"""Command-line and stdio sidecar entry point."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from .desktop_worker import run_desktop_worker
from .ipc import handle_request, serve
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
