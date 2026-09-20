from __future__ import annotations

import copy
import json
from collections.abc import Sequence
from typing import Any

import pytest

from alystria.generation.education_provider import (
    StructuredWritingEducationalProvider,
    WebResearchOutcome,
    _pacing_word_count,
    capture_structured_writing_usage,
)
from alystria.generation.workflow import _fit_storyboard_to_narration, _paced_scene_ticks
from alystria.providers import (
    DataClassification,
    FailureCode,
    PrivacyMode,
    ProviderFailure,
    ProviderResult,
    TextOutput,
    TextRequest,
    Usage,
)
from alystria.providers.openai_compatible_structured import (
    GROQ_STRUCTURED_MODEL,
    launch_structured_cloud_adapter,
)
from alystria.providers.transport import HttpRequest, HttpResponse
from alystria.providers.types import (
    DataBoundary,
    RequestContext,
    RetentionMode,
)
from alystria.research import (
    ExperienceLevel,
    GroundingMode,
    LearnerProfile,
    LearningObjective,
    LearningPlan,
    ObjectiveLevel,
    PrerequisiteDag,
    ScriptDraft,
    ScriptSection,
)


def test_structured_scene_schema_can_author_progressive_teaching_modes() -> None:
    from alystria.generation.education_provider import _SCRIPT_SCHEMA

    scene_types = set(
        _SCRIPT_SCHEMA["properties"]["sections"]["items"]["properties"]["sceneType"]["enum"]
    )
    assert {"whiteboard", "live_code"} <= scene_types


class FakeTextClient:
    def __init__(
        self,
        responses: Sequence[dict[str, Any]],
        *,
        correction_attempts: Sequence[int] = (),
    ) -> None:
        self.responses = list(responses)
        self.correction_attempts = list(correction_attempts)
        self.requests: list[TextRequest] = []

    def generate(self, request: TextRequest, *, idempotency_key: str) -> ProviderResult[TextOutput]:
        assert idempotency_key.startswith("education-")
        self.requests.append(request)
        response = self.responses.pop(0)
        correction_attempts = (
            self.correction_attempts.pop(0) if self.correction_attempts else 0
        )
        return ProviderResult(
            "nvidia-nim",
            request.model,
            TextOutput("", parsed=response),
            Usage("nvidia-nim", request.model, {"output_tokens": 400}, 123),
            correction_attempts=correction_attempts,
        )


class FakeResearchTextClient:
    def __init__(self, citations: tuple[dict[str, str], ...]) -> None:
        self.citations = citations
        self.requests: list[TextRequest] = []

    def generate(
        self, request: TextRequest, *, idempotency_key: str
    ) -> ProviderResult[TextOutput]:
        assert idempotency_key == "education-web-research-test"
        self.requests.append(request)
        payload = {
            "findings": [
                {
                    "statement": "Karatsuba replaces four half-size products with three.",
                    "teachingUse": "Explain where the recursive saving comes from.",
                }
            ]
        }
        return ProviderResult(
            "gemini",
            "gemini-2.5-flash-001",
            TextOutput(json.dumps(payload), citations=self.citations),
            Usage(
                "gemini",
                "gemini-2.5-flash",
                {"input_tokens": 120, "output_tokens": 80, "search_requests": 1},
                236,
                request_id="gemini-research-1",
            ),
            raw_id="gemini-research-1",
        )


def test_structured_provider_runs_one_prose_research_request_with_provenance() -> None:
    client = FakeResearchTextClient(
        ({"url": "https://example.test/karatsuba", "title": "Karatsuba reference"},)
    )
    provider = StructuredWritingEducationalProvider(
        client, model="writer-v1", research_model="gemini-2.5-flash"
    )

    outcome = provider.research_web(
        "Research Karatsuba for beginning learners.",
        locale="en-US",
        idempotency_key="education-web-research-test",
    )

    assert len(client.requests) == 1
    sent = client.requests[0]
    assert sent.research is True
    assert sent.model == "gemini-2.5-flash"
    assert sent.json_schema is None
    assert sent.max_correction_attempts == 0
    assert outcome.public_payload()["requestId"] == "gemini-research-1"
    assert outcome.public_payload()["resultCount"] == 1
    assert outcome.public_payload()["citationCount"] == 1


