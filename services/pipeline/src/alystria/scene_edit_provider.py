"""Structured-writing adapter for reversible authored-scene proposals."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from alystria.providers import (
    Capability,
    ProviderResult,
    ProviderRuntime,
    ProviderTextClient,
    TextOutput,
    TextRequest,
)

_PROPOSAL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "narration", "objective", "durationSeconds", "visualIntent"],
    "properties": {
        "title": {"type": "string", "minLength": 1, "maxLength": 160},
        "narration": {"type": "string", "minLength": 1, "maxLength": 4_000},
        "objective": {"type": "string", "minLength": 1, "maxLength": 1_000},
        "durationSeconds": {"type": "integer", "minimum": 1, "maximum": 10_800},
        "visualIntent": {"type": "string", "maxLength": 2_000},
    },
}


@dataclass(frozen=True, slots=True)
class StructuredSceneEdit:
    proposal: dict[str, Any]
    idempotency_key: str
    provider_result: ProviderResult[TextOutput]


class StructuredSceneEditProvider:
    """Ask only the project's approved structured-writing route for a proposal."""

    def __init__(self, client: ProviderTextClient, *, model: str) -> None:
        if not model.strip():
            raise ValueError("structured scene-edit model must not be blank")
        self.client = client
        self.model = model.strip()

    @classmethod
    def from_runtime(cls, runtime: ProviderRuntime) -> StructuredSceneEditProvider:
        route = runtime.policy.route_for(Capability.LLM_STRUCTURED)
        return cls(ProviderTextClient(runtime), model=route.model)

    def propose_scene_edit(
        self,
        scene: Mapping[str, Any],
        *,
        instruction: str,
        focus: str,
        alternative_index: int,
        preservation_locks: tuple[str, ...],
    ) -> StructuredSceneEdit:
        payload = {
            "task": "Propose one reviewable edit to this tutorial scene.",
            "focus": focus,
            "instruction": instruction,
            "alternativeIndex": alternative_index,
            "scene": {
                "title": scene.get("title", ""),
                "narration": scene.get("narration", ""),
                "objective": scene.get("objective", ""),
                "durationSeconds": _scene_duration_seconds(scene),
                "visualIntent": scene.get("visualIntent", scene.get("objective", "")),
            },
            "preservationLocks": list(preservation_locks),
            "requirements": [
                "Return a complete replacement scene, not editing instructions or commentary.",
                "Preserve the factual claims, citations, language, learner level, and teaching objective.",
                "Do not add a URL, source, quotation, named statistic, or numerical claim not present in the supplied scene.",
                "Keep narration natural spoken prose and visualIntent free of rendered text instructions.",
                "For explanation focus, make the reasoning more concrete with an example or analogy supported by the existing facts.",
                "For pacing focus, tighten repetition and transitions while keeping every factual claim.",
                "Honor every preservation lock exactly.",
            ],
        }
        idempotency_key = hashlib.sha256(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        result = self.client.generate(
            TextRequest(
                prompt=json.dumps(payload, ensure_ascii=False),
                system=(
                    "You are Alystria's senior scene editor. Return only schema-valid structured "
                    "data. Preserve truth and the reviewed source boundary; never invent evidence."
                ),
                model=self.model,
                max_output_tokens=2_048,
                temperature=0.35 if alternative_index == 0 else 0.45,
                json_schema=_PROPOSAL_SCHEMA,
                schema_name="alystria_scene_edit_candidate",
            ),
            idempotency_key=idempotency_key,
        )
        if not isinstance(result.value.parsed, dict):
            raise ValueError("Structured-writing provider returned no scene edit object")
        return StructuredSceneEdit(
            proposal=dict(result.value.parsed),
            idempotency_key=idempotency_key,
            provider_result=result,
        )


def _scene_duration_seconds(scene: Mapping[str, Any]) -> int:
    duration_ticks = scene.get("durationTicks")
    if isinstance(duration_ticks, int) and not isinstance(duration_ticks, bool) and duration_ticks > 0:
        return max(1, round(duration_ticks / 240_000))
    duration = scene.get("duration")
    if isinstance(duration, int | float) and not isinstance(duration, bool) and duration > 0:
        return max(1, round(duration))
    return 20
