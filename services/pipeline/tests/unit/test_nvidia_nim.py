from __future__ import annotations

import base64
import json
from typing import Any

import pytest

from alystria.audio.wav import WavFixtureSpec, generate_sine_wav
from alystria.providers import (
    NVIDIA_MAGPIE_ENDPOINT,
    NVIDIA_MAGPIE_MODEL,
    NVIDIA_MAGPIE_VOICE,
    AssetInput,
    Capability,
    DataClassification,
    EmbeddingInputType,
    EmbeddingRequest,
    FailureCode,
    HttpRequest,
    HttpResponse,
    ImageRequest,
    NvidiaNimAdapter,
    ProviderFailure,
    RequestContext,
    RerankPassage,
    RerankRequest,
    SpeechRequest,
    TextRequest,
    VisionLanguageRequest,
    default_catalog,
    parse_routing_policy,
)


class FakeTransport:
    def __init__(self, *payloads: dict[str, Any]) -> None:
        self.payloads = list(payloads)
        self.requests: list[HttpRequest] = []

    def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        if not self.payloads:
            raise AssertionError("unexpected NVIDIA request")
        return HttpResponse(
            200,
            {"Content-Type": "application/json"},
            json.dumps(self.payloads.pop(0)).encode(),
        )


def preview_context(**overrides: Any) -> RequestContext:
    values: dict[str, Any] = {
        "idempotency_key": "nim-attempt-1",
        "approved_provider_id": "nvidia-nim",
        "credential": "synthetic-short-key",
        "data_classification": DataClassification.PUBLIC,
        "metadata": {
            "termsApproved": "true",
            "modelAccessCheckedAt": "2026-08-28T00:00:00Z",
        },
    }
    values.update(overrides)
    return RequestContext(**values)


def test_nvidia_catalog_is_nonproduction_public_preview() -> None:
    descriptor = default_catalog().get("nvidia-nim")
    assert descriptor.display_name == "NVIDIA NIM Hosted Preview"
    assert descriptor.data_policy.training_use is True
    assert "Not production" in descriptor.data_policy.notes
    assert "Self-hosted NIM" in descriptor.data_policy.notes


def test_chat_uses_fixed_openai_compatible_endpoint_and_parses_usage() -> None:
    transport = FakeTransport(
        {
            "id": "nim-response-1",
            "model": "openai/gpt-oss-20b",
            "choices": [{"message": {"content": "A grounded outline"}}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 7},
        }
    )
    adapter = NvidiaNimAdapter(transport)
    result = adapter.invoke(
        TextRequest("Outline a public-domain topic", "openai/gpt-oss-20b"),
        preview_context(),
    )

    sent = transport.requests[0]
    assert sent.url == "https://integrate.api.nvidia.com/v1/chat/completions"
    assert sent.json_body is not None and sent.json_body["stream"] is False
    assert sent.redacted_headers()["Authorization"] == "[REDACTED]"
    assert result.value.text == "A grounded outline"
    assert result.usage.units == {"input_tokens": 12.0, "output_tokens": 7.0}


def test_structured_chat_reserves_completion_budget_with_low_reasoning_effort() -> None:
    transport = FakeTransport(
        {
            "model": "openai/gpt-oss-20b",
            "choices": [{"message": {"content": '{"answer":"yes"}'}}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 4},
        }
    )
    adapter = NvidiaNimAdapter(transport)

    result = adapter.invoke(
        TextRequest(
            "Return a structured answer",
            "openai/gpt-oss-20b",
            json_schema={
                "type": "object",
                "properties": {"answer": {"type": "string"}},
                "required": ["answer"],
                "additionalProperties": False,
            },
        ),
        preview_context(),
    )

    assert transport.requests[0].json_body["reasoning_effort"] == "low"
    assert transport.requests[0].timeout_seconds == 300.0
    assert result.value.parsed == {"answer": "yes"}


