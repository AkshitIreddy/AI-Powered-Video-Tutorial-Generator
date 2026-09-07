"""Compile one shared caption timeline for scene pixels and delivery sidecars."""

from __future__ import annotations

from dataclasses import asdict, replace
from typing import Any

from alystria.audio import CaptionCue, WordTiming, captions_from_words, to_srt, to_webvtt
from alystria.course import TICKS_PER_SECOND
from alystria.project import ProjectStore

CAPTION_COMPILER_VERSION = "caption-compiler-v2"


def build_caption_bundle(
    store: ProjectStore,
    narration_payload: dict[str, Any],
    *,
    captions_enabled: bool,
    locale: str,
) -> dict[str, Any]:
    """Reflow original aligned words once, independently within each scene.

    Offsetting the resulting cues preserves identical text and boundaries in
    the renderer, editor, WebVTT, and SRT. Treating whole cues as pseudo-words
    for a second reflow loses word boundaries and creates flashing fragments.
    """
    scenes = narration_payload["storyboard"]["scenes"]
    narration = narration_payload["narration"]
    scene_ids = [str(scene["id"]) for scene in scenes]
    narration_by_scene = {str(item["sceneId"]): item for item in narration}
    if (
        len(set(scene_ids)) != len(scene_ids)
        or len(narration_by_scene) != len(narration)
        or set(scene_ids) != set(narration_by_scene)
    ):
        raise ValueError("Caption narration must match each measured scene exactly once")

    by_scene: dict[str, list[dict[str, Any]]] = {}
    all_cues: list[CaptionCue] = []
    offset_ticks = 0
    for scene in scenes:
        scene_id = str(scene["id"])
        duration_ticks = scene["durationTicks"]
        if isinstance(duration_ticks, bool) or not isinstance(duration_ticks, int) or duration_ticks <= 0:
            raise ValueError("Caption scene duration must be positive measured ticks")
        offset_ms = round(offset_ticks * 1_000 / TICKS_PER_SECOND)
        # Quantize shared boundaries, not independent durations, so a fractional
        # millisecond cannot create overlap between consecutive scenes.
        end_ms = round((offset_ticks + duration_ticks) * 1_000 / TICKS_PER_SECOND)
        scene_duration_ms = end_ms - offset_ms
        words = tuple(WordTiming(**word) for word in narration_by_scene[scene_id]["words"])
        if any(word.start_ms >= scene_duration_ms or word.end_ms > scene_duration_ms + 1 for word in words):
            raise ValueError("Aligned caption words extend beyond their measured scene")
        cues = tuple(
            replace(cue, end_ms=min(cue.end_ms, scene_duration_ms))
            for cue in captions_from_words(words, cue_prefix=scene_id)
        )
        by_scene[scene_id] = [asdict(cue) for cue in cues]
        all_cues.extend(
            replace(cue, start_ms=cue.start_ms + offset_ms, end_ms=cue.end_ms + offset_ms)
            for cue in cues
        )
        offset_ticks += duration_ticks

    metadata = {"locale": locale, "rightsStatus": "owned", "compilerVersion": CAPTION_COMPILER_VERSION}
    vtt = to_webvtt(all_cues) if captions_enabled else "WEBVTT\n"
    srt = to_srt(all_cues) if captions_enabled else ""
    vtt_artifact = store.add_artifact_bytes(
        vtt.encode(), media_type="text/vtt", original_name="captions.vtt", metadata=metadata,
    )
    srt_artifact = store.add_artifact_bytes(
        srt.encode(), media_type="application/x-subrip", original_name="captions.srt", metadata=metadata,
    )
    transcript_artifact = store.add_artifact_bytes(
        "\n\n".join(str(scene["narration"]) for scene in scenes).encode(),
        media_type="text/plain", original_name="transcript.txt", metadata=metadata,
    )
    return {
        "compilerVersion": CAPTION_COMPILER_VERSION,
        "captionsEnabled": captions_enabled,
        "byScene": by_scene,
        "vttArtifactHash": vtt_artifact.hash,
        "srtArtifactHash": srt_artifact.hash,
        "transcriptArtifactHash": transcript_artifact.hash,
        "cueCount": len(all_cues),
    }
