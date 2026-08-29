"""Durable native editor operations invoked through the privilege broker.

These operations never impersonate browser-demo simulations.  Every request is
validated against the current immutable project revision, represented by a
SQLite job, and either produces a CAS artifact/revision or returns a durable
failed job with an actionable gate/runtime error.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
import uuid
from typing import Any

from alystria.generation import GenerationCoordinator, GenerationState
from alystria.generation.adapters import RendererClient
from alystria.jobs import ActionKey, DependencyGraph, Job, JobContext, JobState
from alystria.jobs.runtime import SQLiteWorkflowRuntime
from alystria.project import ProjectStore, Revision
from alystria.project_assets import validate_approved_presenter_for_export

TICKS_PER_SECOND = 240_000
CONTROL_IMPLEMENTATION_VERSION = "native-controls-v1"
SCENE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
ALLOWED_LOCKS = frozenset(
    {"narration", "citations", "learningobjective", "timing", "assets", "presenter"}
)
RESOLUTIONS = {
    "1080p": (1920, 1080),
    "1440p": (2560, 1440),
    "4k": (3840, 2160),
}
ASPECTS = frozenset({"16:9", "9:16", "1:1"})
FPS_VALUES = frozenset({24, 25, 30, 50, 60})


class NativeControlCoordinator:
    def __init__(
        self,
        store: ProjectStore,
        *,
        renderer: RendererClient | None = None,
    ) -> None:
        self.store = store
        self.runtime = SQLiteWorkflowRuntime(store.connection)
        self.renderer = renderer
        self.handlers = {
            "native.regenerate_scene": self._regenerate_scene,
            "native.render_scene": self._render_scene,
            "native.repair_qa": self._repair_qa,
            "native.export_master": self._export_master,
        }

    def submit_regeneration(self, params: dict[str, Any]) -> Job:
        head, scene = self._validate_scene_base(params)
        instruction = _bounded_text(params.get("instruction"), "instruction", 4_000)
        locks = _locks(params.get("preservationLocks", []))
        alternatives = _integer(params.get("alternatives", 1), "alternatives", 1, 4)
        base_generation_id = self._validate_base_generation(params.get("baseJobId"))
        parameters = {
            "expectedHeadRevisionId": head.revision_id,
            "baseRevisionId": _required_text(params, "baseRevisionId"),
            "baseGenerationId": base_generation_id,
            "sceneId": scene["id"],
            "instruction": instruction,
            "preservationLocks": sorted(locks),
            "alternatives": alternatives,
        }
        return self._enqueue("native.regenerate_scene", parameters, head.root_hash)

    def submit_scene_render(self, params: dict[str, Any]) -> Job:
        head, scene = self._validate_scene_base(params)
        base_generation_id = self._validate_base_generation(params.get("baseJobId"))
        target = _target(params)
        parameters = {
            "expectedHeadRevisionId": head.revision_id,
            "baseRevisionId": _required_text(params, "baseRevisionId"),
            "baseGenerationId": base_generation_id,
            "sceneId": scene["id"],
            "target": target,
        }
        return self._enqueue("native.render_scene", parameters, head.root_hash)

    def submit_qa_repair(self, params: dict[str, Any]) -> Job:
        head = self._validate_head(params)
        base_generation_id = self._validate_base_generation(params.get("baseJobId"), required=True)
        assert base_generation_id is not None
        finding_ids = params.get("findingIds")
        if (
            not isinstance(finding_ids, list)
            or not 1 <= len(finding_ids) <= 20
            or not all(isinstance(value, str) and 0 < len(value) <= 160 for value in finding_ids)
        ):
            raise ValueError("findingIds must contain between 1 and 20 bounded strings")
        selected = self._selected_repairable_findings(base_generation_id, set(finding_ids))
        parameters = {
            "expectedHeadRevisionId": head.revision_id,
            "baseRevisionId": _required_text(params, "baseRevisionId"),
            "baseGenerationId": base_generation_id,
            "findingIds": sorted(selected),
        }
        return self._enqueue("native.repair_qa", parameters, head.root_hash)

    def submit_master_export(self, params: dict[str, Any]) -> Job:
        head = self._validate_head(params)
        base_generation_id = self._validate_base_generation(params.get("baseJobId"), required=True)
        assert base_generation_id is not None
        status = GenerationCoordinator(self.store).status(base_generation_id)
        if status.state is not GenerationState.SUCCEEDED:
            raise ValueError("Master export requires a completed, approved generation job")
        target = _target(params)
        parameters = {
            "expectedHeadRevisionId": head.revision_id,
            "baseRevisionId": _required_text(params, "baseRevisionId"),
            "baseGenerationId": base_generation_id,
            "target": target,
            "captions": bool(params.get("captions", True)),
            "transcript": bool(params.get("transcript", True)),
            "bibliography": bool(params.get("bibliography", True)),
        }
        return self._enqueue("native.export_master", parameters, head.root_hash)

    def status(self, job_id: str) -> Job:
        return self.runtime.get_job(job_id)

    def cancel(self, job_id: str) -> Job:
        return self.runtime.cancel(job_id)

    def retry(self, job_id: str) -> Job:
        return self.runtime.retry(job_id)

    def _enqueue(self, kind: str, parameters: dict[str, Any], root_hash: str) -> Job:
        action = ActionKey(
            kind,
            CONTROL_IMPLEMENTATION_VERSION,
            parameters,
            input_hashes=(root_hash,),
            provider="local-native",
            model_revision="none",
            schema_version="1",
            toolchain_version="alystria-2",
        )
        job = self.runtime.enqueue(
            project_id=self.store.manifest.project_id,
            kind=kind,
            parameters=parameters,
            job_id=str(uuid.uuid4()),
            action_key=action,
            max_attempts=2,
        )
        return job

    def _validate_head(self, params: dict[str, Any]) -> Revision:
        expected = _required_text(params, "baseRevisionId")
        head = self.store.head_revision()
        if head is None:
            raise ValueError("Project has no durable base revision")
        if head.revision_id != expected:
            raise ValueError(
                f"Base revision {expected} is stale; current head is {head.revision_id}"
            )
        return head

    def _validate_scene_base(self, params: dict[str, Any]) -> tuple[Revision, dict[str, Any]]:
        head = self._validate_head(params)
        scene_id = _required_text(params, "sceneId")
        if not SCENE_ID_PATTERN.fullmatch(scene_id):
            raise ValueError("sceneId contains unsupported characters")
        scene = _scene(head.snapshot, scene_id)
        return head, scene

    def _validate_base_generation(self, value: Any, *, required: bool = False) -> str | None:
        if value is None and not required:
            return None
        if not isinstance(value, str):
            raise ValueError("baseJobId must identify a durable generation job")
        try:
            generation_id = str(uuid.UUID(value))
        except ValueError as error:
            raise ValueError("baseJobId must be a UUID") from error
        GenerationCoordinator(self.store).status(generation_id)
        return generation_id

    def _regenerate_scene(self, context: JobContext, params: dict[str, Any]) -> dict[str, Any]:
        head = self._require_current_head(params)
        scene = _scene(head.snapshot, str(params["sceneId"]))
        context.set_progress(0.2, message="Recording scoped candidate work")
        candidates = []
        for index in range(int(params["alternatives"])):
            candidate_id = f"candidate_{uuid.uuid4().hex}"
            candidates.append(
                {
                    "id": candidate_id,
                    "sceneId": scene["id"],
                    "baseRevisionId": head.revision_id,
                    "baseGenerationId": params.get("baseGenerationId"),
                    "instruction": params["instruction"],
                    "preservationLocks": params["preservationLocks"],
                    "alternativeIndex": index,
                    "status": "queued_for_configured_generator",
                    "acceptedSceneUnchanged": True,
                }
            )
        artifact = self.store.add_artifact_bytes(
            (json.dumps({"candidates": candidates}, sort_keys=True, separators=(",", ":")) + "\n").encode(),
            media_type="application/vnd.alystria.scene-candidates+json",
            original_name=f"{scene['id']}-candidates.json",
            metadata={"sceneId": scene["id"], "rightsStatus": "owned"},
        )
        snapshot = copy.deepcopy(head.snapshot)
        existing = snapshot.get("sceneCandidates")
        snapshot["sceneCandidates"] = [*(existing if isinstance(existing, list) else []), *candidates]
        revision = self.store.create_revision(
            snapshot=snapshot,
            kind="generation",
            message=f"Scoped candidate request for scene {scene['id']}",
            expected_head=head.revision_id,
            artifact_links=[
                {
                    "artifactHash": artifact.hash,
                    "role": "scene-candidate-request",
                    "stableId": str(scene["id"]),
                }
            ],
        )
        invalidated = self._invalidate_scene(
            str(scene["id"]),
            params.get("baseGenerationId"),
            set(params["preservationLocks"]),
            head.root_hash,
        )
        context.set_progress(1, message="Candidate work persisted without replacing the accepted scene")
        return {
            "operation": "regenerate_scene",
            "sceneId": scene["id"],
            "baseRevisionId": head.revision_id,
            "headRevisionId": revision.revision_id,
            "revisionNumber": revision.number,
            "candidateIds": [item["id"] for item in candidates],
            "candidateArtifactHash": artifact.hash,
            "candidateStatus": "queued_for_configured_generator",
            "invalidated": invalidated,
        }

    def _render_scene(self, context: JobContext, params: dict[str, Any]) -> dict[str, Any]:
        head = self._require_current_head(params)
        if self.renderer is None:
            raise RuntimeError(
                "Pinned renderer runtime is unavailable; install/verify Node, Chromium, FFmpeg, and ffprobe before rendering"
            )
        scene = _scene(head.snapshot, str(params["sceneId"]))
        generation_id = params.get("baseGenerationId")
        narration, captions = self._scene_media(generation_id, str(scene["id"]))
        presenters = self._scene_presenters(generation_id, str(scene["id"]))
        context.set_progress(0.1, message="Submitting one immutable scene to the pinned renderer")
        rendered = self.renderer.render(
            {
                "schemaVersion": 1,
                "generationId": context.job_id,
                "timebase": TICKS_PER_SECOND,
                "seed": 0,
                "targets": [params["target"]],
                "scenes": [_renderer_scene(scene)],
                "narration": narration,
                "captions": captions,
                "presenters": presenters,
            }
        )
        artifact = self.store.add_artifact_bytes(
            rendered.content,
            media_type=rendered.media_type,
            original_name=rendered.original_name,
            metadata={
                "renderer": self.renderer.renderer_id,
                "rendererVersion": self.renderer.renderer_version,
                "sceneId": scene["id"],
                "rightsStatus": "owned",
            },
        )
        extension = ".webm" if rendered.media_type == "video/webm" else ".mp4"
        destination = self.store.root / "exports" / "previews" / f"{scene['id']}-{uuid.uuid4().hex[:10]}{extension}"
        self.store.cas.copy_to(artifact.hash, destination)
        context.set_progress(1, message="Scene preview rendered and promoted")
        return {
            "operation": "render_scene",
            "sceneId": scene["id"],
            "artifactHash": artifact.hash,
            "path": str(destination),
            "mediaType": rendered.media_type,
            "renderManifest": rendered.manifest,
            "metrics": rendered.metrics,
        }

    def _repair_qa(self, context: JobContext, params: dict[str, Any]) -> dict[str, Any]:
        head = self._require_current_head(params)
        finding_ids = list(params["findingIds"])
        candidates = [
            {
                "id": f"qa_candidate_{uuid.uuid4().hex}",
                "findingId": finding_id,
                "baseGenerationId": params["baseGenerationId"],
                "baseRevisionId": head.revision_id,
                "status": "queued_for_bounded_repair",
                "attemptLimit": 2,
            }
            for finding_id in finding_ids
        ]
        snapshot = copy.deepcopy(head.snapshot)
        existing = snapshot.get("qaRepairCandidates")
        snapshot["qaRepairCandidates"] = [*(existing if isinstance(existing, list) else []), *candidates]
        artifact = self.store.add_artifact_bytes(
            (json.dumps({"repairs": candidates}, sort_keys=True, separators=(",", ":")) + "\n").encode(),
            media_type="application/vnd.alystria.qa-repair-candidates+json",
            original_name="qa-repair-candidates.json",
            metadata={"generationId": params["baseGenerationId"], "rightsStatus": "owned"},
        )
        revision = self.store.create_revision(
            snapshot=snapshot,
            kind="generation",
            message=f"Queued {len(candidates)} selected QA repair candidate(s)",
            expected_head=head.revision_id,
            artifact_links=[
                {
                    "artifactHash": artifact.hash,
                    "role": "qa-repair-request",
                    "stableId": params["baseGenerationId"],
                }
            ],
        )
        graph = DependencyGraph(self.store.connection, self.store.manifest.project_id)
        roots = [f"generation:{params['baseGenerationId']}:qa_final"]
        invalidated = graph.invalidate_from(roots)
        context.set_progress(1, message="Selected repair work persisted with a two-attempt bound")
        return {
            "operation": "repair_qa",
            "headRevisionId": revision.revision_id,
            "revisionNumber": revision.number,
            "findingIds": finding_ids,
            "candidateIds": [item["id"] for item in candidates],
            "candidateArtifactHash": artifact.hash,
            "invalidated": invalidated,
        }

    def _export_master(self, context: JobContext, params: dict[str, Any]) -> dict[str, Any]:
        self._require_current_head(params)
        if self.renderer is None:
            raise RuntimeError(
                "Pinned renderer runtime is unavailable; master export is disabled until runtime diagnostics pass"
            )
        generation_id = str(params["baseGenerationId"])
        generation_status = GenerationCoordinator(self.store).status(generation_id)
        if generation_status.approval_revision_id is None:
            raise ValueError("Master export requires a durable approval revision")
        validate_approved_presenter_for_export(
            self.store,
            generation_status.approval_revision_id,
            distribution_scope="publicCommercial",
        )
        storyboard = self._stage_payload(generation_id, "storyboard")["storyboard"]
        narration_payload = self._stage_payload(generation_id, "narration")
        captions_payload = self._stage_payload(generation_id, "captions")
        presenter_payload = self._stage_payload(generation_id, "presenter")
        qa_payload = self._stage_payload(generation_id, "qa_final")
        gate = qa_payload.get("qualityGate")
        if not isinstance(gate, dict) or gate.get("status") not in {"PASS", "WARNING"}:
            raise ValueError("Master export is blocked because the final QA gate does not permit export")
        context.set_progress(0.08, message="Rendering approved storyboard with selected master target")
        rendered = self.renderer.render(
            {
                "schemaVersion": 1,
                "generationId": context.job_id,
                "timebase": TICKS_PER_SECOND,
                "seed": 0,
                "targets": [params["target"]],
                "scenes": storyboard["scenes"],
                "narration": narration_payload["narration"],
                "captions": captions_payload if params["captions"] else {"captionsEnabled": False},
                "presenters": presenter_payload.get("presenters", []),
                "locale": storyboard.get("locale", "en-US"),
            }
        )
        artifact = self.store.add_artifact_bytes(
            rendered.content,
            media_type=rendered.media_type,
            original_name=rendered.original_name,
            metadata={
                "renderer": self.renderer.renderer_id,
                "rendererVersion": self.renderer.renderer_version,
                "generationId": generation_id,
                "qualityGate": gate,
                "rightsStatus": "owned",
            },
        )
        extension = ".webm" if rendered.media_type == "video/webm" else ".mp4"
        target = params["target"]
        destination = self.store.root / "exports" / (
            f"master-{target['width']}x{target['height']}-{target['fps']}fps-"
            f"{uuid.uuid4().hex[:10]}{extension}"
        )
        self.store.cas.copy_to(artifact.hash, destination)
        sidecars = self._copy_export_sidecars(generation_id, params, destination.stem)
        context.set_progress(1, message="Master and requested sidecars promoted to exports")
        return {
            "operation": "export_master",
            "artifactHash": artifact.hash,
            "path": str(destination),
            "mediaType": rendered.media_type,
            "sidecarPaths": sidecars,
            "qualityGate": gate,
            "renderManifest": rendered.manifest,
            "metrics": rendered.metrics,
        }

    def _require_current_head(self, params: dict[str, Any]) -> Revision:
        head = self.store.head_revision()
        expected = str(params["expectedHeadRevisionId"])
        if head is None or head.revision_id != expected:
            actual = "none" if head is None else head.revision_id
            raise ValueError(f"Native control base revision became stale: expected {expected}, got {actual}")
        return head

    def _selected_repairable_findings(
        self, generation_id: str, requested: set[str]
    ) -> dict[str, dict[str, Any]]:
        found: dict[str, dict[str, Any]] = {}
        for stage in ("qa_initial", "qa_one", "qa_final"):
            try:
                payload = self._stage_payload(generation_id, stage)
            except ValueError:
                continue
            gate = payload.get("qualityGate")
            findings = gate.get("findings", []) if isinstance(gate, dict) else []
            if not isinstance(findings, list):
                continue
            for finding in findings:
                if not isinstance(finding, dict) or not finding.get("repairable"):
                    continue
                identifier = str(finding.get("code", ""))
                if identifier in requested:
                    found[identifier] = finding
        missing = requested.difference(found)
        if missing:
            raise ValueError(
                "Selected QA findings are not unresolved repairable findings: "
                + ", ".join(sorted(missing))
            )
        return found

    def _stage_payload(self, generation_id: str, stage: str) -> dict[str, Any]:
        rows = self.store.connection.execute(
            "SELECT result_json FROM jobs WHERE project_id=? AND kind=? AND state='SUCCEEDED' "
            "AND json_extract(parameters_json,'$.generationId')=? ORDER BY completed_at DESC LIMIT 1",
            (self.store.manifest.project_id, f"generation.{stage}", generation_id),
        ).fetchone()
        if rows is None or rows["result_json"] is None:
            raise ValueError(f"Completed generation stage {stage} is unavailable")
        result = json.loads(rows["result_json"])
        payload = result.get("payload") if isinstance(result, dict) else None
        if not isinstance(payload, dict):
            raise ValueError(f"Generation stage {stage} has no durable payload")
        return payload

    def _scene_media(
        self, generation_id: Any, scene_id: str
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        if not isinstance(generation_id, str):
            return [], {"captionsEnabled": False}
        narration_payload = self._stage_payload(generation_id, "narration")
        captions_payload = self._stage_payload(generation_id, "captions")
        narration = [
            item
            for item in narration_payload.get("narration", [])
            if isinstance(item, dict) and item.get("sceneId") == scene_id
        ]
        cues = captions_payload.get("byScene", {})
        return narration, {
            "captionsEnabled": bool(captions_payload.get("captionsEnabled", True)),
            "byScene": {scene_id: cues.get(scene_id, []) if isinstance(cues, dict) else []},
        }

    def _scene_presenters(self, generation_id: Any, scene_id: str) -> list[dict[str, Any]]:
        """Return only the durable presenter candidate bound to this scene."""

        if not isinstance(generation_id, str):
            return []
        presenter_payload = self._stage_payload(generation_id, "presenter")
        values = presenter_payload.get("presenters", [])
        if not isinstance(values, list):
            raise ValueError("Completed presenter stage has an invalid presenters payload")
        return [
            item
            for item in values
            if isinstance(item, dict) and item.get("sceneId") == scene_id
        ]

    def _invalidate_scene(
        self,
        scene_id: str,
        generation_id: Any,
        locks: set[str],
        root_hash: str,
    ) -> list[str]:
        if isinstance(generation_id, str):
            return list(GenerationCoordinator(self.store).invalidate_scope(generation_id, f"scene:{scene_id}"))
        graph = DependencyGraph(self.store.connection, self.store.manifest.project_id)
        prefix = f"project:{self.store.manifest.project_id}:scene:{scene_id}"
        nodes = [
            (f"{prefix}:visual-layout", []),
            (f"{prefix}:scene-render", [f"{prefix}:visual-layout"]),
            (f"{prefix}:visual-qa", [f"{prefix}:scene-render"]),
            (f"{prefix}:final-composition", [f"{prefix}:visual-qa"]),
        ]
        if "narration" not in locks:
            nodes.insert(0, (f"{prefix}:narration", []))
            nodes[2][1].append(f"{prefix}:narration")
        for key, upstream in nodes:
            graph.record_node(key, hashlib.sha256(f"{root_hash}:{key}".encode()).hexdigest(), upstream_keys=upstream)
        roots = [f"{prefix}:visual-layout"]
        if "narration" not in locks:
            roots.append(f"{prefix}:narration")
        return graph.invalidate_from(roots)

    def _copy_export_sidecars(
        self, generation_id: str, params: dict[str, Any], stem: str
    ) -> list[str]:
        captions = self._stage_payload(generation_id, "captions")
        requested: list[tuple[str, str]] = []
        if params["captions"]:
            requested.extend(
                [
                    (str(captions["vttArtifactHash"]), ".vtt"),
                    (str(captions["srtArtifactHash"]), ".srt"),
                ]
            )
        if params["transcript"]:
            requested.append((str(captions["transcriptArtifactHash"]), ".txt"))
        paths = []
        for digest, extension in requested:
            destination = self.store.root / "exports" / f"{stem}{extension}"
            self.store.cas.copy_to(digest, destination)
            paths.append(str(destination))
        if params["bibliography"]:
            exported = self._stage_payload(generation_id, "export")
            manifest = exported.get("exportManifest", {})
            bibliography = self.store.root / "exports" / f"{stem}-sources.json"
            bibliography.write_text(
                json.dumps(manifest.get("sources", []), ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            paths.append(str(bibliography))
        return paths


def native_job_receipt(job: Job, message: str | None = None) -> dict[str, Any]:
    error_message = None if job.error is None else str(job.error.get("message", "Native job failed"))
    return {
        "jobId": job.job_id,
        "state": job.state.value,
        "acceptedAt": job.created_at,
        "message": message or error_message or _job_message(job),
        "retryable": job.state in {JobState.FAILED, JobState.CANCELLED, JobState.STALE},
        "operation": job.kind.removeprefix("native."),
        "progress": job.progress,
        "result": job.result,
        "error": job.error,
    }


def _job_message(job: Job) -> str:
    labels = {
        "native.regenerate_scene": "Scoped scene candidate work persisted",
        "native.render_scene": "Scene render completed",
        "native.repair_qa": "Selected QA repair work persisted",
        "native.export_master": "Master export completed",
    }
    if job.state is JobState.SUCCEEDED:
        return labels.get(job.kind, "Native operation completed")
    return f"{job.kind.removeprefix('native.').replace('_', ' ').title()} is {job.state.value.lower()}"


def _scene(snapshot: dict[str, Any], scene_id: str) -> dict[str, Any]:
    scenes = snapshot.get("scenes")
    if not isinstance(scenes, list):
        raise ValueError("Current project revision has no editable scenes")
    matches = [item for item in scenes if isinstance(item, dict) and item.get("id") == scene_id]
    if len(matches) != 1:
        raise ValueError(f"Scene {scene_id} does not exist exactly once in the base revision")
    return copy.deepcopy(matches[0])


def _renderer_scene(scene: dict[str, Any]) -> dict[str, Any]:
    duration = scene.get("duration", 1)
    if not isinstance(duration, (int, float)) or isinstance(duration, bool) or duration <= 0:
        raise ValueError("Scene duration must be positive")
    return {
        **scene,
        "type": str(scene.get("type", scene.get("kind", "bullets"))).replace("_", "-"),
        "title": _bounded_text(scene.get("title"), "scene.title", 500),
        "narration": _bounded_text(scene.get("narration", "Preview"), "scene.narration", 20_000),
        "durationTicks": int(float(duration) * TICKS_PER_SECOND),
    }


def _target(params: dict[str, Any]) -> dict[str, Any]:
    aspect = str(params.get("aspect", "16:9")).lower()
    if aspect not in ASPECTS:
        raise ValueError("aspect must be 16:9, 9:16, or 1:1")
    resolution = str(params.get("resolution", "1080p")).lower()
    if resolution not in RESOLUTIONS:
        raise ValueError("resolution must be 1080p, 1440p, or 4K")
    width, height = RESOLUTIONS[resolution]
    if aspect == "9:16":
        width, height = height, width
    elif aspect == "1:1":
        edge = min(width, height)
        width = height = edge
    fps = _integer(params.get("fps", 30), "fps", 1, 120)
    if fps not in FPS_VALUES:
        raise ValueError("fps must be 24, 25, 30, 50, or 60")
    return {"name": aspect.replace(":", "x"), "width": width, "height": height, "fps": fps}


def _locks(value: Any) -> set[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError("preservationLocks must be an array of strings")
    locks = set(value)
    unknown = locks.difference(ALLOWED_LOCKS)
    if unknown:
        raise ValueError("Unsupported preservation locks: " + ", ".join(sorted(unknown)))
    return locks


def _required_text(params: dict[str, Any], key: str) -> str:
    return _bounded_text(params.get(key), key, 4_000)


def _bounded_text(value: Any, label: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    text = value.strip()
    if len(text) > maximum or "\x00" in text:
        raise ValueError(f"{label} exceeds its safety limit")
    return text


def _integer(value: Any, label: str, minimum: int, maximum: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not minimum <= value <= maximum:
        raise ValueError(f"{label} must be between {minimum} and {maximum}")
    return value
