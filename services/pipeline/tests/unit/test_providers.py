from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import pytest

from alystria.providers import (
    AnthropicMessagesAdapter,
    AssetInput,
    Capability,
    DataBoundary,
    DataClassification,
    FailureCode,
    GeminiInteractionsAdapter,
    HttpRequest,
    HttpResponse,
    ImageRequest,
    MediaSearchRequest,
    MotionRequest,
    OpenAICompatibleLocalAdapter,
    OpenAIResponsesAdapter,
    OperationState,
    PresenterRequest,
    PrivacyMode,
    ProviderFailure,
    ProviderResult,
    ProviderRouter,
    RequestContext,
    RetentionMode,
    RoutingPolicy,
    SpeechRequest,
    TextOutput,
    TextRequest,
    TokenPrices,
    TranscriptionRequest,
    UnitPrice,
    UrllibTransport,
    Usage,
    default_catalog,
    launch_media_adapter,
    launch_media_provider_ids,
)
from alystria.security.errors import PolicyViolation
from alystria.security.network import ValidatedUrl
from alystria.security.privacy import ProviderBoundary, current_network_context


def response(payload: dict[str, Any], status: int = 200) -> HttpResponse:
    return HttpResponse(
        status,
        {"Content-Type": "application/json", "x-request-id": "req_header"},
        json.dumps(payload).encode(),
    )


def test_http_transport_value_reprs_hide_project_content_and_credentials() -> None:
    request = HttpRequest(
        "POST",
        "https://api.example.test/v1/generate",
        {"Authorization": "Bearer secret-provider-token"},
        {"prompt": "private learner source content"},
        b"private raw body",
    )
    provider_response = HttpResponse(
        200,
        {"X-Provider-Debug": "private-header"},
        b'{"output":"private generated content"}',
    )
    assert "secret-provider-token" not in repr(request)
    assert "private learner source content" not in repr(request)
    assert "private raw body" not in repr(request)
    assert "private-header" not in repr(provider_response)
    assert "private generated content" not in repr(provider_response)


class FakeTransport:
    def __init__(self, *responses: HttpResponse) -> None:
        self.responses = list(responses)
        self.requests: list[HttpRequest] = []

    def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        if not self.responses:
            raise AssertionError("Fake transport received an unexpected request")
        return self.responses.pop(0)


class StubProductionTransport(UrllibTransport):
    def __init__(self, *responses: HttpResponse) -> None:
        super().__init__(resolver=self._resolve_public)
        self.responses = list(responses)
        self.validated: list[ValidatedUrl] = []
        self.contexts: list[Any] = []

    @staticmethod
    def _resolve_public(_host: str, _port: int) -> tuple[str, ...]:
        return ("93.184.216.34",)

    def _send_pinned(
        self,
        validated: ValidatedUrl,
        request: HttpRequest,
        body: bytes | None,
        headers: dict[str, str],
    ) -> HttpResponse:
        del request, body, headers
        self.validated.append(validated)
        self.contexts.append(current_network_context())
        if not self.responses:
            raise AssertionError("Stub production transport received an unexpected request")
        return self.responses.pop(0)


def fail_if_resolved(_host: str, _port: int) -> tuple[str, ...]:
    raise AssertionError("DNS must not run for a request rejected by privacy policy")


def context(provider: str, **kwargs: Any) -> RequestContext:
    return RequestContext(
        idempotency_key="job-01-attempt-01",
        approved_provider_id=provider,
        credential="secret-value",
        **kwargs,
    )


SCHEMA = {
    "type": "object",
    "properties": {"answer": {"type": "string"}},
    "required": ["answer"],
    "additionalProperties": False,
}


def test_openai_responses_uses_stateless_current_structured_contract() -> None:
    transport = FakeTransport(
        response(
            {
                "id": "resp_1",
                "status": "completed",
                "model": "gpt-test",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": '{"answer":"yes"}'}],
                    }
                ],
                "usage": {"input_tokens": 20, "output_tokens": 5, "total_tokens": 25},
            }
        )
    )
    adapter = OpenAIResponsesAdapter(
        transport,
        prices=TokenPrices("price-v1", 1_000_000, 2_000_000),
    )
    result = adapter.generate(
        TextRequest("Return an answer", "gpt-test", json_schema=SCHEMA),
        context("openai"),
    )

    sent = transport.requests[0]
    assert sent.url == "https://api.openai.com/v1/responses"
    assert sent.json_body is not None
    assert sent.json_body["store"] is False
    assert sent.json_body["text"]["format"] == {
        "type": "json_schema",
        "name": "alystria_output",
        "schema": SCHEMA,
        "strict": True,
    }
    assert sent.headers["Idempotency-Key"] == "job-01-attempt-01"
    assert sent.redacted_headers()["Authorization"] == "[REDACTED]"
    assert result.value.parsed == {"answer": "yes"}
    assert result.usage.actual_cost_micros == 30


