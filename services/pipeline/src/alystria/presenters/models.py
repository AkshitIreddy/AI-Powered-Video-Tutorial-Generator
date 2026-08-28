"""Presenter direction, provider capability, and avatar job contracts."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class PresenterPlacement(StrEnum):
    FULL_FRAME = "full_frame"
    LEFT = "left"
    RIGHT = "right"
    LOWER_THIRD = "lower_third"
    PICTURE_IN_PICTURE = "picture_in_picture"


class GazeDirection(StrEnum):
    CAMERA = "camera"
    LEFT = "left"
    RIGHT = "right"
    DOWN = "down"
    AUTO = "auto"


class DegradationPolicy(StrEnum):
    BLOCK = "block"
    ALLOW_DECLARED = "allow_declared"


@dataclass(frozen=True, slots=True)
class PresenterDirection:
    placement: PresenterPlacement = PresenterPlacement.PICTURE_IN_PICTURE
    gaze: GazeDirection = GazeDirection.CAMERA
    emotion: str | None = None
    gesture: str | None = None
    expression_intensity: float = 0.5
    crop: str = "medium"
    background: str = "transparent"
    eye_contact_required: bool = True

    def __post_init__(self) -> None:
        if not 0 <= self.expression_intensity <= 1:
            raise ValueError("presenter expression intensity must be between 0 and 1")
        if self.crop not in {"close", "medium", "wide"}:
            raise ValueError("unsupported presenter crop")
        if self.background not in {"transparent", "original", "solid", "generated"}:
            raise ValueError("unsupported presenter background mode")


@dataclass(frozen=True, slots=True)
class PresenterCapabilities:
    provider: str
    model: str
    max_duration_ms: int
    supported_locales: frozenset[str]
    supports_gaze_control: bool = False
    supports_emotion: bool = False
    supported_gestures: frozenset[str] = field(default_factory=frozenset)
    supported_crops: frozenset[str] = field(default_factory=lambda: frozenset({"medium"}))
    supports_transparency: bool = False
    supports_background_replacement: bool = False
    supports_1080p: bool = True
    supports_4k: bool = False
    supports_seed: bool = False

    def __post_init__(self) -> None:
        if not self.provider or not self.model or self.max_duration_ms <= 0:
            raise ValueError("presenter capability identity and duration are required")


@dataclass(frozen=True, slots=True)
class CapabilityDegradation:
    capability: str
    requested: str
    effective: str
    reason: str


@dataclass(frozen=True, slots=True)
class PresenterProfile:
    profile_id: str
    subject_id: str
    display_name: str
    portrait_artifact_hash: str
    consent_id: str
    default_direction: PresenterDirection = field(default_factory=PresenterDirection)
    disclosure_text: str = "This video contains a synthetic presenter."

    def __post_init__(self) -> None:
        if not all(
            (
                self.profile_id,
                self.subject_id,
                self.display_name,
                self.portrait_artifact_hash,
                self.consent_id,
            )
        ):
            raise ValueError("presenter profile is incomplete")
        if not self.disclosure_text.strip():
            raise ValueError("synthetic presenter disclosure cannot be empty")


@dataclass(frozen=True, slots=True)
class AvatarJobPlan:
    job_id: str
    project_id: str
    scene_id: str
    provider: str
    model: str
    presenter_profile_id: str
    consent_id: str
    portrait_artifact_hash: str
    speech_artifact_hash: str
    duration_ms: int
    locale: str
    requested_direction: PresenterDirection
    effective_direction: PresenterDirection
    degradations: tuple[CapabilityDegradation, ...]
    output_width: int
    output_height: int
    deterministic_seed: int | None
    disclosure_required: bool

    def __post_init__(self) -> None:
        if not all(
            (
                self.job_id,
                self.project_id,
                self.scene_id,
                self.provider,
                self.model,
                self.portrait_artifact_hash,
                self.speech_artifact_hash,
            )
        ):
            raise ValueError("avatar job plan identity and immutable inputs are required")
        if self.duration_ms <= 0 or self.output_width <= 0 or self.output_height <= 0:
            raise ValueError("avatar job duration and dimensions must be positive")
