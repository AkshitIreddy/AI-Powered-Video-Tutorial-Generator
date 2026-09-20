from __future__ import annotations

import base64
import hashlib
import json
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from alystria.generation.adapters import GeneratedMedia
from alystria.jobs import ActionKey, SQLiteWorkflowRuntime
from alystria.presenter_preview import (
    PREVIEW_AUDIO_SHA256,
    SOULX_MODEL_ID,
    SOULX_WORKER_CONTRACT_ID,
    accept_presenter_preview,
    prepare_presenter_preview,
    reject_presenter_preview,
    render_presenter_preview,
)
from alystria.project import ProjectStore
from alystria.service import PipelineService

PNG = b"\x89PNG\r\n\x1a\n" + b"custom-presenter-preview"


class PreviewMediaClient:
    def __init__(
        self,
        *,
        model_id: str = SOULX_MODEL_ID,
        model_revision: str = "soulx-flashhead-pro@code-a+weights-b",
        contract_id: str = SOULX_WORKER_CONTRACT_ID,
    ) -> None:
        self.runtime = SimpleNamespace(
            model_id=model_id,
            model_revision=model_revision,
            worker_contract=SimpleNamespace(contract_id=contract_id),
        )
        self.calls: list[tuple[dict[str, Any], str, int]] = []

    def create_presenter(
        self,
        scene: dict[str, Any],
        *,
        narration_hash: str,
        seed: int,
    ) -> GeneratedMedia:
        self.calls.append((scene, narration_hash, seed))
        content = b"\x00\x00\x00\x18ftypmp42" + hashlib.sha256(
            f"{scene['portraitArtifactHash']}:{narration_hash}:{seed}".encode()
        ).digest()
        output_hash = hashlib.sha256(content).hexdigest()
        return GeneratedMedia(
            content=content,
            media_type="video/mp4",
            original_name="preview.mp4",
            provider_id="local-presenter",
            model_revision=self.runtime.model_revision,
            metadata={
                "presenterProfileId": scene["presenterProfileId"],
                "portraitArtifactHash": scene["portraitArtifactHash"],
                "narrationArtifactHash": narration_hash,
                "modelId": self.runtime.model_id,
                "modelRevision": self.runtime.model_revision,
                "workerContractId": self.runtime.worker_contract.contract_id,
                "outputSha256": output_hash,
                "probe": {"durationSeconds": 5.08},
            },
        )


def _project(tmp_path: Path) -> tuple[ProjectStore, str]:
    root = tmp_path / "Presenter Preview"
    project_id = str(uuid.uuid4())
    with ProjectStore.create(
        root,
        name="Presenter preview",
        project_id=project_id,
        initial_snapshot={"id": project_id, "title": "Presenter preview"},
    ) as created:
        head = created.head_revision()
        assert head is not None
        initial_head = head.revision_id
    imported = PipelineService().asset_import(
        {
            "projectId": project_id,
            "projectDirectory": str(root),
            "expectedHeadRevisionId": initial_head,
            "kind": "presenterPortrait",
            "filename": "nova.png",
            "mimeType": "image/png",
            "privacy": "project_local",
            "rights": {
                "status": "owned",
                "creator": "Project owner",
                "license": "User-owned media",
                "attribution": None,
                "commercialUse": "allowed",
                "redistribution": "allowed",
                "modelInput": "allowed",
            },
            "presenter": {
                "identityType": "synthetic",
                "displayName": "Nova",
                "syntheticOriginAttested": True,
                "consent": None,
                "selectAfterImport": True,
            },
            "contentBase64": base64.b64encode(PNG).decode("ascii"),
        }
    )
    return ProjectStore.open(root), str(imported["presenterProfile"]["profileId"])


def _run_preview(
    store: ProjectStore, profile_id: str, client: PreviewMediaClient
) -> tuple[dict[str, Any], str]:
    head = store.head_revision()
    assert head is not None
    _, _, params = prepare_presenter_preview(
        store, {"baseRevisionId": head.revision_id, "profileId": profile_id}
    )
    runtime = SQLiteWorkflowRuntime(store.connection)
    job_id = str(uuid.uuid4())
    kind = "native.preview_presenter_animation"
    job = runtime.enqueue(
        project_id=store.manifest.project_id,
        kind=kind,
        parameters=params,
        job_id=job_id,
        action_key=ActionKey(
            kind,
            "test-presenter-preview-v1",
            params,
            input_hashes=(head.root_hash, str(params["portraitArtifactHash"])),
        ),
        max_attempts=1,
    )
    assert job.state.value == "QUEUED"
    completed = runtime.run_once(
        {kind: lambda context, queued: render_presenter_preview(store, client, context, queued)}
    )
    assert completed is not None
    assert completed.state.value == "SUCCEEDED"
    assert completed.result is not None
    return completed.result, job_id


