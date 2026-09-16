"""Optional sparse visual review of actual rendered video frames.

The renderer's structural QA remains authoritative for frame, audio, caption,
and timeline metrics.  This module adds a deliberately limited semantic check:
up to six representative frames from the promoted video are decoded with the
pinned FFmpeg runtime, assembled into one small JPEG contact sheet, and sent in
one request through the project's explicitly selected ``vlm.chat`` route.

No route is a durable ``not_reviewed`` result, never a synthetic pass.  A
positive provider response is also described as a sparse review rather than an
all-frame guarantee.
"""

from __future__ import annotations

import base64
import copy
import hashlib
import io
import json
import math
import re
import subprocess
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path
from typing import Any, Protocol

from PIL import Image, ImageDraw, ImageFont

from .project import ProjectStore
from .project.models import utc_now
from .providers.errors import ProviderFailure
from .providers.policy import TutorialRoutingPolicy
from .providers.types import (
    AssetInput,
    Capability,
    ProviderResult,
    TextOutput,
    VisionLanguageRequest,
)
from .qa import Finding, Severity

MAX_SAMPLE_FRAMES = 6
MAX_CONTACT_SHEET_BYTES = 180 * 1024
MAX_FINDINGS = 24
MAX_RATIONALE_CHARS = 500
MAX_RESPONSE_CHARS = 24_000
MAX_FRAME_BYTES = 2 * 1024 * 1024
MAX_VIDEO_DURATION_SECONDS = 6 * 60 * 60
SUPPORTED_VIDEO_TYPES = frozenset({"video/mp4", "video/webm"})
FINDING_SEVERITIES = frozenset({"INFO", "MINOR", "MAJOR", "CRITICAL"})
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class RenderedFrameReviewError(ValueError):
    """The rendered-frame review input or immutable evidence is invalid."""


class FrameExtractionUnavailable(RuntimeError):
    """Trusted local frame extraction could not produce review evidence."""


class RenderedFrameReviewResponseError(ValueError):
    """The VLM response did not match the closed review schema."""


class ReviewJobContext(Protocol):
    task_key: str

    def check_cancelled(self) -> None: ...

    def provider_acceptance(self, idempotency_key: str) -> dict[str, Any] | None: ...

    def record_provider_acceptance(
        self,
        *,
        idempotency_key: str,
        provider: str,
        model: str,
        provider_request_id: str | None,
        result: dict[str, Any],
        unit: str,
        quantity: float,
        cost_micros: int,
        usage_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]: ...


class RoutedVisionRuntime(Protocol):
    policy: TutorialRoutingPolicy

    def invoke(
        self, request: VisionLanguageRequest, *, idempotency_key: str
    ) -> ProviderResult[Any]: ...


class FrameExtractor(Protocol):
    def probe_duration(self, video_path: Path, ffprobe_path: Path) -> float: ...

    def extract_frame(
        self, video_path: Path, timestamp_seconds: float, output_path: Path, ffmpeg_path: Path
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class SceneWindow:
    scene_id: str
    start_seconds: float
    end_seconds: float


@dataclass(frozen=True, slots=True)
class RenderedFrameReviewRequest:
    generation_id: str
    render_artifact_hash: str
    render_media_type: str
    expected_duration_seconds: float
    scenes: tuple[SceneWindow, ...]


@dataclass(frozen=True, slots=True)
class SampledFrame:
    scene_id: str
    timestamp_seconds: float
    artifact_hash: str
    byte_size: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "sceneId": self.scene_id,
            "timestampSeconds": self.timestamp_seconds,
            "artifactHash": self.artifact_hash,
            "byteSize": self.byte_size,
        }


@dataclass(frozen=True, slots=True)
class RenderedFrameFinding:
    scene_id: str
    timestamp_seconds: float
    severity: str
    rationale: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "sceneId": self.scene_id,
            "timestampSeconds": self.timestamp_seconds,
            "severity": self.severity,
            "rationale": self.rationale,
        }


@dataclass(frozen=True, slots=True)
class RenderedFrameReviewResult:
    status: str
    reason: str | None
    report_artifact_hash: str
    contact_sheet_artifact_hash: str | None
    sampled_frames: tuple[SampledFrame, ...]
    findings: tuple[RenderedFrameFinding, ...]
    provider_id: str | None
    model: str | None
    critical_finding_count: int
    revision_id: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "reason": self.reason,
            "reportArtifactHash": self.report_artifact_hash,
            "contactSheetArtifactHash": self.contact_sheet_artifact_hash,
            "sampledFrames": [item.to_dict() for item in self.sampled_frames],
            "findings": [item.to_dict() for item in self.findings],
            "providerId": self.provider_id,
            "model": self.model,
            "criticalFindingCount": self.critical_finding_count,
            "revisionId": self.revision_id,
        }


