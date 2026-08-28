"""Audio-description authoring and export contracts."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .captions import to_webvtt
from .models import CaptionCue, CaptionKind


class DescriptionPlacement(StrEnum):
    NATURAL_GAP = "natural_gap"
    PAUSE_NARRATION = "pause_narration"
    EXTEND_SCENE = "extend_scene"
    SEPARATE_TRACK_ONLY = "separate_track_only"


@dataclass(frozen=True, slots=True)
class AudioDescriptionCue:
    cue_id: str
    start_ms: int
    end_ms: int
    text: str
    placement: DescriptionPlacement
    voice_id: str | None = None
    scene_id: str | None = None

    def __post_init__(self) -> None:
        if self.start_ms < 0 or self.end_ms <= self.start_ms:
            raise ValueError("audio-description cue must have a positive duration")
        if not self.text.strip():
            raise ValueError("audio-description text is required")


@dataclass(frozen=True, slots=True)
class AudioDescriptionExportPlan:
    locale: str
    cues: tuple[AudioDescriptionCue, ...]
    speech_artifact_hashes: tuple[str, ...]
    mixed_audio_output: str
    webvtt_output: str
    transcript_output: str
    include_in_container: bool = True

    def __post_init__(self) -> None:
        if not all(
            (
                self.locale,
                self.mixed_audio_output,
                self.webvtt_output,
                self.transcript_output,
            )
        ):
            raise ValueError("audio-description locale and sidecar outputs are required")
        if len(self.cues) != len(self.speech_artifact_hashes):
            raise ValueError("every description cue requires one synthesized speech artifact")
        if any(not artifact_hash for artifact_hash in self.speech_artifact_hashes):
            raise ValueError("audio-description speech artifact hashes cannot be empty")
        previous_end = -1
        for cue in self.cues:
            if cue.start_ms < previous_end:
                raise ValueError("audio-description cues cannot overlap")
            previous_end = cue.end_ms

    def webvtt(self) -> str:
        return to_webvtt(
            tuple(
                CaptionCue(
                    cue_id=cue.cue_id,
                    start_ms=cue.start_ms,
                    end_ms=cue.end_ms,
                    text=cue.text,
                    kind=CaptionKind.DESCRIPTION,
                )
                for cue in self.cues
            )
        )

    def transcript(self) -> str:
        return "\n\n".join(
            f"[{_clock(cue.start_ms)}] {cue.text.strip()}" for cue in self.cues
        ) + ("\n" if self.cues else "")


def _clock(milliseconds: int) -> str:
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{millis:03d}"
