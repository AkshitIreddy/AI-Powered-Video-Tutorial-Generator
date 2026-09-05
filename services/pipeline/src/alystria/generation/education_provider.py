"""Structured, provider-authored educational plans and scene specifications."""

from __future__ import annotations

import copy
import hashlib
import json
import re
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

from alystria.providers import (
    Capability,
    ProviderResult,
    ProviderRuntime,
    ProviderTextClient,
    TextOutput,
    TextRequest,
)
from alystria.research import (
    DeterministicOfflineProvider,
    GroundingMode,
    LearnerProfile,
    LearningObjective,
    LearningPlan,
    OutlineSection,
    ScriptDraft,
    ScriptSection,
)

from .spoken_text import normalize_spoken_text

_SCENE_TYPES = {
    "question",
    "definition",
    "diagram",
    "worked_example",
    "comparison",
    "recap",
    "formula",
    "code",
    "whiteboard",
    "live_code",
}

# Alice's measured long-form delivery varies with equations and punctuation.
# Author 123 wpm, synthesize at a natural 0.86 speed, then let the measured MP3
# frame duration—not a text estimate—set every scene's final timing.
NARRATION_WORDS_PER_SECOND = 2.05

_SCENE_SEMANTICS = {
    "question": ("question", "editorial_type", "question-hold"),
    "definition": ("define", "object_stage", "reveal-primary"),
    "diagram": ("demonstrate", "diagram", "trace-relationship"),
    "worked_example": ("demonstrate", "worked_example", "transform-object"),
    "comparison": ("compare", "split_evidence", "compare-shift"),
    "recap": ("recap", "editorial_type", "resolve-hold"),
    "formula": ("prove", "worked_example", "emphasize-result"),
    "code": ("demonstrate", "document_focus", "evidence-focus"),
    "whiteboard": ("demonstrate", "worked_example", "trace-relationship"),
    "live_code": ("demonstrate", "document_focus", "evidence-focus"),
}

_OUTLINE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["sections"],
    "properties": {
        "sections": {
            "type": "array",
            "minItems": 3,
            "maxItems": 7,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "title",
                    "objectiveIds",
                    "teachingStrategy",
                    "estimatedSeconds",
                ],
                "properties": {
                    "title": {"type": "string", "minLength": 3, "maxLength": 72},
                    "objectiveIds": {
                        "type": "array",
                        "minItems": 1,
                        "items": {"type": "string"},
                    },
                    "teachingStrategy": {
                        "type": "string",
                        "minLength": 3,
                        "maxLength": 120,
                    },
                    "estimatedSeconds": {"type": "integer", "minimum": 8},
                },
            },
        }
    },
}

_SCRIPT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["sections"],
    "properties": {
        "sections": {
            "type": "array",
            "minItems": 1,
            "maxItems": 7,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "outlineSectionId",
                    "sceneType",
                    "title",
                    "narration",
                    "visualIntent",
                    "onScreenText",
                    "informationUnits",
                ],
                "properties": {
                    "outlineSectionId": {"type": "string"},
                    "sceneType": {"type": "string", "enum": sorted(_SCENE_TYPES)},
                    "title": {"type": "string", "minLength": 2, "maxLength": 72},
                    "narration": {"type": "string", "minLength": 40},
                    "visualIntent": {"type": "string", "minLength": 12, "maxLength": 320},
                    "onScreenText": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 6,
                        "items": {"type": "string", "minLength": 1, "maxLength": 80},
                    },
                    "informationUnits": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 8,
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["role", "text"],
                            "properties": {
                                "role": {
                                    "type": "string",
                                    "enum": [
                                        "question",
                                        "concept",
                                        "example",
                                        "step",
                                        "evidence",
                                        "formula",
                                        "result",
                                        "recap",
                                    ],
                                },
                                "text": {"type": "string", "minLength": 1, "maxLength": 120},
                            },
                        },
                    },
                },
            },
        }
    },
}

_NARRATION_REWRITE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["sections"],
    "properties": {
        "sections": {
            "type": "array",
            "minItems": 1,
            "maxItems": 7,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["outlineSectionId", "narration"],
                "properties": {
                    "outlineSectionId": {"type": "string"},
                    "narration": {"type": "string", "minLength": 40},
                },
            },
        }
    },
}

