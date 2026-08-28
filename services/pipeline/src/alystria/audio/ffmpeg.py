"""Side-effect-free FFmpeg plans for mixing, ducking, and two-pass loudness.

Paths are always individual argv entries; callers must execute these plans
without a shell.  The first pass measures the *mixed* programme, and the second
pass is created only after parsing its JSON loudnorm output.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .models import WORKING_SAMPLE_RATE_HZ


@dataclass(frozen=True, slots=True)
class MasteringPolicy:
    integrated_lufs: float = -16.0
    loudness_range_lu: float = 11.0
    true_peak_dbtp: float = -1.5
    dual_mono: bool = False
    duck_threshold: float = 0.03
    duck_ratio: float = 8.0
    duck_attack_ms: int = 20
    duck_release_ms: int = 400

    def __post_init__(self) -> None:
        if not -30 <= self.integrated_lufs <= -5:
            raise ValueError("integrated loudness target is outside safe mastering bounds")
        if not 1 <= self.loudness_range_lu <= 20:
            raise ValueError("loudness range target must be between 1 and 20 LU")
        if not -9 <= self.true_peak_dbtp <= 0:
            raise ValueError("true-peak target must be between -9 and 0 dBTP")
        if not 0 < self.duck_threshold <= 1 or not 1 <= self.duck_ratio <= 20:
            raise ValueError("invalid ducking threshold or ratio")
        if self.duck_attack_ms < 1 or self.duck_release_ms < 1:
            raise ValueError("ducking attack and release must be positive")


@dataclass(frozen=True, slots=True)
class LoudnormMeasurement:
    input_i: float
    input_lra: float
    input_tp: float
    input_thresh: float
    target_offset: float

    def __post_init__(self) -> None:
        if not all(math.isfinite(value) for value in (
            self.input_i,
            self.input_lra,
            self.input_tp,
            self.input_thresh,
            self.target_offset,
        )):
            raise ValueError("loudnorm measurements must be finite")


@dataclass(frozen=True, slots=True)
class FFmpegCommand:
    argv: tuple[str, ...]
    purpose: str
    reads_loudnorm_json_from_stderr: bool = False

    def __post_init__(self) -> None:
        if not self.argv or any("\x00" in part for part in self.argv):
            raise ValueError("invalid FFmpeg argv")


@dataclass(frozen=True, slots=True)
class TwoPassMasteringPlan:
    ffmpeg_binary: str
    narration_path: str
    output_path: str
    music_path: str | None = None
    sound_effect_paths: tuple[str, ...] = ()
    music_gain_db: float = -18.0
    effect_gain_db: float = -9.0
    policy: MasteringPolicy = field(default_factory=MasteringPolicy)

    def __post_init__(self) -> None:
        paths = (
            self.ffmpeg_binary,
            self.narration_path,
            self.output_path,
            *((self.music_path,) if self.music_path is not None else ()),
            *self.sound_effect_paths,
        )
        for value in paths:
            if not value or "\x00" in value:
                raise ValueError("FFmpeg plan paths must be non-empty and contain no NUL")
        if not -60 <= self.music_gain_db <= 12 or not -60 <= self.effect_gain_db <= 12:
            raise ValueError("mix gains must be between -60 dB and +12 dB")

    def analysis_command(self) -> FFmpegCommand:
        inputs, graph = self._inputs_and_mix_graph()
        graph += f";[programme]{_loudnorm_filter(self.policy, None)}[analysis]"
        argv = (
            self.ffmpeg_binary,
            "-hide_banner",
            "-nostdin",
            *inputs,
            "-filter_complex",
            graph,
            "-map",
            "[analysis]",
            "-f",
            "null",
            "-",
        )
        return FFmpegCommand(argv, "measure mixed programme loudness", True)

    def final_command(self, measurement: LoudnormMeasurement) -> FFmpegCommand:
        inputs, graph = self._inputs_and_mix_graph()
        graph += f";[programme]{_loudnorm_filter(self.policy, measurement)}[mastered]"
        argv = (
            self.ffmpeg_binary,
            "-hide_banner",
            "-nostdin",
            "-y",
            *inputs,
            "-filter_complex",
            graph,
            "-map",
            "[mastered]",
            "-ar",
            str(WORKING_SAMPLE_RATE_HZ),
            "-c:a",
            "pcm_s24le",
            self.output_path,
        )
        return FFmpegCommand(argv, "render ducked and two-pass-normalized 48 kHz master")

    def _inputs_and_mix_graph(self) -> tuple[tuple[str, ...], str]:
        inputs: list[str] = ["-i", self.narration_path]
        narration_chain = f"[0:a]aresample={WORKING_SAMPLE_RATE_HZ},asetpts=PTS-STARTPTS"
        chains = [f"{narration_chain}[narration]"]
        mix_labels = ["[narration]"]
        next_index = 1
        if self.music_path:
            # A filter output can only be consumed once. Preserve the clean
            # narration for the final mix and use a split copy as the ducking
            # sidechain key.
            chains[0] = f"{narration_chain},asplit=2[narration][narration-key]"
            inputs.extend(("-stream_loop", "-1", "-i", self.music_path))
            chains.append(
                f"[{next_index}:a]aresample={WORKING_SAMPLE_RATE_HZ},"
                f"volume={self.music_gain_db:.3f}dB[music-bed]"
            )
            chains.append(
                f"[music-bed][narration-key]sidechaincompress="
                f"threshold={self.policy.duck_threshold:.6f}:"
                f"ratio={self.policy.duck_ratio:.3f}:"
                f"attack={self.policy.duck_attack_ms}:release={self.policy.duck_release_ms}"
                "[music-ducked]"
            )
            mix_labels.append("[music-ducked]")
            next_index += 1
        for effect_number, effect_path in enumerate(self.sound_effect_paths):
            inputs.extend(("-i", effect_path))
            label = f"sfx-{effect_number}"
            chains.append(
                f"[{next_index}:a]aresample={WORKING_SAMPLE_RATE_HZ},"
                f"volume={self.effect_gain_db:.3f}dB[{label}]"
            )
            mix_labels.append(f"[{label}]")
            next_index += 1
        if len(mix_labels) == 1:
            chains.append("[narration]anull[programme]")
        else:
            chains.append(
                f"{''.join(mix_labels)}amix=inputs={len(mix_labels)}:"
                "duration=first:dropout_transition=0:normalize=0[programme]"
            )
        return tuple(inputs), ";".join(chains)


def _loudnorm_filter(policy: MasteringPolicy, measurement: LoudnormMeasurement | None) -> str:
    values = (
        f"loudnorm=I={policy.integrated_lufs:.1f}:"
        f"LRA={policy.loudness_range_lu:.1f}:TP={policy.true_peak_dbtp:.1f}:"
        f"dual_mono={'true' if policy.dual_mono else 'false'}"
    )
    if measurement is None:
        return values + ":print_format=json"
    return (
        values
        + f":measured_I={measurement.input_i:.6f}"
        + f":measured_LRA={measurement.input_lra:.6f}"
        + f":measured_TP={measurement.input_tp:.6f}"
        + f":measured_thresh={measurement.input_thresh:.6f}"
        + f":offset={measurement.target_offset:.6f}:linear=true:print_format=summary"
    )
