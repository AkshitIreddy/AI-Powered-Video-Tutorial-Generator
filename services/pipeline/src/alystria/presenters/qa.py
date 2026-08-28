"""Measurable lip-sync and identity preservation QA contracts."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class PresenterQAStatus(StrEnum):
    NOT_RUN = "NOT_RUN"
    PASSED = "PASSED"
    FAILED = "FAILED"


@dataclass(frozen=True, slots=True)
class LipSyncMetrics:
    status: PresenterQAStatus
    engine: str | None = None
    confidence: float | None = None
    mean_av_offset_ms: float | None = None
    p95_absolute_offset_ms: float | None = None
    evaluated_frames: int = 0
    note: str | None = None

    def __post_init__(self) -> None:
        if self.confidence is not None and not 0 <= self.confidence <= 1:
            raise ValueError("lip-sync confidence must be between 0 and 1")
        if self.evaluated_frames < 0:
            raise ValueError("evaluated frame count cannot be negative")
        if self.status is not PresenterQAStatus.NOT_RUN and not self.engine:
            raise ValueError("completed lip-sync QA requires an engine")
        if self.status is PresenterQAStatus.PASSED and self.evaluated_frames == 0:
            raise ValueError("passed lip-sync QA requires evaluated frames")


@dataclass(frozen=True, slots=True)
class IdentityMetrics:
    status: PresenterQAStatus
    engine: str | None = None
    reference_similarity: float | None = None
    minimum_frame_similarity: float | None = None
    temporal_drift: float | None = None
    evaluated_frames: int = 0
    note: str | None = None

    def __post_init__(self) -> None:
        for value in (
            self.reference_similarity,
            self.minimum_frame_similarity,
            self.temporal_drift,
        ):
            if value is not None and not 0 <= value <= 1:
                raise ValueError("identity metrics must be between 0 and 1")
        if self.evaluated_frames < 0:
            raise ValueError("evaluated frame count cannot be negative")
        if self.status is not PresenterQAStatus.NOT_RUN and not self.engine:
            raise ValueError("completed identity QA requires an engine")
        if self.status is PresenterQAStatus.PASSED and self.evaluated_frames == 0:
            raise ValueError("passed identity QA requires evaluated frames")


@dataclass(frozen=True, slots=True)
class PresenterQAPolicy:
    minimum_lip_sync_confidence: float = 0.80
    maximum_p95_offset_ms: float = 80.0
    minimum_reference_similarity: float = 0.72
    minimum_frame_similarity: float = 0.62
    maximum_temporal_drift: float = 0.18


@dataclass(frozen=True, slots=True)
class PresenterQAFinding:
    code: str
    message: str
    measured: float | None = None
    expected: str | None = None


@dataclass(frozen=True, slots=True)
class PresenterQAResult:
    status: PresenterQAStatus
    findings: tuple[PresenterQAFinding, ...]
    lip_sync: LipSyncMetrics
    identity: IdentityMetrics


def evaluate_presenter_quality(
    lip_sync: LipSyncMetrics,
    identity: IdentityMetrics,
    policy: PresenterQAPolicy | None = None,
) -> PresenterQAResult:
    if policy is None:
        policy = PresenterQAPolicy()
    findings: list[PresenterQAFinding] = []
    if lip_sync.status is not PresenterQAStatus.PASSED:
        findings.append(
            PresenterQAFinding(
                "LIP_SYNC_NOT_VERIFIED", lip_sync.note or "lip-sync QA did not pass"
            )
        )
    else:
        if lip_sync.confidence is None or lip_sync.confidence < policy.minimum_lip_sync_confidence:
            findings.append(
                PresenterQAFinding(
                    "LIP_SYNC_CONFIDENCE_LOW",
                    "lip-sync confidence is below policy",
                    lip_sync.confidence,
                    f">= {policy.minimum_lip_sync_confidence:.2f}",
                )
            )
        if (
            lip_sync.p95_absolute_offset_ms is None
            or lip_sync.p95_absolute_offset_ms > policy.maximum_p95_offset_ms
        ):
            findings.append(
                PresenterQAFinding(
                    "LIP_SYNC_OFFSET_HIGH",
                    "95th percentile audio/visual offset exceeds policy",
                    lip_sync.p95_absolute_offset_ms,
                    f"<= {policy.maximum_p95_offset_ms:.1f} ms",
                )
            )
    if identity.status is not PresenterQAStatus.PASSED:
        findings.append(
            PresenterQAFinding(
                "IDENTITY_NOT_VERIFIED", identity.note or "identity QA did not pass"
            )
        )
    else:
        thresholds = (
            (
                "IDENTITY_SIMILARITY_LOW",
                identity.reference_similarity,
                policy.minimum_reference_similarity,
                "reference similarity",
            ),
            (
                "IDENTITY_FRAME_OUTLIER",
                identity.minimum_frame_similarity,
                policy.minimum_frame_similarity,
                "minimum frame similarity",
            ),
        )
        for code, value, minimum, label in thresholds:
            if value is None or value < minimum:
                findings.append(
                    PresenterQAFinding(code, f"{label} is below policy", value, f">= {minimum:.2f}")
                )
        if (
            identity.temporal_drift is None
            or identity.temporal_drift > policy.maximum_temporal_drift
        ):
            findings.append(
                PresenterQAFinding(
                    "IDENTITY_DRIFT_HIGH",
                    "presenter identity drifts across the clip",
                    identity.temporal_drift,
                    f"<= {policy.maximum_temporal_drift:.2f}",
                )
            )
    return PresenterQAResult(
        PresenterQAStatus.FAILED if findings else PresenterQAStatus.PASSED,
        tuple(findings),
        lip_sync,
        identity,
    )
