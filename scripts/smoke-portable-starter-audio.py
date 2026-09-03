"""Render and measure bundled music/SFX from a portable Alystria test area.

This is a packaging smoke check, not a substitute for human listening. It
trusts only the Alystria test-area manifest, then independently revalidates the
catalog, selected byte counts, and SHA-256 digests before invoking FFmpeg.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
import wave
from array import array
from pathlib import Path
from typing import Any


def _load_json(path: Path, *, maximum_bytes: int) -> dict[str, Any]:
    if not path.is_file() or path.is_symlink():
        raise ValueError(f"Expected a regular JSON file: {path}")
    if path.stat().st_size <= 0 or path.stat().st_size > maximum_bytes:
        raise ValueError(f"JSON file exceeds its trust-boundary size: {path}")
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise TypeError(f"Expected a JSON object: {path}")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _inside(root: Path, relative: str) -> Path:
    value = Path(relative)
    if (
        value.is_absolute()
        or not value.parts
        or any(part in {"", ".", ".."} for part in value.parts)
    ):
        raise ValueError(f"Unsafe starter-audio path: {relative!r}")
    candidate = (root / value).resolve(strict=True)
    if (
        candidate.is_symlink()
        or not candidate.is_file()
        or not candidate.is_relative_to(root)
    ):
        raise ValueError(f"Starter-audio path leaves its portable root: {relative!r}")
    return candidate


def _select(catalog: dict[str, Any], root: Path, asset_id: str) -> Path:
    assets = catalog.get("assets")
    if not isinstance(assets, list):
        raise TypeError("Starter-audio catalog assets must be an array")
    matches = [
        item for item in assets if isinstance(item, dict) and item.get("id") == asset_id
    ]
    if len(matches) != 1:
        raise ValueError(f"Catalog must contain exactly one {asset_id!r}")
    item = matches[0]
    path = _inside(root, str(item.get("path", "")))
    expected_bytes = item.get("bytes")
    expected_hash = item.get("sha256")
    if not isinstance(expected_bytes, int) or path.stat().st_size != expected_bytes:
        raise ValueError(f"Portable asset {asset_id!r} has the wrong size")
    if not isinstance(expected_hash, str) or _sha256(path) != expected_hash:
        raise ValueError(f"Portable asset {asset_id!r} failed SHA-256 validation")
    return path


def _measure_pcm(path: Path) -> dict[str, float | int]:
    with wave.open(str(path), "rb") as stream:
        channels = stream.getnchannels()
        sample_width = stream.getsampwidth()
        sample_rate = stream.getframerate()
        frames = stream.getnframes()
        samples = stream.readframes(frames)
    if sample_width != 2:
        raise ValueError("Portable audio smoke output must be 16-bit PCM")
    decoded = array("h")
    decoded.frombytes(samples)
    if sys.byteorder != "little":
        decoded.byteswap()
    peak = max((abs(sample) for sample in decoded), default=0)
    rms = math.sqrt(sum(sample * sample for sample in decoded) / max(len(decoded), 1))
    clipped = sum(1 for sample in decoded if abs(sample) >= 32767)
    return {
        "sampleRateHz": sample_rate,
        "channels": channels,
        "durationSeconds": round(frames / sample_rate, 3),
        "samplePeakDbfs": round(20 * math.log10(max(peak, 1) / 32768), 3),
        "rmsDbfs": round(20 * math.log10(max(rms, 1) / 32768), 3),
        "clippedSamples": clipped,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("test_area", type=Path)
    parser.add_argument("--ffmpeg", required=True, type=Path)
    parser.add_argument("--music-id", default="starter.audio.music.focus-loop")
    parser.add_argument("--sfx-id", default="starter.audio.sfx.emphasis-a")
    arguments = parser.parse_args()

    test_area = arguments.test_area.resolve(strict=True)
    manifest_path = test_area / "test-area-manifest.json"
    manifest = _load_json(manifest_path, maximum_bytes=1024 * 1024)
    if manifest.get("kind") != "ai-video-tutorial-generator-portable-debug-test-area":
        raise ValueError("Not an Alystria portable debug test area")
    audio_record = manifest.get("starterAudio")
    if not isinstance(audio_record, dict):
        raise TypeError("Portable test-area manifest has no starterAudio record")
    audio_root = (test_area / str(audio_record.get("path", ""))).resolve(strict=True)
    if (
        not audio_root.is_relative_to(test_area)
        or audio_root.is_symlink()
        or not audio_root.is_dir()
    ):
        raise ValueError("Portable starterAudio root is unsafe")
    catalog_path = audio_root / "catalog.json"
    catalog = _load_json(catalog_path, maximum_bytes=2 * 1024 * 1024)
    if (
        catalog.get("schemaVersion") != 1
        or catalog.get("catalogId") != "alystria.starter-audio.v1"
    ):
        raise ValueError("Portable starter-audio catalog identity is unsupported")
    if _sha256(catalog_path) != audio_record.get("catalogSha256"):
        raise ValueError(
            "Portable starter-audio catalog does not match the test-area manifest"
        )

    music = _select(catalog, audio_root, arguments.music_id)
    sfx = _select(catalog, audio_root, arguments.sfx_id)
    ffmpeg = arguments.ffmpeg.resolve(strict=True)
    output_dir = test_area / "Test Data" / "verification"
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / "starter-audio-portable-smoke.wav"
    command = [
        str(ffmpeg),
        "-y",
        "-nostdin",
        "-v",
        "error",
        "-i",
        str(music),
        "-i",
        str(sfx),
        "-filter_complex",
        (
            "[0:a]atrim=duration=5,volume=0.12[music];"
            "[1:a]adelay=1200|1200,volume=0.28[sfx];"
            "[music][sfx]amix=inputs=2:duration=longest:dropout_transition=0,"
            "atrim=duration=5,aresample=48000,"
            "aformat=sample_fmts=s16:channel_layouts=stereo[out]"
        ),
        "-map",
        "[out]",
        "-c:a",
        "pcm_s16le",
        str(output),
    ]
    subprocess.run(command, check=True, stdin=subprocess.DEVNULL)
    measurements = _measure_pcm(output)
    if measurements["sampleRateHz"] != 48_000 or measurements["channels"] != 2:
        raise ValueError(
            f"Portable audio smoke output has the wrong format: {measurements}"
        )
    if measurements["clippedSamples"] != 0 or measurements["samplePeakDbfs"] > -1.5:
        raise ValueError(
            f"Portable audio smoke output failed peak safety: {measurements}"
        )
    if measurements["rmsDbfs"] < -60:
        raise ValueError(
            f"Portable audio smoke output is unexpectedly silent: {measurements}"
        )
    proof = {
        "schemaVersion": 1,
        "musicId": arguments.music_id,
        "sfxId": arguments.sfx_id,
        "catalogSha256": _sha256(catalog_path),
        "output": str(output),
        "outputSha256": _sha256(output),
        "measurements": measurements,
    }
    proof_path = output.with_suffix(".json")
    proof_path.write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(proof, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
