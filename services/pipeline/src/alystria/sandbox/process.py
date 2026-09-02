"""Bounded subprocess execution with whole-process-tree teardown."""

from __future__ import annotations

import contextlib
import ctypes
import importlib
import math
import os
import signal
import subprocess
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any, BinaryIO, ClassVar, Protocol, cast


class TerminationReason(StrEnum):
    EXITED = "exited"
    TIMED_OUT = "timed-out"
    CANCELLED = "cancelled"
    OUTPUT_LIMIT = "output-limit"
    START_FAILED = "start-failed"


@dataclass(frozen=True, slots=True)
class ProcessLimits:
    wall_time_ms: int
    cpu_time_ms: int
    memory_bytes: int
    output_bytes: int


@dataclass(frozen=True, slots=True)
class ProcessPlan:
    argv: tuple[str, ...]
    environment: tuple[tuple[str, str], ...]
    cwd: Path
    limits: ProcessLimits
    result_path: Path | None = None
    result_bytes: int = 0

    def __post_init__(self) -> None:
        if not self.argv or not Path(self.argv[0]).is_absolute():
            raise ValueError("sandbox process executable must be absolute")
        if any("\x00" in value for value in self.argv):
            raise ValueError("sandbox process argument contains NUL")
        if not self.cwd.is_absolute():
            raise ValueError("sandbox process working directory must be absolute")


@dataclass(frozen=True, slots=True)
class RawProcessResult:
    returncode: int | None
    stdout: bytes
    stderr: bytes
    duration_ms: int
    reason: TerminationReason
    start_error: str | None = None


@dataclass(frozen=True, slots=True)
class ProbeResult:
    returncode: int | None
    stdout: str
    stderr: str
    error: str | None = None


class ProcessRunner(Protocol):
    def probe(self, argv: tuple[str, ...], *, environment: Mapping[str, str]) -> ProbeResult: ...

    def run(
        self, plan: ProcessPlan, *, cancellation: threading.Event | None = None
    ) -> RawProcessResult: ...


class _BoundedStreams:
    def __init__(self, maximum: int) -> None:
        self._maximum = maximum
        self._remaining = maximum
        self._lock = threading.Lock()
        self.exceeded = threading.Event()
        self.stdout = bytearray()
        self.stderr = bytearray()

    def consume(self, stream: BinaryIO, destination: bytearray) -> None:
        while True:
            chunk = stream.read(16 * 1024)
            if not chunk:
                return
            with self._lock:
                accepted = min(self._remaining, len(chunk))
                if accepted:
                    destination.extend(chunk[:accepted])
                    self._remaining -= accepted
                if accepted != len(chunk):
                    self.exceeded.set()


