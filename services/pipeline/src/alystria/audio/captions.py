"""Caption segmentation and deterministic WebVTT/SRT serialization."""

from __future__ import annotations

import re
import textwrap
from dataclasses import dataclass, replace

from .models import CaptionCue, CaptionKind, WordTiming


@dataclass(frozen=True, slots=True)
class CaptionPolicy:
    max_chars_per_line: int = 42
    max_lines: int = 2
    min_duration_ms: int = 700
    max_duration_ms: int = 7_000
    max_chars_per_second: float = 20.0
    max_interword_gap_ms: int = 800
    include_speaker_labels: bool = True

    def __post_init__(self) -> None:
        if self.max_chars_per_line < 12 or self.max_lines not in {1, 2, 3}:
            raise ValueError("caption line limits are outside supported bounds")
        if self.min_duration_ms < 100 or self.max_duration_ms <= self.min_duration_ms:
            raise ValueError("invalid caption duration policy")
        if self.max_chars_per_second <= 0:
            raise ValueError("caption reading rate must be positive")
        if self.max_interword_gap_ms < 0:
            raise ValueError("caption interword gap cannot be negative")


@dataclass(frozen=True, slots=True)
class AccessibilityEvent:
    event_id: str
    start_ms: int
    end_ms: int
    description: str
    kind: CaptionKind = CaptionKind.SOUND

    def __post_init__(self) -> None:
        if self.start_ms < 0 or self.end_ms <= self.start_ms:
            raise ValueError("accessibility event must have a positive duration")
        if self.kind not in {CaptionKind.SOUND, CaptionKind.MUSIC, CaptionKind.DESCRIPTION}:
            raise ValueError("accessibility event must describe non-dialogue audio or visuals")
        if not self.description.strip():
            raise ValueError("accessibility event description is required")


def captions_from_words(
    words: tuple[WordTiming, ...] | list[WordTiming],
    *,
    policy: CaptionPolicy | None = None,
    speaker: str | None = None,
    cue_prefix: str = "cue",
) -> tuple[CaptionCue, ...]:
    """Group aligned words into readable cues without inventing timing."""

    if policy is None:
        policy = CaptionPolicy()
    if not words:
        return ()
    cues: list[CaptionCue] = []
    current: list[WordTiming] = []
    for word in words:
        candidate = [*current, word]
        candidate_text = _join_tokens(candidate)
        duration_ms = candidate[-1].end_ms - candidate[0].start_ms
        cps = len(candidate_text) / max(duration_ms / 1000, 0.001)
        should_split = bool(current) and (
            _line_count(candidate_text, policy.max_chars_per_line) > policy.max_lines
            or duration_ms > policy.max_duration_ms
            or (cps > policy.max_chars_per_second and len(current) >= 3)
            or word.start_ms - current[-1].end_ms > policy.max_interword_gap_ms
        )
        if should_split:
            cues.append(_cue_from_words(current, len(cues), policy, speaker, cue_prefix))
            current = [word]
        else:
            current = candidate

        if current and _is_sentence_end(current[-1].token):
            cues.append(_cue_from_words(current, len(cues), policy, speaker, cue_prefix))
            current = []

    if current:
        cues.append(_cue_from_words(current, len(cues), policy, speaker, cue_prefix))
    return _prevent_overlaps(cues)


def build_accessibility_captions(
    dialogue: tuple[CaptionCue, ...] | list[CaptionCue],
    events: tuple[AccessibilityEvent, ...] | list[AccessibilityEvent],
    *,
    include_speaker_labels: bool = True,
) -> tuple[CaptionCue, ...]:
    result: list[CaptionCue] = []
    for cue in dialogue:
        if include_speaker_labels and cue.speaker:
            result.append(replace(cue, text=f"{cue.speaker}: {cue.text}", kind=CaptionKind.SPEAKER))
        else:
            result.append(cue)
    for event in events:
        description = event.description.strip()
        if not (description.startswith("[") and description.endswith("]")):
            description = f"[{description}]"
        result.append(
            CaptionCue(
                cue_id=f"accessibility-{event.event_id}",
                start_ms=event.start_ms,
                end_ms=event.end_ms,
                text=description,
                kind=event.kind,
            )
        )
    return tuple(sorted(result, key=lambda cue: (cue.start_ms, cue.end_ms, cue.cue_id)))


