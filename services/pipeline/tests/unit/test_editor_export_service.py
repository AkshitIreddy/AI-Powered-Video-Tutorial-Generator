from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import alystria.native_controls as native_controls_module
from alystria.native_controls import NativeControlCoordinator
from alystria.project import ProjectStore
from alystria.service import PipelineService


def test_editor_timeline_export_dispatch_persists_artifact_and_revision(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    root = tmp_path / "Editor Project"
    with ProjectStore.create(root, name="Editor Project", project_id=str(uuid.uuid4())) as store:
        project_id = store.manifest.project_id
        head = store.head_revision()
        assert head is not None
        expected_head = head.revision_id

    monkeypatch.setenv("ALYSTRIA_FFMPEG_PATH", str(tmp_path / "ffmpeg.exe"))

    def fake_render(
        store: ProjectStore,
        manifest: Any,
        *,
        ffmpeg_path: Path,
    ) -> dict[str, Any]:
        assert manifest["schema"] == "alystria.editor.render.v1"
        assert ffmpeg_path == tmp_path / "ffmpeg.exe"
        output = store.root / "exports" / "editor" / "edited.webm"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"edited timeline")
        artifact = store.add_artifact_bytes(
            b"edited timeline",
            media_type="video/webm",
            original_name="edited.webm",
        )
        return {
            "projectId": project_id,
            "outputPath": str(output),
            "artifactHash": artifact.hash,
            "mediaType": "video/webm",
            "byteSize": output.stat().st_size,
            "codec": "vp9",
            "durationTicks": 240_000,
            "manifestHash": "a" * 64,
            "warnings": [],
        }

    monkeypatch.setattr(native_controls_module, "render_editor_timeline", fake_render)
    receipt = PipelineService().dispatch(
        "editor.timeline.export",
        {
            "projectId": project_id,
            "projectDirectory": str(root),
            "expectedHeadRevisionId": expected_head,
            "manifest": {
                "schema": "alystria.editor.render.v1",
                "projectId": project_id,
                "assets": [],
            },
        },
    )

    assert receipt["state"] == "QUEUED"
    with ProjectStore.open(root) as store:
        control = NativeControlCoordinator(store)
        control.runtime.run_once(control.handlers)
        completed = control.status(receipt["jobId"])
        assert completed.result is not None
        result = completed.result

    assert Path(result["outputPath"]).is_file()
    assert result["headRevisionId"] != expected_head
    with ProjectStore.open(root) as store:
        head = store.head_revision()
        assert head is not None
        assert head.snapshot["editorExports"][-1]["artifactHash"] == result["artifactHash"]


def test_editor_timeline_export_rejects_caller_declared_unlinked_asset(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    root = tmp_path / "Editor Project"
    project_id = str(uuid.uuid4())
    with ProjectStore.create(root, name="Editor Project", project_id=project_id) as store:
        head = store.head_revision()
        assert head is not None
        artifact = store.add_artifact_bytes(
            b"RIFF-unlinked",
            media_type="audio/wav",
            original_name="unlinked.wav",
        )
        expected_head = head.revision_id

    monkeypatch.setenv("ALYSTRIA_FFMPEG_PATH", str(tmp_path / "ffmpeg.exe"))
    receipt = PipelineService().dispatch(
        "editor.timeline.export",
        {
            "projectId": project_id,
            "projectDirectory": str(root),
            "expectedHeadRevisionId": expected_head,
            "manifest": {
                "schema": "alystria.editor.render.v1",
                "projectId": project_id,
                "assets": [
                    {
                        "id": "caller-assertion",
                        "artifactHash": artifact.hash,
                        "mediaType": "audio/wav",
                        "kind": "audio",
                        "exportEligible": True,
                    }
                ],
            },
        },
    )

    with ProjectStore.open(root) as store:
        control = NativeControlCoordinator(store)
        control.runtime.run_once(control.handlers)
        failed = control.status(receipt["jobId"])
    assert failed.state.value == "FAILED"
    assert failed.error is not None
    assert "durable provenance" in str(failed.error["message"])
