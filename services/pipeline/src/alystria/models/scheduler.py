"""Fair in-process RAM/VRAM/CPU leasing for local model workers."""

from __future__ import annotations

import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass

from .domain import ResourceEstimate
from .errors import ResourceUnavailableError
from .hardware import ComputeBackend, ComputeDevice, HardwareInventory

GIB = 1024**3


@dataclass(frozen=True, slots=True)
class ResourcePolicy:
    ram_headroom_bytes: int = 2 * GIB
    ram_headroom_fraction: float = 0.15
    vram_headroom_bytes: int = 768 * 1024**2
    vram_headroom_fraction: float = 0.08
    serial_gpu_total_memory_threshold: int = 13 * GIB

    def __post_init__(self) -> None:
        if self.ram_headroom_bytes < 0 or self.vram_headroom_bytes < 0:
            raise ValueError("resource headroom cannot be negative")
        if not 0 <= self.ram_headroom_fraction < 1:
            raise ValueError("RAM headroom fraction must be in [0, 1)")
        if not 0 <= self.vram_headroom_fraction < 1:
            raise ValueError("VRAM headroom fraction must be in [0, 1)")


@dataclass(frozen=True, slots=True)
class LeaseRequest:
    owner: str
    model_install_key: str
    resources: ResourceEstimate
    preferred_device_id: str | None = None
    allowed_backends: frozenset[ComputeBackend] = frozenset(
        {ComputeBackend.NVIDIA_CUDA, ComputeBackend.AMD_ROCM, ComputeBackend.APPLE_METAL}
    )


@dataclass(frozen=True, slots=True)
class LeaseSnapshot:
    lease_id: str
    owner: str
    model_install_key: str
    device_id: str | None
    ram_bytes: int
    vram_bytes: int
    cpu_threads: int
    acquired_at: float


@dataclass(slots=True)
class _Allocation:
    snapshot: LeaseSnapshot
    gpu_heavy: bool


class ResourceLease:
    def __init__(self, scheduler: ResourceScheduler, snapshot: LeaseSnapshot) -> None:
        self._scheduler = scheduler
        self.snapshot = snapshot
        self._released = False

    def release(self) -> None:
        if not self._released:
            self._scheduler.release(self.snapshot.lease_id)
            self._released = True

    def __enter__(self) -> ResourceLease:
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        del exc_type, exc, traceback
        self.release()


class ResourceScheduler:
    """Reserve local compute capacity without overcommitting a laptop.

    Requests are FIFO. A request at the head waits rather than being leapfrogged,
    which prevents a stream of small tasks from starving image/avatar work. On
    GPUs at or below the configured threshold (including Alystria's 12 GB target),
    GPU-heavy leases are serialized even when their byte estimates might fit.
    """

    def __init__(
        self,
        inventory: HardwareInventory,
        policy: ResourcePolicy | None = None,
    ) -> None:
        self.inventory = inventory
        self.policy = policy or ResourcePolicy()
        self._condition = threading.Condition(threading.RLock())
        self._waiters: deque[str] = deque()
        self._allocations: dict[str, _Allocation] = {}

    def acquire(
        self,
        request: LeaseRequest,
        *,
        timeout_seconds: float | None = None,
    ) -> ResourceLease:
        if timeout_seconds is not None and timeout_seconds < 0:
            raise ValueError("timeout_seconds cannot be negative")
        ticket = uuid.uuid4().hex
        deadline = time.monotonic() + timeout_seconds if timeout_seconds is not None else None
        with self._condition:
            self._waiters.append(ticket)
            try:
                while True:
                    if self._waiters[0] == ticket:
                        device = self._select_device(request)
                        if self._capacity_available(request, device):
                            snapshot = self._commit(request, device)
                            self._waiters.popleft()
                            self._condition.notify_all()
                            return ResourceLease(self, snapshot)
                    remaining = None if deadline is None else deadline - time.monotonic()
                    if remaining is not None and remaining <= 0:
                        raise ResourceUnavailableError(
                            f"timed out waiting for resources for {request.model_install_key}"
                        )
                    self._condition.wait(timeout=remaining)
            finally:
                if ticket in self._waiters:
                    self._waiters.remove(ticket)
                    self._condition.notify_all()

    def try_acquire(self, request: LeaseRequest) -> ResourceLease:
        return self.acquire(request, timeout_seconds=0)

    def release(self, lease_id: str) -> None:
        with self._condition:
            if self._allocations.pop(lease_id, None) is None:
                raise KeyError(f"unknown or already released lease: {lease_id}")
            self._condition.notify_all()

    def active_leases(self) -> tuple[LeaseSnapshot, ...]:
        with self._condition:
            return tuple(
                allocation.snapshot
                for allocation in sorted(
                    self._allocations.values(), key=lambda item: item.snapshot.acquired_at
                )
            )

    def active_model_keys(self) -> frozenset[str]:
        return frozenset(item.model_install_key for item in self.active_leases())

    def _select_device(self, request: LeaseRequest) -> ComputeDevice | None:
        if request.resources.vram_bytes == 0:
            return None
        candidates = [
            device
            for device in self.inventory.devices
            if device.backend in request.allowed_backends
            and device.backend is not ComputeBackend.CPU
        ]
        if request.preferred_device_id:
            candidates = [
                device for device in candidates if device.device_id == request.preferred_device_id
            ]
        candidates.sort(key=lambda device: device.free_memory_bytes, reverse=True)
        return candidates[0] if candidates else None

    def _capacity_available(self, request: LeaseRequest, device: ComputeDevice | None) -> bool:
        allocated_ram = sum(item.snapshot.ram_bytes for item in self._allocations.values())
        allocated_threads = sum(item.snapshot.cpu_threads for item in self._allocations.values())
        ram_headroom = max(
            self.policy.ram_headroom_bytes,
            int(self.inventory.ram_total_bytes * self.policy.ram_headroom_fraction),
        )
        usable_ram = max(0, self.inventory.ram_available_bytes - ram_headroom)
        if allocated_ram + request.resources.ram_bytes > usable_ram:
            return False
        if allocated_threads + request.resources.minimum_cpu_threads > self.inventory.cpu_threads:
            return False
        if request.resources.vram_bytes == 0:
            return True
        if device is None:
            return False
        allocated_vram = sum(
            item.snapshot.vram_bytes
            for item in self._allocations.values()
            if item.snapshot.device_id == device.device_id
        )
        vram_headroom = max(
            self.policy.vram_headroom_bytes,
            int(device.total_memory_bytes * self.policy.vram_headroom_fraction),
        )
        usable_vram = max(0, device.free_memory_bytes - vram_headroom)
        if allocated_vram + request.resources.vram_bytes > usable_vram:
            return False
        if request.resources.gpu_heavy and (
            device.total_memory_bytes <= self.policy.serial_gpu_total_memory_threshold
        ):
            return not any(
                item.gpu_heavy and item.snapshot.device_id == device.device_id
                for item in self._allocations.values()
            )
        return True

    def _commit(self, request: LeaseRequest, device: ComputeDevice | None) -> LeaseSnapshot:
        snapshot = LeaseSnapshot(
            lease_id=uuid.uuid4().hex,
            owner=request.owner,
            model_install_key=request.model_install_key,
            device_id=device.device_id if device else None,
            ram_bytes=request.resources.ram_bytes,
            vram_bytes=request.resources.vram_bytes,
            cpu_threads=request.resources.minimum_cpu_threads,
            acquired_at=time.time(),
        )
        self._allocations[snapshot.lease_id] = _Allocation(
            snapshot=snapshot,
            gpu_heavy=request.resources.gpu_heavy,
        )
        return snapshot
