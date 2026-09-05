from __future__ import annotations

import base64
import json
from typing import Any

import pytest

from alystria.providers.licensed_media_selection import (
    LicensedMediaVisionSelector,
    PreparedLicensedMediaCandidate,
)
from alystria.providers.types import (
    AssetInput,
    MediaAsset,
    ProviderResult,
    TextOutput,
    Usage,
    VisionLanguageRequest,
)


class Judge:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        self.calls: list[tuple[VisionLanguageRequest, str]] = []

    def invoke(
        self, request: VisionLanguageRequest, *, idempotency_key: str
    ) -> ProviderResult[Any]:
        self.calls.append((request, idempotency_key))
        return ProviderResult(
            "nvidia-nim",
            request.model,
            TextOutput(json.dumps(self.payload)),
            Usage("nvidia-nim", request.model),
        )


def candidate(
    candidate_id: str, *, license_id: str = "cc0", provider_id: str = "openverse"
) -> PreparedLicensedMediaCandidate:
    return PreparedLicensedMediaCandidate(
        candidate_id,
        provider_id,
        MediaAsset(
            uri=f"https://media.test/{candidate_id}.jpg",
            media_type="image/jpeg",
            width=1920,
            height=1080,
            license=license_id,
            attribution="Photographer" if license_id != "cc0" else None,
            source_url=f"https://source.test/{candidate_id}",
        ),
        AssetInput("image/jpeg", data_base64=base64.b64encode(candidate_id.encode()).decode()),
        0,
    )


def judgement(candidate_id: str, *, risks: list[str] | None = None) -> dict[str, Any]:
    return {
        "candidateId": candidate_id,
        "lessonFit": 91,
        "composition": 84,
        "technicalQuality": 90,
        "overall": 88,
        "risks": risks or [],
        "rationale": "The subject directly supports the lesson and leaves usable title space.",
    }


def test_ranked_candidate_stays_review_only_and_uses_inline_previews() -> None:
    judge = Judge(
        {
            "recommendedCandidateId": "candidate-a",
            "rankings": [judgement("candidate-a"), judgement("candidate-b")],
        }
    )
    selector = LicensedMediaVisionSelector(judge, model="nvidia/vision-model")

    selected = selector.select(
        lesson_intent="Show how a glacier carves a U-shaped valley.",
        candidates=(
            candidate("candidate-a"),
            candidate("candidate-b", license_id="pexels", provider_id="pexels"),
        ),
    )

    assert selected.ready_for_review is True
    assert selected.review_required is True
    request, idempotency_key = judge.calls[0]
    assert request.capability.value == "vlm.chat"
    assert all(image.uri is None and image.data_base64 for image in request.images)
    assert "Do not assess licensing" in request.prompt
    assert len(idempotency_key) == 64


def test_blocking_visual_risk_never_becomes_ready() -> None:
    judge = Judge(
        {
            "recommendedCandidateId": "candidate-a",
            "rankings": [judgement("candidate-a", risks=["watermark"])],
        }
    )
    result = LicensedMediaVisionSelector(judge, model="vision").select(
        lesson_intent="A clear ocean wave for a physics lesson.",
        candidates=(candidate("candidate-a"),),
    )
    assert result.ready_for_review is False


def test_candidate_license_source_and_dimensions_fail_closed() -> None:
    with pytest.raises(ValueError, match="license"):
        candidate("candidate-a", license_id="by-nc")
    with pytest.raises(ValueError, match="CC0"):
        candidate("candidate-a", license_id="by")
    with pytest.raises(ValueError, match="HTTPS"):
        PreparedLicensedMediaCandidate(
            "candidate-a",
            "openverse",
            MediaAsset(
                uri="http://media.test/a.jpg",
                media_type="image/jpeg",
                width=1920,
                height=1080,
                license="cc0",
                source_url="https://source.test/a",
            ),
            AssetInput("image/jpeg", data_base64=base64.b64encode(b"image").decode()),
            0,
        )


def test_judge_cannot_change_candidate_identity_or_schema() -> None:
    selector = LicensedMediaVisionSelector(
        Judge(
            {
                "recommendedCandidateId": "invented",
                "rankings": [judgement("invented")],
            }
        ),
        model="vision",
    )
    with pytest.raises(ValueError, match="identities"):
        selector.select(
            lesson_intent="Explain a forest ecosystem.",
            candidates=(candidate("candidate-a"),),
        )
