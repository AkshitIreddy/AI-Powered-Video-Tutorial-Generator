"""Provider-neutral contracts used by every cloud and local adapter."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any

from ..security.privacy import DataClassification, PrivacyMode

JSON = dict[str, Any]


class Capability(StrEnum):
    LLM_TEXT = "llm.text"
    LLM_STRUCTURED = "llm.structured"
    RESEARCH = "research.web"
    IMAGE_GENERATION = "image.generate"
    IMAGE_EDITING = "image.edit"
    LICENSED_MEDIA = "media.licensed.search"
    MOTION = "motion.generate"
    TTS = "audio.tts"
    TRANSCRIPTION = "audio.transcribe"
    ALIGNMENT = "audio.align"
    PRESENTER = "presenter.generate"
    PORTRAIT_ANIMATION = "portrait.animate"
    LIP_SYNC = "lipsync.generate"
    VISION_LANGUAGE = "vlm.chat"
    EMBEDDING = "retrieval.embed"
    RERANKING = "retrieval.rerank"


class DataBoundary(StrEnum):
    LOCAL = "local"
    CLOUD = "cloud"


class RetentionMode(StrEnum):
    LOCAL_ONLY = "local_only"
    ZERO_DATA_RETENTION = "zero_data_retention"
    CONFIGURABLE = "configurable"
    PROVIDER_DEFAULT = "provider_default"
    UNKNOWN = "unknown"


class OperationState(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


@dataclass(frozen=True, slots=True)
class DataPolicy:
    boundary: DataBoundary
    retention: RetentionMode
    regions: tuple[str, ...] = ()
    stores_by_default: bool | None = None
    training_use: bool | None = None
    notes: str = ""


@dataclass(frozen=True, slots=True)
class Price:
    capability: Capability
    unit: str
    micros_per_unit: int
    currency: str = "USD"
    model: str | None = None

    def __post_init__(self) -> None:
        if self.micros_per_unit < 0:
            raise ValueError("micros_per_unit must not be negative")


@dataclass(frozen=True, slots=True)
class ProviderDescriptor:
    provider_id: str
    display_name: str
    capabilities: frozenset[Capability]
    data_policy: DataPolicy
    catalog_version: str
    last_verified_at: str
    docs_url: str
    prices: tuple[Price, ...] = ()
    models: tuple[str, ...] = ()
    supports_idempotency: bool = False
    supports_cancellation: bool = False

    def supports(self, capability: Capability) -> bool:
        return capability in self.capabilities


@dataclass(frozen=True, slots=True)
class CostEstimate:
    micros: int | None
    currency: str
    bounded: bool
    basis: str
    catalog_version: str

    def require_within(self, budget_micros: int | None) -> None:
        from .errors import FailureCode, ProviderFailure

        if budget_micros is None:
            return
        if self.micros is None or not self.bounded:
            raise ProviderFailure(
                FailureCode.BUDGET_EXCEEDED,
                "The request price cannot be bounded under the selected hard budget",
            )
        if self.micros > budget_micros:
            raise ProviderFailure(
                FailureCode.BUDGET_EXCEEDED,
                f"Estimated cost {self.micros} micros exceeds the hard budget",
            )


@dataclass(frozen=True, slots=True)
class Usage:
    provider_id: str
    model: str
    units: dict[str, float] = field(default_factory=dict)
    actual_cost_micros: int | None = None
    currency: str = "USD"
    request_id: str | None = None


@dataclass(frozen=True, slots=True)
class RequestContext:
    """Per-call approval, credential and accounting constraints.

    Credentials are supplied by the privilege broker at the last possible
    moment.  They are intentionally excluded from repr so test failures and
    logs cannot print secrets.
    """

    idempotency_key: str
    approved_provider_id: str
    credential: str | None = field(default=None, repr=False)
    hard_budget_micros: int | None = None
    approved_boundary: DataBoundary | None = None
    approved_region: str | None = None
    approved_retention: RetentionMode | None = None
    privacy_mode: PrivacyMode = PrivacyMode.HYBRID
    data_classification: DataClassification = DataClassification.PROJECT
    contains_project_content: bool = True
    metadata: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.idempotency_key.strip():
            raise ValueError("idempotency_key is required")


@dataclass(frozen=True, slots=True)
class TextRequest:
    prompt: str
    model: str
    system: str | None = None
    max_output_tokens: int = 2048
    temperature: float | None = None
    json_schema: JSON | None = None
    schema_name: str = "alystria_output"
    research: bool = False
    allowed_domains: tuple[str, ...] = ()

    @property
    def capability(self) -> Capability:
        if self.research:
            return Capability.RESEARCH
        if self.json_schema is not None:
            return Capability.LLM_STRUCTURED
        return Capability.LLM_TEXT


@dataclass(frozen=True, slots=True)
class TextOutput:
    text: str
    parsed: Any | None = None
    citations: tuple[JSON, ...] = ()


@dataclass(frozen=True, slots=True)
class VisionLanguageRequest:
    """Provider-neutral image-aware chat request.

    Remote URLs are intentionally not accepted by NVIDIA's adapter. Assets are
    passed as already-quarantined inline bytes so the provider cannot become an
    SSRF fetcher on Alystria's behalf.
    """

    prompt: str
    model: str
    images: tuple[AssetInput, ...]
    system: str | None = None
    max_output_tokens: int = 2048
    temperature: float | None = None

    capability: Capability = field(default=Capability.VISION_LANGUAGE, init=False)

    def __post_init__(self) -> None:
        if not self.prompt.strip():
            raise ValueError("vision-language prompt must not be empty")
        if not self.images:
            raise ValueError("vision-language request requires at least one image")


class EmbeddingInputType(StrEnum):
    QUERY = "query"
    PASSAGE = "passage"


class EmbeddingEncoding(StrEnum):
    FLOAT = "float"
    BASE64 = "base64"


class EmbeddingTruncation(StrEnum):
    NONE = "NONE"
    START = "START"
    END = "END"


@dataclass(frozen=True, slots=True)
class EmbeddingRequest:
    inputs: tuple[str, ...]
    model: str
    input_type: EmbeddingInputType
    encoding_format: EmbeddingEncoding = EmbeddingEncoding.FLOAT
    truncate: EmbeddingTruncation = EmbeddingTruncation.NONE

    capability: Capability = field(default=Capability.EMBEDDING, init=False)

    def __post_init__(self) -> None:
        if not self.inputs or any(not value.strip() for value in self.inputs):
            raise ValueError("embedding inputs must contain non-empty text")
        if len(self.inputs) > 512:
            raise ValueError("embedding requests are limited to 512 inputs")


@dataclass(frozen=True, slots=True)
class EmbeddingOutput:
    """Embeddings preserve NVIDIA's selected float or base64 representation."""

    vectors: tuple[tuple[float, ...] | str, ...]
    dimensions: int | None


