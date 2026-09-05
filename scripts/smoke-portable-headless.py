#!/usr/bin/env python3
"""Launch a portable AI Video Tutorial Generator build invisibly and verify it stays healthy."""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--portable-root", required=True, type=Path)
    parser.add_argument(
        "--seconds",
        type=float,
        default=120.0,
        help="maximum seconds for exact runtime verification and worker readiness",
    )
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def free_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def process_is_running(process_id: int) -> bool:
    process_query_limited_information = 0x1000
    still_active = 259
    handle = ctypes.windll.kernel32.OpenProcess(
        process_query_limited_information, False, process_id
    )
    if not handle:
        return False
    try:
        exit_code = ctypes.c_ulong()
        if not ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
            return False
        return exit_code.value == still_active
    finally:
        ctypes.windll.kernel32.CloseHandle(handle)


def close_windows_for_process(process_id: int) -> list[dict[str, object]]:
    wm_close = 0x0010
    closed: list[dict[str, object]] = []
    enum_callback = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

    @enum_callback
    def visit(window: int, _: int) -> bool:
        owner = ctypes.c_ulong()
        ctypes.windll.user32.GetWindowThreadProcessId(window, ctypes.byref(owner))
        if owner.value == process_id:
            title = ctypes.create_unicode_buffer(512)
            class_name = ctypes.create_unicode_buffer(256)
            ctypes.windll.user32.GetWindowTextW(window, title, len(title))
            ctypes.windll.user32.GetClassNameW(window, class_name, len(class_name))
            posted = bool(ctypes.windll.user32.PostMessageW(window, wm_close, 0, 0))
            closed.append(
                {
                    "handle": int(window),
                    "title": title.value,
                    "className": class_name.value,
                    "visible": bool(ctypes.windll.user32.IsWindowVisible(window)),
                    "posted": posted,
                }
            )
        return True

    ctypes.windll.user32.EnumWindows(visit, 0)
    return closed


def wait_for_native_ready(report_path: Path, process: subprocess.Popen[bytes], timeout: float) -> dict[str, object]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if report_path.is_file():
            report = json.loads(report_path.read_text(encoding="utf-8"))
            if report.get("state") == "ready":
                return report
            if report.get("state") == "failed":
                raise RuntimeError(f"Native acceptance startup failed: {report.get('reason', 'unknown')}")
        exit_code = process.poll()
        if exit_code is not None:
            raise RuntimeError(
                f"Packaged AI Video Tutorial Generator exited before native readiness with code {exit_code}"
            )
        time.sleep(0.1)
    raise RuntimeError("The packaged app did not report native WebView/worker readiness in time")


def wait_for_webview_target(port: int, timeout: float) -> dict[str, object]:
    deadline = time.monotonic() + timeout
    endpoint = f"http://127.0.0.1:{port}/json/list"
    last_page: dict[str, object] | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(endpoint, timeout=0.5) as response:
                targets = json.loads(response.read())
            pages = [target for target in targets if target.get("type") == "page"]
            for page in pages:
                observed = {
                    "title": str(page.get("title", "")),
                    "url": str(page.get("url", "")),
                }
                last_page = observed
                if observed["title"] == "AI Video Tutorial Generator" and str(
                    observed["url"]
                ).startswith(("http://tauri.localhost", "tauri://localhost")):
                    return observed
        except (OSError, ValueError, urllib.error.URLError):
            pass
        time.sleep(0.1)
    raise RuntimeError(
        "The packaged WebView did not load the expected headless acceptance document"
        f"; last page was {last_page!r}"
    )


def pe_subsystem(path: Path) -> int:
    with path.open("rb") as executable:
        if executable.read(2) != b"MZ":
            raise RuntimeError("The packaged desktop executable has no PE header")
        executable.seek(0x3C)
        pe_offset = int.from_bytes(executable.read(4), "little")
        executable.seek(pe_offset)
        if executable.read(4) != b"PE\x00\x00":
            raise RuntimeError("The packaged desktop executable has an invalid PE header")
        executable.seek(pe_offset + 24 + 68)
        return int.from_bytes(executable.read(2), "little")


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
    native_ready_path = evidence / "native-headless-ready.json"
    native_ready_path.unlink(missing_ok=True)
    debugging_port = free_loopback_port()

    environment = os.environ.copy()
    # Deliberately provide no portable path redirects here. The packaged GUI
    # executable must discover its sibling manifest and bootstrap WebView2,
    # state, caches, models, and workers by itself. This flag only suppresses
    # the main window for automated acceptance.
    environment["ALYSTRIA_HEADLESS_ACCEPTANCE"] = "1"
    environment["ALYSTRIA_HEADLESS_ACCEPTANCE_CDP_PORT"] = str(debugging_port)
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = subprocess.SW_HIDE
    started = datetime.now(UTC)
    process: subprocess.Popen[bytes] | None = None
    try:
        with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
            process_start = time.monotonic()
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
            webview = wait_for_webview_target(debugging_port, min(options.seconds, 30.0))
            webview_ready_seconds = time.monotonic() - process_start
            native_ready = wait_for_native_ready(native_ready_path, process, options.seconds)
            worker_ready_seconds = time.monotonic() - process_start
            if webview["title"] != "AI Video Tutorial Generator":
                raise RuntimeError(
                    f"The packaged WebView loaded an unexpected document: {webview['title']!r}"
                )
            if not str(webview["url"]).startswith(
                ("http://tauri.localhost", "tauri://localhost")
            ):
                raise RuntimeError(
                    f"The packaged WebView loaded an unexpected URL: {webview['url']!r}"
                )
            worker_pid = int(native_ready["workerPid"])
            if not process_is_running(worker_pid):
                raise RuntimeError("The packaged pipeline worker exited before acceptance completed")
            posted_windows = close_windows_for_process(process.pid)
            if not posted_windows or not any(window["posted"] for window in posted_windows):
                raise RuntimeError("No native Tauri window was available for a graceful WM_CLOSE")
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired as error:
                raise RuntimeError(
                    "The packaged app did not exit after a graceful WM_CLOSE; "
                    f"posted windows: {posted_windows!r}"
                ) from error
            if process.returncode != 0:
                raise RuntimeError(f"The packaged app exited with code {process.returncode}")
            worker_deadline = time.monotonic() + 10
            while time.monotonic() < worker_deadline and process_is_running(worker_pid):
                time.sleep(0.1)
            if process_is_running(worker_pid):
                raise RuntimeError("The supervised pipeline worker survived the desktop app shutdown")
    finally:
        if process is not None and process.poll() is None:
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
            except subprocess.TimeoutExpired:
                pass

    subsystem = pe_subsystem(executable)
    if subsystem != 2:
        raise RuntimeError(f"The packaged executable uses PE subsystem {subsystem}, expected Windows GUI (2)")

    report = {
        "schemaVersion": 1,
        "state": "passed",
        "headless": True,
        "gracefulShutdown": True,
        "nativeWorkerHandshake": True,
        "workerExitedWithApp": True,
        "closedWindows": posted_windows,
        "webview": webview,
        "webviewReadySeconds": round(webview_ready_seconds, 3),
        "workerReadySeconds": round(worker_ready_seconds, 3),
        "peSubsystem": subsystem,
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