_StructuredUsageSink = Callable[[str, ProviderResult[TextOutput]], None]
_structured_usage_sink: ContextVar[_StructuredUsageSink | None] = ContextVar(
    "alystria_structured_writing_usage_sink",
    default=None,
)


@contextmanager
def capture_structured_writing_usage(sink: _StructuredUsageSink) -> Iterator[None]:
    """Bind accepted provider usage to the current durable job invocation."""

    token = _structured_usage_sink.set(sink)
    try:
        yield
    finally:
        _structured_usage_sink.reset(token)


def _publish_structured_usage(
    idempotency_key: str, result: ProviderResult[TextOutput]
) -> None:
    sink = _structured_usage_sink.get()
    if sink is not None:
        sink(idempotency_key, result)


class StructuredWritingEducationalProvider(DeterministicOfflineProvider):
    """Use the project's explicitly approved structured-writing route.

    Provider output supplies educational decisions and semantic information.
    Alystria still owns IDs, validation, timing, responsive layout, motion, and
    all visible typography, so image providers never need to draw slide text.
    """

    def __init__(self, client: ProviderTextClient, *, model: str) -> None:
        if not model.strip():
            raise ValueError("structured writing model must not be blank")
        self.client = client
        self.model = model.strip()

    @classmethod
    def from_runtime(cls, runtime: ProviderRuntime) -> StructuredWritingEducationalProvider:
        route = runtime.policy.route_for(Capability.LLM_STRUCTURED)
        return cls(ProviderTextClient(runtime), model=route.model)

    def build_outline(
        self,
        topic: str,
        learner: LearnerProfile,
        objectives: Sequence[LearningObjective],
        target_duration_seconds: int,
    ) -> Sequence[OutlineSection]:
        objective_payload = [
            {
                "id": objective.id,
                "statement": objective.statement,
                "level": objective.level.value,
            }
            for objective in objectives
        ]
        minimum_sections = 5 if target_duration_seconds >= 150 else 3
        outline_schema = copy.deepcopy(_OUTLINE_SCHEMA)
        outline_schema["properties"]["sections"]["minItems"] = minimum_sections
        prompt = json.dumps(
            {
                "task": "Design a compact, teachable tutorial outline.",
                "topic": topic,
                "learner": {
                    "audience": learner.audience,
                    "experience": learner.experience.value,
                    "locale": learner.locale,
                    "priorKnowledge": list(learner.prior_knowledge),
                    "accessibilityNeeds": list(learner.accessibility_needs),
                },
                "objectives": objective_payload,
                "targetDurationSeconds": target_duration_seconds,
                "requirements": [
                    f"Use {minimum_sections} to seven purposeful sections in a coherent teaching arc.",
                    "Cover every objective ID and use no objective ID that was not supplied.",
                    "Allocate realistic time for explanation, an example, and a concise recap.",
                    "Titles must be specific to the subject, not generic production instructions.",
                ],
            },
            ensure_ascii=False,
        )
        idempotency_key = _idempotency(
            "outline", topic, objective_payload, target_duration_seconds
        )
        result = self.client.generate(
            TextRequest(
                prompt=prompt,
                system=(
                    "You are Alystria's senior instructional designer. Return only the requested "
                    "structured data. Never emit placeholders, meta-commentary, URLs, HTML, or "
                    "duplicated filler. Make each section teach a distinct idea."
                ),
                model=self.model,
                max_output_tokens=2500,
                temperature=0.35,
                json_schema=outline_schema,
                schema_name="alystria_tutorial_outline",
            ),
            idempotency_key=idempotency_key,
        )
        _publish_structured_usage(idempotency_key, result)
        payload = _parsed_object(result.value.parsed, "outline")
        raw_sections = _object_list(payload.get("sections"), "outline sections")
        known_ids = {objective.id for objective in objectives}
        claimed: set[str] = set()
        validated: list[tuple[str, tuple[str, ...], str, int]] = []
        for raw in raw_sections:
            objective_ids = tuple(_string_list(raw.get("objectiveIds"), "objective IDs"))
            if not objective_ids or not set(objective_ids) <= known_ids:
                raise ValueError("Writing provider returned an unknown or empty objective ID")
            claimed.update(objective_ids)
            validated.append(
                (
                    _clean_text(raw.get("title"), "outline title", 72),
                    objective_ids,
                    _clean_text(raw.get("teachingStrategy"), "teaching strategy", 120),
                    _positive_int(raw.get("estimatedSeconds"), "estimated seconds"),
                )
            )
        if claimed != known_ids:
            raise ValueError("Writing provider did not cover every learning objective")
        normalized = _normalize_durations(
            [item[3] for item in validated], target_duration_seconds, minimum=8
        )
        objective_by_id = {objective.id: objective for objective in objectives}
        return tuple(
            OutlineSection.create(
                title,
                objective_ids,
                teaching_strategy=strategy,
                estimated_seconds=duration,
                evidence_claim_ids=tuple(
                    dict.fromkeys(
                        claim_id
                        for objective_id in objective_ids
                        for claim_id in objective_by_id[objective_id].claim_ids
                    )
                ),
            )
            for (title, objective_ids, strategy, _), duration in zip(
                validated, normalized, strict=True
            )
        )

    def draft_script(self, plan: LearningPlan, grounding: GroundingMode) -> ScriptDraft:
        prompt = json.dumps(
            {
                "task": "Write the narration and semantic slide plan for this tutorial.",
                "topic": plan.topic,
                "locale": plan.learner.locale,
                "audience": plan.learner.audience,
                "experience": plan.learner.experience.value,
                "groundingMode": grounding.value,
                "targetDurationSeconds": plan.target_duration_seconds,
                "targetNarrationWords": round(
                    plan.target_duration_seconds * NARRATION_WORDS_PER_SECOND
                ),
                "objectives": [
                    {
                        "id": objective.id,
                        "statement": objective.statement,
                        "assessment": objective.assessment,
                        "claimIds": list(objective.claim_ids),
                    }
                    for objective in plan.objectives
                ],
                "outline": [
                    {
                        "id": section.id,
                        "title": section.title,
                        "objectiveIds": list(section.objective_ids),
                        "teachingStrategy": section.teaching_strategy,
                        "estimatedSeconds": section.estimated_seconds,
                        "claimIds": list(section.evidence_claim_ids),
                        "targetWords": round(
                            section.estimated_seconds * NARRATION_WORDS_PER_SECOND
                        ),
                    }
                    for section in plan.outline
                ],
                "requirements": [
                    "Return exactly one section for every supplied outline ID, in the same order.",
                    "Open with a concrete learner-facing question, then answer it rather than lingering.",
                    "Narration must be natural spoken prose at roughly 123 words per minute.",
                    "For English narration, pace the spoken expansion of equations, operators, numbers, and symbols rather than treating each written expression as one word.",
                    "Keep every section's narration within ten percent of its targetWords value and the complete narration within six percent of targetNarrationWords.",
                    "Every section must advance the explanation with subject-specific facts or reasoning.",
                    "On-screen text must be short, exact, and useful; never repeat a word accidentally.",
                    "Information units must encode the actual concepts, steps, evidence, formula, or result.",
                    "Use whiteboard when a derivation or spatial explanation should be revealed stroke by stroke.",
                    "Use live_code when code should be typed and explained in narration-timed steps; use code for a static listing.",
                    "Visual intent describes text-free supporting imagery only. Never ask image models to draw letters, numbers, equations, captions, UI, logos, or watermarks.",
                    "Do not include production directions, placeholders, URLs, paths, HTML, or generic filler.",
                ],
            },
            ensure_ascii=False,
        )
        target_words = round(plan.target_duration_seconds * NARRATION_WORDS_PER_SECOND)
        idempotency_key = _idempotency(
            "script",
            plan.topic,
            [item.id for item in plan.outline],
            plan.target_duration_seconds,
        )
        result = self.client.generate(
            TextRequest(
                prompt=prompt,
                system=(
                    "You are an expert teacher and information designer. Write accurate, vivid, "
                    "plain-language narration and a semantic slide plan. Return only schema-valid "
                    "structured data. Do not merely restate the narration as slide labels."
                ),
                model=self.model,
                # gpt-oss accounts for its separate reasoning stream inside
                # the completion budget. A five-to-seven scene long-form JSON
                # document needs room for both that stream and the full schema.
                max_output_tokens=max(8192, round(plan.target_duration_seconds * 16)),
                temperature=0.45,
                json_schema=_SCRIPT_SCHEMA,
                schema_name="alystria_tutorial_script",
            ),
            idempotency_key=idempotency_key,
        )
        _publish_structured_usage(idempotency_key, result)
        payload = _parsed_object(result.value.parsed, "script")
        draft = _draft_from_payload(plan, grounding, payload, result)
        pacing_word_count = _pacing_word_count(draft)
        if target_words * 0.94 <= pacing_word_count <= target_words * 1.08:
            return draft
        for attempt in range(2):
            payload, result = self._rewrite_narration_to_pacing(
                plan, payload, previous_word_count=pacing_word_count, attempt=attempt
            )
            draft = _draft_from_payload(plan, grounding, payload, result)
            pacing_word_count = _pacing_word_count(draft)
            if target_words * 0.94 <= pacing_word_count <= target_words * 1.08:
                return draft
        pacing_unit = "spoken words" if draft.locale.casefold().startswith("en") else "words"
        raise ValueError(
            "Writing provider narration is outside the safe pacing range after two corrective passes "
            f"({pacing_word_count} {pacing_unit} for a {target_words}-word target)"
        )

    def _rewrite_narration_to_pacing(
        self,
        plan: LearningPlan,
        payload: Mapping[str, Any],
        *,
        previous_word_count: int,
        attempt: int,
    ) -> tuple[Mapping[str, Any], Any]:
        raw_sections = _object_list(payload.get("sections"), "script sections")
        expected_ids = [section.id for section in plan.outline]
        if len(raw_sections) != len(expected_ids):
            raise ValueError("Writing provider omitted or added outline sections")
        request_payload = {
            "task": "Rewrite only the spoken narration to meet the exact pacing targets.",
            "topic": plan.topic,
            "audience": plan.learner.audience,
            "locale": plan.learner.locale,
            "previousTotalWords": previous_word_count,
            "targetTotalWords": round(
                plan.target_duration_seconds * NARRATION_WORDS_PER_SECOND
            ),
            "requirements": [
                "Return exactly one narration for every supplied outline ID in the same order.",
                "Keep each narration within five words of its targetWords value.",
                "For English narration, count equations, operators, numbers, and symbols as the words a narrator will speak.",
                "Preserve every fact and worked value already present; introduce no new numerical claim.",
                "Add useful reasoning, connective explanation, misconception checks, or verification—not repetition, filler, or production commentary.",
                "Write natural spoken prose and do not copy slide labels as a list.",
            ],
            "sections": [
                {
                    "outlineSectionId": expected_ids[index],
                    "title": plan.outline[index].title,
                    "objectiveStatements": [
                        objective.statement
                        for objective in plan.objectives
                        if objective.id in plan.outline[index].objective_ids
                    ],
                    "targetWords": round(
                        plan.outline[index].estimated_seconds * NARRATION_WORDS_PER_SECOND
                    ),
                    "currentNarration": _clean_text(
                        raw.get("narration"), "script narration", 4_000
                    ),
                }
                for index, raw in enumerate(raw_sections)
            ],
        }
        idempotency_key = _idempotency(
            "narration-rewrite",
            plan.topic,
            expected_ids,
            plan.target_duration_seconds,
            attempt,
        )
        result = self.client.generate(
            TextRequest(
                prompt=json.dumps(request_payload, ensure_ascii=False),
                system=(
                    "You are Alystria's senior spoken-script editor. Return only schema-valid data. "
                    "Make the requested narration length through substantive teaching, never padding."
                ),
                model=self.model,
                max_output_tokens=max(8192, round(plan.target_duration_seconds * 12)),
                temperature=0.35,
                json_schema=_NARRATION_REWRITE_SCHEMA,
                schema_name="alystria_paced_narration",
            ),
            idempotency_key=idempotency_key,
        )
        _publish_structured_usage(idempotency_key, result)
        rewrite = _parsed_object(result.value.parsed, "paced narration")
        rewritten_sections = _object_list(rewrite.get("sections"), "paced narration sections")
        rewritten_ids = [str(item.get("outlineSectionId", "")) for item in rewritten_sections]
        if len(rewritten_sections) != len(raw_sections):
            raise ValueError("Writing provider omitted or added paced narration sections")
        if rewritten_ids != expected_ids:
            # Opaque model-generated IDs are rebound by exact count/order, as
            # in the main script path; they are never trusted as identity.
            rewritten_ids = expected_ids
        corrected: dict[str, Any] = dict(copy.deepcopy(payload))
        corrected_sections = [
            dict(item)
            for item in _object_list(corrected.get("sections"), "script sections")
        ]
        for index, rewrite_section in enumerate(rewritten_sections):
            corrected_sections[index]["outlineSectionId"] = rewritten_ids[index]
            corrected_sections[index]["narration"] = _clean_text(
                rewrite_section.get("narration"), "paced narration", 4_000
            )
        corrected["sections"] = corrected_sections
        return corrected, result


