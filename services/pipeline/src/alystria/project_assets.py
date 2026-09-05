"""Typed user-media import and presenter-profile selection.

The desktop webview supplies bytes from an ordinary browser ``File``.  It never
receives a project object path and this service never accepts a caller-chosen
filesystem path.  Imported media is validated in quarantine, promoted into the
project CAS, then referenced only by opaque stable IDs and immutable hashes.
"""

from __future__ import annotations

import base64
import binascii
import copy
import hashlib
import json
import os
import re
import uuid
from dataclasses import dataclass
from typing import Any

from .font_assets import inspect_font
from .project import ProjectHistory, ProjectStore
from .project.database import transaction
from .project.models import utc_now
from .security.files import ImportLimits, validate_file

MAX_ASSET_BYTES = 64 * 1024 * 1024
MAX_ASSET_BASE64_CHARS = ((MAX_ASSET_BYTES + 2) // 3) * 4

ASSET_LIMITS = {
    "presenterPortrait": 32 * 1024 * 1024,
    "presenterAudio": 64 * 1024 * 1024,
    "backgroundImage": 32 * 1024 * 1024,
    "font": 16 * 1024 * 1024,
    "music": 64 * 1024 * 1024,
    "soundEffect": 32 * 1024 * 1024,
    "editorImage": 32 * 1024 * 1024,
    "editorVideo": 64 * 1024 * 1024,
    "editorAudio": 64 * 1024 * 1024,
}

ASSET_MIME_TYPES = {
    "presenterPortrait": frozenset({"image/png", "image/jpeg", "image/webp"}),
    "backgroundImage": frozenset({"image/png", "image/jpeg", "image/webp"}),
    "font": frozenset({"font/ttf", "font/otf", "font/woff", "font/woff2"}),
    "presenterAudio": frozenset(
        {"audio/wav", "audio/mpeg", "audio/flac", "audio/ogg"}
    ),
    "music": frozenset({"audio/wav", "audio/mpeg", "audio/flac", "audio/ogg"}),
    "soundEffect": frozenset(
        {"audio/wav", "audio/mpeg", "audio/flac", "audio/ogg"}
    ),
    "editorImage": frozenset({"image/png", "image/jpeg", "image/webp"}),
    "editorVideo": frozenset({"video/mp4", "video/webm", "video/quicktime"}),
    "editorAudio": frozenset(
        {"audio/wav", "audio/mpeg", "audio/flac", "audio/ogg"}
    ),
}

PRIVACY_CLASSES = frozenset({"public", "project_local", "sensitive", "restricted"})
RIGHTS_STATUSES = frozenset({"owned", "licensed", "publicDomain", "unknown"})
PERMISSIONS = frozenset({"allowed", "notAllowed", "unknown"})
CONSENT_AUTHORITIES = frozenset(
    {"selfConsent", "parentOrGuardian", "authorizedRepresentative"}
)
CONSENT_GRANTS = frozenset(
    {
        "portraitAnimation",
        "videoReenactment",
        "publicDistribution",
        "commercialDistribution",
    }
)
CONSENT_DISTRIBUTION_SCOPES = frozenset(
    {"privatePreview", "publicNonCommercial", "publicCommercial"}
)
_DISTRIBUTION_SCOPE_RANK = {
    "privatePreview": 0,
    "publicNonCommercial": 1,
    "publicCommercial": 2,
}
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class ParsedRights:
    status: str
    creator: str | None
    license: str | None
    attribution: str | None
    commercial_use: str
    redistribution: str
    model_input: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "creator": self.creator,
            "license": self.license,
            "attribution": self.attribution,
            "commercialUse": self.commercial_use,
            "redistribution": self.redistribution,
            "modelInput": self.model_input,
        }

    def export_blockers(self) -> tuple[str, ...]:
        blockers: list[str] = []
        if self.status == "unknown":
            blockers.append("Rights status has not been established")
        if self.status == "licensed" and not self.license:
            blockers.append("Licensed media requires a license identifier or terms reference")
        if self.status == "licensed" and not self.attribution:
            blockers.append("Licensed media requires attribution metadata")
        if self.commercial_use != "allowed":
            blockers.append("Commercial-use permission is not explicitly allowed")
        if self.redistribution != "allowed":
            blockers.append("Redistribution permission is not explicitly allowed")
        return tuple(blockers)

    def model_input_blockers(self) -> tuple[str, ...]:
        if self.model_input != "allowed":
            return ("Model-input permission is not explicitly allowed",)
        return ()


