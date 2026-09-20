"""Durable, hash-bound animation previews for custom presenter portraits."""

from __future__ import annotations

import copy
import hashlib
import json
import re
from collections.abc import Mapping
from importlib.resources import files
from typing import Any, Protocol, cast

from alystria.generation.adapters import GeneratedMedia
from alystria.jobs import JobContext
from alystria.project import ProjectHistory, ProjectStore, Revision
from alystria.project.models import utc_now
from alystria.project_assets import _validate_stored_presenter_profile

PREVIEW_IMPLEMENTATION_VERSION = "presenter-animation-preview-v1"
PREVIEW_AUDIO_FILENAME = "presenter-animation-preview-zira-v1.wav"
PREVIEW_AUDIO_SHA256 = "49615c6743d80b6a3651e84ae1f50f7752ec097ba8ed9e3b3d3885aa6ad88f44"
PREVIEW_AUDIO_BYTE_SIZE = 487_678
PREVIEW_AUDIO_DURATION_MS = 5_080
PREVIEW_AUDIO_VOICE = "Microsoft Zira Desktop"
SOULX_MODEL_ID = "soulx-flashhead-pro"
SOULX_WORKER_CONTRACT_ID = "alystria.soulx-flashhead.worker.v1"
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
STABLE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
SUPPORTED_PREVIEW_MEDIA_TYPES = frozenset({"video/mp4"})


class PresenterPreviewMediaClient(Protocol):
    runtime: Any

    def create_presenter(
        self,
        scene: dict[str, Any],
        *,
        narration_hash: str,
        seed: int,
    ) -> GeneratedMedia | None: ...


def prepare_presenter_preview(
    store: ProjectStore, params: Mapping[str, Any]
) -> tuple[Revision, dict[str, Any], dict[str, Any]]:
    """Validate a cheap queue request without loading the GPU runtime."""

    expected_head = _bounded_text(params.get("baseRevisionId"), "baseRevisionId", 160)
    profile_id = _stable_id(params.get("profileId"), "profileId")
    head = store.head_revision()
    if head is None:
        raise ValueError("Project has no durable base revision")
    if head.revision_id != expected_head:
        raise ValueError(
            f"Base revision {expected_head} is stale; current head is {head.revision_id}"
        )
    profile, portrait = _reviewed_profile(store, head.snapshot, profile_id)
    parameters = {
        "expectedHeadRevisionId": head.revision_id,
        "profileId": profile_id,
        "portraitArtifactId": portrait["id"],
        "portraitArtifactHash": portrait["artifactHash"],
        # LocalPresenterMediaClient watches running presenter-stage jobs for
        # cancellation, including this standalone preview path.
        "stage": "presenter",
    }
    return head, profile, parameters