def test_magpie_tts_uses_pinned_endpoint_voice_and_validates_wav() -> None:
    wav = generate_sine_wav(WavFixtureSpec(duration_ms=250, sample_rate_hz=48_000))

    class SpeechTransport:
        def __init__(self) -> None:
            self.requests: list[HttpRequest] = []

        def send(self, request: HttpRequest) -> HttpResponse:
            self.requests.append(request)
            return HttpResponse(200, {"x-request-id": "magpie-1"}, wav)

    transport = SpeechTransport()
    adapter = NvidiaNimAdapter(
        transport,
        configured_tts_models=frozenset({NVIDIA_MAGPIE_MODEL}),
    )
    result = adapter.invoke(
        SpeechRequest(
            "A stable invariant narrows the search interval.",
            NVIDIA_MAGPIE_MODEL,
            NVIDIA_MAGPIE_VOICE,
            "en-US",
        ),
        preview_context(),
    )

    sent = transport.requests[0]
    assert sent.url == NVIDIA_MAGPIE_ENDPOINT
    assert sent.json_body is None and sent.body is not None
    assert NVIDIA_MAGPIE_VOICE.encode() in sent.body
    assert b'name="sample_rate_hz"\r\n\r\n48000' in sent.body
    assert result.value.assets[0].media_type == "audio/wav"
    assert result.value.assets[0].duration_seconds == pytest.approx(0.25)
    assert result.value.metadata["voiceId"] == NVIDIA_MAGPIE_VOICE
    assert result.usage.units == {"characters": 47.0}


def test_magpie_tts_rejects_unapproved_voice_before_network() -> None:
    transport = FakeTransport()
    adapter = NvidiaNimAdapter(
        transport,
        configured_tts_models=frozenset({NVIDIA_MAGPIE_MODEL}),
    )
    with pytest.raises(ProviderFailure, match="must pin"):
        adapter.invoke(
            SpeechRequest(
                "Narrate this",
                NVIDIA_MAGPIE_MODEL,
                "Magpie-Multilingual.EN-US.Aria.Calm",
                "en-US",
            ),
            preview_context(),
        )
    assert transport.requests == []


def test_embedding_and_reranking_contracts_are_typed() -> None:
    transport = FakeTransport(
        {
            "model": "nvidia/nemotron-3-embed-1b",
            "data": [
                {"index": 0, "embedding": [0.1, 0.2]},
                {"index": 1, "embedding": [0.3, 0.4]},
            ],
            "usage": {"prompt_tokens": 5},
        },
        {
            "rankings": [
                {"index": 0, "logit": 0.2},
                {"index": 1, "logit": 0.9},
            ]
        },
    )
    adapter = NvidiaNimAdapter(
        transport,
        configured_rerank_models=frozenset({"nvidia/nv-rerankqa-mistral-4b-v3"}),
    )
    embeddings = adapter.invoke(
        EmbeddingRequest(
            ("query text", "passage text"),
            "nvidia/nemotron-3-embed-1b",
            EmbeddingInputType.QUERY,
        ),
        preview_context(),
    )
    ranking = adapter.invoke(
        RerankRequest(
            "Which passage?",
            (RerankPassage("first", "p1"), RerankPassage("second", "p2")),
            "nvidia/nv-rerankqa-mistral-4b-v3",
            top_n=1,
        ),
        preview_context(),
    )

    assert transport.requests[0].url == "https://integrate.api.nvidia.com/v1/embeddings"
    assert embeddings.value.dimensions == 2
    assert embeddings.value.vectors[1] == (0.3, 0.4)
    assert transport.requests[1].url == ("https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking")
    assert transport.requests[1].json_body == {
        "model": "nvidia/nv-rerankqa-mistral-4b-v3",
        "query": {"text": "Which passage?"},
        "passages": [{"text": "first"}, {"text": "second"}],
    }
    assert ranking.value.rankings[0].passage_id == "p2"


def test_vlm_never_turns_nvidia_into_a_remote_asset_fetcher() -> None:
    adapter = NvidiaNimAdapter(FakeTransport())
    request = VisionLanguageRequest(
        "Describe this image",
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        (AssetInput("image/png", uri="https://internal.example/image.png"),),
    )
    with pytest.raises(ProviderFailure, match="inline image bytes") as caught:
        adapter.build_request(request, preview_context())
    assert caught.value.code is FailureCode.INVALID_REQUEST


