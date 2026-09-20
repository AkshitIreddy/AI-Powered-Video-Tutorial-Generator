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
from contextlib import nullcontext
from pathlib import Path
from typing import Any

from alystria.editor_export import EDITOR_EXPORT_IMPLEMENTATION_VERSION, render_editor_timeline
from alystria.generation import GenerationCoordinator, GenerationState
from alystria.generation.adapters import GenerationMediaClient, RendererClient
from alystria.generation.caption_bundle import build_caption_bundle
from alystria.jobs import ActionKey, DependencyGraph, Job, JobContext, JobState
from alystria.jobs.runtime import SQLiteWorkflowRuntime
from alystria.licensed_media_workflow import (
    LicensedMediaInvoker,
    search_visual_candidates,
)
from alystria.music_workflow import (
    accept_music_candidate,
    reject_music_candidate,
    search_music_candidates,
)
from alystria.project import ProjectStore, Revision
from alystria.project_assets import validate_approved_presenters_for_export
from alystria.providers.licensed_media_selection import LicensedMediaVisionSelector
from alystria.scene_edit_candidates import (
    SceneEditProvider,
    accept_scene_edit_candidate,
    generate_scene_edit_candidates,
    reject_scene_edit_candidate,
)
from alystria.sources.safety import SafeHttpTransport
from alystria.visual_candidates import (
    accept_visual_candidate,
    generate_visual_candidates,
    normalize_image_recipe,
    reject_visual_candidate,
)

