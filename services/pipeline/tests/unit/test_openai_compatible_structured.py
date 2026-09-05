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

_DEFAULT_PAYLOAD = object()


class FixtureTransport:
    def __init__(self, payload: Any = _DEFAULT_PAYLOAD, *, status: int = 200) -> None:
        self.requests: list[HttpRequest] = []
        self.status = status
        self.payload = (
            {
                "id": "chatcmpl-reviewed",
                "model": GROQ_STRUCTURED_MODEL,
                "choices": [{"message": {"content": '{"title":"Fractions"}'}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 4},
            }
            if payload is _DEFAULT_PAYLOAD
            else payload
        )

    def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        return HttpResponse(
            self.status,
            {"content-type": "application/json", "x-request-id": "safe-request-id"},
            json.dumps(self.payload).encode(),
        )


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
        (
            "openrouter",
            OPENROUTER_STRUCTURED_MODEL,
            "https://openrouter.ai/api/v1/chat/completions",
        ),
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


def test_groq_projects_local_bounds_into_structural_schema_descriptions() -> None:
    schema = {
        "type": "object",
        "additionalProperties": False,
        "required": ["labels"],
        "properties": {
            "labels": {
                "type": "array",
                "minItems": 1,
                "maxItems": 3,
                "items": {"type": "string", "minLength": 2, "maxLength": 8},
            }
        },
    }
    request = TextRequest("Labels", GROQ_STRUCTURED_MODEL, json_schema=schema)
    adapter = launch_structured_cloud_adapter("groq", FixtureTransport())
    body = adapter.build_request(request, context("groq")).json_body
    assert body is not None
    projected = body["response_format"]["json_schema"]["schema"]
    labels = projected["properties"]["labels"]
    assert "minItems" not in labels and "maxItems" not in labels
    assert labels["description"] == "Return between 1 and 3 items."
    assert labels["items"]["description"] == "Use between 2 and 8 characters."
    assert labels["items"]["type"] == "string"
    assert schema["properties"]["labels"]["minItems"] == 1

    mistral_request = TextRequest("Labels", MISTRAL_STRUCTURED_MODEL, json_schema=schema)
    mistral = launch_structured_cloud_adapter("mistral", FixtureTransport())
    mistral_body = mistral.build_request(mistral_request, context("mistral")).json_body
    assert mistral_body is not None
    assert mistral_body["response_format"]["json_schema"]["schema"] == schema


@pytest.mark.parametrize("provider_id", tuple(STRUCTURED_CLOUD_SPECS))
def test_all_structured_adapters_reject_unknown_schema_keyword_before_transport(
    provider_id: str,
) -> None:
    transport = FixtureTransport()
    adapter = launch_structured_cloud_adapter(provider_id, transport)
    request = TextRequest(
        "Title",
        STRUCTURED_CLOUD_SPECS[provider_id].model,
        json_schema={"type": "string", "pattern": ".*"},
    )
    with pytest.raises(ProviderFailure, match="unreviewed JSON Schema keyword") as raised:
        adapter.invoke(request, context(provider_id))
    assert raised.value.code is FailureCode.UNSUPPORTED_CAPABILITY
    assert raised.value.details == {"schemaKeyword": "pattern"}
    assert transport.requests == []


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
    transport = FixtureTransport(
        {
            "id": "bad-json",
            "choices": [{"message": {"content": "not-json"}}],
            "usage": {},
        }
    )
    adapter = launch_structured_cloud_adapter("mistral", transport)
    with pytest.raises(ProviderFailure) as raised:
        adapter.invoke(structured_request(MISTRAL_STRUCTURED_MODEL), context("mistral"))
    assert raised.value.code is FailureCode.MALFORMED_RESPONSE


@pytest.mark.parametrize("invalid_number", ("NaN", "Infinity", "-Infinity", "1e999"))
def test_non_finite_structured_numbers_are_rejected(invalid_number: str) -> None:
    transport = FixtureTransport(
        {
            "id": "bad-number",
            "choices": [{"message": {"content": f'{{"score":{invalid_number}}}'}}],
            "usage": {},
        }
    )
    adapter = launch_structured_cloud_adapter("groq", transport)
    request = TextRequest(
        "Score",
        GROQ_STRUCTURED_MODEL,
        json_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["score"],
            "properties": {"score": {"type": "number"}},
        },
    )
    with pytest.raises(ProviderFailure) as raised:
        adapter.invoke(request, context("groq"))
    assert raised.value.code is FailureCode.MALFORMED_RESPONSE


def test_structured_json_is_validated_against_original_unprojected_schema() -> None:
    transport = FixtureTransport(
        {
            "id": "out-of-bounds",
            "choices": [{"message": {"content": '{"title":"Too long"}'}}],
            "usage": {},
        }
    )
    adapter = launch_structured_cloud_adapter("groq", transport)
    request = TextRequest(
        "Title",
        GROQ_STRUCTURED_MODEL,
        json_schema={
            "type": "object",
            "additionalProperties": False,
            "required": ["title"],
            "properties": {"title": {"type": "string", "maxLength": 4}},
        },
    )
    with pytest.raises(ProviderFailure, match="outside the requested schema") as raised:
        adapter.invoke(request, context("groq"))
    assert raised.value.code is FailureCode.MALFORMED_RESPONSE
    assert raised.value.details == {"schemaKeyword": "maxLength", "schemaPath": "$.title"}


def test_groq_error_keeps_only_sanitized_machine_diagnostics() -> None:
    secret = "fixture-secret-that-must-not-survive"
    transport = FixtureTransport(
        {
            "error": {
                "message": f"generated project content {secret}",
                "type": "invalid_request_error",
                "code": "json_validate_failed",
                "failed_generation": {"private": secret},
            }
        },
        status=400,
    )
    adapter = launch_structured_cloud_adapter("groq", transport)
    with pytest.raises(ProviderFailure, match="rejected generated JSON") as raised:
        adapter.invoke(structured_request(GROQ_STRUCTURED_MODEL), context("groq"))
    diagnostic = raised.value.to_dict()
    assert diagnostic["details"] == {
        "providerErrorCode": "json_validate_failed",
        "providerErrorType": "invalid_request_error",
        "providerErrorParam": None,
        "failedGenerationPresent": True,
    }
    assert secret not in repr(raised.value)
    assert secret not in json.dumps(diagnostic)


@pytest.mark.parametrize("invalid_envelope", (None, [], "error"))
def test_non_object_error_envelope_keeps_generic_http_failure(invalid_envelope: Any) -> None:
    transport = FixtureTransport(invalid_envelope, status=400)
    adapter = launch_structured_cloud_adapter("groq", transport)
    with pytest.raises(ProviderFailure, match="groq returned HTTP 400") as raised:
        adapter.invoke(structured_request(GROQ_STRUCTURED_MODEL), context("groq"))
    assert raised.value.code is FailureCode.INVALID_REQUEST
    assert raised.value.details == {
        "providerErrorCode": None,
        "providerErrorType": None,
        "providerErrorParam": None,
        "failedGenerationPresent": False,
    }


def test_unknown_provider_has_no_generic_fallback() -> None:
    with pytest.raises(ValueError, match="no reviewed"):
        launch_structured_cloud_adapter("another-openai-compatible-cloud", FixtureTransport())