def test_active_vlm_uses_bounded_instruct_mode_and_retired_route_is_a_tombstone() -> None:
    transport = FakeTransport()
    adapter = NvidiaNimAdapter(transport)
    encoded = base64.b64encode(b"small inspected jpeg").decode("ascii")
    active = adapter.build_request(
        VisionLanguageRequest(
            "Return the closed visual review JSON",
            "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
            (AssetInput("image/jpeg", data_base64=encoded),),
            max_output_tokens=1024,
            temperature=0.0,
        ),
        preview_context(),
    )
    assert active.url == "https://integrate.api.nvidia.com/v1/chat/completions"
    assert active.json_body is not None
    assert active.json_body["model"] == "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
    assert active.json_body["max_tokens"] == 1024
    assert active.json_body["chat_template_kwargs"] == {"enable_thinking": False}
    assert active.json_body["top_k"] == 1

    with pytest.raises(ProviderFailure, match="retired") as retired:
        adapter.build_request(
            VisionLanguageRequest(
                "Review this image",
                "nvidia/nemotron-nano-12b-v2-vl",
                (AssetInput("image/jpeg", data_base64=encoded),),
            ),
            preview_context(),
        )
    assert retired.value.code is FailureCode.PROVIDER_UNAVAILABLE
    assert transport.requests == []


def test_retired_embedding_and_unclassified_models_fail_before_network() -> None:
    transport = FakeTransport()
    adapter = NvidiaNimAdapter(transport)
    with pytest.raises(ProviderFailure, match="retired") as retired:
        adapter.build_request(
            EmbeddingRequest(("query",), "nvidia/nv-embed-v1", EmbeddingInputType.QUERY),
            preview_context(),
        )
    assert retired.value.code is FailureCode.PROVIDER_UNAVAILABLE
    with pytest.raises(ProviderFailure, match="chat capability allowlist"):
        adapter.build_request(TextRequest("hello", "listed-but-not-chat"), preview_context())
    assert transport.requests == []


def test_preview_is_zero_cost_but_reranking_stays_dormant_without_account_access() -> None:
    adapter = NvidiaNimAdapter(FakeTransport())
    estimate = adapter.estimate(TextRequest("hello", "openai/gpt-oss-20b"))
    assert estimate.micros == 0 and estimate.bounded is True
    assert not adapter.descriptor.supports(Capability.RERANKING)
    with pytest.raises(ProviderFailure, match="does not support"):
        adapter.build_request(
            RerankRequest(
                "query",
                (RerankPassage("passage"),),
                "nvidia/nv-rerankqa-mistral-4b-v3",
            ),
            preview_context(),
        )


def test_visual_models_require_exact_active_allowlisted_configuration() -> None:
    with pytest.raises(ValueError, match="endpoint allowlist"):
        NvidiaNimAdapter(
            FakeTransport(), configured_visual_models=frozenset({"vendor/arbitrary-model"})
        )
    with pytest.raises(ValueError, match="unavailable"):
        NvidiaNimAdapter(
            FakeTransport(),
            configured_visual_models=frozenset({"stabilityai/stable-video-diffusion"}),
        )

    adapter = NvidiaNimAdapter(
        FakeTransport(),
        configured_visual_models=frozenset({"black-forest-labs/flux.2-klein-4b"}),
    )
    request = adapter.build_request(
        ImageRequest(
            "A precise educational diagram",
            "black-forest-labs/flux.2-klein-4b",
            aspect_ratio="1:1",
            seed=42,
        ),
        preview_context(),
    )
    assert request.url == ("https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b")
    assert request.json_body is not None
    assert request.json_body["width"] == 1024
    assert request.json_body["height"] == 1024
    assert request.json_body["cfg_scale"] == 1.0
    assert request.json_body["steps"] == 1
    assert "mode" not in request.json_body


