"""Pinned worker boundary for the local presenter runtime.

This file intentionally has no torch or MuseTalk import at module load time. The
privileged runtime pack supplies one exact-hash adapter implementing
``run_presenter_job(job, emit_progress)`` and the adapter owns model-specific
imports. The broker verifies the same ledger before launch; this worker verifies
it again before importing any runtime code.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path
from types import ModuleType
from typing import Any, NoReturn

MUSE_TALK_CONTRACT_ID = "alystria.musetalk.worker.v1"
JOYVASA_CONTRACT_ID = "alystria.joyvasa.worker.v1"
MUSE_TALK_MODELS = frozenset({"musetalk", "musetalk-1.5", "liveportrait-musetalk-1.5"})
JOYVASA_MODELS = frozenset({"joyvasa-human", "joyvasa-animal"})
SUPPORTED_MODELS = MUSE_TALK_MODELS | JOYVASA_MODELS
ALLOWED_MUSE_TALK_ROLES = frozenset(
    {
        "adapter-entrypoint",
        "audio-feature-config",
        "audio-feature-preprocessor",
        "audio-feature-weights",
        "face-detection-weights",
        "face-landmark-weights",
        "face-parse-weights",
        "face-resnet-weights",
        "musetalk-config",
        "musetalk-inference-entrypoint",
        "musetalk-adapter-entrypoint",
        "musetalk-weights",
        "liveportrait-motion-template",
        "liveportrait-runtime-manifest",
        "runtime-source-manifest",
        "vae-config",
        "vae-weights",
    }
)
REQUIRED_MUSE_TALK_ROLES = frozenset(
    {
        "adapter-entrypoint",
        "audio-feature-config",
        "audio-feature-preprocessor",
        "audio-feature-weights",
        "face-detection-weights",
        "face-landmark-weights",
        "face-parse-weights",
        "face-resnet-weights",
        "musetalk-config",
        "musetalk-inference-entrypoint",
        "musetalk-weights",
        "runtime-source-manifest",
        "vae-config",
        "vae-weights",
    }
)
ALLOWED_JOYVASA_ROLES = frozenset(
    {
        "adapter-entrypoint",
        "runtime-source-manifest",
        "audio-feature-config",
        "audio-feature-preprocessor",
        "audio-feature-weights",
        "motion-generator-weights",
        "motion-template",
        "portrait-runtime-manifest",
    }
)
REQUIRED_JOYVASA_ROLES = ALLOWED_JOYVASA_ROLES
CONTRACTS = {
    MUSE_TALK_CONTRACT_ID: (MUSE_TALK_MODELS, ALLOWED_MUSE_TALK_ROLES, REQUIRED_MUSE_TALK_ROLES),
    JOYVASA_CONTRACT_ID: (JOYVASA_MODELS, ALLOWED_JOYVASA_ROLES, REQUIRED_JOYVASA_ROLES),
}
SHA256_LENGTH = 64
MAX_MANIFEST_BYTES = 1024 * 1024
DENIED_NETWORK_AUDIT_EVENTS = frozenset(
    {
        "socket.bind",
        "socket.connect",
        "socket.getaddrinfo",
        "socket.gethostbyaddr",
        "socket.gethostbyname",
        "socket.gethostbyname_ex",
    }
)


def _fail(message: str) -> NoReturn:
    raise RuntimeError(message)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _regular_file(value: object, label: str) -> Path:
    if not isinstance(value, str) or not value or "\x00" in value:
        _fail(f"{label} path is invalid")
    path = Path(value)
    try:
        if path.is_symlink() or not path.resolve(strict=True).is_file():
            _fail(f"{label} must be a regular non-symlink file")
    except OSError as error:
        raise RuntimeError(f"{label} is unavailable") from error
    return path


def _verify_pin(value: object, label: str) -> Path:
    if not isinstance(value, dict):
        _fail(f"{label} pin is missing")
    path = _regular_file(value.get("path"), label)
    digest = value.get("sha256")
    if (
        not isinstance(digest, str)
        or len(digest) != SHA256_LENGTH
        or any(character not in "0123456789abcdef" for character in digest)
    ):
        _fail(f"{label} SHA-256 is invalid")
    if _sha256(path) != digest:
        _fail(f"{label} SHA-256 changed")
    return path


def _load_manifest(path: Path) -> dict[str, Any]:
    info = path.lstat()
    if path.is_symlink() or not path.is_file() or not 0 < info.st_size <= MAX_MANIFEST_BYTES:
        _fail("job manifest must be a small regular file")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schemaVersion") != 2:
        _fail("job manifest requires schemaVersion 2")
    if value.get("model") not in SUPPORTED_MODELS:
        _fail("worker accepts only pinned local presenter jobs")
    return value


def _load_adapter(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location("alystria_pinned_presenter_adapter", path)
    if spec is None or spec.loader is None:
        _fail("could not load pinned presenter adapter")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _install_network_denial() -> None:
    """Deny network resolution, client connections, and listener binding.

    Python audit hooks cannot be removed by imported model code. This is paired
    with offline library flags so the exact-hash worker fails rather than
    reaching a provider, model hub, telemetry collector, or local listener.
    """

    for name in (
        "ALYSTRIA_TRUST_REMOTE_CODE",
        "HF_DATASETS_OFFLINE",
        "HF_HUB_DISABLE_TELEMETRY",
        "HF_HUB_OFFLINE",
        "TRANSFORMERS_OFFLINE",
    ):
        os.environ[name] = "0" if name == "ALYSTRIA_TRUST_REMOTE_CODE" else "1"

    def deny_network(event: str, _: tuple[object, ...]) -> None:
        if event in DENIED_NETWORK_AUDIT_EVENTS:
            raise PermissionError(f"Local presenter network access denied: {event}")

    sys.addaudithook(deny_network)


def _verify_source_manifest(path: Path, label: str) -> None:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        _fail(f"{label} has an invalid schema")
    root_value = value.get("root")
    files = value.get("files")
    if not isinstance(root_value, str) or not isinstance(files, list) or not files:
        _fail(f"{label} is incomplete")
    root = Path(root_value).resolve(strict=True)
    if root.is_symlink() or not root.is_dir() or len(files) > 10_000:
        _fail(f"{label} root or file count is unsafe")
    for index, item in enumerate(files):
        if not isinstance(item, dict):
            _fail(f"{label} entry {index} is invalid")
        relative_value = item.get("relativePath")
        if not isinstance(relative_value, str):
            _fail(f"{label} entry {index} has no relative path")
        relative = Path(relative_value)
        if relative.is_absolute() or not relative.parts or ".." in relative.parts:
            _fail(f"{label} entry {index} escapes its root")
        candidate = (root / relative).resolve(strict=True)
        try:
            candidate.relative_to(root)
        except ValueError as error:
            raise RuntimeError(f"{label} entry escaped its root") from error
        _verify_pin(
            {"path": str(candidate), "sha256": item.get("sha256")},
            f"{label} source {relative.as_posix()}",
        )


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("--job", required=True)
    parser.add_argument("--portrait", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--seed", required=True, type=int)
    return parser.parse_args()


def main() -> int:
    args = _arguments()
    manifest_path = _regular_file(args.job, "job manifest")
    job = _load_manifest(manifest_path)
    contract = job.get("workerContract")
    contract_id = contract.get("contractId") if isinstance(contract, dict) else None
    contract_policy = CONTRACTS.get(contract_id)
    if not isinstance(contract, dict) or contract_policy is None:
        _fail("presenter worker contract is missing or unsupported")
    contract_models, allowed_roles, required_roles = contract_policy
    if job["model"] not in contract_models:
        _fail("presenter model and worker contract do not match")
    worker_entrypoint = _verify_pin(contract.get("entrypoint"), "worker entrypoint")
    if worker_entrypoint.resolve(strict=True) != Path(__file__).resolve(strict=True):
        _fail("worker contract entrypoint does not identify this pinned broker")
    files = contract.get("files")
    if not isinstance(files, list):
        _fail("worker contract files are missing")
    verified: dict[str, Path] = {}
    for index, item in enumerate(files):
        if not isinstance(item, dict):
            _fail(f"worker contract file {index} is invalid")
        role = item.get("role")
        if not isinstance(role, str) or role not in allowed_roles or role in verified:
            _fail(f"worker contract role {role!r} is invalid or duplicated")
        verified[role] = _verify_pin(item, f"worker contract {role}")
    if job["model"] == "liveportrait-musetalk-1.5":
        required_roles = required_roles | {
            "liveportrait-motion-template",
            "liveportrait-runtime-manifest",
            "musetalk-adapter-entrypoint",
        }
    if not required_roles <= verified.keys():
        _fail("worker contract is incomplete")
    _verify_source_manifest(verified["runtime-source-manifest"], "runtime source manifest")
    if job["model"] == "liveportrait-musetalk-1.5":
        _verify_source_manifest(
            verified["liveportrait-runtime-manifest"], "LivePortrait runtime manifest"
        )
    if contract_id == JOYVASA_CONTRACT_ID:
        _verify_source_manifest(
            verified["portrait-runtime-manifest"], "portrait runtime manifest"
        )

    encoding = job.get("encoding")
    if not isinstance(encoding, dict):
        _fail("managed presenter job has no brokered encoder selection")
    _verify_pin(
        {"path": encoding.get("ffmpegPath"), "sha256": encoding.get("ffmpegSha256")},
        "presenter FFmpeg",
    )

    lease = job.get("gpuLease")
    if not isinstance(lease, dict) or not all(
        isinstance(lease.get(key), str) and lease[key]
        for key in ("leaseId", "owner", "mutexName", "deviceId")
    ):
        _fail("GPU lease metadata is missing")
    if not isinstance(lease.get("vramBytes"), int) or lease["vramBytes"] <= 0:
        _fail("GPU lease VRAM metadata is invalid")

    inputs = job.get("inputs")
    output = job.get("output")
    progress = job.get("progress")
    if not isinstance(inputs, dict) or not isinstance(output, dict) or not isinstance(progress, dict):
        _fail("job I/O contract is incomplete")
    portrait = _verify_pin(inputs.get("portrait"), "portrait input")
    audio = _verify_pin(inputs.get("audio"), "audio input")
    output_path = Path(str(output.get("path", "")))
    progress_path = Path(str(progress.get("path", "")))
    workspace = Path(args.workspace)
    if (
        portrait != Path(args.portrait).resolve(strict=True)
        or audio != Path(args.audio).resolve(strict=True)
        or output_path != Path(args.output)
        or int(job.get("seed", -1)) != args.seed
    ):
        _fail("argv and manifest I/O identity differ")
    if output_path.exists() or not output_path.parent.is_dir():
        _fail("output path must be a new file in an existing directory")
    if progress_path.exists() or not progress_path.parent.is_dir():
        _fail("progress path must be a new file in an existing directory")
    if not workspace.is_dir() or workspace.is_symlink():
        _fail("workspace must be an existing non-symlink directory")

    sequence = 0
    last_progress = -1.0

    def emit_progress(stage: str, progress_value: float, message: str) -> None:
        nonlocal sequence, last_progress
        if stage not in {
            "accepted",
            "verified",
            "model-loading",
            "inference",
            "encoding",
            "complete",
        }:
            _fail(f"adapter emitted unsupported progress stage {stage!r}")
        if not last_progress <= progress_value <= 1 or not message or len(message) > 512:
            _fail("adapter emitted invalid progress")
        sequence += 1
        last_progress = progress_value
        event = {
            "schemaVersion": 1,
            "sequence": sequence,
            "stage": stage,
            "progress": progress_value,
            "message": message,
        }
        with progress_path.open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(json.dumps(event, sort_keys=True, separators=(",", ":")) + "\n")
            stream.flush()
            os.fsync(stream.fileno())

    presenter_name = {
        "liveportrait-musetalk-1.5": "LivePortrait + MuseTalk",
        "joyvasa-human": "JoyVASA human",
        "joyvasa-animal": "JoyVASA animal",
    }.get(job["model"], "MuseTalk")
    emit_progress("accepted", 0.0, f"{presenter_name} job accepted")
    emit_progress("verified", 0.05, "Exact-hash runtime and inputs verified")
    _install_network_denial()
    emit_progress("model-loading", 0.1, f"Loading pinned {presenter_name} adapter")
    adapter = _load_adapter(verified["adapter-entrypoint"])
    entry = getattr(adapter, "run_presenter_job", None)
    if not callable(entry):
        _fail("pinned presenter adapter has no run_presenter_job function")
    result = entry(job, emit_progress)
    if result not in (None, 0):
        _fail(f"pinned presenter adapter failed with result {result!r}")
    if not output_path.is_file() or output_path.is_symlink():
        _fail("pinned presenter adapter did not produce the declared output")
    emit_progress("complete", 1.0, f"{presenter_name} delivery completed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"local presenter worker failed: {type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1) from error
