"""Cross-process ownership for Alystria's one shared GPU.

The user-visible marker remains the existing ``yes``/``no`` file.  A guard
holds an operating-system exclusive writer handle for the whole GPU operation,
so cooperating processes cannot both observe ``no`` and then claim it.  Readers
remain allowed while the lease is held.  A process crash deliberately leaves
``yes`` behind and requires verified recovery instead of silently taking over an
unknown GPU workload.
"""

from __future__ import annotations

import ctypes
import os
import stat
import threading
from contextlib import AbstractContextManager
from pathlib import Path
from types import TracebackType
from typing import Any, Protocol, cast

GPU_LOCK_PATH_ENV = "ALYSTRIA_GPU_LOCK_PATH"
GPU_TEMP_DIR_ENV = "ALYSTRIA_TEMP_DIR"
SHARED_GPU_MUTEX_NAME = r"Global\Alystria.SharedGpu"
_FALLBACK_MARKER_NAME = "alystria-gpu-use.txt"
_MARKER_LIMIT_BYTES = 64


class GpuGuardError(RuntimeError):
    """The configured GPU ownership contract could not be honored."""


class GpuGuardBusyError(GpuGuardError):
    """Another operation owns the shared GPU or left a conservative stale claim."""


class GpuGuardPolicyError(GpuGuardError):
    """The marker or named mutex configuration is unsafe."""


class _MarkerLease(Protocol):
    def read(self) -> bytes: ...

    def write(self, value: bytes) -> None: ...

    def close(self) -> None: ...


class _NamedMutexLease(Protocol):
    def close(self) -> None: ...


def configured_gpu_lock_path(explicit: Path | None = None) -> Path:
    """Return the explicit marker or the path forwarded by the desktop host."""

    candidate = explicit
    if candidate is None:
        raw = os.environ.get(GPU_LOCK_PATH_ENV)
        if raw is not None:
            if not raw.strip() or "\x00" in raw:
                raise GpuGuardPolicyError(f"{GPU_LOCK_PATH_ENV} is invalid")
            candidate = Path(raw)
    if candidate is None:
        candidate = _fallback_gpu_lock_path()
    if not candidate.is_absolute() or ".." in candidate.parts:
        raise GpuGuardPolicyError("The GPU marker path must be absolute")
    return candidate


class GpuExecutionGuard(AbstractContextManager["GpuExecutionGuard"]):
    """Hold marker ownership and an optional named mutex until context exit."""

    def __init__(
        self,
        marker_path: Path | None = None,
        *,
        mutex_name: str | None = None,
        owner: str,
    ) -> None:
        if not owner.strip() or "\x00" in owner or len(owner) > 256:
            raise GpuGuardPolicyError("GPU guard owner is invalid")
        if mutex_name is not None and (
            not mutex_name.strip() or "\x00" in mutex_name or len(mutex_name) > 256
        ):
            raise GpuGuardPolicyError("GPU mutex name is invalid")
        self.marker_path = configured_gpu_lock_path(marker_path)
        self.mutex_name = mutex_name
        self.owner = owner
        self._marker: _MarkerLease | None = None
        self._mutexes: list[_NamedMutexLease] = []
        self._owns_marker = False
        self._preserve_claim = False

    def __enter__(self) -> GpuExecutionGuard:
        if self._marker is not None or self._mutexes or self._owns_marker:
            raise GpuGuardPolicyError("GPU guard instances cannot be reused")
        try:
            mutex_names = [SHARED_GPU_MUTEX_NAME]
            if (
                self.mutex_name is not None
                and self.mutex_name.casefold() != SHARED_GPU_MUTEX_NAME.casefold()
            ):
                mutex_names.append(self.mutex_name)
            for mutex_name in mutex_names:
                self._mutexes.append(_acquire_named_mutex(mutex_name))
            self._marker = _open_marker(self.marker_path)
            try:
                state = self._marker.read().decode("utf-8-sig").strip().casefold()
            except UnicodeDecodeError as error:
                raise GpuGuardPolicyError("GPU marker is not valid UTF-8") from error
            if state == "yes":
                raise GpuGuardBusyError(
                    "GPU is already claimed; verify the previous workload has stopped before "
                    "clearing the marker"
                )
            if state != "no":
                raise GpuGuardPolicyError("GPU marker state must be exactly yes or no")
            self._marker.write(b"yes\n")
            self._owns_marker = True
            return self
        except BaseException:
            self._release_after_failed_acquisition()
            raise

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc, traceback
        release_error: BaseException | None = None
        marker = self._marker
        try:
            if marker is not None and self._owns_marker and not self._preserve_claim:
                try:
                    marker.write(b"no\n")
                except BaseException as error:
                    # Closing the handle leaves a conservative yes/unknown state.
                    # Never pretend the shared GPU became available.
                    release_error = error
        finally:
            self._owns_marker = False
            self._preserve_claim = False
            self._marker = None
            try:
                if marker is not None:
                    marker.close()
            finally:
                self._close_mutexes()
        if release_error is not None:
            raise GpuGuardError("Could not release the owned GPU marker") from release_error
        return None

    def preserve_claim(self) -> None:
        """Leave ``yes`` behind when an owned GPU process may still be alive."""

        if self._marker is None or not self._owns_marker:
            raise GpuGuardPolicyError("Only an active GPU owner can preserve its claim")
        self._preserve_claim = True

    def _release_after_failed_acquisition(self) -> None:
        marker = self._marker
        self._marker = None
        try:
            if marker is not None:
                marker.close()
        finally:
            self._close_mutexes()
            self._owns_marker = False
            self._preserve_claim = False

    def _close_mutexes(self) -> None:
        mutexes = self._mutexes
        self._mutexes = []
        first_error: BaseException | None = None
        for mutex in reversed(mutexes):
            try:
                mutex.close()
            except BaseException as error:
                if first_error is None:
                    first_error = error
        if first_error is not None:
            raise first_error


