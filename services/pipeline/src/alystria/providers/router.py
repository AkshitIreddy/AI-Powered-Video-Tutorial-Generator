"""Consent-aware provider routing with deliberately no failover side effects."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .base import ProviderAdapter
from .errors import FailureCode, ProviderFailure
from .types import (
    Capability,
    DataBoundary,
    ProviderRequest,
    ProviderResult,
    RequestContext,
    RetentionMode,
)


@dataclass(frozen=True, slots=True)
class RoutingPolicy:
    """A user-approved candidate list; order is meaningful and deterministic."""

    approved_provider_ids: tuple[str, ...]
    required_boundary: DataBoundary | None = None
    required_retention: RetentionMode | None = None
    required_region: str | None = None


@dataclass(frozen=True, slots=True)
class RoutingDecision:
    provider_id: str
    capability: Capability
    reason: str


class ProviderRouter:
    """Route once, then either succeed or surface that provider's failure.

    The router never catches a provider failure and calls another provider. A
    separate, newly approved workflow attempt is required to cross a vendor,
    region, retention or local/cloud boundary.
    """

    def __init__(self, adapters: tuple[ProviderAdapter, ...] = ()) -> None:
        self._adapters: dict[tuple[str, Capability], ProviderAdapter] = {}
        for adapter in adapters:
            self.register(adapter)

    def register(self, adapter: ProviderAdapter) -> None:
        for capability in adapter.descriptor.capabilities:
            key = (adapter.descriptor.provider_id, capability)
            if key in self._adapters:
                raise ValueError(f"Duplicate adapter for {key[0]} / {key[1].value}")
            self._adapters[key] = adapter

    def decide(
        self,
        capability: Capability,
        policy: RoutingPolicy,
        *,
        explicit_provider_id: str | None = None,
    ) -> RoutingDecision:
        candidates: tuple[str, ...]
        if explicit_provider_id is not None:
            if explicit_provider_id not in policy.approved_provider_ids:
                raise ProviderFailure(
                    FailureCode.ROUTING_CONSENT_REQUIRED,
                    "Explicit provider is not in the approved provider set",
                    provider_id=explicit_provider_id,
                )
            candidates = (explicit_provider_id,)
            reason = "explicit user selection"
        else:
            if not policy.approved_provider_ids:
                raise ProviderFailure(
                    FailureCode.ROUTING_CONSENT_REQUIRED,
                    "Automatic routing requires an ordered approved provider set",
                )
            candidates = policy.approved_provider_ids
            reason = "first compatible provider in the user-approved order"

        rejected: list[str] = []
        for provider_id in candidates:
            adapter = self._adapters.get((provider_id, capability))
            if adapter is None:
                rejected.append(f"{provider_id}: capability unavailable")
                continue
            data_policy = adapter.descriptor.data_policy
            if (
                policy.required_boundary is not None
                and data_policy.boundary != policy.required_boundary
            ):
                rejected.append(f"{provider_id}: boundary mismatch")
                continue
            if (
                policy.required_retention is not None
                and data_policy.retention != policy.required_retention
            ):
                rejected.append(f"{provider_id}: retention mismatch")
                continue
            if policy.required_region is not None and (
                not data_policy.regions or policy.required_region not in data_policy.regions
            ):
                rejected.append(f"{provider_id}: region not declared")
                continue
            return RoutingDecision(provider_id, capability, reason)
        raise ProviderFailure(
            FailureCode.PROVIDER_UNAVAILABLE,
            "No approved provider satisfies the request policy",
            details={"rejections": rejected},
        )

    def adapter_for(self, decision: RoutingDecision) -> ProviderAdapter:
        return self._adapters[(decision.provider_id, decision.capability)]

    def invoke(
        self,
        request: ProviderRequest,
        context: RequestContext,
        policy: RoutingPolicy,
        *,
        explicit_provider_id: str | None = None,
    ) -> ProviderResult[Any]:
        decision = self.decide(
            request.capability,
            policy,
            explicit_provider_id=explicit_provider_id,
        )
        if context.approved_provider_id != decision.provider_id:
            raise ProviderFailure(
                FailureCode.ROUTING_CONSENT_REQUIRED,
                "Request context approval does not match the routing decision",
                provider_id=decision.provider_id,
            )
        # Intentionally no exception handling/failover here.
        return self.adapter_for(decision).invoke(request, context)
