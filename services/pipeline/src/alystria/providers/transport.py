"""Injectable HTTP transport; production pins standard-library HTTPS, tests use fakes."""

from __future__ import annotations

import json
import socket
import ssl
from dataclasses import dataclass, field
from http.client import HTTPException, HTTPSConnection
from typing import Any, Protocol
from urllib.parse import urlsplit

from ..security.errors import PolicyViolation
from ..security.network import (
    DEFAULT_URL_POLICY,
    Resolver,
    UrlPolicy,
    ValidatedUrl,
    assert_connected_peer,
    system_resolver,
    validate_url,
)
from ..security.privacy import (
    DataClassification,
    PrivacyMode,
    ProviderBoundary,
    current_network_context,
    enforce_network_access,
)
from .errors import FailureCode, ProviderFailure

_SENSITIVE_HEADERS = {"authorization", "x-api-key", "api-key", "ocp-apim-subscription-key"}


@dataclass(frozen=True, slots=True)
class HttpRequest:
    method: str
    url: str
    headers: dict[str, str] = field(default_factory=dict, repr=False)
    json_body: dict[str, Any] | None = field(default=None, repr=False)
    body: bytes | None = field(default=None, repr=False)
    timeout_seconds: float = 120.0

    def redacted_headers(self) -> dict[str, str]:
        return {
            key: "[REDACTED]" if key.lower() in _SENSITIVE_HEADERS else value
            for key, value in self.headers.items()
        }


@dataclass(frozen=True, slots=True)
class HttpResponse:
    status: int
    headers: dict[str, str] = field(repr=False)
    body: bytes = field(repr=False)

    def json(self) -> dict[str, Any]:
        value = json.loads(self.body.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("Expected a JSON object")
        return value


class HttpTransport(Protocol):
    def send(self, request: HttpRequest) -> HttpResponse: ...


class UrllibTransport:
    """Dependency-free transport used by sidecar workers.

    It does not retry. Durable workflow code owns retries so a provider charge
    cannot be duplicated by an invisible lower-level retry.
    """

    def __init__(
        self,
        *,
        resolver: Resolver = system_resolver,
        url_policy: UrlPolicy = DEFAULT_URL_POLICY,
    ) -> None:
        self._resolver = resolver
        self._url_policy = url_policy

    def send(self, request: HttpRequest) -> HttpResponse:
        self._preflight_scope()
        validated = validate_url(
            request.url,
            policy=self._url_policy,
            resolver=self._resolver,
        )
        enforce_network_access(validated)

        body = request.body
        headers = dict(request.headers)
        if request.json_body is not None:
            body = json.dumps(request.json_body, separators=(",", ":")).encode("utf-8")
            headers.setdefault("Content-Type", "application/json")
        try:
            return self._send_pinned(validated, request, body, headers)
        except TimeoutError as exc:
            raise ProviderFailure(
                FailureCode.TIMEOUT,
                "Provider request timed out",
                retryable=True,
            ) from exc
        except (HTTPException, OSError) as exc:
            raise ProviderFailure(
                FailureCode.TRANSIENT,
                "Provider request could not be completed",
                retryable=True,
            ) from exc

    @staticmethod
    def _preflight_scope() -> None:
        """Reject before DNS when no scope, Local project egress, or IPC misuse exists."""

        context = current_network_context()
        if context is None:
            # Use the central policy hook so callers receive its canonical error.
            enforce_network_access(None)
            raise AssertionError("unreachable")
        if context.provider_boundary is ProviderBoundary.LOCAL_PROCESS:
            raise PolicyViolation("local-process provider must not open a network destination")
        if context.provider_boundary is ProviderBoundary.LOCAL_LOOPBACK:
            raise PolicyViolation("loopback networking must use the supervised IPC broker")
        if context.mode is PrivacyMode.LOCAL and context.contains_project_content:
            raise PolicyViolation("project-content networking is disabled in Local mode")
        if context.classification is DataClassification.SECRET:
            raise PolicyViolation("secrets must never be sent as provider payload content")

    def _send_pinned(
        self,
        validated: ValidatedUrl,
        request: HttpRequest,
        body: bytes | None,
        headers: dict[str, str],
    ) -> HttpResponse:
        """Connect only to a DNS answer captured by ``validate_url``.

        Redirects are deliberately returned to the adapter as 3xx responses.
        This transport never follows a second URL implicitly.
        """

        parsed = urlsplit(validated.normalized_url)
        target = parsed.path or "/"
        if parsed.query:
            target = f"{target}?{parsed.query}"
        connection = _PinnedHTTPSConnection(
            validated,
            timeout=request.timeout_seconds,
        )
        try:
            connection.request(request.method, target, body=body, headers=headers)
            response = connection.getresponse()
            return HttpResponse(
                status=response.status,
                headers=dict(response.headers.items()),
                body=response.read(),
            )
        finally:
            connection.close()


class _PinnedHTTPSConnection(HTTPSConnection):
    """HTTPS connection whose TCP peer is restricted to the validated pin set."""

    def __init__(self, validated: ValidatedUrl, *, timeout: float) -> None:
        tls_context = ssl.create_default_context()
        super().__init__(
            validated.ascii_host,
            validated.port,
            timeout=timeout,
            context=tls_context,
        )
        self._validated = validated
        self._timeout_seconds = timeout
        self._tls_context = tls_context

    def connect(self) -> None:
        connected: socket.socket | None = None
        last_error: OSError | None = None
        for address in self._validated.pinned_addresses:
            try:
                connected = socket.create_connection(
                    (address, self._validated.port),
                    self._timeout_seconds,
                )
                break
            except OSError as exc:
                last_error = exc
        if connected is None:
            if last_error is not None:
                raise last_error
            raise OSError("validated destination has no connectable pinned address")
        try:
            assert_connected_peer(self._validated, connected.getpeername()[0])
            self.sock = self._tls_context.wrap_socket(
                connected,
                server_hostname=self._validated.ascii_host,
            )
        except BaseException:
            connected.close()
            raise
