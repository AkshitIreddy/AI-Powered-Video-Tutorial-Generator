from __future__ import annotations

import hashlib
import json
import subprocess
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest

from alystria.generation.forced_alignment import (
    AlignmentInput,
    ForcedAlignmentError,
    OnnxCtcRuntime,
    PinnedFile,
    PinnedOnnxCtcAligner,
)
from alystria.project import ProjectStore


def _hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class _Runner:
    def __init__(self, result: dict[str, Any]) -> None:
        self.result = result
        self.calls: list[tuple[str, ...]] = []

    def run(
        self, argv: Sequence[str], *, cwd: Path, timeout_seconds: int
    ) -> subprocess.CompletedProcess[bytes]:
        self.calls.append(tuple(argv))
        output = Path(argv[argv.index("--output") + 1])
        output.write_text(json.dumps(self.result), encoding="utf-8")
        return subprocess.CompletedProcess(argv, 0, b"", b"")


def _runtime(root: Path) -> OnnxCtcRuntime:
    pins = []
    for name in ("python.exe", "worker.py", "model.onnx", "vocab.json"):
        path = root / name
        path.write_bytes(name.encode())
        pins.append(PinnedFile(path, _hash(path)))
    return OnnxCtcRuntime(root, *pins)


def test_pinned_onnx_ctc_aligner_runs_one_batch_and_normalizes_metadata(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    runtime_root.mkdir()
    runner = _Runner(
        {
            "results": [
                {
                    "sceneId": "scene-one",
                    "words": [
                        {"word": "Measured", "startMs": 40, "endMs": 380, "confidence": 0.92},
                        {"word": "speech", "startMs": 410, "endMs": 840, "confidence": 0.88},
                    ],
                }
            ]
        }
    )
    with ProjectStore.create(tmp_path / "project", name="Alignment") as store:
        aligner = PinnedOnnxCtcAligner(store, _runtime(runtime_root), runner=runner)
        result = aligner.align_batch(
            [AlignmentInput("scene-one", b"RIFF", "audio/wav", "Measured speech", "en-US", 900)]
        )

    assert len(runner.calls) == 1
    assert result["scene-one"]["alignmentSource"] == "forced-alignment"
    assert result["scene-one"]["alignmentEngine"] == "onnx-ctc-v1"
    assert result["scene-one"]["wordTimings"][-1]["endMs"] == 840


def test_pinned_onnx_ctc_aligner_rejects_out_of_bounds_result(tmp_path: Path) -> None:
    runtime_root = tmp_path / "runtime"
    runtime_root.mkdir()
    runner = _Runner(
        {
            "results": [
                {
                    "sceneId": "scene-one",
                    "words": [
                        {"word": "Speech", "startMs": 0, "endMs": 2_000, "confidence": 0.9}
                    ],
                }
            ]
        }
    )
    with ProjectStore.create(tmp_path / "project", name="Alignment") as store:
        aligner = PinnedOnnxCtcAligner(store, _runtime(runtime_root), runner=runner)
        with pytest.raises(ForcedAlignmentError, match="word timing"):
            aligner.align_batch(
                [AlignmentInput("scene-one", b"RIFF", "audio/wav", "Speech", "en-US", 900)]
            )