def test_openai_research_collects_sources_and_actual_search_usage() -> None:
    transport = FakeTransport(
        response(
            {
                "id": "resp_research",
                "status": "completed",
                "output_text": "Grounded answer",
                "output": [
                    {
                        "type": "web_search_call",
                        "action": {
                            "sources": [
                                {
                                    "type": "url_citation",
                                    "url": "https://example.test",
                                    "title": "A",
                                }
                            ]
                        },
                    }
                ],
                "usage": {"input_tokens": 10, "output_tokens": 10},
            }
        )
    )
    adapter = OpenAIResponsesAdapter(
        transport,
        prices=TokenPrices("price-v1", 0, 0, search_micros_per_call=10_000),
    )
    result = adapter.invoke(
        TextRequest(
            "Research it",
            "gpt-test",
            research=True,
            allowed_domains=("example.test",),
        ),
        context("openai"),
    )
    assert transport.requests[0].json_body["tools"] == [
        {"type": "web_search", "filters": {"allowed_domains": ["example.test"]}}
    ]
    assert result.value.citations[0]["url"] == "https://example.test"
    assert result.usage.units["search_requests"] == 1
    assert result.usage.actual_cost_micros == 10_000


def test_anthropic_uses_output_config_and_versioned_research_tool() -> None:
    transport = FakeTransport(
        response(
            {
                "id": "msg_1",
                "type": "message",
                "model": "claude-test",
                "content": [
                    {
                        "type": "text",
                        "text": '{"answer":"yes"}',
                        "citations": [
                            {
                                "type": "web_search_result",
                                "url": "https://source.test",
                                "title": "S",
                            }
                        ],
                    }
                ],
                "usage": {
                    "input_tokens": 4,
                    "output_tokens": 2,
                    "server_tool_use": {"web_search_requests": 1},
                },
            }
        )
    )
    adapter = AnthropicMessagesAdapter(transport)
    result = adapter.invoke(
        TextRequest(
            "Research",
            "claude-test",
            json_schema=SCHEMA,
            research=True,
            allowed_domains=("source.test",),
        ),
        context("anthropic"),
    )
    body = transport.requests[0].json_body
    assert body is not None
    assert body["output_config"]["format"] == {"type": "json_schema", "schema": SCHEMA}
    assert body["tools"][0]["type"] == "web_search_20260318"
    assert body["tools"][0]["allowed_callers"] == ["direct"]
    assert "output_format" not in body
    assert result.value.parsed == {"answer": "yes"}
    assert result.value.citations[0]["url"] == "https://source.test"


def test_gemini_uses_interactions_response_format_and_steps_shape() -> None:
    transport = FakeTransport(
        response(
            {
                "id": "int_1",
                "status": "completed",
                "model": "gemini-test",
                "steps": [
                    {
                        "type": "model_output",
                        "content": [{"type": "text", "text": '{"answer":"yes"}'}],
                    }
                ],
                "usage": {
                    "total_input_tokens": 6,
                    "total_output_tokens": 3,
                    "total_thought_tokens": 2,
                    "total_tool_use_tokens": 0,
                },
            }
        )
    )
    adapter = GeminiInteractionsAdapter(transport)
    result = adapter.invoke(
        TextRequest("Answer", "gemini-test", json_schema=SCHEMA),
        context("gemini"),
    )
    sent = transport.requests[0]
    assert sent.url.endswith("/v1beta/interactions")
    assert sent.headers["Api-Revision"] == "2026-05-20"
    assert sent.json_body["store"] is False
    assert sent.json_body["response_format"] == {
        "type": "text",
        "mime_type": "application/json",
        "schema": SCHEMA,
    }
    assert result.value.parsed == {"answer": "yes"}
    assert result.usage.units["thought_tokens"] == 2


def test_gemini_research_rejects_unadvertised_domain_filter_before_network() -> None:
    transport = FakeTransport()
    adapter = GeminiInteractionsAdapter(transport)
    with pytest.raises(ProviderFailure, match="domain allowlisting") as caught:
        adapter.invoke(
            TextRequest("Research", "gemini-test", research=True, allowed_domains=("x.test",)),
            context("gemini"),
        )
    assert caught.value.code is FailureCode.UNSUPPORTED_CAPABILITY
    assert transport.requests == []


