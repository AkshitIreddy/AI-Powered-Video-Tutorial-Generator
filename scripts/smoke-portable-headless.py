#!/usr/bin/env python3
"""Launch a portable AI Video Tutorial Generator build invisibly and verify it stays healthy."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--portable-root", required=True, type=Path)
    parser.add_argument("--seconds", type=float, default=12.0)
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    options = arguments()
    portable = options.portable_root.resolve(strict=True)
    executable = portable / "App" / "AI Video Tutorial Generator.exe"
    executable.resolve(strict=True)
    logs = portable / "Logs"
    evidence = portable / "Evidence"
    logs.mkdir(parents=True, exist_ok=True)
    evidence.mkdir(parents=True, exist_ok=True)
    stdout_path = logs / "packaged-headless-smoke.stdout.log"
    stderr_path = logs / "packaged-headless-smoke.stderr.log"

    environment = os.environ.copy()
    # Deliberately provide no portable path redirects here. The packaged GUI
    # executable must discover its sibling manifest and bootstrap WebView2,
    # state, caches, models, and workers by itself. This flag only suppresses
    # the main window for automated acceptance.
    environment["ALYSTRIA_HEADLESS_ACCEPTANCE"] = "1"
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = subprocess.SW_HIDE
    started = datetime.now(UTC)
    with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
        process = subprocess.Popen(
            [str(executable)],
            cwd=portable,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=stdout,
            stderr=stderr,
            startupinfo=startup,
            creationflags=subprocess.CREATE_NO_WINDOW,
            close_fds=True,
        )
        deadline = time.monotonic() + options.seconds
        while time.monotonic() < deadline:
            exit_code = process.poll()
            if exit_code is not None:
                raise RuntimeError(
                    f"Packaged AI Video Tutorial Generator exited during the headless smoke with code {exit_code}"
                )
            time.sleep(0.25)
        subprocess.run(
            [r"C:\Windows\System32\taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW,
            startupinfo=startup,
            check=False,
        )
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired as error:
            raise RuntimeError(
                "Packaged AI Video Tutorial Generator did not stop after the smoke test"
            ) from error

    report = {
        "schemaVersion": 1,
        "state": "passed",
        "headless": True,
        "durationSeconds": options.seconds,
        "startedAtUtc": started.isoformat().replace("+00:00", "Z"),
        "finishedAtUtc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "executable": str(executable),
        "executableSha256": sha256_file(executable),
        "portableRoot": str(portable),
        "stdoutBytes": stdout_path.stat().st_size,
        "stderrBytes": stderr_path.stat().st_size,
    }
    (evidence / "packaged-headless-smoke.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
