"""CPU-only tests for the staged JoyVASA runtime installer."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[4] / "scripts" / "prepare-joyvasa-presenter-runtime.py"
REPOSITORY = Path(__file__).parents[4]


@pytest.fixture
def installer():
    spec = importlib.util.spec_from_file_location("prepare_joyvasa_runtime", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _canonical_digest(value: object) -> str:
    content = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()
    return hashlib.sha256(content).hexdigest()


def _fixture(tmp_path: Path) -> dict[str, Path]:
    candidate = tmp_path / "candidate"
    repository = tmp_path / "repository"
    models = tmp_path / "Models"
    destination = models / "Presenter" / "JoyVASA"
    primary = models / "presenter-runtime.json"
    routes_path = tmp_path / "routes.json"
    manifest_path = candidate / "candidate-metadata" / "alystria-install-manifest.json"
    revision = "916a90f8de490e8648fee460c1200bd5d9a795af"

    candidate_files = {
        "python-base/python.exe": b"portable python base",
        "ffmpeg/ffmpeg.exe": b"ffmpeg",
        "ffmpeg/ffprobe.exe": b"ffprobe",
        "ffmpeg/avcodec.dll": b"ffmpeg dependency",
        "src/config/argument_config.py": b"# argument config\n",
        "src/config/crop_config.py": b"# crop config\n",
        "src/config/inference_config.py": b"# inference config\n",
        "src/config/models.yaml": b"model_params: {}\n",
        "src/live_portrait_wmg_wrapper.py": b"# wrapper\n",
        "src/modules/dit_talking_head.py": b"# motion model\n",
        "src/live_portrait_wmg_pipeline.py": b"# human pipeline\n",
        "src/live_portrait_wmg_pipeline_animal.py": b"# animal pipeline\n",
        "src/utils/resources/lip_array.pkl": b"lip array",
        "src/utils/resources/mask_template.png": b"mask template",
        "pretrained_weights/chinese-hubert-base/config.json": b"{}\n",
        "pretrained_weights/chinese-hubert-base/preprocessor_config.json": b"{}\n",
        "pretrained_weights/chinese-hubert-base/pytorch_model.bin": b"audio weights",
        "pretrained_weights/JoyVASA/motion_generator/motion_generator_hubert_chinese.pt": (
            b"motion generator"
        ),
        "pretrained_weights/JoyVASA/motion_template/motion_template.pkl": b"motion template",
        "pretrained_weights/liveportrait/base_models/appearance_feature_extractor.pth": b"h-f",
        "pretrained_weights/liveportrait/base_models/motion_extractor.pth": b"h-m",
        "pretrained_weights/liveportrait/base_models/spade_generator.pth": b"h-g",
        "pretrained_weights/liveportrait/base_models/warping_module.pth": b"h-w",
        "pretrained_weights/liveportrait_animals/base_models_v1.1/appearance_feature_extractor.pth": (
            b"a-f"
        ),
        "pretrained_weights/liveportrait_animals/base_models_v1.1/motion_extractor.pth": b"a-m",
        "pretrained_weights/liveportrait_animals/base_models_v1.1/spade_generator.pth": b"a-g",
        "pretrained_weights/liveportrait_animals/base_models_v1.1/warping_module.pth": b"a-w",
    }
    repository_files = {
        "services/pipeline/scripts/local_presenter_worker.py": b"# strict worker\n",
        "services/pipeline/scripts/joyvasa_presenter_adapter.py": b"# broker adapter\n",
    }
    for relative, content in candidate_files.items():
        target = candidate / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    dependency = candidate / "venv" / "Lib" / "site-packages" / "torch" / "__init__.py"
    dependency.parent.mkdir(parents=True, exist_ok=True)
    dependency.write_bytes(b"# pinned torch package\n")
    for relative, content in repository_files.items():
        target = repository / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    evidence_path = candidate / "candidate-metadata" / "candidate-manifest.json"
    _write_json(evidence_path, {"schemaVersion": 1, "source": {"commit": revision}})

    files = []
    for relative in candidate_files:
        source = candidate / relative
        files.append(
            {
                "origin": "candidate",
                "sourcePath": relative,
                "installPath": relative,
                "bytes": source.stat().st_size,
                "sha256": _digest(source),
            }
        )
    repository_install_paths = {
        "services/pipeline/scripts/local_presenter_worker.py": "worker/local_presenter_worker.py",
        "services/pipeline/scripts/joyvasa_presenter_adapter.py": "worker/joyvasa_presenter_adapter.py",
    }
    for relative, install_path in repository_install_paths.items():
        source = repository / relative
        files.append(
            {
                "origin": "repository",
                "sourcePath": relative,
                "installPath": install_path,
                "bytes": source.stat().st_size,
                "sha256": _digest(source),
            }
        )

    curated = {
        "schemaVersion": 1,
        "packId": "joyvasa-reviewed-test",
        "sourceRevision": revision,
        "modelRevision": f"joyvasa-{revision}",
        "motionProfile": "native-idle",
        "candidateEvidence": {
            "relativePath": "candidate-metadata/candidate-manifest.json",
            "sha256": _digest(evidence_path),
            "sourceRevisionField": "source.commit",
        },
        "files": files,
        "trees": [
            {
                "origin": "candidate",
                "sourcePath": "venv/Lib/site-packages",
                "installPath": "venv/Lib/site-packages",
                "fileCount": 1,
                "bytes": dependency.stat().st_size,
                "sha256": _canonical_digest(
                    {
                        "files": [
                            {
                                "relativePath": "torch/__init__.py",
                                "bytes": dependency.stat().st_size,
                                "sha256": _digest(dependency),
                            }
                        ]
                    }
                ),
            }
        ],
        "runtime": {
            "executable": "python-base/python.exe",
            "pythonRuntime": {
                "kind": "embedded",
                "home": "python-base",
                "homeExecutable": "python-base/python.exe",
                "sitePackages": "venv/Lib/site-packages",
            },
            "ffmpeg": "ffmpeg/ffmpeg.exe",
            "ffprobe": "ffmpeg/ffprobe.exe",
            "workerEntrypoint": "worker/local_presenter_worker.py",
            "adapterEntrypoint": "worker/joyvasa_presenter_adapter.py",
            "audioFeatureConfig": "pretrained_weights/chinese-hubert-base/config.json",
            "audioFeaturePreprocessor": (
                "pretrained_weights/chinese-hubert-base/preprocessor_config.json"
            ),
            "audioFeatureWeights": (
                "pretrained_weights/chinese-hubert-base/pytorch_model.bin"
            ),
            "motionGeneratorWeights": (
                "pretrained_weights/JoyVASA/motion_generator/"
                "motion_generator_hubert_chinese.pt"
            ),
            "motionTemplate": (
                "pretrained_weights/JoyVASA/motion_template/motion_template.pkl"
            ),
            "sourceManifestFiles": [
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
                "python-base/python.exe",
                "worker/local_presenter_worker.py",
                "worker/joyvasa_presenter_adapter.py",
            ],
            "portraitRuntimeManifestFiles": [
                "pretrained_weights/chinese-hubert-base/config.json",
                "pretrained_weights/chinese-hubert-base/preprocessor_config.json",
                "pretrained_weights/chinese-hubert-base/pytorch_model.bin",
                "pretrained_weights/JoyVASA/motion_generator/"
                "motion_generator_hubert_chinese.pt",
                "pretrained_weights/JoyVASA/motion_template/motion_template.pkl",
                "pretrained_weights/liveportrait/base_models/appearance_feature_extractor.pth",
                "pretrained_weights/liveportrait/base_models/motion_extractor.pth",
                "pretrained_weights/liveportrait/base_models/spade_generator.pth",
                "pretrained_weights/liveportrait/base_models/warping_module.pth",
                "pretrained_weights/liveportrait_animals/base_models_v1.1/"
                "appearance_feature_extractor.pth",
                "pretrained_weights/liveportrait_animals/base_models_v1.1/motion_extractor.pth",
                "pretrained_weights/liveportrait_animals/base_models_v1.1/spade_generator.pth",
                "pretrained_weights/liveportrait_animals/base_models_v1.1/warping_module.pth",
            ],
            "pinnedFiles": ["ffmpeg/avcodec.dll"],
        },
        "canonicalProfiles": {
            "human": {
                "profileId": "presenter-portrait.casual-anime-finn-v1",
                "portraitArtifactHash": "1" * 64,
                "subjectId": "fictional-synthetic-casual-anime-finn-v1",
            },
            "animal": {
                "profileId": "presenter-portrait.animal-cat-milo-v1",
                "portraitArtifactHash": "2" * 64,
                "subjectId": "fictional-synthetic-animal-cat-milo-v1",
            },
        },
    }
    _write_json(manifest_path, curated)

    original_primary = {
        "schemaVersion": 1,
        "runtimeRoot": str(models / "Presenter"),
        "executionPolicy": "unsafe-test-only",
        "networkPolicy": "not-enforced",
        "unsafeTestOnlyAcknowledged": True,
        "defaultProfileId": "presenter-portrait.broadcast-elena-v1",
        "profiles": [
            {
                "profileId": "presenter-portrait.broadcast-elena-v1",
                "portraitArtifactHash": "a" * 64,
                "subjectId": "fictional-synthetic-broadcast-elena-v1",
            }
        ],
        "gpuLease": {
            "leaseId": "test-lease",
            "owner": "test sandbox",
            "mutexName": "global\\presenter-test",
            "deviceId": "cuda:0",
            "vramBytes": 12_000_000_000,
        },
        "presenterEncoding": {
            "policy": "alystria-presenter-h264-v1",
            "ffmpeg": {"relativePath": "old/ffmpeg.exe", "sha256": "b" * 64},
            "gplX264": None,
            "probeTimeoutSeconds": 30,
        },
        "minimumOutputBytes": 1024,
        "timeoutSeconds": 3600,
        "ownerExtension": {"preserve": [1, 2, 3]},
    }
    _write_json(primary, original_primary)

    routes = []
    for index in range(8):
        routes.append(
            {
                "runtime": "human" if index == 0 else "animal",
                "profileId": f"presenter-portrait.optional-{index}",
                "portraitArtifactHash": f"{index + 3:064x}",
                "subjectId": f"fictional-synthetic-optional-{index}",
            }
        )
    _write_json(routes_path, {"schemaVersion": 1, "routes": routes})
    return {
        "candidate": candidate,
        "repository": repository,
        "destination": destination,
        "primary": primary,
        "routes": routes_path,
        "manifest": manifest_path,
    }


def _plan(installer, paths: dict[str, Path], *, routes: bool = True):
    return installer.build_plan(
        candidate_root=paths["candidate"],
        repository_root=paths["repository"],
        destination=paths["destination"],
        primary_config=paths["primary"],
        curated_manifest_path=paths["manifest"],
        routes_manifest_path=paths["routes"] if routes else None,
    )


def _set_first_route_migration(paths: dict[str, Path], prior_hash: str, new_hash: str) -> None:
    routes = json.loads(paths["routes"].read_text(encoding="utf-8"))
    routes["routes"][0]["portraitArtifactHash"] = new_hash
    routes["routes"][0]["priorPortraitArtifactHash"] = prior_hash
    _write_json(paths["routes"], routes)


def test_dry_run_validates_every_source_without_mutating_models(installer, tmp_path: Path):
    paths = _fixture(tmp_path)
    original = paths["primary"].read_bytes()

    plan = _plan(installer, paths)
    receipt = installer.describe(plan)

    assert receipt["validated"] is True
    assert receipt["networkUsed"] is False
    assert receipt["routeCount"] == 8
    assert receipt["primaryConfigWouldChange"] is True
    assert receipt["preservedPrimaryDefaultProfileId"] == (
        "presenter-portrait.broadcast-elena-v1"
    )
    assert not paths["destination"].exists()
    assert paths["primary"].read_bytes() == original
    assert not tuple(paths["primary"].parent.glob("*.backup-*"))


def test_activate_builds_pinned_children_and_preserves_primary_config(installer, tmp_path: Path):
    paths = _fixture(tmp_path)
    original = json.loads(paths["primary"].read_text(encoding="utf-8"))

    result = installer.activate(_plan(installer, paths), "copy")

    assert result["runtimeAction"] == "installed"
    assert result["primaryConfigAction"] == "updated"
    assert result["requestedRouteCount"] == 8
    backup = Path(result["primaryConfigBackup"])
    assert json.loads(backup.read_text(encoding="utf-8")) == original
    updated = json.loads(paths["primary"].read_text(encoding="utf-8"))
    assert updated["defaultProfileId"] == original["defaultProfileId"]
    assert updated["profiles"] == original["profiles"]
    assert updated["ownerExtension"] == original["ownerExtension"]
    assert len(updated["portraitRuntimeOverrides"]) == 8

    expected_paths = {
        "Presenter/JoyVASA/joy-human.json",
        "Presenter/JoyVASA/joy-animal.json",
    }
    assert {item["relativeConfigPath"] for item in updated["portraitRuntimeOverrides"]} == (
        expected_paths
    )
    for runtime_name, filename in installer.CHILD_CONFIGS.items():
        child = json.loads((paths["destination"] / filename).read_text(encoding="utf-8"))
        assert child["modelId"] == f"joyvasa-{runtime_name}"
        assert child["executionPolicy"] == "unsafe-test-only"
        assert child["networkPolicy"] == "not-enforced"
        assert child["argumentTemplate"][:2] == [
            "-B",
            "worker/local_presenter_worker.py",
        ]
        assert "portraitRuntimeOverrides" not in child
        assert len(child["profiles"]) == 1
        assert child["workerContract"]["contractId"] == "alystria.joyvasa.worker.v1"
        assert {item["role"] for item in child["workerContract"]["files"]} == {
            "adapter-entrypoint",
            "runtime-source-manifest",
            "audio-feature-config",
            "audio-feature-preprocessor",
            "audio-feature-weights",
            "motion-generator-weights",
            "motion-template",
            "portrait-runtime-manifest",
        }
        source_manifest_pin = next(
            item
            for item in child["workerContract"]["files"]
            if item["role"] == "runtime-source-manifest"
        )
        source_manifest = json.loads(
            (paths["destination"] / source_manifest_pin["relativePath"]).read_text(
                encoding="utf-8"
            )
        )
        source_paths = {item["relativePath"] for item in source_manifest["files"]}
        assert "src/utils/resources/lip_array.pkl" in source_paths
        assert "src/utils/resources/mask_template.png" in source_paths
    assert not (paths["destination"] / "venv" / "pyvenv.cfg").exists()
    assert (paths["destination"] / "python-base" / "python.exe").is_file()
    assert (paths["destination"] / "install-receipt.json").is_file()


def test_repeated_activation_verifies_existing_pack_without_new_backup(installer, tmp_path: Path):
    paths = _fixture(tmp_path)
    plan = _plan(installer, paths)
    first = installer.activate(plan, "copy")
    backups_before = set(paths["primary"].parent.glob("*.backup-*"))

    second = installer.activate(plan, "copy")

    assert first["runtimeAction"] == "installed"
    assert second["runtimeAction"] == "verified-existing"
    assert second["primaryConfigAction"] == "unchanged"
    assert set(paths["primary"].parent.glob("*.backup-*")) == backups_before


def test_hash_drift_fails_before_any_destination_or_config_mutation(installer, tmp_path: Path):
    paths = _fixture(tmp_path)
    original = paths["primary"].read_bytes()
    (
        paths["candidate"]
        / "pretrained_weights"
        / "JoyVASA"
        / "motion_generator"
        / "motion_generator_hubert_chinese.pt"
    ).write_bytes(b"changed")

    with pytest.raises(installer.InstallError, match="Reviewed source file changed"):
        _plan(installer, paths)

    assert not paths["destination"].exists()
    assert paths["primary"].read_bytes() == original


def test_dependency_tree_drift_fails_before_any_destination_or_config_mutation(
    installer, tmp_path: Path
):
    paths = _fixture(tmp_path)
    original = paths["primary"].read_bytes()
    dependency = paths["candidate"] / "venv" / "Lib" / "site-packages" / "torch" / "__init__.py"
    dependency.write_bytes(b"changed dependency")

    with pytest.raises(installer.InstallError, match="Reviewed source tree changed"):
        _plan(installer, paths)

    assert not paths["destination"].exists()
    assert paths["primary"].read_bytes() == original


def test_conflicting_existing_route_is_rejected_without_mutation(installer, tmp_path: Path):
    paths = _fixture(tmp_path)
    primary = json.loads(paths["primary"].read_text(encoding="utf-8"))
    route = json.loads(paths["routes"].read_text(encoding="utf-8"))["routes"][0]
    primary["portraitRuntimeOverrides"] = [
        {
            "portraitArtifactHash": route["portraitArtifactHash"],
            "relativeConfigPath": "Presenter/Other/child.json",
        }
    ]
    _write_json(paths["primary"], primary)
    original = paths["primary"].read_bytes()

    with pytest.raises(installer.InstallError, match="different runtime"):
        installer.activate(_plan(installer, paths), "copy")

    assert not paths["destination"].exists()
    assert paths["primary"].read_bytes() == original


def test_explicit_route_migration_replaces_only_the_expected_prior_hash(
    installer, tmp_path: Path
):
    paths = _fixture(tmp_path)
    prior_hash = "c" * 64
    new_hash = "d" * 64
    unrelated = {
        "portraitArtifactHash": "e" * 64,
        "relativeConfigPath": "Presenter/Other/child.json",
    }
    expected_path = "Presenter/JoyVASA/joy-human.json"
    primary = json.loads(paths["primary"].read_text(encoding="utf-8"))
    primary["portraitRuntimeOverrides"] = [
        unrelated,
        {
            "portraitArtifactHash": prior_hash,
            "relativeConfigPath": expected_path,
        },
    ]
    _write_json(paths["primary"], primary)
    _set_first_route_migration(paths, prior_hash, new_hash)

    first = installer.activate(_plan(installer, paths), "copy")
    updated = json.loads(paths["primary"].read_text(encoding="utf-8"))
    overrides = updated["portraitRuntimeOverrides"]

    assert first["primaryConfigAction"] == "updated"
    assert first["routes"][0]["priorPortraitArtifactHash"] == prior_hash
    assert unrelated in overrides
    assert not any(item["portraitArtifactHash"] == prior_hash for item in overrides)
    assert {
        "portraitArtifactHash": new_hash,
        "relativeConfigPath": expected_path,
    } in overrides
    assert installer.activate(_plan(installer, paths), "copy")["primaryConfigAction"] == (
        "unchanged"
    )


def test_route_migration_rejects_prior_hash_routed_to_another_runtime(
    installer, tmp_path: Path
):
    paths = _fixture(tmp_path)
    prior_hash = "c" * 64
    new_hash = "d" * 64
    primary = json.loads(paths["primary"].read_text(encoding="utf-8"))
    primary["portraitRuntimeOverrides"] = [
        {
            "portraitArtifactHash": prior_hash,
            "relativeConfigPath": "Presenter/Other/child.json",
        }
    ]
    _write_json(paths["primary"], primary)
    original = paths["primary"].read_bytes()
    _set_first_route_migration(paths, prior_hash, new_hash)

    with pytest.raises(installer.InstallError, match=r"Prior portrait .* different runtime"):
        installer.activate(_plan(installer, paths), "copy")

    assert paths["primary"].read_bytes() == original
    assert not paths["destination"].exists()


def test_route_migration_rejects_missing_prior_and_current_hash(installer, tmp_path: Path):
    paths = _fixture(tmp_path)
    _set_first_route_migration(paths, "c" * 64, "d" * 64)

    with pytest.raises(installer.InstallError, match="missing before guarded migration"):
        installer.describe(_plan(installer, paths))

    assert not paths["destination"].exists()


def test_manifest_rejects_path_traversal(installer, tmp_path: Path):
    paths = _fixture(tmp_path)
    manifest = json.loads(paths["manifest"].read_text(encoding="utf-8"))
    manifest["files"][0]["installPath"] = "../escape.exe"
    _write_json(paths["manifest"], manifest)

    with pytest.raises(installer.InstallError, match="must stay inside"):
        _plan(installer, paths)


def test_manifest_must_pin_every_adapter_selected_source(installer, tmp_path: Path):
    paths = _fixture(tmp_path)
    manifest = json.loads(paths["manifest"].read_text(encoding="utf-8"))
    manifest["runtime"]["sourceManifestFiles"].remove("src/utils/resources/lip_array.pkl")
    _write_json(paths["manifest"], manifest)

    plan = _plan(installer, paths)
    with pytest.raises(installer.InstallError, match="adapter-selected source paths"):
        installer.describe(plan)


def test_repo_route_manifest_matches_the_bundled_presenter_bytes():
    routes = json.loads(
        (REPOSITORY / "docs/assets/joyvasa-presenter-routes-2026-09-20.json").read_text(
            encoding="utf-8"
        )
    )["routes"]

    assert len(routes) == 8
    assert [route["runtime"] for route in routes].count("human") == 1
    assert [route["runtime"] for route in routes].count("animal") == 7
    for route in routes:
        slug = route["profileId"].removeprefix("presenter-portrait.")
        portrait = REPOSITORY / "apps" / "desktop" / "src" / "assets" / "presenters" / f"{slug}.png"
        assert portrait.is_file(), route["profileId"]
        assert _digest(portrait) == route["portraitArtifactHash"]


def test_tracked_curated_manifest_is_machine_independent_and_pins_repo_sources():
    manifest_path = REPOSITORY / "docs" / "models" / "joyvasa" / "install-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    serialized = manifest_path.read_text(encoding="utf-8")

    assert _digest(manifest_path) == "240e993925e6faf8a954303334529334e44ddb82e29921c89112f86c0d3f946d"
    assert manifest["candidateEvidence"]["sha256"] == (
        "cd22d9e2d97162e1a99201a329dd436c19984f3e64123ba4674c3d6ac4df4ff6"
    )
    assert manifest["trees"] == [
        {
            "origin": "candidate",
            "sourcePath": "venv/Lib/site-packages",
            "installPath": "venv/Lib/site-packages",
            "fileCount": 42_871,
            "bytes": 5_977_361_589,
            "sha256": "4f5b7beade14d39aa93ac50261284dec20a8e128872676284af62622b1802de8",
        }
    ]
    assert "C:\\\\Users" not in serialized
    assert "E:\\\\" not in serialized
    for entry in manifest["files"]:
        if entry["origin"] != "repository":
            continue
        source = REPOSITORY / entry["sourcePath"]
        assert source.stat().st_size == entry["bytes"]
        assert _digest(source) == entry["sha256"]
