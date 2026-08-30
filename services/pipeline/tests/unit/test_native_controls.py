from __future__ import annotations

from pathlib import Path

import pytest

from alystria.generation import GenerationCoordinator, GenerationRequest, GenerationState
from alystria.generation.adapters import RenderedTutorial
from alystria.native_controls import NativeControlCoordinator, _caption_delivery_mode
from alystria.project import ProjectHistory, ProjectStore


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


def _project(tmp_path: Path) -> ProjectStore:
    return ProjectStore.create(
        tmp_path / "Native Controls",
        name="Native controls",
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
        control = NativeControlCoordinator(store)
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
    renderer = RecordingRenderer()
    with _project(tmp_path) as store:
        generation = GenerationCoordinator(store, renderer_client=renderer)
        started = generation.start(
            GenerationRequest(
                topic="Durable export",
                audience="Test learners",
                duration_seconds=30,
            )
        )
        generation.run_pending()
        generation.approve(started.generation_id, name="Approved")
        generation.run_pending()
        assert generation.status(started.generation_id).state is GenerationState.SUCCEEDED
        head = store.head_revision()
        assert head is not None

        control = NativeControlCoordinator(store, renderer=renderer)
        job = control.submit_master_export(
            {
                "baseRevisionId": head.revision_id,
                "baseJobId": started.generation_id,
                "aspect": "1:1",
                "resolution": "1080p",
                "fps": 24,
                "captionDeliveryMode": "sidecar",
                "transcript": True,
                "bibliography": True,
            }
        )
        assert job.state.value == "QUEUED"
        calls_before = len(renderer.requests)
        control.runtime.run_once(control.handlers)
        completed = control.status(job.job_id)
        assert completed.state.value == "SUCCEEDED"
        assert len(renderer.requests) == calls_before + 1
        assert "presenters" in renderer.requests[-1]
        assert renderer.requests[-1]["captionDeliveryMode"] == "sidecar"
        assert renderer.requests[-1]["captions"]["captionsEnabled"] is True
        assert Path(completed.result["path"]).is_file()
        assert len(completed.result["sidecarPaths"]) == 4
        assert all(Path(path).is_file() for path in completed.result["sidecarPaths"])
        sidecar_names = {Path(path).name for path in completed.result["sidecarPaths"]}
        assert any(name.endswith(".en-US.srt") for name in sidecar_names)
        assert any(name.endswith(".en-US.vtt") for name in sidecar_names)
        assert completed.result["captionDelivery"] == {
            "mode": "sidecar",
            "sidecars": ["vtt", "srt"],
            "burnedIntoPixels": False,
            "embeddedInContainer": False,
        }


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
