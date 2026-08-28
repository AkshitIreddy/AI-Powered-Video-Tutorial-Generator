"""Audio-master and frame-accurate timeline quality gates."""

from __future__ import annotations

from dataclasses import dataclass
from math import isfinite

from .models import Finding, QualityGate, Severity

TARGET_LUFS = -16.0
LUFS_TOLERANCE = 1.0
MAX_TRUE_PEAK_DBTP = -1.5
MAX_ASR_WER = 0.03
MIN_ALIGNED_TOKEN_RATIO = 0.98


@dataclass(frozen=True, slots=True)
class AudioMetrics:
    duration_seconds: float
    sample_rate_hz: int
    channels: int
    integrated_lufs: float
    true_peak_dbtp: float
    clipped_samples: int
    asr_wer: float | None = None
    aligned_token_ratio: float | None = None


@dataclass(frozen=True, slots=True)
class CaptionCue:
    cue_id: str
    start_seconds: float
    end_seconds: float


@dataclass(frozen=True, slots=True)
class TimelineMetrics:
    scene_id: str
    duration_seconds: float
    audio_duration_seconds: float
    visual_end_seconds: float
    fps: float
    captions: tuple[CaptionCue, ...] = ()


def check_audio(metrics: AudioMetrics) -> QualityGate:
    findings: list[Finding] = []
    numeric = (
        metrics.duration_seconds,
        metrics.integrated_lufs,
        metrics.true_peak_dbtp,
    )
    optional_numeric = tuple(
        value for value in (metrics.asr_wer, metrics.aligned_token_ratio) if value is not None
    )
    if not all(isfinite(value) for value in numeric + optional_numeric):
        findings.append(
            Finding(
                "audio.non_finite_metric",
                "Audio metrics contain NaN or infinity.",
                Severity.CRITICAL,
            )
        )
        return QualityGate.from_findings("media.audio", "audio", findings)
    if metrics.duration_seconds <= 0 or metrics.sample_rate_hz <= 0 or metrics.channels <= 0:
        findings.append(
            Finding("audio.invalid_stream", "Audio stream metadata is invalid.", Severity.CRITICAL)
        )
    if metrics.clipped_samples:
        findings.append(
            Finding(
                "audio.clipping",
                f"Audio contains {metrics.clipped_samples} clipped samples.",
                Severity.MAJOR,
                evidence=str(metrics.clipped_samples),
                repairable=True,
            )
        )
    if abs(metrics.integrated_lufs - TARGET_LUFS) > LUFS_TOLERANCE:
        findings.append(
            Finding(
                "audio.loudness",
                f"Integrated loudness {metrics.integrated_lufs:.1f} LUFS is outside -16 ±1 LUFS.",
                Severity.MAJOR,
                evidence=f"{metrics.integrated_lufs:.3f}",
                repairable=True,
            )
        )
    if metrics.true_peak_dbtp > MAX_TRUE_PEAK_DBTP:
        findings.append(
            Finding(
                "audio.true_peak",
                f"True peak {metrics.true_peak_dbtp:.1f} dBTP exceeds -1.5 dBTP.",
                Severity.MAJOR,
                repairable=True,
            )
        )
    if metrics.asr_wer is not None and metrics.asr_wer > MAX_ASR_WER:
        findings.append(
            Finding(
                "audio.asr_wer",
                f"Narration WER {metrics.asr_wer:.1%} exceeds 3%.",
                Severity.MAJOR,
                repairable=True,
            )
        )
    if (
        metrics.aligned_token_ratio is not None
        and metrics.aligned_token_ratio < MIN_ALIGNED_TOKEN_RATIO
    ):
        findings.append(
            Finding(
                "audio.alignment_coverage",
                f"Aligned-token coverage {metrics.aligned_token_ratio:.1%} is below 98%.",
                Severity.MAJOR,
                repairable=True,
            )
        )
    return QualityGate.from_findings("media.audio", "audio", findings)


def check_timeline(metrics: TimelineMetrics) -> QualityGate:
    findings: list[Finding] = []
    location = f"scene:{metrics.scene_id}"
    timeline_numbers = (
        metrics.duration_seconds,
        metrics.audio_duration_seconds,
        metrics.visual_end_seconds,
        metrics.fps,
    )
    if not all(isfinite(value) for value in timeline_numbers):
        findings.append(
            Finding(
                "timeline.non_finite_metric",
                "Timeline metrics contain NaN or infinity.",
                Severity.CRITICAL,
                location,
            )
        )
        return QualityGate.from_findings("media.timeline", "timeline", findings)
    if metrics.duration_seconds <= 0 or metrics.fps <= 0:
        findings.append(
            Finding(
                "timeline.invalid",
                "Timeline duration and FPS must be positive.",
                Severity.CRITICAL,
                location,
            )
        )
        return QualityGate.from_findings("media.timeline", "timeline", findings)
    frame = 1 / metrics.fps
    for name, end in (
        ("audio", metrics.audio_duration_seconds),
        ("visual", metrics.visual_end_seconds),
    ):
        if abs(end - metrics.duration_seconds) > frame + 1e-9:
            findings.append(
                Finding(
                    f"timeline.{name}_drift",
                    f"{name.title()} ends more than one frame from the scene boundary.",
                    Severity.MAJOR,
                    location,
                    evidence=f"drift_seconds={end - metrics.duration_seconds:.6f}",
                    repairable=True,
                )
            )
    previous_end = 0.0
    for cue in sorted(metrics.captions, key=lambda item: (item.start_seconds, item.cue_id)):
        cue_location = f"{location}/caption:{cue.cue_id}"
        if (
            cue.start_seconds < 0
            or cue.end_seconds <= cue.start_seconds
            or cue.end_seconds > metrics.duration_seconds + frame
        ):
            findings.append(
                Finding(
                    "timeline.caption_bounds",
                    f"Caption {cue.cue_id} has invalid timing.",
                    Severity.MAJOR,
                    cue_location,
                    repairable=True,
                )
            )
        if cue.start_seconds < previous_end - 1e-9:
            findings.append(
                Finding(
                    "timeline.caption_overlap",
                    f"Caption {cue.cue_id} overlaps the previous cue.",
                    Severity.MINOR,
                    cue_location,
                    repairable=True,
                )
            )
        previous_end = max(previous_end, cue.end_seconds)
    return QualityGate.from_findings("media.timeline", "timeline", findings)