def _pacing_word_count(draft: ScriptDraft) -> int:
    """Count the exact English text sent to TTS; preserve legacy locale behavior."""

    if not draft.locale.casefold().startswith("en"):
        return draft.word_count
    return sum(
        len(
            re.findall(
                r"\b\w+[\w'-]*\b",
                normalize_spoken_text(section.narration, locale=draft.locale).spoken_text,
            )
        )
        for section in draft.sections
    )


def _draft_from_payload(
    plan: LearningPlan,
    grounding: GroundingMode,
    payload: Mapping[str, Any],
    result: Any,
) -> ScriptDraft:
    raw_sections = _object_list(payload.get("sections"), "script sections")
    expected_ids = [section.id for section in plan.outline]
    actual_ids = [str(section.get("outlineSectionId", "")) for section in raw_sections]
    if len(actual_ids) != len(expected_ids):
        raise ValueError("Writing provider omitted or added outline sections")
    section_ids_normalized = actual_ids != expected_ids

    outline_by_id = {section.id: section for section in plan.outline}
    sections: list[ScriptSection] = []
    for index, raw in enumerate(raw_sections):
        # Provider IDs are never trusted as database identity. If a model
        # rewrites an opaque hash while preserving the exact section count
        # and order, bind the authored content back to Alystria's IDs.
        outline_id = expected_ids[index]
        scene_type = str(raw.get("sceneType", "")).strip()
        if scene_type not in _SCENE_TYPES:
            raise ValueError(f"Writing provider returned unsupported scene type {scene_type!r}")
        on_screen = tuple(
            _clean_text(value, "on-screen text", 80)
            for value in _string_list(raw.get("onScreenText"), "on-screen text")
        )
        information_units = _information_units(raw.get("informationUnits"), index)
        narration = _clean_text(raw.get("narration"), "narration", 20_000)
        if len(re.findall(r"\b\w+[\w'-]*\b", narration)) < 8:
            raise ValueError("Writing provider returned unusably sparse narration")
        outline = outline_by_id[outline_id]
        title = _clean_text(raw.get("title"), "scene title", 72)
        sections.append(
            ScriptSection(
                outline_id,
                narration,
                _clean_text(raw.get("visualIntent"), "visual intent", 320),
                outline.evidence_claim_ids,
                scene_type=scene_type,
                title=title,
                on_screen_text=on_screen,
                visual_beat=_visual_beat(
                    scene_type,
                    information_units,
                    index,
                    title=title,
                    support=on_screen[0] if on_screen else information_units[0]["text"],
                ),
            )
        )
    draft = ScriptDraft.create(
        sections,
        locale=plan.learner.locale,
        revision=1,
        metadata={
            "grounding": grounding.value,
            "provider": result.provider_id,
            "model": result.model,
            "actualCostMicros": result.usage.actual_cost_micros,
            "usage": dict(result.usage.units),
            "providerSectionIdsNormalized": section_ids_normalized,
        },
    )
    return draft


