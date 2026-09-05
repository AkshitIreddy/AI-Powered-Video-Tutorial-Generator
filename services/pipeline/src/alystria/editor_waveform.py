"""Cached, content-addressed editor waveform derivatives."""

from __future__ import annotations

import hashlib
import json
import math
import os
import subprocess
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from .project import ProjectStore

EDITOR_WAVEFORM_VERSION = 2
EDITOR_TIMEBASE_HZ = 240_000
SHA256 = frozenset("0123456789abcdef")


class EditorWaveformError(ValueError):
    """The requested waveform cannot be derived safely."""


class WaveformRunner(Protocol):
    def run(self, argv: Sequence[str], *, timeout_seconds: float) -> str: ...


class SubprocessWaveformRunner:
    def run(self, argv: Sequence[str], *, timeout_seconds: float) -> str:
        try:
            completed = subprocess.run(
                tuple(argv),
                stdin=subprocess.DEVNULL,
                capture_output=True,
                check=False,
                shell=False,
                timeout=timeout_seconds,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise EditorWaveformError(f"Waveform analysis could not run: {error}") from error
        if completed.returncode != 0:
            detail = completed.stderr.decode("utf-8", errors="replace")[-1600:].strip()
            raise EditorWaveformError(f"Waveform analysis failed: {detail or f'exit {completed.returncode}'}")
        return completed.stdout.decode("utf-8", errors="strict").strip()


@dataclass(frozen=True, slots=True)
class WaveformProfile:
    width: int = 2048
    height: int = 72


def _dimension(value: object, label: str, *, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise EditorWaveformError(f"{label} must be an integer from {minimum} through {maximum}")
    return value


def parse_waveform_profile(value: object) -> WaveformProfile:
    if value is None:
        return WaveformProfile()
    if not isinstance(value, Mapping):
        raise EditorWaveformError("profile must be an object")
    unexpected = set(value) - {"width", "height"}
    if unexpected:
        raise EditorWaveformError(f"Unsupported waveform profile fields: {', '.join(sorted(unexpected))}")
    return WaveformProfile(
        width=_dimension(value.get("width", 2048), "profile.width", minimum=256, maximum=4096),
        height=_dimension(value.get("height", 72), "profile.height", minimum=32, maximum=256),
    )


def _png_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()[:24]
    if len(data) != 24 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise EditorWaveformError("FFmpeg did not produce a valid PNG waveform")
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def _registered_media(store: ProjectStore, digest: str) -> tuple[str, int]:
    if len(digest) != 64 or any(character not in SHA256 for character in digest):
        raise EditorWaveformError("artifactHash must be 64 lowercase hexadecimal characters")
    row = store.connection.execute("SELECT media_type,byte_size FROM artifacts WHERE hash=?", (digest,)).fetchone()
    if row is None:
        raise EditorWaveformError("artifactHash is not registered in this project")
    media_type = str(row["media_type"])
    if not (media_type.startswith("audio/") or media_type.startswith("video/")):
        raise EditorWaveformError("Waveforms require a registered audio or video artifact")
    if not store.cas.verify(digest):
        raise EditorWaveformError("Registered waveform source is missing or corrupt")
    return media_type, int(row["byte_size"])


def _cache_key(digest: str, profile: WaveformProfile) -> str:
    value = f"editor-waveform-v{EDITOR_WAVEFORM_VERSION}:{digest}:{profile.width}x{profile.height}"
    return hashlib.sha256(value.encode("ascii")).hexdigest()


def _positive_duration(value: object) -> float | None:
    if not isinstance(value, (int, float, str)) or isinstance(value, bool):
        return None
    try:
        duration = float(value)
    except ValueError:
        return None
    return duration if math.isfinite(duration) and duration > 0 else None


def _timecode_duration(value: object) -> float | None:
    if not isinstance(value, str):
        return None
    parts = value.split(":")
    if len(parts) != 3:
        return None
    try:
        hours, minutes, seconds = int(parts[0]), int(parts[1]), float(parts[2])
    except ValueError:
        return None
    if hours < 0 or not 0 <= minutes < 60 or not 0 <= seconds < 60:
        return None
    return _positive_duration((hours * 3600) + (minutes * 60) + seconds)


def _duration_from_timebase(stream: Mapping[str, Any]) -> float | None:
    duration_ticks = _positive_duration(stream.get("duration_ts"))
    time_base = stream.get("time_base")
    if duration_ticks is None or not isinstance(time_base, str):
        return None
    parts = time_base.split("/")
    if len(parts) != 2:
        return None
    try:
        numerator, denominator = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if numerator <= 0 or denominator <= 0:
        return None
    return _positive_duration(duration_ticks * numerator / denominator)


def _audio_duration_seconds(
    runner: WaveformRunner,
    ffprobe_path: Path,
    source_path: Path,
    *,
    timeout_seconds: float,
) -> float:
    probe_text = runner.run(
        (
            str(ffprobe_path),
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=duration,duration_ts,time_base:stream_tags=DURATION:format=duration",
            "-of",
            "json",
            str(source_path),
        ),
        timeout_seconds=min(timeout_seconds, 30),
    )
    try:
        probe = json.loads(probe_text)
    except json.JSONDecodeError as error:
        raise EditorWaveformError("Audio stream duration is unavailable for waveform alignment") from error
    if not isinstance(probe, Mapping):
        raise EditorWaveformError("Audio stream duration is unavailable for waveform alignment")
    streams = probe.get("streams")
    if not isinstance(streams, list) or not streams or not isinstance(streams[0], Mapping):
        raise EditorWaveformError("Waveforms require a decodable audio stream")
    stream = streams[0]
    tags = stream.get("tags")
    tagged_duration = _timecode_duration(tags.get("DURATION")) if isinstance(tags, Mapping) else None
    stream_duration = (
        _positive_duration(stream.get("duration"))
        or _duration_from_timebase(stream)
        or tagged_duration
    )
    format_record = probe.get("format")
    format_duration = _positive_duration(format_record.get("duration")) if isinstance(format_record, Mapping) else None
    duration_seconds = stream_duration or format_duration
    if duration_seconds is None:
        raise EditorWaveformError("Audio stream duration is unavailable for waveform alignment")
    if duration_seconds > 14_400:
        raise EditorWaveformError("Waveform audio duration must be no longer than four hours")
    return duration_seconds


def _cached_receipt(store: ProjectStore, digest: str, profile: WaveformProfile, index_path: Path) -> dict[str, Any] | None:
    try:
        record = json.loads(index_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(record, dict) or record.get("sourceHash") != digest or record.get("width") != profile.width or record.get("height") != profile.height:
        return None
    waveform_hash = record.get("waveformHash")
    duration_ticks = record.get("durationTicks")
    if not isinstance(waveform_hash, str) or not isinstance(duration_ticks, int) or duration_ticks <= 0 or not store.cas.verify(waveform_hash):
        return None
    row = store.connection.execute("SELECT media_type FROM artifacts WHERE hash=?", (waveform_hash,)).fetchone()
    if row is None or row["media_type"] != "image/png":
        return None
    waveform_path = store.cas.object_path(waveform_hash).resolve(strict=True)
    if _png_dimensions(waveform_path) != (profile.width, profile.height):
        return None
    return {
        "projectId": store.manifest.project_id,
        "artifactHash": digest,
        "profile": {"width": profile.width, "height": profile.height},
        "waveformHash": waveform_hash,
        "waveformPath": str(waveform_path),
        "mediaType": "image/png",
        "width": profile.width,
        "height": profile.height,
        "durationTicks": duration_ticks,
    }


def render_editor_waveform(
    store: ProjectStore,
    artifact_hash: str,
    *,
    ffmpeg_path: Path,
    profile: WaveformProfile | None = None,
    runner: WaveformRunner | None = None,
    timeout_seconds: float = 120,
) -> dict[str, Any]:
    """Return a cached waveform PNG for one verified project media object."""

    if timeout_seconds <= 0:
        raise EditorWaveformError("Waveform timeout must be positive")
    profile = profile or WaveformProfile()
    _registered_media(store, artifact_hash)
    source_path = store.cas.object_path(artifact_hash).resolve(strict=True)
    cache_root = (store.root / "cache" / "editor-waveforms").resolve()
    cache_root.mkdir(parents=True, exist_ok=True)
    cache_key = _cache_key(artifact_hash, profile)
    index_path = cache_root / f"{cache_key}.json"
    cached = _cached_receipt(store, artifact_hash, profile, index_path)
    if cached is not None:
        return cached

    selected_runner = runner or SubprocessWaveformRunner()
    ffprobe_path = ffmpeg_path.with_name("ffprobe.exe" if ffmpeg_path.suffix.lower() == ".exe" else "ffprobe")
    duration_seconds = _audio_duration_seconds(
        selected_runner,
        ffprobe_path,
        source_path,
        timeout_seconds=timeout_seconds,
    )

    temporary = cache_root / f".{cache_key}-{uuid.uuid4().hex}.png"
    try:
        selected_runner.run(
            (
                str(ffmpeg_path), "-hide_banner", "-nostdin", "-y", "-i", str(source_path),
                "-filter_complex", f"aformat=channel_layouts=mono,showwavespic=s={profile.width}x{profile.height}:colors=0xEDE9FE:scale=lin",
                "-frames:v", "1", "-c:v", "png", str(temporary),
            ),
            timeout_seconds=timeout_seconds,
        )
        if _png_dimensions(temporary) != (profile.width, profile.height):
            raise EditorWaveformError("Waveform dimensions do not match the requested profile")
        artifact = store.cas.add_file(
            temporary,
            media_type="image/png",
            original_name=f"waveform-{artifact_hash[:12]}-{profile.width}x{profile.height}.png",
            metadata={"role": "editor-waveform", "sourceHash": artifact_hash, "width": profile.width, "height": profile.height, "version": EDITOR_WAVEFORM_VERSION},
            max_bytes=4 * 1024 * 1024,
        )
        store.register_artifact(artifact)
        duration_ticks = round(duration_seconds * EDITOR_TIMEBASE_HZ)
        index = {"version": EDITOR_WAVEFORM_VERSION, "sourceHash": artifact_hash, "waveformHash": artifact.hash, "width": profile.width, "height": profile.height, "durationTicks": duration_ticks}
        temporary_index = index_path.with_suffix(f".{uuid.uuid4().hex}.tmp")
        with temporary_index.open("w", encoding="utf-8", newline="\n") as stream:
            json.dump(index, stream, sort_keys=True, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_index, index_path)
        result = _cached_receipt(store, artifact_hash, profile, index_path)
        if result is None:
            raise EditorWaveformError("Waveform cache verification failed")
        return result
    finally:
        temporary.unlink(missing_ok=True)
