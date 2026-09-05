from __future__ import annotations

import copy
import hashlib
import json
import socket
import uuid
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from alystria.generation import (
    ALL_STAGES,
    ApprovalNotReadyError,
    ClaimSpec,
    DeterministicMediaClient,
    DeterministicRendererClient,
    GeneratedMedia,
    GenerationCoordinator,
    GenerationRequest,
    GenerationStage,
    GenerationState,
    ObjectiveSpec,
    RenderedTutorial,
    SourceSpec,
    request_from_desktop,
    request_from_fixture,
)
from alystria.generation.coordinator import _prepare_narration_pacing_reapproval
from alystria.generation.forced_alignment import AlignmentInput
from alystria.generation.workflow import (
    _caption_alignment_quality_gate,
    _presenter_direction,
    _presenter_fit,
    _presenters_for_render,
    _provider_neutral_word_timings,
    _remaining_structured_job_budget,
)
from alystria.jobs import JobContext, JobState
from alystria.presenters import PresenterPlacement
from alystria.project import ProjectStore
from alystria.project.errors import RevisionConflictError
from alystria.providers import FailureCode, ProviderFailure
from alystria.qa import Finding, GateStatus, QualityGate, Severity
from alystria.research import DeterministicOfflineProvider, GroundingMode
from alystria.service import _configured_forced_aligner, _configured_local_presenter


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


class TerminalUsageEducationProvider(DeterministicOfflineProvider):
    def build_outline(self, *_: Any, **__: Any) -> Any:
        raise ProviderFailure(
            FailureCode.MALFORMED_RESPONSE,
            "Structured-output provider returned JSON outside the requested schema",
            provider_id="groq",
            details={
                "schemaKeyword": "minItems",
                "schemaPath": "$.sections[4].objectiveIds",
                "repairAttempted": True,
                "attemptCount": 2,
                "billableUsage": {
                    "model": "openai/gpt-oss-20b",
                    "inputTokens": 1_950,
                    "outputTokens": 920,
                    "actualCostMicros": 423,
                },
            },
        )


