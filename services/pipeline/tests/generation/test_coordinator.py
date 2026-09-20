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

import alystria.generation.workflow as generation_workflow
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
from alystria.generation.caption_bundle import CAPTION_COMPILER_VERSION
from alystria.generation.coordinator import _prepare_failed_media_reapproval
from alystria.generation.education_provider import StructuredWritingEducationalProvider
from alystria.generation.forced_alignment import AlignmentInput
from alystria.generation.workflow import (
    _apply_presenter_selection,
    _caption_alignment_quality_gate,
    _fingerprint,
    _presenter_direction,
    _presenter_fit,
    _presenters_for_render,
    _provider_neutral_word_timings,
    _web_research_query,
)
from alystria.jobs import JobState
from alystria.presenters import PresenterPlacement
from alystria.project import ProjectStore
from alystria.project.errors import RevisionConflictError
from alystria.providers import (
    FailureCode,
    ProviderFailure,
    ProviderResult,
    TextOutput,
    TextRequest,
    Usage,
)
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


class GroundedResearchTextClient:
    def __init__(self) -> None:
        self.requests: list[TextRequest] = []

    def generate(
        self, request: TextRequest, *, idempotency_key: str
    ) -> ProviderResult[TextOutput]:
        assert idempotency_key.startswith("education-web-research-")
        self.requests.append(request)
        return ProviderResult(
            "gemini",
            "gemini-2.5-flash-001",
            TextOutput(
                json.dumps(
                    {
                        "findings": [
                            {
                                "statement": "Binary search preserves a target-containing interval while halving its size.",
                                "teachingUse": "Explain why discarded halves are safe.",
                            }
                        ]
                    }
                ),
                citations=(
                    {
                        "url": "https://example.test/binary-search",
                        "title": "Binary search reference",
                    },
                ),
            ),
            Usage(
                "gemini",
                "gemini-2.5-flash",
                {"input_tokens": 90, "output_tokens": 55, "search_requests": 1},
                165,
                request_id="research-response-1",
            ),
            raw_id="research-response-1",
        )


class MalformedGroundedResearchTextClient:
    def __init__(self, text: str, citations: tuple[dict[str, str], ...]) -> None:
        self.text = text
        self.citations = citations
        self.requests: list[TextRequest] = []

    def generate(
        self, request: TextRequest, *, idempotency_key: str
    ) -> ProviderResult[TextOutput]:
        assert idempotency_key.startswith("education-web-research-")
        self.requests.append(request)
        return ProviderResult(
            "gemini",
            "gemini-2.5-flash-001",
            TextOutput(self.text, citations=self.citations),
            Usage(
                "gemini",
                "gemini-2.5-flash",
                {"input_tokens": 70, "output_tokens": 12, "search_requests": 1},
                91,
                request_id="malformed-research-response-1",
            ),
            raw_id="malformed-research-response-1",
        )


class NoCallResearchTextClient:
    def __init__(self) -> None:
        self.requests: list[TextRequest] = []

    def generate(
        self, request: TextRequest, *, idempotency_key: str
    ) -> ProviderResult[TextOutput]:
        self.requests.append(request)
        raise AssertionError("legacy normalized checkpoint must prevent a provider call")


def test_grounded_ingest_consumes_web_research_once_with_durable_usage(
    tmp_path: Path,
) -> None:
    store = ProjectStore.create(tmp_path / "Grounded research", name="Grounded research")
    client = GroundedResearchTextClient()
    coordinator = GenerationCoordinator(
        store,
        educational_provider=StructuredWritingEducationalProvider(
            client, model="writer-v1", research_model="gemini-2.5-flash"
        ),
    )
    try:
        generation_id = coordinator.start(
            GenerationRequest(
                topic="Binary search invariants",
                audience="Beginning computer-science learners",
                duration_seconds=60,
                grounding_mode=GroundingMode.GROUNDED,
            )
        ).generation_id
        ran = coordinator.runtime.run_once(coordinator.workflow.handlers)
        assert ran is not None
        assert len(client.requests) == 1

        ingest = next(
            job
            for job in coordinator._jobs(generation_id)
            if job.parameters["stage"] == GenerationStage.INGEST_RESEARCH.value
        )
        assert ingest.result is not None
        web_research = ingest.result["payload"]["webResearch"]
        assert web_research["providerId"] == "gemini"
        assert web_research["model"] == "gemini-2.5-flash"
        assert web_research["requestId"] == "research-response-1"
        assert web_research["resultCount"] == len(web_research["findings"]) == 1
        assert web_research["citationCount"] == len(web_research["citations"]) == 1
        assert web_research["provenanceScope"] == "response"
        assert json.loads(web_research["query"])["topic"] == "Binary search invariants"

        rows = store.connection.execute(
            "SELECT provider,model,unit,quantity,cost_micros,metadata_json FROM usage_records"
        ).fetchall()
        assert len(rows) == 1
        assert rows[0]["provider"] == "gemini"
        assert rows[0]["model"] == "gemini-2.5-flash"
        assert rows[0]["unit"] == "tokens"
        assert rows[0]["quantity"] == 145
        assert rows[0]["cost_micros"] == 165
        metadata = json.loads(str(rows[0]["metadata_json"]))
        assert metadata["incurred"] is True
        assert metadata["capability"] == "research.web"
        assert metadata["usageComplete"] is True
        assert metadata["searchRequests"] == 1
        assert metadata["providerRequestId"] == "research-response-1"
        checkpoint = store.connection.execute(
            "SELECT result_json FROM provider_acceptance_checkpoints WHERE job_id=?",
            (ingest.job_id,),
        ).fetchone()
        assert checkpoint is not None
        raw = json.loads(str(checkpoint["result_json"]))
        assert raw["kind"] == "web-research-raw-response"
        assert raw["requestId"] == "research-response-1"
        assert raw["rawTextTruncated"] is False
        assert "findings" not in raw
    finally:
        store.close()