class SubprocessRunner:
    """Production runner. It never invokes a shell or inherits the host environment."""

    def probe(self, argv: tuple[str, ...], *, environment: Mapping[str, str]) -> ProbeResult:
        try:
            completed = subprocess.run(
                argv,
                check=False,
                capture_output=True,
                timeout=2.0,
                shell=False,
                env=_platform_environment(environment),
                creationflags=int(getattr(subprocess, "CREATE_NO_WINDOW", 0)),
            )
        except (OSError, subprocess.SubprocessError) as error:
            return ProbeResult(None, "", "", str(error))
        return ProbeResult(
            completed.returncode,
            completed.stdout[:16_384].decode("utf-8", "replace"),
            completed.stderr[:16_384].decode("utf-8", "replace"),
        )

    def run(
        self, plan: ProcessPlan, *, cancellation: threading.Event | None = None
    ) -> RawProcessResult:
        started = time.monotonic()
        try:
            if os.name == "nt":
                process = subprocess.Popen(
                    plan.argv,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    cwd=plan.cwd,
                    env=_platform_environment(dict(plan.environment)),
                    shell=False,
                    creationflags=(
                        subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
                    ),
                )
            else:
                process = subprocess.Popen(
                    plan.argv,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    cwd=plan.cwd,
                    env=_platform_environment(dict(plan.environment)),
                    shell=False,
                    start_new_session=True,
                    preexec_fn=_posix_limits(plan.limits),
                )
        except OSError as error:
            return RawProcessResult(
                None,
                b"",
                b"",
                int((time.monotonic() - started) * 1_000),
                TerminationReason.START_FAILED,
                str(error),
            )
        windows_job: _WindowsJob | None = None
        if os.name == "nt":
            try:
                windows_job = _WindowsJob.create(plan.limits)
                windows_job.assign(process)
            except OSError as error:
                _terminate_process_tree(process, windows_job)
                if windows_job is not None:
                    windows_job.close()
                return RawProcessResult(
                    process.returncode,
                    b"",
                    b"",
                    int((time.monotonic() - started) * 1_000),
                    TerminationReason.START_FAILED,
                    f"cannot apply Windows sandbox job limits: {error}",
                )
        assert process.stdout is not None
        assert process.stderr is not None
        streams = _BoundedStreams(plan.limits.output_bytes)
        readers = (
            threading.Thread(
                target=streams.consume, args=(process.stdout, streams.stdout), daemon=True
            ),
            threading.Thread(
                target=streams.consume, args=(process.stderr, streams.stderr), daemon=True
            ),
        )
        for reader in readers:
            reader.start()
        reason = TerminationReason.EXITED
        deadline = started + plan.limits.wall_time_ms / 1_000
        while process.poll() is None:
            if cancellation is not None and cancellation.is_set():
                reason = TerminationReason.CANCELLED
                _terminate_process_tree(process, windows_job)
                break
            if streams.exceeded.is_set():
                reason = TerminationReason.OUTPUT_LIMIT
                _terminate_process_tree(process, windows_job)
                break
            if time.monotonic() >= deadline:
                reason = TerminationReason.TIMED_OUT
                _terminate_process_tree(process, windows_job)
                break
            time.sleep(0.01)
        with contextlib.suppress(subprocess.TimeoutExpired):
            process.wait(timeout=1.0)
        if process.poll() is None:
            _kill_process_tree(process, windows_job)
            process.wait(timeout=1.0)
        for reader in readers:
            reader.join(timeout=1.0)
        result = RawProcessResult(
            process.returncode,
            bytes(streams.stdout),
            bytes(streams.stderr),
            int((time.monotonic() - started) * 1_000),
            reason,
        )
        if windows_job is not None:
            windows_job.close()
        return result


def _platform_environment(environment: Mapping[str, str]) -> dict[str, str]:
    clean = dict(environment)
    if os.name == "nt":
        for name in ("SYSTEMROOT", "WINDIR"):
            if name in os.environ:
                clean[name] = os.environ[name]
    return clean


