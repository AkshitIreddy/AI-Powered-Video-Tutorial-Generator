"""Dependency-free starter-kit trust-boundary models and semantic validation.

JSON Schema remains canonical.  These small records deliberately model only the
fields the Python pipeline must trust when deciding whether an asset may render
or export; presentation-only catalog text remains in the original mapping.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

AssetKind = Literal[
    "background",
    "overlay",
    "transition",
    "font",
    "music",
    "sound-effect",
    "presenter-style",
    "presenter-portrait",
    "lower-third",
    "caption-style",
]


@dataclass(frozen=True, slots=True)
class StarterKitDiagnostic:
    code: str
    severity: Literal["warning", "error", "fatal"]
    path: str
    message: str


@dataclass(frozen=True, slots=True)
class StarterAssetRecord:
    asset_id: str
    kind: str
    delivery: str
    availability: str
    render_safe: bool
    remote_fetch_required: bool
    license_status: str
    license_expression: str
    export_allowed: bool
    provenance_origin: str
    provenance_review_status: str
    content_hash: str | None
    relative_path: str | None


@dataclass(frozen=True, slots=True)
class StarterThemePackRecord:
    pack_id: str
    theme_id: str
    referenced_asset_ids: tuple[tuple[str, str], ...]


@dataclass(frozen=True, slots=True)
class StarterKitCatalog:
    schema_version: int
    catalog_id: str
    version: str
    assets: tuple[StarterAssetRecord, ...]
    theme_packs: tuple[StarterThemePackRecord, ...]
    user_asset_slot_ids: tuple[str, ...]
    source: Mapping[str, Any]

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> StarterKitCatalog:
        assets = tuple(_asset_from_mapping(item, index) for index, item in enumerate(_sequence(value.get("assets"), "/assets")))
        theme_packs = tuple(_pack_from_mapping(item, index) for index, item in enumerate(_sequence(value.get("themePacks"), "/themePacks")))
        slots = tuple(_string(_mapping(item, f"/userAssetSlots/{index}").get("id"), f"/userAssetSlots/{index}/id") for index, item in enumerate(_sequence(value.get("userAssetSlots"), "/userAssetSlots")))
        return cls(
            schema_version=_integer(value.get("schemaVersion"), "/schemaVersion"),
            catalog_id=_string(value.get("id"), "/id"),
            version=_string(value.get("version"), "/version"),
            assets=assets,
            theme_packs=theme_packs,
            user_asset_slot_ids=slots,
            source=value,
        )

    def diagnostics(self) -> tuple[StarterKitDiagnostic, ...]:
        diagnostics: list[StarterKitDiagnostic] = []
        if self.schema_version != 1:
            diagnostics.append(StarterKitDiagnostic("starter.unsupported-schema", "fatal", "/schemaVersion", f"Unsupported starter-kit schema: {self.schema_version}"))
        asset_by_id: dict[str, StarterAssetRecord] = {}
        for index, asset in enumerate(self.assets):
            if asset.asset_id in asset_by_id:
                diagnostics.append(StarterKitDiagnostic("starter.duplicate-id", "fatal", f"/assets/{index}/id", f"Duplicate asset id: {asset.asset_id}"))
            asset_by_id[asset.asset_id] = asset
            if asset.availability == "ready" and not asset.render_safe:
                diagnostics.append(StarterKitDiagnostic("starter.ready-asset-not-render-safe", "fatal", f"/assets/{index}/technical/renderSafe", f"Ready asset is not render-safe: {asset.asset_id}"))
            if asset.remote_fetch_required:
                diagnostics.append(StarterKitDiagnostic("starter.remote-render-fetch", "fatal", f"/assets/{index}/technical/remoteFetchRequired", f"Remote render fetch is forbidden: {asset.asset_id}"))
            if asset.license_status != "cleared" and asset.export_allowed:
                diagnostics.append(StarterKitDiagnostic("starter.uncleared-export", "fatal", f"/assets/{index}/license", f"Uncleared asset cannot permit export: {asset.asset_id}"))
            if asset.availability == "planned" and asset.export_allowed:
                diagnostics.append(StarterKitDiagnostic("starter.placeholder-exportable", "fatal", f"/assets/{index}/license/exportAllowed", f"Placeholder cannot permit export: {asset.asset_id}"))
            if asset.delivery in {"bundled-file", "optional-download"} and (asset.content_hash is None or len(asset.content_hash) != 64):
                diagnostics.append(StarterKitDiagnostic("starter.missing-integrity", "fatal", f"/assets/{index}/source/contentHash", f"File-backed asset lacks an immutable SHA-256: {asset.asset_id}"))
            if asset.delivery == "bundled-file" and asset.relative_path is None:
                diagnostics.append(StarterKitDiagnostic("starter.missing-path", "fatal", f"/assets/{index}/source/relativePath", f"Bundled asset lacks a relative path: {asset.asset_id}"))

        expected_kinds: dict[str, frozenset[str]] = {
            "backgroundAssetId": frozenset({"background", "overlay"}),
            "overlayAssetId": frozenset({"overlay"}),
            "transitionAssetId": frozenset({"transition"}),
            "displayFontAssetId": frozenset({"font"}),
            "bodyFontAssetId": frozenset({"font"}),
            "codeFontAssetId": frozenset({"font"}),
            "presenterStyleAssetId": frozenset({"presenter-style"}),
            "presenterPortraitAssetId": frozenset({"presenter-portrait"}),
            "lowerThirdAssetId": frozenset({"lower-third"}),
            "captionStyleAssetId": frozenset({"caption-style"}),
            "backgroundAssetIds": frozenset({"background", "overlay"}),
            "transitionAssetIds": frozenset({"transition"}),
            "fontAssetIds": frozenset({"font"}),
            "presenterStyleAssetIds": frozenset({"presenter-style"}),
            "presenterPortraitAssetIds": frozenset({"presenter-portrait"}),
            "musicAssetIds": frozenset({"music"}),
            "soundEffectAssetIds": frozenset({"sound-effect"}),
        }
        seen_pack_ids: set[str] = set()
        seen_themes: set[str] = set()
        for pack_index, pack in enumerate(self.theme_packs):
            if pack.pack_id in seen_pack_ids:
                diagnostics.append(StarterKitDiagnostic("starter.duplicate-id", "fatal", f"/themePacks/{pack_index}/id", f"Duplicate theme pack id: {pack.pack_id}"))
            seen_pack_ids.add(pack.pack_id)
            seen_themes.add(pack.theme_id)
            for field, asset_id in pack.referenced_asset_ids:
                referenced_asset = asset_by_id.get(asset_id)
                path = f"/themePacks/{pack_index}/{field}"
                if referenced_asset is None:
                    diagnostics.append(StarterKitDiagnostic("starter.missing-asset", "fatal", path, f"Unknown starter asset: {asset_id}"))
                elif referenced_asset.kind not in expected_kinds[field.rsplit("/", 1)[-1]]:
                    diagnostics.append(StarterKitDiagnostic("starter.wrong-asset-kind", "error", path, f"Asset {asset_id} has kind {referenced_asset.kind}"))

        required_themes = {"minimal", "academic", "modern-tech", "notebook", "documentary", "playful", "childrens-education", "corporate-training", "light", "dark"}
        for theme_id in sorted(required_themes - seen_themes):
            diagnostics.append(StarterKitDiagnostic("starter.missing-theme-pack", "fatal", "/themePacks", f"Missing starter pack for theme: {theme_id}"))
        if len(set(self.user_asset_slot_ids)) != len(self.user_asset_slot_ids):
            diagnostics.append(StarterKitDiagnostic("starter.duplicate-upload-slot", "fatal", "/userAssetSlots", "User upload slot ids must be unique"))
        return tuple(diagnostics)

    def assert_valid(self) -> None:
        failures = [item for item in self.diagnostics() if item.severity in {"error", "fatal"}]
        if failures:
            summary = "; ".join(f"{item.path}: {item.message}" for item in failures[:8])
            raise ValueError(f"Starter-kit manifest failed semantic validation: {summary}")


def _mapping(value: Any, path: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{path} must be an object")
    return value


def _sequence(value: Any, path: str) -> Sequence[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{path} must be an array")
    return value


def _string(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{path} must be a non-empty string")
    return value


def _integer(value: Any, path: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{path} must be an integer")
    return value


def _boolean(value: Any, path: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{path} must be a boolean")
    return value


def _optional_string(value: Any, path: str) -> str | None:
    return None if value is None else _string(value, path)


def _asset_from_mapping(value: Any, index: int) -> StarterAssetRecord:
    base = f"/assets/{index}"
    item = _mapping(value, base)
    source = _mapping(item.get("source"), f"{base}/source")
    license_value = _mapping(item.get("license"), f"{base}/license")
    provenance = _mapping(item.get("provenance"), f"{base}/provenance")
    technical = _mapping(item.get("technical"), f"{base}/technical")
    return StarterAssetRecord(
        asset_id=_string(item.get("id"), f"{base}/id"), kind=_string(item.get("kind"), f"{base}/kind"),
        delivery=_string(source.get("delivery"), f"{base}/source/delivery"), availability=_string(source.get("availability"), f"{base}/source/availability"),
        render_safe=_boolean(technical.get("renderSafe"), f"{base}/technical/renderSafe"), remote_fetch_required=_boolean(technical.get("remoteFetchRequired"), f"{base}/technical/remoteFetchRequired"),
        license_status=_string(license_value.get("status"), f"{base}/license/status"), license_expression=_string(license_value.get("expression"), f"{base}/license/expression"), export_allowed=_boolean(license_value.get("exportAllowed"), f"{base}/license/exportAllowed"),
        provenance_origin=_string(provenance.get("origin"), f"{base}/provenance/origin"), provenance_review_status=_string(provenance.get("reviewStatus"), f"{base}/provenance/reviewStatus"),
        content_hash=_optional_string(source.get("contentHash"), f"{base}/source/contentHash"), relative_path=_optional_string(source.get("relativePath"), f"{base}/source/relativePath"),
    )


def _pack_from_mapping(value: Any, index: int) -> StarterThemePackRecord:
    base = f"/themePacks/{index}"
    item = _mapping(value, base)
    defaults = _mapping(item.get("defaults"), f"{base}/defaults")
    alternatives = _mapping(item.get("alternatives"), f"{base}/alternatives")
    references: list[tuple[str, str]] = []
    for field in ("backgroundAssetId", "overlayAssetId", "transitionAssetId", "displayFontAssetId", "bodyFontAssetId", "codeFontAssetId", "presenterStyleAssetId", "presenterPortraitAssetId", "lowerThirdAssetId", "captionStyleAssetId"):
        if field in defaults:
            references.append((f"defaults/{field}", _string(defaults[field], f"{base}/defaults/{field}")))
    for field in ("backgroundAssetIds", "transitionAssetIds", "fontAssetIds", "presenterStyleAssetIds", "presenterPortraitAssetIds", "musicAssetIds", "soundEffectAssetIds"):
        for item_index, asset_id in enumerate(_sequence(alternatives.get(field), f"{base}/alternatives/{field}")):
            references.append((f"alternatives/{field}", _string(asset_id, f"{base}/alternatives/{field}/{item_index}")))
    return StarterThemePackRecord(pack_id=_string(item.get("id"), f"{base}/id"), theme_id=_string(item.get("themeId"), f"{base}/themeId"), referenced_asset_ids=tuple(references))