def _open_marker(path: Path) -> _MarkerLease:
    _reject_reparse_chain(path)
    try:
        info = path.lstat()
    except OSError as error:
        raise GpuGuardPolicyError("GPU marker is missing or inaccessible") from error
    if path.is_symlink() or not stat.S_ISREG(info.st_mode):
        raise GpuGuardPolicyError("GPU marker must be a regular non-symlink file")
    if not 0 < info.st_size <= _MARKER_LIMIT_BYTES:
        raise GpuGuardPolicyError("GPU marker has an invalid size")
    if os.name == "nt":
        return _WindowsMarkerLease.open(path)
    return _PosixMarkerLease.open(path)


def _fallback_gpu_lock_path() -> Path:
    raw_temp = os.environ.get(GPU_TEMP_DIR_ENV)
    if raw_temp is None or not raw_temp.strip() or "\x00" in raw_temp:
        raise GpuGuardPolicyError(
            f"{GPU_LOCK_PATH_ENV} or desktop-owned {GPU_TEMP_DIR_ENV} is required for GPU execution"
        )
    temp_root = Path(raw_temp)
    if not temp_root.is_absolute() or ".." in temp_root.parts:
        raise GpuGuardPolicyError("The desktop GPU marker directory must be absolute")
    _reject_reparse_chain(temp_root)
    try:
        root_info = temp_root.lstat()
    except OSError as error:
        raise GpuGuardPolicyError("The desktop GPU marker directory is unavailable") from error
    if not stat.S_ISDIR(root_info.st_mode):
        raise GpuGuardPolicyError("The desktop GPU marker directory must be a directory")
    marker = temp_root / _FALLBACK_MARKER_NAME
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    flags |= getattr(os, "O_BINARY", 0)
    try:
        descriptor = os.open(marker, flags, 0o600)
    except FileExistsError:
        return marker
    except OSError as error:
        raise GpuGuardPolicyError("The desktop GPU marker could not be created") from error
    try:
        if os.write(descriptor, b"no\n") != 3:
            raise OSError("short GPU marker initialization")
        os.fsync(descriptor)
    except OSError as error:
        # Keep a partial marker fail-closed. It must be inspected rather than
        # deleted or silently overwritten by another process.
        raise GpuGuardPolicyError("The desktop GPU marker could not be initialized") from error
    finally:
        os.close(descriptor)
    return marker


def _reject_reparse_chain(path: Path) -> None:
    for candidate in (path, *path.parents):
        try:
            info = candidate.lstat()
        except OSError as error:
            raise GpuGuardPolicyError("GPU marker path contains a missing ancestor") from error
        is_reparse = bool(
            os.name == "nt"
            and info.st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT
        )
        if stat.S_ISLNK(info.st_mode) or is_reparse:
            raise GpuGuardPolicyError("GPU marker path cannot traverse a reparse point")


