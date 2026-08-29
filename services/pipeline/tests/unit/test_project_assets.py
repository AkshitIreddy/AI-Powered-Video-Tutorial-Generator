from __future__ import annotations

import base64
import sqlite3
import struct
import uuid
from pathlib import Path
from typing import Any

import pytest

from alystria.desktop_worker import ALLOWED_METHODS
from alystria.project import ProjectStore
from alystria.project_assets import (
    validate_approved_presenter_for_export,
    validate_selected_presenter_for_export,
)
from alystria.service import PipelineService

PNG = b"\x89PNG\r\n\x1a\n" + b"safe-synthetic-image"


def _valid_test_font() -> bytes:
    family = "Alystria Test".encode("utf-16-be")
    name = struct.pack(">HHH", 0, 1, 18) + struct.pack(
        ">HHHHHH", 3, 1, 0x0409, 1, len(family), 0
    ) + family
    os2 = bytearray(64)
    struct.pack_into(">HHHH", os2, 0, 4, 0, 400, 5)
    post = bytearray(32)
    struct.pack_into(">I", post, 0, 0x00030000)
    tables = {b"OS/2": bytes(os2), b"name": name, b"post": bytes(post)}
    header_size = 12 + len(tables) * 16
    records = bytearray()
    payload = bytearray()
    offset = header_size
    for tag, table in sorted(tables.items()):
        records.extend(tag + struct.pack(">III", 0, offset, len(table)))
        payload.extend(table)
        padding = (-len(table)) % 4
        payload.extend(b"\x00" * padding)
        offset += len(table) + padding
    return b"\x00\x01\x00\x00" + struct.pack(">HHHH", len(tables), 0, 0, 0) + records + payload


def test_desktop_worker_exposes_only_typed_asset_operations() -> None:
    assert "asset.import" in ALLOWED_METHODS
    assert "presenter.profile.select" in ALLOWED_METHODS
    assert "filesystem.read" not in ALLOWED_METHODS


def _project(tmp_path: Path) -> tuple[Path, str, str]:
    root = tmp_path / "Asset Project"
    project_id = str(uuid.uuid4())
    with ProjectStore.create(
        root,
        name="Asset project",
        project_id=project_id,
        initial_snapshot={"id": project_id, "title": "Asset project"},
    ) as store:
        head = store.head_revision()
        assert head is not None
        return root, project_id, head.revision_id


def _rights(**overrides: Any) -> dict[str, Any]:
    value: dict[str, Any] = {
        "status": "owned",
        "creator": "Project owner",
        "license": "User-owned media",
        "attribution": None,
        "commercialUse": "allowed",
        "redistribution": "allowed",
        "modelInput": "allowed",
    }
    value.update(overrides)
    return value


