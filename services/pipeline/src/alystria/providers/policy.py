"""Persisted tutorial provider routing, disclosure, and approval policy.

Only opaque credential references are serialised. Credential values are
resolved into one invocation-scoped lease by the desktop privilege broker.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from ..security.privacy import DataClassification, PrivacyMode
from .catalog import ProviderCatalog, default_catalog
from .types import Capability, DataBoundary, RetentionMode

_CREDENTIAL_REFERENCE = re.compile(
    r"keyring://alystria/(?P<provider>[a-z0-9]+(?:-[a-z0-9]+)*)/"
    r"(?P<kind>[a-z][a-z0-9_-]{1,63})\Z"
)


@dataclass(frozen=True, slots=True)
class BudgetApproval:
    currency: str
    hard_limit_micros: int | None
    require_known_pricing: bool
    approved: bool

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[A-Z]{3}", self.currency):
            raise ValueError("budget currency must be an uppercase ISO-4217 code")
        if self.hard_limit_micros is not None and self.hard_limit_micros < 0:
            raise ValueError("hard budget cannot be negative")


@dataclass(frozen=True, slots=True)
class ProviderApproval:
    provider_id: str
    capabilities: tuple[Capability, ...]
    credential_ref: str | None
    boundary: DataBoundary
    retention: RetentionMode
    regions: tuple[str, ...]
    data_classes: tuple[DataClassification, ...]
    privacy_approved: bool
    retention_approved: bool
    region_approved: bool
    budget_approved: bool
    terms_approved: bool = False
    model_access_checked_at: str | None = None


@dataclass(frozen=True, slots=True)
class CapabilityRoute:
    capability: Capability
    provider_ids: tuple[str, ...]
    model: str
    voice: str | None = None


@dataclass(frozen=True, slots=True)
class TutorialRoutingPolicy:
    version: int
    privacy_mode: PrivacyMode
    data_classification: DataClassification
    budget: BudgetApproval
    approvals: tuple[ProviderApproval, ...]
    routes: tuple[CapabilityRoute, ...]

    def __post_init__(self) -> None:
        if self.version != 1:
            raise ValueError("provider routing policy version must be 1")

    def approval_for(self, provider_id: str) -> ProviderApproval:
        for approval in self.approvals:
            if approval.provider_id == provider_id:
                return approval
        raise ValueError(f"provider {provider_id!r} does not have an approval")

    def route_for(self, capability: Capability) -> CapabilityRoute:
        for route in self.routes:
            if route.capability is capability:
                return route
        raise ValueError(f"no approved route exists for {capability.value}")

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "privacyMode": self.privacy_mode.value,
            "dataClassification": self.data_classification.value,
            "budget": {
                "currency": self.budget.currency,
                "hardLimitMicros": self.budget.hard_limit_micros,
                "requireKnownPricing": self.budget.require_known_pricing,
                "approved": self.budget.approved,
            },
            "approvals": [
                {
                    "providerId": approval.provider_id,
                    "capabilities": [value.value for value in approval.capabilities],
                    "credentialRef": approval.credential_ref,
                    "boundary": approval.boundary.value,
                    "retention": approval.retention.value,
                    "regions": list(approval.regions),
                    "dataClasses": [value.value for value in approval.data_classes],
                    "privacyApproved": approval.privacy_approved,
                    "retentionApproved": approval.retention_approved,
                    "regionApproved": approval.region_approved,
                    "budgetApproved": approval.budget_approved,
                    "termsApproved": approval.terms_approved,
                    "modelAccessCheckedAt": approval.model_access_checked_at,
                }
                for approval in self.approvals
            ],
            "routes": [
                {
                    "capability": route.capability.value,
                    "providerIds": list(route.provider_ids),
                    "model": route.model,
                    "voice": route.voice,
                }
                for route in self.routes
            ],
        }


def parse_routing_policy(
    value: dict[str, Any], *, catalog: ProviderCatalog | None = None
) -> TutorialRoutingPolicy:
    """Parse closed, canonical policy input and fail before any provider call."""

    catalog = catalog or default_catalog()
    _closed(
        value,
        {"version", "privacyMode", "dataClassification", "budget", "approvals", "routes"},
        "provider routing policy",
    )
    budget_value = _object(value, "budget")
    _closed(
        budget_value,
        {"currency", "hardLimitMicros", "requireKnownPricing", "approved"},
        "provider budget approval",
    )
    budget = BudgetApproval(
        _string(budget_value, "currency").upper(),
        _optional_int(budget_value, "hardLimitMicros"),
        _bool(budget_value, "requireKnownPricing"),
        _bool(budget_value, "approved"),
    )
    privacy_mode = PrivacyMode(_string(value, "privacyMode"))
    classification = DataClassification(_string(value, "dataClassification"))

    approval_values = _array(value, "approvals")
    approvals: list[ProviderApproval] = []
    seen: set[str] = set()
    for item in approval_values:
        if not isinstance(item, dict):
            raise ValueError("provider approvals must be objects")
        _closed(
            item,
            {
                "providerId",
                "capabilities",
                "credentialRef",
                "boundary",
                "retention",
                "regions",
                "dataClasses",
                "privacyApproved",
                "retentionApproved",
                "regionApproved",
                "budgetApproved",
                "termsApproved",
                "modelAccessCheckedAt",
            },
            "provider approval",
        )
        submitted_id = _string(item, "providerId")
        provider_id = catalog.canonical_id(submitted_id)
        if submitted_id != provider_id:
            raise ValueError(f"provider approval must persist canonical ID {provider_id!r}")
        if provider_id in seen:
            raise ValueError(f"duplicate provider approval {provider_id!r}")
        seen.add(provider_id)
        descriptor = catalog.get(provider_id)
        capabilities = tuple(Capability(value) for value in _strings(item, "capabilities"))
        if not capabilities or any(not descriptor.supports(value) for value in capabilities):
            raise ValueError(f"provider {provider_id!r} approval contains unsupported capabilities")
        boundary = DataBoundary(_string(item, "boundary"))
        retention = RetentionMode(_string(item, "retention"))
        if boundary is not descriptor.data_policy.boundary:
            raise ValueError(f"provider {provider_id!r} boundary differs from the catalog")
        if retention is not descriptor.data_policy.retention:
            raise ValueError(f"provider {provider_id!r} retention differs from the catalog")
        credential_ref = _optional_string(item, "credentialRef")
        if credential_ref is not None:
            match = _CREDENTIAL_REFERENCE.fullmatch(credential_ref)
            if match is None or match.group("provider") != provider_id:
                raise ValueError("credentialRef must be an opaque provider-matched keyring URI")
        regions = tuple(_strings(item, "regions"))
        if any(region not in descriptor.data_policy.regions for region in regions):
            raise ValueError(f"provider {provider_id!r} region differs from the catalog")
        data_classes = tuple(
            DataClassification(value) for value in _strings(item, "dataClasses")
        )
        approval = ProviderApproval(
            provider_id,
            capabilities,
            credential_ref,
            boundary,
            retention,
            regions,
            data_classes,
            _bool(item, "privacyApproved"),
            _bool(item, "retentionApproved"),
            _bool(item, "regionApproved"),
            _bool(item, "budgetApproved"),
            _optional_bool(item, "termsApproved") or False,
            _optional_string(item, "modelAccessCheckedAt"),
        )
        _validate_approval(approval, privacy_mode, classification, budget)
        approvals.append(approval)

    routes: list[CapabilityRoute] = []
    routed_capabilities: set[Capability] = set()
    for item in _array(value, "routes"):
        if not isinstance(item, dict):
            raise ValueError("provider routes must be objects")
        _closed(item, {"capability", "providerIds", "model", "voice"}, "provider route")
        capability = Capability(_string(item, "capability"))
        if capability in routed_capabilities:
            raise ValueError(f"duplicate provider route for {capability.value}")
        routed_capabilities.add(capability)
        provider_ids = tuple(_strings(item, "providerIds"))
        if not provider_ids:
            raise ValueError("provider route requires at least one approved provider")
        for provider_id in provider_ids:
            if catalog.canonical_id(provider_id) != provider_id:
                raise ValueError("provider routes must use canonical provider IDs")
            route_approval = next(
                (candidate for candidate in approvals if candidate.provider_id == provider_id), None
            )
            if route_approval is None or capability not in route_approval.capabilities:
                raise ValueError(
                    f"route {capability.value} uses provider {provider_id!r} without approval"
                )
        routes.append(
            CapabilityRoute(
                capability,
                provider_ids,
                _string(item, "model"),
                _optional_string(item, "voice"),
            )
        )
    return TutorialRoutingPolicy(
        int(value.get("version", 0)),
        privacy_mode,
        classification,
        budget,
        tuple(approvals),
        tuple(routes),
    )


def _validate_approval(
    approval: ProviderApproval,
    privacy_mode: PrivacyMode,
    classification: DataClassification,
    budget: BudgetApproval,
) -> None:
    if classification not in approval.data_classes:
        raise ValueError(f"provider {approval.provider_id!r} is not approved for project data")
    if not approval.privacy_approved:
        raise ValueError(f"provider {approval.provider_id!r} privacy is not approved")
    if not approval.budget_approved or not budget.approved:
        raise ValueError(f"provider {approval.provider_id!r} budget is not approved")
    if approval.provider_id == "nvidia-nim":
        if classification is not DataClassification.PUBLIC or approval.data_classes != (
            DataClassification.PUBLIC,
        ):
            raise ValueError("NVIDIA hosted preview accepts public/synthetic content only")
        if not approval.terms_approved:
            raise ValueError("NVIDIA hosted preview Trial Terms must be explicitly approved")
        if approval.model_access_checked_at is None:
            raise ValueError("NVIDIA model availability and limits must be checked at selection")
    if approval.boundary is DataBoundary.CLOUD:
        if privacy_mode is PrivacyMode.LOCAL:
            raise ValueError("Local privacy mode forbids cloud provider approvals")
        if not approval.retention_approved:
            raise ValueError(f"provider {approval.provider_id!r} retention is not approved")
        if not approval.region_approved or not approval.regions:
            raise ValueError(f"provider {approval.provider_id!r} region is not approved")
        if approval.credential_ref is None:
            raise ValueError(f"cloud provider {approval.provider_id!r} requires a credentialRef")


def _closed(value: dict[str, Any], allowed: set[str], label: str) -> None:
    unknown = set(value) - allowed
    if unknown:
        raise ValueError(f"{label} contains unknown fields: {sorted(unknown)}")


def _object(value: dict[str, Any], key: str) -> dict[str, Any]:
    result = value.get(key)
    if not isinstance(result, dict):
        raise ValueError(f"{key} must be an object")
    return result


def _array(value: dict[str, Any], key: str) -> list[Any]:
    result = value.get(key)
    if not isinstance(result, list):
        raise ValueError(f"{key} must be an array")
    return result


def _string(value: dict[str, Any], key: str) -> str:
    result = value.get(key)
    if not isinstance(result, str) or not result.strip():
        raise ValueError(f"{key} must be a non-empty string")
    return result.strip()


def _optional_string(value: dict[str, Any], key: str) -> str | None:
    result = value.get(key)
    if result is None:
        return None
    if not isinstance(result, str) or not result.strip():
        raise ValueError(f"{key} must be a non-empty string or null")
    return result.strip()


def _optional_bool(value: dict[str, Any], key: str) -> bool | None:
    result = value.get(key)
    if result is None:
        return None
    if not isinstance(result, bool):
        raise ValueError(f"{key} must be a boolean")
    return result


def _strings(value: dict[str, Any], key: str) -> list[str]:
    result = _array(value, key)
    if not all(isinstance(item, str) and item.strip() for item in result):
        raise ValueError(f"{key} must contain non-empty strings")
    strings = [item.strip() for item in result]
    if len(set(strings)) != len(strings):
        raise ValueError(f"{key} must not contain duplicates")
    return strings


def _bool(value: dict[str, Any], key: str) -> bool:
    result = value.get(key)
    if not isinstance(result, bool):
        raise ValueError(f"{key} must be a boolean")
    return result


def _optional_int(value: dict[str, Any], key: str) -> int | None:
    result = value.get(key)
    if result is None:
        return None
    if not isinstance(result, int) or isinstance(result, bool):
        raise ValueError(f"{key} must be an integer or null")
    return result
