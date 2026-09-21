from __future__ import annotations

import threading

import pytest

from alystria.models import (
    BUILTIN_CATALOG,
    ComputeBackend,
    ComputeDevice,
    HardwareInventory,
    LeaseRequest,
    ResourceEstimate,
    ResourceScheduler,
    ResourceUnavailableError,
)

GIB = 1024**3


class FakeHardwareProbe:
    def __init__(self, inventory: HardwareInventory) -> None:
        self.inventory = inventory
        self.calls = 0

    def probe(self, install_root):
        del install_root
        self.calls += 1
        return self.inventory


def laptop_inventory() -> HardwareInventory:
    return HardwareInventory(
        os_name="Windows",
        architecture="AMD64",
        cpu_name="Test CPU",
        cpu_threads=16,
        ram_total_bytes=32 * GIB,
        ram_available_bytes=24 * GIB,
        disk_free_bytes=500 * GIB,
        devices=(
            ComputeDevice(
                device_id="GPU-test",
                name="RTX 4080 Laptop GPU",
                backend=ComputeBackend.NVIDIA_CUDA,
                total_memory_bytes=12 * GIB,
                free_memory_bytes=11 * GIB,
            ),
        ),
    )


def heavy_request(owner: str, model: str) -> LeaseRequest:
    return LeaseRequest(
        owner=owner,
        model_install_key=model,
        resources=ResourceEstimate(8 * GIB, 4 * GIB, 5 * GIB, 4, True),
    )


def test_12gb_gpu_heavy_models_are_serialized_without_benchmark_timing() -> None:
    probe = FakeHardwareProbe(laptop_inventory())
    scheduler = ResourceScheduler(probe.probe(None))
    first = scheduler.acquire(heavy_request("render-a", "flux@a"))

    with pytest.raises(ResourceUnavailableError):
        scheduler.try_acquire(heavy_request("render-b", "avatar@b"))

    first.release()
    second = scheduler.try_acquire(heavy_request("render-b", "avatar@b"))
    assert second.snapshot.device_id == "GPU-test"
    second.release()
    assert probe.calls == 1


def test_headroom_prevents_ram_and_vram_overcommit() -> None:
    scheduler = ResourceScheduler(laptop_inventory())
    too_much_ram = LeaseRequest(
        owner="ram",
        model_install_key="large@a",
        resources=ResourceEstimate(1, 23 * GIB, 0, 1),
    )
    too_much_vram = LeaseRequest(
        owner="vram",
        model_install_key="large@b",
        resources=ResourceEstimate(1, 1 * GIB, 11 * GIB, 1, True),
    )
    with pytest.raises(ResourceUnavailableError):
        scheduler.try_acquire(too_much_ram)
    with pytest.raises(ResourceUnavailableError):
        scheduler.try_acquire(too_much_vram)


def test_measured_soulx_profile_fits_reference_ram_without_removing_headroom() -> None:
    inventory = HardwareInventory(
        os_name="Windows",
        architecture="AMD64",
        cpu_name="Reference CPU",
        cpu_threads=16,
        ram_total_bytes=32 * GIB,
        ram_available_bytes=18 * GIB,
        disk_free_bytes=500 * GIB,
        devices=(
            ComputeDevice(
                device_id="GPU-reference",
                name="Reference NVIDIA GPU",
                backend=ComputeBackend.NVIDIA_CUDA,
                total_memory_bytes=16 * GIB,
                free_memory_bytes=14 * GIB,
            ),
        ),
    )
    resources = BUILTIN_CATALOG.get("soulx-flashhead-pro").resources

    lease = ResourceScheduler(inventory).try_acquire(
        LeaseRequest("presenter-preview", "soulx@verified", resources)
    )
    assert lease.snapshot.ram_bytes == 12 * GIB
    lease.release()

    constrained = HardwareInventory(
        os_name=inventory.os_name,
        architecture=inventory.architecture,
        cpu_name=inventory.cpu_name,
        cpu_threads=inventory.cpu_threads,
        ram_total_bytes=inventory.ram_total_bytes,
        ram_available_bytes=16 * GIB,
        disk_free_bytes=inventory.disk_free_bytes,
        devices=inventory.devices,
    )
    with pytest.raises(ResourceUnavailableError):
        ResourceScheduler(constrained).try_acquire(
            LeaseRequest("presenter-preview", "soulx@verified", resources)
        )


def test_waiter_acquires_after_release_and_lease_context_cleans_up() -> None:
    scheduler = ResourceScheduler(laptop_inventory())
    first = scheduler.acquire(heavy_request("one", "model@one"))
    acquired: list[str] = []

    def wait_for_lease() -> None:
        with scheduler.acquire(heavy_request("two", "model@two"), timeout_seconds=2) as lease:
            acquired.append(lease.snapshot.model_install_key)

    thread = threading.Thread(target=wait_for_lease)
    thread.start()
    first.release()
    thread.join(timeout=2)

    assert acquired == ["model@two"]
    assert scheduler.active_leases() == ()


def test_cpu_only_leases_share_capacity_and_are_visible() -> None:
    scheduler = ResourceScheduler(laptop_inventory())
    request = LeaseRequest(
        owner="embedding",
        model_install_key="embed@a",
        resources=ResourceEstimate(1, GIB, 0, 2),
    )
    first = scheduler.try_acquire(request)
    second = scheduler.try_acquire(
        LeaseRequest("reranker", "rerank@a", ResourceEstimate(1, GIB, 0, 2))
    )
    assert scheduler.active_model_keys() == frozenset({"embed@a", "rerank@a"})
    first.release()
    second.release()
