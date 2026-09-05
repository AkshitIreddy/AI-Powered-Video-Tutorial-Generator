from __future__ import annotations

import base64
import json
from typing import Any

import pytest

from alystria.providers import (
    CLOUDFLARE_FLUX_ESTIMATED_MICROS,
    CLOUDFLARE_FLUX_MODEL,
    CLOUDFLARE_FLUX_STEPS,
    AssetInput,
    Capability,
    CloudflareWorkersAIAdapter,
    DataBoundary,
    DataClassification,
    EphemeralCredentialBroker,
    FailureCode,
    HttpRequest,
    HttpResponse,
    ImageRequest,
    PrivacyMode,
    ProviderFailure,
    ProviderRuntimeFactory,
    RequestContext,
    RetentionMode,
    SpeechRequest,
    default_catalog,
    parse_routing_policy,
)


class FakeTransport:
    def __init__(self, *responses: HttpResponse) -> None:
        self.responses = list(responses)
        self.requests: list[HttpRequest] = []

    def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        if not self.responses:
            raise AssertionError("unexpected Cloudflare request")
        return self.responses.pop(0)


def response(payload: dict[str, Any], status: int = 200) -> HttpResponse:
    return HttpResponse(
        status,
        {"Content-Type": "application/json", "cf-ray": "fixture-ray"},
        json.dumps(payload).encode(),
    )


def context(**overrides: Any) -> RequestContext:
    values: dict[str, Any] = {
        "idempotency_key": "cloudflare-image-1",
        "approved_provider_id": "cloudflare-workers-ai",
        "credential": "fixture-token",
        "approved_boundary": DataBoundary.CLOUD,
        "approved_retention": RetentionMode.CONFIGURABLE,
        "approved_region": "provider-managed",
        "privacy_mode": PrivacyMode.CLOUD,
        "data_classification": DataClassification.PROJECT,
        "metadata": {"accountId": "0123456789abcdef0123456789abcdef"},
    }
    values.update(overrides)
    return RequestContext(**values)


def jpeg_fixture() -> bytes:
    # The adapter validates the provider-declared JPEG boundary. Full image
    # decoding happens later in Alystria's media quarantine.
    return b"\xff\xd8\xff\xe0fixture-jpeg\xff\xd9"


def cloudflare_policy() -> dict[str, Any]:
    return {
        "version": 1,
        "privacyMode": "cloud",
        "dataClassification": "project",
        "budget": {
            "currency": "USD",
            "hardLimitMicros": 10_000,
            "requireKnownPricing": True,
            "approved": True,
        },
        "approvals": [
            {
                "providerId": "cloudflare-workers-ai",
                "capabilities": ["image.generate"],
                "credentialRef": "keyring://alystria/cloudflare-workers-ai/api_key",
                "accountId": "0123456789abcdef0123456789abcdef",
                "boundary": "cloud",
                "retention": "configurable",
                "regions": ["provider-managed"],
                "dataClasses": ["project"],
                "privacyApproved": True,
                "retentionApproved": True,
                "regionApproved": True,
                "budgetApproved": True,
                "termsApproved": False,
                "modelAccessCheckedAt": None,
            }
        ],
        "routes": [
            {
                "capability": "image.generate",
                "providerIds": ["cloudflare-workers-ai"],
                "model": CLOUDFLARE_FLUX_MODEL,
                "voice": None,
            }
        ],
    }


def test_catalog_declares_only_the_verified_cloudflare_image_route() -> None:
    descriptor = default_catalog().get("cloudflare-workers-ai")
    assert descriptor.capabilities == frozenset({Capability.IMAGE_GENERATION})
    assert descriptor.models == (CLOUDFLARE_FLUX_MODEL,)
    assert descriptor.data_policy.stores_by_default is False
    assert descriptor.data_policy.training_use is False


def test_adapter_uses_fixed_host_account_path_and_exact_model() -> None:
    encoded = base64.b64encode(jpeg_fixture()).decode()
    transport = FakeTransport(response({"result": {"image": encoded}, "success": True}))
    adapter = CloudflareWorkersAIAdapter(transport)
    result = adapter.invoke(
        ImageRequest(
            "A clear paper-cut diagram of photosynthesis",
            CLOUDFLARE_FLUX_MODEL,
            seed=17,
        ),
        context(hard_budget_micros=1_000),
    )

    sent = transport.requests[0]
    assert sent.url == (
        "https://api.cloudflare.com/client/v4/accounts/"
        "0123456789abcdef0123456789abcdef/ai/run/"
        "@cf/black-forest-labs/flux-1-schnell"
    )
    assert sent.json_body == {
        "prompt": "A clear paper-cut diagram of photosynthesis",
        "steps": CLOUDFLARE_FLUX_STEPS,
        "seed": 17,
    }
    assert sent.redacted_headers()["Authorization"] == "[REDACTED]"
    assert result.value.assets[0].media_type == "image/jpeg"
    assert result.value.assets[0].data_base64 == encoded
    assert result.value.assets[0].license == "Apache-2.0"
    assert result.value.metadata["providerOutputFormat"] == "jpeg"
    assert result.usage.units["steps"] == 4.0
    assert result.raw_id == "fixture-ray"
    assert adapter.estimate(
        ImageRequest("A diagram", CLOUDFLARE_FLUX_MODEL)
    ).micros == CLOUDFLARE_FLUX_ESTIMATED_MICROS


