"""Durable staged generation workflow built on the project SQLite runtime."""

from __future__ import annotations

import copy
import hashlib
import itertools
import json
import os
import re
from collections.abc import Mapping
from contextlib import nullcontext
from dataclasses import asdict, replace
from pathlib import Path
from typing import Any

from alystria.audio import WordTiming, captions_from_words, to_srt, to_webvtt
from alystria.course import TICKS_PER_SECOND, VisualBible
from alystria.jobs import ActionKey, DependencyGraph, JobContext, SQLiteWorkflowRuntime
from alystria.jobs.runtime import TaskHandler
from alystria.presenters import PresenterDirection, PresenterPlacement
from alystria.project import ProjectStore
from alystria.project_assets import validate_approved_presenter_for_export
from alystria.qa import Finding, GateStatus, QualityGate, Severity
from alystria.qa.content import (
    Citation,
    Claim,
    ContentPackage,
    Objective,
    SceneContent,
    run_content_checks,
)
from alystria.qa.media import AudioMetrics, CaptionCue, TimelineMetrics, check_audio, check_timeline
from alystria.qa.repair import MAX_AUTOMATIC_REPAIRS
from alystria.qa.visual import (
    ElementKind,
    Rect,
    VisualElement,
    VisualSnapshot,
    check_visual_snapshot,
)
from alystria.rendered_frame_review import (
    FrameExtractor,
    RenderedFrameReviewRequest,
    RoutedVisionRuntime,
    SceneWindow,
    critical_review_findings,
    review_rendered_frames,
)
from alystria.research import (
    AtomicClaim,
    ClaimSupport,
    DeterministicOfflineProvider,
    EducationalProvider,
    EducationalWorkflow,
    EvidenceChunk,
    EvidenceLedger,
    GroundingMode,
    LearnerProfile,
    LearningObjective,
    LearningPlan,
    Misconception,
    ObjectiveLevel,
    OutlineSection,
    Prerequisite,
    PrerequisiteDag,
    ResearchPolicy,
    ScriptDraft,
    ScriptReview,
    ScriptWorkflowResult,
    chunk_source,
    verify_claim_evidence,
)
from alystria.research.education import ExperienceLevel
from alystria.security.gates import ExportGateInput, SecurityGates
from alystria.security.licensing import AssetUse, DistributionPurpose
from alystria.security.provenance import (
    AssetProvenance,
    C2paRecord,
    C2paStatus,
    OriginKind,
    RightsStatus,
)
from alystria.sources import SourceDocument
from alystria.sources.models import (
    PrivacyClass,
    RetentionClass,
    SourceKind,
    SourceMetadata,
)

from .adapters import (
    DeterministicMediaClient,
    DeterministicRendererClient,
    GeneratedMedia,
    GenerationMediaClient,
    RendererClient,
)
from .forced_alignment import AlignmentInput, ForcedAlignmentClient
from .models import (
    PRE_APPROVAL_STAGES,
    ClaimSpec,
    GenerationRequest,
    GenerationStage,
    ObjectiveSpec,
    SourceSpec,
)
from .spoken_text import normalize_spoken_text

IMPLEMENTATION_VERSION = "generation-v10-reviewed-narration-reapproval"
PROMPT_VERSION = "offline-education-v1"
MODEL_REVISION = "deterministic-v1"
TICKS_PER_MILLISECOND = TICKS_PER_SECOND // 1_000
MAX_UNAUTHORED_VISUAL_TAIL_MS = 2_000
MAX_UNAUTHORED_VISUAL_TAIL_RATIO = 0.06
PRESENTER_SCENE_TYPES = frozenset({"presenter", "presenter-slide", "presenter-with-slide"})


class ExportQualityGateError(ValueError):
    """The immutable candidate was rejected by the current export policy."""