def import_project_asset(store: ProjectStore, params: dict[str, Any]) -> dict[str, Any]:
    """Validate, promote, and revision-link one typed user-owned media asset."""

    _exact_keys(
        params,
        required={
            "projectId",
            "projectDirectory",
            "expectedHeadRevisionId",
            "kind",
            "filename",
            "mimeType",
            "privacy",
            "rights",
            "contentBase64",
        },
        optional={"presenter"},
        label="asset import",
    )
    kind = _enum_string(params, "kind", frozenset(ASSET_LIMITS))
    filename = _bounded_string(params, "filename", 240)
    declared_mime = _bounded_string(params, "mimeType", 127).lower()
    privacy = _enum_string(params, "privacy", PRIVACY_CLASSES)
    expected_head = _bounded_string(params, "expectedHeadRevisionId", 128)
    rights = _parse_rights(_object(params, "rights"))
    presenter = _parse_presenter(params.get("presenter"), kind=kind, rights=rights)
    content = _decode_content(params, ASSET_LIMITS[kind])
    validated = validate_file(
        filename,
        content,
        declared_mime=declared_mime,
        limits=ImportLimits(
            max_files=1,
            max_file_bytes=ASSET_LIMITS[kind],
            max_total_bytes=ASSET_LIMITS[kind],
        ),
    )
    if validated.detected_mime not in ASSET_MIME_TYPES[kind]:
        raise ValueError(
            f"{kind} does not accept detected MIME {validated.detected_mime}"
        )

    font_inspection = (
        inspect_font(content, media_type=validated.detected_mime)
        if kind == "font"
        else None
    )

    head = store.head_revision()
    if head is None:
        raise ValueError("project has no durable snapshot")
    if head.revision_id != expected_head:
        from .project.errors import RevisionConflictError

        raise RevisionConflictError(
            f"Expected head {expected_head}, but current head is {head.revision_id}"
        )

    now = utc_now()
    artifact_id = f"asset_{uuid.uuid4().hex}"
    provenance_id = f"prov_{uuid.uuid4().hex}"
    asset_metadata = {
        "assetId": artifact_id,
        "kind": kind,
        "privacy": privacy,
        "provenanceId": provenance_id,
        "origin": "userImport",
        "quarantineValidated": True,
    }
    if font_inspection is not None:
        asset_metadata["fontMetadata"] = font_inspection.metadata
    quarantine = store.root / "staging" / "asset-import" / f"{uuid.uuid4().hex}.upload"
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
            metadata=asset_metadata,
            max_bytes=ASSET_LIMITS[kind],
        )
    finally:
        quarantine.unlink(missing_ok=True)

    blockers = list(rights.export_blockers())
    model_input_blockers = list(rights.model_input_blockers())
    if font_inspection is not None:
        blockers.extend(font_inspection.export_blockers)
    export_eligible = not blockers
    asset_record = {
        "id": artifact_id,
        "kind": kind,
        "artifactHash": artifact.hash,
        "filename": validated.filename,
        "mediaType": validated.detected_mime,
        "byteSize": artifact.byte_size,
        "privacy": privacy,
        "state": "promoted",
        "provenanceId": provenance_id,
        "createdAt": now,
    }
    if font_inspection is not None:
        asset_record["fontMetadata"] = font_inspection.metadata
    provenance_record = {
        "id": provenance_id,
        "assetId": artifact_id,
        "origin": "userImport",
        "contentHash": artifact.hash,
        "createdAt": now,
        "rights": rights.to_dict(),
        "exportEligible": export_eligible,
        "blockers": blockers,
        "modelInputEligible": not model_input_blockers,
        "modelInputBlockers": model_input_blockers,
        "c2paStatus": "absent",
    }
    if font_inspection is not None:
        provenance_record["fontEmbedding"] = font_inspection.metadata["embedding"]

    consent_record: dict[str, Any] | None = None
    consent_proof = None
    profile_record: dict[str, Any] | None = None
    selected_profile_id: str | None = None
    if presenter is not None:
        consent_record, consent_proof = _create_consent_proof(
            store,
            presenter,
            project_id=store.manifest.project_id,
            portrait_artifact_id=artifact_id,
            portrait_hash=artifact.hash,
            captured_at=now,
        )
        profile_id = f"presenter_{uuid.uuid4().hex}"
        profile_record = {
            "profileId": profile_id,
            "displayName": presenter["displayName"],
            "portraitArtifactId": artifact_id,
            "portraitArtifactHash": artifact.hash,
            "identityType": presenter["identityType"],
            "consentRecordId": None if consent_record is None else consent_record["id"],
            "disclosureRequired": True,
            "authorizedDistributionScope": (
                "publicCommercial"
                if consent_record is None
                else consent_record["distributionScope"]
            ),
            "createdAt": now,
        }
        if presenter["selectAfterImport"]:
            selected_profile_id = profile_id

    snapshot = copy.deepcopy(head.snapshot)
    snapshot["mediaAssets"] = [*_records(snapshot, "mediaAssets"), asset_record]
    snapshot["assetProvenance"] = [
        *_records(snapshot, "assetProvenance"),
        provenance_record,
    ]
    if consent_record is not None:
        snapshot["consentRecords"] = [
            *_records(snapshot, "consentRecords"),
            consent_record,
        ]
    if profile_record is not None:
        snapshot["presenterProfiles"] = [
            *_records(snapshot, "presenterProfiles"),
            profile_record,
        ]
        if selected_profile_id is not None:
            snapshot["selectedPresenterProfileId"] = selected_profile_id

    links = [
        {"artifactHash": artifact.hash, "role": f"asset-{kind}", "stableId": artifact_id}
    ]
    if consent_proof is not None and consent_record is not None:
        links.append(
            {
                "artifactHash": consent_proof.hash,
                "role": "consent-proof",
                "stableId": consent_record["id"],
            }
        )
    with transaction(store.connection):
        store.register_artifact(artifact)
        if consent_proof is not None:
            store.register_artifact(consent_proof)
        revision = store.create_revision(
            snapshot=snapshot,
            kind="import",
            message=f"Imported {kind} asset {validated.filename}",
            expected_head=head.revision_id,
            artifact_links=links,
        )
        ProjectHistory(store).record_new_revision(head.revision_id, revision)

    return {
        "projectId": store.manifest.project_id,
        "headRevisionId": revision.revision_id,
        "revisionNumber": revision.number,
        "artifact": {
            "id": artifact_id,
            "kind": kind,
            "sha256": artifact.hash,
            "byteSize": artifact.byte_size,
            "mediaType": validated.detected_mime,
            "originalFilename": validated.filename,
            "state": "promoted",
            "fontMetadata": None
            if font_inspection is None
            else font_inspection.metadata,
        },
        "provenance": {
            "id": provenance_id,
            "origin": "userImport",
            "rightsStatus": rights.status,
            "creator": rights.creator,
            "license": rights.license,
            "attribution": rights.attribution,
            "exportEligible": export_eligible,
            "blockers": blockers,
            "modelInputEligible": not model_input_blockers,
            "modelInputBlockers": model_input_blockers,
        },
        "presenterProfile": None
        if profile_record is None
        else _public_profile(profile_record),
        "selectedPresenterProfileId": selected_profile_id,
    }