def render_presenter_preview(
    store: ProjectStore,
    media_client: PresenterPreviewMediaClient | None,
    context: JobContext,
    params: Mapping[str, Any],
) -> dict[str, Any]:
    """Render and persist one review candidate using the installed SoulX route."""

    expected_head = _bounded_text(
        params.get("expectedHeadRevisionId"), "expectedHeadRevisionId", 160
    )
    current = store.head_revision()
    if current is None:
        raise ValueError("Project has no durable base revision")
    preview_id = f"presenter-preview-{context.task_key[:32]}"
    recovered = _existing_preview(store, current, preview_id)
    if recovered is not None:
        if recovered.get("baseRevisionId") != expected_head:
            raise ValueError("Recovered presenter preview does not match its queued revision")
        return _preview_result(recovered, current)
    head = _ensure_head(store, expected_head)
    profile_id = _stable_id(params.get("profileId"), "profileId")
    profile, portrait = _reviewed_profile(store, head.snapshot, profile_id)
    if params.get("portraitArtifactId") != portrait["id"] or params.get(
        "portraitArtifactHash"
    ) != portrait["artifactHash"]:
        raise ValueError("Presenter preview no longer matches the queued portrait")

    model_id, model_revision, worker_contract_id = _runtime_identity(media_client)
    audio = _preview_audio()
    narration = store.add_artifact_bytes(
        audio,
        media_type="audio/wav",
        original_name=PREVIEW_AUDIO_FILENAME,
        metadata={
            "kind": "presenterAnimationPreviewAudio",
            "voiceId": PREVIEW_AUDIO_VOICE,
            "model": "System.Speech.Synthesis",
            "durationMs": PREVIEW_AUDIO_DURATION_MS,
            "sampleRateHz": 48_000,
            "channels": 1,
            "localOnly": True,
            "rightsStatus": "owned",
        },
    )
    if narration.hash != PREVIEW_AUDIO_SHA256:
        raise RuntimeError("Bundled presenter preview audio failed integrity validation")

    consent_id = profile.get("consentRecordId")
    subject_id: str | None = None
    if profile.get("identityType") == "realPerson":
        consent = _unique_record(
            head.snapshot.get("consentRecords"),
            "id",
            consent_id,
            "presenter consent",
        )
        subject_id = _stable_id(consent.get("subjectId"), "consent subjectId")

    scene = {
        "id": preview_id,
        "title": "Presenter animation preview",
        "presenterProfileId": profile_id,
        "portraitArtifactHash": portrait["artifactHash"],
        "presenterModelInputAllowed": True,
        "presenterIdentityType": profile["identityType"],
        "presenterConsentId": consent_id,
        "presenterSubjectId": subject_id,
    }
    seed = int(context.task_key[:15], 16)
    context.set_progress(0.05, message="Preparing the portrait and local preview audio")
    assert media_client is not None
    generated = media_client.create_presenter(
        scene,
        narration_hash=narration.hash,
        seed=seed,
    )
    context.check_cancelled()
    if generated is None:
        raise RuntimeError("The configured presenter route did not return an animation preview")
    _validate_generated_preview(
        generated,
        profile_id=profile_id,
        portrait_hash=str(portrait["artifactHash"]),
        narration_hash=narration.hash,
        model_id=model_id,
        model_revision=model_revision,
        worker_contract_id=worker_contract_id,
    )
    duration_ms = _duration_ms(generated)
    artifact = store.add_artifact_bytes(
        generated.content,
        media_type=generated.media_type,
        original_name=f"{preview_id}.mp4",
        metadata={
            "kind": "presenterAnimationPreview",
            "previewId": preview_id,
            "profileId": profile_id,
            "portraitArtifactHash": portrait["artifactHash"],
            "narrationArtifactHash": narration.hash,
            "modelId": model_id,
            "modelRevision": model_revision,
            "workerContractId": worker_contract_id,
            "durationMs": duration_ms,
            "rightsStatus": "owned",
            "localOnly": True,
        },
    )
    declared_output_hash = generated.metadata.get("outputSha256")
    if declared_output_hash != artifact.hash:
        raise ValueError("Presenter runtime output hash does not match the promoted preview")

    candidate = {
        "schemaVersion": 1,
        "id": preview_id,
        "status": "ready",
        "baseRevisionId": head.revision_id,
        "profileId": profile_id,
        "portraitArtifactId": portrait["id"],
        "portraitArtifactHash": portrait["artifactHash"],
        "narrationArtifactHash": narration.hash,
        "outputArtifactHash": artifact.hash,
        "mediaType": artifact.media_type,
        "byteSize": artifact.byte_size,
        "durationMs": duration_ms,
        "engineId": model_id,
        "modelRevision": model_revision,
        "workerContractId": worker_contract_id,
        "seed": seed,
        "createdAt": utc_now(),
    }
    context.set_progress(0.95, message="Saving the animation preview for review")
    context.check_cancelled()
    _ensure_head(store, head.revision_id)
    snapshot = copy.deepcopy(head.snapshot)
    snapshot["presenterAnimationPreviews"] = [
        *_records(snapshot.get("presenterAnimationPreviews")),
        candidate,
    ]
    revision = store.create_revision(
        snapshot=snapshot,
        kind="generation",
        message=f"Rendered animation preview for {profile.get('displayName', profile_id)}",
        expected_head=head.revision_id,
        artifact_links=[
            {
                "artifactHash": narration.hash,
                "role": "presenter-preview-audio",
                "stableId": preview_id,
            },
            {
                "artifactHash": artifact.hash,
                "role": "presenter-preview-video",
                "stableId": preview_id,
            },
        ],
    )
    ProjectHistory(store).record_new_revision(head.revision_id, revision)
    return _preview_result(candidate, revision)


