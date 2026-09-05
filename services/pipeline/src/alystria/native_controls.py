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
import os
import re
import uuid
from pathlib import Path
from typing import Any

from alystria.editor_export import render_editor_timeline
from alystria.generation import GenerationCoordinator, GenerationState
from alystria.generation.adapters import GenerationMediaClient, RendererClient
from alystria.jobs import ActionKey, DependencyGraph, Job, JobContext, JobState
from alystria.jobs.runtime import SQLiteWorkflowRuntime
from alystria.licensed_media_workflow import (
    LicensedMediaInvoker,
    search_visual_candidates,
)
from alystria.project import ProjectStore, Revision
from alystria.project_assets import validate_approved_presenter_for_export
from alystria.providers.licensed_media_selection import LicensedMediaVisionSelector
from alystria.sources.safety import SafeHttpTransport
from alystria.visual_candidates import (
    accept_visual_candidate,
    generate_visual_candidates,
    normalize_image_recipe,
    reject_visual_candidate,
)

TICKS_PER_SECOND = 240_000
CONTROL_IMPLEMENTATION_VERSION = "native-controls-v2-caption-delivery"
SCENE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
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
CAPTION_DELIVERY_MODES = frozenset({"sidecar", "embedded", "burned", "both"})
CODEC_PREFERENCES = {
    "h264-hardware": "h264_nvenc",
    "hevc-hardware": "hevc_nvenc",
    "av1": "av1",
}


