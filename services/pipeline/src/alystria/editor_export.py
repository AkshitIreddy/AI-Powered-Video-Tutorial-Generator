"""Deterministic FFmpeg export for validated editor timeline manifests.

The browser contract carries only content-addressed artifact hashes. This module
resolves those hashes through the project CAS, prepares programme audio, then
renders visuals with shell-free FFmpeg commands. Unsupported features fail closed.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import subprocess
import time
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path
from typing import Any, Protocol

from .project import ProjectStore

EDITOR_RENDER_SCHEMA = "alystria.editor.render.v1"
EDITOR_EXPORT_IMPLEMENTATION_VERSION = "editor-export-v5-caption-line-endings"
EDITOR_TIMEBASE_HZ = 240_000
SUPPORTED_CODECS = frozenset(
    {"vp9", "av1", "h264_nvenc", "h264_mf", "libx264", "hevc_nvenc"}
)
VISUAL_KINDS = frozenset({"slides", "presenter"})
TEXT_KINDS = frozenset({"titles", "captions"})
AUDIO_KINDS = frozenset({"narration", "music", "sfx"})
SHA256 = re.compile(r"^[0-9a-f]{64}$")
BITRATE = re.compile(r"^[1-9][0-9]*(?:k|M|G)$")
KEYFRAME_PROPERTIES = frozenset(
    {"transform.x", "transform.y", "transform.scaleX", "transform.scaleY", "transform.rotation", "opacity", "audio.volumeDb"}
)
KEYFRAME_INTERPOLATIONS = frozenset({"hold", "linear", "ease-in", "ease-out", "ease-in-out"})


class EditorExportError(ValueError):
    """The timeline cannot be rendered without changing its meaning."""


def _hidden_creation_flags() -> int:
    return int(getattr(subprocess, "CREATE_NO_WINDOW", 0)) if os.name == "nt" else 0


class EditorExportRunner(Protocol):
    def run(self, argv: Sequence[str], *, timeout_seconds: float) -> None: ...


class EditorMediaProbe(Protocol):
    def has_audio_stream(self, source_path: Path, *, ffprobe_path: Path, timeout_seconds: float) -> bool: ...


class SubprocessEditorMediaProbe:
    def has_audio_stream(self, source_path: Path, *, ffprobe_path: Path, timeout_seconds: float) -> bool:
        try:
            completed = subprocess.run(
                (
                    str(ffprobe_path),
                    "-v", "error",
                    "-select_streams", "a:0",
                    "-show_entries", "stream=index",
                    "-of", "json",
                    str(source_path),
                ),
                stdin=subprocess.DEVNULL,
                capture_output=True,
                check=False,
                shell=False,
                timeout=timeout_seconds,
                creationflags=_hidden_creation_flags(),
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise EditorExportError(f"Editor source-audio inspection could not run: {error}") from error
        if completed.returncode != 0:
            detail = completed.stderr.decode("utf-8", errors="replace")[-1600:].strip()
            raise EditorExportError(f"Editor source-audio inspection failed: {detail or f'exit {completed.returncode}'}")
        try:
            payload = json.loads(completed.stdout.decode("utf-8", errors="strict"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise EditorExportError("Editor source-audio inspection returned invalid JSON") from error
        streams = payload.get("streams") if isinstance(payload, Mapping) else None
        if not isinstance(streams, list):
            raise EditorExportError("Editor source-audio inspection returned no stream list")
        return bool(streams)


class SubprocessEditorExportRunner:
    def __init__(self, cancel_check: Callable[[], bool] | None = None) -> None:
        self.cancel_check = cancel_check or (lambda: False)

    def run(self, argv: Sequence[str], *, timeout_seconds: float) -> None:
        # Share renderer lifetime ownership so cancellation also stops any
        # descendants and cannot leave output-pipe readers waiting indefinitely.
        from .generation.renderer_client import RendererClientError, SubprocessCommandRunner

        try:
            completed = SubprocessCommandRunner().run(
                argv,
                cwd=Path.cwd(),
                timeout_seconds=timeout_seconds,
                cancelled=self.cancel_check,
            )
        except RendererClientError as error:
            raise EditorExportError(f"FFmpeg editor export could not run: {error}") from error
        if completed.exit_code != 0:
            detail = completed.stderr[-2000:].strip()
            raise EditorExportError(f"FFmpeg editor export failed: {detail or f'exit {completed.exit_code}'}")


def verify_editor_delivery(
    output_path: Path, *, ffmpeg_path: Path, duration_seconds: float, fps: float,
    timeout_seconds: float, cancel_check: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Decode both streams before promotion; container duration can conceal short audio."""
    from .generation.renderer_client import RendererClientError, SubprocessCommandRunner

    try:
        completed = SubprocessCommandRunner().run(
            (
                str(ffmpeg_path), "-hide_banner", "-nostdin", "-nostats", "-xerror",
                "-progress", "pipe:1", "-i", str(output_path),
                "-map", "0:v:0", "-map", "0:a:0", "-af",
                "aresample=48000,aformat=sample_fmts=flt,astats=reset=0:measure_perchannel=none:"
                "measure_overall=Peak_level+Number_of_samples+Number_of_NaNs+Number_of_Infs",
                "-fps_mode", "passthrough", "-f", "null", "-",
            ),
            cwd=output_path.parent, timeout_seconds=timeout_seconds,
            cancelled=cancel_check or (lambda: False),
        )
    except RendererClientError as error:
        raise EditorExportError(f"Editor delivery verification could not run: {error}") from error
    if completed.exit_code != 0:
        raise EditorExportError(f"Editor delivery could not be decoded: {completed.stderr[-1600:]}")

    def metric(label: str) -> float:
        matches = re.findall(rf"{re.escape(label)}: ([^\s]+)", completed.stderr)
        try:
            return float(matches[-1])
        except (IndexError, ValueError) as error:
            raise EditorExportError(f"Editor delivery verification omitted {label}") from error

    samples = metric("Number of samples")
    peak_db = metric("Peak level dB")
    if not math.isfinite(samples) or samples <= 0:
        raise EditorExportError("Editor delivery has no decoded audio samples")
    audio_seconds = samples / 48000
    # AAC may include one padded audio frame; allow at most one video frame
    # or 25 ms, while still rejecting truncated streams and missing long gaps.
    if abs(audio_seconds - duration_seconds) > max(1 / fps, 0.025) + 1e-6:
        raise EditorExportError(
            f"Editor delivery audio lasts {audio_seconds:.3f}s; expected {duration_seconds:.3f}s"
        )
    if metric("Number of NaNs") or metric("Number of Infs") or math.isnan(peak_db):
        raise EditorExportError("Editor delivery contains invalid audio samples")
    if peak_db >= 0:
        raise EditorExportError("Editor delivery audio clips; lower clip or track volume before exporting")
    frames = re.findall(r"(?m)^frame=\s*(\d+)", completed.stdout)
    if not frames or "progress=end" not in completed.stdout:
        raise EditorExportError("Editor delivery verification did not finish decoding video")
    decoded_frames = int(frames[-1])
    if abs(decoded_frames - duration_seconds * fps) > 1 + 1e-6:
        raise EditorExportError("Editor delivery video frame count does not match the timeline")
    return {
        "decodedVideoFrames": decoded_frames, "decodedAudioSamples": int(samples),
        "audioSampleRate": 48000, "audioDurationSeconds": audio_seconds,
        "audioPeakDbfs": peak_db if math.isfinite(peak_db) else None,
    }


