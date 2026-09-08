"""Durable, narrowly validated project visual-bible customization.

The webview may choose presentation settings and opaque asset IDs, but it may
not replace the rest of the project snapshot or smuggle paths, executable
content, credentials, or embedded bytes through this command.
"""

from __future__ import annotations

import copy
import re
import unicodedata
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlsplit

from .project import ProjectHistory, ProjectStore

_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
_HEX_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")

_ASSET_KINDS = frozenset({"presenter", "background", "element", "font", "music", "sfx"})
_DURABLE_KINDS = {
    "presenter": "presenterPortrait",
    "background": "backgroundImage",
    "element": "editorImage",
    "font": "font",
    "music": "music",
    "sfx": "soundEffect",
}


def save_project_customization(store: ProjectStore, params: Mapping[str, Any]) -> dict[str, Any]:
    """Merge a validated customization snapshot into the current project head."""

    _exact_keys(
        params,
        required={
            "projectId",
            "projectDirectory",
            "expectedHeadRevisionId",
            "customization",
        },
        optional={"message"},
        label="project customization save",
    )
    expected_head = _identifier(params.get("expectedHeadRevisionId"), "expectedHeadRevisionId")
    customization = validate_customization(params.get("customization"))
    head = store.head_revision()
    if head is None:
        raise ValueError("project has no durable snapshot")
    if head.revision_id != expected_head:
        from .project.errors import RevisionConflictError

        raise RevisionConflictError(
            f"Expected head {expected_head}, but current head is {head.revision_id}"
        )
    _validate_asset_bindings(customization, head.snapshot)
    snapshot = copy.deepcopy(head.snapshot)
    snapshot["customization"] = customization
    message_value = params.get("message") or "Updated visual bible customization"
    message = _printable(message_value, "message", 500)
    revision = store.create_revision(
        snapshot=snapshot,
        kind="edit",
        message=message,
        expected_head=expected_head,
    )
    ProjectHistory(store).record_new_revision(head.revision_id, revision)
    return {
        "projectId": store.manifest.project_id,
        "headRevisionId": revision.revision_id,
        "revisionNumber": revision.number,
        "rootHash": revision.root_hash,
        "updatedAt": revision.created_at,
        "customization": customization,
    }


def validate_customization(value: Any) -> dict[str, Any]:
    customization = _object(value, "customization")
    _exact_keys(
        customization,
        required={
            "fontPairId",
            "displayFont",
            "bodyFont",
            "typeScale",
            "lineHeight",
            "fonts",
            "paletteId",
            "colors",
            "backgroundMode",
            "backgroundAssetId",
            "materialStrength",
            "density",
            "contrast",
            "reducedMotion",
            "sceneTreatment",
            "cornerRadius",
            "shadowStrength",
            "captions",
            "presenter",
            "audio",
            "assets",
        },
        optional=set(),
        label="customization",
    )
    result: dict[str, Any] = {
        "fontPairId": _enum(
            customization, "fontPairId", {"editorial", "humanist", "technical", "cinematic", "custom"}
        ),
        "displayFont": _safe_name(customization.get("displayFont"), "displayFont", 160),
        "bodyFont": _safe_name(customization.get("bodyFont"), "bodyFont", 160),
        "typeScale": _integer(customization, "typeScale", 85, 125),
        "lineHeight": _enum(customization, "lineHeight", {"compact", "balanced", "airy"}),
        "fonts": _validate_fonts(customization.get("fonts")),
        "paletteId": _enum(
            customization, "paletteId", {"precision", "midnight", "field-notes", "signal", "custom"}
        ),
        "colors": _validate_colors(customization.get("colors")),
        "backgroundMode": _enum(
            customization, "backgroundMode", {"paper", "grid", "gradient", "image"}
        ),
        "backgroundAssetId": _nullable_identifier(
            customization.get("backgroundAssetId"), "backgroundAssetId"
        ),
        "materialStrength": _integer(customization, "materialStrength", 0, 100),
        "density": _enum(customization, "density", {"compact", "balanced", "spacious"}),
        "contrast": _enum(customization, "contrast", {"standard", "high"}),
        "reducedMotion": _boolean(customization, "reducedMotion"),
        "sceneTreatment": _enum(
            customization, "sceneTreatment", {"edge-to-edge", "card", "editorial-frame"}
        ),
        "cornerRadius": _integer(customization, "cornerRadius", 0, 64),
        "shadowStrength": _integer(customization, "shadowStrength", 0, 100),
        "captions": _validate_captions(customization.get("captions")),
        "presenter": _validate_presenter(customization.get("presenter")),
        "audio": _validate_audio(customization.get("audio")),
        "assets": _validate_assets(customization.get("assets")),
    }
    _validate_selection_kinds(result)
    return result


