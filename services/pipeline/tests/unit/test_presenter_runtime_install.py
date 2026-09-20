from __future__ import annotations

import hashlib
import json
import subprocess
import zipfile
from copy import deepcopy
from pathlib import Path

import pytest

from alystria import presenter_runtime_install as installer
from alystria.cli import _parser


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_manifest_pins_complete_offline_windows_runtime() -> None:
    manifest = installer.load_install_manifest()
    digest, total_bytes, artifact_count = installer.manifest_identity()

    assert len(digest) == 64
    assert total_bytes == 10_394_156_663
    assert artifact_count == 75
    wheels = [item for item in manifest["artifacts"] if item["kind"] == "wheel"]
    assert len(wheels) == 63
    assert {item["requirement"] for item in wheels} >= {
        "pip==25.2",
        "torch==2.7.1+cu128",
        "torchvision==0.22.1+cu128",
        "diffusers==0.36.0",
        "transformers==4.57.3",
    }
    assert all(item["sourceUrl"].startswith("https://") for item in manifest["artifacts"])
    assert set(manifest["roles"]) == {
        "adapter-entrypoint",
        "runtime-source-manifest",
        "audio-feature-config",
        "audio-feature-preprocessor",
        "audio-feature-weights",
        "flashhead-config",
        "flashhead-weights",
        "vae-weights",
    }


def test_reviewed_patch_reproduces_candidate_hashes(tmp_path: Path) -> None:
    candidate = Path(
        r"E:\temp\AI Video Tutorial Generator\runtimes\SoulX-FlashHead-candidate-9bc03de0"
    )
    archive = (
        candidate
        / "candidate-metadata"
        / ("official-source-9bc03de06bb0de82cd6bc477804512ae06144bf2.zip")
    )
    if not archive.is_file():
        pytest.skip("reviewed SoulX candidate is unavailable")
    installer._safe_extract(archive, tmp_path / "source")
    source = tmp_path / "source" / "SoulX-FlashHead-9bc03de06bb0de82cd6bc477804512ae06144bf2"
    installer._apply_reviewed_patch(source, installer.ASSET_ROOT / "soulx-windows-compat.patch")
    receipt = json.loads(
        (candidate / "candidate-metadata" / "patched-source-files.json").read_text(encoding="utf-8")
    )
    for item in receipt["files"]:
        path = source / item["path"]
        assert path.stat().st_size == item["patchedBytes"]
        assert _digest(path) == item["patchedSha256"]


def test_safe_extract_rejects_archive_traversal(tmp_path: Path) -> None:
    archive = tmp_path / "bad.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("../escape.txt", b"bad")

    with pytest.raises(installer.PresenterRuntimeInstallError, match="stay inside"):
        installer._safe_extract(archive, tmp_path / "output")
    assert not (tmp_path / "escape.txt").exists()


