from __future__ import annotations

import json
import socket
import uuid
from pathlib import Path
from typing import Any

import pytest

from alystria.generation import (
    ALL_STAGES,
    ApprovalNotReadyError,
    ClaimSpec,
    DeterministicRendererClient,
    GenerationCoordinator,
    GenerationRequest,
    GenerationStage,
    GenerationState,
    RenderedTutorial,
    SourceSpec,
    request_from_desktop,
    request_from_fixture,
)
from alystria.generation.workflow import _presenter_direction, _presenter_fit
from alystria.presenters import PresenterPlacement
from alystria.project import ProjectStore
from alystria.research import GroundingMode


def request(*, faults: int = 0) -> GenerationRequest:
    return GenerationRequest(
        topic="Binary search invariants",
        audience="Beginning computer-science learners",
        duration_seconds=180,
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
        presenter_mode="auto",
        repairable_faults=faults,
        metadata={"testOnlyInjectQaFaults": True} if faults else {},
    )


def open_coordinator(tmp_path: Path) -> tuple[ProjectStore, GenerationCoordinator]:
    store = ProjectStore.create(tmp_path / "Tutorial Project", name="Tutorial Project")
    return store, GenerationCoordinator(store)


def test_presenter_direction_uses_only_explicit_semantic_placements() -> None:
    assert _presenter_direction({}).placement is PresenterPlacement.PICTURE_IN_PICTURE
    assert _presenter_direction({"presenterPlacement": "full_frame"}).placement is PresenterPlacement.FULL_FRAME
    assert _presenter_direction({"presenterPlacement": "picture-in-picture"}).placement is PresenterPlacement.PICTURE_IN_PICTURE
    assert _presenter_fit({"presenterFit": "contain"}) == "contain"
    with pytest.raises(ValueError, match="Unsupported presenter placement"):
        _presenter_direction({"presenterPlacement": "arbitrary-filter-coordinate"})
    with pytest.raises(ValueError, match="Presenter fit"):
        _presenter_fit({"presenterFit": "unknown"})


def test_staged_workflow_pauses_for_approval_then_exports(tmp_path: Path) -> None:
    store, coordinator = open_coordinator(tmp_path)
    try:
        started = coordinator.start(request())
        assert started.state is GenerationState.QUEUED
        assert len(started.stages) == 5

        waiting = coordinator.run_pending()
        assert waiting is not None
        assert waiting.state is GenerationState.WAITING_APPROVAL
        assert [item.stage for item in waiting.stages] == list(ALL_STAGES[:5])
        with pytest.raises(ValueError, match="no failed"):
            coordinator.retry(waiting.generation_id)

        approved = coordinator.approve(waiting.generation_id)
        assert approved.approval_revision_id is not None
        assert len(approved.stages) == len(ALL_STAGES)

        completed = coordinator.run_pending()
        assert completed is not None
        assert completed.state is GenerationState.SUCCEEDED
        assert completed.progress == pytest.approx(1.0)
        assert completed.export_artifact_hash is not None
        assert store.cas.verify(completed.export_artifact_hash)
        assert completed.final_revision_id is not None

        export = next(item for item in completed.stages if item.stage is GenerationStage.EXPORT)
        export_job = coordinator.runtime.get_job(export.job_id)
        assert export_job.result is not None
        manifest = export_job.result["payload"]["exportManifest"]
        assert manifest["title"] == "Binary search invariants"
        assert manifest["qualityGate"]["status"] == "PASS"
        assert {item["role"] for item in manifest["files"]} == {
            "video",
            "captions",
            "captions-srt",
            "transcript",
        }

        generation_revisions = [
            revision
            for revision in store.list_revisions(limit=100)
            if revision.snapshot.get("generationId") == completed.generation_id
        ]
        assert len(generation_revisions) == len(ALL_STAGES) + 1
        assert all(
            revision.snapshot.get("stageArtifactHash")
            for revision in generation_revisions
            if revision.kind == "generation"
        )
        dependency_count = store.connection.execute(
            "SELECT COUNT(*) FROM job_dependencies"
        ).fetchone()[0]
        assert dependency_count >= len(ALL_STAGES) - 1
    finally:
        store.close()


