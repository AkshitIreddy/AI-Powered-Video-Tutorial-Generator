from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest

from alystria.generation.forced_alignment import (
    AlignmentInput,
    DeferredPinnedOnnxCtcAligner,
    ForcedAlignmentError,
    OnnxCtcRuntime,
    PinnedFile,
    PinnedOnnxCtcAligner,
)
from alystria.generation.spoken_text import normalize_spoken_text
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
    return OnnxCtcRuntime(root, pins[0], pins[1], pins[2], pins[3])


def _invalid_config(root: Path) -> Path:
    root.mkdir()
    entries: dict[str, dict[str, str]] = {}
    for key, relative in (
        ("python", "python.exe"),
        ("worker", "worker.py"),
        ("model", "model.onnx"),
        ("vocab", "vocab.json"),
    ):
        path = root / relative
        path.write_bytes(key.encode())
        entries[key] = {"relativePath": relative, "sha256": _hash(path)}
    entries["worker"]["sha256"] = "0" * 64
    config = root / "alignment-runtime.json"
    config.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "runtimeRoot": str(root),
                "timeoutSeconds": 60,
                **entries,
            }
        ),
        encoding="utf-8",
    )
    return config


def test_deferred_aligner_validates_runtime_only_when_alignment_is_requested(
    tmp_path: Path,
) -> None:
    with ProjectStore.create(tmp_path / "project", name="Deferred alignment") as store:
        aligner = DeferredPinnedOnnxCtcAligner(store, _invalid_config(tmp_path / "runtime"))

        with pytest.raises(ForcedAlignmentError, match="worker pin is invalid"):
            aligner.align_batch(
                [AlignmentInput("scene-one", b"RIFF", "audio/wav", "spoken text", "en-US", 900)]
            )


def _worker_module() -> Any:
    worker_path = Path(__file__).parents[2] / "scripts" / "onnx_ctc_forced_aligner.py"
    spec = importlib.util.spec_from_file_location("alystria_test_ctc_worker", worker_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_worker_rejects_unexpanded_math_instead_of_silently_changing_the_transcript() -> None:
    worker = _worker_module()
    vocab = {character: index for index, character in enumerate("abcdefghijklmnopqrstuvwxyz|")}

    with pytest.raises(ValueError, match="cannot be represented"):
        worker._normalized_words("O(n^2) 1234", vocab)

    spoken = normalize_spoken_text("O(n^2) + 1234 = 50%", locale="en-US").spoken_text
    originals, targets = worker._normalized_words(spoken, vocab)
    assert originals == spoken.split()
    assert len(targets) == len(originals)
    assert all(target and target.isalpha() for target in targets)


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
                    "words": [{"word": "Speech", "startMs": 0, "endMs": 2_000, "confidence": 0.9}],
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