def test_structured_budget_is_shared_by_stages_in_one_generation(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Shared generation budget", name="Budget")
    runtime = GenerationCoordinator(store).runtime
    try:
        first = runtime.enqueue(
            project_id=store.manifest.project_id,
            kind="generation.learning_plan",
            parameters={"generationId": "generation-a"},
            budget_micros=1_000,
        )
        current = runtime.enqueue(
            project_id=store.manifest.project_id,
            kind="generation.script",
            parameters={"generationId": "generation-a", "stage": "script"},
            budget_micros=1_000,
        )
        separate = runtime.enqueue(
            project_id=store.manifest.project_id,
            kind="generation.learning_plan",
            parameters={"generationId": "generation-b"},
            budget_micros=1_000,
        )
        runtime.record_usage(
            first.job_id,
            provider="groq",
            model="openai/gpt-oss-20b",
            unit="tokens",
            quantity=100,
            cost_micros=300,
            idempotency_key="generation-a-plan",
        )
        runtime.record_usage(
            separate.job_id,
            provider="groq",
            model="openai/gpt-oss-20b",
            unit="tokens",
            quantity=100,
            cost_micros=400,
            idempotency_key="generation-b-plan",
        )
        context = JobContext(runtime, current.job_id, "attempt", 1, current.task_key)

        assert _remaining_structured_job_budget(context) == 700
        runtime.record_usage(
            current.job_id,
            provider="groq",
            model="openai/gpt-oss-20b",
            unit="billing-status",
            quantity=0,
            cost_micros=0,
            idempotency_key="generation-a-unknown-billing",
            metadata={"usageComplete": False, "knownCostMicros": None},
            incurred=True,
        )
        assert _remaining_structured_job_budget(context) == 0
    finally:
        store.close()


def test_terminal_structured_repair_usage_reaches_the_learning_plan_ledger(
    tmp_path: Path,
) -> None:
    store = ProjectStore.create(tmp_path / "Provider usage", name="Provider usage")
    coordinator = GenerationCoordinator(
        store,
        educational_provider=TerminalUsageEducationProvider(),
    )
    try:
        generation_id = coordinator.start(
            replace(request(), hard_budget_micros=1_000)
        ).generation_id
        failed = coordinator.run_pending()
        assert failed is not None and failed.state is GenerationState.FAILED
        learning = next(
            coordinator.runtime.get_job(stage.job_id)
            for stage in failed.stages
            if stage.stage is GenerationStage.LEARNING_PLAN
        )
        summary = coordinator.runtime.usage_summary(learning.job_id)
        assert summary.records == 1
        assert summary.total_cost_micros == 423
        assert summary.by_provider == {"groq": 423}

        coordinator.retry(generation_id)
        failed_again = coordinator.run_pending()
        assert failed_again is not None and failed_again.state is GenerationState.FAILED
        cumulative = coordinator.runtime.usage_summary(learning.job_id)
        assert cumulative.records == 2
        assert cumulative.total_cost_micros == 846
        assert cumulative.by_provider == {"groq": 846}
    finally:
        store.close()


def test_word_timing_normalization_supports_native_forced_and_fallback_routes() -> None:
    native_words, native_alignment = _provider_neutral_word_timings(
        "Every model works",
        duration_ms=900,
        metadata={
            "wordTimings": [
                {"word": "Every", "startMs": 20, "endMs": 220},
                {"word": "model", "startMs": 250, "endMs": 500},
                {"word": "works", "startMs": 540, "endMs": 860},
            ],
            "alignmentEngine": "provider-word-clock",
        },
    )
    assert [word.token for word in native_words] == ["Every", "model", "works"]
    assert native_alignment == {
        "schemaVersion": 1,
        "status": "COMPLETE",
        "source": "provider-native",
        "engine": "provider-word-clock",
        "alignedTokenRatio": 1.0,
    }

    _, forced_alignment = _provider_neutral_word_timings(
        "Every model works",
        duration_ms=900,
        metadata={
            "alignment": {
                "source": "forced-alignment",
                "engine": "selected-local-aligner",
                "words": [
                    {"token": "Every", "start_ms": 20, "end_ms": 220},
                    {"token": "model", "start_ms": 250, "end_ms": 500},
                    {"token": "works", "start_ms": 540, "end_ms": 860},
                ],
            }
        },
    )
    assert forced_alignment["source"] == "forced-alignment"
    assert forced_alignment["engine"] == "selected-local-aligner"

    fallback_words, fallback_alignment = _provider_neutral_word_timings(
        "Every model works",
        duration_ms=900,
        metadata={"wordTimings": [{"word": "bad", "startMs": 900, "endMs": 901}]},
    )
    assert fallback_alignment["source"] == "duration-proportional"
    assert fallback_alignment["status"] == "ESTIMATED"
    assert fallback_alignment["alignedTokenRatio"] is None
    assert fallback_words[-1].end_ms == 900

    wrong_words, wrong_alignment = _provider_neutral_word_timings(
        "Every model works",
        duration_ms=900,
        metadata={
            "wordTimings": [
                {"word": "Completely", "startMs": 20, "endMs": 220},
                {"word": "different", "startMs": 250, "endMs": 500},
                {"word": "tokens", "startMs": 540, "endMs": 860},
            ]
        },
    )
    assert [word.token for word in wrong_words] == ["Every", "model", "works"]
    assert wrong_alignment["status"] == "ESTIMATED"
    assert wrong_alignment["alignedTokenRatio"] is None


def test_estimated_caption_timing_blocks_final_media_quality() -> None:
    gate = _caption_alignment_quality_gate(
        {
            "narrationAlignments": [
                {
                    "sceneId": "scene-one",
                    "alignment": {
                        "status": "ESTIMATED",
                        "source": "duration-proportional",
                        "alignedTokenRatio": None,
                    },
                }
            ]
        }
    )

    assert gate.status is GateStatus.FAIL
    assert gate.findings[0].code == "audio.alignment_not_verified"


class _UntimedMediaClient:
    provider_id = "test-untimed"
    model_revision = "1"

    def __init__(self) -> None:
        self.inner = DeterministicMediaClient()
        self.narration_texts: list[str] = []

    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        return self.inner.create_visual(scene, seed=seed)

    def synthesize_narration(
        self, scene: dict[str, Any], *, locale: str, seed: int
    ) -> GeneratedMedia:
        self.narration_texts.append(str(scene["narration"]))
        media = self.inner.synthesize_narration(scene, locale=locale, seed=seed)
        return replace(
            media,
            metadata={
                key: value
                for key, value in media.metadata.items()
                if key not in {"wordTimings", "alignmentSource", "alignmentEngine"}
            },
        )

    def create_presenter(
        self, scene: dict[str, Any], *, narration_hash: str, seed: int
    ) -> GeneratedMedia | None:
        return self.inner.create_presenter(scene, narration_hash=narration_hash, seed=seed)


class _RecordingNativeMediaClient(DeterministicMediaClient):
    def __init__(self) -> None:
        self.narration_texts: list[str] = []

    def synthesize_narration(
        self, scene: dict[str, Any], *, locale: str, seed: int
    ) -> GeneratedMedia:
        self.narration_texts.append(str(scene["narration"]))
        return super().synthesize_narration(scene, locale=locale, seed=seed)


class _MeasuredBatchAligner:
    def __init__(self) -> None:
        self.calls: list[tuple[AlignmentInput, ...]] = []

    def align_batch(self, values: tuple[AlignmentInput, ...] | list[AlignmentInput]) -> dict[str, dict[str, Any]]:
        self.calls.append(tuple(values))
        output: dict[str, dict[str, Any]] = {}
        for value in values:
            tokens = value.text.split()
            output[value.scene_id] = {
                "wordTimings": [
                    {
                        "word": token,
                        "startMs": round(index * value.duration_ms / len(tokens)),
                        "endMs": round((index + 1) * value.duration_ms / len(tokens)),
                    }
                    for index, token in enumerate(tokens)
                ],
                "alignmentSource": "forced-alignment",
                "alignmentEngine": "test-measured-aligner",
            }
        return output


def test_narration_runs_one_forced_alignment_batch_before_caption_export(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Aligned", name="Aligned")
    aligner = _MeasuredBatchAligner()
    media_client = _UntimedMediaClient()
    try:
        coordinator = GenerationCoordinator(
            store,
            media_client=media_client,
            alignment_client=aligner,
        )
        authored = replace(
            request(),
            topic="Analyze O(n^2) and 1,234 + 50%",
            duration_seconds=60,
        )
        started = coordinator.start(authored)
        coordinator.run_pending()
        coordinator.approve(started.generation_id)
        completed = coordinator.run_pending()
        assert completed is not None
        assert completed.state is GenerationState.SUCCEEDED
        assert len(aligner.calls) == 1
        aligned_texts = [item.text for item in aligner.calls[0]]
        assert aligned_texts == media_client.narration_texts
        assert all(
            "O(n^2)" not in text and "1,234" not in text and "50%" not in text
            for text in aligned_texts
        )
        assert all("big O of n squared" in text for text in aligned_texts)
        assert all("one thousand two hundred thirty four" in text for text in aligned_texts)
        assert all("fifty percent" in text for text in aligned_texts)
        narration_stage = next(
            item for item in completed.stages if item.stage is GenerationStage.NARRATION
        )
        result = coordinator.runtime.get_job(narration_stage.job_id).result
        assert result is not None
        assert all(
            item["spokenText"] in media_client.narration_texts
            and item["authoredText"] != item["spokenText"]
            and item["spokenWordCount"] > item["authoredWordCount"]
            for item in result["payload"]["narration"]
        )
        assert all(
            item["alignment"]["source"] == "forced-alignment"
            for item in result["payload"]["narration"]
        )
    finally:
        store.close()


def test_non_english_native_timing_route_preserves_provider_narration(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Spanish", name="Spanish")
    media_client = _RecordingNativeMediaClient()
    try:
        coordinator = GenerationCoordinator(store, media_client=media_client)
        configured = replace(
            request(),
            topic="Comparar O(n^2) con 1,234 operaciones",
            locale="es-ES",
            duration_seconds=60,
        )
        generation_id = coordinator.start(configured).generation_id
        coordinator.run_pending()
        coordinator.approve(generation_id)
        completed = coordinator.run_pending()
        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        assert media_client.narration_texts
        assert all(
            "O(n^2)" in text and "1,234" in text for text in media_client.narration_texts
        )
    finally:
        store.close()


def test_invalid_deferred_aligner_fails_narration_job_instead_of_stalling_queue(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime_root = tmp_path / "invalid-aligner"
    config = _invalid_alignment_config(runtime_root)
    monkeypatch.setenv("ALYSTRIA_FORCED_ALIGNER_CONFIG_PATH", str(config))
    store = ProjectStore.create(tmp_path / "Deferred failure", name="Deferred failure")
    try:
        alignment_client = _configured_forced_aligner(store)
        assert alignment_client is not None
        coordinator = GenerationCoordinator(
            store,
            media_client=_UntimedMediaClient(),
            alignment_client=alignment_client,
        )
        generation_id = coordinator.start(request()).generation_id
        waiting = coordinator.run_pending()
        assert waiting is not None and waiting.state is GenerationState.WAITING_APPROVAL
        coordinator.approve(generation_id)

        failed = coordinator.run_pending()

        assert failed is not None and failed.state is GenerationState.FAILED
        narration = next(
            stage for stage in failed.stages if stage.stage is GenerationStage.NARRATION
        )
        assert narration.state == "FAILED"
        assert narration.error is not None
        assert narration.error["exceptionType"] == "ForcedAlignmentError"
        assert "worker pin is invalid" in narration.error["message"]
    finally:
        store.close()


def _invalid_alignment_config(root: Path) -> Path:
    root.mkdir()
    entries: dict[str, dict[str, str]] = {}
    for key, relative in (
        ("python", "python.exe"),
        ("worker", "worker.py"),
        ("model", "model.onnx"),
        ("vocab", "vocab.json"),
    ):
        path = root / relative
        path.write_bytes(key.encode())
        entries[key] = {
            "relativePath": relative,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
    entries["worker"]["sha256"] = "0" * 64
    config = root / "alignment-runtime.json"
    config.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "runtimeRoot": str(root),
                "timeoutSeconds": 60,
                **entries,
            }
        ),
        encoding="utf-8",
    )
    return config


def open_coordinator(tmp_path: Path) -> tuple[ProjectStore, GenerationCoordinator]:
    store = ProjectStore.create(tmp_path / "Tutorial Project", name="Tutorial Project")
    return store, GenerationCoordinator(store)


def test_missing_optional_presenter_config_preserves_media_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, _ = open_coordinator(tmp_path)
    media_client = DeterministicMediaClient()
    try:
        monkeypatch.setenv(
            "ALYSTRIA_LOCAL_PRESENTER_CONFIG_PATH",
            str(tmp_path / "Models" / "presenter-runtime.json"),
        )
        assert _configured_local_presenter(store, media_client) is media_client
    finally:
        store.close()


def test_presenter_direction_uses_only_explicit_semantic_placements() -> None:
    assert _presenter_direction({}).placement is PresenterPlacement.PICTURE_IN_PICTURE
    assert _presenter_direction({"presenterPlacement": "full_frame"}).placement is PresenterPlacement.FULL_FRAME
    assert _presenter_direction({"presenterPlacement": "picture-in-picture"}).placement is PresenterPlacement.PICTURE_IN_PICTURE
    assert _presenter_direction({"presenterPlacement": "left"}).placement is PresenterPlacement.LEFT
    assert _presenter_direction({"presenterPlacement": "split-left"}).placement is PresenterPlacement.LEFT
    assert _presenter_direction({"presenterPlacement": "split_left"}).placement is PresenterPlacement.LEFT
    assert _presenter_direction({"presenterPlacement": "right"}).placement is PresenterPlacement.RIGHT
    assert _presenter_direction({"presenterPlacement": "split-right"}).placement is PresenterPlacement.RIGHT
    assert _presenter_direction({"presenterPlacement": "split_right"}).placement is PresenterPlacement.RIGHT
    assert _presenter_fit({"presenterFit": "contain"}) == "contain"
    with pytest.raises(ValueError, match="Unsupported presenter placement"):
        _presenter_direction({"presenterPlacement": "arbitrary-filter-coordinate"})
    with pytest.raises(ValueError, match="Unsupported presenter placement"):
        _presenter_direction({"presenterPlacement": "split-center"})
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
        assert completed.output_path is not None
        assert Path(completed.output_path).is_file()
        assert completed.output_media_type == "application/vnd.alystria.render+json"
        assert completed.video_artifact_hash is not None
        assert store.cas.verify(completed.video_artifact_hash)

        export = next(item for item in completed.stages if item.stage is GenerationStage.EXPORT)
        export_job = coordinator.runtime.get_job(export.job_id)
        assert export_job.result is not None
        manifest = export_job.result["payload"]["exportManifest"]
        assert manifest["title"] == "Binary search invariants"
        assert manifest["qualityGate"]["status"] == "PASS"
        assert manifest["files"][0]["path"] == completed.output_path
        assert manifest["files"][0]["mediaType"] == completed.output_media_type
        assert {item["role"] for item in manifest["files"]} == {
            "video",
            "captions",
            "captions-srt",
            "transcript",
        }
        rendered_review = export_job.result["payload"]["renderedFrameReview"]
        assert rendered_review["status"] == "not_reviewed"
        assert rendered_review["reason"] == "no_explicit_vlm_route"
        assert rendered_review["generationId"] == completed.generation_id
        assert rendered_review["renderArtifactHash"] == completed.video_artifact_hash
        head = store.head_revision()
        assert head is not None
        assert head.snapshot["renderedFrameReview"] == rendered_review

        generation_revisions = [
            revision
            for revision in store.list_revisions(limit=100)
            if revision.snapshot.get("generationId") == completed.generation_id
        ]
        assert len(generation_revisions) == len(ALL_STAGES) + 2
        assert all(
            revision.snapshot.get("stageArtifactHash")
            for revision in generation_revisions
            if revision.kind == "generation"
        )
        assert all(revision.snapshot["name"] == "Tutorial Project" for revision in generation_revisions)
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


def test_retry_rechecks_final_qa_after_policy_only_export_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, coordinator = open_coordinator(tmp_path)
    original_quality_gates = coordinator.workflow._candidate_quality_gates

    def obsolete_policy_gate(
        candidate: dict[str, Any],
        approved: dict[str, Any],
        generation_request: GenerationRequest,
    ) -> tuple[QualityGate, ...]:
        return (
            *original_quality_gates(candidate, approved, generation_request),
            QualityGate.from_findings(
                "generation.obsolete_local_policy",
                "policy",
                (
                    Finding(
                        "policy.obsolete_local_rule",
                        "An obsolete local policy blocks this otherwise valid export.",
                        Severity.MAJOR,
                        "render:master",
                    ),
                ),
            ),
        )

    monkeypatch.setattr(
        coordinator.workflow,
        "_candidate_quality_gates",
        obsolete_policy_gate,
    )
    try:
        generation_id = coordinator.start(request()).generation_id
        coordinator.run_pending()
        coordinator.approve(generation_id)
        failed = coordinator.run_pending()
        assert failed is not None and failed.state is GenerationState.FAILED

        old_qa_stage = next(
            stage for stage in failed.stages if stage.stage is GenerationStage.QA_FINAL
        )
        old_qa_job = coordinator.runtime.get_job(old_qa_stage.job_id)
        assert old_qa_job.result is not None
        old_qa_artifact_hash = str(old_qa_job.result["artifactHash"])
        old_qa_revision_id = str(old_qa_job.result["revisionId"])
        assert old_qa_job.result["payload"]["passed"] is False
        assert store.cas.verify(old_qa_artifact_hash)

        # Simulate retrying after installing a local policy/code update. The
        # immutable render remains valid, but the old QA decision does not.
        monkeypatch.setattr(
            coordinator.workflow,
            "_candidate_quality_gates",
            original_quality_gates,
        )
        retried = coordinator.retry(generation_id)
        assert retried.state is GenerationState.QUEUED

        completed = coordinator.run_pending()
        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        new_qa_stage = next(
            stage for stage in completed.stages if stage.stage is GenerationStage.QA_FINAL
        )
        new_qa_job = coordinator.runtime.get_job(new_qa_stage.job_id)
        assert new_qa_job.result is not None
        assert new_qa_job.attempt_count == old_qa_job.attempt_count + 1
        assert new_qa_job.result["payload"]["passed"] is True
        assert new_qa_job.result["artifactHash"] != old_qa_artifact_hash

        # Stage artifacts and revisions are immutable history even though the
        # durable job advances to a fresh attempt and result pointer.
        assert store.cas.verify(old_qa_artifact_hash)
        revisions = {
            revision.revision_id: revision
            for revision in store.list_revisions(limit=100)
        }
        assert revisions[old_qa_revision_id].snapshot["stageArtifactHash"] == old_qa_artifact_hash
        assert new_qa_job.result["revisionId"] in revisions
    finally:
        store.close()


def test_retry_does_not_recompute_qa_for_non_policy_export_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, coordinator = open_coordinator(tmp_path)
    original_export = coordinator.workflow._export

    def fail_export_write(*_: Any, **__: Any) -> dict[str, Any]:
        raise OSError("injected export filesystem failure")

    monkeypatch.setattr(coordinator.workflow, "_export", fail_export_write)
    try:
        generation_id = coordinator.start(request()).generation_id
        coordinator.run_pending()
        coordinator.approve(generation_id)
        failed = coordinator.run_pending()
        assert failed is not None and failed.state is GenerationState.FAILED
        qa_stage = next(
            stage for stage in failed.stages if stage.stage is GenerationStage.QA_FINAL
        )
        qa_before = coordinator.runtime.get_job(qa_stage.job_id)
        assert qa_before.result is not None
        assert qa_before.result["payload"]["passed"] is True

        monkeypatch.setattr(coordinator.workflow, "_export", original_export)
        coordinator.retry(generation_id)
        completed = coordinator.run_pending()
        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        qa_after = coordinator.runtime.get_job(qa_stage.job_id)
        assert qa_after.attempt_count == qa_before.attempt_count
        assert qa_after.result == qa_before.result
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
        scene_asset = coordinator.invalidate_scope(generation_id, f"scene-asset:{scene_id}")
        assert any(f"scene:{scene_id}:asset" in item for item in scene_asset)
        assert not any(f"scene:{scene_id}:narration" in item for item in scene_asset)
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


class RecordingMediaClient(DeterministicMediaClient):
    def __init__(self) -> None:
        self.visual_scene_ids: list[str] = []
        self.narration_scenes: list[dict[str, Any]] = []

    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        self.visual_scene_ids.append(str(scene["id"]))
        return super().create_visual(scene, seed=seed)

    def synthesize_narration(
        self, scene: dict[str, Any], *, locale: str, seed: int
    ) -> GeneratedMedia:
        self.narration_scenes.append(copy.deepcopy(scene))
        return super().synthesize_narration(scene, locale=locale, seed=seed)


class PacingRecoveryMediaClient(RecordingMediaClient):
    def synthesize_narration(
        self, scene: dict[str, Any], *, locale: str, seed: int
    ) -> GeneratedMedia:
        output = super().synthesize_narration(scene, locale=locale, seed=seed)
        duration_ms = 35_000 if "reviewed pacing" in str(scene["narration"]) else 30_000
        tokens = str(scene["narration"]).split()
        return replace(
            output,
            metadata={
                **output.metadata,
                "durationMs": duration_ms,
                "wordTimings": [
                    {
                        "word": token,
                        "startMs": round(index * duration_ms / len(tokens)),
                        "endMs": round((index + 1) * duration_ms / len(tokens)),
                    }
                    for index, token in enumerate(tokens)
                ],
            },
        )


def pacing_recovery_request() -> GenerationRequest:
    fixture_scenes = [
        {
            "id": f"paced-scene-{index}",
            "type": "definition",
            "title": f"Pacing scene {index}",
            "narration": f"Initial narration for pacing scene {index}.",
            "visualIntent": f"Explain pacing scene {index}.",
            "claimIds": [],
            "objectiveIds": ["objective.pacing"],
        }
        for index in range(5)
    ]
    return replace(
        request(),
        presenter_mode="off",
        objectives=(
            ObjectiveSpec(
                "objective.pacing",
                "Explain how measured narration pacing matches the tutorial timeline.",
            ),
        ),
        metadata={"canonicalFixtureScenes": fixture_scenes},
    )


def test_failed_measured_pacing_can_freeze_a_new_reviewed_approval_branch(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ALYSTRIA_MEDIA_MODE", "production")
    store = ProjectStore.create(tmp_path / "Pacing recovery", name="Pacing recovery")
    media = PacingRecoveryMediaClient()
    renderer = RecordingRenderer()
    coordinator = GenerationCoordinator(store, media_client=media, renderer_client=renderer)
    try:
        generation_id = coordinator.start(pacing_recovery_request()).generation_id
        coordinator.run_pending()
        generated_head = store.head_revision()
        assert generated_head is not None
        first_approval = coordinator.approve(
            generation_id,
            expected_head_revision_id=generated_head.revision_id,
        )
        old_approval_id = first_approval.approval_revision_id
        assert old_approval_id is not None
        old_approval_snapshot = copy.deepcopy(store.get_revision(old_approval_id).snapshot)

        failed = coordinator.run_pending()
        assert failed is not None and failed.state is GenerationState.FAILED
        failed_narration = next(
            item for item in failed.stages if item.stage is GenerationStage.NARRATION
        )
        assert failed_narration.error is not None
        assert "leaves 30000 ms unvoiced" in str(failed_narration.error["message"])

        failed_head = store.head_revision()
        assert failed_head is not None
        reviewed_snapshot = copy.deepcopy(failed_head.snapshot)
        for scene in reviewed_snapshot["payload"]["storyboard"]["scenes"]:
            scene["narration"] = f"{scene['narration']} reviewed pacing"
        reviewed = store.create_revision(
            snapshot=reviewed_snapshot,
            expected_head=failed_head.revision_id,
            message="Revise narration after measured pacing failure",
        )

        reapproved = coordinator.approve(
            generation_id,
            expected_head_revision_id=reviewed.revision_id,
        )
        assert reapproved.approval_revision_id not in {None, old_approval_id}
        new_approval = store.get_revision(str(reapproved.approval_revision_id))
        assert new_approval.snapshot["payload"]["approval"][
            "supersedesApprovalRevisionId"
        ] == old_approval_id
        assert store.get_revision(old_approval_id).snapshot == old_approval_snapshot

        old_post_jobs = [
            job
            for job in coordinator._jobs(generation_id)
            if job.parameters.get("approvalRevisionId") == old_approval_id
        ]
        assert old_post_jobs
        assert all(job.state is JobState.STALE for job in old_post_jobs)
        new_post_jobs = [
            job
            for job in coordinator._jobs(generation_id)
            if job.parameters.get("approvalRevisionId") == new_approval.revision_id
        ]
        assert len(new_post_jobs) == len(old_post_jobs)
        assert {str(job.parameters["stage"]) for job in new_post_jobs} == {
            str(job.parameters["stage"]) for job in old_post_jobs
        }
        assert {job.task_key for job in new_post_jobs}.isdisjoint(
            {job.task_key for job in old_post_jobs}
        )

        completed = coordinator.run_pending()
        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        assert completed.approval_revision_id == new_approval.revision_id
        assert all(
            "reviewed pacing" in str(scene["narration"])
            for scene in media.narration_scenes[-5:]
        )
        assert renderer.requests
        assert all(
            "reviewed pacing" in str(scene["narration"])
            for scene in renderer.requests[-1]["scenes"]
        )

        reopened = ProjectStore.open(store.root)
        try:
            resumed = GenerationCoordinator(reopened)
            resumed_status = resumed.status(generation_id)
            assert resumed_status.state is GenerationState.SUCCEEDED
            assert resumed_status.approval_revision_id == new_approval.revision_id
            assert {stage.job_id for stage in resumed_status.stages}.isdisjoint(
                {job.job_id for job in old_post_jobs}
            )
            reopened_old_jobs = [
                job
                for job in resumed._jobs(generation_id)
                if job.parameters.get("approvalRevisionId") == old_approval_id
            ]
            assert len(reopened_old_jobs) == len(old_post_jobs)
            assert all(job.state is JobState.STALE for job in reopened_old_jobs)
        finally:
            reopened.close()
    finally:
        store.close()


def test_pacing_reapproval_refreshes_stale_job_snapshots_before_superseding(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ALYSTRIA_MEDIA_MODE", "production")
    store = ProjectStore.create(tmp_path / "Pacing race", name="Pacing race")
    coordinator = GenerationCoordinator(store, media_client=PacingRecoveryMediaClient())
    try:
        generation_id = coordinator.start(pacing_recovery_request()).generation_id
        coordinator.run_pending()
        head = store.head_revision()
        assert head is not None
        approved = coordinator.approve(
            generation_id,
            expected_head_revision_id=head.revision_id,
        )
        approval_revision_id = approved.approval_revision_id
        assert approval_revision_id is not None
        failed = coordinator.run_pending()
        assert failed is not None and failed.state is GenerationState.FAILED

        stale_job_snapshots = coordinator._jobs(generation_id)
        failed_narration = next(
            job
            for job in stale_job_snapshots
            if job.parameters.get("approvalRevisionId") == approval_revision_id
            and job.parameters.get("stage") == GenerationStage.NARRATION.value
        )
        assert failed_narration.state is JobState.FAILED
        previous_payload = copy.deepcopy(
            store.get_revision(approval_revision_id).snapshot["payload"]
        )
        reviewed_payload = copy.deepcopy(previous_payload)
        reviewed_payload["storyboard"]["scenes"][0]["narration"] += " reviewed pacing"

        retried = coordinator.runtime.retry(failed_narration.job_id)
        assert retried.state is JobState.QUEUED
        with pytest.raises(ApprovalNotReadyError, match="media work is active"):
            _prepare_narration_pacing_reapproval(
                coordinator.runtime,
                stale_job_snapshots,
                approval_revision_id=approval_revision_id,
                previous_payload=previous_payload,
                reviewed_payload=reviewed_payload,
            )
        assert coordinator.runtime.get_job(failed_narration.job_id).state is JobState.QUEUED
        assert not any(
            job.state is JobState.STALE
            for job in coordinator._jobs(generation_id)
            if job.parameters.get("approvalRevisionId") == approval_revision_id
        )
    finally:
        store.close()


def test_reviewed_narration_cannot_branch_while_media_work_is_active(
    tmp_path: Path,
) -> None:
    store, coordinator = open_coordinator(tmp_path)
    try:
        generation_id = coordinator.start(request()).generation_id
        coordinator.run_pending()
        generated_head = store.head_revision()
        assert generated_head is not None
        approved = coordinator.approve(
            generation_id,
            expected_head_revision_id=generated_head.revision_id,
        )
        assert approved.state is GenerationState.QUEUED
        approval_revision_id = approved.approval_revision_id
        assert approval_revision_id is not None
        total_jobs_before = len(coordinator._jobs(generation_id))
        post_jobs_before = [
            job
            for job in coordinator._jobs(generation_id)
            if job.parameters.get("approvalRevisionId") == approval_revision_id
        ]
        assert any(job.state in {JobState.READY, JobState.BLOCKED} for job in post_jobs_before)

        approval_head = store.head_revision()
        assert approval_head is not None
        reviewed_snapshot = copy.deepcopy(approval_head.snapshot)
        reviewed_snapshot["payload"]["storyboard"]["scenes"][0]["narration"] = (
            "A changed narration must wait until the current media branch is terminal."
        )
        reviewed = store.create_revision(
            snapshot=reviewed_snapshot,
            expected_head=approval_head.revision_id,
            message="Attempt narration edit while media is active",
        )

        with pytest.raises(ApprovalNotReadyError, match="media work is active"):
            coordinator.approve(
                generation_id,
                expected_head_revision_id=reviewed.revision_id,
            )
        approval_revisions = [
            revision
            for revision in store.list_revisions(limit=100)
            if revision.kind == "approval"
            and revision.snapshot.get("generationId") == generation_id
        ]
        assert [revision.revision_id for revision in approval_revisions] == [
            approval_revision_id
        ]
        assert len(coordinator._jobs(generation_id)) == total_jobs_before
    finally:
        store.close()


def test_approval_freezes_reviewed_scene_prose_for_narration_and_render(
    tmp_path: Path,
) -> None:
    store = ProjectStore.create(tmp_path / "Reviewed storyboard", name="Reviewed storyboard")
    media = RecordingMediaClient()
    renderer = RecordingRenderer()
    coordinator = GenerationCoordinator(store, media_client=media, renderer_client=renderer)
    try:
        generation_id = coordinator.start(request()).generation_id
        waiting = coordinator.run_pending()
        assert waiting is not None and waiting.state is GenerationState.WAITING_APPROVAL
        approval_job = next(
            coordinator.runtime.get_job(item.job_id)
            for item in waiting.stages
            if item.stage is GenerationStage.APPROVAL
        )
        assert approval_job.result is not None
        original_payload = copy.deepcopy(approval_job.result["payload"])
        scene_id = original_payload["storyboard"]["scenes"][0]["id"]

        head = store.head_revision()
        assert head is not None
        reviewed_snapshot = copy.deepcopy(head.snapshot)
        reviewed_scene = reviewed_snapshot["payload"]["storyboard"]["scenes"][0]
        reviewed_scene.update(
            {
                "title": "A reviewed invariant",
                "narration": "The reviewed narration reaches the speech provider exactly.",
                "visualIntent": "Show the reviewed learning objective as an interval invariant.",
            }
        )
        reviewed = store.create_revision(
            snapshot=reviewed_snapshot,
            expected_head=head.revision_id,
            message="Review scene prose before approval",
        )

        approved = coordinator.approve(
            generation_id,
            expected_head_revision_id=reviewed.revision_id,
        )
        assert approved.approval_revision_id is not None
        approval_revision = store.get_revision(approved.approval_revision_id)
        frozen_scene = approval_revision.snapshot["payload"]["storyboard"]["scenes"][0]
        assert frozen_scene["id"] == scene_id
        assert frozen_scene["title"] == "A reviewed invariant"
        assert frozen_scene["narration"] == (
            "The reviewed narration reaches the speech provider exactly."
        )
        assert frozen_scene["visualIntent"] == (
            "Show the reviewed learning objective as an interval invariant."
        )
        assert approval_revision.snapshot["payload"]["approval"]["reviewedRevisionId"] == (
            reviewed.revision_id
        )
        assert approval_job.result["payload"] == original_payload

        completed = coordinator.run_pending()
        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        spoken = next(scene for scene in media.narration_scenes if scene["id"] == scene_id)
        assert spoken["narration"] == frozen_scene["narration"]
        rendered = next(scene for scene in renderer.requests[0]["scenes"] if scene["id"] == scene_id)
        assert rendered["title"] == frozen_scene["title"]
        assert rendered["narration"] == frozen_scene["narration"]
        assert rendered["visualIntent"] == frozen_scene["visualIntent"]
    finally:
        store.close()


def test_approval_rejects_a_stale_review_revision(tmp_path: Path) -> None:
    store, coordinator = open_coordinator(tmp_path)
    try:
        generation_id = coordinator.start(request()).generation_id
        coordinator.run_pending()
        stale = store.head_revision()
        assert stale is not None
        store.create_revision(
            snapshot=copy.deepcopy(stale.snapshot),
            expected_head=stale.revision_id,
            message="Advance the reviewed head",
        )

        with pytest.raises(RevisionConflictError, match="Expected head"):
            coordinator.approve(
                generation_id,
                expected_head_revision_id=stale.revision_id,
            )
    finally:
        store.close()


def test_approval_rejects_mismatched_or_structurally_modified_scenes(tmp_path: Path) -> None:
    store, coordinator = open_coordinator(tmp_path)
    try:
        generation_id = coordinator.start(request()).generation_id
        coordinator.run_pending()
        head = store.head_revision()
        assert head is not None

        mismatched = copy.deepcopy(head.snapshot)
        mismatched["payload"]["storyboard"]["scenes"][0]["id"] = "placeholder-scene"
        mismatch_revision = store.create_revision(
            snapshot=mismatched,
            expected_head=head.revision_id,
            message="Invalid placeholder scene",
        )
        with pytest.raises(ApprovalNotReadyError, match="scene identities"):
            coordinator.approve(
                generation_id,
                expected_head_revision_id=mismatch_revision.revision_id,
            )

        restored = store.restore(head.revision_id, message="Restore generated storyboard")
        structurally_changed = copy.deepcopy(restored.snapshot)
        structurally_changed["payload"]["storyboard"]["scenes"][0]["durationTicks"] += 1
        changed_revision = store.create_revision(
            snapshot=structurally_changed,
            expected_head=restored.revision_id,
            message="Invalid structural edit",
        )
        with pytest.raises(ApprovalNotReadyError, match="outside prose"):
            coordinator.approve(
                generation_id,
                expected_head_revision_id=changed_revision.revision_id,
            )
    finally:
        store.close()


def test_accepted_scene_visual_is_reused_by_generation_and_renderer(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Accepted visual", name="Accepted visual")
    media = RecordingMediaClient()
    renderer = RecordingRenderer()
    coordinator = GenerationCoordinator(store, media_client=media, renderer_client=renderer)
    try:
        generation_id = coordinator.start(request()).generation_id
        waiting = coordinator.run_pending()
        assert waiting is not None and waiting.state is GenerationState.WAITING_APPROVAL
        approval_job = next(
            coordinator.runtime.get_job(item.job_id)
            for item in waiting.stages
            if item.stage is GenerationStage.APPROVAL
        )
        assert approval_job.result is not None
        storyboard = approval_job.result["payload"]["storyboard"]
        selected_scene = storyboard["scenes"][0]

        selected_bytes = b"\x89PNG\r\n\x1a\naccepted-project-visual"
        artifact = store.add_artifact_bytes(
            selected_bytes,
            media_type="image/png",
            original_name="accepted.png",
            metadata={
                "rightsStatus": "owned",
                "licenseId": "USER-OWNED",
                "provider": "test-accepted-visual",
                "modelRevision": "1",
            },
        )
        asset_id = "asset-accepted-scene"
        provenance_id = "provenance-accepted-scene"
        head = store.head_revision()
        assert head is not None
        snapshot = copy.deepcopy(head.snapshot)
        snapshot["scenes"] = [
            {
                **selected_scene,
                "visualAssetId": asset_id,
                "visualArtifactHash": artifact.hash,
            }
        ]
        snapshot["mediaAssets"] = [
            {
                "id": asset_id,
                "artifactHash": artifact.hash,
                "mediaType": "image/png",
                "state": "promoted",
                "provenanceId": provenance_id,
            }
        ]
        snapshot["assetProvenance"] = [
            {
                "id": provenance_id,
                "assetId": asset_id,
                "exportEligible": True,
                "blockers": [],
            }
        ]
        store.create_revision(
            snapshot=snapshot,
            expected_head=head.revision_id,
            message="Accept a generated scene visual",
        )

        coordinator.approve(generation_id)
        completed = coordinator.run_pending()
        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        assert str(selected_scene["id"]) not in media.visual_scene_ids

        assets_job = next(
            coordinator.runtime.get_job(item.job_id)
            for item in completed.stages
            if item.stage is GenerationStage.ASSETS
        )
        assert assets_job.result is not None
        selected = next(
            item
            for item in assets_job.result["payload"]["assets"]
            if item["sceneId"] == selected_scene["id"]
        )
        assert selected["artifactHash"] == artifact.hash
        assert selected["provider"] == "accepted-project-asset"
        assert renderer.requests[0]["assets"][0]["artifactHash"] == artifact.hash
    finally:
        store.close()


def test_authored_only_generation_never_calls_an_image_provider(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Authored only", name="Authored only")
    media = RecordingMediaClient()
    renderer = RecordingRenderer()
    coordinator = GenerationCoordinator(store, media_client=media, renderer_client=renderer)
    try:
        authored_request = replace(
            request(),
            presenter_mode="off",
            metadata={"sceneVisualGeneration": "authored-only"},
        )
        generation_id = coordinator.start(authored_request).generation_id
        coordinator.run_pending()
        coordinator.approve(generation_id)
        completed = coordinator.run_pending()

        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        assert media.visual_scene_ids == []
        assets_job = next(
            coordinator.runtime.get_job(item.job_id)
            for item in completed.stages
            if item.stage is GenerationStage.ASSETS
        )
        assert assets_job.result is not None
        assert assets_job.result["payload"]["visualGenerationMode"] == "authored-only"
        assert assets_job.result["payload"]["assets"] == []
        assert renderer.requests[0]["assets"] == []
        assert renderer.requests[0]["scenes"]
    finally:
        store.close()


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
        assert len(sent["presenters"]) == 1
        assert sent["presenters"][0]["sceneId"] == sent["scenes"][0]["id"]
        assert sent["presenters"][0]["activeDurationTicks"] == min(
            sent["scenes"][0]["durationTicks"],
            sent["narration"][0]["durationMs"] * 240,
        )
    finally:
        store.close()


def test_presenter_on_generates_only_for_compatible_scene_layouts(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Tutorial Project", name="Tutorial Project")
    renderer = RecordingRenderer()
    coordinator = GenerationCoordinator(store, renderer_client=renderer)
    try:
        generation_id = coordinator.start(
            replace(request(), presenter_mode="on")
        ).generation_id
        coordinator.run_pending()
        coordinator.approve(generation_id)
        completed = coordinator.run_pending()
        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        sent = renderer.requests[0]
        presenter_scene_ids = {
            scene["id"]
            for scene in sent["scenes"]
            if scene["type"] in {"presenter", "presenter-slide", "presenter-with-slide"}
        }
        assert {item["sceneId"] for item in sent["presenters"]} == presenter_scene_ids
        assert len(sent["presenters"]) == 1
    finally:
        store.close()


def test_render_compatibility_ignores_only_known_non_presenter_bindings() -> None:
    scenes = [
        {"id": "intro", "type": "presenter-slide"},
        {"id": "diagram", "type": "diagram"},
    ]
    bindings = [
        {"sceneId": "intro", "artifactHash": "a" * 64},
        {"sceneId": "diagram", "artifactHash": "b" * 64},
        {"sceneId": "unknown", "artifactHash": "c" * 64},
    ]
    assert _presenters_for_render(scenes, bindings) == [bindings[0], bindings[2]]


def test_render_compatibility_clamps_legacy_binding_to_probed_video_duration(
    tmp_path: Path,
) -> None:
    store = ProjectStore.create(tmp_path / "Tutorial Project", name="Tutorial Project")
    try:
        artifact = store.add_artifact_bytes(
            b"presenter-fixture",
            media_type="video/mp4",
            original_name="presenter.mp4",
            metadata={"probe": {"durationSeconds": 1.25}},
        )
        bindings = [
            {
                "sceneId": "intro",
                "artifactHash": artifact.hash,
                "activeDurationTicks": 2 * 240_000,
            }
        ]
        result = _presenters_for_render(
            [{"id": "intro", "type": "presenter-slide"}],
            bindings,
            store=store,
        )
        assert result[0]["activeDurationTicks"] == 300_000
    finally:
        store.close()


def test_split_presenter_placement_preserves_storyboard_and_provider_semantics(
    tmp_path: Path,
) -> None:
    store = ProjectStore.create(tmp_path / "Tutorial Project", name="Tutorial Project")
    renderer = RecordingRenderer()
    coordinator = GenerationCoordinator(store, renderer_client=renderer)
    configured = replace(
        request(),
        metadata={
            "visualCustomization": {
                "presenter": {"placement": "split-left", "fit": "contain"}
            }
        },
    )
    try:
        generation_id = coordinator.start(configured).generation_id
        coordinator.run_pending()
        coordinator.approve(generation_id)
        completed = coordinator.run_pending()

        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        assert len(renderer.requests) == 1
        sent = renderer.requests[0]
        assert sent["scenes"][0]["presenterPlacement"] == "split-left"
        assert sent["presenters"][0]["direction"]["placement"] == "left"
        assert sent["presenters"][0]["fit"] == "contain"
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


def test_desktop_flagship_identity_loads_the_bundled_karatsuba_contract(
    tmp_path: Path,
) -> None:
    store, coordinator = open_coordinator(tmp_path)
    try:
        store.create_revision(
            snapshot={
                "brief": {
                    "topic": "Create the canonical 12-minute Karatsuba tutorial",
                    "audience": "Undergraduate algorithms students",
                    "durationSeconds": 720,
                    "locale": "en-US",
                },
                "canonicalFixtureId": "fixture.karatsuba.undergraduate.en",
                "groundingMode": "strict",
                "sources": [],
            },
            kind="edit",
        )
        converted = request_from_desktop(
            store,
            {
                "quality": "studio",
                "privacy": "hybrid",
                "approvedProviderIds": ["nvidia-nim", "local-runtime"],
                "budget": {
                    "currency": "USD",
                    "hardLimitMinorUnits": 100,
                    "requireKnownPricing": True,
                },
            },
        )

        scenes = converted.metadata["canonicalFixtureScenes"]
        assert converted.topic == "Karatsuba Multiplication: Three Products Instead of Four"
        assert converted.duration_seconds == 720
        assert len(scenes) == 13
        assert all(len(scene["onScreenText"]) >= 3 for scene in scenes)
        assert all(scene["visualBeat"]["schemaVersion"] == 1 for scene in scenes)
        assert scenes[1]["visualBeat"]["focalAnchor"] == "base-b-split-axis"
        assert scenes[8]["visualBeat"]["informationUnits"][-1]["text"] == (
            "1234 \N{MULTIPLICATION SIGN} 5678 = 7,006,652"
        )
        assert sum(len(scene["narration"].split()) for scene in scenes) >= 1_600
        assert converted.output_targets == (
            {"name": "landscape", "width": 1920, "height": 1080, "fps": 30},
            {"name": "portrait", "width": 1080, "height": 1920, "fps": 30},
            {"name": "square", "width": 1080, "height": 1080, "fps": 30},
        )
        assert converted.presenter_mode == "off"
        assert converted.metadata["fixtureId"] == "fixture.karatsuba.undergraduate.en"
        assert converted.metadata["quality"] == "studio"
        generation_id = coordinator.start(converted).generation_id
        waiting = coordinator.run_pending()
        assert waiting is not None and waiting.state is GenerationState.WAITING_APPROVAL
        storyboard_job = next(
            job
            for job in coordinator._jobs(generation_id)
            if job.parameters["stage"] == GenerationStage.STORYBOARD.value
        )
        assert storyboard_job.result is not None
        storyboard = storyboard_job.result["payload"]["storyboard"]
        assert storyboard["scenes"][0]["type"] == "title"
        assert storyboard["scenes"][1]["type"] == "definition"
        assert all("visualBeat" in scene for scene in storyboard["scenes"])
        assert all("onScreenText" in scene for scene in storyboard["scenes"])
        assert storyboard["scenes"][1]["onScreenText"] == scenes[1]["onScreenText"]
        assert storyboard["scenes"][1]["visualBeat"] == scenes[1]["visualBeat"]
    finally:
        store.close()


def test_desktop_recovers_flagship_identity_from_a_legacy_exact_topic(
    tmp_path: Path,
) -> None:
    store, _ = open_coordinator(tmp_path)
    try:
        store.create_revision(
            snapshot={
                "brief": {
                    "topic": (
                        "Create the canonical 12-minute Karatsuba multiplication tutorial: "
                        "derive the three-multiplication method rigorously, work through "
                        "1234 \u00d7 5678, compare O(n^log2 3) with grade-school O(n²), "
                        "and include retrieval practice plus a recap."
                    ),
                    "audience": "Undergraduate students",
                    "durationSeconds": 720,
                    "locale": "en-US",
                },
                "groundingMode": "creative",
                "sources": [],
            },
            kind="edit",
        )

        converted = request_from_desktop(
            store,
            {
                "quality": "studio",
                "privacy": "hybrid",
                "approvedProviderIds": ["nvidia-nim", "local-runtime"],
                "budget": {
                    "currency": "USD",
                    "hardLimitMinorUnits": 0,
                    "requireKnownPricing": True,
                },
            },
        )

        assert converted.metadata["fixtureId"] == "fixture.karatsuba.undergraduate.en"
        assert len(converted.metadata["canonicalFixtureScenes"]) == 13
        assert converted.duration_seconds == 720
    finally:
        store.close()


def test_desktop_does_not_replace_an_ordinary_karatsuba_topic_with_the_flagship(
    tmp_path: Path,
) -> None:
    store, _ = open_coordinator(tmp_path)
    try:
        store.create_revision(
            snapshot={
                "brief": {
                    "topic": "Explain why Karatsuba uses three products",
                    "audience": "Undergraduate students",
                    "durationSeconds": 300,
                    "locale": "en-US",
                },
                "groundingMode": "creative",
                "sources": [],
            },
            kind="edit",
        )

        converted = request_from_desktop(
            store,
            {
                "quality": "standard",
                "privacy": "hybrid",
                "approvedProviderIds": ["nvidia-nim", "local-runtime"],
                "budget": {
                    "currency": "USD",
                    "hardLimitMinorUnits": 0,
                    "requireKnownPricing": True,
                },
            },
        )

        assert converted.topic == "Explain why Karatsuba uses three products"
        assert "fixtureId" not in converted.metadata
        assert "canonicalFixtureScenes" not in converted.metadata
    finally:
        store.close()


@pytest.mark.parametrize("persisted_fixture_id", [False, True])
def test_desktop_duration_choice_overrides_legacy_flagship_identity(
    tmp_path: Path,
    persisted_fixture_id: bool,
) -> None:
    store, _ = open_coordinator(tmp_path)
    try:
        snapshot: dict[str, Any] = {
            "brief": {
                "topic": "Create the canonical 12-minute Karatsuba multiplication tutorial",
                "audience": "Undergraduate students",
                "durationSeconds": 180,
                "locale": "en-US",
            },
            "groundingMode": "creative",
            "sources": [],
        }
        if persisted_fixture_id:
            snapshot["canonicalFixtureId"] = "fixture.karatsuba.undergraduate.en"
        store.create_revision(snapshot=snapshot, kind="edit")

        converted = request_from_desktop(
            store,
            {
                "quality": "standard",
                "privacy": "hybrid",
                "approvedProviderIds": ["nvidia-nim", "local-runtime"],
                "budget": {
                    "currency": "USD",
                    "hardLimitMinorUnits": 0,
                    "requireKnownPricing": True,
                },
            },
        )

        assert converted.topic == "Create the canonical 12-minute Karatsuba multiplication tutorial"
        assert converted.duration_seconds == 180
        assert "fixtureId" not in converted.metadata
        assert "canonicalFixtureScenes" not in converted.metadata
    finally:
        store.close()