@dataclass(frozen=True, slots=True)
class RerankPassage:
    text: str
    id: str | None = None

    def __post_init__(self) -> None:
        if not self.text.strip():
            raise ValueError("rerank passage text must not be empty")


@dataclass(frozen=True, slots=True)
class RerankRequest:
    query: str
    passages: tuple[RerankPassage, ...]
    model: str
    top_n: int | None = None

    capability: Capability = field(default=Capability.RERANKING, init=False)

    def __post_init__(self) -> None:
        if not self.query.strip():
            raise ValueError("rerank query must not be empty")
        if not 1 <= len(self.passages) <= 512:
            raise ValueError("rerank requests require between 1 and 512 passages")
        if self.top_n is not None and not 1 <= self.top_n <= len(self.passages):
            raise ValueError("top_n must select between 1 and the passage count")


@dataclass(frozen=True, slots=True)
class RerankScore:
    index: int
    score: float
    passage_id: str | None = None


@dataclass(frozen=True, slots=True)
class RerankOutput:
    rankings: tuple[RerankScore, ...]


@dataclass(frozen=True, slots=True)
class AssetInput:
    media_type: str
    data_base64: str | None = None
    uri: str | None = None
    sha256: str | None = None

    def __post_init__(self) -> None:
        if (self.data_base64 is None) == (self.uri is None):
            raise ValueError("AssetInput requires exactly one of data_base64 or uri")