def test_structured_provider_rejects_research_without_citation_provenance() -> None:
    provider = StructuredWritingEducationalProvider(
        FakeResearchTextClient(()),
        model="writer-v1",
        research_model="gemini-2.5-flash",
    )

    outcome = provider.research_web(
        "Research Karatsuba.",
        locale="en-US",
        idempotency_key="education-web-research-test",
    )
    with pytest.raises(ProviderFailure) as raised:
        outcome.public_payload()

    assert raised.value.code is FailureCode.MALFORMED_RESPONSE
    assert "citation provenance" in str(raised.value)


def test_raw_web_research_checkpoint_bounds_provider_text_before_validation() -> None:
    raw_text = "x" * 20_000
    result = ProviderResult(
        "gemini",
        "gemini-2.5-flash-001",
        TextOutput(raw_text),
        Usage(
            "gemini",
            "gemini-2.5-flash",
            {"input_tokens": 10, "output_tokens": 2, "search_requests": 1},
            3,
        ),
        raw_id="oversized-research-1",
    )

    outcome = WebResearchOutcome("Research a bounded topic.", result)
    checkpoint = outcome.raw_payload()

    assert len(checkpoint["rawText"]) == 16_384
    assert checkpoint["rawTextLength"] == len(raw_text)
    assert checkpoint["rawTextTruncated"] is True
    with pytest.raises(ProviderFailure, match="checkpoint limit"):
        outcome.public_payload()


class EducationSequenceTransport:
    def __init__(self, payloads: Sequence[dict[str, Any]]) -> None:
        self.payloads = list(payloads)
        self.requests: list[HttpRequest] = []

    def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        if not self.payloads:
            raise AssertionError("unexpected extra education provider request")
        return HttpResponse(
            200,
            {"content-type": "application/json"},
            json.dumps(self.payloads.pop(0)).encode(),
        )


class GroqEducationTextClient:
    def __init__(self, transport: EducationSequenceTransport) -> None:
        self.adapter = launch_structured_cloud_adapter("groq", transport)
        self.results: list[ProviderResult[TextOutput]] = []

    def generate(
        self, request: TextRequest, *, idempotency_key: str
    ) -> ProviderResult[TextOutput]:
        result = self.adapter.invoke(
            request,
            RequestContext(
                idempotency_key=idempotency_key,
                approved_provider_id="groq",
                credential="fixture-secret",
                approved_boundary=DataBoundary.CLOUD,
                approved_region="provider-managed",
                approved_retention=RetentionMode.PROVIDER_DEFAULT,
                privacy_mode=PrivacyMode.CLOUD,
                data_classification=DataClassification.PROJECT,
            ),
        )
        self.results.append(result)
        return result


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


