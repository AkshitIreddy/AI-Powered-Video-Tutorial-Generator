from __future__ import annotations

import base64
import uuid
from pathlib import Path
from typing import Any

import alystria.editor_export as editor_export_module
import alystria.native_controls as native_controls_module
from alystria.native_controls import NativeControlCoordinator
from alystria.project import ProjectStore
from alystria.service import PipelineService


def test_editor_engine_change_does_not_reuse_an_old_export_job(tmp_path: Path, monkeypatch: Any) -> None:
    with ProjectStore.create(tmp_path / "project", name="Engine identity") as store:
        head = store.head_revision()
        assert head is not None
        control = NativeControlCoordinator(store)
        request = {"expectedHeadRevisionId": head.revision_id, "manifest": {"schema": "alystria.editor.render.v1"}}
        first = control.submit_editor_timeline_export(request)
        assert control.submit_editor_timeline_export(request).job_id == first.job_id
        monkeypatch.setattr(native_controls_module, "EDITOR_EXPORT_IMPLEMENTATION_VERSION", "next-reviewed-editor-engine")
        second = control.submit_editor_timeline_export(request)
        assert second.job_id != first.job_id
        assert control.submit_editor_timeline_export(request).job_id == second.job_id


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

    def fake_run(_: object, argv: tuple[str, ...], *, timeout_seconds: float) -> None:
        assert 0 < timeout_seconds <= 3_600
        Path(argv[-1]).write_bytes(b"edited timeline")

    monkeypatch.setattr(editor_export_module.SubprocessEditorExportRunner, "run", fake_run)
    monkeypatch.setattr(editor_export_module, "verify_editor_delivery", lambda *_args, **_kwargs: {"testDouble": True})
    monkeypatch.setattr(editor_export_module.SubprocessEditorMediaProbe, "has_audio_stream", lambda *_args, **_kwargs: False)
    transform = {"x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "rotation": 0, "anchorX": 0.5, "anchorY": 0.5}
    audio = {"volumeDb": 0, "pan": 0, "muted": False, "fadeInTicks": 0, "fadeOutTicks": 0}
    receipt = service.dispatch(
        "editor.timeline.export",
        {
            "projectId": project_id,
            "projectDirectory": str(root),
            "expectedHeadRevisionId": expected_head,
            "manifest": {
                "schema": "alystria.editor.render.v1",
                "projectId": project_id,
                "name": "Durable editor export",
                "timebaseHz": 240_000,
                "frameRate": {"numerator": 30, "denominator": 1},
                "canvas": {"width": 1280, "height": 720, "pixelAspectRatio": 1, "backgroundColor": "#101116"},
                "durationTicks": 240_000,
                "codec": {"name": "vp9", "quality": 24},
                "assets": [
                    {
                        "id": imported["artifact"]["id"],
                        "artifactHash": imported["artifact"]["sha256"],
                        "mediaType": "video/webm",
                        "kind": "video",
                        "exportEligible": True,
                    }
                ],
                "clips": [
                    {
                        "id": "visual", "trackId": "slides", "kind": "slides", "layer": 0,
                        "assetId": imported["artifact"]["id"], "timelineStartTicks": 0,
                        "timelineDurationTicks": 240_000, "sourceStartTicks": 0,
                        "sourceDurationTicks": 240_000, "playbackRate": 1,
                        "transform": transform, "opacity": 1, "audio": audio,
                        "keyframes": [], "includeSourceAudio": False,
                    },
                    {
                        "id": "caption", "trackId": "captions", "kind": "captions", "layer": 1,
                        "assetId": None, "timelineStartTicks": 48_000,
                        "timelineDurationTicks": 144_000, "sourceStartTicks": 0,
                        "sourceDurationTicks": 144_000, "playbackRate": 1,
                        "transform": transform, "opacity": 1, "audio": audio, "keyframes": [],
                        "text": "A durable caption",
                        "textStyle": {"fontFamily": "Atkinson", "fontSize": 36, "fontWeight": 600, "color": "#FFFFFF", "backgroundColor": "#000000", "align": "center", "position": "bottom"},
                    },
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
        linked = store.connection.execute(
            "SELECT artifact_hash,role FROM revision_artifacts WHERE revision_id=? ORDER BY role",
            (head.revision_id,),
        ).fetchall()
        assert [(row["artifact_hash"], row["role"]) for row in linked] == [
            (result["captionSidecars"][0]["artifactHash"], "editor-caption-sidecar"),
            (result["captionSidecars"][1]["artifactHash"], "editor-caption-sidecar"),
            (result["artifactHash"], "editor-timeline-export"),
        ]
        for artifact_hash, _role in linked:
            assert store.connection.execute("SELECT 1 FROM artifacts WHERE hash=?", (artifact_hash,)).fetchone() is not None


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