class FfmpegFrameExtractor:
    """Decode bounded representative frames with explicit trusted executables."""

    def probe_duration(self, video_path: Path, ffprobe_path: Path) -> float:
        completed = subprocess.run(
            [
                str(ffprobe_path),
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(video_path),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
            shell=False,
        )
        if completed.returncode != 0:
            raise FrameExtractionUnavailable("ffprobe could not inspect the promoted video")
        try:
            decoded = json.loads(completed.stdout)
            duration = float(decoded["format"]["duration"])
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise FrameExtractionUnavailable("ffprobe returned no valid video duration") from error
        if not math.isfinite(duration) or not 0 < duration <= MAX_VIDEO_DURATION_SECONDS:
            raise FrameExtractionUnavailable("ffprobe returned an unsupported video duration")
        return duration

    def extract_frame(
        self, video_path: Path, timestamp_seconds: float, output_path: Path, ffmpeg_path: Path
    ) -> None:
        completed = subprocess.run(
            [
                str(ffmpeg_path),
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-i",
                str(video_path),
                "-ss",
                f"{timestamp_seconds:.3f}",
                "-frames:v",
                "1",
                "-vf",
                "scale=480:270:force_original_aspect_ratio=decrease,"
                "pad=480:270:(ow-iw)/2:(oh-ih)/2:black",
                "-q:v",
                "3",
                "-y",
                str(output_path),
            ],
            check=False,
            capture_output=True,
            timeout=45,
            shell=False,
        )
        if completed.returncode != 0 or not output_path.is_file():
            raise FrameExtractionUnavailable("FFmpeg could not decode a representative frame")


def review_rendered_frames(
    store: ProjectStore,
    request: RenderedFrameReviewRequest,
    context: ReviewJobContext,
    *,
    runtime: RoutedVisionRuntime | None,
    ffmpeg_path: Path | None,
    ffprobe_path: Path | None,
    extractor: FrameExtractor | None = None,
) -> RenderedFrameReviewResult:
    """Persist one optional sparse rendered-frame review.

    The caller may invoke this from final QA on every retry.  A stable review
    key and provider checkpoint make the operation idempotent, while the VLM
    request remains capped at one contact sheet.
    """

    _validate_request(request)
    _verify_render_artifact(store, request)
    route, unavailable_reason = _selected_vlm_route(runtime)
    review_key = _review_key(request, route)
    recovered = _recover_result(store, request, review_key)
    if recovered is not None:
        return recovered
    if route is None or runtime is None:
        return _persist_not_reviewed(store, request, review_key, unavailable_reason or "no_explicit_vlm_route")
    if request.render_media_type not in SUPPORTED_VIDEO_TYPES:
        return _persist_not_reviewed(store, request, review_key, "unsupported_render_media")
    if ffmpeg_path is None or ffprobe_path is None:
        return _persist_not_reviewed(store, request, review_key, "trusted_frame_tools_unavailable")
    try:
        trusted_ffmpeg = _trusted_executable(ffmpeg_path, "FFmpeg")
        trusted_ffprobe = _trusted_executable(ffprobe_path, "ffprobe")
    except FrameExtractionUnavailable:
        return _persist_not_reviewed(store, request, review_key, "trusted_frame_tools_unavailable")

    context.check_cancelled()
    frame_extractor = extractor or FfmpegFrameExtractor()
    try:
        duration = frame_extractor.probe_duration(
            store.cas.object_path(request.render_artifact_hash), trusted_ffprobe
        )
        _validate_measured_duration(request.expected_duration_seconds, duration)
        timestamps = _sample_timestamps(request.scenes, duration)
        frames, sheet_bytes = _extract_evidence(
            store,
            request,
            context,
            frame_extractor,
            trusted_ffmpeg,
            timestamps,
        )
    except FrameExtractionUnavailable:
        return _persist_not_reviewed(store, request, review_key, "frame_extraction_failed")

    sheet = store.add_artifact_bytes(
        sheet_bytes,
        media_type="image/jpeg",
        original_name=f"rendered-frame-review-{request.generation_id}.jpg",
        metadata={
            "rightsStatus": "owned",
            "generationId": request.generation_id,
            "renderArtifactHash": request.render_artifact_hash,
            "reviewScope": "sparse_representative_frames",
        },
    )
    idempotency_key = hashlib.sha256(
        f"rendered-frame-review:{request.generation_id}:{request.render_artifact_hash}:"
        f"{sheet.hash}:{route['model']}".encode()
    ).hexdigest()
    try:
        provider_record = _invoke_once(
            runtime,
            context,
            idempotency_key=idempotency_key,
            provider_id=route["providerId"],
            model=route["model"],
            sheet_bytes=sheet_bytes,
            frames=frames,
        )
        findings = _parse_findings(provider_record["text"], frames)
    except ProviderFailure as error:
        return _persist_not_reviewed(
            store,
            request,
            review_key,
            "provider_unavailable",
            frames=frames,
            contact_sheet_hash=sheet.hash,
            provider_invocation_attempted=True,
            provider_failure={
                "code": error.code.value,
                "providerId": error.provider_id,
                "retryable": error.retryable,
                "httpStatus": error.http_status,
                "requestId": error.request_id,
            },
        )
    except RenderedFrameReviewResponseError:
        return _persist_not_reviewed(
            store,
            request,
            review_key,
            "invalid_provider_response",
            frames=frames,
            contact_sheet_hash=sheet.hash,
            provider_invocation_attempted=True,
        )

    report = {
        "schemaVersion": 1,
        "status": "reviewed",
        "reason": None,
        "scope": "sparse_representative_frames",
        "limitations": [
            "This review inspected only the listed representative timestamps, not every frame.",
            "Each contact-sheet tile is 360 by 203 pixels; exact captions, mathematics, and code remain covered by deterministic checks.",
            "Audio, motion between samples, and transient defects outside these timestamps were not inspected.",
            "Automated visual findings are flags that require author review before repair or dismissal.",
        ],
        "reviewKey": review_key,
        "generationId": request.generation_id,
        "renderArtifactHash": request.render_artifact_hash,
        "renderMediaType": request.render_media_type,
        "expectedDurationSeconds": request.expected_duration_seconds,
        "probedDurationSeconds": duration,
        "sampledFrames": [item.to_dict() for item in frames],
        "sampleCoverage": _sample_coverage(frames, duration),
        "contactSheetArtifactHash": sheet.hash,
        "frameToolHashes": {
            "ffmpeg": _sha256_file(trusted_ffmpeg),
            "ffprobe": _sha256_file(trusted_ffprobe),
        },
        "visionReview": {
            "providerId": provider_record["providerId"],
            "model": provider_record["model"],
            "requestId": provider_record["requestId"],
            "actualCostMicros": provider_record["actualCostMicros"],
            "usageUnits": provider_record["usageUnits"],
        },
        "findings": [item.to_dict() for item in findings],
        "criticalFindingCount": sum(item.severity == "CRITICAL" for item in findings),
        "reviewedAt": utc_now(),
    }
    return _persist_report(store, request, report, frames=frames, contact_sheet_hash=sheet.hash)


def critical_review_findings(result: RenderedFrameReviewResult) -> tuple[Finding, ...]:
    """Return only critical, human-review-required findings for the required QA gate."""

    return tuple(
        Finding(
            "generation.rendered_frame_review_critical."
            + hashlib.sha256(
                f"{item.scene_id}\0{item.timestamp_seconds:.3f}".encode()
            ).hexdigest()[:16],
            item.rationale,
            Severity.CRITICAL,
            f"scene:{item.scene_id}@{item.timestamp_seconds:.3f}s",
            result.report_artifact_hash,
            True,
            {
                "sceneId": item.scene_id,
                "timestampSeconds": item.timestamp_seconds,
                "requiresHumanReview": True,
                "reportArtifactHash": result.report_artifact_hash,
                "suggestedAction": "review_or_rerender_scene",
            },
        )
        for item in result.findings
        if item.severity == "CRITICAL"
    )


def _selected_vlm_route(
    runtime: RoutedVisionRuntime | None,
) -> tuple[dict[str, str] | None, str | None]:
    if runtime is None:
        return None, "no_explicit_vlm_route"
    policy = runtime.policy
    try:
        route = policy.route_for(Capability.VISION_LANGUAGE)
        approval = policy.approval_for(route.provider_ids[0])
    except (IndexError, ValueError):
        return None, "no_explicit_vlm_route"
    if (
        Capability.VISION_LANGUAGE not in approval.capabilities
        or policy.data_classification not in approval.data_classes
        or not approval.privacy_approved
        or not approval.retention_approved
        or not approval.region_approved
        or not route.model.strip()
        or len(route.model) > 500
        or len(route.provider_ids[0]) > 240
    ):
        return None, "vlm_route_not_fully_approved"
    if approval.provider_id == "nvidia-nim" and (
        not approval.terms_approved or approval.model_access_checked_at is None
    ):
        return None, "vlm_route_not_fully_approved"
    return {"providerId": route.provider_ids[0], "model": route.model}, None


def _invoke_once(
    runtime: RoutedVisionRuntime,
    context: ReviewJobContext,
    *,
    idempotency_key: str,
    provider_id: str,
    model: str,
    sheet_bytes: bytes,
    frames: Sequence[SampledFrame],
) -> dict[str, Any]:
    checkpoint = context.provider_acceptance(idempotency_key)
    if checkpoint is not None:
        recovered = checkpoint.get("result")
        if not isinstance(recovered, dict):
            raise RenderedFrameReviewResponseError("VLM checkpoint has no response record")
        return _provider_record(recovered, provider_id=provider_id, model=model)
    prompt = _review_prompt(frames)
    result = runtime.invoke(
        VisionLanguageRequest(
            prompt=prompt,
            system=(
                "You are a conservative visual QA reviewer. Inspect only the supplied rendered-video "
                "contact sheet. Do not infer unshown frames or claim an all-frame pass."
            ),
            model=model,
            images=(
                AssetInput(
                    "image/jpeg",
                    data_base64=base64.b64encode(sheet_bytes).decode("ascii"),
                    sha256=hashlib.sha256(sheet_bytes).hexdigest(),
                ),
            ),
            max_output_tokens=1_024,
            temperature=0.0,
        ),
        idempotency_key=idempotency_key,
    )
    if not isinstance(result.value, TextOutput):
        raise RenderedFrameReviewResponseError("VLM returned a non-text review")
    if result.provider_id != provider_id or result.model != model:
        raise RenderedFrameReviewResponseError("VLM response route differs from the approved route")
    record = {
        "text": result.value.text,
        "providerId": result.provider_id,
        "model": result.model,
        "requestId": result.raw_id or result.usage.request_id,
        "actualCostMicros": max(0, result.usage.actual_cost_micros or 0),
        "usageUnits": _numeric_usage(result.usage.units),
    }
    context.record_provider_acceptance(
        idempotency_key=idempotency_key,
        provider=result.provider_id,
        model=result.model,
        provider_request_id=result.raw_id or result.usage.request_id,
        result=record,
        unit="rendered_frame_review",
        quantity=1.0,
        cost_micros=max(0, result.usage.actual_cost_micros or 0),
        usage_metadata=_numeric_usage(result.usage.units),
    )
    return record


def _provider_record(
    value: Mapping[str, Any], *, provider_id: str, model: str
) -> dict[str, Any]:
    if not all(isinstance(value.get(key), str) and str(value[key]).strip() for key in ("text", "providerId", "model")):
        raise RenderedFrameReviewResponseError("VLM checkpoint response is incomplete")
    if value["providerId"] != provider_id or value["model"] != model:
        raise RenderedFrameReviewResponseError("VLM checkpoint route differs from the approved route")
    cost = value.get("actualCostMicros", 0)
    if isinstance(cost, bool) or not isinstance(cost, int) or cost < 0:
        raise RenderedFrameReviewResponseError("VLM checkpoint cost is invalid")
    return {
        "text": str(value["text"]),
        "providerId": str(value["providerId"]),
        "model": str(value["model"]),
        "requestId": value.get("requestId") if isinstance(value.get("requestId"), str) else None,
        "actualCostMicros": cost,
        "usageUnits": _numeric_usage(value.get("usageUnits", {})),
    }


def _review_prompt(frames: Sequence[SampledFrame]) -> str:
    manifest = [
        {"sceneId": item.scene_id, "timestampSeconds": item.timestamp_seconds}
        for item in frames
    ]
    return (
        "Inspect the contact sheet made from these exact sparse rendered-video samples: "
        f"{json.dumps(manifest, separators=(',', ':'))}. "
        "Review only broad visible and temporal-layout defects: corruption, blank or severely clipped compositions, "
        "obvious watermarks, unsafe imagery, repeated overlays, or disruptive composition jumps across samples. "
        "Do not judge exact caption wording, mathematics, code, or small text from these reduced tiles; deterministic "
        "checks own that evidence. Flag illegible or pseudo-text only when the defect is unmistakable at this scale. "
        "Faces alone are not a defect. "
        "CRITICAL means the sampled frame makes the exported lesson unusable or unsafe and must be flagged for "
        "human review; do not use CRITICAL for style preferences. Return JSON only with exactly this shape: "
        '{"findings":[{"sceneId":"...","timestampSeconds":0.0,'
        '"severity":"INFO|MINOR|MAJOR|CRITICAL","rationale":"..."}]}. '
        "Use only listed scene IDs and timestamps. Return an empty findings array when nothing visible in the "
        "sampled frames warrants a finding."
    )


def _parse_findings(text: str, frames: Sequence[SampledFrame]) -> tuple[RenderedFrameFinding, ...]:
    if len(text) > MAX_RESPONSE_CHARS:
        raise RenderedFrameReviewResponseError("VLM review exceeds the response limit")
    try:
        value = json.loads(text, object_pairs_hook=_closed_json_object)
    except (json.JSONDecodeError, RenderedFrameReviewResponseError) as error:
        raise RenderedFrameReviewResponseError("VLM review is not valid JSON") from error
    if not isinstance(value, dict) or set(value) != {"findings"}:
        raise RenderedFrameReviewResponseError("VLM review has unexpected top-level fields")
    rows = value["findings"]
    if not isinstance(rows, list) or len(rows) > MAX_FINDINGS:
        raise RenderedFrameReviewResponseError("VLM review has an invalid finding count")
    samples = {(item.scene_id, item.timestamp_seconds) for item in frames}
    findings: list[RenderedFrameFinding] = []
    seen: set[tuple[str, float, str, str]] = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {
            "sceneId",
            "timestampSeconds",
            "severity",
            "rationale",
        }:
            raise RenderedFrameReviewResponseError("VLM finding has unexpected fields")
        scene_id = _response_identifier(row.get("sceneId"), "finding sceneId")
        timestamp = _response_number(row.get("timestampSeconds"), "finding timestampSeconds")
        timestamp = round(timestamp, 3)
        if (scene_id, timestamp) not in samples:
            raise RenderedFrameReviewResponseError("VLM finding does not match a sampled timestamp")
        severity = str(row.get("severity", ""))
        if severity not in FINDING_SEVERITIES:
            raise RenderedFrameReviewResponseError("VLM finding severity is invalid")
        rationale = _bounded_text(row.get("rationale"), "finding rationale", MAX_RATIONALE_CHARS)
        key = (scene_id, timestamp, severity, rationale)
        if key in seen:
            raise RenderedFrameReviewResponseError("VLM review contains duplicate findings")
        seen.add(key)
        findings.append(RenderedFrameFinding(scene_id, timestamp, severity, rationale))
    return tuple(findings)


def _extract_evidence(
    store: ProjectStore,
    request: RenderedFrameReviewRequest,
    context: ReviewJobContext,
    extractor: FrameExtractor,
    ffmpeg_path: Path,
    timestamps: Sequence[tuple[str, float]],
) -> tuple[tuple[SampledFrame, ...], bytes]:
    frames: list[SampledFrame] = []
    images: list[tuple[str, float, bytes]] = []
    staging = store.root / "staging"
    staging.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="rendered-frame-review-", dir=staging) as temporary:
        root = Path(temporary)
        video = store.cas.object_path(request.render_artifact_hash)
        for index, (scene_id, timestamp) in enumerate(timestamps):
            context.check_cancelled()
            target = root / f"frame-{index:02d}.jpg"
            extractor.extract_frame(video, timestamp, target, ffmpeg_path)
            if target.is_symlink() or not target.is_file() or target.stat().st_size > MAX_FRAME_BYTES:
                raise FrameExtractionUnavailable("FFmpeg frame exceeds the review byte limit")
            frame_bytes = target.read_bytes()
            _validate_jpeg(frame_bytes)
            artifact = store.add_artifact_bytes(
                frame_bytes,
                media_type="image/jpeg",
                original_name=target.name,
                metadata={
                    "rightsStatus": "owned",
                    "generationId": request.generation_id,
                    "renderArtifactHash": request.render_artifact_hash,
                    "sceneId": scene_id,
                    "timestampSeconds": timestamp,
                },
            )
            frames.append(SampledFrame(scene_id, timestamp, artifact.hash, artifact.byte_size))
            images.append((scene_id, timestamp, frame_bytes))
    return tuple(frames), _contact_sheet(images)


