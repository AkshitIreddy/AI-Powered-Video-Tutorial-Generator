"""Reproducible Windows installer for the reviewed SoulX-FlashHead Pro runtime.

The desktop downloads every public artifact itself and invokes this module through
the packaged pipeline CLI. Installation is offline: pip only sees the verified
wheelhouse and the embedded interpreter never falls back to host Python.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import uuid
import zipfile
from collections import Counter
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlsplit

MODEL_ID = "local/soulx-flashhead-pro"
RUNTIME_MODEL_ID = "soulx-flashhead-pro"
ASSET_ROOT = Path(__file__).with_name("presenter_runtime_assets")
MANIFEST_PATH = ASSET_ROOT / "soulx-flashhead-install-manifest.json"
INSTALL_DIRECTORY = Path("Presenter") / "SoulX-FlashHead-Pro"
STAGED_CONFIG_NAME = "presenter-runtime.soulx-flashhead-pro.staged.json"
PRIMARY_CONFIG_NAME = "presenter-runtime.json"
MAX_MANIFEST_BYTES = 256 * 1024
MAX_RUNTIME_LEDGER_BYTES = 32 * 1024 * 1024
MAX_ZIP_MEMBERS = 100_000
SHA256 = re.compile(r"^[0-9a-f]{64}$")
EXACT_REQUIREMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*==[A-Za-z0-9][A-Za-z0-9.!+_-]*$")
PATCH_HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")
EXCLUDED_PARTS = {"__pycache__", ".cache", ".hf-cache", "sample_results"}
EXPECTED_ARTIFACT_KINDS = {
    "python-archive": 1,
    "source-archive": 1,
    "model-file": 10,
    "wheel": 63,
}
ALLOWED_DOWNLOAD_HOSTS = {
    "www.python.org",
    "github.com",
    "huggingface.co",
    "files.pythonhosted.org",
    "download.pytorch.org",
    "download-r2.pytorch.org",
}
DEFAULT_PROFILE = {
    "profileId": "presenter-portrait.casual-realistic-emma-v1",
    "portraitArtifactHash": "27ac749dc0b30c2676d327e2a14fd05f873aee401d4b97bdd684eaab7c42a7f7",
    "subjectId": "fictional-synthetic-casual-realistic-emma-v1",
}


class PresenterRuntimeInstallError(RuntimeError):
    """The requested installation does not match the reviewed declaration."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_json(value: object) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode()


def _atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_bytes(content)
    os.replace(temporary, path)


