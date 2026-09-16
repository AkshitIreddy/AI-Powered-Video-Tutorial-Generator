"""Learner modelling and deterministic multi-pass educational planning."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from enum import StrEnum
from typing import ClassVar, Protocol

from alystria.sources.models import stable_id

from .evidence import GroundingMode


class ExperienceLevel(StrEnum):
    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"


@dataclass(frozen=True, slots=True)
class LearnerProfile:
    audience: str
    experience: ExperienceLevel
    locale: str = "en"
    age_range: str | None = None
    prior_knowledge: tuple[str, ...] = ()
    accessibility_needs: tuple[str, ...] = ()
    goals: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.audience.strip():
            raise ValueError("learner audience must not be blank")
        if not re.fullmatch(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*", self.locale):
            raise ValueError("learner locale is invalid")


class ObjectiveLevel(StrEnum):
    REMEMBER = "remember"
    UNDERSTAND = "understand"
    APPLY = "apply"
    ANALYZE = "analyze"
    EVALUATE = "evaluate"
    CREATE = "create"


@dataclass(frozen=True, slots=True)
class LearningObjective:
    id: str
    statement: str
    level: ObjectiveLevel
    assessment: str
    claim_ids: tuple[str, ...] = ()

    @classmethod
    def create(
        cls,
        statement: str,
        *,
        level: ObjectiveLevel = ObjectiveLevel.UNDERSTAND,
        assessment: str = "Explain the concept in the learner's own words.",
        claim_ids: Sequence[str] = (),
    ) -> LearningObjective:
        normalized = re.sub(r"\s+", " ", statement).strip()
        if not normalized:
            raise ValueError("objective statement must not be blank")
        return cls(
            stable_id("obj", normalized, level.value),
            normalized,
            level,
            assessment.strip(),
            tuple(claim_ids),
        )


@dataclass(frozen=True, slots=True)
class Prerequisite:
    id: str
    label: str
    assumed: bool = False

    @classmethod
    def create(cls, label: str, *, assumed: bool = False) -> Prerequisite:
        normalized = re.sub(r"\s+", " ", label).strip()
        if not normalized:
            raise ValueError("prerequisite label must not be blank")
        return cls(stable_id("pre", normalized), normalized, assumed)


class PrerequisiteDag:
    """Validated directed acyclic graph where edges mean prerequisite -> concept."""

    def __init__(
        self,
        nodes: Sequence[Prerequisite],
        edges: Sequence[tuple[str, str]] = (),
    ) -> None:
        self.nodes = {node.id: node for node in nodes}
        if len(self.nodes) != len(nodes):
            raise ValueError("prerequisite IDs must be unique")
        self.edges = tuple(edges)
        for before, after in self.edges:
            if before not in self.nodes or after not in self.nodes:
                raise ValueError("prerequisite edge references an unknown node")
            if before == after:
                raise ValueError("prerequisite cannot depend on itself")
        self.topological_order()

    def topological_order(self) -> tuple[str, ...]:
        incoming = {node_id: 0 for node_id in self.nodes}
        outgoing: dict[str, list[str]] = {node_id: [] for node_id in self.nodes}
        for before, after in self.edges:
            outgoing[before].append(after)
            incoming[after] += 1
        ready = sorted(node_id for node_id, count in incoming.items() if count == 0)
        ordered: list[str] = []
        while ready:
            current = ready.pop(0)
            ordered.append(current)
            for dependent in sorted(outgoing[current]):
                incoming[dependent] -= 1
                if incoming[dependent] == 0:
                    ready.append(dependent)
                    ready.sort()
        if len(ordered) != len(self.nodes):
            raise ValueError("prerequisite graph contains a cycle")
        return tuple(ordered)


@dataclass(frozen=True, slots=True)
class Misconception:
    id: str
    belief: str
    correction: str
    diagnostic_question: str

    @classmethod
    def create(cls, belief: str, correction: str, diagnostic_question: str) -> Misconception:
        values = tuple(
            re.sub(r"\s+", " ", value).strip()
            for value in (belief, correction, diagnostic_question)
        )
        if not all(values):
            raise ValueError("misconception fields must not be blank")
        return cls(stable_id("mis", values[0]), *values)


@dataclass(frozen=True, slots=True)
class OutlineSection:
    id: str
    title: str
    objective_ids: tuple[str, ...]
    teaching_strategy: str
    estimated_seconds: int
    evidence_claim_ids: tuple[str, ...] = ()

    @classmethod
    def create(
        cls,
        title: str,
        objective_ids: Sequence[str],
        *,
        teaching_strategy: str,
        estimated_seconds: int,
        evidence_claim_ids: Sequence[str] = (),
    ) -> OutlineSection:
        if estimated_seconds <= 0:
            raise ValueError("section duration must be positive")
        normalized = re.sub(r"\s+", " ", title).strip()
        return cls(
            stable_id("section", normalized, *objective_ids),
            normalized,
            tuple(objective_ids),
            teaching_strategy.strip(),
            estimated_seconds,
            tuple(evidence_claim_ids),
        )


@dataclass(frozen=True, slots=True)
class LearningPlan:
    topic: str
    learner: LearnerProfile
    objectives: tuple[LearningObjective, ...]
    prerequisites: PrerequisiteDag
    misconceptions: tuple[Misconception, ...]
    outline: tuple[OutlineSection, ...]
    target_duration_seconds: int

    def __post_init__(self) -> None:
        if not self.topic.strip() or not self.objectives or not self.outline:
            raise ValueError("learning plan requires a topic, objectives, and outline")
        objective_ids = {objective.id for objective in self.objectives}
        referenced = {
            objective_id for section in self.outline for objective_id in section.objective_ids
        }
        unknown = referenced - objective_ids
        if unknown:
            raise ValueError(f"outline references unknown objectives: {sorted(unknown)}")
        if objective_ids - referenced:
            raise ValueError("every objective must appear in at least one outline section")
        if self.target_duration_seconds <= 0:
            raise ValueError("target duration must be positive")


@dataclass(frozen=True, slots=True)
class ScriptSection:
    outline_section_id: str
    narration: str
    visual_intent: str
    claim_ids: tuple[str, ...] = ()
    scene_type: str | None = None
    title: str | None = None
    on_screen_text: tuple[str, ...] = ()
    visual_beat: Mapping[str, object] | None = None


@dataclass(frozen=True, slots=True)
class ScriptDraft:
    id: str
    revision: int
    locale: str
    sections: tuple[ScriptSection, ...]
    word_count: int
    metadata: Mapping[str, object] = field(default_factory=dict)

    @classmethod
    def create(
        cls,
        sections: Sequence[ScriptSection],
        *,
        locale: str,
        revision: int,
        metadata: Mapping[str, object] | None = None,
    ) -> ScriptDraft:
        section_tuple = tuple(sections)
        words = sum(
            len(re.findall(r"\b\w+[\w'-]*\b", section.narration)) for section in section_tuple
        )
        content = "\n".join(section.narration for section in section_tuple)
        return cls(
            stable_id("script", locale, str(revision), content),
            revision,
            locale,
            section_tuple,
            words,
            dict(metadata or {}),
        )


class ReviewDimension(StrEnum):
    PEDAGOGY = "pedagogy"
    FACTUALITY = "factuality"
    CLARITY = "clarity"
    REDUNDANCY = "redundancy"
    PACING = "pacing"


@dataclass(frozen=True, slots=True)
class ScriptIssue:
    code: str
    message: str
    section_id: str | None = None
    severity: str = "warning"


@dataclass(frozen=True, slots=True)
class ScriptReview:
    dimension: ReviewDimension
    issues: tuple[ScriptIssue, ...]
    passed: bool


class EducationalProvider(Protocol):
    def build_outline(
        self,
        topic: str,
        learner: LearnerProfile,
        objectives: Sequence[LearningObjective],
        target_duration_seconds: int,
        *,
        minimum_sections: int = 1,
        presenter_count: int = 0,
    ) -> Sequence[OutlineSection]: ...

    def draft_script(self, plan: LearningPlan, grounding: GroundingMode) -> ScriptDraft: ...

    def review_script(
        self,
        draft: ScriptDraft,
        plan: LearningPlan,
        dimension: ReviewDimension,
    ) -> ScriptReview: ...

    def revise_script(
        self,
        draft: ScriptDraft,
        plan: LearningPlan,
        review: ScriptReview,
    ) -> ScriptDraft: ...


class DeterministicOfflineProvider:
    """Predictable provider for offline mode, fixtures, and recovery tests."""

    def build_outline(
        self,
        topic: str,
        learner: LearnerProfile,
        objectives: Sequence[LearningObjective],
        target_duration_seconds: int,
        *,
        minimum_sections: int = 1,
        presenter_count: int = 0,
    ) -> Sequence[OutlineSection]:
        del presenter_count
        seconds_each = max(30, target_duration_seconds // max(1, len(objectives)))
        strategies = (
            "activate prior knowledge",
            "worked explanation",
            "guided practice",
            "retrieval recap",
        )
        section_count = max(len(objectives), minimum_sections)
        return tuple(
            OutlineSection.create(
                f"{index + 1}. {objective.statement}",
                [objective.id],
                teaching_strategy=strategies[index % len(strategies)],
                estimated_seconds=seconds_each,
                evidence_claim_ids=objective.claim_ids,
            )
            for index, objective in (
                (index, objectives[index % len(objectives)])
                for index in range(section_count)
            )
        )

    def draft_script(self, plan: LearningPlan, grounding: GroundingMode) -> ScriptDraft:
        objective_by_id = {objective.id: objective for objective in plan.objectives}
        sections = []
        for index, outline in enumerate(plan.outline):
            objective = objective_by_id[outline.objective_ids[0]]
            opening = (
                "Start with a question: why does this idea matter? "
                if index == 0
                else "Now connect this to what you just learned. "
            )
            narration = (
                f"{opening}{objective.statement} "
                f"We will use {outline.teaching_strategy}, then test the idea "
                "with a concrete example. "
                "Pause and predict the result before the explanation continues."
            )
            sections.append(
                ScriptSection(
                    outline.id,
                    narration,
                    f"Use a precise visual progression for {objective.statement.lower()}",
                    outline.evidence_claim_ids,
                )
            )
        return ScriptDraft.create(
            sections,
            locale=plan.learner.locale,
            revision=1,
            metadata={"grounding": grounding.value, "provider": "offline"},
        )

    def review_script(
        self,
        draft: ScriptDraft,
        plan: LearningPlan,
        dimension: ReviewDimension,
    ) -> ScriptReview:
        issues: list[ScriptIssue] = []
        if dimension == ReviewDimension.PEDAGOGY:
            if not any("question" in section.narration.casefold() for section in draft.sections):
                issues.append(ScriptIssue("pedagogy.no_hook", "Add an opening learner question."))
            for section in draft.sections:
                if "example" not in section.narration.casefold():
                    issues.append(
                        ScriptIssue(
                            "pedagogy.no_example",
                            "Add a concrete example.",
                            section.outline_section_id,
                        )
                    )
        elif dimension == ReviewDimension.FACTUALITY:
            grounded = draft.metadata.get("grounding") in {
                GroundingMode.GROUNDED.value,
                GroundingMode.STRICT.value,
            }
            if grounded:
                for section in draft.sections:
                    if not section.claim_ids:
                        issues.append(
                            ScriptIssue(
                                "factuality.no_claim_links",
                                "Grounded narration has no linked evidence claims.",
                                section.outline_section_id,
                                "error",
                            )
                        )
        elif dimension == ReviewDimension.CLARITY:
            for section in draft.sections:
                sentences = re.split(r"[.!?]+", section.narration)
                if any(len(sentence.split()) > 32 for sentence in sentences):
                    issues.append(
                        ScriptIssue(
                            "clarity.long_sentence",
                            "Split the long sentence.",
                            section.outline_section_id,
                        )
                    )
        elif dimension == ReviewDimension.REDUNDANCY:
            seen: set[str] = set()
            for section in draft.sections:
                normalized = re.sub(r"\W+", " ", section.narration).casefold().strip()
                if normalized in seen:
                    issues.append(
                        ScriptIssue(
                            "redundancy.duplicate_section",
                            "Remove repeated narration.",
                            section.outline_section_id,
                        )
                    )
                seen.add(normalized)
        elif dimension == ReviewDimension.PACING:
            target_words = plan.target_duration_seconds * 2.5
            if draft.word_count > target_words * 1.15:
                issues.append(
                    ScriptIssue(
                        "pacing.too_fast",
                        "Reduce narration for the target duration.",
                    )
                )
            elif draft.word_count < target_words * 0.15:
                issues.append(
                    ScriptIssue(
                        "pacing.too_sparse",
                        "Add explanatory detail for the target duration.",
                    )
                )
        blocking = any(issue.severity == "error" for issue in issues)
        return ScriptReview(dimension, tuple(issues), not blocking)

    def revise_script(
        self,
        draft: ScriptDraft,
        plan: LearningPlan,
        review: ScriptReview,
    ) -> ScriptDraft:
        sections = list(draft.sections)
        issue_codes = {issue.code for issue in review.issues}
        if "pedagogy.no_hook" in issue_codes and sections:
            sections[0] = replace(
                sections[0],
                narration="What do you predict will happen? " + sections[0].narration,
            )
        if "pacing.too_sparse" in issue_codes:
            sections = [
                replace(
                    section,
                    narration=(
                        section.narration
                        + " Work through one case, compare it with a non-example, "
                        "and state the takeaway."
                    ),
                )
                for section in sections
            ]
        if "pacing.too_fast" in issue_codes:
            sections = [
                replace(
                    section,
                    narration=" ".join(
                        section.narration.split()[: max(20, len(section.narration.split()) // 2)]
                    ),
                )
                for section in sections
            ]
        metadata = dict(draft.metadata)
        metadata.setdefault("reviewed", [])
        reviewed_value = metadata.get("reviewed", [])
        reviewed = list(reviewed_value) if isinstance(reviewed_value, (list, tuple)) else []
        metadata["reviewed"] = [*reviewed, review.dimension.value]
        return ScriptDraft.create(
            sections,
            locale=draft.locale,
            revision=draft.revision + 1,
            metadata=metadata,
        )


@dataclass(frozen=True, slots=True)
class ScriptWorkflowResult:
    initial: ScriptDraft
    final: ScriptDraft
    reviews: tuple[ScriptReview, ...]
    revisions: tuple[ScriptDraft, ...]


class EducationalWorkflow:
    DEFAULT_PASSES: ClassVar[tuple[ReviewDimension, ...]] = (
        ReviewDimension.PEDAGOGY,
        ReviewDimension.FACTUALITY,
        ReviewDimension.CLARITY,
        ReviewDimension.REDUNDANCY,
        ReviewDimension.PACING,
    )

    def __init__(self, provider: EducationalProvider) -> None:
        self.provider = provider

    def create_plan(
        self,
        *,
        topic: str,
        learner: LearnerProfile,
        objectives: Sequence[LearningObjective],
        prerequisites: PrerequisiteDag,
        misconceptions: Sequence[Misconception] = (),
        target_duration_seconds: int = 600,
        minimum_outline_sections: int = 1,
        presenter_count: int = 0,
    ) -> LearningPlan:
        outline = self.provider.build_outline(
            topic,
            learner,
            objectives,
            target_duration_seconds,
            minimum_sections=minimum_outline_sections,
            presenter_count=presenter_count,
        )
        return LearningPlan(
            topic.strip(),
            learner,
            tuple(objectives),
            prerequisites,
            tuple(misconceptions),
            tuple(outline),
            target_duration_seconds,
        )

    def create_script(
        self,
        plan: LearningPlan,
        *,
        grounding: GroundingMode = GroundingMode.GROUNDED,
        passes: Sequence[ReviewDimension] = DEFAULT_PASSES,
    ) -> ScriptWorkflowResult:
        initial = self.provider.draft_script(plan, grounding)
        current = initial
        reviews: list[ScriptReview] = []
        revisions: list[ScriptDraft] = []
        for dimension in passes:
            review = self.provider.review_script(current, plan, dimension)
            reviews.append(review)
            current = self.provider.revise_script(current, plan, review)
            revisions.append(current)
        return ScriptWorkflowResult(initial, current, tuple(reviews), tuple(revisions))
