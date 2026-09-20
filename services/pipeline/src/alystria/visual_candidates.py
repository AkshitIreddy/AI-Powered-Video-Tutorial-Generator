"""Durable, review-first image candidates for scenes and presenter portraits.

Candidate generation is deliberately separate from candidate acceptance.  A
provider response is validated as a raster image and promoted to the project
CAS, but it cannot change an accepted scene or presenter until the user accepts
that exact immutable artifact in a later revision.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from collections.abc import Mapping, Sequence
from typing import Any, Protocol
from urllib.parse import urlsplit

from .generation.adapters import GeneratedMedia, GenerationMediaClient
from .jobs.runtime import CancellationRequested
from .project import ProjectHistory, ProjectStore
from .project.models import Revision, utc_now
from .providers.errors import ProviderFailure
from .security.files import ImportLimits, ValidatedFile, validate_file

MAX_CANDIDATE_IMAGE_BYTES = 32 * 1024 * 1024
MAX_INSTRUCTION_CHARS = 4_000
MAX_ALTERNATIVES = 4
MAX_SEED = 2**63 - 1
LOCAL_SDXL_MODEL_ID = "local/sdxl-base-1.0"
LOCAL_SDXL_OFFSET_LORA_ID = "local/sdxl-offset-lora-1.0"
SUPPORTED_IMAGE_TYPES = frozenset({"image/png", "image/jpeg", "image/webp"})
CANDIDATE_ROLES = frozenset({"scene", "presenter"})
PRESERVATION_LOCKS = frozenset(
    {"narration", "citations", "learningobjective", "timing", "assets", "presenter"}
)
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
SCENE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


class CandidateJobContext(Protocol):
    job_id: str
    task_key: str

    def check_cancelled(self) -> None: ...

    def set_progress(self, progress: float, *, message: str | None = None) -> None: ...

    def provider_acceptance(self, idempotency_key: str) -> dict[str, Any] | None: ...

    def record_provider_acceptance(
        self,
        *,
        idempotency_key: str,
        provider: str,
        model: str,
        provider_request_id: str | None,
        result: dict[str, Any],
        unit: str,
        quantity: float,
        cost_micros: int,
        usage_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]: ...


class VisualCandidateGenerationError(RuntimeError):
    """Every requested alternative failed, after durable failure records were saved."""


def generate_visual_candidates(
    store: ProjectStore,
    media_client: GenerationMediaClient,
    context: CandidateJobContext,
    params: Mapping[str, Any],
) -> dict[str, Any]:
    """Generate raster alternatives without replacing the accepted visual.

    The provider call uses the configured ``image.generate`` route exposed by
    ``GenerationMediaClient``.  Provider/model fallback is therefore outside
    this component and cannot occur silently here.
    """

    head = _current_head(store, params)
    scene_id = _scene_id(params.get("sceneId"))
    scene = _scene(head.snapshot, scene_id)
    role = _enum(params.get("role", "scene"), CANDIDATE_ROLES, "role")
    presenter_display_name = (
        _bounded_text(params.get("presenterDisplayName"), "presenterDisplayName", 120)
        if role == "presenter" and params.get("presenterDisplayName") is not None
        else None
    )
    instruction = _bounded_text(params.get("instruction"), "instruction", MAX_INSTRUCTION_CHARS)
    locks = _preservation_locks(params.get("preservationLocks", []), role=role)
    alternatives = _integer(params.get("alternatives", 1), "alternatives", 1, MAX_ALTERNATIVES)
    seed = _integer(params.get("seed"), "seed", 0, MAX_SEED)
    image_recipe = normalize_image_recipe(
        params.get("imageRecipe", scene.get("imageRecipe")),
        local_provider=_local_image_recipe_supported(media_client),
    )
    base_generation_id = params.get("baseGenerationId")
    if base_generation_id is not None and not isinstance(base_generation_id, str):
        raise ValueError("baseGenerationId must be a string when supplied")

    prompt = _candidate_prompt(scene, instruction=instruction, role=role)
    candidates: list[dict[str, Any]] = []
    artifact_links: list[dict[str, str]] = []
    for index in range(alternatives):
        context.check_cancelled()
        candidate_seed = seed + index
        if candidate_seed > MAX_SEED:
            raise ValueError("candidate seed exceeds the supported range")
        candidate_id = _candidate_id(context.task_key, role, scene_id, index)
        context.set_progress(
            0.05 + index / max(1, alternatives) * 0.75,
            message=f"Generating image candidate {index + 1} of {alternatives}",
        )
        try:
            candidate, link = _generate_one(
                store,
                media_client,
                context,
                scene,
                candidate_id=candidate_id,
                role=role,
                presenter_display_name=presenter_display_name,
                prompt=prompt,
                instruction=instruction,
                preservation_locks=locks,
                seed=candidate_seed,
                alternative_index=index,
                base_revision_id=head.revision_id,
                base_generation_id=base_generation_id,
                image_recipe=image_recipe,
            )
            candidates.append(candidate)
            artifact_links.append(link)
        except CancellationRequested:
            raise
        except Exception as error:  # A failed provider response remains reviewable evidence.
            candidates.append(
                _failed_candidate(
                    candidate_id=candidate_id,
                    scene_id=scene_id,
                    role=role,
                    presenter_display_name=presenter_display_name,
                    prompt=prompt,
                    instruction=instruction,
                    preservation_locks=locks,
                    seed=candidate_seed,
                    alternative_index=index,
                    base_revision_id=head.revision_id,
                    base_generation_id=base_generation_id,
                    image_recipe=image_recipe,
                    error=error,
                )
            )

    context.check_cancelled()
    # A provider can take long enough for another edit to win.  Never attach
    # its result to a different project head.
    _current_head(store, {"expectedHeadRevisionId": head.revision_id})
    snapshot = copy.deepcopy(head.snapshot)
    snapshot["sceneCandidates"] = [*_records(snapshot, "sceneCandidates"), *candidates]
    revision = store.create_revision(
        snapshot=snapshot,
        kind="generation",
        message=f"Generated review candidates for {role} {scene_id}",
        expected_head=head.revision_id,
        artifact_links=artifact_links,
    )
    ProjectHistory(store).record_new_revision(head.revision_id, revision)
    ready = [item for item in candidates if item["status"] == "ready"]
    failed = [item for item in candidates if item["status"] == "failed"]
    result = {
        "operation": "regenerate_scene",
        "sceneId": scene_id,
        "role": role,
        "baseRevisionId": head.revision_id,
        "headRevisionId": revision.revision_id,
        "revisionNumber": revision.number,
        "candidateIds": [item["id"] for item in candidates],
        "candidates": candidates,
        "readyCount": len(ready),
        "failedCount": len(failed),
        "acceptedSceneUnchanged": True,
    }
    if not ready:
        first = failed[0]["error"] if failed else {"message": "No image candidate was produced"}
        raise VisualCandidateGenerationError(str(first["message"]))
    return result


def accept_visual_candidate(store: ProjectStore, params: Mapping[str, Any]) -> dict[str, Any]:
    """Bind one reviewed CAS candidate in a new, undoable project revision."""

    head = _current_head(store, params)
    candidate_id = _bounded_text(params.get("candidateId"), "candidateId", 160)
    candidates = _records(head.snapshot, "sceneCandidates")
    candidate = _unique_record(candidates, candidate_id, "visual candidate")
    if candidate.get("status") != "ready":
        raise ValueError("Only a ready visual candidate can be accepted")
    scene_id = _scene_id(candidate.get("sceneId"))
    role = _enum(candidate.get("role"), CANDIDATE_ROLES, "candidate role")
    origin = _candidate_origin(candidate.get("origin", "aiGenerated"))
    if origin == "licensedMedia" and role != "scene":
        raise ValueError("Licensed-media candidates can only be accepted as scene visuals")
    digest = _sha256(candidate.get("artifactHash"), "candidate artifactHash")
    media_type = _enum(candidate.get("mediaType"), SUPPORTED_IMAGE_TYPES, "candidate mediaType")
    registered = _verify_registered_artifact(store, digest, media_type)
    _verify_candidate_identity(store, candidate, registered)
    rights = candidate.get("rights")
    expected_rights = _rights_from_metadata(
        registered,
        provider=_bounded_text(candidate.get("provider"), "candidate provider", 240),
        model=_bounded_text(candidate.get("model"), "candidate model", 500),
    )
    if (
        not isinstance(rights, dict)
        or rights != expected_rights
        or rights.get("exportEligible") is not True
    ):
        raise ValueError("Candidate rights source is not cleared for export")

    now = utc_now()
    asset_id = f"asset_{candidate_id.removeprefix('candidate_')}"
    provenance_id = f"prov_{candidate_id.removeprefix('candidate_')}"
    kind = "backgroundImage" if role == "scene" else "presenterPortrait"
    asset_record = {
        "id": asset_id,
        "kind": kind,
        "artifactHash": digest,
        "filename": str(candidate.get("filename") or f"{candidate_id}.{_extension(media_type)}"),
        "mediaType": media_type,
        "byteSize": _integer(candidate.get("byteSize"), "candidate byteSize", 1, MAX_CANDIDATE_IMAGE_BYTES),
        "privacy": "project_local",
        "state": "promoted",
        "provenanceId": provenance_id,
        "createdAt": now,
    }
    provenance_rights = (
        {
            "status": rights["status"],
            "license": rights["license"],
            "source": rights["source"],
            "attribution": rights["attribution"],
            "creator": rights["creator"],
            "commercialUse": rights["commercialUse"],
            "redistribution": rights["redistribution"],
            "modelInput": rights["modelInput"],
        }
        if origin == "licensedMedia"
        else {
            "status": rights.get("status"),
            "license": rights.get("license"),
            "source": rights.get("source"),
            "attribution": rights.get("attribution"),
            "commercialUse": "allowed",
            "redistribution": "allowed",
            "modelInput": "allowed",
        }
    )
    provenance_record = {
        "id": provenance_id,
        "assetId": asset_id,
        "origin": origin,
        "contentHash": digest,
        "createdAt": now,
        "provider": candidate["provider"],
        "model": candidate["model"],
        "promptHash": candidate["promptHash"],
        "seed": candidate["seed"],
        "rights": provenance_rights,
        "exportEligible": True,
        "blockers": [],
        "c2paStatus": candidate.get("c2paStatus", "absent"),
        **(
            {"licensedSource": copy.deepcopy(candidate["licensedSource"])}
            if origin == "licensedMedia"
            else {}
        ),
    }

    snapshot = copy.deepcopy(head.snapshot)
    snapshot["mediaAssets"] = _upsert_record(
        _records(snapshot, "mediaAssets"), asset_record, label="media asset"
    )
    snapshot["assetProvenance"] = _upsert_record(
        _records(snapshot, "assetProvenance"), provenance_record, label="asset provenance"
    )
    customization_value = snapshot.get("customization")
    customization = (
        copy.deepcopy(customization_value) if isinstance(customization_value, dict) else {}
    )
    customization_assets = customization.get("assets", [])
    if not isinstance(customization_assets, list) or not all(
        isinstance(item, dict) for item in customization_assets
    ):
        raise ValueError("Project customization assets must be an array of records")
    customization["assets"] = _upsert_record(
        customization_assets,
        {
            "id": asset_id,
            "kind": "background" if role == "scene" else "presenter",
            "label": (
                str(candidate.get("displayName") or "Generated presenter")[:160]
                if role == "presenter"
                else f"{_scene(head.snapshot, scene_id).get('title', 'Scene')} illustration"[:160]
            ),
            "source": "licensed-media" if origin == "licensedMedia" else "generated",
            "filename": asset_record["filename"],
            "mediaType": media_type,
            "byteSize": asset_record["byteSize"],
            "sha256": digest,
            "creator": (
                str(rights["creator"])[:240]
                if origin == "licensedMedia"
                else f"{candidate['model']} via {candidate['provider']}"[:240]
            ),
            "license": str(rights["license"])[:500],
            "attribution": str(rights["attribution"])[:500],
            **(
                {"sourceUrl": str(rights["source"])[:2_000]}
                if origin == "licensedMedia"
                else {}
            ),
            "rightsStatus": "cleared",
        },
        label="customization asset",
    )
    snapshot["customization"] = customization
    updated_candidates: list[dict[str, Any]] = []
    for item in candidates:
        updated = copy.deepcopy(item)
        if updated.get("id") == candidate_id:
            updated.update({"status": "accepted", "acceptedAt": now, "assetId": asset_id})
        elif (
            updated.get("sceneId") == scene_id
            and updated.get("role") == role
            and updated.get("status") == "accepted"
        ):
            updated.update(
                {
                    "status": "rejected",
                    "rejectedAt": now,
                    "rejectionReason": "superseded by another accepted candidate",
                }
            )
        updated_candidates.append(updated)
    snapshot["sceneCandidates"] = updated_candidates

    if role == "scene":
        scenes = _records(snapshot, "scenes")
        selected = _unique_record(scenes, scene_id, "scene")
        selected["visualAssetId"] = asset_id
        selected["visualArtifactHash"] = digest
        snapshot["scenes"] = [selected if item.get("id") == scene_id else item for item in scenes]
    else:
        profile_id = f"presenter_{candidate_id.removeprefix('candidate_')}"
        profile = {
            "profileId": profile_id,
            "displayName": str(candidate.get("displayName") or "Generated presenter"),
            "portraitArtifactId": asset_id,
            "portraitArtifactHash": digest,
            "identityType": "synthetic",
            "consentRecordId": None,
            "disclosureRequired": True,
            "authorizedDistributionScope": "publicCommercial",
            "createdAt": now,
        }
        snapshot["presenterProfiles"] = _upsert_record(
            _records(snapshot, "presenterProfiles"), profile, key="profileId", label="presenter profile"
        )
        presenter = customization.get("presenter")
        presenter = copy.deepcopy(presenter) if isinstance(presenter, dict) else {}
        placement = presenter.get("placement", "picture-in-picture")
        if placement == "off":
            placement = "picture-in-picture"
        presenter.update({"assetId": asset_id, "placement": placement})
        customization["presenter"] = presenter
        snapshot["customization"] = customization
        snapshot["selectedPresenterProfileId"] = profile_id
        snapshot["presenterSelection"] = _select_generated_presenter(
            snapshot.get("presenterSelection"),
            profile_id=profile_id,
            portrait_asset_id=asset_id,
            scene_id=scene_id,
        )

    revision = store.create_revision(
        snapshot=snapshot,
        kind="approval",
        message=f"Accepted {role} visual candidate {candidate_id}",
        expected_head=head.revision_id,
        artifact_links=[
            {"artifactHash": digest, "role": f"accepted-{role}-visual", "stableId": scene_id}
        ],
    )
    ProjectHistory(store).record_new_revision(head.revision_id, revision)
    return {
        "projectId": store.manifest.project_id,
        "headRevisionId": revision.revision_id,
        "revisionNumber": revision.number,
        "candidateId": candidate_id,
        "sceneId": scene_id,
        "role": role,
        "artifactHash": digest,
        "assetId": asset_id,
        "baseGenerationId": candidate.get("baseGenerationId"),
        "preservationLocks": copy.deepcopy(candidate.get("preservationLocks", [])),
    }


def _select_generated_presenter(
    value: Any,
    *,
    profile_id: str,
    portrait_asset_id: str,
    scene_id: str,
) -> dict[str, Any]:
    """Join an accepted portrait to the current cast and assign its source scene.

    New projects use ``presenterSelection`` as the generation authority.  The
    legacy ``selectedPresenterProfileId`` remains populated for old projects,
    but updating only that field makes an accepted generated portrait invisible
    to the multi-presenter renderer whenever a modern selection already exists.
    """

    if value is None:
        presenters: list[dict[str, Any]] = []
        assignments: list[dict[str, Any]] = []
    else:
        if not isinstance(value, dict):
            raise ValueError("presenterSelection must be an object")
        if value.get("schemaVersion") != 1:
            raise ValueError("presenterSelection.schemaVersion must be 1")
        raw_presenters = value.get("presenters")
        raw_assignments = value.get("sceneAssignments")
        if not isinstance(raw_presenters, list) or not all(
            isinstance(item, dict) for item in raw_presenters
        ):
            raise ValueError("presenterSelection.presenters must be an array of records")
        if not isinstance(raw_assignments, list) or not all(
            isinstance(item, dict) for item in raw_assignments
        ):
            raise ValueError("presenterSelection.sceneAssignments must be an array of records")
        presenters = copy.deepcopy(raw_presenters)
        assignments = copy.deepcopy(raw_assignments)

    if not any(item.get("presenterId") == profile_id for item in presenters):
        if len(presenters) >= 12:
            raise ValueError(
                "The presenter cast already contains the maximum of 12 presenters; "
                "remove one before accepting another generated portrait"
            )
        presenters.append(
            {"presenterId": profile_id, "portraitAssetId": portrait_asset_id}
        )
    else:
        presenters = [
            {
                **item,
                "portraitAssetId": portrait_asset_id,
            }
            if item.get("presenterId") == profile_id
            else item
            for item in presenters
        ]

    assignments = [
        item for item in assignments if item.get("sceneId") != scene_id
    ]
    assignments.append({"sceneId": scene_id, "presenterId": profile_id})
    return {
        "schemaVersion": 1,
        "mode": "on",
        "presenters": presenters,
        "sceneAssignments": assignments,
    }


def reject_visual_candidate(store: ProjectStore, params: Mapping[str, Any]) -> dict[str, Any]:
    """Reject a ready candidate while preserving its immutable review evidence."""

    head = _current_head(store, params)
    candidate_id = _bounded_text(params.get("candidateId"), "candidateId", 160)
    reason = _bounded_text(params.get("reason", "Rejected during visual review"), "reason", 500)
    candidates = _records(head.snapshot, "sceneCandidates")
    candidate = _unique_record(candidates, candidate_id, "visual candidate")
    if candidate.get("status") != "ready":
        raise ValueError("Only a ready visual candidate can be rejected")
    now = utc_now()
    snapshot = copy.deepcopy(head.snapshot)
    snapshot["sceneCandidates"] = [
        {
            **item,
            "status": "rejected",
            "rejectedAt": now,
            "rejectionReason": reason,
        }
        if item.get("id") == candidate_id
        else item
        for item in candidates
    ]
    revision = store.create_revision(
        snapshot=snapshot,
        kind="approval",
        message=f"Rejected visual candidate {candidate_id}",
        expected_head=head.revision_id,
    )
    ProjectHistory(store).record_new_revision(head.revision_id, revision)
    return {
        "projectId": store.manifest.project_id,
        "headRevisionId": revision.revision_id,
        "revisionNumber": revision.number,
        "candidateId": candidate_id,
        "status": "rejected",
    }


def _generate_one(
    store: ProjectStore,
    media_client: GenerationMediaClient,
    context: CandidateJobContext,
    scene: Mapping[str, Any],
    *,
    candidate_id: str,
    role: str,
    presenter_display_name: str | None,
    prompt: str,
    instruction: str,
    preservation_locks: Sequence[str],
    seed: int,
    alternative_index: int,
    base_revision_id: str,
    base_generation_id: str | None,
    image_recipe: Mapping[str, Any],
) -> tuple[dict[str, Any], dict[str, str]]:
    idempotency_key = hashlib.sha256(
        f"visual-candidate:{context.task_key}:{alternative_index}:{seed}".encode()
    ).hexdigest()
    checkpoint = context.provider_acceptance(idempotency_key)
    if checkpoint is not None:
        recovered = checkpoint.get("result")
        if not isinstance(recovered, dict):
            raise ValueError("Provider checkpoint has no candidate result")
        digest = _sha256(recovered.get("artifactHash"), "checkpoint artifactHash")
        media_type = _enum(recovered.get("mediaType"), SUPPORTED_IMAGE_TYPES, "checkpoint mediaType")
        _verify_registered_artifact(store, digest, media_type)
        return copy.deepcopy(recovered), {
            "artifactHash": digest,
            "role": f"{role}-visual-candidate",
            "stableId": candidate_id,
        }

    provider_scene = copy.deepcopy(dict(scene))
    # The configured local/cloud image client owns the reviewed recipe.  This
    # closed semantic hint only selects its approved scene or portrait shape;
    # any persisted ``imageRecipe`` remains intact for exact model/LoRA checks.
    provider_scene["imageRole"] = role
    if image_recipe:
        provider_scene["imageRecipe"] = copy.deepcopy(dict(image_recipe))
    provider_scene["visualIntent"] = prompt
    provider_scene["title"] = prompt
    media = media_client.create_visual(provider_scene, seed=seed)
    context.check_cancelled()
    provider_id = _bounded_text(media.provider_id, "image provider", 240)
    model_revision = _bounded_text(media.model_revision, "image model", 500)
    validated = _validate_media(media, candidate_id)
    safe_metadata = _public_media_metadata(media.metadata)
    artifact = store.add_artifact_bytes(
        media.content,
        media_type=validated.detected_mime,
        original_name=validated.filename,
        metadata={
            **safe_metadata,
            "candidateId": candidate_id,
            "sceneId": scene["id"],
            "role": role,
            "provider": provider_id,
            "model": model_revision,
            "seed": seed,
            "promptHash": hashlib.sha256(prompt.encode()).hexdigest(),
            "baseGenerationId": base_generation_id,
            "preservationLocks": list(preservation_locks),
            "imageRecipe": copy.deepcopy(dict(image_recipe)),
        },
    )
    rights = _candidate_rights(media)
    candidate = {
        "id": candidate_id,
        "sceneId": str(scene["id"]),
        "role": role,
        "status": "ready",
        "baseRevisionId": base_revision_id,
        "baseGenerationId": base_generation_id,
        "artifactHash": artifact.hash,
        "mediaType": artifact.media_type,
        "byteSize": artifact.byte_size,
        "filename": validated.filename,
        "prompt": prompt,
        "promptHash": hashlib.sha256(prompt.encode()).hexdigest(),
        "instruction": instruction,
        "provider": provider_id,
        "model": model_revision,
        "seed": seed,
        "alternativeIndex": alternative_index,
        "preservationLocks": list(preservation_locks),
        "imageRecipe": copy.deepcopy(dict(image_recipe)),
        "rights": rights,
        "c2paStatus": safe_metadata.get("c2paStatus", "absent"),
        "recipeId": safe_metadata.get("recipeId"),
        "createdAt": utc_now(),
        "acceptedSceneUnchanged": True,
        "actualCostMicros": media.actual_cost_micros,
        "usageUnits": _numeric_usage(media.usage_units),
        **(
            {"displayName": presenter_display_name or _presenter_display_name(instruction)}
            if role == "presenter"
            else {}
        ),
    }
    context.record_provider_acceptance(
        idempotency_key=idempotency_key,
        provider=provider_id,
        model=model_revision,
        provider_request_id=None,
        result=candidate,
        unit="image",
        quantity=1.0,
        cost_micros=max(0, media.actual_cost_micros or 0),
        usage_metadata={
            "sceneId": str(scene["id"]),
            "role": role,
            "candidateId": candidate_id,
            "providerUnits": candidate["usageUnits"],
        },
    )
    return candidate, {
        "artifactHash": artifact.hash,
        "role": f"{role}-visual-candidate",
        "stableId": candidate_id,
    }


def _candidate_prompt(scene: Mapping[str, Any], *, instruction: str, role: str) -> str:
    title = _bounded_text(scene.get("title", "Tutorial scene"), "scene title", 500)
    objective_value = scene.get("objective") or scene.get("visualIntent") or title
    objective = _bounded_text(objective_value, "scene objective", 2_000)
    if role == "presenter":
        return (
            f"Create an original synthetic adult educator portrait for a tutorial about {title}. "
            f"Direction: {instruction}. Front-facing head-and-shoulders composition, relaxed neutral "
            "expression, lips naturally closed, direct but gentle eye contact, realistic facial detail, "
            "clean uncluttered background, even studio light, no microphone, no headset, no text, logo, "
            "watermark, signature, UI, public figure, or identifiable real person."
        )
    return (
        f"Create a text-free supporting illustration for the tutorial scene '{title}'. "
        f"Learning objective: {objective}. Revision direction: {instruction}. "
        "Keep the composition educational and visually clear with generous negative space for native "
        "typography and diagrams. Do not render letters, numbers, equations, captions, interface text, "
        "logos, watermarks, signatures, or pseudo-text."
    )


def _candidate_rights(media: GeneratedMedia) -> dict[str, Any]:
    metadata = media.metadata if isinstance(media.metadata, dict) else {}
    return _rights_from_metadata(
        metadata,
        provider=media.provider_id,
        model=media.model_revision,
    )


def _rights_from_metadata(
    metadata: Mapping[str, Any], *, provider: str, model: str
) -> dict[str, Any]:
    origin = _candidate_origin(metadata.get("origin", "aiGenerated"))
    status = str(metadata.get("rightsStatus", "unknown")).strip().casefold()
    license_id = str(metadata.get("licenseId", "")).strip()
    source = str(metadata.get("sourceUri", "")).strip()
    attribution = str(metadata.get("attribution", "") or "").strip()
    if len(status) > 40 or len(license_id) > 500 or len(source) > 2_000 or len(attribution) > 500:
        raise ValueError("Image rights metadata exceeds the review record limits")
    if origin == "licensedMedia":
        creator = _bounded_text(metadata.get("attribution"), "licensed-media creator", 500)
        license_id = _bounded_text(metadata.get("licenseId"), "licensed-media license", 500)
        source = _bounded_https_url(metadata.get("sourceUri"), "licensed-media source")
        commercial_use = _enum(
            metadata.get("commercialUse"), frozenset({"allowed"}), "commercialUse"
        )
        redistribution = _enum(
            metadata.get("redistribution"),
            frozenset({"allowed", "composedWorkOnly"}),
            "redistribution",
        )
        model_input = _enum(
            metadata.get("modelInput"),
            frozenset({"allowed", "reviewOnly", "notAllowed"}),
            "modelInput",
        )
        verified = status == "verified"
        return {
            "status": status,
            "license": license_id,
            "source": source,
            "attribution": creator,
            "creator": creator,
            "commercialUse": commercial_use,
            "redistribution": redistribution,
            "modelInput": model_input,
            "exportEligible": verified,
        }
    verified = status in {"owned", "verified"} and license_id.casefold() not in {
        "",
        "unknown",
        "unverified",
    }
    if not source:
        source = f"model:{provider}/{model}"
    if not attribution:
        attribution = f"Generated with {model} via {provider}"
    return {
        "status": status,
        "license": license_id or None,
        "source": source,
        "attribution": attribution,
        "exportEligible": verified,
    }


def _validate_media(media: GeneratedMedia, candidate_id: str) -> ValidatedFile:
    if media.media_type not in SUPPORTED_IMAGE_TYPES:
        raise ValueError("Image route returned an unsupported media type")
    extension = _extension(media.media_type)
    validated = validate_file(
        f"{candidate_id}.{extension}",
        media.content,
        declared_mime=media.media_type,
        limits=ImportLimits(
            max_files=1,
            max_file_bytes=MAX_CANDIDATE_IMAGE_BYTES,
            max_total_bytes=MAX_CANDIDATE_IMAGE_BYTES,
        ),
    )
    if validated.detected_mime not in SUPPORTED_IMAGE_TYPES:
        raise ValueError("Image route did not return a supported raster image")
    return validated


def _failed_candidate(
    *,
    candidate_id: str,
    scene_id: str,
    role: str,
    presenter_display_name: str | None,
    prompt: str,
    instruction: str,
    preservation_locks: Sequence[str],
    seed: int,
    alternative_index: int,
    base_revision_id: str,
    base_generation_id: str | None,
    image_recipe: Mapping[str, Any],
    error: Exception,
) -> dict[str, Any]:
    failure = _public_failure(error)
    return {
        "id": candidate_id,
        "sceneId": scene_id,
        "role": role,
        "status": "failed",
        "baseRevisionId": base_revision_id,
        "baseGenerationId": base_generation_id,
        "prompt": prompt,
        "promptHash": hashlib.sha256(prompt.encode()).hexdigest(),
        "instruction": instruction,
        "seed": seed,
        "alternativeIndex": alternative_index,
        "preservationLocks": list(preservation_locks),
        "imageRecipe": copy.deepcopy(dict(image_recipe)),
        "error": failure,
        "createdAt": utc_now(),
        "acceptedSceneUnchanged": True,
        **(
            {"displayName": presenter_display_name or _presenter_display_name(instruction)}
            if role == "presenter"
            else {}
        ),
    }


def _public_failure(error: Exception) -> dict[str, str | bool]:
    if isinstance(error, ProviderFailure):
        return {
            "code": error.code.value,
            "message": str(error)[:500],
            "retryable": bool(error.retryable),
        }
    return {
        "code": "image_generation_failed",
        "message": str(error)[:500] or type(error).__name__,
        "retryable": False,
    }


def _public_media_metadata(value: Mapping[str, Any]) -> dict[str, Any]:
    allowed = {
        "origin",
        "rightsStatus",
        "licenseId",
        "attribution",
        "sourceUri",
        "recipeId",
        "c2paStatus",
        "width",
        "height",
    }
    return {key: copy.deepcopy(item) for key, item in value.items() if key in allowed}


def _numeric_usage(value: Mapping[str, Any]) -> dict[str, float]:
    result: dict[str, float] = {}
    for key, item in value.items():
        if isinstance(key, str) and isinstance(item, (int, float)) and not isinstance(item, bool):
            numeric = float(item)
            if math.isfinite(numeric):
                result[key[:80]] = max(0.0, numeric)
    return result


def _current_head(store: ProjectStore, params: Mapping[str, Any]) -> Revision:
    expected = _bounded_text(params.get("expectedHeadRevisionId"), "expectedHeadRevisionId", 160)
    head = store.head_revision()
    if head is None or head.revision_id != expected:
        actual = "none" if head is None else head.revision_id
        raise ValueError(f"Visual candidate base revision became stale: expected {expected}, got {actual}")
    return head


def _scene(snapshot: Mapping[str, Any], scene_id: str) -> dict[str, Any]:
    return _unique_record(_records(snapshot, "scenes"), scene_id, "scene")


def _unique_record(records: Sequence[dict[str, Any]], identifier: str, label: str) -> dict[str, Any]:
    matches = [copy.deepcopy(item) for item in records if item.get("id") == identifier]
    if len(matches) != 1:
        raise ValueError(f"{label.title()} {identifier} does not exist exactly once")
    return matches[0]


def _records(snapshot: Mapping[str, Any], key: str) -> list[dict[str, Any]]:
    value = snapshot.get(key, [])
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise ValueError(f"Project {key} must be an array of records")
    return [copy.deepcopy(item) for item in value]


def _upsert_record(
    records: Sequence[dict[str, Any]],
    record: dict[str, Any],
    *,
    key: str = "id",
    label: str,
) -> list[dict[str, Any]]:
    matches = [item for item in records if item.get(key) == record.get(key)]
    if len(matches) > 1:
        raise ValueError(f"Project contains duplicate {label} identifiers")
    return [record if item.get(key) == record.get(key) else copy.deepcopy(item) for item in records] + (
        [] if matches else [record]
    )


def _verify_registered_artifact(
    store: ProjectStore, digest: str, media_type: str
) -> dict[str, Any]:
    row = store.connection.execute(
        "SELECT media_type,byte_size,metadata_json FROM artifacts WHERE hash=?", (digest,)
    ).fetchone()
    if row is None or row["media_type"] != media_type:
        raise ValueError("Candidate artifact is not registered with its claimed media type")
    if not store.cas.verify(digest):
        raise ValueError("Candidate artifact is missing or corrupt")
    try:
        metadata = json.loads(str(row["metadata_json"]))
    except json.JSONDecodeError as error:
        raise ValueError("Candidate artifact registration has invalid metadata") from error
    if not isinstance(metadata, dict):
        raise ValueError("Candidate artifact registration has invalid metadata")
    return {**metadata, "registeredByteSize": int(row["byte_size"])}


def _verify_candidate_identity(
    store: ProjectStore,
    candidate: Mapping[str, Any],
    registered: Mapping[str, Any],
) -> None:
    candidate_id = _bounded_text(candidate.get("id"), "candidate id", 160)
    scene_id = _scene_id(candidate.get("sceneId"))
    role = _enum(candidate.get("role"), CANDIDATE_ROLES, "candidate role")
    provider = _bounded_text(candidate.get("provider"), "candidate provider", 240)
    model = _bounded_text(candidate.get("model"), "candidate model", 500)
    seed = _integer(candidate.get("seed"), "candidate seed", 0, MAX_SEED)
    prompt = _bounded_text(candidate.get("prompt"), "candidate prompt", 8_000)
    prompt_hash = _sha256(candidate.get("promptHash"), "candidate promptHash")
    if hashlib.sha256(prompt.encode()).hexdigest() != prompt_hash:
        raise ValueError("Candidate prompt does not match its immutable prompt hash")
    preservation_locks = list(
        _preservation_locks(candidate.get("preservationLocks", []), role=role)
    )
    base_generation_id = candidate.get("baseGenerationId")
    if base_generation_id is not None and not isinstance(base_generation_id, str):
        raise ValueError("candidate baseGenerationId must be a string when supplied")
    byte_size = _integer(
        candidate.get("byteSize"), "candidate byteSize", 1, MAX_CANDIDATE_IMAGE_BYTES
    )
    expected = {
        "candidateId": candidate_id,
        "sceneId": scene_id,
        "role": role,
        "provider": provider,
        "model": model,
        "seed": seed,
        "promptHash": prompt_hash,
        "registeredByteSize": byte_size,
        "baseGenerationId": base_generation_id,
        "preservationLocks": preservation_locks,
        "imageRecipe": normalize_image_recipe(
            candidate.get("imageRecipe"),
            local_provider=True,
        ),
    }
    origin = _candidate_origin(candidate.get("origin", "aiGenerated"))
    registered_origin = _candidate_origin(registered.get("origin", "aiGenerated"))
    if origin != registered_origin:
        raise ValueError("Candidate origin does not match its immutable artifact registration")
    if origin == "licensedMedia":
        if role != "scene":
            raise ValueError("Licensed-media candidates cannot be presenter portraits")
        expected["origin"] = origin
        expected["licensedSource"] = _licensed_source(candidate.get("licensedSource"), provider)
    if any(registered.get(key) != value for key, value in expected.items()):
        raise ValueError("Candidate metadata does not match its immutable artifact registration")
    link = store.connection.execute(
        """SELECT 1 FROM revision_artifacts
        WHERE artifact_hash=? AND role=? AND stable_id=? LIMIT 1""",
        (candidate["artifactHash"], f"{role}-visual-candidate", candidate_id),
    ).fetchone()
    if link is None:
        raise ValueError("Candidate artifact has no immutable review revision link")


def _candidate_origin(value: Any) -> str:
    return _enum(value, frozenset({"aiGenerated", "licensedMedia"}), "candidate origin")


def _licensed_source(value: Any, provider: str) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) != {
        "providerId",
        "sourceAssetId",
        "sourceUrl",
        "creator",
        "licenseId",
    }:
        raise ValueError("Licensed-media source record is invalid")
    source = {
        "providerId": _bounded_text(value.get("providerId"), "source provider", 240),
        "sourceAssetId": _sha256(value.get("sourceAssetId"), "source asset ID"),
        "sourceUrl": _bounded_https_url(value.get("sourceUrl"), "source URL"),
        "creator": _bounded_text(value.get("creator"), "source creator", 500),
        "licenseId": _bounded_text(value.get("licenseId"), "source license", 500),
    }
    if source["providerId"] != provider:
        raise ValueError("Licensed-media source provider does not match its candidate")
    return source


def _bounded_https_url(value: Any, label: str) -> str:
    text = _bounded_text(value, label, 2_000)
    parsed = urlsplit(text)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError(f"{label} must be a public HTTPS URL")
    return text


def _preservation_locks(value: Any, *, role: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError("preservationLocks must be an array of strings")
    normalized = tuple(sorted(set(value)))
    unknown = set(normalized).difference(PRESERVATION_LOCKS)
    if unknown:
        raise ValueError(f"Unsupported preservation locks: {', '.join(sorted(unknown))}")
    conflicts = {"assets"} if role == "scene" else {"presenter"}
    requested_conflicts = conflicts.intersection(normalized)
    if requested_conflicts:
        raise ValueError(
            f"Cannot regenerate a {role} visual while preserving {', '.join(sorted(requested_conflicts))}"
        )
    return normalized


def normalize_image_recipe(value: Any, *, local_provider: bool = True) -> dict[str, Any]:
    """Validate the closed local SDXL recipe shared by RPC and execution."""
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("imageRecipe must be an object")
    unsupported = set(value).difference({"model", "loras", "negativePrompt"})
    if unsupported:
        raise ValueError(
            "imageRecipe contains unsupported fields: "
            + ", ".join(sorted(str(item) for item in unsupported))
        )
    if value and not local_provider:
        raise ValueError("imageRecipe is only supported by the selected local image route")
    normalized: dict[str, Any] = {}
    if "model" in value:
        model = _bounded_text(value.get("model"), "imageRecipe.model", 500)
        if model != LOCAL_SDXL_MODEL_ID:
            raise ValueError(f"imageRecipe.model must be {LOCAL_SDXL_MODEL_ID}")
        normalized["model"] = model
    if "loras" in value:
        loras = value.get("loras")
        if not isinstance(loras, list) or not all(isinstance(item, str) for item in loras):
            raise ValueError("imageRecipe.loras must be an array of model IDs")
        if len(loras) > 1:
            raise ValueError("imageRecipe.loras supports at most one reviewed LoRA")
        if loras and loras[0] != LOCAL_SDXL_OFFSET_LORA_ID:
            raise ValueError(
                f"imageRecipe.loras only supports {LOCAL_SDXL_OFFSET_LORA_ID}"
            )
        normalized["loras"] = list(loras)
    if "negativePrompt" in value:
        negative_prompt = _bounded_text(
            value.get("negativePrompt"), "imageRecipe.negativePrompt", 2_048
        )
        normalized["negativePrompt"] = negative_prompt
    return normalized


def _local_image_recipe_supported(media_client: GenerationMediaClient) -> bool:
    """Follow the current media decorators to the actually selected image lane."""

    current: Any = media_client
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        image_provider_ids = getattr(current, "_image_provider_ids", None)
        if isinstance(image_provider_ids, tuple):
            if image_provider_ids != ("local-runtime",):
                return False
            current = getattr(current, "_local_fallback", None)
            continue
        if getattr(current, "provider_id", None) == "local-runtime":
            return True
        current = getattr(current, "base", None) or getattr(current, "fallback", None)
    return False


def _candidate_id(task_key: str, role: str, scene_id: str, index: int) -> str:
    digest = hashlib.sha256(f"{task_key}:{role}:{scene_id}:{index}".encode()).hexdigest()
    return f"candidate_{digest[:32]}"


def _presenter_display_name(instruction: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9 '-]+", " ", instruction).strip()
    return (cleaned[:80].strip() or "Generated presenter").title()


def _scene_id(value: Any) -> str:
    scene_id = _bounded_text(value, "sceneId", 128)
    if SCENE_ID_PATTERN.fullmatch(scene_id) is None:
        raise ValueError("sceneId contains unsupported characters")
    return scene_id


def _sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or SHA256_PATTERN.fullmatch(value) is None:
        raise ValueError(f"{label} must be a lowercase SHA-256 digest")
    return value


def _bounded_text(value: Any, label: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f"{label} must contain 1 to {maximum} characters")
    return value.strip()


def _enum(value: Any, allowed: frozenset[str], label: str) -> str:
    if not isinstance(value, str) or value not in allowed:
        raise ValueError(f"{label} must be one of {', '.join(sorted(allowed))}")
    return value


def _integer(value: Any, label: str, minimum: int, maximum: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not minimum <= value <= maximum:
        raise ValueError(f"{label} must be an integer between {minimum} and {maximum}")
    return value


def _extension(media_type: str) -> str:
    return {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[media_type]
