from __future__ import annotations

import json
from pathlib import Path

from alystria.contracts import StarterKitCatalog

ROOT = Path(__file__).parents[4]
CATALOG = ROOT / "packages" / "themes" / "starter-kits" / "core.v1.json"


def test_generated_starter_kit_is_semantically_valid() -> None:
    value = json.loads(CATALOG.read_text(encoding="utf-8"))
    catalog = StarterKitCatalog.from_mapping(value)
    assert catalog.diagnostics() == ()
    catalog.assert_valid()
    assert len(catalog.assets) >= 75
    assert len(catalog.theme_packs) == 10
    assert "upload.presenter-portrait-real" in catalog.user_asset_slot_ids


def test_python_gate_rejects_uncleared_export_and_remote_fetch() -> None:
    value = json.loads(CATALOG.read_text(encoding="utf-8"))
    value["assets"][0]["license"]["status"] = "unknown"
    value["assets"][0]["license"]["exportAllowed"] = True
    value["assets"][0]["technical"]["remoteFetchRequired"] = True
    codes = {item.code for item in StarterKitCatalog.from_mapping(value).diagnostics()}
    assert "starter.uncleared-export" in codes
    assert "starter.remote-render-fetch" in codes