def select_presenter_profile(store: ProjectStore, params: dict[str, Any]) -> dict[str, Any]:
    _exact_keys(
        params,
        required={
            "projectId",
            "projectDirectory",
            "expectedHeadRevisionId",
            "profileId",
        },
        optional=set(),
        label="presenter profile selection",
    )
    expected_head = _bounded_string(params, "expectedHeadRevisionId", 128)
    profile_id = _stable_id(params, "profileId")
    head = store.head_revision()
    if head is None:
        raise ValueError("project has no durable snapshot")
    if head.revision_id != expected_head:
        from .project.errors import RevisionConflictError

        raise RevisionConflictError(
            f"Expected head {expected_head}, but current head is {head.revision_id}"
        )
    profiles = _records(head.snapshot, "presenterProfiles")
    profile = next((value for value in profiles if value.get("profileId") == profile_id), None)
    if profile is None:
        raise ValueError("profileId does not identify a presenter profile in this project")
    _validate_stored_presenter_profile(store, head.snapshot, profile)

    snapshot = copy.deepcopy(head.snapshot)
    snapshot["selectedPresenterProfileId"] = profile_id
    revision = store.create_revision(
        snapshot=snapshot,
        kind="edit",
        message=f"Selected presenter profile {profile.get('displayName', profile_id)}",
        expected_head=head.revision_id,
    )
    ProjectHistory(store).record_new_revision(head.revision_id, revision)
    return {
        "projectId": store.manifest.project_id,
        "headRevisionId": revision.revision_id,
        "revisionNumber": revision.number,
        "selectedPresenterProfileId": profile_id,
        "profile": _public_profile(profile),
    }


