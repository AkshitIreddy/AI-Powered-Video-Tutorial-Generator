from __future__ import annotations

import base64
import io
import json
from typing import Any

from PIL import Image

from alystria.providers import (
    GEMINI_3_8_FLASH_MODEL,
    EphemeralCredentialBroker,
    HttpRequest,
    HttpResponse,
    ProviderRuntimeFactory,
    ProviderTextClient,
    TextRequest,
    parse_routing_policy,
)
from alystria.providers.gemini_vision import GEMINI_VISION_MODEL
from alystria.providers.types import AssetInput, VisionLanguageRequest


class GeminiFixtureTransport:
    def send(self, request: HttpRequest) -> HttpResponse:
        assert request.json_body is not None
        assert request.url.endswith(f"/v1beta/models/{GEMINI_3_8_FLASH_MODEL}:generateContent")
        assert request.json_body["generationConfig"]["responseMimeType"] == "application/json"
        return HttpResponse(
            200,
            {"content-type": "application/json"},
            json.dumps(
                {
                    "responseId": "gemini-priced",
                    "modelVersion": "gemini-3.8-flash-001",
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
                "model": GEMINI_3_8_FLASH_MODEL,
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
            GEMINI_3_8_FLASH_MODEL,
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
    assert result.usage.actual_cost_micros == 33


def test_runtime_factory_supports_vision_without_a_gemini_writing_route() -> None:
    document = _policy()
    document["approvals"][0]["capabilities"] = ["vlm.chat"]
    document["routes"][0].update(capability="vlm.chat", model=GEMINI_VISION_MODEL)
    observed = []

    class VisionTransport:
        def send(self, request):
            observed.append(request)
            return HttpResponse(
                200, {}, b'{"candidates":[{"content":{"parts":[{"text":"{\\"ok\\":true}"}]}}]}'
            )

    broker = EphemeralCredentialBroker()
    reference = "keyring://alystria/gemini/api_key"
    grant = broker.issue("gemini", reference, "fixture-credential")
    runtime = ProviderRuntimeFactory(
        transport_factory=lambda _: VisionTransport(),
        credential_resolver=broker,
        credential_grants={"gemini": grant},
    ).build(parse_routing_policy(document))
    data = io.BytesIO()
    Image.new("RGB", (16, 16)).save(data, format="PNG")
    result = runtime.invoke(
        VisionLanguageRequest(
            "Review",
            GEMINI_VISION_MODEL,
            (AssetInput("image/png", data_base64=base64.b64encode(data.getvalue()).decode()),),
        ),
        idempotency_key="vision-only",
    )
    assert result.provider_id == "gemini"
    assert len(observed) == 1
    assert observed[0].url.endswith(f"/{GEMINI_VISION_MODEL}:generateContent")