class _PosixMarkerLease:
    """POSIX fallback: advisory cross-process writer lock on the same inode."""

    def __init__(self, descriptor: int) -> None:
        self.descriptor = descriptor

    @classmethod
    def open(cls, path: Path) -> _PosixMarkerLease:
        import fcntl

        fcntl_api = vars(fcntl)
        flock = cast(Any, fcntl_api["flock"])
        lock_ex = int(fcntl_api["LOCK_EX"])
        lock_nb = int(fcntl_api["LOCK_NB"])
        flags = os.O_RDWR | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(path, flags)
        except OSError as error:
            raise GpuGuardPolicyError("GPU marker could not be opened safely") from error
        try:
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= _MARKER_LIMIT_BYTES:
                raise GpuGuardPolicyError("GPU marker changed before acquisition")
            try:
                flock(descriptor, lock_ex | lock_nb)
            except BlockingIOError as error:
                raise GpuGuardBusyError("GPU marker has another active writer") from error
            return cls(descriptor)
        except BaseException:
            os.close(descriptor)
            raise

    def read(self) -> bytes:
        os.lseek(self.descriptor, 0, os.SEEK_SET)
        return os.read(self.descriptor, _MARKER_LIMIT_BYTES + 1)

    def write(self, value: bytes) -> None:
        os.lseek(self.descriptor, 0, os.SEEK_SET)
        written = os.write(self.descriptor, value)
        if written != len(value):
            raise OSError("short GPU marker write")
        os.ftruncate(self.descriptor, len(value))
        os.fsync(self.descriptor)

    def close(self) -> None:
        import fcntl

        fcntl_api = vars(fcntl)
        flock = cast(Any, fcntl_api["flock"])
        lock_un = int(fcntl_api["LOCK_UN"])
        try:
            flock(self.descriptor, lock_un)
        finally:
            os.close(self.descriptor)


class _WindowsMarkerLease:
    """Windows marker handle shared for reads and denied to writers/deleters."""

    def __init__(self, handle: int) -> None:
        self.handle = handle

    @classmethod
    def open(cls, path: Path) -> _WindowsMarkerLease:
        kernel32 = _kernel32()
        create_file = kernel32.CreateFileW
        create_file.argtypes = [
            ctypes.c_wchar_p,
            ctypes.c_uint32,
            ctypes.c_uint32,
            ctypes.c_void_p,
            ctypes.c_uint32,
            ctypes.c_uint32,
            ctypes.c_void_p,
        ]
        create_file.restype = ctypes.c_void_p
        handle = create_file(
            str(path),
            0x80000000 | 0x40000000,  # GENERIC_READ | GENERIC_WRITE
            0x00000001,  # FILE_SHARE_READ only
            None,
            3,  # OPEN_EXISTING
            0x00200000,  # FILE_FLAG_OPEN_REPARSE_POINT
            None,
        )
        invalid = ctypes.c_void_p(-1).value
        if handle in {None, invalid}:
            error_code = ctypes.get_last_error()
            if error_code in {32, 33}:  # sharing or lock violation
                raise GpuGuardBusyError("GPU marker has another active writer")
            raise GpuGuardPolicyError(
                f"GPU marker could not be opened safely (Windows error {error_code})"
            )
        lease = cls(int(handle))
        try:
            lease._validate_regular_file()
            return lease
        except BaseException:
            lease.close()
            raise

    def _validate_regular_file(self) -> None:
        kernel32 = _kernel32()
        information = _ByHandleFileInformation()
        if not kernel32.GetFileInformationByHandle(
            ctypes.c_void_p(self.handle), ctypes.byref(information)
        ):
            raise GpuGuardPolicyError("GPU marker identity could not be verified")
        attributes = int(information.file_attributes)
        size = (int(information.file_size_high) << 32) | int(information.file_size_low)
        if attributes & 0x00000010 or attributes & 0x00000400:
            raise GpuGuardPolicyError("GPU marker cannot be a directory or reparse point")
        if not 0 < size <= _MARKER_LIMIT_BYTES:
            raise GpuGuardPolicyError("GPU marker changed before acquisition")
        if _kernel32().GetFileType(ctypes.c_void_p(self.handle)) != 0x0001:
            raise GpuGuardPolicyError("GPU marker must be a disk file")

    def read(self) -> bytes:
        self._seek_start()
        kernel32 = _kernel32()
        buffer = ctypes.create_string_buffer(_MARKER_LIMIT_BYTES + 1)
        count = ctypes.c_uint32()
        if not kernel32.ReadFile(
            ctypes.c_void_p(self.handle),
            buffer,
            len(buffer),
            ctypes.byref(count),
            None,
        ):
            raise OSError(ctypes.get_last_error(), "Could not read GPU marker")
        return buffer.raw[: count.value]

    def write(self, value: bytes) -> None:
        self._seek_start()
        kernel32 = _kernel32()
        count = ctypes.c_uint32()
        buffer = ctypes.create_string_buffer(value)
        if not kernel32.WriteFile(
            ctypes.c_void_p(self.handle),
            buffer,
            len(value),
            ctypes.byref(count),
            None,
        ) or count.value != len(value):
            raise OSError(ctypes.get_last_error(), "Could not write GPU marker")
        if not kernel32.SetEndOfFile(ctypes.c_void_p(self.handle)):
            raise OSError(ctypes.get_last_error(), "Could not truncate GPU marker")
        if not kernel32.FlushFileBuffers(ctypes.c_void_p(self.handle)):
            raise OSError(ctypes.get_last_error(), "Could not flush GPU marker")

    def _seek_start(self) -> None:
        new_position = ctypes.c_longlong()
        if not _kernel32().SetFilePointerEx(
            ctypes.c_void_p(self.handle),
            ctypes.c_longlong(0),
            ctypes.byref(new_position),
            0,
        ):
            raise OSError(ctypes.get_last_error(), "Could not seek GPU marker")

    def close(self) -> None:
        if self.handle:
            _kernel32().CloseHandle(ctypes.c_void_p(self.handle))
            self.handle = 0


