from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import pytest

from alystria.generation.education_provider import StructuredWritingEducationalProvider
from alystria.generation.workflow import _fit_storyboard_to_narration, _paced_scene_ticks
from alystria.providers import ProviderResult, TextOutput, TextRequest, Usage
from alystria.research import (
    ExperienceLevel,
    GroundingMode,
    LearnerProfile,
    LearningObjective,
    LearningPlan,
    ObjectiveLevel,
    PrerequisiteDag,
)


def test_structured_scene_schema_can_author_progressive_teaching_modes() -> None:
    from alystria.generation.education_provider import _SCRIPT_SCHEMA

    scene_types = set(
        _SCRIPT_SCHEMA["properties"]["sections"]["items"]["properties"]["sceneType"]["enum"]
    )
    assert {"whiteboard", "live_code"} <= scene_types


class FakeTextClient:
    def __init__(self, responses: Sequence[dict[str, Any]]) -> None:
        self.responses = list(responses)
        self.requests: list[TextRequest] = []

    def generate(self, request: TextRequest, *, idempotency_key: str) -> ProviderResult[TextOutput]:
        assert idempotency_key.startswith("education-")
        self.requests.append(request)
        response = self.responses.pop(0)
        return ProviderResult(
            "nvidia-nim",
            request.model,
            TextOutput("", parsed=response),
            Usage("nvidia-nim", request.model, {"output_tokens": 400}, 123),
        )


def _objectives() -> tuple[LearningObjective, ...]:
    return (
        LearningObjective(
            "objective-meaning",
            "Explain why Karatsuba reduces recursive multiplications.",
            ObjectiveLevel.UNDERSTAND,
            "Explain the split and recombination.",
        ),
        LearningObjective(
            "objective-example",
            "Apply Karatsuba to a two-digit multiplication.",
            ObjectiveLevel.APPLY,
            "Complete a worked example.",
        ),
        LearningObjective(
            "objective-recall",
            "Recall the three products and final combination.",
            ObjectiveLevel.REMEMBER,
            "State the recurrence.",
        ),
    )


def _outline_response() -> dict[str, Any]:
    return {
        "sections": [
            {
                "title": "Can three products replace four?",
                "objectiveIds": ["objective-meaning"],
                "teachingStrategy": "pose a concrete multiplication puzzle",
                "estimatedSeconds": 17,
            },
            {
                "title": "Split, multiply, and recombine",
                "objectiveIds": ["objective-example"],
                "teachingStrategy": "trace a worked 12 by 34 example",
                "estimatedSeconds": 28,
            },
            {
                "title": "The recurrence to remember",
                "objectiveIds": ["objective-recall"],
                "teachingStrategy": "retrieve the three products and complexity",
                "estimatedSeconds": 16,
            },
        ]
    }


def _narration(seed: str) -> str:
    return (
        f"{seed} Start with twelve times thirty four. A schoolbook split creates four smaller "
        "multiplications, but Karatsuba combines the cross terms so only three products remain. "
        "Follow the values and notice exactly where the saved multiplication appears. "
        "This preserves answers while reducing recursive work."
    )


def _script_response(section_ids: Sequence[str]) -> dict[str, Any]:
    scene_types = ("question", "worked_example", "recap")
    titles = (
        "Can three beat four?",
        "Multiply 12 by 34",
        "Three products, one result",
    )
    return {
        "sections": [
            {
                "outlineSectionId": section_id,
                "sceneType": scene_types[index],
                "title": titles[index],
                "narration": _narration(f"Step {index + 1}."),
                "visualIntent": "A clean text-free arrangement of grouped counting blocks with generous negative space.",
                "onScreenText": [titles[index], "Three products", "Same exact answer"],
                "informationUnits": [
                    {"role": "step", "text": "Split each number into tens and ones"},
                    {"role": "result", "text": "Combine three products to recover 408"},
                ],
            }
            for index, section_id in enumerate(section_ids)
        ]
    }


def _paced_narration_response(section_ids: Sequence[str]) -> dict[str, Any]:
    return {
        "sections": [
            {
                "outlineSectionId": section_id,
                "narration": _narration(f"Step {index + 1}."),
            }
            for index, section_id in enumerate(section_ids)
        ]
    }


def test_structured_provider_authors_exact_timed_plan_and_semantic_slides() -> None:
    client = FakeTextClient([_outline_response()])
    provider = StructuredWritingEducationalProvider(client, model="meta/llama-3.3-70b-instruct")
    learner = LearnerProfile("curious beginners", ExperienceLevel.BEGINNER)

    outline = provider.build_outline("Karatsuba multiplication", learner, _objectives(), 60)

    assert sum(section.estimated_seconds for section in outline) == 60
    assert {objective_id for section in outline for objective_id in section.objective_ids} == {
        "objective-meaning",
        "objective-example",
        "objective-recall",
    }
    assert client.requests[0].json_schema is not None
    assert "placeholders" in (client.requests[0].system or "")

    script_client = FakeTextClient([_script_response([section.id for section in outline])])
    script_provider = StructuredWritingEducationalProvider(
        script_client, model="meta/llama-3.3-70b-instruct"
    )
    plan = LearningPlan(
        "Karatsuba multiplication",
        learner,
        _objectives(),
        PrerequisiteDag(()),
        (),
        tuple(outline),
        60,
    )

    draft = script_provider.draft_script(plan, GroundingMode.CREATIVE)

    assert [section.scene_type for section in draft.sections] == [
        "question",
        "worked_example",
        "recap",
    ]
    assert all(section.title and section.on_screen_text for section in draft.sections)
    assert all(section.visual_beat for section in draft.sections)
    assert draft.sections[0].visual_beat["compositionFamily"] == "editorial_type"
    assert draft.sections[1].visual_beat["compositionFamily"] == "worked_example"
    assert draft.metadata["provider"] == "nvidia-nim"
    assert draft.metadata["actualCostMicros"] == 123
    assert "text-free" in script_client.requests[0].prompt


