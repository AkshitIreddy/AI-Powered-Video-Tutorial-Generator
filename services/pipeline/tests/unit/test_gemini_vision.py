from __future__ import annotations

import base64
import io
import json
from dataclasses import replace

import pytest
from PIL import Image

from alystria.providers.errors import FailureCode, ProviderFailure
from alystria.providers.gemini_vision import GEMINI_VISION_MODEL, GeminiVisionAdapter
from alystria.providers.transport import HttpResponse
from alystria.providers.types import AssetInput, RequestContext, VisionLanguageRequest


class Transport:
    def __init__(self, payload=None):
        self.requests = []
        self.payload = payload or {
            "candidates": [{"content": {"parts": [{"text": '{"answer":"red"}'}]}}],
            "usageMetadata": {
                "promptTokenCount": 30,
                "candidatesTokenCount": 5,
                "thoughtsTokenCount": 7,
            },
        }

    def send(self, request):
        self.requests.append(request)
        return HttpResponse(200, {}, json.dumps(self.payload).encode())


def vision_request():
    stream = io.BytesIO()
    Image.new("RGB", (16, 16), "red").save(stream, format="PNG")
    return VisionLanguageRequest(
        "Return the colour as JSON",
        GEMINI_VISION_MODEL,
        (AssetInput("image/png", data_base64=base64.b64encode(stream.getvalue()).decode()),),
    )


def test_inline_vision_request_preserves_guardrails_and_bills_thought_tokens():
    transport = Transport()
    adapter = GeminiVisionAdapter(transport)
    request = vision_request()
    result = adapter.invoke(
        request, RequestContext("test", "gemini", "not-a-real-key", hard_budget_micros=500_000)
    )
    sent = transport.requests[0]
    assert sent.url.endswith(f"/{GEMINI_VISION_MODEL}:generateContent")
    assert sent.json_body["contents"][0]["parts"][1]["inlineData"]["mimeType"] == "image/png"
    assert sent.json_body["generationConfig"] == {
        "maxOutputTokens": 2048,
        "responseMimeType": "application/json",
        "thinkingConfig": {"thinkingLevel": "low"},
    }
    assert "temperature" not in sent.json_body["generationConfig"]
    assert result.value.text == '{"answer":"red"}'
    assert result.usage.actual_cost_micros == 135  # 30 input + 12 billable output
    assert adapter.estimate(request).micros >= result.usage.actual_cost_micros
    assert sent.redacted_headers()["x-goog-api-key"] == "[REDACTED]"


@pytest.mark.parametrize(
    "change",
    [
        {"model": "latest"},
        {"images": (AssetInput("image/png", uri="https://example.com/private.png"),)},
        {"images": (AssetInput("image/png", data_base64="not base64"),)},
        {"max_output_tokens": 8193},
        {"images": vision_request().images * 9},
        {"images": (replace(vision_request().images[0], sha256="0" * 64),)},
    ],
)
def test_invalid_preview_or_unreviewed_model_never_reaches_transport(change):
    transport = Transport()
    with pytest.raises(ProviderFailure):
        GeminiVisionAdapter(transport).invoke(
            replace(vision_request(), **change), RequestContext("test", "gemini", "fake")
        )
    assert not transport.requests


def test_budget_and_provider_consent_are_checked_before_egress():
    for context, code in [
        (
            RequestContext("test", "gemini", "fake", hard_budget_micros=0),
            FailureCode.BUDGET_EXCEEDED,
        ),
        (RequestContext("test", "nvidia-nim", "fake"), FailureCode.ROUTING_CONSENT_REQUIRED),
    ]:
        transport = Transport()
        with pytest.raises(ProviderFailure) as failure:
            GeminiVisionAdapter(transport).invoke(vision_request(), context)
        assert failure.value.code == code
        assert not transport.requests


def test_blocked_vision_output_is_not_a_successful_review():
    transport = Transport({"promptFeedback": {"blockReason": "SAFETY"}})
    with pytest.raises(ProviderFailure) as failure:
        GeminiVisionAdapter(transport).invoke(
            vision_request(), RequestContext("test", "gemini", "fake")
        )
    assert failure.value.code == FailureCode.POLICY_BLOCKED

