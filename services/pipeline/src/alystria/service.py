"""Narrow JSON-friendly application service used by Tauri IPC and the CLI."""

from __future__ import annotations

import base64
import binascii
import copy
import json
import os
import platform
import shutil
import sqlite3
import sys
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from . import __version__
from .generation import (
    DeterministicRendererClient,
    GenerationCoordinator,
    GenerationMediaClient,
    GenerationState,
    GenerationStatus,
    RenderedTutorial,
    RendererClient,
    RendererClientError,
    RendererOptions,
    RendererRuntimeError,
    RuntimeGenerationMediaClient,
    StructuredWritingEducationalProvider,
    create_production_renderer_client,
    default_local_media_client,
    load_local_presenter_media_client,
    request_from_desktop,
)
from .jobs import (
    ActionKey,
    DependencyGraph,
    Job,
    JobState,
    MockGenerationWorkflow,
    SQLiteWorkflowRuntime,
)
from .native_controls import NativeControlCoordinator, native_job_receipt
from .project import ProjectHistory, ProjectStore, export_project, import_project
from .project_assets import import_project_asset, select_presenter_profile
from .project_customization import save_project_customization
from .providers import Capability, ProviderRuntimeFactory, parse_routing_policy
from .security.files import ImportLimits, validate_file

if TYPE_CHECKING:
    from .background import DesktopJobSupervisor

