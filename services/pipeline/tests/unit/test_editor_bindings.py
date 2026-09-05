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

    def render(self, request: dict[str, object]) -> RenderedTutorial:
        return RenderedTutorial(
            b"video fixture",
            "video/mp4",
            "tutorial.mp4",
            {"schemaVersion": 1},
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


def _completed_generation(root: Path, project_id: str) -> str:
    with ProjectStore.create(root, name="Bindings", project_id=project_id) as store:
        coordinator = GenerationCoordinator(store, renderer_client=_VideoRenderer())
        started = coordinator.start(_request())
        coordinator.run_pending()
        coordinator.approve(started.generation_id)
        coordinator.run_pending()
        return started.generation_id


def test_editor_bindings_are_loaded_from_verified_stage_artifacts(tmp_path: Path) -> None:
    root = tmp_path / "Bindings"
    project_id = str(uuid.uuid4())
    generation_id = _completed_generation(root, project_id)

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
    }
    assert result["renders"][0]["mediaType"] == "video/mp4"
    assert all(
        "path" not in item
        for name in ("assets", "narration", "presenters", "renders")
        for item in result[name]
    )


def test_editor_bindings_reject_mutated_inline_job_payload(tmp_path: Path) -> None:
    root = tmp_path / "Bindings"
    project_id = str(uuid.uuid4())
    generation_id = _completed_generation(root, project_id)
    with ProjectStore.open(root) as store:
        row = store.connection.execute(
            "SELECT job_id,result_json FROM jobs WHERE kind='generation.assets' "
            "AND json_extract(parameters_json,'$.generationId')=?",
            (generation_id,),
        ).fetchone()
        assert row is not None
        result = json.loads(row["result_json"])
        result["payload"]["assets"][0]["artifactHash"] = "f" * 64
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