def accept_presenter_preview(
    store: ProjectStore, params: Mapping[str, Any]
) -> dict[str, Any]:
    """Accept only an intact preview bound to the current portrait and runtime."""

    head = _decision_head(store, params)
    preview_id = _stable_id(params.get("previewId"), "previewId")
    previews = _records(head.snapshot.get("presenterAnimationPreviews"))
    preview = _unique_record(previews, "id", preview_id, "presenter animation preview")
    validated = _validated_preview(store, head.snapshot, preview)
    if validated["status"] == "accepted":
        return _decision_result(validated, head)
    if validated["status"] != "ready":
        raise ValueError("Only a ready presenter animation preview can be accepted")

    accepted_at = utc_now()
    updated = {**validated, "status": "accepted", "acceptedAt": accepted_at}
    snapshot = copy.deepcopy(head.snapshot)
    snapshot["presenterAnimationPreviews"] = [
        updated if item.get("id") == preview_id else copy.deepcopy(item)
        for item in previews
    ]
    revision = store.create_revision(
        snapshot=snapshot,
        kind="edit",
        message=f"Accepted presenter animation preview {preview_id}",
        expected_head=head.revision_id,
    )
    ProjectHistory(store).record_new_revision(head.revision_id, revision)
    return _decision_result(updated, revision)


def reject_presenter_preview(
    store: ProjectStore, params: Mapping[str, Any]
) -> dict[str, Any]:
    """Dismiss a candidate while retaining its auditable project artifact."""

    head = _decision_head(store, params)
    preview_id = _stable_id(params.get("previewId"), "previewId")
    previews = _records(head.snapshot.get("presenterAnimationPreviews"))
    preview = _unique_record(previews, "id", preview_id, "presenter animation preview")
    validated = _validated_preview(store, head.snapshot, preview)
    if validated["status"] == "rejected":
        return _decision_result(validated, head)
    if validated["status"] != "ready":
        raise ValueError("Only a ready presenter animation preview can be rejected")
    updated = {**validated, "status": "rejected", "rejectedAt": utc_now()}
    snapshot = copy.deepcopy(head.snapshot)
    snapshot["presenterAnimationPreviews"] = [
        updated if item.get("id") == preview_id else copy.deepcopy(item)
        for item in previews
    ]
    revision = store.create_revision(
        snapshot=snapshot,
        kind="edit",
        message=f"Rejected presenter animation preview {preview_id}",
        expected_head=head.revision_id,
    )
    ProjectHistory(store).record_new_revision(head.revision_id, revision)
    return _decision_result(updated, revision)


