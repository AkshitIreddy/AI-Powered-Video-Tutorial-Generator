"""Lifetime ownership for trusted Windows media subprocesses and descendants.

This is process cleanup, not a security sandbox. The caller assigns its freshly
created child immediately, before waiting for output, and retains the job handle
until the whole operation ends. Breakaway is not enabled.
"""

from __future__ import annotations

import ctypes
import os
import subprocess
from ctypes import wintypes
from typing import Any, ClassVar, cast


class _IoCounters(ctypes.Structure):
    _fields_: ClassVar[list[tuple[str, Any]]] = [
        (name, ctypes.c_ulonglong)
        for name in (
            "read_operations", "write_operations", "other_operations",
            "read_bytes", "write_bytes", "other_bytes",
        )
    ]


class _BasicLimits(ctypes.Structure):
    _fields_: ClassVar[list[tuple[str, Any]]] = [
        ("process_time", ctypes.c_longlong),
        ("job_time", ctypes.c_longlong),
        ("flags", wintypes.DWORD),
        ("minimum_working_set", ctypes.c_size_t),
        ("maximum_working_set", ctypes.c_size_t),
        ("active_processes", wintypes.DWORD),
        ("affinity", ctypes.c_size_t),
        ("priority", wintypes.DWORD),
        ("scheduling", wintypes.DWORD),
    ]


class _ExtendedLimits(ctypes.Structure):
    _fields_: ClassVar[list[tuple[str, Any]]] = [
        ("basic", _BasicLimits),
        ("io", _IoCounters),
        ("process_memory", ctypes.c_size_t),
        ("job_memory", ctypes.c_size_t),
        ("peak_process_memory", ctypes.c_size_t),
        ("peak_job_memory", ctypes.c_size_t),
    ]


class WindowsProcessGroup:
    """An unnamed, non-inheritable kill-on-close Windows Job Object."""

    def __init__(self) -> None:
        if os.name != "nt":
            raise OSError("Windows process ownership is only available on Windows")
        api = ctypes.WinDLL("kernel32", use_last_error=True)
        api.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        api.CreateJobObjectW.restype = wintypes.HANDLE
        api.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        api.SetInformationJobObject.restype = wintypes.BOOL
        api.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        api.AssignProcessToJobObject.restype = wintypes.BOOL
        api.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
        api.TerminateJobObject.restype = wintypes.BOOL
        api.CloseHandle.argtypes = [wintypes.HANDLE]
        api.CloseHandle.restype = wintypes.BOOL
        handle = api.CreateJobObjectW(None, None)
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        self._api = api
        self._handle = handle
        self._closed = False
        limits = _ExtendedLimits()
        limits.basic.flags = 0x00002000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not api.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            error = ctypes.WinError(ctypes.get_last_error())
            self.close()
            raise error

    def assign(self, process: subprocess.Popen[bytes]) -> None:
        # Borrow Popen's live process handle; never reopen by a potentially reused PID.
        handle = int(cast(Any, process)._handle)
        if not self._api.AssignProcessToJobObject(self._handle, handle):
            raise ctypes.WinError(ctypes.get_last_error())

    def terminate(self) -> None:
        if not self._closed and not self._api.TerminateJobObject(self._handle, 1):
            raise ctypes.WinError(ctypes.get_last_error())

    def close(self) -> None:
        if not self._closed:
            self._api.CloseHandle(self._handle)
            self._closed = True