def _parse_rights(value: dict[str, Any]) -> ParsedRights:
    _exact_keys(
        value,
        required={"status", "commercialUse", "redistribution", "modelInput"},
        optional={"creator", "license", "attribution"},
        label="rights",
    )
    return ParsedRights(
        _enum_string(value, "status", RIGHTS_STATUSES),
        _optional_bounded_string(value, "creator", 500),
        _optional_bounded_string(value, "license", 2_000),
        _optional_bounded_string(value, "attribution", 2_000),
        _enum_string(value, "commercialUse", PERMISSIONS),
        _enum_string(value, "redistribution", PERMISSIONS),
        _enum_string(value, "modelInput", PERMISSIONS),
    )


def _parse_presenter(
    raw: Any, *, kind: str, rights: ParsedRights
) -> dict[str, Any] | None:
    if kind != "presenterPortrait":
        if raw is not None:
            raise ValueError("presenter metadata is only valid for presenterPortrait")
        return None
    if not isinstance(raw, dict):
        raise ValueError("presenterPortrait requires presenter metadata")
    _exact_keys(
        raw,
        required={
            "identityType",
            "displayName",
            "syntheticOriginAttested",
            "selectAfterImport",
        },
        optional={"consent"},
        label="presenter",
    )
    identity = _enum_string(raw, "identityType", frozenset({"synthetic", "realPerson"}))
    if not isinstance(raw["syntheticOriginAttested"], bool):
        raise ValueError("presenter.syntheticOriginAttested must be a boolean")
    if not isinstance(raw["selectAfterImport"], bool):
        raise ValueError("presenter.selectAfterImport must be a boolean")
    if rights.model_input != "allowed":
        raise ValueError("presenter portraits must be explicitly cleared for model input")
    presenter = {
        "identityType": identity,
        "displayName": _bounded_string(raw, "displayName", 120),
        "syntheticOriginAttested": raw["syntheticOriginAttested"],
        "selectAfterImport": raw["selectAfterImport"],
        "consent": raw.get("consent"),
    }
    if identity == "synthetic":
        if not presenter["syntheticOriginAttested"]:
            raise ValueError("synthetic portraits require an explicit origin attestation")
        if presenter["consent"] is not None:
            raise ValueError("synthetic portraits cannot carry real-person consent")
        return presenter
    if presenter["syntheticOriginAttested"]:
        raise ValueError("real-person portraits cannot be attested as synthetic")
    presenter["consent"] = _parse_consent(presenter["consent"])
    return presenter


