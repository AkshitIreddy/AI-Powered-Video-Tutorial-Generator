"""Authenticated loopback RPC transport for the Tauri desktop broker."""

from __future__ import annotations

import hmac
import json
import os
import socket
import socketserver
import sys
import threading
import uuid
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, BinaryIO, NoReturn, TextIO

from .background import DesktopJobSupervisor
from .ipc import handle_request
from .providers import (
    DesktopCredentialBrokerResolver,
    ProviderRuntimeFactory,
    UrllibTransport,
)
from .service import PipelineService, desktop_run_one

PROTOCOL_VERSION = 1
MAX_STARTUP_BYTES = 8 * 1024
MAX_REQUEST_BYTES = 96 * 1024 * 1024
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
SOCKET_TIMEOUT_SECONDS = 30.0
ALLOWED_METHODS = frozenset(
    {
        "system.ping",
        "system.shutdown",
        "project.initialize",
        "project.snapshot.get",
        "project.snapshot.save",
        "project.customization.save",
        "project.history.get",
        "project.history.undo",
        "project.history.redo",
        "project.export",
        "source.import",
        "asset.import",
        "asset.resolve",
        "editor.bindings.get",
        "editor.waveform.get",
        "editor.timeline.export",
        "presenter.profile.select",
        "provider.routingPolicy.get",
        "provider.routingPolicy.save",
        "generation.start",
        "generation.approve",
        "generation.cancel",
        "generation.retry",
        "control.regenerateScene",
        "control.searchVisualCandidates",
        "control.acceptVisualCandidate",
        "control.rejectVisualCandidate",
        "control.acceptSceneEditCandidate",
        "control.rejectSceneEditCandidate",
        "control.renderScene",
        "control.repairQa",
        "control.exportMaster",
        "job.status",
    }
)


@dataclass(frozen=True, slots=True)
class StartupConfiguration:
    authentication_token: str
    protocol_version: int
    credential_broker_endpoint: str | None = None
    credential_broker_token: str | None = None


class DesktopProtocolError(ValueError):
    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class _ThreadedLoopbackServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    block_on_close = True
    allow_reuse_address = False
    request_queue_size = 16

    authentication_token: str
    protocol_version: int
    shutdown_after_response: threading.Event
    pipeline_service: PipelineService

    def process_request_thread(self, request: Any, client_address: Any) -> None:
        try:
            self.finish_request(request, client_address)
        except Exception:
            self.handle_error(request, client_address)
        finally:
            # Close the accepted connection before stopping the listening
            # socket.  This guarantees the Rust client's read-to-EOF receives
            # the complete shutdown response rather than a Windows TCP reset.
            self.shutdown_request(request)
            if self.shutdown_after_response.is_set():
                self.shutdown()


class _IPv4LoopbackServer(_ThreadedLoopbackServer):
    address_family = socket.AF_INET


class _IPv6LoopbackServer(_ThreadedLoopbackServer):
    address_family = socket.AF_INET6


class _DesktopRequestHandler(socketserver.StreamRequestHandler):
    server: _ThreadedLoopbackServer

    def setup(self) -> None:
        super().setup()
        self.request.settimeout(SOCKET_TIMEOUT_SECONDS)

    def handle(self) -> None:
        request_id: str | None = None
        should_shutdown = False
        try:
            line = self.rfile.readline(MAX_REQUEST_BYTES + 1)
            if len(line) > MAX_REQUEST_BYTES:
                raise DesktopProtocolError(
                    "REQUEST_TOO_LARGE", "Worker request exceeds the 96 MiB safety limit"
                )
            if not line or not line.endswith(b"\n"):
                raise DesktopProtocolError(
                    "INCOMPLETE_REQUEST", "Worker request must be one newline-terminated JSON object"
                )
            try:
                request = json.loads(line)
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise DesktopProtocolError("INVALID_JSON", "Worker request is not valid JSON") from error
            if isinstance(request, dict) and isinstance(request.get("id"), str):
                with suppress(ValueError):
                    request_id = str(uuid.UUID(request["id"]))
            request_id, method, payload = _validate_request(
                request,
                authentication_token=self.server.authentication_token,
                protocol_version=self.server.protocol_version,
            )
            if method == "system.shutdown":
                response = _success_envelope(
                    request_id,
                    {"status": "shuttingDown"},
                    protocol_version=self.server.protocol_version,
                )
                should_shutdown = True
            else:
                service_response = handle_request(
                    self.server.pipeline_service,
                    {
                        "id": request_id,
                        "method": method,
                        "params": _service_payload(method, payload),
                    },
                )
                response = {
                    "protocolVersion": self.server.protocol_version,
                    **service_response,
                }
        except DesktopProtocolError as error:
            response = _error_envelope(
                request_id,
                error.code,
                str(error),
                retryable=error.retryable,
                protocol_version=self.server.protocol_version,
            )
        except (ConnectionError, OSError, TimeoutError):
            return
        except Exception:
            # Protocol clients receive a stable, non-sensitive failure.  The
            # packaged worker may log diagnostics to stderr, never stdout.
            response = _error_envelope(
                request_id,
                "INTERNAL",
                "The pipeline worker could not complete the request",
                retryable=True,
                protocol_version=self.server.protocol_version,
            )

        encoded = _encode_bounded_response(response, self.server.protocol_version, request_id)
        try:
            self.wfile.write(encoded)
            self.wfile.flush()
        except (BrokenPipeError, ConnectionError, OSError):
            return
        finally:
            if should_shutdown:
                self.server.shutdown_after_response.set()


