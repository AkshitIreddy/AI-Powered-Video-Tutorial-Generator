from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from alystria.course import TICKS_PER_SECOND
from alystria.generation import (
    GenerationCoordinator,
    GenerationRequest,
    GenerationStage,
    GenerationState,
    SourceSpec,
    request_from_fixture,
)
from alystria.project import ProjectStore

REPOSITORY_ROOT = Path(__file__).parents[4]
BINARY_SEARCH_FIXTURE = (
    REPOSITORY_ROOT / "fixtures" / "canonical" / "binary-search" / "fixture.json"
)


def _fixture() -> dict[str, Any]:
    return json.loads(BINARY_SEARCH_FIXTURE.read_text(encoding="utf-8"))


def _assertion(value: dict[str, Any], assertion_id: str) -> dict[str, Any]:
    return next(
        item for item in value["qualityAssertions"] if item["id"] == assertion_id
    )


def _binary_search_trace(values: list[int], target: int) -> tuple[list[list[int]], int | None]:
    low = 0
    high = len(values) - 1
    trace: list[list[int]] = []
    while low <= high:
        mid = low + (high - low) // 2
        trace.append([low, mid, high, values[mid]])
        if values[mid] == target:
            return trace, mid
        if values[mid] < target:
            low = mid + 1
        else:
            high = mid - 1
    return trace, None


def test_binary_search_fixture_is_executable_and_pedagogically_complete() -> None:
    value = _fixture()
    source_spec = value["sources"][0]
    source_path = BINARY_SEARCH_FIXTURE.parent / source_spec["path"]
    source = source_path.read_text(encoding="utf-8")
    assert hashlib.sha256(source_path.read_bytes()).hexdigest() == source_spec["sha256"]

    pseudocode = _assertion(value, "qa.binary.pseudocode")["expected"]
    assert all(line in source for line in pseudocode)
    code_scene = next(scene for scene in value["scenes"] if scene["id"] == "scene.binary.code")
    assert all(line in code_scene["captionText"] for line in pseudocode)

    found = _assertion(value, "qa.binary.found-trace")["expected"]
    found_trace, found_index = _binary_search_trace(found["values"], found["target"])
    assert found_trace == found["steps"]
    assert found_index == found["returnIndex"] == 6
    assert found["intervalAtReturn"] == found["steps"][-1][::2]
    assert found["intervalAtReturn"] != found["forbiddenState"]

    absent = _assertion(value, "qa.binary.absent-trace")["expected"]
    absent_trace, absent_index = _binary_search_trace(found["values"], absent["target"])
    assert absent_trace == absent["steps"]
    assert absent_index is None
    assert absent["terminalBounds"] == [7, 6]

    bound = _assertion(value, "qa.binary.comparison-bound")["expected"]
    probe_counts = [
        len(_binary_search_trace(list(range(bound["inputLength"])), target)[0])
        for target in range(-1, bound["inputLength"] + 1)
    ]
    assert bound["halvingsToOneCandidate"] == 10
    assert max(probe_counts) == bound["worstCaseValueProbes"] == 11
    assert bound["linearWorstCaseValueProbes"] == 1_024

    scenes = value["scenes"]
    prompt_index = next(
        index for index, scene in enumerate(scenes) if scene["id"] == "scene.binary.quiz-prompt"
    )
    assert scenes[prompt_index + 1]["id"] == "scene.binary.quiz-reveal"
    prompt = scenes[prompt_index]
    reveal = scenes[prompt_index + 1]
    assert prompt["claimIds"] == []
    assert "sorted order is the evidence" not in prompt["narration"].lower()
    assert reveal["captionText"].startswith("No —")


def test_fixture_loader_preserves_authored_teaching_scenes(tmp_path: Path) -> None:
    fixture = _fixture()
    request = request_from_fixture(BINARY_SEARCH_FIXTURE)
    assert request.presenter_mode == "off"
    assert request.metadata["canonicalFixtureScenes"] == fixture["scenes"]
    assert request.metadata["canonicalQualityAssertions"] == fixture["qualityAssertions"]

    store = ProjectStore.create(tmp_path / "Fixture Project", name="Fixture Project")
    coordinator = GenerationCoordinator(store)
    try:
        coordinator.start(request)
        waiting = coordinator.run_pending()
        assert waiting is not None
        assert waiting.state is GenerationState.WAITING_APPROVAL
        storyboard_stage = next(
            stage for stage in waiting.stages if stage.stage is GenerationStage.STORYBOARD
        )
        storyboard_job = coordinator.runtime.get_job(storyboard_stage.job_id)
        assert storyboard_job.result is not None
        storyboard = storyboard_job.result["payload"]["storyboard"]
        assert [scene["id"] for scene in storyboard["scenes"]] == [
            scene["id"] for scene in fixture["scenes"]
        ]
        assert [scene["narration"] for scene in storyboard["scenes"]] == [
            scene["narration"] for scene in fixture["scenes"]
        ]
        assert sum(scene["durationTicks"] for scene in storyboard["scenes"]) == (
            fixture["durationSeconds"] * TICKS_PER_SECOND
        )
        coordinator.approve(waiting.generation_id)
        completed = coordinator.run_pending()
        assert completed is not None
        assert completed.state is GenerationState.SUCCEEDED
    finally:
        store.close()


