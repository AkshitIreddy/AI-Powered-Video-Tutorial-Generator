"""Filesystem and network safety primitives for source ingestion."""

from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from urllib.parse import urljoin, urlsplit

from .models import SourceLoadError

SocketAddress = tuple[str, int] | tuple[str, int, int, int] | tuple[int, bytes]
AddressInfo = tuple[socket.AddressFamily, socket.SocketKind, int, str, SocketAddress]
AddressResolver = Callable[..., list[AddressInfo]]


def _is_public_address(value: str) -> bool:
    address = ipaddress.ip_address(value)
    return not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


@dataclass(frozen=True, slots=True)
class UrlSafetyPolicy:
    allowed_schemes: tuple[str, ...] = ("https",)
    allowed_ports: tuple[int, ...] = (443,)
    max_redirects: int = 4
    max_bytes: int = 8 * 1024 * 1024
    timeout_seconds: float = 15.0

    def resolve_public(
        self,
        url: str,
        *,
        resolver: AddressResolver = socket.getaddrinfo,
    ) -> tuple[str, int, tuple[str, ...]]:
        parsed = urlsplit(url)
        if parsed.scheme.lower() not in self.allowed_schemes:
            raise SourceLoadError(f"URL scheme is not allowed: {parsed.scheme or '(missing)'}")
        if parsed.username or parsed.password:
            raise SourceLoadError("URL credentials are not allowed")
        if not parsed.hostname:
            raise SourceLoadError("URL must include a hostname")
        port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
        if self.allowed_ports and port not in self.allowed_ports:
            raise SourceLoadError(f"URL port is not allowed: {port}")
        hostname = parsed.hostname.rstrip(".").lower()
        if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".localhost"):
            raise SourceLoadError("local hostnames are not allowed")
        try:
            addresses = resolver(hostname, port, type=socket.SOCK_STREAM)
        except OSError as exc:
            raise SourceLoadError(f"hostname could not be resolved: {hostname}") from exc
        if not addresses:
            raise SourceLoadError(f"hostname did not resolve: {hostname}")
        resolved_addresses = tuple(sorted({str(item[4][0]) for item in addresses}))
        for address in resolved_addresses:
            if not _is_public_address(address):
                raise SourceLoadError("URL resolves to a non-public network address")
        return hostname, port, resolved_addresses

    def validate(
        self,
        url: str,
        *,
        resolver: AddressResolver = socket.getaddrinfo,
    ) -> str:
        self.resolve_public(url, resolver=resolver)
        return url


@dataclass(frozen=True, slots=True)
class HttpResponse:
    url: str
    status: int
    headers: Mapping[str, str]
    body: bytes


class SafeHttpTransport(Protocol):
    def get(self, url: str, *, headers: Mapping[str, str] | None = None) -> HttpResponse: ...


class _PinnedHttpsConnection(http.client.HTTPSConnection):
    """HTTPS connection with DNS result pinned while retaining TLS hostname checks."""

    def __init__(
        self,
        hostname: str,
        port: int,
        address: str,
        *,
        timeout: float,
    ) -> None:
        tls_context = ssl.create_default_context()
        super().__init__(
            hostname,
            port,
            timeout=timeout,
            context=tls_context,
        )
        self._pinned_address = address
        self._pinned_source_address: tuple[str, int] | None = None
        self._pinned_tls_context = tls_context

    def connect(self) -> None:
        raw_socket = socket.create_connection(
            (self._pinned_address, self.port),
            self.timeout,
            self._pinned_source_address,
        )
        self.sock = self._pinned_tls_context.wrap_socket(raw_socket, server_hostname=self.host)


class UrllibSafeHttpTransport:
    """Bounded client that revalidates redirects and pins public DNS results.

    The historical class name is retained as part of the loader interface, but
    the implementation uses ``http.client`` so a hostname cannot be validated
    as public and then rebound to a private address during connection.
    """

    def __init__(self, policy: UrlSafetyPolicy | None = None) -> None:
        self.policy = policy or UrlSafetyPolicy()

    def get(self, url: str, *, headers: Mapping[str, str] | None = None) -> HttpResponse:
        current = url
        request_headers = {"Accept": "text/plain, text/html, application/json, application/xml"}
        request_headers.update(
            {
                key: value
                for key, value in (headers or {}).items()
                if key.casefold() not in {"host", "connection", "content-length"}
            }
        )
        for redirect_count in range(self.policy.max_redirects + 1):
            hostname, port, addresses = self.policy.resolve_public(current)
            parsed = urlsplit(current)
            target = parsed.path or "/"
            if parsed.query:
                target = f"{target}?{parsed.query}"
            default_port = 443 if parsed.scheme.lower() == "https" else 80
            host_header = hostname if port == default_port else f"{hostname}:{port}"
            effective_headers = {**request_headers, "Host": host_header, "Connection": "close"}
            if parsed.scheme.lower() == "https":
                connection: http.client.HTTPConnection = _PinnedHttpsConnection(
                    hostname,
                    port,
                    addresses[0],
                    timeout=self.policy.timeout_seconds,
                )
            else:
                connection = http.client.HTTPConnection(
                    addresses[0],
                    port,
                    timeout=self.policy.timeout_seconds,
                )
            try:
                connection.request("GET", target, headers=effective_headers)
                response = connection.getresponse()
                response_headers = {
                    str(key).lower(): str(value)
                    for key, value in response.getheaders()
                }
                if response.status in {301, 302, 303, 307, 308}:
                    location = response_headers.get("location")
                    if not location or redirect_count >= self.policy.max_redirects:
                        raise SourceLoadError("unsafe or excessive HTTP redirect")
                    current = urljoin(current, location)
                    continue
                if not 200 <= response.status < 300:
                    raise SourceLoadError(f"source server returned HTTP {response.status}")
                length_header = response_headers.get("content-length")
                try:
                    if length_header and int(length_header) > self.policy.max_bytes:
                        raise SourceLoadError("source response exceeds the configured byte limit")
                except ValueError as exc:
                    raise SourceLoadError("source response has an invalid content length") from exc
                body = response.read(self.policy.max_bytes + 1)
            except (OSError, http.client.HTTPException) as exc:
                raise SourceLoadError("source URL could not be fetched") from exc
            finally:
                connection.close()
            if len(body) > self.policy.max_bytes:
                raise SourceLoadError("source response exceeds the configured byte limit")
            return HttpResponse(
                url=current,
                status=response.status,
                headers=response_headers,
                body=body,
            )
        raise SourceLoadError("source redirect limit exceeded")


def resolve_safe_path(path: str | Path, allowed_roots: tuple[Path, ...]) -> Path:
    unresolved = Path(path).expanduser()
    if unresolved.is_symlink():
        raise SourceLoadError("symbolic-link sources are not allowed")
    candidate = unresolved.resolve(strict=True)
    if not allowed_roots:
        raise SourceLoadError("at least one source root must be configured")
    roots = tuple(root.expanduser().resolve(strict=True) for root in allowed_roots)
    if not any(candidate == root or candidate.is_relative_to(root) for root in roots):
        raise SourceLoadError("source path is outside the allowed roots")
    return candidate