def _require_object(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise PresenterRuntimeInstallError(f"{label} must be an object")
    return value


def _require_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or "\x00" in value:
        raise PresenterRuntimeInstallError(f"{label} must be non-empty text")
    return value


def _require_hash(value: object, label: str) -> str:
    digest = _require_text(value, label)
    if SHA256.fullmatch(digest) is None:
        raise PresenterRuntimeInstallError(f"{label} must be a lowercase SHA-256 digest")
    return digest


def _relative(value: object, label: str) -> PurePosixPath:
    raw = _require_text(value, label)
    if "\\" in raw or ":" in raw:
        raise PresenterRuntimeInstallError(f"{label} must use a portable relative path")
    path = PurePosixPath(raw)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise PresenterRuntimeInstallError(f"{label} must stay inside its declared root")
    return path


def _child(root: Path, relative: PurePosixPath) -> Path:
    return root.joinpath(*relative.parts)


def _regular_file(root: Path, relative: PurePosixPath, label: str) -> Path:
    if root.is_symlink():
        raise PresenterRuntimeInstallError(f"{label} root cannot be a symbolic link")
    resolved_root = root.resolve(strict=True)
    candidate = _child(resolved_root, relative)
    if candidate.is_symlink():
        raise PresenterRuntimeInstallError(f"{label} cannot be a symbolic link")
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(resolved_root)
    except (OSError, ValueError) as error:
        raise PresenterRuntimeInstallError(f"{label} escapes or is missing") from error
    if not resolved.is_file():
        raise PresenterRuntimeInstallError(f"{label} must be a regular file")
    return resolved


def _is_reparse(path: Path) -> bool:
    try:
        metadata = os.lstat(path)
    except OSError:
        return False
    return bool(getattr(metadata, "st_file_attributes", 0) & 0x400) or path.is_symlink()


def _runtime_destination(models_root: Path) -> tuple[Path, Path]:
    if _is_reparse(models_root):
        raise PresenterRuntimeInstallError("Models root cannot be a reparse point")
    root = models_root.resolve(strict=True)
    presenter = root / INSTALL_DIRECTORY.parent
    if presenter.exists() and _is_reparse(presenter):
        raise PresenterRuntimeInstallError("SoulX Presenter directory cannot be a reparse point")
    presenter.mkdir(parents=False, exist_ok=True)
    presenter = presenter.resolve(strict=True)
    try:
        presenter.relative_to(root)
    except ValueError as error:
        raise PresenterRuntimeInstallError(
            "SoulX Presenter directory escapes the Models root"
        ) from error
    final_root = presenter / INSTALL_DIRECTORY.name
    if final_root.exists():
        if _is_reparse(final_root) or final_root.resolve(strict=True) != final_root:
            raise PresenterRuntimeInstallError("Existing SoulX runtime cannot be a reparse point")
        if not final_root.is_dir():
            raise PresenterRuntimeInstallError("Existing SoulX runtime is not a directory")
    return root, final_root


def load_install_manifest(path: Path = MANIFEST_PATH) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_MANIFEST_BYTES:
        raise PresenterRuntimeInstallError("SoulX install manifest is missing or unsafe")
    manifest = _require_object(json.loads(path.read_text(encoding="utf-8")), "manifest")
    if (
        manifest.get("schemaVersion") != 1
        or manifest.get("modelId") != MODEL_ID
        or manifest.get("runtimeModelId") != RUNTIME_MODEL_ID
        or manifest.get("contractId") != "alystria.soulx-flashhead.worker.v1"
        or manifest.get("motionProfile") != "native-idle"
    ):
        raise PresenterRuntimeInstallError("SoulX install manifest identity is unsupported")
    artifacts = manifest.get("artifacts")
    resources = manifest.get("resources")
    roles = manifest.get("roles")
    if not isinstance(artifacts, list) or not artifacts or not isinstance(resources, list):
        raise PresenterRuntimeInstallError("SoulX install manifest has no artifact declaration")
    if not isinstance(roles, dict) or set(roles) != {
        "adapter-entrypoint",
        "runtime-source-manifest",
        "audio-feature-config",
        "audio-feature-preprocessor",
        "audio-feature-weights",
        "flashhead-config",
        "flashhead-weights",
        "vae-weights",
    }:
        raise PresenterRuntimeInstallError("SoulX worker role declaration is incomplete")
    seen: set[PurePosixPath] = set()
    wheel_requirements: set[str] = set()
    kinds: Counter[str] = Counter()
    paths_by_kind: dict[str, set[PurePosixPath]] = {kind: set() for kind in EXPECTED_ARTIFACT_KINDS}
    for index, raw in enumerate(artifacts):
        item = _require_object(raw, f"artifacts[{index}]")
        kind = _require_text(item.get("kind"), f"artifacts[{index}].kind")
        if kind not in EXPECTED_ARTIFACT_KINDS:
            raise PresenterRuntimeInstallError("SoulX artifact kind is unsupported")
        kinds[kind] += 1
        relative = _relative(item.get("relativePath"), f"artifacts[{index}].relativePath")
        paths_by_kind[kind].add(relative)
        url = _require_text(item.get("sourceUrl"), f"artifacts[{index}].sourceUrl")
        parsed = urlsplit(url)
        if (
            parsed.scheme != "https"
            or parsed.hostname not in ALLOWED_DOWNLOAD_HOSTS
            or parsed.username is not None
            or parsed.password is not None
            or parsed.fragment
        ):
            raise PresenterRuntimeInstallError("SoulX artifact URL must be credential-free HTTPS")
        if relative in seen or not isinstance(item.get("bytes"), int) or item["bytes"] <= 0:
            raise PresenterRuntimeInstallError("SoulX artifact path or byte count is invalid")
        seen.add(relative)
        _require_hash(item.get("sha256"), f"artifacts[{index}].sha256")
        if kind == "wheel":
            requirement = _require_text(item.get("requirement"), "wheel requirement")
            if (
                EXACT_REQUIREMENT.fullmatch(requirement) is None
                or requirement in wheel_requirements
                or relative.parts[0] != "wheelhouse"
                or relative.suffix != ".whl"
            ):
                raise PresenterRuntimeInstallError(
                    "SoulX wheel requirement is not exact and unique"
                )
            wheel_requirements.add(requirement)
        elif "requirement" in item:
            raise PresenterRuntimeInstallError(
                "Only SoulX wheel artifacts may declare requirements"
            )
    if dict(kinds) != EXPECTED_ARTIFACT_KINDS:
        raise PresenterRuntimeInstallError(
            "SoulX artifact kind counts differ from the reviewed set"
        )
    resource_paths: set[PurePosixPath] = set()
    resource_kinds: Counter[str] = Counter()
    for index, raw in enumerate(resources):
        item = _require_object(raw, f"resources[{index}]")
        kind = _require_text(item.get("kind"), f"resources[{index}].kind")
        resource_kinds[kind] += 1
        resource_name = _relative(item.get("resourceName"), "resourceName")
        install_path = _relative(item.get("installPath"), "installPath")
        if len(resource_name.parts) != 1:
            raise PresenterRuntimeInstallError("SoulX resource must be a direct packaged asset")
        if install_path in resource_paths:
            raise PresenterRuntimeInstallError(
                "SoulX packaged resource install paths must be unique"
            )
        resource_paths.add(install_path)
        resource = _regular_file(ASSET_ROOT, resource_name, "SoulX packaged resource")
        if resource.stat().st_size != item.get("bytes") or _sha256(resource) != _require_hash(
            item.get("sha256"), "resource sha256"
        ):
            raise PresenterRuntimeInstallError("SoulX packaged resource differs from its manifest")
    if resource_kinds != Counter(
        {"source-patch": 1, "worker-entrypoint": 1, "adapter-entrypoint": 1}
    ):
        raise PresenterRuntimeInstallError(
            "SoulX packaged resource kinds differ from the reviewed set"
        )
    source = _require_object(manifest.get("source"), "source declaration")
    python = _require_object(manifest.get("python"), "Python declaration")
    runtime_encoder = _require_object(manifest.get("runtimeEncoder"), "runtime encoder")
    if {_relative(source.get("archivePath"), "source archive path")} != paths_by_kind[
        "source-archive"
    ]:
        raise PresenterRuntimeInstallError("SoulX source archive declaration is not artifact-bound")
    if {_relative(python.get("archivePath"), "Python archive path")} != paths_by_kind[
        "python-archive"
    ]:
        raise PresenterRuntimeInstallError("SoulX Python archive declaration is not artifact-bound")
    if (
        _relative(python.get("bootstrapPipWheel"), "pip bootstrap wheel")
        not in paths_by_kind["wheel"]
    ):
        raise PresenterRuntimeInstallError("SoulX pip bootstrap is not a verified wheel artifact")
    expected_roles = {
        "adapter-entrypoint": PurePosixPath("worker/soulx_flashhead_presenter_adapter.py"),
        "runtime-source-manifest": PurePosixPath("manifests/source-manifest.json"),
        "audio-feature-config": PurePosixPath("models/wav2vec2-base-960h/config.json"),
        "audio-feature-preprocessor": PurePosixPath(
            "models/wav2vec2-base-960h/preprocessor_config.json"
        ),
        "audio-feature-weights": PurePosixPath("models/wav2vec2-base-960h/model.safetensors"),
        "flashhead-config": PurePosixPath("models/SoulX-FlashHead-1_3B/Model_Pro/config.json"),
        "flashhead-weights": PurePosixPath(
            "models/SoulX-FlashHead-1_3B/Model_Pro/diffusion_pytorch_model.safetensors"
        ),
        "vae-weights": PurePosixPath("models/SoulX-FlashHead-1_3B/VAE_Wan/Wan2.1_VAE.pth"),
    }
    if {role: _relative(value, f"role {role}") for role, value in roles.items()} != expected_roles:
        raise PresenterRuntimeInstallError("SoulX role paths differ from the reviewed contract")
    if set(expected_roles.values()) - {
        expected_roles["adapter-entrypoint"],
        expected_roles["runtime-source-manifest"],
    } != paths_by_kind["model-file"].intersection(set(expected_roles.values())):
        raise PresenterRuntimeInstallError("SoulX model roles are not bound to model artifacts")
    resource_by_kind = {
        item["kind"]: _relative(item["installPath"], "resource install path") for item in resources
    }
    if resource_by_kind["adapter-entrypoint"] != expected_roles["adapter-entrypoint"] or source.get(
        "patchResource"
    ) != next(item["resourceName"] for item in resources if item["kind"] == "source-patch"):
        raise PresenterRuntimeInstallError("SoulX packaged resources are not contract-bound")
    if manifest.get("environment") != {} or manifest.get("argumentTemplate", [])[:2] != [
        "-B",
        "worker/local_presenter_worker.py",
    ]:
        raise PresenterRuntimeInstallError("SoulX worker launch declaration is not offline-safe")
    if _relative(source.get("archiveRoot"), "source archive root") != PurePosixPath(
        "SoulX-FlashHead-9bc03de06bb0de82cd6bc477804512ae06144bf2"
    ):
        raise PresenterRuntimeInstallError(
            "SoulX source archive root differs from the reviewed root"
        )
    encoder_files = runtime_encoder.get("files")
    if (
        runtime_encoder.get("sourceRoot") != "ffmpeg"
        or runtime_encoder.get("executable") != "ffmpeg/ffmpeg.exe"
        or runtime_encoder.get("ffprobe") != "ffmpeg/ffprobe.exe"
        or not isinstance(encoder_files, list)
        or len(encoder_files) != 11
    ):
        raise PresenterRuntimeInstallError("SoulX runtime encoder declaration is incomplete")
    encoder_paths: set[PurePosixPath] = set()
    for raw in encoder_files:
        item = _require_object(raw, "runtime encoder file")
        relative = _relative(item.get("relativePath"), "runtime encoder path")
        if relative.parts[0] != "ffmpeg" or relative in encoder_paths:
            raise PresenterRuntimeInstallError("SoulX runtime encoder path is unsafe")
        encoder_paths.add(relative)
        if not isinstance(item.get("bytes"), int) or item["bytes"] <= 0:
            raise PresenterRuntimeInstallError("SoulX runtime encoder byte count is invalid")
        _require_hash(item.get("sha256"), "runtime encoder sha256")
    if {PurePosixPath("ffmpeg/ffmpeg.exe"), PurePosixPath("ffmpeg/ffprobe.exe")} - encoder_paths:
        raise PresenterRuntimeInstallError("SoulX runtime encoder entry points are missing")
    if resource_by_kind["worker-entrypoint"] != PurePosixPath("worker/local_presenter_worker.py"):
        raise PresenterRuntimeInstallError("SoulX worker resource is not contract-bound")
    generated_requirements = (
        "\n".join(
            f"{item['requirement']} --hash=sha256:{item['sha256']}"
            for item in artifacts
            if item.get("kind") == "wheel"
        )
        + "\n"
    ).encode()
    if hashlib.sha256(generated_requirements).hexdigest() != _require_hash(
        manifest.get("generatedRequirementsSha256"), "generated requirements sha256"
    ):
        raise PresenterRuntimeInstallError("SoulX generated dependency ledger differs")
    removed_overrides = manifest.get("activationRemovePortraitOverrides")
    if (
        not isinstance(removed_overrides, list)
        or len(removed_overrides) != 7
        or any(
            not isinstance(value, dict)
            or set(value)
            != {
                "portraitArtifactHash",
                "relativeConfigPath",
                "modelId",
                "modelRevision",
                "installFingerprint",
            }
            or SHA256.fullmatch(str(value.get("portraitArtifactHash"))) is None
            or SHA256.fullmatch(str(value.get("installFingerprint"))) is None
            or _relative(value.get("relativeConfigPath"), "activation route path")
            != PurePosixPath("Presenter/JoyVASA/joy-human.json")
            or value.get("modelId") != "joyvasa-human"
            or not isinstance(value.get("modelRevision"), str)
            for value in removed_overrides
        )
        or len({value["portraitArtifactHash"] for value in removed_overrides}) != 7
    ):
        raise PresenterRuntimeInstallError("SoulX activation override migration is invalid")
    return manifest


def manifest_identity(path: Path = MANIFEST_PATH) -> tuple[str, int, int]:
    manifest = load_install_manifest(path)
    artifacts = manifest["artifacts"]
    return _sha256(path), sum(int(item["bytes"]) for item in artifacts), len(artifacts)


def _verify_downloads(manifest: Mapping[str, Any], downloads_root: Path) -> None:
    for raw in manifest["artifacts"]:
        item = _require_object(raw, "artifact")
        path = _regular_file(
            downloads_root, _relative(item["relativePath"], "artifact path"), "artifact"
        )
        if path.stat().st_size != item["bytes"] or _sha256(path) != item["sha256"]:
            raise PresenterRuntimeInstallError(
                f"Downloaded artifact failed verification: {item['relativePath']}"
            )


def _safe_extract(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=False)
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        if not entries or len(entries) > MAX_ZIP_MEMBERS:
            raise PresenterRuntimeInstallError("Runtime archive member count is unsafe")
        for entry in entries:
            relative = (
                _relative(entry.filename.rstrip("/"), "archive member")
                if entry.filename.rstrip("/")
                else None
            )
            if relative is None:
                continue
            unix_mode = entry.external_attr >> 16
            if unix_mode & 0o170000 == 0o120000:
                raise PresenterRuntimeInstallError("Runtime archive contains a symbolic link")
            output = _child(destination, relative)
            if entry.is_dir():
                output.mkdir(parents=True, exist_ok=True)
            else:
                output.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(entry) as source, output.open("xb") as target:
                    shutil.copyfileobj(source, target, length=1024 * 1024)


def _expanded_patch_lines(patch: str) -> list[str]:
    lines: list[str] = []
    # The reviewed upstream diff records three files that lacked terminal newlines;
    # git concatenated the deletion and addition markers. Expand only that exact form.
    for line in patch.splitlines():
        if line.startswith("-"):
            marker = line.find("+", 1)
            if marker > 1 and line[1:marker] == line[marker + 1 :]:
                lines.extend((line[:marker], line[marker:]))
                continue
        lines.append(line)
    return lines


def _apply_reviewed_patch(root: Path, patch_path: Path) -> None:
    lines = _expanded_patch_lines(patch_path.read_text(encoding="utf-8"))
    index = 0
    while index < len(lines):
        if not lines[index].startswith("--- a/"):
            index += 1
            continue
        old_path = _relative(lines[index][6:], "patch old path")
        index += 1
        if index >= len(lines) or not lines[index].startswith("+++ b/"):
            raise PresenterRuntimeInstallError("Reviewed SoulX patch has an invalid file header")
        new_path = _relative(lines[index][6:], "patch new path")
        if old_path != new_path:
            raise PresenterRuntimeInstallError("Reviewed SoulX patch may not rename files")
        target = _regular_file(root, old_path, "patch target")
        original_bytes = target.read_bytes()
        original = original_bytes.decode("utf-8").splitlines()
        output: list[str] = []
        cursor = 0
        index += 1
        saw_hunk = False
        while index < len(lines) and not lines[index].startswith("--- a/"):
            match = PATCH_HUNK.match(lines[index])
            if match is None:
                index += 1
                continue
            saw_hunk = True
            old_start = int(match.group(1)) - 1
            output.extend(original[cursor:old_start])
            cursor = old_start
            index += 1
            while index < len(lines) and not lines[index].startswith(("@@ ", "--- a/")):
                row = lines[index]
                if row.startswith(" "):
                    if cursor >= len(original) or original[cursor] != row[1:]:
                        raise PresenterRuntimeInstallError(
                            "Reviewed SoulX patch context does not match"
                        )
                    output.append(original[cursor])
                    cursor += 1
                elif row.startswith("-"):
                    if cursor >= len(original) or original[cursor] != row[1:]:
                        actual = original[cursor] if cursor < len(original) else "<eof>"
                        raise PresenterRuntimeInstallError(
                            f"Reviewed SoulX patch deletion does not match {old_path}:{cursor + 1}; "
                            f"expected {row[1:]!r}, found {actual!r}"
                        )
                    cursor += 1
                elif row.startswith("+"):
                    output.append(row[1:])
                elif row.startswith("\\ No newline"):
                    pass
                else:
                    raise PresenterRuntimeInstallError(
                        "Reviewed SoulX patch contains an invalid row"
                    )
                index += 1
        if not saw_hunk:
            raise PresenterRuntimeInstallError("Reviewed SoulX patch contains no hunks")
        output.extend(original[cursor:])
        encoded = "\n".join(output).encode("utf-8") + b"\n"
        target.write_bytes(encoded)


def _copy_file(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def _copy_tree(
    source: Path, destination: Path, *, excluded_prefixes: Iterable[PurePosixPath] = ()
) -> None:
    excluded = tuple(excluded_prefixes)
    for current, directories, files in os.walk(source):
        current_path = Path(current)
        relative_directory = current_path.relative_to(source)
        directories[:] = [name for name in directories if name not in EXCLUDED_PARTS]
        for filename in files:
            relative = PurePosixPath(relative_directory.as_posix()) / filename
            if filename.endswith((".pyc", ".log")) or any(
                relative == prefix or prefix in relative.parents for prefix in excluded
            ):
                continue
            item = current_path / filename
            if item.is_symlink():
                raise PresenterRuntimeInstallError("Candidate runtime contains a symbolic link")
            _copy_file(item, _child(destination, relative))


def _requirements(manifest: Mapping[str, Any]) -> bytes:
    rows = [
        f"{item['requirement']} --hash=sha256:{item['sha256']}"
        for item in manifest["artifacts"]
        if item.get("kind") == "wheel"
    ]
    return ("\n".join(rows) + "\n").encode()


def _hidden_subprocess_flags() -> int:
    return 0x08000000 if os.name == "nt" else 0


def _verified_tree_entries(root: Path, label: str) -> tuple[list[Path], list[Path]]:
    if _is_reparse(root) or not root.is_dir():
        raise PresenterRuntimeInstallError(f"{label} must be a regular directory")
    resolved_root = root.resolve(strict=True)
    directories: list[Path] = []
    files: list[Path] = []
    for current, names, filenames in os.walk(resolved_root, topdown=True, followlinks=False):
        current_path = Path(current)
        for name in (*names, *filenames):
            path = current_path / name
            relative = path.relative_to(resolved_root).as_posix()
            if _is_reparse(path):
                raise PresenterRuntimeInstallError(f"{label} contains a reparse point: {relative}")
            try:
                path.resolve(strict=True).relative_to(resolved_root)
            except (OSError, ValueError) as error:
                raise PresenterRuntimeInstallError(
                    f"{label} contains an escaping or missing path: {relative}"
                ) from error
            if path.is_dir():
                directories.append(path)
            elif path.is_file():
                files.append(path)
            else:
                raise PresenterRuntimeInstallError(
                    f"{label} contains a non-regular path: {relative}"
                )
    return directories, files


def _remove_verified_tree(root: Path, label: str) -> None:
    _verified_tree_entries(root, label)
    shutil.rmtree(root)


def _remove_packaged_bytecode(site_packages: Path) -> None:
    directories, files = _verified_tree_entries(site_packages, "SoulX site-packages")
    cache_directories = sorted(
        (path for path in directories if path.name == "__pycache__"),
        key=lambda path: len(path.parts),
    )
    cache_roots: list[Path] = []
    for path in cache_directories:
        if not any(parent in path.parents for parent in cache_roots):
            cache_roots.append(path)
    for path in files:
        if path.suffix.casefold() == ".pyc" and not any(
            cache in path.parents for cache in cache_roots
        ):
            path.unlink()
    for cache in cache_roots:
        shutil.rmtree(cache)


def _install_wheels(manifest: Mapping[str, Any], downloads: Path, stage: Path) -> None:
    python = _child(stage, _relative(manifest["python"]["executable"], "python executable"))
    site_packages = _child(stage, _relative(manifest["python"]["sitePackages"], "site packages"))
    pip_wheel = _regular_file(
        downloads, _relative(manifest["python"]["bootstrapPipWheel"], "pip wheel"), "pip wheel"
    )
    _safe_extract(pip_wheel, site_packages)
    pth = stage / "python-base" / "python310._pth"
    pth.write_text("\n".join(manifest["python"]["pth"]) + "\n", encoding="utf-8")
    requirements = stage / "manifests" / "requirements-windows-cu128.hashed.txt"
    _atomic_write(requirements, _requirements(manifest))
    if _sha256(requirements) != manifest["generatedRequirementsSha256"]:
        raise PresenterRuntimeInstallError("Generated SoulX hashed requirements differ")
    environment = {
        **os.environ,
        "PIP_NO_INDEX": "1",
        "PIP_DISABLE_PIP_VERSION_CHECK": "1",
        "PIP_NO_INPUT": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    pip_temporary = stage / ".pip-temp"
    pip_temporary.mkdir(exist_ok=False)
    environment.update(
        {
            "TEMP": str(pip_temporary),
            "TMP": str(pip_temporary),
            "TMPDIR": str(pip_temporary),
        }
    )
    try:
        completed = subprocess.run(
            [
                str(python),
                "-B",
                "-m",
                "pip",
                "install",
                "--no-index",
                "--no-deps",
                "--require-hashes",
                "--only-binary=:all:",
                "--no-compile",
                "--target",
                str(site_packages),
                "--find-links",
                str(downloads / "wheelhouse"),
                "--requirement",
                str(requirements),
            ],
            cwd=stage,
            env=environment,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            check=False,
            creationflags=_hidden_subprocess_flags(),
            timeout=1800,
        )
    finally:
        _remove_verified_tree(pip_temporary, "SoulX pip temporary directory")
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace")[-2000:]
        raise PresenterRuntimeInstallError(f"Offline SoulX wheel installation failed: {detail}")
    _remove_packaged_bytecode(site_packages)


def _copy_resources(manifest: Mapping[str, Any], stage: Path) -> None:
    for raw in manifest["resources"]:
        item = _require_object(raw, "resource")
        source = _regular_file(
            ASSET_ROOT, _relative(item["resourceName"], "resource name"), "resource"
        )
        destination = _child(stage, _relative(item["installPath"], "resource install path"))
        _copy_file(source, destination)


def _copy_runtime_encoder(
    manifest: Mapping[str, Any], trusted_runtime_root: Path, stage: Path
) -> None:
    if _is_reparse(trusted_runtime_root):
        raise PresenterRuntimeInstallError("Signed runtime pack root cannot be a reparse point")
    trusted_runtime_root = trusted_runtime_root.resolve(strict=True)
    declaration = manifest["runtimeEncoder"]
    declared = {
        _relative(raw["relativePath"], "runtime encoder path"): raw for raw in declaration["files"]
    }
    source_directory = _child(
        trusted_runtime_root,
        _relative(declaration["sourceRoot"], "runtime encoder source root"),
    )
    if _is_reparse(source_directory) or not source_directory.is_dir():
        raise PresenterRuntimeInstallError(
            "Signed runtime pack encoder root cannot be a reparse point"
        )
    for path in source_directory.rglob("*"):
        if _is_reparse(path):
            raise PresenterRuntimeInstallError(
                "Signed runtime pack encoder contains a reparse point"
            )
    actual = {
        PurePosixPath(path.relative_to(trusted_runtime_root).as_posix()): path
        for path in source_directory.rglob("*")
        if path.is_file()
    }
    if set(actual) != set(declared):
        raise PresenterRuntimeInstallError(
            "Signed runtime pack encoder files differ from the SoulX declaration"
        )
    for relative, source in actual.items():
        raw = declared[relative]
        if source.stat().st_size != raw["bytes"] or _sha256(source) != raw["sha256"]:
            raise PresenterRuntimeInstallError(
                "Signed runtime pack encoder failed its exact hash check"
            )
        _copy_file(source, _child(stage, relative))


def _source_manifest(source_root: Path, final_root: Path, output: Path) -> None:
    files: list[dict[str, Any]] = []
    for path in sorted(source_root.rglob("*"), key=lambda item: item.as_posix().casefold()):
        if (
            not path.is_file()
            or path.is_symlink()
            or any(part in EXCLUDED_PARTS for part in path.parts)
        ):
            continue
        relative = path.relative_to(source_root)
        if not relative.parts or relative.parts[0] != "flash_head":
            continue
        files.append(
            {
                "relativePath": relative.as_posix(),
                "bytes": path.stat().st_size,
                "sha256": _sha256(path),
            }
        )
    if not files or len(files) > 10_000:
        raise PresenterRuntimeInstallError("SoulX source inventory is empty or too large")
    required = {
        PurePosixPath(item["relativePath"])
        for item in files
        if isinstance(item.get("relativePath"), str)
    }
    if not required:
        raise PresenterRuntimeInstallError("SoulX source inventory has no portable paths")
    _atomic_write(
        output,
        _canonical_json(
            {
                "schemaVersion": 1,
                "root": str(final_root.absolute()),
                "files": files,
            }
        ),
    )


def _runtime_files(root: Path) -> dict[PurePosixPath, Path]:
    files: dict[PurePosixPath, Path] = {}
    for path in sorted(root.rglob("*"), key=lambda item: item.as_posix().casefold()):
        if path.is_dir():
            if _is_reparse(path):
                raise PresenterRuntimeInstallError("SoulX runtime contains a reparse directory")
            if path.name in EXCLUDED_PARTS:
                directory_relative = path.relative_to(root).as_posix()
                raise PresenterRuntimeInstallError(
                    f"SoulX runtime contains an undeclared mutable directory: {directory_relative}"
                )
            continue
        relative = PurePosixPath(path.relative_to(root).as_posix())
        if (
            path.is_symlink()
            or _is_reparse(path)
            or relative
            in {
                PurePosixPath("manifests/runtime-ledger.json"),
                PurePosixPath("manifests/install-receipt.json"),
            }
        ):
            if path.is_symlink() or _is_reparse(path):
                raise PresenterRuntimeInstallError("SoulX runtime contains a reparse file")
            continue
        if any(part in EXCLUDED_PARTS for part in relative.parts) or path.name.endswith(
            (".pyc", ".log")
        ):
            raise PresenterRuntimeInstallError(
                f"SoulX runtime contains an undeclared mutable file: {relative.as_posix()}"
            )
        files[relative] = path
    return files


def _write_runtime_ledger(stage: Path) -> dict[str, Any]:
    rows = []
    total_bytes = 0
    for relative, path in _runtime_files(stage).items():
        size = path.stat().st_size
        total_bytes += size
        rows.append(
            {
                "relativePath": relative.as_posix(),
                "bytes": size,
                "sha256": _sha256(path),
            }
        )
    if not rows or len(rows) > MAX_ZIP_MEMBERS:
        raise PresenterRuntimeInstallError("SoulX runtime ledger file count is unsafe")
    ledger_path = stage / "manifests" / "runtime-ledger.json"
    _atomic_write(
        ledger_path,
        _canonical_json(
            {
                "schemaVersion": 1,
                "fileCount": len(rows),
                "totalBytes": total_bytes,
                "files": rows,
            }
        ),
    )
    return {
        "relativePath": "manifests/runtime-ledger.json",
        "bytes": ledger_path.stat().st_size,
        "sha256": _sha256(ledger_path),
        "fileCount": len(rows),
        "totalBytes": total_bytes,
    }


def _verify_runtime_ledger(runtime_root: Path, declaration: object) -> None:
    pin = _require_object(declaration, "runtime ledger pin")
    relative = _relative(pin.get("relativePath"), "runtime ledger path")
    ledger_path = _regular_file(runtime_root, relative, "runtime ledger")
    if (
        ledger_path.stat().st_size != pin.get("bytes")
        or ledger_path.stat().st_size > MAX_RUNTIME_LEDGER_BYTES
        or _sha256(ledger_path) != _require_hash(pin.get("sha256"), "runtime ledger sha256")
    ):
        raise PresenterRuntimeInstallError("SoulX runtime ledger differs from its receipt")
    ledger = _require_object(json.loads(ledger_path.read_text(encoding="utf-8")), "runtime ledger")
    rows = ledger.get("files")
    if ledger.get("schemaVersion") != 1 or not isinstance(rows, list) or not rows:
        raise PresenterRuntimeInstallError("SoulX runtime ledger is invalid")
    if len(rows) != pin.get("fileCount") or len(rows) > MAX_ZIP_MEMBERS:
        raise PresenterRuntimeInstallError("SoulX runtime ledger count differs")
    expected: dict[PurePosixPath, tuple[int, str]] = {}
    total_bytes = 0
    for index, raw in enumerate(rows):
        item = _require_object(raw, f"runtime ledger files[{index}]")
        item_path = _relative(item.get("relativePath"), "runtime ledger file path")
        size = item.get("bytes")
        digest = _require_hash(item.get("sha256"), "runtime ledger file sha256")
        if item_path in expected or not isinstance(size, int) or size < 0:
            raise PresenterRuntimeInstallError(
                "SoulX runtime ledger has a duplicate or invalid file"
            )
        expected[item_path] = (size, digest)
        total_bytes += size
    if total_bytes != pin.get("totalBytes") or total_bytes != ledger.get("totalBytes"):
        raise PresenterRuntimeInstallError("SoulX runtime ledger byte total differs")
    actual = _runtime_files(runtime_root)
    if set(actual) != set(expected):
        raise PresenterRuntimeInstallError("SoulX runtime files differ from the installed ledger")
    for relative_path, path in actual.items():
        size, digest = expected[relative_path]
        if path.stat().st_size != size or _sha256(path) != digest:
            raise PresenterRuntimeInstallError(
                f"SoulX runtime file failed verification: {relative_path.as_posix()}"
            )


def _pin(runtime_root: Path, relative: str) -> dict[str, str]:
    path = _regular_file(runtime_root, _relative(relative, "runtime pin"), "runtime pin")
    return {"relativePath": relative, "sha256": _sha256(path)}


def _install_fingerprint(manifest_path: Path, manifest: Mapping[str, Any]) -> str:
    digest = hashlib.sha256()
    for value in [
        "alystria-managed-soulx-flashhead-install-v1",
        _sha256(manifest_path),
        manifest["immutableRevision"],
        manifest["dependencyLockSha256"],
        manifest["generatedRequirementsSha256"],
        *[item["sha256"] for item in manifest["resources"]],
    ]:
        digest.update(str(value).encode())
        digest.update(b"\0")
    return digest.hexdigest()


def _primary_settings(models_root: Path) -> dict[str, Any]:
    path = models_root / PRIMARY_CONFIG_NAME
    if not path.exists():
        return {}
    if _is_reparse(path) or not path.is_file() or path.stat().st_size > 1024 * 1024:
        raise PresenterRuntimeInstallError(
            "Existing presenter runtime config is unsafe; it was left unchanged"
        )
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise PresenterRuntimeInstallError(
            "Existing presenter runtime config is unreadable; it was left unchanged"
        ) from error
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise PresenterRuntimeInstallError(
            "Existing presenter runtime config has an unsupported schema; it was left unchanged"
        )
    return value


def _runtime_config(
    manifest: Mapping[str, Any],
    models_root: Path,
    runtime_root: Path,
    fingerprint: str,
    *,
    remove_reviewed_overrides: bool = False,
) -> dict[str, Any]:
    previous = _primary_settings(models_root)
    profiles = previous.get("profiles", [DEFAULT_PROFILE])
    default_profile_id = previous.get("defaultProfileId", DEFAULT_PROFILE["profileId"])
    if (
        not isinstance(profiles, list)
        or not profiles
        or not isinstance(default_profile_id, str)
        or default_profile_id
        not in {
            item.get("profileId")
            for item in profiles
            if isinstance(item, dict) and isinstance(item.get("profileId"), str)
        }
    ):
        raise PresenterRuntimeInstallError(
            "Existing presenter profile routing is invalid; it was left unchanged"
        )
    roles = [
        {"role": role, **_pin(runtime_root, relative)}
        for role, relative in manifest["roles"].items()
    ]
    config: dict[str, Any] = {
        "schemaVersion": 1,
        "runtimeRoot": INSTALL_DIRECTORY.as_posix(),
        "modelId": RUNTIME_MODEL_ID,
        "modelRevision": manifest["immutableRevision"],
        "installFingerprint": fingerprint,
        "executable": _pin(runtime_root, manifest["python"]["executable"]),
        "ffprobe": _pin(runtime_root, manifest["runtimeEncoder"]["ffprobe"]),
        "argumentTemplate": manifest["argumentTemplate"],
        "executionPolicy": "managed-verified",
        "networkPolicy": "supervisor-deny",
        "motionProfile": "native-idle",
        "timeoutSeconds": 3600,
        "probeTimeoutSeconds": 30,
        "minimumOutputBytes": 1024,
        "maximumOutputBytes": 2 * 1024 * 1024 * 1024,
        "environment": {},
        "profiles": profiles,
        "workerContract": {
            "contractId": manifest["contractId"],
            "entrypoint": _pin(runtime_root, "worker/local_presenter_worker.py"),
            "files": roles,
        },
        "presenterEncoding": {
            "policy": "alystria-presenter-h264-v1",
            "ffmpeg": _pin(runtime_root, manifest["runtimeEncoder"]["executable"]),
            "probeTimeoutSeconds": 30,
            "gplX264": None,
        },
        "gpuLease": previous.get("gpuLease")
        or {
            "leaseId": "alystria-soulx-flashhead-pro-v1",
            "owner": "Alystria Studio managed SoulX runtime",
            "mutexName": "global\\alystria-soulx-flashhead-presenter",
            "deviceId": "cuda:0",
            "vramBytes": 9_000_000_000,
        },
    }
    config["defaultProfileId"] = default_profile_id
    if "portraitRuntimeOverrides" in previous:
        overrides = previous["portraitRuntimeOverrides"]
        if not isinstance(overrides, list):
            raise PresenterRuntimeInstallError(
                "Existing portrait runtime routing is invalid; it was left unchanged"
            )
        config["portraitRuntimeOverrides"] = [
            item
            for item in overrides
            if not isinstance(item, dict)
            or not remove_reviewed_overrides
            or not _matches_override_migration(
                models_root,
                item,
                manifest["activationRemovePortraitOverrides"],
            )
        ]
    return config


def _matches_override_migration(
    models_root: Path,
    override: Mapping[str, Any],
    migrations: object,
) -> bool:
    if not isinstance(migrations, list):
        return False
    migration = next(
        (
            value
            for value in migrations
            if isinstance(value, dict)
            and value.get("portraitArtifactHash") == override.get("portraitArtifactHash")
            and value.get("relativeConfigPath") == override.get("relativeConfigPath")
        ),
        None,
    )
    if migration is None:
        return False
    try:
        child = _regular_file(
            models_root,
            _relative(migration["relativeConfigPath"], "activation route path"),
            "activation route config",
        )
        if child.stat().st_size > 1024 * 1024:
            return False
        value = _require_object(json.loads(child.read_text(encoding="utf-8")), "route config")
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, PresenterRuntimeInstallError):
        return False
    return all(
        value.get(field) == migration[field]
        for field in ("modelId", "modelRevision", "installFingerprint")
    )


def _validate_runtime_config(config_path: Path) -> None:
    from .generation.local_presenter import load_local_presenter_media_client

    class _ValidationMediaClient:
        provider_id = "runtime-config-validation"
        model_revision = "runtime-config-validation"

    try:
        load_local_presenter_media_client(
            object(),  # type: ignore[arg-type]
            _ValidationMediaClient(),  # type: ignore[arg-type]
            config_path,
        )
    except (OSError, TypeError, ValueError) as error:
        raise PresenterRuntimeInstallError(
            f"Generated SoulX runtime config failed validation: {error}"
        ) from error


def _publish_staged_config(models_root: Path, config: Mapping[str, Any]) -> Path:
    path = models_root / STAGED_CONFIG_NAME
    previous: bytes | None = None
    if path.exists():
        if _is_reparse(path) or not path.is_file() or path.stat().st_size > 1024 * 1024:
            raise PresenterRuntimeInstallError("Existing staged SoulX config is unsafe")
        previous = path.read_bytes()
    _atomic_write(path, _canonical_json(config))
    try:
        _validate_runtime_config(path)
    except Exception:
        if previous is None:
            path.unlink(missing_ok=True)
        else:
            _atomic_write(path, previous)
        raise
    return path


def _verify_roles(
    manifest: Mapping[str, Any],
    runtime_root: Path,
    *,
    source_manifest_root: Path | None = None,
) -> None:
    for relative in manifest["roles"].values():
        _regular_file(runtime_root, _relative(relative, "worker role"), "worker role")
    for path_key, hash_key in (
        ("executable", "executableSha256"),
        ("pythonDll", "pythonDllSha256"),
        ("pthFile", "pthSha256"),
    ):
        python_file = _regular_file(
            runtime_root, _relative(manifest["python"][path_key], path_key), path_key
        )
        if _sha256(python_file) != manifest["python"][hash_key]:
            raise PresenterRuntimeInstallError(
                f"SoulX {path_key} differs from its reviewed Python archive"
            )
    for raw in manifest["runtimeEncoder"]["files"]:
        encoder_file = _regular_file(
            runtime_root,
            _relative(raw["relativePath"], "runtime encoder path"),
            "runtime encoder file",
        )
        if encoder_file.stat().st_size != raw["bytes"] or _sha256(encoder_file) != raw["sha256"]:
            raise PresenterRuntimeInstallError("SoulX runtime encoder differs from its signed pack")
    for raw in manifest["resources"]:
        resource = _regular_file(
            runtime_root,
            _relative(raw["installPath"], "resource install path"),
            "installed SoulX resource",
        )
        if resource.stat().st_size != raw["bytes"] or _sha256(resource) != raw["sha256"]:
            raise PresenterRuntimeInstallError("Installed SoulX resource differs from its package")
    for raw in manifest["artifacts"]:
        if raw.get("kind") != "model-file":
            continue
        model = _regular_file(
            runtime_root,
            _relative(raw["relativePath"], "model path"),
            "installed SoulX model",
        )
        if model.stat().st_size != raw["bytes"] or _sha256(model) != raw["sha256"]:
            raise PresenterRuntimeInstallError("Installed SoulX model differs from its manifest")
    source_manifest_path = _regular_file(
        runtime_root,
        _relative(manifest["roles"]["runtime-source-manifest"], "source manifest path"),
        "SoulX source manifest",
    )
    source_manifest = _require_object(
        json.loads(source_manifest_path.read_text(encoding="utf-8")), "source manifest"
    )
    expected_source_root = runtime_root if source_manifest_root is None else source_manifest_root
    if source_manifest.get("root") != str(expected_source_root.absolute()):
        raise PresenterRuntimeInstallError("SoulX source manifest root differs from the runtime")
    source_rows = source_manifest.get("files")
    if not isinstance(source_rows, list):
        raise PresenterRuntimeInstallError("SoulX source manifest has no file declarations")
    pinned_source = {
        _relative(row.get("relativePath"), "source file path"): row
        for row in source_rows
        if isinstance(row, dict)
    }
    for required in manifest["source"]["requiredFiles"]:
        relative = _relative(required, "required source file")
        row = pinned_source.get(relative)
        if row is None:
            raise PresenterRuntimeInstallError("SoulX source manifest is incomplete")
        source = _regular_file(runtime_root, relative, "required SoulX source")
        if source.stat().st_size != row.get("bytes") or _sha256(source) != row.get("sha256"):
            raise PresenterRuntimeInstallError("Required SoulX source differs from its manifest")


def _write_receipts(
    manifest_path: Path,
    manifest: Mapping[str, Any],
    models_root: Path,
    stage: Path,
    final_root: Path,
    source: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    _source_manifest(stage, final_root, stage / "manifests" / "source-manifest.json")
    _verify_roles(manifest, stage, source_manifest_root=final_root)
    fingerprint = _install_fingerprint(manifest_path, manifest)
    runtime_ledger = _write_runtime_ledger(stage)
    receipt = {
        "schemaVersion": 1,
        "operation": "install",
        "modelId": MODEL_ID,
        "runtimeModelId": RUNTIME_MODEL_ID,
        "runtimeRoot": str(final_root.resolve(strict=False)),
        "runtimeReady": True,
        "runtimeRevision": manifest["immutableRevision"],
        "modelRevision": manifest["immutableRevision"],
        "installFingerprint": fingerprint,
        "manifestSha256": _sha256(manifest_path),
        "dependencyLockSha256": manifest["dependencyLockSha256"],
        "generatedRequirementsSha256": manifest["generatedRequirementsSha256"],
        "source": source,
        "contractId": manifest["contractId"],
        "artifactCount": len(manifest["artifacts"]),
        "runtimeLedger": runtime_ledger,
        "installedAt": datetime.now(UTC).isoformat(),
    }
    _atomic_write(stage / "manifests" / "install-receipt.json", _canonical_json(receipt))
    config = _runtime_config(manifest, models_root, stage, fingerprint)
    return receipt, config


def _promote(stage: Path, final_root: Path) -> str | None:
    final_root.parent.mkdir(parents=True, exist_ok=True)
    if final_root.exists():
        raise PresenterRuntimeInstallError(
            "SoulX immutable runtime already exists; inspect it or remove it explicitly before repair"
        )
    os.replace(stage, final_root)
    return None


def _promote_and_publish(
    stage: Path,
    final_root: Path,
    models_root: Path,
    config: Mapping[str, Any],
) -> tuple[str | None, Path]:
    backup = _promote(stage, final_root)
    try:
        staged_config = _publish_staged_config(models_root, config)
    except Exception:
        if final_root.exists() and not stage.exists():
            os.replace(final_root, stage)
        raise
    return backup, staged_config


def install_from_downloads(
    models_root: Path,
    downloads_root: Path,
    trusted_runtime_root: Path,
    manifest_path: Path = MANIFEST_PATH,
) -> dict[str, Any]:
    manifest = load_install_manifest(manifest_path)
    models_root, final_root = _runtime_destination(models_root)
    if final_root.exists():
        receipt, fingerprint = _verified_installed_receipt(manifest_path, manifest, final_root)
        config = _runtime_config(manifest, models_root, final_root, fingerprint)
        recovered = dict(receipt)
        recovered["runtimeBackup"] = None
        recovered["stagedConfig"] = str(_publish_staged_config(models_root, config))
        recovered["recoveredExistingInstall"] = True
        return recovered
    downloads_root = downloads_root.resolve(strict=True)
    _verify_downloads(manifest, downloads_root)
    stage = final_root.with_name(f".{final_root.name}.install-{uuid.uuid4().hex}")
    stage.mkdir(parents=True, exist_ok=False)
    try:
        python_extract = stage / ".python-extract"
        _safe_extract(
            _regular_file(
                downloads_root,
                _relative(manifest["python"]["archivePath"], "python archive"),
                "python archive",
            ),
            python_extract,
        )
        os.replace(python_extract, stage / "python-base")
        source_extract = stage / ".source-extract"
        _safe_extract(
            _regular_file(
                downloads_root,
                _relative(manifest["source"]["archivePath"], "source archive"),
                "source archive",
            ),
            source_extract,
        )
        source = source_extract / manifest["source"]["archiveRoot"]
        _apply_reviewed_patch(source, ASSET_ROOT / manifest["source"]["patchResource"])
        for child in source.iterdir():
            if child.name in {"assets", "examples", ".gitignore"}:
                continue
            os.replace(child, stage / child.name)
        shutil.rmtree(source_extract)
        _copy_runtime_encoder(manifest, trusted_runtime_root, stage)
        for raw in manifest["artifacts"]:
            if raw.get("kind") != "model-file":
                continue
            relative = _relative(raw["relativePath"], "model artifact")
            _copy_file(
                _regular_file(downloads_root, relative, "model artifact"),
                _child(stage, relative),
            )
        _copy_resources(manifest, stage)
        _install_wheels(manifest, downloads_root, stage)
        receipt, config = _write_receipts(
            manifest_path,
            manifest,
            models_root,
            stage,
            final_root,
            "verified-downloads",
        )
        backup, staged_config = _promote_and_publish(stage, final_root, models_root, config)
        receipt["runtimeBackup"] = backup
        receipt["stagedConfig"] = str(staged_config)
        return receipt
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def _verify_candidate(candidate_root: Path, manifest: Mapping[str, Any]) -> dict[str, Any]:
    receipt_path = candidate_root / "candidate-metadata" / "candidate-receipt.json"
    if _sha256(receipt_path) != manifest["candidateReceiptSha256"]:
        raise PresenterRuntimeInstallError(
            "SoulX candidate receipt does not match the reviewed receipt"
        )
    receipt = _require_object(
        json.loads(receipt_path.read_text(encoding="utf-8")), "candidate receipt"
    )
    if receipt.get("managedContract", {}).get("contractId") != manifest["contractId"]:
        raise PresenterRuntimeInstallError("SoulX candidate worker contract differs")
    metadata_declarations = (
        receipt.get("source", {}).get("originalInventory"),
        receipt.get("source", {}).get("patchedSourceReceipt"),
        receipt.get("pythonRuntime", {}).get("dependencyLock"),
    )
    for declaration in metadata_declarations:
        item = _require_object(declaration, "candidate metadata declaration")
        metadata = _regular_file(
            candidate_root,
            _relative(item.get("path"), "candidate metadata path"),
            "candidate metadata",
        )
        if _sha256(metadata) != _require_hash(item.get("sha256"), "candidate metadata sha256"):
            raise PresenterRuntimeInstallError("SoulX candidate metadata differs from its receipt")
    lock = _regular_file(
        candidate_root,
        _relative(
            receipt["pythonRuntime"]["dependencyLock"]["path"],
            "candidate dependency lock path",
        ),
        "candidate dependency lock",
    )
    if _sha256(lock) != manifest["dependencyLockSha256"]:
        raise PresenterRuntimeInstallError("SoulX candidate dependency lock differs")
    for raw in receipt["models"]["files"]:
        relative = _relative(raw["path"], "candidate model path")
        path = _regular_file(candidate_root, relative, "candidate model")
        if path.stat().st_size != raw["bytes"] or _sha256(path) != raw["sha256"]:
            raise PresenterRuntimeInstallError("SoulX candidate model bytes differ")
    for group in (receipt["pythonRuntime"]["files"], receipt["ffmpeg"]["files"]):
        for raw in group:
            path = _regular_file(
                candidate_root,
                _relative(raw["path"], "candidate runtime path"),
                "candidate runtime",
            )
            if _sha256(path) != raw["sha256"]:
                raise PresenterRuntimeInstallError("SoulX candidate runtime bytes differ")
    inventory = _require_object(
        json.loads(
            (candidate_root / receipt["source"]["originalInventory"]["path"]).read_text(
                encoding="utf-8"
            )
        ),
        "candidate source inventory",
    )
    patched = _require_object(
        json.loads(
            (candidate_root / receipt["source"]["patchedSourceReceipt"]["path"]).read_text(
                encoding="utf-8"
            )
        ),
        "candidate patched source receipt",
    )
    expected_source = {
        _relative(raw["path"], "candidate source path"): (raw["bytes"], raw["sha256"])
        for raw in inventory["files"]
        if isinstance(raw, dict) and str(raw.get("path", "")).startswith("flash_head/")
    }
    for raw in patched["files"]:
        relative = _relative(raw["path"], "patched source")
        path = _regular_file(candidate_root, relative, "patched source")
        if path.stat().st_size != raw["patchedBytes"] or _sha256(path) != raw["patchedSha256"]:
            raise PresenterRuntimeInstallError("SoulX candidate patched source differs")
        if relative.parts[0] == "flash_head":
            expected_source[relative] = (raw["patchedBytes"], raw["patchedSha256"])
    actual_source = {
        PurePosixPath(path.relative_to(candidate_root).as_posix()): path
        for path in (candidate_root / "flash_head").rglob("*")
        if path.is_file()
        and not path.is_symlink()
        and not any(part in EXCLUDED_PARTS for part in path.parts)
        and not path.name.endswith((".pyc", ".log"))
    }
    if set(actual_source) != set(expected_source):
        raise PresenterRuntimeInstallError(
            "SoulX candidate source set differs from the official inventory"
        )
    for relative, path in actual_source.items():
        size, digest = expected_source[relative]
        if path.stat().st_size != size or _sha256(path) != digest:
            raise PresenterRuntimeInstallError(
                "SoulX candidate source differs from the official inventory"
            )
    return receipt


def stage_candidate(
    models_root: Path,
    candidate_root: Path,
    trusted_runtime_root: Path,
    manifest_path: Path = MANIFEST_PATH,
    *,
    developer_mode: bool = False,
) -> dict[str, Any]:
    if not developer_mode:
        raise PresenterRuntimeInstallError(
            "Reviewed-candidate staging is a developer-only operation; use the pinned cold installer"
        )
    manifest = load_install_manifest(manifest_path)
    models_root, final_root = _runtime_destination(models_root)
    if final_root.exists():
        receipt, fingerprint = _verified_installed_receipt(manifest_path, manifest, final_root)
        config = _runtime_config(manifest, models_root, final_root, fingerprint)
        recovered = dict(receipt)
        recovered["runtimeBackup"] = None
        recovered["stagedConfig"] = str(_publish_staged_config(models_root, config))
        recovered["recoveredExistingInstall"] = True
        return recovered
    candidate_root = candidate_root.resolve(strict=True)
    _verify_candidate(candidate_root, manifest)
    stage = final_root.with_name(f".{final_root.name}.install-{uuid.uuid4().hex}")
    stage.mkdir(parents=True, exist_ok=False)
    try:
        for directory in ("flash_head", "python-base", "venv"):
            _copy_tree(candidate_root / directory, stage / directory)
        _copy_runtime_encoder(manifest, trusted_runtime_root, stage)
        for raw in manifest["artifacts"]:
            if raw.get("kind") == "model-file":
                relative = _relative(raw["relativePath"], "model artifact")
                source = _regular_file(candidate_root, relative, "candidate model")
                if source.stat().st_size != raw["bytes"] or _sha256(source) != raw["sha256"]:
                    raise PresenterRuntimeInstallError(
                        "Candidate model differs from cold-install pin"
                    )
                _copy_file(source, _child(stage, relative))
        _copy_file(candidate_root / "LICENSE", stage / "LICENSE")
        _copy_resources(manifest, stage)
        _copy_file(
            candidate_root / "candidate-metadata" / "requirements-windows-cu128.lock.txt",
            stage / "manifests" / "requirements-windows-cu128.lock.txt",
        )
        receipt, config = _write_receipts(
            manifest_path,
            manifest,
            models_root,
            stage,
            final_root,
            "reviewed-candidate",
        )
        backup, staged_config = _promote_and_publish(stage, final_root, models_root, config)
        receipt["runtimeBackup"] = backup
        receipt["stagedConfig"] = str(staged_config)
        return receipt
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def _verified_installed_receipt(
    manifest_path: Path,
    manifest: Mapping[str, Any],
    runtime_root: Path,
) -> tuple[dict[str, Any], str]:
    receipt_path = _regular_file(
        runtime_root,
        PurePosixPath("manifests/install-receipt.json"),
        "install receipt",
    )
    if receipt_path.stat().st_size > 1024 * 1024:
        raise PresenterRuntimeInstallError("Installed SoulX receipt is too large")
    receipt = _require_object(
        json.loads(receipt_path.read_text(encoding="utf-8")), "install receipt"
    )
    fingerprint = _install_fingerprint(manifest_path, manifest)
    if (
        receipt.get("modelId") != MODEL_ID
        or receipt.get("modelRevision") != manifest["immutableRevision"]
        or receipt.get("manifestSha256") != _sha256(manifest_path)
        or receipt.get("installFingerprint") != fingerprint
        or receipt.get("runtimeRoot") != str(runtime_root.absolute())
        or receipt.get("dependencyLockSha256") != manifest["dependencyLockSha256"]
        or receipt.get("generatedRequirementsSha256") != manifest["generatedRequirementsSha256"]
    ):
        raise PresenterRuntimeInstallError(
            "Installed SoulX receipt differs from the reviewed manifest"
        )
    _verify_roles(manifest, runtime_root)
    _verify_runtime_ledger(runtime_root, receipt.get("runtimeLedger"))
    return receipt, fingerprint


def inspect_installed(models_root: Path, manifest_path: Path = MANIFEST_PATH) -> dict[str, Any]:
    manifest = load_install_manifest(manifest_path)
    models_root, runtime_root = _runtime_destination(models_root)
    _, fingerprint = _verified_installed_receipt(manifest_path, manifest, runtime_root)
    config_path = models_root / STAGED_CONFIG_NAME
    config_file = _regular_file(models_root, PurePosixPath(STAGED_CONFIG_NAME), "staged config")
    if config_file.stat().st_size > 1024 * 1024:
        raise PresenterRuntimeInstallError("Staged SoulX config is too large")
    config = _require_object(json.loads(config_file.read_text(encoding="utf-8")), "staged config")
    if config.get("installFingerprint") != fingerprint or config.get("modelId") != RUNTIME_MODEL_ID:
        raise PresenterRuntimeInstallError("Staged SoulX config differs from the installed runtime")
    _validate_runtime_config(config_path)
    return {
        "ok": True,
        "operation": "inspect",
        "modelId": MODEL_ID,
        "runtimeRoot": str(runtime_root),
        "runtimeReady": True,
        "activationReady": True,
        "runtimeRevision": manifest["immutableRevision"],
        "installFingerprint": fingerprint,
        "manifestSha256": _sha256(manifest_path),
        "artifactCount": len(manifest["artifacts"]),
        "stagedConfig": str(config_path),
    }


def activate_installed(models_root: Path, manifest_path: Path = MANIFEST_PATH) -> dict[str, Any]:
    inspection = inspect_installed(models_root, manifest_path)
    models_root = models_root.resolve(strict=True)
    primary = models_root / PRIMARY_CONFIG_NAME
    manifest = load_install_manifest(manifest_path)
    runtime = models_root / INSTALL_DIRECTORY
    # Rebuild against the latest primary so profiles and the GPU lease are not
    # lost if the user edited presenter setup after download.
    config = _runtime_config(
        manifest,
        models_root,
        runtime,
        inspection["installFingerprint"],
        remove_reviewed_overrides=True,
    )
    backup: Path | None = None
    if primary.exists():
        backup = models_root / (
            "presenter-runtime.previous-"
            f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%S%fZ')}-{uuid.uuid4().hex}.json"
        )
        if backup.exists():
            raise PresenterRuntimeInstallError(
                "Presenter runtime backup destination already exists"
            )
        shutil.copy2(primary, backup)
    _publish_staged_config(models_root, config)
    try:
        _atomic_write(primary, _canonical_json(config))
        _validate_runtime_config(primary)
    except Exception:
        if backup is None:
            primary.unlink(missing_ok=True)
        else:
            _atomic_write(primary, backup.read_bytes())
        raise
    return {
        **inspection,
        "operation": "activate",
        "activeConfig": str(primary),
        "previousConfig": str(backup) if backup is not None else None,
    }
