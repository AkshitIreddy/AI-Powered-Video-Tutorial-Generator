"""Portable hardware inventory probes with injectable command execution."""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Protocol


class ComputeBackend(StrEnum):
    NVIDIA_CUDA = "nvidia-cuda"
    AMD_ROCM = "amd-rocm"
    APPLE_METAL = "apple-metal"
    CPU = "cpu"


@dataclass(frozen=True, slots=True)
class ComputeDevice:
    device_id: str
    name: str
    backend: ComputeBackend
    total_memory_bytes: int
    free_memory_bytes: int
    driver_version: str | None = None
    compute_capability: str | None = None

    def __post_init__(self) -> None:
        if self.total_memory_bytes < 0 or self.free_memory_bytes < 0:
            raise ValueError("device memory cannot be negative")
        if self.free_memory_bytes > self.total_memory_bytes:
            raise ValueError("free device memory cannot exceed total memory")


@dataclass(frozen=True, slots=True)
class HardwareInventory:
    os_name: str
    architecture: str
    cpu_name: str
    cpu_threads: int
    ram_total_bytes: int
    ram_available_bytes: int
    disk_free_bytes: int
    devices: tuple[ComputeDevice, ...]
    warnings: tuple[str, ...] = ()

    def accelerator(self, device_id: str) -> ComputeDevice | None:
        return next((device for device in self.devices if device.device_id == device_id), None)


class HardwareProbe(Protocol):
    def probe(self, install_root: Path) -> HardwareInventory: ...


@dataclass(frozen=True, slots=True)
class CommandResult:
    returncode: int
    stdout: str
    stderr: str = ""


class CommandRunner(Protocol):
    def run(self, argv: tuple[str, ...], *, timeout_seconds: float) -> CommandResult: ...


class SubprocessRunner:
    def run(self, argv: tuple[str, ...], *, timeout_seconds: float) -> CommandResult:
        completed = subprocess.run(
            argv,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            shell=False,
        )
        return CommandResult(completed.returncode, completed.stdout, completed.stderr)


class AcceleratorProbe(Protocol):
    def devices(self) -> tuple[ComputeDevice, ...]: ...


class NvidiaSmiProbe:
    _QUERY = (
        "nvidia-smi",
        "--query-gpu=uuid,name,memory.total,memory.free,driver_version,compute_cap",
        "--format=csv,noheader,nounits",
    )

    def __init__(self, runner: CommandRunner | None = None) -> None:
        self._runner = runner or SubprocessRunner()

    def devices(self) -> tuple[ComputeDevice, ...]:
        result = self._runner.run(self._QUERY, timeout_seconds=5.0)
        if result.returncode != 0:
            return ()
        devices: list[ComputeDevice] = []
        for line in result.stdout.splitlines():
            fields = [field.strip() for field in line.split(",")]
            if len(fields) != 6:
                continue
            try:
                total_mib = int(fields[2])
                free_mib = int(fields[3])
            except ValueError:
                continue
            devices.append(
                ComputeDevice(
                    device_id=fields[0],
                    name=fields[1],
                    backend=ComputeBackend.NVIDIA_CUDA,
                    total_memory_bytes=total_mib * 1024 * 1024,
                    free_memory_bytes=free_mib * 1024 * 1024,
                    driver_version=fields[4],
                    compute_capability=fields[5],
                )
            )
        return tuple(devices)


class AmdRocmProbe:
    """Read stable memory totals from `rocm-smi --showmeminfo vram --json`."""

    _QUERY = ("rocm-smi", "--showproductname", "--showmeminfo", "vram", "--json")

    def __init__(self, runner: CommandRunner | None = None) -> None:
        self._runner = runner or SubprocessRunner()

    def devices(self) -> tuple[ComputeDevice, ...]:
        result = self._runner.run(self._QUERY, timeout_seconds=5.0)
        if result.returncode != 0:
            return ()
        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
            return ()
        devices: list[ComputeDevice] = []
        for card_id, card in sorted(data.items()):
            if not isinstance(card, dict):
                continue
            try:
                total = int(card["VRAM Total Memory (B)"])
                used = int(card.get("VRAM Total Used Memory (B)", 0))
            except (KeyError, TypeError, ValueError):
                continue
            devices.append(
                ComputeDevice(
                    device_id=f"rocm:{card_id}",
                    name=str(card.get("Card series", card.get("Card model", card_id))),
                    backend=ComputeBackend.AMD_ROCM,
                    total_memory_bytes=total,
                    free_memory_bytes=max(0, total - used),
                )
            )
        return tuple(devices)


