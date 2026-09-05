from __future__ import annotations

import json
from typing import Any

from alystria.providers import (
    EphemeralCredentialBroker,
    HttpRequest,
    HttpResponse,
    ProviderRuntimeFactory,
    ProviderTextClient,
    TextRequest,
    parse_routing_policy,
)


class GeminiFixtureTransport:
    def send(self, request: HttpRequest) -> HttpResponse:
        assert request.json_body is not None
        assert request.url.endswith("/v1beta/models/gemini-2.5-flash:generateContent")
        assert request.json_body["generationConfig"]["responseMimeType"] == "application/json"
        return HttpResponse(
            200,
            {"content-type": "application/json"},
            json.dumps(
                {
                    "responseId": "gemini-priced",
                    "modelVersion": "gemini-2.5-flash-001",
                    "candidates": [
                        {
                            "finishReason": "STOP",
                            "content": {
                                "role": "model",
                                "parts": [{"text": '{"lesson":"verified"}'}],
                            },
                        }
                    ],
                    "usageMetadata": {
                        "promptTokenCount": 8,
                        "candidatesTokenCount": 4,
                        "thoughtsTokenCount": 3,
                        "toolUsePromptTokenCount": 0,
                    },
                }
            ).encode(),
        )


def _policy() -> dict[str, Any]:
    return {
        "version": 1,
        "privacyMode": "hybrid",
        "dataClassification": "project",
        "budget": {
            "currency": "USD",
            "hardLimitMicros": 1_000_000,
            "requireKnownPricing": True,
            "approved": True,
        },
        "approvals": [
            {
                "providerId": "gemini",
                "capabilities": ["llm.structured"],
                "credentialRef": "keyring://alystria/gemini/api_key",
                "boundary": "cloud",
                "retention": "configurable",
                "regions": ["provider-managed"],
                "dataClasses": ["project"],
                "privacyApproved": True,
                "retentionApproved": True,
                "regionApproved": True,
                "budgetApproved": True,
            }
        ],
        "routes": [
            {
                "capability": "llm.structured",
                "providerIds": ["gemini"],
                "model": "gemini-2.5-flash",
                "voice": None,
            }
        ],
    }


def test_runtime_factory_applies_reviewed_gemini_pricing_under_one_dollar_cap() -> None:
    broker = EphemeralCredentialBroker()
    credential_ref = "keyring://alystria/gemini/api_key"
    grant = broker.issue("gemini", credential_ref, "fixture-runtime-credential")
    runtime = ProviderRuntimeFactory(
        transport_factory=lambda provider_id: (
            GeminiFixtureTransport()
            if provider_id == "gemini"
            else (_ for _ in ()).throw(AssertionError(provider_id))
        ),
        credential_resolver=broker,
        credential_grants={"gemini": grant},
    ).build(parse_routing_policy(_policy()))

    result = ProviderTextClient(runtime).generate(
        TextRequest(
            "Create a grounded lesson plan.",
            "gemini-2.5-flash",
            max_output_tokens=8_192,
            json_schema={
                "type": "object",
                "properties": {"lesson": {"type": "string"}},
                "required": ["lesson"],
                "additionalProperties": False,
            },
        ),
        idempotency_key="gemini-priced-runtime",
    )

    assert result.value.parsed == {"lesson": "verified"}
    assert result.usage.units["output_tokens"] == 4
    assert result.usage.units["thought_tokens"] == 3
    assert result.usage.actual_cost_micros == 20