def _visual_beat(
    scene_type: str,
    information_units: Sequence[Mapping[str, str]],
    index: int,
    *,
    title: str,
    support: str,
) -> dict[str, Any]:
    semantic, family, motion = _SCENE_SEMANTICS[scene_type]
    focal = f"focus_{index + 1}"
    return {
        "schemaVersion": 1,
        "semanticIntent": semantic,
        "compositionFamily": family,
        "focalAnchor": focal,
        "continuityKey": "tutorial_concept_thread",
        "informationUnits": [
            {"id": f"unit_{index + 1}_{unit_index + 1}", **dict(unit)}
            for unit_index, unit in enumerate(information_units)
        ],
        "attentionCue": focal,
        "motionIntent": [motion],
        "textRoles": {
            "title": title,
            "focus": information_units[0]["text"],
            "support": support,
        },
        "avoidRegions": [],
    }


def _information_units(value: Any, scene_index: int) -> tuple[Mapping[str, str], ...]:
    items = _object_list(value, "information units")
    validated: list[Mapping[str, str]] = []
    for item in items[:8]:
        role = str(item.get("role", "")).strip()
        if role not in {
            "question",
            "concept",
            "example",
            "step",
            "evidence",
            "formula",
            "result",
            "recap",
        }:
            raise ValueError("Writing provider returned an unsupported information-unit role")
        validated.append(
            {"role": role, "text": _clean_text(item.get("text"), "information unit", 120)}
        )
    if not validated:
        raise ValueError(f"Scene {scene_index + 1} has no usable information units")
    return tuple(validated)


