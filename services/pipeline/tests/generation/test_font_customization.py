from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from alystria.generation.font_customization import (
    renderer_font_family,
    resolve_font_customization,
)
from alystria.project import ProjectStore


def _snapshot(
    *,
    asset_id: str,
    digest: str,
    media_type: str = "font/ttf",
    export_eligible: bool = True,
    blockers: list[str] | None = None,
    inspection_status: str = "metadata-inspected",
    permission: str = "installable",
) -> dict[str, Any]:
    return {
        "customization": {
            "displayFont": "Owned Classroom",
            "bodyFont": "Atkinson Hyperlegible Next",
            "fonts": {"displayAssetId": asset_id, "bodyAssetId": None},
            "assets": [
                {
                    "id": asset_id,
                    "kind": "font",
                    "source": "user-upload",
                    "rightsStatus": "cleared",
                    "sha256": digest,
                    "mediaType": media_type,
                }
            ],
        },
        "mediaAssets": [
            {
                "id": asset_id,
                "kind": "font",
                "artifactHash": digest,
                "mediaType": media_type,
                "state": "promoted",
                "fontMetadata": {
                    "inspectionStatus": inspection_status,
                    "weightClass": 650,
                    "italic": False,
                    "variableAxes": [],
                    "compatibleTypographyRoles": [
                        "display",
                        "body",
                        "caption",
                    ],
                    "embedding": {
                        "permission": permission,
                        "bitmapOnly": False,
                    },
                },
            }
        ],
        "assetProvenance": [
            {
                "assetId": asset_id,
                "contentHash": digest,
                "exportEligible": export_eligible,
                "blockers": blockers or [],
            }
        ],
    }


def test_selected_font_becomes_hash_bound_alias_and_role(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Font Tutorial", name="Font Tutorial")
    try:
        artifact = store.add_artifact_bytes(
            b"\x00\x01\x00\x00owned-font", media_type="font/ttf"
        )
        resolved = resolve_font_customization(
            store,
            _snapshot(asset_id="asset_font", digest=artifact.hash),
        )
        font = resolved["fontAssets"][0]
        assert font["artifactHash"] == artifact.hash
        assert font["family"] == renderer_font_family(artifact.hash)
        assert font["roles"] == ["display"]
        assert resolved["typography"]["displayFamily"] == font["family"]
        assert resolved["typography"]["bodyFamily"] == "Atkinson Hyperlegible Next"
    finally:
        store.close()


def test_one_font_can_bind_body_and_caption_without_duplicate_input(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Font Tutorial", name="Font Tutorial")
    try:
        artifact = store.add_artifact_bytes(
            b"\x00\x01\x00\x00owned-font", media_type="font/ttf"
        )
        snapshot = _snapshot(asset_id="asset_font", digest=artifact.hash)
        snapshot["customization"]["fonts"] = {
            "displayAssetId": "asset_font",
            "bodyAssetId": "asset_font",
        }
        resolved = resolve_font_customization(store, snapshot)
        assert len(resolved["fontAssets"]) == 1
        assert resolved["fontAssets"][0]["roles"] == ["display", "body", "caption"]
        assert resolved["typography"]["captionFamily"] == resolved["fontAssets"][0]["family"]
    finally:
        store.close()


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"export_eligible": False}, "not cleared for export"),
        ({"blockers": ["license missing"]}, "not cleared for export"),
        ({"inspection_status": "container-only"}, "not fully inspected"),
        ({"permission": "restricted"}, "not cleared for export|browser embedding"),
        ({"media_type": "font/woff2"}, "no render-safe media registration|not cleared"),
    ],
)
def test_selected_uncleared_or_uninspected_font_fails_closed(
    tmp_path: Path, changes: dict[str, Any], message: str
) -> None:
    store = ProjectStore.create(tmp_path / "Font Tutorial", name="Font Tutorial")
    try:
        artifact = store.add_artifact_bytes(
            b"\x00\x01\x00\x00owned-font",
            media_type=str(changes.get("media_type", "font/ttf")),
        )
        with pytest.raises(ValueError, match=message):
            resolve_font_customization(
                store,
                _snapshot(asset_id="asset_font", digest=artifact.hash, **changes),
            )
    finally:
        store.close()


def test_unselected_font_uses_deterministic_declared_fallbacks(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Font Tutorial", name="Font Tutorial")
    try:
        resolved = resolve_font_customization(
            store,
            {
                "customization": {
                    "displayFont": "Bricolage Grotesque",
                    "bodyFont": "Atkinson Hyperlegible Next",
                    "fonts": {"displayAssetId": None, "bodyAssetId": None},
                }
            },
        )
        assert resolved["fontAssets"] == []
        assert resolved["typography"]["captionFamily"] == "Atkinson Hyperlegible Next"
    finally:
        store.close()
