from __future__ import annotations

import hashlib

import pytest

from alystria.models import (
    BUILTIN_CATALOG,
    AmdRocmProbe,
    ArtifactSpec,
    Capability,
    CommandResult,
    ComputeBackend,
    ExecutionMode,
    ModelTrustPolicy,
    NetworkDisabledError,
    NetworkPolicy,
    NetworkPolicyError,
    NetworkPurpose,
    NvidiaSmiProbe,
    SerializationFormat,
    UnsafeModelError,
)


class FakeCommandRunner:
    def __init__(self, result: CommandResult) -> None:
        self.result = result
        self.argv: tuple[str, ...] | None = None

    def run(self, argv: tuple[str, ...], *, timeout_seconds: float) -> CommandResult:
        assert timeout_seconds > 0
        self.argv = argv
        return self.result


def artifact(path: str, serialization: SerializationFormat) -> ArtifactSpec:
    blob = b"x"
    return ArtifactSpec(
        path=path,
        size_bytes=1,
        sha256=hashlib.sha256(blob).hexdigest(),
        serialization=serialization,
        urls=("https://models.example/artifact",),
    )


def test_fully_local_mode_denies_network_but_allows_strict_loopback_runtime() -> None:
    policy = NetworkPolicy.fully_local()
    with pytest.raises(NetworkDisabledError):
        policy.assert_url("https://models.example/model", NetworkPurpose.MODEL_DOWNLOAD)
    with pytest.raises(NetworkDisabledError):
        policy.assert_project_content_egress("https://provider.example/v1")
    policy.assert_url("http://127.0.0.1:11434/v1", NetworkPurpose.LOOPBACK_RUNTIME)
    with pytest.raises(NetworkPolicyError):
        policy.assert_url("http://192.168.1.8:11434/v1", NetworkPurpose.LOOPBACK_RUNTIME)


def test_hybrid_network_is_https_allowlisted_and_ssrf_safe() -> None:
    policy = NetworkPolicy(
        ExecutionMode.HYBRID,
        True,
        frozenset({"models.example", "127.0.0.1"}),
    )
    policy.assert_url("https://models.example/model", NetworkPurpose.MODEL_DOWNLOAD)
    with pytest.raises(NetworkPolicyError):
        policy.assert_url("http://models.example/model", NetworkPurpose.MODEL_DOWNLOAD)
    with pytest.raises(NetworkPolicyError):
        policy.assert_url("https://127.0.0.1/model", NetworkPurpose.MODEL_DOWNLOAD)
    with pytest.raises(NetworkPolicyError):
        policy.assert_url("https://unapproved.example/model", NetworkPurpose.MODEL_DOWNLOAD)


def test_safe_serialization_rejects_pickle_code_and_mismatched_extensions() -> None:
    policy = ModelTrustPolicy()
    policy.validate_artifact(artifact("weights/model.gguf", SerializationFormat.GGUF))
    policy.validate_artifact(artifact("weights/model.safetensors", SerializationFormat.SAFETENSORS))
    with pytest.raises(UnsafeModelError):
        policy.validate_artifact(artifact("weights/model.pkl", SerializationFormat.BINARY_DATA))
    with pytest.raises(UnsafeModelError):
        policy.validate_artifact(artifact("weights/model.bin", SerializationFormat.GGUF))
    assert policy.runtime_environment()["ALYSTRIA_TRUST_REMOTE_CODE"] == "0"


def test_nvidia_probe_parses_memory_without_touching_power_profile() -> None:
    runner = FakeCommandRunner(
        CommandResult(0, "GPU-123, RTX 4080 Laptop GPU, 12282, 11000, 555.1, 8.9\n")
    )
    devices = NvidiaSmiProbe(runner).devices()
    assert len(devices) == 1
    assert devices[0].backend is ComputeBackend.NVIDIA_CUDA
    assert devices[0].total_memory_bytes == 12282 * 1024 * 1024
    assert runner.argv is not None and runner.argv[0] == "nvidia-smi"


def test_amd_probe_parses_rocm_json() -> None:
    runner = FakeCommandRunner(
        CommandResult(
            0,
            '{"card0":{"Card series":"Test Radeon","VRAM Total Memory (B)":"16000",'
            '"VRAM Total Used Memory (B)":"4000"}}',
        )
    )
    device = AmdRocmProbe(runner).devices()[0]
    assert device.backend is ComputeBackend.AMD_ROCM
    assert device.free_memory_bytes == 12000


def test_catalog_covers_every_planned_local_capability_and_stays_unverified() -> None:
    expected = {
        Capability.LLM,
        Capability.VISION_LANGUAGE,
        Capability.EMBEDDING,
        Capability.RERANKING,
        Capability.IMAGE_GENERATION,
        Capability.TTS,
        Capability.STT,
        Capability.ALIGNMENT,
        Capability.AVATAR,
        Capability.LIP_SYNC,
    }
    actual = {
        capability for entry in BUILTIN_CATALOG.entries() for capability in entry.capabilities
    }
    assert expected <= actual
    assert {entry.model_id for entry in BUILTIN_CATALOG.entries()} >= {
        "qwen3.5-9b-gguf",
        "qwen3-embedding-0.6b",
        "bge-reranker",
        "flux.2-klein-4b",
        "qwen3-tts-0.6b",
        "kokoro",
        "whisper-large-v3-turbo",
        "liveportrait",
        "musetalk-1.5",
        "echomimicv3-flash",
        "longcat-avatar-1.5",
        "latentsync-1.5",
    }
    verified = [entry for entry in BUILTIN_CATALOG.entries() if entry.installable]
    assert [entry.model_id for entry in verified] == ["soulx-flashhead-pro"]
    presenter = verified[0]
    assert presenter.license_id == "Apache-2.0"
    assert presenter.supported_backends == frozenset({ComputeBackend.NVIDIA_CUDA})
    assert presenter.resources.vram_bytes == 12 * 1024**3
    assert presenter.resources.ram_bytes == 24 * 1024**3
