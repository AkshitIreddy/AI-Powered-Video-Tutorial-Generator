"""Fail-closed visual judging for already-quarantined licensed-media previews.

Network retrieval stays with the provider adapters.  The caller must download,
validate, and resize each preview before this module can send it to an approved
vision-language route.  A positive result is still a review candidate; it is
never permission to insert an asset into a project automatically.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlsplit

from .types import AssetInput, MediaAsset, ProviderResult, TextOutput, VisionLanguageRequest

MAX_JUDGE_CANDIDATES = 8
MAX_PREVIEW_BYTES = 4 * 1024 * 1024
MIN_SOURCE_WIDTH = 960
MIN_SOURCE_HEIGHT = 540
READY_SCORE = 72
ALLOWED_MEDIA_TYPES = frozenset({"image/jpeg", "image/png"})
ALLOWED_LICENSES = frozenset({"cc0", "pexels"})
ALLOWED_RISKS = frozenset(
    {
        "faces",
        "irrelevant",
        "logos",
        "low_resolution",
        "pseudo_text",
        "unsafe",
        "watermark",
    }
)
BLOCKING_RISKS = frozenset(
    {"irrelevant", "logos", "low_resolution", "pseudo_text", "unsafe", "watermark"}
)
_CANDIDATE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")


class VisionInvoker(Protocol):
    def invoke(
        self, request: VisionLanguageRequest, *, idempotency_key: str
    ) -> ProviderResult[Any]: ...


@dataclass(frozen=True, slots=True)
class PreparedLicensedMediaCandidate:
    candidate_id: str
    provider_id: str
    asset: MediaAsset
    preview: AssetInput
    search_rank: int

    def __post_init__(self) -> None:
        if not _CANDIDATE_ID.fullmatch(self.candidate_id):
            raise ValueError("Licensed-media candidate ID is invalid")
        if self.provider_id not in {"openverse", "pexels"}:
            raise ValueError("Licensed-media candidate provider is not approved")
        if not 0 <= self.search_rank < 10_000:
            raise ValueError("Licensed-media search rank is invalid")
        _validate_asset(self.asset, provider_id=self.provider_id)
        _preview_bytes(self.preview)


@dataclass(frozen=True, slots=True)
class CandidateJudgement:
    candidate_id: str
    lesson_fit: int
    composition: int
    technical_quality: int
    overall: int
    risks: tuple[str, ...]
    rationale: str

    def __post_init__(self) -> None:
        for label, value in (
            ("lessonFit", self.lesson_fit),
            ("composition", self.composition),
            ("technicalQuality", self.technical_quality),
            ("overall", self.overall),
        ):
            if isinstance(value, bool) or not 0 <= value <= 100:
                raise ValueError(f"Licensed-media {label} score must be between 0 and 100")
        if len(self.rationale) > 500:
            raise ValueError("Licensed-media rationale is too long")
        if len(self.risks) != len(set(self.risks)) or set(self.risks) - ALLOWED_RISKS:
            raise ValueError("Licensed-media judgement contains unsupported risk flags")


@dataclass(frozen=True, slots=True)
class LicensedMediaSelection:
    recommended_candidate_id: str | None
    rankings: tuple[CandidateJudgement, ...]
    judge_provider_id: str
    judge_model: str
    review_required: bool = True

    @property
    def ready_for_review(self) -> bool:
        if self.recommended_candidate_id is None:
            return False
        selected = next(
            (item for item in self.rankings if item.candidate_id == self.recommended_candidate_id),
            None,
        )
        return bool(
            selected
            and selected.overall >= READY_SCORE
            and not BLOCKING_RISKS.intersection(selected.risks)
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "recommendedCandidateId": self.recommended_candidate_id,
            "readyForReview": self.ready_for_review,
            "reviewRequired": self.review_required,
            "judgeProviderId": self.judge_provider_id,
            "judgeModel": self.judge_model,
            "rankings": [
                {
                    "candidateId": item.candidate_id,
                    "lessonFit": item.lesson_fit,
                    "composition": item.composition,
                    "technicalQuality": item.technical_quality,
                    "overall": item.overall,
                    "risks": list(item.risks),
                    "rationale": item.rationale,
                }
                for item in self.rankings
            ],
        }


class LicensedMediaVisionSelector:
    """Rank a bounded set of safe inline previews using an approved VLM."""

    def __init__(
        self,
        invoker: VisionInvoker,
        *,
        model: str,
        max_preview_bytes: int = MAX_PREVIEW_BYTES,
    ) -> None:
        if not model.strip() or len(model) > 500:
            raise ValueError("Licensed-media judge model is invalid")
        if not 32 * 1024 <= max_preview_bytes <= MAX_PREVIEW_BYTES:
            raise ValueError("Licensed-media judge preview limit is invalid")
        self.invoker = invoker
        self.model = model
        self.max_preview_bytes = max_preview_bytes

    def select(
        self,
        *,
        lesson_intent: str,
        candidates: tuple[PreparedLicensedMediaCandidate, ...],
        desired_aspect_ratio: str = "16:9",
    ) -> LicensedMediaSelection:
        intent = lesson_intent.strip()
        if not intent or len(intent) > 4_000:
            raise ValueError("Licensed-media lesson intent must contain 1 to 4000 characters")
        if not 1 <= len(candidates) <= MAX_JUDGE_CANDIDATES:
            raise ValueError("Licensed-media judging requires between 1 and 8 candidates")
        ids = [item.candidate_id for item in candidates]
        if len(ids) != len(set(ids)):
            raise ValueError("Licensed-media candidate IDs must be unique")
        if any(_preview_size(item.preview) > self.max_preview_bytes for item in candidates):
            raise ValueError("Licensed-media preview exceeds the selected VLM byte limit")
        if desired_aspect_ratio not in {"16:9", "4:3", "1:1", "9:16"}:
            raise ValueError("Licensed-media target aspect ratio is unsupported")

        manifest = [
            {
                "candidateId": item.candidate_id,
                "imageIndex": index,
                "provider": item.provider_id,
                "license": _normalise_license(item.asset.license),
                "width": item.asset.width,
                "height": item.asset.height,
                "searchRank": item.search_rank,
            }
            for index, item in enumerate(candidates, start=1)
        ]
        prompt = _judge_prompt(intent, desired_aspect_ratio, manifest)
        previews = tuple(item.preview for item in candidates)
        fingerprint = hashlib.sha256(
            json.dumps(
                {
                    "intent": intent,
                    "aspectRatio": desired_aspect_ratio,
                    "manifest": manifest,
                    "previews": [hashlib.sha256(_preview_bytes(item)).hexdigest() for item in previews],
                    "model": self.model,
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()
        result = self.invoker.invoke(
            VisionLanguageRequest(
                prompt=prompt,
                system=(
                    "You are a conservative educational art director. Evaluate only the supplied "
                    "images. Return one JSON object and no markdown. Never infer copyright or consent."
                ),
                model=self.model,
                images=previews,
                max_output_tokens=1_500,
                temperature=0,
            ),
            idempotency_key=fingerprint,
        )
        if not isinstance(result.value, TextOutput):
            raise ValueError("Licensed-media vision judge returned a non-text result")
        rankings, recommended = _parse_judgement(result.value.text, expected_ids=tuple(ids))
        return LicensedMediaSelection(
            recommended,
            rankings,
            result.provider_id,
            result.model,
        )


def _judge_prompt(intent: str, aspect_ratio: str, manifest: list[dict[str, Any]]) -> str:
    return (
        "Rank each candidate as supporting lesson photography or a slide background. "
        "Prefer literal lesson relevance, a clear focal subject, usable negative space, correct "
        f"orientation for {aspect_ratio}, and professional technical quality. Penalize watermarks, "
        "logos, legible or pseudo text, unsafe content, visual clutter, and generic imagery that does "
        "not teach the stated idea. Do not assess licensing; it has already been checked separately. "
        f"Lesson intent: {intent}\nCandidate manifest in image order: "
        f"{json.dumps(manifest, separators=(',', ':'))}\n"
        "Return exactly: {\"recommendedCandidateId\":string|null,\"rankings\":[{\"candidateId\":string,"
        "\"lessonFit\":integer,\"composition\":integer,\"technicalQuality\":integer,"
        "\"overall\":integer,\"risks\":[string],\"rationale\":string}]}. "
        f"Allowed risk strings: {','.join(sorted(ALLOWED_RISKS))}. Include every candidate once."
    )


def _parse_judgement(
    text: str, *, expected_ids: tuple[str, ...]
) -> tuple[tuple[CandidateJudgement, ...], str | None]:
    raw = text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"\A```(?:json)?\s*|\s*```\Z", "", raw, flags=re.IGNORECASE)
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError("Licensed-media vision judgement is not valid JSON") from error
    if not isinstance(value, dict) or set(value) != {"recommendedCandidateId", "rankings"}:
        raise ValueError("Licensed-media vision judgement has unexpected top-level fields")
    rows = value["rankings"]
    if not isinstance(rows, list) or len(rows) != len(expected_ids):
        raise ValueError("Licensed-media vision judgement must rank every candidate once")
    rankings: list[CandidateJudgement] = []
    for row in rows:
        required = {
            "candidateId",
            "lessonFit",
            "composition",
            "technicalQuality",
            "overall",
            "risks",
            "rationale",
        }
        if not isinstance(row, dict) or set(row) != required:
            raise ValueError("Licensed-media candidate judgement has unexpected fields")
        risks = row["risks"]
        if not isinstance(risks, list) or not all(isinstance(item, str) for item in risks):
            raise ValueError("Licensed-media risk flags must be strings")
        rankings.append(
            CandidateJudgement(
                candidate_id=str(row["candidateId"]),
                lesson_fit=_score(row["lessonFit"]),
                composition=_score(row["composition"]),
                technical_quality=_score(row["technicalQuality"]),
                overall=_score(row["overall"]),
                risks=tuple(risks),
                rationale=str(row["rationale"]),
            )
        )
    ranked_ids = tuple(item.candidate_id for item in rankings)
    if len(set(ranked_ids)) != len(ranked_ids) or set(ranked_ids) != set(expected_ids):
        raise ValueError("Licensed-media vision judgement changed candidate identities")
    recommended = value["recommendedCandidateId"]
    if recommended is not None and recommended not in expected_ids:
        raise ValueError("Licensed-media recommendation is not one of the candidates")
    if recommended is not None and rankings[0].candidate_id != recommended:
        raise ValueError("Licensed-media recommendation must be the first ranked candidate")
    return tuple(rankings), recommended


def _validate_asset(asset: MediaAsset, *, provider_id: str) -> None:
    if asset.uri is None or not _https_url(asset.uri):
        raise ValueError("Licensed-media source requires an HTTPS media URL")
    if asset.source_url is None or not _https_url(asset.source_url):
        raise ValueError("Licensed-media source requires an HTTPS landing page")
    if asset.media_type not in ALLOWED_MEDIA_TYPES:
        raise ValueError("Licensed-media source must be a JPEG or PNG")
    if asset.width is None or asset.height is None:
        raise ValueError("Licensed-media source dimensions are required")
    if asset.width < MIN_SOURCE_WIDTH or asset.height < MIN_SOURCE_HEIGHT:
        raise ValueError("Licensed-media source is too small for a slide")
    license_id = _normalise_license(asset.license)
    if provider_id == "openverse" and license_id != "cc0":
        raise ValueError(
            "Openverse automatic selection is limited to CC0 until exact license versions and URLs are preserved"
        )
    if license_id not in ALLOWED_LICENSES:
        raise ValueError("Licensed-media source license is not in the export allowlist")
    if provider_id == "pexels" and license_id != "pexels":
        raise ValueError("Pexels results must preserve the Pexels license")
    if license_id == "pexels" and not (asset.attribution or "").strip():
        raise ValueError("Licensed-media source requires creator attribution")


def _preview_bytes(preview: AssetInput) -> bytes:
    if preview.uri is not None or preview.data_base64 is None:
        raise ValueError("Licensed-media judge previews must be quarantined inline bytes")
    if preview.media_type not in ALLOWED_MEDIA_TYPES:
        raise ValueError("Licensed-media judge preview must be a JPEG or PNG")
    try:
        data = base64.b64decode(preview.data_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("Licensed-media judge preview is not valid base64") from error
    if not data or len(data) > MAX_PREVIEW_BYTES:
        raise ValueError("Licensed-media judge preview exceeds its byte limit")
    return data


def _preview_size(preview: AssetInput) -> int:
    return len(_preview_bytes(preview))


def _https_url(value: str) -> bool:
    parsed = urlsplit(value)
    return parsed.scheme == "https" and bool(parsed.hostname) and not parsed.username


def _normalise_license(value: str | None) -> str:
    return (value or "").strip().casefold().replace("cc ", "").replace("cc-", "")


def _score(value: object) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError("Licensed-media judgement scores must be integers")
    return value