def test_flux_klein_visual_response_preserves_its_exact_model_license() -> None:
    jpeg = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\xff\xd9"
    transport = FakeTransport({"artifacts": [{"base64": base64.b64encode(jpeg).decode("ascii")}]})
    adapter = NvidiaNimAdapter(
        transport,
        configured_visual_models=frozenset({"black-forest-labs/flux.2-klein-4b"}),
    )

    result = adapter.invoke(
        ImageRequest(
            "A precise educational diagram",
            "black-forest-labs/flux.2-klein-4b",
            aspect_ratio="1:1",
            seed=42,
        ),
        preview_context(),
    )

    assert result.value.assets[0].license == "Apache-2.0"
    assert result.value.assets[0].media_type == "image/jpeg"


def test_flux_klein_binds_media_type_to_returned_bytes_not_requested_format() -> None:
    jpeg = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\xff\xd9"
    adapter = NvidiaNimAdapter(
        FakeTransport({"artifacts": [{"base64": base64.b64encode(jpeg).decode("ascii")}]}),
        configured_visual_models=frozenset({"black-forest-labs/flux.2-klein-4b"}),
    )
    result = adapter.invoke(
        ImageRequest(
            "A precise educational diagram",
            "black-forest-labs/flux.2-klein-4b",
            aspect_ratio="1:1",
            output_format="png",
        ),
        preview_context(),
    )
    assert result.value.assets[0].media_type == "image/jpeg"


@pytest.mark.parametrize("encoded", ["not-base64!", base64.b64encode(b"not an image").decode()])
def test_flux_klein_rejects_unverifiable_visual_bytes(encoded: str) -> None:
    adapter = NvidiaNimAdapter(
        FakeTransport({"artifacts": [{"base64": encoded}]}),
        configured_visual_models=frozenset({"black-forest-labs/flux.2-klein-4b"}),
    )
    with pytest.raises(ProviderFailure) as caught:
        adapter.invoke(
            ImageRequest(
                "A precise educational diagram",
                "black-forest-labs/flux.2-klein-4b",
                aspect_ratio="1:1",
            ),
            preview_context(),
        )
    assert caught.value.code is FailureCode.MALFORMED_RESPONSE


@pytest.mark.parametrize(
    "context",
    [
        preview_context(data_classification=DataClassification.PRIVATE),
        preview_context(metadata={"modelAccessCheckedAt": "2026-08-28T00:00:00Z"}),
        preview_context(metadata={"termsApproved": "true"}),
    ],
)
def test_hosted_preview_policy_blocks_before_network(context: RequestContext) -> None:
    transport = FakeTransport()
    with pytest.raises(ProviderFailure):
        NvidiaNimAdapter(transport).invoke(TextRequest("private", "openai/gpt-oss-20b"), context)
    assert transport.requests == []


def test_routing_policy_requires_terms_model_check_and_public_only() -> None:
    value = {
        "version": 1,
        "privacyMode": "cloud",
        "dataClassification": "public",
        "budget": {
            "currency": "USD",
            "hardLimitMicros": None,
            "requireKnownPricing": False,
            "approved": True,
        },
        "approvals": [
            {
                "providerId": "nvidia-nim",
                "capabilities": ["llm.text"],
                "credentialRef": "keyring://alystria/nvidia-nim/api_key",
                "boundary": "cloud",
                "retention": "provider_default",
                "regions": ["provider-managed"],
                "dataClasses": ["public"],
                "privacyApproved": True,
                "retentionApproved": True,
                "regionApproved": True,
                "budgetApproved": True,
                "termsApproved": True,
                "modelAccessCheckedAt": "2026-08-28T00:00:00Z",
            }
        ],
        "routes": [
            {
                "capability": "llm.text",
                "providerIds": ["nvidia-nim"],
                "model": "openai/gpt-oss-20b",
                "voice": None,
            }
        ],
    }
    policy = parse_routing_policy(value)
    assert policy.approvals[0].terms_approved is True

    value["approvals"][0]["termsApproved"] = False
    with pytest.raises(ValueError, match="Trial Terms"):
        parse_routing_policy(value)