def _validate_colors(value: Any) -> dict[str, str]:
    colors = _object(value, "colors")
    _exact_keys(colors, required={"paper", "ink", "accent", "evidence"}, optional=set(), label="colors")
    return {field: _color(colors.get(field), f"colors.{field}") for field in ("paper", "ink", "accent", "evidence")}


def _validate_fonts(value: Any) -> dict[str, str | None]:
    fonts = _object(value, "fonts")
    _exact_keys(
        fonts,
        required={"displayAssetId", "bodyAssetId"},
        optional=set(),
        label="fonts",
    )
    return {
        "displayAssetId": _nullable_identifier(
            fonts.get("displayAssetId"), "fonts.displayAssetId"
        ),
        "bodyAssetId": _nullable_identifier(
            fonts.get("bodyAssetId"), "fonts.bodyAssetId"
        ),
    }


def _validate_captions(value: Any) -> dict[str, Any]:
    captions = _object(value, "captions")
    _exact_keys(
        captions,
        required={"position", "style", "size", "safeInset", "textColor", "panelColor", "maxLines"},
        optional=set(),
        label="captions",
    )
    return {
        "position": _enum(captions, "position", {"auto", "top", "lower-third"}),
        "style": _enum(captions, "style", {"soft-panel", "solid-panel", "outline"}),
        "size": _integer(captions, "size", 80, 140),
        "safeInset": _integer(captions, "safeInset", 5, 18),
        "textColor": _color(captions.get("textColor"), "captions.textColor"),
        "panelColor": _color(captions.get("panelColor"), "captions.panelColor"),
        "maxLines": _integer(captions, "maxLines", 1, 3),
    }


def _validate_presenter(value: Any) -> dict[str, Any]:
    presenter = _object(value, "presenter")
    _exact_keys(
        presenter,
        required={"assetId", "placement", "side", "scale", "crop", "frame"},
        optional={
            "idleAnimation",
            "blink",
            "breathing",
            "restMouth",
            "voiceDirection",
            "preferredVoiceId",
        },
        label="presenter",
    )
    result = {
        "assetId": _nullable_identifier(presenter.get("assetId"), "presenter.assetId"),
        "placement": _enum(
            presenter, "placement", {"off", "picture-in-picture", "split", "full-frame"}
        ),
        "side": _enum(presenter, "side", {"left", "right"}),
        "scale": _integer(presenter, "scale", 28, 100),
        "crop": _enum(presenter, "crop", {"contain", "cover", "portrait"}),
        "frame": _enum(presenter, "frame", {"none", "soft", "keyline"}),
    }
    if "idleAnimation" in presenter:
        result["idleAnimation"] = _boolean(presenter, "idleAnimation")
    if "blink" in presenter:
        result["blink"] = _boolean(presenter, "blink")
    if "breathing" in presenter:
        result["breathing"] = _boolean(presenter, "breathing")
    if "restMouth" in presenter:
        result["restMouth"] = _enum(presenter, "restMouth", {"closed"})
    if "voiceDirection" in presenter:
        result["voiceDirection"] = _printable(
            presenter.get("voiceDirection"), "presenter.voiceDirection", 240
        )
    if "preferredVoiceId" in presenter:
        result["preferredVoiceId"] = _nullable_identifier(
            presenter.get("preferredVoiceId"), "presenter.preferredVoiceId"
        )
    return result


