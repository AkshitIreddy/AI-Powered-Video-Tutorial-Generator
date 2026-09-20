"""Application-facing lifecycle service for durable tutorial generations."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import tempfile
import uuid
from dataclasses import replace
from pathlib import Path
from typing import Any

from alystria.jobs import DependencyGraph, Job, JobState, SQLiteWorkflowRuntime
from alystria.jobs.runtime import TaskHandler
from alystria.project import ProjectStore
from alystria.project.database import transaction
from alystria.project.errors import RevisionConflictError
from alystria.project.models import utc_now
from alystria.project_customization import validate_customization
from alystria.providers import parse_routing_policy
from alystria.rendered_frame_review import FrameExtractor, RoutedVisionRuntime
from alystria.research import EducationalProvider
from alystria.security.files import detect_mime
from alystria.sources import (
    DOCLING_SUFFIXES,
    DoclingExtractor,
    DocumentExtractor,
    SourceLoadError,
)

from .adapters import GenerationMediaClient, RendererClient
from .audio_assets import resolve_audio_customization
from .font_customization import resolve_font_customization
from .forced_alignment import ForcedAlignmentClient
from .models import (
    ALL_STAGES,
    POST_APPROVAL_STAGES,
    PRE_APPROVAL_STAGES,
    ClaimSpec,
    GenerationRequest,
    GenerationStage,
    GenerationState,
    GenerationStatus,
    ObjectiveSpec,
    SourceSpec,
    StageStatus,
)
from .visual_customization import resolve_visual_customization
from .workflow import ExportQualityGateError, GenerationWorkflow, _apply_presenter_selection


class GenerationNotFoundError(KeyError):
    pass


class ApprovalNotReadyError(RuntimeError):
    pass


MAX_DESKTOP_SOURCE_BYTES = 8 * 1024 * 1024
MAX_DESKTOP_SOURCE_CHARS = 2_000_000
CANONICAL_FIXTURE_PATHS = {
    "fixture.karatsuba.undergraduate.en": Path("karatsuba") / "fixture.json",
}
_TEXT_SOURCE_SUFFIXES = frozenset(
    {
        ".c",
        ".cc",
        ".cpp",
        ".css",
        ".csv",
        ".go",
        ".h",
        ".hpp",
        ".html",
        ".ini",
        ".java",
        ".js",
        ".json",
        ".jsonl",
        ".jsx",
        ".md",
        ".markdown",
        ".ps1",
        ".py",
        ".rs",
        ".rst",
        ".sh",
        ".sql",
        ".srt",
        ".toml",
        ".ts",
        ".tsx",
        ".txt",
        ".vtt",
        ".xml",
        ".yaml",
        ".yml",
    }
)
_TEXT_SOURCE_MEDIA_TYPES = frozenset(
    {
        "application/json",
        "application/sql",
        "application/toml",
        "application/xml",
        "application/x-httpd-php",
        "application/x-ndjson",
        "application/x-sh",
        "application/x-yaml",
        "application/yaml",
        "text/csv",
        "text/markdown",
        "text/plain",
        "text/x-c",
        "text/x-c++src",
        "text/x-java-source",
        "text/x-python",
        "text/x-rust",
        "text/x-script.python",
        "text/yaml",
    }
)
_DOCUMENT_MEDIA_SUFFIXES = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "image/bmp": ".bmp",
    "image/heic": ".heic",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/tiff": ".tiff",
    "image/webp": ".webp",
}


def _canonical_fixture_id_from_topic(topic: str) -> str | None:
    """Recover the narrowly branded flagship identity from legacy projects.

    Desktop builds created before ``canonicalFixtureId`` was persisted still
    contain the exact user brief. Keep this matcher aligned with the desktop
    creation rule: a generic Karatsuba request must continue through the chosen
    generation path and must not be silently replaced by the bundled flagship.
    """

    normalized = re.sub(r"\s+", " ", topic).strip()
    asks_for_karatsuba = re.search(r"\bkaratsuba\b", normalized, re.IGNORECASE)
    asks_for_flagship = re.search(
        r"\bcanonical\b|\b(?:12|twelve)[ -]minute\b",
        normalized,
        re.IGNORECASE,
    )
    if asks_for_karatsuba and asks_for_flagship:
        return "fixture.karatsuba.undergraduate.en"
    return None


class GenerationCoordinator:
    """Narrow service suitable for desktop generation start/status controls."""

    def __init__(
        self,
        store: ProjectStore,
        runtime: SQLiteWorkflowRuntime | None = None,
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
        self.runtime = runtime or SQLiteWorkflowRuntime(store.connection)
        self.workflow = GenerationWorkflow(
            store,
            self.runtime,
            media_client=media_client,
            renderer_client=renderer_client,
            educational_provider=educational_provider,
            alignment_client=alignment_client,
            vision_runtime=vision_runtime,
            rendered_frame_ffmpeg_path=rendered_frame_ffmpeg_path,
            rendered_frame_ffprobe_path=rendered_frame_ffprobe_path,
            rendered_frame_extractor=rendered_frame_extractor,
        )
        self._media_cancel = getattr(self.workflow.media_client, "cancel", None)
        self._media_reset_cancellation = getattr(
            self.workflow.media_client, "reset_cancellation", None
        )

    def start(
        self,
        request: GenerationRequest,
        *,
        generation_id: str | None = None,
    ) -> GenerationStatus:
        identifier = generation_id or str(uuid.uuid4())
        try:
            identifier = str(uuid.UUID(identifier))
        except ValueError as error:
            raise ValueError("generation_id must be a UUID") from error
        existing = self._jobs(identifier)
        if existing:
            existing_request = existing[0].parameters.get("request")
            normalized_request = json.loads(json.dumps(request.to_dict()))
            if existing_request != normalized_request:
                raise ValueError("generation_id already belongs to a different request")
            return self.status(identifier)
        # The five pre-approval jobs form one accepted desktop operation. A
        # process interruption or validation failure must expose all of them or
        # none of them to the autonomous runner.
        with transaction(self.store.connection):
            self.workflow.enqueue_pre_approval(generation_id=identifier, request=request)
        return self.status(identifier)

    def status(self, generation_id: str) -> GenerationStatus:
        all_jobs = self._jobs(generation_id)
        if not all_jobs:
            raise GenerationNotFoundError(generation_id)
        approval_revision = self._approval_revision(generation_id)
        jobs = _current_generation_jobs(all_jobs, approval_revision)
        by_stage = {
            GenerationStage(str(job.parameters["stage"])): job
            for job in jobs
            if isinstance(job.parameters.get("stage"), str)
        }
        stage_statuses: list[StageStatus] = []
        for stage in ALL_STAGES:
            job = by_stage.get(stage)
            if job is None:
                continue
            result = job.result or {}
            stage_statuses.append(
                StageStatus(
                    stage,
                    job.job_id,
                    job.state.value,
                    job.progress,
                    _optional_string(result.get("artifactHash")),
                    _optional_string(result.get("revisionId")),
                    job.error,
                )
            )
        export_job = by_stage.get(GenerationStage.EXPORT)
        approval_job = by_stage.get(GenerationStage.APPROVAL)
        failed = [job for job in jobs if job.state is JobState.FAILED]
        active = [
            job
            for job in jobs
            if job.state
            in {
                JobState.BLOCKED,
                JobState.READY,
                JobState.QUEUED,
                JobState.RUNNING,
                JobState.RETRY_WAIT,
            }
        ]
        control_state = self._control_state(generation_id)
        if control_state == "CANCELLED":
            state = GenerationState.CANCELLED
        elif export_job is not None and export_job.state is JobState.SUCCEEDED:
            state = GenerationState.SUCCEEDED
        elif failed:
            state = GenerationState.FAILED
        elif not active and any(job.state is JobState.CANCELLED for job in jobs):
            state = GenerationState.CANCELLED
        elif (
            approval_job is not None
            and approval_job.state is JobState.SUCCEEDED
            and all(stage not in by_stage for stage in POST_APPROVAL_STAGES)
        ):
            state = GenerationState.WAITING_APPROVAL
        elif any(job.state is JobState.RUNNING for job in jobs):
            state = GenerationState.RUNNING
        else:
            state = GenerationState.QUEUED
        expected = len(ALL_STAGES)
        progress = (
            sum(
                1.0 if job.state is JobState.SUCCEEDED else job.progress
                for job in by_stage.values()
            )
            / expected
        )
        export_result = export_job.result if export_job is not None else None
        export_payload: dict[str, Any] = {}
        if isinstance(export_result, dict):
            payload_value = export_result.get("payload")
            if isinstance(payload_value, dict):
                export_payload = payload_value
        return GenerationStatus(
            generation_id,
            self.store.manifest.project_id,
            state,
            min(1.0, progress),
            approval_revision,
            None if export_result is None else _optional_string(export_result.get("revisionId")),
            (
                None
                if export_result is None
                else _optional_string(
                    (export_result.get("payload") or {}).get("exportArtifactHash")
                    if isinstance(export_result.get("payload"), dict)
                    else None
                )
            ),
            tuple(stage_statuses),
            self._invalidated_scopes(generation_id),
            _optional_string(export_payload.get("path")),
            _optional_string(export_payload.get("mediaType")),
            _optional_string(export_payload.get("videoArtifactHash")),
        )

    def approve(
        self,
        generation_id: str,
        *,
        name: str = "Approved storyboard",
        message: str = "Approved generation plan, storyboard, privacy, and rights gates",
        expected_head_revision_id: str | None = None,
    ) -> GenerationStatus:
        status = self.status(generation_id)
        if status.state is GenerationState.SUCCEEDED:
            return status
        if status.state is GenerationState.CANCELLED:
            raise ApprovalNotReadyError("Cancelled generation must be retried before approval")
        jobs = self._jobs(generation_id)
        approval_job = next(
            (job for job in jobs if job.parameters.get("stage") == GenerationStage.APPROVAL.value),
            None,
        )
        if approval_job is None or approval_job.state is not JobState.SUCCEEDED:
            raise ApprovalNotReadyError("Storyboard approval gate is not ready")
        with transaction(self.store.connection):
            reviewed_head = self.store.head_revision()
            if reviewed_head is None:
                raise ApprovalNotReadyError("Project has no reviewed snapshot to approve")
            if (
                expected_head_revision_id is not None
                and reviewed_head.revision_id != expected_head_revision_id
            ):
                raise RevisionConflictError(
                    f"Expected head {expected_head_revision_id}, but current head is "
                    f"{reviewed_head.revision_id}"
                )
            request = _request_with_reviewed_presenter_selection(
                self.store,
                _request_from_job(approval_job.parameters),
                reviewed_head.snapshot,
            )
            request_visual_generation_mode = _request_visual_generation_mode(request)
            image_generation_approved = _request_image_generation_approved(request)
            existing_revision = self._approval_revision(generation_id)
            if existing_revision is None:
                if approval_job.result is None or not isinstance(
                    approval_job.result.get("payload"), dict
                ):
                    raise ApprovalNotReadyError("Approval gate payload is unavailable")
                approval_payload = _freeze_reviewed_approval_payload(
                    approval_job.result["payload"],
                    reviewed_head.snapshot,
                    generation_id=generation_id,
                    reviewed_revision_id=reviewed_head.revision_id,
                    request_visual_generation_mode=request_visual_generation_mode,
                    image_generation_approved=image_generation_approved,
                    request=request,
                )
                supersedes_revision_id = None
            elif status.state is GenerationState.FAILED:
                if expected_head_revision_id is None:
                    raise ApprovalNotReadyError(
                        "Reapproving failed narration requires the exact reviewed head revision"
                    )
                if approval_job.result is None or not isinstance(
                    approval_job.result.get("payload"), dict
                ):
                    raise ApprovalNotReadyError("Approval gate payload is unavailable")
                approval_payload = _freeze_reviewed_approval_payload(
                    approval_job.result["payload"],
                    reviewed_head.snapshot,
                    generation_id=generation_id,
                    reviewed_revision_id=reviewed_head.revision_id,
                    request_visual_generation_mode=request_visual_generation_mode,
                    image_generation_approved=image_generation_approved,
                    request=request,
                )
                previous_payload = self.store.get_revision(existing_revision).snapshot.get(
                    "payload"
                )
                if not isinstance(previous_payload, dict):
                    raise ApprovalNotReadyError("Prior approval payload is unavailable")
                _prepare_failed_media_reapproval(
                    self.runtime,
                    jobs,
                    approval_revision_id=existing_revision,
                    previous_payload=previous_payload,
                    reviewed_payload=approval_payload,
                    request_visual_generation_mode=request_visual_generation_mode,
                )
                supersedes_revision_id = existing_revision
            else:
                if reviewed_head.kind == "edit":
                    previous_payload = self.store.get_revision(existing_revision).snapshot.get(
                        "payload"
                    )
                    if not isinstance(previous_payload, dict):
                        raise ApprovalNotReadyError("Prior approval payload is unavailable")
                    if approval_job.result is None or not isinstance(
                        approval_job.result.get("payload"), dict
                    ):
                        raise ApprovalNotReadyError("Approval gate payload is unavailable")
                    reviewed_payload = _freeze_reviewed_approval_payload(
                        approval_job.result["payload"],
                        reviewed_head.snapshot,
                        generation_id=generation_id,
                        reviewed_revision_id=reviewed_head.revision_id,
                        request_visual_generation_mode=request_visual_generation_mode,
                        image_generation_approved=image_generation_approved,
                        request=request,
                    )
                    if _reviewed_scene_prose_changed(
                        previous_payload, reviewed_payload
                    ) or _reviewed_visual_generation_changed(
                        previous_payload,
                        reviewed_payload,
                        fallback=request_visual_generation_mode,
                    ) or _reviewed_presenter_assignments_changed(
                        previous_payload, reviewed_payload
                    ):
                        raise ApprovalNotReadyError(
                            "Reviewed content cannot be reapproved while post-approval "
                            "media work is active"
                        )
                approval_revision_id = existing_revision

            if existing_revision is None or status.state is GenerationState.FAILED:
                approval_payload["approval"] = {
                    **dict(approval_payload.get("approval", {})),
                    "approved": True,
                    **(
                        {"supersedesApprovalRevisionId": supersedes_revision_id}
                        if supersedes_revision_id is not None
                        else {}
                    ),
                }
                snapshot = copy.deepcopy(reviewed_head.snapshot)
                snapshot.update(
                    {
                        "projectId": self.store.manifest.project_id,
                        "generationId": generation_id,
                        "stage": GenerationStage.APPROVAL.value,
                        "payload": approval_payload,
                    }
                )
                revision = self.store.create_revision(
                    snapshot=snapshot,
                    kind="approval",
                    name=name,
                    message=message,
                    expected_head=reviewed_head.revision_id,
                )
                approval_revision_id = revision.revision_id
            self.workflow.enqueue_post_approval(
                generation_id=generation_id,
                request=request,
                approval_job_id=approval_job.job_id,
                approval_revision_id=approval_revision_id,
            )
        return self.status(generation_id)

    def cancel(self, generation_id: str) -> GenerationStatus:
        all_jobs = self._jobs(generation_id)
        if not all_jobs:
            raise GenerationNotFoundError(generation_id)
        if self.status(generation_id).state is GenerationState.SUCCEEDED:
            return self.status(generation_id)
        jobs = _current_generation_jobs(all_jobs, self._approval_revision(generation_id))
        for job in jobs:
            if job.state not in {
                JobState.SUCCEEDED,
                JobState.FAILED,
                JobState.CANCELLED,
                JobState.STALE,
            }:
                self.runtime.cancel(job.job_id)
        self._set_control_state(generation_id, "CANCELLED")
        if callable(self._media_cancel):
            self._media_cancel()
        return self.status(generation_id)

    def retry(self, generation_id: str) -> GenerationStatus:
        all_jobs = self._jobs(generation_id)
        if not all_jobs:
            raise GenerationNotFoundError(generation_id)
        jobs = _current_generation_jobs(all_jobs, self._approval_revision(generation_id))
        if callable(self._media_reset_cancellation):
            self._media_reset_cancellation()
        with transaction(self.store.connection):
            cancelled_control = self._control_state(generation_id) == "CANCELLED"
            retried = False
            final_qa = self._policy_retry_qa_job(jobs)
            if final_qa is not None:
                # Export policy is evaluated by QA_FINAL as well as EXPORT. A
                # local policy/code update must create a new QA stage artifact
                # and revision instead of making export consume the prior
                # decision again. mark_stale + retry preserves the old CAS
                # object, revision, attempts, and events as immutable history.
                self.runtime.mark_stale(
                    final_qa.job_id,
                    reason="export_policy_recheck",
                )
                self.runtime.retry(final_qa.job_id)
                retried = True
            for job in jobs:
                if job.state in {JobState.FAILED, JobState.CANCELLED, JobState.STALE}:
                    self.runtime.retry(job.job_id)
                    retried = True
            if cancelled_control:
                self._clear_control_state(generation_id)
                retried = True
            if not retried:
                raise ValueError("Generation has no failed, cancelled, or stale stages to retry")
        return self.status(generation_id)

    @staticmethod
    def _policy_retry_qa_job(jobs: list[Job]) -> Job | None:
        """Return final QA only when export failed solely on its quality gate.

        ``ExportQualityGateError`` identifies new failures precisely. The
        message fallback recovers projects created before that exception type
        existed, which persisted the same failure as a generic ``ValueError``.
        """

        by_stage = {
            str(job.parameters.get("stage")): job
            for job in jobs
            if isinstance(job.parameters.get("stage"), str)
        }
        export = by_stage.get(GenerationStage.EXPORT.value)
        final_qa = by_stage.get(GenerationStage.QA_FINAL.value)
        if (
            export is None
            or export.state is not JobState.FAILED
            or final_qa is None
            or final_qa.state is not JobState.SUCCEEDED
        ):
            return None
        if any(
            job.job_id != export.job_id
            and job.state in {JobState.FAILED, JobState.CANCELLED, JobState.STALE}
            for job in jobs
        ):
            return None
        error = export.error
        if not isinstance(error, dict):
            return None
        exception_type = error.get("exceptionType")
        message = error.get("message")
        is_quality_failure = exception_type == ExportQualityGateError.__name__ or (
            exception_type == "ValueError"
            and isinstance(message, str)
            and message.startswith("Export blocked after ")
        )
        if not is_quality_failure:
            return None
        result = final_qa.result
        payload = result.get("payload") if isinstance(result, dict) else None
        if not isinstance(payload, dict):
            return None
        gate = payload.get("qualityGate")
        if not isinstance(gate, dict) or gate.get("status") not in {"FAIL", "BLOCKED"}:
            return None
        return final_qa

    def run_pending(
        self,
        *,
        max_jobs: int = 1_000,
        extra_handlers: dict[str, TaskHandler] | None = None,
    ) -> GenerationStatus | None:
        handlers = {**(extra_handlers or {}), **self.workflow.handlers}
        completed = self.runtime.run_until_idle(handlers, max_jobs=max_jobs)
        if not completed:
            return None
        generation_id = _optional_string(completed[-1].parameters.get("generationId"))
        return None if generation_id is None else self.status(generation_id)

    def events(
        self,
        generation_id: str,
        *,
        after_sequence: int = 0,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        """Return the generation's durable stage events in database order."""

        if after_sequence < 0:
            raise ValueError("after_sequence cannot be negative")
        if not 1 <= limit <= 1_000:
            raise ValueError("event limit must be between 1 and 1000")
        jobs = self._jobs(generation_id)
        if not jobs:
            raise GenerationNotFoundError(generation_id)
        job_ids = [job.job_id for job in jobs]
        placeholders = ",".join("?" for _ in job_ids)
        rows = self.store.connection.execute(
            f"""SELECT event.*,job.parameters_json FROM job_events event
            JOIN jobs job ON job.job_id=event.job_id
            WHERE event.job_id IN ({placeholders}) AND event.sequence>?
            ORDER BY event.sequence LIMIT ?""",
            [*job_ids, after_sequence, limit],
        ).fetchall()
        values: list[dict[str, Any]] = []
        for row in rows:
            parameters = json.loads(row["parameters_json"])
            payload = json.loads(row["payload_json"])
            # Successful stage payloads can contain full storyboards/manifests.
            # Status polling needs the event fact, not another multi-megabyte
            # copy of generated content in every desktop response.
            if isinstance(payload, dict) and "result" in payload:
                payload = {key: value for key, value in payload.items() if key != "result"}
                payload["resultAvailable"] = True
            values.append(
                {
                    "id": row["event_id"],
                    "jobId": row["job_id"],
                    "sequence": int(row["sequence"]),
                    "stage": parameters.get("stage"),
                    "kind": str(row["event_type"]).replace("_", "-"),
                    "occurredAt": row["created_at"],
                    "payload": payload,
                }
            )
        return values

    def invalidate_scope(self, generation_id: str, scope: str) -> tuple[str, ...]:
        self.status(generation_id)
        graph = DependencyGraph(self.store.connection, self.store.manifest.project_id)
        roots: list[str]
        if scope.startswith("scene-asset:"):
            scene_id = scope.removeprefix("scene-asset:")
            roots = [self.workflow.logical_key(generation_id, f"scene:{scene_id}:asset")]
        elif scope.startswith("scene:"):
            scene_id = scope.removeprefix("scene:")
            roots = [
                self.workflow.logical_key(generation_id, f"scene:{scene_id}:asset"),
                self.workflow.logical_key(generation_id, f"scene:{scene_id}:narration"),
            ]
        else:
            aliases = {
                "sources": GenerationStage.INGEST_RESEARCH.value,
                "learner": GenerationStage.LEARNING_PLAN.value,
                "script": GenerationStage.SCRIPT.value,
                "storyboard": GenerationStage.STORYBOARD.value,
                "pronunciation": "pronunciation",
                "assets": GenerationStage.ASSETS.value,
                "narration": GenerationStage.NARRATION.value,
                "captions": GenerationStage.CAPTIONS.value,
                "presenter": GenerationStage.PRESENTER.value,
                "render": GenerationStage.RENDER.value,
            }
            if scope not in aliases:
                raise ValueError(f"Unknown generation invalidation scope: {scope}")
            roots = [self.workflow.logical_key(generation_id, aliases[scope])]
        return tuple(graph.invalidate_from(roots))

    def _jobs(self, generation_id: str) -> list[Job]:
        return [
            job
            for job in self.runtime.list_jobs(
                project_id=self.store.manifest.project_id,
                limit=1_000,
            )
            if job.parameters.get("generationId") == generation_id
        ]

    def _approval_revision(self, generation_id: str) -> str | None:
        for revision in self.store.list_revisions(limit=1_000):
            if (
                revision.kind == "approval"
                and revision.snapshot.get("generationId") == generation_id
            ):
                return revision.revision_id
        for job in self._jobs(generation_id):
            revision_id = job.parameters.get("approvalRevisionId")
            if isinstance(revision_id, str):
                return revision_id
        return None

    def _invalidated_scopes(self, generation_id: str) -> tuple[str, ...]:
        prefix = f"generation:{generation_id}:"
        return tuple(
            value.removeprefix(prefix)
            for value in DependencyGraph(
                self.store.connection, self.store.manifest.project_id
            ).stale_nodes()
            if value.startswith(prefix)
        )

    def _control_state(self, generation_id: str) -> str | None:
        row = self.store.connection.execute(
            "SELECT state FROM generation_controls WHERE generation_id=?",
            (generation_id,),
        ).fetchone()
        return None if row is None else str(row["state"])

    def _set_control_state(self, generation_id: str, state: str) -> None:
        with transaction(self.store.connection):
            self.store.connection.execute(
                """INSERT INTO generation_controls(generation_id,state,updated_at)
                VALUES(?,?,?) ON CONFLICT(generation_id) DO UPDATE SET
                state=excluded.state,updated_at=excluded.updated_at""",
                (generation_id, state, utc_now()),
            )

    def _clear_control_state(self, generation_id: str) -> None:
        with transaction(self.store.connection):
            self.store.connection.execute(
                "DELETE FROM generation_controls WHERE generation_id=?",
                (generation_id,),
            )


