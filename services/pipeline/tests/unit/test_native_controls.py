from __future__ import annotations

import binascii
import copy
import json
import struct
import uuid
import zlib
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest

from alystria.generation import (
    GenerationCoordinator,
    GenerationRequest,
    GenerationState,
    RendererRuntimeError,
)
from alystria.generation.adapters import GeneratedMedia, RenderedTutorial
from alystria.jobs import SQLiteWorkflowRuntime
from alystria.native_controls import (
    NativeControlCoordinator,
    _caption_delivery_mode,
    _renderer_scene,
)
from alystria.project import ProjectHistory, ProjectStore
from alystria.service import PipelineService, desktop_run_one


def _candidate_png() -> bytes:
    pixels = b"".join(b"\x00" + b"\x66\x88\xaa" * 8 for _ in range(8))

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(pixels, 9))
        + chunk(b"IEND", b"")
    )


class CandidateMediaClient:
    provider_id = "comfyui-local"
    model_revision = "local/sdxl-base-1.0"

    def create_visual(self, scene: dict[str, object], *, seed: int) -> GeneratedMedia:
        del scene, seed
        return GeneratedMedia(
            _candidate_png(),
            "image/png",
            "candidate.png",
            "comfyui-local",
            "local/sdxl-base-1.0",
            {
                "rightsStatus": "verified",
                "licenseId": "CreativeML-OpenRAIL++-M",
                "sourceUri": "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0",
            },
        )

    def synthesize_narration(self, *_: object, **__: object) -> GeneratedMedia:
        raise AssertionError("candidate generation must not synthesize narration")

    def create_presenter(self, *_: object, **__: object) -> GeneratedMedia:
        raise AssertionError("candidate generation must not animate a presenter")


class RecordingRenderer:
    renderer_id = "test-renderer"
    renderer_version = "1"

    def __init__(self) -> None:
        self.requests: list[dict[str, object]] = []

    def render(self, request: dict[str, object]) -> RenderedTutorial:
        self.requests.append(request)
        return RenderedTutorial(
            content=("render:" + str(request["generationId"])).encode(),
            media_type="video/webm",
            original_name="delivery.webm",
            manifest={"schemaVersion": 1, "test": True},
            metrics={
                "deterministic": True,
                "blankFrames": 0,
                "captionCollisions": 0,
                "clippedSamples": 0,
                "integratedLufs": -16.0,
                "truePeakDbtp": -1.5,
                "alignedTokenRatio": 1.0,
                "asrWer": 0.0,
                "avDriftFrames": 0.0,
            },
        )


class CancellationAwareRenderer(RecordingRenderer):
    def __init__(self, store: ProjectStore) -> None:
        super().__init__()
        self.store = store
        self.cancel_next = True
        self.active_cancel_check: Callable[[], bool] | None = None
        self.scope_entries = 0

    @contextmanager
    def cancellation_scope(self, cancel_check: Callable[[], bool]) -> Iterator[None]:
        assert self.active_cancel_check is None
        self.active_cancel_check = cancel_check
        self.scope_entries += 1
        try:
            yield
        finally:
            self.active_cancel_check = None

    def render(self, request: dict[str, object]) -> RenderedTutorial:
        assert self.active_cancel_check is not None
        if self.cancel_next:
            self.cancel_next = False
            SQLiteWorkflowRuntime(self.store.connection).cancel(str(request["generationId"]))
            assert self.active_cancel_check()
        return super().render(request)


def _project(tmp_path: Path) -> ProjectStore:
    return ProjectStore.create(
        tmp_path / "Native Controls",
        name="Native controls",
        project_id=str(uuid.uuid4()),
        initial_snapshot={
            "id": "temporary",
            "title": "Native controls",
            "scenes": [
                {
                    "id": "scene-one",
                    "index": 1,
                    "title": "Accepted scene",
                    "kind": "definition",
                    "duration": 1,
                    "narration": "The accepted narration remains unchanged.",
                    "objective": "Explain one durable operation.",
                    "citations": 1,
                }
            ],
            "sources": [],
        },
    )


