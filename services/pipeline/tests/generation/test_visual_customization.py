from __future__ import annotations

import base64
import copy
import uuid
from pathlib import Path
from typing import Any

from alystria.generation.coordinator import request_from_desktop
from alystria.generation.visual_customization import resolve_visual_customization
from alystria.project import ProjectStore
from alystria.project_assets import import_project_asset

PNG = b"\x89PNG\r\n\x1a\n" + b"customized-render-image"


def _customization(*, background: str | None = None, presenter: str | None = None) -> dict[str, Any]:
    starter_assets = []
    if background:
        starter_assets.append({"id": background, "kind": "background", "label": "Starter background", "source": "starter-pack", "creator": "Alystria Studio project owner", "license": "User owned", "attribution": "Synthetic provenance retained", "rightsStatus": "cleared"})
    if presenter:
        starter_assets.append({"id": presenter, "kind": "presenter", "label": "Starter presenter", "source": "starter-pack", "creator": "Alystria Studio project owner", "license": "User owned", "attribution": "Synthetic provenance retained", "rightsStatus": "cleared"})
    return {
        "fontPairId": "technical",
        "displayFont": "Bricolage Grotesque",
        "bodyFont": "Atkinson Hyperlegible Next",
        "fonts": {"displayAssetId": None, "bodyAssetId": None},
        "typeScale": 100,
        "lineHeight": "balanced",
        "paletteId": "precision",
        "colors": {"paper": "#F7F8FC", "ink": "#151827", "accent": "#5658E8", "evidence": "#168F88"},
        "backgroundMode": "image" if background else "paper",
        "backgroundAssetId": background,
        "materialStrength": 42,
        "density": "balanced",
        "contrast": "standard",
        "reducedMotion": False,
        "sceneTreatment": "editorial-frame",
        "cornerRadius": 22,
        "shadowStrength": 18,
        "captions": {
            "position": "top",
            "style": "solid-panel",
            "size": 112,
            "safeInset": 9,
            "textColor": "#FFF4D6",
            "panelColor": "#102033",
            "maxLines": 3,
        },
        "presenter": {
            "assetId": presenter,
            "placement": "split" if presenter else "off",
            "side": "right",
            "scale": 68,
            "crop": "contain",
            "frame": "keyline",
        },
        "audio": {"musicAssetId": None, "sfxAssetId": None, "musicLevel": 0, "sfxLevel": 0, "narrationDucking": 72},
        "assets": starter_assets,
    }


def _project(tmp_path: Path, snapshot: dict[str, Any]) -> ProjectStore:
    return ProjectStore.create(
        tmp_path / "Visual Project",
        name="Visual project",
        project_id=str(uuid.uuid4()),
        initial_snapshot=snapshot,
    )


def test_missing_starter_visual_runtime_uses_procedural_fallback(tmp_path: Path) -> None:
    with _project(
        tmp_path,
        {"title": "Fallback", "customization": _customization(background="background-modern-signal")},
    ) as store:
        result = resolve_visual_customization(store, store.head_revision().snapshot)  # type: ignore[union-attr]

    assert result["assets"] == []
    assert "procedural fallback" in result["warnings"][0]
    assert result["captionStyle"]["position"] == "top"
    assert result["captionStyle"]["maxLines"] == 3
    assert result["captionStyle"]["fontFamily"] == "Atkinson Hyperlegible Next"


def test_canonical_starter_assets_are_hash_verified_and_promoted(tmp_path: Path) -> None:
    repository_root = Path(__file__).resolve().parents[4]
    snapshot = {
        "title": "Starter visual",
        "customization": _customization(
            background="background.modern-tech-signal-v1",
            presenter="presenter-portrait.modern-tech-minji-v1",
        ),
    }
    with _project(tmp_path, snapshot) as store:
        result = resolve_visual_customization(
            store,
            snapshot,
            starter_visual_root=repository_root,
        )
        bindings = {item["role"]: item for item in result["assets"]}
        assert bindings["background"]["assetId"] == "background.modern-tech-signal-v1"
        assert bindings["presenter-portrait"]["assetId"] == "presenter-portrait.modern-tech-minji-v1"
        assert bindings["presenter-portrait"]["fit"] == "contain"
        assert result["presenter"]["placement"] == "right"
        assert result["presenter"]["profile"]["identityType"] == "synthetic"
        for binding in bindings.values():
            assert store.cas.verify(binding["artifactHash"])
            assert not {"path", "url", "uri", "contentBase64"} & binding.keys()


def test_user_presenter_requires_ledger_provenance_and_exports_by_hash(tmp_path: Path) -> None:
    with _project(tmp_path, {"title": "User portrait"}) as store:
        head = store.head_revision()
        assert head is not None
        receipt = import_project_asset(
            store,
            {
                "projectId": store.manifest.project_id,
                "projectDirectory": str(store.root),
                "expectedHeadRevisionId": head.revision_id,
                "kind": "presenterPortrait",
                "filename": "guide.png",
                "mimeType": "image/png",
                "privacy": "project_local",
                "rights": {
                    "status": "owned",
                    "creator": "Project owner",
                    "license": "User-owned media",
                    "attribution": None,
                    "commercialUse": "allowed",
                    "redistribution": "allowed",
                    "modelInput": "allowed",
                },
                "presenter": {
                    "identityType": "synthetic",
                    "displayName": "My Guide",
                    "syntheticOriginAttested": True,
                    "consent": None,
                    "selectAfterImport": True,
                },
                "contentBase64": base64.b64encode(PNG).decode("ascii"),
            },
        )
        current = store.head_revision()
        assert current is not None
        snapshot = copy.deepcopy(current.snapshot)
        snapshot["customization"] = _customization(presenter=receipt["artifact"]["id"])
        result = resolve_visual_customization(store, snapshot)

    binding = result["assets"][0]
    assert binding["source"] == "project"
    assert binding["artifactHash"] == receipt["artifact"]["sha256"]
    assert result["presenter"]["profile"]["displayName"] == "My Guide"


def test_desktop_request_carries_closed_visual_contract_without_paths(tmp_path: Path) -> None:
    snapshot = {
        "title": "Binary search",
        "brief": {"topic": "Binary search", "audience": "Beginners", "durationSeconds": 60},
        "customization": _customization(background="background-modern-signal"),
    }
    with _project(tmp_path, snapshot) as store:
        request = request_from_desktop(
            store,
            {
                "budget": {"hardLimitMinorUnits": 0, "currency": "USD", "requireKnownPricing": True},
                "approvedProviderIds": [],
            },
        )

    contract = request.metadata["visualCustomization"]
    assert contract["schemaVersion"] == 1
    assert contract["assets"] == []
    assert contract["captionStyle"]["safeInsetPercent"] == 9
    assert "procedural fallback" in contract["warnings"][0]
    assert "path" not in str(contract).casefold()