@pytest.mark.parametrize(
    ("metadata", "message"),
    [
        ({}, "Account ID"),
        ({"accountId": "../redirect"}, "Account ID"),
    ],
)
def test_account_id_must_be_safe_before_any_transport(
    metadata: dict[str, str], message: str
) -> None:
    transport = FakeTransport()
    adapter = CloudflareWorkersAIAdapter(transport)
    with pytest.raises(ProviderFailure, match=message) as raised:
        adapter.build_request(
            ImageRequest("A diagram", CLOUDFLARE_FLUX_MODEL),
            context(metadata=metadata),
        )
    assert raised.value.code is FailureCode.INVALID_REQUEST
    assert transport.requests == []


def test_unknown_model_and_image_edit_fail_closed() -> None:
    adapter = CloudflareWorkersAIAdapter(FakeTransport())
    with pytest.raises(ProviderFailure, match="allowlist"):
        adapter.build_request(ImageRequest("A", "@cf/vendor/other"), context())
    with pytest.raises(ProviderFailure, match=r"does not support image\.edit"):
        adapter.build_request(
            ImageRequest(
                "A",
                CLOUDFLARE_FLUX_MODEL,
                reference_images=(
                    # The actual bytes do not need to be decoded before this
                    # unsupported-capability boundary rejects the request.
                    AssetInput("image/png", data_base64="AA=="),
                ),
            ),
            context(),
        )


@pytest.mark.parametrize(
    "payload",
    [
        {"result": {}, "success": True},
        {"result": {"image": "not base64"}, "success": True},
        {
            "result": {"image": base64.b64encode(b"not-a-jpeg").decode()},
            "success": True,
        },
        {"result": {"image": base64.b64encode(jpeg_fixture()).decode()}, "success": False},
    ],
)
def test_malformed_or_unsuccessful_cloudflare_envelopes_are_rejected(
    payload: dict[str, Any]
) -> None:
    adapter = CloudflareWorkersAIAdapter(FakeTransport(response(payload)))
    with pytest.raises(ProviderFailure) as raised:
        adapter.invoke(ImageRequest("A diagram", CLOUDFLARE_FLUX_MODEL), context())
    assert raised.value.code in {FailureCode.MALFORMED_RESPONSE, FailureCode.PROVIDER_ERROR}
    assert raised.value.request_id == "fixture-ray"


def test_policy_round_trip_requires_account_id_and_runtime_uses_vault_lease() -> None:
    submitted = cloudflare_policy()
    policy = parse_routing_policy(submitted)
    assert policy.approval_for("cloudflare-workers-ai").account_id == (
        "0123456789abcdef0123456789abcdef"
    )
    assert policy.to_dict() == submitted

    encoded = base64.b64encode(jpeg_fixture()).decode()
    transport = FakeTransport(response({"result": {"image": encoded}, "success": True}))
    broker = EphemeralCredentialBroker()
    reference = "keyring://alystria/cloudflare-workers-ai/api_key"
    grant = broker.issue("cloudflare-workers-ai", reference, "fixture-token")
    runtime = ProviderRuntimeFactory(
        transport_factory=lambda provider_id: (
            transport
            if provider_id == "cloudflare-workers-ai"
            else (_ for _ in ()).throw(AssertionError(provider_id))
        ),
        credential_resolver=broker,
        credential_grants={"cloudflare-workers-ai": grant},
    ).build(policy)
    result = runtime.invoke(
        ImageRequest("A route-integrated diagram", CLOUDFLARE_FLUX_MODEL),
        idempotency_key="cloudflare-integrated-1",
    )
    assert result.provider_id == "cloudflare-workers-ai"
    assert transport.requests[0].redacted_headers()["Authorization"] == "[REDACTED]"


def test_policy_rejects_missing_account_id() -> None:
    submitted = cloudflare_policy()
    submitted["approvals"][0]["accountId"] = None
    with pytest.raises(ValueError, match="Account ID"):
        parse_routing_policy(submitted)


def test_adapter_does_not_claim_speech_support() -> None:
    adapter = CloudflareWorkersAIAdapter(FakeTransport())
    with pytest.raises(ProviderFailure) as raised:
        adapter.build_request(
            SpeechRequest("Hello", "@cf/deepgram/aura-2-en", "asteria-en", "en-US"),
            context(),
        )
    assert raised.value.code is FailureCode.UNSUPPORTED_CAPABILITY
