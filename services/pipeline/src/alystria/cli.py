"""Command-line and stdio sidecar entry point."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from typing import Any

from .desktop_worker import run_desktop_worker
from .ipc import handle_request, serve
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
    return parser


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
