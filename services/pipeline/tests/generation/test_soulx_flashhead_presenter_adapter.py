"""CPU-only checks for the managed SoulX-FlashHead presenter adapter."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def adapter():
    path = Path(__file__).parents[2] / "scripts" / "soulx_flashhead_presenter_adapter.py"
    spec = importlib.util.spec_from_file_location("soulx_flashhead_adapter_boundary", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _encoding() -> dict[str, object]:
    return {
        "ffmpegPath": "C:/verified runtime/ffmpeg.exe",
        "policy": "alystria-presenter-h264-v1",
        "encoder": "h264_nvenc",
        "codecArguments": ["-c:v", "h264_nvenc"],
        "pixelFormat": "yuv420p",
        "audioEncoder": "aac",
    }


def test_encoder_uses_only_the_exact_brokered_selection(adapter, tmp_path: Path) -> None:
    command = adapter._encoder_command(
        _encoding(), 512, 512, 25, tmp_path / "portrait with spaces.mp4"
    )
    assert command[0] == "C:/verified runtime/ffmpeg.exe"
    assert command[command.index("-c:v") + 1] == "h264_nvenc"
    assert "libx264" not in command
    assert command[-1] == str(tmp_path / "portrait with spaces.mp4")

    invalid = _encoding()
    invalid["codecArguments"] = ["-c:v", "libx264"]
    with pytest.raises(ValueError, match="brokered"):
        adapter._encoder_command(invalid, 512, 512, 25, tmp_path / "output.mp4")


def test_frame_trimming_matches_narration_and_rejects_short_generation(adapter) -> None:
    chunks = [["frame-1", "frame-2"], ["frame-3", "frame-4", "frame-5"]]
    result = list(adapter._trimmed_frames(chunks, 4))
    assert result == ["frame-1", "frame-2", "frame-3", "frame-4"]
    assert adapter._target_frame_count(128_000, 16_000, 25) == 200
    assert adapter._target_frame_count(128_001, 16_000, 25) == 201

    with pytest.raises(RuntimeError, match="fewer than the required"):
        list(adapter._trimmed_frames([chunks[0]], 3))
    with pytest.raises(ValueError, match="positive-duration"):
        adapter._target_frame_count(0, 16_000, 25)


def test_generated_chunks_report_monotonic_progress_without_loading_a_gpu(
    adapter, monkeypatch
) -> None:
    class FakeArray(list):
        def __init__(self, values, shape=None):
            super().__init__(values)
            self.shape = shape or (len(self),)

        @property
        def ndim(self):
            return len(self.shape)

        def reshape(self, rows, columns):
            assert rows * columns == len(self)
            return [
                FakeArray(self[index * columns : (index + 1) * columns]) for index in range(rows)
            ]

        def tolist(self):
            return list(self)

        def __getitem__(self, key):
            result = super().__getitem__(key)
            if isinstance(key, slice):
                return FakeArray(result, (len(result), *self.shape[1:]))
            return result

    fake_numpy = SimpleNamespace(
        float32="float32",
        asarray=lambda value, dtype=None: (
            value if isinstance(value, FakeArray) else FakeArray(list(value))
        ),
        pad=lambda value, padding: FakeArray([0.0] * padding[0] + list(value) + [0.0] * padding[1]),
    )
    monkeypatch.setitem(sys.modules, "numpy", fake_numpy)
    progress: list[tuple[str, float, str]] = []
    embeddings: list[tuple[int, int]] = []

    def get_audio_embedding(_pipeline, audio, start, end):
        assert len(audio) == 128_000
        embeddings.append((start, end))
        return object()

    def run_pipeline(_pipeline, _embedding):
        return FakeArray([object()] * 33, (33, 4, 4, 3))

    chunks = list(
        adapter._generated_chunks(
            audio_samples=[0.0] * 35_840,
            pipeline=object(),
            infer_params={
                "sample_rate": 16_000,
                "tgt_fps": 25,
                "frame_num": 33,
                "motion_frames_num": 5,
                "cached_audio_duration": 8,
            },
            get_audio_embedding=get_audio_embedding,
            run_pipeline=run_pipeline,
            emit_progress=lambda *event: progress.append(event),
        )
    )
    assert [chunk.shape[0] for chunk in chunks] == [28, 28]
    assert embeddings == [(167, 200), (167, 200)]
    assert [event[0] for event in progress] == ["inference", "inference"]
    assert [event[1] for event in progress] == sorted(event[1] for event in progress)
    assert abs(progress[-1][1] - 0.8) < 1e-12


def test_mux_is_bounded_to_narration_duration_and_hides_windows_child(adapter, monkeypatch):
    calls = []

    def fake_run(command, **kwargs):
        calls.append((command, kwargs))
        return SimpleNamespace(returncode=0, stderr=b"")

    monkeypatch.setattr(adapter.subprocess, "run", fake_run)
    adapter._mux_audio(
        encoding=_encoding(),
        video=Path("C:/attempt/workspace/frames.mp4"),
        audio=Path("C:/attempt/inputs/narration.wav"),
        duration_seconds=8.001,
        output=Path("C:/attempt/output/presenter.mp4"),
    )
    command, options = calls[0]
    assert command[command.index("-t") + 1] == "8.001000000"
    assert "-shortest" in command
    assert command[command.index("-c:v") + 1] == "copy"
    assert command[command.index("-c:a") + 1] == "aac"
    assert options["timeout"] == 300
    assert options["creationflags"] == getattr(adapter.subprocess, "CREATE_NO_WINDOW", 0)


def test_run_job_uses_pinned_api_and_brokered_media_path(adapter, monkeypatch, tmp_path: Path):
    runtime = tmp_path / "runtime"
    for relative in adapter.REQUIRED_SOURCE_PATHS:
        path = runtime / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"# {relative}\n", encoding="utf-8")
    source_manifest = tmp_path / "source-manifest.json"
    source_manifest.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "root": str(runtime),
                "files": [
                    {"relativePath": relative, "sha256": "0" * 64}
                    for relative in adapter.REQUIRED_SOURCE_PATHS
                ],
            }
        ),
        encoding="utf-8",
    )

    checkpoints = runtime / "models" / "SoulX-FlashHead-1_3B"
    wav2vec = runtime / "models" / "wav2vec2-base-960h"
    role_paths = {
        "adapter-entrypoint": Path(adapter.__file__),
        "runtime-source-manifest": source_manifest,
        "flashhead-config": checkpoints / "Model_Pro" / "config.json",
        "flashhead-weights": checkpoints / "Model_Pro" / "diffusion_pytorch_model.safetensors",
        "vae-weights": checkpoints / "VAE_Wan" / "Wan2.1_VAE.pth",
        "audio-feature-config": wav2vec / "config.json",
        "audio-feature-preprocessor": wav2vec / "preprocessor_config.json",
        "audio-feature-weights": wav2vec / "model.safetensors",
    }
    for role, path in role_paths.items():
        if role not in {"adapter-entrypoint", "runtime-source-manifest"}:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(role.encode())

    attempt = tmp_path / "attempt"
    workspace = attempt / "workspace"
    output_root = attempt / "output"
    inputs = attempt / "inputs"
    workspace.mkdir(parents=True)
    output_root.mkdir()
    inputs.mkdir()
    portrait = inputs / "portrait.png"
    audio = inputs / "narration.wav"
    output = output_root / "presenter.mp4"
    portrait.write_bytes(b"portrait")
    audio.write_bytes(b"audio")
    events = []
    pipeline = object()
    inference = SimpleNamespace(
        get_pipeline=lambda **kwargs: pipeline,
        get_base_data=lambda selected, **kwargs: selected is pipeline,
        get_infer_params=lambda: {
            "sample_rate": 16_000,
            "tgt_fps": 25,
            "width": 4,
            "height": 4,
        },
        get_audio_embedding=object(),
        run_pipeline=object(),
    )
    fake_torch = SimpleNamespace(
        manual_seed=lambda _seed: None,
        cuda=SimpleNamespace(manual_seed_all=lambda _seed: None),
    )
    fake_numpy = SimpleNamespace(
        float32="float32",
        random=SimpleNamespace(seed=lambda _seed: None),
    )
    fake_librosa = SimpleNamespace(load=lambda *_args, **_kwargs: ([0.0] * 1_280, 16_000))
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "numpy", fake_numpy)
    monkeypatch.setitem(sys.modules, "librosa", fake_librosa)
    monkeypatch.setattr(adapter.importlib, "import_module", lambda name: inference)
    monkeypatch.setattr(
        adapter,
        "_generated_chunks",
        lambda **kwargs: [["frame-1", "frame-2"]],
    )

    encoded = []

    def fake_encode(frames, **kwargs):
        encoded.extend(frames)
        kwargs["output"].write_bytes(b"silent")

    def fake_mux(**kwargs):
        assert abs(kwargs["duration_seconds"] - 0.08) < 1e-12
        kwargs["output"].write_bytes(b"0" * 1_024)

    monkeypatch.setattr(adapter, "_write_video_frames", fake_encode)
    monkeypatch.setattr(adapter, "_mux_audio", fake_mux)
    job = {
        "model": "soulx-flashhead-pro",
        "seed": 42,
        "inputs": {"portrait": {"path": str(portrait)}, "audio": {"path": str(audio)}},
        "workspace": {"path": str(workspace)},
        "output": {"path": str(output)},
        "encoding": _encoding(),
        "workerContract": {
            "files": [{"role": role, "path": str(path)} for role, path in role_paths.items()]
        },
    }
    assert adapter.run_presenter_job(job, lambda *event: events.append(event)) == 0
    assert len(encoded) == 2
    assert output.stat().st_size == 1_024
    assert [event[0] for event in events] == [
        "model-loading",
        "inference",
        "encoding",
        "encoding",
    ]
    assert events[-1][1] == 0.96


def test_weight_roles_must_share_the_reviewed_layout(adapter, tmp_path: Path) -> None:
    root = tmp_path / "models" / "SoulX-FlashHead-1_3B"
    audio = tmp_path / "models" / "wav2vec2-base-960h"
    files = {
        "flashhead-config": root / "Model_Pro" / "config.json",
        "flashhead-weights": root / "Model_Pro" / "diffusion_pytorch_model.safetensors",
        "vae-weights": root / "VAE_Wan" / "Wan2.1_VAE.pth",
        "audio-feature-config": audio / "config.json",
        "audio-feature-preprocessor": audio / "preprocessor_config.json",
        "audio-feature-weights": audio / "model.safetensors",
    }
    for path in files.values():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"pinned")
    assert adapter._validate_weight_layout(files) == (root, audio)

    unrelated = tmp_path / "other" / "model.safetensors"
    unrelated.parent.mkdir()
    unrelated.write_bytes(b"unreviewed")
    files["audio-feature-weights"] = unrelated
    with pytest.raises(ValueError, match=r"reviewed model\.safetensors"):
        adapter._validate_weight_layout(files)