def request_from_fixture(path: Path) -> GenerationRequest:
    """Load a checked-in canonical fixture without any network dependency."""

    fixture_path = path.resolve(strict=True)
    value = json.loads(fixture_path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Canonical fixture must be a JSON object")
    sources: list[SourceSpec] = []
    for source in value.get("sources", []):
        source_path = (fixture_path.parent / str(source["path"])).resolve(strict=True)
        try:
            source_path.relative_to(fixture_path.parent)
        except ValueError as error:
            raise ValueError("Fixture source escapes its fixture directory") from error
        content_bytes = source_path.read_bytes()
        expected = str(source.get("sha256", ""))
        actual = hashlib.sha256(content_bytes).hexdigest()
        if expected and actual != expected:
            raise ValueError(f"Fixture source hash mismatch: {source_path.name}")
        sources.append(
            SourceSpec(
                str(source["id"]),
                str(source["title"]),
                content_bytes.decode("utf-8"),
                source_path.as_posix(),
                str(source.get("mimeType", "text/plain")),
                str(source.get("licenseExpression")) if source.get("licenseExpression") else None,
                str(source.get("creator")) if source.get("creator") else None,
            )
        )
    objectives = tuple(
        ObjectiveSpec(
            str(item["id"]),
            str(item["statement"]),
            _objective_level(str(item["statement"])),
        )
        for item in value.get("objectives", [])
    )
    claims = tuple(
        ClaimSpec(
            str(item["id"]),
            str(item["statement"]),
            (str(item["supports"][0]["sourceId"]) if item.get("supports") else None),
            _claim_importance(str(item.get("importance", "normal"))),
        )
        for item in value.get("claims", [])
    )
    learner = value.get("learner", {})
    from alystria.research import ExperienceLevel, GroundingMode

    return GenerationRequest(
        topic=str(value.get("title", value.get("id", "Tutorial"))),
        audience=str(learner.get("audience", "General learners")),
        duration_seconds=int(value.get("durationSeconds", 300)),
        locale=str(value.get("locale", "en-US")),
        experience=ExperienceLevel(str(learner.get("knowledgeLevel", "beginner"))),
        grounding_mode=GroundingMode(str(value.get("groundingMode", "grounded"))),
        sources=tuple(sources),
        objectives=objectives,
        claims=claims,
        prerequisites=tuple(str(item) for item in learner.get("prerequisites", [])),
        accessibility_needs=tuple(
            str(item) for item in learner.get("accessibilityNeeds", ["captions"])
        ),
        output_targets=tuple(dict(item) for item in value.get("outputTargets", [])),
        # Canonical fixtures author every scene explicitly.  Keep the
        # presenter off so the storyboard compiler does not replace the
        # fixture's opening scene family with a presenter scene.
        presenter_mode="off",
        captions_enabled=True,
        deterministic_seed=int(value.get("deterministicSeed", 0)),
        metadata={
            "fixtureId": value.get("id"),
            "networkRequired": False,
            # Preserve the executable teaching contract.  Previously the
            # fixture loader retained objectives and claims but discarded the
            # authored scenes and release-blocking content assertions, so an
            # unrelated generic script could reach the renderer instead.
            "canonicalFixtureScenes": [dict(item) for item in value.get("scenes", [])],
            "canonicalQualityAssertions": [
                dict(item) for item in value.get("qualityAssertions", [])
            ],
        },
    )


def request_from_canonical_fixture(fixture_id: str) -> GenerationRequest:
    """Load one closed, bundled flagship fixture by durable product identity."""

    relative = CANONICAL_FIXTURE_PATHS.get(fixture_id)
    if relative is None:
        raise ValueError(f"Unsupported canonical fixture ID: {fixture_id}")
    configured_root = os.environ.get("ALYSTRIA_CANONICAL_FIXTURE_ROOT")
    candidates = [
        Path(__file__).resolve().parent / "canonical" / relative,
        Path(__file__).resolve().parents[5] / "fixtures" / "canonical" / relative,
    ]
    if configured_root:
        candidates.insert(0, Path(configured_root).resolve() / relative)
    for candidate in candidates:
        if candidate.is_file():
            return request_from_fixture(candidate)
    raise FileNotFoundError(f"The bundled canonical fixture is unavailable: {fixture_id}")


def _desktop_slide_mode(snapshot: dict[str, Any]) -> str:
    creative = snapshot.get("creative")
    if creative is None:
        return "designed"
    if not isinstance(creative, dict):
        raise ValueError("Project creative configuration must be an object")
    slide = creative.get("slide")
    if slide is None:
        return "designed"
    if not isinstance(slide, dict):
        raise ValueError("Project slide configuration must be an object")
    mode = slide.get("mode")
    if mode is None:
        return "designed"
    if mode not in {"designed", "illustrated"}:
        raise ValueError("Project slide mode must be designed or illustrated")
    return str(mode)


def request_from_desktop(
    store: ProjectStore,
    params: dict[str, Any],
    *,
    document_extractor: DocumentExtractor | None = None,
    starter_audio_root: Path | None = None,
    starter_visual_root: Path | None = None,
) -> GenerationRequest:
    """Translate the narrow Rust desktop request plus current project snapshot.

    The desktop contract intentionally carries policy and scope rather than
    duplicating editable project content. This adapter reads that content from
    the authoritative current revision while the project connection is open.
    """

    head = store.head_revision()
    snapshot = {} if head is None else head.snapshot
    brief_value = snapshot.get("brief", {})
    brief = brief_value if isinstance(brief_value, dict) else {}
    summary = store.summary()
    topic = _first_non_blank(
        brief.get("topic"),
        snapshot.get("topic"),
        snapshot.get("title"),
        summary.name,
    )
    audience = _first_non_blank(
        brief.get("audience"),
        snapshot.get("audience"),
        "General learners",
    )
    duration_value = brief.get("durationSeconds", snapshot.get("durationSeconds", 300))
    duration_seconds = int(duration_value)
    locale = _first_non_blank(
        brief.get("locale"),
        snapshot.get("locale"),
        summary.settings.get("locale"),
        "en-US",
    )
    grounding = _first_non_blank(
        snapshot.get("groundingMode"),
        summary.settings.get("groundingMode"),
        "grounded",
    ).lower()
    sources: list[SourceSpec] = []
    source_values = snapshot.get("sources", [])
    if not isinstance(source_values, list):
        raise ValueError("Project sources must be an array")
    for index, item in enumerate(source_values):
        if not isinstance(item, dict):
            raise ValueError(f"Project source {index + 1} must be an object")
        sources.append(
            _source_from_desktop_record(
                store,
                item,
                index,
                document_extractor=document_extractor,
            )
        )
    from alystria.research import ExperienceLevel, GroundingMode

    experience_value = _first_non_blank(
        brief.get("experience"), snapshot.get("experience"), "beginner"
    ).lower()
    routing_value = snapshot.get("providerRoutingPolicy")
    routing_policy = (
        parse_routing_policy(routing_value).to_dict() if isinstance(routing_value, dict) else None
    )
    slide_mode = _desktop_slide_mode(snapshot)
    has_approved_image_route = routing_policy is not None and any(
            route.get("capability") == "image.generate"
            for route in routing_policy.get("routes", [])
            if isinstance(route, dict)
    )
    if slide_mode == "illustrated" and not has_approved_image_route:
        raise ValueError(
            "Illustrated slide mode requires an approved image generation route"
        )
    scene_visual_generation = "routed" if slide_mode == "illustrated" else "authored-only"
    if starter_audio_root is None:
        configured_starter_root = os.environ.get("ALYSTRIA_STARTER_AUDIO_ROOT")
        starter_audio_root = (
            None if configured_starter_root is None else Path(configured_starter_root)
        )
    audio_customization = resolve_audio_customization(
        store,
        snapshot,
        starter_audio_root=starter_audio_root,
    )
    customization_value = snapshot.get("customization")
    customization = (
        validate_customization(customization_value) if customization_value is not None else None
    )
    if starter_visual_root is None:
        configured_visual_root = os.environ.get("ALYSTRIA_STARTER_VISUAL_ROOT")
        starter_visual_root = (
            None if configured_visual_root is None else Path(configured_visual_root)
        )
    visual_customization = resolve_visual_customization(
        store,
        snapshot,
        starter_visual_root=starter_visual_root,
    )
    presenter_selection = _desktop_presenter_selection(snapshot, visual_customization)
    font_customization = resolve_font_customization(store, snapshot)
    metadata = {
        "snapshotId": params.get("snapshotId"),
        "scope": params.get("scope", {"kind": "project"}),
        "quality": params.get("quality", "standard"),
        "privacy": params.get("privacy", "local"),
        "approvedProviderIds": list(params.get("approvedProviderIds", [])),
        "preservationLocks": list(params.get("preservationLocks", [])),
        "providerRoutingPolicy": routing_policy,
        "sceneVisualGeneration": scene_visual_generation,
        "imageGenerationApproved": has_approved_image_route,
        "audioCustomization": audio_customization,
        "visualCustomization": visual_customization,
        "presenterSelection": presenter_selection,
        "fontCustomization": font_customization,
        "customization": customization,
        # Every current wizard choice is presented as an approximate target
        # ("About 1 minute", "min target"). Measured narration may therefore
        # retime the result within the workflow's narrow audited bound.
        "durationContract": "target",
    }
    presenter_mode = str(presenter_selection["mode"])
    canonical_fixture_value = snapshot.get("canonicalFixtureId")
    if canonical_fixture_value is not None and not isinstance(canonical_fixture_value, str):
        raise ValueError("canonicalFixtureId must be a string")
    canonical_fixture_id = (
        canonical_fixture_value
        if isinstance(canonical_fixture_value, str)
        else _canonical_fixture_id_from_topic(topic)
    )
    if canonical_fixture_id is not None:
        fixture = request_from_canonical_fixture(canonical_fixture_id)
        # A fixture is an exact-duration authored contract, not permission to
        # override the learner's duration choice. Legacy projects may retain a
        # canonical topic or fixture ID after the duration is edited; those
        # projects must return to the normal generation path.
        if duration_seconds == fixture.duration_seconds:
            return replace(
                fixture,
                presenter_mode=presenter_mode,
                metadata={**fixture.metadata, **metadata, "durationContract": "exact"},
            )
    return GenerationRequest(
        topic=topic,
        audience=audience,
        duration_seconds=duration_seconds,
        locale=locale,
        experience=ExperienceLevel(experience_value),
        grounding_mode=GroundingMode(grounding),
        sources=tuple(sources),
        presenter_mode=presenter_mode,
        deterministic_seed=int(snapshot.get("deterministicSeed", 0)),
        metadata=metadata,
    )


def _desktop_presenter_selection(
    snapshot: dict[str, Any], visual_customization: dict[str, Any]
) -> dict[str, Any]:
    """Freeze a validated, hash-bound roster and optional scene overrides.

    The project snapshot stores user-facing portrait asset IDs. The visual
    customization boundary resolves those IDs into project CAS hashes before
    this function runs. Persisting the resolved roster in GenerationRequest
    metadata makes approval, narration, presenter synthesis, and render stages
    consume one immutable assignment contract.
    """

    raw_value = snapshot.get("presenterSelection")
    raw = raw_value if isinstance(raw_value, dict) else None
    if raw_value is not None and raw is None:
        raise ValueError("presenterSelection must be an object")
    if raw is not None and raw.get("schemaVersion", 1) != 1:
        raise ValueError("presenterSelection.schemaVersion must be 1")
    if raw is not None:
        mode = raw.get("mode", "off")
        if mode not in {"off", "auto", "on"}:
            raise ValueError("presenterSelection.mode must be off, auto, or on")
    else:
        mode = (
            "auto"
            if bool(visual_customization.get("presenter", {}).get("enabled"))
            else "off"
        )

    if mode == "off":
        return {
            "schemaVersion": 1,
            "mode": "off",
            "presenters": [],
            "sceneAssignments": [],
        }

    resolved_value = visual_customization.get("presenters", [])
    if not isinstance(resolved_value, list):
        raise ValueError("Resolved presenter roster must be an array")
    resolved: list[dict[str, Any]] = [
        dict(item) for item in resolved_value if isinstance(item, dict)
    ]
    if len(resolved) != len(resolved_value):
        raise ValueError("Resolved presenter roster contains a malformed item")

    # Saved projects from the single-presenter era have no presenterSelection.
    # Preserve their exact portrait and preferred voice as a one-person roster.
    if raw is None and not resolved:
        presenter_value = visual_customization.get("presenter", {})
        presenter = presenter_value if isinstance(presenter_value, dict) else {}
        portrait_binding = next(
            (
                item
                for item in visual_customization.get("assets", [])
                if isinstance(item, dict) and item.get("role") == "presenter-portrait"
            ),
            None,
        )
        if portrait_binding is not None:
            asset_id = str(portrait_binding["assetId"])
            original_customization = snapshot.get("customization")
            original_presenter = (
                original_customization.get("presenter", {})
                if isinstance(original_customization, dict)
                else {}
            )
            preferred_voice = (
                original_presenter.get("preferredVoiceId")
                if isinstance(original_presenter, dict)
                else None
            )
            resolved = [
                {
                    "presenterId": asset_id,
                    "portraitAssetId": asset_id,
                    "portraitArtifactHash": str(portrait_binding["artifactHash"]),
                    "portraitMediaType": str(portrait_binding["mediaType"]),
                    "profile": dict(presenter.get("profile", {}))
                    if isinstance(presenter.get("profile"), dict)
                    else {},
                    **(
                        {"voiceId": preferred_voice.strip()}
                        if isinstance(preferred_voice, str) and preferred_voice.strip()
                        else {}
                    ),
                }
            ]

    if not 1 <= len(resolved) <= 12:
        raise ValueError("An enabled presenter selection needs 1 to 12 resolved portraits")
    presenter_ids: set[str] = set()
    normalized_presenters: list[dict[str, Any]] = []
    for index, item in enumerate(resolved):
        presenter_id = item.get("presenterId")
        portrait_asset_id = item.get("portraitAssetId")
        portrait_hash = item.get("portraitArtifactHash")
        if not isinstance(presenter_id, str) or not presenter_id.strip():
            raise ValueError(f"Resolved presenter {index + 1} has no presenterId")
        if presenter_id in presenter_ids:
            raise ValueError(f"Duplicate presenterId {presenter_id!r}")
        presenter_ids.add(presenter_id)
        if not isinstance(portrait_asset_id, str) or not portrait_asset_id.strip():
            raise ValueError(f"Resolved presenter {presenter_id!r} has no portraitAssetId")
        if (
            not isinstance(portrait_hash, str)
            or len(portrait_hash) != 64
            or any(character not in "0123456789abcdef" for character in portrait_hash)
        ):
            raise ValueError(f"Resolved presenter {presenter_id!r} has no verified portrait hash")
        normalized_presenters.append(dict(item))

    assignments_value = [] if raw is None else raw.get("sceneAssignments", [])
    if not isinstance(assignments_value, list):
        raise ValueError("presenterSelection.sceneAssignments must be an array")
    assignments: list[dict[str, str]] = []
    assigned_scene_ids: set[str] = set()
    for index, value in enumerate(assignments_value):
        if not isinstance(value, dict):
            raise ValueError(f"presenterSelection.sceneAssignments[{index}] must be an object")
        scene_id = value.get("sceneId")
        presenter_id = value.get("presenterId")
        if not isinstance(scene_id, str) or not scene_id.strip():
            raise ValueError(f"presenterSelection.sceneAssignments[{index}].sceneId is required")
        if not isinstance(presenter_id, str) or presenter_id not in presenter_ids:
            raise ValueError(
                f"presenterSelection.sceneAssignments[{index}] references an unknown presenter"
            )
        if scene_id in assigned_scene_ids:
            raise ValueError(f"Scene {scene_id!r} has more than one presenter assignment")
        assigned_scene_ids.add(scene_id)
        assignments.append({"sceneId": scene_id, "presenterId": presenter_id})
    return {
        "schemaVersion": 1,
        "mode": mode,
        "presenters": normalized_presenters,
        "sceneAssignments": assignments,
    }


def _source_from_desktop_record(
    store: ProjectStore,
    item: dict[str, Any],
    index: int,
    *,
    document_extractor: DocumentExtractor | None,
) -> SourceSpec:
    """Hydrate one selected source from inline text or an immutable CAS object."""

    artifact_hash = item.get("artifactHash")
    extraction_metadata: dict[str, Any] = {}
    if artifact_hash is not None:
        if not isinstance(artifact_hash, str):
            raise ValueError(f"Project source {index + 1} has an invalid artifact hash")
        raw = _read_verified_desktop_artifact(store, artifact_hash, index=index)
        content, media_type, extraction_metadata = _extract_desktop_source(
            raw,
            filename=_first_non_blank(item.get("filename"), item.get("title"), f"source-{index}"),
            declared_media_type=_first_non_blank(
                item.get("mediaType"), "application/octet-stream"
            ).casefold(),
            index=index,
            document_extractor=document_extractor,
        )
        locator = _first_non_blank(item.get("locator"), f"cas:sha256:{artifact_hash}")
    else:
        inline = item.get("content")
        if not isinstance(inline, str) or not inline.strip():
            raise ValueError(
                f"Project source {index + 1} has neither extractable content nor an artifact"
            )
        if len(inline) > MAX_DESKTOP_SOURCE_CHARS:
            raise ValueError(f"Project source {index + 1} exceeds the character limit")
        if "\x00" in inline:
            raise ValueError(f"Project source {index + 1} contains NUL characters")
        content = inline
        media_type = _first_non_blank(item.get("mediaType"), "text/plain")
        locator = _first_non_blank(item.get("locator"), f"project:sources/{index}")

    locator_metadata = {
        key: item[key]
        for key in (
            "versionId",
            "filename",
            "origin",
            "storedRelativePath",
            "byteSize",
            "privacy",
            "rightsStatus",
            "attribution",
            "status",
        )
        if key in item
    }
    locator_metadata.update(extraction_metadata)
    return SourceSpec(
        source_id=str(item.get("id") or _stable_desktop_id("source", index, content)),
        title=_first_non_blank(item.get("title"), f"Project source {index + 1}"),
        content=content,
        locator=locator,
        media_type=media_type,
        license_id=_optional_string(item.get("licenseId")) or _optional_string(item.get("license")),
        creator=_optional_string(item.get("creator")),
        artifact_hash=artifact_hash,
        locator_metadata=locator_metadata,
    )


def _read_verified_desktop_artifact(
    store: ProjectStore,
    artifact_hash: str,
    *,
    index: int,
) -> bytes:
    try:
        path = store.cas.object_path(artifact_hash)
    except ValueError as error:
        raise ValueError(f"Project source {index + 1} has an invalid artifact hash") from error
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Project source {index + 1} artifact is missing")
    if path.stat().st_size > MAX_DESKTOP_SOURCE_BYTES:
        raise ValueError(f"Project source {index + 1} exceeds the 8 MiB extraction limit")
    if not store.cas.verify(artifact_hash):
        raise ValueError(f"Project source {index + 1} artifact is corrupt")
    with path.open("rb") as stream:
        raw = stream.read(MAX_DESKTOP_SOURCE_BYTES + 1)
    if len(raw) > MAX_DESKTOP_SOURCE_BYTES:
        raise ValueError(f"Project source {index + 1} exceeds the 8 MiB extraction limit")
    if hashlib.sha256(raw).hexdigest() != artifact_hash:
        raise ValueError(f"Project source {index + 1} artifact changed during verification")
    return raw


def _extract_desktop_source(
    raw: bytes,
    *,
    filename: str,
    declared_media_type: str,
    index: int,
    document_extractor: DocumentExtractor | None,
) -> tuple[str, str, dict[str, Any]]:
    suffix = Path(filename).suffix.casefold()
    try:
        detected_media_type = detect_mime(raw)
    except ValueError as error:
        raise ValueError(f"Project source {index + 1} has an unsupported file format") from error
    is_text = (
        suffix in _TEXT_SOURCE_SUFFIXES
        and detected_media_type in {"text/plain", "application/json"}
    ) or (
        not suffix
        and declared_media_type in _TEXT_SOURCE_MEDIA_TYPES
        and detected_media_type in {"text/plain", "application/json"}
    )
    if is_text:
        if b"\x00" in raw:
            raise ValueError(f"Project source {index + 1} contains binary NUL bytes")
        try:
            content = raw.decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise ValueError(f"Project source {index + 1} must be UTF-8") from error
        if not content.strip():
            raise ValueError(f"Project source {index + 1} contains no extractable text")
        if len(content) > MAX_DESKTOP_SOURCE_CHARS:
            raise ValueError(f"Project source {index + 1} exceeds the character limit")
        return content, declared_media_type, {"detectedMediaType": detected_media_type}

    document_suffix = _DOCUMENT_MEDIA_SUFFIXES.get(detected_media_type)
    if document_suffix is None or document_suffix not in DOCLING_SUFFIXES:
        raise ValueError(
            f"Project source {index + 1} format {detected_media_type!r} is not extractable"
        )
    extractor = document_extractor or DoclingExtractor()
    try:
        with tempfile.TemporaryDirectory(prefix="alystria-source-") as directory:
            source_path = Path(directory) / f"source{document_suffix}"
            source_path.write_bytes(raw)
            extracted = extractor.extract(source_path, max_chars=MAX_DESKTOP_SOURCE_CHARS)
    except SourceLoadError as error:
        raise ValueError(f"Project source {index + 1} extraction failed: {error}") from error
    if not extracted.text.strip():
        raise ValueError(f"Project source {index + 1} contains no extractable text")
    return (
        extracted.text,
        extracted.media_type,
        {
            "detectedMediaType": detected_media_type,
            "extractorBoundary": "quarantined_worker",
            **dict(extracted.attributes),
        },
    )


def _request_from_job(parameters: dict[str, Any]) -> GenerationRequest:
    from .workflow import _request

    return _request(parameters)


def _current_generation_jobs(
    jobs: list[Job], approval_revision_id: str | None
) -> list[Job]:
    """Select pre-approval jobs and the newest immutable approval branch."""

    selected: list[Job] = []
    for job in jobs:
        stage_value = job.parameters.get("stage")
        if not isinstance(stage_value, str):
            continue
        try:
            stage = GenerationStage(stage_value)
        except ValueError:
            continue
        if stage in PRE_APPROVAL_STAGES or (
            stage in POST_APPROVAL_STAGES
            and approval_revision_id is not None
            and job.parameters.get("approvalRevisionId") == approval_revision_id
        ):
            selected.append(job)
    return selected


_ACTIVE_MEDIA_STATES = frozenset(
    {JobState.READY, JobState.QUEUED, JobState.RUNNING, JobState.RETRY_WAIT}
)
_NARRATION_PACING_FAILURE_PREFIXES = (
    "Measured narration leaves ",
    "Measured narration exceeds the requested tutorial duration by ",
)


def _request_visual_generation_mode(request: GenerationRequest) -> str:
    mode = request.metadata.get("sceneVisualGeneration", "routed")
    if mode not in {"routed", "authored-only"}:
        raise ApprovalNotReadyError(
            "Generation request sceneVisualGeneration must be routed or authored-only"
        )
    return str(mode)


def _request_image_generation_approved(request: GenerationRequest) -> bool:
    approved = request.metadata.get("imageGenerationApproved")
    if approved is None:
        return _request_visual_generation_mode(request) == "routed"
    if not isinstance(approved, bool):
        raise ApprovalNotReadyError("Generation request imageGenerationApproved must be boolean")
    return approved


def _approved_visual_generation_mode(
    payload: dict[str, Any], *, fallback: str
) -> str:
    approval = payload.get("approval")
    mode = approval.get("sceneVisualGeneration") if isinstance(approval, dict) else None
    if mode is None:
        mode = fallback
    if mode not in {"routed", "authored-only"}:
        raise ApprovalNotReadyError(
            "Approved sceneVisualGeneration must be routed or authored-only"
        )
    return str(mode)


def _reviewed_visual_generation_changed(
    previous_payload: dict[str, Any],
    reviewed_payload: dict[str, Any],
    *,
    fallback: str,
) -> bool:
    return _approved_visual_generation_mode(
        previous_payload, fallback=fallback
    ) != _approved_visual_generation_mode(reviewed_payload, fallback=fallback)


def _prepare_failed_media_reapproval(
    runtime: SQLiteWorkflowRuntime,
    jobs: list[Job],
    *,
    approval_revision_id: str,
    previous_payload: dict[str, Any],
    reviewed_payload: dict[str, Any],
    request_visual_generation_mode: str,
) -> None:
    """Retire one inactive failed branch after a narrow reviewed correction."""

    post_job_ids = [
        job.job_id
        for job in jobs
        if job.parameters.get("stage") in {stage.value for stage in POST_APPROVAL_STAGES}
        and job.parameters.get("approvalRevisionId") == approval_revision_id
    ]
    # ``approve`` computed its high-level state before opening the transaction.
    # Refresh branch jobs here so a concurrent Retry cannot be superseded using
    # stale FAILED snapshots.
    post_jobs = [runtime.get_job(job_id) for job_id in post_job_ids]
    active = [job for job in post_jobs if job.state in _ACTIVE_MEDIA_STATES]
    if active:
        stages = sorted(str(job.parameters.get("stage")) for job in active)
        raise ApprovalNotReadyError(
            "Reviewed media cannot be reapproved while media work is active: "
            + ", ".join(stages)
        )

    assets_failed = any(
        job.parameters.get("stage") == GenerationStage.ASSETS.value
        and job.state is JobState.FAILED
        for job in post_jobs
    )
    previous_visual_mode = _approved_visual_generation_mode(
        previous_payload, fallback=request_visual_generation_mode
    )
    reviewed_visual_mode = _approved_visual_generation_mode(
        reviewed_payload, fallback=request_visual_generation_mode
    )
    is_designed_asset_recovery = (
        assets_failed
        and previous_visual_mode == "routed"
        and reviewed_visual_mode == "authored-only"
        and not _reviewed_scene_prose_changed(previous_payload, reviewed_payload)
    )
    if _reviewed_presenter_assignments_changed(previous_payload, reviewed_payload):
        stale_reason = "superseded_by_reviewed_presenters"
    elif is_designed_asset_recovery:
        stale_reason = "superseded_by_reviewed_visual_mode"
    else:
        _validate_narration_pacing_reapproval(
            post_jobs,
            previous_payload=previous_payload,
            reviewed_payload=reviewed_payload,
        )
        stale_reason = "superseded_by_reviewed_narration"

    for job in post_jobs:
        if job.state is not JobState.STALE:
            runtime.mark_stale(job.job_id, reason=stale_reason)


def _validate_narration_pacing_reapproval(
    post_jobs: list[Job],
    *,
    previous_payload: dict[str, Any],
    reviewed_payload: dict[str, Any],
) -> None:
    narration_job = next(
        (
            job
            for job in post_jobs
            if job.parameters.get("stage") == GenerationStage.NARRATION.value
            and job.state is JobState.FAILED
        ),
        None,
    )
    error_message = (
        narration_job.error.get("message")
        if narration_job is not None and isinstance(narration_job.error, dict)
        else None
    )
    if not isinstance(error_message, str) or not error_message.startswith(
        _NARRATION_PACING_FAILURE_PREFIXES
    ):
        raise ApprovalNotReadyError(
            "A new approval branch requires either failed illustrated assets switched to "
            "Designed layout or measured narration pacing with revised prose"
        )
    if not _reviewed_narration_changed(previous_payload, reviewed_payload):
        raise ApprovalNotReadyError(
            "Revise at least one narration before reapproving a measured pacing failure"
        )


def _reviewed_narration_changed(
    previous_payload: dict[str, Any], reviewed_payload: dict[str, Any]
) -> bool:
    previous_scenes, reviewed_scenes = _approval_scene_pairs(
        previous_payload, reviewed_payload
    )
    return any(
        previous.get("narration") != reviewed.get("narration")
        for previous, reviewed in zip(previous_scenes, reviewed_scenes, strict=True)
    )


def _reviewed_scene_prose_changed(
    previous_payload: dict[str, Any], reviewed_payload: dict[str, Any]
) -> bool:
    previous_scenes, reviewed_scenes = _approval_scene_pairs(
        previous_payload, reviewed_payload
    )
    return any(
        any(previous.get(field) != reviewed.get(field) for field in _REVIEWABLE_SCENE_FIELDS)
        for previous, reviewed in zip(previous_scenes, reviewed_scenes, strict=True)
    )


def _reviewed_presenter_assignments_changed(
    previous_payload: dict[str, Any], reviewed_payload: dict[str, Any]
) -> bool:
    previous_scenes, reviewed_scenes = _approval_scene_pairs(
        previous_payload, reviewed_payload
    )
    fields = (
        "type",
        "presenterBaseType",
        "presenterId",
        "presenterProfileId",
        "speakerId",
        "portraitAssetId",
        "portraitArtifactHash",
        "voiceId",
        "presenterPlacement",
        "presenterFit",
    )
    return any(
        any(previous.get(field) != reviewed.get(field) for field in fields)
        for previous, reviewed in zip(previous_scenes, reviewed_scenes, strict=True)
    )
def _approval_scene_pairs(
    previous_payload: dict[str, Any], reviewed_payload: dict[str, Any]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    previous_storyboard = previous_payload.get("storyboard")
    reviewed_storyboard = reviewed_payload.get("storyboard")
    if not isinstance(previous_storyboard, dict) or not isinstance(reviewed_storyboard, dict):
        raise ApprovalNotReadyError("Approved narration recovery requires both storyboards")
    previous_scenes = previous_storyboard.get("scenes")
    reviewed_scenes = reviewed_storyboard.get("scenes")
    if not isinstance(previous_scenes, list) or not isinstance(reviewed_scenes, list):
        raise ApprovalNotReadyError("Approved narration recovery requires scene lists")
    if not all(isinstance(scene, dict) for scene in [*previous_scenes, *reviewed_scenes]):
        raise ApprovalNotReadyError("Approved narration recovery requires scene objects")
    if len(previous_scenes) != len(reviewed_scenes):
        raise ApprovalNotReadyError("Approved narration recovery requires matching scenes")
    return previous_scenes, reviewed_scenes


_REVIEWABLE_SCENE_FIELDS = frozenset({"title", "narration", "visualIntent"})
_REVIEWABLE_SCENE_LIMITS = {
    "title": 300,
    "narration": 20_000,
    "visualIntent": 4_000,
}


def _request_with_reviewed_presenter_selection(
    store: ProjectStore,
    request: GenerationRequest,
    reviewed_snapshot: dict[str, Any],
) -> GenerationRequest:
    """Bind the exact cast saved by the review UI before media jobs are queued."""

    if "presenterSelection" not in reviewed_snapshot:
        return request
    configured_visual_root = os.environ.get("ALYSTRIA_STARTER_VISUAL_ROOT")
    try:
        visual_customization = resolve_visual_customization(
            store,
            reviewed_snapshot,
            starter_visual_root=(
                None if configured_visual_root is None else Path(configured_visual_root)
            ),
        )
        presenter_selection = _desktop_presenter_selection(
            reviewed_snapshot, visual_customization
        )
    except ValueError as error:
        raise ApprovalNotReadyError(
            f"Reviewed presenter selection is invalid: {error}"
        ) from error
    return replace(
        request,
        presenter_mode=str(presenter_selection["mode"]),
        metadata={
            **request.metadata,
            "visualCustomization": visual_customization,
            "presenterSelection": presenter_selection,
        },
    )


def _freeze_reviewed_approval_payload(
    approval_payload: dict[str, Any],
    reviewed_snapshot: dict[str, Any],
    *,
    generation_id: str,
    reviewed_revision_id: str,
    request_visual_generation_mode: str,
    image_generation_approved: bool,
    request: GenerationRequest,
) -> dict[str, Any]:
    """Copy reviewed prose and the explicit slide mode into the approval payload.

    The webview project snapshot is user-editable JSON.  It may supply revised
    scene prose and choose Designed or Illustrated output, but it cannot replace
    scene identities, claims, timing, provider policy, visual structure, or any
    other generated contract while approving.
    """

    if reviewed_snapshot.get("generationId") != generation_id:
        raise ApprovalNotReadyError(
            "The reviewed project revision does not belong to this generation"
        )
    reviewed_payload = reviewed_snapshot.get("payload")
    if not isinstance(reviewed_payload, dict):
        raise ApprovalNotReadyError("The reviewed project revision has no generation payload")
    baseline_storyboard = approval_payload.get("storyboard")
    reviewed_storyboard = reviewed_payload.get("storyboard")
    if not isinstance(baseline_storyboard, dict) or not isinstance(reviewed_storyboard, dict):
        raise ApprovalNotReadyError("The reviewed project revision has no storyboard")

    baseline_scenes = baseline_storyboard.get("scenes")
    reviewed_scenes = reviewed_storyboard.get("scenes")
    if not isinstance(baseline_scenes, list) or not isinstance(reviewed_scenes, list):
        raise ApprovalNotReadyError("The reviewed storyboard has no scene list")
    if not all(isinstance(scene, dict) for scene in [*baseline_scenes, *reviewed_scenes]):
        raise ApprovalNotReadyError("The reviewed storyboard scenes must be objects")

    baseline_ids = [scene.get("id") for scene in baseline_scenes]
    reviewed_ids = [scene.get("id") for scene in reviewed_scenes]
    if (
        not baseline_ids
        or any(not isinstance(scene_id, str) or not scene_id for scene_id in baseline_ids)
        or len(set(baseline_ids)) != len(baseline_ids)
        or reviewed_ids != baseline_ids
    ):
        raise ApprovalNotReadyError(
            "The reviewed storyboard scene identities do not match the generated storyboard"
        )

    baseline_envelope = {key: value for key, value in baseline_storyboard.items() if key != "scenes"}
    reviewed_envelope = {key: value for key, value in reviewed_storyboard.items() if key != "scenes"}
    if reviewed_envelope != baseline_envelope:
        raise ApprovalNotReadyError(
            "The reviewed storyboard changed generated structure outside scene prose"
        )

    frozen_scenes: list[dict[str, Any]] = []
    for baseline_scene, reviewed_scene in zip(baseline_scenes, reviewed_scenes, strict=True):
        baseline_contract = {
            key: value for key, value in baseline_scene.items() if key not in _REVIEWABLE_SCENE_FIELDS
        }
        reviewed_contract = {
            key: value for key, value in reviewed_scene.items() if key not in _REVIEWABLE_SCENE_FIELDS
        }
        if reviewed_contract != baseline_contract:
            changed_fields = sorted(
                key
                for key in baseline_contract.keys() | reviewed_contract.keys()
                if baseline_contract.get(key) != reviewed_contract.get(key)
            )
            raise ApprovalNotReadyError(
                f"Reviewed scene {baseline_scene['id']!r} changed generated fields outside prose: "
                f"{', '.join(changed_fields)}. Approval accepts only title, narration, and "
                "learning objective edits"
            )
        frozen_scene = copy.deepcopy(baseline_scene)
        for field in _REVIEWABLE_SCENE_FIELDS:
            value = reviewed_scene.get(field)
            limit = _REVIEWABLE_SCENE_LIMITS[field]
            requires_text = field in {"title", "narration"}
            if (
                not isinstance(value, str)
                or (requires_text and not value.strip())
                or len(value) > limit
                or "\x00" in value
            ):
                raise ApprovalNotReadyError(
                    f"Reviewed scene {baseline_scene['id']!r} has an invalid {field}"
                )
            frozen_scene[field] = value
        frozen_scenes.append(frozen_scene)

    frozen = copy.deepcopy(approval_payload)
    _apply_presenter_selection(
        frozen_scenes,
        request=request,
        presenter_customization=(
            dict(request.metadata.get("visualCustomization", {}).get("presenter", {}))
            if isinstance(request.metadata.get("visualCustomization"), dict)
            and isinstance(
                request.metadata.get("visualCustomization", {}).get("presenter"), dict
            )
            else {}
        ),
    )
    frozen["storyboard"] = {**copy.deepcopy(baseline_storyboard), "scenes": frozen_scenes}
    if "creative" in reviewed_snapshot:
        try:
            reviewed_visual_mode = _desktop_slide_mode(reviewed_snapshot)
        except ValueError as error:
            raise ApprovalNotReadyError(str(error)) from error
    else:
        reviewed_visual_mode = (
            "illustrated" if request_visual_generation_mode == "routed" else "designed"
        )
    if reviewed_visual_mode == "illustrated" and not image_generation_approved:
        raise ApprovalNotReadyError(
            "Illustrated slide mode requires an approved image generation route"
        )
    scene_visual_generation = (
        "routed" if reviewed_visual_mode == "illustrated" else "authored-only"
    )
    approval = frozen.get("approval")
    frozen["approval"] = {
        **(copy.deepcopy(approval) if isinstance(approval, dict) else {}),
        "reviewedRevisionId": reviewed_revision_id,
        "reviewedVisualMode": reviewed_visual_mode,
        "sceneVisualGeneration": scene_visual_generation,
    }
    return frozen


def _optional_string(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _first_non_blank(*values: object) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    raise ValueError("Expected at least one non-blank string")


def _stable_desktop_id(prefix: str, index: int, value: str) -> str:
    digest = hashlib.sha256(f"{index}:{value}".encode()).hexdigest()[:24]
    return f"{prefix}_{digest}"


def _objective_level(statement: str) -> str:
    lowered = statement.casefold()
    if lowered.startswith("apply"):
        return "apply"
    if lowered.startswith("compare"):
        return "analyze"
    if lowered.startswith("derive"):
        return "analyze"
    return "understand"


def _claim_importance(value: str) -> str:
    return {"major": "high", "release-blocking": "critical"}.get(value, value)
