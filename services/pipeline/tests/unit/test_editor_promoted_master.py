from __future__ import annotations

import copy
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
from alystria.native_controls import NativeControlCoordinator, _editor_caption_bindings
from alystria.project import ProjectStore


class VersionedVideoRenderer:
    renderer_id = "test-video-renderer"
    renderer_version = "1"

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.renderer_build_sha256 = "1" * 64

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


class ConstantVideoRenderer(VersionedVideoRenderer):
    def render(self, request: dict[str, Any]) -> RenderedTutorial:
        rendered = super().render(request)
        return RenderedTutorial(
            content=b"identical-sidecar-mode-video",
            media_type=rendered.media_type,
            original_name=rendered.original_name,
            manifest=rendered.manifest,
            metrics=rendered.metrics,
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
    caption_mode: str = "burned",
) -> dict[str, Any]:
    queued = control.submit_master_export(
        _master_params(control, generation_id, fps=fps, caption_mode=caption_mode)
    )
    control.runtime.run_once(control.handlers)
    completed = control.status(queued.job_id)
    assert completed.state.value == "SUCCEEDED"
    assert completed.result is not None
    return {"jobId": completed.job_id, **completed.result}


def _master_params(
    control: NativeControlCoordinator,
    generation_id: str,
    *,
    fps: int,
    caption_mode: str = "burned",
) -> dict[str, Any]:
    head = control.store.head_revision()
    assert head is not None
    return {
        "baseRevisionId": head.revision_id,
        "baseJobId": generation_id,
        "aspect": "16:9",
        "resolution": "1080p",
        "fps": fps,
        "captionDeliveryMode": caption_mode,
        "transcript": False,
        "bibliography": False,
    }


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


def _replace_narration_timing(
    store: ProjectStore,
    control: NativeControlCoordinator,
    generation_id: str,
) -> str:
    narration, previous_hash = control._verified_stage_payload(generation_id, "narration")
    corrected = copy.deepcopy(narration)
    first_word = corrected["narration"][0]["words"][0]
    assert first_word["start_ms"] + 1 < first_word["end_ms"]
    first_word["start_ms"] += 1
    previous_row = store.connection.execute(
        "SELECT media_type,original_name,metadata_json FROM artifacts WHERE hash=?",
        (previous_hash,),
    ).fetchone()
    job_row = store.connection.execute(
        "SELECT job_id,result_json FROM jobs WHERE project_id=? "
        "AND kind='generation.narration' AND state='SUCCEEDED' "
        "AND json_extract(parameters_json,'$.generationId')=? "
        "ORDER BY completed_at DESC LIMIT 1",
        (store.manifest.project_id, generation_id),
    ).fetchone()
    assert previous_row is not None and job_row is not None
    replacement = store.add_artifact_bytes(
        json.dumps(corrected, sort_keys=True, separators=(",", ":")).encode(),
        media_type=str(previous_row["media_type"]),
        original_name=previous_row["original_name"],
        metadata=json.loads(str(previous_row["metadata_json"])),
    )
    job_result = json.loads(str(job_row["result_json"]))
    job_result.update({"artifactHash": replacement.hash, "payload": corrected})
    with store.connection:
        store.connection.execute(
            "UPDATE jobs SET result_json=? WHERE job_id=?",
            (json.dumps(job_result), job_row["job_id"]),
        )
    head = store.head_revision()
    assert head is not None
    store.create_revision(
        snapshot=head.snapshot,
        kind="generation",
        message="Persist corrected narration timing fixture",
        expected_head=head.revision_id,
        artifact_links=[
            {
                "artifactHash": replacement.hash,
                "role": "generation-stage:narration",
                "stableId": generation_id,
            },
            *[
                {
                    "artifactHash": str(item["artifactHash"]),
                    "role": "scene-narration",
                    "stableId": str(item["sceneId"]),
                }
                for item in corrected["narration"]
            ],
        ],
    )
    return replacement.hash


