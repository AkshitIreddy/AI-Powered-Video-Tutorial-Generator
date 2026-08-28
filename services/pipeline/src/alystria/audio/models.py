"""Provider-neutral speech, alignment, caption, and audio artifact contracts.

The pipeline stores provider originals and derives a normalized 48 kHz working
stem.  These records deliberately contain no provider SDK types so a project can
be reopened even when a provider adapter is unavailable.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any

WORKING_SAMPLE_RATE_HZ = 48_000


class CaptionKind(StrEnum):
    DIALOGUE = "dialogue"
    SPEAKER = "speaker"
    SOUND = "sound"
    MUSIC = "music"
    DESCRIPTION = "description"


class AlignmentStatus(StrEnum):
    NOT_RUN = "NOT_RUN"
    PARTIAL = "PARTIAL"
    COMPLETE = "COMPLETE"
    FAILED = "FAILED"


class PrivacyClass(StrEnum):
    PUBLIC = "public"
    PROJECT = "project"
    PRIVATE = "private"


@dataclass(frozen=True, slots=True)
class DeliveryProfile:
    pace: float = 1.0
    pitch_semitones: float = 0.0
    style: str | None = None
    emotion: str | None = None
    intensity: float = 0.5

    def __post_init__(self) -> None:
        if not 0.5 <= self.pace <= 2.0:
            raise ValueError("pace must be between 0.5 and 2.0")
        if not -12.0 <= self.pitch_semitones <= 12.0:
            raise ValueError("pitch_semitones must be between -12 and 12")
        if not 0.0 <= self.intensity <= 1.0:
            raise ValueError("intensity must be between 0 and 1")


@dataclass(frozen=True, slots=True)
class EmphasisSpan:
    start: int
    end: int
    level: str = "moderate"

    def __post_init__(self) -> None:
        if self.start < 0 or self.end <= self.start:
            raise ValueError("emphasis span must be non-empty and non-negative")
        if self.level not in {"reduced", "moderate", "strong"}:
            raise ValueError("unsupported emphasis level")


@dataclass(frozen=True, slots=True)
class PauseBeat:
    offset: int
    duration_ms: int
    reason: str | None = None

    def __post_init__(self) -> None:
        if self.offset < 0:
            raise ValueError("pause offset must be non-negative")
        if not 20 <= self.duration_ms <= 10_000:
            raise ValueError("pause duration must be between 20 and 10000 ms")


@dataclass(frozen=True, slots=True)
class SpeechRequest:
    request_id: str
    text: str
    locale: str
    voice_id: str | None = None
    speaker_id: str | None = None
    delivery: DeliveryProfile = field(default_factory=DeliveryProfile)
    emphasis: tuple[EmphasisSpan, ...] = ()
    pauses: tuple[PauseBeat, ...] = ()
    pronunciation_rule_ids: tuple[str, ...] = ()
    context_before: str | None = None
    context_after: str | None = None
    privacy: PrivacyClass = PrivacyClass.PROJECT
    deterministic_seed: int | None = None

    def __post_init__(self) -> None:
        if not self.request_id.strip():
            raise ValueError("request_id is required")
        if not self.text.strip():
            raise ValueError("speech text is required")
        if not self.locale.strip():
            raise ValueError("locale is required")
        for span in self.emphasis:
            if span.end > len(self.text):
                raise ValueError("emphasis span extends beyond speech text")
        for pause in self.pauses:
            if pause.offset > len(self.text):
                raise ValueError("pause offset extends beyond speech text")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class AudioStemSpec:
    sample_rate_hz: int = WORKING_SAMPLE_RATE_HZ
    channels: int = 1
    sample_format: str = "pcm_s24le"
    container: str = "wav"
    channel_layout: str = "mono"

    def __post_init__(self) -> None:
        if self.sample_rate_hz != WORKING_SAMPLE_RATE_HZ:
            raise ValueError("Alystria working stems must be 48 kHz")
        if self.channels not in {1, 2}:
            raise ValueError("working stems support mono or stereo audio")
        if self.sample_format not in {"pcm_s16le", "pcm_s24le", "pcm_f32le"}:
            raise ValueError("unsupported working-stem sample format")
        expected_layout = "mono" if self.channels == 1 else "stereo"
        if self.channel_layout != expected_layout:
            raise ValueError(f"{self.channels} channel stem requires {expected_layout} layout")


@dataclass(frozen=True, slots=True)
class NativeAudioArtifact:
    artifact_hash: str
    media_type: str
    sample_rate_hz: int | None = None
    channels: int | None = None
    provider_request_id: str | None = None

    def __post_init__(self) -> None:
        if not self.artifact_hash or not self.media_type:
            raise ValueError("native audio artifact hash and media type are required")
        if self.sample_rate_hz is not None and self.sample_rate_hz <= 0:
            raise ValueError("native audio sample rate must be positive")
        if self.channels is not None and self.channels <= 0:
            raise ValueError("native audio channel count must be positive")


@dataclass(frozen=True, slots=True)
class WordTiming:
    token: str
    start_ms: int
    end_ms: int
    text_start: int | None = None
    text_end: int | None = None
    confidence: float | None = None

    def __post_init__(self) -> None:
        _validate_timing(self.start_ms, self.end_ms, self.confidence)
        if (self.text_start is None) != (self.text_end is None):
            raise ValueError("text offsets must be both present or both absent")
        if self.text_start is not None:
            assert self.text_end is not None
            if self.text_start < 0 or self.text_end <= self.text_start:
                raise ValueError("invalid word text offsets")


@dataclass(frozen=True, slots=True)
class PhonemeTiming:
    phoneme: str
    start_ms: int
    end_ms: int
    word_index: int
    confidence: float | None = None

    def __post_init__(self) -> None:
        _validate_timing(self.start_ms, self.end_ms, self.confidence)
        if self.word_index < 0:
            raise ValueError("word_index must be non-negative")


@dataclass(frozen=True, slots=True)
class CaptionCue:
    cue_id: str
    start_ms: int
    end_ms: int
    text: str
    kind: CaptionKind = CaptionKind.DIALOGUE
    speaker: str | None = None
    line: int | None = None
    position_percent: int | None = None
    align: str | None = None

    def __post_init__(self) -> None:
        _validate_timing(self.start_ms, self.end_ms, None)
        if not self.cue_id.strip() or not self.text.strip():
            raise ValueError("caption cue id and text are required")
        if self.line is not None and not -100 <= self.line <= 100:
            raise ValueError("caption line must be between -100 and 100")
        if self.position_percent is not None and not 0 <= self.position_percent <= 100:
            raise ValueError("caption position must be between 0 and 100")
        if self.align not in {None, "start", "center", "end", "left", "right"}:
            raise ValueError("unsupported caption alignment")


@dataclass(frozen=True, slots=True)
class AlignmentResult:
    status: AlignmentStatus
    words: tuple[WordTiming, ...] = ()
    phonemes: tuple[PhonemeTiming, ...] = ()
    captions: tuple[CaptionCue, ...] = ()
    aligned_token_ratio: float | None = None
    engine: str | None = None
    engine_version: str | None = None
    warnings: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.aligned_token_ratio is not None and not 0 <= self.aligned_token_ratio <= 1:
            raise ValueError("aligned_token_ratio must be between 0 and 1")
        if self.status is AlignmentStatus.COMPLETE and (
            not self.words or self.aligned_token_ratio is None
        ):
            raise ValueError("complete alignment requires word timings and coverage")
        _require_monotonic(self.words, "word")
        _require_monotonic(self.phonemes, "phoneme")
        _require_monotonic(self.captions, "caption")


@dataclass(frozen=True, slots=True)
class SpeechArtifact:
    artifact_id: str
    request_id: str
    provider: str
    model: str
    native: NativeAudioArtifact
    working_artifact_hash: str
    working_spec: AudioStemSpec
    duration_ms: int
    alignment: AlignmentResult = field(
        default_factory=lambda: AlignmentResult(status=AlignmentStatus.NOT_RUN)
    )
    pronunciation_rule_ids: tuple[str, ...] = ()
    provider_metadata: dict[str, Any] = field(default_factory=dict)
    warnings: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not all((self.artifact_id, self.request_id, self.provider, self.model)):
            raise ValueError("speech artifact identity and provider fields are required")
        if not self.working_artifact_hash:
            raise ValueError("speech artifact requires a normalized working stem")
        if self.duration_ms <= 0:
            raise ValueError("speech artifact duration must be positive")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _validate_timing(start_ms: int, end_ms: int, confidence: float | None) -> None:
    if start_ms < 0 or end_ms <= start_ms:
        raise ValueError("timing must be non-empty and non-negative")
    if confidence is not None and not 0 <= confidence <= 1:
        raise ValueError("confidence must be between 0 and 1")


def _require_monotonic(items: tuple[Any, ...], label: str) -> None:
    previous_start = -1
    for item in items:
        if item.start_ms < previous_start:
            raise ValueError(f"{label} timings must be ordered by start time")
        previous_start = item.start_ms