class NativeControlCoordinator:
    def __init__(
        self,
        store: ProjectStore,
        *,
        renderer: RendererClient | None = None,
        media_client: GenerationMediaClient | None = None,
        licensed_media_client: LicensedMediaInvoker | None = None,
        licensed_media_selector: LicensedMediaVisionSelector | None = None,
        licensed_media_transport: SafeHttpTransport | None = None,
    ) -> None:
        self.store = store
        self.runtime = SQLiteWorkflowRuntime(store.connection)
        self.renderer = renderer
        self.media_client = media_client
        self.licensed_media_client = licensed_media_client
        self.licensed_media_selector = licensed_media_selector
        self.licensed_media_transport = licensed_media_transport
        self.handlers = {
            "native.regenerate_scene": self._regenerate_scene,
            "native.search_visual_candidates": self._search_visual_candidates,
            "native.render_scene": self._render_scene,
            "native.repair_qa": self._repair_qa,
            "native.export_master": self._export_master,
            "native.editor_timeline_export": self._editor_timeline_export,
        }

    def submit_regeneration(self, params: dict[str, Any]) -> Job:
        head, scene = self._validate_scene_base(params)
        instruction = _bounded_text(params.get("instruction"), "instruction", 4_000)
        locks = _locks(params.get("preservationLocks", []))
        alternatives = _integer(params.get("alternatives", 1), "alternatives", 1, 4)
        role = params.get("role", "scene")
        if role not in {"scene", "presenter"}:
            raise ValueError("role must be scene or presenter")
        requested_seed = params.get("seed")
        if "seed" in params and (
            not isinstance(requested_seed, int)
            or isinstance(requested_seed, bool)
            or not 0 <= requested_seed < 2**63
        ):
            raise ValueError("seed must be an integer between 0 and 2^63-1")
        seed = requested_seed if isinstance(requested_seed, int) else int(
                hashlib.sha256(
                    f"{head.revision_id}:{scene['id']}:{instruction}".encode()
                ).hexdigest()[:15],
                16,
        )
        if (role == "scene" and "assets" in locks) or (
            role == "presenter" and "presenter" in locks
        ):
            raise ValueError(f"Cannot regenerate a {role} visual with its target locked")
        base_generation_id = self._validate_base_generation(params.get("baseJobId"))
        parameters = {
            "expectedHeadRevisionId": head.revision_id,
            "baseRevisionId": _required_text(params, "baseRevisionId"),
            "baseGenerationId": base_generation_id,
            "sceneId": scene["id"],
            "instruction": instruction,
            "preservationLocks": sorted(locks),
            "alternatives": alternatives,
            "role": role,
            "seed": seed,
            **(
                {"imageRecipe": normalize_image_recipe(params["imageRecipe"], local_provider=True)}
                if "imageRecipe" in params
                else {}
            ),
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

    def submit_visual_search(self, params: dict[str, Any]) -> Job:
        head, scene = self._validate_scene_base(params)
        instruction = _bounded_text(params.get("instruction"), "instruction", 4_000)
        locks = _locks(params.get("preservationLocks", []))
        unsupported_locks = locks - {
            "narration",
            "citations",
            "learningobjective",
            "timing",
            "presenter",
        }
        if unsupported_locks:
            raise ValueError(
                "Licensed-media search cannot preserve unsupported locks: "
                + ", ".join(sorted(unsupported_locks))
            )
        alternatives = _integer(params.get("alternatives", 3), "alternatives", 1, 4)
        provider_id = _bounded_text(params.get("providerId"), "providerId", 80)
        if provider_id not in {"openverse", "pexels"}:
            raise ValueError("providerId must be openverse or pexels")
        desired_aspect_ratio = _bounded_text(
            params.get("desiredAspectRatio", "16:9"),
            "desiredAspectRatio",
            8,
        )
        if desired_aspect_ratio not in {"16:9", "4:3", "1:1", "9:16"}:
            raise ValueError("desiredAspectRatio must be 16:9, 4:3, 1:1, or 9:16")
        locale = _bounded_text(params.get("locale", "en-US"), "locale", 40)
        parameters = {
            "expectedHeadRevisionId": head.revision_id,
            "sceneId": scene["id"],
            "instruction": instruction,
            "preservationLocks": sorted(locks),
            "alternatives": alternatives,
            "providerId": provider_id,
            "desiredAspectRatio": desired_aspect_ratio,
            "locale": locale,
            **(
                {
                    "searchQuery": _bounded_text(
                        params.get("searchQuery"), "searchQuery", 240
                    )
                }
                if "searchQuery" in params
                else {}
            ),
        }
        return self._enqueue(
            "native.search_visual_candidates", parameters, head.root_hash
        )

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
        caption_delivery_mode = _caption_delivery_mode(params)
        codec_preference, renderer_codec = _codec_preference(params)
        parameters = {
            "expectedHeadRevisionId": head.revision_id,
            "baseRevisionId": _required_text(params, "baseRevisionId"),
            "baseGenerationId": base_generation_id,
            "target": target,
            "captionDeliveryMode": caption_delivery_mode,
            "codecPreference": codec_preference,
            "rendererCodec": renderer_codec,
            "transcript": bool(params.get("transcript", True)),
            "bibliography": bool(params.get("bibliography", True)),
        }
        return self._enqueue("native.export_master", parameters, head.root_hash)

    def submit_editor_timeline_export(self, params: dict[str, Any]) -> Job:
        head = self._validate_head({"baseRevisionId": params.get("expectedHeadRevisionId")})
        manifest = params.get("manifest")
        if not isinstance(manifest, dict):
            raise ValueError("manifest must be an editor render object")
        encoded = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > 4 * 1024 * 1024:
            raise ValueError("Editor render manifest exceeds its 4 MiB safety limit")
        parameters = {
            "expectedHeadRevisionId": head.revision_id,
            "manifest": copy.deepcopy(manifest),
        }
        return self._enqueue("native.editor_timeline_export", parameters, head.root_hash)

    def editor_bindings(self, generation_id: str) -> dict[str, Any]:
        """Return verified CAS bindings from completed generation stages.

        A job row's inline result is only an index.  The generation-stage CAS
        object and its revision links are the authority, so an editor cannot
        receive a hash that was merely inserted into mutable JSON.
        """

        validated_generation_id = self._validate_base_generation(generation_id, required=True)
        assert validated_generation_id is not None
        assets, assets_stage_hash = self._verified_stage_payload(
            validated_generation_id, "assets"
        )
        narration, narration_stage_hash = self._verified_stage_payload(
            validated_generation_id, "narration"
        )
        presenter, presenter_stage_hash = self._verified_stage_payload(
            validated_generation_id, "presenter"
        )
        render, render_stage_hash = self._verified_stage_payload(
            validated_generation_id, "render"
        )
        return {
            "projectId": self.store.manifest.project_id,
            "generationId": validated_generation_id,
            "assets": self._verified_generated_bindings(
                assets.get("assets"),
                generation_id=validated_generation_id,
                stage="assets",
                stage_hash=assets_stage_hash,
                role="scene-visual",
            ),
            "narration": self._verified_generated_bindings(
                narration.get("narration"),
                generation_id=validated_generation_id,
                stage="narration",
                stage_hash=narration_stage_hash,
                role="scene-narration",
                duration_key="durationMs",
            ),
            "presenters": self._verified_generated_bindings(
                presenter.get("presenters"),
                generation_id=validated_generation_id,
                stage="presenter",
                stage_hash=presenter_stage_hash,
                role="scene-presenter",
                duration_key="activeDurationTicks",
            ),
            "renders": self._verified_render_bindings(
                render,
                narration,
                generation_id=validated_generation_id,
                stage_hash=render_stage_hash,
            ),
        }

    def status(self, job_id: str) -> Job:
        return self.runtime.get_job(job_id)

    def cancel(self, job_id: str) -> Job:
        return self.runtime.cancel(job_id)

    def retry(self, job_id: str) -> Job:
        return self.runtime.retry(job_id)

    def accept_candidate(self, params: dict[str, Any]) -> dict[str, Any]:
        result = accept_visual_candidate(self.store, params)
        base_generation_id = result.pop("baseGenerationId", None)
        preservation_locks = result.pop("preservationLocks", [])
        head = self.store.head_revision()
        if head is None:
            raise RuntimeError("Accepted visual candidate did not create a project revision")
        result["invalidated"] = self._invalidate_scene(
            str(result["sceneId"]),
            base_generation_id,
            set(preservation_locks),
            head.root_hash,
            role=str(result["role"]),
        )
        return result

    def reject_candidate(self, params: dict[str, Any]) -> dict[str, Any]:
        return reject_visual_candidate(self.store, params)

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
            max_attempts=(
                1
                if kind
                in {"native.regenerate_scene", "native.search_visual_candidates"}
                else 2
            ),
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
        if self.media_client is None:
            raise RuntimeError("Configured image-generation runtime is unavailable")
        return generate_visual_candidates(self.store, self.media_client, context, params)

    def _search_visual_candidates(
        self, context: JobContext, params: dict[str, Any]
    ) -> dict[str, Any]:
        if self.licensed_media_client is None or self.licensed_media_selector is None:
            raise RuntimeError(
                "Licensed-media search requires approved stock and visual-review routes"
            )
        return search_visual_candidates(
            self.store,
            self.licensed_media_client,
            self.licensed_media_selector,
            params,
            context,
            transport=self.licensed_media_transport,
        )

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
        caption_delivery_mode = _caption_delivery_mode(params)
        rendered = self.renderer.render(
            {
                "schemaVersion": 1,
                "generationId": context.job_id,
                "timebase": TICKS_PER_SECOND,
                "seed": 0,
                "targets": [params["target"]],
                "scenes": storyboard["scenes"],
                "narration": narration_payload["narration"],
                "captions": captions_payload,
                "captionDeliveryMode": caption_delivery_mode,
                "codec": params["rendererCodec"],
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
                "captionDeliveryMode": caption_delivery_mode,
                "codecPreference": params["codecPreference"],
                "rendererCodec": params["rendererCodec"],
                "captionsBurnedIntoPixels": caption_delivery_mode in {"burned", "both"},
                "captionsEmbeddedInContainer": caption_delivery_mode in {"embedded", "both"},
                "captionSidecars": ["vtt", "srt"],
            },
        )
        extension = ".webm" if rendered.media_type == "video/webm" else ".mp4"
        target = params["target"]
        destination = self.store.root / "exports" / (
            f"master-{target['width']}x{target['height']}-{target['fps']}fps-"
            f"{uuid.uuid4().hex[:10]}{extension}"
        )
        self.store.cas.copy_to(artifact.hash, destination)
        sidecars = self._copy_export_sidecars(
            generation_id,
            params,
            destination.stem,
            str(storyboard.get("locale", "und")),
        )
        context.set_progress(1, message="Master and requested sidecars promoted to exports")
        return {
            "operation": "export_master",
            "artifactHash": artifact.hash,
            "path": str(destination),
            "mediaType": rendered.media_type,
            "sidecarPaths": sidecars,
            "captionDelivery": {
                "mode": caption_delivery_mode,
                "sidecars": ["vtt", "srt"],
                "burnedIntoPixels": caption_delivery_mode in {"burned", "both"},
                "embeddedInContainer": caption_delivery_mode in {"embedded", "both"},
            },
            "codecPreference": params["codecPreference"],
            "rendererCodec": params["rendererCodec"],
            "qualityGate": gate,
            "renderManifest": rendered.manifest,
            "metrics": rendered.metrics,
        }

    def _editor_timeline_export(
        self,
        context: JobContext,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        head = self._require_current_head(params)
        ffmpeg_value = os.environ.get("ALYSTRIA_FFMPEG_PATH")
        if not ffmpeg_value:
            raise RuntimeError("Pinned FFmpeg runtime is missing for editor export")
        context.set_progress(0.05, message="Validating content-addressed editor timeline")
        self._require_exportable_editor_assets(head.snapshot, params["manifest"])
        result = render_editor_timeline(
            self.store,
            params["manifest"],
            ffmpeg_path=Path(ffmpeg_value),
        )
        snapshot = copy.deepcopy(head.snapshot)
        previous = snapshot.get("editorExports")
        snapshot["editorExports"] = [
            *(previous if isinstance(previous, list) else []),
            dict(result),
        ]
        sidecar_links = [
            {
                "artifactHash": str(item["artifactHash"]),
                "role": "editor-caption-sidecar",
                "stableId": f"{result['manifestHash']}:{item['format']}",
            }
            for item in result.get("captionSidecars", [])
            if isinstance(item, dict)
            and isinstance(item.get("artifactHash"), str)
            and item.get("format") in {"vtt", "srt"}
        ]
        try:
            revision = self.store.create_revision(
                snapshot=snapshot,
                kind="generation",
                message="Rendered editor timeline",
                expected_head=head.revision_id,
                artifact_links=[
                    {
                        "artifactHash": str(result["artifactHash"]),
                        "role": "editor-timeline-export",
                        "stableId": str(result["manifestHash"]),
                    },
                    *sidecar_links,
                ],
            )
        except Exception:
            Path(str(result["outputPath"])).unlink(missing_ok=True)
            raise
        context.set_progress(1, message="Editor timeline rendered and saved")
        return {
            **result,
            "operation": "editor_timeline_export",
            "headRevisionId": revision.revision_id,
            "revisionNumber": revision.number,
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
        payload, _ = self._verified_stage_payload(generation_id, stage)
        return payload

    def _verified_stage_payload(
        self, generation_id: str, stage: str
    ) -> tuple[dict[str, Any], str]:
        rows = self.store.connection.execute(
            "SELECT result_json FROM jobs WHERE project_id=? AND kind=? AND state='SUCCEEDED' "
            "AND json_extract(parameters_json,'$.generationId')=? ORDER BY completed_at DESC LIMIT 1",
            (self.store.manifest.project_id, f"generation.{stage}", generation_id),
        ).fetchone()
        if rows is None or rows["result_json"] is None:
            raise ValueError(f"Completed generation stage {stage} is unavailable")
        result = json.loads(rows["result_json"])
        artifact_hash = result.get("artifactHash") if isinstance(result, dict) else None
        if not isinstance(artifact_hash, str) or not SHA256_PATTERN.fullmatch(artifact_hash):
            raise ValueError(f"Generation stage {stage} has no durable artifact")
        linked = self.store.connection.execute(
            "SELECT a.media_type FROM revision_artifacts AS ra "
            "JOIN revisions AS r ON r.revision_id=ra.revision_id "
            "JOIN artifacts AS a ON a.hash=ra.artifact_hash "
            "WHERE r.project_id=? AND ra.artifact_hash=? AND ra.role=? AND ra.stable_id=? "
            "LIMIT 1",
            (
                self.store.manifest.project_id,
                artifact_hash,
                f"generation-stage:{stage}",
                generation_id,
            ),
        ).fetchone()
        if linked is None or linked["media_type"] != "application/vnd.alystria.generation-stage+json":
            raise ValueError(f"Generation stage {stage} artifact is not linked to this generation")
        if not self.store.cas.verify(artifact_hash):
            raise ValueError(f"Generation stage {stage} artifact is missing or corrupt")
        try:
            persisted = json.loads(self.store.cas.object_path(artifact_hash).read_bytes())
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError(f"Generation stage {stage} artifact is invalid") from error
        if not isinstance(persisted, dict):
            raise ValueError(f"Generation stage {stage} artifact is not an object")
        inline_payload = result.get("payload") if isinstance(result, dict) else None
        if inline_payload != persisted:
            raise ValueError(f"Generation stage {stage} result does not match its immutable artifact")
        return persisted, artifact_hash

    def _verified_generated_bindings(
        self,
        values: Any,
        *,
        generation_id: str,
        stage: str,
        stage_hash: str,
        role: str,
        duration_key: str | None = None,
    ) -> list[dict[str, Any]]:
        if not isinstance(values, list):
            raise ValueError(f"Completed generation stage {stage} has an invalid media payload")
        bindings: list[dict[str, Any]] = []
        for value in values:
            if not isinstance(value, dict):
                raise ValueError(f"Completed generation stage {stage} has an invalid media binding")
            scene_id = value.get("sceneId")
            digest = value.get("artifactHash")
            if not isinstance(scene_id, str) or not SCENE_ID_PATTERN.fullmatch(scene_id):
                raise ValueError(f"Completed generation stage {stage} has an invalid scene id")
            if not isinstance(digest, str) or not SHA256_PATTERN.fullmatch(digest):
                raise ValueError(f"Completed generation stage {stage} has an invalid artifact hash")
            row = self.store.connection.execute(
                "SELECT a.media_type FROM revision_artifacts AS media "
                "JOIN revision_artifacts AS stage_link ON stage_link.revision_id=media.revision_id "
                "JOIN artifacts AS a ON a.hash=media.artifact_hash "
                "WHERE media.artifact_hash=? AND media.role=? AND media.stable_id=? "
                "AND stage_link.artifact_hash=? AND stage_link.role=? AND stage_link.stable_id=? "
                "LIMIT 1",
                (
                    digest,
                    role,
                    scene_id,
                    stage_hash,
                    f"generation-stage:{stage}",
                    generation_id,
                ),
            ).fetchone()
            if row is None or not self.store.cas.verify(digest):
                raise ValueError(
                    f"Completed generation stage {stage} references an unverified scene artifact"
                )
            media_type = str(row["media_type"])
            declared_media_type = value.get("mediaType")
            if declared_media_type is not None and declared_media_type != media_type:
                raise ValueError(
                    f"Completed generation stage {stage} media type does not match its artifact"
                )
            binding: dict[str, Any] = {
                "sceneId": scene_id,
                "artifactHash": digest,
                "mediaType": media_type,
            }
            if duration_key is not None:
                duration = value.get(duration_key)
                if not isinstance(duration, int) or isinstance(duration, bool) or duration <= 0:
                    raise ValueError(
                        f"Completed generation stage {stage} has an invalid {duration_key}"
                    )
                binding[duration_key] = duration
            bindings.append(binding)
        return bindings

    def _require_exportable_editor_assets(
        self, snapshot: dict[str, Any], manifest: dict[str, Any]
    ) -> None:
        values = manifest.get("assets")
        if not isinstance(values, list):
            raise ValueError("Editor render manifest assets must be a list")
        imported = _exportable_imported_artifacts(snapshot)
        for value in values:
            if not isinstance(value, dict):
                raise ValueError("Editor render manifest assets must contain objects")
            digest = value.get("artifactHash")
            if not isinstance(digest, str) or not SHA256_PATTERN.fullmatch(digest):
                raise ValueError("Editor render manifest asset has an invalid artifact hash")
            row = self.store.connection.execute(
                "SELECT media_type FROM artifacts WHERE hash=?", (digest,)
            ).fetchone()
            if row is None or not self.store.cas.verify(digest):
                raise ValueError("Editor render manifest references an unverified project artifact")
            declared_media_type = value.get("mediaType")
            if declared_media_type != row["media_type"]:
                raise ValueError("Editor render manifest asset media type does not match its artifact")
            generated = self.store.connection.execute(
                "SELECT 1 FROM revision_artifacts AS ra JOIN revisions AS r "
                "ON r.revision_id=ra.revision_id WHERE r.project_id=? AND ra.artifact_hash=? "
                "AND r.kind='generation' AND (ra.role IN "
                "('scene-visual','scene-narration','scene-presenter','render-output',"
                "'editor-timeline-export')) LIMIT 1",
                (self.store.manifest.project_id, digest),
            ).fetchone()
            if generated is None:
                imported_binding = imported.get(digest)
                linked = None
                if imported_binding is not None:
                    artifact_id, kind = imported_binding
                    linked = self.store.connection.execute(
                        "SELECT 1 FROM revision_artifacts AS ra JOIN revisions AS r "
                        "ON r.revision_id=ra.revision_id WHERE r.project_id=? "
                        "AND ra.artifact_hash=? AND ra.role=? AND ra.stable_id=? LIMIT 1",
                        (
                            self.store.manifest.project_id,
                            digest,
                            f"asset-{kind}",
                            artifact_id,
                        ),
                    ).fetchone()
                if linked is None:
                    raise ValueError(
                        "Editor render manifest asset is not cleared for export by durable provenance"
                    )

    def _verified_render_bindings(
        self,
        render: dict[str, Any],
        narration: dict[str, Any],
        *,
        generation_id: str,
        stage_hash: str,
    ) -> list[dict[str, Any]]:
        candidate = render.get("candidate")
        storyboard = narration.get("storyboard")
        scenes = storyboard.get("scenes") if isinstance(storyboard, dict) else None
        if not isinstance(candidate, dict) or not isinstance(scenes, list):
            raise ValueError("Completed render stage has no durable scene timeline")
        digest = candidate.get("renderArtifactHash")
        declared_media_type = candidate.get("renderMediaType")
        if not isinstance(digest, str) or not SHA256_PATTERN.fullmatch(digest):
            raise ValueError("Completed render stage has an invalid render artifact hash")
        row = self.store.connection.execute(
            "SELECT a.media_type FROM revision_artifacts AS media "
            "JOIN revision_artifacts AS stage_link ON stage_link.revision_id=media.revision_id "
            "JOIN artifacts AS a ON a.hash=media.artifact_hash "
            "WHERE media.artifact_hash=? AND media.role='render-output' "
            "AND media.stable_id='master' AND stage_link.artifact_hash=? "
            "AND stage_link.role='generation-stage:render' AND stage_link.stable_id=? LIMIT 1",
            (digest, stage_hash, generation_id),
        ).fetchone()
        if row is None or not self.store.cas.verify(digest):
            raise ValueError("Completed render stage references an unverified master artifact")
        media_type = str(row["media_type"])
        if declared_media_type != media_type:
            raise ValueError("Completed render stage media type does not match its artifact")
        # Deterministic unit fixtures intentionally persist a JSON render
        # receipt. Only actual playable render media can initialize the editor.
        if not media_type.startswith("video/"):
            return []
        bindings: list[dict[str, Any]] = []
        source_start = 0
        for scene in scenes:
            if not isinstance(scene, dict):
                raise ValueError("Completed render stage has an invalid storyboard scene")
            scene_id = scene.get("id")
            duration = scene.get("durationTicks")
            if (
                not isinstance(scene_id, str)
                or not SCENE_ID_PATTERN.fullmatch(scene_id)
                or not isinstance(duration, int)
                or isinstance(duration, bool)
                or duration <= 0
            ):
                raise ValueError("Completed render stage has an invalid scene interval")
            bindings.append(
                {
                    "sceneId": scene_id,
                    "artifactHash": digest,
                    "mediaType": media_type,
                    "sourceStartTicks": source_start,
                    "durationTicks": duration,
                }
            )
            source_start += duration
        return bindings

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
        *,
        role: str = "scene",
    ) -> list[str]:
        if isinstance(generation_id, str):
            scope = f"scene-asset:{scene_id}" if role == "scene" else "presenter"
            return list(GenerationCoordinator(self.store).invalidate_scope(generation_id, scope))
        graph = DependencyGraph(self.store.connection, self.store.manifest.project_id)
        prefix = f"project:{self.store.manifest.project_id}:scene:{scene_id}"
        if role == "presenter":
            presenter = f"{prefix}:presenter-animation"
            composition = f"{prefix}:final-composition"
            graph.record_node(
                presenter,
                hashlib.sha256(f"{root_hash}:{presenter}".encode()).hexdigest(),
            )
            graph.record_node(
                composition,
                hashlib.sha256(f"{root_hash}:{composition}".encode()).hexdigest(),
                upstream_keys=[presenter],
            )
            return graph.invalidate_from([presenter])
        nodes = [
            (f"{prefix}:visual-layout", []),
            (f"{prefix}:scene-render", [f"{prefix}:visual-layout"]),
            (f"{prefix}:visual-qa", [f"{prefix}:scene-render"]),
            (f"{prefix}:final-composition", [f"{prefix}:visual-qa"]),
        ]
        for key, upstream in nodes:
            graph.record_node(key, hashlib.sha256(f"{root_hash}:{key}".encode()).hexdigest(), upstream_keys=upstream)
        del locks
        return graph.invalidate_from([f"{prefix}:visual-layout"])

    def _copy_export_sidecars(
        self,
        generation_id: str,
        params: dict[str, Any],
        stem: str,
        locale: str,
    ) -> list[str]:
        captions = self._stage_payload(generation_id, "captions")
        safe_locale = (
            locale
            if re.fullmatch(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*", locale)
            else "und"
        )
        requested: list[tuple[str, str]] = []
        requested.extend(
            [
                (str(captions["vttArtifactHash"]), f".{safe_locale}.vtt"),
                (str(captions["srtArtifactHash"]), f".{safe_locale}.srt"),
            ]
        )
        if params["transcript"]:
            requested.append(
                (str(captions["transcriptArtifactHash"]), f".{safe_locale}.transcript.txt")
            )
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
        "native.search_visual_candidates": "Licensed visual candidates are ready for review",
        "native.render_scene": "Scene render completed",
        "native.repair_qa": "Selected QA repair work persisted",
        "native.export_master": "Master export completed",
        "native.editor_timeline_export": "Editor timeline export completed",
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
    if "durationTicks" in scene:
        duration_ticks = scene["durationTicks"]
        if (
            not isinstance(duration_ticks, int)
            or isinstance(duration_ticks, bool)
            or duration_ticks <= 0
            or duration_ticks > 2**53 - 1
        ):
            raise ValueError("Scene durationTicks must be a positive safe integer")
    else:
        duration = scene.get("duration", 1)
        if not isinstance(duration, (int, float)) or isinstance(duration, bool) or duration <= 0:
            raise ValueError("Scene duration must be positive")
        duration_ticks = int(float(duration) * TICKS_PER_SECOND)
    return {
        **scene,
        "type": str(scene.get("type", scene.get("kind", "bullets"))).replace("_", "-"),
        "title": _bounded_text(scene.get("title"), "scene.title", 500),
        "narration": _bounded_text(scene.get("narration", "Preview"), "scene.narration", 20_000),
        "durationTicks": duration_ticks,
    }


def _exportable_imported_artifacts(snapshot: dict[str, Any]) -> dict[str, tuple[str, str]]:
    assets = snapshot.get("mediaAssets")
    provenances = snapshot.get("assetProvenance")
    if not isinstance(assets, list) or not isinstance(provenances, list):
        return {}
    by_id = {
        value.get("id"): value
        for value in provenances
        if isinstance(value, dict) and isinstance(value.get("id"), str)
    }
    exportable: dict[str, tuple[str, str]] = {}
    for asset in assets:
        if not isinstance(asset, dict) or asset.get("state") != "promoted":
            continue
        digest = asset.get("artifactHash")
        artifact_id = asset.get("id")
        kind = asset.get("kind")
        provenance = by_id.get(asset.get("provenanceId"))
        if (
            isinstance(digest, str)
            and SHA256_PATTERN.fullmatch(digest)
            and isinstance(artifact_id, str)
            and isinstance(kind, str)
            and isinstance(provenance, dict)
            and provenance.get("assetId") == asset.get("id")
            and provenance.get("contentHash") == digest
            and provenance.get("exportEligible") is True
            and provenance.get("blockers") in (None, [])
        ):
            exportable[digest] = (artifact_id, kind)
    return exportable


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


def _caption_delivery_mode(params: dict[str, Any]) -> str:
    """Normalize the 2.0 caption contract and safely migrate old booleans.

    Caption authoring is part of every accessible tutorial. The mode controls
    only whether captions are composited into pixels and/or embedded in the
    media container; UTF-8 VTT and SRT sidecars are always promoted.
    """

    value = params.get("captionDeliveryMode")
    if value is None and isinstance(params.get("captions"), bool):
        # Both legacy boolean values migrate to a clean picture with sidecars.
        # This intentionally avoids carrying the old implicit burn-in behavior
        # into a 2.0 export while retaining the authored captions.
        return "sidecar"
    if value is None:
        return "sidecar"
    if not isinstance(value, str) or value not in CAPTION_DELIVERY_MODES:
        raise ValueError(
            "captionDeliveryMode must be sidecar, embedded, burned, or both"
        )
    return value


def _codec_preference(params: dict[str, Any]) -> tuple[str, str]:
    """Resolve the product-level choice to the renderer's closed codec name."""

    value = params.get("codecPreference", "h264-hardware")
    if not isinstance(value, str) or value not in CODEC_PREFERENCES:
        raise ValueError("codecPreference must be h264-hardware, hevc-hardware, or av1")
    return value, CODEC_PREFERENCES[value]


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