def _replace_master_receipt(
    store: ProjectStore,
    promoted: dict[str, Any],
    document: dict[str, Any],
    *,
    result_updates: dict[str, Any] | None = None,
    result_removals: tuple[str, ...] = (),
) -> str:
    replacement = store.add_artifact_bytes(
        json.dumps(document, sort_keys=True, separators=(",", ":")).encode(),
        media_type="application/vnd.alystria.master-provenance+json",
        original_name="forged-master-provenance.json",
        metadata=copy.deepcopy(document),
    )
    row = store.connection.execute(
        "SELECT result_json FROM jobs WHERE job_id=?", (promoted["jobId"],)
    ).fetchone()
    assert row is not None
    result = json.loads(str(row["result_json"]))
    result["masterProvenanceArtifactHash"] = replacement.hash
    result.update(result_updates or {})
    for field in result_removals:
        result.pop(field, None)
    with store.connection:
        store.connection.execute(
            "UPDATE jobs SET result_json=? WHERE job_id=?",
            (json.dumps(result), promoted["jobId"]),
        )
    return replacement.hash


def test_editor_prefers_latest_verified_master_and_uses_its_scene_windows(
    tmp_path: Path,
) -> None:
    store, control, generation_id, _ = _completed_generation(tmp_path)
    try:
        first = _export_master(control, generation_id, fps=24)
        latest = _export_master(control, generation_id, fps=30)

        bindings = control.editor_bindings(generation_id)
        bundle_document = json.loads(
            store.cas.object_path(latest["captionBundleArtifactHash"]).read_bytes()
        )
        narration, narration_stage_hash = control._verified_stage_payload(
            generation_id, "narration"
        )

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
        assert latest["sourceNarrationStageArtifactHash"] == narration_stage_hash
        assert bundle_document["captions"] == control.renderer.requests[-1]["captions"]
        assert bindings["captions"] == _editor_caption_bindings(
            bundle_document["captions"], narration
        )
        head = store.head_revision()
        assert head is not None
        control._require_exportable_editor_assets(
            head.snapshot,
            {
                "assets": [
                    {
                        "artifactHash": latest["artifactHash"],
                        "mediaType": latest["mediaType"],
                    }
                ]
            },
        )
        with pytest.raises(ValueError, match="durable provenance"):
            control._require_exportable_editor_assets(
                head.snapshot,
                {
                    "assets": [
                        {
                            "artifactHash": first["artifactHash"],
                            "mediaType": first["mediaType"],
                        }
                    ]
                },
            )
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


def test_master_action_deduplicates_same_build_and_refreshes_changed_build_only(
    tmp_path: Path,
) -> None:
    store, control, generation_id, _ = _completed_generation(tmp_path)
    try:
        first = _export_master(control, generation_id, fps=24)
        upstream_before = store.connection.execute(
            "SELECT job_id,kind,attempt_count,result_json FROM jobs "
            "WHERE kind LIKE 'generation.%' ORDER BY rowid"
        ).fetchall()
        usage_before = store.connection.execute(
            "SELECT usage_id,job_id,quantity,metadata_json FROM usage_records ORDER BY rowid"
        ).fetchall()
        narration_before = control._verified_stage_payload(generation_id, "narration")[1]
        request = _master_params(control, generation_id, fps=24)
        renderer = control.renderer
        assert isinstance(renderer, VersionedVideoRenderer)

        duplicate = control.submit_master_export(request)
        assert duplicate.job_id == first["jobId"]
        calls_before = len(renderer.requests)

        renderer.renderer_build_sha256 = "2" * 64
        refreshed = control.submit_master_export(request)
        assert refreshed.job_id != first["jobId"]
        control.runtime.run_once(control.handlers)
        assert control.status(refreshed.job_id).state.value == "SUCCEEDED"
        assert len(renderer.requests) == calls_before + 1
        refreshed_result = control.status(refreshed.job_id).result
        assert refreshed_result is not None
        assert refreshed_result["rendererRuntimeIdentitySha256"] == "2" * 64
        assert control._verified_stage_payload(generation_id, "narration")[1] == narration_before
        assert store.connection.execute(
            "SELECT job_id,kind,attempt_count,result_json FROM jobs "
            "WHERE kind LIKE 'generation.%' ORDER BY rowid"
        ).fetchall() == upstream_before
        assert store.connection.execute(
            "SELECT usage_id,job_id,quantity,metadata_json FROM usage_records ORDER BY rowid"
        ).fetchall() == usage_before
    finally:
        store.close()


