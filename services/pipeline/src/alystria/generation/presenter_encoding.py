"""Fail-closed H.264 encoder selection for managed local presenter workers.

MuseTalk 1.5's upstream inference script currently asks FFmpeg for ``libx264``
directly.  Alystria's MIT core ships an LGPL FFmpeg runtime, so a managed
MuseTalk worker must use this brokered contract instead of inheriting that
upstream default.  The broker performs a real one-frame encode with each
eligible hardware encoder and records every attempted fallback.

The selected value is intentionally a small enum, not a user-controlled FFmpeg
argument.  A packaged worker can consume :func:`build_presenter_mux_argv` or
the equivalent fields written to ``presenter-job.json``.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any, Protocol


class PresenterEncoderPolicyError(RuntimeError):
    """No policy-compliant presenter delivery encoder is usable."""


class PresenterVideoEncoder(StrEnum):
    H264_NVENC = "h264_nvenc"
    H264_MEDIA_FOUNDATION = "h264_mf"
    LIBX264 = "libx264"


ENCODER_PRIORITY = (
    PresenterVideoEncoder.H264_NVENC,
    PresenterVideoEncoder.H264_MEDIA_FOUNDATION,
    PresenterVideoEncoder.LIBX264,
)


@dataclass(frozen=True, slots=True)
class EncoderProbeResult:
    exit_code: int
    stdout: str = ""
    stderr: str = ""


class EncoderProbeOutcome(Protocol):
    exit_code: int
    stdout: str
    stderr: str


class EncoderProbeRunner(Protocol):
    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        environment: Mapping[str, str],
        timeout_seconds: float,
        cancelled: Callable[[], bool],
    ) -> Any: ...


@dataclass(frozen=True, slots=True)
class GplX264Approval:
    """Durable evidence permitting one separately installed GPL runtime pack."""

    runtime_pack_id: str
    consent_id: str
    license_id: str = "GPL-2.0-or-later"

    def __post_init__(self) -> None:
        if not re.fullmatch(r"ffmpeg-gpl-x264/[A-Za-z0-9._-]{1,96}", self.runtime_pack_id):
            raise ValueError(
                "GPL x264 fallback requires an installed ffmpeg-gpl-x264/<version> pack ID"
            )
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{2,127}", self.consent_id):
            raise ValueError("GPL x264 fallback requires a durable explicit consent ID")
        if self.license_id != "GPL-2.0-or-later":
            raise ValueError("GPL x264 fallback license must be GPL-2.0-or-later")


@dataclass(frozen=True, slots=True)
class PresenterEncoderProbe:
    encoder: PresenterVideoEncoder
    available: bool
    diagnostic_code: str
    message: str

    def as_manifest(self) -> dict[str, object]:
        return {
            "encoder": self.encoder.value,
            "available": self.available,
            "diagnosticCode": self.diagnostic_code,
            "message": self.message,
        }


@dataclass(frozen=True, slots=True)
class PresenterEncoderSelection:
    encoder: PresenterVideoEncoder
    probes: tuple[PresenterEncoderProbe, ...]
    gpl_runtime_pack_id: str | None = None
    gpl_consent_id: str | None = None

    @property
    def fallback_occurred(self) -> bool:
        return self.encoder is not ENCODER_PRIORITY[0]

    @property
    def codec_arguments(self) -> tuple[str, ...]:
        if self.encoder is PresenterVideoEncoder.H264_NVENC:
            return ("-c:v", "h264_nvenc")
        if self.encoder is PresenterVideoEncoder.H264_MEDIA_FOUNDATION:
            # h264_mf can otherwise select its software implementation.  The
            # managed policy permits Media Foundation only when hardware is
            # explicitly forced and its one-frame probe succeeds.
            return ("-c:v", "h264_mf", "-hw_encoding", "1")
        return ("-c:v", "libx264", "-preset", "medium", "-crf", "18")

    def as_manifest(self) -> dict[str, object]:
        return {
            "policy": "alystria-presenter-h264-v1",
            "encoder": self.encoder.value,
            "codecArguments": list(self.codec_arguments),
            "pixelFormat": "yuv420p",
            "audioEncoder": "aac",
            "fallbackOccurred": self.fallback_occurred,
            "probes": [probe.as_manifest() for probe in self.probes],
            "gplRuntimePackId": self.gpl_runtime_pack_id,
            "gplConsentId": self.gpl_consent_id,
        }


@dataclass(frozen=True, slots=True)
class PresenterEncoderPolicy:
    """Fixed-priority policy for one pinned FFmpeg executable."""

    ffmpeg_path: Path
    ffmpeg_sha256: str
    probe_timeout_seconds: float = 30
    gpl_x264_approval: GplX264Approval | None = None

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[0-9a-f]{64}", self.ffmpeg_sha256):
            raise ValueError("Presenter FFmpeg SHA-256 must be 64 lowercase hex characters")
        if self.probe_timeout_seconds <= 0 or self.probe_timeout_seconds > 120:
            raise ValueError("Presenter encoder probe timeout must be between 0 and 120 seconds")

    def select(
        self,
        runner: EncoderProbeRunner,
        *,
        cwd: Path,
        environment: Mapping[str, str],
        cancelled: Callable[[], bool],
    ) -> PresenterEncoderSelection:
        """Probe encoders in fixed order and return a fully auditable choice."""

        probes: list[PresenterEncoderProbe] = []
        for encoder in ENCODER_PRIORITY:
            if encoder is PresenterVideoEncoder.LIBX264:
                approval = self.gpl_x264_approval
                if approval is None:
                    probes.append(
                        PresenterEncoderProbe(
                            encoder,
                            False,
                            "gpl-consent-required",
                            "The optional GPL x264 runtime pack is not installed and explicitly approved.",
                        )
                    )
                    continue
                build_probe = runner.run(
                    (str(self.ffmpeg_path), "-hide_banner", "-buildconf"),
                    cwd=cwd,
                    environment=environment,
                    timeout_seconds=self.probe_timeout_seconds,
                    cancelled=cancelled,
                )
                build_text = f"{build_probe.stdout}\n{build_probe.stderr}".casefold()
                if (
                    build_probe.exit_code != 0
                    or "--enable-gpl" not in build_text
                    or "--enable-libx264" not in build_text
                ):
                    probes.append(
                        PresenterEncoderProbe(
                            encoder,
                            False,
                            "gpl-pack-capability-mismatch",
                            "The approved GPL runtime pack does not report both --enable-gpl and --enable-libx264.",
                        )
                    )
                    continue

            result = runner.run(
                _encoder_probe_argv(self.ffmpeg_path, encoder),
                cwd=cwd,
                environment=environment,
                timeout_seconds=self.probe_timeout_seconds,
                cancelled=cancelled,
            )
            diagnostic = _probe_diagnostic(encoder, result)
            probes.append(diagnostic)
            if diagnostic.available:
                approval = self.gpl_x264_approval
                return PresenterEncoderSelection(
                    encoder=encoder,
                    probes=tuple(probes),
                    gpl_runtime_pack_id=(
                        approval.runtime_pack_id
                        if encoder is PresenterVideoEncoder.LIBX264 and approval is not None
                        else None
                    ),
                    gpl_consent_id=(
                        approval.consent_id
                        if encoder is PresenterVideoEncoder.LIBX264 and approval is not None
                        else None
                    ),
                )

        reasons = "; ".join(
            f"{probe.encoder.value}: {probe.message}" for probe in probes
        )
        raise PresenterEncoderPolicyError(
            "No approved H.264 presenter encoder passed a real encode probe. "
            f"{reasons} Alystria did not silently substitute an unapproved software codec."
        )


def build_presenter_mux_argv(
    ffmpeg_path: Path,
    selection: PresenterEncoderSelection,
    *,
    silent_video: Path,
    narration_audio: Path,
    output: Path,
) -> tuple[str, ...]:
    """Build the only allowed MuseTalk delivery mux argv.

    Paths come from the supervisor's attempt directory.  Encoder names and
    switches come exclusively from the typed selection above.
    """

    return (
        str(ffmpeg_path),
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i",
        str(silent_video),
        "-i",
        str(narration_audio),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        *selection.codec_arguments,
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-movflags",
        "+faststart",
        str(output),
    )


def _encoder_probe_argv(
    ffmpeg_path: Path, encoder: PresenterVideoEncoder
) -> tuple[str, ...]:
    codec_arguments = PresenterEncoderSelection(encoder, ()).codec_arguments
    return (
        str(ffmpeg_path),
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:r=1:d=1",
        "-frames:v",
        "1",
        "-an",
        *codec_arguments,
        "-pix_fmt",
        "yuv420p",
        "-f",
        "null",
        "-",
    )


def _probe_diagnostic(
    encoder: PresenterVideoEncoder, result: EncoderProbeOutcome
) -> PresenterEncoderProbe:
    if result.exit_code == 0:
        return PresenterEncoderProbe(
            encoder,
            True,
            "available",
            f"{encoder.value} completed the one-frame H.264 encode probe.",
        )
    raw = f"{result.stderr}\n{result.stdout}".strip()
    folded = raw.casefold()
    if encoder is PresenterVideoEncoder.H264_NVENC and any(
        marker in folded
        for marker in (
            "driver does not support the required nvenc api",
            "minimum required nvidia driver",
            "unsupported device",
            "no nvenc capable devices",
            "cannot load nvcuda",
            "cannot load nvencodeapi",
        )
    ):
        return PresenterEncoderProbe(
            encoder,
            False,
            "nvenc-driver-api-incompatible",
            "NVIDIA NVENC is unavailable or its driver/API is incompatible. Update the NVIDIA "
            "driver, restart Windows, and rerun Alystria Diagnostics before selecting NVENC.",
        )
    if "unknown encoder" in folded or "encoder not found" in folded:
        return PresenterEncoderProbe(
            encoder,
            False,
            "encoder-not-built",
            f"The pinned FFmpeg runtime does not contain {encoder.value}.",
        )
    if encoder is PresenterVideoEncoder.H264_MEDIA_FOUNDATION and any(
        marker in folded
        for marker in ("hardware encoding is not available", "no capable devices", "device failed")
    ):
        return PresenterEncoderProbe(
            encoder,
            False,
            "media-foundation-hardware-unavailable",
            "Windows Media Foundation H.264 hardware encoding is unavailable; software Media "
            "Foundation fallback is forbidden by policy.",
        )
    return PresenterEncoderProbe(
        encoder,
        False,
        "encode-probe-failed",
        f"{encoder.value} failed the one-frame encode probe (FFmpeg exit {result.exit_code}).",
    )