def _parsed_object(value: Any, label: str) -> Mapping[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as error:
            raise ValueError(f"Writing provider returned malformed {label} JSON") from error
    if not isinstance(value, Mapping):
        raise ValueError(f"Writing provider returned no structured {label} object")
    return value


def _object_list(value: Any, label: str) -> list[Mapping[str, Any]]:
    if (
        not isinstance(value, list)
        or not value
        or not all(isinstance(item, Mapping) for item in value)
    ):
        raise ValueError(f"Writing provider returned invalid {label}")
    return list(value)


def _string_list(value: Any, label: str) -> list[str]:
    if not isinstance(value, list) or not value or not all(isinstance(item, str) for item in value):
        raise ValueError(f"Writing provider returned invalid {label}")
    cleaned = [re.sub(r"\s+", " ", item).strip() for item in value]
    if not all(cleaned) or len(cleaned) != len(set(item.casefold() for item in cleaned)):
        raise ValueError(f"Writing provider returned blank or duplicated {label}")
    return cleaned


def _clean_text(value: Any, label: str, maximum: int) -> str:
    if not isinstance(value, str):
        raise ValueError(f"Writing provider returned invalid {label}")
    cleaned = re.sub(r"\s+", " ", value).strip()
    if not cleaned or len(cleaned) > maximum:
        raise ValueError(f"Writing provider returned invalid {label}")
    return cleaned


def _positive_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"Writing provider returned invalid {label}")
    return int(value)


def _normalize_durations(values: Sequence[int], target: int, *, minimum: int) -> tuple[int, ...]:
    if not values or target < len(values) * minimum:
        raise ValueError("Requested duration is too short for the generated outline")
    available = target - len(values) * minimum
    total_weight = sum(values)
    raw = [available * value / total_weight for value in values]
    durations = [minimum + int(value) for value in raw]
    remainder = target - sum(durations)
    order = sorted(range(len(values)), key=lambda index: raw[index] - int(raw[index]), reverse=True)
    for index in order[:remainder]:
        durations[index] += 1
    return tuple(durations)


def _idempotency(kind: str, *parts: object) -> str:
    payload = json.dumps(parts, ensure_ascii=False, sort_keys=True, default=str)
    return f"education-{kind}-{hashlib.sha256(payload.encode()).hexdigest()[:32]}"