TICKS_PER_SECOND = 240_000
CONTROL_IMPLEMENTATION_VERSION = "native-controls-v3-caption-bundle"
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
        scene_edit_provider: SceneEditProvider | None = None,
        licensed_media_client: LicensedMediaInvoker | None = None,
        licensed_media_selector: LicensedMediaVisionSelector | None = None,
        licensed_media_transport: SafeHttpTransport | None = None,
    ) -> None:
        self.store = store
        self.runtime = SQLiteWorkflowRuntime(store.connection)
        self.renderer = renderer
        self.media_client = media_client
        self.scene_edit_provider = scene_edit_provider
        self.licensed_media_client = licensed_media_client
        self.licensed_media_selector = licensed_media_selector
        self.licensed_media_transport = licensed_media_transport
        self.handlers = {
            "native.regenerate_scene": self._regenerate_scene,
            "native.regenerate_authored_scene": self._regenerate_authored_scene,
            "native.search_visual_candidates": self._search_visual_candidates,
            "native.search_music_candidates": self._search_music_candidates,
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
        edit_focus = params.get("editFocus")
        if edit_focus is not None:
            if edit_focus not in {"explanation", "pacing"}:
                raise ValueError("editFocus must be explanation or pacing")
            if role != "scene":
                raise ValueError("Authored scene edits cannot target presenter portraits")
            if "imageRecipe" in params:
                raise ValueError("Authored scene edits cannot include an image recipe")
            base_generation_id = self._validate_base_generation(params.get("baseJobId"))
            parameters = {
                "expectedHeadRevisionId": head.revision_id,
                "baseRevisionId": _required_text(params, "baseRevisionId"),
                "baseGenerationId": base_generation_id,
                "sceneId": scene["id"],
                "focus": edit_focus,
                "instruction": instruction,
                "preservationLocks": sorted(locks),
                "alternatives": alternatives,
            }
            return self._enqueue(
                "native.regenerate_authored_scene", parameters, head.root_hash
            )
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

    def submit_music_search(self, params: dict[str, Any]) -> Job:
        expected = _required_text(params, "expectedHeadRevisionId")
        head = self.store.head_revision()
        if head is None:
            raise ValueError("Project has no durable base revision")
        if head.revision_id != expected:
            raise ValueError(
                f"Base revision {expected} is stale; current head is {head.revision_id}"
            )
        topic = _bounded_text(params.get("topic"), "topic", 240)
        mood = _bounded_text(params.get("mood", "curious"), "mood", 40)
        if mood not in {
            "calm",
            "curious",
            "focused",
            "hopeful",
            "playful",
            "reflective",
            "energetic",
        }:
            raise ValueError("mood is unsupported")
        parameters = {
            "expectedHeadRevisionId": head.revision_id,
            "topic": topic,
            "mood": mood,
            "alternatives": _integer(params.get("alternatives", 3), "alternatives", 1, 4),
            "locale": _bounded_text(params.get("locale", "en-US"), "locale", 40),
        }
        return self._enqueue("native.search_music_candidates", parameters, head.root_hash)

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
        renderer_runtime_identity = _renderer_runtime_identity(self.renderer)
        parameters = {
            "expectedHeadRevisionId": head.revision_id,
            "baseRevisionId": _required_text(params, "baseRevisionId"),
            "baseGenerationId": base_generation_id,
            "target": target,
            "captionDeliveryMode": caption_delivery_mode,
            "codecPreference": codec_preference,
            "rendererCodec": renderer_codec,
            "rendererRuntimeIdentitySha256": renderer_runtime_identity,
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
        captions, _ = self._verified_stage_payload(validated_generation_id, "captions")
        presenter, presenter_stage_hash = self._verified_stage_payload(
            validated_generation_id, "presenter"
        )
        render, render_stage_hash = self._verified_stage_payload(
            validated_generation_id, "render"
        )
        renders = self._verified_render_bindings(
            render,
            narration,
            generation_id=validated_generation_id,
            stage_hash=render_stage_hash,
        )
        generation_status = GenerationCoordinator(self.store).status(
            validated_generation_id
        )
        approval_revision_id = generation_status.approval_revision_id
        if approval_revision_id is not None:
            master_rows = self.store.connection.execute(
                "SELECT job_id,result_json FROM jobs WHERE project_id=? "
                "AND kind='native.export_master' AND state='SUCCEEDED' "
                "AND json_valid(parameters_json)=1 "
                "AND json_extract(parameters_json,'$.baseGenerationId')=? "
                "ORDER BY completed_at DESC, rowid DESC",
                (self.store.manifest.project_id, validated_generation_id),
            ).fetchall()
            promoted: dict[str, Any] | None = None
            promoted_job_id: str | None = None
            for master_row in master_rows:
                try:
                    candidate = json.loads(str(master_row["result_json"]))
                except (TypeError, json.JSONDecodeError):
                    continue
                if not isinstance(candidate, dict):
                    continue
                if (
                    candidate.get("generationId") == validated_generation_id
                    and candidate.get("approvalRevisionId") == approval_revision_id
                    and candidate.get("sourceRenderStageArtifactHash") == render_stage_hash
                ):
                    promoted = candidate
                    promoted_job_id = str(master_row["job_id"])
                    break

            if promoted is not None:
                digest = promoted.get("artifactHash")
                declared_media_type = promoted.get("mediaType")
                expected_candidate = render.get("candidate")
                expected_windows = (
                    expected_candidate.get("renderSceneWindows")
                    if isinstance(expected_candidate, dict)
                    else None
                )
                windows = promoted.get("renderSceneWindows")
                if (
                    not isinstance(digest, str)
                    or not SHA256_PATTERN.fullmatch(digest)
                    or not isinstance(declared_media_type, str)
                    or not declared_media_type.startswith("video/")
                    or not isinstance(windows, list)
                    or not windows
                    or windows != expected_windows
                ):
                    raise ValueError("Latest promoted master has invalid durable provenance")
                artifact_row = self.store.connection.execute(
                    "SELECT media_type,metadata_json FROM artifacts WHERE hash=?",
                    (digest,),
                ).fetchone()
                if artifact_row is None or not self.store.cas.verify(digest):
                    raise ValueError("Latest promoted master artifact is missing or corrupt")
                if artifact_row["media_type"] != declared_media_type:
                    raise ValueError("Latest promoted master media type does not match its artifact")
                caption_locale = str(
                    narration.get("storyboard", {}).get("locale", "en-US")
                )
                provenance_hash = promoted.get("masterProvenanceArtifactHash")
                if provenance_hash is not None:
                    if (
                        not isinstance(provenance_hash, str)
                        or not SHA256_PATTERN.fullmatch(provenance_hash)
                        or promoted_job_id is None
                    ):
                        raise ValueError(
                            "Latest promoted master provenance receipt is invalid"
                        )
                    receipt = self._verified_promoted_master_receipt(
                        provenance_hash,
                        export_job_id=promoted_job_id,
                        promoted=promoted,
                        generation_id=validated_generation_id,
                        approval_revision_id=approval_revision_id,
                        render_stage_hash=render_stage_hash,
                        narration_stage_hash=narration_stage_hash,
                        video_artifact_hash=digest,
                        video_media_type=declared_media_type,
                        render_scene_windows=windows,
                    )
                    receipt_bundle_hash = str(receipt["captionBundleArtifactHash"])
                    receipt_compiler_version = str(receipt["captionCompilerVersion"])
                    captions = self._verified_promoted_caption_bundle(
                        receipt_bundle_hash,
                        generation_id=validated_generation_id,
                        approval_revision_id=approval_revision_id,
                        narration_stage_hash=narration_stage_hash,
                        locale=caption_locale,
                    )
                    if captions.get("compilerVersion") != receipt_compiler_version:
                        raise ValueError(
                            "Latest promoted master caption compiler provenance is invalid"
                        )
                    caption_delivery = receipt["captionDelivery"]
                    assert isinstance(caption_delivery, dict)
                    captions_burned = caption_delivery["burnedIntoPixels"]
                else:
                    try:
                        artifact_metadata = json.loads(str(artifact_row["metadata_json"]))
                    except (TypeError, json.JSONDecodeError) as error:
                        raise ValueError(
                            "Latest promoted master artifact metadata is invalid"
                        ) from error
                    if (
                        not isinstance(artifact_metadata, dict)
                        or artifact_metadata.get("generationId") != validated_generation_id
                        or artifact_metadata.get("approvalRevisionId")
                        != approval_revision_id
                        or artifact_metadata.get("sourceRenderStageArtifactHash")
                        != render_stage_hash
                        or artifact_metadata.get("renderSceneWindows") != windows
                        or artifact_metadata.get("rightsStatus") != "owned"
                    ):
                        raise ValueError(
                            "Latest promoted master artifact provenance is invalid"
                        )
                    bundle_hash = promoted.get("captionBundleArtifactHash")
                    source_narration_hash = promoted.get(
                        "sourceNarrationStageArtifactHash"
                    )
                    artifact_bundle_hash = artifact_metadata.get(
                        "captionBundleArtifactHash"
                    )
                    artifact_source_narration_hash = artifact_metadata.get(
                        "sourceNarrationStageArtifactHash"
                    )
                    compiler_version = promoted.get("captionCompilerVersion")
                    artifact_compiler_version = artifact_metadata.get(
                        "captionCompilerVersion"
                    )
                    has_caption_bundle_provenance = any(
                        value is not None
                        for value in (
                            bundle_hash,
                            source_narration_hash,
                            artifact_bundle_hash,
                            artifact_source_narration_hash,
                            compiler_version,
                            artifact_compiler_version,
                        )
                    )
                    if has_caption_bundle_provenance:
                        if (
                            not isinstance(bundle_hash, str)
                            or not SHA256_PATTERN.fullmatch(bundle_hash)
                            or source_narration_hash != narration_stage_hash
                            or artifact_bundle_hash != bundle_hash
                            or artifact_source_narration_hash != narration_stage_hash
                            or not isinstance(compiler_version, str)
                            or not compiler_version
                            or artifact_compiler_version != compiler_version
                        ):
                            raise ValueError(
                                "Latest promoted master caption bundle provenance is invalid"
                            )
                        captions = self._verified_promoted_caption_bundle(
                            bundle_hash,
                            generation_id=validated_generation_id,
                            approval_revision_id=approval_revision_id,
                            narration_stage_hash=narration_stage_hash,
                            locale=caption_locale,
                        )
                        if captions.get("compilerVersion") != compiler_version:
                            raise ValueError(
                                "Latest promoted master caption compiler provenance is invalid"
                            )
                    captions_burned = artifact_metadata.get(
                        "captionsBurnedIntoPixels"
                    )
                if not isinstance(captions_burned, bool):
                    raise ValueError("Latest promoted master caption provenance is invalid")
                promoted_bindings: list[dict[str, Any]] = []
                previous_end = 0
                scene_ids: set[str] = set()
                for window in windows:
                    if not isinstance(window, dict):
                        raise ValueError("Latest promoted master has an invalid scene window")
                    scene_id = window.get("sceneId")
                    start_ticks = window.get("startTicks")
                    end_ticks = window.get("endTicks")
                    if (
                        not isinstance(scene_id, str)
                        or not SCENE_ID_PATTERN.fullmatch(scene_id)
                        or scene_id in scene_ids
                        or not isinstance(start_ticks, int)
                        or isinstance(start_ticks, bool)
                        or start_ticks != previous_end
                        or not isinstance(end_ticks, int)
                        or isinstance(end_ticks, bool)
                        or not start_ticks < end_ticks <= 2**53 - 1
                    ):
                        raise ValueError("Latest promoted master has an invalid scene window")
                    promoted_bindings.append(
                        {
                            "sceneId": scene_id,
                            "artifactHash": digest,
                            "mediaType": declared_media_type,
                            "sourceStartTicks": start_ticks,
                            "durationTicks": end_ticks - start_ticks,
                            "captionsBurnedIntoPixels": captions_burned,
                        }
                    )
                    scene_ids.add(scene_id)
                    previous_end = end_ticks
                renders = promoted_bindings
        return {
            "projectId": self.store.manifest.project_id,
            "generationId": validated_generation_id,
            "captions": _editor_caption_bindings(captions, narration),
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
            "renders": renders,
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

    def accept_music_candidate(self, params: dict[str, Any]) -> dict[str, Any]:
        return accept_music_candidate(self.store, params)

    def reject_music_candidate(self, params: dict[str, Any]) -> dict[str, Any]:
        return reject_music_candidate(self.store, params)

    def accept_scene_edit_candidate(self, params: dict[str, Any]) -> dict[str, Any]:
        result = accept_scene_edit_candidate(self.store, params)
        head = self.store.head_revision()
        if head is None:
            raise RuntimeError("Accepted scene edit did not create a project revision")
        result["invalidated"] = self._invalidate_authored_scene(
            str(result["sceneId"]),
            result.get("baseGenerationId"),
            head.root_hash,
        )
        result["invalidatedJobIds"] = self._mark_promoted_media_stale(
            str(result["sceneId"])
        )
        return result

    def reject_scene_edit_candidate(self, params: dict[str, Any]) -> dict[str, Any]:
        return reject_scene_edit_candidate(self.store, params)

    def _enqueue(self, kind: str, parameters: dict[str, Any], root_hash: str) -> Job:
        action = ActionKey(
            kind,
            EDITOR_EXPORT_IMPLEMENTATION_VERSION if kind == "native.editor_timeline_export" else CONTROL_IMPLEMENTATION_VERSION,
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
                in {
                    "native.regenerate_scene",
                    "native.regenerate_authored_scene",
                    "native.search_visual_candidates",
                    "native.search_music_candidates",
                }
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

    def _regenerate_authored_scene(
        self, context: JobContext, params: dict[str, Any]
    ) -> dict[str, Any]:
        if self.scene_edit_provider is None:
            raise RuntimeError(
                "An approved structured-writing provider route is required for authored scene edits"
            )
        return generate_scene_edit_candidates(
            self.store, self.scene_edit_provider, context, params
        )

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

    def _search_music_candidates(
        self, context: JobContext, params: dict[str, Any]
    ) -> dict[str, Any]:
        if self.licensed_media_client is None:
            raise RuntimeError("Background-music search requires an approved Openverse route")
        return search_music_candidates(
            self.store,
            self.licensed_media_client,
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
        cancellation_scope = getattr(self.renderer, "cancellation_scope", None)
        scope = (
            cancellation_scope(context.is_cancelled)
            if callable(cancellation_scope)
            else nullcontext()
        )
        with scope:
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
        context.check_cancelled()
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
        renderer_runtime_identity = _renderer_runtime_identity(self.renderer)
        if params.get("rendererRuntimeIdentitySha256") != renderer_runtime_identity:
            raise RuntimeError(
                "Verified renderer runtime changed after this master export was queued; submit a fresh export"
            )
        generation_id = str(params["baseGenerationId"])
        generation_status = GenerationCoordinator(self.store).status(generation_id)
        if generation_status.approval_revision_id is None:
            raise ValueError("Master export requires a durable approval revision")
        validate_approved_presenters_for_export(
            self.store,
            generation_status.approval_revision_id,
            distribution_scope="publicCommercial",
        )
        render_payload, render_stage_hash = self._verified_stage_payload(generation_id, "render")
        narration_payload, narration_stage_hash = self._verified_stage_payload(
            generation_id, "narration"
        )
        approved_captions, _ = self._verified_stage_payload(generation_id, "captions")
        storyboard = narration_payload["storyboard"]
        approved_render_request = render_payload.get("renderRequest")
        if not isinstance(approved_render_request, dict):
            raise ValueError("Master export requires the immutable approved render request")
        if approved_render_request.get("scenes") != storyboard.get("scenes"):
            raise ValueError("Master export render request disagrees with measured narration timing")
        candidate = render_payload.get("candidate")
        scene_windows = candidate.get("renderSceneWindows") if isinstance(candidate, dict) else None
        if not isinstance(scene_windows, list) or not scene_windows:
            raise ValueError("Master export requires measured scene windows")
        qa_payload = self._stage_payload(generation_id, "qa_final")
        gate = qa_payload.get("qualityGate")
        if not isinstance(gate, dict) or gate.get("status") not in {"PASS", "WARNING"}:
            raise ValueError("Master export is blocked because the final QA gate does not permit export")
        context.set_progress(0.08, message="Rendering approved storyboard with selected master target")
        caption_delivery_mode = _caption_delivery_mode(params)
        locale = str(storyboard.get("locale", "en-US"))
        caption_bundle = build_caption_bundle(
            self.store,
            narration_payload,
            captions_enabled=bool(approved_captions.get("captionsEnabled", True)),
            locale=locale,
        )
        caption_compiler_version = caption_bundle.get("compilerVersion")
        if not isinstance(caption_compiler_version, str) or not caption_compiler_version:
            raise ValueError("Master export caption bundle has no compiler provenance")
        caption_bundle_document = {
            "schemaVersion": 1,
            "generationId": generation_id,
            "approvalRevisionId": generation_status.approval_revision_id,
            "sourceNarrationStageArtifactHash": narration_stage_hash,
            "locale": locale,
            "captions": caption_bundle,
        }
        caption_bundle_artifact = self.store.add_artifact_bytes(
            json.dumps(
                caption_bundle_document,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8"),
            media_type="application/vnd.alystria.caption-bundle+json",
            original_name="master-caption-bundle.json",
            metadata={
                "generationId": generation_id,
                "approvalRevisionId": generation_status.approval_revision_id,
                "sourceNarrationStageArtifactHash": narration_stage_hash,
                "locale": locale,
                "compilerVersion": caption_compiler_version,
                "rightsStatus": "owned",
            },
        )
        # Reuse the verified request that produced the approved media. Rebuilding
        # from the original plan loses measured pacing, reviewed prose, selected
        # assets, presenter timing, fonts, and audio/visual customization.
        master_render_request = copy.deepcopy(approved_render_request)
        master_render_request.update(
            {
                "generationId": context.job_id,
                "targets": [params["target"]],
                "captionDeliveryMode": caption_delivery_mode,
                "codec": params["rendererCodec"],
                "locale": locale,
                "captions": copy.deepcopy(caption_bundle),
            }
        )
        cancellation_scope = getattr(self.renderer, "cancellation_scope", None)
        scope = (
            cancellation_scope(context.is_cancelled)
            if callable(cancellation_scope)
            else nullcontext()
        )
        with scope:
            rendered = self.renderer.render(master_render_request)
        context.check_cancelled()
        caption_delivery = {
            "mode": caption_delivery_mode,
            "sidecars": ["vtt", "srt"],
            "burnedIntoPixels": caption_delivery_mode in {"burned", "both"},
            "embeddedInContainer": caption_delivery_mode in {"embedded", "both"},
        }
        artifact = self.store.add_artifact_bytes(
            rendered.content,
            media_type=rendered.media_type,
            original_name=rendered.original_name,
            metadata={
                "renderer": self.renderer.renderer_id,
                "rendererVersion": self.renderer.renderer_version,
                "rendererRuntimeIdentitySha256": renderer_runtime_identity,
                "generationId": generation_id,
                "approvalRevisionId": generation_status.approval_revision_id,
                "sourceRenderStageArtifactHash": render_stage_hash,
                "sourceNarrationStageArtifactHash": narration_stage_hash,
                "captionBundleArtifactHash": caption_bundle_artifact.hash,
                "captionCompilerVersion": caption_compiler_version,
                "renderSceneWindows": copy.deepcopy(scene_windows),
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
        master_provenance = {
            "schemaVersion": 2,
            "exportJobId": context.job_id,
            "generationId": generation_id,
            "approvalRevisionId": generation_status.approval_revision_id,
            "sourceRenderStageArtifactHash": render_stage_hash,
            "sourceNarrationStageArtifactHash": narration_stage_hash,
            "captionBundleArtifactHash": caption_bundle_artifact.hash,
            "captionCompilerVersion": caption_compiler_version,
            "videoArtifactHash": artifact.hash,
            "videoMediaType": rendered.media_type,
            "renderSceneWindows": copy.deepcopy(scene_windows),
            "captionDelivery": caption_delivery,
            "rendererRuntimeIdentitySha256": renderer_runtime_identity,
            "rightsStatus": "owned",
        }
        master_provenance_artifact = self.store.add_artifact_bytes(
            json.dumps(
                master_provenance,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8"),
            media_type="application/vnd.alystria.master-provenance+json",
            original_name="master-provenance.json",
            metadata=copy.deepcopy(master_provenance),
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
            captions_override=caption_bundle,
        )
        context.set_progress(1, message="Master and requested sidecars promoted to exports")
        return {
            "operation": "export_master",
            "generationId": generation_id,
            "approvalRevisionId": generation_status.approval_revision_id,
            "sourceRenderStageArtifactHash": render_stage_hash,
            "sourceNarrationStageArtifactHash": narration_stage_hash,
            "captionBundleArtifactHash": caption_bundle_artifact.hash,
            "captionCompilerVersion": caption_compiler_version,
            "masterProvenanceArtifactHash": master_provenance_artifact.hash,
            "rendererRuntimeIdentitySha256": renderer_runtime_identity,
            "renderSceneWindows": copy.deepcopy(scene_windows),
            "artifactHash": artifact.hash,
            "path": str(destination),
            "mediaType": rendered.media_type,
            "sidecarPaths": sidecars,
            "captionDelivery": caption_delivery,
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
        ffprobe_value = os.environ.get("ALYSTRIA_FFPROBE_PATH")
        if not ffprobe_value:
            raise RuntimeError("Pinned FFprobe runtime is missing for editor export")
        context.set_progress(0.05, message="Validating content-addressed editor timeline")
        self._require_exportable_editor_assets(head.snapshot, params["manifest"])
        result = render_editor_timeline(
            self.store,
            params["manifest"],
            ffmpeg_path=Path(ffmpeg_value),
            ffprobe_path=Path(ffprobe_value),
            cancel_check=context.is_cancelled,
        )
        context.check_cancelled()
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

    def _verified_promoted_master_receipt(
        self,
        artifact_hash: str,
        *,
        export_job_id: str,
        promoted: dict[str, Any],
        generation_id: str,
        approval_revision_id: str,
        render_stage_hash: str,
        narration_stage_hash: str,
        video_artifact_hash: str,
        video_media_type: str,
        render_scene_windows: list[Any],
    ) -> dict[str, Any]:
        """Verify per-export provenance without relying on shared video metadata."""

        row = self.store.connection.execute(
            "SELECT media_type,metadata_json FROM artifacts WHERE hash=?",
            (artifact_hash,),
        ).fetchone()
        if (
            row is None
            or row["media_type"] != "application/vnd.alystria.master-provenance+json"
            or not self.store.cas.verify(artifact_hash)
        ):
            raise ValueError("Latest promoted master provenance receipt is missing or corrupt")
        try:
            metadata = json.loads(str(row["metadata_json"]))
            document = json.loads(self.store.cas.object_path(artifact_hash).read_bytes())
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("Latest promoted master provenance receipt is invalid") from error
        if not isinstance(document, dict) or metadata != document:
            raise ValueError("Latest promoted master provenance receipt metadata is invalid")
        bundle_hash = document.get("captionBundleArtifactHash")
        compiler_version = document.get("captionCompilerVersion")
        renderer_runtime_identity = document.get("rendererRuntimeIdentitySha256")
        promoted_renderer_runtime_identity = promoted.get(
            "rendererRuntimeIdentitySha256"
        )
        schema_version = document.get("schemaVersion")
        delivery = document.get("captionDelivery")
        mode = delivery.get("mode") if isinstance(delivery, dict) else None
        expected_delivery = (
            {
                "mode": mode,
                "sidecars": ["vtt", "srt"],
                "burnedIntoPixels": mode in {"burned", "both"},
                "embeddedInContainer": mode in {"embedded", "both"},
            }
            if isinstance(mode, str) and mode in CAPTION_DELIVERY_MODES
            else None
        )
        if (
            schema_version not in {1, 2}
            or document.get("exportJobId") != export_job_id
            or document.get("generationId") != generation_id
            or document.get("approvalRevisionId") != approval_revision_id
            or document.get("sourceRenderStageArtifactHash") != render_stage_hash
            or document.get("sourceNarrationStageArtifactHash") != narration_stage_hash
            or not isinstance(bundle_hash, str)
            or not SHA256_PATTERN.fullmatch(bundle_hash)
            or not isinstance(compiler_version, str)
            or not compiler_version
            or (
                schema_version == 2
                and (
                    not isinstance(renderer_runtime_identity, str)
                    or not SHA256_PATTERN.fullmatch(renderer_runtime_identity)
                    or promoted_renderer_runtime_identity
                    != renderer_runtime_identity
                )
            )
            or (
                schema_version == 1
                and (
                    renderer_runtime_identity is not None
                    or promoted_renderer_runtime_identity is not None
                )
            )
            or document.get("videoArtifactHash") != video_artifact_hash
            or document.get("videoMediaType") != video_media_type
            or document.get("renderSceneWindows") != render_scene_windows
            or expected_delivery is None
            or not isinstance(delivery, dict)
            or not isinstance(delivery.get("burnedIntoPixels"), bool)
            or not isinstance(delivery.get("embeddedInContainer"), bool)
            or delivery != expected_delivery
            or document.get("rightsStatus") != "owned"
            or promoted.get("generationId") != document.get("generationId")
            or promoted.get("approvalRevisionId") != document.get("approvalRevisionId")
            or promoted.get("sourceRenderStageArtifactHash")
            != document.get("sourceRenderStageArtifactHash")
            or promoted.get("sourceNarrationStageArtifactHash")
            != document.get("sourceNarrationStageArtifactHash")
            or promoted.get("captionBundleArtifactHash") != bundle_hash
            or promoted.get("captionCompilerVersion") != compiler_version
            or promoted.get("artifactHash") != video_artifact_hash
            or promoted.get("mediaType") != video_media_type
            or promoted.get("renderSceneWindows") != render_scene_windows
            or promoted.get("captionDelivery") != delivery
        ):
            raise ValueError("Latest promoted master provenance receipt is incoherent")
        return document

    def _verified_promoted_caption_bundle(
        self,
        artifact_hash: str,
        *,
        generation_id: str,
        approval_revision_id: str,
        narration_stage_hash: str,
        locale: str,
    ) -> dict[str, Any]:
        """Load captions only when the promoted master's immutable bundle is coherent."""

        row = self.store.connection.execute(
            "SELECT media_type,metadata_json FROM artifacts WHERE hash=?",
            (artifact_hash,),
        ).fetchone()
        if (
            row is None
            or row["media_type"] != "application/vnd.alystria.caption-bundle+json"
            or not self.store.cas.verify(artifact_hash)
        ):
            raise ValueError("Latest promoted master caption bundle is missing or corrupt")
        try:
            metadata = json.loads(str(row["metadata_json"]))
            document = json.loads(self.store.cas.object_path(artifact_hash).read_bytes())
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("Latest promoted master caption bundle is invalid") from error
        if (
            not isinstance(metadata, dict)
            or metadata.get("generationId") != generation_id
            or metadata.get("approvalRevisionId") != approval_revision_id
            or metadata.get("sourceNarrationStageArtifactHash") != narration_stage_hash
            or metadata.get("locale") != locale
            or metadata.get("rightsStatus") != "owned"
            or not isinstance(document, dict)
            or document.get("schemaVersion") != 1
            or document.get("generationId") != generation_id
            or document.get("approvalRevisionId") != approval_revision_id
            or document.get("sourceNarrationStageArtifactHash") != narration_stage_hash
            or document.get("locale") != locale
        ):
            raise ValueError("Latest promoted master caption bundle provenance is invalid")
        captions = document.get("captions")
        compiler_version = metadata.get("compilerVersion")
        if (
            not isinstance(captions, dict)
            or not isinstance(compiler_version, str)
            or not compiler_version
            or captions.get("compilerVersion") != compiler_version
            or not isinstance(captions.get("captionsEnabled"), bool)
            or not isinstance(captions.get("byScene"), dict)
            or not isinstance(captions.get("cueCount"), int)
            or isinstance(captions.get("cueCount"), bool)
            or captions["cueCount"] < 0
        ):
            raise ValueError("Latest promoted master caption bundle payload is invalid")
        sidecars = (
            ("vttArtifactHash", "text/vtt"),
            ("srtArtifactHash", "application/x-subrip"),
            ("transcriptArtifactHash", "text/plain"),
        )
        for field, media_type in sidecars:
            digest = captions.get(field)
            if not isinstance(digest, str) or not SHA256_PATTERN.fullmatch(digest):
                raise ValueError("Latest promoted master caption bundle payload is invalid")
            sidecar_row = self.store.connection.execute(
                "SELECT media_type,metadata_json FROM artifacts WHERE hash=?", (digest,)
            ).fetchone()
            if (
                sidecar_row is None
                or sidecar_row["media_type"] != media_type
                or not self.store.cas.verify(digest)
            ):
                raise ValueError("Latest promoted master caption sidecar is missing or corrupt")
            try:
                sidecar_metadata = json.loads(str(sidecar_row["metadata_json"]))
            except (TypeError, json.JSONDecodeError) as error:
                raise ValueError("Latest promoted master caption sidecar is invalid") from error
            if (
                not isinstance(sidecar_metadata, dict)
                or sidecar_metadata.get("locale") != locale
                or sidecar_metadata.get("rightsStatus") != "owned"
            ):
                raise ValueError("Latest promoted master caption sidecar provenance is invalid")
        return captions

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
            if generated is None and self._is_current_verified_promoted_master(digest):
                continue
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

    def _is_current_verified_promoted_master(self, artifact_hash: str) -> bool:
        """Accept an unlinked video only through the current verified master job."""

        rows = self.store.connection.execute(
            "SELECT DISTINCT json_extract(result_json,'$.generationId') AS generation_id "
            "FROM jobs WHERE project_id=? AND kind='native.export_master' "
            "AND state='SUCCEEDED' AND json_valid(result_json)=1 "
            "AND json_extract(result_json,'$.artifactHash')=?",
            (self.store.manifest.project_id, artifact_hash),
        ).fetchall()
        for row in rows:
            generation_id = row["generation_id"]
            if not isinstance(generation_id, str):
                continue
            try:
                bindings = self.editor_bindings(generation_id)
            except (RuntimeError, ValueError):
                continue
            renders = bindings.get("renders")
            if isinstance(renders, list) and any(
                isinstance(binding, dict)
                and binding.get("artifactHash") == artifact_hash
                for binding in renders
            ):
                return True
        return False

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
        manifest = candidate.get("renderManifest")
        delivery = manifest.get("captionDelivery") if isinstance(manifest, dict) else None
        burned = delivery.get("burnedIntoVideo") if isinstance(delivery, dict) else None
        if not isinstance(burned, bool):
            burned = None
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
                    "captionsBurnedIntoPixels": burned,
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

    def _invalidate_authored_scene(
        self,
        scene_id: str,
        generation_id: Any,
        root_hash: str,
    ) -> list[str]:
        if isinstance(generation_id, str):
            return list(
                GenerationCoordinator(self.store).invalidate_scope(
                    generation_id, f"scene:{scene_id}"
                )
            )
        graph = DependencyGraph(self.store.connection, self.store.manifest.project_id)
        prefix = f"project:{self.store.manifest.project_id}:scene:{scene_id}"
        narration = f"{prefix}:narration"
        visual_layout = f"{prefix}:visual-layout"
        scene_render = f"{prefix}:scene-render"
        visual_qa = f"{prefix}:visual-qa"
        composition = f"{prefix}:final-composition"
        nodes = [
            (narration, []),
            (visual_layout, []),
            (scene_render, [narration, visual_layout]),
            (visual_qa, [scene_render]),
            (composition, [visual_qa]),
        ]
        for key, upstream in nodes:
            graph.record_node(
                key,
                hashlib.sha256(f"{root_hash}:{key}".encode()).hexdigest(),
                upstream_keys=upstream,
            )
        return graph.invalidate_from([narration, visual_layout])

    def _mark_promoted_media_stale(self, scene_id: str) -> list[str]:
        stale_ids: list[str] = []
        for job in self.runtime.list_jobs(
            project_id=self.store.manifest.project_id,
            limit=1_000,
        ):
            if job.state is not JobState.SUCCEEDED:
                continue
            scene_render = (
                job.kind == "native.render_scene"
                and job.parameters.get("sceneId") == scene_id
            )
            project_render = job.kind in {
                "native.export_master",
                "native.editor_timeline_export",
            }
            if not scene_render and not project_render:
                continue
            self.runtime.mark_stale(
                job.job_id,
                reason=f"Authored scene {scene_id} changed after this media was promoted",
            )
            stale_ids.append(job.job_id)
        return stale_ids

    def _copy_export_sidecars(
        self,
        generation_id: str,
        params: dict[str, Any],
        stem: str,
        locale: str,
        *,
        captions_override: dict[str, Any] | None = None,
    ) -> list[str]:
        captions = (
            captions_override
            if captions_override is not None
            else self._stage_payload(generation_id, "captions")
        )
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
        head = self.store.head_revision()
        credits = [] if head is None else _export_asset_attributions(head.snapshot)
        if credits:
            attribution = self.store.root / "exports" / f"{stem}-attribution.json"
            attribution.write_text(
                json.dumps(
                    {
                        "schema": "alystria.export.credits.v1",
                        "projectId": self.store.manifest.project_id,
                        "assets": credits,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            paths.append(str(attribution))
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
        "native.regenerate_authored_scene": "Authored scene proposals are ready for review",
        "native.search_visual_candidates": "Licensed visual candidates are ready for review",
        "native.search_music_candidates": "Background-music candidates are ready for review",
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


def _export_asset_attributions(snapshot: dict[str, Any]) -> list[dict[str, str]]:
    customization = snapshot.get("customization")
    if not isinstance(customization, dict):
        return []
    selected_ids: set[str] = set()
    for value in (
        customization.get("backgroundAssetId"),
        customization.get("audio", {}).get("musicAssetId")
        if isinstance(customization.get("audio"), dict)
        else None,
        customization.get("audio", {}).get("sfxAssetId")
        if isinstance(customization.get("audio"), dict)
        else None,
        customization.get("presenter", {}).get("assetId")
        if isinstance(customization.get("presenter"), dict)
        else None,
    ):
        if isinstance(value, str):
            selected_ids.add(value)
    assets = customization.get("assets")
    if not isinstance(assets, list):
        return []
    credits: list[dict[str, str]] = []
    for asset in assets:
        if (
            not isinstance(asset, dict)
            or asset.get("id") not in selected_ids
            or asset.get("source") != "licensed-media"
            or asset.get("rightsStatus") != "cleared"
        ):
            continue
        required = {
            "assetId": asset.get("id"),
            "title": asset.get("label"),
            "role": asset.get("kind"),
            "creator": asset.get("creator"),
            "license": asset.get("license"),
            "attribution": asset.get("attribution"),
            "sourceUrl": asset.get("sourceUrl"),
            "sha256": asset.get("sha256"),
        }
        if not all(isinstance(value, str) and value.strip() for value in required.values()):
            raise ValueError("Selected licensed asset has incomplete export attribution")
        if not SHA256_PATTERN.fullmatch(str(required["sha256"])):
            raise ValueError("Selected licensed asset attribution has an invalid SHA-256")
        if not str(required["sourceUrl"]).casefold().startswith("https://"):
            raise ValueError("Selected licensed asset attribution source must use HTTPS")
        credits.append({key: str(value) for key, value in required.items()})
    return sorted(credits, key=lambda item: item["assetId"])


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


def _renderer_runtime_identity(renderer: RendererClient | None) -> str:
    """Return a stable cache identity, preferring the verified build digest."""

    if renderer is None:
        declared = {"rendererId": "unavailable", "rendererVersion": "unavailable"}
    else:
        build_hash = getattr(renderer, "renderer_build_sha256", None)
        if build_hash is not None:
            if not isinstance(build_hash, str) or not SHA256_PATTERN.fullmatch(build_hash):
                raise ValueError("Renderer build identity must be a SHA-256 digest")
            return build_hash
        declared = {
            "rendererId": str(renderer.renderer_id),
            "rendererVersion": str(renderer.renderer_version),
        }
    return hashlib.sha256(
        json.dumps(declared, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _codec_preference(params: dict[str, Any]) -> tuple[str, str]:
    """Resolve the product-level choice to the renderer's closed codec name."""

    value = params.get("codecPreference", "h264-hardware")
    if not isinstance(value, str) or value not in CODEC_PREFERENCES:
        raise ValueError("codecPreference must be h264-hardware, hevc-hardware, or av1")
    return value, CODEC_PREFERENCES[value]


def _editor_caption_bindings(
    captions: dict[str, Any], narration: dict[str, Any]
) -> list[dict[str, Any]]:
    """Expose verified aligned cues on each scene's local clock, never raw prose."""
    if captions.get("captionsEnabled") is False:
        return []
    by_scene = captions.get("byScene")
    storyboard = narration.get("storyboard")
    scenes = storyboard.get("scenes") if isinstance(storyboard, dict) else None
    if not isinstance(by_scene, dict) or not isinstance(scenes, list):
        raise ValueError("Completed caption stage has no aligned scene timeline")
    bindings: list[dict[str, Any]] = []
    scene_ids: set[str] = set()
    for scene in scenes:
        if not isinstance(scene, dict):
            raise ValueError("Completed caption stage has an invalid scene")
        scene_id = _bounded_text(scene.get("id"), "caption scene id", 128)
        if not SCENE_ID_PATTERN.fullmatch(scene_id) or scene_id in scene_ids:
            raise ValueError("Completed caption stage has an invalid scene identity")
        scene_ids.add(scene_id)
        duration = _integer(scene.get("durationTicks"), "caption scene duration", 1, 2**53 - 1)
        cues = by_scene.get(scene_id, [])
        if not isinstance(cues, list):
            raise ValueError("Completed caption stage has invalid aligned cues")
        cue_ids: set[str] = set()
        previous_end = 0
        for cue in cues:
            if not isinstance(cue, dict):
                raise ValueError("Completed caption stage has an invalid cue")
            cue_id = _bounded_text(cue.get("cue_id"), "caption cue id", 180)
            text = _bounded_text(cue.get("text"), "caption cue text", 10_000)
            start = _integer(cue.get("start_ms"), "caption cue start", 0, 2**40) * 240
            end = _integer(cue.get("end_ms"), "caption cue end", 1, 2**40) * 240
            # Captions use integer milliseconds; permit only the existing
            # half-millisecond scene-end rounding, then retain the exact end.
            if cue_id in cue_ids or start < previous_end or start >= end or end > duration + 120:
                raise ValueError("Completed caption stage has an invalid cue interval")
            end = min(end, duration)
            if start >= end:
                raise ValueError("Completed caption stage has a cue outside its scene")
            cue_ids.add(cue_id)
            previous_end = end
            bindings.append({
                "sceneId": scene_id,
                "id": cue_id,
                "startTicks": start,
                "endTicks": end,
                "text": text,
            })
    if set(by_scene).difference(scene_ids):
        raise ValueError("Completed caption stage references an unknown scene")
    return bindings


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
