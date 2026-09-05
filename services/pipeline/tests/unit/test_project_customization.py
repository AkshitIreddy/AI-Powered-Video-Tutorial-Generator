from __future__ import annotations

import copy
import uuid
from pathlib import Path
from typing import Any

import pytest

from alystria.desktop_worker import ALLOWED_METHODS
from alystria.generation.coordinator import request_from_desktop
from alystria.project import ProjectStore
from alystria.project.errors import RevisionConflictError
from alystria.service import PipelineService


def _customization() -> dict[str, Any]:
    return {
        "fontPairId": "editorial",
        "displayFont": "Bricolage Grotesque",
        "bodyFont": "Atkinson Hyperlegible Next",
        "typeScale": 100,
        "lineHeight": "balanced",
        "fonts": {"displayAssetId": None, "bodyAssetId": None},
        "paletteId": "precision",
        "colors": {
            "paper": "#F7F8FC",
            "ink": "#151827",
            "accent": "#5658E8",
            "evidence": "#168F88",
        },
        "backgroundMode": "paper",
        "backgroundAssetId": None,
        "materialStrength": 28,
        "density": "balanced",
        "contrast": "standard",
        "reducedMotion": False,
        "sceneTreatment": "edge-to-edge",
        "cornerRadius": 14,
        "shadowStrength": 24,
        "captions": {
            "position": "auto",
            "style": "soft-panel",
            "size": 100,
            "safeInset": 8,
            "textColor": "#FFFFFF",
            "panelColor": "#151827",
            "maxLines": 2,
        },
        "presenter": {
            "assetId": None,
            "placement": "off",
            "side": "right",
            "scale": 72,
            "crop": "portrait",
            "frame": "soft",
        },
        "audio": {
            "musicAssetId": None,
            "sfxAssetId": None,
            "musicLevel": 12,
            "sfxLevel": 28,
            "narrationDucking": 72,
        },
        "assets": [],
    }


def test_presenter_idle_and_voice_pairing_are_validated_without_paths() -> None:
    customization = _customization()
    customization["presenter"].update(
        {
            "idleAnimation": True,
            "blink": True,
            "breathing": True,
            "restMouth": "closed",
            "voiceDirection": "Warm adult mathematics educator, clear medium pace",
            "preferredVoiceId": "Xb7hH8MSUJpSbSDYk0k2",
        }
    )
    from alystria.project_customization import validate_customization

    validated = validate_customization(customization)
    assert validated["presenter"]["idleAnimation"] is True
    assert validated["presenter"]["blink"] is True
    assert validated["presenter"]["breathing"] is True
    assert validated["presenter"]["restMouth"] == "closed"
    assert validated["presenter"]["preferredVoiceId"] == "Xb7hH8MSUJpSbSDYk0k2"


def _project(tmp_path: Path) -> tuple[Path, str, str]:
    root = tmp_path / "Customization Project"
    project_id = str(uuid.uuid4())
    with ProjectStore.create(
        root,
        name="Customization project",
        project_id=project_id,
        initial_snapshot={
            "id": project_id,
            "title": "Customization project",
            "topic": "Binary search",
            "audience": "Beginners",
            "scenes": [],
            "sources": [],
            "mediaAssets": [],
            "assetProvenance": [],
        },
    ) as store:
        head = store.head_revision()
        assert head is not None
        return root, project_id, head.revision_id


def _save(
    service: PipelineService,
    root: Path,
    project_id: str,
    head: str,
    customization: dict[str, Any],
) -> dict[str, Any]:
    return service.project_customization_save(
        {
            "projectId": project_id,
            "projectDirectory": str(root),
            "expectedHeadRevisionId": head,
            "customization": customization,
        }
    )


def test_worker_exposes_narrow_customization_operation() -> None:
    assert "project.customization.save" in ALLOWED_METHODS
    assert "filesystem.write" not in ALLOWED_METHODS


def test_customization_save_merges_only_the_visual_bible_and_creates_revision(
    tmp_path: Path,
) -> None:
    root, project_id, head = _project(tmp_path)
    customization = _customization()
    customization["typeScale"] = 112
    receipt = _save(PipelineService(), root, project_id, head, customization)

    assert receipt["headRevisionId"] != head
    assert receipt["revisionNumber"] == 2
    assert receipt["customization"]["typeScale"] == 112
    with ProjectStore.open(root) as store:
        durable = store.head_revision()
        assert durable is not None
        assert durable.snapshot["topic"] == "Binary search"
        assert durable.snapshot["mediaAssets"] == []
        assert durable.snapshot["customization"] == receipt["customization"]