def _parse_consent(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("real-person portraits require consent metadata")
    _exact_keys(
        raw,
        required={
            "subjectDisplayName",
            "attestorDisplayName",
            "authority",
            "grants",
            "distributionScope",
            "accepted",
            "disclosureRequired",
        },
        optional=set(),
        label="presenter.consent",
    )
    if raw.get("accepted") is not True:
        raise ValueError("presenter consent must be explicitly accepted")
    if raw.get("disclosureRequired") is not True:
        raise ValueError("real-person animation requires synthetic-media disclosure")
    grants = raw.get("grants")
    if (
        not isinstance(grants, list)
        or not grants
        or not all(isinstance(value, str) and value in CONSENT_GRANTS for value in grants)
        or len(set(grants)) != len(grants)
    ):
        raise ValueError("presenter consent grants are invalid or duplicated")
    if "portraitAnimation" not in grants:
        raise ValueError("portraitAnimation consent is required")
    distribution_scope = _enum_string(
        raw, "distributionScope", CONSENT_DISTRIBUTION_SCOPES
    )
    if distribution_scope in {"publicNonCommercial", "publicCommercial"} and (
        "publicDistribution" not in grants
    ):
        raise ValueError(
            "publicDistribution consent is required for public presenter output"
        )
    if distribution_scope == "publicCommercial" and (
        "commercialDistribution" not in grants
    ):
        raise ValueError(
            "commercialDistribution consent is required for commercial presenter output"
        )
    if "commercialDistribution" in grants and "publicDistribution" not in grants:
        raise ValueError(
            "commercialDistribution consent also requires publicDistribution consent"
        )
    parsed: dict[str, Any] = {
        "subjectDisplayName": _bounded_string(raw, "subjectDisplayName", 160),
        "attestorDisplayName": _bounded_string(raw, "attestorDisplayName", 160),
        "authority": _enum_string(raw, "authority", CONSENT_AUTHORITIES),
        "grants": grants,
        "distributionScope": distribution_scope,
        "accepted": True,
        "disclosureRequired": True,
    }
    if (
        parsed["authority"] == "selfConsent"
        and parsed["subjectDisplayName"].casefold()
        != parsed["attestorDisplayName"].casefold()
    ):
        raise ValueError(
            "selfConsent requires the subject and attestor to be the same person"
        )
    return parsed


def _create_consent_proof(
    store: ProjectStore,
    presenter: dict[str, Any],
    *,
    project_id: str,
    portrait_artifact_id: str,
    portrait_hash: str,
    captured_at: str,
) -> tuple[dict[str, Any] | None, Any | None]:
    if presenter["identityType"] != "realPerson":
        return None, None
    consent = presenter["consent"]
    consent_id = f"consent_{uuid.uuid4().hex}"
    subject_id = f"subject_{uuid.uuid4().hex}"
    proof_id = f"consentproof_{uuid.uuid4().hex}"
    proof = {
        "schemaVersion": 1,
        "id": consent_id,
        "projectId": project_id,
        "subjectId": subject_id,
        "subjectDisplayName": consent["subjectDisplayName"],
        "attestorDisplayName": consent["attestorDisplayName"],
        "authority": consent["authority"],
        "grants": consent["grants"],
        "distributionScope": consent["distributionScope"],
        "portraitArtifactId": portrait_artifact_id,
        "portraitArtifactHash": portrait_hash,
        "capturedAt": captured_at,
        "syntheticMediaDisclosureRequired": True,
        "statement": (
            "The attestor confirms authority to grant the listed uses for this portrait "
            "and accepts synthetic-media disclosure."
        ),
    }
    encoded = (json.dumps(proof, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode(
        "utf-8"
    )
    artifact = store.cas.add_bytes(
        encoded,
        media_type="application/json",
        original_name=f"{consent_id}.json",
        metadata={"artifactId": proof_id, "kind": "consentProof", "consentId": consent_id},
    )
    record = {
        "id": consent_id,
        "subjectId": subject_id,
        "subjectDisplayName": consent["subjectDisplayName"],
        "attestorDisplayName": consent["attestorDisplayName"],
        "capturedAt": captured_at,
        "proofArtifactId": proof_id,
        "proofArtifactHash": artifact.hash,
        "grants": consent["grants"],
        "distributionScope": consent["distributionScope"],
        "projectId": project_id,
        "authority": consent["authority"],
        "revokedAt": None,
        "syntheticMediaDisclosureRequired": True,
    }
    return record, artifact


def _validate_stored_presenter_profile(
    store: ProjectStore,
    snapshot: dict[str, Any],
    profile: dict[str, Any],
    *,
    required_distribution_scope: str | None = None,
) -> None:
    portrait_id = profile.get("portraitArtifactId")
    asset = next(
        (
            value
            for value in _records(snapshot, "mediaAssets")
            if value.get("id") == portrait_id
        ),
        None,
    )
    if asset is None or asset.get("kind") != "presenterPortrait":
        raise ValueError("presenter profile references a missing or invalid portrait asset")
    if profile.get("portraitArtifactHash") != asset.get("artifactHash"):
        raise ValueError("presenter profile portrait hash does not match the asset ledger")
    provenance_id = asset.get("provenanceId")
    provenance = next(
        (
            value
            for value in _records(snapshot, "assetProvenance")
            if value.get("id") == provenance_id
        ),
        None,
    )
    if provenance is None:
        raise ValueError("presenter portrait provenance is missing")
    rights = provenance.get("rights")
    if not isinstance(rights, dict) or rights.get("modelInput") != "allowed":
        raise ValueError("presenter portrait is not cleared for model input")
    if provenance.get("exportEligible") is not True or provenance.get("blockers") not in (
        None,
        [],
    ):
        raise ValueError("presenter portrait rights are not cleared for export")
    if profile.get("disclosureRequired") is not True:
        raise ValueError("presenter profile is missing synthetic-media disclosure")
    identity = profile.get("identityType")
    if identity == "synthetic":
        if profile.get("consentRecordId") is not None:
            raise ValueError("synthetic presenter profile has an invalid consent reference")
        return
    if identity != "realPerson":
        raise ValueError("presenter profile identity type is invalid")
    consent_id = profile.get("consentRecordId")
    consent = next(
        (
            value
            for value in _records(snapshot, "consentRecords")
            if value.get("id") == consent_id
        ),
        None,
    )
    if (
        consent is None
        or consent.get("revokedAt") is not None
        or "portraitAnimation" not in consent.get("grants", [])
        or not consent.get("proofArtifactHash")
        or consent.get("syntheticMediaDisclosureRequired") is not True
    ):
        raise ValueError("real-person presenter consent is missing, revoked, or insufficient")
    authorized_scope = consent.get("distributionScope")
    if authorized_scope not in CONSENT_DISTRIBUTION_SCOPES:
        raise ValueError("real-person presenter consent has no valid distribution scope")
    if profile.get("authorizedDistributionScope") != authorized_scope:
        raise ValueError("presenter profile distribution scope does not match consent")
    if required_distribution_scope is not None:
        if required_distribution_scope not in CONSENT_DISTRIBUTION_SCOPES:
            raise ValueError("requested presenter distribution scope is unsupported")
        if _DISTRIBUTION_SCOPE_RANK[str(authorized_scope)] < _DISTRIBUTION_SCOPE_RANK[
            required_distribution_scope
        ]:
            raise ValueError(
                "real-person presenter consent does not authorize the requested distribution scope"
            )
        grants = consent.get("grants", [])
        if required_distribution_scope in {"publicNonCommercial", "publicCommercial"} and (
            "publicDistribution" not in grants
        ):
            raise ValueError("real-person presenter consent does not authorize public distribution")
        if required_distribution_scope == "publicCommercial" and (
            "commercialDistribution" not in grants
        ):
            raise ValueError(
                "real-person presenter consent does not authorize commercial distribution"
            )
    _verify_immutable_consent_proof(store, profile, asset, consent)


def validate_selected_presenter_for_export(
    store: ProjectStore,
    snapshot: dict[str, Any],
    *,
    distribution_scope: str,
) -> dict[str, Any] | None:
    """Fail closed before exporting a selected real-person presenter.

    The returned policy contains only stable IDs and hashes and can be copied
    into a durable generation request. Synthetic presenters are still checked
    for provenance and model-input rights, but do not require human consent.
    """

    if distribution_scope not in CONSENT_DISTRIBUTION_SCOPES:
        raise ValueError("requested presenter distribution scope is unsupported")
    profiles = _records(snapshot, "presenterProfiles")
    profile: dict[str, Any] | None
    selected = snapshot.get("selectedPresenterProfileId")
    chosen_asset_id: str | None = None
    customization = snapshot.get("customization")
    if isinstance(customization, dict):
        presenter_customization = customization.get("presenter")
        if isinstance(presenter_customization, dict):
            if presenter_customization.get("placement") == "off":
                return None
            configured_asset = presenter_customization.get("assetId")
            if configured_asset is not None:
                if not isinstance(configured_asset, str):
                    raise ValueError("selected presenter portrait asset ID is invalid")
                chosen_asset_id = configured_asset
    if chosen_asset_id is not None:
        matches = [
            value for value in profiles if value.get("portraitArtifactId") == chosen_asset_id
        ]
        if not matches and chosen_asset_id.startswith(
            (
                "presenter-portrait.",
                "presenter-academic-",
                "presenter-modern-",
                "presenter-documentary-",
                "presenter-playful-",
            )
        ):
            # Bundled presenter portraits are synthetic and catalog-verified by
            # the visual customization resolver before rendering. There is no
            # human identity or consent record to gate here.
            return {
                "profileId": chosen_asset_id,
                "identityType": "synthetic",
                "portraitArtifactId": chosen_asset_id,
                "portraitArtifactHash": None,
                "consentRecordId": None,
                "authorizedDistributionScope": "publicCommercial",
                "requiredDistributionScope": distribution_scope,
                "disclosureRequired": True,
            }
        if len(matches) != 1:
            raise ValueError("selected presenter portrait has no unique presenter profile")
        profile = matches[0]
    else:
        if selected is None:
            return None
        if not isinstance(selected, str):
            raise ValueError("selected presenter profile ID is invalid")
        profile = next(
            (value for value in profiles if value.get("profileId") == selected),
            None,
        )
    if profile is None:
        raise ValueError("selected presenter profile is missing")
    _validate_stored_presenter_profile(
        store,
        snapshot,
        profile,
        required_distribution_scope=distribution_scope,
    )
    return {
        "profileId": profile["profileId"],
        "identityType": profile["identityType"],
        "portraitArtifactId": profile["portraitArtifactId"],
        "portraitArtifactHash": profile["portraitArtifactHash"],
        "consentRecordId": profile.get("consentRecordId"),
        "authorizedDistributionScope": profile.get("authorizedDistributionScope"),
        "requiredDistributionScope": distribution_scope,
        "disclosureRequired": True,
    }


def validate_approved_presenter_for_export(
    store: ProjectStore,
    approval_revision_id: str,
    *,
    distribution_scope: str,
) -> dict[str, Any] | None:
    """Validate the project snapshot that an approval revision froze.

    Generation-stage revisions intentionally contain stage payloads rather than
    mutable editor state. The approval revision's parent is the exact project
    head the user reviewed, so an export must gate that snapshot instead of a
    later workflow head or whatever happens to be current in the editor.
    """

    try:
        approval = store.get_revision(approval_revision_id)
    except KeyError as error:
        raise ValueError("presenter export approval revision is missing") from error
    if approval.kind != "approval" or approval.parent_revision_id is None:
        raise ValueError("presenter export requires a durable approval revision")
    generation_id = approval.snapshot.get("generationId")
    cursor_id: str | None = approval.parent_revision_id
    approved_project = None
    while cursor_id is not None:
        try:
            candidate = store.get_revision(cursor_id)
        except KeyError as error:
            raise ValueError("approved presenter project revision is missing") from error
        # Pre-approval workflow stages are immutable child revisions layered on
        # the editor snapshot. Walk over only stages belonging to this exact
        # generation, then gate the first non-workflow ancestor the user began
        # generation from. This avoids both mutable current-head state and an
        # older, unrelated presenter selection.
        if (
            isinstance(generation_id, str)
            and candidate.snapshot.get("generationId") == generation_id
            and isinstance(candidate.snapshot.get("stage"), str)
        ):
            cursor_id = candidate.parent_revision_id
            continue
        approved_project = candidate
        break
    if approved_project is None:
        raise ValueError("approved presenter project revision is missing")
    return validate_selected_presenter_for_export(
        store,
        approved_project.snapshot,
        distribution_scope=distribution_scope,
    )


def _verify_immutable_consent_proof(
    store: ProjectStore,
    profile: dict[str, Any],
    asset: dict[str, Any],
    consent: dict[str, Any],
) -> None:
    proof_hash = consent.get("proofArtifactHash")
    if not isinstance(proof_hash, str) or not _SHA256.fullmatch(proof_hash):
        raise ValueError("real-person presenter consent proof hash is invalid")
    if not store.cas.verify(proof_hash):
        raise ValueError("real-person presenter consent proof is missing or corrupt")
    row = store.connection.execute(
        "SELECT media_type, metadata_json FROM artifacts WHERE hash = ?", (proof_hash,)
    ).fetchone()
    if row is None or row["media_type"] != "application/json":
        raise ValueError("real-person presenter consent proof is not registered")
    try:
        metadata = json.loads(str(row["metadata_json"]))
        proof_bytes = store.cas.object_path(proof_hash).read_bytes()
        if len(proof_bytes) > 64 * 1024:
            raise ValueError("consent proof exceeds the immutable proof limit")
        if hashlib.sha256(proof_bytes).hexdigest() != proof_hash:
            raise ValueError("consent proof changed during verification")
        proof = json.loads(proof_bytes.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError) as error:
        raise ValueError("real-person presenter consent proof is unreadable") from error
    if (
        not isinstance(metadata, dict)
        or metadata.get("kind") != "consentProof"
        or metadata.get("artifactId") != consent.get("proofArtifactId")
    ):
        raise ValueError("real-person presenter consent proof metadata is invalid")
    if metadata.get("consentId") != consent.get("id"):
        raise ValueError("real-person presenter consent proof metadata does not match")
    expected = {
        "id": consent.get("id"),
        "projectId": store.manifest.project_id,
        "subjectId": consent.get("subjectId"),
        "subjectDisplayName": consent.get("subjectDisplayName"),
        "attestorDisplayName": consent.get("attestorDisplayName"),
        "authority": consent.get("authority"),
        "grants": consent.get("grants"),
        "distributionScope": consent.get("distributionScope"),
        "portraitArtifactId": asset.get("id"),
        "portraitArtifactHash": asset.get("artifactHash"),
        "syntheticMediaDisclosureRequired": True,
    }
    if not isinstance(proof, dict) or any(proof.get(key) != value for key, value in expected.items()):
        raise ValueError("real-person presenter consent proof does not match the profile")
    link = store.connection.execute(
        "SELECT 1 FROM revision_artifacts WHERE artifact_hash = ? AND role = 'consent-proof' LIMIT 1",
        (proof_hash,),
    ).fetchone()
    if link is None:
        raise ValueError("real-person presenter consent proof is not revision-linked")


def _public_profile(profile: dict[str, Any]) -> dict[str, Any]:
    return {
        "profileId": profile["profileId"],
        "displayName": profile["displayName"],
        "portraitArtifactId": profile["portraitArtifactId"],
        "identityType": profile["identityType"],
        "consentRecordId": profile.get("consentRecordId"),
        "disclosureRequired": bool(profile.get("disclosureRequired", True)),
        "authorizedDistributionScope": profile.get("authorizedDistributionScope"),
    }


def _decode_content(params: dict[str, Any], limit: int) -> bytes:
    encoded = _bounded_string(params, "contentBase64", MAX_ASSET_BASE64_CHARS)
    if len(encoded) > ((limit + 2) // 3) * 4:
        raise ValueError(f"contentBase64 exceeds the {limit // 1024 // 1024} MiB asset limit")
    try:
        content = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("contentBase64 must be canonical base64") from error
    if len(content) > limit:
        raise ValueError(f"decoded asset exceeds the {limit // 1024 // 1024} MiB limit")
    return content


def _records(snapshot: dict[str, Any], key: str) -> list[dict[str, Any]]:
    value = snapshot.get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _object(value: dict[str, Any], key: str) -> dict[str, Any]:
    item = value.get(key)
    if not isinstance(item, dict):
        raise ValueError(f"{key} must be an object")
    return item


def _bounded_string(value: dict[str, Any], key: str, maximum: int) -> str:
    item = value.get(key)
    if (
        not isinstance(item, str)
        or not item.strip()
        or len(item) > maximum
        or "\x00" in item
    ):
        raise ValueError(f"{key} must be a non-empty string of at most {maximum} characters")
    return item


def _optional_bounded_string(
    value: dict[str, Any], key: str, maximum: int
) -> str | None:
    item = value.get(key)
    if item is None:
        return None
    return _bounded_string(value, key, maximum)


def _enum_string(value: dict[str, Any], key: str, options: frozenset[str]) -> str:
    item = value.get(key)
    if not isinstance(item, str) or item not in options:
        raise ValueError(f"{key} must be one of {', '.join(sorted(options))}")
    return item


def _stable_id(value: dict[str, Any], key: str) -> str:
    item = _bounded_string(value, key, 128)
    if not all(character.isalnum() or character in "-_.:" for character in item):
        raise ValueError(f"{key} must be a stable identifier")
    return item


def _exact_keys(
    value: dict[str, Any],
    *,
    required: set[str],
    optional: set[str],
    label: str,
) -> None:
    missing = required.difference(value)
    extras = set(value).difference(required | optional)
    if missing:
        raise ValueError(f"{label} is missing {', '.join(sorted(missing))}")
    if extras:
        raise ValueError(f"{label} contains unsupported fields: {', '.join(sorted(extras))}")
