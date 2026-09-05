from __future__ import annotations

import base64
import hashlib
import io
import json
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

from alystria.project import ProjectStore
from alystria.providers.errors import FailureCode, ProviderFailure
from alystria.providers.policy import (
    BudgetApproval,
    CapabilityRoute,
    ProviderApproval,
    TutorialRoutingPolicy,
)
from alystria.providers.types import (
    Capability,
    DataBoundary,
    ProviderResult,
    RetentionMode,
    TextOutput,
    Usage,
    VisionLanguageRequest,
)
from alystria.rendered_frame_review import (
    MAX_CONTACT_SHEET_BYTES,
    RenderedFrameReviewError,
    RenderedFrameReviewRequest,
    SceneWindow,
    critical_review_findings,
    review_rendered_frames,
)
from alystria.security.privacy import DataClassification, PrivacyMode


class Context:
    task_key = "generation-final-qa"

    def __init__(self) -> None:
        self.checkpoints: dict[str, dict[str, Any]] = {}
        self.cancel_checks = 0

    def check_cancelled(self) -> None:
        self.cancel_checks += 1

    def provider_acceptance(self, idempotency_key: str) -> dict[str, Any] | None:
        return self.checkpoints.get(idempotency_key)

    def record_provider_acceptance(self, **values: Any) -> dict[str, Any]:
        checkpoint = {**values, "result": values["result"]}
        self.checkpoints[str(values["idempotency_key"])] = checkpoint
        return checkpoint


class FakeExtractor:
    def __init__(self, duration: float = 60.0) -> None:
        self.duration = duration
        self.probes = 0
        self.timestamps: list[float] = []

    def probe_duration(self, video_path: Path, ffprobe_path: Path) -> float:
        assert video_path.is_file()
        assert ffprobe_path.is_file()
        self.probes += 1
        return self.duration

    def extract_frame(
        self, video_path: Path, timestamp_seconds: float, output_path: Path, ffmpeg_path: Path
    ) -> None:
        assert video_path.is_file()
        assert ffmpeg_path.is_file()
        self.timestamps.append(timestamp_seconds)
        color = (int(timestamp_seconds * 3) % 255, 76, 132)
        image = Image.new("RGB", (480, 270), color)
        image.save(output_path, format="JPEG", quality=88)


class VisionRuntime:
    def __init__(self, response: str, *, classification: DataClassification) -> None:
        self.policy = _policy(classification)
        self.response = response
        self.calls: list[tuple[VisionLanguageRequest, str]] = []

    def invoke(
        self, request: VisionLanguageRequest, *, idempotency_key: str
    ) -> ProviderResult[Any]:
        self.calls.append((request, idempotency_key))
        return ProviderResult(
            "vision-provider",
            request.model,
            TextOutput(self.response),
            Usage(
                "vision-provider",
                request.model,
                {"input_images": 1.0, "output_tokens": 96.0},
                17,
                request_id="request-one",
            ),
            "request-one",
        )


class FailingVisionRuntime(VisionRuntime):
    def invoke(
        self, request: VisionLanguageRequest, *, idempotency_key: str
    ) -> ProviderResult[Any]:
        self.calls.append((request, idempotency_key))
        raise ProviderFailure(
            FailureCode.RATE_LIMITED,
            "Sanitized provider failure",
            provider_id="vision-provider",
            retryable=True,
            http_status=429,
            request_id="request-rate-limited",
        )


def _policy(classification: DataClassification) -> TutorialRoutingPolicy:
    return TutorialRoutingPolicy(
        version=1,
        privacy_mode=PrivacyMode.HYBRID,
        data_classification=classification,
        budget=BudgetApproval("USD", 1_000, True, True),
        approvals=(
            ProviderApproval(
                "vision-provider",
                (Capability.VISION_LANGUAGE,),
                None,
                DataBoundary.CLOUD,
                RetentionMode.ZERO_DATA_RETENTION,
                ("us",),
                (classification,),
                True,
                True,
                True,
                True,
            ),
        ),
        routes=(
            CapabilityRoute(
                Capability.VISION_LANGUAGE,
                ("vision-provider",),
                "vision-model-v1",
            ),
        ),
    )


def _project(tmp_path: Path, *, linked: bool = True) -> tuple[ProjectStore, str]:
    store = ProjectStore.create(
        tmp_path / "rendered-review",
        name="Rendered review",
        initial_snapshot={"scenes": []},
    )
    video = store.add_artifact_bytes(
        b"promoted-video-container",
        media_type="video/mp4",
        original_name="master.mp4",
        metadata={"rightsStatus": "owned"},
    )
    stage = store.add_artifact_bytes(
        b'{"stage":"render"}\n',
        media_type="application/vnd.alystria.generation-stage+json",
        original_name="render.json",
        metadata={"generationId": "generation-one", "stage": "render"},
    )
    head = store.head_revision()
    assert head is not None
    links = [
        {
            "artifactHash": stage.hash,
            "role": "generation-stage:render",
            "stableId": "generation-one",
        }
    ]
    if linked:
        links.append(
            {
                "artifactHash": video.hash,
                "role": "render-output",
                "stableId": "master",
            }
        )
    store.create_revision(
        snapshot={"generationId": "generation-one", "stage": "render"},
        kind="generation",
        message="Promoted actual render",
        expected_head=head.revision_id,
        artifact_links=links,
    )
    return store, video.hash


