from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import pytest

from alystria.generation import (
    GenerationCoordinator,
    GenerationRequest,
    GenerationState,
    RenderedTutorial,
)
from alystria.native_controls import NativeControlCoordinator
from alystria.project import ProjectStore


class VersionedVideoRenderer:
    renderer_id = "test-video-renderer"
    renderer_version = "1"

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []

    def render(self, request: dict[str, Any]) -> RenderedTutorial:
        self.requests.append(request)
        version = len(self.requests)
        return RenderedTutorial(
            content=f"verified-video-{version}:{request['generationId']}".encode(),
            media_type="video/mp4",
            original_name=f"verified-video-{version}.mp4",
            manifest={
                "schemaVersion": 1,
                "captionDelivery": {
                    "burnedIntoVideo": request.get("captionDeliveryMode")
                    in {"burned", "both"}
                },
            },
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


def _completed_generation(
    tmp_path: Path,
) -> tuple[ProjectStore, NativeControlCoordinator, str, str]:
    store = ProjectStore.create(tmp_path / "Promoted Master", name="Promoted master")
    renderer = VersionedVideoRenderer()
    generation = GenerationCoordinator(store, renderer_client=renderer)
    started = generation.start(
        GenerationRequest(
            topic="Binary search invariants",
            audience="Beginning computer-science learners",
            duration_seconds=30,
            presenter_mode="off",
            deterministic_seed=17,
        )
    )
    generation.run_pending()
    generation.approve(started.generation_id, name="Approved")
    generation.run_pending()
    status = generation.status(started.generation_id)
    assert status.state is GenerationState.SUCCEEDED
    assert status.approval_revision_id is not None
    return (
        store,
        NativeControlCoordinator(store, renderer=renderer),
        started.generation_id,
        status.approval_revision_id,
    )


def _export_master(
    control: NativeControlCoordinator,
    generation_id: str,
    *,
    fps: int,
) -> dict[str, Any]:
    head = control.store.head_revision()
    assert head is not None
    queued = control.submit_master_export(
        {
            "baseRevisionId": head.revision_id,
            "baseJobId": generation_id,
            "aspect": "16:9",
            "resolution": "1080p",
            "fps": fps,
            "captionDeliveryMode": "burned",
            "transcript": False,
            "bibliography": False,
        }
    )
    control.runtime.run_once(control.handlers)
    completed = control.status(queued.job_id)
    assert completed.state.value == "SUCCEEDED"
    assert completed.result is not None
    return {"jobId": completed.job_id, **completed.result}


def _clone_succeeded_job(
    store: ProjectStore,
    source_job_id: str,
    *,
    parameter_updates: dict[str, Any],
    result_updates: dict[str, Any],
    completed_at: str,
) -> None:
    row = store.connection.execute(
        "SELECT * FROM jobs WHERE job_id=?", (source_job_id,)
    ).fetchone()
    assert row is not None
    values = dict(row)
    parameters = json.loads(str(values["parameters_json"]))
    result = json.loads(str(values["result_json"]))
    parameters.update(parameter_updates)
    result.update(result_updates)
    values.update(
        {
            "job_id": str(uuid.uuid4()),
            "task_key": f"test-promoted-master-{uuid.uuid4()}",
            "parameters_json": json.dumps(parameters),
            "result_json": json.dumps(result),
            "created_at": completed_at,
            "updated_at": completed_at,
            "started_at": completed_at,
            "completed_at": completed_at,
        }
    )
    columns = tuple(values)
    placeholders = ",".join("?" for _ in columns)
    with store.connection:
        store.connection.execute(
            f"INSERT INTO jobs ({','.join(columns)}) VALUES ({placeholders})",
            tuple(values[column] for column in columns),
        )


def test_editor_prefers_latest_verified_master_and_uses_its_scene_windows(
    tmp_path: Path,
) -> None:
    store, control, generation_id, _ = _completed_generation(tmp_path)
    try:
        first = _export_master(control, generation_id, fps=24)
        latest = _export_master(control, generation_id, fps=30)

        bindings = control.editor_bindings(generation_id)

        assert bindings["renders"]
        assert {
            item["artifactHash"] for item in bindings["renders"]
        } == {latest["artifactHash"]}
        assert latest["artifactHash"] != first["artifactHash"]
        assert [
            {
                "sceneId": item["sceneId"],
                "startTicks": item["sourceStartTicks"],
                "endTicks": item["sourceStartTicks"] + item["durationTicks"],
            }
            for item in bindings["renders"]
        ] == latest["renderSceneWindows"]
        assert all(item["captionsBurnedIntoPixels"] is True for item in bindings["renders"])
    finally:
        store.close()


def test_editor_uses_verified_generation_render_when_no_promoted_master_exists(
    tmp_path: Path,
) -> None:
    store, control, generation_id, _ = _completed_generation(tmp_path)
    try:
        render, _ = control._verified_stage_payload(generation_id, "render")
        expected_hash = render["candidate"]["renderArtifactHash"]

        bindings = control.editor_bindings(generation_id)

        assert bindings["renders"]
        assert {
            item["artifactHash"] for item in bindings["renders"]
        } == {expected_hash}
    finally:
        store.close()


def test_editor_excludes_newer_stale_approval_and_other_generation_masters(
    tmp_path: Path,
) -> None:
    store, control, generation_id, _ = _completed_generation(tmp_path)
    try:
        eligible = _export_master(control, generation_id, fps=24)
        _clone_succeeded_job(
            store,
            str(eligible["jobId"]),
            parameter_updates={},
            result_updates={"approvalRevisionId": str(uuid.uuid4())},
            completed_at="9998-01-01T00:00:00+00:00",
        )
        other_generation = str(uuid.uuid4())
        _clone_succeeded_job(
            store,
            str(eligible["jobId"]),
            parameter_updates={"baseGenerationId": other_generation},
            result_updates={"generationId": other_generation},
            completed_at="9999-01-01T00:00:00+00:00",
        )

        bindings = control.editor_bindings(generation_id)

        assert bindings["renders"]
        assert {
            item["artifactHash"] for item in bindings["renders"]
        } == {eligible["artifactHash"]}
    finally:
        store.close()


def test_editor_fails_closed_when_latest_eligible_master_is_corrupt(tmp_path: Path) -> None:
    store, control, generation_id, _ = _completed_generation(tmp_path)
    try:
        promoted = _export_master(control, generation_id, fps=24)
        store.cas.object_path(str(promoted["artifactHash"])).write_bytes(b"corrupt")

        with pytest.raises(ValueError, match="promoted master artifact is missing or corrupt"):
            control.editor_bindings(generation_id)
    finally:
        store.close()