def run_desktop_worker(
    *,
    input_stream: BinaryIO | None = None,
    output_stream: TextIO | None = None,
) -> int:
    """Run the desktop-only worker until an authenticated shutdown request."""

    startup_input = input_stream or sys.stdin.buffer
    readiness_output = output_stream or sys.stdout
    try:
        startup = _read_startup(startup_input)
    except DesktopProtocolError as error:
        print(f"alystria worker startup failed: {error}", file=sys.stderr)
        return 2

    server = _bind_loopback(startup)
    provider_runtime_factory = _provider_runtime_factory(startup)

    def executor(store: Any, runtime: Any) -> Any:
        return desktop_run_one(
            store,
            runtime,
            provider_runtime_factory=provider_runtime_factory,
        )

    background = DesktopJobSupervisor(executor)
    background.start()
    server.pipeline_service = PipelineService(
        background_supervisor=background,
        provider_runtime_factory=provider_runtime_factory,
    )
    try:
        endpoint = _format_endpoint(server.server_address)
        readiness = {
            "type": "ready",
            "protocolVersion": startup.protocol_version,
            "endpoint": endpoint,
        }
        readiness_output.write(json.dumps(readiness, separators=(",", ":")) + "\n")
        readiness_output.flush()
        server.serve_forever(poll_interval=0.1)
    finally:
        server.server_close()
        background.stop(timeout_seconds=2)
    return 0


def _read_startup(stream: BinaryIO) -> StartupConfiguration:
    line = stream.readline(MAX_STARTUP_BYTES + 1)
    if len(line) > MAX_STARTUP_BYTES:
        raise DesktopProtocolError("STARTUP_TOO_LARGE", "Startup message exceeds 8 KiB")
    if not line or not line.endswith(b"\n"):
        raise DesktopProtocolError("INVALID_STARTUP", "Startup message must be newline terminated")
    try:
        value = json.loads(line)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DesktopProtocolError("INVALID_STARTUP", "Startup message is not valid JSON") from error
    if not isinstance(value, dict) or set(value) not in (
        {"protocolVersion", "authenticationToken"},
        {"protocolVersion", "authenticationToken", "credentialBroker"},
    ):
        raise DesktopProtocolError("INVALID_STARTUP", "Startup message has an invalid shape")
    protocol_version = value.get("protocolVersion")
    if protocol_version != PROTOCOL_VERSION:
        raise DesktopProtocolError("PROTOCOL_MISMATCH", "Desktop worker protocol is incompatible")
    token = value.get("authenticationToken")
    if not isinstance(token, str) or not 32 <= len(token) <= 512 or any(ord(char) < 0x21 for char in token):
        raise DesktopProtocolError("INVALID_STARTUP", "Authentication token is invalid")
    if os.environ.get("ALYSTRIA_WORKER_AUTH") not in {None, "stdin"}:
        raise DesktopProtocolError("INVALID_STARTUP", "Unsupported worker authentication channel")
    declared_protocol = os.environ.get("ALYSTRIA_WORKER_PROTOCOL")
    if declared_protocol is not None and declared_protocol != str(protocol_version):
        raise DesktopProtocolError("PROTOCOL_MISMATCH", "Worker environment protocol is incompatible")
    broker = value.get("credentialBroker")
    if broker is None:
        return StartupConfiguration(token, protocol_version)
    if not isinstance(broker, dict) or set(broker) != {"endpoint", "authenticationToken"}:
        raise DesktopProtocolError("INVALID_STARTUP", "Credential broker has an invalid shape")
    endpoint = broker.get("endpoint")
    broker_token = broker.get("authenticationToken")
    if not isinstance(endpoint, str) or not endpoint:
        raise DesktopProtocolError("INVALID_STARTUP", "Credential broker endpoint is invalid")
    if (
        not isinstance(broker_token, str)
        or not 32 <= len(broker_token) <= 512
        or any(ord(char) < 0x21 for char in broker_token)
    ):
        raise DesktopProtocolError("INVALID_STARTUP", "Credential broker token is invalid")
    try:
        DesktopCredentialBrokerResolver(endpoint, broker_token)
    except (OSError, ValueError) as error:
        raise DesktopProtocolError(
            "INVALID_STARTUP", "Credential broker must be a valid loopback endpoint"
        ) from error
    return StartupConfiguration(token, protocol_version, endpoint, broker_token)


