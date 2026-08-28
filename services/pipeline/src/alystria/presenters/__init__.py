"""Consent-gated, capability-aware synthetic presenter contracts."""

from .consent import ConsentGrant, ConsentRecord
from .models import (
    AvatarJobPlan,
    CapabilityDegradation,
    DegradationPolicy,
    GazeDirection,
    PresenterCapabilities,
    PresenterDirection,
    PresenterPlacement,
    PresenterProfile,
)
from .planner import PresenterPlanError, plan_avatar_job
from .qa import (
    IdentityMetrics,
    LipSyncMetrics,
    PresenterQAFinding,
    PresenterQAPolicy,
    PresenterQAResult,
    PresenterQAStatus,
    evaluate_presenter_quality,
)

__all__ = [
    "AvatarJobPlan",
    "CapabilityDegradation",
    "ConsentGrant",
    "ConsentRecord",
    "DegradationPolicy",
    "GazeDirection",
    "IdentityMetrics",
    "LipSyncMetrics",
    "PresenterCapabilities",
    "PresenterDirection",
    "PresenterPlacement",
    "PresenterPlanError",
    "PresenterProfile",
    "PresenterQAFinding",
    "PresenterQAPolicy",
    "PresenterQAResult",
    "PresenterQAStatus",
    "evaluate_presenter_quality",
    "plan_avatar_job",
]
