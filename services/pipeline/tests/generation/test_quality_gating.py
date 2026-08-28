from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from alystria.generation import (
    DeterministicMediaClient,
    DeterministicRendererClient,
    GeneratedMedia,
    GenerationCoordinator,
    GenerationRequest,
    GenerationStage,
    GenerationState,
    RenderedTutorial,
    SourceSpec,
)
from alystria.generation.workflow import _content_quality_gates
from alystria.project import ProjectStore
from alystria.research import GroundingMode


class MetricsRenderer(DeterministicRendererClient):
    def __init__(self, metrics: dict[str, Any]) -> None:
        self.metrics = metrics

    def render(self, request: dict[str, Any]) -> RenderedTutorial:
        rendered = super().render(request)
        return replace(rendered, metrics={**rendered.metrics, **self.metrics})


class MissingRightsMediaClient(DeterministicMediaClient):
    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        media = super().create_visual(scene, seed=seed)
        return replace(media, metadata={"seed": seed})


def generation_request(*, strict: bool = False) -> GenerationRequest:
    return GenerationRequest(
        topic="Binary search invariants",
        audience="Beginning computer-science learners",
        duration_seconds=60,
        sources=(
            SourceSpec(
                "source.binary-search",
                "Binary search note",
                "Binary search halves a sorted search interval while preserving the target invariant.",
                "fixture:binary-search.md",
                "text/markdown",
                "CC0-1.0",
                "Fixture authors",
            ),
        ),
        deterministic_seed=17,
        presenter_mode="off",
        grounding_mode=GroundingMode.STRICT if strict else GroundingMode.GROUNDED,
    )


def run_generation(
    tmp_path: Path,
    *,
    renderer: DeterministicRendererClient | None = None,
    media: DeterministicMediaClient | None = None,
) -> tuple[GenerationState, dict[str, Any]]:
    store = ProjectStore.create(tmp_path / "Tutorial Project", name="Tutorial Project")
    coordinator = GenerationCoordinator(store, renderer_client=renderer, media_client=media)
    try:
        generation_id = coordinator.start(generation_request()).generation_id
        coordinator.run_pending()
        coordinator.approve(generation_id)
        status = coordinator.run_pending()
        assert status is not None
        qa_job = next(
            coordinator.runtime.get_job(stage.job_id)
            for stage in status.stages
            if stage.stage is GenerationStage.QA_FINAL
        )
        assert qa_job.result is not None, "\n".join(
            f"{stage.stage.value}: {stage.state} {stage.error}"
            for stage in status.stages
        )
        return status.state, deepcopy(qa_job.result["payload"])
    finally:
        store.close()


@pytest.mark.parametrize(
    ("metrics", "expected_codes"),
    (
        (
            {
                "visualSnapshots": [
                    {
                        "sceneId": "scene.blank",
                        "tick": 0,
                        "width": 640,
                        "height": 360,
                        "elements": [],
                    }
                ]
            },
            {"visual.blank_frame"},
        ),
        ({"clippedSamples": 24}, {"audio.clipping"}),
        (
            {"integratedLufs": -22.0, "truePeakDbtp": -0.2},
            {"audio.loudness", "audio.true_peak"},
        ),
        (
            {
                "visualSnapshots": [
                    {
                        "sceneId": "scene.caption",
                        "tick": 120_000,
                        "width": 640,
                        "height": 360,
                        "elements": [
                            {
                                "elementId": "diagram",
                                "kind": "visual",
                                "x": 80,
                                "y": 230,
                                "width": 480,
                                "height": 70,
                                "essential": True,
                            },
                            {
                                "elementId": "caption",
                                "kind": "caption",
                                "x": 100,
                                "y": 250,
                                "width": 440,
                                "height": 44,
                                "foreground": "#FFFFFF",
                                "background": "#151827",
                            },
                        ],
                    }
                ]
            },
            {"visual.caption_obstruction"},
        ),
        ({"avDriftFrames": 2.0}, {"timeline.audio_drift"}),
    ),
)
def test_measured_multimodal_failures_block_export(
    tmp_path: Path,
    metrics: dict[str, Any],
    expected_codes: set[str],
) -> None:
    state, qa = run_generation(tmp_path, renderer=MetricsRenderer(metrics))

    assert state is GenerationState.FAILED
    assert qa["passed"] is False
    assert expected_codes <= {
        finding["code"] for finding in qa["qualityGate"]["findings"]
    }


def test_missing_rights_or_provenance_blocks_export(tmp_path: Path) -> None:
    state, qa = run_generation(tmp_path, media=MissingRightsMediaClient())

    assert state is GenerationState.FAILED
    assert qa["passed"] is False
    assert {finding["code"] for finding in qa["qualityGate"]["findings"]} & {
        "export.license",
        "export.provenance",
    }


def test_strict_unsupported_claim_is_a_major_quality_failure(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Tutorial Project", name="Tutorial Project")
    coordinator = GenerationCoordinator(store)
    try:
        coordinator.start(generation_request(strict=True))
        waiting = coordinator.run_pending()
        assert waiting is not None
        approval = next(
            coordinator.runtime.get_job(stage.job_id)
            for stage in waiting.stages
            if stage.stage is GenerationStage.APPROVAL
        )
        assert approval.result is not None
        approved = deepcopy(approval.result["payload"])
        approved["claims"][0]["status"] = "unsupported"
        approved["claims"][0]["externallyVerifiable"] = True
        approved["claims"][0]["evidenceChunkIds"] = ["evidence.test"]
        approved["evidenceChunks"].append(
            {
                "id": "evidence.test",
                "sourceId": "source.binary-search",
                "sha256": "0" * 64,
                "locator": "fixture:binary-search.md#L1",
            }
        )
        gates = _content_quality_gates(approved, generation_request(strict=True))
    finally:
        store.close()

    findings = [finding for gate in gates for finding in gate.findings]
    unsupported = next(
        (finding for finding in findings if finding.code == "claim.unsupported"),
        None,
    )
    assert unsupported is not None, {
        "findings": [(finding.code, finding.message) for finding in findings],
        "claims": approved["claims"],
        "sceneClaims": [scene.get("claimIds") for scene in approved["storyboard"]["scenes"]],
    }
    assert unsupported.severity.value == "MAJOR"


def test_valid_immutable_metrics_and_provenance_pass(tmp_path: Path) -> None:
    state, qa = run_generation(tmp_path)

    assert state is GenerationState.SUCCEEDED
    assert qa["passed"] is True
    assert qa["qualityGate"]["status"] == "PASS"
    assert qa["candidate"]["provenanceManifestHash"]
    assert qa["candidate"]["qaEvidenceHash"]
