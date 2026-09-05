from __future__ import annotations

import json
from typing import Any

import pytest

from alystria.providers.errors import FailureCode, ProviderFailure
from alystria.providers.openai_compatible_structured import (
    GROQ_STRUCTURED_MODEL,
    MISTRAL_STRUCTURED_MODEL,
    OPENROUTER_STRUCTURED_MODEL,
    STRUCTURED_CLOUD_SPECS,
    launch_structured_cloud_adapter,
)
from alystria.providers.transport import HttpRequest, HttpResponse
from alystria.providers.types import (
    DataBoundary,
    DataClassification,
    PrivacyMode,
    RequestContext,
    RetentionMode,
    TextRequest,
)


class FixtureTransport:
    def __init__(self, payload: dict[str, Any] | None = None) -> None:
        self.requests: list[HttpRequest] = []
        self.payload = payload or {
            "id": "chatcmpl-reviewed",
            "model": GROQ_STRUCTURED_MODEL,
            "choices": [{"message": {"content": '{"title":"Fractions"}'}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 4},
        }

    def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        return HttpResponse(200, {"content-type": "application/json"}, json.dumps(self.payload).encode())


def context(provider_id: str) -> RequestContext:
    return RequestContext(
        idempotency_key=f"{provider_id}-structured-1",
        approved_provider_id=provider_id,
        credential="fixture-secret",
        hard_budget_micros=5_000,
        approved_boundary=DataBoundary.CLOUD,
        approved_region="provider-managed",
        approved_retention=RetentionMode.PROVIDER_DEFAULT,
        privacy_mode=PrivacyMode.CLOUD,
        data_classification=DataClassification.PROJECT,
    )


def structured_request(model: str) -> TextRequest:
    return TextRequest(
        "Create a concise tutorial plan.",
        model,
        system="Return only the requested structure.",
        max_output_tokens=256,
        json_schema={
            "type": "object",
            "properties": {"title": {"type": "string"}},
            "required": ["title"],
            "additionalProperties": False,
        },
        schema_name="tutorial_plan",
    )


@pytest.mark.parametrize(
    ("provider_id", "model", "url"),
    [
        ("groq", GROQ_STRUCTURED_MODEL, "https://api.groq.com/openai/v1/chat/completions"),
        ("mistral", MISTRAL_STRUCTURED_MODEL, "https://api.mistral.ai/v1/chat/completions"),
        ("openrouter", OPENROUTER_STRUCTURED_MODEL, "https://openrouter.ai/api/v1/chat/completions"),
    ],
)
def test_builds_only_the_reviewed_provider_host_model_and_json_schema(
    provider_id: str, model: str, url: str
) -> None:
    adapter = launch_structured_cloud_adapter(provider_id, FixtureTransport())
    request = adapter.build_request(structured_request(model), context(provider_id))
    assert request.url == url
    assert request.redacted_headers()["Authorization"] == "[REDACTED]"
    assert request.json_body is not None
    assert request.json_body["model"] == model
    assert request.json_body["response_format"] == {
        "type": "json_schema",
        "json_schema": {
            "name": "tutorial_plan",
            "strict": True,
            "schema": structured_request(model).json_schema,
        },
    }
    if provider_id == "openrouter":
        assert request.json_body["provider"] == {"require_parameters": True}
    else:
        assert "provider" not in request.json_body


def test_openrouter_free_model_is_zero_cost_but_still_bounded() -> None:
    adapter = launch_structured_cloud_adapter("openrouter", FixtureTransport())
    estimate = adapter.estimate(structured_request(OPENROUTER_STRUCTURED_MODEL))
    assert estimate.micros == 0
    assert estimate.bounded is True
    assert estimate.catalog_version == "openrouter-model-list-2026-09-05"


def test_groq_cost_guard_uses_the_published_model_specific_prices() -> None:
    adapter = launch_structured_cloud_adapter("groq", FixtureTransport())
    estimate = adapter.estimate(structured_request(GROQ_STRUCTURED_MODEL))
    assert estimate.micros is not None and estimate.micros > 0
    assert estimate.catalog_version == "groq-2026-09-05"


def test_invoke_parses_structured_text_and_usage_without_exposing_credential() -> None:
    transport = FixtureTransport()
    adapter = launch_structured_cloud_adapter("groq", transport)
    result = adapter.invoke(structured_request(GROQ_STRUCTURED_MODEL), context("groq"))
    assert result.value.parsed == {"title": "Fractions"}
    assert result.usage.units == {"input_tokens": 10, "output_tokens": 4}
    assert result.raw_id == "chatcmpl-reviewed"
    assert "fixture-secret" not in repr(transport.requests[0])


@pytest.mark.parametrize("provider_id", tuple(STRUCTURED_CLOUD_SPECS))
def test_unknown_models_fail_before_transport(provider_id: str) -> None:
    transport = FixtureTransport()
    adapter = launch_structured_cloud_adapter(provider_id, transport)
    with pytest.raises(ProviderFailure, match="allowlist") as raised:
        adapter.build_request(structured_request("latest-or-user-entered"), context(provider_id))
    assert raised.value.code is FailureCode.INVALID_REQUEST
    assert transport.requests == []


def test_research_claim_fails_closed_for_all_three_providers() -> None:
    for provider_id, spec in STRUCTURED_CLOUD_SPECS.items():
        adapter = launch_structured_cloud_adapter(provider_id, FixtureTransport())
        request = TextRequest("Research this", spec.model, research=True)
        with pytest.raises(ProviderFailure, match="does not include web research"):
            adapter.build_request(request, context(provider_id))


def test_invalid_structured_json_is_rejected() -> None:
    transport = FixtureTransport({
        "id": "bad-json",
        "choices": [{"message": {"content": "not-json"}}],
        "usage": {},
    })
    adapter = launch_structured_cloud_adapter("mistral", transport)
    with pytest.raises(ProviderFailure) as raised:
        adapter.invoke(structured_request(MISTRAL_STRUCTURED_MODEL), context("mistral"))
    assert raised.value.code is FailureCode.MALFORMED_RESPONSE


def test_unknown_provider_has_no_generic_fallback() -> None:
    with pytest.raises(ValueError, match="no reviewed"):
        launch_structured_cloud_adapter("another-openai-compatible-cloud", FixtureTransport())
