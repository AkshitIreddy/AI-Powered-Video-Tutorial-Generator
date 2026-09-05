"""Curated local-model capability catalog.

Catalog entries are install intents, not mutable download manifests. A trusted
catalog service resolves an entry to a signed `ModelManifest` containing an exact
revision and artifact hashes before installation.
"""

from __future__ import annotations

from dataclasses import dataclass

from .domain import Capability, ResourceEstimate, SerializationFormat
from .hardware import ComputeBackend, HardwareInventory

GIB = 1024**3
MIB = 1024**2


@dataclass(frozen=True, slots=True)
class ModelCatalogEntry:
    model_id: str
    display_name: str
    upstream: str
    capabilities: tuple[Capability, ...]
    runtime: str
    preferred_serialization: SerializationFormat
    resources: ResourceEstimate
    supported_backends: frozenset[ComputeBackend]
    verified_revision: str | None
    license_id: str
    optional: bool = False
    notes: str = ""

    @property
    def installable(self) -> bool:
        """Only immutable, independently verified revisions may be installed."""

        return self.verified_revision is not None


@dataclass(frozen=True, slots=True)
class CompatibilityReport:
    model_id: str
    compatible: bool
    reasons: tuple[str, ...]
    candidate_device_ids: tuple[str, ...]


class ModelCatalog:
    def __init__(self, entries: tuple[ModelCatalogEntry, ...]) -> None:
        ids = [entry.model_id for entry in entries]
        if len(ids) != len(set(ids)):
            raise ValueError("catalog model IDs must be unique")
        self._entries = {entry.model_id: entry for entry in entries}

    def entries(self) -> tuple[ModelCatalogEntry, ...]:
        return tuple(self._entries.values())

    def get(self, model_id: str) -> ModelCatalogEntry:
        try:
            return self._entries[model_id]
        except KeyError as exc:
            raise KeyError(f"unknown catalog model: {model_id}") from exc

    def for_capability(self, capability: Capability) -> tuple[ModelCatalogEntry, ...]:
        return tuple(entry for entry in self._entries.values() if capability in entry.capabilities)

    def compatibility(
        self,
        model_id: str,
        inventory: HardwareInventory,
    ) -> CompatibilityReport:
        entry = self.get(model_id)
        reasons: list[str] = []
        if inventory.disk_free_bytes < entry.resources.disk_bytes:
            reasons.append("insufficient disk space")
        if inventory.ram_available_bytes < entry.resources.ram_bytes:
            reasons.append("insufficient available system RAM")
        devices = tuple(
            device.device_id
            for device in inventory.devices
            if device.backend in entry.supported_backends
            and device.free_memory_bytes >= entry.resources.vram_bytes
        )
        if entry.resources.vram_bytes and not devices:
            reasons.append("no supported accelerator has enough currently free VRAM")
        if inventory.cpu_threads < entry.resources.minimum_cpu_threads:
            reasons.append("insufficient CPU threads")
        if not entry.installable:
            reasons.append("no verified immutable release manifest is published")
        return CompatibilityReport(entry.model_id, not reasons, tuple(reasons), devices)