MAX_DESKTOP_SOURCE_BYTES = 8 * 1024 * 1024
MAX_DESKTOP_SOURCE_BASE64_CHARS = ((MAX_DESKTOP_SOURCE_BYTES + 2) // 3) * 4
MAX_DESKTOP_SNAPSHOT_BYTES = 1024 * 1024
SOURCE_PRIVACY_CLASSES = frozenset({"public", "project_local", "sensitive", "restricted"})
SOURCE_RIGHTS_STATUSES = frozenset({"owned", "licensed", "public_domain", "fair_use", "unknown"})


class PipelineService:
    """Stateless method dispatcher; every request identifies its project path."""

    def __init__(
        self,
        *,
        background_supervisor: DesktopJobSupervisor | None = None,
        generation_coordinator_factory: Callable[
            [ProjectStore, SQLiteWorkflowRuntime | None], GenerationCoordinator
        ]
        | None = None,
        provider_runtime_factory: ProviderRuntimeFactory | None = None,
    ) -> None:
        self._background_supervisor = background_supervisor
        self._provider_runtime_factory = provider_runtime_factory
        if generation_coordinator_factory is not None:
            self._generation_coordinator_factory = generation_coordinator_factory
        elif provider_runtime_factory is not None:
            self._generation_coordinator_factory = lambda store, runtime: (
                _enqueue_generation_coordinator(
                    store,
                    runtime,
                    provider_runtime_factory=provider_runtime_factory,
                )
            )
        else:
            self._generation_coordinator_factory = _enqueue_generation_coordinator
        self._methods: dict[str, Callable[[dict[str, Any]], Any]] = {
            "system.ping": self.ping,
            "system.doctor": self.doctor,
            "project.initialize": self.project_initialize,
            "project.snapshot.get": self.project_snapshot_get,
            "project.snapshot.save": self.project_snapshot_save,
            "project.customization.save": self.project_customization_save,
            "project.history.get": self.project_history_get,
            "project.history.undo": self.project_history_undo,
            "project.history.redo": self.project_history_redo,
            "project.create": self.project_create,
            "project.get": self.project_get,
            "project.revisions": self.project_revisions,
            "project.revise": self.project_revise,
            "project.approve": self.project_approve,
            "project.restore": self.project_restore,
            "project.backup": self.project_backup,
            "project.export": self.project_export,
            "project.import": self.project_import,
            "source.import": self.source_import,
            "asset.import": self.asset_import,
            "presenter.profile.select": self.presenter_profile_select,
            "provider.routingPolicy.get": self.provider_routing_policy_get,
            "provider.routingPolicy.save": self.provider_routing_policy_save,
            "job.enqueue": self.job_enqueue,
            "job.enqueueMockGeneration": self.job_enqueue_mock_generation,
            "job.get": self.job_get,
            "job.list": self.job_list,
            "job.events": self.job_events,
            "job.cancel": self.job_cancel,
            "job.retry": self.job_retry,
            "job.runPending": self.job_run_pending,
            "job.recover": self.job_recover,
            "job.usage": self.job_usage,
            "dependency.invalidate": self.dependency_invalidate,
            "generation.start": self.generation_start,
            "generation.approve": self.generation_approve,
            "generation.cancel": self.generation_cancel,
            "generation.retry": self.generation_retry,
            "control.regenerateScene": self.control_regenerate_scene,
            "control.renderScene": self.control_render_scene,
            "control.repairQa": self.control_repair_qa,
            "control.exportMaster": self.control_export_master,
            "job.status": self.desktop_job_status,
        }

    @property
    def methods(self) -> tuple[str, ...]:
        return tuple(sorted(self._methods))

    def dispatch(self, method: str, params: dict[str, Any] | None = None) -> Any:
        handler = self._methods.get(method)
        if handler is None:
            raise KeyError(f"Unknown pipeline method: {method}")
        return handler(params or {})

    def ping(self, _: dict[str, Any]) -> dict[str, Any]:
        return {"service": "alystria-pipeline", "version": __version__, "status": "ok"}

    def doctor(self, _: dict[str, Any]) -> dict[str, Any]:
        return {
            "serviceVersion": __version__,
            "pythonVersion": platform.python_version(),
            "platform": platform.platform(),
            "sqliteVersion": sqlite3.sqlite_version,
            "ffmpeg": shutil.which("ffmpeg"),
            "ffprobe": shutil.which("ffprobe"),
            "workflowRuntime": "sqlite",
            "executable": sys.executable,
        }

    def project_create(self, params: dict[str, Any]) -> dict[str, Any]:
        with ProjectStore.create(
            Path(_required_string(params, "path")),
            name=_required_string(params, "name"),
            initial_snapshot=_optional_object(params, "initialSnapshot"),
        ) as store:
            return store.summary().to_dict()

    def project_initialize(self, params: dict[str, Any]) -> dict[str, Any]:
        project_id = _required_uuid(params, "projectId")
        manifest_revision = params.get("manifestRevision")
        if not isinstance(manifest_revision, int) or isinstance(manifest_revision, bool):
            raise ValueError("manifestRevision must be an integer")
        if manifest_revision < 1:
            raise ValueError("manifestRevision must be at least one")
        with ProjectStore.initialize_existing(
            Path(_required_string(params, "projectDirectory")),
            expected_project_id=project_id,
            expected_manifest_revision=manifest_revision,
            initial_snapshot=_optional_snapshot(params, "initialSnapshot"),
        ) as store:
            summary = store.summary()
            return {
                "projectId": summary.project_id,
                "databaseReady": True,
                "schemaVersion": 1,
                "headRevisionId": summary.head_revision_id,
            }

    def project_snapshot_get(self, params: dict[str, Any]) -> dict[str, Any]:
        project_id = _required_uuid(params, "projectId")
        with self._open_desktop_project(params, expected_project_id=project_id) as store:
            head = store.head_revision()
            if head is None:
                raise ValueError("project has no durable snapshot")
            return _snapshot_receipt(head)

    def project_snapshot_save(self, params: dict[str, Any]) -> dict[str, Any]:
        project_id = _required_uuid(params, "projectId")
        expected_head = _required_string(params, "expectedHeadRevisionId")
        snapshot = _required_snapshot(params, "snapshot")
        snapshot["id"] = project_id
        with self._open_desktop_project(params, expected_project_id=project_id) as store:
            previous_head = store.head_revision()
            if previous_head is None or previous_head.revision_id != expected_head:
                from .project.errors import RevisionConflictError

                actual = "none" if previous_head is None else previous_head.revision_id
                raise RevisionConflictError(
                    f"Expected head {expected_head}, but current head is {actual}"
                )
            # Asset ledgers, provenance, and consent records are pipeline-owned
            # trust-boundary data.  The webview persists visual-bible choices
            # but must never erase or rewrite these records when saving an
            # otherwise portable project snapshot after an asset import.
            for protected_field in (
                "customization",
                "mediaAssets",
                "assetProvenance",
                "presenterProfiles",
                "consentRecords",
                "selectedPresenterProfileId",
            ):
                if protected_field in previous_head.snapshot:
                    snapshot[protected_field] = copy.deepcopy(
                        previous_head.snapshot[protected_field]
                    )
            revision = store.create_revision(
                snapshot=snapshot,
                kind="edit",
                message=str(params.get("message", "Saved project edits"))[:500],
                expected_head=expected_head,
            )
            history = ProjectHistory(store).record_new_revision(expected_head, revision)
            return {**_snapshot_receipt(revision), "history": history.to_dict()}

    def project_customization_save(self, params: dict[str, Any]) -> dict[str, Any]:
        project_id = _required_uuid(params, "projectId")
        with self._open_desktop_project(params, expected_project_id=project_id) as store:
            return save_project_customization(store, params)

    def project_history_get(self, params: dict[str, Any]) -> dict[str, Any]:
        project_id = _required_uuid(params, "projectId")
        with self._open_desktop_project(params, expected_project_id=project_id) as store:
            return ProjectHistory(store).state().to_dict()

    def project_history_undo(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._project_history_move(params, "undo")

    def project_history_redo(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._project_history_move(params, "redo")

    def _project_history_move(self, params: dict[str, Any], direction: str) -> dict[str, Any]:
        project_id = _required_uuid(params, "projectId")
        expected_head = _required_string(params, "expectedHeadRevisionId")
        with self._open_desktop_project(params, expected_project_id=project_id) as store:
            revision, history = ProjectHistory(store).move(
                "undo" if direction == "undo" else "redo",
                expected_head=expected_head,
            )
            return {**_snapshot_receipt(revision), "history": history.to_dict()}

    def project_get(self, params: dict[str, Any]) -> dict[str, Any]:
        with self._open(params) as store:
            summary = store.summary().to_dict()
            head = store.head_revision()
            return {**summary, "headRevision": None if head is None else head.to_dict()}

    def project_revisions(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        with self._open(params) as store:
            return [
                revision.to_dict()
                for revision in store.list_revisions(limit=int(params.get("limit", 100)))
            ]

    def project_revise(self, params: dict[str, Any]) -> dict[str, Any]:
        with self._open(params) as store:
            return store.create_revision(
                snapshot=_required_object(params, "snapshot"),
                kind=str(params.get("kind", "edit")),
                name=_optional_string(params, "name"),
                message=str(params.get("message", "")),
                expected_head=_optional_string(params, "expectedHead"),
            ).to_dict()

    def project_approve(self, params: dict[str, Any]) -> dict[str, Any]:
        with self._open(params) as store:
            return store.approve(
                name=_required_string(params, "name"),
                message=str(params.get("message", "Approved snapshot")),
            ).to_dict()

    def project_restore(self, params: dict[str, Any]) -> dict[str, Any]:
        with self._open(params) as store:
            return store.restore(
                _required_string(params, "revisionId"), message=_optional_string(params, "message")
            ).to_dict()

    def project_backup(self, params: dict[str, Any]) -> dict[str, Any]:
        with self._open(params) as store:
            destination = (
                None if params.get("destination") is None else Path(str(params["destination"]))
            )
            return {"path": str(store.backup(destination))}

    def project_export(self, params: dict[str, Any]) -> dict[str, Any]:
        with self._open(params) as store:
            path = export_project(
                store,
                Path(_required_string(params, "destination")),
                overwrite=bool(params.get("overwrite", False)),
            )
            return {"path": str(path)}

    def source_import(self, params: dict[str, Any]) -> dict[str, Any]:
        project_id = _required_uuid(params, "projectId")
        filename = _required_string(params, "filename")
        declared_mime = _required_string(params, "mimeType").lower()
        privacy = _required_string(params, "privacy")
        rights_status = _required_string(params, "rightsStatus")
        if privacy not in SOURCE_PRIVACY_CLASSES:
            raise ValueError("privacy is not a supported source privacy class")
        if rights_status not in SOURCE_RIGHTS_STATUSES:
            raise ValueError("rightsStatus is not a supported rights status")
        license_name = _optional_string(params, "license")
        attribution = _optional_string(params, "attribution")
        encoded = _required_string(params, "contentBase64")
        if len(encoded) > MAX_DESKTOP_SOURCE_BASE64_CHARS:
            raise ValueError("contentBase64 exceeds the 8 MiB source import limit")
        try:
            content = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("contentBase64 must be canonical base64") from error
        if len(content) > MAX_DESKTOP_SOURCE_BYTES:
            raise ValueError("decoded source exceeds the 8 MiB source import limit")
        validated = validate_file(
            filename,
            content,
            declared_mime=declared_mime,
            limits=ImportLimits(
                max_files=1,
                max_file_bytes=MAX_DESKTOP_SOURCE_BYTES,
                max_total_bytes=MAX_DESKTOP_SOURCE_BYTES,
            ),
        )

        with self._open_desktop_project(params, expected_project_id=project_id) as store:
            head = store.head_revision()
            if head is None:
                raise ValueError("project has no durable snapshot")
            expected_head = _optional_string(params, "expectedHeadRevisionId")
            if expected_head is not None and expected_head != head.revision_id:
                from .project.errors import RevisionConflictError

                raise RevisionConflictError(
                    f"Expected head {expected_head}, but current head is {head.revision_id}"
                )

            source_id = f"src_{uuid.uuid4().hex}"
            metadata = {
                "sourceId": source_id,
                "privacy": privacy,
                "rightsStatus": rights_status,
                "license": license_name,
                "attribution": attribution,
                "quarantineValidated": True,
            }
            quarantine = store.root / "sources" / "quarantine" / f"{uuid.uuid4().hex}.upload"
            quarantine.parent.mkdir(parents=True, exist_ok=True)
            descriptor = os.open(quarantine, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            try:
                with os.fdopen(descriptor, "wb") as stream:
                    stream.write(content)
                    stream.flush()
                    os.fsync(stream.fileno())
                artifact = store.cas.add_file(
                    quarantine,
                    media_type=validated.detected_mime,
                    original_name=validated.filename,
                    metadata=metadata,
                    max_bytes=MAX_DESKTOP_SOURCE_BYTES,
                )
                store.register_artifact(artifact)
            finally:
                quarantine.unlink(missing_ok=True)

            original_name = f"{artifact.hash[:16]}-{validated.filename}"
            original_path = store.root / "sources" / "original" / original_name
            if not original_path.exists():
                store.cas.copy_to(artifact.hash, original_path)

            source_record = {
                "id": source_id,
                "versionId": f"srcv_{artifact.hash[:24]}",
                "title": validated.filename,
                "filename": validated.filename,
                "origin": "Imported file",
                "kind": "document",
                "mediaType": validated.detected_mime,
                "byteSize": artifact.byte_size,
                "artifactHash": artifact.hash,
                "storedRelativePath": original_path.relative_to(store.root).as_posix(),
                "privacy": privacy,
                "rightsStatus": rights_status,
                "license": license_name or "Rights review required",
                "attribution": attribution,
                "evidence": 0,
                "status": "verified" if rights_status != "unknown" else "review",
            }
            snapshot = copy.deepcopy(head.snapshot)
            sources = snapshot.get("sources")
            if not isinstance(sources, list):
                sources = []
            snapshot["sources"] = [*sources, source_record]
            revision = store.create_revision(
                snapshot=snapshot,
                kind="import",
                message=f"Imported source {validated.filename}",
                expected_head=head.revision_id,
                artifact_links=[
                    {
                        "artifactHash": artifact.hash,
                        "role": "source-original",
                        "stableId": source_id,
                    }
                ],
            )
            ProjectHistory(store).record_new_revision(head.revision_id, revision)
            return {
                **source_record,
                "projectId": project_id,
                "headRevisionId": revision.revision_id,
                "revisionNumber": revision.number,
            }

    def asset_import(self, params: dict[str, Any]) -> dict[str, Any]:
        project_id = _required_uuid(params, "projectId")
        with self._open_desktop_project(params, expected_project_id=project_id) as store:
            return import_project_asset(store, params)

    def presenter_profile_select(self, params: dict[str, Any]) -> dict[str, Any]:
        project_id = _required_uuid(params, "projectId")
        with self._open_desktop_project(params, expected_project_id=project_id) as store:
            return select_presenter_profile(store, params)

    def project_import(self, params: dict[str, Any]) -> dict[str, Any]:
        with import_project(
            Path(_required_string(params, "archive")), Path(_required_string(params, "destination"))
        ) as store:
            return store.summary().to_dict()

    def provider_routing_policy_get(self, params: dict[str, Any]) -> dict[str, Any]:
        with self._open(params) as store:
            head = store.head_revision()
            if head is None:
                raise ValueError("project has no durable snapshot")
            value = head.snapshot.get("providerRoutingPolicy")
            if not isinstance(value, dict):
                return {"policy": None, "headRevisionId": head.revision_id}
            return {
                "policy": parse_routing_policy(value).to_dict(),
                "headRevisionId": head.revision_id,
            }

    def provider_routing_policy_save(self, params: dict[str, Any]) -> dict[str, Any]:
        policy = parse_routing_policy(_required_object(params, "policy"))
        expected_head = _required_string(params, "expectedHeadRevisionId")
        with self._open(params) as store:
            head = store.head_revision()
            if head is None:
                raise ValueError("project has no durable snapshot")
            snapshot = copy.deepcopy(head.snapshot)
            snapshot["providerRoutingPolicy"] = policy.to_dict()
            revision = store.create_revision(
                snapshot=snapshot,
                kind="edit",
                message=str(params.get("message", "Updated provider routing policy"))[:500],
                expected_head=expected_head,
            )
            ProjectHistory(store).record_new_revision(head.revision_id, revision)
            return {
                "policy": policy.to_dict(),
                "headRevisionId": revision.revision_id,
                "revisionNumber": revision.number,
            }

    def job_enqueue(self, params: dict[str, Any]) -> dict[str, Any]:
        with self._open(params) as store:
            runtime = SQLiteWorkflowRuntime(store.connection)
            parameters = _required_object(params, "parameters")
            action = ActionKey(
                kind=_required_string(params, "kind"),
                implementation_version=str(params.get("implementationVersion", "1")),
                parameters=parameters,
                input_hashes=tuple(str(value) for value in params.get("inputHashes", [])),
                provider=str(params.get("provider", "local")),
                model_revision=str(params.get("modelRevision", "none")),
                prompt_version=str(params.get("promptVersion", "none")),
                schema_version=str(params.get("schemaVersion", "1")),
                toolchain_version=str(params.get("toolchainVersion", "1")),
                seed=int(params.get("seed", 0)),
            )
            return runtime.enqueue(
                project_id=store.manifest.project_id,
                kind=action.kind,
                parameters=parameters,
                action_key=action,
                dependency_ids=[str(value) for value in params.get("dependencyIds", [])],
                priority=int(params.get("priority", 0)),
                max_attempts=int(params.get("maxAttempts", 3)),
                estimated_cost_micros=int(params.get("estimatedCostMicros", 0)),
                budget_micros=None
                if params.get("budgetMicros") is None
                else int(params["budgetMicros"]),
            ).to_dict()

    def job_enqueue_mock_generation(self, params: dict[str, Any]) -> dict[str, Any]:
        with self._open(params) as store:
            runtime = SQLiteWorkflowRuntime(store.connection)
            return MockGenerationWorkflow(store, runtime).enqueue(
                topic=_required_string(params, "topic"),
                audience=str(params.get("audience", "General")),
                language=str(params.get("language", "en")),
                duration_minutes=int(params.get("durationMinutes", 5)),
                seed=int(params.get("seed", 0)),
                budget_micros=None
                if params.get("budgetMicros") is None
                else int(params["budgetMicros"]),
            )

    def job_get(self, params: dict[str, Any]) -> dict[str, Any]:
        with self._open(params) as store:
            return (
                SQLiteWorkflowRuntime(store.connection)
                .get_job(_required_string(params, "jobId"))
                .to_dict()
            )

    def job_list(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        with self._open(params) as store:
            state_values = params.get("states")
            states = (
                None if state_values is None else [JobState(str(value)) for value in state_values]
            )
            return [
                job.to_dict()
                for job in SQLiteWorkflowRuntime(store.connection).list_jobs(
                    project_id=store.manifest.project_id,
                    states=states,
                    limit=int(params.get("limit", 200)),
                )
            ]

    def job_events(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        with self._open(params) as store:
            return [
                event.to_dict()
                for event in SQLiteWorkflowRuntime(store.connection).events(
                    _required_string(params, "jobId"),
                    after_sequence=int(params.get("afterSequence", 0)),
                    limit=int(params.get("limit", 500)),
                )
            ]

    def job_cancel(self, params: dict[str, Any]) -> dict[str, Any]:
        with self._open(params) as store:
            return (
                SQLiteWorkflowRuntime(store.connection)
                .cancel(_required_string(params, "jobId"))
                .to_dict()
            )

    def job_retry(self, params: dict[str, Any]) -> dict[str, Any]:
        with self._open(params) as store:
            return (
                SQLiteWorkflowRuntime(store.connection)
                .retry(_required_string(params, "jobId"))
                .to_dict()
            )

    def job_run_pending(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        with self._open(params) as store:
            runtime = SQLiteWorkflowRuntime(store.connection)
            mock_workflow = MockGenerationWorkflow(store, runtime)
            generation = _production_generation_coordinator(
                store,
                runtime,
                provider_runtime_factory=self._provider_runtime_factory,
            )
            handlers = {**mock_workflow.handlers, **generation.workflow.handlers}
            return [
                job.to_dict()
                for job in runtime.run_until_idle(
                    handlers,
                    max_jobs=int(params.get("maxJobs", 1000)),
                )
            ]

    def job_recover(self, params: dict[str, Any]) -> dict[str, Any]:
        with self._open(params) as store:
            return {"recoveredJobIds": SQLiteWorkflowRuntime(store.connection).recover_expired()}

    def job_usage(self, params: dict[str, Any]) -> dict[str, Any]:
        with self._open(params) as store:
            return (
                SQLiteWorkflowRuntime(store.connection)
                .usage_summary(_required_string(params, "jobId"))
                .to_dict()
            )

    def dependency_invalidate(self, params: dict[str, Any]) -> dict[str, Any]:
        with self._open(params) as store:
            keys = params.get("logicalKeys")
            if not isinstance(keys, list) or not all(isinstance(value, str) for value in keys):
                raise ValueError("logicalKeys must be an array of strings")
            graph = DependencyGraph(store.connection, store.manifest.project_id)
            return {"invalidated": graph.invalidate_from(keys)}

    def generation_start(self, params: dict[str, Any]) -> dict[str, Any]:
        """Atomically accept a staged workflow without running it on the RPC thread."""
        project_id = _required_uuid(params, "projectId")
        request_id = str(uuid.uuid4())
        project_path = Path(_required_string(params, "projectDirectory"))
        with self._open_desktop_project(params, expected_project_id=project_id) as store:
            coordinator = self._generation_coordinator_factory(store, None)
            status = coordinator.start(
                request_from_desktop(store, params),
                generation_id=request_id,
            )
            receipt = _generation_receipt(
                status,
                "Generation accepted; planning continues in the background",
                coordinator=coordinator,
            )
        self._notify_background(project_path)
        return receipt

    def generation_approve(self, params: dict[str, Any]) -> dict[str, Any]:
        project_id = _required_uuid(params, "projectId")
        generation_id = _required_uuid(params, "jobId")
        project_path = Path(_required_string(params, "projectDirectory"))
        with self._open_desktop_project(params, expected_project_id=project_id) as store:
            coordinator = self._generation_coordinator_factory(store, None)
            status = coordinator.approve(
                generation_id,
                name=str(params.get("name", "Approved storyboard")),
                message=str(params.get("message", "Approved in Alystria Studio")),
            )
            receipt = _generation_receipt(
                status,
                "Approval accepted; generation continues in the background",
                coordinator=coordinator,
            )
        self._notify_background(project_path)
        return receipt

    def generation_cancel(self, params: dict[str, Any]) -> dict[str, Any]:
        project_id = _required_uuid(params, "projectId")
        generation_id = _required_uuid(params, "jobId")
        project_path = Path(_required_string(params, "projectDirectory"))
        with self._open_desktop_project(params, expected_project_id=project_id) as store:
            native = _native_control_for_job(store, generation_id)
            if native is not None:
                return native_job_receipt(native.cancel(generation_id))
            coordinator = GenerationCoordinator(store)
            receipt = _generation_receipt(
                coordinator.cancel(generation_id),
                "Cancellation requested",
                coordinator=coordinator,
            )
        self._notify_background(project_path)
        return receipt

    def generation_retry(self, params: dict[str, Any]) -> dict[str, Any]:
        project_id = _required_uuid(params, "projectId")
        generation_id = _required_uuid(params, "jobId")
        project_path = Path(_required_string(params, "projectDirectory"))
        with self._open_desktop_project(params, expected_project_id=project_id) as store:
            native = _native_control_for_job(store, generation_id)
            if native is not None:
                return native_job_receipt(native.retry(generation_id))
            coordinator = self._generation_coordinator_factory(store, None)
            status = coordinator.retry(generation_id)
            receipt = _generation_receipt(
                status,
                "Generation request queued for background retry",
                coordinator=coordinator,
            )
        self._notify_background(project_path)
        return receipt

    def control_regenerate_scene(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._submit_native_control(params, "regenerate")

    def control_render_scene(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._submit_native_control(params, "render")

    def control_repair_qa(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._submit_native_control(params, "repair")

    def control_export_master(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._submit_native_control(params, "export")

    def _submit_native_control(self, params: dict[str, Any], operation: str) -> dict[str, Any]:
        project_id = _required_uuid(params, "projectId")
        project_path = Path(_required_string(params, "projectDirectory"))
        with self._open_desktop_project(params, expected_project_id=project_id) as store:
            # Submission remains a bounded SQLite transaction. Runtime
            # resolution and heavyweight rendering happen only on the
            # background supervisor thread.
            control = NativeControlCoordinator(store)
            submit = {
                "regenerate": control.submit_regeneration,
                "render": control.submit_scene_render,
                "repair": control.submit_qa_repair,
                "export": control.submit_master_export,
            }[operation]
            receipt = native_job_receipt(submit(params))
        self._notify_background(project_path)
        return receipt

    def desktop_job_status(self, params: dict[str, Any]) -> dict[str, Any]:
        project_id = _required_uuid(params, "projectId")
        generation_id = _required_uuid(params, "jobId")
        project_path = Path(_required_string(params, "projectDirectory"))
        with self._open_desktop_project(params, expected_project_id=project_id) as store:
            native = _native_control_for_job(store, generation_id)
            if native is not None:
                return native_job_receipt(native.status(generation_id))
            coordinator = GenerationCoordinator(store)
            receipt = _generation_receipt(
                coordinator.status(generation_id),
                "Generation status refreshed",
                coordinator=coordinator,
            )
        # Registering on status is what lets a freshly restarted worker discover
        # and recover an in-flight project without needing a new generation.
        self._notify_background(project_path)
        return receipt

    def _notify_background(self, project_path: Path) -> None:
        if self._background_supervisor is not None:
            self._background_supervisor.register(project_path)

    def _open_desktop_project(
        self, params: dict[str, Any], *, expected_project_id: str
    ) -> ProjectStore:
        store = ProjectStore.open(Path(_required_string(params, "projectDirectory")))
        if store.manifest.project_id != expected_project_id:
            store.close()
            raise ValueError("projectId does not match the project manifest")
        return store

    def _desktop_job(self, params: dict[str, Any]) -> _DesktopJobContext:
        project_id = _required_uuid(params, "projectId")
        job_id = _required_uuid(params, "jobId")
        store = self._open_desktop_project(params, expected_project_id=project_id)
        return _DesktopJobContext(store, job_id)

    @staticmethod
    def _open(params: dict[str, Any]) -> ProjectStore:
        return ProjectStore.open(Path(_required_string(params, "projectPath")))


def _required_string(params: dict[str, Any], key: str) -> str:
    value = params.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} must be a non-empty string")
    return value


def _optional_string(params: dict[str, Any], key: str) -> str | None:
    value = params.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{key} must be a string or null")
    return value


def _required_object(params: dict[str, Any], key: str) -> dict[str, Any]:
    value = params.get(key)
    if not isinstance(value, dict):
        raise ValueError(f"{key} must be an object")
    return value


def _validate_snapshot(value: dict[str, Any]) -> dict[str, Any]:
    try:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise ValueError("snapshot must contain only JSON values") from error
    if len(encoded) > MAX_DESKTOP_SNAPSHOT_BYTES:
        raise ValueError("snapshot exceeds the 1 MiB project limit")
    return copy.deepcopy(value)


def _required_snapshot(params: dict[str, Any], key: str) -> dict[str, Any]:
    return _validate_snapshot(_required_object(params, key))


def _optional_snapshot(params: dict[str, Any], key: str) -> dict[str, Any] | None:
    value = _optional_object(params, key)
    return None if value is None else _validate_snapshot(value)


def _optional_object(params: dict[str, Any], key: str) -> dict[str, Any] | None:
    value = params.get(key)
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError(f"{key} must be an object or null")
    return value


def _required_uuid(params: dict[str, Any], key: str) -> str:
    value = _required_string(params, key)
    try:
        return str(uuid.UUID(value))
    except ValueError as error:
        raise ValueError(f"{key} must be a UUID") from error


def _job_receipt(job: Job, message: str) -> dict[str, Any]:
    return {
        "jobId": job.job_id,
        "state": job.state.value,
        "acceptedAt": job.created_at,
        "message": message,
        "retryable": job.state in {JobState.FAILED, JobState.CANCELLED, JobState.STALE},
    }


class _QueuedRendererClient:
    """Cheap renderer identity used only while transactionally enqueueing work."""

    renderer_id = "alystria-node-renderer"

    def __init__(self, renderer_version: str) -> None:
        self.renderer_version = renderer_version

    def render(self, request: dict[str, Any]) -> RenderedTutorial:
        del request
        raise RuntimeError("Queue-only renderer cannot execute a render")


def _enqueue_generation_coordinator(
    store: ProjectStore,
    runtime: SQLiteWorkflowRuntime | None = None,
    *,
    provider_runtime_factory: ProviderRuntimeFactory | None = None,
) -> GenerationCoordinator:
    """Build task keys without hashing/probing the renderer on an RPC thread."""

    media_client = default_local_media_client()
    educational_provider = None
    head = store.head_revision()
    routing_value = None if head is None else head.snapshot.get("providerRoutingPolicy")
    if isinstance(routing_value, dict):
        if provider_runtime_factory is None:
            raise ValueError(
                "Project provider routing requires an authenticated credential runtime"
            )
        provider_runtime = provider_runtime_factory.build(parse_routing_policy(routing_value))
        media_client = RuntimeGenerationMediaClient(provider_runtime)
        if any(
            route.capability is Capability.LLM_STRUCTURED
            for route in provider_runtime.policy.routes
        ):
            educational_provider = StructuredWritingEducationalProvider.from_runtime(
                provider_runtime
            )
    media_client = _configured_local_presenter(store, media_client)
    return GenerationCoordinator(
        store,
        runtime,
        media_client=media_client,
        renderer_client=_queued_renderer_identity(),
        educational_provider=educational_provider,
    )


def _queued_renderer_identity() -> RendererClient:
    mode = os.environ.get("ALYSTRIA_RENDERER_MODE", "production").strip().casefold()
    if mode == "fixture":
        return DeterministicRendererClient()
    if mode == "production":
        manifest_value = os.environ.get("ALYSTRIA_RUNTIME_MANIFEST_PATH")
        if not manifest_value:
            raise RendererRuntimeError("The verified renderer runtime manifest is missing")
        manifest = json.loads(Path(manifest_value).read_text(encoding="utf-8"))
        components = manifest.get("components") if isinstance(manifest, dict) else None
        if not isinstance(components, list):
            raise RendererRuntimeError("Installed runtime manifest has no component ledger")
        renderer = next(
            (
                item
                for item in components
                if isinstance(item, dict) and item.get("id") == "renderer-cli"
            ),
            None,
        )
        version = None if renderer is None else renderer.get("version")
    elif mode == "repository":
        root_value = os.environ.get("ALYSTRIA_REPOSITORY_ROOT")
        if not root_value:
            raise RendererRuntimeError("Repository renderer root is missing")
        package = json.loads(
            (Path(root_value) / "services" / "renderer" / "package.json").read_text(
                encoding="utf-8"
            )
        )
        version = package.get("version") if isinstance(package, dict) else None
    else:
        raise RendererRuntimeError(f"Unsupported ALYSTRIA_RENDERER_MODE {mode!r}")
    if not isinstance(version, str) or not version.strip():
        raise RendererRuntimeError("Renderer identity is missing its version")
    return _QueuedRendererClient(version)


def _production_generation_coordinator(
    store: ProjectStore,
    runtime: SQLiteWorkflowRuntime | None = None,
    *,
    provider_runtime_factory: ProviderRuntimeFactory | None = None,
) -> GenerationCoordinator:
    """Use the explicit fixture mode or a complete signed/pinned runtime pack.

    The packaged desktop runtime sets every path from its verified manifest.
    A partial or invalid set fails closed and is never guessed from the host.
    """

    renderer = _production_renderer_client(store)
    media_client = default_local_media_client()
    educational_provider = None
    head = store.head_revision()
    routing_value = None if head is None else head.snapshot.get("providerRoutingPolicy")
    if isinstance(routing_value, dict):
        if provider_runtime_factory is None:
            raise ValueError(
                "Project provider routing requires an authenticated credential runtime"
            )
        provider_runtime = provider_runtime_factory.build(parse_routing_policy(routing_value))
        media_client = RuntimeGenerationMediaClient(provider_runtime)
        if any(
            route.capability is Capability.LLM_STRUCTURED
            for route in provider_runtime.policy.routes
        ):
            educational_provider = StructuredWritingEducationalProvider.from_runtime(
                provider_runtime
            )
    media_client = _configured_local_presenter(store, media_client)
    return GenerationCoordinator(
        store,
        runtime,
        media_client=media_client,
        renderer_client=renderer,
        educational_provider=educational_provider,
    )


def _configured_local_presenter(
    store: ProjectStore, media_client: GenerationMediaClient
) -> GenerationMediaClient:
    """Attach the installed local presenter only through an explicit config path.

    The privileged desktop/model manager owns this file. Missing configuration
    preserves the selected visual/TTS client; malformed or unsafe configuration
    fails closed instead of silently returning fixture presenter metadata.
    """

    config_value = os.environ.get("ALYSTRIA_LOCAL_PRESENTER_CONFIG_PATH")
    if not config_value:
        return media_client
    config_path = Path(config_value)
    # The portable launcher always reserves this path, including before an
    # optional presenter runtime has been installed. A genuinely absent file
    # means "not configured"; an existing directory, malformed file, or even a
    # broken symlink still reaches the strict loader and fails closed.
    if not config_path.exists() and not config_path.is_symlink():
        return media_client
    return load_local_presenter_media_client(store, media_client, config_path)


def _production_renderer_client(store: ProjectStore) -> RendererClient:
    """Resolve an explicit renderer mode and fail closed in managed production.

    ``fixture`` is intentionally available to tests and deterministic examples.
    The packaged desktop always supplies ``production`` plus paths emitted by
    the verified runtime pack. No missing or corrupt production pack can become
    a success-looking fixture render.
    """

    mode = os.environ.get("ALYSTRIA_RENDERER_MODE", "production").strip().casefold()
    if mode == "fixture":
        return DeterministicRendererClient()
    if mode not in {"production", "repository"}:
        raise RendererRuntimeError(f"Unsupported ALYSTRIA_RENDERER_MODE {mode!r}")

    common_paths = {
        "node_path": os.environ.get("ALYSTRIA_NODE_PATH"),
        "renderer_cli_path": os.environ.get("ALYSTRIA_RENDERER_CLI_PATH"),
        "chromium_path": os.environ.get("ALYSTRIA_CHROMIUM_PATH"),
        "ffmpeg_path": os.environ.get("ALYSTRIA_FFMPEG_PATH"),
        "ffprobe_path": os.environ.get("ALYSTRIA_FFPROBE_PATH"),
    }
    if mode == "production":
        required_paths = {
            "runtime_pack_root": os.environ.get("ALYSTRIA_RUNTIME_PACK_ROOT"),
            "runtime_manifest_path": os.environ.get("ALYSTRIA_RUNTIME_MANIFEST_PATH"),
            **common_paths,
        }
    else:
        required_paths = {
            "repository_root": os.environ.get("ALYSTRIA_REPOSITORY_ROOT"),
            **common_paths,
        }
    missing = sorted(name for name, value in required_paths.items() if not value)
    if missing:
        raise RendererRuntimeError(
            "The verified renderer runtime is incomplete; missing " + ", ".join(missing)
        )
    try:
        options = RendererOptions(
            concurrency=_renderer_environment_integer(
                "ALYSTRIA_RENDERER_CONCURRENCY", default=2, minimum=1, maximum=8
            ),
            timeout_seconds=float(
                _renderer_environment_integer(
                    "ALYSTRIA_RENDERER_TIMEOUT_SECONDS",
                    default=3_600,
                    minimum=60,
                    maximum=86_400,
                )
            ),
        )
        if mode == "production":
            return create_production_renderer_client(
                store,
                runtime_pack_root=Path(required_paths["runtime_pack_root"] or ""),
                runtime_manifest_path=Path(required_paths["runtime_manifest_path"] or ""),
                node_path=Path(required_paths["node_path"] or ""),
                renderer_cli_path=Path(required_paths["renderer_cli_path"] or ""),
                chromium_path=Path(required_paths["chromium_path"] or ""),
                ffmpeg_path=Path(required_paths["ffmpeg_path"] or ""),
                ffprobe_path=Path(required_paths["ffprobe_path"] or ""),
                options=options,
            )
        return create_production_renderer_client(
            store,
            repository_root=Path(required_paths["repository_root"] or ""),
            node_path=Path(required_paths["node_path"] or ""),
            renderer_cli_path=Path(required_paths["renderer_cli_path"] or ""),
            chromium_path=Path(required_paths["chromium_path"] or ""),
            ffmpeg_path=Path(required_paths["ffmpeg_path"] or ""),
            ffprobe_path=Path(required_paths["ffprobe_path"] or ""),
            options=options,
        )
    except (OSError, ValueError, RendererClientError) as error:
        raise RendererRuntimeError(
            f"The verified renderer runtime could not be loaded: {error}"
        ) from error


def _renderer_environment_integer(name: str, *, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as error:
        raise RendererRuntimeError(f"{name} must be an integer") from error
    if not minimum <= value <= maximum:
        raise RendererRuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


def _native_control_for_job(store: ProjectStore, job_id: str) -> NativeControlCoordinator | None:
    runtime = SQLiteWorkflowRuntime(store.connection)
    try:
        job = runtime.get_job(job_id)
    except KeyError:
        return None
    if not job.kind.startswith("native."):
        return None
    return NativeControlCoordinator(store)


def _generation_receipt(
    status: GenerationStatus,
    message: str,
    *,
    coordinator: GenerationCoordinator | None = None,
) -> dict[str, Any]:
    states = {
        GenerationState.QUEUED: "QUEUED",
        GenerationState.RUNNING: "RUNNING",
        GenerationState.WAITING_APPROVAL: "BLOCKED",
        GenerationState.FAILED: "FAILED",
        GenerationState.CANCELLED: "CANCELLED",
        GenerationState.SUCCEEDED: "SUCCEEDED",
    }
    value = {
        "jobId": status.generation_id,
        "state": states[status.state],
        "acceptedAt": datetime.now(UTC).isoformat(),
        "message": message,
        "retryable": status.state in {GenerationState.FAILED, GenerationState.CANCELLED},
        "progress": status.progress,
        "approvalRevisionId": status.approval_revision_id,
        "finalRevisionId": status.final_revision_id,
        "stages": [
            {
                "stage": stage.stage.value,
                "jobId": stage.job_id,
                "state": stage.state,
                "progress": stage.progress,
                "artifactHash": stage.artifact_hash,
                "revisionId": stage.revision_id,
                "error": stage.error,
            }
            for stage in status.stages
        ],
    }
    if coordinator is not None:
        value["events"] = coordinator.events(status.generation_id, limit=200)
    return value


def desktop_run_one(
    store: ProjectStore,
    runtime: SQLiteWorkflowRuntime,
    *,
    provider_runtime_factory: ProviderRuntimeFactory | None = None,
) -> Job | None:
    """Execute at most one desktop-owned task for process-lifetime supervision."""

    mock_workflow = MockGenerationWorkflow(store, runtime)
    renderer: RendererClient | None
    try:
        renderer = _production_renderer_client(store)
    except RendererClientError:
        renderer = None
    controls = NativeControlCoordinator(store, renderer=renderer)
    handlers = {**mock_workflow.handlers, **controls.handlers}
    try:
        generation = _production_generation_coordinator(
            store,
            runtime,
            provider_runtime_factory=provider_runtime_factory,
        )
    except (RendererClientError, ValueError):
        # Generation jobs fail with NO_HANDLER while native render/export jobs
        # execute their own actionable missing-runtime gate.
        generation = None
    if generation is not None:
        handlers.update(generation.workflow.handlers)
    return runtime.run_once(handlers)


def _snapshot_receipt(revision: Any) -> dict[str, Any]:
    return {
        "projectId": revision.project_id,
        "headRevisionId": revision.revision_id,
        "revisionNumber": revision.number,
        "rootHash": revision.root_hash,
        "updatedAt": revision.created_at,
        "snapshot": revision.snapshot,
    }


class _DesktopJobContext:
    """Own the project connection while a desktop job action is evaluated."""

    def __init__(self, store: ProjectStore, job_id: str) -> None:
        self._store = store
        self._job_id = job_id

    def __enter__(self) -> tuple[SQLiteWorkflowRuntime, str]:
        runtime = SQLiteWorkflowRuntime(self._store.connection)
        try:
            job = runtime.get_job(self._job_id)
            if job.project_id != self._store.manifest.project_id:
                raise ValueError("jobId does not belong to projectId")
        except BaseException:
            self._store.close()
            raise
        return runtime, self._job_id

    def __exit__(self, *_: object) -> None:
        self._store.close()
