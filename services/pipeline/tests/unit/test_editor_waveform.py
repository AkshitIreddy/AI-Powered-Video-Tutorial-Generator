from __future__ import annotations

import io
import math
import shutil
import struct
import subprocess
import wave
from pathlib import Path

import pytest

from alystria.editor_waveform import (
    EditorWaveformError,
    WaveformProfile,
    _audio_duration_seconds,
    parse_waveform_profile,
    render_editor_waveform,
)
from alystria.project import ProjectStore


def _ffmpeg() -> Path | None:
    pinned = Path(r"C:\FFmpeg\bin\ffmpeg.exe")
    if pinned.is_file():
        return pinned
    found = shutil.which("ffmpeg")
    return None if found is None else Path(found)


def _known_pcm() -> bytes:
    stream = io.BytesIO()
    sample_rate = 8_000
    with wave.open(stream, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        samples = []
        for index in range(sample_rate * 2):
            value = 0 if index < sample_rate else round(math.sin(2 * math.pi * 220 * index / sample_rate) * 26_000)
            samples.append(struct.pack("<h", value))
        output.writeframes(b"".join(samples))
    return stream.getvalue()


@pytest.mark.skipif(_ffmpeg() is None, reason="FFmpeg is required for waveform integration proof")
def test_waveform_uses_known_pcm_peaks_and_reuses_hash_profile_cache(tmp_path: Path) -> None:
    ffmpeg = _ffmpeg()
    assert ffmpeg is not None
    with ProjectStore.create(tmp_path / "waveform-project", name="Waveform") as store:
        source = store.add_artifact_bytes(_known_pcm(), media_type="audio/wav", original_name="known.wav")
        profile = WaveformProfile(width=512, height=64)
        first = render_editor_waveform(store, source.hash, ffmpeg_path=ffmpeg, profile=profile)
        index_path = next((store.root / "cache" / "editor-waveforms").glob("*.json"))
        first_modified = index_path.stat().st_mtime_ns
        second = render_editor_waveform(store, source.hash, ffmpeg_path=ffmpeg, profile=profile)

        assert second == first
        assert index_path.stat().st_mtime_ns == first_modified
        assert first["durationTicks"] == 480_000
        waveform_path = Path(first["waveformPath"])
        assert waveform_path.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
        raw = subprocess.run(
            [str(ffmpeg), "-v", "error", "-i", str(waveform_path), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            check=True,
            capture_output=True,
        ).stdout
        lit_by_column = []
        for x in range(profile.width):
            lit_by_column.append(sum(1 for y in range(profile.height) if sum(raw[(y * profile.width + x) * 3:(y * profile.width + x) * 3 + 3]) > 80))
        assert sum(lit_by_column[profile.width // 2:]) > sum(lit_by_column[: profile.width // 2]) * 8


def test_waveform_profile_is_strict_and_bounded() -> None:
    assert parse_waveform_profile({"width": 1024, "height": 64}) == WaveformProfile(1024, 64)
    with pytest.raises(ValueError, match=r"profile\.width"):
        parse_waveform_profile({"width": 10, "height": 64})
    with pytest.raises(ValueError, match="Unsupported waveform profile fields"):
        parse_waveform_profile({"width": 1024, "height": 64, "colour": "fake"})


class _ProbeRunner:
    def __init__(self, response: str) -> None:
        self.response = response
        self.argv: tuple[str, ...] | None = None

    def run(self, argv: tuple[str, ...], *, timeout_seconds: float) -> str:
        self.argv = argv
        assert timeout_seconds == 30
        return self.response


def test_waveform_duration_prefers_audio_stream_and_rejects_silent_video() -> None:
    runner = _ProbeRunner('{"streams":[{"duration":"1.25"}],"format":{"duration":"9.5"}}')
    assert _audio_duration_seconds(
        runner,
        Path("ffprobe"),
        Path("source.mp4"),
        timeout_seconds=120,
    ) == 1.25
    assert runner.argv is not None
    assert runner.argv[runner.argv.index("-select_streams") + 1] == "a:0"

    tagged = _ProbeRunner(
        '{"streams":[{"duration_ts":"N/A","time_base":"1/1000","tags":{"DURATION":"00:00:01.250000000"}}],"format":{"duration":"9.5"}}'
    )
    assert _audio_duration_seconds(
        tagged,
        Path("ffprobe"),
        Path("source.webm"),
        timeout_seconds=120,
    ) == 1.25

    with pytest.raises(EditorWaveformError, match="decodable audio stream"):
        _audio_duration_seconds(
            _ProbeRunner('{"streams":[],"format":{"duration":"9.5"}}'),
            Path("ffprobe"),
            Path("silent.mp4"),
            timeout_seconds=120,
        )