def test_local_openai_compatible_is_loopback_by_default_and_needs_no_key() -> None:
    with pytest.raises(ValueError, match="loopback"):
        OpenAICompatibleLocalAdapter(FakeTransport(), base_url="https://remote.test/v1")

    transport = FakeTransport(
        response(
            {
                "id": "chatcmpl-local",
                "model": "qwen-local",
                "choices": [{"message": {"content": '{"answer":"local"}'}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 2},
            }
        )
    )
    adapter = OpenAICompatibleLocalAdapter(transport)
    request_context = RequestContext("local-attempt", "openai-compatible-local")
    result = adapter.invoke(
        TextRequest("Answer", "qwen-local", json_schema=SCHEMA),
        request_context,
    )
    assert "Authorization" not in transport.requests[0].headers
    assert transport.requests[0].json_body["response_format"]["type"] == "json_schema"
    assert result.value.parsed == {"answer": "local"}


def test_production_transport_requires_scope_before_dns_or_socket() -> None:
    transport = UrllibTransport(resolver=fail_if_resolved)

    with pytest.raises(PolicyViolation, match="outside an explicit privacy scope"):
        transport.send(HttpRequest("GET", "https://api.openai.com/v1/models"))


def test_local_mode_blocks_project_content_cloud_egress_before_dns() -> None:
    transport = UrllibTransport(resolver=fail_if_resolved)
    adapter = OpenAIResponsesAdapter(transport)

    with pytest.raises(PolicyViolation, match="disabled in Local mode"):
        adapter.invoke(
            TextRequest("private project text", "gpt-test"),
            context(
                "openai",
                privacy_mode=PrivacyMode.LOCAL,
                data_classification=DataClassification.PROJECT,
                contains_project_content=True,
            ),
        )


def test_openai_compatible_url_cannot_turn_local_ipc_into_public_http() -> None:
    transport = UrllibTransport(resolver=fail_if_resolved)
    adapter = OpenAICompatibleLocalAdapter(
        transport,
        base_url="https://169.254.169.254/v1",
        allow_non_loopback=True,
    )

    with pytest.raises(PolicyViolation, match="local-process provider"):
        adapter.invoke(
            TextRequest("private project text", "qwen-local"),
            RequestContext("local-attempt", "openai-compatible-local"),
        )


def test_custom_openai_base_url_cannot_target_private_address() -> None:
    adapter = OpenAIResponsesAdapter(
        UrllibTransport(resolver=fail_if_resolved),
        base_url="https://127.0.0.1/v1",
    )

    with pytest.raises(PolicyViolation, match="non-public address"):
        adapter.invoke(TextRequest("project text", "gpt-test"), context("openai"))


def test_approved_cloud_route_runs_transport_inside_derived_scope() -> None:
    transport = StubProductionTransport(
        response(
            {
                "id": "resp_approved",
                "status": "completed",
                "model": "gpt-test",
                "output_text": "approved",
                "usage": {"input_tokens": 1, "output_tokens": 1},
            }
        )
    )
    adapter = OpenAIResponsesAdapter(transport)

    adapter.invoke(
        TextRequest("public fact", "gpt-test"),
        context(
            "openai",
            privacy_mode=PrivacyMode.CLOUD,
            data_classification=DataClassification.PUBLIC,
            contains_project_content=False,
        ),
    )

    assert transport.validated[0].normalized_url == "https://api.openai.com/v1/responses"
    assert transport.validated[0].pinned_addresses == ("93.184.216.34",)
    assert len(transport.contexts) == 1
    observed = transport.contexts[0]
    assert observed is not None
    assert observed.mode is PrivacyMode.CLOUD
    assert observed.classification is DataClassification.PUBLIC
    assert observed.contains_project_content is False
    assert observed.provider_boundary is ProviderBoundary.CLOUD
    assert current_network_context() is None


def test_provider_http_failures_are_typed_and_do_not_echo_remote_body_or_key() -> None:
    transport = FakeTransport(
        HttpResponse(
            401,
            {"Content-Type": "application/json", "x-request-id": "req_1"},
            b'{"error":"secret-value and private prompt"}',
        )
    )
    with pytest.raises(ProviderFailure) as caught:
        OpenAIResponsesAdapter(transport).invoke(
            TextRequest("private prompt", "gpt-test"),
            context("openai"),
        )
    assert caught.value.code is FailureCode.AUTHENTICATION
    assert caught.value.request_id == "req_1"
    serialised = json.dumps(caught.value.to_dict())
    assert "secret-value" not in serialised
    assert "private prompt" not in serialised


def test_hard_budget_fails_closed_when_price_is_unbounded() -> None:
    transport = FakeTransport()
    adapter = OpenAIResponsesAdapter(transport)
    with pytest.raises(ProviderFailure) as caught:
        adapter.invoke(
            TextRequest("Answer", "gpt-test"),
            context("openai", hard_budget_micros=100),
        )
    assert caught.value.code is FailureCode.BUDGET_EXCEEDED
    assert transport.requests == []


def test_versioned_catalog_covers_every_launch_modality_and_is_conservative() -> None:
    catalog = default_catalog()
    capabilities = set().union(*(entry.capabilities for entry in catalog.entries.values()))
    assert set(Capability) <= capabilities
    assert catalog.get("openai").catalog_version == catalog.version
    assert catalog.get("openai").data_policy.boundary is DataBoundary.CLOUD
    assert catalog.get("openai").data_policy.retention is RetentionMode.CONFIGURABLE
    assert catalog.get("whisperx-local").data_policy.retention is RetentionMode.LOCAL_ONLY
    assert set(launch_media_provider_ids()) <= set(catalog.entries)


@pytest.mark.parametrize(
    ("provider", "provider_request", "path_fragment"),
    [
        ("openai", ImageRequest("diagram", "gpt-image", size="1536x1024"), "/images/generations"),
        ("black-forest-labs", ImageRequest("diagram", "flux"), "/v1/flux-pro-1.1"),
        ("recraft", ImageRequest("diagram", "recraftv4_1"), "/images/generations"),
        ("openverse", MediaSearchRequest("Ada Lovelace"), "/images/?"),
        ("pexels", MediaSearchRequest("ocean", media_type="video"), "/v1/videos/search?"),
        ("runway", MotionRequest("orbit", "gen4", 5), "/v1/text_to_video"),
        (
            "elevenlabs",
            SpeechRequest("Hello", "eleven", "voice-1", "en-US"),
            "/text-to-speech/voice-1",
        ),
        (
            "google-cloud-speech",
            TranscriptionRequest(AssetInput("audio/wav", data_base64="UklGRg=="), "chirp"),
            "speech:recognize",
        ),
    ],
)
def test_launch_media_request_builders(
    provider: str, provider_request: Any, path_fragment: str
) -> None:
    adapter = launch_media_adapter(provider, FakeTransport())
    sent = adapter.build_request(provider_request, context(provider))
    assert path_fragment in sent.url
    assert sent.method in {"GET", "POST"}


def test_image_edit_builder_uses_multipart_and_never_fetches_remote_input() -> None:
    adapter = launch_media_adapter("openai", FakeTransport())
    request = ImageRequest(
        "Make it blue",
        "gpt-image",
        reference_images=(AssetInput("image/png", data_base64="iVBORw=="),),
    )
    sent = adapter.build_request(request, context("openai"))
    assert sent.url.endswith("/images/edits")
    assert sent.headers["Content-Type"].startswith("multipart/form-data; boundary=")
    assert sent.body is not None and b"Make it blue" in sent.body

    remote = ImageRequest(
        "Make it blue",
        "gpt-image",
        reference_images=(AssetInput("image/png", uri="https://untrusted.test/image.png"),),
    )
    with pytest.raises(ProviderFailure, match="ingested inline asset"):
        adapter.build_request(remote, context("openai"))


def test_licensed_media_builder_carries_explicit_license_allowlist() -> None:
    adapter = launch_media_adapter("openverse", FakeTransport())
    sent = adapter.build_request(
        MediaSearchRequest("history", license_allowlist=("cc0", "by")),
        RequestContext("search-1", "openverse"),
    )
    assert "license=cc0%2Cby" in sent.url
    assert "Authorization" not in sent.headers


def test_pexels_result_preserves_download_source_attribution_and_license() -> None:
    transport = FakeTransport(
        response(
            {
                "videos": [
                    {
                        "url": "https://pexels.test/video/1",
                        "duration": 4,
                        "user": {"name": "Creator"},
                        "video_files": [
                            {
                                "link": "https://cdn.test/small.mp4",
                                "file_type": "video/mp4",
                                "width": 640,
                                "height": 360,
                            },
                            {
                                "link": "https://cdn.test/large.mp4",
                                "file_type": "video/mp4",
                                "width": 1920,
                                "height": 1080,
                            },
                        ],
                    }
                ]
            }
        )
    )
    adapter = launch_media_adapter("pexels", transport)
    result = adapter.invoke(
        MediaSearchRequest("ocean", media_type="video"), context("pexels")
    )
    asset = result.value.assets[0]
    assert asset.uri == "https://cdn.test/large.mp4"
    assert asset.source_url == "https://pexels.test/video/1"
    assert asset.attribution == "Creator"
    assert asset.license == "Pexels"


def test_async_motion_submit_poll_and_cancel_are_explicit() -> None:
    transport = FakeTransport(
        response({"id": "task_1", "status": "pending"}, 202),
        response(
            {
                "id": "task_1",
                "status": "succeeded",
                "progress": 1,
                "output": [{"url": "https://assets.test/video.mp4", "duration": 5}],
                "usage": {"seconds": 5, "cost_micros": 42_000},
            }
        ),
        HttpResponse(204, {}, b""),
    )
    adapter = launch_media_adapter("runway", transport)
    request = MotionRequest("orbit", "gen4", 5)
    handle = adapter.submit(request, context("runway"))
    assert handle.poll_url == "https://api.dev.runwayml.com/v1/tasks/task_1"
    assert handle.cancel_url == "https://api.dev.runwayml.com/v1/tasks/task_1"
    status = adapter.poll(handle, context("runway"))
    assert status.state is OperationState.SUCCEEDED
    assert status.result is not None
    assert status.result.assets[0].uri == "https://assets.test/video.mp4"
    assert status.usage is not None and status.usage.actual_cost_micros == 42_000
    cancelled = adapter.cancel(handle, context("runway"))
    assert cancelled.state is OperationState.CANCELLED
    assert transport.requests[2].method == "DELETE"


def test_presenter_requires_consent_and_disclosure_before_network() -> None:
    transport = FakeTransport()
    adapter = launch_media_adapter("heygen", transport)
    request = PresenterRequest(
        AssetInput("audio/wav", uri="https://approved.test/audio"),
        AssetInput("application/x-provider-id", uri="avatar-1"),
        "avatar-model",
    )
    with pytest.raises(ProviderFailure) as caught:
        adapter.submit(request, context("heygen"))
    assert caught.value.code is FailureCode.POLICY_BLOCKED
    assert transport.requests == []


def test_unit_cost_estimate_and_provider_actual_cost_are_separate() -> None:
    transport = FakeTransport(
        HttpResponse(200, {"Content-Type": "audio/wav"}, b"RIFFaudio")
    )
    adapter = launch_media_adapter(
        "elevenlabs",
        transport,
        prices=(UnitPrice(Capability.TTS, "characters", 10, "price-v1"),),
    )
    request = SpeechRequest("hello", "eleven", "voice", "en-US")
    estimate = adapter.estimate(request)
    assert estimate.micros == 50 and estimate.bounded
    result = adapter.invoke(request, context("elevenlabs", hard_budget_micros=50))
    assert result.usage.actual_cost_micros is None
    assert result.value.assets[0].data_base64 is not None


@dataclass
class StubAdapter:
    descriptor: Any
    calls: int = 0
    failure: ProviderFailure | None = None

    def estimate(self, request: Any) -> Any:
        return None

    def invoke(self, request: Any, request_context: Any) -> ProviderResult[TextOutput]:
        self.calls += 1
        if self.failure:
            raise self.failure
        return ProviderResult(
            self.descriptor.provider_id,
            request.model,
            TextOutput("ok"),
            Usage(self.descriptor.provider_id, request.model),
        )


def test_router_never_silently_falls_back_after_provider_failure() -> None:
    catalog = default_catalog()
    first = StubAdapter(
        catalog.get("openai"),
        failure=ProviderFailure(FailureCode.RATE_LIMITED, "rate limited", retryable=True),
    )
    second = StubAdapter(catalog.get("anthropic"))
    router = ProviderRouter((first, second))
    policy = RoutingPolicy(("openai", "anthropic"))

    with pytest.raises(ProviderFailure) as caught:
        router.invoke(TextRequest("hello", "model"), context("openai"), policy)
    assert caught.value.code is FailureCode.RATE_LIMITED
    assert first.calls == 1
    assert second.calls == 0


def test_router_requires_explicit_approval_and_policy_match() -> None:
    adapter = StubAdapter(default_catalog().get("openai"))
    router = ProviderRouter((adapter,))
    with pytest.raises(ProviderFailure) as caught:
        router.decide(Capability.LLM_TEXT, RoutingPolicy(()))
    assert caught.value.code is FailureCode.ROUTING_CONSENT_REQUIRED

    with pytest.raises(ProviderFailure) as mismatch:
        router.decide(
            Capability.LLM_TEXT,
            RoutingPolicy(("openai",), required_boundary=DataBoundary.LOCAL),
        )
    assert mismatch.value.code is FailureCode.PROVIDER_UNAVAILABLE