@pytest.mark.parametrize(
    ("raw_text", "citations", "expect_citation_truncation"),
    (
        ("not valid research JSON", (), False),
        (
            json.dumps(
                {
                    "findings": [
                        {
                            "statement": "Binary search halves a sorted interval.",
                            "teachingUse": "Explain logarithmic narrowing.",
                        }
                    ]
                }
            ),
            (),
            False,
        ),
        (
            json.dumps(
                {
                    "findings": [
                        {
                            "statement": "Binary search halves a sorted interval.",
                            "teachingUse": "Explain logarithmic narrowing.",
                        }
                    ]
                }
            ),
            tuple({"blob": "x" * 4_000} for _ in range(20)),
            True,
        ),
    ),
)
def test_malformed_grounded_research_retry_reuses_raw_checkpoint_and_usage(
    tmp_path: Path,
    raw_text: str,
    citations: tuple[dict[str, str], ...],
    expect_citation_truncation: bool,
) -> None:
    store = ProjectStore.create(tmp_path / "Malformed research", name="Malformed research")
    client = MalformedGroundedResearchTextClient(raw_text, citations)
    coordinator = GenerationCoordinator(
        store,
        educational_provider=StructuredWritingEducationalProvider(
            client, model="writer-v1", research_model="gemini-2.5-flash"
        ),
    )
    try:
        generation_id = coordinator.start(
            GenerationRequest(
                topic="Binary search invariants",
                audience="Beginning computer-science learners",
                duration_seconds=60,
                grounding_mode=GroundingMode.GROUNDED,
            )
        ).generation_id

        first = coordinator.runtime.run_once(coordinator.workflow.handlers)
        assert first is not None and first.state is JobState.FAILED
        assert len(client.requests) == 1
        ingest = next(
            job
            for job in coordinator._jobs(generation_id)
            if job.parameters["stage"] == GenerationStage.INGEST_RESEARCH.value
        )
        checkpoint = coordinator.runtime.provider_acceptance(
            ingest.job_id,
            next(
                str(row["idempotency_key"])
                for row in store.connection.execute(
                    "SELECT idempotency_key FROM provider_acceptance_checkpoints WHERE job_id=?",
                    (ingest.job_id,),
                )
            ),
        )
        assert checkpoint is not None
        assert checkpoint["result"]["rawText"] == raw_text
        assert checkpoint["result"]["citationsTruncated"] is expect_citation_truncation
        assert (
            len(
                json.dumps(
                    checkpoint["result"]["citations"],
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode()
            )
            <= 65_536
        )
        first_usage = coordinator.runtime.usage_summary(ingest.job_id)
        assert first_usage.records == 1
        assert first_usage.total_cost_micros == 91

        coordinator.retry(generation_id)
        second = coordinator.runtime.run_once(coordinator.workflow.handlers)
        assert second is not None and second.state is JobState.FAILED
        assert len(client.requests) == 1
        second_usage = coordinator.runtime.usage_summary(ingest.job_id)
        assert second_usage.records == 1
        assert second_usage.total_cost_micros == 91
        assert (
            store.connection.execute(
                "SELECT COUNT(*) FROM provider_acceptance_checkpoints WHERE job_id=?",
                (ingest.job_id,),
            ).fetchone()[0]
            == 1
        )
    finally:
        store.close()


def test_grounded_ingest_reuses_legacy_normalized_checkpoint_without_provider_call(
    tmp_path: Path,
) -> None:
    store = ProjectStore.create(tmp_path / "Legacy research", name="Legacy research")
    client = NoCallResearchTextClient()
    coordinator = GenerationCoordinator(
        store,
        educational_provider=StructuredWritingEducationalProvider(
            client, model="writer-v1", research_model="gemini-2.5-flash"
        ),
    )
    request_value = GenerationRequest(
        topic="Binary search invariants",
        audience="Beginning computer-science learners",
        duration_seconds=60,
        grounding_mode=GroundingMode.GROUNDED,
    )
    try:
        generation_id = coordinator.start(request_value).generation_id
        ingest = next(
            job
            for job in coordinator._jobs(generation_id)
            if job.parameters["stage"] == GenerationStage.INGEST_RESEARCH.value
        )
        query = _web_research_query(request_value)
        research_key = f"education-web-research-{_fingerprint(query)[:32]}"
        legacy_result = {
            "providerId": "gemini",
            "model": "gemini-2.5-flash",
            "responseModel": "gemini-2.5-flash-001",
            "requestId": "legacy-research-response-1",
            "query": query,
            "resultCount": 1,
            "citationCount": 1,
            "provenanceScope": "response",
            "findings": [
                {
                    "statement": "Binary search halves a sorted interval.",
                    "teachingUse": "Explain logarithmic narrowing.",
                }
            ],
            "citations": [
                {
                    "url": "https://example.test/binary-search",
                    "title": "Binary search reference",
                }
            ],
        }
        coordinator.runtime.record_provider_acceptance(
            ingest.job_id,
            idempotency_key=research_key,
            provider="gemini",
            model="gemini-2.5-flash",
            provider_request_id="legacy-research-response-1",
            result=legacy_result,
            unit="tokens",
            quantity=145,
            cost_micros=165,
            usage_metadata={"kind": "web-research", "usageComplete": True},
        )

        ran = coordinator.runtime.run_once(coordinator.workflow.handlers)
        assert ran is not None and ran.state is JobState.SUCCEEDED
        assert client.requests == []
        assert ran.result is not None
        assert ran.result["payload"]["webResearch"] == legacy_result
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
        generation_id = coordinator.start(request()).generation_id
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

        render_stage = next(item for item in completed.stages if item.stage is GenerationStage.RENDER)
        render_result = coordinator.runtime.get_job(render_stage.job_id).result
        assert render_result is not None
        caption_provenance = [
            item for item in render_result["payload"]["candidate"]["provenanceRecords"]
            if item["role"] in {"captions-vtt", "captions-srt", "transcript"}
        ]
        assert len(caption_provenance) == 3
        assert {item["modelRevision"] for item in caption_provenance} == {CAPTION_COMPILER_VERSION}

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
        self.presenter_scenes: list[dict[str, Any]] = []

    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        self.visual_scene_ids.append(str(scene["id"]))
        return super().create_visual(scene, seed=seed)

    def synthesize_narration(
        self, scene: dict[str, Any], *, locale: str, seed: int
    ) -> GeneratedMedia:
        self.narration_scenes.append(copy.deepcopy(scene))
        return super().synthesize_narration(scene, locale=locale, seed=seed)

    def create_presenter(
        self, scene: dict[str, Any], *, narration_hash: str, seed: int
    ) -> GeneratedMedia | None:
        self.presenter_scenes.append(copy.deepcopy(scene))
        return super().create_presenter(
            scene, narration_hash=narration_hash, seed=seed
        )


class FailingVisualMediaClient(RecordingMediaClient):
    def narration_cache_runtime_identity(self) -> dict[str, object]:
        value: dict[str, object] = {
            "contract": "failing-visual-cache-fixture-v1",
            "selectedProvider": self.provider_id,
            "requestedModel": self.model_revision,
            "requestedVoice": "deterministic-sine",
            "synthesisControls": {"duration": "word-count-bounded"},
        }
        canonical = json.dumps(value, sort_keys=True, separators=(",", ":"))
        return {
            **value,
            "runtimeIdentitySha256": hashlib.sha256(canonical.encode()).hexdigest(),
        }

    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        self.visual_scene_ids.append(str(scene["id"]))
        raise RuntimeError("image generation failed")


class PacingRecoveryMediaClient(RecordingMediaClient):
    def narration_cache_runtime_identity(self) -> dict[str, object]:
        value: dict[str, object] = {
            "contract": "pacing-recovery-fixture-v1",
            "selectedProvider": self.provider_id,
            "requestedModel": self.model_revision,
            "requestedVoice": "deterministic-sine",
            "synthesisControls": {
                "normalDurationMs": 30_000,
                "reviewedDurationMs": 35_000,
            },
        }
        canonical = json.dumps(value, sort_keys=True, separators=(",", ":"))
        return {
            **value,
            "runtimeIdentitySha256": hashlib.sha256(canonical.encode()).hexdigest(),
        }

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
        metadata={
            "canonicalFixtureScenes": fixture_scenes,
            "durationContract": "exact",
        },
    )


