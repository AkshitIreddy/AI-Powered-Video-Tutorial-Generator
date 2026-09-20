"""Command-line and stdio sidecar entry point."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from .desktop_worker import run_desktop_worker
from .ipc import handle_request, serve
from .presenter_runtime_install import (
    PresenterRuntimeInstallError,
    activate_installed,
    inspect_installed,
    install_from_downloads,
    manifest_identity,
)
from .providers.comfyui_local import COMFYUI_RUNTIME_REVISION, ComfyBundleInstaller
from .service import PipelineService


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="alystria-pipeline")
    parser.add_argument(
        "--alystria-desktop-worker",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    subcommands = parser.add_subparsers(dest="command")
    subcommands.add_parser("serve", help="serve newline-delimited JSON over stdin/stdout")
    call = subcommands.add_parser("call", help="invoke one service method")
    call.add_argument("method")
    call.add_argument("params", nargs="?", default="{}", help="JSON object")
    subcommands.add_parser("doctor", help="print local pipeline diagnostics")
    local_image = subcommands.add_parser(
        "local-image", help="install or inspect a pinned local image bundle"
    )
    local_image_commands = local_image.add_subparsers(dest="local_image_operation", required=True)
    runtime = local_image_commands.add_parser("install-runtime")
    runtime.add_argument("--runtime-root", required=True)
    for operation in ("install", "preflight"):
        command = local_image_commands.add_parser(operation)
        command.add_argument("--runtime-root", required=True)
        command.add_argument("--model-id", required=True)
    presenter_runtime = subcommands.add_parser(
        "presenter-runtime", help="install or inspect a pinned presenter runtime"
    )
    presenter_commands = presenter_runtime.add_subparsers(
        dest="presenter_runtime_operation", required=True
    )
    plan = presenter_commands.add_parser("plan")
    plan.add_argument("--models-root", required=True)
    install = presenter_commands.add_parser("install")
    install.add_argument("--models-root", required=True)
    install.add_argument("--download-root", required=True)
    install.add_argument("--trusted-runtime-root", required=True)
    install.add_argument("--staging-only", action="store_true")
    for operation in ("inspect", "activate"):
        command = presenter_commands.add_parser(operation)
        command.add_argument("--models-root", required=True)
    return parser


def _run_local_image(arguments: argparse.Namespace) -> int:
    operation = str(arguments.local_image_operation)
    raw_model_id = getattr(arguments, "model_id", None)
    model_id = str(raw_model_id) if raw_model_id is not None else None
    runtime_root = Path(str(arguments.runtime_root))
    if not runtime_root.is_absolute():
        payload: dict[str, Any] = {
            "ok": False,
            "operation": operation,
            **({"modelId": model_id} if model_id is not None else {}),
            "error": {
                "code": "absolute_runtime_root_required",
                "message": "Local image runtime root must be an absolute path",
            },
        }
        print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        return 1

    installer = ComfyBundleInstaller(runtime_root)
    try:
        if operation == "install-runtime":
            installer.install_runtime()
            payload = {
                "ok": True,
                "operation": operation,
                "runtimeRoot": str(runtime_root.resolve()),
                "runtimeReady": True,
                "runtimeRevision": COMFYUI_RUNTIME_REVISION,
            }
        else:
            assert model_id is not None
            if operation == "install":
                installer.install_runtime()
                installer.install_bundle(model_id)
            preflight = installer.preflight(model_id)
            payload = {
                "ok": True,
                "operation": operation,
                "runtimeRoot": str(runtime_root.resolve()),
                **preflight,
            }
    except (OSError, RuntimeError, ValueError) as error:
        payload = {
            "ok": False,
            "operation": operation,
            **({"modelId": model_id} if model_id is not None else {}),
            "runtimeRoot": str(runtime_root.resolve()),
            "error": {
                "code": f"local_image_{operation}_failed",
                "message": str(error)[:500] or "Local image operation failed",
            },
        }
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return 0 if payload["ok"] else 1


def _run_presenter_runtime(arguments: argparse.Namespace) -> int:
    operation = str(arguments.presenter_runtime_operation)
    models_root = Path(str(arguments.models_root))
    payload: dict[str, Any]
    try:
        if not models_root.is_absolute() or not models_root.is_dir():
            raise PresenterRuntimeInstallError("Presenter models root must be an existing absolute directory")
        if operation == "plan":
            manifest_sha256, total_bytes, artifact_count = manifest_identity()
            payload = {
                "ok": True,
                "operation": operation,
                "modelId": "local/soulx-flashhead-pro",
                "modelsRoot": str(models_root.resolve()),
                "manifestSha256": manifest_sha256,
                "totalBytes": total_bytes,
                "artifactCount": artifact_count,
                "activationRequested": False,
            }
        elif operation == "install":
            if arguments.staging_only is not True:
                raise PresenterRuntimeInstallError("Cold installation requires explicit --staging-only")
            payload = {
                "ok": True,
                **install_from_downloads(
                    models_root,
                    Path(str(arguments.download_root)),
                    Path(str(arguments.trusted_runtime_root)),
                ),
                "operation": operation,
                "activationRequested": False,
            }
        elif operation == "inspect":
            payload = inspect_installed(models_root)
        elif operation == "activate":
            payload = activate_installed(models_root)
        else:  # pragma: no cover - argparse owns the closed vocabulary
            raise PresenterRuntimeInstallError("Unsupported presenter runtime operation")
    except (OSError, ValueError, PresenterRuntimeInstallError) as error:
        payload = {
            "ok": False,
            "operation": operation,
            "modelId": "local/soulx-flashhead-pro",
            "error": {
                "code": f"presenter_runtime_{operation}_failed",
                "message": str(error)[:500] or "Presenter runtime operation failed",
            },
        }
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return 0 if payload["ok"] else 1


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    if arguments.alystria_desktop_worker:
        if arguments.command is not None:
            _parser().error("--alystria-desktop-worker cannot be combined with a subcommand")
        return run_desktop_worker()
    if arguments.command is None:
        _parser().error("a subcommand is required")
    if arguments.command == "serve":
        return serve()
    if arguments.command == "local-image":
        return _run_local_image(arguments)
    if arguments.command == "presenter-runtime":
        return _run_presenter_runtime(arguments)
    service = PipelineService()
    if arguments.command == "doctor":
        print(json.dumps(service.doctor({}), ensure_ascii=False, indent=2))
        return 0
    try:
        params: Any = json.loads(arguments.params)
    except json.JSONDecodeError as error:
        _parser().error(f"params is not valid JSON: {error}")
    response = handle_request(service, {"id": "cli", "method": arguments.method, "params": params})
    print(json.dumps(response, ensure_ascii=False, indent=2))
    return 0 if response["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
