"""Resolve persisted visual customization into hash-bound render inputs.

Project snapshots contain only opaque asset IDs and closed rendering tokens.
This module is the trust boundary that verifies user imports or bundled starter
assets, promotes bundled bytes into the project CAS, and emits no paths or
URLs.  The renderer client creates its own attempt-local paths later.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from alystria.project import ProjectStore

MAX_STARTER_MANIFEST_BYTES = 8 * 1024 * 1024
MAX_VISUAL_ASSET_BYTES = 32 * 1024 * 1024
SUPPORTED_IMAGE_TYPES = frozenset({"image/png", "image/jpeg", "image/webp"})
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
FONT_FAMILY = re.compile(r"^[\w .'-]{1,120}$", re.UNICODE)

# Early desktop previews used concise IDs before the starter-kit contract was
# generated.  Treat them as compatibility aliases, then persist/use canonical
# catalog IDs everywhere beyond this boundary.
STARTER_ALIASES = {
    "background-academic-evidence": "background.academic-evidence-paper-v1",
    "background-modern-signal": "background.modern-tech-signal-v1",
    "background-playful-paper": "background.playful-paper-cut-v1",
    "presenter-academic-amara": "presenter-portrait.academic-amara-v1",
    "presenter-modern-minji": "presenter-portrait.modern-tech-minji-v1",
    "presenter-documentary-malik": "presenter-portrait.documentary-malik-v1",
    "presenter-playful-lucia": "presenter-portrait.playful-lucia-v1",
}


def resolve_visual_customization(
    store: ProjectStore,
    snapshot: Mapping[str, Any],
    *,
    starter_visual_root: Path | None = None,
) -> dict[str, Any]:
    """Return renderer-safe visual and caption customization.

    A missing optional starter runtime degrades to the procedural renderer and
    records a warning.  A selected user import is never silently ignored:
    missing provenance, rights, consent, or bytes block generation.
    """

    customization_value = snapshot.get("customization")
    if customization_value is None:
        return _empty_customization()
    customization = _mapping(customization_value, "Project customization")
    assets = _record_index(snapshot.get("mediaAssets", []), "mediaAssets")
    provenance = _record_index(
        snapshot.get("assetProvenance", []), "assetProvenance", key="assetId"
    )
    warnings: list[str] = []
    bindings: list[dict[str, Any]] = []

    background_id = customization.get("backgroundAssetId")
    background_mode = customization.get("backgroundMode", "paper")
    if background_mode not in {"paper", "grid", "gradient", "image"}:
        raise ValueError("Project backgroundMode is unsupported")
    if background_mode == "image" and background_id not in (None, ""):
        binding = _resolve_selection(
            store,
            background_id,
            expected_kind="backgroundImage",
            starter_kind="background",
            role="background",
            starter_visual_root=starter_visual_root,
            assets=assets,
            provenance=provenance,
            warnings=warnings,
        )
        if binding is not None:
            bindings.append({**binding, "fit": "cover"})

    presenter_value = customization.get("presenter", {})
    presenter = _mapping(presenter_value, "Project presenter customization")
    placement = _enum(
        presenter.get("placement", "off"),
        {"off", "picture-in-picture", "split", "full-frame"},
        "presenter.placement",
    )
    side = _enum(presenter.get("side", "right"), {"left", "right"}, "presenter.side")
    fit_value = _enum(
        presenter.get("crop", "cover"),
        {"contain", "cover", "portrait"},
        "presenter.crop",
    )
    presenter_id = presenter.get("assetId")
    presenter_binding: dict[str, Any] | None = None
    presenter_profile: dict[str, Any] | None = None
    if placement != "off" and presenter_id not in (None, ""):
        presenter_binding = _resolve_selection(
            store,
            presenter_id,
            expected_kind="presenterPortrait",
            starter_kind="presenter-portrait",
            role="presenter-portrait",
            starter_visual_root=starter_visual_root,
            assets=assets,
            provenance=provenance,
            warnings=warnings,
        )
        if presenter_binding is not None:
            bindings.append(
                {
                    **presenter_binding,
                    "fit": "contain" if fit_value == "contain" else "cover",
                }
            )
            presenter_profile = _presenter_profile(
                snapshot,
                str(presenter_binding["assetId"]),
                source=str(presenter_binding["source"]),
            )

    caption_value = customization.get("captions", {})
    captions = _mapping(caption_value, "Project caption customization")
    caption_style = {
        "position": _enum(
            captions.get("position", "auto"),
            {"auto", "top", "lower-third"},
            "captions.position",
        ),
        "style": _enum(
            captions.get("style", "soft-panel"),
            {"soft-panel", "solid-panel", "outline"},
            "captions.style",
        ),
        "sizePercent": _number(captions.get("size", 100), 60, 160, "captions.size"),
        "safeInsetPercent": _number(
            captions.get("safeInset", 6), 2, 24, "captions.safeInset"
        ),
        "maxLines": _integer(captions.get("maxLines", 2), 1, 3, "captions.maxLines"),
        "textColor": _color(captions.get("textColor", "#FFFFFF"), "captions.textColor"),
        "panelColor": _color(captions.get("panelColor", "#151827"), "captions.panelColor"),
        "fontFamily": _font_family(
            customization.get("bodyFont", "Atkinson Hyperlegible Next"),
            "bodyFont",
        ),
        "fallbackFamilies": ["Arial", "sans-serif"],
    }
    return {
        "schemaVersion": 1,
        "assets": bindings,
        "presenter": {
            "enabled": placement != "off" and presenter_binding is not None,
            "placement": _renderer_placement(placement, side),
            "fit": "contain" if fit_value == "contain" else "cover",
            "side": side,
            "scalePercent": _number(
                presenter.get("scale", 72), 30, 100, "presenter.scale"
            ),
            "frame": _enum(
                presenter.get("frame", "soft"),
                {"none", "soft", "keyline"},
                "presenter.frame",
            ),
            **({"profile": presenter_profile} if presenter_profile else {}),
        },
        "captionStyle": caption_style,
        "warnings": warnings,
    }


def _empty_customization() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "assets": [],
        "presenter": {
            "enabled": False,
            "placement": "picture-in-picture",
            "fit": "cover",
            "side": "right",
            "scalePercent": 72.0,
            "frame": "soft",
        },
        "captionStyle": {
            "position": "auto",
            "style": "soft-panel",
            "sizePercent": 100.0,
            "safeInsetPercent": 6.0,
            "maxLines": 2,
            "textColor": "#FFFFFF",
            "panelColor": "#151827",
            "fontFamily": "Atkinson Hyperlegible Next",
            "fallbackFamilies": ["Arial", "sans-serif"],
        },
        "warnings": [],
    }


def _resolve_selection(
    store: ProjectStore,
    selected: object,
    *,
    expected_kind: str,
    starter_kind: str,
    role: str,
    starter_visual_root: Path | None,
    assets: Mapping[str, Mapping[str, Any]],
    provenance: Mapping[str, Mapping[str, Any]],
    warnings: list[str],
) -> dict[str, Any] | None:
    asset_id = _string(selected, f"selected {role} asset")
    canonical_id = STARTER_ALIASES.get(asset_id, asset_id)
    if canonical_id.startswith(("background.", "presenter-portrait.")):
        if starter_visual_root is None:
            warnings.append(
                f"Selected starter asset {canonical_id} is unavailable; procedural fallback used"
            )
            return None
        return _resolve_starter_asset(
            store,
            canonical_id,
            expected_kind=starter_kind,
            role=role,
            starter_visual_root=starter_visual_root,
        )
    return _resolve_project_asset(
        store,
        canonical_id,
        expected_kind=expected_kind,
        role=role,
        assets=assets,
        provenance=provenance,
    )


def _resolve_project_asset(
    store: ProjectStore,
    asset_id: str,
    *,
    expected_kind: str,
    role: str,
    assets: Mapping[str, Mapping[str, Any]],
    provenance: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    record = assets.get(asset_id)
    if record is None or record.get("kind") != expected_kind:
        raise ValueError(f"Selected {role} asset {asset_id!r} is missing or has the wrong kind")
    if record.get("state") != "promoted":
        raise ValueError(f"Selected {role} asset {asset_id!r} is not promoted")
    digest = _sha256(record.get("artifactHash"), f"{asset_id} artifactHash")
    media_type = _registered_media_type(store, digest)
    if media_type not in SUPPORTED_IMAGE_TYPES or record.get("mediaType") != media_type:
        raise ValueError(f"Selected {role} asset {asset_id!r} has an invalid media registration")
    if not store.cas.verify(digest):
        raise ValueError(f"Selected {role} asset {asset_id!r} is missing or corrupt")
    proof = provenance.get(asset_id)
    if proof is None or proof.get("contentHash") != digest:
        raise ValueError(f"Selected {role} asset {asset_id!r} has invalid provenance")
    if proof.get("exportEligible") is not True or proof.get("blockers") not in (None, []):
        raise ValueError(f"Selected {role} asset {asset_id!r} is not cleared for export")
    return {
        "assetId": asset_id,
        "artifactHash": digest,
        "mediaType": media_type,
        "role": role,
        "source": "project",
        "alt": str(record.get("filename") or f"Selected {role}"),
    }


def _resolve_starter_asset(
    store: ProjectStore,
    asset_id: str,
    *,
    expected_kind: str,
    role: str,
    starter_visual_root: Path,
) -> dict[str, Any]:
    root = starter_visual_root.resolve(strict=True)
    catalog = root / "packages" / "themes" / "starter-kits" / "core.v1.json"
    _regular_file_inside(root, catalog, "starter visual catalog")
    if catalog.stat().st_size > MAX_STARTER_MANIFEST_BYTES:
        raise ValueError("Starter visual catalog exceeds the trust-boundary limit")
    try:
        document = json.loads(catalog.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Starter visual catalog could not be read: {error}") from error
    if not isinstance(document, dict) or document.get("schemaVersion") != 1:
        raise ValueError("Starter visual catalog has an unsupported schema")
    records = document.get("assets")
    if not isinstance(records, list):
        raise ValueError("Starter visual catalog assets must be an array")
    matches = [item for item in records if isinstance(item, dict) and item.get("id") == asset_id]
    if len(matches) != 1:
        raise ValueError(f"Starter visual catalog does not contain exactly one {asset_id!r}")
    item = matches[0]
    if item.get("kind") != expected_kind:
        raise ValueError(f"Starter asset {asset_id!r} has the wrong visual kind")
    source = _mapping(item.get("source"), f"{asset_id}.source")
    technical = _mapping(item.get("technical"), f"{asset_id}.technical")
    license_record = _mapping(item.get("license"), f"{asset_id}.license")
    provenance = _mapping(item.get("provenance"), f"{asset_id}.provenance")
    if (
        source.get("delivery") != "bundled-file"
        or source.get("availability") != "ready"
        or technical.get("renderSafe") is not True
        or technical.get("remoteFetchRequired") is not False
        or license_record.get("exportAllowed") is not True
        or provenance.get("reviewStatus") != "verified"
    ):
        raise ValueError(f"Starter asset {asset_id!r} is not cleared for local rendering")
    media_type = _string(technical.get("mediaType"), f"{asset_id}.mediaType").casefold()
    if media_type not in SUPPORTED_IMAGE_TYPES:
        raise ValueError(f"Starter asset {asset_id!r} uses an unsupported media type")
    relative_path = Path(_string(source.get("relativePath"), f"{asset_id}.relativePath"))
    if relative_path.is_absolute() or any(part in {"", ".", ".."} for part in relative_path.parts):
        raise ValueError(f"Starter asset {asset_id!r} has an unsafe catalog path")
    source_path = root / relative_path
    _regular_file_inside(root, source_path, f"starter asset {asset_id}")
    info = source_path.stat()
    expected_size = source.get("byteSize")
    if (
        info.st_size <= 0
        or info.st_size > MAX_VISUAL_ASSET_BYTES
        or not isinstance(expected_size, int)
        or isinstance(expected_size, bool)
        or expected_size != info.st_size
    ):
        raise ValueError(f"Starter asset {asset_id!r} size does not match its catalog record")
    expected_hash = _sha256(source.get("contentHash"), f"{asset_id}.contentHash")
    content = source_path.read_bytes()
    if hashlib.sha256(content).hexdigest() != expected_hash:
        raise ValueError(f"Starter asset {asset_id!r} hash does not match its catalog record")
    artifact = store.add_artifact_bytes(
        content,
        media_type=media_type,
        original_name=source_path.name,
        metadata={
            "assetId": asset_id,
            "origin": str(provenance.get("origin", "alystria-authored")),
            "rightsStatus": "owned",
            "licenseId": str(license_record.get("expression", "MIT")),
            "creator": str(provenance.get("creator", "Alystria Studio contributors")),
            "starterCatalogId": str(document.get("id", "alystria.starter-kit.core")),
            "sourceHash": expected_hash,
        },
    )
    if artifact.hash != expected_hash:
        raise ValueError(f"Starter asset {asset_id!r} CAS hash changed during promotion")
    return {
        "assetId": asset_id,
        "artifactHash": artifact.hash,
        "mediaType": media_type,
        "role": role,
        "source": "starter",
        "alt": str(item.get("description") or item.get("name") or asset_id),
    }


def _presenter_profile(
    snapshot: Mapping[str, Any], asset_id: str, *, source: str
) -> dict[str, Any]:
    if source == "starter":
        return {
            "displayName": asset_id.split(".")[-1].replace("-v1", "").replace("-", " ").title(),
            "identityType": "synthetic",
            "disclosureRequired": True,
            "modelInputAllowed": True,
        }
    profiles = _records(snapshot.get("presenterProfiles", []), "presenterProfiles")
    matches = [item for item in profiles if item.get("portraitArtifactId") == asset_id]
    if len(matches) != 1:
        raise ValueError("Selected presenter portrait has no unique presenter profile")
    profile = matches[0]
    identity = profile.get("identityType")
    if identity not in {"synthetic", "realPerson"}:
        raise ValueError("Selected presenter profile has an invalid identity type")
    if identity == "realPerson":
        consent_id = profile.get("consentRecordId")
        consents = _records(snapshot.get("consentRecords", []), "consentRecords")
        consent = next((item for item in consents if item.get("id") == consent_id), None)
        if (
            consent is None
            or consent.get("revokedAt") is not None
            or "portraitAnimation" not in consent.get("grants", [])
            or consent.get("syntheticMediaDisclosureRequired") is not True
            or not consent.get("proofArtifactHash")
        ):
            raise ValueError("Selected real-person presenter lacks valid, current consent")
    return {
        "profileId": _string(profile.get("profileId"), "presenter profileId"),
        "displayName": _string(profile.get("displayName"), "presenter displayName"),
        "identityType": identity,
        "disclosureRequired": bool(profile.get("disclosureRequired", True)),
        "modelInputAllowed": True,
    }


def _renderer_placement(placement: str, side: str) -> str:
    if placement == "full-frame":
        return "full_frame"
    if placement == "split":
        return "left" if side == "left" else "right"
    return "picture_in_picture"


def _registered_media_type(store: ProjectStore, digest: str) -> str:
    row = store.connection.execute(
        "SELECT media_type FROM artifacts WHERE hash=?", (digest,)
    ).fetchone()
    if row is None:
        raise ValueError("Selected visual artifact is not registered")
    return str(row["media_type"]).casefold()


def _record_index(
    value: object, label: str, *, key: str = "id"
) -> dict[str, Mapping[str, Any]]:
    records = _records(value, label)
    result: dict[str, Mapping[str, Any]] = {}
    for index, record in enumerate(records):
        record_id = _string(record.get(key), f"{label}[{index}].{key}")
        if record_id in result:
            raise ValueError(f"{label} contains duplicate ID {record_id!r}")
        result[record_id] = record
    return result


def _records(value: object, label: str) -> list[Mapping[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{label} must be an array")
    result: list[Mapping[str, Any]] = []
    for index, item in enumerate(value):
        result.append(_mapping(item, f"{label}[{index}]"))
    return result


def _mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    return value


def _string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 1_000:
        raise ValueError(f"{label} must be a bounded non-empty string")
    return value.strip()


def _sha256(value: object, label: str) -> str:
    digest = _string(value, label).casefold()
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise ValueError(f"{label} must be a SHA-256 digest")
    return digest


def _enum(value: object, allowed: set[str], label: str) -> str:
    item = _string(value, label)
    if item not in allowed:
        raise ValueError(f"{label} must be one of {', '.join(sorted(allowed))}")
    return item


def _number(value: object, minimum: float, maximum: float, label: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result) or result < minimum or result > maximum:
        raise ValueError(f"{label} must be between {minimum} and {maximum}")
    return result


def _integer(value: object, minimum: int, maximum: int, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum or value > maximum:
        raise ValueError(f"{label} must be an integer between {minimum} and {maximum}")
    return value


def _color(value: object, label: str) -> str:
    color = _string(value, label).upper()
    if not HEX_COLOR.fullmatch(color):
        raise ValueError(f"{label} must be a six-digit hexadecimal color")
    return color


def _font_family(value: object, label: str) -> str:
    family = _string(value, label)
    if not FONT_FAMILY.fullmatch(family):
        raise ValueError(f"{label} contains unsupported font-family characters")
    return family


def _regular_file_inside(root: Path, path: Path, label: str) -> None:
    try:
        resolved = path.resolve(strict=True)
        resolved.relative_to(root)
        info = path.lstat()
    except (OSError, ValueError) as error:
        raise ValueError(f"{label} is unavailable or escapes its runtime root") from error
    if path.is_symlink() or not resolved.is_file() or info.st_size <= 0:
        raise ValueError(f"{label} must be a non-empty regular file")
