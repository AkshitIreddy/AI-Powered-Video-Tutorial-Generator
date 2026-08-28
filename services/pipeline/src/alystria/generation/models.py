"""Public, JSON-friendly contracts for durable tutorial generation."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any

from alystria.research import GroundingMode
from alystria.research.education import ExperienceLevel


class GenerationState(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    WAITING_APPROVAL = "WAITING_APPROVAL"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    SUCCEEDED = "SUCCEEDED"


class GenerationStage(StrEnum):
    INGEST_RESEARCH = "ingest_research"
    LEARNING_PLAN = "learning_plan"
    SCRIPT = "script"
    STORYBOARD = "storyboard"
    APPROVAL = "approval"
    ASSETS = "assets"
    NARRATION = "narration"
    CAPTIONS = "captions"
    PRESENTER = "presenter"
    RENDER = "render"
    QA_INITIAL = "qa_initial"
    REPAIR_ONE = "repair_one"
    QA_ONE = "qa_one"
    REPAIR_TWO = "repair_two"
    QA_FINAL = "qa_final"
    EXPORT = "export"


PRE_APPROVAL_STAGES = (
    GenerationStage.INGEST_RESEARCH,
    GenerationStage.LEARNING_PLAN,
    GenerationStage.SCRIPT,
    GenerationStage.STORYBOARD,
    GenerationStage.APPROVAL,
)

POST_APPROVAL_STAGES = (
    GenerationStage.ASSETS,
    GenerationStage.NARRATION,
    GenerationStage.CAPTIONS,
    GenerationStage.PRESENTER,
    GenerationStage.RENDER,
    GenerationStage.QA_INITIAL,
    GenerationStage.REPAIR_ONE,
    GenerationStage.QA_ONE,
    GenerationStage.REPAIR_TWO,
    GenerationStage.QA_FINAL,
    GenerationStage.EXPORT,
)

ALL_STAGES = (*PRE_APPROVAL_STAGES, *POST_APPROVAL_STAGES)


@dataclass(frozen=True, slots=True)
class SourceSpec:
    """An already-quarantined inert source supplied to the coordinator."""

    source_id: str
    title: str
    content: str
    locator: str = "inline:notes"
    media_type: str = "text/plain"
    license_id: str | None = None
    creator: str | None = None
    artifact_hash: str | None = None
    locator_metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.source_id.strip() or not self.title.strip() or not self.content.strip():
            raise ValueError("Generation sources require an ID, title, and content")
        if not self.locator.strip() or not self.media_type.strip():
            raise ValueError("Generation source locator and media type are required")
        if self.artifact_hash is not None and (
            len(self.artifact_hash) != 64
            or any(character not in "0123456789abcdef" for character in self.artifact_hash)
        ):
            raise ValueError("Generation source artifact hash must be a SHA-256 digest")
        object.__setattr__(self, "locator_metadata", dict(self.locator_metadata))


@dataclass(frozen=True, slots=True)
class ObjectiveSpec:
    objective_id: str
    statement: str
    level: str = "understand"

    def __post_init__(self) -> None:
        if not self.objective_id.strip() or not self.statement.strip():
            raise ValueError("Objectives require an ID and statement")


@dataclass(frozen=True, slots=True)
class ClaimSpec:
    claim_id: str
    statement: str
    source_id: str | None = None
    importance: str = "normal"

    def __post_init__(self) -> None:
        if not self.claim_id.strip() or not self.statement.strip():
            raise ValueError("Claims require an ID and statement")
        if self.importance not in {"low", "normal", "high", "critical"}:
            raise ValueError("Unsupported claim importance")


@dataclass(frozen=True, slots=True)
class GenerationRequest:
    topic: str
    audience: str
    duration_seconds: int
    locale: str = "en-US"
    experience: ExperienceLevel = ExperienceLevel.BEGINNER
    grounding_mode: GroundingMode = GroundingMode.GROUNDED
    sources: tuple[SourceSpec, ...] = ()
    objectives: tuple[ObjectiveSpec, ...] = ()
    claims: tuple[ClaimSpec, ...] = ()
    prerequisites: tuple[str, ...] = ()
    accessibility_needs: tuple[str, ...] = ("captions",)
    output_targets: tuple[dict[str, Any], ...] = (
        {"name": "landscape", "width": 1920, "height": 1080, "fps": 30},
    )
    presenter_mode: str = "auto"
    captions_enabled: bool = True
    deterministic_seed: int = 0
    hard_budget_micros: int | None = 0
    repairable_faults: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.topic.strip() or not self.audience.strip():
            raise ValueError("Generation topic and audience are required")
        if not 30 <= self.duration_seconds <= 10_800:
            raise ValueError("Generation duration must be between 30 seconds and 180 minutes")
        if self.hard_budget_micros is not None and self.hard_budget_micros < 0:
            raise ValueError("Generation budget cannot be negative")
        if self.repairable_faults < 0:
            raise ValueError("repairable_faults cannot be negative")
        if self.repairable_faults and self.metadata.get("testOnlyInjectQaFaults") is not True:
            raise ValueError(
                "repairable_faults is a test-only fixture control and requires "
                "metadata.testOnlyInjectQaFaults=true"
            )
        if self.presenter_mode not in {"off", "auto", "on"}:
            raise ValueError("presenter_mode must be off, auto, or on")
        if not self.output_targets:
            raise ValueError("At least one output target is required")
        for target in self.output_targets:
            if not isinstance(target, dict):
                raise ValueError("Output targets must be JSON objects")
            for key in ("name", "width", "height", "fps"):
                if key not in target:
                    raise ValueError(f"Output target is missing {key}")

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["experience"] = self.experience.value
        value["groundingMode"] = self.grounding_mode.value
        del value["grounding_mode"]
        value["durationSeconds"] = value.pop("duration_seconds")
        value["accessibilityNeeds"] = value.pop("accessibility_needs")
        value["outputTargets"] = value.pop("output_targets")
        value["presenterMode"] = value.pop("presenter_mode")
        value["captionsEnabled"] = value.pop("captions_enabled")
        value["deterministicSeed"] = value.pop("deterministic_seed")
        value["hardBudgetMicros"] = value.pop("hard_budget_micros")
        value["repairableFaults"] = value.pop("repairable_faults")
        return value


@dataclass(frozen=True, slots=True)
class StageStatus:
    stage: GenerationStage
    job_id: str
    state: str
    progress: float
    artifact_hash: str | None = None
    revision_id: str | None = None
    error: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["stage"] = self.stage.value
        value["jobId"] = value.pop("job_id")
        value["artifactHash"] = value.pop("artifact_hash")
        value["revisionId"] = value.pop("revision_id")
        return value


@dataclass(frozen=True, slots=True)
class GenerationStatus:
    generation_id: str
    project_id: str
    state: GenerationState
    progress: float
    approval_revision_id: str | None
    final_revision_id: str | None
    export_artifact_hash: str | None
    stages: tuple[StageStatus, ...]
    invalidated_scopes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "generationId": self.generation_id,
            "projectId": self.project_id,
            "state": self.state.value,
            "progress": self.progress,
            "approvalRevisionId": self.approval_revision_id,
            "finalRevisionId": self.final_revision_id,
            "exportArtifactHash": self.export_artifact_hash,
            "stages": [stage.to_dict() for stage in self.stages],
            "invalidatedScopes": list(self.invalidated_scopes),
        }