# Resource numbers are conservative planning estimates, not benchmark claims. The
# release manifest/profile benchmark may increase them, but never silently lower
# safety headroom on the 12 GB laptop target.
BUILTIN_CATALOG = ModelCatalog(
    (
        ModelCatalogEntry(
            model_id="qwen3.5-9b-gguf",
            display_name="Qwen3.5 9B (GGUF)",
            upstream="Qwen/Qwen3.5-9B",
            capabilities=(Capability.LLM, Capability.VISION_LANGUAGE),
            runtime="llama-cpp",
            preferred_serialization=SerializationFormat.GGUF,
            resources=ResourceEstimate(7 * GIB, 9 * GIB, 7 * GIB, 4, True),
            supported_backends=frozenset(
                {ComputeBackend.NVIDIA_CUDA, ComputeBackend.AMD_ROCM, ComputeBackend.APPLE_METAL}
            ),
            verified_revision=None,
            license_id="upstream-review-required",
            notes="Quantization is selected by the signed release profile.",
        ),
        ModelCatalogEntry(
            model_id="qwen3-embedding-0.6b",
            display_name="Qwen3 Embedding 0.6B",
            upstream="Qwen/Qwen3-Embedding-0.6B",
            capabilities=(Capability.EMBEDDING,),
            runtime="onnx-runtime",
            preferred_serialization=SerializationFormat.ONNX,
            resources=ResourceEstimate(2 * GIB, 3 * GIB, 2 * GIB, 2),
            supported_backends=frozenset(
                {ComputeBackend.NVIDIA_CUDA, ComputeBackend.AMD_ROCM, ComputeBackend.CPU}
            ),
            verified_revision=None,
            license_id="upstream-review-required",
        ),
        ModelCatalogEntry(
            model_id="bge-reranker",
            display_name="BGE Reranker",
            upstream="BAAI/bge-reranker-v2-m3",
            capabilities=(Capability.RERANKING,),
            runtime="onnx-runtime",
            preferred_serialization=SerializationFormat.ONNX,
            resources=ResourceEstimate(3 * GIB, 4 * GIB, 3 * GIB, 2),
            supported_backends=frozenset(
                {ComputeBackend.NVIDIA_CUDA, ComputeBackend.AMD_ROCM, ComputeBackend.CPU}
            ),
            verified_revision=None,
            license_id="upstream-review-required",
        ),
        ModelCatalogEntry(
            model_id="flux.2-klein-4b",
            display_name="FLUX.2 Klein 4B",
            upstream="black-forest-labs/FLUX.2-klein-4B",
            capabilities=(Capability.IMAGE_GENERATION,),
            runtime="diffusers-rs",
            preferred_serialization=SerializationFormat.SAFETENSORS,
            resources=ResourceEstimate(10 * GIB, 12 * GIB, 10 * GIB, 6, True),
            supported_backends=frozenset({ComputeBackend.NVIDIA_CUDA}),
            verified_revision=None,
            license_id="upstream-review-required",
            optional=True,
            notes="Enabled only after an on-device benchmark passes.",
        ),
        ModelCatalogEntry(
            model_id="qwen3-tts-0.6b",
            display_name="Qwen3 TTS 0.6B",
            upstream="Qwen/Qwen3-TTS-0.6B",
            capabilities=(Capability.TTS,),
            runtime="onnx-runtime",
            preferred_serialization=SerializationFormat.ONNX,
            resources=ResourceEstimate(3 * GIB, 4 * GIB, 3 * GIB, 2),
            supported_backends=frozenset(
                {ComputeBackend.NVIDIA_CUDA, ComputeBackend.AMD_ROCM, ComputeBackend.CPU}
            ),
            verified_revision=None,
            license_id="upstream-review-required",
        ),
        ModelCatalogEntry(
            model_id="kokoro",
            display_name="Kokoro Draft Voice",
            upstream="hexgrad/Kokoro-82M",
            capabilities=(Capability.TTS,),
            runtime="onnx-runtime",
            preferred_serialization=SerializationFormat.ONNX,
            resources=ResourceEstimate(512 * MIB, 1 * GIB, 0, 2),
            supported_backends=frozenset({ComputeBackend.CPU}),
            verified_revision=None,
            license_id="upstream-review-required",
        ),
        ModelCatalogEntry(
            model_id="whisper-large-v3-turbo",
            display_name="Whisper Large v3 Turbo",
            upstream="openai/whisper-large-v3-turbo",
            capabilities=(Capability.STT,),
            runtime="whisper-cpp",
            preferred_serialization=SerializationFormat.GGUF,
            resources=ResourceEstimate(4 * GIB, 6 * GIB, 4 * GIB, 4, True),
            supported_backends=frozenset(
                {ComputeBackend.NVIDIA_CUDA, ComputeBackend.AMD_ROCM, ComputeBackend.APPLE_METAL}
            ),
            verified_revision=None,
            license_id="upstream-review-required",
        ),
        ModelCatalogEntry(
            model_id="montreal-forced-aligner",
            display_name="Montreal Forced Aligner Profile",
            upstream="MontrealCorpusTools/mfa-models",
            capabilities=(Capability.ALIGNMENT,),
            runtime="mfa",
            preferred_serialization=SerializationFormat.BINARY_DATA,
            resources=ResourceEstimate(3 * GIB, 4 * GIB, 0, 4),
            supported_backends=frozenset({ComputeBackend.CPU}),
            verified_revision=None,
            license_id="mixed-upstream-review-required",
        ),
        ModelCatalogEntry(
            model_id="liveportrait",
            display_name="LivePortrait",
            upstream="KlingAIResearch/LivePortrait",
            capabilities=(Capability.AVATAR,),
            runtime="liveportrait-worker",
            preferred_serialization=SerializationFormat.BINARY_DATA,
            resources=ResourceEstimate(1 * GIB, 4 * GIB, 3 * GIB, 4, True),
            supported_backends=frozenset({ComputeBackend.NVIDIA_CUDA}),
            verified_revision=None,
            license_id="mit-code-and-model-terms-review-required",
            notes=(
                "Measured on the RTX 4080 Laptop test box at 2.7 GB peak VRAM for a "
                "16.48-second native pose/expression/eye pass. Pair with a separate "
                "lip-sync route when narration-accurate mouth motion is required."
            ),
        ),
        ModelCatalogEntry(
            model_id="musetalk-1.5",
            display_name="MuseTalk 1.5",
            upstream="TMElyralab/MuseTalk",
            capabilities=(Capability.AVATAR, Capability.LIP_SYNC),
            runtime="musetalk-worker",
            preferred_serialization=SerializationFormat.SAFETENSORS,
            resources=ResourceEstimate(8 * GIB, 10 * GIB, 8 * GIB, 6, True),
            supported_backends=frozenset({ComputeBackend.NVIDIA_CUDA}),
            verified_revision=None,
            license_id="upstream-review-required",
            notes=(
                "Managed activation requires Alystria's pinned H.264 mux broker: real-probe "
                "h264_nvenc, hardware-forced h264_mf, then an explicitly approved separate "
                "GPL x264 pack. The upstream hard-coded libx264 mux is not permitted."
            ),
        ),
        ModelCatalogEntry(
            model_id="echomimicv3-flash",
            display_name="EchoMimicV3 Flash",
            upstream="antgroup/echomimic_v3",
            capabilities=(Capability.AVATAR, Capability.LIP_SYNC),
            runtime="echomimic-worker",
            preferred_serialization=SerializationFormat.SAFETENSORS,
            resources=ResourceEstimate(26 * GIB, 48 * GIB, 12 * GIB, 8, True),
            supported_backends=frozenset({ComputeBackend.NVIDIA_CUDA}),
            verified_revision=None,
            license_id="apache-2.0-review-required",
            optional=True,
            notes=(
                "Official Flash profile reports 12 GB VRAM, but the pinned Windows test "
                "committed about 46 GB of host memory and did not reach frame one after "
                "386.92 seconds. Keep unavailable on this 32 GB reference machine."
            ),
        ),
        ModelCatalogEntry(
            model_id="longcat-avatar-1.5",
            display_name="LongCat Video Avatar 1.5",
            upstream="meituan-longcat/LongCat-Video-Avatar-1.5",
            capabilities=(Capability.AVATAR, Capability.LIP_SYNC),
            runtime="wangp-longcat-worker",
            preferred_serialization=SerializationFormat.SAFETENSORS,
            resources=ResourceEstimate(32 * GIB, 24 * GIB, 12 * GIB, 8, True),
            supported_backends=frozenset({ComputeBackend.NVIDIA_CUDA}),
            verified_revision=None,
            license_id="upstream-and-wangp-terms-review-required",
            optional=True,
            notes=(
                "Eight-step distilled whole-avatar quality route. The measured WanGP "
                "bootstrap uses a 15.96 GB INT8 transformer plus Whisper, UMT5, VAE, and "
                "shared preprocessing assets; never install it as a surprise dependency."
            ),
        ),
        ModelCatalogEntry(
            model_id="latentsync-1.5",
            display_name="LatentSync 1.5",
            upstream="bytedance/LatentSync",
            capabilities=(Capability.LIP_SYNC,),
            runtime="latentsync-worker",
            preferred_serialization=SerializationFormat.SAFETENSORS,
            resources=ResourceEstimate(10 * GIB, 12 * GIB, 10 * GIB, 6, True),
            supported_backends=frozenset({ComputeBackend.NVIDIA_CUDA}),
            verified_revision=None,
            license_id="upstream-review-required",
            optional=True,
        ),
    )
)
