"""Measurable narration and mastered-audio quality gates."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .wav import WavMeasurements


class QAStatus(StrEnum):
    NOT_RUN = "NOT_RUN"
    PASSED = "PASSED"
    FAILED = "FAILED"


class QASeverity(StrEnum):
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"


@dataclass(frozen=True, slots=True)
class ASRVerification:
    status: QAStatus = QAStatus.NOT_RUN
    engine: str | None = None
    reference_text: str | None = None
    transcript: str | None = None
    word_error_rate: float | None = None
    aligned_token_ratio: float | None = None
    note: str = "ASR adapter has not supplied a result"

    def __post_init__(self) -> None:
        if self.word_error_rate is not None and self.word_error_rate < 0:
            raise ValueError("word error rate cannot be negative")
        if self.aligned_token_ratio is not None and not 0 <= self.aligned_token_ratio <= 1:
            raise ValueError("aligned token ratio must be between 0 and 1")
        if self.status is not QAStatus.NOT_RUN and not self.engine:
            raise ValueError("completed ASR verification requires an engine")


@dataclass(frozen=True, slots=True)
class LoudnessMeasurement:
    integrated_lufs: float
    true_peak_dbtp: float
    loudness_range_lu: float | None = None
    tool: str = "ffmpeg-loudnorm"


@dataclass(frozen=True, slots=True)
class AudioQAPolicy:
    target_lufs: float = -16.0
    lufs_tolerance: float = 1.0
    max_true_peak_dbtp: float = -1.5
    max_duration_delta_ms: float = 1_000 / 24
    max_leading_silence_ms: float = 500.0
    max_trailing_silence_ms: float = 750.0
    max_silent_sample_ratio: float = 0.95
    max_word_error_rate: float = 0.03
    min_aligned_token_ratio: float = 0.98


@dataclass(frozen=True, slots=True)
class AudioQAFinding:
    code: str
    severity: QASeverity
    message: str
    measured: float | int | None = None
    expected: str | None = None


@dataclass(frozen=True, slots=True)
class AudioQAResult:
    status: QAStatus
    findings: tuple[AudioQAFinding, ...]
    measurements: WavMeasurements
    loudness: LoudnessMeasurement | None
    asr: ASRVerification


def evaluate_audio_quality(
    measurements: WavMeasurements,
    *,
    expected_duration_ms: float,
    loudness: LoudnessMeasurement | None = None,
    asr: ASRVerification | None = None,
    policy: AudioQAPolicy | None = None,
) -> AudioQAResult:
    if asr is None:
        asr = ASRVerification()
    if policy is None:
        policy = AudioQAPolicy()
    findings: list[AudioQAFinding] = []
    if measurements.clipped_sample_count:
        findings.append(
            AudioQAFinding(
                "AUDIO_CLIPPING",
                QASeverity.ERROR,
                "PCM contains full-scale samples",
                measurements.clipped_sample_count,
                "0 clipped samples",
            )
        )
    if measurements.is_digital_silence:
        findings.append(
            AudioQAFinding("AUDIO_SILENT", QASeverity.ERROR, "audio is digital silence")
        )
    elif measurements.silent_sample_ratio > policy.max_silent_sample_ratio:
        findings.append(
            AudioQAFinding(
                "AUDIO_MOSTLY_SILENT",
                QASeverity.ERROR,
                "audio is mostly silent",
                measurements.silent_sample_ratio,
                f"<= {policy.max_silent_sample_ratio:.3f}",
            )
        )
    if measurements.leading_silence_ms > policy.max_leading_silence_ms:
        findings.append(
            AudioQAFinding(
                "AUDIO_LEADING_SILENCE",
                QASeverity.WARNING,
                "leading silence exceeds policy",
                measurements.leading_silence_ms,
                f"<= {policy.max_leading_silence_ms:.1f} ms",
            )
        )
    if measurements.trailing_silence_ms > policy.max_trailing_silence_ms:
        findings.append(
            AudioQAFinding(
                "AUDIO_TRAILING_SILENCE",
                QASeverity.WARNING,
                "trailing silence exceeds policy",
                measurements.trailing_silence_ms,
                f"<= {policy.max_trailing_silence_ms:.1f} ms",
            )
        )
    duration_delta = abs(measurements.duration_ms - expected_duration_ms)
    if duration_delta > policy.max_duration_delta_ms:
        findings.append(
            AudioQAFinding(
                "AUDIO_DURATION_MISMATCH",
                QASeverity.ERROR,
                "audio duration differs from the render contract by more than one frame",
                duration_delta,
                f"<= {policy.max_duration_delta_ms:.3f} ms",
            )
        )

    if loudness is None:
        findings.append(
            AudioQAFinding(
                "LOUDNESS_NOT_MEASURED",
                QASeverity.WARNING,
                "sample RMS is available, but integrated LUFS/true peak require a loudness adapter",
                measurements.rms_dbfs,
                "FFmpeg loudnorm or equivalent result",
            )
        )
    else:
        if abs(loudness.integrated_lufs - policy.target_lufs) > policy.lufs_tolerance:
            findings.append(
                AudioQAFinding(
                    "LOUDNESS_OUT_OF_RANGE",
                    QASeverity.ERROR,
                    "integrated programme loudness is outside target tolerance",
                    loudness.integrated_lufs,
                    f"{policy.target_lufs:.1f} +/- {policy.lufs_tolerance:.1f} LUFS",
                )
            )
        if loudness.true_peak_dbtp > policy.max_true_peak_dbtp:
            findings.append(
                AudioQAFinding(
                    "TRUE_PEAK_TOO_HIGH",
                    QASeverity.ERROR,
                    "true peak exceeds the delivery ceiling",
                    loudness.true_peak_dbtp,
                    f"<= {policy.max_true_peak_dbtp:.1f} dBTP",
                )
            )

    if asr.status is QAStatus.NOT_RUN:
        findings.append(
            AudioQAFinding(
                "ASR_NOT_RUN",
                QASeverity.WARNING,
                "speech intelligibility verification has not run",
            )
        )
    elif asr.status is QAStatus.FAILED:
        findings.append(AudioQAFinding("ASR_ADAPTER_FAILED", QASeverity.ERROR, asr.note))
    else:
        if asr.word_error_rate is None or asr.word_error_rate > policy.max_word_error_rate:
            findings.append(
                AudioQAFinding(
                    "ASR_WER_TOO_HIGH",
                    QASeverity.ERROR,
                    "speech transcription differs too much from narration",
                    asr.word_error_rate,
                    f"<= {policy.max_word_error_rate:.3f}",
                )
            )
        if (
            asr.aligned_token_ratio is None
            or asr.aligned_token_ratio < policy.min_aligned_token_ratio
        ):
            findings.append(
                AudioQAFinding(
                    "ALIGNMENT_COVERAGE_LOW",
                    QASeverity.ERROR,
                    "too few narration tokens have reliable alignment",
                    asr.aligned_token_ratio,
                    f">= {policy.min_aligned_token_ratio:.3f}",
                )
            )

    status = (
        QAStatus.FAILED
        if any(finding.severity is QASeverity.ERROR for finding in findings)
        else QAStatus.PASSED
    )
    return AudioQAResult(status, tuple(findings), measurements, loudness, asr)