class _ByHandleFileInformation(ctypes.Structure):
    _fields_ = [
        ("file_attributes", ctypes.c_uint32),
        ("creation_time_low", ctypes.c_uint32),
        ("creation_time_high", ctypes.c_uint32),
        ("last_access_time_low", ctypes.c_uint32),
        ("last_access_time_high", ctypes.c_uint32),
        ("last_write_time_low", ctypes.c_uint32),
        ("last_write_time_high", ctypes.c_uint32),
        ("volume_serial_number", ctypes.c_uint32),
        ("file_size_high", ctypes.c_uint32),
        ("file_size_low", ctypes.c_uint32),
        ("number_of_links", ctypes.c_uint32),
        ("file_index_high", ctypes.c_uint32),
        ("file_index_low", ctypes.c_uint32),
    ]


class _WindowsNamedMutexLease:
    def __init__(self, handle: int) -> None:
        self.handle = handle

    def close(self) -> None:
        if self.handle:
            kernel32 = _kernel32()
            kernel32.ReleaseMutex(ctypes.c_void_p(self.handle))
            kernel32.CloseHandle(ctypes.c_void_p(self.handle))
            self.handle = 0


_fallback_mutex_registry_lock = threading.Lock()
_fallback_mutexes: dict[str, threading.Lock] = {}


class _FallbackNamedMutexLease:
    """Non-Windows named-mutex fallback; the marker lock remains cross-process."""

    def __init__(self, mutex: threading.Lock) -> None:
        self.mutex = mutex

    def close(self) -> None:
        self.mutex.release()


def _acquire_named_mutex(name: str) -> _NamedMutexLease:
    if os.name != "nt":
        with _fallback_mutex_registry_lock:
            mutex = _fallback_mutexes.setdefault(name, threading.Lock())
        if not mutex.acquire(blocking=False):
            raise GpuGuardBusyError("GPU named mutex is already owned in this process")
        return _FallbackNamedMutexLease(mutex)

    kernel32 = _kernel32()
    create_mutex = kernel32.CreateMutexW
    create_mutex.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p]
    create_mutex.restype = ctypes.c_void_p
    canonical_name = _canonical_windows_mutex_name(name)
    handle = create_mutex(None, 0, canonical_name)
    if not handle:
        raise GpuGuardPolicyError(
            f"GPU named mutex could not be opened (Windows error {ctypes.get_last_error()})"
        )
    wait_result = kernel32.WaitForSingleObject(ctypes.c_void_p(handle), 0)
    if wait_result in {0x00000000, 0x00000080}:  # acquired or abandoned-and-acquired
        return _WindowsNamedMutexLease(int(handle))
    kernel32.CloseHandle(ctypes.c_void_p(handle))
    if wait_result == 0x00000102:
        raise GpuGuardBusyError("GPU named mutex is already owned")
    raise GpuGuardPolicyError("GPU named mutex wait failed")


def _canonical_windows_mutex_name(name: str) -> str:
    lowered = name.casefold()
    for prefix in ("global\\", "local\\"):
        if lowered.startswith(prefix):
            return prefix.title() + name[len(prefix) :]
    return name


def _kernel32() -> Any:
    win_dll = getattr(ctypes, "WinDLL", None)
    if win_dll is None:
        raise GpuGuardPolicyError("Windows GPU guard APIs are unavailable")
    return win_dll("kernel32", use_last_error=True)