def test_wheel_install_is_offline_hash_required_and_uses_embedded_python(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stage = tmp_path / "stage"
    downloads = tmp_path / "downloads"
    (stage / "python-base").mkdir(parents=True)
    (stage / "python-base" / "python.exe").write_bytes(b"python")
    pip_wheel = downloads / "wheelhouse" / "pip.whl"
    pip_wheel.parent.mkdir(parents=True)
    with zipfile.ZipFile(pip_wheel, "w") as bundle:
        bundle.writestr("pip/__init__.py", b"__version__='test'\n")
        bundle.writestr("pip/__pycache__/__init__.cpython-310.pyc", b"packaged cache")
    manifest = {
        "python": {
            "executable": "python-base/python.exe",
            "sitePackages": "venv/Lib/site-packages",
            "bootstrapPipWheel": "wheelhouse/pip.whl",
            "pth": ["python310.zip", "..\\venv\\Lib\\site-packages", ".."],
        },
        "artifacts": [
            {
                "kind": "wheel",
                "requirement": "pip==25.2",
                "sha256": "a" * 64,
            }
        ],
    }
    requirements_bytes = f"pip==25.2 --hash=sha256:{'a' * 64}\n".encode()
    manifest["generatedRequirementsSha256"] = hashlib.sha256(requirements_bytes).hexdigest()
    observed: dict[str, object] = {}

    def fake_run(arguments: list[str], **kwargs: object) -> subprocess.CompletedProcess[bytes]:
        observed["arguments"] = arguments
        observed["environment"] = kwargs["env"]
        environment = kwargs["env"]
        assert isinstance(environment, dict)
        pip_temporary = Path(str(environment["TEMP"]))
        assert pip_temporary.is_dir()
        (pip_temporary / "wheel-unpack.tmp").write_bytes(b"temporary extraction")
        bundled_cache = (
            stage / "venv" / "Lib" / "site-packages" / "numpy" / "distutils" / "__pycache__"
        )
        bundled_cache.mkdir(parents=True)
        (bundled_cache / "conv_template.cpython-310.pyc").write_bytes(b"wheel bytecode")
        (bundled_cache.parent / "conv_template.py").write_text("source = True\n")
        return subprocess.CompletedProcess(arguments, 0, b"", b"")

    monkeypatch.setattr(subprocess, "run", fake_run)
    installer._install_wheels(manifest, downloads, stage)

    arguments = observed["arguments"]
    assert isinstance(arguments, list)
    assert arguments[0] == str(stage / "python-base" / "python.exe")
    assert arguments[1] == "-B"
    assert {"--no-index", "--no-deps", "--require-hashes", "--only-binary=:all:"} <= set(arguments)
    environment = observed["environment"]
    assert isinstance(environment, dict)
    assert environment["PIP_NO_INDEX"] == "1"
    assert environment["TEMP"] == environment["TMP"] == environment["TMPDIR"]
    assert not Path(str(environment["TEMP"])).exists()
    assert not list((stage / "venv" / "Lib" / "site-packages").rglob("*.pyc"))
    assert not list((stage / "venv" / "Lib" / "site-packages").rglob("__pycache__"))
    assert (
        stage / "venv" / "Lib" / "site-packages" / "numpy" / "distutils" / "conv_template.py"
    ).is_file()
    requirements = (stage / "manifests" / "requirements-windows-cu128.hashed.txt").read_text()
    assert requirements == f"pip==25.2 --hash=sha256:{'a' * 64}\n"


def test_runtime_config_preserves_profiles_and_custom_engine_overrides(
    tmp_path: Path,
) -> None:
    manifest = installer.load_install_manifest()
    models = tmp_path / "Models"
    runtime = models / installer.INSTALL_DIRECTORY
    runtime.mkdir(parents=True)
    for relative in {
        manifest["python"]["executable"],
        manifest["runtimeEncoder"]["executable"],
        manifest["runtimeEncoder"]["ffprobe"],
        "worker/local_presenter_worker.py",
        *manifest["roles"].values(),
    }:
        path = runtime / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(relative.encode())
    prior = {
        "schemaVersion": 1,
        "defaultProfileId": "teacher",
        "profiles": [{"profileId": "teacher", "portraitArtifactHash": "a" * 64}],
        "portraitRuntimeOverrides": [
            {"portraitArtifactHash": "b" * 64, "relativeConfigPath": "old.json"}
        ],
        "gpuLease": {
            "leaseId": "existing",
            "owner": "test",
            "mutexName": "global\\test",
            "deviceId": "cuda:0",
            "vramBytes": 9_000_000_000,
        },
    }
    models.mkdir(exist_ok=True)
    (models / installer.PRIMARY_CONFIG_NAME).write_text(json.dumps(prior), encoding="utf-8")

    config = installer._runtime_config(manifest, models, runtime, "c" * 64)

    assert config["profiles"] == prior["profiles"]
    assert config["defaultProfileId"] == "teacher"
    assert config["gpuLease"] == prior["gpuLease"]
    assert config["portraitRuntimeOverrides"] == prior["portraitRuntimeOverrides"]
    assert config["modelId"] == "soulx-flashhead-pro"
    assert config["executionPolicy"] == "managed-verified"
    assert config["networkPolicy"] == "supervisor-deny"


def test_manifest_rejects_unsafe_internal_paths_and_requirement_newlines(
    tmp_path: Path,
) -> None:
    manifest = installer.load_install_manifest()
    cases = []
    escaped = deepcopy(manifest)
    escaped["source"]["archiveRoot"] = "../escape"
    cases.append(escaped)
    injected = deepcopy(manifest)
    injected["artifacts"] = deepcopy(injected["artifacts"])
    wheel = next(row for row in injected["artifacts"] if row["kind"] == "wheel")
    wheel["requirement"] += "\n--index-url=https://example.invalid"
    cases.append(injected)
    wrong_kind = deepcopy(manifest)
    archive_path = wrong_kind["python"]["archivePath"]
    next(row for row in wrong_kind["artifacts"] if row["relativePath"] == archive_path)["kind"] = (
        "wheel"
    )
    cases.append(wrong_kind)
    for index, value in enumerate(cases):
        path = tmp_path / f"manifest-{index}.json"
        path.write_text(json.dumps(value), encoding="utf-8")
        with pytest.raises(installer.PresenterRuntimeInstallError):
            installer.load_install_manifest(path)


def test_runtime_ledger_rejects_unexpected_cache_file(tmp_path: Path) -> None:
    runtime = tmp_path / "runtime"
    (runtime / "worker").mkdir(parents=True)
    (runtime / "worker" / "worker.py").write_text("ok", encoding="utf-8")
    declaration = installer._write_runtime_ledger(runtime)
    (runtime / "worker" / "stale.pyc").write_bytes(b"cache")
    with pytest.raises(
        installer.PresenterRuntimeInstallError, match=r"mutable file: worker/stale\.pyc"
    ):
        installer._verify_runtime_ledger(runtime, declaration)


def test_runtime_ledger_reports_unexpected_cache_directory_path(tmp_path: Path) -> None:
    runtime = tmp_path / "runtime"
    cache = runtime / "venv" / "Lib" / "site-packages" / "numpy" / "__pycache__"
    cache.mkdir(parents=True)
    with pytest.raises(
        installer.PresenterRuntimeInstallError,
        match=r"mutable directory: venv/Lib/site-packages/numpy/__pycache__",
    ):
        installer._runtime_files(runtime)


def test_invalid_existing_primary_fails_closed(tmp_path: Path) -> None:
    models = tmp_path / "Models"
    models.mkdir()
    primary = models / installer.PRIMARY_CONFIG_NAME
    primary.write_text("{not-json", encoding="utf-8")
    with pytest.raises(installer.PresenterRuntimeInstallError, match="left unchanged"):
        installer._runtime_config(
            installer.load_install_manifest(), models, models / "runtime", "a" * 64
        )
    assert primary.read_text(encoding="utf-8") == "{not-json"


def test_promote_publish_failure_restores_stage(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stage = tmp_path / "stage"
    final = tmp_path / "final"
    stage.mkdir()
    (stage / "payload").write_bytes(b"ok")

    def fail_publish(*_args: object, **_kwargs: object) -> Path:
        raise installer.PresenterRuntimeInstallError("publish failed")

    monkeypatch.setattr(installer, "_publish_staged_config", fail_publish)
    with pytest.raises(installer.PresenterRuntimeInstallError, match="publish failed"):
        installer._promote_and_publish(stage, final, tmp_path, {})
    assert (stage / "payload").read_bytes() == b"ok"
    assert not final.exists()


def test_packaged_cli_has_no_candidate_stage_command() -> None:
    with pytest.raises(SystemExit):
        _parser().parse_args(["presenter-runtime", "stage-candidate"])


def test_activation_migration_preserves_custom_route_for_reviewed_portrait(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    manifest = installer.load_install_manifest()
    migration = manifest["activationRemovePortraitOverrides"][0]
    models = tmp_path / "Models"
    models.mkdir()
    override = {
        "portraitArtifactHash": migration["portraitArtifactHash"],
        "relativeConfigPath": "Presenter/custom-presenter.json",
    }
    primary = {
        "schemaVersion": 1,
        "profiles": [installer.DEFAULT_PROFILE],
        "defaultProfileId": installer.DEFAULT_PROFILE["profileId"],
        "portraitRuntimeOverrides": [override],
    }
    (models / installer.PRIMARY_CONFIG_NAME).write_text(json.dumps(primary), encoding="utf-8")
    monkeypatch.setattr(
        installer,
        "_pin",
        lambda _root, relative: {
            "relativePath": str(relative).replace("\\", "/"),
            "sha256": "b" * 64,
        },
    )
    config = installer._runtime_config(
        manifest,
        models,
        models / installer.INSTALL_DIRECTORY,
        "a" * 64,
        remove_reviewed_overrides=True,
    )
    assert config["portraitRuntimeOverrides"] == [override]


def test_source_manifest_uses_final_root_while_validating_stage(tmp_path: Path) -> None:
    stage = tmp_path / "stage"
    final = tmp_path / "final"
    files = {
        "python/python.exe": b"python",
        "python/python.dll": b"dll",
        "python/python._pth": b"pth",
        "ffmpeg/ffmpeg.exe": b"ffmpeg",
        "ffmpeg/ffprobe.exe": b"ffprobe",
        "flash_head/inference.py": b"source",
    }
    for relative, content in files.items():
        path = stage / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    source_manifest = stage / "manifests/source-manifest.json"
    installer._source_manifest(stage, final, source_manifest)
    manifest = {
        "roles": {"runtime-source-manifest": "manifests/source-manifest.json"},
        "python": {
            "executable": "python/python.exe",
            "executableSha256": _digest(stage / "python/python.exe"),
            "pythonDll": "python/python.dll",
            "pythonDllSha256": _digest(stage / "python/python.dll"),
            "pthFile": "python/python._pth",
            "pthSha256": _digest(stage / "python/python._pth"),
        },
        "runtimeEncoder": {
            "executable": "ffmpeg/ffmpeg.exe",
            "ffprobe": "ffmpeg/ffprobe.exe",
            "files": [
                {
                    "relativePath": "ffmpeg/ffmpeg.exe",
                    "bytes": (stage / "ffmpeg/ffmpeg.exe").stat().st_size,
                    "sha256": _digest(stage / "ffmpeg/ffmpeg.exe"),
                },
                {
                    "relativePath": "ffmpeg/ffprobe.exe",
                    "bytes": (stage / "ffmpeg/ffprobe.exe").stat().st_size,
                    "sha256": _digest(stage / "ffmpeg/ffprobe.exe"),
                },
            ],
        },
        "resources": [],
        "artifacts": [],
        "source": {"requiredFiles": ["flash_head/inference.py"]},
    }
    installer._verify_roles(manifest, stage, source_manifest_root=final)
    assert json.loads(source_manifest.read_text(encoding="utf-8"))["root"] == str(final.absolute())


def test_existing_verified_runtime_recovers_staged_config_without_rebuild(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    models = tmp_path / "Models"
    final = models / installer.INSTALL_DIRECTORY
    final.mkdir(parents=True)
    staged = models / installer.STAGED_CONFIG_NAME
    monkeypatch.setattr(
        installer,
        "_verified_installed_receipt",
        lambda *_args: ({"ok": True}, "f" * 64),
    )
    monkeypatch.setattr(installer, "_runtime_config", lambda *_args, **_kwargs: {"ok": True})
    monkeypatch.setattr(installer, "_publish_staged_config", lambda *_args: staged)
    result = installer.install_from_downloads(
        models, tmp_path / "missing-downloads", tmp_path / "missing-runtime"
    )
    assert result["recoveredExistingInstall"] is True
    assert result["stagedConfig"] == str(staged)


def test_exact_reviewed_joy_route_is_removed_only_when_child_identity_matches(
    tmp_path: Path,
) -> None:
    manifest = installer.load_install_manifest()
    migration = manifest["activationRemovePortraitOverrides"][0]
    models = tmp_path / "Models"
    child = models / migration["relativeConfigPath"]
    child.parent.mkdir(parents=True)
    child.write_text(
        json.dumps(
            {
                "modelId": migration["modelId"],
                "modelRevision": migration["modelRevision"],
                "installFingerprint": migration["installFingerprint"],
            }
        ),
        encoding="utf-8",
    )
    override = {
        "portraitArtifactHash": migration["portraitArtifactHash"],
        "relativeConfigPath": migration["relativeConfigPath"],
    }
    assert installer._matches_override_migration(
        models, override, manifest["activationRemovePortraitOverrides"]
    )
    child.write_text(json.dumps({"modelId": "custom"}), encoding="utf-8")
    assert not installer._matches_override_migration(
        models, override, manifest["activationRemovePortraitOverrides"]
    )