def test_structured_provider_repairs_only_narration_when_pacing_is_short() -> None:
    learner = LearnerProfile("curious beginners", ExperienceLevel.BEGINNER)
    outline_provider = StructuredWritingEducationalProvider(
        FakeTextClient([_outline_response()]), model="writer-v1"
    )
    outline = tuple(
        outline_provider.build_outline("Karatsuba multiplication", learner, _objectives(), 60)
    )
    initial = _script_response([section.id for section in outline])
    for section in initial["sections"]:
        section["narration"] = "Karatsuba saves one recursive multiplication in this focused step."
    client = FakeTextClient(
        [initial, _paced_narration_response([section.id for section in outline])]
    )
    provider = StructuredWritingEducationalProvider(client, model="writer-v1")
    plan = LearningPlan(
        "Karatsuba multiplication",
        learner,
        _objectives(),
        PrerequisiteDag(()),
        (),
        outline,
        60,
    )

    draft = provider.draft_script(plan, GroundingMode.CREATIVE)

    assert len(client.requests) == 2
    assert client.requests[1].schema_name == "alystria_paced_narration"
    assert draft.word_count >= round(60 * 2.05 * 0.94)
    assert draft.sections[0].title == "Can three beat four?"


def test_structured_provider_rejects_missing_objective_coverage() -> None:
    response = _outline_response()
    response["sections"] = response["sections"][:2]
    client = FakeTextClient([response])
    provider = StructuredWritingEducationalProvider(client, model="writer-v1")

    with pytest.raises(ValueError, match="every learning objective"):
        provider.build_outline(
            "Karatsuba",
            LearnerProfile("beginners", ExperienceLevel.BEGINNER),
            _objectives(),
            60,
        )


def test_three_minute_outline_requires_more_inspectable_scenes() -> None:
    response = _outline_response()
    response["sections"].extend(
        [
            {
                "title": "Check the saved multiplication",
                "objectiveIds": ["objective-meaning", "objective-example"],
                "teachingStrategy": "contrast the three-product and four-product paths",
                "estimatedSeconds": 30,
            },
            {
                "title": "Connect the recurrence to runtime",
                "objectiveIds": ["objective-recall"],
                "teachingStrategy": "link the recurrence to the asymptotic improvement",
                "estimatedSeconds": 30,
            },
        ]
    )
    client = FakeTextClient([response])
    provider = StructuredWritingEducationalProvider(client, model="writer-v1")

    outline = provider.build_outline(
        "Karatsuba",
        LearnerProfile("beginners", ExperienceLevel.BEGINNER),
        _objectives(),
        180,
    )

    assert len(outline) == 5
    assert sum(section.estimated_seconds for section in outline) == 180
    assert client.requests[0].json_schema is not None
    assert client.requests[0].json_schema["properties"]["sections"]["minItems"] == 5


def test_storyboard_pacing_distributes_exact_duration_by_narration_weight() -> None:
    narration = " ".join(f"word{index}" for index in range(90))

    ticks = _paced_scene_ticks(
        [{"narration": narration}, {"narration": narration}, {"narration": narration}],
        180 * 240_000,
    )

    assert sum(ticks) == 180 * 240_000
    assert ticks == [60 * 240_000, 60 * 240_000, 60 * 240_000]


def test_storyboard_pacing_preserves_short_scene_floor_and_exact_total() -> None:
    ticks = _paced_scene_ticks(
        [{"narration": "brief"}, {"narration": " ".join(["detailed"] * 99)}],
        100,
    )

    assert ticks == [2, 98]
    assert sum(ticks) == 100


def test_measured_audio_retimes_scenes_without_chopping_or_lingering() -> None:
    storyboard = {
        "scenes": [
            {"id": "one", "durationTicks": 60 * 240_000},
            {"id": "two", "durationTicks": 60 * 240_000},
            {"id": "three", "durationTicks": 60 * 240_000},
        ],
        "visualBible": {"style": "test"},
    }
    fitted = _fit_storyboard_to_narration(
        storyboard,
        [
            {"sceneId": "one", "durationMs": 52_000},
            {"sceneId": "two", "durationMs": 58_000},
            {"sceneId": "three", "durationMs": 55_000},
        ],
    )

    durations = [scene["durationTicks"] for scene in fitted["scenes"]]
    measured = [52_000 * 240, 58_000 * 240, 55_000 * 240]
    assert sum(durations) == 180 * 240_000
    assert all(duration >= audio for duration, audio in zip(durations, measured, strict=True))
    assert max(duration - audio for duration, audio in zip(durations, measured, strict=True)) <= (
        5_000 * 240
    )
    assert storyboard["scenes"][0]["durationTicks"] == 60 * 240_000


def test_measured_audio_rejects_a_tutorial_that_cannot_fit() -> None:
    with pytest.raises(ValueError, match="exceeds the requested tutorial duration"):
        _fit_storyboard_to_narration(
            {"scenes": [{"id": "one", "durationTicks": 10 * 240_000}]},
            [{"sceneId": "one", "durationMs": 10_001}],
        )
