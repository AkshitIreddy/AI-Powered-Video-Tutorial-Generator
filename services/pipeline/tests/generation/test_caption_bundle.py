from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

import pytest

from alystria.generation.caption_bundle import CAPTION_COMPILER_VERSION, build_caption_bundle
from alystria.project import ProjectStore


def narration_payload() -> dict[str, Any]:
    texts = ["first scene words", "second scene words"]
    return {
        "storyboard": {"scenes": [
            {"id": f"scene_{index}", "durationTicks": 360_000, "narration": text}
            for index, text in enumerate(texts)
        ]},
        "narration": [
            {"sceneId": f"scene_{index}", "words": [
                {"token": word, "start_ms": start, "end_ms": end}
                for word, start, end in zip(text.split(), [0, 400, 700], [350, 650, 1000], strict=True)
            ]}
            for index, text in enumerate(texts)
        ],
    }


def test_scene_cues_and_sidecars_share_one_reflow_without_cross_scene_merges(tmp_path: Path) -> None:
    source = narration_payload()
    original = copy.deepcopy(source)
    with ProjectStore.create(tmp_path / "project", name="Caption test") as store:
        bundle = build_caption_bundle(store, source, captions_enabled=True, locale="en-US")
        vtt = store.cas.object_path(bundle["vttArtifactHash"]).read_text()
        srt = store.cas.object_path(bundle["srtArtifactHash"]).read_text()
        transcript = store.cas.object_path(bundle["transcriptArtifactHash"]).read_text()

    assert source == original
    assert bundle["compilerVersion"] == CAPTION_COMPILER_VERSION
    assert bundle["cueCount"] == sum(len(cues) for cues in bundle["byScene"].values()) == 2
    assert vtt.count(" --> ") == srt.count(" --> ") == 2
    assert "00:00:00.000 --> 00:00:01.000" in vtt
    assert "00:00:01.500 --> 00:00:02.500" in vtt
    assert "00:00:01,500 --> 00:00:02,500" in srt
    assert transcript == "first scene words\n\nsecond scene words"
    for scene_id, cues in bundle["byScene"].items():
        assert f"{scene_id}-" in vtt
        assert cues[0]["text"] in vtt and cues[0]["text"] in srt


def test_disabled_captions_keep_transcript_without_emitting_subtitles(tmp_path: Path) -> None:
    with ProjectStore.create(tmp_path / "project", name="Caption test") as store:
        bundle = build_caption_bundle(store, narration_payload(), captions_enabled=False, locale="en-US")
        assert store.cas.object_path(bundle["vttArtifactHash"]).read_text() == "WEBVTT\n"
        assert store.cas.object_path(bundle["srtArtifactHash"]).read_text() == ""
        assert store.cas.object_path(bundle["transcriptArtifactHash"]).read_text().startswith("first scene")


@pytest.mark.parametrize("mismatch", ["duplicate", "missing", "out_of_bounds"])
def test_caption_bundle_rejects_lost_or_out_of_scene_narration(tmp_path: Path, mismatch: str) -> None:
    source = narration_payload()
    if mismatch == "duplicate":
        source["narration"].append(copy.deepcopy(source["narration"][0]))
    elif mismatch == "missing":
        source["narration"].pop()
    else:
        source["narration"][0]["words"][-1]["end_ms"] = 1600
    with (
        ProjectStore.create(tmp_path / "project", name="Caption test") as store,
        pytest.raises(ValueError, match=r"match each measured scene|beyond their measured scene"),
    ):
        build_caption_bundle(store, source, captions_enabled=True, locale="en-US")