def test_legacy_target_retry_reuses_verified_clips_and_persists_retime_receipt(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ALYSTRIA_MEDIA_MODE", "production")
    store = ProjectStore.create(tmp_path / "Legacy target retry", name="Legacy target retry")
    media = PacingRecoveryMediaClient()
    coordinator = GenerationCoordinator(store, media_client=media)
    real_fit = generation_workflow._fit_storyboard_to_narration
    try:
        target_request = replace(
            request(),
            duration_seconds=120,
            presenter_mode="off",
            metadata={},
        )
        generation_id = coordinator.start(target_request).generation_id
        coordinator.run_pending()
        head = store.head_revision()
        assert head is not None
        approved = coordinator.approve(
            generation_id,
            expected_head_revision_id=head.revision_id,
        )
        assert approved.approval_revision_id is not None

        def fail_after_verified_synthesis(*_: Any, **__: Any) -> dict[str, Any]:
            raise ValueError("legacy exact-duration pacing failure")

        monkeypatch.setattr(
            generation_workflow,
            "_fit_storyboard_to_narration",
            fail_after_verified_synthesis,
        )
        failed = coordinator.run_pending()
        assert failed is not None and failed.state is GenerationState.FAILED
        narration_calls = len(media.narration_scenes)
        assert narration_calls > 0

        failed_narration = next(
            job
            for job in coordinator._jobs(generation_id)
            if job.parameters.get("stage") == GenerationStage.NARRATION.value
        )
        monkeypatch.setattr(
            generation_workflow,
            "_fit_storyboard_to_narration",
            real_fit,
        )
        coordinator.runtime.retry(failed_narration.job_id)
        completed = coordinator.run_pending()

        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        assert len(media.narration_scenes) == narration_calls
        narration_job = coordinator.runtime.get_job(failed_narration.job_id)
        assert narration_job.result is not None
        payload = narration_job.result["payload"]
        assert payload["storyboard"]["timingAdjustment"]["durationContract"] == "target"
        assert all(
            item["synthesis"]["reused"] is True
            and item["synthesis"]["providerInvoked"] is False
            and item["synthesis"]["newActualCostMicros"] == 0
            for item in payload["narration"]
        )
    finally:
        store.close()


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


def test_pacing_reapproval_reuses_unchanged_verified_narration_clips(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ALYSTRIA_MEDIA_MODE", "production")
    root = tmp_path / "Pacing clip reuse"
    store = ProjectStore.create(root, name="Pacing clip reuse")
    media = PacingRecoveryMediaClient()
    try:
        coordinator = GenerationCoordinator(store, media_client=media)
        generation_id = coordinator.start(pacing_recovery_request()).generation_id
        coordinator.run_pending()
        head = store.head_revision()
        assert head is not None
        first_approval = coordinator.approve(
            generation_id,
            expected_head_revision_id=head.revision_id,
        )
        assert first_approval.approval_revision_id is not None
        failed = coordinator.run_pending()
        assert failed is not None and failed.state is GenerationState.FAILED
        assert len(media.narration_scenes) == 5
        assert (
            store.connection.execute(
                """SELECT COUNT(*) FROM dependency_nodes
                   WHERE project_id=? AND logical_key LIKE 'narration-cache:%'
                     AND state='CURRENT'""",
                (store.manifest.project_id,),
            ).fetchone()[0]
            == 5
        )

        # Reopen the project to prove this is durable CAS reuse rather than an
        # in-memory retry shortcut. Only the edited scene should invoke TTS.
        store.close()
        store = ProjectStore.open(root)
        coordinator = GenerationCoordinator(store, media_client=media)
        failed_head = store.head_revision()
        assert failed_head is not None
        revised_snapshot = copy.deepcopy(failed_head.snapshot)
        first_scene = revised_snapshot["payload"]["storyboard"]["scenes"][0]
        first_scene["narration"] = f"{first_scene['narration']} reviewed pacing"
        revised = store.create_revision(
            snapshot=revised_snapshot,
            expected_head=failed_head.revision_id,
            message="Revise one narration scene after measured pacing failure",
        )
        reapproved = coordinator.approve(
            generation_id,
            expected_head_revision_id=revised.revision_id,
        )
        assert reapproved.approval_revision_id is not None
        second_failed = coordinator.run_pending()
        assert second_failed is not None and second_failed.state is GenerationState.FAILED
        assert len(media.narration_scenes) == 6
        assert media.narration_scenes[-1]["id"] == first_scene["id"]
        assert "reviewed pacing" in str(media.narration_scenes[-1]["narration"])

        narration_usage = []
        for row in store.connection.execute("SELECT metadata_json FROM usage_records"):
            metadata = json.loads(str(row["metadata_json"]))
            if metadata.get("kind") == "narration":
                narration_usage.append(metadata)
        assert len(narration_usage) == 6
        cache_keys = [
            str(row["logical_key"])
            for row in store.connection.execute(
                """SELECT logical_key FROM dependency_nodes
                   WHERE project_id=? AND logical_key LIKE 'narration-cache:%'
                     AND state='CURRENT' ORDER BY logical_key""",
                (store.manifest.project_id,),
            )
        ]
        assert len(cache_keys) == 6, cache_keys

        second_failed_head = store.head_revision()
        assert second_failed_head is not None
        final_snapshot = copy.deepcopy(second_failed_head.snapshot)
        for scene in final_snapshot["payload"]["storyboard"]["scenes"][1:]:
            scene["narration"] = f"{scene['narration']} reviewed pacing"
        final_revision = store.create_revision(
            snapshot=final_snapshot,
            expected_head=second_failed_head.revision_id,
            message="Finish reviewed narration pacing",
        )
        final_approval = coordinator.approve(
            generation_id,
            expected_head_revision_id=final_revision.revision_id,
        )
        assert final_approval.approval_revision_id is not None
        completed = coordinator.run_pending()
        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        # The first reviewed scene is reused from the second failed fit; only
        # the four newly edited scenes invoke the provider on this branch.
        assert len(media.narration_scenes) == 10
        final_narration_job = next(
            job
            for job in coordinator._jobs(generation_id)
            if job.parameters.get("approvalRevisionId") == final_approval.approval_revision_id
            and job.parameters.get("stage") == GenerationStage.NARRATION.value
        )
        assert final_narration_job.result is not None
        final_narration = final_narration_job.result["payload"]["narration"]
        by_scene = {str(item["sceneId"]): item for item in final_narration}
        reused = by_scene[str(first_scene["id"])]["synthesis"]
        assert reused["reused"] is True
        assert reused["providerInvoked"] is False
        assert reused["newActualCostMicros"] == 0
        assert reused["newUsageUnits"] == {}
        assert reused["originUsage"]["providerInvoked"] is True
        assert all(
            item["synthesis"]["providerInvoked"] is True
            for scene_id, item in by_scene.items()
            if scene_id != str(first_scene["id"])
        )
        narration_usage = [
            json.loads(str(row["metadata_json"]))
            for row in store.connection.execute("SELECT metadata_json FROM usage_records")
            if json.loads(str(row["metadata_json"])).get("kind") == "narration"
        ]
        assert len(narration_usage) == 10
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
            _prepare_failed_media_reapproval(
                coordinator.runtime,
                stale_job_snapshots,
                approval_revision_id=approval_revision_id,
                previous_payload=previous_payload,
                reviewed_payload=reviewed_payload,
                request_visual_generation_mode="routed",
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


def test_reviewed_visual_mode_cannot_branch_while_media_work_is_active(
    tmp_path: Path,
) -> None:
    store, coordinator = open_coordinator(tmp_path)
    try:
        generation_id = coordinator.start(
            replace(request(), metadata={"sceneVisualGeneration": "routed"})
        ).generation_id
        coordinator.run_pending()
        generated_head = store.head_revision()
        assert generated_head is not None
        illustrated_snapshot = copy.deepcopy(generated_head.snapshot)
        illustrated_snapshot["creative"] = {"slide": {"mode": "illustrated"}}
        illustrated_review = store.create_revision(
            snapshot=illustrated_snapshot,
            expected_head=generated_head.revision_id,
            message="Review illustrated mode",
        )
        approved = coordinator.approve(
            generation_id,
            expected_head_revision_id=illustrated_review.revision_id,
        )
        approval_revision_id = approved.approval_revision_id
        assert approval_revision_id is not None
        assert approved.state is GenerationState.QUEUED
        total_jobs_before = len(coordinator._jobs(generation_id))

        approval_head = store.head_revision()
        assert approval_head is not None
        designed_snapshot = copy.deepcopy(approval_head.snapshot)
        designed_snapshot["creative"] = {"slide": {"mode": "designed"}}
        designed_review = store.create_revision(
            snapshot=designed_snapshot,
            expected_head=approval_head.revision_id,
            message="Attempt mode change while media is active",
        )
        with pytest.raises(ApprovalNotReadyError, match="media work is active"):
            coordinator.approve(
                generation_id,
                expected_head_revision_id=designed_review.revision_id,
            )
        assert coordinator.status(generation_id).approval_revision_id == approval_revision_id
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


def test_failed_illustrated_assets_can_be_reapproved_as_designed_without_new_media_calls(
    tmp_path: Path,
) -> None:
    store = ProjectStore.create(tmp_path / "Designed recovery", name="Designed recovery")
    media = FailingVisualMediaClient()
    renderer = RecordingRenderer()
    coordinator = GenerationCoordinator(store, media_client=media, renderer_client=renderer)
    try:
        routed_request = replace(
            pacing_recovery_request(),
            presenter_mode="off",
            metadata={
                **pacing_recovery_request().metadata,
                "sceneVisualGeneration": "routed",
            },
        )
        generation_id = coordinator.start(routed_request).generation_id
        coordinator.run_pending()
        generated_head = store.head_revision()
        assert generated_head is not None
        illustrated_snapshot = copy.deepcopy(generated_head.snapshot)
        illustrated_snapshot["creative"] = {"slide": {"mode": "illustrated"}}
        illustrated_review = store.create_revision(
            snapshot=illustrated_snapshot,
            expected_head=generated_head.revision_id,
            message="Review illustrated canvas",
        )
        first_approval = coordinator.approve(
            generation_id,
            expected_head_revision_id=illustrated_review.revision_id,
        )
        first_approval_id = first_approval.approval_revision_id
        assert first_approval_id is not None

        failed = coordinator.run_pending()
        assert failed is not None and failed.state is GenerationState.FAILED
        failed_assets = next(
            item for item in failed.stages if item.stage is GenerationStage.ASSETS
        )
        assert failed_assets.error is not None
        assert len(media.visual_scene_ids) == 1
        assert len(media.narration_scenes) == 5

        failed_head = store.head_revision()
        assert failed_head is not None
        unchanged_snapshot = copy.deepcopy(store.get_revision(first_approval_id).snapshot)
        unchanged_review = store.create_revision(
            snapshot=unchanged_snapshot,
            expected_head=failed_head.revision_id,
            message="Keep illustrated mode after artwork failure",
        )
        with pytest.raises(ApprovalNotReadyError, match="failed illustrated assets"):
            coordinator.approve(
                generation_id,
                expected_head_revision_id=unchanged_review.revision_id,
            )

        designed_snapshot = copy.deepcopy(store.get_revision(first_approval_id).snapshot)
        designed_snapshot["creative"] = {"slide": {"mode": "designed"}}
        designed_review = store.create_revision(
            snapshot=designed_snapshot,
            expected_head=unchanged_review.revision_id,
            message="Use designed slide layout after artwork failure",
        )
        reapproved = coordinator.approve(
            generation_id,
            expected_head_revision_id=designed_review.revision_id,
        )
        second_approval_id = reapproved.approval_revision_id
        assert second_approval_id not in {None, first_approval_id}
        assert store.get_revision(first_approval_id).snapshot["payload"]["approval"][
            "reviewedVisualMode"
        ] == "illustrated"
        assert store.get_revision(str(second_approval_id)).snapshot["payload"]["approval"][
            "reviewedVisualMode"
        ] == "designed"

        completed = coordinator.run_pending()
        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        assert len(media.visual_scene_ids) == 1
        assert len(media.narration_scenes) == 5
        narration_job = next(
            job
            for job in coordinator._jobs(generation_id)
            if job.parameters.get("approvalRevisionId") == second_approval_id
            and job.parameters.get("stage") == GenerationStage.NARRATION.value
        )
        assert narration_job.result is not None
        assert all(
            item["synthesis"]["reused"] is True
            and item["synthesis"]["providerInvoked"] is False
            for item in narration_job.result["payload"]["narration"]
        )
        assets_job = next(
            job
            for job in coordinator._jobs(generation_id)
            if job.parameters.get("approvalRevisionId") == second_approval_id
            and job.parameters.get("stage") == GenerationStage.ASSETS.value
        )
        assert assets_job.result is not None
        assert assets_job.result["payload"]["visualGenerationMode"] == "authored-only"
        assert assets_job.result["payload"]["assets"] == []
    finally:
        store.close()


def test_designed_asset_reapproval_refreshes_jobs_before_superseding(
    tmp_path: Path,
) -> None:
    store = ProjectStore.create(tmp_path / "Designed recovery race", name="Designed race")
    coordinator = GenerationCoordinator(store, media_client=FailingVisualMediaClient())
    try:
        routed_request = replace(
            request(),
            presenter_mode="off",
            metadata={"sceneVisualGeneration": "routed"},
        )
        generation_id = coordinator.start(routed_request).generation_id
        coordinator.run_pending()
        head = store.head_revision()
        assert head is not None
        illustrated_snapshot = copy.deepcopy(head.snapshot)
        illustrated_snapshot["creative"] = {"slide": {"mode": "illustrated"}}
        illustrated_review = store.create_revision(
            snapshot=illustrated_snapshot,
            expected_head=head.revision_id,
            message="Review illustrated canvas",
        )
        approved = coordinator.approve(
            generation_id,
            expected_head_revision_id=illustrated_review.revision_id,
        )
        approval_revision_id = approved.approval_revision_id
        assert approval_revision_id is not None
        failed = coordinator.run_pending()
        assert failed is not None and failed.state is GenerationState.FAILED

        stale_job_snapshots = coordinator._jobs(generation_id)
        failed_assets = next(
            job
            for job in stale_job_snapshots
            if job.parameters.get("approvalRevisionId") == approval_revision_id
            and job.parameters.get("stage") == GenerationStage.ASSETS.value
        )
        assert failed_assets.state is JobState.FAILED
        previous_payload = copy.deepcopy(
            store.get_revision(approval_revision_id).snapshot["payload"]
        )
        reviewed_payload = copy.deepcopy(previous_payload)
        reviewed_payload["approval"]["reviewedVisualMode"] = "designed"
        reviewed_payload["approval"]["sceneVisualGeneration"] = "authored-only"

        retried = coordinator.runtime.retry(failed_assets.job_id)
        assert retried.state is JobState.QUEUED
        with pytest.raises(ApprovalNotReadyError, match="media work is active"):
            _prepare_failed_media_reapproval(
                coordinator.runtime,
                stale_job_snapshots,
                approval_revision_id=approval_revision_id,
                previous_payload=previous_payload,
                reviewed_payload=reviewed_payload,
                request_visual_generation_mode="routed",
            )
        assert coordinator.runtime.get_job(failed_assets.job_id).state is JobState.QUEUED
        assert not any(
            job.state is JobState.STALE
            for job in coordinator._jobs(generation_id)
            if job.parameters.get("approvalRevisionId") == approval_revision_id
        )
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


def test_multiple_presenters_route_portraits_voices_and_profiles_per_scene(
    tmp_path: Path,
) -> None:
    store = ProjectStore.create(tmp_path / "Multi presenter", name="Multi presenter")
    renderer = RecordingRenderer()
    media = RecordingMediaClient()
    portraits = ("a" * 64, "b" * 64, "c" * 64, "d" * 64)
    configured = replace(
        request(),
        presenter_mode="on",
        metadata={
            "presenterSelection": {
                "schemaVersion": 1,
                "mode": "on",
                "presenters": [
                    {
                        "presenterId": "presenter.alpha",
                        "portraitAssetId": "presenter-portrait.alpha-v1",
                        "portraitArtifactHash": portraits[0],
                        "portraitMediaType": "image/webp",
                        "voiceId": "voice.alpha",
                        "profile": {"displayName": "Alpha"},
                    },
                    {
                        "presenterId": "presenter.beta",
                        "portraitAssetId": "presenter-portrait.beta-v1",
                        "portraitArtifactHash": portraits[1],
                        "portraitMediaType": "image/webp",
                        "voiceId": "voice.beta",
                        "profile": {"displayName": "Beta"},
                    },
                    {
                        "presenterId": "presenter.gamma",
                        "portraitAssetId": "presenter-portrait.gamma-v1",
                        "portraitArtifactHash": portraits[2],
                        "portraitMediaType": "image/webp",
                        "voiceId": "voice.gamma",
                        "profile": {"displayName": "Gamma"},
                    },
                    {
                        "presenterId": "presenter.delta",
                        "portraitAssetId": "presenter-portrait.delta-v1",
                        "portraitArtifactHash": portraits[3],
                        "portraitMediaType": "image/webp",
                        "voiceId": "voice.delta",
                        "profile": {"displayName": "Delta"},
                    },
                ],
                "sceneAssignments": [],
            }
        },
    )
    coordinator = GenerationCoordinator(
        store,
        media_client=media,
        renderer_client=renderer,
    )
    try:
        generation_id = coordinator.start(configured).generation_id
        coordinator.run_pending()
        coordinator.approve(generation_id)
        completed = coordinator.run_pending()

        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        learning_plan_job = next(
            job
            for job in coordinator._jobs(generation_id)
            if job.parameters.get("stage") == GenerationStage.LEARNING_PLAN.value
        )
        assert learning_plan_job.result is not None
        learning_plan = learning_plan_job.result["payload"]["learningPlan"]
        assert learning_plan["presenterPlan"]["selectedCount"] == 4
        assert learning_plan["presenterPlan"]["minimumSpeakingScenes"] == 4
        assert len(learning_plan["outline"]) >= 4
        assert len(media.narration_scenes) >= 2
        assert [scene["presenterId"] for scene in media.narration_scenes] == [
            "presenter.alpha",
            "presenter.beta",
            "presenter.gamma",
            "presenter.delta",
        ]
        assert [scene["voiceId"] for scene in media.narration_scenes] == [
            "voice.alpha",
            "voice.beta",
            "voice.gamma",
            "voice.delta",
        ]
        assert [scene["presenterProfileId"] for scene in media.presenter_scenes] == [
            "presenter.alpha",
            "presenter.beta",
            "presenter.gamma",
            "presenter.delta",
        ]
        assert [scene["portraitArtifactHash"] for scene in media.presenter_scenes] == list(
            portraits
        )
        sent = renderer.requests[0]
        assert all(scene["type"] == "presenter-slide" for scene in sent["scenes"])
        assert [item["presenterId"] for item in sent["presenters"]] == [
            "presenter.alpha",
            "presenter.beta",
            "presenter.gamma",
            "presenter.delta",
        ]
        assert [item["voiceId"] for item in sent["presenters"]] == [
            "voice.alpha",
            "voice.beta",
            "voice.gamma",
            "voice.delta",
        ]
    finally:
        store.close()


def test_presenter_off_overrides_a_persisted_roster(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Presenter off", name="Presenter off")
    renderer = RecordingRenderer()
    media = RecordingMediaClient()
    configured = replace(
        request(),
        presenter_mode="off",
        metadata={
            "presenterSelection": {
                "schemaVersion": 1,
                "mode": "off",
                "presenters": [
                    {
                        "presenterId": "presenter.saved",
                        "portraitAssetId": "presenter-portrait.saved-v1",
                        "portraitArtifactHash": "a" * 64,
                    }
                ],
                "sceneAssignments": [],
            }
        },
    )
    coordinator = GenerationCoordinator(
        store,
        media_client=media,
        renderer_client=renderer,
    )
    try:
        generation_id = coordinator.start(configured).generation_id
        coordinator.run_pending()
        coordinator.approve(generation_id)
        completed = coordinator.run_pending()

        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        assert media.presenter_scenes == []
        assert renderer.requests[0]["presenters"] == []
        assert all(
            "presenterId" not in scene for scene in renderer.requests[0]["scenes"]
        )
    finally:
        store.close()


def test_approval_rebinds_the_exact_reviewed_cast_before_media_enqueue(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository_root = Path(__file__).resolve().parents[4]
    monkeypatch.setenv("ALYSTRIA_STARTER_VISUAL_ROOT", str(repository_root))
    store = ProjectStore.create(tmp_path / "Reviewed cast", name="Reviewed cast")
    renderer = RecordingRenderer()
    media = RecordingMediaClient()
    coordinator = GenerationCoordinator(
        store,
        media_client=media,
        renderer_client=renderer,
    )
    try:
        generation_id = coordinator.start(request()).generation_id
        coordinator.run_pending()
        head = store.head_revision()
        assert head is not None
        reviewed_snapshot = copy.deepcopy(head.snapshot)
        reviewed_snapshot["presenterSelection"] = {
            "schemaVersion": 1,
            "mode": "on",
            "presenters": [
                {
                    "presenterId": "presenter-portrait.broadcast-elena-v1",
                    "portraitAssetId": "presenter-portrait.broadcast-elena-v1",
                    "voiceId": "voice.elena",
                },
                {
                    "presenterId": "presenter-portrait.anime-astrid-v1",
                    "portraitAssetId": "presenter-portrait.anime-astrid-v1",
                    "voiceId": "voice.astrid",
                },
            ],
            "sceneAssignments": [],
        }
        reviewed = store.create_revision(
            snapshot=reviewed_snapshot,
            kind="edit",
            expected_head=head.revision_id,
            message="Review a two-presenter cast",
        )
        approved = coordinator.approve(
            generation_id,
            expected_head_revision_id=reviewed.revision_id,
        )
        assert approved.approval_revision_id is not None
        frozen = store.get_revision(approved.approval_revision_id).snapshot["payload"]
        frozen_scenes = frozen["storyboard"]["scenes"]
        assert [scene["presenterId"] for scene in frozen_scenes[:2]] == [
            "presenter-portrait.broadcast-elena-v1",
            "presenter-portrait.anime-astrid-v1",
        ]
        assert [scene["voiceId"] for scene in frozen_scenes[:2]] == [
            "voice.elena",
            "voice.astrid",
        ]

        completed = coordinator.run_pending()
        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        assert [scene["presenterProfileId"] for scene in media.presenter_scenes[:2]] == [
            "presenter-portrait.broadcast-elena-v1",
            "presenter-portrait.anime-astrid-v1",
        ]
        assert len(renderer.requests[0]["presenters"]) == len(frozen_scenes)
    finally:
        store.close()


def test_reviewed_cast_cannot_change_while_media_work_is_active(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository_root = Path(__file__).resolve().parents[4]
    monkeypatch.setenv("ALYSTRIA_STARTER_VISUAL_ROOT", str(repository_root))
    store, coordinator = open_coordinator(tmp_path)
    try:
        generation_id = coordinator.start(request()).generation_id
        coordinator.run_pending()
        head = store.head_revision()
        assert head is not None
        approved = coordinator.approve(
            generation_id,
            expected_head_revision_id=head.revision_id,
        )
        assert approved.approval_revision_id is not None
        active_head = store.head_revision()
        assert active_head is not None
        reviewed_snapshot = copy.deepcopy(active_head.snapshot)
        reviewed_snapshot["presenterSelection"] = {
            "schemaVersion": 1,
            "mode": "on",
            "presenters": [
                {
                    "presenterId": "presenter-portrait.anime-astrid-v1",
                    "portraitAssetId": "presenter-portrait.anime-astrid-v1",
                }
            ],
            "sceneAssignments": [],
        }
        reviewed = store.create_revision(
            snapshot=reviewed_snapshot,
            kind="edit",
            expected_head=active_head.revision_id,
            message="Try to change cast during media work",
        )

        with pytest.raises(ApprovalNotReadyError, match="media work is active"):
            coordinator.approve(
                generation_id,
                expected_head_revision_id=reviewed.revision_id,
            )
    finally:
        store.close()


def test_failed_media_branch_can_be_reapproved_with_a_reviewed_cast(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repository_root = Path(__file__).resolve().parents[4]
    monkeypatch.setenv("ALYSTRIA_MEDIA_MODE", "production")
    monkeypatch.setenv("ALYSTRIA_STARTER_VISUAL_ROOT", str(repository_root))
    store = ProjectStore.create(tmp_path / "Failed cast reapproval", name="Failed cast")
    coordinator = GenerationCoordinator(store, media_client=PacingRecoveryMediaClient())
    try:
        generation_id = coordinator.start(pacing_recovery_request()).generation_id
        coordinator.run_pending()
        head = store.head_revision()
        assert head is not None
        first = coordinator.approve(
            generation_id,
            expected_head_revision_id=head.revision_id,
        )
        old_approval_id = first.approval_revision_id
        assert old_approval_id is not None
        failed = coordinator.run_pending()
        assert failed is not None and failed.state is GenerationState.FAILED

        failed_head = store.head_revision()
        assert failed_head is not None
        reviewed_snapshot = copy.deepcopy(failed_head.snapshot)
        reviewed_snapshot["presenterSelection"] = {
            "schemaVersion": 1,
            "mode": "on",
            "presenters": [
                {
                    "presenterId": "presenter-portrait.anime-astrid-v1",
                    "portraitAssetId": "presenter-portrait.anime-astrid-v1",
                    "voiceId": "voice.astrid",
                }
            ],
            "sceneAssignments": [],
        }
        reviewed = store.create_revision(
            snapshot=reviewed_snapshot,
            kind="edit",
            expected_head=failed_head.revision_id,
            message="Review a replacement presenter after media failure",
        )
        reapproved = coordinator.approve(
            generation_id,
            expected_head_revision_id=reviewed.revision_id,
        )

        assert reapproved.approval_revision_id not in {None, old_approval_id}
        new_payload = store.get_revision(str(reapproved.approval_revision_id)).snapshot[
            "payload"
        ]
        assert all(
            scene["presenterId"] == "presenter-portrait.anime-astrid-v1"
            for scene in new_payload["storyboard"]["scenes"]
        )
        old_post_jobs = [
            job
            for job in coordinator._jobs(generation_id)
            if job.parameters.get("approvalRevisionId") == old_approval_id
        ]
        assert old_post_jobs and all(job.state is JobState.STALE for job in old_post_jobs)
    finally:
        store.close()


def test_presenter_on_rejects_overrides_that_leave_a_selected_speaker_unused() -> None:
    configured = replace(
        request(),
        presenter_mode="on",
        metadata={
            "presenterSelection": {
                "schemaVersion": 1,
                "mode": "on",
                "presenters": [
                    {
                        "presenterId": presenter_id,
                        "portraitAssetId": f"presenter-portrait.{presenter_id}",
                        "portraitArtifactHash": character * 64,
                    }
                    for presenter_id, character in (("alpha", "a"), ("beta", "b"))
                ],
                "sceneAssignments": [
                    {"sceneId": "scene-one", "presenterId": "alpha"},
                    {"sceneId": "scene-two", "presenterId": "alpha"},
                ],
            }
        },
    )
    scenes = [
        {"id": "scene-one", "type": "diagram"},
        {"id": "scene-two", "type": "worked-example"},
    ]

    with pytest.raises(ValueError, match="leave selected presenters unused: beta"):
        _apply_presenter_selection(
            scenes,
            request=configured,
            presenter_customization={},
        )


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


def _desktop_image_routing_policy() -> dict[str, Any]:
    return {
        "version": 1,
        "privacyMode": "local",
        "dataClassification": "project",
        "budget": {
            "currency": "USD",
            "hardLimitMicros": 0,
            "requireKnownPricing": True,
            "approved": True,
        },
        "approvals": [
            {
                "providerId": "mock",
                "capabilities": ["image.generate"],
                "credentialRef": None,
                "boundary": "local",
                "retention": "local_only",
                "regions": ["local"],
                "dataClasses": ["project"],
                "privacyApproved": True,
                "retentionApproved": True,
                "regionApproved": True,
                "budgetApproved": True,
            }
        ],
        "routes": [
            {
                "capability": "image.generate",
                "providerIds": ["mock"],
                "model": "mock-image-v1",
                "voice": None,
            }
        ],
    }


@pytest.mark.parametrize(
    ("slide_mode", "expected_generation_mode", "expects_provider_images"),
    [
        ("designed", "authored-only", False),
        ("illustrated", "routed", True),
    ],
)
def test_desktop_slide_mode_controls_provider_images_even_when_a_route_exists(
    tmp_path: Path,
    slide_mode: str,
    expected_generation_mode: str,
    expects_provider_images: bool,
) -> None:
    store = ProjectStore.create(tmp_path / slide_mode, name=f"{slide_mode} tutorial")
    media = RecordingMediaClient()
    coordinator = GenerationCoordinator(store, media_client=media)
    try:
        store.create_revision(
            snapshot={
                "brief": {
                    "topic": "Explain stable sorting",
                    "audience": "Beginning programmers",
                    "durationSeconds": 180,
                    "locale": "en-US",
                },
                "groundingMode": "creative",
                "sources": [],
                "creative": {"slide": {"mode": slide_mode}},
                "providerRoutingPolicy": _desktop_image_routing_policy(),
            },
            kind="edit",
        )
        converted = request_from_desktop(
            store,
            {
                "quality": "standard",
                "privacy": "local",
                "approvedProviderIds": ["mock"],
                "budget": {
                    "currency": "USD",
                    "hardLimitMinorUnits": 0,
                    "requireKnownPricing": True,
                },
            },
        )
        assert converted.metadata["sceneVisualGeneration"] == expected_generation_mode
        assert converted.metadata["imageGenerationApproved"] is True

        generation_id = coordinator.start(converted).generation_id
        waiting = coordinator.run_pending()
        assert waiting is not None and waiting.state is GenerationState.WAITING_APPROVAL
        reviewed = store.head_revision()
        assert reviewed is not None
        approved = coordinator.approve(
            generation_id,
            expected_head_revision_id=reviewed.revision_id,
        )
        approval_revision_id = approved.approval_revision_id
        assert approval_revision_id is not None
        approval_payload = store.get_revision(approval_revision_id).snapshot["payload"]
        assert approval_payload["approval"]["reviewedVisualMode"] == slide_mode
        assert approval_payload["approval"][
            "sceneVisualGeneration"
        ] == expected_generation_mode

        completed = coordinator.run_pending()
        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        assert bool(media.visual_scene_ids) is expects_provider_images
    finally:
        store.close()


def test_default_designed_request_can_approve_illustrated_mode_with_its_frozen_route(
    tmp_path: Path,
) -> None:
    store = ProjectStore.create(tmp_path / "Illustrated at review", name="Illustrated review")
    media = RecordingMediaClient()
    coordinator = GenerationCoordinator(store, media_client=media)
    try:
        store.create_revision(
            snapshot={
                "brief": {
                    "topic": "Explain stable sorting",
                    "audience": "Beginning programmers",
                    "durationSeconds": 180,
                    "locale": "en-US",
                },
                "groundingMode": "creative",
                "sources": [],
                "providerRoutingPolicy": _desktop_image_routing_policy(),
            },
            kind="edit",
        )
        converted = request_from_desktop(
            store,
            {
                "quality": "standard",
                "privacy": "local",
                "approvedProviderIds": ["mock"],
                "budget": {"hardLimitMinorUnits": 0},
            },
        )
        assert converted.metadata["sceneVisualGeneration"] == "authored-only"
        assert converted.metadata["imageGenerationApproved"] is True

        generation_id = coordinator.start(converted).generation_id
        coordinator.run_pending()
        head = store.head_revision()
        assert head is not None
        illustrated_snapshot = copy.deepcopy(head.snapshot)
        illustrated_snapshot["creative"] = {"slide": {"mode": "illustrated"}}
        illustrated_review = store.create_revision(
            snapshot=illustrated_snapshot,
            expected_head=head.revision_id,
            message="Choose illustrated canvas during review",
        )
        approved = coordinator.approve(
            generation_id,
            expected_head_revision_id=illustrated_review.revision_id,
        )
        assert approved.approval_revision_id is not None
        approval = store.get_revision(approved.approval_revision_id).snapshot["payload"][
            "approval"
        ]
        assert approval["reviewedVisualMode"] == "illustrated"
        assert approval["sceneVisualGeneration"] == "routed"

        completed = coordinator.run_pending()
        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        assert media.visual_scene_ids
    finally:
        store.close()


def test_desktop_illustrated_mode_requires_an_approved_image_route(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Missing image route", name="Missing route")
    try:
        store.create_revision(
            snapshot={
                "brief": {
                    "topic": "Explain stable sorting",
                    "audience": "Beginning programmers",
                    "durationSeconds": 180,
                    "locale": "en-US",
                },
                "groundingMode": "creative",
                "sources": [],
                "creative": {"slide": {"mode": "illustrated"}},
            },
            kind="edit",
        )
        with pytest.raises(ValueError, match="requires an approved image generation route"):
            request_from_desktop(
                store,
                {
                    "quality": "standard",
                    "privacy": "local",
                    "approvedProviderIds": [],
                    "budget": {"hardLimitMinorUnits": 0},
                },
            )
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
        assert "hardBudgetMicros" not in converted.to_dict()
        assert converted.sources[0].source_id == "source.note"
        assert converted.metadata["preservationLocks"] == ["script"]
        assert converted.metadata["sceneVisualGeneration"] == "authored-only"
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