@dataclass(frozen=True, slots=True)
class EditorExportPlan:
    argv: tuple[str, ...]
    audio_argv: tuple[str, ...]
    output_path: Path
    manifest_hash: str
    duration_ticks: int
    codec: str
    media_type: str
    warnings: tuple[str, ...]


def _mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise EditorExportError(f"{label} must be an object")
    return value


def _list(value: object, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise EditorExportError(f"{label} must be an array")
    return value


def _string(value: object, label: str, *, maximum: int = 512) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum or "\x00" in value:
        raise EditorExportError(f"{label} must be a non-empty string of at most {maximum} characters")
    return value


def _number(value: object, label: str, *, minimum: float | None = None, maximum: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise EditorExportError(f"{label} must be a finite number")
    result = float(value)
    if (minimum is not None and result < minimum) or (maximum is not None and result > maximum):
        raise EditorExportError(f"{label} is outside the supported range")
    return result


def _integer(value: object, label: str, *, minimum: int = 0) -> int:
    number = _number(value, label, minimum=float(minimum))
    if not number.is_integer():
        raise EditorExportError(f"{label} must be an integer")
    return int(number)


def _seconds(ticks: int) -> str:
    return f"{ticks / EDITOR_TIMEBASE_HZ:.9f}".rstrip("0").rstrip(".")


def _filter_path(path: Path) -> str:
    # FFmpeg filter option escaping is separate from shell escaping. argv never
    # enters a shell; this protects the filter parser's drive colon and quotes.
    return str(path.resolve()).replace("\\", "/").replace(":", r"\:").replace("'", r"\'")


def _fallback_font_path() -> Path:
    candidates = [
        Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "arial.ttf",
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise EditorExportError("No pinned fallback font is available for editor title or caption rendering")


def _parse_keyframes(
    value: object,
    *,
    clip_id: str,
    start_ticks: int,
    end_ticks: int,
) -> dict[str, list[tuple[int, float, str]]]:
    result: dict[str, list[tuple[int, float, str]]] = {}
    limits = {
        "transform.x": (-16384.0, 16384.0),
        "transform.y": (-16384.0, 16384.0),
        "transform.scaleX": (0.01, 16.0),
        "transform.scaleY": (0.01, 16.0),
        "transform.rotation": (-3600.0, 3600.0),
        "opacity": (0.0, 1.0),
        "audio.volumeDb": (-90.0, 12.0),
    }
    for raw in _list(value, f"clip {clip_id} keyframes"):
        keyframe = _mapping(raw, f"clip {clip_id} keyframe")
        prop = _string(keyframe.get("property"), f"clip {clip_id} keyframe property", maximum=32)
        if prop not in KEYFRAME_PROPERTIES:
            raise EditorExportError(f"Clip {clip_id} has unsupported keyframe property {prop!r}")
        ticks = _integer(keyframe.get("timelineTicks"), f"clip {clip_id} keyframe timelineTicks")
        if ticks < start_ticks or ticks >= end_ticks:
            raise EditorExportError(f"Clip {clip_id} has a keyframe outside its timeline range")
        interpolation = _string(keyframe.get("interpolation"), f"clip {clip_id} keyframe interpolation", maximum=16)
        if interpolation not in KEYFRAME_INTERPOLATIONS:
            raise EditorExportError(f"Clip {clip_id} has unsupported keyframe interpolation {interpolation!r}")
        minimum, maximum = limits[prop]
        numeric = _number(keyframe.get("value"), f"clip {clip_id} {prop} keyframe", minimum=minimum, maximum=maximum)
        result.setdefault(prop, []).append((ticks, numeric, interpolation))
    for prop, keyframes in result.items():
        keyframes.sort(key=lambda item: item[0])
        if any(left[0] == right[0] for left, right in pairwise(keyframes)):
            raise EditorExportError(f"Clip {clip_id} has duplicate {prop} keyframes at one time")
    return result


def _automation_expression(
    keyframes: Mapping[str, list[tuple[int, float, str]]],
    prop: str,
    base: float,
    *,
    time_expression: str = "t",
) -> str:
    points = keyframes.get(prop, [])
    if not points:
        return f"{base:.9f}"

    def progress(previous: tuple[int, float, str], following: tuple[int, float, str]) -> str:
        start = previous[0] / EDITOR_TIMEBASE_HZ
        duration = (following[0] - previous[0]) / EDITOR_TIMEBASE_HZ
        linear = f"(({time_expression}-{start:.9f})/{duration:.9f})"
        if previous[2] == "hold":
            return "0"
        if previous[2] == "ease-in":
            return f"pow({linear},2)"
        if previous[2] == "ease-out":
            return f"(1-pow(1-{linear},2))"
        if previous[2] == "ease-in-out":
            return f"if(lt({linear},0.5),2*pow({linear},2),1-pow(-2*{linear}+2,2)/2)"
        return linear

    expression = f"{points[-1][1]:.9f}"
    for previous, following in reversed(list(pairwise(points))):
        amount = progress(previous, following)
        segment = f"({previous[1]:.9f}+({following[1] - previous[1]:.9f})*({amount}))"
        expression = f"if(lt({time_expression},{following[0] / EDITOR_TIMEBASE_HZ:.9f}),{segment},{expression})"
    return f"if(lt({time_expression},{points[0][0] / EDITOR_TIMEBASE_HZ:.9f}),{base:.9f},{expression})"


def _caption_timestamp(ticks: int, *, srt: bool) -> str:
    milliseconds = round(ticks * 1000 / EDITOR_TIMEBASE_HZ)
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1_000)
    separator = "," if srt else "."
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}{separator}{millis:03d}"


def _write_caption_sidecars(clips: Sequence[Mapping[str, Any]], output_path: Path) -> tuple[Path, Path] | tuple[()]:
    cues: list[tuple[int, int, str]] = []
    for clip in clips:
        if clip.get("kind") != "captions":
            continue
        clip_id = _string(clip.get("id"), "caption clip.id", maximum=180)
        start = _integer(clip.get("timelineStartTicks"), f"caption {clip_id} timelineStartTicks")
        duration = _integer(clip.get("timelineDurationTicks"), f"caption {clip_id} timelineDurationTicks", minimum=1)
        text = _string(clip.get("text"), f"caption {clip_id} text", maximum=10_000)
        cues.append((start, start + duration, text.replace("\r\n", "\n").replace("\r", "\n")))
    if not cues:
        return ()
    cues.sort(key=lambda cue: (cue[0], cue[1]))
    if any(left[1] > right[0] for left, right in pairwise(cues)):
        raise EditorExportError("Caption cues overlap; reconcile their timeline ranges before export")
    vtt_path = output_path.with_suffix(".vtt")
    srt_path = output_path.with_suffix(".srt")
    vtt_lines = ["WEBVTT", ""]
    srt_lines: list[str] = []
    for index, (start, end, text) in enumerate(cues, start=1):
        vtt_lines.extend((f"{_caption_timestamp(start, srt=False)} --> {_caption_timestamp(end, srt=False)}", text, ""))
        srt_lines.extend((str(index), f"{_caption_timestamp(start, srt=True)} --> {_caption_timestamp(end, srt=True)}", text, ""))
    vtt_path.write_text("\n".join(vtt_lines), encoding="utf-8")
    srt_path.write_text("\n".join(srt_lines), encoding="utf-8")
    return vtt_path, srt_path


def _hex_color(value: object, label: str) -> str:
    color = _string(value, label, maximum=9)
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?", color):
        raise EditorExportError(f"{label} must be a six- or eight-digit hex colour")
    return color


def _atempo(rate: float) -> str:
    # Even unit-speed atempo changes the sample count at clip boundaries.
    if rate == 1:
        return "anull"
    parts: list[float] = []
    remaining = rate
    while remaining > 2:
        parts.append(2)
        remaining /= 2
    while remaining < 0.5:
        parts.append(0.5)
        remaining /= 0.5
    parts.append(remaining)
    return ",".join(f"atempo={part:.8f}".rstrip("0").rstrip(".") for part in parts)


def _codec_args(codec: str, quality: int | None, bitrate: str | None) -> tuple[list[str], str, str, list[str]]:
    warnings: list[str] = []
    if codec == "vp9":
        return ["-c:v", "libvpx-vp9", "-crf", str(quality if quality is not None else 24), "-b:v", bitrate or "0"], "libopus", "video/webm", warnings
    if codec == "av1":
        return ["-c:v", "libaom-av1", "-crf", str(quality if quality is not None else 30), "-b:v", bitrate or "0"], "libopus", "video/webm", warnings
    if codec == "libx264":
        warnings.append("libx264 requires the separately installed GPL runtime pack.")
        return ["-c:v", "libx264", "-preset", "slow", "-crf", str(quality if quality is not None else 18)], "aac", "video/mp4", warnings
    if codec == "h264_mf":
        return ["-c:v", "h264_mf", "-hw_encoding", "1", *( ["-b:v", bitrate] if bitrate else [] )], "aac", "video/mp4", warnings
    if codec == "h264_nvenc":
        return ["-c:v", "h264_nvenc", "-cq", str(quality if quality is not None else 19), *( ["-b:v", bitrate] if bitrate else [] )], "aac", "video/mp4", warnings
    return ["-c:v", "hevc_nvenc", "-cq", str(quality if quality is not None else 21), *( ["-b:v", bitrate] if bitrate else [] )], "aac", "video/mp4", warnings


def build_editor_export_plan(
    store: ProjectStore,
    manifest: Mapping[str, Any],
    *,
    ffmpeg_path: Path,
    ffprobe_path: Path | None = None,
    media_probe: EditorMediaProbe | None = None,
    probe_timeout_seconds: float = 30,
    output_path: Path,
    staging_dir: Path,
) -> EditorExportPlan:
    """Validate a render manifest and compile one deterministic FFmpeg argv."""

    if probe_timeout_seconds <= 0:
        raise EditorExportError("Editor media probe timeout must be positive")
    selected_ffprobe = ffprobe_path or ffmpeg_path.with_name("ffprobe.exe" if ffmpeg_path.suffix.lower() == ".exe" else "ffprobe")
    selected_probe = media_probe or SubprocessEditorMediaProbe()
    canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    manifest_hash = hashlib.sha256(canonical).hexdigest()
    if manifest.get("schema") != EDITOR_RENDER_SCHEMA:
        raise EditorExportError(f"Expected manifest schema {EDITOR_RENDER_SCHEMA}")
    project_id = _string(manifest.get("projectId"), "manifest.projectId", maximum=128)
    if project_id != store.manifest.project_id:
        raise EditorExportError("Editor manifest project does not match the opened project store")
    if _integer(manifest.get("timebaseHz"), "manifest.timebaseHz", minimum=1) != EDITOR_TIMEBASE_HZ:
        raise EditorExportError(f"Editor manifest must use the {EDITOR_TIMEBASE_HZ} Hz timebase")
    duration_ticks = _integer(manifest.get("durationTicks"), "manifest.durationTicks", minimum=1)
    frame_rate = _mapping(manifest.get("frameRate"), "manifest.frameRate")
    numerator = _integer(frame_rate.get("numerator"), "manifest.frameRate.numerator", minimum=1)
    denominator = _integer(frame_rate.get("denominator"), "manifest.frameRate.denominator", minimum=1)
    fps = numerator / denominator
    canvas = _mapping(manifest.get("canvas"), "manifest.canvas")
    width = _integer(canvas.get("width"), "manifest.canvas.width", minimum=16)
    height = _integer(canvas.get("height"), "manifest.canvas.height", minimum=16)
    if width > 7680 or height > 4320 or width % 2 or height % 2:
        raise EditorExportError("Editor canvas must be even-sized and no larger than 7680 by 4320")
    background = _hex_color(canvas.get("backgroundColor"), "manifest.canvas.backgroundColor")
    codec_record = _mapping(manifest.get("codec"), "manifest.codec")
    codec = _string(codec_record.get("name"), "manifest.codec.name", maximum=32)
    if codec not in SUPPORTED_CODECS:
        raise EditorExportError(f"Unsupported editor export codec {codec!r}")
    quality_value = codec_record.get("quality")
    quality = None if quality_value is None else _integer(quality_value, "manifest.codec.quality", minimum=0)
    bitrate_value = codec_record.get("bitrate")
    bitrate = None if bitrate_value is None else _string(bitrate_value, "manifest.codec.bitrate", maximum=16)
    if bitrate is not None and not BITRATE.fullmatch(bitrate):
        raise EditorExportError("manifest.codec.bitrate must look like 192k, 12M, or 1G")

    asset_paths: dict[str, tuple[Path, str]] = {}
    for raw_asset in _list(manifest.get("assets"), "manifest.assets"):
        asset = _mapping(raw_asset, "manifest asset")
        asset_id = _string(asset.get("id"), "asset.id", maximum=160)
        digest = _string(asset.get("artifactHash"), f"asset {asset_id} artifactHash", maximum=64)
        if asset_id in asset_paths or not SHA256.fullmatch(digest):
            raise EditorExportError(f"Asset {asset_id} has a duplicate identity or invalid SHA-256")
        if asset.get("exportEligible") is not True:
            raise EditorExportError(f"Asset {asset_id} is not eligible for export")
        kind = _string(asset.get("kind"), f"asset {asset_id} kind", maximum=16)
        if kind not in {"image", "video", "audio"}:
            raise EditorExportError(f"Asset {asset_id} has unsupported kind {kind!r}")
        if not store.cas.verify(digest):
            raise EditorExportError(f"Asset {asset_id} is missing or corrupt in the project CAS")
        asset_paths[asset_id] = (store.cas.object_path(digest), kind)

    clips = [_mapping(item, "manifest clip") for item in _list(manifest.get("clips"), "manifest.clips")]
    if not clips:
        raise EditorExportError("Editor timeline has no enabled clips to render")
    clips.sort(key=lambda clip: (_integer(clip.get("layer"), "clip.layer"), _integer(clip.get("timelineStartTicks"), "clip.timelineStartTicks"), str(clip.get("id", ""))))

    staging_dir.mkdir(parents=True, exist_ok=True)
    input_args: list[str] = []
    media_inputs: dict[str, tuple[int, str, Path]] = {}
    next_input = 0
    for clip in clips:
        clip_id = _string(clip.get("id"), "clip.id", maximum=180)
        kind = _string(clip.get("kind"), f"clip {clip_id} kind", maximum=24)
        if kind not in VISUAL_KINDS | TEXT_KINDS | AUDIO_KINDS:
            raise EditorExportError(f"Clip {clip_id} has unsupported track kind {kind!r}")
        raw_asset_id = clip.get("assetId")
        if kind in VISUAL_KINDS | AUDIO_KINDS:
            asset_key = _string(raw_asset_id, f"clip {clip_id} assetId", maximum=160)
            binding = asset_paths.get(asset_key)
            if binding is None:
                raise EditorExportError(f"Clip {clip_id} has no verified CAS asset binding")
            expected_kind = "audio" if kind in AUDIO_KINDS else {"image", "video"}
            if (isinstance(expected_kind, str) and binding[1] != expected_kind) or (isinstance(expected_kind, set) and binding[1] not in expected_kind):
                raise EditorExportError(f"Clip {clip_id} media kind does not match its track")
            input_args.extend(("-i", str(binding[0])))
            media_inputs[clip_id] = (next_input, binding[1], binding[0])
            next_input += 1
        elif raw_asset_id is not None:
            raise EditorExportError(f"Text clip {clip_id} must not carry a media asset")

    duration_seconds = _seconds(duration_ticks)
    chains: list[str] = [f"color=c={background}:s={width}x{height}:r={fps:.9f}:d={duration_seconds},format=rgba[canvas0]"]
    audio_chains: list[str] = []
    visual_label = "canvas0"
    audio_labels: list[str] = []
    visual_number = 0
    text_number = 0
    audio_number = 0
    plan_warnings: list[str] = []
    source_audio_cache: dict[Path, bool] = {}

    for clip in clips:
        clip_id = str(clip["id"])
        kind = str(clip["kind"])
        start_ticks = _integer(clip.get("timelineStartTicks"), f"clip {clip_id} timelineStartTicks")
        timeline_ticks = _integer(clip.get("timelineDurationTicks"), f"clip {clip_id} timelineDurationTicks", minimum=1)
        source_start = _integer(clip.get("sourceStartTicks"), f"clip {clip_id} sourceStartTicks")
        source_duration = _integer(clip.get("sourceDurationTicks"), f"clip {clip_id} sourceDurationTicks", minimum=1)
        if start_ticks + timeline_ticks > duration_ticks:
            raise EditorExportError(f"Clip {clip_id} extends beyond the timeline duration")
        rate = _number(clip.get("playbackRate", 1), f"clip {clip_id} playbackRate", minimum=0.25, maximum=4)
        expected_timeline_ticks = source_duration / rate
        if abs(expected_timeline_ticks - timeline_ticks) > EDITOR_TIMEBASE_HZ / max(fps, 1):
            raise EditorExportError(f"Clip {clip_id} source duration, timeline duration, and speed disagree")
        start = _seconds(start_ticks)
        source_at = _seconds(source_start)
        source_for = _seconds(source_duration)
        transform = _mapping(clip.get("transform"), f"clip {clip_id} transform")
        x = _number(transform.get("x"), f"clip {clip_id} transform.x", minimum=-16384, maximum=16384)
        y = _number(transform.get("y"), f"clip {clip_id} transform.y", minimum=-16384, maximum=16384)
        scale_x = _number(transform.get("scaleX"), f"clip {clip_id} transform.scaleX", minimum=0.01, maximum=16)
        scale_y = _number(transform.get("scaleY"), f"clip {clip_id} transform.scaleY", minimum=0.01, maximum=16)
        rotation = _number(transform.get("rotation"), f"clip {clip_id} transform.rotation", minimum=-3600, maximum=3600)
        if _number(transform.get("anchorX"), f"clip {clip_id} transform.anchorX") != 0.5 or _number(transform.get("anchorY"), f"clip {clip_id} transform.anchorY") != 0.5:
            raise EditorExportError(f"Clip {clip_id} uses a non-centre anchor, which this native renderer does not support")
        opacity = _number(clip.get("opacity"), f"clip {clip_id} opacity", minimum=0, maximum=1)
        audio = _mapping(clip.get("audio"), f"clip {clip_id} audio")
        if _number(audio.get("pan"), f"clip {clip_id} audio.pan", minimum=-1, maximum=1) != 0:
            raise EditorExportError(f"Clip {clip_id} uses pan, which this native renderer does not support")
        keyframes = _parse_keyframes(clip.get("keyframes"), clip_id=clip_id, start_ticks=start_ticks, end_ticks=start_ticks + timeline_ticks)

        if kind in VISUAL_KINDS:
            input_index, media_kind, media_path = media_inputs[clip_id]
            requested_source_audio = clip.get("includeSourceAudio", False)
            if not isinstance(requested_source_audio, bool):
                raise EditorExportError(f"Clip {clip_id} includeSourceAudio must be a boolean")
            if requested_source_audio and media_kind != "video":
                raise EditorExportError(f"Clip {clip_id} can preserve source audio only from video media")
            include_source_audio = requested_source_audio
            if requested_source_audio:
                if media_path not in source_audio_cache:
                    source_audio_cache[media_path] = selected_probe.has_audio_stream(
                        media_path,
                        ffprobe_path=selected_ffprobe,
                        timeout_seconds=probe_timeout_seconds,
                    )
                include_source_audio = source_audio_cache[media_path]
                if not include_source_audio:
                    plan_warnings.append(f"{clip_id} requested source audio, but its verified video asset has no audio stream.")
            unsupported = set(keyframes) - {"transform.x", "transform.y", "transform.scaleX", "transform.scaleY", "transform.rotation", "opacity", *( {"audio.volumeDb"} if requested_source_audio else set() )}
            if unsupported:
                raise EditorExportError(f"Clip {clip_id} has keyframes that do not apply to its visual media: {', '.join(sorted(unsupported))}")
            prefix = "loop=loop=-1:size=1:start=0," if media_kind == "image" else ""
            current = f"v{visual_number}"
            next_canvas = f"canvas{visual_number + 1}"
            scale_x_expression = _automation_expression(keyframes, "transform.scaleX", scale_x)
            scale_y_expression = _automation_expression(keyframes, "transform.scaleY", scale_y)
            rotation_expression = _automation_expression(keyframes, "transform.rotation", rotation)
            opacity_expression = _automation_expression(keyframes, "opacity", opacity, time_expression="T")
            x_expression = _automation_expression(keyframes, "transform.x", x)
            y_expression = _automation_expression(keyframes, "transform.y", y)
            contain_expression = f"min({width}/iw,{height}/ih)"
            visual_filters = [
                f"[{input_index}:v]{prefix}trim=start={source_at}:duration={source_for},"
                f"setpts=(PTS-STARTPTS)/{rate:.9f}+{start}/TB",
                f"scale='trunc(iw*({contain_expression})*({scale_x_expression})/2)*2':'trunc(ih*({contain_expression})*({scale_y_expression})/2)*2':eval=frame",
                "format=rgba",
            ]
            if rotation != 0 or "transform.rotation" in keyframes:
                visual_filters.append(
                    f"rotate='({rotation_expression})*PI/180':c=none:ow='ceil(hypot(iw,ih)/2)*2':oh='ceil(hypot(iw,ih)/2)*2'"
                )
            if opacity != 1 or "opacity" in keyframes:
                visual_filters.append(
                    f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*({opacity_expression})'"
                )
            chains.append(",".join(visual_filters) + f"[{current}]")
            chains.append(
                f"[{visual_label}][{current}]overlay=x='(W-w)/2+({x_expression})':y='(H-h)/2+({y_expression})':eval=frame:"
                f"enable='gte(t,{start})*lt(t,{_seconds(start_ticks + timeline_ticks)})'[{next_canvas}]"
            )
            visual_label = next_canvas
            visual_number += 1
            if include_source_audio:
                muted = audio.get("muted") is True
                gain = -90.0 if muted else _number(audio.get("volumeDb"), f"clip {clip_id} volumeDb", minimum=-90, maximum=12)
                fade_in_ticks = _integer(audio.get("fadeInTicks", 0), f"clip {clip_id} fadeInTicks")
                fade_out_ticks = _integer(audio.get("fadeOutTicks", 0), f"clip {clip_id} fadeOutTicks")
                if fade_in_ticks + fade_out_ticks > timeline_ticks:
                    raise EditorExportError(f"Clip {clip_id} audio fades exceed its duration")
                filters = [
                    f"atrim=start={source_at}:duration={source_for}",
                    "asetpts=PTS-STARTPTS",
                    _atempo(rate),
                    f"volume='pow(10,({_automation_expression(keyframes, 'audio.volumeDb', gain, time_expression=f't+{start}')})/20)':eval=frame",
                ]
                if fade_in_ticks:
                    filters.append(f"afade=t=in:st=0:d={_seconds(fade_in_ticks)}")
                if fade_out_ticks:
                    filters.append(f"afade=t=out:st={_seconds(timeline_ticks - fade_out_ticks)}:d={_seconds(fade_out_ticks)}")
                # adelay can retain source-offset timestamps. Rebase its output
                # sample clock before trimming, or FFmpeg strips the inserted silence.
                delay_samples = round(start_ticks * 48000 / EDITOR_TIMEBASE_HZ)
                filters.extend(("aresample=48000", f"atrim=duration={_seconds(timeline_ticks)}",
                                f"adelay={delay_samples}S:all=1", "asetpts=N/SR/TB",
                                f"atrim=duration={duration_seconds}"))
                label = f"audio{audio_number}"
                audio_chains.append(f"[{input_index}:a]{','.join(filters)}[{label}]")
                audio_labels.append(f"[{label}]")
                audio_number += 1
        elif kind in TEXT_KINDS:
            unsupported = set(keyframes) - {"transform.x", "transform.y", "opacity"}
            if unsupported:
                raise EditorExportError(f"Clip {clip_id} has keyframes that do not apply to text: {', '.join(sorted(unsupported))}")
            if scale_x != 1 or scale_y != 1 or rotation != 0:
                raise EditorExportError(f"Clip {clip_id} uses text scale or rotation that this renderer cannot reproduce")
            text = clip.get("text")
            if not isinstance(text, str):
                raise EditorExportError(f"Text clip {clip_id} has no text")
            text_path = staging_dir / f"text-{text_number:04d}.txt"
            # drawtext treats CR and LF as separate line breaks on Windows.
            # Preserve one authored break per line without host newline expansion.
            text_path.write_text(text.replace("\r\n", "\n").replace("\r", "\n"), encoding="utf-8", newline="\n")
            style = _mapping(clip.get("textStyle"), f"clip {clip_id} textStyle")
            font_size = _integer(style.get("fontSize"), f"clip {clip_id} fontSize", minimum=6)
            if font_size > 512:
                raise EditorExportError(f"Clip {clip_id} font size is too large")
            font_color = _hex_color(style.get("color"), f"clip {clip_id} color")
            align = _string(style.get("align"), f"clip {clip_id} align", maximum=8)
            position = _string(style.get("position"), f"clip {clip_id} position", maximum=8)
            if align not in {"left", "center", "right"} or position not in {"top", "center", "bottom", "custom"}:
                raise EditorExportError(f"Clip {clip_id} has unsupported text placement")
            if "Text uses the pinned FFmpeg fallback font; editor font family and weight are not yet bound as CAS font assets." not in plan_warnings:
                plan_warnings.append("Text uses the pinned FFmpeg fallback font; editor font family and weight are not yet bound as CAS font assets.")
            x_expr = "w*0.05" if align == "left" else "w-text_w-w*0.05" if align == "right" else "(w-text_w)/2"
            text_align = {"left": "T+L", "center": "T+C", "right": "T+R"}[align]
            y_expr = "h*0.05" if position == "top" else "h-text_h-h*0.05" if position == "bottom" else "(h-text_h)/2"
            x_expression = _automation_expression(keyframes, "transform.x", x)
            y_expression = _automation_expression(keyframes, "transform.y", y)
            opacity_expression = _automation_expression(keyframes, "opacity", opacity)
            box = style.get("backgroundColor")
            box_args = ""
            if box is not None:
                box_args = f":box=1:boxcolor={_hex_color(box, f'clip {clip_id} backgroundColor')}@0.75:boxborderw=12"
            next_canvas = f"textcanvas{text_number + 1}"
            chains.append(
                f"[{visual_label}]drawtext=fontfile='{_filter_path(_fallback_font_path())}':textfile='{_filter_path(text_path)}':fontsize={font_size}:"
                f"expansion=none:text_align={text_align}:fontcolor={font_color}{box_args}:alpha='{opacity_expression}':x='{x_expr}+({x_expression})':y='{y_expr}+({y_expression})':"
                f"enable='gte(t,{start})*lt(t,{_seconds(start_ticks + timeline_ticks)})'[{next_canvas}]"
            )
            visual_label = next_canvas
            text_number += 1
        else:
            unsupported = set(keyframes) - {"audio.volumeDb"}
            if unsupported:
                raise EditorExportError(f"Clip {clip_id} has keyframes that do not apply to audio: {', '.join(sorted(unsupported))}")
            input_index, _, _ = media_inputs[clip_id]
            muted = audio.get("muted") is True
            gain = -90.0 if muted else _number(audio.get("volumeDb"), f"clip {clip_id} volumeDb", minimum=-90, maximum=12)
            fade_in_ticks = _integer(audio.get("fadeInTicks", 0), f"clip {clip_id} fadeInTicks")
            fade_out_ticks = _integer(audio.get("fadeOutTicks", 0), f"clip {clip_id} fadeOutTicks")
            if fade_in_ticks + fade_out_ticks > timeline_ticks:
                raise EditorExportError(f"Clip {clip_id} audio fades exceed its duration")
            filters = [
                f"atrim=start={source_at}:duration={source_for}",
                "asetpts=PTS-STARTPTS",
                _atempo(rate),
                f"volume='pow(10,({_automation_expression(keyframes, 'audio.volumeDb', gain, time_expression=f't+{start}')})/20)':eval=frame",
            ]
            if fade_in_ticks:
                filters.append(f"afade=t=in:st=0:d={_seconds(fade_in_ticks)}")
            if fade_out_ticks:
                filters.append(f"afade=t=out:st={_seconds(timeline_ticks - fade_out_ticks)}:d={_seconds(fade_out_ticks)}")
            delay_samples = round(start_ticks * 48000 / EDITOR_TIMEBASE_HZ)
            filters.extend(("aresample=48000", f"atrim=duration={_seconds(timeline_ticks)}",
                                f"adelay={delay_samples}S:all=1", "asetpts=N/SR/TB",
                                f"atrim=duration={duration_seconds}"))
            label = f"audio{audio_number}"
            audio_chains.append(f"[{input_index}:a]{','.join(filters)}[{label}]")
            audio_labels.append(f"[{label}]")
            audio_number += 1

    if audio_labels:
        audio_chains.append(f"{''.join(audio_labels)}amix=inputs={len(audio_labels)}:duration=longest:dropout_transition=0:normalize=0,apad=whole_len={round(duration_ticks * 48000 / EDITOR_TIMEBASE_HZ)},atrim=end_sample={round(duration_ticks * 48000 / EDITOR_TIMEBASE_HZ)},asetpts=N/SR/TB[programme]")
    else:
        audio_chains.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={duration_seconds}[programme]")
    video_args, audio_codec, media_type, warnings = _codec_args(codec, quality, bitrate)
    warnings = [*plan_warnings, *warnings]
    # Compositing onto the authored RGBA canvas can discard input color tags.
    # Convert the delivery matrix/range explicitly and carry the frame metadata
    # into the encoder; stream flags alone do not preserve it on every codec.
    chains.append(
        f"[{visual_label}]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,"
        "setparams=range=limited:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709[delivery]"
    )
    # A combined graph with delayed source-audio branches buffers decoded video
    # from later clips while the audio mixer advances. On a real 180-second
    # timeline this exhausted 19 GiB. Prepare float PCM separately so the visual
    # graph never needs to drain audio from the same decoder inputs.
    programme_path = staging_dir / "programme.wav"
    audio_argv = (
        str(ffmpeg_path), "-hide_banner", "-nostdin", "-y", *input_args,
        "-filter_complex", ";".join(audio_chains), "-map", "[programme]",
        "-vn", "-c:a", "pcm_f32le", "-ar", "48000", "-t", duration_seconds, str(programme_path),
    )
    argv = (
        str(ffmpeg_path), "-hide_banner", "-nostdin", "-y", *input_args, "-i", str(programme_path),
        "-filter_complex", ";".join(chains), "-map", "[delivery]", "-map", f"{next_input}:a:0",
        "-r", f"{fps:.9f}", *video_args, "-pix_fmt", "yuv420p", "-c:a", audio_codec,
        "-color_primaries", "bt709", "-color_trc", "iec61966-2-1", "-colorspace", "bt709", "-color_range", "tv",
        "-ar", "48000", "-t", duration_seconds, str(output_path),
    )
    return EditorExportPlan(argv, audio_argv, output_path, manifest_hash, duration_ticks, codec, media_type, tuple(warnings))


def render_editor_timeline(
    store: ProjectStore,
    manifest: Mapping[str, Any],
    *,
    ffmpeg_path: Path,
    ffprobe_path: Path | None = None,
    media_probe: EditorMediaProbe | None = None,
    output_path: Path | None = None,
    runner: EditorExportRunner | None = None,
    timeout_seconds: float = 3_600,
    cancel_check: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Render, verify, and content-address one editor timeline delivery."""

    if timeout_seconds <= 0:
        raise EditorExportError("Editor export timeout must be positive")
    codec_record = _mapping(manifest.get("codec"), "manifest.codec")
    codec = str(codec_record.get("name", ""))
    extension = ".webm" if codec in {"vp9", "av1"} else ".mp4"
    export_root = (store.root / "exports" / "editor").resolve()
    export_root.mkdir(parents=True, exist_ok=True)
    selected_output = (output_path or export_root / f"editor-{uuid.uuid4().hex}{extension}").resolve()
    try:
        selected_output.relative_to(export_root)
    except ValueError as error:
        raise EditorExportError("Editor output must stay inside the project editor export directory") from error
    if selected_output.suffix.lower() != extension:
        raise EditorExportError(f"Codec {codec} requires an {extension} output")
    selected_output.parent.mkdir(parents=True, exist_ok=True)
    attempt = (store.root / "staging" / "editor-export" / uuid.uuid4().hex).resolve()
    attempt.mkdir(parents=True, exist_ok=False)
    plan = build_editor_export_plan(
        store,
        manifest,
        ffmpeg_path=ffmpeg_path,
        ffprobe_path=ffprobe_path,
        media_probe=media_probe,
        probe_timeout_seconds=min(timeout_seconds, 30),
        output_path=selected_output,
        staging_dir=attempt,
    )
    sidecar_paths: tuple[Path, ...] = ()
    try:
        selected_runner = runner or SubprocessEditorExportRunner(cancel_check)
        started = time.monotonic()
        selected_runner.run(plan.audio_argv, timeout_seconds=timeout_seconds)
        if cancel_check is not None and cancel_check():
            raise EditorExportError("Editor export cancelled before promotion")
        remaining = timeout_seconds - (time.monotonic() - started)
        if remaining <= 0:
            raise EditorExportError("Editor export timed out during audio preparation")
        selected_runner.run(plan.argv, timeout_seconds=remaining)
        if cancel_check is not None and cancel_check():
            raise EditorExportError("Editor export cancelled before promotion")
        if not selected_output.is_file() or selected_output.stat().st_size <= 0:
            raise EditorExportError("FFmpeg reported success but produced no editor delivery")
        remaining = timeout_seconds - (time.monotonic() - started)
        if remaining <= 0:
            raise EditorExportError("Editor export timed out before delivery verification")
        frame_rate = _mapping(manifest.get("frameRate"), "manifest.frameRate")
        verification = verify_editor_delivery(
            selected_output, ffmpeg_path=ffmpeg_path,
            duration_seconds=plan.duration_ticks / EDITOR_TIMEBASE_HZ,
            fps=float(frame_rate["numerator"]) / float(frame_rate["denominator"]),
            timeout_seconds=remaining, cancel_check=cancel_check,
        )
        if cancel_check is not None and cancel_check():
            raise EditorExportError("Editor export cancelled before promotion")
        sidecar_paths = _write_caption_sidecars(
            [_mapping(item, "manifest clip") for item in _list(manifest.get("clips"), "manifest.clips")],
            selected_output,
        )
        artifact = store.cas.add_file(
            selected_output,
            media_type=plan.media_type,
            original_name=selected_output.name,
            metadata={"role": "editor-timeline-export", "manifestHash": plan.manifest_hash, "codec": plan.codec},
        )
        sidecars = []
        artifacts = [artifact]
        for path in sidecar_paths:
            media_type = "text/vtt" if path.suffix == ".vtt" else "application/x-subrip"
            sidecar_artifact = store.cas.add_file(
                path,
                media_type=media_type,
                original_name=path.name,
                metadata={"role": "editor-caption-sidecar", "manifestHash": plan.manifest_hash, "format": path.suffix[1:]},
            )
            artifacts.append(sidecar_artifact)
            sidecars.append({"format": path.suffix[1:], "path": str(path), "artifactHash": sidecar_artifact.hash, "mediaType": media_type, "byteSize": path.stat().st_size})
        store.register_artifacts(artifacts)
        return {
            "projectId": store.manifest.project_id,
            "outputPath": str(selected_output),
            "artifactHash": artifact.hash,
            "mediaType": plan.media_type,
            "byteSize": selected_output.stat().st_size,
            "codec": plan.codec,
            "durationTicks": plan.duration_ticks,
            "manifestHash": plan.manifest_hash,
            "warnings": list(plan.warnings),
            "captionSidecars": sidecars,
            "deliveryVerification": verification,
        }
    except Exception:
        selected_output.unlink(missing_ok=True)
        for path in sidecar_paths:
            path.unlink(missing_ok=True)
        raise
    finally:
        for child in attempt.iterdir():
            child.unlink(missing_ok=True)
        attempt.rmdir()
