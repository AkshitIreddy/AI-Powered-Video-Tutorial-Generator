"""CPU-only contract checks for the managed SoulX-FlashHead route."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

from alystria.generation.local_presenter import (
    LocalPresenterRuntime,
    PinnedPresenterFile,
    PresenterContractFile,
    PresenterEncoderPolicy,
    PresenterGpuLeaseMetadata,
    PresenterWorkerContract,
)

SOULX_ROLES = (
    "adapter-entrypoint",
    "runtime-source-manifest",
    "audio-feature-config",
    "audio-feature-preprocessor",
    "audio-feature-weights",
    "flashhead-config",
    "flashhead-weights",
    "vae-weights",
)


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _pin(path: Path) -> PinnedPresenterFile:
    return PinnedPresenterFile(path, _digest(path))


def test_managed_soulx_requires_exact_contract_encoder_gpu_and_workspace(tmp_path: Path) -> None:
    pinned = tmp_path / "pinned.bin"
    pinned.write_bytes(b"pinned")
    pin = _pin(pinned)
    contract = PresenterWorkerContract(
        "alystria.soulx-flashhead.worker.v1",
        pin,
        tuple(PresenterContractFile(role, pin) for role in SOULX_ROLES),
    )
    common = {
        "runtime_root": tmp_path,
        "executable": pin,
        "ffprobe": pin,
        "model_id": "soulx-flashhead-pro",
        "model_revision": "9bc03de0+pro-59119b6c",
        "motion_profile": "native-idle",
        "encoder_policy": PresenterEncoderPolicy(pin.path, pin.sha256),
        "worker_contract": contract,
        "gpu_lease": PresenterGpuLeaseMetadata(
            "test-lease", "pytest", "global\\alystria-test-gpu", "cuda:0", 9 * 1024**3
        ),
    }
    arguments = (
        "--job",
        "{job_manifest}",
        "--portrait",
        "{portrait}",
        "--audio",
        "{audio}",
        "--output",
        "{output}",
        "--workspace",
        "{workspace}",
    )
    runtime = LocalPresenterRuntime(argument_template=arguments, **common)
    assert runtime.worker_contract is contract
    assert runtime.motion_profile == "native-idle"

    without_workspace = arguments[:-2]
    with pytest.raises(ValueError, match="brokered attempt workspace"):
        LocalPresenterRuntime(argument_template=without_workspace, **common)
    with pytest.raises(ValueError, match="requires native-idle motion"):
        LocalPresenterRuntime(
            argument_template=arguments,
            **{**common, "motion_profile": "lip-sync-only"},
        )
    with pytest.raises(ValueError, match="requires an exact-hash worker contract"):
        LocalPresenterRuntime(
            argument_template=arguments,
            **{**common, "worker_contract": None},
        )


def test_soulx_contract_rejects_missing_or_unrelated_roles(tmp_path: Path) -> None:
    pin = PinnedPresenterFile(tmp_path / "unused", "0" * 64)
    with pytest.raises(ValueError, match="missing roles: vae-weights"):
        PresenterWorkerContract(
            "alystria.soulx-flashhead.worker.v1",
            pin,
            tuple(PresenterContractFile(role, pin) for role in SOULX_ROLES[:-1]),
        )
    with pytest.raises(ValueError, match="unsupported roles: motion-template"):
        PresenterWorkerContract(
            "alystria.soulx-flashhead.worker.v1",
            pin,
            tuple(PresenterContractFile(role, pin) for role in (*SOULX_ROLES, "motion-template")),
        )


def test_pinned_worker_accepts_soulx_and_emits_bounded_progress(tmp_path: Path) -> None:
    worker = Path(__file__).parents[2] / "scripts" / "local_presenter_worker.py"
    adapter = tmp_path / "soulx-adapter.py"
    source_root = tmp_path / "source"
    source_root.mkdir()
    source = source_root / "inference.py"
    source.write_text("# exact SoulX source\n", encoding="utf-8")
    source_manifest = tmp_path / "source-manifest.json"
    source_manifest.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "root": str(source_root),
                "files": [{"relativePath": source.name, "sha256": _digest(source)}],
            }
        ),
        encoding="utf-8",
    )
    adapter.write_text(
        "def run_presenter_job(job, emit_progress):\n"
        "    from pathlib import Path\n"
        "    assert job['model'] == 'soulx-flashhead-pro'\n"
        "    emit_progress('model-loading', 0.12, 'fake SoulX load')\n"
        "    emit_progress('inference', 0.8, 'fake SoulX chunks')\n"
        "    emit_progress('encoding', 0.96, 'fake brokered encoding')\n"
        "    Path(job['output']['path']).write_bytes(b'0' * 1024)\n"
        "    return 0\n",
        encoding="utf-8",
    )
    paths = {
        "adapter-entrypoint": adapter,
        "runtime-source-manifest": source_manifest,
        **{
            role: tmp_path / f"{role}.bin"
            for role in SOULX_ROLES
            if role not in {"adapter-entrypoint", "runtime-source-manifest"}
        },
    }
    for role, path in paths.items():
        if role not in {"adapter-entrypoint", "runtime-source-manifest"}:
            path.write_bytes(f"exact {role}".encode())

    workspace = tmp_path / "workspace"
    output_root = tmp_path / "output"
    workspace.mkdir()
    output_root.mkdir()
    portrait = tmp_path / "portrait.png"
    audio = tmp_path / "audio.wav"
    output = output_root / "presenter.mp4"
    progress = tmp_path / "progress.ndjson"
    ffmpeg = tmp_path / "ffmpeg.exe"
    portrait.write_bytes(b"\x89PNG\r\n\x1a\n" + bytes(64))
    audio.write_bytes(b"RIFF" + bytes(64))
    ffmpeg.write_bytes(b"pinned ffmpeg")
    manifest = tmp_path / "job.json"
    job = {
        "schemaVersion": 2,
        "model": "soulx-flashhead-pro",
        "modelRevision": "9bc03de0+pro-59119b6c",
        "seed": 42,
        "inputs": {
            "portrait": {"path": str(portrait), "sha256": _digest(portrait)},
            "audio": {"path": str(audio), "sha256": _digest(audio)},
        },
        "workspace": {"path": str(workspace)},
        "output": {"path": str(output), "mediaType": "video/mp4"},
        "progress": {"path": str(progress), "schemaVersion": 1},
        "encoding": {
            "policy": "alystria-presenter-h264-v1",
            "encoder": "h264_nvenc",
            "codecArguments": ["-c:v", "h264_nvenc"],
            "ffmpegPath": str(ffmpeg),
            "ffmpegSha256": _digest(ffmpeg),
        },
        "gpuLease": {
            "leaseId": "test-lease",
            "owner": "pytest",
            "mutexName": "global\\alystria-test-gpu",
            "deviceId": "cuda:0",
            "vramBytes": 9 * 1024**3,
        },
        "workerContract": {
            "contractId": "alystria.soulx-flashhead.worker.v1",
            "entrypoint": {"path": str(worker), "sha256": _digest(worker)},
            "files": [
                {"role": role, "path": str(path), "sha256": _digest(path)}
                for role, path in paths.items()
            ],
        },
    }
    manifest.write_text(json.dumps(job), encoding="utf-8")
    command = (
        sys.executable,
        str(worker),
        "--job",
        str(manifest),
        "--portrait",
        str(portrait),
        "--audio",
        str(audio),
        "--output",
        str(output),
        "--workspace",
        str(workspace),
        "--seed",
        "42",
    )
    result = subprocess.run(command, cwd=tmp_path, capture_output=True, check=False, timeout=10)
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    events = [json.loads(line) for line in progress.read_text(encoding="utf-8").splitlines()]
    assert [event["progress"] for event in events] == sorted(event["progress"] for event in events)
    assert events[0]["message"] == "SoulX-FlashHead Pro job accepted"
    assert events[-1]["stage"] == "complete"
    assert output.stat().st_size == 1_024

    output.unlink()
    progress.unlink()
    job["model"] = "joyvasa-human"
    manifest.write_text(json.dumps(job), encoding="utf-8")
    mismatch = subprocess.run(command, cwd=tmp_path, capture_output=True, check=False, timeout=10)
    assert mismatch.returncode == 1
    assert b"model and worker contract do not match" in mismatch.stderr
