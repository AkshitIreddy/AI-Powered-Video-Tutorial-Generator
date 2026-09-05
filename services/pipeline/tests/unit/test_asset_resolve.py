from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import pytest

import alystria.service as service_module
from alystria.project import ProjectStore
from alystria.service import PipelineService


def test_asset_resolve_returns_only_verified_registered_project_object(tmp_path: Path) -> None:
    root = tmp_path / "Resolve Project"
    project_id = str(uuid.uuid4())
    with ProjectStore.create(root, name="Resolve Project", project_id=project_id) as store:
        artifact = store.add_artifact_bytes(
            b"RIFF-test-asset",
            media_type="audio/wav",
            original_name="voice.wav",
        )

    result = PipelineService().dispatch(
        "asset.resolve",
        {
            "projectId": project_id,
            "projectDirectory": str(root),
            "artifactHash": artifact.hash,
        },
    )

    path = Path(result["path"])
    assert result == {
        "projectId": project_id,
        "artifactHash": artifact.hash,
        "path": str(path),
        "mediaType": "audio/wav",
        "byteSize": len(b"RIFF-test-asset"),
    }
    assert path.read_bytes() == b"RIFF-test-asset"
    path.relative_to((root / "objects" / "sha256").resolve())


def test_asset_resolve_rejects_unregistered_hash(tmp_path: Path) -> None:
    root = tmp_path / "Resolve Project"
    project_id = str(uuid.uuid4())
    with ProjectStore.create(root, name="Resolve Project", project_id=project_id):
        pass
    with pytest.raises(ValueError, match="not registered"):
        PipelineService().dispatch(
            "asset.resolve",
            {
                "projectId": project_id,
                "projectDirectory": str(root),
                "artifactHash": "a" * 64,
            },
        )


def test_asset_resolve_rejects_registered_non_preview_artifact(tmp_path: Path) -> None:
    root = tmp_path / "Resolve Project"
    project_id = str(uuid.uuid4())
    with ProjectStore.create(root, name="Resolve Project", project_id=project_id) as store:
        artifact = store.add_artifact_bytes(
            b"<svg><script>alert(1)</script></svg>",
            media_type="image/svg+xml",
            original_name="active.svg",
        )
    with pytest.raises(ValueError, match="supported preview media"):
        PipelineService().dispatch(
            "asset.resolve",
            {
                "projectId": project_id,
                "projectDirectory": str(root),
                "artifactHash": artifact.hash,
            },
        )


def test_editor_waveform_dispatch_forwards_verified_profile(
    tmp_path: Path, monkeypatch: Any
) -> None:
    root = tmp_path / "Waveform Project"
    project_id = str(uuid.uuid4())
    with ProjectStore.create(root, name="Waveform Project", project_id=project_id) as store:
        source = store.add_artifact_bytes(
            b"RIFF-waveform-source",
            media_type="audio/wav",
            original_name="voice.wav",
        )
    ffmpeg = tmp_path / "ffmpeg.exe"
    monkeypatch.setenv("ALYSTRIA_FFMPEG_PATH", str(ffmpeg))

    def fake_render(
        store: ProjectStore,
        artifact_hash: str,
        *,
        ffmpeg_path: Path,
        profile: Any,
    ) -> dict[str, Any]:
        assert store.manifest.project_id == project_id
        assert artifact_hash == source.hash
        assert ffmpeg_path == ffmpeg
        assert (profile.width, profile.height) == (1024, 64)
        return {
            "projectId": project_id,
            "artifactHash": source.hash,
            "profile": {"width": 1024, "height": 64},
            "waveformHash": "b" * 64,
            "waveformPath": str(root / "objects" / "sha256" / "bb" / ("b" * 64)),
            "mediaType": "image/png",
            "width": 1024,
            "height": 64,
            "durationTicks": 480_000,
        }

    monkeypatch.setattr(service_module, "render_editor_waveform", fake_render)
    result = PipelineService().dispatch(
        "editor.waveform.get",
        {
            "projectId": project_id,
            "projectDirectory": str(root),
            "artifactHash": source.hash,
            "profile": {"width": 1024, "height": 64},
        },
    )
    assert result["durationTicks"] == 480_000
    assert result["mediaType"] == "image/png"