def test_master_fails_before_render_when_build_changes_after_queue(tmp_path: Path) -> None:
    store, control, generation_id, _ = _completed_generation(tmp_path)
    try:
        queued = control.submit_master_export(
            _master_params(control, generation_id, fps=24)
        )
        renderer = control.renderer
        assert isinstance(renderer, VersionedVideoRenderer)
        calls_before = len(renderer.requests)
        renderer.renderer_build_sha256 = "3" * 64

        control.runtime.run_once(control.handlers)

        failed = control.status(queued.job_id)
        assert failed.state.value == "FAILED"
        assert failed.error is not None
        assert "renderer runtime changed" in str(failed.error["message"])
        assert len(renderer.requests) == calls_before
    finally:
        store.close()


def test_repeated_sidecar_master_uses_new_receipt_when_video_bytes_deduplicate(
    tmp_path: Path,
) -> None:
    store, control, generation_id, _ = _completed_generation(tmp_path)
    try:
        renderer = ConstantVideoRenderer()
        control.renderer = renderer
        first = _export_master(control, generation_id, fps=24, caption_mode="sidecar")
        corrected_narration_hash = _replace_narration_timing(
            store, control, generation_id
        )
        latest = _export_master(control, generation_id, fps=24, caption_mode="sidecar")

        assert first["artifactHash"] == latest["artifactHash"]
        assert first["captionBundleArtifactHash"] != latest["captionBundleArtifactHash"]
        assert (
            first["masterProvenanceArtifactHash"]
            != latest["masterProvenanceArtifactHash"]
        )
        video_row = store.connection.execute(
            "SELECT metadata_json FROM artifacts WHERE hash=?", (latest["artifactHash"],)
        ).fetchone()
        assert video_row is not None
        historical_video_metadata = json.loads(str(video_row["metadata_json"]))
        assert (
            historical_video_metadata["captionBundleArtifactHash"]
            == first["captionBundleArtifactHash"]
        )
        assert (
            historical_video_metadata["sourceNarrationStageArtifactHash"]
            != corrected_narration_hash
        )

        bindings = control.editor_bindings(generation_id)
        latest_bundle = json.loads(
            store.cas.object_path(latest["captionBundleArtifactHash"]).read_bytes()
        )
        narration, narration_hash = control._verified_stage_payload(
            generation_id, "narration"
        )
        assert narration_hash == corrected_narration_hash
        assert {item["artifactHash"] for item in bindings["renders"]} == {
            latest["artifactHash"]
        }
        assert bindings["captions"] == _editor_caption_bindings(
            latest_bundle["captions"], narration
        )
        assert renderer.requests[-1]["captions"] == latest_bundle["captions"]
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


def test_editor_fails_closed_when_promoted_caption_bundle_is_corrupt(tmp_path: Path) -> None:
    store, control, generation_id, _ = _completed_generation(tmp_path)
    try:
        promoted = _export_master(control, generation_id, fps=24)
        store.cas.object_path(str(promoted["captionBundleArtifactHash"])).write_bytes(
            b"corrupt"
        )

        with pytest.raises(ValueError, match="caption bundle is missing or corrupt"):
            control.editor_bindings(generation_id)
    finally:
        store.close()


def test_editor_rejects_receipt_forged_for_another_export_job(tmp_path: Path) -> None:
    store, control, generation_id, _ = _completed_generation(tmp_path)
    try:
        promoted = _export_master(control, generation_id, fps=24)
        receipt = json.loads(
            store.cas.object_path(promoted["masterProvenanceArtifactHash"]).read_bytes()
        )
        receipt["exportJobId"] = str(uuid.uuid4())
        _replace_master_receipt(store, promoted, receipt)

        with pytest.raises(ValueError, match="provenance receipt is incoherent"):
            control.editor_bindings(generation_id)
    finally:
        store.close()


def test_editor_accepts_valid_receipt_v1_without_renderer_identity(tmp_path: Path) -> None:
    store, control, generation_id, _ = _completed_generation(tmp_path)
    try:
        promoted = _export_master(control, generation_id, fps=24)
        receipt = json.loads(
            store.cas.object_path(promoted["masterProvenanceArtifactHash"]).read_bytes()
        )
        receipt["schemaVersion"] = 1
        receipt.pop("rendererRuntimeIdentitySha256")
        _replace_master_receipt(
            store,
            promoted,
            receipt,
            result_removals=("rendererRuntimeIdentitySha256",),
        )

        bindings = control.editor_bindings(generation_id)

        assert bindings["renders"]
        assert {item["artifactHash"] for item in bindings["renders"]} == {
            promoted["artifactHash"]
        }
    finally:
        store.close()


