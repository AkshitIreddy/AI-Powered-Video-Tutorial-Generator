#!/usr/bin/env python3
"""Create a compact all-scene renderer manifest from a canonical fixture.

The specimen uses the same bounded scene-content bridge as production, but
shortens every scene and omits provider media, spoken narration, and captions.
A quiet measured reference tone keeps delivery-audio verification active.  The
result is cheap enough to run before a long app-driven export while still
exercising authored visual beats, responsive layout, transitions, Chromium
capture, audio muxing, and final encoding for every scene in sequence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
import wave
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PIPELINE_SOURCE = ROOT / "services" / "pipeline" / "src"
if str(PIPELINE_SOURCE) not in sys.path:
    sys.path.insert(0, str(PIPELINE_SOURCE))

from alystria.generation.renderer_client import _scene_content, _scene_kind


TICKS_PER_SECOND = 240_000
REFERENCE_SAMPLE_RATE = 48_000
REFERENCE_AMPLITUDE = 0.05
REFERENCE_FADE_MILLISECONDS = 20


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--fixture",
        type=Path,
        default=ROOT / "fixtures" / "canonical" / "karatsuba" / "fixture.json",
    )
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--scene-seconds", type=int, default=2)
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--fps", type=int, default=30)
    return parser.parse_args()


def validate_dimensions(width: int, height: int, fps: int, scene_seconds: int) -> None:
    if width < 320 or height < 320:
        raise ValueError("Specimen dimensions must be at least 320 by 320")
    if fps not in {24, 25, 30, 50, 60}:
        raise ValueError("Specimen fps must be one of 24, 25, 30, 50, or 60")
    if scene_seconds < 1 or scene_seconds > 10:
        raise ValueError("Specimen scenes must last between 1 and 10 seconds")


def renderer_path(path: Path) -> str:
    """Return a native path for the Windows renderer when invoked from WSL."""

    resolved = path.resolve()
    parts = resolved.parts
    if len(parts) >= 4 and parts[0] == "/" and parts[1] == "mnt":
        drive = parts[2]
        if len(drive) == 1 and drive.isascii() and drive.isalpha():
            suffix = "\\".join(parts[3:])
            return f"{drive.upper()}:\\{suffix}"
    return str(resolved)


def specimen_scene(authored: dict[str, Any], index: int, duration_ticks: int) -> dict[str, Any]:
    source_kind = str(authored.get("type", "definition"))
    kind = "presenter-slide" if index == 0 else _scene_kind(source_kind)
    content = _scene_content(authored, kind)
    metadata: dict[str, str | int] = {
        "sourceType": source_kind,
        "sceneIndex": index,
        "specimen": "canonical-all-scenes",
    }
    visual_beat = content.get("visualBeat")
    if isinstance(visual_beat, dict):
        for key in (
            "semanticIntent",
            "compositionFamily",
            "focalAnchor",
            "continuityKey",
            "attentionCue",
            "visualMetaphor",
        ):
            value = visual_beat.get(key)
            if isinstance(value, str):
                metadata[key] = value
    return {
        "id": str(authored["id"]),
        "kind": kind,
        "durationTicks": duration_ticks,
        "seed": f"canonical-specimen:{authored['id']}:{index}",
        "content": content,
        "captions": [],
        "accessibilityDescription": str(authored["accessibilityDescription"]),
        "metadata": metadata,
    }


def write_reference_tone(path: Path, duration_seconds: int) -> tuple[str, dict[str, Any]]:
    """Write and numerically verify a quiet click-free QA reference tone."""

    frame_count = duration_seconds * REFERENCE_SAMPLE_RATE
    fade_frames = REFERENCE_SAMPLE_RATE * REFERENCE_FADE_MILLISECONDS // 1_000
    maximum = (1 << 15) - 1
    peak_target = round(maximum * REFERENCE_AMPLITUDE)
    samples: list[int] = []
    for index in range(frame_count):
        attack = min(1.0, index / max(1, fade_frames))
        release = min(1.0, (frame_count - 1 - index) / max(1, fade_frames))
        envelope = min(attack, release)
        sample = round(
            peak_target
            * envelope
            * math.sin(2 * math.pi * 220 * index / REFERENCE_SAMPLE_RATE)
        )
        samples.append(sample)
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(REFERENCE_SAMPLE_RATE)
        output.writeframes(b"".join(struct.pack("<h", sample) for sample in samples))

    peak = max((abs(sample) for sample in samples), default=0)
    rms = math.sqrt(sum(sample * sample for sample in samples) / max(1, len(samples)))
    tail = samples[-fade_frames:] if fade_frames else []
    tail_rms = math.sqrt(sum(sample * sample for sample in tail) / max(1, len(tail)))
    content = path.read_bytes()
    measurements = {
        "schemaVersion": 1,
        "sampleRateHz": REFERENCE_SAMPLE_RATE,
        "channels": 1,
        "sampleWidthBits": 16,
        "durationSeconds": duration_seconds,
        "frequencyHz": 220,
        "fadeMilliseconds": REFERENCE_FADE_MILLISECONDS,
        "peak": peak / (1 << 15),
        "rms": rms / (1 << 15),
        "tailRms": tail_rms / (1 << 15),
        "clippedSamples": sum(abs(sample) >= maximum for sample in samples),
        "silent": peak == 0,
        "sha256": hashlib.sha256(content).hexdigest(),
    }
    if measurements["silent"] or measurements["clippedSamples"]:
        raise ValueError("Specimen reference tone failed numeric audio verification")
    if measurements["peak"] >= 0.1 or measurements["tailRms"] >= 0.03:
        raise ValueError("Specimen reference tone is too loud or has an abrupt tail")
    return str(measurements["sha256"]), measurements


def main() -> int:
    options = arguments()
    validate_dimensions(options.width, options.height, options.fps, options.scene_seconds)
    fixture_path = options.fixture.resolve(strict=True)
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    raw_scenes = fixture.get("scenes")
    if not isinstance(raw_scenes, list) or not raw_scenes:
        raise ValueError("Canonical fixture must contain scenes")
    if any(not isinstance(scene, dict) for scene in raw_scenes):
        raise ValueError("Canonical fixture scenes must be objects")

    output_root = options.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    duration_ticks = options.scene_seconds * TICKS_PER_SECOND
    total_duration_seconds = options.scene_seconds * len(raw_scenes)
    reference_tone_path = output_root / "qa-reference-tone.wav"
    reference_tone_sha256, reference_tone_measurements = write_reference_tone(
        reference_tone_path,
        total_duration_seconds,
    )
    (output_root / "qa-reference-tone-measurements.json").write_text(
        json.dumps(reference_tone_measurements, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    safe_x = max(24, round(options.width * 0.05))
    safe_y = max(24, round(options.height * 0.05))
    manifest = {
        "id": f"specimen.{fixture['id']}",
        "schemaVersion": 1,
        "rendererVersion": "2.0.0-rc.0",
        "target": {
            "name": "custom",
            "width": options.width,
            "height": options.height,
            "pixelRatio": 1,
            "frameRate": {"numerator": options.fps, "denominator": 1},
            "colorSpace": "srgb-rec709",
            "safeArea": {
                "top": safe_y,
                "right": safe_x,
                "bottom": safe_y,
                "left": safe_x,
            },
        },
        "scenes": [
            specimen_scene(scene, index, duration_ticks)
            for index, scene in enumerate(raw_scenes)
        ],
        "audioInputs": [
            {
                "id": "canonical-specimen-reference-tone",
                "assetId": "qa-reference-tone",
                "path": renderer_path(reference_tone_path),
                "sha256": reference_tone_sha256,
                "mediaType": "audio/wav",
                "role": "narration",
                "startTick": 0,
                "endTick": total_duration_seconds * TICKS_PER_SECOND,
                "gainDb": 0,
            }
        ],
        "captionDeliveryMode": "sidecar",
        "outputDirectory": renderer_path(output_root / "render"),
        "metadata": {
            "fixture": str(fixture["id"]),
            "purpose": "compact authored-visual acceptance before full export",
            "networkRequired": False,
        },
    }
    manifest_path = output_root / "render-manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(manifest_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