def _reviewed_profile(
    store: ProjectStore, snapshot: dict[str, Any], profile_id: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    profile = _unique_record(
        snapshot.get("presenterProfiles"), "profileId", profile_id, "presenter profile"
    )
    _validate_stored_presenter_profile(store, snapshot, profile)
    portrait = _unique_record(
        snapshot.get("mediaAssets"),
        "id",
        profile.get("portraitArtifactId"),
        "presenter portrait",
    )
    digest = _sha256(profile.get("portraitArtifactHash"), "portraitArtifactHash")
    if portrait.get("artifactHash") != digest or portrait.get("kind") != "presenterPortrait":
        raise ValueError("Presenter profile no longer matches its reviewed portrait")
    if not store.cas.verify(digest):
        raise ValueError("Presenter portrait is missing or corrupt")
    return profile, portrait


def _runtime_identity(
    media_client: PresenterPreviewMediaClient | None,
) -> tuple[str, str, str]:
    runtime = None if media_client is None else getattr(media_client, "runtime", None)
    if runtime is None:
        raise RuntimeError(
            "Install and select the SoulX-FlashHead presenter model before previewing animation"
        )
    model_id = _bounded_text(getattr(runtime, "model_id", None), "presenter model", 160)
    model_revision = _bounded_text(
        getattr(runtime, "model_revision", None), "presenter model revision", 500
    )
    worker_contract = getattr(runtime, "worker_contract", None)
    contract_id = _bounded_text(
        getattr(worker_contract, "contract_id", None), "presenter worker contract", 200
    )
    if model_id != SOULX_MODEL_ID or contract_id != SOULX_WORKER_CONTRACT_ID:
        raise RuntimeError(
            "Custom portrait previews require the installed SoulX-FlashHead Pro runtime"
        )
    if model_revision.casefold() in {"unverified", "none", "unknown"}:
        raise RuntimeError(
            "SoulX-FlashHead is missing its verified model revision; repair the presenter model"
        )
    return model_id, model_revision, contract_id


def _preview_audio() -> bytes:
    audio = files("alystria.assets").joinpath(PREVIEW_AUDIO_FILENAME).read_bytes()
    if (
        len(audio) != PREVIEW_AUDIO_BYTE_SIZE
        or hashlib.sha256(audio).hexdigest() != PREVIEW_AUDIO_SHA256
    ):
        raise RuntimeError("Bundled presenter preview audio failed integrity validation")
    return audio


def _validate_generated_preview(
    generated: GeneratedMedia,
    *,
    profile_id: str,
    portrait_hash: str,
    narration_hash: str,
    model_id: str,
    model_revision: str,
    worker_contract_id: str,
) -> None:
    if generated.media_type not in SUPPORTED_PREVIEW_MEDIA_TYPES:
        raise ValueError("Presenter runtime returned an unsupported preview media type")
    if generated.provider_id != "local-presenter" or generated.model_revision != model_revision:
        raise ValueError("Presenter runtime returned a different model identity")
    metadata = generated.metadata
    expected = {
        "presenterProfileId": profile_id,
        "portraitArtifactHash": portrait_hash,
        "narrationArtifactHash": narration_hash,
        "modelId": model_id,
        "modelRevision": model_revision,
        "workerContractId": worker_contract_id,
    }
    if any(metadata.get(key) != value for key, value in expected.items()):
        raise ValueError("Presenter runtime output provenance does not match the preview request")
    output_hash = metadata.get("outputSha256")
    if not isinstance(output_hash, str) or output_hash != hashlib.sha256(
        generated.content
    ).hexdigest():
        raise ValueError("Presenter runtime output hash is invalid")


def _duration_ms(generated: GeneratedMedia) -> int:
    probe = generated.metadata.get("probe")
    seconds = probe.get("durationSeconds") if isinstance(probe, Mapping) else None
    if not isinstance(seconds, (int, float, str)) or isinstance(seconds, bool):
        raise ValueError("Presenter preview has no measured duration")
    try:
        duration = round(float(seconds) * 1_000)
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError("Presenter preview duration is invalid") from error
    if not 4_000 <= duration <= 7_000:
        raise ValueError("Presenter preview must be between four and seven seconds")
    return duration


def _validated_preview(
    store: ProjectStore, snapshot: dict[str, Any], raw: Mapping[str, Any]
) -> dict[str, Any]:
    preview = copy.deepcopy(dict(raw))
    if preview.get("schemaVersion") != 1:
        raise ValueError("Presenter animation preview has an unsupported schema")
    _stable_id(preview.get("id"), "preview id")
    status = preview.get("status")
    if status not in {"ready", "accepted", "rejected"}:
        raise ValueError("Presenter animation preview has an invalid status")
    profile_id = _stable_id(preview.get("profileId"), "preview profileId")
    profile, portrait = _reviewed_profile(store, snapshot, profile_id)
    if (
        preview.get("portraitArtifactId") != portrait["id"]
        or preview.get("portraitArtifactHash") != portrait["artifactHash"]
        or profile.get("portraitArtifactHash") != portrait["artifactHash"]
    ):
        raise ValueError("Presenter animation preview no longer matches its portrait")
    output_hash = _sha256(preview.get("outputArtifactHash"), "preview outputArtifactHash")
    narration_hash = _sha256(
        preview.get("narrationArtifactHash"), "preview narrationArtifactHash"
    )
    if narration_hash != PREVIEW_AUDIO_SHA256:
        raise ValueError("Presenter animation preview uses unexpected audio")
    if not store.cas.verify(output_hash) or not store.cas.verify(narration_hash):
        raise ValueError("Presenter animation preview media is missing or corrupt")
    row = store.connection.execute(
        "SELECT media_type,byte_size,metadata_json FROM artifacts WHERE hash=?", (output_hash,)
    ).fetchone()
    if row is None or row["media_type"] != "video/mp4" or int(row["byte_size"]) != preview.get(
        "byteSize"
    ):
        raise ValueError("Presenter animation preview artifact ledger is invalid")
    try:
        metadata = json.loads(str(row["metadata_json"]))
    except (TypeError, json.JSONDecodeError) as error:
        raise ValueError("Presenter animation preview metadata is invalid") from error
    expected_metadata = {
        "previewId": preview["id"],
        "profileId": profile_id,
        "portraitArtifactHash": portrait["artifactHash"],
        "narrationArtifactHash": narration_hash,
        "modelId": preview.get("engineId"),
        "modelRevision": preview.get("modelRevision"),
        "workerContractId": preview.get("workerContractId"),
        "durationMs": preview.get("durationMs"),
    }
    if not isinstance(metadata, dict) or any(
        metadata.get(key) != value for key, value in expected_metadata.items()
    ):
        raise ValueError("Presenter animation preview metadata does not match its receipt")
    if preview.get("engineId") != SOULX_MODEL_ID or preview.get(
        "workerContractId"
    ) != SOULX_WORKER_CONTRACT_ID:
        raise ValueError("Presenter animation preview used an unsupported runtime")
    _bounded_text(preview.get("modelRevision"), "preview modelRevision", 500)
    duration = preview.get("durationMs")
    if not isinstance(duration, int) or isinstance(duration, bool) or not 4_000 <= duration <= 7_000:
        raise ValueError("Presenter animation preview duration is invalid")
    return preview


def _current_head(store: ProjectStore, params: Mapping[str, Any]) -> Revision:
    expected = _bounded_text(
        params.get("expectedHeadRevisionId"), "expectedHeadRevisionId", 160
    )
    return _ensure_head(store, expected)


def _decision_head(store: ProjectStore, params: Mapping[str, Any]) -> Revision:
    expected = _bounded_text(
        params.get("expectedHeadRevisionId"), "expectedHeadRevisionId", 160
    )
    return _ensure_head(store, expected)


def _ensure_head(store: ProjectStore, expected: str) -> Revision:
    head = store.head_revision()
    if head is None:
        raise ValueError("Project has no durable base revision")
    if head.revision_id != expected:
        raise ValueError(
            f"Base revision {expected} is stale; current head is {head.revision_id}"
        )
    return head


def _existing_preview(
    store: ProjectStore, head: Revision, preview_id: str
) -> dict[str, Any] | None:
    matches = [
        value
        for value in _records(head.snapshot.get("presenterAnimationPreviews"))
        if value.get("id") == preview_id
    ]
    if not matches:
        return None
    if len(matches) != 1:
        raise ValueError("Presenter animation preview identity is duplicated")
    return _validated_preview(store, head.snapshot, matches[0])


def _preview_result(preview: Mapping[str, Any], revision: Revision) -> dict[str, Any]:
    return {
        "operation": "preview_presenter_animation",
        "projectId": revision.project_id,
        "headRevisionId": revision.revision_id,
        "revisionNumber": revision.number,
        "preview": copy.deepcopy(dict(preview)),
    }


def _decision_result(preview: Mapping[str, Any], revision: Revision) -> dict[str, Any]:
    return {
        "operation": f"{preview['status']}_presenter_animation_preview",
        "projectId": revision.project_id,
        "headRevisionId": revision.revision_id,
        "revisionNumber": revision.number,
        "previewId": preview["id"],
        "status": preview["status"],
        "profileId": preview["profileId"],
        "portraitArtifactHash": preview["portraitArtifactHash"],
        "outputArtifactHash": preview["outputArtifactHash"],
        "engineId": preview["engineId"],
        "modelRevision": preview["modelRevision"],
        "workerContractId": preview["workerContractId"],
        **(
            {"acceptedAt": preview["acceptedAt"]}
            if preview.get("acceptedAt") is not None
            else {}
        ),
    }


def _records(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise ValueError("Presenter animation preview records must be an array of objects")
    return cast(list[dict[str, Any]], value)


def _unique_record(
    value: Any, key: str, expected: Any, label: str
) -> dict[str, Any]:
    matches = [item for item in _records(value) if item.get(key) == expected]
    if len(matches) != 1:
        raise ValueError(f"{label} does not exist exactly once")
    return copy.deepcopy(matches[0])


def _sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA256_PATTERN.fullmatch(value):
        raise ValueError(f"{label} must be a lowercase SHA-256 digest")
    return value


def _stable_id(value: Any, label: str) -> str:
    text = _bounded_text(value, label, 160)
    if not STABLE_ID_PATTERN.fullmatch(text):
        raise ValueError(f"{label} contains unsupported characters")
    return text


def _bounded_text(value: Any, label: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    text = value.strip()
    if len(text) > maximum or "\x00" in text:
        raise ValueError(f"{label} exceeds its safety limit")
    return text


__all__ = [
    "PREVIEW_AUDIO_SHA256",
    "PREVIEW_IMPLEMENTATION_VERSION",
    "SOULX_MODEL_ID",
    "SOULX_WORKER_CONTRACT_ID",
    "accept_presenter_preview",
    "prepare_presenter_preview",
    "reject_presenter_preview",
    "render_presenter_preview",
]
