from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from alystria.generation import (
    EncoderProbeResult,
    GplX264Approval,
    PresenterEncoderPolicy,
    PresenterEncoderPolicyError,
    PresenterEncoderProbe,
    PresenterEncoderSelection,
    PresenterVideoEncoder,
    build_presenter_mux_argv,
)


@dataclass
class ProbeRunner:
    nvenc: EncoderProbeResult
    media_foundation: EncoderProbeResult
    quick_sync: EncoderProbeResult = field(
        default_factory=lambda: EncoderProbeResult(1, "", "Unknown encoder 'h264_qsv'")
    )
    x264: EncoderProbeResult = field(default_factory=lambda: EncoderProbeResult(1, "", "no"))
    buildconf: EncoderProbeResult = field(
        default_factory=lambda: EncoderProbeResult(
            0, "configuration: --enable-gpl --enable-libx264", ""
        )
    )

    def __post_init__(self) -> None:
        self.calls: list[tuple[str, ...]] = []

    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        environment: Mapping[str, str],
        timeout_seconds: float,
        cancelled: Callable[[], bool],
    ) -> EncoderProbeResult:
        del cwd, environment
        assert timeout_seconds == 12
        assert not cancelled()
        call = tuple(argv)
        self.calls.append(call)
        if "-buildconf" in call:
            return self.buildconf
        encoder = call[call.index("-c:v") + 1]
        return {
            "h264_nvenc": self.nvenc,
            "h264_qsv": self.quick_sync,
            "h264_mf": self.media_foundation,
            "libx264": self.x264,
        }[encoder]


def _policy(
    tmp_path: Path, approval: GplX264Approval | None = None
) -> PresenterEncoderPolicy:
    return PresenterEncoderPolicy(
        tmp_path / "ffmpeg.exe",
        "1" * 64,
        probe_timeout_seconds=12,
        gpl_x264_approval=approval,
    )


def _select(policy: PresenterEncoderPolicy, runner: ProbeRunner) -> PresenterEncoderSelection:
    return policy.select(
        runner,
        cwd=Path("runtime"),
        environment={"SYSTEMROOT": "C:/Windows"},
        cancelled=lambda: False,
    )


def test_nvenc_is_first_and_requires_a_real_encode_probe(tmp_path: Path) -> None:
    runner = ProbeRunner(EncoderProbeResult(0), EncoderProbeResult(0))
    selected = _select(_policy(tmp_path), runner)

    assert selected.encoder is PresenterVideoEncoder.H264_NVENC
    assert selected.fallback_occurred is False
    assert len(runner.calls) == 1
    assert "color=c=black:s=64x64:r=1:d=1" in runner.calls[0]
    assert runner.calls[0][runner.calls[0].index("-c:v") + 1] == "h264_nvenc"


def test_nvenc_driver_api_failure_is_actionable_and_mf_is_hardware_forced(
    tmp_path: Path,
) -> None:
    runner = ProbeRunner(
        EncoderProbeResult(
            1,
            "",
            "Driver does not support the required nvenc API version. "
            "The minimum required Nvidia driver is newer.",
        ),
        EncoderProbeResult(0),
    )
    selected = _select(_policy(tmp_path), runner)

    assert selected.encoder is PresenterVideoEncoder.H264_MEDIA_FOUNDATION
    assert selected.fallback_occurred is True
    assert selected.probes[0].diagnostic_code == "nvenc-driver-api-incompatible"
    assert "Update the NVIDIA driver" in selected.probes[0].message
    mf_call = runner.calls[2]
    assert mf_call[mf_call.index("-c:v") + 1] == "h264_mf"
    assert mf_call[mf_call.index("-hw_encoding") + 1] == "1"
    assert selected.as_manifest()["fallbackOccurred"] is True