def test_srt_and_vtt_use_storyboard_scene_starts_not_audio_lengths(tmp_path: Path) -> None:
    request = GenerationRequest(
        topic="Caption scene clock",
        audience="Test learners",
        # The workflow authors three scenes, then fits their shared storyboard
        # clock to measured narration plus bounded visual tails.
        duration_seconds=30,
        sources=(
            SourceSpec(
                "source.caption-clock",
                "Caption clock note",
                "Alpha starts now. Bravo begins second.",
                "fixture:caption-clock.md",
            ),
        ),
        presenter_mode="off",
    )
    store = ProjectStore.create(tmp_path / "Caption Project", name="Caption Project")
    coordinator = GenerationCoordinator(store)
    try:
        generation_id = coordinator.start(request).generation_id
        waiting = coordinator.run_pending()
        assert waiting is not None
        assert waiting.state is GenerationState.WAITING_APPROVAL
        coordinator.approve(generation_id)
        completed = coordinator.run_pending()
        assert completed is not None
        assert completed.state is GenerationState.SUCCEEDED

        caption_job = next(
            job
            for job in coordinator._jobs(generation_id)
            if job.parameters["stage"] == GenerationStage.CAPTIONS.value
        )
        narration_job = next(
            job
            for job in coordinator._jobs(generation_id)
            if job.parameters["stage"] == GenerationStage.NARRATION.value
        )
        assert caption_job.result is not None
        assert narration_job.result is not None
        payload = caption_job.result["payload"]
        narration_payload = narration_job.result["payload"]
        scenes = narration_payload["storyboard"]["scenes"]
        with store.cas.open(payload["srtArtifactHash"]) as stream:
            srt = stream.read().decode("utf-8")
        with store.cas.open(payload["vttArtifactHash"]) as stream:
            vtt = stream.read().decode("utf-8")

        def timestamp(milliseconds: int, separator: str) -> str:
            hours, remainder = divmod(milliseconds, 3_600_000)
            minutes, remainder = divmod(remainder, 60_000)
            seconds, millis = divmod(remainder, 1_000)
            return f"{hours:02}:{minutes:02}:{seconds:02}{separator}{millis:03}"

        srt_intervals = [line for line in srt.splitlines() if " --> " in line]
        vtt_intervals = [line for line in vtt.splitlines() if " --> " in line]
        expected_srt: list[str] = []
        expected_vtt: list[str] = []
        offset_ticks = 0
        for scene in scenes:
            offset_ms = round(offset_ticks * 1_000 / TICKS_PER_SECOND)
            for cue in payload["byScene"][scene["id"]]:
                start_ms = offset_ms + cue["start_ms"]
                end_ms = offset_ms + cue["end_ms"]
                expected_srt.append(
                    f"{timestamp(start_ms, ',')} --> {timestamp(end_ms, ',')}"
                )
                expected_vtt.append(
                    f"{timestamp(start_ms, '.')} --> {timestamp(end_ms, '.')}"
                )
            offset_ticks += scene["durationTicks"]

        assert srt_intervals == expected_srt
        assert vtt_intervals == expected_vtt
        # The global second-scene cue derives from the fitted storyboard
        # boundary plus its local aligned start, rather than concatenating the
        # preceding audio file's measured duration.
        second_scene_first_cue = payload["byScene"][scenes[1]["id"]][0]
        first_boundary_ms = round(
            scenes[0]["durationTicks"] * 1_000 / TICKS_PER_SECOND
        )
        first_audio_ms = next(
            item["durationMs"]
            for item in narration_payload["narration"]
            if item["sceneId"] == scenes[0]["id"]
        )
        assert first_boundary_ms > first_audio_ms
        assert expected_srt[len(payload["byScene"][scenes[0]["id"]])].startswith(
            timestamp(first_boundary_ms + second_scene_first_cue["start_ms"], ",")
        )
    finally:
        store.close()
