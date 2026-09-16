"""Shared provider guardrails and protocols."""

from __future__ import annotations

from typing import Any, Protocol

from ..security.privacy import (
    NetworkContext,
    ProviderBoundary,
    network_scope,
)
from .errors import FailureCode, ProviderFailure, failure_from_http
from .transport import HttpRequest, HttpResponse, HttpTransport
from .types import (
    AsyncHandle,
    Capability,
    CostEstimate,
    DataBoundary,
    OperationStatus,
    ProviderDescriptor,
    ProviderRequest,
    ProviderResult,
    RequestContext,
)


class ProviderAdapter(Protocol):
    descriptor: ProviderDescriptor

    def estimate(self, request: ProviderRequest) -> CostEstimate: ...

    def invoke(
        self, request: ProviderRequest, context: RequestContext
    ) -> ProviderResult[Any]: ...


class AsyncProviderAdapter(ProviderAdapter, Protocol):
    def submit(self, request: ProviderRequest, context: RequestContext) -> AsyncHandle: ...

    def poll(self, handle: AsyncHandle, context: RequestContext) -> OperationStatus[Any]: ...

    def cancel(self, handle: AsyncHandle, context: RequestContext) -> OperationStatus[Any]: ...


class GuardedAdapter:
    descriptor: ProviderDescriptor
    transport: HttpTransport
    requires_credential = True

    def estimate(self, request: ProviderRequest) -> CostEstimate:
        raise NotImplementedError

    def _guard(self, capability: Capability, context: RequestContext) -> None:
        if context.approved_provider_id != self.descriptor.provider_id:
            raise ProviderFailure(
                FailureCode.ROUTING_CONSENT_REQUIRED,
                "The selected provider was not approved for this request",
                provider_id=self.descriptor.provider_id,
            )
        if not self.descriptor.supports(capability):
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                f"{self.descriptor.provider_id} does not support {capability.value}",
                provider_id=self.descriptor.provider_id,
            )
        policy = self.descriptor.data_policy
        if context.approved_boundary is not None and context.approved_boundary != policy.boundary:
            raise ProviderFailure(
                FailureCode.POLICY_BLOCKED,
                "Provider data boundary differs from the approved boundary",
                provider_id=self.descriptor.provider_id,
            )
        if (
            context.approved_retention is not None
            and context.approved_retention != policy.retention
        ):
            raise ProviderFailure(
                FailureCode.POLICY_BLOCKED,
                "Provider retention mode differs from the approved retention mode",
                provider_id=self.descriptor.provider_id,
            )
        if context.approved_region is not None and (
            not policy.regions or context.approved_region not in policy.regions
        ):
            raise ProviderFailure(
                FailureCode.POLICY_BLOCKED,
                "The approved region is not declared by this catalog snapshot",
                provider_id=self.descriptor.provider_id,
            )
        if self.requires_credential and not context.credential:
            raise ProviderFailure(
                FailureCode.AUTHENTICATION,
                "No credential reference was resolved for the selected provider",
                provider_id=self.descriptor.provider_id,
            )

    def _send(self, request: HttpRequest, context: RequestContext) -> HttpResponse:
        """Run a transport call inside policy context derived from approved call data."""

        boundary = (
            ProviderBoundary.CLOUD
            if self.descriptor.data_policy.boundary is DataBoundary.CLOUD
            else ProviderBoundary.LOCAL_PROCESS
        )
        privacy_context = NetworkContext(
            mode=context.privacy_mode,
            classification=context.data_classification,
            contains_project_content=context.contains_project_content,
            provider_boundary=boundary,
        )
        with network_scope(privacy_context):
            return self.transport.send(request)

    def _json_response(self, response: HttpResponse) -> dict[str, Any]:
        request_id = _header(response.headers, "x-request-id")
        if not 200 <= response.status < 300:
            raise failure_from_http(
                self.descriptor.provider_id,
                response.status,
                request_id=request_id,
            )
        try:
            return response.json()
        except (UnicodeDecodeError, ValueError) as exc:
            raise ProviderFailure(
                FailureCode.MALFORMED_RESPONSE,
                "Provider returned a malformed JSON response",
                provider_id=self.descriptor.provider_id,
                request_id=request_id,
            ) from exc


def _header(headers: dict[str, str], name: str) -> str | None:
    lowered = name.lower()
    return next((value for key, value in headers.items() if key.lower() == lowered), None)
