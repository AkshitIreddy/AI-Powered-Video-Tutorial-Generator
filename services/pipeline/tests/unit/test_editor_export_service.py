from __future__ import annotations

import base64
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

    service = PipelineService()
    imported = service.asset_import(
        {
            "projectId": project_id,
            "projectDirectory": str(root),
            "expectedHeadRevisionId": expected_head,
            "kind": "editorVideo",
            "filename": "owned.webm",
            "mimeType": "video/webm",
            "privacy": "project_local",
            "rights": {
                "status": "owned",
                "creator": "Project owner",
                "license": "User-owned media",
                "attribution": None,
                "commercialUse": "allowed",
                "redistribution": "allowed",
                "modelInput": "notAllowed",
            },
            "contentBase64": base64.b64encode(
                b"\x1a\x45\xdf\xa3\x8b\x42\x86\x81\x01\x42\x82\x84webm\x18\x53\x80\x67\xff\xa3\x81\x00"
            ).decode("ascii"),
        }
    )
    expected_head = imported["headRevisionId"]
    assert imported["provenance"]["exportEligible"] is True
    assert imported["provenance"]["modelInputEligible"] is False

    monkeypatch.setenv("ALYSTRIA_FFMPEG_PATH", str(tmp_path / "ffmpeg.exe"))
    monkeypatch.setenv("ALYSTRIA_FFPROBE_PATH", str(tmp_path / "ffprobe.exe"))

    def fake_render(
        store: ProjectStore,
        manifest: Any,
        *,
        ffmpeg_path: Path,
        ffprobe_path: Path,
    ) -> dict[str, Any]:
        assert manifest["schema"] == "alystria.editor.render.v1"
        assert ffmpeg_path == tmp_path / "ffmpeg.exe"
        assert ffprobe_path == tmp_path / "ffprobe.exe"
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
    receipt = service.dispatch(
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
                        "id": imported["artifact"]["id"],
                        "artifactHash": imported["artifact"]["sha256"],
                        "mediaType": "video/webm",
                        "kind": "video",
                        "exportEligible": True,
                    }
                ],
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
    monkeypatch.setenv("ALYSTRIA_FFPROBE_PATH", str(tmp_path / "ffprobe.exe"))
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