def _request(video_hash: str) -> RenderedFrameReviewRequest:
    return RenderedFrameReviewRequest(
        generation_id="generation-one",
        render_artifact_hash=video_hash,
        render_media_type="video/mp4",
        expected_duration_seconds=60.0,
        scenes=(
            SceneWindow("scene-one", 0.0, 30.0),
            SceneWindow("scene-two", 30.0, 60.0),
        ),
    )


def _tools(tmp_path: Path) -> tuple[Path, Path]:
    ffmpeg = tmp_path / "ffmpeg.exe"
    ffprobe = tmp_path / "ffprobe.exe"
    ffmpeg.write_bytes(b"pinned ffmpeg")
    ffprobe.write_bytes(b"pinned ffprobe")
    return ffmpeg, ffprobe


def test_missing_route_is_durable_not_reviewed_without_decoding_or_provider_call(
    tmp_path: Path,
) -> None:
    store, video_hash = _project(tmp_path)
    try:
        context = Context()
        result = review_rendered_frames(
            store,
            _request(video_hash),
            context,
            runtime=None,
            ffmpeg_path=None,
            ffprobe_path=None,
        )

        assert result.status == "not_reviewed"
        assert result.reason == "no_explicit_vlm_route"
        assert result.sampled_frames == ()
        assert result.critical_finding_count == 0
        assert context.cancel_checks == 0
        assert store.cas.verify(result.report_artifact_hash)
        with store.cas.open(result.report_artifact_hash) as stream:
            report = json.load(stream)
        assert report["status"] == "not_reviewed"
        assert report["findings"] == []
        assert "passed" not in report
        assert "all-frame" not in json.dumps(report).casefold()
    finally:
        store.close()


def test_public_approved_route_reviews_six_real_samples_in_one_inline_jpeg_request(
    tmp_path: Path,
) -> None:
    store, video_hash = _project(tmp_path)
    ffmpeg, ffprobe = _tools(tmp_path)
    response = json.dumps(
        {
            "findings": [
                {
                    "sceneId": "scene-one",
                    "timestampSeconds": 5.0,
                    "severity": "CRITICAL",
                    "rationale": "The sampled frame is fully blank and needs human review.",
                },
                {
                    "sceneId": "scene-two",
                    "timestampSeconds": 45.0,
                    "severity": "MINOR",
                    "rationale": "The visual has limited contrast in this sampled frame.",
                },
            ]
        }
    )
    runtime = VisionRuntime(response, classification=DataClassification.PUBLIC)
    extractor = FakeExtractor()
    context = Context()
    try:
        result = review_rendered_frames(
            store,
            _request(video_hash),
            context,
            runtime=runtime,
            ffmpeg_path=ffmpeg,
            ffprobe_path=ffprobe,
            extractor=extractor,
        )

        assert result.status == "reviewed"
        assert result.reason is None
        assert result.critical_finding_count == 1
        assert extractor.timestamps == [5.0, 15.0, 25.0, 35.0, 45.0, 55.0]
        assert len(result.sampled_frames) == 6
        assert all(store.cas.verify(item.artifact_hash) for item in result.sampled_frames)
        assert len(runtime.calls) == 1
        request, idempotency_key = runtime.calls[0]
        assert len(idempotency_key) == 64
        assert len(request.images) == 1
        assert request.images[0].uri is None
        contact_sheet = base64.b64decode(request.images[0].data_base64 or "", validate=True)
        assert 0 < len(contact_sheet) <= MAX_CONTACT_SHEET_BYTES
        with Image.open(io.BytesIO(contact_sheet)) as image:
            assert image.format == "JPEG"
        assert result.contact_sheet_artifact_hash == hashlib.sha256(contact_sheet).hexdigest()
        assert store.cas.verify(result.contact_sheet_artifact_hash)
        with store.cas.open(result.report_artifact_hash) as stream:
            report = json.load(stream)
        assert report["sampleCoverage"] == {
            "allFramesReviewed": False,
            "durationSeconds": 60.0,
            "firstTimestampSeconds": 5.0,
            "largestUnsampledGapSeconds": 10.0,
            "lastTimestampSeconds": 55.0,
            "sampleCount": 6,
            "sceneIdsRepresented": ["scene-one", "scene-two"],
        }
        assert any("not every frame" in item for item in report["limitations"])
        assert any("mathematics" in item for item in report["limitations"])
        blocking = critical_review_findings(result)
        assert len(blocking) == 1
        assert blocking[0].metadata["requiresHumanReview"] is True
        assert blocking[0].repairable is True
        assert blocking[0].evidence == result.report_artifact_hash

        first_revision = result.revision_id
        recovered = review_rendered_frames(
            store,
            _request(video_hash),
            context,
            runtime=runtime,
            ffmpeg_path=ffmpeg,
            ffprobe_path=ffprobe,
            extractor=extractor,
        )
        assert recovered.report_artifact_hash == result.report_artifact_hash
        assert recovered.revision_id == first_revision
        assert len(runtime.calls) == 1
        assert extractor.probes == 1
    finally:
        store.close()