def _replace_verified_stage_payload(
    store: ProjectStore,
    generation_id: str,
    stage: str,
    payload: dict[str, object],
) -> str:
    row = store.connection.execute(
        "SELECT job_id,result_json FROM jobs WHERE project_id=? AND kind=? "
        "AND state='SUCCEEDED' AND json_extract(parameters_json,'$.generationId')=? "
        "ORDER BY completed_at DESC LIMIT 1",
        (store.manifest.project_id, f"generation.{stage}", generation_id),
    ).fetchone()
    assert row is not None
    result = json.loads(str(row["result_json"]))
    previous_hash = str(result["artifactHash"])
    previous_artifact = store.connection.execute(
        "SELECT media_type,original_name,metadata_json FROM artifacts WHERE hash=?",
        (previous_hash,),
    ).fetchone()
    assert previous_artifact is not None
    replacement = store.add_artifact_bytes(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode(),
        media_type=str(previous_artifact["media_type"]),
        original_name=previous_artifact["original_name"],
        metadata=json.loads(str(previous_artifact["metadata_json"])),
    )
    result.update({"artifactHash": replacement.hash, "payload": payload})
    with store.connection:
        store.connection.execute(
            "UPDATE revision_artifacts SET artifact_hash=? WHERE artifact_hash=? "
            "AND role=? AND stable_id=?",
            (
                replacement.hash,
                previous_hash,
                f"generation-stage:{stage}",
                generation_id,
            ),
        )
        store.connection.execute(
            "UPDATE jobs SET result_json=? WHERE job_id=?",
            (json.dumps(result, sort_keys=True, separators=(",", ":")), row["job_id"]),
        )
    return replacement.hash


def test_revision_navigation_is_append_only_and_redo_survives_reopen(tmp_path: Path) -> None:
    store = _project(tmp_path)
    try:
        initial = store.head_revision()
        assert initial is not None
        second = store.create_revision(
            snapshot={**initial.snapshot, "title": "Second"},
            expected_head=initial.revision_id,
        )
        history = ProjectHistory(store)
        history.record_new_revision(initial.revision_id, second)
        third = store.create_revision(
            snapshot={**second.snapshot, "title": "Third"},
            expected_head=second.revision_id,
        )
        history.record_new_revision(second.revision_id, third)

        undone, state = history.move("undo", expected_head=third.revision_id)
        assert undone.snapshot["title"] == "Second"
        assert state.can_redo
        count_after_undo = len(store.list_revisions())
    finally:
        root = store.root
        store.close()

    with ProjectStore.open(root) as reopened:
        history = ProjectHistory(reopened)
        assert history.state().can_redo
        redone, state = history.move(
            "redo", expected_head=history.state().head_revision_id
        )
        assert redone.snapshot["title"] == "Third"
        assert not state.can_redo
        assert len(reopened.list_revisions()) == count_after_undo + 1


def test_scoped_regeneration_returns_before_work_and_preserves_accepted_scene(
    tmp_path: Path,
) -> None:
    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None
        control = NativeControlCoordinator(store, media_client=CandidateMediaClient())
        job = control.submit_regeneration(
            {
                "baseRevisionId": head.revision_id,
                "sceneId": "scene-one",
                "instruction": "Make the diagram more concrete.",
                "preservationLocks": ["narration", "citations", "learningobjective"],
                "alternatives": 2,
            }
        )

        assert job.state.value == "QUEUED"
        assert store.head_revision().revision_id == head.revision_id
        control.runtime.run_once(control.handlers)
        completed = control.status(job.job_id)
        assert completed.state.value == "SUCCEEDED"
        assert completed.result is not None
        assert len(completed.result["candidateIds"]) == 2
        current = store.head_revision()
        assert current is not None
        assert current.snapshot["scenes"][0] == head.snapshot["scenes"][0]
        assert all(
            candidate["acceptedSceneUnchanged"]
            for candidate in current.snapshot["sceneCandidates"]
        )
        candidate_id = completed.result["candidateIds"][0]
        accepted = PipelineService().dispatch(
            "control.acceptVisualCandidate",
            {
                "projectId": store.manifest.project_id,
                "projectDirectory": str(store.root),
                "expectedHeadRevisionId": current.revision_id,
                "candidateId": candidate_id,
            },
        )
        assert accepted["candidateId"] == candidate_id
        assert accepted["artifactHash"]


