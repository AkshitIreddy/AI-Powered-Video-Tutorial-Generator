"""Resolve selected user fonts into hash-bound final-render inputs.

The desktop persists opaque asset IDs. This boundary proves that each selected
font is a promoted, structurally inspected CAS object with matching provenance
and export/embedding clearance. It emits no path; the renderer client creates
attempt-local copies after this decision.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from alystria.project import ProjectStore

SUPPORTED_RENDER_FONT_TYPES = frozenset({"font/ttf", "font/otf", "font/woff"})
SUPPORTED_EMBEDDING_PERMISSIONS = frozenset(
    {"installable", "previewPrint", "editable"}
)
SHA256 = re.compile(r"^[0-9a-f]{64}$")
SAFE_FAMILY = re.compile(r"^[\w .'-]{1,120}$", re.UNICODE)


def renderer_font_family(digest: str) -> str:
    """Return the same collision-resistant CSS alias as the Node renderer."""

    normalized = digest.casefold()
    if not SHA256.fullmatch(normalized):
        raise ValueError("Renderer font family requires a lowercase SHA-256 hash")
    return f"AlystriaImported-{normalized[:16]}"


def resolve_font_customization(
    store: ProjectStore,
    snapshot: Mapping[str, Any],
) -> dict[str, Any]:
    """Return closed typography tokens and selected immutable font records.

    Unselected or unavailable custom-font records do not affect deterministic
    theme fallbacks. Once an asset ID is selected for a role, however, any
    rights, inspection, provenance, registry, or byte failure blocks rendering
    rather than pretending that the user's family was applied.
    """

    customization_value = snapshot.get("customization")
    if customization_value is None:
        return _fallback_typography()
    customization = _mapping(customization_value, "Project customization")
    fonts = _mapping(customization.get("fonts"), "Project font selections")
    selections = {
        "display": _nullable_id(fonts.get("displayAssetId"), "fonts.displayAssetId"),
        "body": _nullable_id(fonts.get("bodyAssetId"), "fonts.bodyAssetId"),
    }
    display_name = _family(
        customization.get("displayFont", "Bricolage Grotesque"), "displayFont"
    )
    body_name = _family(
        customization.get("bodyFont", "Atkinson Hyperlegible Next"), "bodyFont"
    )
    if selections["display"] is None and selections["body"] is None:
        return {
            "fontAssets": [],
            "typography": {
                "displayFamily": display_name,
                "bodyFamily": body_name,
                "codeFamily": "JetBrains Mono",
                "captionFamily": body_name,
            },
        }

    durable = _record_index(snapshot.get("mediaAssets"), "mediaAssets")
    provenance = _record_index(
        snapshot.get("assetProvenance"), "assetProvenance", key="assetId"
    )
    declared = _record_index(
        customization.get("assets"), "customization.assets"
    )
    roles_by_asset: dict[str, list[str]] = {}
    for role, asset_id in selections.items():
        if asset_id is not None:
            roles_by_asset.setdefault(asset_id, []).append(role)

    inputs: list[dict[str, Any]] = []
    aliases: dict[str, str] = {}
    for asset_id, roles in roles_by_asset.items():
        item = _resolve_font(
            store,
            asset_id,
            roles,
            durable=durable,
            provenance=provenance,
            declared=declared,
        )
        inputs.append(item)
        for role in roles:
            aliases[role] = str(item["family"])

    resolved_body = aliases.get("body", body_name)
    return {
        "fontAssets": inputs,
        "typography": {
            "displayFamily": aliases.get("display", display_name),
            "bodyFamily": resolved_body,
            "codeFamily": "JetBrains Mono",
            "captionFamily": resolved_body,
        },
    }


def _resolve_font(
    store: ProjectStore,
    asset_id: str,
    roles: list[str],
    *,
    durable: Mapping[str, Mapping[str, Any]],
    provenance: Mapping[str, Mapping[str, Any]],
    declared: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    selection = declared.get(asset_id)
    if (
        selection is None
        or selection.get("kind") != "font"
        or selection.get("source") != "user-upload"
        or selection.get("rightsStatus") != "cleared"
    ):
        raise ValueError(
            f"Selected font asset {asset_id!r} is absent from the cleared customization ledger"
        )
    record = durable.get(asset_id)
    if record is None or record.get("kind") != "font":
        raise ValueError(f"Selected font asset {asset_id!r} is missing or has the wrong kind")
    if record.get("state") != "promoted":
        raise ValueError(f"Selected font asset {asset_id!r} is not promoted")
    digest = _digest(record.get("artifactHash"), f"{asset_id}.artifactHash")
    if selection.get("sha256") != digest:
        raise ValueError(f"Selected font asset {asset_id!r} does not match its customization hash")
    if not store.cas.verify(digest):
        raise ValueError(f"Selected font asset {asset_id!r} is missing or corrupt")
    row = store.connection.execute(
        "SELECT media_type FROM artifacts WHERE hash=?", (digest,)
    ).fetchone()
    if row is None:
        raise ValueError(f"Selected font asset {asset_id!r} is not registered")
    media_type = str(row["media_type"]).casefold()
    if (
        media_type not in SUPPORTED_RENDER_FONT_TYPES
        or record.get("mediaType") != media_type
        or selection.get("mediaType") != media_type
    ):
        raise ValueError(
            f"Selected font asset {asset_id!r} has no render-safe media registration"
        )
    proof = provenance.get(asset_id)
    if proof is None or proof.get("contentHash") != digest:
        raise ValueError(f"Selected font asset {asset_id!r} has invalid provenance")
    blockers = proof.get("blockers")
    if proof.get("exportEligible") is not True or blockers not in (None, []):
        raise ValueError(f"Selected font asset {asset_id!r} is not cleared for export")

    metadata = _mapping(record.get("fontMetadata"), f"{asset_id}.fontMetadata")
    if metadata.get("inspectionStatus") != "metadata-inspected":
        raise ValueError(f"Selected font asset {asset_id!r} was not fully inspected")
    compatible = metadata.get("compatibleTypographyRoles")
    if not isinstance(compatible, list) or any(role not in compatible for role in roles):
        raise ValueError(
            f"Selected font asset {asset_id!r} is not compatible with its typography role"
        )
    embedding = _mapping(metadata.get("embedding"), f"{asset_id}.embedding")
    permission = embedding.get("permission")
    if permission not in SUPPORTED_EMBEDDING_PERMISSIONS:
        raise ValueError(
            f"Selected font asset {asset_id!r} is not cleared for browser embedding"
        )
    if embedding.get("bitmapOnly") is not False:
        raise ValueError(f"Selected font asset {asset_id!r} permits bitmap embedding only")

    weight = metadata.get("weightClass")
    if not isinstance(weight, int) or isinstance(weight, bool) or not 1 <= weight <= 1_000:
        weight = 400
    variable_range = _variable_weight_range(metadata.get("variableAxes"))
    return {
        "id": asset_id,
        "artifactHash": digest,
        "mediaType": media_type,
        "family": renderer_font_family(digest),
        "roles": [*roles, *( ["caption"] if "body" in roles else [] )],
        "weight": variable_range or weight,
        "style": "italic" if metadata.get("italic") is True else "normal",
        "inspectionStatus": "metadata-inspected",
        "embeddingPermission": permission,
        "exportEligible": True,
    }


def _variable_weight_range(value: object) -> list[int] | None:
    if not isinstance(value, list):
        return None
    for raw in value:
        if not isinstance(raw, Mapping) or raw.get("tag") != "wght":
            continue
        minimum = raw.get("minimum")
        maximum = raw.get("maximum")
        if not isinstance(minimum, int) or not isinstance(maximum, int):
            return None
        # fvar stores Fixed 16.16 values; the inspector deliberately preserves
        # those exact integers rather than interpreting untrusted floating data.
        minimum_value = round(minimum / 65_536)
        maximum_value = round(maximum / 65_536)
        if 1 <= minimum_value <= maximum_value <= 1_000:
            return [minimum_value, maximum_value]
    return None


def _fallback_typography() -> dict[str, Any]:
    return {
        "fontAssets": [],
        "typography": {
            "displayFamily": "Bricolage Grotesque",
            "bodyFamily": "Atkinson Hyperlegible Next",
            "codeFamily": "JetBrains Mono",
            "captionFamily": "Atkinson Hyperlegible Next",
        },
    }


def _record_index(
    value: object, label: str, *, key: str = "id"
) -> dict[str, Mapping[str, Any]]:
    if not isinstance(value, list):
        raise ValueError(f"{label} ledger is invalid")
    result: dict[str, Mapping[str, Any]] = {}
    for raw in value:
        if not isinstance(raw, Mapping) or not isinstance(raw.get(key), str):
            raise ValueError(f"{label} ledger contains an invalid record")
        record_id = str(raw[key])
        if record_id in result:
            raise ValueError(f"{label} ledger contains duplicate ID {record_id!r}")
        result[record_id] = raw
    return result


def _mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    return value


def _nullable_id(value: object, label: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}", value
    ):
        raise ValueError(f"{label} must be a bounded opaque identifier")
    return value


def _family(value: object, label: str) -> str:
    if not isinstance(value, str) or not SAFE_FAMILY.fullmatch(value):
        raise ValueError(f"{label} contains unsupported font-family characters")
    return value


def _digest(value: object, label: str) -> str:
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        raise ValueError(f"{label} must be a lowercase SHA-256 hash")
    return value