def _validate_audio(value: Any) -> dict[str, Any]:
    audio = _object(value, "audio")
    _exact_keys(
        audio,
        required={"musicAssetId", "sfxAssetId", "musicLevel", "sfxLevel", "narrationDucking"},
        optional=set(),
        label="audio",
    )
    return {
        "musicAssetId": _nullable_identifier(audio.get("musicAssetId"), "audio.musicAssetId"),
        "sfxAssetId": _nullable_identifier(audio.get("sfxAssetId"), "audio.sfxAssetId"),
        "musicLevel": _integer(audio, "musicLevel", 0, 40),
        "sfxLevel": _integer(audio, "sfxLevel", 0, 100),
        "narrationDucking": _integer(audio, "narrationDucking", 30, 90),
    }


def _validate_assets(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) > 256:
        raise ValueError("customization.assets must be an array with at most 256 entries")
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(value):
        asset = _object(raw, f"assets[{index}]")
        _exact_keys(
            asset,
            required={"id", "kind", "label", "source", "creator", "license", "attribution", "rightsStatus"},
            optional={"filename", "mediaType", "byteSize", "sha256", "sourceUrl"},
            label=f"assets[{index}]",
        )
        asset_id = _identifier(asset.get("id"), f"assets[{index}].id")
        if asset_id in seen:
            raise ValueError(f"customization.assets contains duplicate ID {asset_id}")
        seen.add(asset_id)
        kind = _enum(asset, "kind", _ASSET_KINDS)
        source = _enum(
            asset,
            "source",
            {"generated", "licensed-media", "starter-pack", "user-upload"},
        )
        entry: dict[str, Any] = {
            "id": asset_id,
            "kind": kind,
            "label": _printable(asset.get("label"), f"assets[{index}].label", 160),
            "source": source,
            "creator": _printable(asset.get("creator"), f"assets[{index}].creator", 240),
            "license": _printable(asset.get("license"), f"assets[{index}].license", 500),
            "attribution": _printable(asset.get("attribution"), f"assets[{index}].attribution", 500),
            "rightsStatus": _enum(asset, "rightsStatus", {"cleared", "review"}),
        }
        if "filename" in asset:
            filename = _printable(asset.get("filename"), f"assets[{index}].filename", 240)
            if "/" in filename or "\\" in filename or filename in {".", ".."}:
                raise ValueError(f"assets[{index}].filename must not be a path")
            entry["filename"] = filename
        if "mediaType" in asset:
            media_type = _printable(asset.get("mediaType"), f"assets[{index}].mediaType", 127)
            if not re.fullmatch(r"[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*", media_type):
                raise ValueError(f"assets[{index}].mediaType must be a MIME token")
            entry["mediaType"] = media_type
        if "byteSize" in asset:
            entry["byteSize"] = _integer(asset, "byteSize", 1, 64 * 1024 * 1024)
        if "sha256" in asset:
            digest = asset.get("sha256")
            if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
                raise ValueError(f"assets[{index}].sha256 must be lowercase SHA-256")
            entry["sha256"] = digest
        if "sourceUrl" in asset:
            source_url = _printable(asset.get("sourceUrl"), f"assets[{index}].sourceUrl", 2_000)
            parsed = urlsplit(source_url)
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError(f"assets[{index}].sourceUrl must be an HTTPS source URL")
            entry["sourceUrl"] = source_url
        if source in {"generated", "licensed-media", "user-upload"} and not {
            "filename",
            "mediaType",
            "byteSize",
            "sha256",
        } <= entry.keys():
            raise ValueError(f"assets[{index}] durable media lacks immutable metadata")
        if source == "licensed-media" and "sourceUrl" not in entry:
            raise ValueError(f"assets[{index}] licensed media lacks its source URL")
        result.append(entry)
    return result


