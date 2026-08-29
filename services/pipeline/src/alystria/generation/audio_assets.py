"""Resolve explicit project audio choices to immutable render inputs.

The studio snapshot stores opaque asset IDs.  This module is the trust boundary
that turns those IDs into hash-bound CAS artifacts.  Callers never supply a
filesystem path: user media must already exist in the project's asset ledger,
while bundled media is resolved only through Alystria's signed/runtime-owned
starter catalog and verified byte-for-byte before CAS promotion.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Literal

from alystria.project import ProjectStore

AudioRole = Literal["music", "sfx"]

MAX_STARTER_CATALOG_BYTES = 2 * 1024 * 1024
MAX_STARTER_AUDIO_BYTES = 64 * 1024 * 1024
SUPPORTED_AUDIO_MEDIA_TYPES = frozenset(
    {"audio/wav", "audio/x-wav", "audio/flac", "audio/mpeg", "audio/mp4", "audio/ogg"}
)
EXPECTED_PROJECT_KINDS: dict[AudioRole, str] = {
    "music": "music",
    "sfx": "soundEffect",
}
EXPECTED_STARTER_KINDS: dict[AudioRole, frozenset[str]] = {
    "music": frozenset({"music"}),
    "sfx": frozenset({"sfx", "stinger"}),
}
LEGACY_STARTER_ALIASES = {
    "music-light-pulse": "starter.audio.music.focus-loop",
    "music-documentary-bed": "starter.audio.music.inquiry-loop",
    "sfx-quiet-cues": "starter.audio.sfx.emphasis-a",
    "sfx-technical": "starter.audio.sfx.emphasis-b",
}


def resolve_audio_customization(
    store: ProjectStore,
    snapshot: Mapping[str, Any],
    *,
    starter_audio_root: Path | None = None,
) -> dict[str, Any]:
    """Return renderer-safe audio bindings for one durable project snapshot.

    No choice means no binding.  This keeps music and sound effects off by
    default, even when a theme advertises optional alternatives.
    """

    customization_value = snapshot.get("customization")
    if customization_value is None:
        return _empty_policy()
    customization = _mapping(customization_value, "Project customization")
    audio_value = customization.get("audio")
    if audio_value is None:
        return _empty_policy()
    audio = _mapping(audio_value, "Project audio customization")

    media_assets = _record_index(snapshot.get("mediaAssets", []), "mediaAssets")
    provenance = _record_index(
        snapshot.get("assetProvenance", []), "assetProvenance", key="assetId"
    )
    selections: list[dict[str, Any]] = []
    choice_fields: tuple[tuple[AudioRole, str, str], ...] = (
        ("music", "musicAssetId", "musicLevel"),
        ("sfx", "sfxAssetId", "sfxLevel"),
    )
    for role, field, level_field in choice_fields:
        selected = audio.get(field)
        if selected is None or selected in {"", "music-none", "sfx-none"}:
            continue
        if not isinstance(selected, str) or len(selected) > 160:
            raise ValueError(f"{field} must be a bounded asset ID or null")
        canonical_id = LEGACY_STARTER_ALIASES.get(selected, selected)
        level = _percentage(audio.get(level_field, 0), level_field)
        if level == 0:
            continue
        if canonical_id.startswith("starter.audio."):
            binding = _resolve_starter_asset(
                store,
                canonical_id,
                role=role,
                starter_audio_root=starter_audio_root,
            )
        else:
            binding = _resolve_project_asset(
                store,
                canonical_id,
                role=role,
                media_assets=media_assets,
                provenance=provenance,
            )
        selections.append(
            {
                **binding,
                "gainDb": _linear_percent_to_db(level),
                "schedule": "full-program-loop" if role == "music" else "scene-emphasis",
            }
        )

    ducking = _percentage(audio.get("narrationDucking", 72), "narrationDucking")
    return {
        "schemaVersion": 1,
        "inputs": selections,
        "mix": {
            # The renderer interprets this as the maximum gain reduction for
            # music while narration or audio description is active.
            "musicDuckingDb": round(-18.0 * ducking / 100.0, 2),
        },
    }


def _empty_policy() -> dict[str, Any]:
    return {"schemaVersion": 1, "inputs": [], "mix": {"musicDuckingDb": -12.96}}


def _resolve_project_asset(
    store: ProjectStore,
    asset_id: str,
    *,
    role: AudioRole,
    media_assets: Mapping[str, Mapping[str, Any]],
    provenance: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    record = media_assets.get(asset_id)
    if record is None:
        raise ValueError(f"Selected {role} asset {asset_id!r} is not in the project asset ledger")
    if record.get("kind") != EXPECTED_PROJECT_KINDS[role]:
        raise ValueError(f"Selected {role} asset {asset_id!r} has the wrong media kind")
    if record.get("state") != "promoted":
        raise ValueError(f"Selected {role} asset {asset_id!r} is not promoted")
    digest = _sha256(record.get("artifactHash"), f"{asset_id} artifactHash")
    registered_media_type = _registered_media_type(store, digest)
    declared_media_type = _string(record.get("mediaType"), f"{asset_id} mediaType").casefold()
    if declared_media_type != registered_media_type:
        raise ValueError(f"Selected {role} asset {asset_id!r} media type does not match CAS")
    if registered_media_type not in SUPPORTED_AUDIO_MEDIA_TYPES:
        raise ValueError(f"Selected {role} asset {asset_id!r} is not an allowed audio format")
    if not store.cas.verify(digest):
        raise ValueError(f"Selected {role} asset {asset_id!r} is missing or corrupt")

    proof = provenance.get(asset_id)
    if proof is None:
        raise ValueError(f"Selected {role} asset {asset_id!r} has no provenance record")
    if proof.get("contentHash") != digest:
        raise ValueError(f"Selected {role} asset {asset_id!r} provenance hash does not match")
    if proof.get("exportEligible") is not True or proof.get("blockers") not in (None, []):
        raise ValueError(f"Selected {role} asset {asset_id!r} is not cleared for export")
    return {
        "assetId": asset_id,
        "artifactHash": digest,
        "mediaType": registered_media_type,
        "role": role,
        "source": "project",
    }


def _resolve_starter_asset(
    store: ProjectStore,
    asset_id: str,
    *,
    role: AudioRole,
    starter_audio_root: Path | None,
) -> dict[str, Any]:
    if starter_audio_root is None:
        raise ValueError(
            f"Selected starter audio {asset_id!r} is unavailable because the verified starter-audio runtime is not installed"
        )
    root = starter_audio_root.resolve(strict=True)
    catalog_path = root / "catalog.json"
    _regular_file_inside(root, catalog_path, "starter audio catalog")
    if catalog_path.stat().st_size > MAX_STARTER_CATALOG_BYTES:
        raise ValueError("Starter audio catalog exceeds the 2 MiB trust-boundary limit")
    try:
        document = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Starter audio catalog could not be read: {error}") from error
    if not isinstance(document, dict) or document.get("schemaVersion") != 1:
        raise ValueError("Starter audio catalog has an unsupported schema")
    assets_value = document.get("assets")
    if not isinstance(assets_value, list):
        raise ValueError("Starter audio catalog assets must be an array")
    matches = [item for item in assets_value if isinstance(item, dict) and item.get("id") == asset_id]
    if len(matches) != 1:
        raise ValueError(f"Starter audio catalog does not contain exactly one {asset_id!r}")
    item = matches[0]
    if item.get("kind") not in EXPECTED_STARTER_KINDS[role]:
        raise ValueError(f"Starter asset {asset_id!r} is not valid for the {role} bus")
    media_type = _string(item.get("mimeType"), f"{asset_id} mimeType").casefold()
    if media_type not in SUPPORTED_AUDIO_MEDIA_TYPES:
        raise ValueError(f"Starter asset {asset_id!r} uses an unsupported audio format")
    relative_path = Path(_string(item.get("path"), f"{asset_id} path"))
    if relative_path.is_absolute() or any(part in {"", ".", ".."} for part in relative_path.parts):
        raise ValueError(f"Starter asset {asset_id!r} has an unsafe catalog path")
    source = root / relative_path
    _regular_file_inside(root, source, f"starter asset {asset_id}")
    info = source.stat()
    if info.st_size <= 0 or info.st_size > MAX_STARTER_AUDIO_BYTES:
        raise ValueError(f"Starter asset {asset_id!r} has an invalid byte size")
    expected_size = item.get("bytes")
    if not isinstance(expected_size, int) or isinstance(expected_size, bool) or expected_size != info.st_size:
        raise ValueError(f"Starter asset {asset_id!r} size does not match the catalog")
    expected_hash = _sha256(item.get("sha256"), f"{asset_id} sha256")
    content = source.read_bytes()
    if hashlib.sha256(content).hexdigest() != expected_hash:
        raise ValueError(f"Starter asset {asset_id!r} hash does not match the catalog")
    artifact = store.add_artifact_bytes(
        content,
        media_type=media_type,
        original_name=source.name,
        metadata={
            "assetId": asset_id,
            "origin": "alystria-authored",
            "rightsStatus": "owned",
            "licenseId": str(document.get("licenseExpression", "MIT")),
            "creator": str(document.get("creator", "Alystria Studio contributors")),
            "starterCatalogId": str(document.get("catalogId", "alystria.starter-audio.v1")),
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
    }


def _registered_media_type(store: ProjectStore, digest: str) -> str:
    row = store.connection.execute(
        "SELECT media_type FROM artifacts WHERE hash = ?", (digest,)
    ).fetchone()
    if row is None:
        raise ValueError("Selected audio artifact is not registered")
    return str(row["media_type"]).casefold()


def _record_index(value: object, label: str, *, key: str = "id") -> dict[str, Mapping[str, Any]]:
    if not isinstance(value, list):
        raise ValueError(f"{label} must be an array")
    result: dict[str, Mapping[str, Any]] = {}
    for index, item in enumerate(value):
        record = _mapping(item, f"{label}[{index}]")
        record_id = _string(record.get(key), f"{label}[{index}].{key}")
        if record_id in result:
            raise ValueError(f"{label} contains duplicate ID {record_id!r}")
        result[record_id] = record
    return result


def _mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    return value


def _string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value


def _sha256(value: object, label: str) -> str:
    digest = _string(value, label).casefold()
    if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise ValueError(f"{label} must be a SHA-256 digest")
    return digest


def _percentage(value: object, label: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result) or result < 0 or result > 100:
        raise ValueError(f"{label} must be between 0 and 100")
    return result


def _linear_percent_to_db(percent: float) -> float:
    if percent <= 0:
        return -96.0
    return round(max(-60.0, 20.0 * math.log10(percent / 100.0)), 2)


def _regular_file_inside(root: Path, path: Path, label: str) -> None:
    try:
        resolved = path.resolve(strict=True)
        resolved.relative_to(root)
        info = path.lstat()
    except (OSError, ValueError) as error:
        raise ValueError(f"{label} is unavailable or escapes its runtime root") from error
    if path.is_symlink() or not resolved.is_file() or info.st_size <= 0:
        raise ValueError(f"{label} must be a non-empty regular file")
