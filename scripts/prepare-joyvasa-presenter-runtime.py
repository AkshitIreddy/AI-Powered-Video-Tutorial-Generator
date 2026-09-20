#!/usr/bin/env python3
"""Validate, stage, and optionally activate a reviewed JoyVASA runtime pack.

Dry-run is the default. The script never downloads files and only installs paths
listed in an exact-hash curated manifest. Activation prepares a sibling staging
directory, verifies every installed byte, atomically swaps the runtime directory,
then (when a routes manifest is supplied) backs up and updates the primary
presenter config without changing its existing profiles or defaults.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

SHA256_LENGTH = 64
MAX_CHILD_CONFIG_BYTES = 1024 * 1024
MAX_NESTED_MANIFEST_FILES = 10_000
INSTALL_MANIFEST_NAME = "alystria-install-manifest.json"
RECEIPT_NAME = "install-receipt.json"
CHILD_CONFIGS = {"human": "joy-human.json", "animal": "joy-animal.json"}
ROLE_KEYS = {
    "audio-feature-config": "audioFeatureConfig",
    "audio-feature-preprocessor": "audioFeaturePreprocessor",
    "audio-feature-weights": "audioFeatureWeights",
    "motion-generator-weights": "motionGeneratorWeights",
    "motion-template": "motionTemplate",
}
REQUIRED_JOYVASA_SOURCE_PATHS = frozenset(
    {
        "src/config/argument_config.py",
        "src/config/crop_config.py",
        "src/config/inference_config.py",
        "src/config/models.yaml",
        "src/live_portrait_wmg_wrapper.py",
        "src/modules/dit_talking_head.py",
        "src/live_portrait_wmg_pipeline.py",
        "src/live_portrait_wmg_pipeline_animal.py",
        "src/utils/resources/lip_array.pkl",
        "src/utils/resources/mask_template.png",
    }
)
REQUIRED_PORTRAIT_PATHS = frozenset(
    {
        "pretrained_weights/liveportrait/base_models/appearance_feature_extractor.pth",
        "pretrained_weights/liveportrait/base_models/motion_extractor.pth",
        "pretrained_weights/liveportrait/base_models/spade_generator.pth",
        "pretrained_weights/liveportrait/base_models/warping_module.pth",
        "pretrained_weights/liveportrait_animals/base_models_v1.1/appearance_feature_extractor.pth",
        "pretrained_weights/liveportrait_animals/base_models_v1.1/motion_extractor.pth",
        "pretrained_weights/liveportrait_animals/base_models_v1.1/spade_generator.pth",
        "pretrained_weights/liveportrait_animals/base_models_v1.1/warping_module.pth",
    }
)
EXPECTED_RUNTIME_ROLE_PATHS = {
    "audioFeatureConfig": "pretrained_weights/chinese-hubert-base/config.json",
    "audioFeaturePreprocessor": (
        "pretrained_weights/chinese-hubert-base/preprocessor_config.json"
    ),
    "audioFeatureWeights": "pretrained_weights/chinese-hubert-base/pytorch_model.bin",
    "motionGeneratorWeights": (
        "pretrained_weights/JoyVASA/motion_generator/motion_generator_hubert_chinese.pt"
    ),
    "motionTemplate": "pretrained_weights/JoyVASA/motion_template/motion_template.pkl",
}


class InstallError(RuntimeError):
    """The candidate or requested activation violates the install contract."""


@dataclass(frozen=True, slots=True)
class FileEntry:
    origin: str
    source_path: PurePosixPath
    install_path: PurePosixPath
    sha256: str
    byte_size: int


@dataclass(frozen=True, slots=True)
class TreeFile:
    relative_path: PurePosixPath
    sha256: str
    byte_size: int


@dataclass(frozen=True, slots=True)
class TreeEntry:
    origin: str
    source_path: PurePosixPath
    install_path: PurePosixPath
    sha256: str
    file_count: int
    byte_size: int
    files: tuple[TreeFile, ...]


@dataclass(frozen=True, slots=True)
class RouteEntry:
    runtime: str
    profile: dict[str, str]
    prior_portrait_artifact_hash: str | None


@dataclass(frozen=True, slots=True)
class InstallPlan:
    candidate_root: Path
    repository_root: Path
    destination: Path
    primary_config: Path
    curated_manifest_path: Path
    curated_manifest_sha256: str
    manifest: dict[str, Any]
    files: tuple[FileEntry, ...]
    trees: tuple[TreeEntry, ...]
    routes: tuple[RouteEntry, ...]
    candidate_evidence_sha256: str


def _is_reparse_point(path: Path) -> bool:
    is_junction = getattr(path, "is_junction", None)
    return path.is_symlink() or bool(is_junction is not None and is_junction())


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_json(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _sha256_text(value: object) -> str:
    return hashlib.sha256(_canonical_json(value)).hexdigest()


def _require_object(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise InstallError(f"{label} must be an object")
    return value


def _require_list(value: object, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise InstallError(f"{label} must be a list")
    return value


def _require_string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or "\x00" in value:
        raise InstallError(f"{label} must be a non-empty string")
    return value


def _require_sha256(value: object, label: str) -> str:
    digest = _require_string(value, label)
    if len(digest) != SHA256_LENGTH or any(char not in "0123456789abcdef" for char in digest):
        raise InstallError(f"{label} must be a lowercase SHA-256 digest")
    return digest


def _relative_path(value: object, label: str) -> PurePosixPath:
    raw = _require_string(value, label)
    if "\\" in raw or ":" in raw:
        raise InstallError(f"{label} must use a portable relative path")
    path = PurePosixPath(raw)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise InstallError(f"{label} must stay inside its declared root")
    return path


def _guarded_file(root: Path, relative: PurePosixPath, label: str) -> Path:
    if _is_reparse_point(root):
        raise InstallError(f"{label} root must not be a symbolic link or junction")
    resolved_root = root.resolve(strict=True)
    candidate = resolved_root.joinpath(*relative.parts)
    if _is_reparse_point(candidate):
        raise InstallError(f"{label} must not be a symbolic link or junction")
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(resolved_root)
    except (OSError, ValueError) as error:
        raise InstallError(f"{label} escapes or is missing from its declared root") from error
    if not resolved.is_file():
        raise InstallError(f"{label} must be a regular file")
    return resolved


def _guarded_directory(root: Path, relative: PurePosixPath, label: str) -> Path:
    if _is_reparse_point(root):
        raise InstallError(f"{label} root must not be a symbolic link or junction")
    resolved_root = root.resolve(strict=True)
    candidate = resolved_root.joinpath(*relative.parts)
    if _is_reparse_point(candidate):
        raise InstallError(f"{label} must not be a symbolic link or junction")
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(resolved_root)
    except (OSError, ValueError) as error:
        raise InstallError(f"{label} escapes or is missing from its declared root") from error
    if not resolved.is_dir():
        raise InstallError(f"{label} must be a directory")
    return resolved


def inventory_tree(root: Path) -> tuple[tuple[TreeFile, ...], str, int]:
    """Hash one non-reparse directory tree using canonical relative paths."""

    root = root.resolve(strict=True)
    if _is_reparse_point(root) or not root.is_dir():
        raise InstallError("Dependency tree root must be a regular non-reparse directory")
    pending = [root]
    discovered: list[Path] = []
    while pending:
        directory = pending.pop()
        for child in sorted(directory.iterdir(), key=lambda item: item.name.casefold()):
            if _is_reparse_point(child):
                raise InstallError(f"Dependency tree contains a reparse point: {child}")
            if child.is_dir():
                pending.append(child)
            elif child.is_file():
                discovered.append(child)
            else:
                raise InstallError(f"Dependency tree contains a non-file entry: {child}")
    entries = tuple(
        TreeFile(
            PurePosixPath(path.relative_to(root).as_posix()),
            _sha256(path),
            path.stat().st_size,
        )
        for path in sorted(discovered, key=lambda item: item.relative_to(root).as_posix().casefold())
    )
    ledger = [
        {
            "relativePath": entry.relative_path.as_posix(),
            "bytes": entry.byte_size,
            "sha256": entry.sha256,
        }
        for entry in entries
    ]
    return entries, _sha256_text({"files": ledger}), sum(entry.byte_size for entry in entries)


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        if _is_reparse_point(path) or not path.resolve(strict=True).is_file():
            raise InstallError(f"{label} must be a regular non-reparse file")
        return _require_object(json.loads(path.read_text(encoding="utf-8")), label)
    except InstallError:
        raise
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise InstallError(f"Could not read {label}: {error}") from error


def _nested_string(value: dict[str, Any], dotted_path: str, label: str) -> str:
    current: object = value
    for part in dotted_path.split("."):
        current = _require_object(current, label).get(part)
    return _require_string(current, label)


def _load_file_entries(
    manifest: dict[str, Any], candidate_root: Path, repository_root: Path
) -> tuple[FileEntry, ...]:
    values = _require_list(manifest.get("files"), "files")
    if not values:
        raise InstallError("files must contain at least one reviewed runtime file")
    entries: list[FileEntry] = []
    destinations: set[str] = set()
    for index, raw in enumerate(values):
        item = _require_object(raw, f"files[{index}]")
        origin = _require_string(item.get("origin"), f"files[{index}].origin")
        if origin not in {"candidate", "repository"}:
            raise InstallError(f"files[{index}].origin must be candidate or repository")
        source_path = _relative_path(item.get("sourcePath"), f"files[{index}].sourcePath")
        install_path = _relative_path(item.get("installPath"), f"files[{index}].installPath")
        collision_key = install_path.as_posix().casefold()
        if collision_key in destinations:
            raise InstallError(f"Duplicate install path: {install_path.as_posix()}")
        destinations.add(collision_key)
        digest = _require_sha256(item.get("sha256"), f"files[{index}].sha256")
        byte_size = item.get("bytes")
        if not isinstance(byte_size, int) or isinstance(byte_size, bool) or byte_size < 0:
            raise InstallError(f"files[{index}].bytes must be a non-negative integer")
        source_root = candidate_root if origin == "candidate" else repository_root
        source = _guarded_file(source_root, source_path, f"files[{index}]")
        if source.stat().st_size != byte_size or _sha256(source) != digest:
            raise InstallError(
                f"Reviewed source file changed: {origin}:{source_path.as_posix()}"
            )
        entries.append(FileEntry(origin, source_path, install_path, digest, byte_size))
    return tuple(entries)


def _load_tree_entries(
    manifest: dict[str, Any], candidate_root: Path, repository_root: Path
) -> tuple[TreeEntry, ...]:
    values = _require_list(manifest.get("trees", []), "trees")
    entries: list[TreeEntry] = []
    destinations: set[str] = set()
    for index, raw in enumerate(values):
        item = _require_object(raw, f"trees[{index}]")
        origin = _require_string(item.get("origin"), f"trees[{index}].origin")
        if origin not in {"candidate", "repository"}:
            raise InstallError(f"trees[{index}].origin must be candidate or repository")
        source_path = _relative_path(item.get("sourcePath"), f"trees[{index}].sourcePath")
        install_path = _relative_path(item.get("installPath"), f"trees[{index}].installPath")
        key = install_path.as_posix().casefold()
        if key in destinations:
            raise InstallError(f"Duplicate install tree: {install_path.as_posix()}")
        destinations.add(key)
        expected_digest = _require_sha256(item.get("sha256"), f"trees[{index}].sha256")
        expected_count = item.get("fileCount")
        expected_bytes = item.get("bytes")
        if not isinstance(expected_count, int) or isinstance(expected_count, bool) or expected_count < 1:
            raise InstallError(f"trees[{index}].fileCount must be a positive integer")
        if not isinstance(expected_bytes, int) or isinstance(expected_bytes, bool) or expected_bytes < 1:
            raise InstallError(f"trees[{index}].bytes must be a positive integer")
        source_root = candidate_root if origin == "candidate" else repository_root
        source = _guarded_directory(source_root, source_path, f"trees[{index}]")
        files, digest, byte_size = inventory_tree(source)
        if len(files) != expected_count or byte_size != expected_bytes or digest != expected_digest:
            raise InstallError(
                f"Reviewed source tree changed: {origin}:{source_path.as_posix()}"
            )
        entries.append(
            TreeEntry(
                origin,
                source_path,
                install_path,
                digest,
                expected_count,
                byte_size,
                files,
            )
        )
    return tuple(entries)


def _load_routes(path: Path | None) -> tuple[RouteEntry, ...]:
    if path is None:
        return ()
    value = _read_json(path, "portrait routes manifest")
    if value.get("schemaVersion") != 1:
        raise InstallError("portrait routes manifest requires schemaVersion 1")
    raw_routes = _require_list(value.get("routes"), "portrait routes")
    routes: list[RouteEntry] = []
    seen_hashes: set[str] = set()
    seen_prior_hashes: set[str] = set()
    seen_profiles: set[str] = set()
    for index, raw in enumerate(raw_routes):
        item = _require_object(raw, f"routes[{index}]")
        runtime = _require_string(item.get("runtime"), f"routes[{index}].runtime")
        if runtime not in CHILD_CONFIGS:
            raise InstallError(f"routes[{index}].runtime must be human or animal")
        profile = {
            "profileId": _require_string(item.get("profileId"), f"routes[{index}].profileId"),
            "portraitArtifactHash": _require_sha256(
                item.get("portraitArtifactHash"),
                f"routes[{index}].portraitArtifactHash",
            ),
        }
        for optional in ("consentId", "subjectId"):
            if optional in item:
                profile[optional] = _require_string(item.get(optional), f"routes[{index}].{optional}")
        prior_hash = None
        if "priorPortraitArtifactHash" in item:
            prior_hash = _require_sha256(
                item.get("priorPortraitArtifactHash"),
                f"routes[{index}].priorPortraitArtifactHash",
            )
            if prior_hash == profile["portraitArtifactHash"]:
                raise InstallError("portrait route migration hashes must be different")
            if prior_hash in seen_prior_hashes:
                raise InstallError("prior portrait route hashes must be unique")
            seen_prior_hashes.add(prior_hash)
        if profile["portraitArtifactHash"] in seen_hashes:
            raise InstallError("portrait route hashes must be unique")
        if profile["profileId"] in seen_profiles:
            raise InstallError("portrait route profile IDs must be unique")
        seen_hashes.add(profile["portraitArtifactHash"])
        seen_profiles.add(profile["profileId"])
        routes.append(RouteEntry(runtime, profile, prior_hash))
    overlap = seen_hashes & seen_prior_hashes
    if overlap:
        raise InstallError("prior portrait hashes cannot be current route hashes")
    return tuple(routes)


def build_plan(
    *,
    candidate_root: Path,
    repository_root: Path,
    destination: Path,
    primary_config: Path,
    curated_manifest_path: Path,
    routes_manifest_path: Path | None,
) -> InstallPlan:
    if _is_reparse_point(candidate_root) or _is_reparse_point(repository_root):
        raise InstallError("Candidate and repository roots must not be reparse points")
    candidate_root = candidate_root.resolve(strict=True)
    repository_root = repository_root.resolve(strict=True)
    curated = _read_json(curated_manifest_path, "curated install manifest")
    if curated.get("schemaVersion") != 1:
        raise InstallError("curated install manifest requires schemaVersion 1")
    _require_string(curated.get("packId"), "packId")
    revision = _require_string(curated.get("sourceRevision"), "sourceRevision")
    if len(revision) < 7 or any(char not in "0123456789abcdef" for char in revision):
        raise InstallError("sourceRevision must be a lowercase Git commit digest")
    candidate_evidence = _require_object(curated.get("candidateEvidence"), "candidateEvidence")
    evidence_relative = _relative_path(
        candidate_evidence.get("relativePath"), "candidateEvidence.relativePath"
    )
    evidence_digest = _require_sha256(
        candidate_evidence.get("sha256"), "candidateEvidence.sha256"
    )
    evidence_path = _guarded_file(candidate_root, evidence_relative, "candidate evidence")
    if _sha256(evidence_path) != evidence_digest:
        raise InstallError("Candidate evidence manifest changed after review")
    evidence = _read_json(evidence_path, "candidate evidence manifest")
    commit_path = _require_string(
        candidate_evidence.get("sourceRevisionField", "source.commit"),
        "candidateEvidence.sourceRevisionField",
    )
    if _nested_string(evidence, commit_path, "candidate source revision") != revision:
        raise InstallError("Candidate source revision does not match the curated manifest")

    primary = _read_json(primary_config, "primary presenter config")
    if primary.get("schemaVersion") != 1:
        raise InstallError("primary presenter config requires schemaVersion 1")
    if primary.get("executionPolicy") != "unsafe-test-only":
        raise InstallError(
            "This staged installer only supports the current unsafe-test-only execution policy"
        )
    if primary.get("networkPolicy") != "not-enforced":
        raise InstallError(
            "This staged installer must not claim supervisor network denial"
        )
    if primary.get("unsafeTestOnlyAcknowledged") is not True:
        raise InstallError("Primary presenter config lacks the unsafe-test-only acknowledgement")
    if not isinstance(primary.get("gpuLease"), dict):
        raise InstallError("Primary presenter config must provide GPU lease metadata")
    if not isinstance(primary.get("presenterEncoding"), dict):
        raise InstallError("Primary presenter config must provide presenter encoding policy")

    files = _load_file_entries(curated, candidate_root, repository_root)
    trees = _load_tree_entries(curated, candidate_root, repository_root)
    explicit_paths = {entry.install_path.as_posix().casefold() for entry in files}
    for tree in trees:
        tree_path = tree.install_path.as_posix().casefold()
        if any(
            path == tree_path or path.startswith(tree_path + "/") or tree_path.startswith(path + "/")
            for path in explicit_paths
        ):
            raise InstallError("Installed file and tree destinations must not overlap")
    routes = _load_routes(routes_manifest_path)
    requested_destination = destination
    if requested_destination.exists() and _is_reparse_point(requested_destination):
        raise InstallError("Destination must not be a symbolic link or junction")
    destination = requested_destination.resolve(strict=False)
    primary_config = primary_config.resolve(strict=True)
    try:
        destination.relative_to(primary_config.parent.resolve(strict=True))
    except ValueError as error:
        raise InstallError("Destination must stay inside the primary config directory") from error
    if destination == primary_config.parent:
        raise InstallError("Destination must be a child runtime directory")
    cursor = destination.parent
    config_root = primary_config.parent.resolve(strict=True)
    while True:
        if cursor.exists() and _is_reparse_point(cursor):
            raise InstallError("Destination ancestry must not contain a reparse point")
        if cursor == config_root:
            break
        cursor = cursor.parent
    return InstallPlan(
        candidate_root=candidate_root,
        repository_root=repository_root,
        destination=destination,
        primary_config=primary_config,
        curated_manifest_path=curated_manifest_path.resolve(strict=True),
        curated_manifest_sha256=_sha256(curated_manifest_path.resolve(strict=True)),
        manifest=curated,
        files=files,
        trees=trees,
        routes=routes,
        candidate_evidence_sha256=evidence_digest,
    )


def _entry_by_install_path(plan: InstallPlan) -> dict[str, FileEntry]:
    return {entry.install_path.as_posix(): entry for entry in plan.files}


def _runtime_path(manifest: dict[str, Any], key: str) -> PurePosixPath:
    runtime = _require_object(manifest.get("runtime"), "runtime")
    return _relative_path(runtime.get(key), f"runtime.{key}")


def _validate_runtime_references(plan: InstallPlan) -> None:
    installed = _entry_by_install_path(plan)
    runtime = _require_object(plan.manifest.get("runtime"), "runtime")
    required = {
        "executable",
        "ffmpeg",
        "ffprobe",
        "workerEntrypoint",
        "adapterEntrypoint",
        *ROLE_KEYS.values(),
    }
    for key in sorted(required):
        path = _runtime_path(plan.manifest, key).as_posix()
        if path not in installed:
            raise InstallError(f"runtime.{key} does not name an installed reviewed file")
    for key, expected_path in EXPECTED_RUNTIME_ROLE_PATHS.items():
        if _runtime_path(plan.manifest, key).as_posix() != expected_path:
            raise InstallError(f"runtime.{key} must identify {expected_path}")
    manifest_paths: dict[str, set[str]] = {}
    for list_key in ("sourceManifestFiles", "portraitRuntimeManifestFiles", "pinnedFiles"):
        values = _require_list(runtime.get(list_key, []), f"runtime.{list_key}")
        if list_key != "pinnedFiles" and not values:
            raise InstallError(f"runtime.{list_key} must not be empty")
        if list_key != "pinnedFiles" and len(values) > MAX_NESTED_MANIFEST_FILES:
            raise InstallError(
                f"runtime.{list_key} exceeds the worker's {MAX_NESTED_MANIFEST_FILES}-file limit"
            )
        seen: set[str] = set()
        for index, value in enumerate(values):
            path = _relative_path(value, f"runtime.{list_key}[{index}]").as_posix()
            if path not in installed:
                raise InstallError(f"runtime.{list_key}[{index}] is not installed")
            if path in seen:
                raise InstallError(f"runtime.{list_key} contains duplicate paths")
            seen.add(path)
        manifest_paths[list_key] = seen
    missing_source = REQUIRED_JOYVASA_SOURCE_PATHS - manifest_paths["sourceManifestFiles"]
    if missing_source:
        raise InstallError(
            "runtime.sourceManifestFiles is missing adapter-selected source paths: "
            + ", ".join(sorted(missing_source))
        )
    missing_portrait = REQUIRED_PORTRAIT_PATHS - manifest_paths["portraitRuntimeManifestFiles"]
    if missing_portrait:
        raise InstallError(
            "runtime.portraitRuntimeManifestFiles is missing selected checkpoints: "
            + ", ".join(sorted(missing_portrait))
        )
    python_runtime = _require_object(runtime.get("pythonRuntime"), "runtime.pythonRuntime")
    python_kind = _require_string(
        python_runtime.get("kind"), "runtime.pythonRuntime.kind"
    )
    if python_kind not in {"embedded", "venv"}:
        raise InstallError("runtime.pythonRuntime.kind must be embedded or venv")
    python_home = _relative_path(
        python_runtime.get("home"), "runtime.pythonRuntime.home"
    )
    home_executable = _relative_path(
        python_runtime.get("homeExecutable"), "runtime.pythonRuntime.homeExecutable"
    )
    if home_executable.as_posix() not in installed:
        raise InstallError("runtime.pythonRuntime.homeExecutable is not installed")
    if home_executable.parts[: len(python_home.parts)] != python_home.parts:
        raise InstallError("runtime.pythonRuntime.homeExecutable must stay inside its home")
    if _runtime_path(plan.manifest, "executable") != home_executable and python_kind == "embedded":
        raise InstallError("Embedded Python must be the configured runtime executable")
    if python_kind == "embedded":
        site_packages = _relative_path(
            python_runtime.get("sitePackages"), "runtime.pythonRuntime.sitePackages"
        )
        if not any(tree.install_path == site_packages for tree in plan.trees):
            raise InstallError("Embedded Python sitePackages must name an attested install tree")
        if "venvConfig" in python_runtime:
            raise InstallError("Embedded Python must not declare a venvConfig")
    else:
        venv_config = _relative_path(
            python_runtime.get("venvConfig"), "runtime.pythonRuntime.venvConfig"
        )
        reserved_generated = {
            *CHILD_CONFIGS.values(),
            RECEIPT_NAME,
            "manifests/runtime-source.json",
            "manifests/portrait-runtime.json",
        }
        if venv_config.as_posix() in installed or venv_config.as_posix() in reserved_generated:
            raise InstallError(
                "runtime.pythonRuntime.venvConfig must be a distinct generated path"
            )
        _require_string(python_runtime.get("version"), "runtime.pythonRuntime.version")
    profiles = _require_object(plan.manifest.get("canonicalProfiles"), "canonicalProfiles")
    for runtime_name in CHILD_CONFIGS:
        profile = _require_object(profiles.get(runtime_name), f"canonicalProfiles.{runtime_name}")
        _require_string(profile.get("profileId"), f"canonicalProfiles.{runtime_name}.profileId")
        _require_sha256(
            profile.get("portraitArtifactHash"),
            f"canonicalProfiles.{runtime_name}.portraitArtifactHash",
        )


def _copy_entry(plan: InstallPlan, entry: FileEntry, stage: Path, transfer: str) -> str:
    source_root = plan.candidate_root if entry.origin == "candidate" else plan.repository_root
    source = _guarded_file(source_root, entry.source_path, "reviewed source file")
    target = stage.joinpath(*entry.install_path.parts)
    target.parent.mkdir(parents=True, exist_ok=True)
    method = "copy"
    # Repository worker/adapter files are active development sources. Copy them
    # even when immutable candidate payloads are hardlinked so later edits cannot
    # mutate an activated runtime behind its exact-hash receipt.
    allow_hardlink = entry.origin == "candidate" and transfer in {"auto", "hardlink"}
    if allow_hardlink:
        try:
            os.link(source, target)
            method = "hardlink"
        except OSError:
            if transfer == "hardlink":
                raise
            shutil.copy2(source, target)
    else:
        shutil.copy2(source, target)
    if target.stat().st_size != entry.byte_size or _sha256(target) != entry.sha256:
        raise InstallError(f"Installed file verification failed: {entry.install_path.as_posix()}")
    return method


def _copy_tree(plan: InstallPlan, tree: TreeEntry, stage: Path, transfer: str) -> dict[str, int]:
    source_root = plan.candidate_root if tree.origin == "candidate" else plan.repository_root
    source_tree = _guarded_directory(source_root, tree.source_path, "reviewed source tree")
    target_tree = stage.joinpath(*tree.install_path.parts)
    counts = {"copy": 0, "hardlink": 0}
    for file in tree.files:
        source = _guarded_file(source_tree, file.relative_path, "reviewed tree file")
        target = target_tree.joinpath(*file.relative_path.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        allow_hardlink = tree.origin == "candidate" and transfer in {"auto", "hardlink"}
        method = "copy"
        if allow_hardlink:
            try:
                os.link(source, target)
                method = "hardlink"
            except OSError:
                if transfer == "hardlink":
                    raise
                shutil.copy2(source, target)
        else:
            shutil.copy2(source, target)
        if target.stat().st_size != file.byte_size or _sha256(target) != file.sha256:
            raise InstallError(
                "Installed dependency verification failed: "
                + (tree.install_path / file.relative_path).as_posix()
            )
        counts[method] += 1
    return counts


def _pin(entry: FileEntry) -> dict[str, str]:
    return {"relativePath": entry.install_path.as_posix(), "sha256": entry.sha256}


def _generated_pin(path: PurePosixPath, target: Path) -> dict[str, str]:
    return {"relativePath": path.as_posix(), "sha256": _sha256(target)}


def _profile(value: dict[str, Any], label: str) -> dict[str, str]:
    result = {
        "profileId": _require_string(value.get("profileId"), f"{label}.profileId"),
        "portraitArtifactHash": _require_sha256(
            value.get("portraitArtifactHash"), f"{label}.portraitArtifactHash"
        ),
    }
    for key in ("consentId", "subjectId"):
        if key in value:
            result[key] = _require_string(value.get(key), f"{label}.{key}")
    return result


def _write_stage(plan: InstallPlan, stage: Path, transfer: str) -> dict[str, Any]:
    _validate_runtime_references(plan)
    stage.mkdir(parents=True, exist_ok=False)
    transfer_counts = {"copy": 0, "hardlink": 0}
    for entry in plan.files:
        method = _copy_entry(plan, entry, stage, transfer)
        transfer_counts[method] += 1
    for tree in plan.trees:
        tree_counts = _copy_tree(plan, tree, stage, transfer)
        for method, count in tree_counts.items():
            transfer_counts[method] += count
    installed = _entry_by_install_path(plan)
    runtime = _require_object(plan.manifest["runtime"], "runtime")

    python_runtime = _require_object(runtime["pythonRuntime"], "runtime.pythonRuntime")
    generated_python_files: list[PurePosixPath] = []
    if python_runtime["kind"] == "venv":
        python_home = _relative_path(
            python_runtime["home"], "runtime.pythonRuntime.home"
        )
        venv_config_path = _relative_path(
            python_runtime["venvConfig"], "runtime.pythonRuntime.venvConfig"
        )
        venv_config_target = stage.joinpath(*venv_config_path.parts)
        venv_config_target.parent.mkdir(parents=True, exist_ok=True)
        venv_config_target.write_text(
            "home = " + str(plan.destination.joinpath(*python_home.parts)) + "\n"
            "include-system-site-packages = false\n"
            "version = "
            + _require_string(python_runtime["version"], "runtime.pythonRuntime.version")
            + "\n",
            encoding="utf-8",
            newline="\n",
        )
        generated_python_files.append(venv_config_path)

    source_manifest_path = PurePosixPath("manifests/runtime-source.json")
    portrait_manifest_path = PurePosixPath("manifests/portrait-runtime.json")
    for manifest_path, list_key in (
        (source_manifest_path, "sourceManifestFiles"),
        (portrait_manifest_path, "portraitRuntimeManifestFiles"),
    ):
        files = [
            _pin(installed[_relative_path(value, list_key).as_posix()])
            for value in _require_list(runtime.get(list_key), f"runtime.{list_key}")
        ]
        if list_key == "sourceManifestFiles":
            files.extend(
                _generated_pin(relative, stage.joinpath(*relative.parts))
                for relative in generated_python_files
            )
        value = {"schemaVersion": 1, "root": str(plan.destination), "files": files}
        target = stage.joinpath(*manifest_path.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(_canonical_json(value))

    primary = _read_json(plan.primary_config, "primary presenter config")
    profiles = _require_object(plan.manifest["canonicalProfiles"], "canonicalProfiles")
    model_revision = _require_string(plan.manifest.get("modelRevision"), "modelRevision")
    motion_profile = _require_string(
        plan.manifest.get("motionProfile", "native-idle"), "motionProfile"
    )
    if motion_profile not in {"native-idle", "lip-sync-only"}:
        raise InstallError("motionProfile must be native-idle or lip-sync-only")

    executable = installed[_runtime_path(plan.manifest, "executable").as_posix()]
    ffmpeg = installed[_runtime_path(plan.manifest, "ffmpeg").as_posix()]
    ffprobe = installed[_runtime_path(plan.manifest, "ffprobe").as_posix()]
    worker = installed[_runtime_path(plan.manifest, "workerEntrypoint").as_posix()]
    adapter = installed[_runtime_path(plan.manifest, "adapterEntrypoint").as_posix()]
    role_entries = {
        role: installed[_runtime_path(plan.manifest, key).as_posix()]
        for role, key in ROLE_KEYS.items()
    }
    source_manifest_target = stage.joinpath(*source_manifest_path.parts)
    portrait_manifest_target = stage.joinpath(*portrait_manifest_path.parts)
    contract_files = [
        {"role": "adapter-entrypoint", **_pin(adapter)},
        {
            "role": "runtime-source-manifest",
            **_generated_pin(source_manifest_path, source_manifest_target),
        },
        *({"role": role, **_pin(entry)} for role, entry in role_entries.items()),
        {
            "role": "portrait-runtime-manifest",
            **_generated_pin(portrait_manifest_path, portrait_manifest_target),
        },
    ]
    pinned_files = [
        _pin(installed[_relative_path(value, "runtime.pinnedFiles").as_posix()])
        for value in _require_list(runtime.get("pinnedFiles", []), "runtime.pinnedFiles")
    ]
    config_paths: dict[str, Path] = {}
    for runtime_name, filename in CHILD_CONFIGS.items():
        canonical = _profile(
            _require_object(profiles.get(runtime_name), f"canonicalProfiles.{runtime_name}"),
            f"canonicalProfiles.{runtime_name}",
        )
        child_profiles = [canonical]
        encoding = {
            "policy": "alystria-presenter-h264-v1",
            "ffmpeg": _pin(ffmpeg),
            "gplX264": None,
            "probeTimeoutSeconds": int(
                _require_object(primary["presenterEncoding"], "presenterEncoding").get(
                    "probeTimeoutSeconds", 30
                )
            ),
        }
        child: dict[str, Any] = {
            "schemaVersion": 1,
            "runtimeRoot": ".",
            "executable": _pin(executable),
            "ffprobe": _pin(ffprobe),
            "argumentTemplate": [
                "-B",
                worker.install_path.as_posix(),
                "--portrait",
                "{portrait}",
                "--audio",
                "{audio}",
                "--output",
                "{output}",
                "--workspace",
                "{workspace}",
                "--job",
                "{job_manifest}",
                "--seed",
                "{seed}",
            ],
            "defaultProfileId": canonical["profileId"],
            "executionPolicy": "unsafe-test-only",
            "networkPolicy": "not-enforced",
            "unsafeTestOnlyAcknowledged": True,
            "gpuLease": primary["gpuLease"],
            "minimumOutputBytes": int(primary.get("minimumOutputBytes", 1024)),
            "maximumOutputBytes": int(primary.get("maximumOutputBytes", 2 * 1024**3)),
            "timeoutSeconds": float(primary.get("timeoutSeconds", 3600)),
            "modelId": f"joyvasa-{runtime_name}",
            "modelRevision": model_revision,
            "motionProfile": motion_profile,
            "pinnedFiles": pinned_files,
            "presenterEncoding": encoding,
            "profiles": child_profiles,
            "workerContract": {
                "contractId": "alystria.joyvasa.worker.v1",
                "entrypoint": _pin(worker),
                "files": contract_files,
            },
        }
        child["installFingerprint"] = _sha256_text(child)
        target = stage / filename
        child_bytes = _canonical_json(child)
        if len(child_bytes) > MAX_CHILD_CONFIG_BYTES:
            raise InstallError(f"{filename} exceeds the presenter's 1 MiB config limit")
        target.write_bytes(child_bytes)
        config_paths[runtime_name] = target

    installed_files = [
        {
            "relativePath": entry.install_path.as_posix(),
            "bytes": entry.byte_size,
            "sha256": entry.sha256,
            "origin": entry.origin,
        }
        for entry in plan.files
    ]
    for tree in plan.trees:
        installed_files.extend(
            {
                "relativePath": (tree.install_path / file.relative_path).as_posix(),
                "bytes": file.byte_size,
                "sha256": file.sha256,
                "origin": tree.origin,
            }
            for file in tree.files
        )
    generated_files = []
    for relative in (
        *generated_python_files,
        source_manifest_path,
        portrait_manifest_path,
        *(PurePosixPath(name) for name in CHILD_CONFIGS.values()),
    ):
        target = stage.joinpath(*relative.parts)
        generated_files.append(
            {
                "relativePath": relative.as_posix(),
                "bytes": target.stat().st_size,
                "sha256": _sha256(target),
            }
        )
    receipt = {
        "schemaVersion": 1,
        "state": "activated",
        "packId": _require_string(plan.manifest.get("packId"), "packId"),
        "sourceRevision": _require_string(
            plan.manifest.get("sourceRevision"), "sourceRevision"
        ),
        "modelRevision": model_revision,
        "curatedManifestSha256": plan.curated_manifest_sha256,
        "candidateEvidenceSha256": plan.candidate_evidence_sha256,
        "destination": str(plan.destination),
        "transferCounts": transfer_counts,
        "installedFiles": installed_files,
        "installedTrees": [
            {
                "relativePath": tree.install_path.as_posix(),
                "fileCount": tree.file_count,
                "bytes": tree.byte_size,
                "sha256": tree.sha256,
            }
            for tree in plan.trees
        ],
        "generatedFiles": generated_files,
        "routes": [
            {
                "runtime": route.runtime,
                "profileId": route.profile["profileId"],
                "portraitArtifactHash": route.profile["portraitArtifactHash"],
                **(
                    {"priorPortraitArtifactHash": route.prior_portrait_artifact_hash}
                    if route.prior_portrait_artifact_hash is not None
                    else {}
                ),
            }
            for route in plan.routes
        ],
    }
    (stage / RECEIPT_NAME).write_bytes(_canonical_json(receipt))
    return receipt


def _verify_existing(plan: InstallPlan) -> dict[str, Any] | None:
    receipt_path = plan.destination / RECEIPT_NAME
    if not plan.destination.exists() or not receipt_path.is_file() or _is_reparse_point(receipt_path):
        return None
    receipt = _read_json(receipt_path, "existing JoyVASA install receipt")
    if receipt.get("curatedManifestSha256") != plan.curated_manifest_sha256:
        return None
    for section in ("installedFiles", "generatedFiles"):
        for index, raw in enumerate(_require_list(receipt.get(section), f"receipt.{section}")):
            item = _require_object(raw, f"receipt.{section}[{index}]")
            relative = _relative_path(item.get("relativePath"), f"receipt.{section}.relativePath")
            target = _guarded_file(plan.destination, relative, f"receipt.{section}[{index}]")
            if target.stat().st_size != item.get("bytes") or _sha256(target) != item.get("sha256"):
                raise InstallError(f"Existing runtime file changed: {relative.as_posix()}")
    return receipt


def _desired_primary_config(plan: InstallPlan) -> tuple[dict[str, Any], bool]:
    current = _read_json(plan.primary_config, "primary presenter config")
    if not plan.routes:
        return current, False
    relative_root = plan.destination.relative_to(plan.primary_config.parent.resolve(strict=True))
    desired_routes = [
        (
            route.profile["portraitArtifactHash"],
            (relative_root / CHILD_CONFIGS[route.runtime]).as_posix(),
            route.prior_portrait_artifact_hash,
        )
        for route in plan.routes
    ]
    raw_existing = current.get("portraitRuntimeOverrides", [])
    existing = _require_list(raw_existing, "portraitRuntimeOverrides")
    merged = [dict(_require_object(item, "portraitRuntimeOverrides entry")) for item in existing]
    indexed: dict[str, str] = {}
    for item in merged:
        digest = _require_sha256(item.get("portraitArtifactHash"), "portraitRuntimeOverrides hash")
        path = _require_string(item.get("relativeConfigPath"), "portraitRuntimeOverrides path")
        if digest in indexed:
            raise InstallError("Primary config contains duplicate portrait runtime hashes")
        indexed[digest] = path
    for digest, relative_path, prior_digest in desired_routes:
        prior = indexed.get(digest)
        if prior is not None and PurePosixPath(prior).as_posix() != relative_path:
            raise InstallError(
                f"Primary config already routes portrait {digest} to a different runtime"
            )
        if prior_digest is not None:
            prior_path = indexed.get(prior_digest)
            if prior_path is not None and PurePosixPath(prior_path).as_posix() != relative_path:
                raise InstallError(
                    f"Prior portrait {prior_digest} is routed to a different runtime"
                )
            if prior_path is None and prior is None:
                raise InstallError(
                    f"Prior portrait {prior_digest} is missing before guarded migration"
                )
    retired_hashes = {
        prior_digest
        for _, _, prior_digest in desired_routes
        if prior_digest is not None and prior_digest in indexed
    }
    if retired_hashes:
        merged = [
            item for item in merged if item["portraitArtifactHash"] not in retired_hashes
        ]
    for digest, relative_path, _ in desired_routes:
        prior = indexed.get(digest)
        if prior is None:
            merged.append(
                {
                    "portraitArtifactHash": digest,
                    "relativeConfigPath": relative_path,
                }
            )
    updated = dict(current)
    updated["portraitRuntimeOverrides"] = merged
    return updated, _canonical_json(updated) != _canonical_json(current)


def _requested_route_entries(plan: InstallPlan) -> list[dict[str, str]]:
    relative_root = plan.destination.relative_to(plan.primary_config.parent.resolve(strict=True))
    return [
        {
            "runtime": route.runtime,
            "profileId": route.profile["profileId"],
            "portraitArtifactHash": route.profile["portraitArtifactHash"],
            "relativeConfigPath": (
                relative_root / CHILD_CONFIGS[route.runtime]
            ).as_posix(),
            **(
                {"priorPortraitArtifactHash": route.prior_portrait_artifact_hash}
                if route.prior_portrait_artifact_hash is not None
                else {}
            ),
        }
        for route in plan.routes
    ]


def _backup_path(path: Path, stamp: str) -> Path:
    base = path.with_name(f"{path.name}.backup-{stamp}")
    candidate = base
    index = 1
    while candidate.exists():
        candidate = base.with_name(f"{base.name}-{index}")
        index += 1
    return candidate


def _atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def activate(plan: InstallPlan, transfer: str) -> dict[str, Any]:
    desired_primary, primary_changes = _desired_primary_config(plan)
    existing = _verify_existing(plan)
    stage = plan.destination.parent / f".{plan.destination.name}.stage-{uuid.uuid4().hex}"
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    destination_backup: Path | None = None
    primary_backup: Path | None = None
    installed_new = False
    receipt: dict[str, Any]
    try:
        if existing is None:
            receipt = _write_stage(plan, stage, transfer)
            if plan.destination.exists():
                if _is_reparse_point(plan.destination) or not plan.destination.is_dir():
                    raise InstallError("Existing destination must be a regular directory")
                destination_backup = _backup_path(plan.destination, stamp)
                plan.destination.replace(destination_backup)
            stage.replace(plan.destination)
            installed_new = True
        else:
            receipt = existing
        if primary_changes:
            primary_backup = _backup_path(plan.primary_config, stamp)
            shutil.copy2(plan.primary_config, primary_backup)
            _atomic_write(plan.primary_config, _canonical_json(desired_primary))
        result = dict(receipt)
        result.update(
            {
                "runtimeAction": "installed" if installed_new else "verified-existing",
                "primaryConfigAction": "updated" if primary_changes else "unchanged",
                "primaryConfigBackup": str(primary_backup) if primary_backup else None,
                "replacedRuntimeBackup": str(destination_backup) if destination_backup else None,
                "requestedRouteCount": len(plan.routes),
                "requestedRoutes": _requested_route_entries(plan),
            }
        )
        return result
    except BaseException:
        if primary_backup is not None and primary_backup.exists():
            shutil.copy2(primary_backup, plan.primary_config)
        if installed_new and plan.destination.exists():
            shutil.rmtree(plan.destination)
        if destination_backup is not None and destination_backup.exists():
            destination_backup.replace(plan.destination)
        raise
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def describe(plan: InstallPlan) -> dict[str, Any]:
    _validate_runtime_references(plan)
    desired, primary_changes = _desired_primary_config(plan)
    return {
        "schemaVersion": 1,
        "mode": "dry-run",
        "validated": True,
        "networkUsed": False,
        "candidateRoot": str(plan.candidate_root),
        "destination": str(plan.destination),
        "primaryConfig": str(plan.primary_config),
        "packId": plan.manifest["packId"],
        "sourceRevision": plan.manifest["sourceRevision"],
        "curatedManifestSha256": plan.curated_manifest_sha256,
        "fileCount": len(plan.files),
        "treeCount": len(plan.trees),
        "treeAttestations": [
            {
                "relativePath": tree.install_path.as_posix(),
                "fileCount": tree.file_count,
                "bytes": tree.byte_size,
                "sha256": tree.sha256,
            }
            for tree in plan.trees
        ],
        "logicalBytes": sum(entry.byte_size for entry in plan.files)
        + sum(tree.byte_size for tree in plan.trees),
        "routeCount": len(plan.routes),
        "primaryConfigWouldChange": primary_changes,
        "preservedPrimaryDefaultProfileId": desired.get("defaultProfileId"),
        "activationRequired": True,
    }


def _arguments(argv: list[str] | None = None) -> argparse.Namespace:
    repository_default = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Validate and stage a reviewed JoyVASA presenter runtime without downloads.",
        allow_abbrev=False,
    )
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--destination", required=True, type=Path)
    parser.add_argument("--primary-config", required=True, type=Path)
    parser.add_argument("--repository-root", type=Path, default=repository_default)
    parser.add_argument(
        "--manifest",
        type=Path,
        help=f"Curated manifest (default: candidate/candidate-metadata/{INSTALL_MANIFEST_NAME})",
    )
    parser.add_argument("--routes-manifest", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Validate and print the plan (default)")
    mode.add_argument("--activate", action="store_true", help="Install and update configured routes")
    parser.add_argument(
        "--transfer",
        choices=("copy", "auto", "hardlink"),
        default="auto",
        help=(
            "Hardlink immutable candidate payloads when possible and copy repository sources; "
            "use copy for a fully independent payload."
        ),
    )
    parser.add_argument("--receipt", type=Path, help="Also write the resulting JSON receipt here")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _arguments(argv)
    manifest = args.manifest or (
        args.candidate / "candidate-metadata" / INSTALL_MANIFEST_NAME
    )
    try:
        plan = build_plan(
            candidate_root=args.candidate,
            repository_root=args.repository_root,
            destination=args.destination,
            primary_config=args.primary_config,
            curated_manifest_path=manifest,
            routes_manifest_path=args.routes_manifest,
        )
        result = activate(plan, args.transfer) if args.activate else describe(plan)
        output = _canonical_json(result)
        if args.receipt is not None:
            _atomic_write(args.receipt.resolve(strict=False), output)
        sys.stdout.buffer.write(output)
        return 0
    except (InstallError, OSError, ValueError) as error:
        print(f"JoyVASA runtime preparation failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
