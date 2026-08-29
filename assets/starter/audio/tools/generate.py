#!/usr/bin/env python3
"""Generate and verify Alystria's original starter audio pack.

The pack is deliberately procedural: it contains no samples, recordings, model
output, or third-party material.  Re-running this file with the same Python and
FFmpeg versions produces the same PCM files and catalog hashes.
"""

from __future__ import annotations

import argparse
import cmath
import hashlib
import json
import math
import re
import subprocess
import sys
import wave
from array import array
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

SAMPLE_RATE = 48_000
CHANNELS = 2
SAMPLE_WIDTH = 3
SEED = "alystria-starter-audio-v1"
CREATOR = "Alystria Studio contributors"
LICENSE = "MIT"
EPSILON = 1e-12


StereoSample = tuple[float, float]
RenderFunction = Callable[[float], StereoSample]


@dataclass(frozen=True)
class AssetDefinition:
    asset_id: str
    filename: str
    display_name: str
    kind: str
    role: str
    description: str
    duration_seconds: float
    render: RenderFunction
    is_loop: bool = False
    recommended_level: float = 0.4
    narration_duck_db: float = 0.0
    visual_alternative: str = ""
    tags: tuple[str, ...] = ()


def clamp(value: float, low: float = -1.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def smoothstep(value: float) -> float:
    value = clamp(value, 0.0, 1.0)
    return value * value * (3.0 - 2.0 * value)


def sine(frequency: float, time_seconds: float, phase: float = 0.0) -> float:
    return math.sin(math.tau * frequency * time_seconds + phase)


def stereo_pan(value: float, pan: float) -> StereoSample:
    angle = (clamp(pan, -1.0, 1.0) + 1.0) * math.pi / 4.0
    return value * math.cos(angle), value * math.sin(angle)


def add(*samples: StereoSample) -> StereoSample:
    return sum(sample[0] for sample in samples), sum(sample[1] for sample in samples)


def one_shot_envelope(
    time_seconds: float,
    start: float,
    duration: float,
    attack: float,
    release: float,
) -> float:
    local = time_seconds - start
    if local <= 0.0 or local >= duration:
        return 0.0
    attack_gain = smoothstep(local / attack) if local < attack else 1.0
    remaining = duration - local
    release_gain = smoothstep(remaining / release) if remaining < release else 1.0
    return attack_gain * release_gain


def bell(
    time_seconds: float,
    start: float,
    frequency: float,
    duration: float,
    gain: float,
    pan: float,
    brightness: float = 0.45,
) -> StereoSample:
    local = time_seconds - start
    if local <= 0.0 or local >= duration:
        return 0.0, 0.0
    attack = smoothstep(min(1.0, local / 0.018))
    decay = math.exp(-4.9 * local / duration)
    tail = smoothstep(min(1.0, (duration - local) / 0.085))
    body = (
        sine(frequency, local)
        + brightness * 0.46 * sine(frequency * 2.006, local, 0.17)
        + brightness * 0.22 * sine(frequency * 3.012, local, 0.41)
        + brightness * 0.10 * sine(frequency * 4.97, local, 0.67)
    )
    return stereo_pan(body * gain * attack * decay * tail, pan)


def soft_pad(
    time_seconds: float,
    frequency: float,
    gain: float,
    pan: float,
    envelope: float,
    phase: float = 0.0,
) -> StereoSample:
    body = (
        sine(frequency, time_seconds, phase)
        + 0.23 * sine(frequency * 2.0, time_seconds, phase * 0.7)
        + 0.08 * sine(frequency * 3.0, time_seconds, phase * 1.3)
    )
    return stereo_pan(body * gain * envelope, pan)


def air_layer(time_seconds: float, duration: float, gain: float = 0.01) -> StereoSample:
    """A deterministic, band-limited periodic texture; this is not white noise."""
    left = 0.0
    right = 0.0
    for index in range(14):
        cycles = 1637 + index * 61
        frequency = cycles / duration
        amplitude = gain / (1.0 + index * 0.35)
        phase = (index * 2.399963229728653) % math.tau
        left += amplitude * sine(frequency, time_seconds, phase)
        right += amplitude * sine(frequency, time_seconds, phase + 0.61)
    return left, right


def make_stinger(
    events: tuple[tuple[float, float, float, float, float, float], ...],
    duration: float,
    bed_notes: tuple[float, ...],
) -> RenderFunction:
    def render(time_seconds: float) -> StereoSample:
        master = one_shot_envelope(time_seconds, 0.0, duration, 0.035, 0.24)
        samples = [
            bell(time_seconds, start, frequency, note_duration, gain, pan, brightness)
            for start, frequency, note_duration, gain, pan, brightness in events
        ]
        bed_envelope = one_shot_envelope(time_seconds, 0.0, duration, 0.12, 0.42)
        for index, frequency in enumerate(bed_notes):
            samples.append(
                soft_pad(
                    time_seconds,
                    frequency,
                    0.023,
                    -0.62 + index * (1.24 / max(1, len(bed_notes) - 1)),
                    bed_envelope,
                    index * 0.37,
                )
            )
        left, right = add(*samples)
        return left * master, right * master

    return render


def make_success(variant: int) -> RenderFunction:
    frequencies = (
        (587.33, 739.99, 987.77) if variant == 0 else (659.25, 830.61, 1108.73)
    )

    def render(time_seconds: float) -> StereoSample:
        samples = []
        for index, frequency in enumerate(frequencies):
            samples.append(
                bell(
                    time_seconds,
                    0.055 + index * 0.105,
                    frequency,
                    0.54 - index * 0.045,
                    0.095 - index * 0.012,
                    -0.38 + index * 0.38,
                    0.42,
                )
            )
        return add(*samples)

    return render


def make_warning(variant: int) -> RenderFunction:
    root = 293.66 if variant == 0 else 311.13

    def render(time_seconds: float) -> StereoSample:
        first = bell(time_seconds, 0.045, root, 0.67, 0.09, -0.17, 0.18)
        second = bell(time_seconds, 0.22, root * 1.1892, 0.62, 0.074, 0.17, 0.16)
        bed_env = one_shot_envelope(time_seconds, 0.03, 0.76, 0.05, 0.18)
        bed = soft_pad(time_seconds, root / 2.0, 0.025, 0.0, bed_env)
        return add(first, second, bed)

    return render


def make_emphasis(variant: int) -> RenderFunction:
    root = 440.0 if variant == 0 else 493.88

    def render(time_seconds: float) -> StereoSample:
        sweep_env = one_shot_envelope(time_seconds, 0.025, 0.47, 0.028, 0.13)
        sweep_frequency = root * (0.88 + 0.24 * smoothstep(time_seconds / 0.33))
        center = stereo_pan(
            (
                sine(sweep_frequency, time_seconds)
                + 0.22 * sine(sweep_frequency * 2.0, time_seconds)
            )
            * 0.085
            * sweep_env,
            0.0,
        )
        edge = bell(
            time_seconds, 0.14, root * 2.0, 0.37, 0.05, 0.22 if variant else -0.22, 0.18
        )
        return add(center, edge)

    return render


def make_quiz_correct(variant: int) -> RenderFunction:
    roots = (
        (392.0, 493.88, 659.25, 783.99)
        if variant == 0
        else (440.0, 554.37, 659.25, 880.0)
    )

    def render(time_seconds: float) -> StereoSample:
        samples = []
        for index, frequency in enumerate(roots):
            samples.append(
                bell(
                    time_seconds,
                    0.04 + index * 0.095,
                    frequency,
                    0.76 - index * 0.04,
                    0.072 - index * 0.006,
                    -0.48 + index * 0.32,
                    0.55,
                )
            )
        shimmer_env = one_shot_envelope(time_seconds, 0.28, 0.68, 0.08, 0.28)
        shimmer = stereo_pan(sine(1760.0, time_seconds) * 0.018 * shimmer_env, 0.35)
        return add(*samples, shimmer)

    return render


def make_quiz_reveal(variant: int) -> RenderFunction:
    root = 349.23 if variant == 0 else 369.99

    def render(time_seconds: float) -> StereoSample:
        envelope = one_shot_envelope(time_seconds, 0.03, 0.65, 0.045, 0.22)
        drift = root * (0.96 + 0.08 * smoothstep(time_seconds / 0.5))
        core = stereo_pan(
            (sine(drift, time_seconds) + 0.31 * sine(drift * 2.0, time_seconds, 0.2))
            * 0.075
            * envelope,
            -0.08 if variant == 0 else 0.08,
        )
        answer = bell(time_seconds, 0.26, root * 1.5, 0.54, 0.062, 0.25, 0.25)
        return add(core, answer)

    return render


def periodic_gain(time_seconds: float, duration: float, phase: float) -> float:
    return (
        0.72
        + 0.18 * sine(1.0 / duration, time_seconds, phase)
        + 0.10 * sine(2.0 / duration, time_seconds, phase * 0.61)
    )


def periodic_pulse(
    time_seconds: float, duration: float, center: float, width: float
) -> float:
    distance = abs(
        ((time_seconds - center + duration / 2.0) % duration) - duration / 2.0
    )
    if distance >= width:
        return 0.0
    return 0.5 + 0.5 * math.cos(math.pi * distance / width)


def make_ambient(duration: float, variant: int) -> RenderFunction:
    source_notes = (
        (146.8125, 220.0, 329.625, 349.25, 440.0)
        if variant == 0
        else (130.8125, 196.0, 293.6875, 369.9375, 392.0)
    )
    # Every oscillator completes an integer cycle count across the file.  The
    # adjustment is at most 1 / (2 * duration) Hz and makes the PCM loop
    # mathematically periodic instead of relying on a destructive crossfade.
    notes = tuple(round(frequency * duration) / duration for frequency in source_notes)

    def render(time_seconds: float) -> StereoSample:
        samples: list[StereoSample] = []
        pans = (-0.68, 0.58, -0.31, 0.36, 0.04)
        for index, frequency in enumerate(notes):
            gain = periodic_gain(time_seconds, duration, index * 0.83)
            samples.append(
                soft_pad(
                    time_seconds,
                    frequency,
                    0.018 if index < 2 else 0.012,
                    pans[index],
                    gain,
                    index * 0.51,
                )
            )
        pulse_centers = (0.0, duration / 3.0, 2.0 * duration / 3.0)
        for index, center in enumerate(pulse_centers):
            pulse = periodic_pulse(time_seconds, duration, center, duration * 0.13)
            frequency = notes[2 + index % 3] * (1.0 if variant == 0 else 0.75)
            samples.append(
                stereo_pan(
                    (
                        sine(frequency, time_seconds, index * 0.7)
                        + 0.18 * sine(frequency * 2.0, time_seconds)
                    )
                    * 0.015
                    * pulse,
                    -0.42 + index * 0.42,
                )
            )
        samples.append(
            air_layer(time_seconds, duration, 0.0036 if variant == 0 else 0.0031)
        )
        return add(*samples)

    return render


def definitions() -> tuple[AssetDefinition, ...]:
    return (
        AssetDefinition(
            "starter.audio.stinger.intro-prism",
            "stingers/intro-prism.wav",
            "Intro — Prism",
            "stinger",
            "intro",
            "A bright, precise rise for title cards and lesson openings.",
            3.2,
            make_stinger(
                (
                    (0.08, 293.66, 1.35, 0.090, -0.52, 0.45),
                    (0.34, 440.00, 1.45, 0.082, -0.12, 0.50),
                    (0.67, 659.25, 1.55, 0.072, 0.28, 0.54),
                    (1.02, 880.00, 1.72, 0.056, 0.58, 0.58),
                ),
                3.2,
                (146.83, 220.00, 329.63),
            ),
            recommended_level=0.42,
            visual_alternative="A title-card thread draws from left to right.",
            tags=("bright", "precise", "opening"),
        ),
        AssetDefinition(
            "starter.audio.stinger.intro-thread",
            "stingers/intro-thread.wav",
            "Intro — Concept Thread",
            "stinger",
            "intro",
            "A restrained, curious opening with a gentle call-and-response contour.",
            2.8,
            make_stinger(
                (
                    (0.08, 261.63, 1.24, 0.084, -0.38, 0.35),
                    (0.42, 392.00, 1.34, 0.076, 0.32, 0.38),
                    (0.78, 587.33, 1.45, 0.061, -0.06, 0.44),
                ),
                2.8,
                (130.81, 196.00, 293.66),
            ),
            recommended_level=0.42,
            visual_alternative="A concept-thread node appears and connects to the lesson title.",
            tags=("curious", "gentle", "opening"),
        ),
        AssetDefinition(
            "starter.audio.stinger.outro-arrival",
            "stingers/outro-arrival.wav",
            "Outro — Arrival",
            "stinger",
            "outro",
            "A warm resolution for recaps, completed sections, and lesson endings.",
            3.6,
            make_stinger(
                (
                    (0.10, 659.25, 1.52, 0.064, 0.45, 0.36),
                    (0.39, 493.88, 1.62, 0.073, 0.05, 0.33),
                    (0.72, 392.00, 1.78, 0.082, -0.34, 0.30),
                    (1.10, 293.66, 1.95, 0.088, -0.08, 0.24),
                ),
                3.6,
                (146.83, 220.00, 293.66),
            ),
            recommended_level=0.43,
            visual_alternative="The final concept-thread nodes converge into a completion marker.",
            tags=("warm", "resolved", "ending"),
        ),
        AssetDefinition(
            "starter.audio.stinger.outro-reflection",
            "stingers/outro-reflection.wav",
            "Outro — Reflection",
            "stinger",
            "outro",
            "A slower, softer close for reflective summaries and source cards.",
            4.1,
            make_stinger(
                (
                    (0.10, 523.25, 1.72, 0.063, 0.42, 0.28),
                    (0.54, 392.00, 1.88, 0.072, -0.18, 0.25),
                    (1.04, 329.63, 2.08, 0.078, -0.44, 0.22),
                    (1.48, 261.63, 2.18, 0.083, 0.03, 0.20),
                ),
                4.1,
                (130.81, 196.00, 261.63),
            ),
            recommended_level=0.40,
            visual_alternative="The summary remains on screen as the concept thread settles.",
            tags=("soft", "reflective", "ending"),
        ),
        AssetDefinition(
            "starter.audio.sfx.ui-success-a",
            "sfx/ui-success-a.wav",
            "UI Success A",
            "sfx",
            "success",
            "A compact three-note confirmation for successful local actions.",
            0.82,
            make_success(0),
            recommended_level=0.36,
            visual_alternative="Show a persistent success state with text and an icon.",
            tags=("ui", "success", "confirmation"),
        ),
        AssetDefinition(
            "starter.audio.sfx.ui-success-b",
            "sfx/ui-success-b.wav",
            "UI Success B",
            "sfx",
            "success",
            "A pitch-shifted companion used to reduce repetitive feedback fatigue.",
            0.82,
            make_success(1),
            recommended_level=0.34,
            visual_alternative="Show a persistent success state with text and an icon.",
            tags=("ui", "success", "variant"),
        ),
        AssetDefinition(
            "starter.audio.sfx.ui-warning-a",
            "sfx/ui-warning-a.wav",
            "UI Warning A",
            "sfx",
            "warning",
            "A calm two-tone caution cue without an alarm-like edge.",
            0.86,
            make_warning(0),
            recommended_level=0.34,
            visual_alternative="Show an amber warning with an actionable text explanation.",
            tags=("ui", "warning", "calm"),
        ),
        AssetDefinition(
            "starter.audio.sfx.ui-warning-b",
            "sfx/ui-warning-b.wav",
            "UI Warning B",
            "sfx",
            "warning",
            "A companion warning contour for alternating repeated cautions.",
            0.86,
            make_warning(1),
            recommended_level=0.32,
            visual_alternative="Show an amber warning with an actionable text explanation.",
            tags=("ui", "warning", "variant"),
        ),
        AssetDefinition(
            "starter.audio.sfx.emphasis-a",
            "sfx/emphasis-a.wav",
            "Emphasis A",
            "sfx",
            "emphasis",
            "A soft upward thread cue for key terms and diagram reveals.",
            0.56,
            make_emphasis(0),
            recommended_level=0.27,
            visual_alternative="Use motion, weight, and a non-color marker to emphasize the same item.",
            tags=("tutorial", "emphasis", "reveal"),
        ),
        AssetDefinition(
            "starter.audio.sfx.emphasis-b",
            "sfx/emphasis-b.wav",
            "Emphasis B",
            "sfx",
            "emphasis",
            "A companion emphasis cue with slightly higher tonal color.",
            0.56,
            make_emphasis(1),
            recommended_level=0.25,
            visual_alternative="Use motion, weight, and a non-color marker to emphasize the same item.",
            tags=("tutorial", "emphasis", "variant"),
        ),
        AssetDefinition(
            "starter.audio.sfx.quiz-correct-a",
            "sfx/quiz-correct-a.wav",
            "Quiz Correct A",
            "sfx",
            "quiz-success",
            "A clear celebratory answer cue that remains restrained under narration.",
            1.12,
            make_quiz_correct(0),
            recommended_level=0.32,
            visual_alternative="Keep the correct answer marked with text, icon, and explanation.",
            tags=("quiz", "correct", "celebratory"),
        ),
        AssetDefinition(
            "starter.audio.sfx.quiz-correct-b",
            "sfx/quiz-correct-b.wav",
            "Quiz Correct B",
            "sfx",
            "quiz-success",
            "An alternate quiz-success phrase for varied practice sequences.",
            1.12,
            make_quiz_correct(1),
            recommended_level=0.30,
            visual_alternative="Keep the correct answer marked with text, icon, and explanation.",
            tags=("quiz", "correct", "variant"),
        ),
        AssetDefinition(
            "starter.audio.sfx.quiz-reveal-a",
            "sfx/quiz-reveal-a.wav",
            "Quiz Reveal A",
            "sfx",
            "quiz-reveal",
            "A neutral reveal cue for showing an answer without implying correctness.",
            0.78,
            make_quiz_reveal(0),
            recommended_level=0.25,
            visual_alternative="Reveal the answer with a labelled explanation panel.",
            tags=("quiz", "reveal", "neutral"),
        ),
        AssetDefinition(
            "starter.audio.sfx.quiz-reveal-b",
            "sfx/quiz-reveal-b.wav",
            "Quiz Reveal B",
            "sfx",
            "quiz-reveal",
            "A second neutral answer-reveal cue for repeated interactions.",
            0.78,
            make_quiz_reveal(1),
            recommended_level=0.24,
            visual_alternative="Reveal the answer with a labelled explanation panel.",
            tags=("quiz", "reveal", "variant"),
        ),
        AssetDefinition(
            "starter.audio.music.focus-loop",
            "music/focus-loop.wav",
            "Focus Loop",
            "music",
            "ambient-bed",
            "A sparse, cool suspended bed for quiet diagram and code passages.",
            12.0,
            make_ambient(12.0, 0),
            is_loop=True,
            recommended_level=0.16,
            narration_duck_db=-8.0,
            visual_alternative="Music is decorative; no information is carried only in audio.",
            tags=("ambient", "focus", "cool", "seamless"),
        ),
        AssetDefinition(
            "starter.audio.music.inquiry-loop",
            "music/inquiry-loop.wav",
            "Inquiry Loop",
            "music",
            "ambient-bed",
            "A warm, open-ended suspended bed for research and reflection scenes.",
            12.0,
            make_ambient(12.0, 1),
            is_loop=True,
            recommended_level=0.15,
            narration_duck_db=-8.0,
            visual_alternative="Music is decorative; no information is carried only in audio.",
            tags=("ambient", "inquiry", "warm", "seamless"),
        ),
    )


def render_asset(definition: AssetDefinition, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    frame_count = round(definition.duration_seconds * SAMPLE_RATE)
    left = array("f")
    right = array("f")
    peak = 0.0
    for frame in range(frame_count):
        sample_left, sample_right = definition.render(frame / SAMPLE_RATE)
        sample_left = math.tanh(sample_left * 1.18) / math.tanh(1.18)
        sample_right = math.tanh(sample_right * 1.18) / math.tanh(1.18)
        left.append(sample_left)
        right.append(sample_right)
        peak = max(peak, abs(sample_left), abs(sample_right))

    target_peak = 10.0 ** ((-6.0 if definition.kind == "music" else -4.8) / 20.0)
    scale = target_peak / max(peak, EPSILON)
    dither_state = int.from_bytes(
        hashlib.sha256(f"{SEED}:{definition.asset_id}".encode()).digest()[:8], "little"
    )

    def dither_value() -> float:
        nonlocal dither_state
        # xorshift64*: deterministic and used only to decorrelate 24-bit TPDF
        # dither.  It is not a security or content-generation random source.
        dither_state ^= dither_state >> 12
        dither_state ^= (dither_state << 25) & 0xFFFFFFFFFFFFFFFF
        dither_state ^= dither_state >> 27
        first = (dither_state * 2685821657736338717) & 0xFFFFFFFFFFFFFFFF
        dither_state ^= dither_state >> 12
        dither_state ^= (dither_state << 25) & 0xFFFFFFFFFFFFFFFF
        dither_state ^= dither_state >> 27
        second = (dither_state * 2685821657736338717) & 0xFFFFFFFFFFFFFFFF
        return (((first >> 40) - (second >> 40)) / 16_777_215.0) / 8_388_608.0

    with wave.open(str(output_path), "wb") as output:
        output.setnchannels(CHANNELS)
        output.setsampwidth(SAMPLE_WIDTH)
        output.setframerate(SAMPLE_RATE)
        chunk = bytearray()
        for sample_left, sample_right in zip(left, right, strict=True):
            # Deterministic TPDF dither at one 24-bit least-significant bit.
            dither_left = dither_value()
            dither_right = dither_value()
            for value, dither in (
                (sample_left, dither_left),
                (sample_right, dither_right),
            ):
                integer = round(
                    clamp(value * scale + dither, -0.99999988, 0.99999988) * 8_388_607.0
                )
                chunk.extend(int(integer).to_bytes(3, "little", signed=True))
            if len(chunk) >= 196_608:
                output.writeframesraw(chunk)
                chunk.clear()
        if chunk:
            output.writeframesraw(chunk)


def read_pcm24(path: Path) -> tuple[array, array, int]:
    with wave.open(str(path), "rb") as source:
        if source.getnchannels() != 2 or source.getsampwidth() != 3:
            raise ValueError(f"{path} is not 24-bit stereo PCM")
        sample_rate = source.getframerate()
        raw = source.readframes(source.getnframes())
    left = array("f")
    right = array("f")
    for offset in range(0, len(raw), 6):
        left.append(
            int.from_bytes(raw[offset : offset + 3], "little", signed=True)
            / 8_388_608.0
        )
        right.append(
            int.from_bytes(raw[offset + 3 : offset + 6], "little", signed=True)
            / 8_388_608.0
        )
    return left, right, sample_rate


def dbfs(value: float) -> float:
    return round(20.0 * math.log10(max(abs(value), EPSILON)), 3)


def rms(values: Iterable[float]) -> float:
    values_list = list(values)
    if not values_list:
        return 0.0
    return math.sqrt(sum(value * value for value in values_list) / len(values_list))


def fft(values: list[complex]) -> list[complex]:
    size = len(values)
    if size == 1:
        return values
    even = fft(values[0::2])
    odd = fft(values[1::2])
    result = [0j] * size
    for index in range(size // 2):
        factor = cmath.exp(-2j * math.pi * index / size) * odd[index]
        result[index] = even[index] + factor
        result[index + size // 2] = even[index] - factor
    return result


def spectrum_metrics(left: array, right: array, sample_rate: int) -> dict[str, float]:
    size = 4096
    mono = [(left[index] + right[index]) * 0.5 for index in range(len(left))]
    window_hop = max(size, len(mono) // 48)
    best_start = 0
    best_energy = -1.0
    for start in range(0, max(1, len(mono) - size), window_hop):
        energy = sum(value * value for value in mono[start : start + size])
        if energy > best_energy:
            best_energy = energy
            best_start = start
    segment = mono[best_start : best_start + size]
    segment += [0.0] * (size - len(segment))
    windowed = [
        value * (0.5 - 0.5 * math.cos(math.tau * index / (size - 1)))
        for index, value in enumerate(segment)
    ]
    bins = fft([complex(value, 0.0) for value in windowed])[: size // 2]
    powers = [max(abs(value) ** 2, 1e-24) for value in bins[1:]]
    arithmetic = sum(powers) / len(powers)
    geometric = math.exp(sum(math.log(value) for value in powers) / len(powers))
    total_power = sum(powers)
    hiss_start = math.ceil(5_000.0 * size / sample_rate) - 1
    hiss_share = sum(powers[hiss_start:]) / max(total_power, EPSILON)
    centroid = sum(
        ((index + 1) * sample_rate / size) * power for index, power in enumerate(powers)
    ) / max(total_power, EPSILON)
    return {
        "spectralFlatness": round(geometric / max(arithmetic, EPSILON), 6),
        "hissShareAbove5kHz": round(hiss_share, 6),
        "spectralCentroidHz": round(centroid, 2),
    }


def sample_metrics(path: Path, is_loop: bool) -> dict[str, object]:
    left, right, sample_rate = read_pcm24(path)
    combined = list(left) + list(right)
    peak = max(abs(value) for value in combined)
    overall_rms = rms(combined)
    dc = max(abs(sum(left) / len(left)), abs(sum(right) / len(right)))
    clipped = sum(1 for value in combined if abs(value) >= 1.0)
    first_window = min(len(left), round(sample_rate * 0.02))
    last_window = min(len(left), round(sample_rate * 0.03))
    onset_rms = rms(list(left[:first_window]) + list(right[:first_window]))
    tail_rms = rms(list(left[-last_window:]) + list(right[-last_window:]))
    seam_step = max(abs(left[0] - left[-1]), abs(right[0] - right[-1]))
    derivative_mismatch = max(
        abs((left[0] - left[-1]) - (left[1] - left[0])),
        abs((right[0] - right[-1]) - (right[1] - right[0])),
        abs((left[0] - left[-1]) - (left[-1] - left[-2])),
        abs((right[0] - right[-1]) - (right[-1] - right[-2])),
    )
    result: dict[str, object] = {
        "samplePeakDbfs": dbfs(peak),
        "rmsDbfs": dbfs(overall_rms),
        "dcOffsetDbfs": dbfs(dc),
        "clippedSamples": clipped,
        "onsetRmsDbfs": dbfs(onset_rms),
        "tailRmsDbfs": dbfs(tail_rms),
        **spectrum_metrics(left, right, sample_rate),
    }
    if is_loop:
        result["loopSeamStepDbfs"] = dbfs(seam_step)
        result["loopDerivativeMismatchDbfs"] = dbfs(derivative_mismatch)
    else:
        frame_levels = [
            max(abs(sample_left), abs(sample_right))
            for sample_left, sample_right in zip(left, right, strict=True)
        ]
        global_peak = max(frame_levels)
        active_threshold = global_peak * 0.0001
        active_index = next(
            (
                index
                for index, value in enumerate(frame_levels)
                if value >= active_threshold
            ),
            0,
        )
        analysis_end = min(len(frame_levels), active_index + round(sample_rate * 0.12))
        local_peak = max(frame_levels[active_index:analysis_end], default=global_peak)
        first_millisecond_end = min(
            len(frame_levels), active_index + round(sample_rate * 0.001)
        )
        onset_peak = max(frame_levels[active_index:first_millisecond_end], default=0.0)
        attack_index = next(
            (
                index
                for index in range(active_index, analysis_end)
                if frame_levels[index] >= local_peak * 0.9
            ),
            analysis_end,
        )
        result["onsetRatio1ms"] = round(onset_peak / max(local_peak, EPSILON), 6)
        result["attackMs"] = round(
            (attack_index - active_index) * 1000.0 / sample_rate, 3
        )
    return result


def ffmpeg_metrics(ffmpeg: Path, path: Path) -> tuple[float, float]:
    input_path = str(path)
    if ffmpeg.suffix.lower() == ".exe" and sys.platform != "win32":
        input_path = subprocess.run(
            ["wslpath", "-w", str(path)],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        ).stdout.strip()
    result = subprocess.run(
        [
            str(ffmpeg),
            "-hide_banner",
            "-nostats",
            "-i",
            input_path,
            "-filter_complex",
            "ebur128=peak=true",
            "-f",
            "null",
            "-",
        ],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    output = result.stderr
    integrated_matches = re.findall(r"I:\s+(-?[0-9.]+) LUFS", output)
    peak_matches = re.findall(r"Peak:\s+(-?[0-9.]+) dBFS", output)
    if not integrated_matches or not peak_matches:
        raise RuntimeError(f"could not parse ebur128 output for {path}")
    return float(integrated_matches[-1]), float(peak_matches[-1])


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ffmpeg_version(ffmpeg: Path) -> str:
    result = subprocess.run(
        [str(ffmpeg), "-version"],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return result.stdout.splitlines()[0]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--ffmpeg",
        type=Path,
        required=True,
        help="Pinned or reviewed FFmpeg executable used for BS.1770/true-peak measurements.",
    )
    args = parser.parse_args()
    ffmpeg = args.ffmpeg.resolve()
    if not ffmpeg.is_file():
        parser.error(f"FFmpeg does not exist: {ffmpeg}")

    audio_root = Path(__file__).resolve().parents[1]
    catalog_assets: list[dict[str, object]] = []
    verification_assets: list[dict[str, object]] = []
    for definition in definitions():
        output_path = audio_root / definition.filename
        render_asset(definition, output_path)
        measurements = sample_metrics(output_path, definition.is_loop)
        integrated_lufs, true_peak_dbtp = ffmpeg_metrics(ffmpeg, output_path)
        measurements["integratedLufs"] = integrated_lufs
        measurements["truePeakDbtp"] = true_peak_dbtp

        failures = []
        if int(measurements["clippedSamples"]) != 0:
            failures.append("contains clipped samples")
        if float(measurements["truePeakDbtp"]) > -2.0:
            failures.append("true peak exceeds -2 dBTP")
        if float(measurements["dcOffsetDbfs"]) > -70.0:
            failures.append("DC offset exceeds -70 dBFS")
        if definition.is_loop:
            if float(measurements["loopDerivativeMismatchDbfs"]) > -52.0:
                failures.append("loop derivative mismatch exceeds -52 dBFS")
        else:
            if float(measurements["onsetRatio1ms"]) > 0.35:
                failures.append(
                    "one-shot onset exceeds 35% of local peak in the first millisecond"
                )
            if float(measurements["attackMs"]) < 3.0:
                failures.append("one-shot attack reaches 90% in under 3 ms")
            if float(measurements["tailRmsDbfs"]) > -58.0:
                failures.append("one-shot tail exceeds -58 dBFS")

        file_hash = file_sha256(output_path)
        catalog_assets.append(
            {
                "id": definition.asset_id,
                "displayName": definition.display_name,
                "kind": definition.kind,
                "role": definition.role,
                "description": definition.description,
                "path": definition.filename.replace("\\", "/"),
                "mimeType": "audio/wav",
                "sha256": file_hash,
                "bytes": output_path.stat().st_size,
                "format": {
                    "codec": "pcm_s24le",
                    "sampleRateHz": SAMPLE_RATE,
                    "channels": CHANNELS,
                    "bitDepth": 24,
                    "durationSeconds": definition.duration_seconds,
                },
                "loop": {
                    "enabled": definition.is_loop,
                    "startFrame": 0 if definition.is_loop else None,
                    "endFrameExclusive": round(
                        definition.duration_seconds * SAMPLE_RATE
                    )
                    if definition.is_loop
                    else None,
                },
                "mix": {
                    "enabledByDefault": False,
                    "recommendedLinearLevel": definition.recommended_level,
                    "duckUnderNarrationDb": definition.narration_duck_db,
                    "bus": "music" if definition.kind == "music" else "effects",
                    "autoplay": False,
                },
                "accessibility": {
                    "carriesEssentialInformation": False,
                    "requiredVisualAlternative": definition.visual_alternative,
                },
                "tags": list(definition.tags),
                "provenance": {
                    "creator": CREATOR,
                    "origin": "alystria-authored-procedural-synthesis",
                    "rightsStatus": "owned",
                    "licenseExpression": LICENSE,
                    "sourceGenerator": "tools/generate.py",
                    "generatorSeed": SEED,
                    "ingredients": [],
                    "usesThirdPartySamples": False,
                    "usesGenerativeAi": False,
                },
                "measurements": measurements,
            }
        )
        verification_assets.append(
            {
                "id": definition.asset_id,
                "path": definition.filename.replace("\\", "/"),
                "sha256": file_hash,
                "measurements": measurements,
                "status": "pass" if not failures else "fail",
                "failures": failures,
            }
        )

    catalog = {
        "$schema": "https://alystria.local/schemas/starter-audio-catalog-v1.json",
        "schemaVersion": 1,
        "catalogId": "alystria.starter-audio.v1",
        "displayName": "Alystria Starter Audio",
        "defaultPolicy": {
            "musicEnabled": False,
            "soundEffectsEnabled": False,
            "stingersEnabled": False,
            "autoplay": False,
            "preserveVisualAlternatives": True,
        },
        "licenseExpression": LICENSE,
        "creator": CREATOR,
        "assets": catalog_assets,
    }
    verification = {
        "schemaVersion": 1,
        "catalogId": catalog["catalogId"],
        "sampleProbe": "tools/generate.py deterministic PCM analysis",
        "loudnessProbe": ffmpeg_version(ffmpeg),
        "qualityGates": {
            "clippedSamples": 0,
            "maximumTruePeakDbtp": -2.0,
            "maximumDcOffsetDbfs": -70.0,
            "maximumLoopDerivativeMismatchDbfs": -52.0,
            "maximumOneShotTailRmsDbfs": -58.0,
            "maximumOneShotOnsetRatio1ms": 0.35,
            "minimumOneShotAttackMs": 3.0,
        },
        "assets": verification_assets,
        "status": "pass"
        if all(asset["status"] == "pass" for asset in verification_assets)
        else "fail",
        "humanListeningReviewRequired": True,
    }
    (audio_root / "catalog.json").write_text(
        json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (audio_root / "verification.json").write_text(
        json.dumps(verification, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "assets": len(catalog_assets),
                "status": verification["status"],
                "catalog": str(audio_root / "catalog.json"),
            }
        )
    )
    return 0 if verification["status"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
