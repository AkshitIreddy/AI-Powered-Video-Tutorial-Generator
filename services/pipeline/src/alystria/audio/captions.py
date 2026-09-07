"""Caption segmentation and deterministic WebVTT/SRT serialization."""

from __future__ import annotations

import re
import textwrap
from dataclasses import dataclass, replace
from math import ceil

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
    groups: list[list[WordTiming]] = []
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
            groups.append(current)
            current = [word]
        else:
            current = candidate

        if current and _is_sentence_end(current[-1].token):
            groups.append(current)
            current = []

    if current:
        groups.append(current)
    groups = _rebalance_caption_groups(groups, policy)
    cues = [
        _cue_from_words(group, index, policy, speaker, cue_prefix)
        for index, group in enumerate(groups)
    ]
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
    reading_duration_ms = ceil(len(text.replace("\n", " ")) * 1_000 / policy.max_chars_per_second)
    added_hold_end = min(
        max(start + policy.min_duration_ms, start + reading_duration_ms),
        start + policy.max_duration_ms,
    )
    end = max(words[-1].end_ms, added_hold_end)
    return CaptionCue(
        cue_id=f"{cue_prefix}-{index + 1:04d}",
        start_ms=start,
        end_ms=end,
        text=text,
        speaker=speaker,
    )


def _rebalance_caption_groups(
    groups: list[list[WordTiming]],
    policy: CaptionPolicy,
) -> list[list[WordTiming]]:
    """Repartition adjacent word groups before cue timings become immutable.

    Greedy line and sentence breaks can strand a very short fragment immediately
    before the next spoken word. Once a ``CaptionCue`` exists, overlap prevention
    can only truncate its minimum hold. Rebalancing the original word timings lets
    us move that break while retaining every token and observed speech boundary.
    Long interword gaps remain hard boundaries, which also keeps callers' separate
    scene runs isolated.
    """

    words = [word for group in groups for word in group]
    if not words:
        return []
    result: list[list[WordTiming]] = []
    run_start = 0
    for index in range(1, len(words)):
        if words[index].start_ms - words[index - 1].end_ms > policy.max_interword_gap_ms:
            result.extend(_optimal_caption_groups(words[run_start:index], policy))
            run_start = index
    result.extend(_optimal_caption_groups(words[run_start:], policy))
    return result


def _optimal_caption_groups(
    words: list[WordTiming],
    policy: CaptionPolicy,
) -> list[list[WordTiming]]:
    """Choose readable adjacent groups with deterministic lexicographic costs."""

    if not words:
        return []
    # Cost order: unavoidable policy violations, their magnitude, semantic
    # break quality, cue count, then distance from a comfortable 2.6 second cue.
    Cost = tuple[int, int, int, int, int]
    Solution = tuple[Cost, list[list[WordTiming]]]
    solutions: list[Solution | None] = [None] * (len(words) + 1)
    solutions[-1] = ((0, 0, 0, 0, 0), [])

    for start_index in range(len(words) - 1, -1, -1):
        best: Solution | None = None
        for end_index in range(start_index, len(words)):
            if (
                end_index > start_index
                and words[end_index].start_ms - words[end_index - 1].end_ms
                > policy.max_interword_gap_ms
            ):
                break
            group = words[start_index : end_index + 1]
            text = _join_tokens(group)
            observed_duration_ms = group[-1].end_ms - group[0].start_ms
            wrapped = textwrap.wrap(
                text,
                width=policy.max_chars_per_line,
                break_long_words=False,
                break_on_hyphens=False,
            ) or [text]
            fits_lines = len(wrapped) <= policy.max_lines and all(
                len(line) <= policy.max_chars_per_line for line in wrapped
            )
            if end_index > start_index and (
                observed_duration_ms > policy.max_duration_ms or not fits_lines
            ):
                break

            next_start_ms = words[end_index + 1].start_ms if end_index + 1 < len(words) else None
            duration_ms = _projected_caption_duration_ms(
                group,
                text,
                policy,
                next_start_ms=next_start_ms,
            )
            required_reading_ms = ceil(len(text) * 1_000 / policy.max_chars_per_second)
            minimum_shortfall = max(0, policy.min_duration_ms - duration_ms)
            reading_shortfall = max(0, required_reading_ms - duration_ms)
            line_overflow = (
                sum(max(0, len(line) - policy.max_chars_per_line) for line in wrapped)
                + max(0, len(wrapped) - policy.max_lines) * policy.max_chars_per_line
            )
            duration_overflow = max(0, observed_duration_ms - policy.max_duration_ms)
            violation_count = sum(
                value > 0
                for value in (
                    minimum_shortfall,
                    reading_shortfall,
                    line_overflow,
                    duration_overflow,
                )
            )
            violation_magnitude = (
                minimum_shortfall + reading_shortfall + line_overflow * 1_000 + duration_overflow
            )
            boundary_penalty = _caption_boundary_penalty(group[-1].token)
            duration_balance = abs(duration_ms - 2_600)
            following = solutions[end_index + 1]
            assert following is not None
            tail_cost, tail_groups = following
            cost: Cost = (
                violation_count + tail_cost[0],
                violation_magnitude + tail_cost[1],
                boundary_penalty + tail_cost[2],
                1 + tail_cost[3],
                duration_balance + tail_cost[4],
            )
            candidate: Solution = (cost, [group, *tail_groups])
            if best is None or cost < best[0]:
                best = candidate
        assert best is not None
        solutions[start_index] = best

    resolved = solutions[0]
    assert resolved is not None
    return resolved[1]


def _projected_caption_duration_ms(
    words: list[WordTiming],
    text: str,
    policy: CaptionPolicy,
    *,
    next_start_ms: int | None,
) -> int:
    start_ms = words[0].start_ms
    reading_duration_ms = ceil(len(text) * 1_000 / policy.max_chars_per_second)
    added_hold_end_ms = min(
        max(start_ms + policy.min_duration_ms, start_ms + reading_duration_ms),
        start_ms + policy.max_duration_ms,
    )
    end_ms = max(words[-1].end_ms, added_hold_end_ms)
    if next_start_ms is not None:
        end_ms = min(end_ms, next_start_ms)
    return max(0, end_ms - start_ms)


def _caption_boundary_penalty(token: str) -> int:
    stripped = token.strip()
    if _is_sentence_end(stripped):
        return 0
    if re.search(r"[,;:]$", stripped):
        return 1
    return 3


def _join_tokens(words: list[WordTiming]) -> str:
    result = ""
    for word in words:
        token = word.token.strip()
        if not token:
            continue
        if (
            not result
            or re.fullmatch(r"[.,!?;:%)\]}]", token)
            or token in {"'s", "n't", "'re", "'ve", "'ll", "'d"}
        ):
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
