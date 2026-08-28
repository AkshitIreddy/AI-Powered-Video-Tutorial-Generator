"""Stable, typed provider failures safe to expose over Alystria IPC.

Provider exceptions deliberately exclude request headers and response bodies.  A
provider may echo prompts or credentials in an error body, so callers get only a
sanitised message, stable code, retry hint, HTTP status and provider request ID.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class FailureCode(StrEnum):
    AUTHENTICATION = "AUTHENTICATION"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    INVALID_REQUEST = "INVALID_REQUEST"
    UNSUPPORTED_CAPABILITY = "UNSUPPORTED_CAPABILITY"
    POLICY_BLOCKED = "POLICY_BLOCKED"
    BUDGET_EXCEEDED = "BUDGET_EXCEEDED"
    RATE_LIMITED = "RATE_LIMITED"
    TIMEOUT = "TIMEOUT"
    TRANSIENT = "TRANSIENT"
    CANCELLED = "CANCELLED"
    MALFORMED_RESPONSE = "MALFORMED_RESPONSE"
    PROVIDER_ERROR = "PROVIDER_ERROR"
    ROUTING_CONSENT_REQUIRED = "ROUTING_CONSENT_REQUIRED"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"


@dataclass(eq=False)
class ProviderFailure(RuntimeError):
    """A serialisable provider failure with no secret-bearing raw payload."""

    code: FailureCode
    message: str
    provider_id: str | None = None
    retryable: bool = False
    http_status: int | None = None
    request_id: str | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        RuntimeError.__init__(self, self.message)

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code.value,
            "message": self.message,
            "providerId": self.provider_id,
            "retryable": self.retryable,
            "httpStatus": self.http_status,
            "requestId": self.request_id,
            "details": self.details,
        }


def failure_from_http(
    provider_id: str,
    status: int,
    *,
    request_id: str | None = None,
    message: str | None = None,
) -> ProviderFailure:
    """Map HTTP status to a stable failure without copying a remote body."""

    if status in {401, 407}:
        code, retryable = FailureCode.AUTHENTICATION, False
    elif status in {402, 403}:
        code, retryable = FailureCode.PERMISSION_DENIED, False
    elif status in {400, 404, 409, 422}:
        code, retryable = FailureCode.INVALID_REQUEST, False
    elif status == 408:
        code, retryable = FailureCode.TIMEOUT, True
    elif status == 429:
        code, retryable = FailureCode.RATE_LIMITED, True
    elif status >= 500:
        code, retryable = FailureCode.TRANSIENT, True
    else:
        code, retryable = FailureCode.PROVIDER_ERROR, False
    return ProviderFailure(
        code=code,
        message=message or f"{provider_id} returned HTTP {status}",
        provider_id=provider_id,
        retryable=retryable,
        http_status=status,
        request_id=request_id,
    )