def _validate_selection_kinds(customization: Mapping[str, Any]) -> None:
    assets = {asset["id"]: asset for asset in customization["assets"]}
    selections = (
        (customization["fonts"]["displayAssetId"], "font", "fonts.displayAssetId"),
        (customization["fonts"]["bodyAssetId"], "font", "fonts.bodyAssetId"),
        (customization["backgroundAssetId"], "background", "backgroundAssetId"),
        (customization["presenter"]["assetId"], "presenter", "presenter.assetId"),
        (customization["audio"]["musicAssetId"], "music", "audio.musicAssetId"),
        (customization["audio"]["sfxAssetId"], "sfx", "audio.sfxAssetId"),
    )
    for asset_id, expected_kind, field in selections:
        if asset_id is None or asset_id in {"music-none", "sfx-none"}:
            continue
        asset = assets.get(asset_id)
        if asset is None:
            raise ValueError(f"{field} must reference customization.assets")
        if asset["kind"] != expected_kind:
            raise ValueError(f"{field} references an asset with the wrong kind")


def _validate_asset_bindings(customization: Mapping[str, Any], snapshot: Mapping[str, Any]) -> None:
    durable_assets: dict[str, Mapping[str, Any]] = {}
    raw_assets = snapshot.get("mediaAssets", [])
    if not isinstance(raw_assets, list):
        raise ValueError("Project mediaAssets ledger is invalid")
    for raw in raw_assets:
        if isinstance(raw, Mapping) and isinstance(raw.get("id"), str):
            durable_assets[str(raw["id"])] = raw
    for asset in customization["assets"]:
        if asset["source"] not in {"generated", "licensed-media", "user-upload"}:
            continue
        durable = durable_assets.get(asset["id"])
        if durable is None:
            raise ValueError(f"Durable asset {asset['id']} is not present in the project ledger")
        if durable.get("kind") != _DURABLE_KINDS[asset["kind"]]:
            raise ValueError(f"Durable asset {asset['id']} has a mismatched durable kind")
        if durable.get("artifactHash") != asset.get("sha256"):
            raise ValueError(f"Durable asset {asset['id']} has a mismatched immutable hash")


def _exact_keys(
    value: Mapping[str, Any], *, required: set[str], optional: set[str], label: str
) -> None:
    keys = set(value)
    missing = required - keys
    unknown = keys - required - optional
    if missing:
        raise ValueError(f"{label} is missing {', '.join(sorted(missing))}")
    if unknown:
        raise ValueError(f"{label} contains unsupported fields: {', '.join(sorted(unknown))}")


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _enum(value: Mapping[str, Any], field: str, allowed: set[str] | frozenset[str]) -> str:
    item = value.get(field)
    if not isinstance(item, str) or item not in allowed:
        raise ValueError(f"{field} has an unsupported value")
    return item


def _integer(value: Mapping[str, Any], field: str, minimum: int, maximum: int) -> int:
    item = value.get(field)
    if isinstance(item, bool) or not isinstance(item, int) or not minimum <= item <= maximum:
        raise ValueError(f"{field} must be an integer from {minimum} to {maximum}")
    return item


def _boolean(value: Mapping[str, Any], field: str) -> bool:
    item = value.get(field)
    if not isinstance(item, bool):
        raise ValueError(f"{field} must be a boolean")
    return item


def _identifier(value: Any, field: str) -> str:
    if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
        raise ValueError(f"{field} must be a bounded opaque identifier")
    return value


def _nullable_identifier(value: Any, field: str) -> str | None:
    return None if value is None else _identifier(value, field)


def _safe_name(value: Any, field: str, maximum: int) -> str:
    result = _printable(value, field, maximum)
    lowered = result.casefold()
    if any(token in result for token in ("/", "\\", "<", ">", "{", "}")) or "://" in lowered:
        raise ValueError(f"{field} must be a font family name, not a path, URL, or code")
    return result


def _printable(value: Any, field: str, maximum: int) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    result = value.strip()
    if (
        not result
        or len(result) > maximum
        or any(unicodedata.category(character).startswith("C") for character in result)
    ):
        raise ValueError(f"{field} must contain 1 to {maximum} printable characters")
    return result


def _color(value: Any, field: str) -> str:
    if not isinstance(value, str) or not _HEX_COLOR.fullmatch(value):
        raise ValueError(f"{field} must be a six- or eight-digit hex color")
    return value.upper()
