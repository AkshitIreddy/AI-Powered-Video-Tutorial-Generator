"""Headless authenticated smoke test for a packaged Alystria sidecar."""

from __future__ import annotations

import argparse
import json
import secrets
import socket
import subprocess
import uuid
from pathlib import Path
from typing import Any


def call(endpoint: tuple[str, int], token: str, method: str) -> dict[str, Any]:
    request_id = str(uuid.uuid4())
    request = {
        "protocolVersion": 1,
        "id": request_id,
        "authenticationToken": token,
        "method": method,
        "payload": {},
    }
    with socket.create_connection(endpoint, timeout=5) as stream:
        stream.sendall((json.dumps(request) + "\n").encode())
        stream.shutdown(socket.SHUT_WR)
        chunks: list[bytes] = []
        while data := stream.recv(65_536):
            chunks.append(data)
    response = json.loads(b"".join(chunks))
    if response.get("id") != request_id or not response.get("ok"):
        raise RuntimeError(f"Sidecar rejected {method}: {response.get('error')}")
    result = response.get("result")
    if not isinstance(result, dict):
        raise TypeError(f"Sidecar returned an invalid {method} result")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("executable", type=Path)
    arguments = parser.parse_args()
    executable = arguments.executable.resolve(strict=True)
    process = subprocess.Popen(
        [str(executable), "--alystria-desktop-worker"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    token = secrets.token_urlsafe(32)
    if process.stdin is None or process.stdout is None:
        raise RuntimeError("Sidecar did not expose startup pipes")
    process.stdin.write(json.dumps({"protocolVersion": 1, "authenticationToken": token}) + "\n")
    process.stdin.flush()
    process.stdin.close()
    ready = json.loads(process.stdout.readline())
    if ready.get("type") != "ready" or ready.get("protocolVersion") != 1:
        raise RuntimeError(f"Sidecar readiness failed: {ready}")
    raw_endpoint = str(ready["endpoint"])
    if raw_endpoint.startswith("["):
        host, port = raw_endpoint[1:].split("]:" , 1)
    else:
        host, port = raw_endpoint.rsplit(":", 1)
    endpoint = (host, int(port))
    ping = call(endpoint, token, "system.ping")
    shutdown = call(endpoint, token, "system.shutdown")
    process.wait(timeout=10)
    print(f"sidecar_protocol={ready['protocolVersion']}")
    print(f"sidecar_service={ping.get('service')}")
    print(f"sidecar_status={ping.get('status')}")
    print(f"sidecar_shutdown={shutdown.get('status')}")
    print(f"sidecar_exit={process.returncode}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
