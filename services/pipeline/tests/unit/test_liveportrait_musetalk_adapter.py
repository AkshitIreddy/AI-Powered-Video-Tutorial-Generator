from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest


ADAPTER = (
    Path(__file__).parents[2] / "scripts" / "liveportrait_musetalk_adapter.py"
)


def _load_adapter() -> Any:
    spec = importlib.util.spec_from_file_location("tested_hybrid_adapter", ADAPTER)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_hybrid_adapter_animates_before_lip_sync(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    adapter = _load_adapter()
    liveportrait_root = tmp_path / "liveportrait"
    liveportrait_root.mkdir()
    manifest = tmp_path / "liveportrait-manifest.json"
    manifest.write_text(
        json.dumps({"schemaVersion": 1, "root": str(liveportrait_root), "files": [{}]}),
        encoding="utf-8",
    )
    template = tmp_path / "natural-idle.pkl"
    template.write_bytes(b"pinned motion template")
    musetalk_adapter = tmp_path / "musetalk-adapter.py"
    musetalk_adapter.write_text("# pinned by worker\n", encoding="utf-8")
    portrait = tmp_path / "portrait.webp"
    portrait.write_bytes(b"portrait")
    audio = tmp_path / "narration.wav"
    audio.write_bytes(b"audio")
    output_dir = tmp_path / "attempt" / "output"
    workspace = tmp_path / "attempt" / "workspace"
    output_dir.mkdir(parents=True)
    workspace.mkdir()
    output = output_dir / "presenter.mp4"
    animated = workspace / "liveportrait-results" / "portrait--natural-idle.mp4"
    calls: list[str] = []

    def animate(**kwargs: Any) -> Path:
        assert kwargs["source_root"] == liveportrait_root
        assert kwargs["portrait"] == portrait
        assert kwargs["motion_template"] == template
        assert kwargs["device_id"] == 0
        kwargs["output_dir"].mkdir(exist_ok=True)
        animated.write_bytes(b"real locally animated video")
        calls.append("motion")
        return animated

    def lips(job: dict[str, Any], _emit: Any) -> int:
        calls.append("lips")
        staged = job["inputs"]["portrait"]
        assert staged["path"] == str(animated)
        assert staged["mediaType"] == "video/mp4"
        assert staged["sha256"] == hashlib.sha256(animated.read_bytes()).hexdigest()
        output.write_bytes(b"final presenter video")
        return 0

    monkeypatch.setattr(adapter, "_run_liveportrait", animate)
    monkeypatch.setattr(
        adapter,
        "_load_module",
        lambda path, _name: SimpleNamespace(run_presenter_job=lips)
        if path == musetalk_adapter
        else pytest.fail("unexpected module"),
    )
    progress: list[tuple[str, float, str]] = []
    job = {
        "model": "liveportrait-musetalk-1.5",
        "inputs": {
            "portrait": {"path": str(portrait)},
            "audio": {"path": str(audio)},
        },
        "output": {"path": str(output)},
        "gpuLease": {"deviceId": "cuda:0"},
        "workerContract": {
            "files": [
                {"role": "liveportrait-runtime-manifest", "path": str(manifest)},
                {"role": "liveportrait-motion-template", "path": str(template)},
                {"role": "musetalk-adapter-entrypoint", "path": str(musetalk_adapter)},
            ]
        },
    }

    assert adapter.run_presenter_job(job, lambda *event: progress.append(event)) == 0
    assert calls == ["motion", "lips"]
    assert progress == [
        (
            "inference",
            0.12,
            "Animating native gaze, blink, expression and pose",
        )
    ]


def test_hybrid_adapter_rejects_the_wrong_model() -> None:
    adapter = _load_adapter()
    with pytest.raises(RuntimeError, match="wrong model identity"):
        adapter.run_presenter_job({"model": "musetalk-1.5"}, lambda *_: None)
