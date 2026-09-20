"""CPU checks for the boundary around the separately installed JoyVASA model."""

import importlib.util
import json
import os
from pathlib import Path

import pytest


@pytest.fixture
def adapter():
    path = Path(__file__).parents[2] / "scripts" / "joyvasa_presenter_adapter.py"
    spec = importlib.util.spec_from_file_location("joyvasa_adapter_boundary", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_encoder_uses_exact_brokered_hardware_route_without_x264_fallback(adapter, tmp_path):
    command = adapter._encoder_command(
        {
            "ffmpegPath": "C:/verified runtime/ffmpeg.exe",
            "policy": "alystria-presenter-h264-v1",
            "encoder": "h264_qsv",
            "codecArguments": ["-c:v", "h264_qsv"],
            "pixelFormat": "yuv420p",
            "audioEncoder": "aac",
        },
        512,
        512,
        25,
        tmp_path / "portrait with spaces.mp4",
    )
    assert command[0] == "C:/verified runtime/ffmpeg.exe"
    assert command[command.index("-c:v") + 1] == "h264_qsv"
    assert "libx264" not in command
    assert command[-1] == str(tmp_path / "portrait with spaces.mp4")
    assert command[command.index("-framerate") + 1] == "25"


def test_encoder_accepts_media_foundation_only_with_forced_hardware(adapter, tmp_path):
    command = adapter._encoder_command(
        {
            "ffmpegPath": "C:/verified runtime/ffmpeg.exe",
            "policy": "alystria-presenter-h264-v1",
            "encoder": "h264_mf",
            "codecArguments": ["-c:v", "h264_mf", "-hw_encoding", "1"],
            "pixelFormat": "yuv420p",
            "audioEncoder": "aac",
        },
        512,
        512,
        25,
        tmp_path / "presenter.mp4",
    )
    assert command[command.index("-c:v") : command.index("-c:v") + 4] == [
        "-c:v",
        "h264_mf",
        "-hw_encoding",
        "1",
    ]


@pytest.mark.parametrize(
    "encoding",
    [
        {},
        {
            "policy": "alystria-presenter-h264-v1",
            "encoder": "h264_qsv",
            "codecArguments": ["-c:v", "libx264"],
            "pixelFormat": "yuv420p",
            "audioEncoder": "aac",
        },
        {
            "policy": "alystria-presenter-h264-v1",
            "encoder": "h264_qsv",
            "codecArguments": ["-c:v", "h264_qsv", "-metadata", "comment=unreviewed"],
            "pixelFormat": "yuv420p",
            "audioEncoder": "aac",
        },
        {
            "policy": "alystria-presenter-h264-v1",
            "encoder": "h264_amf",
            "codecArguments": ["-c:v", "h264_amf"],
            "pixelFormat": "yuv420p",
            "audioEncoder": "aac",
        },
        {
            "policy": "alystria-presenter-h264-v1",
            "encoder": "libx264",
            "codecArguments": [
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "18",
            ],
            "pixelFormat": "yuv420p",
            "audioEncoder": "aac",
        },
        {
            "policy": "alystria-presenter-h264-v1",
            "encoder": "unprobed",
            "codecArguments": ["-c:v", "unprobed"],
            "pixelFormat": "yuv420p",
            "audioEncoder": "aac",
        },
    ],
)
def test_encoder_rejects_missing_or_mismatched_selection(adapter, encoding, tmp_path):
    with pytest.raises(ValueError, match="brokered"):
        adapter._encoder_command(encoding, 512, 512, 25, tmp_path / "output.mp4")


def test_model_outputs_cannot_escape_attempt_workspace(adapter, tmp_path):
    workspace = tmp_path / "attempt"
    workspace.mkdir()
    assert adapter._inside(workspace / "frames.mp4", workspace) == workspace / "frames.mp4"
    with pytest.raises(ValueError):
        adapter._inside(workspace / ".." / "unrelated.mp4", workspace)


def test_job_intermediates_use_broker_workspace_separate_from_delivery(adapter, tmp_path):
    attempt = tmp_path / "attempt"
    workspace = attempt / "workspace"
    output_root = attempt / "output"
    workspace.mkdir(parents=True)
    output_root.mkdir()
    output = output_root / "presenter.mp4"
    job = {"workspace": {"path": str(workspace)}}
    selected = adapter._job_workspace(job, output)
    assert selected == workspace.resolve()
    assert selected / "joyvasa" != output_root
    assert list(output_root.iterdir()) == []

    with pytest.raises(ValueError, match="separate from the delivery"):
        adapter._job_workspace({"workspace": {"path": str(output_root)}}, output)
    outside = tmp_path / "outside"
    outside.mkdir()
    with pytest.raises(ValueError):
        adapter._job_workspace({"workspace": {"path": str(outside)}}, output)


@pytest.mark.skipif(os.name != "nt", reason="Windows verbatim path behavior")
def test_windows_verbatim_and_normal_paths_share_one_identity(adapter, tmp_path):
    workspace = tmp_path / "attempt"
    workspace.mkdir()
    output = workspace / "frames.mp4"
    verbatim_workspace = Path("\\\\?\\" + str(workspace.resolve()))
    verbatim_output = Path("\\\\?\\" + str(output.resolve()))
    assert adapter._same_path(output, verbatim_output, strict=False)
    assert adapter._inside(verbatim_output, workspace) == verbatim_output.resolve()
    assert adapter._inside(output, verbatim_workspace) == output.resolve()


def test_runtime_manifest_paths_are_contained_and_semantically_addressable(adapter, tmp_path):
    root = tmp_path / "runtime"
    source = root / "src" / "config" / "models.yaml"
    source.parent.mkdir(parents=True)
    source.write_text("model_params: {}\n", encoding="utf-8")
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "root": str(root),
                "files": [{"relativePath": "src/config/models.yaml", "sha256": "0" * 64}],
            }
        ),
        encoding="utf-8",
    )
    resolved_root, paths = adapter._manifest_paths(manifest, "test manifest")
    assert resolved_root == root.resolve()
    adapter._require_manifested(source, paths, "models config")
    with pytest.raises(ValueError, match="not pinned"):
        adapter._require_manifested(root / "src" / "unreviewed.py", paths, "source")


def test_adapter_rejects_implicit_or_unknown_animation_mode_before_loading_models(adapter):
    with pytest.raises(ValueError, match="explicit human or animal"):
        adapter.run_presenter_job({"model": "joyvasa"}, lambda *_: None)