class AppleMetalProbe:
    _QUERY = ("system_profiler", "SPDisplaysDataType", "-json")

    def __init__(self, runner: CommandRunner | None = None) -> None:
        self._runner = runner or SubprocessRunner()

    def devices(self) -> tuple[ComputeDevice, ...]:
        if platform.system() != "Darwin":
            return ()
        result = self._runner.run(self._QUERY, timeout_seconds=10.0)
        if result.returncode != 0:
            return ()
        try:
            displays = json.loads(result.stdout).get("SPDisplaysDataType", [])
        except (json.JSONDecodeError, AttributeError):
            return ()
        total_ram = _ram_total_bytes()
        return tuple(
            ComputeDevice(
                device_id=f"metal:{index}",
                name=str(item.get("sppci_model", "Apple GPU")),
                backend=ComputeBackend.APPLE_METAL,
                total_memory_bytes=total_ram,
                free_memory_bytes=_ram_available_bytes(),
            )
            for index, item in enumerate(displays)
            if isinstance(item, dict) and "Apple" in str(item.get("sppci_model", ""))
        )


class SystemHardwareProbe:
    """Combine best-effort accelerator probes with always-available host facts."""

    def __init__(self, accelerator_probes: tuple[AcceleratorProbe, ...] | None = None) -> None:
        self._accelerator_probes = accelerator_probes or (
            NvidiaSmiProbe(),
            AmdRocmProbe(),
            AppleMetalProbe(),
        )

    def probe(self, install_root: Path) -> HardwareInventory:
        warnings: list[str] = []
        devices: list[ComputeDevice] = []
        for candidate in self._accelerator_probes:
            try:
                devices.extend(candidate.devices())
            except (OSError, subprocess.SubprocessError, ValueError) as exc:
                warnings.append(f"{candidate.__class__.__name__}: {exc}")
        cpu_threads = os.cpu_count() or 1
        devices.append(
            ComputeDevice(
                device_id="cpu:0",
                name=platform.processor() or platform.machine() or "CPU",
                backend=ComputeBackend.CPU,
                total_memory_bytes=_ram_total_bytes(),
                free_memory_bytes=_ram_available_bytes(),
            )
        )
        return HardwareInventory(
            os_name=platform.system(),
            architecture=platform.machine(),
            cpu_name=platform.processor() or platform.machine() or "CPU",
            cpu_threads=cpu_threads,
            ram_total_bytes=_ram_total_bytes(),
            ram_available_bytes=_ram_available_bytes(),
            disk_free_bytes=shutil.disk_usage(install_root).free,
            devices=tuple(devices),
            warnings=tuple(warnings),
        )


def _ram_total_bytes() -> int:
    if platform.system() == "Windows":
        try:
            import ctypes

            class MemoryStatus(ctypes.Structure):
                _fields_ = [
                    ("length", ctypes.c_ulong),
                    ("memory_load", ctypes.c_ulong),
                    ("total_physical", ctypes.c_ulonglong),
                    ("available_physical", ctypes.c_ulonglong),
                    ("total_page_file", ctypes.c_ulonglong),
                    ("available_page_file", ctypes.c_ulonglong),
                    ("total_virtual", ctypes.c_ulonglong),
                    ("available_virtual", ctypes.c_ulonglong),
                    ("available_extended_virtual", ctypes.c_ulonglong),
                ]

            status = MemoryStatus()
            status.length = ctypes.sizeof(MemoryStatus)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return int(status.total_physical)
        except (AttributeError, OSError):
            pass
    pages = _sysconf("SC_PHYS_PAGES")
    page_size = _sysconf("SC_PAGE_SIZE")
    return pages * page_size if pages and page_size else 0


def _ram_available_bytes() -> int:
    if platform.system() == "Linux":
        try:
            for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) * 1024
        except (OSError, ValueError, IndexError):
            pass
    pages = _sysconf("SC_AVPHYS_PAGES")
    page_size = _sysconf("SC_PAGE_SIZE")
    available = pages * page_size if pages and page_size else 0
    return available or _ram_total_bytes()


def _sysconf(name: str) -> int:
    try:
        sysconf = getattr(os, "sysconf", None)
        if sysconf is None:
            return 0
        return int(sysconf(name))
    except (AttributeError, OSError, ValueError):
        return 0
