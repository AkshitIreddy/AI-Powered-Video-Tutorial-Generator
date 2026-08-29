"""Application-facing lifecycle service for durable tutorial generations."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import uuid
from pathlib import Path
from typing import Any

from alystria.jobs import DependencyGraph, Job, JobState, SQLiteWorkflowRuntime
from alystria.jobs.runtime import TaskHandler
from alystria.project import ProjectStore
from alystria.project.database import transaction
from alystria.project.models import utc_now
from alystria.project_customization import validate_customization
from alystria.providers import parse_routing_policy
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
from .models import (
    ALL_STAGES,
    POST_APPROVAL_STAGES,
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
from .workflow import GenerationWorkflow


class GenerationNotFoundError(KeyError):
    pass


class ApprovalNotReadyError(RuntimeError):
    pass


MAX_DESKTOP_SOURCE_BYTES = 8 * 1024 * 1024
MAX_DESKTOP_SOURCE_CHARS = 2_000_000
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


class GenerationCoordinator:
    """Narrow service suitable for desktop generation start/status controls."""

    def __init__(
        self,
        store: ProjectStore,
        runtime: SQLiteWorkflowRuntime | None = None,
        *,
        media_client: GenerationMediaClient | None = None,
        renderer_client: RendererClient | None = None,
    ) -> None:
        self.store = store
        self.runtime = runtime or SQLiteWorkflowRuntime(store.connection)
        self.workflow = GenerationWorkflow(
            store,
            self.runtime,
            media_client=media_client,
            renderer_client=renderer_client,
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
        jobs = self._jobs(generation_id)
        if not jobs:
            raise GenerationNotFoundError(generation_id)
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
        approval_revision = self._approval_revision(generation_id)
        export_result = export_job.result if export_job is not None else None
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
        )

    def approve(
        self,
        generation_id: str,
        *,
        name: str = "Approved storyboard",
        message: str = "Approved generation plan, storyboard, privacy, rights, and cost gate",
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
            existing_revision = self._approval_revision(generation_id)
            if existing_revision is None:
                if approval_job.result is None or not isinstance(
                    approval_job.result.get("payload"), dict
                ):
                    raise ApprovalNotReadyError("Approval gate payload is unavailable")
                approval_payload = dict(approval_job.result["payload"])
                approval_payload["approval"] = {
                    **dict(approval_payload.get("approval", {})),
                    "approved": True,
                }
                revision = self.store.create_revision(
                    snapshot={
                        "projectId": self.store.manifest.project_id,
                        "generationId": generation_id,
                        "stage": GenerationStage.APPROVAL.value,
                        "payload": approval_payload,
                    },
                    kind="approval",
                    name=name,
                    message=message,
                )
                approval_revision_id = revision.revision_id
            else:
                approval_revision_id = existing_revision
            request = _request_from_job(approval_job.parameters)
            self.workflow.enqueue_post_approval(
                generation_id=generation_id,
                request=request,
                approval_job_id=approval_job.job_id,
                approval_revision_id=approval_revision_id,
            )
        return self.status(generation_id)

    def cancel(self, generation_id: str) -> GenerationStatus:
        jobs = self._jobs(generation_id)
        if not jobs:
            raise GenerationNotFoundError(generation_id)
        if self.status(generation_id).state is GenerationState.SUCCEEDED:
            return self.status(generation_id)
        for job in jobs:
            if job.state not in {
                JobState.SUCCEEDED,
                JobState.FAILED,
                JobState.CANCELLED,
                JobState.STALE,
            }:
                self.runtime.cancel(job.job_id)
        self._set_control_state(generation_id, "CANCELLED")
        return self.status(generation_id)

    def retry(self, generation_id: str) -> GenerationStatus:
        jobs = self._jobs(generation_id)
        if not jobs:
            raise GenerationNotFoundError(generation_id)
        with transaction(self.store.connection):
            cancelled_control = self._control_state(generation_id) == "CANCELLED"
            retried = False
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
        if scope.startswith("scene:"):
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
        for job in self._jobs(generation_id):
            revision = job.parameters.get("approvalRevisionId")
            if isinstance(revision, str):
                return revision
        for revision in self.store.list_revisions(limit=1_000):
            if (
                revision.kind == "approval"
                and revision.snapshot.get("generationId") == generation_id
            ):
                return revision.revision_id
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
        presenter_mode="auto",
        captions_enabled=True,
        deterministic_seed=int(value.get("deterministicSeed", 0)),
        hard_budget_micros=0,
        metadata={"fixtureId": value.get("id"), "networkRequired": False},
    )


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
    budget_value = params.get("budget", {})
    if not isinstance(budget_value, dict):
        raise ValueError("Desktop generation budget must be an object")
    minor_units = budget_value.get("hardLimitMinorUnits", 0)
    if not isinstance(minor_units, int) or isinstance(minor_units, bool) or minor_units < 0:
        raise ValueError("Desktop hardLimitMinorUnits must be a non-negative integer")
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
        parse_routing_policy(routing_value).to_dict()
        if isinstance(routing_value, dict)
        else None
    )
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
        validate_customization(customization_value)
        if customization_value is not None
        else None
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
    font_customization = resolve_font_customization(store, snapshot)
    return GenerationRequest(
        topic=topic,
        audience=audience,
        duration_seconds=duration_seconds,
        locale=locale,
        experience=ExperienceLevel(experience_value),
        grounding_mode=GroundingMode(grounding),
        sources=tuple(sources),
        presenter_mode=(
            "auto"
            if customization is None
            or bool(visual_customization.get("presenter", {}).get("enabled"))
            else "off"
        ),
        deterministic_seed=int(snapshot.get("deterministicSeed", 0)),
        hard_budget_micros=minor_units * 10_000,
        metadata={
            "snapshotId": params.get("snapshotId"),
            "scope": params.get("scope", {"kind": "project"}),
            "quality": params.get("quality", "standard"),
            "privacy": params.get("privacy", "local"),
            "approvedProviderIds": list(params.get("approvedProviderIds", [])),
            "preservationLocks": list(params.get("preservationLocks", [])),
            "budgetCurrency": budget_value.get("currency", "USD"),
            "requireKnownPricing": bool(budget_value.get("requireKnownPricing", True)),
            "providerRoutingPolicy": routing_policy,
            "audioCustomization": audio_customization,
            "visualCustomization": visual_customization,
            "fontCustomization": font_customization,
            "customization": customization,
        },
    )


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
        license_id=_optional_string(item.get("licenseId"))
        or _optional_string(item.get("license")),
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
