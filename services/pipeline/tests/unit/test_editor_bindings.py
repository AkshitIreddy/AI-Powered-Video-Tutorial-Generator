from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest

from alystria.generation import (
    GenerationCoordinator,
    GenerationRequest,
    RenderedTutorial,
    SourceSpec,
)
from alystria.native_controls import _editor_caption_bindings
from alystria.project import ProjectStore
from alystria.service import PipelineService


def _request() -> GenerationRequest:
    return GenerationRequest(
        topic="Binary search invariants",
        audience="Beginning computer-science learners",
        duration_seconds=30,
        sources=(
            SourceSpec(
                "source.binary-search",
                "Binary search note",
                "Binary search preserves a target interval in sorted input.",
                "fixture:binary-search.md",
                "text/markdown",
                "CC0-1.0",
                "Fixture authors",
            ),
        ),
        deterministic_seed=23,
        presenter_mode="auto",
    )


class _VideoRenderer:
    renderer_id = "test-video-renderer"
    renderer_version = "1"

    def __init__(self, burned_captions: bool | None = False) -> None:
        self.burned_captions = burned_captions

    def render(self, request: dict[str, object]) -> RenderedTutorial:
        return RenderedTutorial(
            b"video fixture",
            "video/mp4",
            "tutorial.mp4",
            {"schemaVersion": 1, "captionDelivery": {"burnedIntoVideo": self.burned_captions}},
            {
                "deterministic": True,
                "blankFrames": 0,
                "captionCollisions": 0,
                "clippedSamples": 0,
                "integratedLufs": -16.0,
                "truePeakDbtp": -1.5,
                "alignedTokenRatio": None,
                "asrWer": None,
                "avDriftFrames": 0.0,
            },
        )


def _completed_generation(root: Path, project_id: str, burned_captions: bool | None = False) -> str:
    with ProjectStore.create(root, name="Bindings", project_id=project_id) as store:
        coordinator = GenerationCoordinator(store, renderer_client=_VideoRenderer(burned_captions))
        started = coordinator.start(_request())
        coordinator.run_pending()
        coordinator.approve(started.generation_id)
        coordinator.run_pending()
        return started.generation_id


@pytest.mark.parametrize("burned_captions", [False, True, None])
def test_editor_bindings_are_loaded_from_verified_stage_artifacts(tmp_path: Path, burned_captions: bool | None) -> None:
    root = tmp_path / "Bindings"
    project_id = str(uuid.uuid4())
    generation_id = _completed_generation(root, project_id, burned_captions)

    result = PipelineService().dispatch(
        "editor.bindings.get",
        {
            "projectId": project_id,
            "projectDirectory": str(root),
            "generationId": generation_id,
        },
    )

    assert result["projectId"] == project_id
    assert result["generationId"] == generation_id
    assert result["assets"]
    assert result["narration"]
    assert result["presenters"]
    assert result["renders"]
    assert result["captions"]
    assert all(set(cue) == {"sceneId", "id", "startTicks", "endTicks", "text"} for cue in result["captions"])
    assert all(cue["startTicks"] < cue["endTicks"] for cue in result["captions"])
    assert set(result["assets"][0]) == {"sceneId", "artifactHash", "mediaType"}
    assert set(result["narration"][0]) == {
        "sceneId",
        "artifactHash",
        "mediaType",
        "durationMs",
    }
    assert set(result["presenters"][0]) == {
        "sceneId",
        "artifactHash",
        "mediaType",
        "activeDurationTicks",
    }
    assert set(result["renders"][0]) == {
        "sceneId",
        "artifactHash",
        "mediaType",
        "sourceStartTicks",
        "durationTicks",
        "captionsBurnedIntoPixels",
    }
    assert result["renders"][0]["mediaType"] == "video/mp4"
    assert result["renders"][0]["captionsBurnedIntoPixels"] is burned_captions
    assert all(
        "path" not in item
        for name in ("assets", "narration", "presenters", "renders")
        for item in result[name]
    )


@pytest.mark.parametrize("stage", ["assets", "captions"])
def test_editor_bindings_reject_mutated_inline_job_payload(tmp_path: Path, stage: str) -> None:
    root = tmp_path / "Bindings"
    project_id = str(uuid.uuid4())
    generation_id = _completed_generation(root, project_id)
    with ProjectStore.open(root) as store:
        row = store.connection.execute(
            "SELECT job_id,result_json FROM jobs WHERE kind=? "
            "AND json_extract(parameters_json,'$.generationId')=?",
            (f"generation.{stage}", generation_id),
        ).fetchone()
        assert row is not None
        result = json.loads(row["result_json"])
        if stage == "assets":
            result["payload"]["assets"][0]["artifactHash"] = "f" * 64
        else:
            result["payload"]["byScene"] = {}
        store.connection.execute(
            "UPDATE jobs SET result_json=? WHERE job_id=?",
            (json.dumps(result), row["job_id"]),
        )

    with pytest.raises(ValueError, match="does not match its immutable artifact"):
        PipelineService().dispatch(
            "editor.bindings.get",
            {
                "projectId": project_id,
                "projectDirectory": str(root),
                "generationId": generation_id,
            },
        )


def test_caption_bindings_preserve_scene_local_alignment_and_multiline_text() -> None:
    narration = {"storyboard": {"scenes": [
        {"id": "one", "durationTicks": 720_000},
        {"id": "two", "durationTicks": 720_000},
    ]}}
    captions = {"captionsEnabled": True, "byScene": {
        "one": [{"cue_id": "a", "start_ms": 120, "end_ms": 1_000, "text": "First\nline."}],
        "two": [{"cue_id": "b", "start_ms": 80, "end_ms": 800, "text": "Second scene."}],
    }}
    result = _editor_caption_bindings(captions, narration)
    assert result == [
        {"sceneId": "one", "id": "a", "startTicks": 28_800, "endTicks": 240_000, "text": "First\nline."},
        {"sceneId": "two", "id": "b", "startTicks": 19_200, "endTicks": 192_000, "text": "Second scene."},
    ]
    assert _editor_caption_bindings({**captions, "captionsEnabled": False}, narration) == []


@pytest.mark.parametrize("bad_cue", [
    {"cue_id": "a", "start_ms": True, "end_ms": 500, "text": "Bad clock"},
    {"cue_id": "a", "start_ms": 0, "end_ms": 3_001, "text": "Outside scene"},
    {"cue_id": "a", "start_ms": 100, "end_ms": 100, "text": "Empty interval"},
])
def test_caption_bindings_reject_invalid_alignment(bad_cue: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        _editor_caption_bindings(
            {"captionsEnabled": True, "byScene": {"one": [bad_cue]}},
            {"storyboard": {"scenes": [{"id": "one", "durationTicks": 720_000}]}},
        )
