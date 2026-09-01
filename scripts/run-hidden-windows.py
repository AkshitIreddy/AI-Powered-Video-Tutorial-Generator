"""Run a Windows command without allocating or showing a console window.

This helper is intended to be launched with ``pythonw.exe`` from WSL or another
GUI-subsystem parent. Command output is redirected to files and a compact JSON
status record makes success or failure observable without surfacing a terminal.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def write_status(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp-{os.getpid()}")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=True, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def parse_environment(values: list[str]) -> dict[str, str]:
    environment = os.environ.copy()
    for value in values:
        name, separator, setting = value.partition("=")
        if not separator or not name:
            raise ValueError(f"invalid --env value: {value!r}")
        environment[name] = setting
    return environment


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cwd", type=Path)
    parser.add_argument("--stdout", required=True, type=Path)
    parser.add_argument("--stderr", required=True, type=Path)
    parser.add_argument("--status", required=True, type=Path)
    parser.add_argument("--env", action="append", default=[])
    parser.add_argument("command", nargs=argparse.REMAINDER)
    arguments = parser.parse_args()

    command = list(arguments.command)
    if command[:1] == ["--"]:
        command = command[1:]
    if not command:
        parser.error("a command is required after --")

    arguments.stdout.parent.mkdir(parents=True, exist_ok=True)
    arguments.stderr.parent.mkdir(parents=True, exist_ok=True)
    started_at = utc_now()

    startup_info = subprocess.STARTUPINFO()
    startup_info.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup_info.wShowWindow = subprocess.SW_HIDE

    try:
        environment = parse_environment(arguments.env)
        with arguments.stdout.open("ab", buffering=0) as stdout_file, arguments.stderr.open(
            "ab", buffering=0
        ) as stderr_file:
            process = subprocess.Popen(
                command,
                cwd=arguments.cwd,
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=stdout_file,
                stderr=stderr_file,
                creationflags=subprocess.CREATE_NO_WINDOW,
                startupinfo=startup_info,
                close_fds=True,
            )
            write_status(
                arguments.status,
                {
                    "schemaVersion": 1,
                    "state": "running",
                    "pid": process.pid,
                    "startedAtUtc": started_at,
                },
            )
            exit_code = process.wait()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        write_status(
            arguments.status,
            {
                "schemaVersion": 1,
                "state": "launcher-failed",
                "errorType": type(error).__name__,
                "startedAtUtc": started_at,
                "finishedAtUtc": utc_now(),
            },
        )
        return 126

    write_status(
        arguments.status,
        {
            "schemaVersion": 1,
            "state": "succeeded" if exit_code == 0 else "failed",
            "exitCode": exit_code,
            "pid": process.pid,
            "startedAtUtc": started_at,
            "finishedAtUtc": utc_now(),
        },
    )
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