def _posix_limits(limits: ProcessLimits) -> Callable[[], None]:
    # Resolve the module before fork. Import machinery is not async-signal-safe
    # and must never run in Popen's child-side preexec function.
    resource_api = cast(Any, importlib.import_module("resource"))

    def apply() -> None:
        cpu_seconds = max(1, math.ceil(limits.cpu_time_ms / 1_000))
        resource_api.setrlimit(resource_api.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
        resource_api.setrlimit(resource_api.RLIMIT_AS, (limits.memory_bytes, limits.memory_bytes))
        resource_api.setrlimit(
            resource_api.RLIMIT_FSIZE, (limits.output_bytes, limits.output_bytes)
        )
        resource_api.setrlimit(resource_api.RLIMIT_NOFILE, (32, 32))
        os.umask(0o077)

    return apply


def _terminate_process_tree(
    process: subprocess.Popen[bytes], windows_job: _WindowsJob | None = None
) -> None:
    if os.name == "nt":
        if windows_job is not None:
            windows_job.terminate()
            return
        _windows_taskkill(process.pid)
        return
    with contextlib.suppress(ProcessLookupError):
        os.kill(-process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=0.25)
    except subprocess.TimeoutExpired:
        _kill_process_tree(process, windows_job)


def _kill_process_tree(
    process: subprocess.Popen[bytes], windows_job: _WindowsJob | None = None
) -> None:
    if os.name == "nt":
        if windows_job is not None:
            windows_job.terminate()
            return
        _windows_taskkill(process.pid)
        return
    with contextlib.suppress(ProcessLookupError):
        os.kill(-process.pid, cast(Any, signal).SIGKILL)


def _windows_taskkill(pid: int) -> None:
    # taskkill /T is the supported Windows process-tree primitive. The PID is
    # obtained directly from Popen and never from guest-controlled text.
    with contextlib.suppress(OSError, subprocess.SubprocessError):
        subprocess.run(
            ("taskkill.exe", "/PID", str(pid), "/T", "/F"),
            check=False,
            capture_output=True,
            timeout=2.0,
            shell=False,
            creationflags=int(getattr(subprocess, "CREATE_NO_WINDOW", 0)),
        )


class _WindowsJob:
    """Minimal Windows Job Object wrapper for hard resource and child limits."""

    _JOB_OBJECT_LIMIT_PROCESS_TIME = 0x00000002
    _JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008
    _JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100
    _JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
    _JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9

    def __init__(self, handle: int) -> None:
        self._handle = handle
        self._closed = False

    @classmethod
    def create(cls, limits: ProcessLimits) -> _WindowsJob:
        if os.name != "nt":
            raise OSError("Windows Job Objects are unavailable on this platform")
        ctypes_api = cast(Any, ctypes)

        class IoCounters(ctypes.Structure):
            _fields_: ClassVar[list[tuple[str, Any]]] = [
                ("ReadOperationCount", ctypes.c_ulonglong),
                ("WriteOperationCount", ctypes.c_ulonglong),
                ("OtherOperationCount", ctypes.c_ulonglong),
                ("ReadTransferCount", ctypes.c_ulonglong),
                ("WriteTransferCount", ctypes.c_ulonglong),
                ("OtherTransferCount", ctypes.c_ulonglong),
            ]

        class BasicLimitInformation(ctypes.Structure):
            _fields_: ClassVar[list[tuple[str, Any]]] = [
                ("PerProcessUserTimeLimit", ctypes.c_longlong),
                ("PerJobUserTimeLimit", ctypes.c_longlong),
                ("LimitFlags", ctypes.c_ulong),
                ("MinimumWorkingSetSize", ctypes.c_size_t),
                ("MaximumWorkingSetSize", ctypes.c_size_t),
                ("ActiveProcessLimit", ctypes.c_ulong),
                ("Affinity", ctypes.c_size_t),
                ("PriorityClass", ctypes.c_ulong),
                ("SchedulingClass", ctypes.c_ulong),
            ]

        class ExtendedLimitInformation(ctypes.Structure):
            _fields_: ClassVar[list[tuple[str, Any]]] = [
                ("BasicLimitInformation", BasicLimitInformation),
                ("IoInfo", IoCounters),
                ("ProcessMemoryLimit", ctypes_api.c_size_t),
                ("JobMemoryLimit", ctypes_api.c_size_t),
                ("PeakProcessMemoryUsed", ctypes_api.c_size_t),
                ("PeakJobMemoryUsed", ctypes_api.c_size_t),
            ]

        kernel32 = ctypes_api.windll.kernel32
        kernel32.CreateJobObjectW.restype = ctypes.c_void_p
        handle = kernel32.CreateJobObjectW(None, None)
        if not handle:
            raise ctypes_api.WinError()
        info = ExtendedLimitInformation()
        info.BasicLimitInformation.LimitFlags = (
            cls._JOB_OBJECT_LIMIT_PROCESS_TIME
            | cls._JOB_OBJECT_LIMIT_ACTIVE_PROCESS
            | cls._JOB_OBJECT_LIMIT_PROCESS_MEMORY
            | cls._JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        )
        info.BasicLimitInformation.PerProcessUserTimeLimit = limits.cpu_time_ms * 10_000
        info.BasicLimitInformation.ActiveProcessLimit = 1
        info.ProcessMemoryLimit = limits.memory_bytes
        ok = kernel32.SetInformationJobObject(
            handle,
            cls._JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
            ctypes_api.byref(info),
            ctypes_api.sizeof(info),
        )
        if not ok:
            error = ctypes_api.WinError()
            kernel32.CloseHandle(handle)
            raise error
        return cls(int(handle))

    def assign(self, process: subprocess.Popen[bytes]) -> None:
        kernel32 = cast(Any, ctypes).windll.kernel32
        process_handle = cast(Any, process)._handle
        if not kernel32.AssignProcessToJobObject(self._handle, process_handle):
            raise cast(Any, ctypes).WinError()

    def terminate(self) -> None:
        if not self._closed:
            cast(Any, ctypes).windll.kernel32.TerminateJobObject(self._handle, 1)

    def close(self) -> None:
        if not self._closed:
            cast(Any, ctypes).windll.kernel32.CloseHandle(self._handle)
            self._closed = True