def _provider_runtime_factory(
    startup: StartupConfiguration,
) -> ProviderRuntimeFactory | None:
    if startup.credential_broker_endpoint is None or startup.credential_broker_token is None:
        return None
    resolver = DesktopCredentialBrokerResolver(
        startup.credential_broker_endpoint,
        startup.credential_broker_token,
    )
    return ProviderRuntimeFactory(
        transport_factory=lambda _provider_id: UrllibTransport(),
        credential_resolver=resolver,
    )


def _bind_loopback(startup: StartupConfiguration) -> _ThreadedLoopbackServer:
    errors: list[OSError] = []
    candidates: tuple[
        tuple[type[_ThreadedLoopbackServer], tuple[str, int]], ...
    ] = (
        (_IPv6LoopbackServer, ("::1", 0)),
        (_IPv4LoopbackServer, ("127.0.0.1", 0)),
    )
    for server_type, address in candidates:
        try:
            server = server_type(address, _DesktopRequestHandler)
        except OSError as error:
            errors.append(error)
            continue
        server.authentication_token = startup.authentication_token
        server.protocol_version = startup.protocol_version
        server.shutdown_after_response = threading.Event()
        return server
    detail = errors[-1] if errors else "no loopback address was available"
    raise OSError(f"Could not bind the desktop worker loopback socket: {detail}")


def _validate_request(
    value: Any, *, authentication_token: str, protocol_version: int
) -> tuple[str, str, dict[str, Any]]:
    if not isinstance(value, dict):
        raise DesktopProtocolError("INVALID_REQUEST", "Worker request must be a JSON object")
    expected = {"protocolVersion", "id", "authenticationToken", "method", "payload"}
    if set(value) != expected:
        raise DesktopProtocolError("INVALID_REQUEST", "Worker request has an invalid shape")
    raw_id = value.get("id")
    try:
        request_id = str(uuid.UUID(raw_id)) if isinstance(raw_id, str) else None
    except ValueError as error:
        raise DesktopProtocolError("INVALID_REQUEST", "Request id must be a UUID") from error
    if request_id is None:
        raise DesktopProtocolError("INVALID_REQUEST", "Request id must be a UUID")
    if value.get("protocolVersion") != protocol_version:
        raise DesktopProtocolError("PROTOCOL_MISMATCH", "Worker request protocol is incompatible")
    token = value.get("authenticationToken")
    if not isinstance(token, str) or not hmac.compare_digest(token, authentication_token):
        raise DesktopProtocolError("UNAUTHENTICATED", "Worker authentication failed")
    method = value.get("method")
    if not isinstance(method, str) or method not in ALLOWED_METHODS:
        raise DesktopProtocolError("METHOD_NOT_ALLOWED", "Worker method is not allowed")
    payload = value.get("payload")
    if payload is None and method in {"system.ping", "system.shutdown"}:
        payload = {}
    if not isinstance(payload, dict):
        raise DesktopProtocolError("INVALID_ARGUMENT", "Worker payload must be a JSON object")
    return request_id, method, payload


def _service_payload(method: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Translate the desktop command shape to the internal service contract."""

    if method not in {"provider.routingPolicy.get", "provider.routingPolicy.save"}:
        return payload
    project_directory = payload.get("projectDirectory")
    if project_directory is None:
        return payload
    translated = dict(payload)
    translated["projectPath"] = translated.pop("projectDirectory")
    return translated


def _success_envelope(
    request_id: str, result: Any, *, protocol_version: int
) -> dict[str, Any]:
    return {
        "protocolVersion": protocol_version,
        "id": request_id,
        "ok": True,
        "result": result,
        "error": None,
    }


def _error_envelope(
    request_id: str | None,
    code: str,
    message: str,
    *,
    retryable: bool,
    protocol_version: int,
) -> dict[str, Any]:
    return {
        "protocolVersion": protocol_version,
        "id": request_id,
        "ok": False,
        "result": None,
        "error": {"code": code, "message": message, "retryable": retryable},
    }


def _encode_bounded_response(
    response: dict[str, Any], protocol_version: int, request_id: str | None
) -> bytes:
    encoded = (json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    if len(encoded) <= MAX_RESPONSE_BYTES:
        return encoded
    fallback = _error_envelope(
        request_id,
        "RESPONSE_TOO_LARGE",
        "Worker response exceeds the 2 MiB safety limit",
        retryable=False,
        protocol_version=protocol_version,
    )
    return (json.dumps(fallback, separators=(",", ":")) + "\n").encode()


def _format_endpoint(address: Any) -> str:
    if not isinstance(address, tuple) or len(address) < 2:
        _unreachable_endpoint(address)
    host = str(address[0])
    port = int(address[1])
    return f"[{host}]:{port}" if ":" in host else f"{host}:{port}"


def _unreachable_endpoint(address: Any) -> NoReturn:
    raise RuntimeError(f"Unexpected server address: {address!r}")


def connect_address(endpoint: str) -> tuple[str, int]:
    """Parse a readiness endpoint for protocol integration tests."""

    if endpoint.startswith("["):
        host, separator, port = endpoint[1:].partition("]:")
    else:
        host, separator, port = endpoint.rpartition(":")
    if not separator:
        raise ValueError("Invalid worker endpoint")
    return host, int(port)