def test_licensed_visual_search_is_a_bounded_durable_native_job(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None
        service = PipelineService()

        receipt = service.dispatch(
            "control.searchVisualCandidates",
            {
                "projectId": store.manifest.project_id,
                "projectDirectory": str(store.root),
                "baseRevisionId": head.revision_id,
                "sceneId": "scene-one",
                "instruction": "Find a clear photo of a sorted index card set.",
                "preservationLocks": [
                    "narration",
                    "citations",
                    "learningobjective",
                    "timing",
                    "presenter",
                ],
                "alternatives": 3,
                "providerId": "openverse",
                "searchQuery": "sorted index cards",
                "desiredAspectRatio": "16:9",
                "locale": "en-US",
            },
        )

        job = SQLiteWorkflowRuntime(store.connection).get_job(receipt["jobId"])
        assert receipt["state"] == "QUEUED"
        assert receipt["operation"] == "search_visual_candidates"
        assert job.kind == "native.search_visual_candidates"
        assert job.max_attempts == 1
        assert job.parameters["expectedHeadRevisionId"] == head.revision_id
        assert job.parameters["providerId"] == "openverse"


def test_desktop_candidate_generation_does_not_require_renderer_runtime(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None
        control = NativeControlCoordinator(store)
        job = control.submit_regeneration(
            {
                "baseRevisionId": head.revision_id,
                "sceneId": "scene-one",
                "instruction": "Show the invariant as a clear diagram.",
                "preservationLocks": ["narration", "citations", "learningobjective"],
                "alternatives": 1,
            }
        )
        monkeypatch.setattr(
            "alystria.service._production_renderer_client",
            lambda _store: (_ for _ in ()).throw(RendererRuntimeError("renderer missing")),
        )
        monkeypatch.setattr(
            "alystria.service.default_local_media_client", lambda: CandidateMediaClient()
        )

        completed = desktop_run_one(store, SQLiteWorkflowRuntime(store.connection))

        assert completed is not None and completed.job_id == job.job_id
        assert completed.state.value == "SUCCEEDED"
        assert completed.result is not None
        assert completed.result["readyCount"] == 1


def test_candidate_acceptance_invalidates_only_the_role_specific_generation_branch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    observed: list[tuple[str, str]] = []

    def record_scope(
        _coordinator: GenerationCoordinator, generation_id: str, scope: str
    ) -> tuple[str, ...]:
        observed.append((generation_id, scope))
        return (scope,)

    monkeypatch.setattr(GenerationCoordinator, "invalidate_scope", record_scope)
    with _project(tmp_path) as store:
        control = NativeControlCoordinator(store)
        locked = {"narration", "citations", "learningobjective", "timing"}

        scene_invalidated = control._invalidate_scene(
            "scene-one", "generation-one", locked, "scene-hash", role="scene"
        )
        presenter_invalidated = control._invalidate_scene(
            "scene-one", "generation-one", locked, "presenter-hash", role="presenter"
        )

    assert observed == [
        ("generation-one", "scene-asset:scene-one"),
        ("generation-one", "presenter"),
    ]
    assert scene_invalidated == ["scene-asset:scene-one"]
    assert presenter_invalidated == ["presenter"]


def test_scene_render_is_queued_then_promotes_real_renderer_bytes(tmp_path: Path) -> None:
    renderer = RecordingRenderer()
    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None
        control = NativeControlCoordinator(store, renderer=renderer)
        job = control.submit_scene_render(
            {
                "baseRevisionId": head.revision_id,
                "sceneId": "scene-one",
                "aspect": "16:9",
                "resolution": "1080p",
                "fps": 30,
            }
        )

        assert job.state.value == "QUEUED"
        assert renderer.requests == []
        control.runtime.run_once(control.handlers)
        completed = control.status(job.job_id)
        assert completed.state.value == "SUCCEEDED"
        assert completed.result is not None
        output = Path(completed.result["path"])
        assert output.read_bytes().startswith(b"render:")
        assert store.cas.verify(completed.result["artifactHash"])
        assert len(renderer.requests) == 1


def test_scene_render_cancellation_scope_prevents_promotion_and_resets(
    tmp_path: Path,
) -> None:
    with _project(tmp_path) as store:
        renderer = CancellationAwareRenderer(store)
        control = NativeControlCoordinator(store, renderer=renderer)
        head = store.head_revision()
        assert head is not None
        cancelled_job = control.submit_scene_render(
            {
                "baseRevisionId": head.revision_id,
                "sceneId": "scene-one",
                "aspect": "16:9",
                "resolution": "1080p",
                "fps": 30,
            }
        )

        control.runtime.run_once(control.handlers)

        cancelled = control.status(cancelled_job.job_id)
        assert cancelled.state.value == "CANCELLED"
        assert cancelled.result is None
        assert store.connection.execute(
            "SELECT COUNT(*) FROM artifacts WHERE media_type LIKE 'video/%'"
        ).fetchone()[0] == 0
        assert not list((store.root / "exports" / "previews").glob("*"))
        assert renderer.active_cancel_check is None

        completed_job = control.submit_scene_render(
            {
                "baseRevisionId": head.revision_id,
                "sceneId": "scene-one",
                "aspect": "16:9",
                "resolution": "1080p",
                "fps": 24,
            }
        )
        control.runtime.run_once(control.handlers)

        completed = control.status(completed_job.job_id)
        assert completed.state.value == "SUCCEEDED"
        assert completed.result is not None
        assert Path(completed.result["path"]).is_file()
        assert renderer.scope_entries == 2
        assert renderer.active_cancel_check is None


def test_scene_render_fails_closed_without_pinned_runtime(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None
        control = NativeControlCoordinator(store)
        job = control.submit_scene_render(
            {
                "baseRevisionId": head.revision_id,
                "sceneId": "scene-one",
                "aspect": "16:9",
                "resolution": "1080p",
                "fps": 30,
            }
        )
        control.runtime.run_once(control.handlers)
        failed = control.status(job.job_id)
        assert failed.state.value == "FAILED"
        assert "Pinned renderer runtime is unavailable" in failed.error["message"]


def test_renderer_scene_preserves_authoritative_storyboard_ticks() -> None:
    scene = _renderer_scene(
        {
            "id": "timed-scene",
            "type": "worked_example",
            "title": "Measured explanation",
            "narration": "The rendered preview must keep the measured narration duration.",
            "durationTicks": 2_913_600,
            "duration": 1,
        }
    )

    assert scene["type"] == "worked-example"
    assert scene["durationTicks"] == 2_913_600


@pytest.mark.parametrize("duration_ticks", [True, 0, -1, 1.5, 2**53])
def test_renderer_scene_rejects_invalid_authoritative_ticks(duration_ticks: object) -> None:
    with pytest.raises(ValueError, match="durationTicks"):
        _renderer_scene(
            {
                "id": "invalid-timing",
                "title": "Invalid timing",
                "narration": "This preview should fail closed.",
                "durationTicks": duration_ticks,
            }
        )


def test_selected_qa_repair_and_master_export_use_completed_generation(
    tmp_path: Path,
) -> None:
    renderer = RecordingRenderer()
    with _project(tmp_path) as store:
        generation = GenerationCoordinator(store, renderer_client=renderer)
        request = GenerationRequest(
            topic="Durable controls",
            audience="Test learners",
            duration_seconds=30,
            repairable_faults=3,
            metadata={"testOnlyInjectQaFaults": True},
        )
        started = generation.start(request)
        generation.run_pending()
        waiting = generation.status(started.generation_id)
        assert waiting.state is GenerationState.WAITING_APPROVAL
        generation.approve(started.generation_id, name="Approved")
        generation.run_pending()
        assert generation.status(started.generation_id).state is GenerationState.FAILED

        head = store.head_revision()
        assert head is not None
        repairs = NativeControlCoordinator(store, renderer=renderer)
        repair_job = repairs.submit_qa_repair(
            {
                "baseRevisionId": head.revision_id,
                "baseJobId": started.generation_id,
                "findingIds": ["generation.test_fixture_repairable"],
            }
        )
        assert repair_job.state.value == "QUEUED"
        repairs.runtime.run_once(repairs.handlers)
        repaired = repairs.status(repair_job.job_id)
        assert repaired.state.value == "SUCCEEDED"
        assert repaired.result["findingIds"] == ["generation.test_fixture_repairable"]

        with pytest.raises(ValueError, match="completed, approved generation"):
            repairs.submit_master_export(
                {
                    "baseRevisionId": repaired.result["headRevisionId"],
                    "baseJobId": started.generation_id,
                    "aspect": "16:9",
                    "resolution": "1080p",
                    "fps": 30,
                }
            )


def test_master_export_is_queued_and_materializes_requested_sidecars(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        renderer = CancellationAwareRenderer(store)
        renderer.cancel_next = False
        generation = GenerationCoordinator(store, renderer_client=renderer)
        started = generation.start(
            GenerationRequest(
                topic="Durable export",
                audience="Test learners",
                duration_seconds=30,
                deterministic_seed=73,
            )
        )
        generation.run_pending()
        generation.approve(started.generation_id, name="Approved")
        generation.run_pending()
        assert generation.status(started.generation_id).state is GenerationState.SUCCEEDED
        head = store.head_revision()
        assert head is not None

        control = NativeControlCoordinator(store, renderer=renderer)
        approved_render_request = copy.deepcopy(renderer.requests[-1])
        render_payload, render_stage_hash = control._verified_stage_payload(
            started.generation_id, "render"
        )
        narration_payload, previous_narration_stage_hash = control._verified_stage_payload(
            started.generation_id, "narration"
        )
        corrected_narration = copy.deepcopy(narration_payload)
        first_word = corrected_narration["narration"][0]["words"][0]
        assert first_word["start_ms"] + 1 < first_word["end_ms"]
        first_word["start_ms"] += 1
        narration_stage_hash = _replace_verified_stage_payload(
            store, started.generation_id, "narration", corrected_narration
        )
        assert narration_stage_hash != previous_narration_stage_hash
        planned_scenes = control._stage_payload(started.generation_id, "storyboard")["storyboard"]["scenes"]
        assert planned_scenes != approved_render_request["scenes"]
        exported = control._stage_payload(started.generation_id, "export")
        assert exported["storyboard"]["scenes"] == approved_render_request["scenes"]
        assert [
            {"sceneId": chapter["sceneIds"][0], "startTicks": chapter["startTicks"], "endTicks": chapter["endTicks"]}
            for chapter in exported["exportManifest"]["chapters"]
        ] == render_payload["candidate"]["renderSceneWindows"]
        job = control.submit_master_export(
            {
                "baseRevisionId": head.revision_id,
                "baseJobId": started.generation_id,
                "aspect": "1:1",
                "resolution": "1080p",
                "fps": 24,
                "codecPreference": "av1",
                "captionDeliveryMode": "sidecar",
                "transcript": True,
                "bibliography": True,
            }
        )
        assert job.state.value == "QUEUED"
        calls_before = len(renderer.requests)
        scopes_before = renderer.scope_entries
        control.runtime.run_once(control.handlers)
        completed = control.status(job.job_id)
        assert completed.state.value == "SUCCEEDED"
        assert len(renderer.requests) == calls_before + 1
        assert renderer.scope_entries == scopes_before + 1
        assert renderer.active_cancel_check is None
        for key in (
            "scenes", "seed", "visualBible", "assets", "narration",
            "presenters", "audioCustomization", "visualCustomization", "fontCustomization",
            "customization",
        ):
            assert renderer.requests[-1][key] == approved_render_request[key]
        assert renderer.requests[-1]["captions"] != approved_render_request["captions"]
        assert renderer.requests[-1]["seed"] == 73
        assert render_payload["renderRequest"] == approved_render_request
        assert completed.result["generationId"] == started.generation_id
        assert completed.result["approvalRevisionId"] == generation.status(started.generation_id).approval_revision_id
        assert completed.result["sourceRenderStageArtifactHash"] == render_stage_hash
        assert completed.result["sourceNarrationStageArtifactHash"] == narration_stage_hash
        assert completed.result["renderSceneWindows"] == render_payload["candidate"]["renderSceneWindows"]
        assert "presenters" in renderer.requests[-1]
        assert renderer.requests[-1]["captionDeliveryMode"] == "sidecar"
        assert renderer.requests[-1]["codec"] == "av1"
        assert renderer.requests[-1]["captions"]["captionsEnabled"] is True
        caption_bundle_hash = completed.result["captionBundleArtifactHash"]
        caption_bundle = json.loads(store.cas.object_path(caption_bundle_hash).read_bytes())
        assert caption_bundle["sourceNarrationStageArtifactHash"] == narration_stage_hash
        assert caption_bundle["captions"] == renderer.requests[-1]["captions"]
        assert caption_bundle["captions"]["compilerVersion"] == completed.result["captionCompilerVersion"]
        video_metadata_row = store.connection.execute(
            "SELECT metadata_json FROM artifacts WHERE hash=?",
            (completed.result["artifactHash"],),
        ).fetchone()
        assert video_metadata_row is not None
        video_metadata = json.loads(str(video_metadata_row["metadata_json"]))
        assert video_metadata["captionBundleArtifactHash"] == caption_bundle_hash
        assert video_metadata["sourceNarrationStageArtifactHash"] == narration_stage_hash
        assert Path(completed.result["path"]).is_file()
        assert len(completed.result["sidecarPaths"]) == 4
        assert all(Path(path).is_file() for path in completed.result["sidecarPaths"])
        sidecar_names = {Path(path).name for path in completed.result["sidecarPaths"]}
        assert any(name.endswith(".en-US.srt") for name in sidecar_names)
        assert any(name.endswith(".en-US.vtt") for name in sidecar_names)
        for field, suffix in (
            ("vttArtifactHash", ".en-US.vtt"),
            ("srtArtifactHash", ".en-US.srt"),
            ("transcriptArtifactHash", ".en-US.transcript.txt"),
        ):
            copied = next(
                Path(path) for path in completed.result["sidecarPaths"] if path.endswith(suffix)
            )
            assert copied.read_bytes() == store.cas.object_path(
                caption_bundle["captions"][field]
            ).read_bytes()
        assert completed.result["captionDelivery"] == {
            "mode": "sidecar",
            "sidecars": ["vtt", "srt"],
            "burnedIntoPixels": False,
            "embeddedInContainer": False,
        }
        assert completed.result["codecPreference"] == "av1"
        assert completed.result["rendererCodec"] == "av1"


def test_master_render_cancellation_scope_prevents_video_and_export_promotion(
    tmp_path: Path,
) -> None:
    with _project(tmp_path) as store:
        generation_renderer = RecordingRenderer()
        generation = GenerationCoordinator(store, renderer_client=generation_renderer)
        started = generation.start(
            GenerationRequest(
                topic="Cancelable durable export",
                audience="Test learners",
                duration_seconds=30,
                deterministic_seed=91,
            )
        )
        generation.run_pending()
        generation.approve(started.generation_id, name="Approved")
        generation.run_pending()
        assert generation.status(started.generation_id).state is GenerationState.SUCCEEDED
        head = store.head_revision()
        assert head is not None
        renderer = CancellationAwareRenderer(store)
        control = NativeControlCoordinator(store, renderer=renderer)
        videos_before = store.connection.execute(
            "SELECT COUNT(*) FROM artifacts WHERE media_type LIKE 'video/%'"
        ).fetchone()[0]
        exports_before = set((store.root / "exports").glob("*"))
        cancelled_job = control.submit_master_export(
            {
                "baseRevisionId": head.revision_id,
                "baseJobId": started.generation_id,
                "aspect": "16:9",
                "resolution": "1080p",
                "fps": 30,
                "captionDeliveryMode": "sidecar",
                "transcript": False,
                "bibliography": False,
            }
        )

        control.runtime.run_once(control.handlers)

        cancelled = control.status(cancelled_job.job_id)
        assert cancelled.state.value == "CANCELLED"
        assert cancelled.result is None
        assert store.connection.execute(
            "SELECT COUNT(*) FROM artifacts WHERE media_type LIKE 'video/%'"
        ).fetchone()[0] == videos_before
        assert set((store.root / "exports").glob("*")) == exports_before
        assert renderer.scope_entries == 1
        assert renderer.active_cancel_check is None

        completed_job = control.submit_master_export(
            {
                "baseRevisionId": head.revision_id,
                "baseJobId": started.generation_id,
                "aspect": "16:9",
                "resolution": "1080p",
                "fps": 25,
                "captionDeliveryMode": "sidecar",
                "transcript": False,
                "bibliography": False,
            }
        )
        control.runtime.run_once(control.handlers)

        completed = control.status(completed_job.job_id)
        assert completed.state.value == "SUCCEEDED"
        assert completed.result is not None
        assert Path(completed.result["path"]).is_file()
        assert renderer.scope_entries == 2
        assert renderer.active_cancel_check is None


@pytest.mark.parametrize(
    ("preference", "renderer_codec"),
    [
        ("h264-hardware", "h264_nvenc"),
        ("hevc-hardware", "hevc_nvenc"),
        ("av1", "av1"),
    ],
)
def test_master_codec_preference_maps_to_closed_renderer_codec(
    preference: str,
    renderer_codec: str,
) -> None:
    from alystria.native_controls import _codec_preference

    assert _codec_preference({"codecPreference": preference}) == (preference, renderer_codec)


def test_master_codec_preference_rejects_unknown_values() -> None:
    from alystria.native_controls import _codec_preference

    with pytest.raises(ValueError, match="codecPreference"):
        _codec_preference({"codecPreference": "automatic"})


@pytest.mark.parametrize("value", ["sidecar", "embedded", "burned", "both"])
def test_caption_delivery_mode_accepts_exact_contract(value: str) -> None:
    assert _caption_delivery_mode({"captionDeliveryMode": value}) == value


@pytest.mark.parametrize("legacy_value", [True, False])
def test_caption_delivery_mode_migrates_legacy_boolean_to_clean_sidecars(
    legacy_value: bool,
) -> None:
    assert _caption_delivery_mode({"captions": legacy_value}) == "sidecar"


def test_caption_delivery_mode_rejects_unknown_values() -> None:
    with pytest.raises(ValueError, match="captionDeliveryMode"):
        _caption_delivery_mode({"captionDeliveryMode": "burned-in"})