def test_start_rolls_back_the_entire_preapproval_graph_on_enqueue_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, coordinator = open_coordinator(tmp_path)
    original = coordinator.workflow._enqueue_stage
    calls = 0

    def fail_during_graph(*args: Any, **kwargs: Any) -> str:
        nonlocal calls
        calls += 1
        if calls == 3:
            raise RuntimeError("injected enqueue interruption")
        return original(*args, **kwargs)

    monkeypatch.setattr(coordinator.workflow, "_enqueue_stage", fail_during_graph)
    try:
        with pytest.raises(RuntimeError, match="injected enqueue"):
            coordinator.start(request())
        assert coordinator.runtime.list_jobs(project_id=store.manifest.project_id) == []
    finally:
        store.close()


def test_approve_rolls_back_revision_and_postapproval_graph_on_enqueue_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, coordinator = open_coordinator(tmp_path)
    try:
        generation_id = coordinator.start(request()).generation_id
        waiting = coordinator.run_pending()
        assert waiting is not None and waiting.state is GenerationState.WAITING_APPROVAL
        revisions_before = len(store.list_revisions(limit=100))
        original = coordinator.workflow._enqueue_stage
        calls = 0

        def fail_during_graph(*args: Any, **kwargs: Any) -> str:
            nonlocal calls
            calls += 1
            if calls == 3:
                raise RuntimeError("injected postapproval interruption")
            return original(*args, **kwargs)

        monkeypatch.setattr(coordinator.workflow, "_enqueue_stage", fail_during_graph)
        with pytest.raises(RuntimeError, match="injected postapproval"):
            coordinator.approve(generation_id)
        assert len(store.list_revisions(limit=100)) == revisions_before
        assert len(coordinator._jobs(generation_id)) == 5
        assert coordinator.status(generation_id).state is GenerationState.WAITING_APPROVAL
    finally:
        store.close()


def test_retry_rolls_back_all_stage_transitions_on_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, coordinator = open_coordinator(tmp_path)
    try:
        generation_id = coordinator.start(request()).generation_id
        coordinator.cancel(generation_id)
        states_before = {job.job_id: job.state for job in coordinator._jobs(generation_id)}
        original = coordinator.runtime.retry
        calls = 0

        def fail_during_retry(job_id: str):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError("injected retry interruption")
            return original(job_id)

        monkeypatch.setattr(coordinator.runtime, "retry", fail_during_retry)
        with pytest.raises(RuntimeError, match="injected retry"):
            coordinator.retry(generation_id)
        assert {job.job_id: job.state for job in coordinator._jobs(generation_id)} == states_before
        assert coordinator.status(generation_id).state is GenerationState.CANCELLED
    finally:
        store.close()