def _import(
    service: PipelineService,
    root: Path,
    project_id: str,
    head: str,
    *,
    kind: str = "presenterPortrait",
    filename: str = "presenter.png",
    mime_type: str = "image/png",
    content: bytes = PNG,
    presenter: dict[str, Any] | None = None,
    rights: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return service.asset_import(
        {
            "projectId": project_id,
            "projectDirectory": str(root),
            "expectedHeadRevisionId": head,
            "kind": kind,
            "filename": filename,
            "mimeType": mime_type,
            "privacy": "project_local",
            "rights": rights or _rights(),
            "presenter": presenter,
            "contentBase64": base64.b64encode(content).decode("ascii"),
        }
    )


def test_synthetic_presenter_import_is_cas_backed_and_selected_without_paths(
    tmp_path: Path,
) -> None:
    root, project_id, head = _project(tmp_path)
    receipt = _import(
        PipelineService(),
        root,
        project_id,
        head,
        presenter={
            "identityType": "synthetic",
            "displayName": "Indigo instructor",
            "syntheticOriginAttested": True,
            "consent": None,
            "selectAfterImport": True,
        },
    )

    assert receipt["artifact"]["kind"] == "presenterPortrait"
    assert receipt["artifact"]["state"] == "promoted"
    assert "path" not in receipt["artifact"]
    assert receipt["presenterProfile"]["identityType"] == "synthetic"
    assert receipt["presenterProfile"]["consentRecordId"] is None
    assert receipt["selectedPresenterProfileId"] == receipt["presenterProfile"]["profileId"]
    digest = receipt["artifact"]["sha256"]
    assert (root / "objects" / "sha256" / digest[:2] / digest[2:]).read_bytes() == PNG
    assert not list((root / "staging" / "asset-import").iterdir())

    with ProjectStore.open(root) as store:
        snapshot = store.head_revision().snapshot  # type: ignore[union-attr]
        assert snapshot["selectedPresenterProfileId"] == receipt["selectedPresenterProfileId"]
        assert snapshot["assetProvenance"][0]["contentHash"] == digest


def test_real_person_requires_consent_and_writes_immutable_proof(tmp_path: Path) -> None:
    root, project_id, head = _project(tmp_path)
    service = PipelineService()
    with pytest.raises(ValueError, match="require consent"):
        _import(
            service,
            root,
            project_id,
            head,
            presenter={
                "identityType": "realPerson",
                "displayName": "Project owner",
                "syntheticOriginAttested": False,
                "consent": None,
                "selectAfterImport": False,
            },
        )

    receipt = _import(
        service,
        root,
        project_id,
        head,
        presenter={
            "identityType": "realPerson",
            "displayName": "Project owner",
            "syntheticOriginAttested": False,
            "selectAfterImport": False,
            "consent": {
                "subjectDisplayName": "Project owner",
                "attestorDisplayName": "Project owner",
                "authority": "selfConsent",
                "grants": ["portraitAnimation", "publicDistribution"],
                "distributionScope": "publicNonCommercial",
                "accepted": True,
                "disclosureRequired": True,
            },
        },
    )
    consent_id = receipt["presenterProfile"]["consentRecordId"]
    assert consent_id.startswith("consent_")
    assert receipt["selectedPresenterProfileId"] is None

    with ProjectStore.open(root) as store:
        snapshot = store.head_revision().snapshot  # type: ignore[union-attr]
        consent = snapshot["consentRecords"][0]
        assert consent["id"] == consent_id
        assert consent["grants"] == ["portraitAnimation", "publicDistribution"]
        assert consent["syntheticMediaDisclosureRequired"] is True
        assert store.cas.verify(consent["proofArtifactHash"])
        roles = store.connection.execute(
            "SELECT role FROM revision_artifacts WHERE revision_id=? ORDER BY role",
            (receipt["headRevisionId"],),
        ).fetchall()
        assert [row[0] for row in roles] == ["asset-presenterPortrait", "consent-proof"]


def test_selection_revalidates_real_person_consent_and_revision_head(tmp_path: Path) -> None:
    root, project_id, head = _project(tmp_path)
    service = PipelineService()
    imported = _import(
        service,
        root,
        project_id,
        head,
        presenter={
            "identityType": "realPerson",
            "displayName": "Authorized instructor",
            "syntheticOriginAttested": False,
            "selectAfterImport": False,
            "consent": {
                "subjectDisplayName": "Authorized instructor",
                "attestorDisplayName": "Authorized instructor",
                "authority": "selfConsent",
                "grants": ["portraitAnimation"],
                "distributionScope": "privatePreview",
                "accepted": True,
                "disclosureRequired": True,
            },
        },
    )
    profile_id = imported["presenterProfile"]["profileId"]
    selected = service.presenter_profile_select(
        {
            "projectId": project_id,
            "projectDirectory": str(root),
            "expectedHeadRevisionId": imported["headRevisionId"],
            "profileId": profile_id,
        }
    )
    assert selected["selectedPresenterProfileId"] == profile_id
    assert selected["profile"]["portraitArtifactId"] == imported["artifact"]["id"]

    with pytest.raises(Exception, match="Expected head"):
        service.presenter_profile_select(
            {
                "projectId": project_id,
                "projectDirectory": str(root),
                "expectedHeadRevisionId": imported["headRevisionId"],
                "profileId": profile_id,
            }
        )


@pytest.mark.parametrize(
    ("kind", "filename", "mime_type", "content"),
    [
        ("font", "studio.ttf", "font/ttf", _valid_test_font()),
        ("music", "bed.mp3", "audio/mpeg", b"ID3" + b"music-data"),
        ("soundEffect", "click.opus", "audio/opus", b"OggS" + b"sfx-data"),
        ("presenterAudio", "voice.flac", "audio/flac", b"fLaC" + b"voice-data"),
        ("backgroundImage", "paper.webp", "image/webp", b"RIFF\x10\x00\x00\x00WEBPdata"),
    ],
)
def test_supported_custom_asset_families_import_with_typed_roles(
    tmp_path: Path,
    kind: str,
    filename: str,
    mime_type: str,
    content: bytes,
) -> None:
    root, project_id, head = _project(tmp_path)
    receipt = _import(
        PipelineService(),
        root,
        project_id,
        head,
        kind=kind,
        filename=filename,
        mime_type=mime_type,
        content=content,
        presenter=None,
    )
    assert receipt["artifact"]["kind"] == kind
    assert receipt["provenance"]["exportEligible"] is True
    if filename.endswith(".opus"):
        assert receipt["artifact"]["mediaType"] == "audio/ogg"
    if kind == "font":
        metadata = receipt["artifact"]["fontMetadata"]
        assert metadata["familyName"] == "Alystria Test"
        assert metadata["rendererBindingStatus"] == "not-bound"
        assert "path" not in metadata


def test_import_rejects_active_svg_and_unresolved_presenter_rights(tmp_path: Path) -> None:
    root, project_id, head = _project(tmp_path)
    with pytest.raises(ValueError, match="does not accept"):
        _import(
            PipelineService(),
            root,
            project_id,
            head,
            kind="backgroundImage",
            filename="active.svg",
            mime_type="image/svg+xml",
            content=b'<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        )

    with pytest.raises(ValueError, match="model input"):
        _import(
            PipelineService(),
            root,
            project_id,
            head,
            rights=_rights(modelInput="unknown"),
            presenter={
                "identityType": "synthetic",
                "displayName": "Synthetic instructor",
                "syntheticOriginAttested": True,
                "consent": None,
                "selectAfterImport": True,
            },
        )


def test_unknown_rights_are_importable_but_export_blocked(tmp_path: Path) -> None:
    root, project_id, head = _project(tmp_path)
    receipt = _import(
        PipelineService(),
        root,
        project_id,
        head,
        kind="backgroundImage",
        filename="paper.png",
        content=PNG,
        presenter=None,
        rights=_rights(
            status="unknown",
            redistribution="unknown",
            modelInput="unknown",
        ),
    )
    assert receipt["provenance"]["exportEligible"] is False
    assert len(receipt["provenance"]["blockers"]) == 3


@pytest.mark.parametrize(
    ("permission", "message"),
    [
        ("commercialUse", "Commercial-use permission"),
        ("redistribution", "Redistribution permission"),
        ("modelInput", "Model-input permission"),
    ],
)
def test_each_restricted_permission_fails_closed_for_export(
    tmp_path: Path, permission: str, message: str
) -> None:
    root, project_id, head = _project(tmp_path)
    receipt = _import(
        PipelineService(),
        root,
        project_id,
        head,
        kind="music",
        filename="bed.mp3",
        mime_type="audio/mpeg",
        content=b"ID3" + b"music-data",
        presenter=None,
        rights=_rights(**{permission: "notAllowed"}),
    )
    assert receipt["provenance"]["exportEligible"] is False
    assert any(message in blocker for blocker in receipt["provenance"]["blockers"])


def test_presenter_export_scope_and_immutable_proof_are_revalidated(
    tmp_path: Path,
) -> None:
    root, project_id, head = _project(tmp_path)
    imported = _import(
        PipelineService(),
        root,
        project_id,
        head,
        presenter={
            "identityType": "realPerson",
            "displayName": "Authorized instructor",
            "syntheticOriginAttested": False,
            "selectAfterImport": True,
            "consent": {
                "subjectDisplayName": "Authorized instructor",
                "attestorDisplayName": "Authorized instructor",
                "authority": "selfConsent",
                "grants": ["portraitAnimation", "publicDistribution"],
                "distributionScope": "publicNonCommercial",
                "accepted": True,
                "disclosureRequired": True,
            },
        },
    )
    with ProjectStore.open(root) as store:
        snapshot = store.head_revision().snapshot  # type: ignore[union-attr]
        snapshot["customization"] = {
            "presenter": {
                "assetId": imported["artifact"]["id"],
                "placement": "picture-in-picture",
            }
        }
        policy = validate_selected_presenter_for_export(
            store, snapshot, distribution_scope="publicNonCommercial"
        )
        assert policy is not None
        assert policy["consentRecordId"] == imported["presenterProfile"]["consentRecordId"]
        assert policy["disclosureRequired"] is True
        with pytest.raises(ValueError, match="distribution scope"):
            validate_selected_presenter_for_export(
                store, snapshot, distribution_scope="publicCommercial"
            )

        snapshot["customization"]["presenter"]["placement"] = "off"
        assert (
            validate_selected_presenter_for_export(
                store, snapshot, distribution_scope="publicCommercial"
            )
            is None
        )
        snapshot["customization"]["presenter"]["placement"] = "picture-in-picture"

        snapshot["consentRecords"][0]["proofArtifactHash"] = "0" * 64
        with pytest.raises(ValueError, match="proof is missing or corrupt"):
            validate_selected_presenter_for_export(
                store, snapshot, distribution_scope="publicNonCommercial"
            )


def test_commercial_presenter_scope_requires_both_distribution_grants(
    tmp_path: Path,
) -> None:
    root, project_id, head = _project(tmp_path)
    base = {
        "identityType": "realPerson",
        "displayName": "Authorized instructor",
        "syntheticOriginAttested": False,
        "selectAfterImport": True,
        "consent": {
            "subjectDisplayName": "Authorized instructor",
            "attestorDisplayName": "Authorized instructor",
            "authority": "selfConsent",
            "grants": ["portraitAnimation", "publicDistribution"],
            "distributionScope": "publicCommercial",
            "accepted": True,
            "disclosureRequired": True,
        },
    }
    with pytest.raises(ValueError, match="commercialDistribution"):
        _import(PipelineService(), root, project_id, head, presenter=base)

    base["consent"]["grants"].append("commercialDistribution")
    receipt = _import(PipelineService(), root, project_id, head, presenter=base)
    with ProjectStore.open(root) as store:
        snapshot = store.head_revision().snapshot  # type: ignore[union-attr]
        policy = validate_selected_presenter_for_export(
            store, snapshot, distribution_scope="publicCommercial"
        )
        stage_revision = store.create_revision(
            snapshot={
                "generationId": "generation.presenter-test",
                "stage": "storyboard",
                "payload": {"storyboard": {}},
            },
            kind="generation",
            message="Generated storyboard",
            expected_head=receipt["headRevisionId"],
        )
        approval = store.create_revision(
            snapshot={
                "generationId": "generation.presenter-test",
                "stage": "approval",
                "payload": {"approved": True},
            },
            kind="approval",
            message="Approved presenter export",
            expected_head=stage_revision.revision_id,
        )
        approved_policy = validate_approved_presenter_for_export(
            store,
            approval.revision_id,
            distribution_scope="publicCommercial",
        )
    assert policy is not None
    assert policy["profileId"] == receipt["presenterProfile"]["profileId"]
    assert approved_policy == policy


def test_database_contains_no_absolute_import_path(tmp_path: Path) -> None:
    root, project_id, head = _project(tmp_path)
    _import(
        PipelineService(),
        root,
        project_id,
        head,
        kind="music",
        filename="bed.mp3",
        mime_type="audio/mpeg",
        content=b"ID3" + b"music-data",
        presenter=None,
    )
    database = sqlite3.connect(root / "project.sqlite3")
    try:
        serialized = "\n".join(
            str(value)
            for row in database.execute(
                "SELECT snapshot_json FROM revisions UNION ALL SELECT metadata_json FROM artifacts"
            )
            for value in row
        )
    finally:
        database.close()
    assert str(root) not in serialized