def _three_minute_outline_response() -> dict[str, Any]:
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
    return response


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
    research_context = {
        "providerId": "gemini",
        "model": "gemini-2.5-flash",
        "responseModel": "gemini-2.5-flash-001",
        "requestId": "research-1",
        "query": "Research Karatsuba for beginners.",
        "resultCount": 1,
        "citationCount": 1,
        "provenanceScope": "response",
        "findings": [
            {
                "statement": "Karatsuba replaces four half-size products with three.",
                "teachingUse": "Explain the recursive saving.",
            }
        ],
        "citations": [
            {
                "url": "https://example.test/karatsuba",
                "title": "Karatsuba reference",
            }
        ],
    }
    client = FakeTextClient([_outline_response()])
    provider = StructuredWritingEducationalProvider(
        client,
        model="meta/llama-3.3-70b-instruct",
        research_context=research_context,
    )
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
    assert json.loads(client.requests[0].prompt)["webResearch"] == research_context

    script_client = FakeTextClient([_script_response([section.id for section in outline])])
    script_provider = StructuredWritingEducationalProvider(
        script_client,
        model="meta/llama-3.3-70b-instruct",
        research_context=research_context,
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
    script_request = script_client.requests[0]
    assert "text-free" in script_request.prompt
    assert "spoken expansion" in script_request.prompt
    assert script_request.json_schema is not None
    role_enum = script_request.json_schema["properties"]["sections"]["items"][
        "properties"
    ]["informationUnits"]["items"]["properties"]["role"]["enum"]
    script_prompt = json.loads(script_request.prompt)
    assert script_prompt["webResearch"] == research_context
    assert script_prompt["informationUnitRoleVocabulary"] == role_enum
    assert any(
        "never invent, rename, or reclassify a role" in requirement
        for requirement in script_prompt["requirements"]
    )
    assert any(
        "verbalize arithmetic" in requirement
        and "keep symbolic equations in informationUnits" in requirement
        for requirement in script_prompt["requirements"]
    )
    assert len(script_client.requests) == 1


def test_structured_provider_repairs_math_that_expands_past_spoken_pacing() -> None:
    learner = LearnerProfile("curious beginners", ExperienceLevel.BEGINNER)
    outline_provider = StructuredWritingEducationalProvider(
        FakeTextClient([_outline_response()]), model="writer-v1"
    )
    outline = tuple(
        outline_provider.build_outline("Karatsuba multiplication", learner, _objectives(), 60)
    )
    initial = _script_response([section.id for section in outline])
    mathematical_narration = (
        "We compare O(n^2) with O(n^1.585), so 1234 inputs avoid 25% of the recursive "
        "products. This comparison shows why the faster recurrence saves work as inputs grow "
        "and the recursive tree becomes wider in each level."
    )
    for section in initial["sections"]:
        section["narration"] = mathematical_narration
    initial_authored_words = ScriptDraft.create(
        tuple(
            ScriptSection(section["outlineSectionId"], section["narration"], "test intent")
            for section in initial["sections"]
        ),
        locale="en-US",
        revision=1,
    ).word_count
    original_roles = [
        [unit["role"] for unit in section["informationUnits"]]
        for section in initial["sections"]
    ]
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
    rewrite_prompt = client.requests[1].prompt
    previous_total = json.loads(rewrite_prompt)["previousTotalWords"]
    assert isinstance(previous_total, int)
    assert round(60 * 2.05 * 0.94) <= initial_authored_words <= round(60 * 2.05 * 1.08)
    assert previous_total > initial_authored_words
    assert "words a narrator will speak" in rewrite_prompt
    rewrite_payload = json.loads(rewrite_prompt)
    assert client.requests[0].json_schema is not None
    role_enum = client.requests[0].json_schema["properties"]["sections"]["items"][
        "properties"
    ]["informationUnits"]["items"]["properties"]["role"]["enum"]
    assert rewrite_payload["preservedInformationUnitRoleVocabulary"] == role_enum
    assert any(
        "preserves every existing informationUnits object and its role" in requirement
        and "never return, rename, replace, or reclassify those roles" in requirement
        for requirement in rewrite_payload["requirements"]
    )
    assert any(
        "verbalize arithmetic" in requirement
        and "keep symbolic equations in informationUnits" in requirement
        for requirement in rewrite_payload["requirements"]
    )
    assert [
        [unit["role"] for unit in section.visual_beat["informationUnits"]]
        for section in draft.sections
        if section.visual_beat is not None
    ] == original_roles
    assert _pacing_word_count(draft) <= round(60 * 2.05 * 1.08)


def test_pacing_count_preserves_plain_prose_and_non_english_behavior() -> None:
    plain = ScriptDraft.create(
        (ScriptSection("outline-1", "Plain narration keeps the same ordinary word count.", "test"),),
        locale="en-US",
        revision=1,
    )
    non_english = ScriptDraft.create(
        (ScriptSection("outline-1", "La valeur 12 + 34 reste ecrite ici.", "test"),),
        locale="fr-FR",
        revision=1,
    )

    assert _pacing_word_count(plain) == plain.word_count
    assert _pacing_word_count(non_english) == non_english.word_count


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


def test_structured_provider_repairs_missing_objective_coverage_once() -> None:
    invalid = _outline_response()
    invalid["sections"] = invalid["sections"][:2]
    valid = _outline_response()
    client = FakeTextClient([invalid, valid])
    provider = StructuredWritingEducationalProvider(client, model="writer-v1")

    outline = provider.build_outline(
        "Karatsuba",
        LearnerProfile("beginners", ExperienceLevel.BEGINNER),
        _objectives(),
        60,
    )

    assert len(outline) == 3
    assert len(client.requests) == 2
    repair = client.requests[1]
    assert repair.max_correction_attempts == 0
    assert repair.json_schema == client.requests[0].json_schema
    repair_prompt = json.loads(repair.prompt)
    assert repair_prompt["semanticViolation"] == {
        "path": "$.sections[*].objectiveIds",
        "keyword": "objectiveCoverage",
    }


def test_structured_provider_never_rebinds_an_unknown_objective_id() -> None:
    invalid = _outline_response()
    invalid["sections"][0]["objectiveIds"] = ["invented-objective-id"]
    valid = _outline_response()
    client = FakeTextClient([invalid, valid])
    provider = StructuredWritingEducationalProvider(client, model="writer-v1")

    outline = provider.build_outline(
        "Karatsuba",
        LearnerProfile("beginners", ExperienceLevel.BEGINNER),
        _objectives(),
        60,
    )

    assert len(outline) == 3
    assert "invented-objective-id" not in client.requests[1].prompt
    assert json.loads(client.requests[1].prompt)["semanticViolation"] == {
        "path": "$.sections[0].objectiveIds",
        "keyword": "enum",
    }


def test_prior_schema_correction_consumes_the_only_outline_correction() -> None:
    invalid = _outline_response()
    invalid["sections"] = invalid["sections"][:2]
    client = FakeTextClient([invalid], correction_attempts=[1])
    provider = StructuredWritingEducationalProvider(client, model="writer-v1")

    with pytest.raises(ProviderFailure, match="after one correction") as raised:
        provider.build_outline(
            "Karatsuba",
            LearnerProfile("beginners", ExperienceLevel.BEGINNER),
            _objectives(),
            60,
        )

    assert len(client.requests) == 1
    assert raised.value.details == {
        "semanticPath": "$.sections[*].objectiveIds",
        "semanticKeyword": "objectiveCoverage",
        "repairAttempted": True,
        "attemptCount": 2,
        "usageAlreadyRecorded": True,
    }


def test_semantic_correction_stops_after_a_second_invalid_outline() -> None:
    invalid = _outline_response()
    invalid["sections"] = invalid["sections"][:2]
    still_invalid = _outline_response()
    still_invalid["sections"][2]["objectiveIds"] = []
    client = FakeTextClient([invalid, still_invalid])
    provider = StructuredWritingEducationalProvider(client, model="writer-v1")

    with pytest.raises(ProviderFailure, match="after one correction") as raised:
        provider.build_outline(
            "Karatsuba",
            LearnerProfile("beginners", ExperienceLevel.BEGINNER),
            _objectives(),
            60,
        )

    assert len(client.requests) == 2
    assert client.requests[1].max_correction_attempts == 0
    assert raised.value.details["semanticPath"] == "$.sections[2].objectiveIds"
    assert raised.value.details["semanticKeyword"] == "minItems"


def test_three_minute_outline_requires_more_inspectable_scenes() -> None:
    response = _three_minute_outline_response()
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
    assert client.requests[0].json_schema["properties"]["sections"]["items"][
        "properties"
    ]["objectiveIds"]["items"]["enum"] == [
        objective.id for objective in _objectives()
    ]


def test_three_minute_groq_outline_repairs_one_empty_objective_list_end_to_end() -> None:
    valid = _three_minute_outline_response()
    invalid = copy.deepcopy(valid)
    invalid["sections"][4]["objectiveIds"] = []
    transport = EducationSequenceTransport(
        [
            {
                "id": "outline-invalid",
                "model": GROQ_STRUCTURED_MODEL,
                "choices": [{"message": {"content": json.dumps(invalid)}}],
                "usage": {"prompt_tokens": 900, "completion_tokens": 450},
            },
            {
                "id": "outline-repaired",
                "model": GROQ_STRUCTURED_MODEL,
                "choices": [{"message": {"content": json.dumps(valid)}}],
                "usage": {"prompt_tokens": 1_050, "completion_tokens": 470},
            },
        ]
    )
    client = GroqEducationTextClient(transport)
    provider = StructuredWritingEducationalProvider(client, model=GROQ_STRUCTURED_MODEL)

    captured: list[tuple[str, ProviderResult[TextOutput]]] = []
    with capture_structured_writing_usage(
        lambda key, result: captured.append((key, result))
    ):
        outline = provider.build_outline(
            "Karatsuba multiplication",
            LearnerProfile("beginners", ExperienceLevel.BEGINNER),
            _objectives(),
            180,
        )

    assert len(outline) == 5
    assert all(section.objective_ids for section in outline)
    assert len(transport.requests) == 2
    repair_body = transport.requests[1].json_body
    assert repair_body is not None
    repair_prompt = json.loads(repair_body["messages"][-1]["content"])
    assert repair_prompt["schemaViolation"] == {
        "path": "$.sections[4].objectiveIds",
        "keyword": "minItems",
    }
    assert client.results[0].usage.units == {
        "input_tokens": 1_950.0,
        "output_tokens": 920.0,
    }
    assert client.results[0].usage.actual_cost_micros == 423
    assert client.results[0].correction_attempts == 1
    assert len(captured) == 1
    assert captured[0][0].startswith("education-")
    assert captured[0][1].usage == client.results[0].usage


def test_groq_schema_then_semantic_failure_stops_after_two_total_calls() -> None:
    first = _three_minute_outline_response()
    first["sections"][4]["objectiveIds"] = []
    second = _three_minute_outline_response()
    for section in second["sections"]:
        section["objectiveIds"] = ["objective-meaning"]
    transport = EducationSequenceTransport(
        [
            {
                "id": "schema-invalid",
                "model": GROQ_STRUCTURED_MODEL,
                "choices": [{"message": {"content": json.dumps(first)}}],
                "usage": {"prompt_tokens": 900, "completion_tokens": 450},
            },
            {
                "id": "semantic-invalid",
                "model": GROQ_STRUCTURED_MODEL,
                "choices": [{"message": {"content": json.dumps(second)}}],
                "usage": {"prompt_tokens": 1_050, "completion_tokens": 470},
            },
        ]
    )
    provider = StructuredWritingEducationalProvider(
        GroqEducationTextClient(transport), model=GROQ_STRUCTURED_MODEL
    )

    with pytest.raises(ProviderFailure, match="after one correction") as raised:
        provider.build_outline(
            "Karatsuba multiplication",
            LearnerProfile("beginners", ExperienceLevel.BEGINNER),
            _objectives(),
            180,
        )

    assert len(transport.requests) == 2
    assert raised.value.details["semanticKeyword"] == "objectiveCoverage"
    assert raised.value.details["attemptCount"] == 2


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
            {"sceneId": "one", "durationMs": 59_000},
            {"sceneId": "two", "durationMs": 59_000},
            {"sceneId": "three", "durationMs": 59_000},
        ],
    )

    durations = [scene["durationTicks"] for scene in fitted["scenes"]]
    measured = [59_000 * 240, 59_000 * 240, 59_000 * 240]
    assert sum(durations) == 180 * 240_000
    assert all(duration >= audio for duration, audio in zip(durations, measured, strict=True))
    assert max(duration - audio for duration, audio in zip(durations, measured, strict=True)) == (
        1_000 * 240
    )
    assert [scene["visualTailTicks"] for scene in fitted["scenes"]] == [240_000] * 3
    assert storyboard["scenes"][0]["durationTicks"] == 60 * 240_000


def test_measured_audio_rejects_a_tutorial_that_cannot_fit() -> None:
    with pytest.raises(ValueError, match="exceeds the requested tutorial duration"):
        _fit_storyboard_to_narration(
            {"scenes": [{"id": "one", "durationTicks": 10 * 240_000}]},
            [{"sceneId": "one", "durationMs": 10_001}],
        )


def test_measured_audio_rejects_unvoiced_duration_padding() -> None:
    storyboard = {
        "scenes": [
            {"id": f"scene-{index}", "durationTicks": 36 * 240_000}
            for index in range(5)
        ]
    }

    with pytest.raises(ValueError, match="leaves 30000 ms unvoiced"):
        _fit_storyboard_to_narration(
            storyboard,
            [
                {"sceneId": f"scene-{index}", "durationMs": 30_000}
                for index in range(5)
            ],
        )