def test_canonical_fixture_runs_fully_offline_and_is_grounded(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fixture = Path(__file__).parents[4] / "fixtures" / "canonical" / "karatsuba" / "fixture.json"
    fixture_request = request_from_fixture(fixture)

    def reject_network(*_: Any, **__: Any) -> None:
        raise AssertionError("Offline fixture attempted network access")

    monkeypatch.setattr(socket, "create_connection", reject_network)
    store, coordinator = open_coordinator(tmp_path)
    try:
        generation_id = coordinator.start(fixture_request).generation_id
        waiting = coordinator.run_pending()
        assert waiting is not None and waiting.state is GenerationState.WAITING_APPROVAL
        ingest = next(
            item for item in waiting.stages if item.stage is GenerationStage.INGEST_RESEARCH
        )
        ingest_result = coordinator.runtime.get_job(ingest.job_id).result
        assert ingest_result is not None
        payload = ingest_result["payload"]
        assert payload["policy"] == {"mode": "strict", "accepted": True, "findings": []}
        assert {claim["status"] for claim in payload["claims"]} == {"supported"}
        assert len(payload["claims"]) == 3

        coordinator.approve(generation_id)
        completed = coordinator.run_pending()
        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        storyboard_job = next(
            job
            for job in coordinator._jobs(generation_id)
            if job.parameters["stage"] == GenerationStage.STORYBOARD.value
        )
        assert storyboard_job.result is not None
        storyboard = storyboard_job.result["payload"]["storyboard"]
        assert storyboard["timebase"] == 240_000
        assert len(storyboard["targets"]) == 3
        assert storyboard["visualBible"]["name"] == "Precision Studio"
    finally:
        store.close()


@pytest.mark.parametrize(
    ("sources", "claim", "expected_code"),
    (
        (
            (),
            "Saturn has exactly 82 moons.",
            "claim.unsupported",
        ),
        (
            (
                SourceSpec(
                    "source.unrelated",
                    "Unrelated botany note",
                    "A mature sunflower head contains many individual florets.",
                    "fixture:unrelated.md",
                ),
            ),
            "Saturn has exactly 82 moons.",
            "claim.unsupported",
        ),
        (
            (
                SourceSpec(
                    "source.contradiction",
                    "Contradictory astronomy note",
                    "Saturn does not have exactly 82 moons.",
                    "fixture:contradiction.md",
                ),
            ),
            "Saturn has exactly 82 moons.",
            "claim.contradicted",
        ),
    ),
)
def test_strict_grounding_blocks_unverified_claims(
    tmp_path: Path,
    sources: tuple[SourceSpec, ...],
    claim: str,
    expected_code: str,
) -> None:
    store, coordinator = open_coordinator(tmp_path)
    strict_request = GenerationRequest(
        topic="A short astronomy lesson",
        audience="General learners",
        duration_seconds=60,
        grounding_mode=GroundingMode.STRICT,
        sources=sources,
        claims=(
            # Omitting source_id intentionally permits claim-specific retrieval
            # across all real sources, but never the learner brief/topic.
            ClaimSpec("claim.saturn.moons", claim),
        ),
    )
    try:
        generation_id = coordinator.start(strict_request).generation_id
        failed = coordinator.run_pending()
        assert failed is not None and failed.state is GenerationState.FAILED
        ingest = next(
            item for item in failed.stages if item.stage is GenerationStage.INGEST_RESEARCH
        )
        assert ingest.error is not None
        assert expected_code in ingest.error["message"]
        assert coordinator.status(generation_id).state is GenerationState.FAILED
    finally:
        store.close()


def test_strict_grounding_accepts_exact_supporting_span(tmp_path: Path) -> None:
    source = SourceSpec(
        "source.astronomy",
        "Astronomy note",
        "Saturn has exactly 82 moons.",
        "fixture:astronomy.md",
    )
    store, coordinator = open_coordinator(tmp_path)
    try:
        coordinator.start(
            GenerationRequest(
                topic="A short astronomy lesson",
                audience="General learners",
                duration_seconds=60,
                grounding_mode=GroundingMode.STRICT,
                sources=(source,),
                claims=(ClaimSpec("claim.saturn.moons", source.content, source.source_id),),
            )
        )
        waiting = coordinator.run_pending()
        assert waiting is not None and waiting.state is GenerationState.WAITING_APPROVAL
        ingest = next(
            item for item in waiting.stages if item.stage is GenerationStage.INGEST_RESEARCH
        )
        result = coordinator.runtime.get_job(ingest.job_id).result
        assert result is not None
        claim = result["payload"]["claims"][0]
        assert claim["status"] == "supported"
        assert len(claim["evidenceChunkIds"]) == 1
        evidence = {item["id"]: item for item in result["payload"]["evidenceChunks"]}[
            claim["evidenceChunkIds"][0]
        ]
        assert evidence["text"] == source.content
        assert evidence["locator"].endswith("#chars=0-28")
    finally:
        store.close()


@pytest.mark.parametrize(
    ("faults", "expected_state", "expected_attempts"),
    ((2, GenerationState.SUCCEEDED, 2), (3, GenerationState.FAILED, None)),
)
def test_qa_repairs_are_bounded_to_two_attempts(
    tmp_path: Path,
    faults: int,
    expected_state: GenerationState,
    expected_attempts: int | None,
) -> None:
    store, coordinator = open_coordinator(tmp_path)
    try:
        generation_id = coordinator.start(request(faults=faults)).generation_id
        coordinator.run_pending()
        coordinator.approve(generation_id)
        completed = coordinator.run_pending()
        assert completed is not None
        assert completed.state is expected_state
        repair_jobs = [
            item
            for item in completed.stages
            if item.stage in {GenerationStage.REPAIR_ONE, GenerationStage.REPAIR_TWO}
        ]
        assert all(item.state == "SUCCEEDED" for item in repair_jobs)
        if expected_attempts is not None:
            export_job = next(
                coordinator.runtime.get_job(item.job_id)
                for item in completed.stages
                if item.stage is GenerationStage.EXPORT
            )
            assert export_job.result is not None
            assert (
                export_job.result["payload"]["exportManifest"]["repairAttempts"]
                == expected_attempts
            )
        else:
            export = next(item for item in completed.stages if item.stage is GenerationStage.EXPORT)
            assert export.error is not None
            assert "2 automatic repair attempts" in export.error["message"]
    finally:
        store.close()


def test_cancel_retry_and_idempotent_start(tmp_path: Path) -> None:
    store, coordinator = open_coordinator(tmp_path)
    try:
        generation_id = str(uuid.uuid4())
        first = coordinator.start(request(), generation_id=generation_id)
        second = coordinator.start(request(), generation_id=generation_id)
        assert [item.job_id for item in first.stages] == [item.job_id for item in second.stages]

        cancelled = coordinator.cancel(generation_id)
        assert cancelled.state is GenerationState.CANCELLED
        retried = coordinator.retry(generation_id)
        assert retried.state is GenerationState.QUEUED
        waiting = coordinator.run_pending()
        assert waiting is not None and waiting.state is GenerationState.WAITING_APPROVAL
        with pytest.raises(ApprovalNotReadyError):
            other_store, other = open_coordinator(tmp_path / "other")
            try:
                queued = other.start(request())
                other.approve(queued.generation_id)
            finally:
                other_store.close()
    finally:
        store.close()


def test_cancel_and_retry_are_durable_while_waiting_for_approval(tmp_path: Path) -> None:
    store, coordinator = open_coordinator(tmp_path)
    generation_id = coordinator.start(request()).generation_id
    waiting = coordinator.run_pending()
    assert waiting is not None and waiting.state is GenerationState.WAITING_APPROVAL
    succeeded_before = {stage.job_id for stage in waiting.stages if stage.state == "SUCCEEDED"}

    cancelled = coordinator.cancel(generation_id)
    assert cancelled.state is GenerationState.CANCELLED
    store.close()

    reopened = ProjectStore.open(tmp_path / "Tutorial Project")
    try:
        resumed = GenerationCoordinator(reopened)
        assert resumed.status(generation_id).state is GenerationState.CANCELLED
        retried = resumed.retry(generation_id)
        assert retried.state is GenerationState.WAITING_APPROVAL
        assert {
            stage.job_id for stage in retried.stages if stage.state == "SUCCEEDED"
        } == succeeded_before
        assert resumed.status(generation_id).state is GenerationState.WAITING_APPROVAL
    finally:
        reopened.close()


def test_scope_invalidation_is_transitive_and_scene_local(tmp_path: Path) -> None:
    store, coordinator = open_coordinator(tmp_path)
    try:
        generation_id = coordinator.start(request()).generation_id
        coordinator.run_pending()
        coordinator.approve(generation_id)
        completed = coordinator.run_pending()
        assert completed is not None and completed.state is GenerationState.SUCCEEDED

        pronunciation = coordinator.invalidate_scope(generation_id, "pronunciation")
        suffixes = {item.rsplit(":", 1)[-1] for item in pronunciation}
        assert {
            "pronunciation",
            "narration",
            "captions",
            "presenter",
            "render",
            "export",
        } <= suffixes
        assert "assets" not in suffixes

        storyboard_job = next(
            coordinator.runtime.get_job(item.job_id)
            for item in completed.stages
            if item.stage is GenerationStage.STORYBOARD
        )
        assert storyboard_job.result is not None
        scene_id = storyboard_job.result["payload"]["storyboard"]["scenes"][0]["id"]
        scene = coordinator.invalidate_scope(generation_id, f"scene:{scene_id}")
        assert any(f"scene:{scene_id}:asset" in item for item in scene)
        assert any(f"scene:{scene_id}:narration" in item for item in scene)
        assert "assets" in coordinator.status(generation_id).invalidated_scopes
    finally:
        store.close()


class RecordingRenderer(DeterministicRendererClient):
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []

    def render(self, request: dict[str, Any]) -> RenderedTutorial:
        self.requests.append(json.loads(json.dumps(request)))
        return super().render(request)


def test_renderer_client_receives_immutable_complete_request(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Tutorial Project", name="Tutorial Project")
    renderer = RecordingRenderer()
    coordinator = GenerationCoordinator(store, renderer_client=renderer)
    try:
        generation_id = coordinator.start(request()).generation_id
        coordinator.run_pending()
        coordinator.approve(generation_id)
        coordinator.run_pending()
        assert len(renderer.requests) == 1
        sent = renderer.requests[0]
        assert sent["schemaVersion"] == 1
        assert sent["timebase"] == 240_000
        assert sent["scenes"]
        assert len(sent["assets"]) == len(sent["scenes"])
        assert len(sent["narration"]) == len(sent["scenes"])
        assert all("artifactHash" in item for item in sent["assets"])
        assert sent["scenes"][0]["type"] == "presenter-slide"
        assert sent["presenters"]
        assert sent["presenters"][0]["sceneId"] == sent["scenes"][0]["id"]
    finally:
        store.close()


def test_desktop_policy_request_uses_authoritative_project_snapshot(tmp_path: Path) -> None:
    store, _ = open_coordinator(tmp_path)
    try:
        store.create_revision(
            snapshot={
                "brief": {
                    "topic": "Recursion trees",
                    "audience": "Undergraduate algorithms students",
                    "durationSeconds": 420,
                    "locale": "es-ES",
                },
                "groundingMode": "grounded",
                "sources": [
                    {
                        "id": "source.note",
                        "title": "Course note",
                        "content": "A recursion tree expands recurrence costs by level.",
                        "licenseId": "CC0-1.0",
                    }
                ],
            },
            kind="edit",
        )
        converted = request_from_desktop(
            store,
            {
                "snapshotId": None,
                "scope": {"kind": "project"},
                "quality": "standard",
                "privacy": "local",
                "approvedProviderIds": [],
                "preservationLocks": ["script"],
                "budget": {
                    "currency": "USD",
                    "hardLimitMinorUnits": 25,
                    "requireKnownPricing": True,
                },
            },
        )
        assert converted.topic == "Recursion trees"
        assert converted.locale == "es-ES"
        assert converted.duration_seconds == 420
        assert converted.hard_budget_micros == 250_000
        assert converted.sources[0].source_id == "source.note"
        assert converted.metadata["preservationLocks"] == ["script"]
    finally:
        store.close()
