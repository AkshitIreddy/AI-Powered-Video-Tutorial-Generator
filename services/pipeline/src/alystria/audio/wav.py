"""Deterministic PCM WAV fixtures and sample-level measurements.

This module intentionally uses only the standard library.  It lets CI verify
basic audio invariants even when FFmpeg and audio hardware are unavailable.
"""

from __future__ import annotations

import io
import math
import struct
import wave
from dataclasses import dataclass
from pathlib import Path

from .models import WORKING_SAMPLE_RATE_HZ


@dataclass(frozen=True, slots=True)
class WavFixtureSpec:
    duration_ms: int = 1_000
    frequency_hz: float = 440.0
    amplitude: float = 0.25
    sample_rate_hz: int = WORKING_SAMPLE_RATE_HZ
    channels: int = 1
    leading_silence_ms: int = 0
    trailing_silence_ms: int = 0
    fade_ms: int = 10

    def __post_init__(self) -> None:
        if self.duration_ms <= 0 or self.frequency_hz <= 0:
            raise ValueError("fixture duration and frequency must be positive")
        if not 0 <= self.amplitude <= 1:
            raise ValueError("fixture amplitude must be between 0 and 1")
        if self.sample_rate_hz <= 0 or self.channels not in {1, 2}:
            raise ValueError("invalid fixture sample rate or channel count")
        if self.leading_silence_ms < 0 or self.trailing_silence_ms < 0 or self.fade_ms < 0:
            raise ValueError("fixture silence and fade durations cannot be negative")
        if self.leading_silence_ms + self.trailing_silence_ms > self.duration_ms:
            raise ValueError("fixture silence cannot exceed total duration")


@dataclass(frozen=True, slots=True)
class WavMeasurements:
    sample_rate_hz: int
    channels: int
    sample_width_bytes: int
    frame_count: int
    duration_ms: float
    peak_linear: float
    peak_dbfs: float
    rms_linear: float
    rms_dbfs: float
    dc_offset: float
    clipped_sample_count: int
    silent_sample_ratio: float
    leading_silence_ms: float
    trailing_silence_ms: float

    @property
    def is_digital_silence(self) -> bool:
        return self.peak_linear == 0.0


def generate_sine_wav(spec: WavFixtureSpec | None = None) -> bytes:
    if spec is None:
        spec = WavFixtureSpec()
    frame_count = round(spec.duration_ms * spec.sample_rate_hz / 1_000)
    leading = round(spec.leading_silence_ms * spec.sample_rate_hz / 1_000)
    trailing = round(spec.trailing_silence_ms * spec.sample_rate_hz / 1_000)
    tone_end = frame_count - trailing
    fade_frames = round(spec.fade_ms * spec.sample_rate_hz / 1_000)
    payload = bytearray()
    for frame in range(frame_count):
        if frame < leading or frame >= tone_end or spec.amplitude == 0:
            sample = 0
        else:
            tone_frame = frame - leading
            tone_length = max(1, tone_end - leading)
            envelope = 1.0
            if fade_frames:
                envelope = min(
                    1.0,
                    (tone_frame + 1) / fade_frames,
                    (tone_length - tone_frame) / fade_frames,
                )
            value = spec.amplitude * envelope * math.sin(
                2 * math.pi * spec.frequency_hz * tone_frame / spec.sample_rate_hz
            )
            sample = max(-32_768, min(32_767, round(value * 32_767)))
        packed = struct.pack("<h", sample)
        payload.extend(packed * spec.channels)

    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(spec.channels)
        wav.setsampwidth(2)
        wav.setframerate(spec.sample_rate_hz)
        wav.writeframes(bytes(payload))
    return output.getvalue()


def measure_wav(
    source: bytes | bytearray | Path | str, *, silence_dbfs: float = -60.0
) -> WavMeasurements:
    if isinstance(source, (bytes, bytearray)):
        stream: io.BytesIO | str = io.BytesIO(source)
    else:
        stream = str(source)
    with wave.open(stream, "rb") as wav:
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        sample_rate = wav.getframerate()
        frame_count = wav.getnframes()
        compressed = wav.getcomptype()
        raw = wav.readframes(frame_count)
    if compressed != "NONE" or sample_width != 2:
        raise ValueError("measurement currently supports uncompressed signed PCM16 WAV")
    if frame_count == 0:
        raise ValueError("cannot measure an empty WAV")

    samples = struct.unpack(f"<{len(raw) // 2}h", raw)
    normalized = tuple(sample / 32_768.0 for sample in samples)
    peak = max(abs(sample) for sample in normalized)
    rms = math.sqrt(sum(sample * sample for sample in normalized) / len(normalized))
    dc = sum(normalized) / len(normalized)
    clipped = sum(abs(sample) >= 32_767 for sample in samples)
    silence_threshold = 10 ** (silence_dbfs / 20)
    silent_samples = sum(abs(sample) <= silence_threshold for sample in normalized)

    frames = tuple(
        normalized[index : index + channels] for index in range(0, len(normalized), channels)
    )
    frame_is_silent = tuple(
        max(abs(sample) for sample in frame) <= silence_threshold for frame in frames
    )
    leading_frames = _leading_true(frame_is_silent)
    trailing_frames = _leading_true(tuple(reversed(frame_is_silent)))
    return WavMeasurements(
        sample_rate_hz=sample_rate,
        channels=channels,
        sample_width_bytes=sample_width,
        frame_count=frame_count,
        duration_ms=frame_count * 1_000 / sample_rate,
        peak_linear=peak,
        peak_dbfs=_dbfs(peak),
        rms_linear=rms,
        rms_dbfs=_dbfs(rms),
        dc_offset=dc,
        clipped_sample_count=clipped,
        silent_sample_ratio=silent_samples / len(normalized),
        leading_silence_ms=leading_frames * 1_000 / sample_rate,
        trailing_silence_ms=trailing_frames * 1_000 / sample_rate,
    )


def _leading_true(values: tuple[bool, ...]) -> int:
    for index, value in enumerate(values):
        if not value:
            return index
    return len(values)


def _dbfs(value: float) -> float:
    return -math.inf if value == 0 else 20 * math.log10(value)
