from __future__ import annotations

import json
from typing import Any

import pytest

from alystria.providers import ProviderResult, TextOutput, Usage
from alystria.scene_edit_provider import StructuredSceneEditProvider


class RecordingTextClient:
    def __init__(self, parsed: object) -> None:
        self.parsed = parsed
        self.calls: list[tuple[Any, str]] = []

    def generate(self, request: Any, *, idempotency_key: str) -> ProviderResult[TextOutput]:
        self.calls.append((request, idempotency_key))
        return ProviderResult(
            "groq",
            request.model,
            TextOutput(text=json.dumps(self.parsed), parsed=self.parsed),
            Usage(
                "groq",
                request.model,
                units={"outputTokens": 36},
                actual_cost_micros=0,
                request_id="request-one",
            ),
            raw_id="response-one",
        )


def test_structured_scene_editor_uses_bounded_schema_and_stable_idempotency() -> None:
    client = RecordingTextClient(
        {
            "title": "A concrete example",
            "narration": "Imagine narrowing a shelf of eight books to four, then two.",
            "objective": "Explain interval narrowing.",
            "durationSeconds": 12,
            "visualIntent": "Show the shelf narrowing without replacing approved artwork.",
        }
    )
    provider = StructuredSceneEditProvider(client, model="llama-3.3-70b-versatile")  # type: ignore[arg-type]
    scene = {
        "title": "Interval narrowing",
        "narration": "The interval gets smaller.",
        "objective": "Explain interval narrowing.",
        "durationTicks": 2_400_000,
    }

    first = provider.propose_scene_edit(
        scene,
        instruction="Make this concrete.",
        focus="explanation",
        alternative_index=0,
        preservation_locks=("learningobjective", "assets"),
    )
    second = provider.propose_scene_edit(
        scene,
        instruction="Make this concrete.",
        focus="explanation",
        alternative_index=0,
        preservation_locks=("learningobjective", "assets"),
    )

    request, key = client.calls[0]
    prompt = json.loads(request.prompt)
    assert request.json_schema["additionalProperties"] is False
    assert request.max_output_tokens == 2_048
    assert prompt["scene"]["durationSeconds"] == 10
    assert prompt["focus"] == "explanation"
    assert prompt["preservationLocks"] == ["learningobjective", "assets"]
    assert any(item.startswith("Do not add a URL") for item in prompt["requirements"])
    assert first.idempotency_key == second.idempotency_key == key
    assert first.proposal["durationSeconds"] == 12
    assert first.provider_result.provider_id == "groq"


def test_structured_scene_editor_rejects_missing_parsed_object() -> None:
    provider = StructuredSceneEditProvider(
        RecordingTextClient(None),  # type: ignore[arg-type]
        model="writer-v1",
    )

    with pytest.raises(ValueError, match="no scene edit object"):
        provider.propose_scene_edit(
            {
                "title": "Scene",
                "narration": "Narration",
                "objective": "Objective",
                "duration": 5,
            },
            instruction="Tighten this.",
            focus="pacing",
            alternative_index=0,
            preservation_locks=(),
        )