def test_customization_save_rejects_stale_head_without_overwrite(tmp_path: Path) -> None:
    root, project_id, head = _project(tmp_path)
    service = PipelineService()
    first = _save(service, root, project_id, head, _customization())
    changed = _customization()
    changed["typeScale"] = 125

    with pytest.raises(RevisionConflictError, match="Expected head"):
        _save(service, root, project_id, head, changed)
    with ProjectStore.open(root) as store:
        durable = store.head_revision()
        assert durable is not None
        assert durable.revision_id == first["headRevisionId"]
        assert durable.snapshot["customization"]["typeScale"] == 100


@pytest.mark.parametrize(
    ("mutate", "match"),
    [
        (lambda value: value.update({"displayFont": "file:///C:/secret.ttf"}), "font family"),
        (lambda value: value.update({"command": "run me"}), "unsupported fields"),
        (
            lambda value: value["audio"].update({"musicAssetId": "missing"}),
            "reference customization.assets",
        ),
    ],
)
def test_customization_rejects_paths_code_and_unbound_selections(
    tmp_path: Path, mutate: Any, match: str
) -> None:
    root, project_id, head = _project(tmp_path)
    value = _customization()
    mutate(value)
    with pytest.raises(ValueError, match=match):
        _save(PipelineService(), root, project_id, head, value)


@pytest.mark.parametrize("source", ["user-upload", "generated", "licensed-media"])
def test_durable_asset_reference_must_match_durable_ledger(
    tmp_path: Path, source: str
) -> None:
    root, project_id, head = _project(tmp_path)
    value = _customization()
    asset = {
            "id": "asset_forged",
            "kind": "background",
            "label": "Forged",
            "source": source,
            "filename": "background.png",
            "mediaType": "image/png",
            "byteSize": 10,
            "sha256": "0" * 64,
            "creator": "Project owner",
            "license": "User owned",
            "attribution": "No attribution required",
            "rightsStatus": "cleared",
    }
    if source == "licensed-media":
        asset["sourceUrl"] = "https://example.test/photo"
    value["assets"] = [asset]
    value["backgroundAssetId"] = "asset_forged"
    value["backgroundMode"] = "image"

    with pytest.raises(ValueError, match="not present in the project ledger"):
        _save(PipelineService(), root, project_id, head, value)


def test_generation_request_reads_the_persisted_customization(tmp_path: Path) -> None:
    root, project_id, head = _project(tmp_path)
    customization = _customization()
    customization["captions"]["position"] = "top"
    receipt = _save(PipelineService(), root, project_id, head, customization)

    with ProjectStore.open(root) as store:
        request = request_from_desktop(
            store,
            {
                "projectId": project_id,
                "projectDirectory": str(root),
                "snapshotId": receipt["headRevisionId"],
                "scope": {"kind": "project"},
                "quality": "standard",
                "privacy": "local",
                "budget": {
                    "currency": "USD",
                    "hardLimitMinorUnits": 0,
                    "requireKnownPricing": True,
                },
                "approvedProviderIds": [],
                "preservationLocks": [],
            },
        )
    assert request.metadata["customization"]["captions"]["position"] == "top"
    assert request.metadata["audioCustomization"]["inputs"] == []


def test_generic_snapshot_save_cannot_erase_narrow_customization(tmp_path: Path) -> None:
    root, project_id, head = _project(tmp_path)
    service = PipelineService()
    saved = _save(service, root, project_id, head, _customization())
    stale_document = {
        "id": project_id,
        "title": "Edited title",
        "topic": "Binary search",
        "audience": "Beginners",
        "scenes": [],
        "sources": [],
    }
    generic = service.project_snapshot_save(
        {
            "projectId": project_id,
            "projectDirectory": str(root),
            "expectedHeadRevisionId": saved["headRevisionId"],
            "snapshot": copy.deepcopy(stale_document),
        }
    )
    assert generic["snapshot"]["customization"]["fontPairId"] == "editorial"