@dataclass(frozen=True, slots=True)
class ImageRequest:
    prompt: str
    model: str
    aspect_ratio: str = "16:9"
    size: str | None = None
    output_format: str = "png"
    reference_images: tuple[AssetInput, ...] = ()
    negative_prompt: str | None = None
    seed: int | None = None

    @property
    def capability(self) -> Capability:
        return Capability.IMAGE_EDITING if self.reference_images else Capability.IMAGE_GENERATION


@dataclass(frozen=True, slots=True)
class MediaSearchRequest:
    query: str
    media_type: str = "image"
    page_size: int = 20
    license_allowlist: tuple[str, ...] = ("cc0", "by")
    locale: str = "en-US"

    capability: Capability = field(default=Capability.LICENSED_MEDIA, init=False)


@dataclass(frozen=True, slots=True)
class MotionRequest:
    prompt: str
    model: str
    duration_seconds: float
    aspect_ratio: str = "16:9"
    image: AssetInput | None = None
    seed: int | None = None

    capability: Capability = field(default=Capability.MOTION, init=False)


@dataclass(frozen=True, slots=True)
class SpeechRequest:
    text: str
    model: str
    voice: str
    locale: str
    output_format: str = "wav"
    sample_rate_hz: int = 48_000
    speed: float = 1.0
    style: str | None = None
    pronunciation_lexicon: tuple[tuple[str, str], ...] = ()

    capability: Capability = field(default=Capability.TTS, init=False)


@dataclass(frozen=True, slots=True)
class TranscriptionRequest:
    audio: AssetInput
    model: str
    locale: str | None = None
    word_timestamps: bool = True
    known_text: str | None = None

    @property
    def capability(self) -> Capability:
        return Capability.ALIGNMENT if self.known_text else Capability.TRANSCRIPTION


@dataclass(frozen=True, slots=True)
class PresenterRequest:
    audio: AssetInput
    presenter: AssetInput
    model: str
    aspect_ratio: str = "16:9"
    consent_record_id: str | None = None
    disclosure: bool = True

    capability: Capability = field(default=Capability.PRESENTER, init=False)


@dataclass(frozen=True, slots=True)
class MediaAsset:
    uri: str | None = None
    data_base64: str | None = None
    media_type: str | None = None
    sha256: str | None = None
    width: int | None = None
    height: int | None = None
    duration_seconds: float | None = None
    license: str | None = None
    attribution: str | None = None
    source_url: str | None = None


@dataclass(frozen=True, slots=True)
class MediaOutput:
    assets: tuple[MediaAsset, ...]
    metadata: JSON = field(default_factory=dict)


ProviderRequest = (
    TextRequest
    | VisionLanguageRequest
    | EmbeddingRequest
    | RerankRequest
    | ImageRequest
    | MediaSearchRequest
    | MotionRequest
    | SpeechRequest
    | TranscriptionRequest
    | PresenterRequest
)


@dataclass(frozen=True, slots=True)
class ProviderResult[T]:
    provider_id: str
    model: str
    value: T
    usage: Usage
    raw_id: str | None = None


@dataclass(frozen=True, slots=True)
class AsyncHandle:
    provider_id: str
    operation_id: str
    capability: Capability
    model: str
    poll_url: str | None = None
    cancel_url: str | None = None


@dataclass(frozen=True, slots=True)
class OperationStatus[T]:
    state: OperationState
    progress: float | None = None
    result: T | None = None
    usage: Usage | None = None
    failure: JSON | None = None


def public_request_dict(request: ProviderRequest) -> JSON:
    """Return a serialisable request representation for declarative builders."""

    return asdict(request)