def to_webvtt(cues: tuple[CaptionCue, ...] | list[CaptionCue]) -> str:
    blocks = ["WEBVTT", ""]
    for cue in sorted(cues, key=lambda item: (item.start_ms, item.end_ms, item.cue_id)):
        settings: list[str] = []
        if cue.line is not None:
            settings.append(f"line:{cue.line}")
        if cue.position_percent is not None:
            settings.append(f"position:{cue.position_percent}%")
        if cue.align:
            settings.append(f"align:{cue.align}")
        suffix = f" {' '.join(settings)}" if settings else ""
        text = _safe_caption_text(cue.text)
        if cue.speaker and cue.kind is CaptionKind.DIALOGUE:
            text = f"<v {cue.speaker}>{text}"
        blocks.extend(
            [
                cue.cue_id,
                f"{_format_vtt_time(cue.start_ms)} --> {_format_vtt_time(cue.end_ms)}{suffix}",
                text,
                "",
            ]
        )
    return "\n".join(blocks)


def to_srt(cues: tuple[CaptionCue, ...] | list[CaptionCue]) -> str:
    blocks: list[str] = []
    for index, cue in enumerate(
        sorted(cues, key=lambda item: (item.start_ms, item.end_ms, item.cue_id)), start=1
    ):
        text = _safe_caption_text(cue.text)
        if cue.speaker and cue.kind is CaptionKind.DIALOGUE:
            text = f"{cue.speaker}: {text}"
        blocks.extend(
            [
                str(index),
                f"{_format_srt_time(cue.start_ms)} --> {_format_srt_time(cue.end_ms)}",
                text,
                "",
            ]
        )
    return "\n".join(blocks)


def _cue_from_words(
    words: list[WordTiming],
    index: int,
    policy: CaptionPolicy,
    speaker: str | None,
    cue_prefix: str,
) -> CaptionCue:
    text = _wrap_caption(_join_tokens(words), policy.max_chars_per_line, policy.max_lines)
    start = words[0].start_ms
    end = max(words[-1].end_ms, start + policy.min_duration_ms)
    return CaptionCue(
        cue_id=f"{cue_prefix}-{index + 1:04d}",
        start_ms=start,
        end_ms=end,
        text=text,
        speaker=speaker,
    )


def _join_tokens(words: list[WordTiming]) -> str:
    result = ""
    for word in words:
        token = word.token.strip()
        if not token:
            continue
        if not result or re.fullmatch(r"[.,!?;:%)\]}]", token) or token in {"'s", "n't", "'re", "'ve", "'ll", "'d"}:
            result += token
        else:
            result += f" {token}"
    return result


def _wrap_caption(text: str, width: int, max_lines: int) -> str:
    if len(text) <= width:
        return text
    lines = textwrap.wrap(text, width=width, break_long_words=False, break_on_hyphens=False)
    if len(lines) <= max_lines:
        return "\n".join(lines)
    # Segmentation normally prevents this. Preserve every word if an
    # unbreakable token or unusual punctuation still makes wrapping overflow.
    return "\n".join([*lines[: max_lines - 1], " ".join(lines[max_lines - 1 :])])


def _line_count(text: str, width: int) -> int:
    return max(
        1,
        len(textwrap.wrap(text, width=width, break_long_words=False, break_on_hyphens=False)),
    )


def _prevent_overlaps(cues: list[CaptionCue]) -> tuple[CaptionCue, ...]:
    result: list[CaptionCue] = []
    for index, cue in enumerate(cues):
        if index + 1 < len(cues):
            next_start = cues[index + 1].start_ms
            if cue.end_ms > next_start > cue.start_ms:
                cue = replace(cue, end_ms=next_start)
        result.append(cue)
    return tuple(result)


def _is_sentence_end(token: str) -> bool:
    return bool(re.search(r"[.!?][\"')\]]?$", token.strip()))


def _safe_caption_text(text: str) -> str:
    return text.replace("-->", "→").replace("\r\n", "\n").replace("\r", "\n")


def _format_vtt_time(milliseconds: int) -> str:
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{millis:03d}"


def _format_srt_time(milliseconds: int) -> str:
    return _format_vtt_time(milliseconds).replace(".", ",")
