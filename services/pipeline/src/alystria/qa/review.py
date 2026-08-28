"""Deterministic final multimodal-review sampling plans."""

from __future__ import annotations

from dataclasses import dataclass

TIMEBASE = 240_000


@dataclass(frozen=True, slots=True)
class ReviewScene:
    scene_id: str
    start_tick: int
    end_tick: int


@dataclass(frozen=True, slots=True)
class ReviewHotspot:
    scene_id: str
    tick: int
    reason: str


@dataclass(frozen=True, slots=True)
class FrameSample:
    scene_id: str
    tick: int
    reason: str


@dataclass(frozen=True, slots=True)
class AudioSample:
    start_tick: int
    end_tick: int
    reason: str


@dataclass(frozen=True, slots=True)
class MultimodalReviewPlan:
    frame_samples: tuple[FrameSample, ...]
    audio_samples: tuple[AudioSample, ...]
    inspect_entire_audio: bool
    seed: int


def build_review_plan(
    scenes: tuple[ReviewScene, ...],
    *,
    hotspots: tuple[ReviewHotspot, ...] = (),
    max_frame_samples: int = 120,
    audio_window_seconds: float = 8.0,
    seed: int = 0,
) -> MultimodalReviewPlan:
    if max_frame_samples < 1:
        raise ValueError("max_frame_samples must be positive")
    if audio_window_seconds <= 0:
        raise ValueError("audio_window_seconds must be positive")
    candidates: dict[tuple[str, int], FrameSample] = {}
    scene_by_id = {scene.scene_id: scene for scene in scenes}
    for hotspot in hotspots:
        scene = scene_by_id.get(hotspot.scene_id)
        if scene and scene.start_tick <= hotspot.tick <= scene.end_tick:
            candidates[(hotspot.scene_id, hotspot.tick)] = FrameSample(
                hotspot.scene_id, hotspot.tick, f"finding:{hotspot.reason}"
            )
    for scene in scenes:
        if scene.end_tick <= scene.start_tick:
            raise ValueError(f"Scene {scene.scene_id} has an invalid tick range")
        duration = scene.end_tick - scene.start_tick
        for tick, reason in (
            (scene.start_tick, "scene_start"),
            (scene.start_tick + duration // 2, "scene_midpoint"),
            (scene.end_tick - 1, "scene_end"),
        ):
            candidates.setdefault((scene.scene_id, tick), FrameSample(scene.scene_id, tick, reason))
    ordered = sorted(
        candidates.values(),
        key=lambda item: (
            0 if item.reason.startswith("finding:") else 1,
            item.tick,
            item.scene_id,
            item.reason,
        ),
    )
    selected = _spread(ordered, max_frame_samples)
    total_end = max((scene.end_tick for scene in scenes), default=0)
    window = round(audio_window_seconds * TIMEBASE)
    audio_centers = sorted(
        {sample.tick for sample in selected if sample.reason.startswith("finding:")}
    )
    audio_samples = tuple(
        AudioSample(
            max(0, center - window // 2), min(total_end, center + window // 2), "finding_context"
        )
        for center in audio_centers
    )
    # Audio metrics are cheap and temporal defects can occur between sampled frames;
    # the final review always checks the full mixed master.
    return MultimodalReviewPlan(tuple(selected), audio_samples, True, seed)


def _spread(items: list[FrameSample], limit: int) -> list[FrameSample]:
    if len(items) <= limit:
        return sorted(items, key=lambda item: (item.tick, item.scene_id))
    priorities = [item for item in items if item.reason.startswith("finding:")]
    regular = [item for item in items if not item.reason.startswith("finding:")]
    if len(priorities) >= limit:
        return sorted(priorities[:limit], key=lambda item: (item.tick, item.scene_id))
    remaining = limit - len(priorities)
    if remaining == 1:
        chosen = regular[len(regular) // 2 : len(regular) // 2 + 1]
    else:
        indexes = {
            round(index * (len(regular) - 1) / (remaining - 1)) for index in range(remaining)
        }
        chosen = [regular[index] for index in sorted(indexes)]
    return sorted(priorities + chosen, key=lambda item: (item.tick, item.scene_id))