def test_custom_portrait_preview_is_durable_hash_bound_and_accepted(tmp_path: Path) -> None:
    store, profile_id = _project(tmp_path)
    try:
        client = PreviewMediaClient()
        result, _ = _run_preview(store, profile_id, client)
        preview = result["preview"]
        assert preview["portraitArtifactHash"] == client.calls[0][0]["portraitArtifactHash"]
        assert preview["narrationArtifactHash"] == PREVIEW_AUDIO_SHA256
        assert preview["engineId"] == SOULX_MODEL_ID
        assert preview["modelRevision"] == client.runtime.model_revision
        assert preview["workerContractId"] == SOULX_WORKER_CONTRACT_ID
        assert preview["durationMs"] == 5_080
        assert store.cas.verify(preview["outputArtifactHash"])

        head = store.head_revision()
        assert head is not None
        accepted = accept_presenter_preview(
            store,
            {
                "expectedHeadRevisionId": head.revision_id,
                "previewId": preview["id"],
            },
        )
        assert accepted["status"] == "accepted"
        assert accepted["portraitArtifactHash"] == preview["portraitArtifactHash"]
        assert accepted["outputArtifactHash"] == preview["outputArtifactHash"]
        assert accepted["modelRevision"] == preview["modelRevision"]

        reopened_root = store.root
    finally:
        store.close()

    with ProjectStore.open(reopened_root) as reopened:
        head = reopened.head_revision()
        assert head is not None
        durable = head.snapshot["presenterAnimationPreviews"][0]
        assert durable["status"] == "accepted"
        # Repeating the exact decision at the current head is idempotent, so a
        # native library update can safely be retried after a process restart.
        again = accept_presenter_preview(
            reopened,
            {
                "expectedHeadRevisionId": head.revision_id,
                "previewId": durable["id"],
            },
        )
        assert again["headRevisionId"] == head.revision_id


def test_preview_requires_the_verified_soulx_runtime_without_mutating_project(
    tmp_path: Path,
) -> None:
    store, profile_id = _project(tmp_path)
    try:
        before = store.head_revision()
        assert before is not None
        client = PreviewMediaClient(model_id="musetalk")
        head = store.head_revision()
        assert head is not None
        _, _, params = prepare_presenter_preview(
            store, {"baseRevisionId": head.revision_id, "profileId": profile_id}
        )
        runtime = SQLiteWorkflowRuntime(store.connection)
        kind = "native.preview_presenter_animation"
        runtime.enqueue(
            project_id=store.manifest.project_id,
            kind=kind,
            parameters=params,
            job_id=str(uuid.uuid4()),
            action_key=ActionKey(kind, "test-v1", params, input_hashes=(head.root_hash,)),
            max_attempts=1,
        )
        completed = runtime.run_once(
            {
                kind: lambda context, queued: render_presenter_preview(
                    store, client, context, queued
                )
            }
        )
        assert completed is not None
        assert completed.state.value == "FAILED"
        assert "SoulX-FlashHead Pro" in str(completed.error)
        after = store.head_revision()
        assert after is not None and after.revision_id == before.revision_id
        assert client.calls == []
    finally:
        store.close()


def test_accept_revalidates_registered_output_and_reject_remains_review_first(
    tmp_path: Path,
) -> None:
    store, profile_id = _project(tmp_path)
    try:
        result, _ = _run_preview(store, profile_id, PreviewMediaClient())
        preview = result["preview"]
        head = store.head_revision()
        assert head is not None
        rejected = reject_presenter_preview(
            store,
            {
                "expectedHeadRevisionId": head.revision_id,
                "previewId": preview["id"],
            },
        )
        assert rejected["status"] == "rejected"
        rejected_head = store.head_revision()
        assert rejected_head is not None
        with pytest.raises(ValueError, match="Only a ready"):
            accept_presenter_preview(
                store,
                {
                    "expectedHeadRevisionId": rejected_head.revision_id,
                    "previewId": preview["id"],
                },
            )
    finally:
        store.close()


def test_accept_blocks_tampered_output_provenance(tmp_path: Path) -> None:
    store, profile_id = _project(tmp_path)
    try:
        result, _ = _run_preview(store, profile_id, PreviewMediaClient())
        preview = result["preview"]
        row = store.connection.execute(
            "SELECT metadata_json FROM artifacts WHERE hash=?",
            (preview["outputArtifactHash"],),
        ).fetchone()
        assert row is not None
        metadata = json.loads(str(row["metadata_json"]))
        metadata["modelRevision"] = "tampered"
        with store.connection:
            store.connection.execute(
                "UPDATE artifacts SET metadata_json=? WHERE hash=?",
                (json.dumps(metadata), preview["outputArtifactHash"]),
            )
        head = store.head_revision()
        assert head is not None
        with pytest.raises(ValueError, match="metadata does not match"):
            accept_presenter_preview(
                store,
                {
                    "expectedHeadRevisionId": head.revision_id,
                    "previewId": preview["id"],
                },
            )
    finally:
        store.close()


def test_service_dispatch_queues_one_attempt_preview_without_loading_runtime(
    tmp_path: Path,
) -> None:
    store, profile_id = _project(tmp_path)
    root = store.root
    project_id = store.manifest.project_id
    head = store.head_revision()
    assert head is not None
    store.close()

    receipt = PipelineService().dispatch(
        "control.previewPresenterAnimation",
        {
            "projectId": project_id,
            "projectDirectory": str(root),
            "baseRevisionId": head.revision_id,
            "profileId": profile_id,
        },
    )

    assert receipt["state"] == "QUEUED"
    assert receipt["operation"] == "preview_presenter_animation"
    with ProjectStore.open(root) as reopened:
        job = SQLiteWorkflowRuntime(reopened.connection).get_job(str(receipt["jobId"]))
        assert job is not None
        assert job.kind == "native.preview_presenter_animation"
        assert job.max_attempts == 1
        assert job.parameters["profileId"] == profile_id