def _stable_id(prefix: str, *parts: object) -> str:
    payload = "\x1f".join(str(part) for part in parts).encode()
    return f"{prefix}_{hashlib.sha256(payload).hexdigest()[:24]}"


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _fingerprint(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


def _render_scene_windows(scenes: object) -> list[dict[str, Any]]:
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("Render request requires scenes for temporal QA")
    running_ticks = 0
    windows: list[dict[str, Any]] = []
    for scene in scenes:
        if not isinstance(scene, dict) or not isinstance(scene.get("id"), str):
            raise ValueError("Render scene identity is invalid")
        duration_ticks = scene.get("durationTicks")
        if (
            isinstance(duration_ticks, bool)
            or not isinstance(duration_ticks, int)
            or duration_ticks <= 0
        ):
            raise ValueError("Render scene duration is invalid")
        end_ticks = running_ticks + duration_ticks
        windows.append(
            {
                "sceneId": scene["id"],
                "startTicks": running_ticks,
                "endTicks": end_ticks,
            }
        )
        running_ticks = end_ticks
    return windows


def _rendered_frame_review_request(
    parameters: dict[str, Any], candidate: dict[str, Any]
) -> RenderedFrameReviewRequest:
    values = candidate.get("renderSceneWindows")
    if not isinstance(values, list) or not values:
        raise ValueError("Render candidate has no immutable scene windows for visual review")
    windows: list[SceneWindow] = []
    for value in values:
        if not isinstance(value, dict):
            raise ValueError("Render candidate scene window is invalid")
        scene_id = value.get("sceneId")
        start_ticks = value.get("startTicks")
        end_ticks = value.get("endTicks")
        if (
            not isinstance(scene_id, str)
            or isinstance(start_ticks, bool)
            or not isinstance(start_ticks, int)
            or isinstance(end_ticks, bool)
            or not isinstance(end_ticks, int)
        ):
            raise ValueError("Render candidate scene window is invalid")
        windows.append(
            SceneWindow(
                scene_id,
                start_ticks / TICKS_PER_SECOND,
                end_ticks / TICKS_PER_SECOND,
            )
        )
    render_hash = candidate.get("renderArtifactHash")
    render_media_type = candidate.get("renderMediaType")
    if not isinstance(render_hash, str) or not isinstance(render_media_type, str):
        raise ValueError("Render candidate identity is invalid")
    return RenderedFrameReviewRequest(
        generation_id=str(parameters["generationId"]),
        render_artifact_hash=render_hash,
        render_media_type=render_media_type,
        expected_duration_seconds=windows[-1].end_seconds,
        scenes=tuple(windows),
    )


class GenerationWorkflow:
    """Production coordinator task graph with deterministic offline defaults.

    The workflow itself performs no network I/O. A caller may inject a
    ``GenerationMediaClient`` backed by an approved ``ProviderRouter`` and a
    ``RendererClient`` backed by the renderer sidecar. The default clients are
    deterministic local fixtures suitable for clean-machine and recovery tests.
    """

    def __init__(
        self,
        store: ProjectStore,
        runtime: SQLiteWorkflowRuntime,
        *,
        media_client: GenerationMediaClient | None = None,
        renderer_client: RendererClient | None = None,
        educational_provider: EducationalProvider | None = None,
        alignment_client: ForcedAlignmentClient | None = None,
        vision_runtime: RoutedVisionRuntime | None = None,
        rendered_frame_ffmpeg_path: Path | None = None,
        rendered_frame_ffprobe_path: Path | None = None,
        rendered_frame_extractor: FrameExtractor | None = None,
    ) -> None:
        self.store = store
        self.runtime = runtime
        self.media_client = media_client or DeterministicMediaClient()
        self.renderer_client = renderer_client or DeterministicRendererClient()
        self.educational_provider = educational_provider or DeterministicOfflineProvider()
        self.alignment_client = alignment_client
        self.vision_runtime = vision_runtime
        self.rendered_frame_ffmpeg_path = rendered_frame_ffmpeg_path
        self.rendered_frame_ffprobe_path = rendered_frame_ffprobe_path
        self.rendered_frame_extractor = rendered_frame_extractor

    @property
    def handlers(self) -> dict[str, TaskHandler]:
        return {
            self.kind(GenerationStage.INGEST_RESEARCH): self._ingest_research,
            self.kind(GenerationStage.LEARNING_PLAN): self._learning_plan,
            self.kind(GenerationStage.SCRIPT): self._script,
            self.kind(GenerationStage.STORYBOARD): self._storyboard,
            self.kind(GenerationStage.APPROVAL): self._approval_gate,
            self.kind(GenerationStage.ASSETS): self._assets,
            self.kind(GenerationStage.NARRATION): self._narration,
            self.kind(GenerationStage.CAPTIONS): self._captions,
            self.kind(GenerationStage.PRESENTER): self._presenter,
            self.kind(GenerationStage.RENDER): self._render,
            self.kind(GenerationStage.QA_INITIAL): self._qa,
            self.kind(GenerationStage.REPAIR_ONE): self._repair,
            self.kind(GenerationStage.QA_ONE): self._qa,
            self.kind(GenerationStage.REPAIR_TWO): self._repair,
            self.kind(GenerationStage.QA_FINAL): self._qa,
            self.kind(GenerationStage.EXPORT): self._export,
        }

    @staticmethod
    def kind(stage: GenerationStage) -> str:
        return f"generation.{stage.value}"

    def enqueue_pre_approval(
        self,
        *,
        generation_id: str,
        request: GenerationRequest,
    ) -> dict[GenerationStage, str]:
        parameters = {
            "generationId": generation_id,
            "request": request.to_dict(),
            "stage": GenerationStage.INGEST_RESEARCH.value,
            "inputs": {},
        }
        jobs: dict[GenerationStage, str] = {}
        previous: str | None = None
        for stage in PRE_APPROVAL_STAGES:
            stage_parameters = {
                **parameters,
                "stage": stage.value,
                "inputs": {} if previous is None else {"previous": previous},
            }
            job_id = self._enqueue_stage(
                stage,
                stage_parameters,
                [] if previous is None else [previous],
                request,
            )
            jobs[stage] = job_id
            previous = job_id
        return jobs

    def enqueue_post_approval(
        self,
        *,
        generation_id: str,
        request: GenerationRequest,
        approval_job_id: str,
        approval_revision_id: str,
    ) -> dict[GenerationStage, str]:
        base = {
            "generationId": generation_id,
            "request": request.to_dict(),
            "approvalRevisionId": approval_revision_id,
        }
        jobs: dict[GenerationStage, str] = {}

        def enqueue(
            stage: GenerationStage,
            inputs: dict[str, str],
            dependencies: list[str],
        ) -> str:
            parameters = {**base, "stage": stage.value, "inputs": inputs}
            job_id = self._enqueue_stage(stage, parameters, dependencies, request)
            jobs[stage] = job_id
            return job_id

        assets = enqueue(
            GenerationStage.ASSETS,
            {"approval": approval_job_id},
            [approval_job_id],
        )
        narration = enqueue(
            GenerationStage.NARRATION,
            {"approval": approval_job_id},
            [approval_job_id],
        )
        captions = enqueue(
            GenerationStage.CAPTIONS,
            {"approval": approval_job_id, "narration": narration},
            [approval_job_id, narration],
        )
        presenter = enqueue(
            GenerationStage.PRESENTER,
            {"approval": approval_job_id, "assets": assets, "narration": narration},
            [approval_job_id, assets, narration],
        )
        render = enqueue(
            GenerationStage.RENDER,
            {
                "approval": approval_job_id,
                "assets": assets,
                "narration": narration,
                "captions": captions,
                "presenter": presenter,
            },
            [approval_job_id, assets, narration, captions, presenter],
        )
        qa_initial = enqueue(
            GenerationStage.QA_INITIAL,
            {"candidate": render},
            [render],
        )
        repair_one = enqueue(
            GenerationStage.REPAIR_ONE,
            {"qa": qa_initial},
            [qa_initial],
        )
        qa_one = enqueue(
            GenerationStage.QA_ONE,
            {"candidate": repair_one},
            [repair_one],
        )
        repair_two = enqueue(
            GenerationStage.REPAIR_TWO,
            {"qa": qa_one},
            [qa_one],
        )
        qa_final = enqueue(
            GenerationStage.QA_FINAL,
            {"candidate": repair_two},
            [repair_two],
        )
        enqueue(
            GenerationStage.EXPORT,
            {
                "approval": approval_job_id,
                "captions": captions,
                "render": render,
                "qa": qa_final,
            },
            [approval_job_id, captions, render, qa_final],
        )
        return jobs

    def _enqueue_stage(
        self,
        stage: GenerationStage,
        parameters: dict[str, Any],
        dependency_ids: list[str],
        request: GenerationRequest,
    ) -> str:
        inputs = tuple(self.runtime.get_job(job_id).task_key for job_id in dependency_ids)
        action = ActionKey(
            kind=self.kind(stage),
            implementation_version=IMPLEMENTATION_VERSION,
            parameters=parameters,
            input_hashes=inputs,
            provider=self.media_client.provider_id,
            model_revision=self.media_client.model_revision,
            prompt_version=PROMPT_VERSION,
            schema_version="1",
            toolchain_version=self.renderer_client.renderer_version,
            seed=request.deterministic_seed,
        )
        return self.runtime.enqueue(
            project_id=self.store.manifest.project_id,
            kind=action.kind,
            parameters=parameters,
            action_key=action,
            dependency_ids=dependency_ids,
            max_attempts=3,
            estimated_cost_micros=0,
            budget_micros=request.hard_budget_micros,
        ).job_id

    def _input_payload(self, parameters: dict[str, Any], name: str = "previous") -> dict[str, Any]:
        inputs = parameters.get("inputs")
        if not isinstance(inputs, dict) or not isinstance(inputs.get(name), str):
            raise ValueError(f"Generation stage requires input {name!r}")
        result = self.runtime.get_job(inputs[name]).result
        if not isinstance(result, dict) or not isinstance(result.get("payload"), dict):
            raise ValueError(f"Generation input {name!r} has no persisted payload")
        return dict(result["payload"])

    def _persist_stage(
        self,
        context: JobContext,
        parameters: dict[str, Any],
        payload: dict[str, Any],
        *,
        upstream_stages: list[GenerationStage],
        linked_artifacts: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        stage = GenerationStage(str(parameters["stage"]))
        generation_id = str(parameters["generationId"])
        content = (_canonical(payload) + "\n").encode()
        artifact = self.store.add_artifact_bytes(
            content,
            media_type="application/vnd.alystria.generation-stage+json",
            original_name=f"{stage.value}.json",
            metadata={
                "generationId": generation_id,
                "stage": stage.value,
                "generator": IMPLEMENTATION_VERSION,
                "rightsStatus": "owned",
            },
        )
        artifact_links = [
            {
                "artifactHash": artifact.hash,
                "role": f"generation-stage:{stage.value}",
                "stableId": generation_id,
            },
            *(linked_artifacts or []),
        ]
        head = self.store.head_revision()
        snapshot = copy.deepcopy(head.snapshot) if head is not None else {}
        snapshot.update(
            {
                "projectId": self.store.manifest.project_id,
                "generationId": generation_id,
                "stage": stage.value,
                "stageArtifactHash": artifact.hash,
                "payload": payload,
            }
        )
        if isinstance(payload.get("renderedFrameReview"), dict):
            snapshot["renderedFrameReview"] = copy.deepcopy(
                payload["renderedFrameReview"]
            )
        revision = self.store.create_revision(
            snapshot=snapshot,
            kind="generation",
            message=f"Generation {generation_id}: {stage.value}",
            artifact_links=artifact_links,
        )
        graph = DependencyGraph(self.store.connection, self.store.manifest.project_id)
        logical_key = self.logical_key(generation_id, stage.value)
        graph.record_node(
            logical_key,
            artifact.hash,
            artifact_hash=artifact.hash,
            upstream_keys=[self.logical_key(generation_id, item.value) for item in upstream_stages],
        )
        context.set_progress(1, message=f"{stage.value.replace('_', ' ').title()} persisted")
        return {
            "generationId": generation_id,
            "stage": stage.value,
            "artifactHash": artifact.hash,
            "revisionId": revision.revision_id,
            "payload": payload,
        }

    @staticmethod
    def logical_key(generation_id: str, scope: str) -> str:
        return f"generation:{generation_id}:{scope}"

    def _ingest_research(self, context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
        request = _request(parameters)
        context.set_progress(0.08, message="Normalizing inert sources")
        source_specs = list(request.sources)
        documents: list[tuple[str, SourceDocument]] = []
        for source_spec in source_specs:
            documents.append(
                (
                    source_spec.source_id,
                    SourceDocument.create(
                        source_spec.content,
                        SourceMetadata(
                            SourceKind.NOTES,
                            source_spec.title,
                            source_spec.locator,
                            source_spec.media_type,
                            PrivacyClass.PROJECT_LOCAL,
                            RetentionClass.PROJECT,
                            request.locale,
                            source_spec.creator,
                            source_spec.license_id,
                            attributes={
                                **source_spec.locator_metadata,
                                **(
                                    {"artifactHash": source_spec.artifact_hash}
                                    if source_spec.artifact_hash is not None
                                    else {}
                                ),
                            },
                        ),
                    ),
                )
            )
        ledger = EvidenceLedger()
        chunks_by_source: dict[str, tuple[EvidenceChunk, ...]] = {}
        for source_id, document in documents:
            chunks = chunk_source(document)
            chunks_by_source[source_id] = chunks
            ledger.add_chunks(chunks)
        context.set_progress(0.35, message="Building evidence ledger")
        claim_specs = list(request.claims)
        generated_objective_claim_ids: set[str] = set()
        if not claim_specs:
            objective_statements = [item.statement for item in request.objectives]
            if not objective_statements:
                objective_statements = [
                    f"Explain the central idea of {request.topic}.",
                    f"Apply {request.topic} in a concrete example.",
                    f"Recall the key decisions in {request.topic}.",
                ]
            for index, statement in enumerate(objective_statements):
                selected_source_id = (
                    source_specs[index % len(source_specs)].source_id if source_specs else None
                )
                generated_id = _stable_id("claim", request.topic, index, statement)
                generated_objective_claim_ids.add(generated_id)
                claim_specs.append(
                    _claim_spec(
                        {
                            "claim_id": generated_id,
                            "statement": statement,
                            "source_id": selected_source_id,
                            "importance": "normal",
                        }
                    )
                )
        serialized_claims: list[dict[str, Any]] = []
        policy_threshold = 0.75 if request.grounding_mode is GroundingMode.STRICT else 0.6
        for claim_spec_item in claim_specs:
            # Generated learning objectives are instructions, not factual
            # propositions. User/fixture ClaimSpec records are externally
            # verifiable and therefore never inherit support from the brief.
            externally_verifiable = claim_spec_item.claim_id not in generated_objective_claim_ids
            claim = AtomicClaim(
                claim_spec_item.claim_id,
                claim_spec_item.statement,
                externally_verifiable=externally_verifiable,
                importance=claim_spec_item.importance,
            )
            ledger.add_claim(claim)
            if claim_spec_item.source_id:
                candidate_chunks = chunks_by_source.get(claim_spec_item.source_id, ())
            else:
                candidate_chunks = tuple(
                    chunk
                    for source_spec in source_specs
                    for chunk in chunks_by_source.get(source_spec.source_id, ())
                )
            match = verify_claim_evidence(claim, candidate_chunks)
            if match is not None:
                ledger.add_chunks((match.evidence,))
                ledger.link(
                    ClaimSupport(
                        claim.id,
                        match.evidence.id,
                        match.relation,
                        match.confidence,
                        match.rationale,
                    )
                )
            assessed = ledger.assess(claim.id, minimum_confidence=policy_threshold)
            evidence_links = (*assessed.supports, *assessed.contradictions)
            serialized_claims.append(
                {
                    "id": claim.id,
                    "statement": claim.statement,
                    "importance": claim.importance,
                    "externallyVerifiable": claim.externally_verifiable,
                    "status": assessed.status.value,
                    "evidenceChunkIds": [item.evidence_chunk_id for item in evidence_links],
                    "evidenceLinks": [
                        {
                            "evidenceChunkId": item.evidence_chunk_id,
                            "relation": item.relation.value,
                            "confidence": item.confidence,
                            "rationale": item.rationale,
                        }
                        for item in evidence_links
                    ],
                }
            )
        policy = ResearchPolicy(request.grounding_mode).evaluate(ledger)
        if not policy.accepted:
            codes = ", ".join(item.code for item in policy.findings)
            raise ValueError(f"Grounding policy rejected the evidence ledger: {codes}")
        payload = {
            "request": request.to_dict(),
            "sources": [
                {
                    "id": source_id,
                    "versionId": document.version_id,
                    "title": document.metadata.title,
                    "locator": document.metadata.locator,
                    "sha256": document.content_sha256,
                    "licenseId": document.metadata.license,
                    "creator": document.metadata.creator,
                    "artifactHash": document.metadata.attributes.get("artifactHash"),
                    "locatorMetadata": dict(document.metadata.attributes),
                }
                for source_id, document in documents
            ],
            "evidenceChunks": [
                {
                    "id": item.id,
                    "sourceId": item.source_id,
                    "sourceVersionId": item.source_version_id,
                    "ordinal": item.ordinal,
                    "text": item.text,
                    "sha256": item.content_sha256,
                    "locator": item.locator,
                }
                for item in ledger.chunks
            ],
            "claims": serialized_claims,
            "policy": {
                "mode": policy.mode.value,
                "accepted": policy.accepted,
                "findings": [asdict(item) for item in policy.findings],
            },
        }
        return self._persist_stage(context, parameters, payload, upstream_stages=[])

    def _learning_plan(self, context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
        previous = self._input_payload(parameters)
        request = _request(parameters)
        context.set_progress(0.15, message="Modeling learner and objectives")
        learner = LearnerProfile(
            request.audience,
            request.experience,
            request.locale,
            prior_knowledge=request.prerequisites,
            accessibility_needs=request.accessibility_needs,
        )
        claims = previous["claims"]
        requested = list(request.objectives)
        if not requested:
            requested = [
                _objective_spec(
                    {
                        "objective_id": _stable_id("objective", request.topic, index),
                        "statement": statement,
                        "level": level,
                    }
                )
                for index, (statement, level) in enumerate(
                    (
                        (f"Explain {request.topic} clearly.", "understand"),
                        (f"Apply {request.topic} in a worked example.", "apply"),
                        (f"Recall the key ideas in {request.topic}.", "remember"),
                    )
                )
            ]
        objectives = tuple(
            LearningObjective(
                item.objective_id,
                item.statement,
                ObjectiveLevel(item.level),
                "Explain or apply the objective without hidden steps.",
                (str(claims[index % len(claims)]["id"]),) if claims else (),
            )
            for index, item in enumerate(requested)
        )
        prerequisites = tuple(
            Prerequisite.create(label, assumed=True) for label in request.prerequisites
        )
        workflow = EducationalWorkflow(self.educational_provider)
        plan = workflow.create_plan(
            topic=request.topic,
            learner=learner,
            objectives=objectives,
            prerequisites=PrerequisiteDag(prerequisites),
            misconceptions=(
                Misconception.create(
                    f"{request.topic} can be learned by memorizing labels alone.",
                    "Understanding requires connecting the idea to a concrete example.",
                    "Can you explain why the example works?",
                ),
            ),
            target_duration_seconds=request.duration_seconds,
        )
        payload = {**previous, "learningPlan": _plan_to_dict(plan)}
        return self._persist_stage(
            context,
            parameters,
            payload,
            upstream_stages=[GenerationStage.INGEST_RESEARCH],
        )

    def _script(self, context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
        previous = self._input_payload(parameters)
        request = _request(parameters)
        context.set_progress(0.12, message="Drafting and reviewing script")
        plan = _plan_from_dict(previous["learningPlan"])
        result = EducationalWorkflow(self.educational_provider).create_script(
            plan,
            grounding=request.grounding_mode,
        )
        payload = {**previous, "scriptWorkflow": _script_workflow_to_dict(result)}
        return self._persist_stage(
            context,
            parameters,
            payload,
            upstream_stages=[GenerationStage.INGEST_RESEARCH, GenerationStage.LEARNING_PLAN],
        )

    def _storyboard(self, context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
        previous = self._input_payload(parameters)
        request = _request(parameters)
        context.set_progress(0.15, message="Compiling storyboard and visual bible")
        script = previous["scriptWorkflow"]["final"]
        visual_bible = VisualBible(
            "Precision Studio",
            {
                "paper": "#F7F8FC",
                "ink": "#151827",
                "accent": "#5658E8",
                "evidence": "#168F88",
                "review": "#DF922E",
                "critical": "#C94B67",
            },
            {
                "display": "Bricolage Grotesque",
                "body": "Atkinson Hyperlegible Next",
                "mono": "JetBrains Mono",
            },
            "precise vector diagrams and restrained evidence-led illustration",
            "frame-driven concept threads with reduced-motion alternatives",
        )
        sections = script["sections"]
        fixture_scenes = request.metadata.get("canonicalFixtureScenes")
        scenes: list[dict[str, Any]] = []
        visual_customization = request.metadata.get("visualCustomization")
        presenter_customization = (
            visual_customization.get("presenter", {})
            if isinstance(visual_customization, dict)
            else {}
        )
        if isinstance(fixture_scenes, list) and fixture_scenes:
            total_ticks = request.duration_seconds * TICKS_PER_SECOND
            base_ticks, remainder_ticks = divmod(total_ticks, len(fixture_scenes))
            for index, authored in enumerate(fixture_scenes):
                if not isinstance(authored, dict):
                    raise ValueError("Canonical fixture scenes must be objects")
                scene_id = str(authored.get("id", "")).strip()
                narration = str(authored.get("narration", "")).strip()
                if not scene_id or not narration:
                    raise ValueError("Canonical fixture scenes require id and narration")
                caption_text = str(authored.get("captionText", ""))
                fixture_on_screen_text = authored.get("onScreenText")
                if fixture_on_screen_text is not None and not isinstance(
                    fixture_on_screen_text, list
                ):
                    raise ValueError("Canonical fixture onScreenText must be a list")
                fixture_visual_beat = authored.get("visualBeat")
                if fixture_visual_beat is not None and not isinstance(fixture_visual_beat, dict):
                    raise ValueError("Canonical fixture visualBeat must be an object")
                scene = {
                    "id": scene_id,
                    "sectionId": f"fixture:{scene_id}",
                    "type": str(authored.get("type", "definition")),
                    "title": str(authored.get("title", "Untitled scene")),
                    "narration": narration,
                    "visualIntent": str(authored.get("visualIntent", "")),
                    "claimIds": [str(value) for value in authored.get("claimIds", [])],
                    "objectiveIds": [str(value) for value in authored.get("objectiveIds", [])],
                    "durationTicks": base_ticks + (1 if index < remainder_ticks else 0),
                    "accessibilityDescription": str(authored.get("accessibilityDescription", "")),
                    "onScreenText": copy.deepcopy(fixture_on_screen_text)
                    if fixture_on_screen_text is not None
                    else [line.strip() for line in caption_text.splitlines() if line.strip()],
                    "locks": [],
                }
                if fixture_visual_beat is not None:
                    scene["visualBeat"] = copy.deepcopy(fixture_visual_beat)
                if index == 0 and request.presenter_mode != "off":
                    # The canonical fixture owns its authored sequence, while
                    # the selected user presenter still needs an explicit
                    # presenter-capable opening family. Keep every other
                    # fixture scene unchanged.
                    scene["type"] = "presenter-slide"
                source_locator = authored.get("sourceLocator")
                if isinstance(source_locator, str) and source_locator:
                    scene["sourceLocator"] = source_locator
                scenes.append(scene)
        else:
            total_ticks = request.duration_seconds * TICKS_PER_SECOND
            script_metadata = script.get("metadata", {})
            if isinstance(script_metadata, dict) and script_metadata.get("provider") not in {
                None,
                "offline",
            }:
                scene_ticks = _paced_scene_ticks(sections, total_ticks)
            else:
                outline_durations = {
                    str(item["id"]): int(item["estimatedSeconds"])
                    for item in previous["learningPlan"]["outline"]
                }
                authored_ticks = [
                    max(1, outline_durations.get(str(section["outlineSectionId"]), 1))
                    * TICKS_PER_SECOND
                    for section in sections
                ]
                authored_total = sum(authored_ticks)
                if authored_total <= 0:
                    raise ValueError("Generated storyboard has no positive scene duration")
                scene_ticks = [
                    max(1, round(value * total_ticks / authored_total)) for value in authored_ticks
                ]
                scene_ticks[-1] += total_ticks - sum(scene_ticks)
            types = ("question", "definition", "worked_example", "comparison", "recap")
            for index, section in enumerate(sections):
                scene_id = _stable_id("scene", request.topic, section["outlineSectionId"])
                presenter_scene = index == 0 and request.presenter_mode != "off"
                scene = {
                    "id": scene_id,
                    "sectionId": section["outlineSectionId"],
                    # The opening is the one sparse presenter moment in the
                    # default plan.  A configured presenter can only be
                    # composited into an explicit presenter family; the
                    # renderer rejects a clip bound to an unrelated visual
                    # scene rather than guessing a placement.
                    "type": "presenter-slide"
                    if presenter_scene
                    else str(section.get("sceneType") or types[min(index, len(types) - 1)]),
                    "title": str(
                        section.get("title") or _title_from_narration(section["narration"], index)
                    ),
                    "narration": section["narration"],
                    "visualIntent": section["visualIntent"],
                    "claimIds": section["claimIds"],
                    "objectiveIds": _objective_ids_for_section(
                        previous["learningPlan"], section["outlineSectionId"]
                    ),
                    "durationTicks": scene_ticks[index],
                    "accessibilityDescription": (
                        "A precise explanatory composition presents "
                        + str(
                            section.get("title")
                            or _title_from_narration(section["narration"], index)
                        ).lower()
                    ),
                    "locks": [],
                }
                on_screen_text = section.get("onScreenText")
                if isinstance(on_screen_text, list) and on_screen_text:
                    scene["onScreenText"] = copy.deepcopy(on_screen_text)
                visual_beat = section.get("visualBeat")
                if isinstance(visual_beat, dict):
                    scene["visualBeat"] = copy.deepcopy(visual_beat)
                if presenter_scene and isinstance(presenter_customization, dict):
                    scene["presenterPlacement"] = str(
                        presenter_customization.get("placement", "picture-in-picture")
                    )
                    scene["presenterFit"] = str(presenter_customization.get("fit", "cover"))
                    profile = presenter_customization.get("profile")
                    if isinstance(profile, dict) and isinstance(profile.get("displayName"), str):
                        scene["presenterName"] = profile["displayName"]
                scenes.append(scene)
        storyboard = {
            "id": _stable_id("storyboard", _canonical(scenes), request.deterministic_seed),
            "timebase": TICKS_PER_SECOND,
            "locale": request.locale,
            "visualBible": asdict(visual_bible),
            "targets": list(request.output_targets),
            "scenes": scenes,
        }
        payload = {**previous, "storyboard": storyboard}
        return self._persist_stage(
            context,
            parameters,
            payload,
            upstream_stages=[GenerationStage.SCRIPT],
        )

    def _approval_gate(self, context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
        previous = self._input_payload(parameters)
        request = _request(parameters)
        payload = {
            **previous,
            "approval": {
                "required": True,
                "approved": False,
                "payloadClasses": ["script", "storyboard", "source-derived-evidence"],
                "provider": self.media_client.provider_id,
                "modelRevision": self.media_client.model_revision,
                "estimatedCostMicros": 0,
                "hardBudgetMicros": request.hard_budget_micros,
                "localOnly": self.media_client.provider_id.startswith("local-"),
            },
        }
        return self._persist_stage(
            context,
            parameters,
            payload,
            upstream_stages=[GenerationStage.STORYBOARD],
        )

    def _approved_storyboard(self, parameters: dict[str, Any]) -> dict[str, Any]:
        approval_revision_id = parameters.get("approvalRevisionId")
        generation_id = parameters.get("generationId")
        if not isinstance(approval_revision_id, str):
            raise ValueError("Post-approval task lacks an approval revision")
        try:
            approval_revision = self.store.get_revision(approval_revision_id)
        except KeyError as error:
            raise ValueError("Post-approval task references a missing approval revision") from error
        snapshot = approval_revision.snapshot
        payload = snapshot.get("payload")
        if (
            approval_revision.kind != "approval"
            or snapshot.get("generationId") != generation_id
            or snapshot.get("stage") != GenerationStage.APPROVAL.value
            or not isinstance(payload, dict)
        ):
            raise ValueError("Post-approval task references an invalid approval revision")
        approval = payload.get("approval")
        if not isinstance(approval, dict) or not approval.get("required") or not approval.get(
            "approved"
        ):
            raise ValueError("Post-approval task lacks an approved storyboard snapshot")
        storyboard = payload.get("storyboard")
        if not isinstance(storyboard, dict) or not isinstance(storyboard.get("scenes"), list):
            raise ValueError("Post-approval task lacks an approved storyboard")
        return copy.deepcopy(payload)

    def _assets(self, context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
        approved = self._approved_storyboard(parameters)
        request = _request(parameters)
        assets: list[dict[str, Any]] = []
        links: list[dict[str, str]] = []
        scenes = approved["storyboard"]["scenes"]
        visual_generation_mode = request.metadata.get(
            "sceneVisualGeneration", "routed"
        )
        if visual_generation_mode not in {"routed", "authored-only"}:
            raise ValueError("sceneVisualGeneration must be routed or authored-only")
        for index, scene in enumerate(scenes):
            context.check_cancelled()
            selected = _accepted_scene_visual(self.store, str(scene["id"]))
            if selected is None and visual_generation_mode == "authored-only":
                authored_fingerprint = _fingerprint(
                    {
                        "sceneId": scene["id"],
                        "mode": "authored-only",
                        "scene": scene,
                    }
                )
                self._record_scene_node(
                    str(parameters["generationId"]),
                    str(scene["id"]),
                    "asset",
                    authored_fingerprint,
                    [GenerationStage.STORYBOARD.value],
                    None,
                )
                context.set_progress((index + 1) / max(1, len(scenes)) * 0.9)
                continue
            if selected is None:
                media = self.media_client.create_visual(
                    scene, seed=request.deterministic_seed + index
                )
                self._record_media_usage(
                    context, media, scene_id=str(scene["id"]), kind="visual"
                )
                artifact = self.store.add_artifact_bytes(
                    media.content,
                    media_type=media.media_type,
                    original_name=media.original_name,
                    metadata={
                        **media.metadata,
                        "provider": media.provider_id,
                        "modelRevision": media.model_revision,
                        "sceneId": scene["id"],
                    },
                )
                provider = media.provider_id
                model_revision = media.model_revision
                media_type = media.media_type
                artifact_hash = artifact.hash
            else:
                artifact_hash = str(selected["artifactHash"])
                provider = "accepted-project-asset"
                model_revision = str(selected["provenanceId"])
                media_type = str(selected["mediaType"])
            assets.append(
                {
                    "sceneId": scene["id"],
                    "artifactHash": artifact_hash,
                    "mediaType": media_type,
                    "provider": provider,
                    "modelRevision": model_revision,
                }
            )
            links.append(
                {"artifactHash": artifact_hash, "role": "scene-visual", "stableId": scene["id"]}
            )
            self._record_scene_node(
                str(parameters["generationId"]),
                str(scene["id"]),
                "asset",
                artifact_hash,
                [GenerationStage.STORYBOARD.value],
                artifact_hash,
            )
            context.set_progress((index + 1) / max(1, len(scenes)) * 0.9)
        result = self._persist_stage(
            context,
            parameters,
            {
                "assets": assets,
                "storyboard": approved["storyboard"],
                "visualGenerationMode": visual_generation_mode,
            },
            upstream_stages=[GenerationStage.APPROVAL],
            linked_artifacts=links,
        )
        generation_id = str(parameters["generationId"])
        DependencyGraph(self.store.connection, self.store.manifest.project_id).record_node(
            self.logical_key(generation_id, GenerationStage.ASSETS.value),
            str(result["artifactHash"]),
            artifact_hash=str(result["artifactHash"]),
            upstream_keys=[
                self.logical_key(generation_id, GenerationStage.APPROVAL.value),
                *[
                    self.logical_key(generation_id, f"scene:{scene['id']}:asset")
                    for scene in scenes
                ],
            ],
        )
        return result

    def _narration(self, context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
        approved = self._approved_storyboard(parameters)
        request = _request(parameters)
        narration: list[dict[str, Any]] = []
        links: list[dict[str, str]] = []
        generation_id = str(parameters["generationId"])
        DependencyGraph(self.store.connection, self.store.manifest.project_id).record_node(
            self.logical_key(generation_id, "pronunciation"),
            _fingerprint(
                {
                    "locale": request.locale,
                    "pronunciations": request.metadata.get("pronunciations", []),
                }
            ),
            upstream_keys=[self.logical_key(generation_id, GenerationStage.SCRIPT.value)],
        )
        pending: list[dict[str, Any]] = []
        scenes = approved["storyboard"]["scenes"]
        for index, scene in enumerate(scenes):
            context.check_cancelled()
            authored_text = str(scene["narration"])
            spoken_text = (
                normalize_spoken_text(authored_text, locale=request.locale).spoken_text
                if request.locale.casefold().startswith("en")
                else authored_text
            )
            authored_word_count = len(re.findall(r"\b[\w'-]+\b", authored_text, re.UNICODE))
            spoken_word_count = len(re.findall(r"\b[\w'-]+\b", spoken_text, re.UNICODE))
            spoken_scene = {**scene, "narration": spoken_text}
            media = self.media_client.synthesize_narration(
                spoken_scene,
                locale=request.locale,
                seed=request.deterministic_seed + index,
            )
            self._record_media_usage(context, media, scene_id=str(scene["id"]), kind="narration")
            artifact = self.store.add_artifact_bytes(
                media.content,
                media_type=media.media_type,
                original_name=media.original_name,
                metadata={
                    **media.metadata,
                    "provider": media.provider_id,
                    "modelRevision": media.model_revision,
                    "sceneId": scene["id"],
                    "textSha256": hashlib.sha256(spoken_text.encode()).hexdigest(),
                    "authoredTextSha256": hashlib.sha256(authored_text.encode()).hexdigest(),
                    "authoredWordCount": authored_word_count,
                    "spokenWordCount": spoken_word_count,
                },
            )
            unscaled_word_timings = _deterministic_word_timings(spoken_text)
            duration_ms = _positive_int(
                media.metadata.get("durationMs", unscaled_word_timings[-1].end_ms),
                "narration durationMs",
            )
            word_timings, alignment = _provider_neutral_word_timings(
                spoken_text,
                duration_ms=duration_ms,
                metadata=media.metadata,
            )
            pending.append(
                {
                    "scene": scene,
                    "authoredText": authored_text,
                    "spokenText": spoken_text,
                    "authoredWordCount": authored_word_count,
                    "spokenWordCount": spoken_word_count,
                    "media": media,
                    "artifact": artifact,
                    "durationMs": duration_ms,
                    "wordTimings": word_timings,
                    "alignment": alignment,
                }
            )
            context.set_progress((index + 1) / max(1, len(scenes)) * 0.55)

        needs_alignment = [
            item for item in pending if item["alignment"].get("status") != "COMPLETE"
        ]
        if needs_alignment and self.alignment_client is not None:
            context.set_progress(0.6, message="Running pinned local forced alignment")
            aligned = self.alignment_client.align_batch(
                [
                    AlignmentInput(
                        scene_id=str(item["scene"]["id"]),
                        audio=item["media"].content,
                        media_type=item["media"].media_type,
                        text=str(item["spokenText"]),
                        locale=request.locale,
                        duration_ms=int(item["durationMs"]),
                    )
                    for item in needs_alignment
                ]
            )
            for item in needs_alignment:
                scene_id = str(item["scene"]["id"])
                evidence = aligned.get(scene_id)
                if not isinstance(evidence, dict):
                    raise ValueError(f"Forced alignment omitted narration scene {scene_id}")
                word_timings, alignment = _provider_neutral_word_timings(
                    str(item["spokenText"]),
                    duration_ms=int(item["durationMs"]),
                    metadata={**item["media"].metadata, **evidence},
                )
                if alignment.get("status") != "COMPLETE":
                    raise ValueError(f"Forced alignment did not cover narration scene {scene_id}")
                item["wordTimings"] = word_timings
                item["alignment"] = alignment

        for index, item in enumerate(pending):
            scene = item["scene"]
            media = item["media"]
            artifact = item["artifact"]
            narration.append(
                {
                    "sceneId": scene["id"],
                    "artifactHash": artifact.hash,
                    "mediaType": media.media_type,
                    "durationMs": item["durationMs"],
                    "sampleRateHz": media.metadata.get("sampleRateHz", 48_000),
                    "authoredText": item["authoredText"],
                    "spokenText": item["spokenText"],
                    "authoredWordCount": item["authoredWordCount"],
                    "spokenWordCount": item["spokenWordCount"],
                    "words": [asdict(word) for word in item["wordTimings"]],
                    "alignment": item["alignment"],
                }
            )
            links.append(
                {"artifactHash": artifact.hash, "role": "scene-narration", "stableId": scene["id"]}
            )
            self._record_scene_node(
                generation_id,
                str(scene["id"]),
                "narration",
                artifact.hash,
                [GenerationStage.SCRIPT.value, "pronunciation"],
                artifact.hash,
            )
            context.set_progress(0.65 + (index + 1) / max(1, len(scenes)) * 0.25)
        fixture_timing = os.environ.get("ALYSTRIA_MEDIA_MODE") == "fixture"
        fitted_storyboard = _fit_storyboard_to_narration(
            approved["storyboard"],
            narration,
            allow_fixture_padding=fixture_timing,
        )
        result = self._persist_stage(
            context,
            parameters,
            {"narration": narration, "storyboard": fitted_storyboard},
            upstream_stages=[GenerationStage.APPROVAL],
            linked_artifacts=links,
        )
        DependencyGraph(self.store.connection, self.store.manifest.project_id).record_node(
            self.logical_key(generation_id, GenerationStage.NARRATION.value),
            str(result["artifactHash"]),
            artifact_hash=str(result["artifactHash"]),
            upstream_keys=[
                self.logical_key(generation_id, GenerationStage.APPROVAL.value),
                self.logical_key(generation_id, "pronunciation"),
                *[
                    self.logical_key(generation_id, f"scene:{scene['id']}:narration")
                    for scene in approved["storyboard"]["scenes"]
                ],
            ],
        )
        return result

    def _captions(self, context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
        narration_payload = self._input_payload(parameters, "narration")
        narration = narration_payload["narration"]
        request = _request(parameters)
        by_scene: dict[str, list[dict[str, Any]]] = {}
        all_cues = []
        narration_by_scene = {str(item["sceneId"]): item for item in narration}
        offset_ticks = 0
        for scene in narration_payload["storyboard"]["scenes"]:
            scene_id = str(scene["id"])
            item = narration_by_scene.get(scene_id)
            if item is None:
                raise ValueError(f"Narration is missing for storyboard scene: {scene_id}")
            # Caption sidecars share the renderer's authored storyboard clock.
            # Raw synthesis durations can be shorter than the scene and must
            # not pull every later cue early.
            offset = round(offset_ticks * 1_000 / TICKS_PER_SECOND)
            scene_duration_ms = round(int(scene["durationTicks"]) * 1_000 / TICKS_PER_SECOND)
            words = tuple(WordTiming(**word) for word in item["words"])
            cues = tuple(
                replace(cue, end_ms=min(cue.end_ms, scene_duration_ms))
                for cue in captions_from_words(words, cue_prefix=scene_id)
                if cue.start_ms < scene_duration_ms
            )
            serialized = [asdict(cue) for cue in cues]
            by_scene[scene_id] = serialized
            for cue in cues:
                all_cues.append(
                    WordTiming(
                        cue.text,
                        cue.start_ms + offset,
                        cue.end_ms + offset,
                    )
                )
            offset_ticks += int(scene["durationTicks"])
        global_cues = captions_from_words(all_cues, cue_prefix="tutorial") if all_cues else ()
        vtt = to_webvtt(global_cues) if request.captions_enabled else "WEBVTT\n"
        srt = to_srt(global_cues) if request.captions_enabled else ""
        vtt_artifact = self.store.add_artifact_bytes(
            vtt.encode(),
            media_type="text/vtt",
            original_name="captions.vtt",
            metadata={"locale": request.locale, "rightsStatus": "owned"},
        )
        srt_artifact = self.store.add_artifact_bytes(
            srt.encode(),
            media_type="application/x-subrip",
            original_name="captions.srt",
            metadata={"locale": request.locale, "rightsStatus": "owned"},
        )
        transcript = "\n\n".join(
            str(scene["narration"]) for scene in narration_payload["storyboard"]["scenes"]
        )
        transcript_artifact = self.store.add_artifact_bytes(
            transcript.encode(),
            media_type="text/plain",
            original_name="transcript.txt",
            metadata={"locale": request.locale, "rightsStatus": "owned"},
        )
        context.set_progress(0.9, message="Caption and transcript sidecars built")
        return self._persist_stage(
            context,
            parameters,
            {
                "captionsEnabled": request.captions_enabled,
                "byScene": by_scene,
                "vttArtifactHash": vtt_artifact.hash,
                "srtArtifactHash": srt_artifact.hash,
                "transcriptArtifactHash": transcript_artifact.hash,
                "cueCount": len(global_cues),
            },
            upstream_stages=[GenerationStage.NARRATION],
            linked_artifacts=[
                {
                    "artifactHash": vtt_artifact.hash,
                    "role": "captions-vtt",
                    "stableId": request.locale,
                },
                {
                    "artifactHash": srt_artifact.hash,
                    "role": "captions-srt",
                    "stableId": request.locale,
                },
                {
                    "artifactHash": transcript_artifact.hash,
                    "role": "transcript",
                    "stableId": request.locale,
                },
            ],
        )

    def _presenter(self, context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
        narration_payload = self._input_payload(parameters, "narration")
        narration = narration_payload["narration"]
        request = _request(parameters)
        if request.presenter_mode == "off":
            return self._persist_stage(
                context,
                parameters,
                {"mode": "off", "presenters": []},
                upstream_stages=[GenerationStage.ASSETS, GenerationStage.NARRATION],
            )
        narration_by_scene = {item["sceneId"]: item for item in narration}
        presenters: list[dict[str, Any]] = []
        links: list[dict[str, str]] = []
        scenes = narration_payload["storyboard"]["scenes"]
        presenter_scenes = [scene for scene in scenes if _is_presenter_scene(scene)]
        selected = presenter_scenes if request.presenter_mode == "on" else presenter_scenes[:1]
        for index, scene in enumerate(selected):
            item = narration_by_scene[scene["id"]]
            # The authored scene may intentionally hold after speech for a
            # visual resolve or transition. A talking-head clip follows the
            # finished narration interval only; it must never be stretched to
            # fill the entire scene or frozen on its final frame.
            active_duration_ticks = min(
                _positive_int(scene.get("durationTicks"), "presenter scene durationTicks"),
                _positive_int(item.get("durationMs"), "presenter narration durationMs")
                * TICKS_PER_MILLISECOND,
            )
            direction = _presenter_direction(scene)
            media = self.media_client.create_presenter(
                scene,
                narration_hash=str(item["artifactHash"]),
                seed=request.deterministic_seed + index,
            )
            if media is None:
                continue
            media_duration = media.usage_units.get("seconds")
            if (
                isinstance(media_duration, (int, float))
                and not isinstance(media_duration, bool)
                and media_duration > 0
            ):
                active_duration_ticks = min(
                    active_duration_ticks,
                    max(1, int(float(media_duration) * TICKS_PER_SECOND)),
                )
            self._record_media_usage(context, media, scene_id=str(scene["id"]), kind="presenter")
            artifact = self.store.add_artifact_bytes(
                media.content,
                media_type=media.media_type,
                original_name=media.original_name,
                metadata={**media.metadata, "sceneId": scene["id"]},
            )
            presenters.append(
                {
                    "sceneId": scene["id"],
                    "artifactHash": artifact.hash,
                    "activeDurationTicks": active_duration_ticks,
                    "syntheticDisclosureRequired": True,
                    "direction": asdict(direction),
                    "fit": _presenter_fit(scene),
                    "motionProfile": str(media.metadata.get("motionProfile", "native-idle")),
                }
            )
            links.append(
                {"artifactHash": artifact.hash, "role": "scene-presenter", "stableId": scene["id"]}
            )
        return self._persist_stage(
            context,
            parameters,
            {"mode": request.presenter_mode, "presenters": presenters},
            upstream_stages=[GenerationStage.ASSETS, GenerationStage.NARRATION],
            linked_artifacts=links,
        )

    def _render(self, context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
        approved = self._approved_storyboard(parameters)
        assets = self._input_payload(parameters, "assets")
        narration = self._input_payload(parameters, "narration")
        captions = self._input_payload(parameters, "captions")
        presenter = self._input_payload(parameters, "presenter")
        request = _request(parameters)
        audio_customization = request.metadata.get("audioCustomization")
        if not isinstance(audio_customization, dict):
            audio_customization = {
                "schemaVersion": 1,
                "inputs": [],
                "mix": {"musicDuckingDb": -12.96},
            }
        visual_customization = request.metadata.get("visualCustomization")
        if not isinstance(visual_customization, dict):
            visual_customization = {
                "schemaVersion": 1,
                "assets": [],
                "presenter": {"enabled": False},
                "captionStyle": {},
                "warnings": [],
            }
        font_customization = request.metadata.get("fontCustomization")
        if not isinstance(font_customization, dict):
            font_customization = {
                "fontAssets": [],
                "typography": {
                    "displayFamily": "Bricolage Grotesque",
                    "bodyFamily": "Atkinson Hyperlegible Next",
                    "codeFamily": "JetBrains Mono",
                    "captionFamily": "Atkinson Hyperlegible Next",
                },
            }
        render_request = {
            "schemaVersion": 1,
            "generationId": parameters["generationId"],
            "timebase": TICKS_PER_SECOND,
            "seed": request.deterministic_seed,
            "targets": list(request.output_targets),
            "scenes": narration["storyboard"]["scenes"],
            "visualBible": narration["storyboard"]["visualBible"],
            "assets": assets["assets"],
            "narration": narration["narration"],
            "captions": captions,
            "presenters": _presenters_for_render(
                narration["storyboard"]["scenes"],
                presenter["presenters"],
                store=self.store,
            ),
            "audioCustomization": audio_customization,
            "visualCustomization": visual_customization,
            "fontCustomization": font_customization,
            "customization": request.metadata.get("customization"),
        }
        context.set_progress(0.15, message="Submitting immutable render request")
        cancellation_scope = getattr(self.renderer_client, "cancellation_scope", None)
        scope = (
            cancellation_scope(context.is_cancelled)
            if callable(cancellation_scope)
            else nullcontext()
        )
        with scope:
            rendered = self.renderer_client.render(render_request)
        artifact = self.store.add_artifact_bytes(
            rendered.content,
            media_type=rendered.media_type,
            original_name=rendered.original_name,
            metadata={
                "renderer": self.renderer_client.renderer_id,
                "rendererVersion": self.renderer_client.renderer_version,
                "rightsStatus": "owned",
            },
        )
        provenance_records = self._collect_render_provenance(
            assets=assets,
            narration=narration,
            captions=captions,
            presenter=presenter,
            audio_customization=audio_customization,
            render_artifact_hash=artifact.hash,
        )
        provenance_manifest = {
            "schemaVersion": 1,
            "projectId": self.store.manifest.project_id,
            "generationId": parameters["generationId"],
            "generator": IMPLEMENTATION_VERSION,
            "assets": provenance_records,
        }
        provenance_artifact = self.store.add_artifact_bytes(
            (_canonical(provenance_manifest) + "\n").encode(),
            media_type="application/vnd.alystria.provenance+json",
            original_name="provenance-manifest.json",
            metadata={"rightsStatus": "owned", "licenseId": "USER-OWNED"},
        )
        expected_artifact_hashes = sorted(record["sha256"] for record in provenance_records)
        qa_evidence = {
            "schemaVersion": 1,
            "renderArtifactHash": artifact.hash,
            "renderManifestSha256": _fingerprint(rendered.manifest),
            "rendererMetrics": rendered.metrics,
            "durationTicks": sum(
                int(scene["durationTicks"]) for scene in narration["storyboard"]["scenes"]
            ),
            "fps": float(request.output_targets[0]["fps"]),
            "captionCues": _global_caption_cues(
                narration["storyboard"]["scenes"], captions.get("byScene", {})
            ),
            "narrationAlignments": [
                {
                    "sceneId": item.get("sceneId"),
                    "alignment": copy.deepcopy(item.get("alignment")),
                }
                for item in narration.get("narration", [])
                if isinstance(item, dict)
            ],
            "contentEvidence": {
                key: approved[key]
                for key in (
                    "sources",
                    "evidenceChunks",
                    "claims",
                    "learningPlan",
                    "storyboard",
                )
            },
            "expectedArtifactHashes": expected_artifact_hashes,
            "provenanceManifestHash": provenance_artifact.hash,
        }
        qa_evidence_artifact = self.store.add_artifact_bytes(
            (_canonical(qa_evidence) + "\n").encode(),
            media_type="application/vnd.alystria.qa-evidence+json",
            original_name="qa-evidence.json",
            metadata={"rightsStatus": "owned", "licenseId": "USER-OWNED"},
        )
        candidate = {
            "renderArtifactHash": artifact.hash,
            "renderMediaType": rendered.media_type,
            "renderOriginalName": rendered.original_name,
            "renderManifest": rendered.manifest,
            "metrics": rendered.metrics,
            "qaEvidence": qa_evidence,
            "qaEvidenceHash": qa_evidence_artifact.hash,
            "provenanceManifest": provenance_manifest,
            "provenanceManifestHash": provenance_artifact.hash,
            "provenanceRecords": provenance_records,
            "renderSceneWindows": _render_scene_windows(render_request["scenes"]),
            "remainingFaults": request.repairable_faults,
            "repairAttempts": 0,
        }
        return self._persist_stage(
            context,
            parameters,
            {"candidate": candidate, "renderRequest": render_request},
            upstream_stages=[
                GenerationStage.ASSETS,
                GenerationStage.NARRATION,
                GenerationStage.CAPTIONS,
                GenerationStage.PRESENTER,
            ],
            linked_artifacts=[
                {"artifactHash": artifact.hash, "role": "render-output", "stableId": "master"},
                {
                    "artifactHash": provenance_artifact.hash,
                    "role": "provenance-manifest",
                    "stableId": "master",
                },
                {
                    "artifactHash": qa_evidence_artifact.hash,
                    "role": "qa-evidence",
                    "stableId": "master",
                },
                *[
                    {
                        "artifactHash": str(item["artifactHash"]),
                        "role": f"program-{item['role']}",
                        "stableId": str(item["assetId"]),
                    }
                    for item in audio_customization.get("inputs", [])
                    if isinstance(item, dict)
                    and isinstance(item.get("artifactHash"), str)
                    and item.get("role") in {"music", "sfx"}
                    and isinstance(item.get("assetId"), str)
                ],
            ],
        )

    def _qa(self, context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
        candidate_payload = self._input_payload(parameters, "candidate")
        candidate = dict(candidate_payload["candidate"])
        request = _request(parameters)
        evidence = candidate.get("qaEvidence")
        approved = (
            dict(evidence["contentEvidence"])
            if isinstance(evidence, dict) and isinstance(evidence.get("contentEvidence"), dict)
            else {}
        )
        remaining = int(candidate.get("remainingFaults", 0))
        gates = self._candidate_quality_gates(candidate, approved, request)
        findings = [finding for gate in gates for finding in gate.findings]
        rendered_frame_review: dict[str, Any] | None = None
        if parameters["stage"] == GenerationStage.QA_FINAL.value:
            review_result = review_rendered_frames(
                self.store,
                _rendered_frame_review_request(parameters, candidate),
                context,
                runtime=self.vision_runtime,
                ffmpeg_path=self.rendered_frame_ffmpeg_path,
                ffprobe_path=self.rendered_frame_ffprobe_path,
                extractor=self.rendered_frame_extractor,
            )
            rendered_frame_review = {
                "generationId": str(parameters["generationId"]),
                "renderArtifactHash": str(candidate["renderArtifactHash"]),
                **review_result.to_dict(),
            }
            candidate["renderedFrameReview"] = rendered_frame_review
            findings.extend(critical_review_findings(review_result))
        if remaining:
            findings.append(
                Finding(
                    "generation.test_fixture_repairable",
                    f"Test fixture has {remaining} injected repairable finding(s).",
                    Severity.MAJOR,
                    "render:master",
                    repairable=True,
                    metadata={"remaining": remaining, "testOnly": True},
                )
            )
        gate = QualityGate.from_findings(
            f"generation.{parameters['stage']}",
            "multimodal",
            findings,
            summary="Immutable renderer, audio, caption, factuality, rights, and timeline gate.",
            metadata={
                "repairAttempts": candidate.get("repairAttempts", 0),
                "subgates": [
                    {
                        "gateId": item.gate_id,
                        "category": item.category,
                        "status": item.status.value,
                    }
                    for item in gates
                ],
                "qaEvidenceHash": candidate.get("qaEvidenceHash"),
                "provenanceManifestHash": candidate.get("provenanceManifestHash"),
                "renderedFrameReview": rendered_frame_review,
            },
        )
        payload = {
            "candidate": candidate,
            "qualityGate": gate.to_dict(),
            "passed": gate.permits_export,
            "requiresHumanReview": gate.status in {GateStatus.FAIL, GateStatus.BLOCKED},
            **(
                {"renderedFrameReview": rendered_frame_review}
                if rendered_frame_review is not None
                else {}
            ),
        }
        upstream = (
            [GenerationStage.RENDER]
            if parameters["stage"] == GenerationStage.QA_INITIAL.value
            else [
                GenerationStage.REPAIR_ONE
                if parameters["stage"] == GenerationStage.QA_ONE.value
                else GenerationStage.REPAIR_TWO
            ]
        )
        return self._persist_stage(context, parameters, payload, upstream_stages=upstream)

    def _repair(self, context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
        qa = self._input_payload(parameters, "qa")
        candidate = dict(qa["candidate"])
        attempt = 1 if parameters["stage"] == GenerationStage.REPAIR_ONE.value else 2
        if attempt > MAX_AUTOMATIC_REPAIRS:
            raise ValueError("Automatic repair limit exceeded")
        changed = False
        if not qa["passed"] and int(candidate.get("remainingFaults", 0)) > 0:
            candidate["remainingFaults"] = int(candidate["remainingFaults"]) - 1
            candidate["repairAttempts"] = attempt
            changed = True
        payload = {
            "candidate": candidate,
            "repair": {
                "attempt": attempt,
                "changed": changed,
                "beforeGate": qa["qualityGate"],
            },
        }
        upstream = [GenerationStage.QA_INITIAL if attempt == 1 else GenerationStage.QA_ONE]
        return self._persist_stage(context, parameters, payload, upstream_stages=upstream)

    def _export(self, context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
        distribution_purpose = _distribution_purpose(_request(parameters))
        validate_approved_presenter_for_export(
            self.store,
            str(parameters["approvalRevisionId"]),
            distribution_scope={
                DistributionPurpose.PRIVATE: "privatePreview",
                DistributionPurpose.PUBLIC_NONCOMMERCIAL: "publicNonCommercial",
                DistributionPurpose.PUBLIC_COMMERCIAL: "publicCommercial",
            }[distribution_purpose],
        )
        approved = self._approved_storyboard(parameters)
        captions = self._input_payload(parameters, "captions")
        render = self._input_payload(parameters, "render")
        qa = self._input_payload(parameters, "qa")
        request = _request(parameters)
        candidate = dict(qa["candidate"])
        render_candidate = dict(render["candidate"])
        if (
            candidate.get("renderArtifactHash") != render_candidate.get("renderArtifactHash")
            or candidate.get("qaEvidenceHash") != render_candidate.get("qaEvidenceHash")
            or candidate.get("provenanceManifestHash")
            != render_candidate.get("provenanceManifestHash")
        ):
            raise ValueError("Export QA candidate does not match the immutable render candidate")
        final_gates = self._candidate_quality_gates(candidate, approved, request)
        blocking_codes = sorted(
            {
                finding.code
                for gate in final_gates
                if not gate.permits_export
                for finding in gate.findings
                if finding.severity in {Severity.MAJOR, Severity.CRITICAL}
            }
        )
        qa_gate_status = GateStatus(str(qa["qualityGate"]["status"]))
        if not qa["passed"] or not qa_gate_status.permits_export or blocking_codes:
            suffix = f": {', '.join(blocking_codes)}" if blocking_codes else ""
            raise ExportQualityGateError(
                f"Export blocked after {MAX_AUTOMATIC_REPAIRS} automatic repair attempts{suffix}"
            )
        storyboard = approved["storyboard"]
        running_ticks = 0
        chapters = []
        for scene in storyboard["scenes"]:
            end = running_ticks + int(scene["durationTicks"])
            chapters.append(
                {
                    "chapterId": scene["sectionId"],
                    "title": scene["title"],
                    "startTicks": running_ticks,
                    "endTicks": end,
                    "sceneIds": [scene["id"]],
                }
            )
            running_ticks = end
        sources = [
            {
                "sourceId": item["id"],
                "title": item["title"],
                "citation": item["locator"],
                "creator": item["creator"],
                "licenseId": item["licenseId"],
            }
            for item in approved["sources"]
            if item["id"] != "topic"
        ]
        manifest = {
            "schemaVersion": 1,
            "exportId": _stable_id(
                "export", parameters["generationId"], qa["candidate"]["renderArtifactHash"]
            ),
            "projectId": self.store.manifest.project_id,
            "generationId": parameters["generationId"],
            "approvalRevisionId": parameters["approvalRevisionId"],
            "title": request.topic,
            "description": f"Alystria Studio tutorial about {request.topic}.",
            "summary": f"A grounded tutorial for {request.audience}.",
            "locale": request.locale,
            "targets": list(request.output_targets),
            "files": [
                {"role": "video", "artifactHash": render["candidate"]["renderArtifactHash"]},
                {"role": "captions", "artifactHash": captions["vttArtifactHash"]},
                {"role": "captions-srt", "artifactHash": captions["srtArtifactHash"]},
                {"role": "transcript", "artifactHash": captions["transcriptArtifactHash"]},
            ],
            "chapters": chapters,
            "sources": sources,
            "qualityGate": qa["qualityGate"],
            "repairAttempts": candidate["repairAttempts"],
            "syntheticMediaDisclosure": request.presenter_mode != "off",
            "provenance": {
                "provider": self.media_client.provider_id,
                "modelRevision": self.media_client.model_revision,
                "renderer": self.renderer_client.renderer_id,
                "rendererVersion": self.renderer_client.renderer_version,
                "seed": request.deterministic_seed,
                "manifestArtifactHash": candidate["provenanceManifestHash"],
                "qaEvidenceArtifactHash": candidate["qaEvidenceHash"],
            },
        }
        video_artifact_hash = str(candidate["renderArtifactHash"])
        video_media_type = str(candidate.get("renderMediaType", "video/webm"))
        extension = {
            "video/webm": ".webm",
            "video/mp4": ".mp4",
            "application/vnd.alystria.render+json": ".render.json",
        }.get(video_media_type, ".bin")
        output_path = self.store.root / "exports" / (
            f"generation-{parameters['generationId']}{extension}"
        )
        self.store.cas.copy_to(video_artifact_hash, output_path)
        manifest["files"][0]["mediaType"] = video_media_type
        manifest["files"][0]["path"] = str(output_path)
        export_artifact = self.store.add_artifact_bytes(
            (_canonical(manifest) + "\n").encode(),
            media_type="application/vnd.alystria.export-manifest+json",
            original_name="export-manifest.json",
            metadata={"rightsStatus": "owned", "generationId": parameters["generationId"]},
        )
        payload = {
            "exportManifest": manifest,
            "exportArtifactHash": export_artifact.hash,
            "videoArtifactHash": video_artifact_hash,
            "path": str(output_path),
            "mediaType": video_media_type,
            **(
                {"renderedFrameReview": copy.deepcopy(candidate["renderedFrameReview"])}
                if isinstance(candidate.get("renderedFrameReview"), dict)
                else {}
            ),
        }
        return self._persist_stage(
            context,
            parameters,
            payload,
            upstream_stages=[GenerationStage.QA_FINAL],
            linked_artifacts=[
                {
                    "artifactHash": export_artifact.hash,
                    "role": "export-manifest",
                    "stableId": "master",
                }
            ],
        )

    def _candidate_quality_gates(
        self,
        candidate: dict[str, Any],
        approved: dict[str, Any],
        request: GenerationRequest,
    ) -> tuple[QualityGate, ...]:
        integrity_findings = self._candidate_integrity_findings(candidate)
        gates: list[QualityGate] = [
            QualityGate.from_findings(
                "generation.immutable_evidence",
                "integrity",
                integrity_findings,
                summary="QA evidence and provenance are immutable CAS objects.",
            )
        ]
        gates.extend(_renderer_quality_gates(candidate))
        gates.extend(_content_quality_gates(approved, request))
        gates.append(_provenance_quality_gate(candidate, request=request))
        return tuple(gates)

    def _candidate_integrity_findings(self, candidate: dict[str, Any]) -> tuple[Finding, ...]:
        findings: list[Finding] = []
        for field, embedded in (
            ("qaEvidenceHash", "qaEvidence"),
            ("provenanceManifestHash", "provenanceManifest"),
        ):
            digest = candidate.get(field)
            value = candidate.get(embedded)
            if not isinstance(digest, str) or not isinstance(value, dict):
                findings.append(
                    Finding(
                        "qa.evidence_missing",
                        f"Candidate lacks immutable {embedded} evidence.",
                        Severity.CRITICAL,
                        "render:master",
                    )
                )
                continue
            if not self.store.cas.verify(digest):
                findings.append(
                    Finding(
                        "qa.evidence_corrupt",
                        f"Candidate {embedded} CAS object is missing or corrupt.",
                        Severity.CRITICAL,
                        f"artifact:{digest}",
                    )
                )
                continue
            with self.store.cas.open(digest) as source:
                persisted = source.read()
            if hashlib.sha256((_canonical(value) + "\n").encode()).hexdigest() != digest:
                findings.append(
                    Finding(
                        "qa.evidence_mismatch",
                        f"Embedded {embedded} does not match its immutable CAS object.",
                        Severity.CRITICAL,
                        f"artifact:{digest}",
                    )
                )
            elif persisted != (_canonical(value) + "\n").encode():
                findings.append(
                    Finding(
                        "qa.evidence_mismatch",
                        f"Persisted {embedded} bytes do not match the candidate.",
                        Severity.CRITICAL,
                        f"artifact:{digest}",
                    )
                )
        render_hash = candidate.get("renderArtifactHash")
        if not isinstance(render_hash, str) or not self.store.cas.verify(render_hash):
            findings.append(
                Finding(
                    "qa.render_missing",
                    "Rendered delivery CAS object is missing or corrupt.",
                    Severity.CRITICAL,
                    "render:master",
                )
            )
        return tuple(findings)

    def _collect_render_provenance(
        self,
        *,
        assets: dict[str, Any],
        narration: dict[str, Any],
        captions: dict[str, Any],
        presenter: dict[str, Any],
        audio_customization: dict[str, Any],
        render_artifact_hash: str,
    ) -> list[dict[str, Any]]:
        subjects: list[tuple[str, str, str, str]] = []
        subjects.extend(
            (
                str(item["artifactHash"]),
                "scene-visual",
                self.media_client.provider_id,
                self.media_client.model_revision,
            )
            for item in assets.get("assets", [])
        )
        subjects.extend(
            (
                str(item["artifactHash"]),
                "scene-narration",
                self.media_client.provider_id,
                self.media_client.model_revision,
            )
            for item in narration.get("narration", [])
        )
        for field, role in (
            ("vttArtifactHash", "captions-vtt"),
            ("srtArtifactHash", "captions-srt"),
            ("transcriptArtifactHash", "transcript"),
        ):
            if isinstance(captions.get(field), str):
                subjects.append((str(captions[field]), role, "alystria", "caption-compiler-v1"))
        subjects.extend(
            (
                str(item["artifactHash"]),
                "scene-presenter",
                self.media_client.provider_id,
                self.media_client.model_revision,
            )
            for item in presenter.get("presenters", [])
        )
        subjects.extend(
            (
                str(item["artifactHash"]),
                f"program-{item['role']}",
                "alystria-project-asset",
                "cas-v1",
            )
            for item in audio_customization.get("inputs", [])
            if isinstance(item, dict)
            and isinstance(item.get("artifactHash"), str)
            and item.get("role") in {"music", "sfx"}
        )
        subjects.append(
            (
                render_artifact_hash,
                "render-output",
                self.renderer_client.renderer_id,
                self.renderer_client.renderer_version,
            )
        )
        return [
            self._artifact_provenance(digest, role, provider, revision)
            for digest, role, provider, revision in subjects
        ]

    def _artifact_provenance(
        self,
        digest: str,
        role: str,
        default_provider: str,
        default_revision: str,
    ) -> dict[str, Any]:
        row = self.store.connection.execute(
            "SELECT metadata_json FROM artifacts WHERE hash = ?", (digest,)
        ).fetchone()
        metadata: dict[str, Any] = {}
        if row is not None:
            loaded = json.loads(str(row["metadata_json"]))
            if isinstance(loaded, dict):
                metadata = loaded
        rights_value = str(metadata.get("rightsStatus", "unknown")).casefold()
        rights_status = "verified" if rights_value in {"owned", "verified"} else rights_value
        if rights_status not in {item.value for item in RightsStatus}:
            rights_status = RightsStatus.UNKNOWN.value
        license_id = metadata.get("licenseId", metadata.get("license"))
        if not isinstance(license_id, str) or not license_id.strip():
            license_id = "USER-OWNED" if rights_status == RightsStatus.VERIFIED.value else "UNKNOWN"
        origin_value = str(metadata.get("origin", OriginKind.GENERATED.value))
        if origin_value not in {item.value for item in OriginKind}:
            origin_value = OriginKind.GENERATED.value
        provider = str(metadata.get("provider", default_provider)).strip() or default_provider
        revision = str(metadata.get("modelRevision", default_revision)).strip() or default_revision
        creator = metadata.get("creator")
        return {
            "assetId": f"{role}:{digest[:16]}",
            "sha256": digest,
            "role": role,
            "origin": origin_value,
            "rightsStatus": rights_status,
            "licenseId": license_id,
            "creator": str(creator) if isinstance(creator, str) and creator.strip() else provider,
            "attribution": metadata.get("attribution"),
            "sourceUri": metadata.get("sourceUri"),
            "providerId": provider,
            "modelId": str(metadata.get("modelId", provider)),
            "modelRevision": revision,
            "consentIds": list(metadata.get("consentIds", [])),
        }

    def _record_scene_node(
        self,
        generation_id: str,
        scene_id: str,
        kind: str,
        fingerprint: str,
        upstream_scopes: list[str],
        artifact_hash: str | None,
    ) -> None:
        graph = DependencyGraph(self.store.connection, self.store.manifest.project_id)
        graph.record_node(
            self.logical_key(generation_id, f"scene:{scene_id}:{kind}"),
            fingerprint,
            artifact_hash=artifact_hash,
            upstream_keys=[self.logical_key(generation_id, scope) for scope in upstream_scopes],
        )

    @staticmethod
    def _record_media_usage(
        context: JobContext,
        media: GeneratedMedia,
        *,
        scene_id: str,
        kind: str,
    ) -> None:
        if media.actual_cost_micros is None:
            return
        context.record_usage(
            provider=media.provider_id,
            model=media.model_revision,
            unit="request",
            quantity=1,
            cost_micros=media.actual_cost_micros,
            idempotency_key=f"{context.task_key}:{scene_id}:{kind}",
            metadata={"sceneId": scene_id, "kind": kind, "units": media.usage_units},
        )


def _renderer_quality_gates(candidate: dict[str, Any]) -> tuple[QualityGate, ...]:
    evidence = candidate.get("qaEvidence")
    if not isinstance(evidence, dict) or not isinstance(evidence.get("rendererMetrics"), dict):
        return (
            QualityGate.from_findings(
                "media.metrics",
                "multimodal",
                (
                    Finding(
                        "qa.metric_missing",
                        "Renderer did not provide immutable QA metrics.",
                        Severity.CRITICAL,
                        "render:master",
                    ),
                ),
            ),
        )
    metrics = dict(evidence["rendererMetrics"])
    required = (
        "blankFrames",
        "captionCollisions",
        "clippedSamples",
        "integratedLufs",
        "truePeakDbtp",
        "avDriftFrames",
    )
    missing = [name for name in required if name not in metrics]
    metric_findings = [
        Finding(
            "qa.metric_missing",
            f"Renderer QA metric {name} is missing.",
            Severity.CRITICAL,
            "render:master",
            metadata={"metric": name},
        )
        for name in missing
    ]
    if metric_findings:
        return (QualityGate.from_findings("media.metrics", "multimodal", metric_findings),)
    duration_ticks = _number(evidence.get("durationTicks"), "durationTicks", minimum=1)
    fps = _number(evidence.get("fps"), "fps", minimum=0.001)
    duration_seconds = duration_ticks / TICKS_PER_SECOND
    try:
        audio_gate = check_audio(
            AudioMetrics(
                duration_seconds=duration_seconds,
                sample_rate_hz=int(metrics.get("audioSampleRateHz", 48_000)),
                channels=int(metrics.get("audioChannels", 1)),
                integrated_lufs=_number(metrics["integratedLufs"], "integratedLufs"),
                true_peak_dbtp=_number(metrics["truePeakDbtp"], "truePeakDbtp"),
                clipped_samples=int(
                    _number(metrics["clippedSamples"], "clippedSamples", minimum=0)
                ),
                asr_wer=(
                    None
                    if metrics.get("asrWer") is None
                    else _number(metrics["asrWer"], "asrWer", minimum=0)
                ),
                aligned_token_ratio=(
                    None
                    if metrics.get("alignedTokenRatio") is None
                    else _number(
                        metrics["alignedTokenRatio"],
                        "alignedTokenRatio",
                        minimum=0,
                    )
                ),
            )
        )
        drift_frames = _number(metrics["avDriftFrames"], "avDriftFrames")
        cues = tuple(
            CaptionCue(
                str(item["cueId"]),
                _number(item["startSeconds"], "caption.startSeconds", minimum=0),
                _number(item["endSeconds"], "caption.endSeconds", minimum=0),
            )
            for item in evidence.get("captionCues", [])
            if isinstance(item, dict)
        )
        timeline_gate = check_timeline(
            TimelineMetrics(
                "master",
                duration_seconds,
                duration_seconds + drift_frames / fps,
                duration_seconds,
                fps,
                cues,
            )
        )
    except (KeyError, TypeError, ValueError, OverflowError) as error:
        invalid = QualityGate.from_findings(
            "media.metrics",
            "multimodal",
            (
                Finding(
                    "qa.metric_invalid",
                    f"Renderer QA metrics are invalid: {error}",
                    Severity.CRITICAL,
                    "render:master",
                ),
            ),
        )
        return (invalid,)

    visual_findings: list[Finding] = []
    blank_frames = int(_number(metrics["blankFrames"], "blankFrames", minimum=0))
    if blank_frames:
        visual_findings.append(
            Finding(
                "visual.blank_frame",
                f"Renderer detected {blank_frames} blank frame(s).",
                Severity.CRITICAL,
                "render:master",
                evidence=str(blank_frames),
                repairable=True,
            )
        )
    collisions = int(_number(metrics["captionCollisions"], "captionCollisions", minimum=0))
    if collisions:
        visual_findings.append(
            Finding(
                "visual.caption_obstruction",
                f"Renderer detected {collisions} caption collision(s).",
                Severity.MAJOR,
                "render:master",
                evidence=str(collisions),
                repairable=True,
            )
        )
    visual_gates = [_visual_snapshot_gate(item) for item in metrics.get("visualSnapshots", [])]
    return (
        audio_gate,
        _caption_alignment_quality_gate(evidence),
        timeline_gate,
        QualityGate.from_findings("visual.renderer", "visual", visual_findings),
        *visual_gates,
    )


def _caption_alignment_quality_gate(evidence: dict[str, Any]) -> QualityGate:
    """Block caption certification when word times are estimates.

    Duration-proportional timestamps are useful for an editor placeholder, but
    they are not observed speech alignment and must never satisfy final media
    QA. Provider-native timestamps and explicit forced alignment both require
    complete token identity and coverage earlier in the narration stage.
    """

    values = evidence.get("narrationAlignments")
    findings: list[Finding] = []
    if not isinstance(values, list) or not values:
        findings.append(
            Finding(
                "audio.alignment_not_verified",
                "Narration has no verified word-alignment evidence.",
                Severity.MAJOR,
                "render:master",
                repairable=True,
            )
        )
    else:
        for value in values:
            scene_id = value.get("sceneId") if isinstance(value, dict) else None
            alignment = value.get("alignment") if isinstance(value, dict) else None
            if (
                not isinstance(alignment, dict)
                or alignment.get("status") != "COMPLETE"
                or alignment.get("source") not in {"provider-native", "forced-alignment"}
                or alignment.get("alignedTokenRatio") != 1.0
            ):
                findings.append(
                    Finding(
                        "audio.alignment_not_verified",
                        "Caption timing is estimated; provider timestamps or forced alignment are required.",
                        Severity.MAJOR,
                        f"scene:{scene_id}" if isinstance(scene_id, str) else "render:master",
                        repairable=True,
                    )
                )
    return QualityGate.from_findings(
        "media.caption_alignment",
        "audio",
        findings,
        summary="Every caption interval must be derived from observed narration timing.",
    )


def _visual_snapshot_gate(value: object) -> QualityGate:
    if not isinstance(value, dict):
        return QualityGate.from_findings(
            "visual.layout",
            "visual",
            (
                Finding(
                    "visual.invalid_snapshot",
                    "Renderer visual snapshot is not an object.",
                    Severity.CRITICAL,
                ),
            ),
        )
    try:
        elements = tuple(
            VisualElement(
                element_id=str(item["elementId"]),
                kind=ElementKind(str(item["kind"])),
                bounds=Rect(
                    _number(item["x"], "element.x"),
                    _number(item["y"], "element.y"),
                    _number(item["width"], "element.width"),
                    _number(item["height"], "element.height"),
                ),
                foreground=item.get("foreground"),
                background=item.get("background"),
                font_size_px=_number(item.get("fontSizePx", 16), "fontSizePx"),
                bold=bool(item.get("bold", False)),
                essential=bool(item.get("essential", False)),
                visible=bool(item.get("visible", True)),
            )
            for item in value.get("elements", [])
            if isinstance(item, dict)
        )
        return check_visual_snapshot(
            VisualSnapshot(
                scene_id=str(value["sceneId"]),
                tick=int(value["tick"]),
                width=int(value["width"]),
                height=int(value["height"]),
                elements=elements,
                safe_margin_ratio=_number(
                    value.get("safeMarginRatio", 0.025), "safeMarginRatio", minimum=0
                ),
            )
        )
    except (KeyError, TypeError, ValueError, OverflowError) as error:
        return QualityGate.from_findings(
            "visual.layout",
            "visual",
            (
                Finding(
                    "visual.invalid_snapshot",
                    f"Renderer visual snapshot is invalid: {error}",
                    Severity.CRITICAL,
                ),
            ),
        )


def _content_quality_gates(
    approved: dict[str, Any], request: GenerationRequest
) -> tuple[QualityGate, ...]:
    source_by_id = {
        str(item["id"]): item
        for item in approved.get("sources", [])
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    citations = tuple(
        Citation(
            citation_id=str(item["id"]),
            source_id=str(item["sourceId"]),
            locator=(
                str(item["locator"])
                if item.get("locator")
                else str(source_by_id.get(str(item["sourceId"]), {}).get("locator", ""))
            ),
            source_hash=str(item["sha256"]) if item.get("sha256") else None,
        )
        for item in approved.get("evidenceChunks", [])
        if isinstance(item, dict)
    )
    claims_by_id = {
        str(item["id"]): item
        for item in approved.get("claims", [])
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    seen_claims: set[str] = set()
    scenes: list[SceneContent] = []
    for scene in approved.get("storyboard", {}).get("scenes", []):
        if not isinstance(scene, dict):
            continue
        scene_claims: list[Claim] = []
        for claim_id_value in scene.get("claimIds", []):
            claim_id = str(claim_id_value)
            if claim_id in seen_claims:
                continue
            seen_claims.add(claim_id)
            source = claims_by_id.get(claim_id)
            if source is None:
                scene_claims.append(
                    Claim(claim_id, "", str(scene["id"]), externally_verifiable=True)
                )
                continue
            evidence_ids = tuple(str(item) for item in source.get("evidenceChunkIds", []))
            scene_claims.append(
                Claim(
                    claim_id,
                    str(source.get("statement", "")),
                    str(scene["id"]),
                    externally_verifiable=bool(source.get("externallyVerifiable", True)),
                    citation_ids=evidence_ids,
                    supported=str(source.get("status", "")).casefold() == "supported",
                )
            )
        scenes.append(
            SceneContent(
                str(scene["id"]),
                str(scene.get("narration", "")),
                tuple(str(item) for item in scene.get("objectiveIds", [])),
                tuple(scene_claims),
            )
        )
    unassigned_claims = []
    for claim_id, source in claims_by_id.items():
        if claim_id in seen_claims:
            continue
        evidence_ids = tuple(str(item) for item in source.get("evidenceChunkIds", []))
        unassigned_claims.append(
            Claim(
                claim_id,
                str(source.get("statement", "")),
                "unassigned-claims",
                externally_verifiable=bool(source.get("externallyVerifiable", True)),
                citation_ids=evidence_ids,
                supported=str(source.get("status", "")).casefold() == "supported",
            )
        )
    if unassigned_claims:
        scenes.append(
            SceneContent(
                "unassigned-claims",
                "Claims awaiting explicit scene placement.",
                (),
                tuple(unassigned_claims),
            )
        )
    package = ContentPackage(
        objectives=tuple(
            Objective(str(item["id"]), str(item.get("statement", "")))
            for item in approved.get("learningPlan", {}).get("objectives", [])
            if isinstance(item, dict)
        ),
        scenes=tuple(scenes),
        citations=citations,
    )
    return (
        *run_content_checks(package, strict=request.grounding_mode is GroundingMode.STRICT),
        _narration_density_gate(approved, request),
    )


def _narration_density_gate(approved: dict[str, Any], request: GenerationRequest) -> QualityGate:
    """Reject long-form placeholder scripts that merely stretch a few paragraphs.

    Forty-eight words per minute is intentionally a very conservative floor,
    well below normal explanatory narration. Falling under it is not a style
    preference: it indicates minutes of unplanned silence or repeated holding
    frames and must not be hidden behind otherwise green schema/claim checks.
    """

    # Short tutorials can deliberately teach one compact idea with pauses,
    # demonstrations, or media-led explanation. The 48-wpm safety floor is a
    # long-form anti-placeholder check, not a universal speech-density rule.
    if request.duration_seconds < 300:
        return QualityGate.from_findings(
            "content.narration_density",
            "content",
            (),
            summary="Long-form narration cannot be a stretched placeholder script.",
        )

    storyboard = approved.get("storyboard")
    scene_values = storyboard.get("scenes", []) if isinstance(storyboard, dict) else []
    actual_words = sum(
        len(str(scene.get("narration", "")).split())
        for scene in scene_values
        if isinstance(scene, dict)
    )
    minimum_words = max(40, (request.duration_seconds * 4 + 4) // 5)
    findings: tuple[Finding, ...] = ()
    if actual_words < minimum_words:
        findings = (
            Finding(
                "content.narration_too_sparse",
                (
                    f"Narration has {actual_words} words for a "
                    f"{request.duration_seconds}-second tutorial; at least "
                    f"{minimum_words} are required by the long-form safety floor."
                ),
                Severity.MAJOR,
                "storyboard:narration",
                repairable=True,
                metadata={
                    "actualWords": actual_words,
                    "minimumWords": minimum_words,
                    "targetDurationSeconds": request.duration_seconds,
                },
            ),
        )
    return QualityGate.from_findings(
        "content.narration_density",
        "content",
        findings,
        summary="Long-form narration cannot be a stretched placeholder script.",
    )


def _provenance_quality_gate(
    candidate: dict[str, Any], *, request: GenerationRequest
) -> QualityGate:
    records_value = candidate.get("provenanceRecords")
    evidence = candidate.get("qaEvidence")
    findings: list[Finding] = []
    if not isinstance(records_value, list) or not isinstance(evidence, dict):
        return QualityGate.from_findings(
            "security.export",
            "provenance",
            (
                Finding(
                    "export.provenance",
                    "Export provenance records are missing.",
                    Severity.CRITICAL,
                ),
            ),
        )
    records: list[AssetProvenance] = []
    for value in records_value:
        try:
            if not isinstance(value, dict):
                raise ValueError("record is not an object")
            origin = OriginKind(str(value["origin"]))
            record = AssetProvenance(
                    asset_id=str(value["assetId"]),
                    sha256=str(value["sha256"]),
                    origin=origin,
                    rights_status=RightsStatus(str(value["rightsStatus"])),
                    license_id=str(value["licenseId"]),
                    creator=(str(value["creator"]) if value.get("creator") else None),
                    attribution=(str(value["attribution"]) if value.get("attribution") else None),
                    source_uri=(str(value["sourceUri"]) if value.get("sourceUri") else None),
                    provider_id=(str(value["providerId"]) if value.get("providerId") else None),
                    model_id=str(value["modelId"]) if value.get("modelId") else None,
                    model_revision=(
                        str(value["modelRevision"]) if value.get("modelRevision") else None
                    ),
                    consent_ids=tuple(str(item) for item in value.get("consentIds", [])),
                    c2pa=C2paRecord(C2paStatus.NOT_APPLICABLE),
                )
            # Runs created before the provider adapter recorded ElevenLabs'
            # output terms are upgraded conservatively: private and attributed
            # non-commercial use are allowed, while commercial export remains
            # blocked unless an account-aware paid-plan grant is present.
            if (
                record.provider_id == "elevenlabs"
                and record.origin is OriginKind.GENERATED
                and record.rights_status is RightsStatus.UNKNOWN
                and record.license_id == "UNKNOWN"
            ):
                record = replace(
                    record,
                    rights_status=RightsStatus.VERIFIED,
                    license_id="ELEVENLABS-OUTPUT",
                    attribution="Generated with ElevenLabs (elevenlabs.io)",
                )
            records.append(record)
        except (KeyError, TypeError, ValueError) as error:
            findings.append(
                Finding(
                    "export.provenance",
                    f"Export provenance record is invalid: {error}",
                    Severity.CRITICAL,
                )
            )
    expected = {
        str(item) for item in evidence.get("expectedArtifactHashes", []) if isinstance(item, str)
    }
    recorded = {record.sha256 for record in records}
    for digest in sorted(expected - recorded):
        findings.append(
            Finding(
                "export.provenance",
                "Exported artifact has no provenance record.",
                Severity.CRITICAL,
                f"artifact:{digest}",
            )
        )
    decision = SecurityGates.export_gate(
        ExportGateInput(
            export_id=str(candidate.get("renderArtifactHash", "render:master")),
            assets=tuple(records),
            asset_use=AssetUse(
                _distribution_purpose(request),
                transformed=True,
                attribution_included=True,
            ),
            consents=(),
            required_consent_uses=(),
            captions_present=(not request.captions_enabled or bool(evidence.get("captionCues"))),
            quality_blockers=0,
            provenance_manifest_present=bool(candidate.get("provenanceManifestHash")),
        )
    )
    findings.extend(
        Finding(
            item.code,
            item.message,
            Severity.CRITICAL,
            item.subject_id,
        )
        for item in decision.findings
    )
    return QualityGate.from_findings("security.export", "provenance", findings)


def _distribution_purpose(request: GenerationRequest) -> DistributionPurpose:
    value = request.metadata.get("distributionPurpose", DistributionPurpose.PRIVATE.value)
    aliases = {
        "private": DistributionPurpose.PRIVATE,
        "privatePreview": DistributionPurpose.PRIVATE,
        "public-noncommercial": DistributionPurpose.PUBLIC_NONCOMMERCIAL,
        "publicNonCommercial": DistributionPurpose.PUBLIC_NONCOMMERCIAL,
        "public-commercial": DistributionPurpose.PUBLIC_COMMERCIAL,
        "publicCommercial": DistributionPurpose.PUBLIC_COMMERCIAL,
    }
    try:
        return aliases[str(value)]
    except KeyError as error:
        raise ValueError(f"Unsupported distribution purpose: {value!r}") from error


def _global_caption_cues(scenes: list[dict[str, Any]], by_scene: object) -> list[dict[str, Any]]:
    if not isinstance(by_scene, dict):
        return []
    result: list[dict[str, Any]] = []
    offset_seconds = 0.0
    for scene in scenes:
        for cue in by_scene.get(str(scene["id"]), []):
            if not isinstance(cue, dict):
                continue
            result.append(
                {
                    "cueId": str(cue.get("cue_id", "cue")),
                    "startSeconds": offset_seconds + int(cue["start_ms"]) / 1_000,
                    "endSeconds": offset_seconds + int(cue["end_ms"]) / 1_000,
                }
            )
        offset_seconds += int(scene["durationTicks"]) / TICKS_PER_SECOND
    return result


def _number(value: object, label: str, *, minimum: float | None = None) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"{label} must be numeric")
    result = float(value)
    if minimum is not None and result < minimum:
        raise ValueError(f"{label} must be at least {minimum}")
    return result


def _positive_int(value: object, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError(f"{label} must be a positive integer")
    return value


def _request(parameters: dict[str, Any]) -> GenerationRequest:
    value = parameters.get("request")
    if not isinstance(value, dict):
        raise ValueError("Generation parameters require a request object")
    sources_value = value.get("sources", [])
    objectives_value = value.get("objectives", [])
    claims_value = value.get("claims", [])
    if not all(isinstance(item, dict) for item in sources_value):
        raise ValueError("Generation sources must be objects")
    if not all(isinstance(item, dict) for item in objectives_value):
        raise ValueError("Generation objectives must be objects")
    if not all(isinstance(item, dict) for item in claims_value):
        raise ValueError("Generation claims must be objects")
    return GenerationRequest(
        topic=str(value["topic"]),
        audience=str(value["audience"]),
        duration_seconds=int(value["durationSeconds"]),
        locale=str(value.get("locale", "en-US")),
        experience=ExperienceLevel(str(value.get("experience", "beginner"))),
        grounding_mode=GroundingMode(str(value.get("groundingMode", "grounded"))),
        sources=tuple(SourceSpec(**item) for item in sources_value),
        objectives=tuple(_objective_spec(item) for item in objectives_value),
        claims=tuple(_claim_spec(item) for item in claims_value),
        prerequisites=tuple(str(item) for item in value.get("prerequisites", [])),
        accessibility_needs=tuple(str(item) for item in value.get("accessibilityNeeds", [])),
        output_targets=tuple(dict(item) for item in value.get("outputTargets", [])),
        presenter_mode=str(value.get("presenterMode", "auto")),
        captions_enabled=bool(value.get("captionsEnabled", True)),
        deterministic_seed=int(value.get("deterministicSeed", 0)),
        hard_budget_micros=(
            None if value.get("hardBudgetMicros") is None else int(value["hardBudgetMicros"])
        ),
        repairable_faults=int(value.get("repairableFaults", 0)),
        metadata=dict(value.get("metadata", {})),
    )


def _objective_spec(value: dict[str, Any]) -> ObjectiveSpec:
    return ObjectiveSpec(
        str(value.get("objective_id", value.get("objectiveId", ""))),
        str(value.get("statement", "")),
        str(value.get("level", "understand")),
    )


def _claim_spec(value: dict[str, Any]) -> ClaimSpec:
    source = value.get("source_id", value.get("sourceId"))
    return ClaimSpec(
        str(value.get("claim_id", value.get("claimId", ""))),
        str(value.get("statement", "")),
        None if source is None else str(source),
        str(value.get("importance", "normal")),
    )


def _plan_to_dict(plan: LearningPlan) -> dict[str, Any]:
    return {
        "topic": plan.topic,
        "learner": {
            "audience": plan.learner.audience,
            "experience": plan.learner.experience.value,
            "locale": plan.learner.locale,
            "ageRange": plan.learner.age_range,
            "priorKnowledge": list(plan.learner.prior_knowledge),
            "accessibilityNeeds": list(plan.learner.accessibility_needs),
            "goals": list(plan.learner.goals),
        },
        "objectives": [
            {
                "id": item.id,
                "statement": item.statement,
                "level": item.level.value,
                "assessment": item.assessment,
                "claimIds": list(item.claim_ids),
            }
            for item in plan.objectives
        ],
        "prerequisites": [
            {"id": item.id, "label": item.label, "assumed": item.assumed}
            for item in plan.prerequisites.nodes.values()
        ],
        "prerequisiteEdges": [list(edge) for edge in plan.prerequisites.edges],
        "misconceptions": [asdict(item) for item in plan.misconceptions],
        "outline": [
            {
                "id": item.id,
                "title": item.title,
                "objectiveIds": list(item.objective_ids),
                "teachingStrategy": item.teaching_strategy,
                "estimatedSeconds": item.estimated_seconds,
                "evidenceClaimIds": list(item.evidence_claim_ids),
            }
            for item in plan.outline
        ],
        "targetDurationSeconds": plan.target_duration_seconds,
    }


def _plan_from_dict(value: dict[str, Any]) -> LearningPlan:
    learner_value = value["learner"]
    learner = LearnerProfile(
        str(learner_value["audience"]),
        ExperienceLevel(str(learner_value["experience"])),
        str(learner_value["locale"]),
        learner_value.get("ageRange"),
        tuple(str(item) for item in learner_value.get("priorKnowledge", [])),
        tuple(str(item) for item in learner_value.get("accessibilityNeeds", [])),
        tuple(str(item) for item in learner_value.get("goals", [])),
    )
    objectives = tuple(
        LearningObjective(
            str(item["id"]),
            str(item["statement"]),
            ObjectiveLevel(str(item["level"])),
            str(item["assessment"]),
            tuple(str(claim) for claim in item.get("claimIds", [])),
        )
        for item in value["objectives"]
    )
    prerequisites = tuple(
        Prerequisite(str(item["id"]), str(item["label"]), bool(item["assumed"]))
        for item in value["prerequisites"]
    )
    misconceptions = tuple(
        Misconception(
            str(item["id"]),
            str(item["belief"]),
            str(item["correction"]),
            str(item["diagnostic_question"]),
        )
        for item in value["misconceptions"]
    )
    outline = tuple(
        OutlineSection(
            str(item["id"]),
            str(item["title"]),
            tuple(str(objective) for objective in item["objectiveIds"]),
            str(item["teachingStrategy"]),
            int(item["estimatedSeconds"]),
            tuple(str(claim) for claim in item.get("evidenceClaimIds", [])),
        )
        for item in value["outline"]
    )
    return LearningPlan(
        str(value["topic"]),
        learner,
        objectives,
        PrerequisiteDag(
            prerequisites,
            tuple((str(edge[0]), str(edge[1])) for edge in value["prerequisiteEdges"]),
        ),
        misconceptions,
        outline,
        int(value["targetDurationSeconds"]),
    )


def _draft_to_dict(draft: ScriptDraft) -> dict[str, Any]:
    return {
        "id": draft.id,
        "revision": draft.revision,
        "locale": draft.locale,
        "sections": [
            {
                "outlineSectionId": item.outline_section_id,
                "narration": item.narration,
                "visualIntent": item.visual_intent,
                "claimIds": list(item.claim_ids),
                **({"sceneType": item.scene_type} if item.scene_type else {}),
                **({"title": item.title} if item.title else {}),
                **({"onScreenText": list(item.on_screen_text)} if item.on_screen_text else {}),
                **(
                    {"visualBeat": copy.deepcopy(dict(item.visual_beat))}
                    if item.visual_beat
                    else {}
                ),
            }
            for item in draft.sections
        ],
        "wordCount": draft.word_count,
        "metadata": dict(draft.metadata),
    }


def _review_to_dict(review: ScriptReview) -> dict[str, Any]:
    return {
        "dimension": review.dimension.value,
        "issues": [asdict(issue) for issue in review.issues],
        "passed": review.passed,
    }


def _script_workflow_to_dict(result: ScriptWorkflowResult) -> dict[str, Any]:
    return {
        "initial": _draft_to_dict(result.initial),
        "final": _draft_to_dict(result.final),
        "reviews": [_review_to_dict(item) for item in result.reviews],
        "revisions": [_draft_to_dict(item) for item in result.revisions],
    }


def _title_from_narration(value: str, index: int) -> str:
    words = re.findall(r"\b[\w'-]+\b", value, re.UNICODE)
    return " ".join(words[:7]).strip().capitalize() or f"Scene {index + 1}"


def _paced_scene_ticks(sections: list[dict[str, Any]], total_ticks: int) -> list[int]:
    """Allocate the exact timeline in proportion to authored narration.

    A one-tick floor keeps even an unusually terse authored scene valid.  The
    remaining ticks use largest-remainder apportionment, so rounding is exact
    without hiding a potentially long silent hold in the final scene.
    """

    if not sections or total_ticks < len(sections):
        raise ValueError("Generated storyboard has no usable scene duration")
    if len(sections) == 1:
        return [total_ticks]
    weights = [
        max(1, len(re.findall(r"\b\w+[\w'-]*\b", str(section.get("narration", "")))))
        for section in sections
    ]
    distributable = total_ticks - len(sections)
    total_weight = sum(weights)
    ticks = [1 + distributable * weight // total_weight for weight in weights]
    fractions = [distributable * weight % total_weight for weight in weights]
    remainder = total_ticks - sum(ticks)
    for index in sorted(range(len(sections)), key=lambda item: (-fractions[item], item))[
        :remainder
    ]:
        ticks[index] += 1
    return ticks


def _is_presenter_scene(scene: dict[str, Any]) -> bool:
    scene_type = str(scene.get("type", "")).strip().casefold().replace("_", "-")
    return scene_type in PRESENTER_SCENE_TYPES


def _presenters_for_render(
    scenes: list[dict[str, Any]],
    presenters: object,
    *,
    store: ProjectStore | None = None,
) -> list[dict[str, Any]]:
    """Drop only legacy presenter clips bound to known non-presenter scenes.

    Older runs could generate clips for every scene when presenter mode was
    explicitly enabled. Those expensive clips remain in project provenance,
    but they cannot be composited into a layout that has no presenter stage.
    Unknown scene IDs and malformed bindings are retained or rejected so this
    compatibility path does not hide integrity errors.
    """

    if not isinstance(presenters, list):
        raise ValueError("Presenter stage payload must contain a presenter list")
    known_scene_ids = {str(scene.get("id", "")) for scene in scenes}
    compatible_scene_ids = {
        str(scene.get("id", "")) for scene in scenes if _is_presenter_scene(scene)
    }
    compatible: list[dict[str, Any]] = []
    for item in presenters:
        if not isinstance(item, dict):
            raise ValueError("Presenter stage payload contains a malformed binding")
        scene_id = str(item.get("sceneId", ""))
        if scene_id in compatible_scene_ids or scene_id not in known_scene_ids:
            normalized = dict(item)
            if store is not None:
                artifact_hash = normalized.get("artifactHash")
                if isinstance(artifact_hash, str):
                    row = store.connection.execute(
                        "SELECT metadata_json FROM artifacts WHERE hash=?", (artifact_hash,)
                    ).fetchone()
                    if row is not None:
                        metadata = json.loads(str(row["metadata_json"]))
                        probe = metadata.get("probe") if isinstance(metadata, dict) else None
                        duration_value = (
                            probe.get("durationSeconds") if isinstance(probe, dict) else None
                        )
                        if (
                            isinstance(duration_value, (int, float, str))
                            and not isinstance(duration_value, bool)
                            and isinstance(normalized.get("activeDurationTicks"), int)
                        ):
                            duration_ticks = max(
                                1, int(float(duration_value) * TICKS_PER_SECOND)
                            )
                            normalized["activeDurationTicks"] = min(
                                normalized["activeDurationTicks"], duration_ticks
                            )
            compatible.append(normalized)
    return compatible


def _presenter_direction(scene: dict[str, Any]) -> PresenterDirection:
    """Use an explicit semantic placement only when the storyboard requests it.

    ``picture_in_picture`` remains the sparse product default.  Full-frame,
    split, and lower-third choices are authored storyboard data rather than
    provider-supplied layout coordinates, so the renderer can map them to its
    fixed caption-safe regions.
    """

    raw = scene.get("presenterPlacement", PresenterPlacement.PICTURE_IN_PICTURE.value)
    if not isinstance(raw, str):
        raise ValueError("Presenter placement must be a string")
    normalized = raw.strip().casefold().replace("-", "_")
    # The renderer authors split compositions as ``split-left`` and
    # ``split-right`` while the provider-neutral presenter contract expresses
    # the same semantics as LEFT and RIGHT.  Translate only those exact aliases
    # after delimiter normalization; every other value remains enum-validated.
    normalized = {
        "split_left": PresenterPlacement.LEFT.value,
        "split_right": PresenterPlacement.RIGHT.value,
    }.get(normalized, normalized)
    try:
        placement = PresenterPlacement(normalized)
    except ValueError as error:
        allowed = ", ".join(item.value for item in PresenterPlacement)
        raise ValueError(f"Unsupported presenter placement {raw!r}; expected {allowed}") from error
    return PresenterDirection(
        placement=placement,
        background="transparent",
        eye_contact_required=True,
    )


def _presenter_fit(scene: dict[str, Any]) -> str:
    raw = scene.get("presenterFit", "cover")
    if raw not in {"cover", "contain"}:
        raise ValueError("Presenter fit must be cover or contain")
    return str(raw)


def _objective_ids_for_section(plan: dict[str, Any], section_id: str) -> list[str]:
    for section in plan["outline"]:
        if section["id"] == section_id:
            return [str(item) for item in section["objectiveIds"]]
    return []


def _fit_storyboard_to_narration(
    storyboard: dict[str, Any],
    narration: list[dict[str, Any]],
    *,
    allow_fixture_padding: bool = False,
) -> dict[str, Any]:
    """Fit every scene to measured audio while preserving the exact total."""

    fitted = copy.deepcopy(storyboard)
    scenes = fitted.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("Narration timing requires a non-empty storyboard")
    narration_by_scene = {str(item.get("sceneId")): item for item in narration}
    total_ticks = sum(
        _positive_int(scene.get("durationTicks"), "storyboard durationTicks")
        for scene in scenes
    )
    measured_ticks: list[int] = []
    for scene in scenes:
        scene_id = str(scene.get("id", ""))
        item = narration_by_scene.get(scene_id)
        if item is None:
            raise ValueError(f"Narration timing is missing storyboard scene {scene_id!r}")
        measured_ticks.append(
            _positive_int(item.get("durationMs"), "narration durationMs")
            * TICKS_PER_MILLISECOND
        )
    measured_total = sum(measured_ticks)
    if measured_total > total_ticks:
        overrun_ms = round((measured_total - total_ticks) / TICKS_PER_MILLISECOND)
        raise ValueError(
            f"Measured narration exceeds the requested tutorial duration by {overrun_ms} ms"
        )
    unvoiced_ticks = total_ticks - measured_total
    maximum_unvoiced_ticks = min(
        len(scenes) * MAX_UNAUTHORED_VISUAL_TAIL_MS * TICKS_PER_MILLISECOND,
        int(total_ticks * MAX_UNAUTHORED_VISUAL_TAIL_RATIO),
    )
    if unvoiced_ticks > maximum_unvoiced_ticks and not allow_fixture_padding:
        unvoiced_ms = round(unvoiced_ticks / TICKS_PER_MILLISECOND)
        maximum_ms = round(maximum_unvoiced_ticks / TICKS_PER_MILLISECOND)
        raise ValueError(
            f"Measured narration leaves {unvoiced_ms} ms unvoiced; automatic visual tails "
            f"are limited to {maximum_ms} ms. Revise and approve the narration pacing "
            "instead of padding finished scenes."
        )
    breath, remainder = divmod(unvoiced_ticks, len(scenes))
    for index, (scene, audio_ticks) in enumerate(zip(scenes, measured_ticks, strict=True)):
        visual_tail_ticks = breath + (1 if index < remainder else 0)
        scene["durationTicks"] = audio_ticks + visual_tail_ticks
        scene["visualTailTicks"] = visual_tail_ticks
        scene["timingSource"] = (
            "fixture-duration-padding"
            if allow_fixture_padding and unvoiced_ticks > maximum_unvoiced_ticks
            else "measured-narration+bounded-visual-tail"
        )
    return fitted


def _deterministic_word_timings(
    text: str, *, duration_ms: int | None = None
) -> tuple[WordTiming, ...]:
    matches = list(re.finditer(r"\b[\w'-]+\b|[.,!?;:]", text, re.UNICODE))
    timings: list[WordTiming] = []
    current = 0
    for match in matches:
        token = match.group()
        duration = 80 if re.fullmatch(r"[.,!?;:]", token) else max(120, min(360, len(token) * 35))
        timings.append(
            WordTiming(
                token,
                current,
                current + duration,
                match.start(),
                match.end(),
                1.0,
            )
        )
        current += duration + (100 if token in {".", "!", "?"} else 30)
    if not timings:
        return (WordTiming("Narration", 0, 800, 0, len(text), 1.0),)
    if duration_ms is not None:
        if duration_ms <= 0:
            raise ValueError("Narration duration must be positive")
        scale = duration_ms / timings[-1].end_ms
        timings = [
            replace(
                timing,
                start_ms=round(timing.start_ms * scale),
                end_ms=round(timing.end_ms * scale),
            )
            for timing in timings
        ]
        timings[-1] = replace(timings[-1], end_ms=duration_ms)
    return tuple(timings)


def _accepted_scene_visual(store: ProjectStore, scene_id: str) -> dict[str, Any] | None:
    """Resolve one user-accepted raster binding from the current durable project head."""

    head = store.head_revision()
    if head is None:
        return None
    scene_values = head.snapshot.get("scenes")
    if not isinstance(scene_values, list):
        return None
    scenes = [
        value
        for value in scene_values
        if isinstance(value, dict) and value.get("id") == scene_id
    ]
    if len(scenes) != 1:
        return None
    scene = scenes[0]
    asset_id = scene.get("visualAssetId")
    digest = scene.get("visualArtifactHash")
    if asset_id is None and digest is None:
        return None
    if not isinstance(asset_id, str) or not isinstance(digest, str):
        raise ValueError(f"Accepted visual binding for scene {scene_id} is incomplete")
    assets = head.snapshot.get("mediaAssets")
    provenances = head.snapshot.get("assetProvenance")
    if not isinstance(assets, list) or not isinstance(provenances, list):
        raise ValueError(f"Accepted visual binding for scene {scene_id} lacks provenance")
    matching_assets = [
        value
        for value in assets
        if isinstance(value, dict) and value.get("id") == asset_id
    ]
    if len(matching_assets) != 1:
        raise ValueError(f"Accepted visual asset for scene {scene_id} is not unique")
    asset = matching_assets[0]
    media_type = asset.get("mediaType")
    if (
        asset.get("artifactHash") != digest
        or asset.get("state") != "promoted"
        or media_type not in {"image/png", "image/jpeg", "image/webp"}
    ):
        raise ValueError(f"Accepted visual asset for scene {scene_id} is invalid")
    provenance_id = asset.get("provenanceId")
    matching_provenance = [
        value
        for value in provenances
        if isinstance(value, dict)
        and value.get("id") == provenance_id
        and value.get("assetId") == asset_id
    ]
    if (
        len(matching_provenance) != 1
        or matching_provenance[0].get("exportEligible") is not True
        or matching_provenance[0].get("blockers") not in (None, [])
    ):
        raise ValueError(f"Accepted visual asset for scene {scene_id} is not export eligible")
    row = store.connection.execute(
        "SELECT media_type FROM artifacts WHERE hash=?", (digest,)
    ).fetchone()
    if row is None or row["media_type"] != media_type or not store.cas.verify(digest):
        raise ValueError(f"Accepted visual artifact for scene {scene_id} is missing or corrupt")
    return {
        "artifactHash": digest,
        "mediaType": media_type,
        "provenanceId": provenance_id,
    }


def _provider_neutral_word_timings(
    text: str,
    *,
    duration_ms: int,
    metadata: Mapping[str, Any],
) -> tuple[tuple[WordTiming, ...], dict[str, Any]]:
    """Normalize every TTS/alignment route into one renderer-safe timeline.

    A speech provider may return native word timing, or an independently
    selected aligner may attach forced-alignment timing.  Both use the same
    bounded metadata shape.  Routes without either capability retain full
    functionality through deterministic duration-proportional timing.
    Provider identifiers never enter the renderer contract.
    """

    alignment_value = metadata.get("alignment")
    alignment = alignment_value if isinstance(alignment_value, Mapping) else {}
    raw_words = metadata.get("wordTimings", alignment.get("words"))
    source_hint = metadata.get("alignmentSource", alignment.get("source"))
    engine_hint = metadata.get("alignmentEngine", alignment.get("engine"))
    if isinstance(raw_words, list) and 0 < len(raw_words) <= 4_096:
        parsed: list[WordTiming] = []
        try:
            for raw in raw_words:
                if not isinstance(raw, Mapping):
                    raise ValueError("word timing must be an object")
                token = raw.get("token", raw.get("word"))
                start = raw.get("startMs", raw.get("start_ms"))
                end = raw.get("endMs", raw.get("end_ms"))
                confidence = raw.get("confidence")
                if not isinstance(token, str) or not token.strip():
                    raise ValueError("word timing token is missing")
                if (
                    not isinstance(start, int)
                    or isinstance(start, bool)
                    or not isinstance(end, int)
                    or isinstance(end, bool)
                    or start < 0
                    or end <= start
                    or end > duration_ms
                ):
                    raise ValueError("word timing range is outside narration")
                if confidence is not None and (
                    not isinstance(confidence, (int, float))
                    or isinstance(confidence, bool)
                    or not 0 <= float(confidence) <= 1
                ):
                    raise ValueError("word timing confidence is invalid")
                parsed.append(
                    WordTiming(
                        token.strip(),
                        start,
                        end,
                        confidence=None if confidence is None else float(confidence),
                    )
                )
            # AlignmentResult applies the same monotonic ordering invariant,
            # but keep this helper independent from provider SDK structures.
            if any(
                current.start_ms < previous.start_ms
                for previous, current in itertools.pairwise(parsed)
            ):
                raise ValueError("word timings are not monotonic")
            expected_tokens = [
                match.group()
                for match in re.finditer(r"\b[\w'-]+\b", text, re.UNICODE)
            ]
            normalized_expected = [token.casefold() for token in expected_tokens]
            normalized_actual = [
                token.casefold()
                for timing in parsed
                for token in re.findall(r"[\w'-]+", timing.token, re.UNICODE)
            ]
            actual_index = 0
            matched = 0
            for expected in normalized_expected:
                while actual_index < len(normalized_actual):
                    actual = normalized_actual[actual_index]
                    actual_index += 1
                    if actual == expected:
                        matched += 1
                        break
            aligned_ratio = min(1.0, matched / max(1, len(normalized_expected)))
            if aligned_ratio < 0.5:
                raise ValueError("word timing coverage is too low")
            source = (
                "forced-alignment"
                if source_hint == "forced-alignment"
                else "provider-native"
            )
            engine = (
                str(engine_hint).strip()[:120]
                if isinstance(engine_hint, str) and engine_hint.strip()
                else "native-word-timing"
            )
            return tuple(parsed), {
                "schemaVersion": 1,
                "status": "COMPLETE" if aligned_ratio >= 0.98 else "PARTIAL",
                "source": source,
                "engine": engine,
                "alignedTokenRatio": aligned_ratio,
            }
        except (TypeError, ValueError):
            # Untrusted provider metadata cannot break a route that still has
            # valid audio. Fall through to the deterministic portable path.
            pass

    fallback = _deterministic_word_timings(text, duration_ms=duration_ms)
    return fallback, {
        "schemaVersion": 1,
        "status": "ESTIMATED",
        "source": "duration-proportional",
        "engine": "duration-proportional-v1",
        "alignedTokenRatio": None,
    }
