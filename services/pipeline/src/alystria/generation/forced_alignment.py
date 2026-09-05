"""Pinned local CTC forced alignment for narration without native timestamps."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from alystria.project import ProjectStore

SHA256_PATTERN = __import__("re").compile(r"^[0-9a-f]{64}$")
MAX_ALIGNMENT_AUDIO_BYTES = 512 * 1024 * 1024
MAX_ALIGNMENT_OUTPUT_BYTES = 8 * 1024 * 1024


class ForcedAlignmentError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class AlignmentInput:
    scene_id: str
    audio: bytes
    media_type: str
    text: str
    locale: str
    duration_ms: int


class ForcedAlignmentClient(Protocol):
    def align_batch(self, values: Sequence[AlignmentInput]) -> dict[str, dict[str, Any]]: ...


@dataclass(frozen=True, slots=True)
class PinnedFile:
    path: Path
    sha256: str


@dataclass(frozen=True, slots=True)
class OnnxCtcRuntime:
    root: Path
    python: PinnedFile
    worker: PinnedFile
    model: PinnedFile
    vocab: PinnedFile
    timeout_seconds: int = 900


class AlignmentRunner(Protocol):
    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        timeout_seconds: int,
    ) -> subprocess.CompletedProcess[bytes]: ...


class SubprocessAlignmentRunner:
    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        timeout_seconds: int,
    ) -> subprocess.CompletedProcess[bytes]:
        flags = int(getattr(subprocess, "CREATE_NO_WINDOW", 0)) if os.name == "nt" else 0
        return subprocess.run(
            list(argv),
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=timeout_seconds,
            check=False,
            shell=False,
            creationflags=flags,
            env={
                key: value
                for key, value in os.environ.items()
                if key in {"SYSTEMROOT", "WINDIR", "TEMP", "TMP"}
            },
        )


class PinnedOnnxCtcAligner:
    """Run one CPU model load for every narration batch and validate all output."""

    def __init__(
        self,
        store: ProjectStore,
        runtime: OnnxCtcRuntime,
        *,
        runner: AlignmentRunner | None = None,
    ) -> None:
        self.store = store
        self.runtime = runtime
        self.runner = runner or SubprocessAlignmentRunner()
        self._verify_runtime()

    def align_batch(self, values: Sequence[AlignmentInput]) -> dict[str, dict[str, Any]]:
        if not values:
            return {}
        if len(values) > 200 or len({item.scene_id for item in values}) != len(values):
            raise ForcedAlignmentError("Alignment batch has invalid or duplicate scene IDs")
        staging_root = self.store.root / "staging" / "alignment"
        staging_root.mkdir(parents=True, exist_ok=True)
        work = Path(tempfile.mkdtemp(prefix="attempt-", dir=staging_root))
        try:
            items: list[dict[str, Any]] = []
            total_bytes = 0
            for index, item in enumerate(values):
                if item.media_type not in {"audio/wav", "audio/x-wav"}:
                    raise ForcedAlignmentError("Pinned CTC alignment currently requires PCM WAV narration")
                if not item.text.strip() or not item.locale.casefold().startswith("en"):
                    raise ForcedAlignmentError("Pinned English CTC alignment requires English narration text")
                if item.duration_ms <= 0:
                    raise ForcedAlignmentError("Alignment input duration must be positive")
                total_bytes += len(item.audio)
                if total_bytes > MAX_ALIGNMENT_AUDIO_BYTES:
                    raise ForcedAlignmentError("Alignment batch exceeds its audio size limit")
                audio_name = f"{index:04d}.wav"
                (work / audio_name).write_bytes(item.audio)
                items.append(
                    {
                        "sceneId": item.scene_id,
                        "audioPath": audio_name,
                        "text": item.text,
                        "durationMs": item.duration_ms,
                    }
                )
            request_path = work / "request.json"
            output_path = work / "result.json"
            request_path.write_text(
                json.dumps({"schemaVersion": 1, "items": items}, ensure_ascii=False),
                encoding="utf-8",
            )
            completed = self.runner.run(
                (
                    str(self.runtime.python.path),
                    str(self.runtime.worker.path),
                    "--model",
                    str(self.runtime.model.path),
                    "--vocab",
                    str(self.runtime.vocab.path),
                    "--request",
                    str(request_path),
                    "--output",
                    str(output_path),
                ),
                cwd=work,
                timeout_seconds=self.runtime.timeout_seconds,
            )
            if completed.returncode != 0:
                detail = completed.stderr.decode("utf-8", errors="replace")[-4_096:]
                raise ForcedAlignmentError(f"Pinned CTC aligner failed: {detail}")
            if (
                not output_path.is_file()
                or output_path.is_symlink()
                or output_path.stat().st_size > MAX_ALIGNMENT_OUTPUT_BYTES
            ):
                raise ForcedAlignmentError("Pinned CTC aligner returned no safe bounded result")
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            return self._validate_result(values, payload)
        except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
            raise ForcedAlignmentError(f"Pinned CTC alignment could not complete: {error}") from error
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def _validate_result(
        self, values: Sequence[AlignmentInput], payload: Any
    ) -> dict[str, dict[str, Any]]:
        results = payload.get("results") if isinstance(payload, dict) else None
        if not isinstance(results, list) or len(results) != len(values):
            raise ForcedAlignmentError("Pinned CTC aligner returned an incomplete batch")
        expected = {item.scene_id: item for item in values}
        normalized: dict[str, dict[str, Any]] = {}
        for result in results:
            if not isinstance(result, dict) or result.get("sceneId") not in expected:
                raise ForcedAlignmentError("Pinned CTC aligner returned an unknown scene")
            scene_id = str(result["sceneId"])
            if scene_id in normalized:
                raise ForcedAlignmentError("Pinned CTC aligner duplicated a scene")
            words = result.get("words")
            if not isinstance(words, list):
                raise ForcedAlignmentError("Pinned CTC aligner omitted word intervals")
            previous_end = 0
            validated_words: list[dict[str, Any]] = []
            for word in words:
                if not isinstance(word, dict):
                    raise ForcedAlignmentError("Pinned CTC aligner returned a malformed word")
                token = word.get("word")
                start = word.get("startMs")
                end = word.get("endMs")
                confidence = word.get("confidence")
                if (
                    not isinstance(token, str)
                    or not token.strip()
                    or not isinstance(start, int)
                    or isinstance(start, bool)
                    or not isinstance(end, int)
                    or isinstance(end, bool)
                    or start < previous_end
                    or end <= start
                    or end > expected[scene_id].duration_ms + 120
                    or not isinstance(confidence, (int, float))
                    or isinstance(confidence, bool)
                    or not 0 <= float(confidence) <= 1
                ):
                    raise ForcedAlignmentError("Pinned CTC word timing is invalid")
                previous_end = end
                validated_words.append({"word": token, "startMs": start, "endMs": end})
            normalized[scene_id] = {
                "wordTimings": validated_words,
                "alignmentSource": "forced-alignment",
                "alignmentEngine": "onnx-ctc-v1",
                "alignmentModelSha256": self.runtime.model.sha256,
            }
        return normalized

    def _verify_runtime(self) -> None:
        root = self.runtime.root.resolve(strict=True)
        if not root.is_dir() or root.is_symlink():
            raise ForcedAlignmentError("Forced-alignment runtime root is unsafe")
        for label, pinned in (
            ("python", self.runtime.python),
            ("worker", self.runtime.worker),
            ("model", self.runtime.model),
            ("vocab", self.runtime.vocab),
        ):
            path = pinned.path.resolve(strict=True)
            try:
                path.relative_to(root)
            except ValueError as error:
                raise ForcedAlignmentError(f"Forced-alignment {label} escapes runtime root") from error
            if path.is_symlink() or not path.is_file() or _hash_file(path) != pinned.sha256:
                raise ForcedAlignmentError(f"Forced-alignment {label} pin is invalid")


class DeferredPinnedOnnxCtcAligner:
    """Load and verify the optional runtime only when untimed speech needs it.

    Desktop workers serve unrelated imports, editor exports, visual searches,
    and pre-approval generation stages. A stale optional model pin must not
    disable those queues, while narration still fails inside its durable task
    attempt before any timing can be certified.
    """

    def __init__(self, store: ProjectStore, config_path: Path) -> None:
        self.store = store
        self.config_path = config_path

    def align_batch(self, values: Sequence[AlignmentInput]) -> dict[str, dict[str, Any]]:
        return load_pinned_onnx_ctc_aligner(self.store, self.config_path).align_batch(values)


def load_pinned_onnx_ctc_aligner(
    store: ProjectStore, config_path: Path
) -> PinnedOnnxCtcAligner:
    value = json.loads(config_path.read_text(encoding="utf-8"))
    if not isinstance(value, Mapping) or value.get("schemaVersion") != 1:
        raise ForcedAlignmentError("Forced-alignment config schema is invalid")
    root = Path(_string(value, "runtimeRoot")).resolve(strict=True)

    def pinned(name: str) -> PinnedFile:
        item = value.get(name)
        if not isinstance(item, Mapping):
            raise ForcedAlignmentError(f"Forced-alignment config {name} is invalid")
        relative = Path(_string(item, "relativePath"))
        if relative.is_absolute() or ".." in relative.parts:
            raise ForcedAlignmentError(f"Forced-alignment config {name} path is unsafe")
        digest = _string(item, "sha256")
        if not SHA256_PATTERN.fullmatch(digest):
            raise ForcedAlignmentError(f"Forced-alignment config {name} hash is invalid")
        return PinnedFile(root / relative, digest)

    timeout = value.get("timeoutSeconds", 900)
    if not isinstance(timeout, int) or isinstance(timeout, bool) or not 30 <= timeout <= 3_600:
        raise ForcedAlignmentError("Forced-alignment timeout must be between 30 and 3600 seconds")
    return PinnedOnnxCtcAligner(
        store,
        OnnxCtcRuntime(root, pinned("python"), pinned("worker"), pinned("model"), pinned("vocab"), timeout),
    )


def _string(value: Mapping[str, Any], key: str) -> str:
    item = value.get(key)
    if not isinstance(item, str) or not item.strip() or "\x00" in item:
        raise ForcedAlignmentError(f"Forced-alignment config {key} is invalid")
    return item


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()
