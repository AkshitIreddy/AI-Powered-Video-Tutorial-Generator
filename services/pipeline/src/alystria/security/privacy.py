"""Privacy classification, provider routing, and local-only network guard."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from enum import StrEnum

from .errors import PolicyViolation, ValidationError
from .network import ValidatedUrl


class PrivacyMode(StrEnum):
    LOCAL = "local"
    HYBRID = "hybrid"
    CLOUD = "cloud"


class DataClassification(StrEnum):
    PUBLIC = "public"
    PROJECT = "project"
    PRIVATE = "private"
    BIOMETRIC = "biometric"
    SECRET = "secret"


class ProviderBoundary(StrEnum):
    LOCAL_PROCESS = "local-process"
    LOCAL_LOOPBACK = "local-loopback"
    CLOUD = "cloud"


@dataclass(frozen=True, slots=True)
class ProviderPrivacy:
    provider_id: str
    boundary: ProviderBoundary
    accepted_classes: frozenset[DataClassification]
    retention: str
    region: str | None
    configured: bool
    explicit_approval: bool


@dataclass(frozen=True, slots=True)
class RouteRequest:
    mode: PrivacyMode
    classification: DataClassification
    contains_project_content: bool = True
    requested_region: str | None = None


@dataclass(frozen=True, slots=True)
class RouteDecision:
    allowed: bool
    reasons: tuple[str, ...]
    provider_id: str


def decide_provider_route(request: RouteRequest, provider: ProviderPrivacy) -> RouteDecision:
    reasons: list[str] = []
    if not provider.configured:
        reasons.append("provider is not configured")
    if request.classification not in provider.accepted_classes:
        reasons.append("provider is not approved for this data classification")
    if request.mode == PrivacyMode.LOCAL and provider.boundary == ProviderBoundary.CLOUD:
        reasons.append("cloud providers are forbidden in Local mode")
    if provider.boundary == ProviderBoundary.CLOUD and not provider.explicit_approval:
        reasons.append("cloud provider use has not been explicitly approved")
    if request.requested_region and provider.region != request.requested_region:
        reasons.append("provider region does not match the approved region")
    if (
        request.classification in {DataClassification.BIOMETRIC, DataClassification.SECRET}
        and provider.boundary == ProviderBoundary.CLOUD
    ):
        reasons.append("sensitive data requires a dedicated consent/secret flow")
    return RouteDecision(not reasons, tuple(reasons), provider.provider_id)


@dataclass(frozen=True, slots=True)
class NetworkContext:
    mode: PrivacyMode
    classification: DataClassification
    contains_project_content: bool
    provider_boundary: ProviderBoundary


_network_context: ContextVar[NetworkContext | None] = ContextVar(
    "alystria_network_context", default=None
)


@contextmanager
def network_scope(context: NetworkContext) -> Iterator[None]:
    token = _network_context.set(context)
    try:
        yield
    finally:
        _network_context.reset(token)


def current_network_context() -> NetworkContext | None:
    return _network_context.get()


def enforce_network_access(destination: ValidatedUrl | None = None) -> None:
    """Policy hook invoked immediately before every socket-producing adapter.

    Local-process IPC passes ``None``. Internet adapters must pass a previously
    SSRF-validated and DNS-pinned destination.
    """
    context = current_network_context()
    if context is None:
        raise PolicyViolation("network access attempted outside an explicit privacy scope")
    if context.provider_boundary == ProviderBoundary.LOCAL_PROCESS:
        if destination is not None:
            raise PolicyViolation("local-process provider must not open a network destination")
        return
    if destination is None:
        raise ValidationError("network provider requires a validated destination")
    if context.mode == PrivacyMode.LOCAL and context.contains_project_content:
        raise PolicyViolation("project-content networking is disabled in Local mode")
    if context.provider_boundary == ProviderBoundary.LOCAL_LOOPBACK:
        # Loopback services are intentionally represented by supervised IPC in
        # Local mode; public ValidatedUrl values cannot be relabeled loopback.
        raise PolicyViolation("loopback networking must use the supervised IPC broker")
    if context.classification == DataClassification.SECRET:
        raise PolicyViolation("secrets must never be sent as provider payload content")