def test_editor_rejects_non_boolean_caption_delivery_in_receipt(tmp_path: Path) -> None:
    store, control, generation_id, _ = _completed_generation(tmp_path)
    try:
        promoted = _export_master(control, generation_id, fps=24)
        receipt = json.loads(
            store.cas.object_path(promoted["masterProvenanceArtifactHash"]).read_bytes()
        )
        receipt["captionDelivery"]["burnedIntoPixels"] = 1
        _replace_master_receipt(
            store,
            promoted,
            receipt,
            result_updates={"captionDelivery": receipt["captionDelivery"]},
        )

        with pytest.raises(ValueError, match="provenance receipt is incoherent"):
            control.editor_bindings(generation_id)
    finally:
        store.close()


def test_editor_accepts_caption_sidecar_deduplicated_from_legacy_metadata(
    tmp_path: Path,
) -> None:
    store, control, generation_id, _ = _completed_generation(tmp_path)
    try:
        generation_captions, _ = control._verified_stage_payload(generation_id, "captions")
        transcript_hash = generation_captions["transcriptArtifactHash"]
        transcript_row = store.connection.execute(
            "SELECT metadata_json FROM artifacts WHERE hash=?", (transcript_hash,)
        ).fetchone()
        assert transcript_row is not None
        legacy_metadata = json.loads(str(transcript_row["metadata_json"]))
        legacy_metadata.pop("compilerVersion", None)
        with store.connection:
            store.connection.execute(
                "UPDATE artifacts SET metadata_json=? WHERE hash=?",
                (json.dumps(legacy_metadata), transcript_hash),
            )

        promoted = _export_master(control, generation_id, fps=24)
        bundle = json.loads(
            store.cas.object_path(promoted["captionBundleArtifactHash"]).read_bytes()
        )
        assert bundle["captions"]["transcriptArtifactHash"] == transcript_hash
        assert control.editor_bindings(generation_id)["captions"]
    finally:
        store.close()


def test_editor_rejects_foreign_caption_bundle_even_when_master_claims_it(
    tmp_path: Path,
) -> None:
    store, control, generation_id, approval_revision_id = _completed_generation(tmp_path)
    try:
        promoted = _export_master(control, generation_id, fps=24)
        bundle_path = store.cas.object_path(str(promoted["captionBundleArtifactHash"]))
        foreign_document = json.loads(bundle_path.read_bytes())
        foreign_generation_id = str(uuid.uuid4())
        foreign_document["generationId"] = foreign_generation_id
        foreign_bundle = store.add_artifact_bytes(
            json.dumps(
                foreign_document, sort_keys=True, separators=(",", ":")
            ).encode(),
            media_type="application/vnd.alystria.caption-bundle+json",
            original_name="foreign-caption-bundle.json",
            metadata={
                "generationId": foreign_generation_id,
                "approvalRevisionId": approval_revision_id,
                "sourceNarrationStageArtifactHash": promoted[
                    "sourceNarrationStageArtifactHash"
                ],
                "locale": foreign_document["locale"],
                "compilerVersion": foreign_document["captions"]["compilerVersion"],
                "rightsStatus": "owned",
            },
        )
        master_row = store.connection.execute(
            "SELECT metadata_json FROM artifacts WHERE hash=?",
            (promoted["artifactHash"],),
        ).fetchone()
        job_row = store.connection.execute(
            "SELECT result_json FROM jobs WHERE job_id=?", (promoted["jobId"],)
        ).fetchone()
        assert master_row is not None and job_row is not None
        master_metadata = json.loads(str(master_row["metadata_json"]))
        master_metadata["captionBundleArtifactHash"] = foreign_bundle.hash
        job_result = json.loads(str(job_row["result_json"]))
        job_result["captionBundleArtifactHash"] = foreign_bundle.hash
        with store.connection:
            store.connection.execute(
                "UPDATE artifacts SET metadata_json=? WHERE hash=?",
                (json.dumps(master_metadata), promoted["artifactHash"]),
            )
            store.connection.execute(
                "UPDATE jobs SET result_json=? WHERE job_id=?",
                (json.dumps(job_result), promoted["jobId"]),
            )

        with pytest.raises(ValueError, match="provenance receipt is incoherent"):
            control.editor_bindings(generation_id)
    finally:
        store.close()