def test_non_public_project_never_extracts_or_invokes_vlm(tmp_path: Path) -> None:
    store, video_hash = _project(tmp_path)
    ffmpeg, ffprobe = _tools(tmp_path)
    runtime = VisionRuntime('{"findings":[]}', classification=DataClassification.PROJECT)
    extractor = FakeExtractor()
    try:
        result = review_rendered_frames(
            store,
            _request(video_hash),
            Context(),
            runtime=runtime,
            ffmpeg_path=ffmpeg,
            ffprobe_path=ffprobe,
            extractor=extractor,
        )
        assert result.status == "not_reviewed"
        assert result.reason == "vlm_review_requires_public_project"
        assert runtime.calls == []
        assert extractor.probes == 0
    finally:
        store.close()


def test_provider_failure_is_persisted_as_sanitized_diagnostic_without_retry(
    tmp_path: Path,
) -> None:
    store, video_hash = _project(tmp_path)
    ffmpeg, ffprobe = _tools(tmp_path)
    runtime = FailingVisionRuntime("", classification=DataClassification.PUBLIC)
    try:
        result = review_rendered_frames(
            store,
            _request(video_hash),
            Context(),
            runtime=runtime,
            ffmpeg_path=ffmpeg,
            ffprobe_path=ffprobe,
            extractor=FakeExtractor(),
        )

        assert result.status == "not_reviewed"
        assert result.reason == "provider_unavailable"
        assert len(runtime.calls) == 1
        with store.cas.open(result.report_artifact_hash) as stream:
            report = json.load(stream)
        assert report["providerInvocationAttempted"] is True
        assert report["providerFailure"] == {
            "code": "RATE_LIMITED",
            "httpStatus": 429,
            "providerId": "vision-provider",
            "requestId": "request-rate-limited",
            "retryable": True,
        }
        assert "message" not in report["providerFailure"]
        assert "details" not in report["providerFailure"]
    finally:
        store.close()


@pytest.mark.parametrize(
    "response",
    [
        '{"findings":[{"sceneId":"scene-one","timestampSeconds":5.0,"severity":"CRITICAL","rationale":"Blank","extra":true}]}',
        '{"findings":[{"sceneId":"scene-one","timestampSeconds":7.0,"severity":"CRITICAL","rationale":"Unlisted time"}]}',
        '{"findings":[{"sceneId":"scene-one","timestampSeconds":5.0,"severity":"definite","rationale":"Bad enum"}]}',
        '{"findings":[{"sceneId":"../scene","timestampSeconds":5.0,"severity":"MAJOR","rationale":"Bad scene ID"}]}',
        "not json",
    ],
)
def test_malformed_or_unbound_vlm_findings_are_not_reviewed(
    tmp_path: Path, response: str
) -> None:
    store, video_hash = _project(tmp_path)
    ffmpeg, ffprobe = _tools(tmp_path)
    runtime = VisionRuntime(response, classification=DataClassification.PUBLIC)
    try:
        result = review_rendered_frames(
            store,
            _request(video_hash),
            Context(),
            runtime=runtime,
            ffmpeg_path=ffmpeg,
            ffprobe_path=ffprobe,
            extractor=FakeExtractor(),
        )
        assert result.status == "not_reviewed"
        assert result.reason == "invalid_provider_response"
        assert result.findings == ()
        assert len(runtime.calls) == 1
        assert result.contact_sheet_artifact_hash is not None
    finally:
        store.close()


def test_unlinked_video_is_rejected_before_optional_review(tmp_path: Path) -> None:
    store, video_hash = _project(tmp_path, linked=False)
    try:
        with pytest.raises(RenderedFrameReviewError, match="not linked"):
            review_rendered_frames(
                store,
                _request(video_hash),
                Context(),
                runtime=None,
                ffmpeg_path=None,
                ffprobe_path=None,
            )
    finally:
        store.close()


def test_scene_timeline_must_match_the_render_duration(tmp_path: Path) -> None:
    store, video_hash = _project(tmp_path)
    bad = RenderedFrameReviewRequest(
        generation_id="generation-one",
        render_artifact_hash=video_hash,
        render_media_type="video/mp4",
        expected_duration_seconds=60.0,
        scenes=(SceneWindow("scene-one", 0.0, 20.0),),
    )
    try:
        with pytest.raises(RenderedFrameReviewError, match="does not match"):
            review_rendered_frames(
                store,
                bad,
                Context(),
                runtime=None,
                ffmpeg_path=None,
                ffprobe_path=None,
            )
    finally:
        store.close()