def test_quick_sync_is_used_when_nvenc_is_driver_blocked(tmp_path: Path) -> None:
    runner = ProbeRunner(
        EncoderProbeResult(1, "", "Driver does not support the required nvenc API version"),
        EncoderProbeResult(0),
        quick_sync=EncoderProbeResult(0),
    )

    selected = _select(_policy(tmp_path), runner)

    assert selected.encoder is PresenterVideoEncoder.H264_QUICK_SYNC
    assert selected.codec_arguments == ("-c:v", "h264_qsv")
    assert runner.calls[1][runner.calls[1].index("-c:v") + 1] == "h264_qsv"


def test_no_hardware_and_no_gpl_consent_fails_without_software_substitution(
    tmp_path: Path,
) -> None:
    runner = ProbeRunner(
        EncoderProbeResult(1, "", "Unknown encoder 'h264_nvenc'"),
        EncoderProbeResult(1, "", "Hardware encoding is not available"),
    )

    with pytest.raises(PresenterEncoderPolicyError, match="did not silently substitute") as error:
        _select(_policy(tmp_path), runner)

    assert "gpl-consent-required" not in str(error.value)
    assert len(runner.calls) == 3
    assert all("libx264" not in call for call in runner.calls)


def test_gpl_x264_requires_pinned_pack_build_flags_and_durable_consent(
    tmp_path: Path,
) -> None:
    approval = GplX264Approval(
        "ffmpeg-gpl-x264/9.0.1-signed",
        "approval:project-7:revision-12",
    )
    runner = ProbeRunner(
        EncoderProbeResult(1, "", "Unknown encoder"),
        EncoderProbeResult(1, "", "Unknown encoder"),
        x264=EncoderProbeResult(0),
    )
    selected = _select(_policy(tmp_path, approval), runner)

    assert selected.encoder is PresenterVideoEncoder.LIBX264
    assert selected.gpl_runtime_pack_id == approval.runtime_pack_id
    assert selected.gpl_consent_id == approval.consent_id
    assert "-buildconf" in runner.calls[3]
    assert runner.calls[4][runner.calls[4].index("-c:v") + 1] == "libx264"
    assert selected.as_manifest()["gplConsentId"] == approval.consent_id


def test_claimed_gpl_pack_without_x264_build_flags_is_rejected(tmp_path: Path) -> None:
    approval = GplX264Approval(
        "ffmpeg-gpl-x264/9.0.1-signed",
        "approval:project-7:revision-12",
    )
    runner = ProbeRunner(
        EncoderProbeResult(1),
        EncoderProbeResult(1),
        buildconf=EncoderProbeResult(0, "configuration: --disable-gpl", ""),
    )

    with pytest.raises(PresenterEncoderPolicyError, match="does not report both"):
        _select(_policy(tmp_path, approval), runner)

    assert len(runner.calls) == 4


def test_mux_argv_uses_only_brokered_codec_arguments(tmp_path: Path) -> None:
    selected = PresenterEncoderSelection(
        PresenterVideoEncoder.H264_MEDIA_FOUNDATION,
        (
            PresenterEncoderProbe(
                PresenterVideoEncoder.H264_MEDIA_FOUNDATION,
                True,
                "available",
                "probe passed",
            ),
        ),
    )
    argv = build_presenter_mux_argv(
        tmp_path / "ffmpeg.exe",
        selected,
        silent_video=tmp_path / "silent.avi",
        narration_audio=tmp_path / "narration.wav",
        output=tmp_path / "presenter.mp4",
    )

    assert argv[0] == str(tmp_path / "ffmpeg.exe")
    assert argv[argv.index("-c:v") + 1] == "h264_mf"
    assert argv[argv.index("-hw_encoding") + 1] == "1"
    assert "libx264" not in argv
    assert argv[-1] == str(tmp_path / "presenter.mp4")


def test_gpl_approval_contract_rejects_generic_or_unaccepted_pack_ids() -> None:
    with pytest.raises(ValueError, match="installed ffmpeg-gpl-x264"):
        GplX264Approval("ffmpeg/default", "approval:one")
    with pytest.raises(ValueError, match="durable explicit consent"):
        GplX264Approval("ffmpeg-gpl-x264/9.0.1", "x")