def _contact_sheet(frames: Sequence[tuple[str, float, bytes]]) -> bytes:
    if not frames or len(frames) > MAX_SAMPLE_FRAMES:
        raise FrameExtractionUnavailable("contact sheet requires bounded frame evidence")
    tile_width, image_height, label_height = 360, 203, 24
    columns = 2 if len(frames) > 1 else 1
    rows = math.ceil(len(frames) / columns)
    canvas = Image.new("RGB", (tile_width * columns, (image_height + label_height) * rows), "#111318")
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    for index, (scene_id, timestamp, content) in enumerate(frames):
        with Image.open(io.BytesIO(content)) as image:
            frame = image.convert("RGB")
            frame.thumbnail((tile_width, image_height), Image.Resampling.LANCZOS)
            left = (index % columns) * tile_width + (tile_width - frame.width) // 2
            top = (index // columns) * (image_height + label_height) + (image_height - frame.height) // 2
            canvas.paste(frame, (left, top))
        label_top = (index // columns) * (image_height + label_height) + image_height
        draw.rectangle(
            ((index % columns) * tile_width, label_top, (index % columns + 1) * tile_width, label_top + label_height),
            fill="#111318",
        )
        draw.text(
            ((index % columns) * tile_width + 7, label_top + 5),
            f"{index + 1}  {scene_id}  {timestamp:.3f}s",
            fill="#ffffff",
            font=font,
        )
    for quality in (82, 72, 62, 52, 42, 34):
        output = io.BytesIO()
        canvas.save(output, format="JPEG", quality=quality, optimize=True, progressive=True)
        content = output.getvalue()
        if len(content) <= MAX_CONTACT_SHEET_BYTES:
            return content
    raise FrameExtractionUnavailable("contact sheet exceeds the inline VLM byte limit")


def _sample_timestamps(
    scenes: Sequence[SceneWindow], measured_duration: float
) -> tuple[tuple[str, float], ...]:
    count = MAX_SAMPLE_FRAMES
    samples: list[tuple[str, float]] = []
    for index in range(count):
        timestamp = round(min(measured_duration - 0.001, (index + 0.5) * measured_duration / count), 3)
        scene = next(
            (
                item
                for item in scenes
                if item.start_seconds <= timestamp < item.end_seconds
            ),
            scenes[-1] if math.isclose(timestamp, scenes[-1].end_seconds, abs_tol=0.01) else None,
        )
        if scene is None:
            raise FrameExtractionUnavailable("representative timestamp is outside the authored scene timeline")
        samples.append((scene.scene_id, timestamp))
    return tuple(samples)


def _sample_coverage(
    frames: Sequence[SampledFrame], duration_seconds: float
) -> dict[str, Any]:
    timestamps = [item.timestamp_seconds for item in frames]
    boundaries = [0.0, *timestamps, duration_seconds]
    return {
        "sampleCount": len(frames),
        "durationSeconds": duration_seconds,
        "firstTimestampSeconds": timestamps[0] if timestamps else None,
        "lastTimestampSeconds": timestamps[-1] if timestamps else None,
        "largestUnsampledGapSeconds": round(
            max((right - left for left, right in pairwise(boundaries)), default=duration_seconds),
            3,
        ),
        "sceneIdsRepresented": list(dict.fromkeys(item.scene_id for item in frames)),
        "allFramesReviewed": False,
    }


def _validate_request(request: RenderedFrameReviewRequest) -> None:
    _identifier(request.generation_id, "generationId")
    if SHA256_PATTERN.fullmatch(request.render_artifact_hash) is None:
        raise RenderedFrameReviewError("renderArtifactHash must be a SHA-256 digest")
    if not isinstance(request.render_media_type, str) or not request.render_media_type.strip():
        raise RenderedFrameReviewError("renderMediaType is required")
    duration = _finite_number(request.expected_duration_seconds, "expectedDurationSeconds")
    if not 0 < duration <= MAX_VIDEO_DURATION_SECONDS:
        raise RenderedFrameReviewError("expectedDurationSeconds is outside the supported range")
    if not request.scenes or len(request.scenes) > 500:
        raise RenderedFrameReviewError("rendered-frame review requires 1 to 500 scene windows")
    previous_end = 0.0
    for index, scene in enumerate(request.scenes):
        _identifier(scene.scene_id, "sceneId")
        start = _finite_number(scene.start_seconds, "scene start")
        end = _finite_number(scene.end_seconds, "scene end")
        if start < 0 or end <= start or start < previous_end - 0.001:
            raise RenderedFrameReviewError("scene windows must be ordered, positive, and non-overlapping")
        if index == 0 and start > 0.001:
            raise RenderedFrameReviewError("scene timeline must start at zero")
        previous_end = end
    if abs(previous_end - duration) > max(0.05, duration * 0.001):
        raise RenderedFrameReviewError("scene timeline does not match the expected render duration")


def _verify_render_artifact(store: ProjectStore, request: RenderedFrameReviewRequest) -> None:
    if not store.cas.verify(request.render_artifact_hash):
        raise RenderedFrameReviewError("render artifact is missing or corrupt")
    artifact = store.connection.execute(
        "SELECT media_type FROM artifacts WHERE hash=?",
        (request.render_artifact_hash,),
    ).fetchone()
    if artifact is None or artifact["media_type"] != request.render_media_type:
        raise RenderedFrameReviewError("render artifact registry does not match the review request")
    linked = store.connection.execute(
        """SELECT 1
        FROM revision_artifacts AS media
        JOIN revision_artifacts AS stage ON stage.revision_id=media.revision_id
        WHERE media.artifact_hash=?
          AND ((media.role='render-output' AND media.stable_id='master')
            OR (media.role='render-delivery' AND media.stable_id=?))
          AND stage.role='generation-stage:render'
          AND stage.stable_id=?
        LIMIT 1""",
        (request.render_artifact_hash, request.generation_id, request.generation_id),
    ).fetchone()
    if linked is None:
        raise RenderedFrameReviewError(
            "render artifact is not linked to the requested completed generation render"
        )


def _validate_measured_duration(expected: float, measured: float) -> None:
    if abs(expected - measured) > max(1.0, expected * 0.02):
        raise FrameExtractionUnavailable("probed duration differs materially from the authored timeline")


def _trusted_executable(value: Path, label: str) -> Path:
    try:
        if value.is_symlink():
            raise FrameExtractionUnavailable(f"{label} path must not be a symlink")
        resolved = value.resolve(strict=True)
    except OSError as error:
        raise FrameExtractionUnavailable(f"{label} executable is unavailable") from error
    if not resolved.is_file():
        raise FrameExtractionUnavailable(f"{label} executable is unavailable")
    return resolved


def _validate_jpeg(content: bytes) -> None:
    try:
        with Image.open(io.BytesIO(content)) as image:
            if (
                image.format != "JPEG"
                or image.width < 2
                or image.height < 2
                or image.width > 1_024
                or image.height > 1_024
                or image.width * image.height > 1_048_576
            ):
                raise FrameExtractionUnavailable("FFmpeg returned an invalid JPEG frame")
            image.verify()
    except (OSError, ValueError) as error:
        raise FrameExtractionUnavailable("FFmpeg returned an invalid JPEG frame") from error


def _review_key(
    request: RenderedFrameReviewRequest, route: Mapping[str, str] | None
) -> str:
    route_id = "none" if route is None else f"{route['providerId']}:{route['model']}"
    return hashlib.sha256(
        f"rendered-frame-review-v1:{request.generation_id}:{request.render_artifact_hash}:{route_id}".encode()
    ).hexdigest()


def _persist_not_reviewed(
    store: ProjectStore,
    request: RenderedFrameReviewRequest,
    review_key: str,
    reason: str,
    *,
    frames: Sequence[SampledFrame] = (),
    contact_sheet_hash: str | None = None,
    provider_invocation_attempted: bool = False,
    provider_failure: Mapping[str, Any] | None = None,
) -> RenderedFrameReviewResult:
    report = {
        "schemaVersion": 1,
        "status": "not_reviewed",
        "reason": reason,
        "scope": "sparse_representative_frames",
        "limitations": ["No automated rendered-frame assessment was completed."],
        "reviewKey": review_key,
        "generationId": request.generation_id,
        "renderArtifactHash": request.render_artifact_hash,
        "renderMediaType": request.render_media_type,
        "expectedDurationSeconds": request.expected_duration_seconds,
        "sampledFrames": [item.to_dict() for item in frames],
        "sampleCoverage": _sample_coverage(frames, request.expected_duration_seconds),
        "contactSheetArtifactHash": contact_sheet_hash,
        "providerInvocationAttempted": provider_invocation_attempted,
        "providerFailure": dict(provider_failure) if provider_failure is not None else None,
        "visionReview": None,
        "findings": [],
        "criticalFindingCount": 0,
        "reviewedAt": None,
        "recordedAt": utc_now(),
    }
    return _persist_report(
        store,
        request,
        report,
        frames=frames,
        contact_sheet_hash=contact_sheet_hash,
    )


def _persist_report(
    store: ProjectStore,
    request: RenderedFrameReviewRequest,
    report: dict[str, Any],
    *,
    frames: Sequence[SampledFrame],
    contact_sheet_hash: str | None,
) -> RenderedFrameReviewResult:
    content = (json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n").encode()
    artifact = store.add_artifact_bytes(
        content,
        media_type="application/vnd.alystria.rendered-frame-review+json",
        original_name="rendered-frame-review.json",
        metadata={
            "rightsStatus": "owned",
            "generationId": request.generation_id,
            "renderArtifactHash": request.render_artifact_hash,
            "status": report["status"],
        },
    )
    head = store.head_revision()
    if head is None:
        raise RenderedFrameReviewError("project has no revision for rendered-frame review")
    record = {
        "reviewKey": report["reviewKey"],
        "generationId": request.generation_id,
        "renderArtifactHash": request.render_artifact_hash,
        "status": report["status"],
        "reason": report.get("reason"),
        "reportArtifactHash": artifact.hash,
        "contactSheetArtifactHash": contact_sheet_hash,
        "criticalFindingCount": report["criticalFindingCount"],
        "recordedAt": utc_now(),
    }
    snapshot = copy.deepcopy(head.snapshot)
    existing = snapshot.get("renderedFrameReviews")
    records = [item for item in existing if isinstance(item, dict)] if isinstance(existing, list) else []
    snapshot["renderedFrameReviews"] = [
        *[item for item in records if item.get("reviewKey") != report["reviewKey"]],
        record,
    ]
    links = [
        {
            "artifactHash": artifact.hash,
            "role": "rendered-frame-review",
            "stableId": request.generation_id,
        },
        *(
            [
                {
                    "artifactHash": contact_sheet_hash,
                    "role": "rendered-frame-contact-sheet",
                    "stableId": request.generation_id,
                }
            ]
            if contact_sheet_hash is not None
            else []
        ),
        *[
            {
                "artifactHash": item.artifact_hash,
                "role": "rendered-frame-sample",
                "stableId": f"{request.generation_id}:{index}",
            }
            for index, item in enumerate(frames)
        ],
    ]
    revision = store.create_revision(
        snapshot=snapshot,
        kind="generation",
        message=f"Rendered-frame review for generation {request.generation_id}",
        expected_head=head.revision_id,
        artifact_links=links,
    )
    findings = tuple(
        RenderedFrameFinding(
            str(item["sceneId"]),
            float(item["timestampSeconds"]),
            str(item["severity"]),
            str(item["rationale"]),
        )
        for item in report["findings"]
    )
    vision = report.get("visionReview")
    return RenderedFrameReviewResult(
        str(report["status"]),
        str(report["reason"]) if report.get("reason") is not None else None,
        artifact.hash,
        contact_sheet_hash,
        tuple(frames),
        findings,
        str(vision["providerId"]) if isinstance(vision, dict) else None,
        str(vision["model"]) if isinstance(vision, dict) else None,
        int(report["criticalFindingCount"]),
        revision.revision_id,
    )


def _recover_result(
    store: ProjectStore, request: RenderedFrameReviewRequest, review_key: str
) -> RenderedFrameReviewResult | None:
    head = store.head_revision()
    if head is None:
        return None
    records = head.snapshot.get("renderedFrameReviews")
    if not isinstance(records, list):
        return None
    record = next(
        (
            item
            for item in reversed(records)
            if isinstance(item, dict) and item.get("reviewKey") == review_key
        ),
        None,
    )
    if record is None:
        return None
    digest = record.get("reportArtifactHash")
    if not isinstance(digest, str) or not store.cas.verify(digest):
        raise RenderedFrameReviewError("persisted rendered-frame report is missing or corrupt")
    registered = store.connection.execute(
        """SELECT 1 FROM artifacts
        JOIN revision_artifacts ON revision_artifacts.artifact_hash=artifacts.hash
        WHERE artifacts.hash=?
          AND artifacts.media_type='application/vnd.alystria.rendered-frame-review+json'
          AND revision_artifacts.role='rendered-frame-review'
          AND revision_artifacts.stable_id=? LIMIT 1""",
        (digest, request.generation_id),
    ).fetchone()
    if registered is None:
        raise RenderedFrameReviewError("persisted rendered-frame report has no immutable revision link")
    try:
        with store.cas.open(digest) as stream:
            report = json.load(stream)
    except (OSError, json.JSONDecodeError) as error:
        raise RenderedFrameReviewError("persisted rendered-frame report is invalid") from error
    if (
        not isinstance(report, dict)
        or report.get("reviewKey") != review_key
        or report.get("generationId") != request.generation_id
        or report.get("renderArtifactHash") != request.render_artifact_hash
        or report.get("renderMediaType") != request.render_media_type
        or report.get("status") not in {"reviewed", "not_reviewed"}
    ):
        raise RenderedFrameReviewError("persisted rendered-frame report identity is invalid")
    frames = tuple(
        SampledFrame(
            str(item["sceneId"]),
            float(item["timestampSeconds"]),
            str(item["artifactHash"]),
            int(item["byteSize"]),
        )
        for item in report.get("sampledFrames", [])
        if isinstance(item, dict)
    )
    findings = tuple(
        RenderedFrameFinding(
            str(item["sceneId"]),
            float(item["timestampSeconds"]),
            str(item["severity"]),
            str(item["rationale"]),
        )
        for item in report.get("findings", [])
        if isinstance(item, dict)
    )
    if any(not store.cas.verify(item.artifact_hash) for item in frames):
        raise RenderedFrameReviewError("persisted rendered-frame sample is missing or corrupt")
    contact_hash = report.get("contactSheetArtifactHash")
    if contact_hash is not None and (
        not isinstance(contact_hash, str)
        or SHA256_PATTERN.fullmatch(contact_hash) is None
        or not store.cas.verify(contact_hash)
    ):
        raise RenderedFrameReviewError("persisted rendered-frame contact sheet is missing or corrupt")
    parsed_findings = _parse_findings(
        json.dumps({"findings": [item.to_dict() for item in findings]}), frames
    )
    critical_count = sum(item.severity == "CRITICAL" for item in parsed_findings)
    if report.get("criticalFindingCount") != critical_count:
        raise RenderedFrameReviewError("persisted rendered-frame critical count is invalid")
    vision = report.get("visionReview")
    return RenderedFrameReviewResult(
        str(report["status"]),
        str(report["reason"]) if report.get("reason") is not None else None,
        digest,
        str(contact_hash) if contact_hash is not None else None,
        frames,
        parsed_findings,
        str(vision["providerId"]) if isinstance(vision, dict) else None,
        str(vision["model"]) if isinstance(vision, dict) else None,
        critical_count,
        head.revision_id,
    )


def _identifier(value: Any, label: str) -> str:
    if not isinstance(value, str) or ID_PATTERN.fullmatch(value) is None:
        raise RenderedFrameReviewError(f"{label} is invalid")
    return value


def _bounded_text(value: Any, label: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise RenderedFrameReviewResponseError(f"{label} must be bounded non-empty text")
    return value.strip()


def _finite_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RenderedFrameReviewError(f"{label} must be a finite number")
    result = float(value)
    if not math.isfinite(result):
        raise RenderedFrameReviewError(f"{label} must be a finite number")
    return result


def _response_number(value: Any, label: str) -> float:
    try:
        return _finite_number(value, label)
    except RenderedFrameReviewError as error:
        raise RenderedFrameReviewResponseError(str(error)) from error


def _response_identifier(value: Any, label: str) -> str:
    try:
        return _identifier(value, label)
    except RenderedFrameReviewError as error:
        raise RenderedFrameReviewResponseError(str(error)) from error


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _numeric_usage(value: Any) -> dict[str, float]:
    if not isinstance(value, Mapping):
        return {}
    result: dict[str, float] = {}
    for key, item in value.items():
        if not isinstance(key, str) or not isinstance(item, (int, float)) or isinstance(item, bool):
            continue
        try:
            numeric = float(item)
        except OverflowError:
            continue
        if math.isfinite(numeric):
            result[key[:80]] = max(0.0, numeric)
    return result


def _closed_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise RenderedFrameReviewResponseError("VLM review contains duplicate JSON keys")
        value[key] = item
    return value
