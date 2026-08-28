"""SSRF-resistant URL and redirect validation with DNS pinning."""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from urllib.parse import SplitResult, urlsplit, urlunsplit

from .errors import PolicyViolation, ValidationError

Resolver = Callable[[str, int], Iterable[str]]

BLOCKED_HOST_SUFFIXES = (
    ".localhost",
    ".local",
    ".internal",
    ".home.arpa",
)
BLOCKED_HOSTS = frozenset({"localhost", "localhost.localdomain", "metadata.google.internal"})


@dataclass(frozen=True, slots=True)
class UrlPolicy:
    allowed_schemes: frozenset[str] = frozenset({"https"})
    allowed_ports: frozenset[int] = frozenset({443})
    allow_http_redirect_from_http: bool = False
    max_redirects: int = 5
    max_url_length: int = 4096


@dataclass(frozen=True, slots=True)
class ValidatedUrl:
    normalized_url: str
    scheme: str
    ascii_host: str
    port: int
    pinned_addresses: tuple[str, ...]


DEFAULT_URL_POLICY = UrlPolicy()


def system_resolver(host: str, port: int) -> tuple[str, ...]:
    return tuple(
        {str(item[4][0]) for item in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)}
    )


def _is_public_ip(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value.split("%", 1)[0])
    except ValueError as exc:
        raise ValidationError("DNS returned an invalid IP address") from exc
    return address.is_global and not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


def validate_url(
    raw_url: str,
    *,
    policy: UrlPolicy = DEFAULT_URL_POLICY,
    resolver: Resolver = system_resolver,
) -> ValidatedUrl:
    if not isinstance(raw_url, str) or not raw_url or len(raw_url) > policy.max_url_length:
        raise ValidationError("URL is empty or too long")
    if any(ord(char) < 32 or char.isspace() for char in raw_url):
        raise ValidationError("URL contains control characters or whitespace")
    try:
        parsed = urlsplit(raw_url)
        port = parsed.port
    except ValueError as exc:
        raise ValidationError("URL authority or port is invalid") from exc
    scheme = parsed.scheme.lower()
    if scheme not in policy.allowed_schemes:
        raise PolicyViolation("URL scheme is not allowed")
    if parsed.username is not None or parsed.password is not None:
        raise PolicyViolation("userinfo in URLs is forbidden")
    if parsed.fragment:
        raise ValidationError("URL fragments are not accepted by the fetch boundary")
    if not parsed.hostname:
        raise ValidationError("URL must have a hostname")
    try:
        ascii_host = parsed.hostname.rstrip(".").encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise ValidationError("URL hostname is not valid IDNA") from exc
    if not ascii_host or ascii_host in BLOCKED_HOSTS or ascii_host.endswith(BLOCKED_HOST_SUFFIXES):
        raise PolicyViolation("local or internal hostnames are forbidden")
    port = port or (443 if scheme == "https" else 80)
    if port not in policy.allowed_ports:
        raise PolicyViolation("URL port is not allowed")

    # Literal IPs and every DNS answer are checked. A single private answer makes
    # a mixed response unsafe; a client must connect only to one pinned address.
    try:
        literal = ipaddress.ip_address(ascii_host.strip("[]"))
    except ValueError:
        try:
            addresses = tuple(sorted(set(resolver(ascii_host, port))))
        except (OSError, socket.gaierror) as exc:
            raise ValidationError("hostname could not be resolved") from exc
    else:
        addresses = (str(literal),)
    if not addresses:
        raise ValidationError("hostname resolved to no addresses")
    if not all(_is_public_ip(address) for address in addresses):
        raise PolicyViolation("URL resolves to a non-public address")

    host_for_url = (
        f"[{ascii_host}]" if ":" in ascii_host and not ascii_host.startswith("[") else ascii_host
    )
    default_port = (scheme == "https" and port == 443) or (scheme == "http" and port == 80)
    netloc = host_for_url if default_port else f"{host_for_url}:{port}"
    normalized_path = parsed.path or "/"
    normalized = urlunsplit(SplitResult(scheme, netloc, normalized_path, parsed.query, ""))
    return ValidatedUrl(normalized, scheme, ascii_host, port, addresses)


def validate_redirect(
    previous: ValidatedUrl,
    location: str,
    *,
    redirect_number: int,
    policy: UrlPolicy = DEFAULT_URL_POLICY,
    resolver: Resolver = system_resolver,
) -> ValidatedUrl:
    if redirect_number < 1 or redirect_number > policy.max_redirects:
        raise PolicyViolation("redirect limit exceeded")
    # Fetch clients must resolve relative Location values before this call. That
    # keeps parsing and authority selection centralized in one trusted adapter.
    target = validate_url(location, policy=policy, resolver=resolver)
    if previous.scheme == "https" and target.scheme != "https":
        raise PolicyViolation("HTTPS redirects must not downgrade to HTTP")
    return target


def assert_connected_peer(validated: ValidatedUrl, peer_ip: str) -> None:
    """Defeat DNS rebinding by comparing the actual socket peer to the pin set."""
    try:
        normalized = str(ipaddress.ip_address(peer_ip.split("%", 1)[0]))
    except ValueError as exc:
        raise ValidationError("connected peer is not a valid IP address") from exc
    pinned = {
        str(ipaddress.ip_address(value.split("%", 1)[0])) for value in validated.pinned_addresses
    }
    if normalized not in pinned:
        raise PolicyViolation("connected peer differs from the validated DNS result")


def validate_redirect_chain(
    urls: Iterable[str],
    *,
    policy: UrlPolicy = DEFAULT_URL_POLICY,
    resolver: Resolver = system_resolver,
) -> tuple[ValidatedUrl, ...]:
    values = tuple(urls)
    if not values:
        raise ValidationError("redirect chain is empty")
    validated = [validate_url(values[0], policy=policy, resolver=resolver)]
    for index, url in enumerate(values[1:], start=1):
        validated.append(
            validate_redirect(
                validated[-1], url, redirect_number=index, policy=policy, resolver=resolver
            )
        )
    return tuple(validated)
