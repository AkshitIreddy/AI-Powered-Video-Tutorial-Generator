"""BYOK text, structured-output and web-research HTTP adapters."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from .base import GuardedAdapter
from .catalog import default_catalog
from .errors import FailureCode, ProviderFailure
from .transport import HttpRequest, HttpTransport
from .types import (
    CostEstimate,
    ProviderRequest,
    ProviderResult,
    RequestContext,
    TextOutput,
    TextRequest,
    Usage,
)


@dataclass(frozen=True, slots=True)
class TokenPrices:
    """Immutable pricing snapshot in USD micros per one million tokens."""

    catalog_version: str
    input_micros_per_million: int
    output_micros_per_million: int
    search_micros_per_call: int = 0
    estimated_search_calls: int = 3


GEMINI_2_5_FLASH_MODEL = "gemini-2.5-flash"
GEMINI_2_5_FLASH_PRICES = TokenPrices(
    catalog_version="2026-09-05-google-gemini-pricing",
    input_micros_per_million=300_000,
    output_micros_per_million=2_500_000,
)


def reviewed_gemini_prices(models: tuple[str, ...]) -> TokenPrices:
    """Return the verified paid-tier ceiling for one exact Gemini text model."""

    selected = tuple(dict.fromkeys(models))
    if selected != (GEMINI_2_5_FLASH_MODEL,):
        raise ValueError(
            "Gemini structured writing must pin the reviewed gemini-2.5-flash price snapshot"
        )
    return GEMINI_2_5_FLASH_PRICES


class BaseLLMAdapter(GuardedAdapter):
    def __init__(self, transport: HttpTransport, prices: TokenPrices | None = None) -> None:
        self.transport = transport
        self.prices = prices

    def estimate(self, request: ProviderRequest) -> CostEstimate:
        if not isinstance(request, TextRequest):
            return CostEstimate(None, "USD", False, "unsupported request type", "unknown")
        if self.prices is None:
            return CostEstimate(
                None,
                "USD",
                False,
                "No verified model price is present in this catalog snapshot",
                self.descriptor.catalog_version,
            )
        input_characters = len(request.prompt) + len(request.system or "")
        estimated_input_tokens = max(1, (input_characters + 3) // 4)
        micros = _token_cost(
            estimated_input_tokens,
            request.max_output_tokens,
            self.prices,
        )
        if request.research:
            micros += self.prices.search_micros_per_call * self.prices.estimated_search_calls
        return CostEstimate(
            micros,
            "USD",
            True,
            "Prompt estimate plus maximum output tokens and bounded search allowance",
            self.prices.catalog_version,
        )

    def invoke(
        self, request: ProviderRequest, context: RequestContext
    ) -> ProviderResult[TextOutput]:
        if not isinstance(request, TextRequest):
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                "This adapter accepts TextRequest only",
                provider_id=self.descriptor.provider_id,
            )
        self._guard(request.capability, context)
        response = self._send(self.build_request(request, context), context)
        payload = self._json_response(response)
        return self.parse_response(request, payload)

    generate = invoke

    def build_request(self, request: TextRequest, context: RequestContext) -> HttpRequest:
        raise NotImplementedError

    def parse_response(
        self, request: TextRequest, payload: dict[str, Any]
    ) -> ProviderResult[TextOutput]:
        raise NotImplementedError

    def _usage(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int,
        request_id: str | None,
        *,
        extra: dict[str, float] | None = None,
        billable_output_tokens: int | None = None,
    ) -> Usage:
        units: dict[str, float] = {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }
        units.update(extra or {})
        actual_cost: int | None = None
        if self.prices is not None:
            actual_cost = _token_cost(
                input_tokens,
                output_tokens if billable_output_tokens is None else billable_output_tokens,
                self.prices,
            )
            if "search_requests" in units:
                actual_cost += round(units["search_requests"] * self.prices.search_micros_per_call)
        return Usage(
            provider_id=self.descriptor.provider_id,
            model=model,
            units=units,
            actual_cost_micros=actual_cost,
            request_id=request_id,
        )


class OpenAIResponsesAdapter(BaseLLMAdapter):
    """OpenAI Responses API with stateless storage and native JSON Schema output."""

    def __init__(
        self,
        transport: HttpTransport,
        *,
        base_url: str = "https://api.openai.com/v1",
        prices: TokenPrices | None = None,
    ) -> None:
        super().__init__(transport, prices)
        self.base_url = base_url.rstrip("/")
        self.descriptor = default_catalog().get("openai")

    def build_request(self, request: TextRequest, context: RequestContext) -> HttpRequest:
        body: dict[str, Any] = {
            "model": request.model,
            "input": request.prompt,
            "max_output_tokens": request.max_output_tokens,
            "store": False,
        }
        if request.system:
            body["instructions"] = request.system
        if request.temperature is not None:
            body["temperature"] = request.temperature
        if request.json_schema is not None:
            body["text"] = {
                "format": {
                    "type": "json_schema",
                    "name": request.schema_name,
                    "schema": request.json_schema,
                    "strict": True,
                }
            }
        if request.research:
            tool: dict[str, Any] = {"type": "web_search"}
            if request.allowed_domains:
                tool["filters"] = {"allowed_domains": list(request.allowed_domains)}
            body["tools"] = [tool]
            body["include"] = ["web_search_call.action.sources"]
        return HttpRequest(
            "POST",
            f"{self.base_url}/responses",
            headers={
                "Authorization": f"Bearer {context.credential}",
                "Content-Type": "application/json",
                "Idempotency-Key": context.idempotency_key,
            },
            json_body=body,
        )

    def parse_response(
        self, request: TextRequest, payload: dict[str, Any]
    ) -> ProviderResult[TextOutput]:
        status = payload.get("status", "completed")
        if status != "completed":
            retryable = status in {"queued", "in_progress"}
            raise ProviderFailure(
                FailureCode.TRANSIENT if retryable else FailureCode.PROVIDER_ERROR,
                f"OpenAI response did not complete (status={status})",
                provider_id=self.descriptor.provider_id,
                retryable=retryable,
                request_id=_string(payload.get("id")),
            )
        text = payload.get("output_text")
        if not isinstance(text, str):
            chunks: list[str] = []
            for item in _list(payload.get("output")):
                for content in _list(item.get("content")):
                    if content.get("type") == "output_text" and isinstance(
                        content.get("text"), str
                    ):
                        chunks.append(content["text"])
                    elif content.get("type") == "refusal":
                        raise ProviderFailure(
                            FailureCode.POLICY_BLOCKED,
                            "OpenAI refused the requested content",
                            provider_id=self.descriptor.provider_id,
                            request_id=_string(payload.get("id")),
                        )
            text = "".join(chunks)
        if not text:
            raise _malformed(
                self.descriptor.provider_id, "OpenAI response contained no output text"
            )
        parsed = _parse_structured(text, request, self.descriptor.provider_id)
        usage = _dict(payload.get("usage"))
        input_tokens = _int(usage.get("input_tokens"))
        output_tokens = _int(usage.get("output_tokens"))
        search_requests = _count_type(payload, "web_search_call")
        result_usage = self._usage(
            request.model,
            input_tokens,
            output_tokens,
            _string(payload.get("id")),
            extra={"search_requests": search_requests} if search_requests else None,
        )
        return ProviderResult(
            self.descriptor.provider_id,
            _string(payload.get("model")) or request.model,
            TextOutput(text, parsed, tuple(_collect_citations(payload))),
            result_usage,
            _string(payload.get("id")),
        )


class AnthropicMessagesAdapter(BaseLLMAdapter):
    def __init__(
        self,
        transport: HttpTransport,
        *,
        base_url: str = "https://api.anthropic.com/v1",
        prices: TokenPrices | None = None,
        api_version: str = "2023-06-01",
    ) -> None:
        super().__init__(transport, prices)
        self.base_url = base_url.rstrip("/")
        self.api_version = api_version
        self.descriptor = default_catalog().get("anthropic")

    def build_request(self, request: TextRequest, context: RequestContext) -> HttpRequest:
        body: dict[str, Any] = {
            "model": request.model,
            "max_tokens": request.max_output_tokens,
            "messages": [{"role": "user", "content": request.prompt}],
        }
        if request.system:
            body["system"] = request.system
        if request.temperature is not None:
            body["temperature"] = request.temperature
        if request.json_schema is not None:
            body["output_config"] = {
                "format": {"type": "json_schema", "schema": request.json_schema}
            }
        if request.research:
            tool: dict[str, Any] = {
                "type": "web_search_20260318",
                "name": "web_search",
                "allowed_callers": ["direct"],
                "max_uses": 10,
            }
            if request.allowed_domains:
                tool["allowed_domains"] = list(request.allowed_domains)
            body["tools"] = [tool]
        return HttpRequest(
            "POST",
            f"{self.base_url}/messages",
            headers={
                "x-api-key": context.credential or "",
                "anthropic-version": self.api_version,
                "Content-Type": "application/json",
            },
            json_body=body,
        )

    def parse_response(
        self, request: TextRequest, payload: dict[str, Any]
    ) -> ProviderResult[TextOutput]:
        if payload.get("type") == "error":
            raise ProviderFailure(
                FailureCode.PROVIDER_ERROR,
                "Anthropic returned an error response",
                provider_id=self.descriptor.provider_id,
                request_id=_string(payload.get("request_id")),
            )
        text = "".join(
            block["text"]
            for block in _list(payload.get("content"))
            if block.get("type") == "text" and isinstance(block.get("text"), str)
        )
        if not text:
            raise _malformed(
                self.descriptor.provider_id, "Anthropic response contained no text block"
            )
        usage = _dict(payload.get("usage"))
        server_usage = _dict(usage.get("server_tool_use"))
        extra: dict[str, float] = {
            "cache_creation_input_tokens": _int(usage.get("cache_creation_input_tokens")),
            "cache_read_input_tokens": _int(usage.get("cache_read_input_tokens")),
            "search_requests": _int(server_usage.get("web_search_requests")),
        }
        result_usage = self._usage(
            request.model,
            _int(usage.get("input_tokens")),
            _int(usage.get("output_tokens")),
            _string(payload.get("id")),
            extra=extra,
        )
        return ProviderResult(
            self.descriptor.provider_id,
            _string(payload.get("model")) or request.model,
            TextOutput(
                text,
                _parse_structured(text, request, self.descriptor.provider_id),
                tuple(_collect_citations(payload)),
            ),
            result_usage,
            _string(payload.get("id")),
        )


class GeminiGenerateContentAdapter(BaseLLMAdapter):
    """Gemini stable-model generateContent adapter with native JSON Schema output."""

    def __init__(
        self,
        transport: HttpTransport,
        *,
        base_url: str = "https://generativelanguage.googleapis.com/v1beta",
        prices: TokenPrices | None = None,
    ) -> None:
        super().__init__(transport, prices)
        self.base_url = base_url.rstrip("/")
        self.descriptor = default_catalog().get("gemini")

    def build_request(self, request: TextRequest, context: RequestContext) -> HttpRequest:
        if request.model != GEMINI_2_5_FLASH_MODEL:
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                "Gemini structured writing supports only the reviewed gemini-2.5-flash model",
                provider_id=self.descriptor.provider_id,
            )
        generation_config: dict[str, Any] = {
            "maxOutputTokens": request.max_output_tokens,
        }
        if request.temperature is not None:
            generation_config["temperature"] = request.temperature
        if request.json_schema is not None:
            generation_config["responseMimeType"] = "application/json"
            generation_config["responseJsonSchema"] = request.json_schema
        body: dict[str, Any] = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": request.prompt}],
                }
            ],
            "generationConfig": generation_config,
        }
        if request.system:
            body["systemInstruction"] = {"parts": [{"text": request.system}]}
        if request.research:
            if request.allowed_domains:
                raise ProviderFailure(
                    FailureCode.UNSUPPORTED_CAPABILITY,
                    "Gemini generateContent does not declare web-search domain allowlisting",
                    provider_id=self.descriptor.provider_id,
                )
            body["tools"] = [{"google_search": {}}]
        return HttpRequest(
            "POST",
            f"{self.base_url}/models/{request.model}:generateContent",
            headers={
                "x-goog-api-key": context.credential or "",
                "Content-Type": "application/json",
            },
            json_body=body,
        )

    def parse_response(
        self, request: TextRequest, payload: dict[str, Any]
    ) -> ProviderResult[TextOutput]:
        prompt_feedback = _dict(payload.get("promptFeedback"))
        block_reason = _string(prompt_feedback.get("blockReason"))
        candidates = _list(payload.get("candidates"))
        if block_reason:
            raise ProviderFailure(
                FailureCode.POLICY_BLOCKED,
                f"Gemini blocked the prompt (reason={block_reason})",
                provider_id=self.descriptor.provider_id,
                request_id=_string(payload.get("responseId")),
            )
        if not candidates:
            raise _malformed(self.descriptor.provider_id, "Gemini returned no candidates")
        candidate = candidates[0]
        text = "".join(
            part["text"]
            for part in _list(_dict(candidate.get("content")).get("parts"))
            if isinstance(part.get("text"), str)
        )
        if not text:
            finish_reason = _string(candidate.get("finishReason"))
            if finish_reason in {"SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"}:
                raise ProviderFailure(
                    FailureCode.POLICY_BLOCKED,
                    f"Gemini blocked the response (reason={finish_reason})",
                    provider_id=self.descriptor.provider_id,
                    request_id=_string(payload.get("responseId")),
                )
            raise _malformed(self.descriptor.provider_id, "Gemini returned no text content")
        usage = _dict(payload.get("usageMetadata"))
        output_tokens = _int(usage.get("candidatesTokenCount"))
        thought_tokens = _int(usage.get("thoughtsTokenCount"))
        tool_use_tokens = _int(usage.get("toolUsePromptTokenCount"))
        grounding = _dict(candidate.get("groundingMetadata"))
        web_search_queries = grounding.get("webSearchQueries")
        search_requests = len(web_search_queries) if isinstance(web_search_queries, list) else 0
        if not search_requests and grounding:
            search_requests = 1
        result_usage = self._usage(
            request.model,
            _int(usage.get("promptTokenCount")),
            output_tokens,
            _string(payload.get("responseId")),
            extra={
                "thought_tokens": thought_tokens,
                "tool_use_tokens": tool_use_tokens,
                "search_requests": search_requests,
            },
            billable_output_tokens=output_tokens + thought_tokens,
        )
        return ProviderResult(
            self.descriptor.provider_id,
            _string(payload.get("modelVersion")) or request.model,
            TextOutput(
                text,
                _parse_structured(text, request, self.descriptor.provider_id),
                tuple(_collect_citations(payload)),
            ),
            result_usage,
            _string(payload.get("responseId")),
        )


class OpenAICompatibleLocalAdapter(BaseLLMAdapter):
    """Chat-Completions-compatible local endpoint with loopback-by-default policy."""

    requires_credential = False

    def __init__(
        self,
        transport: HttpTransport,
        *,
        base_url: str = "http://127.0.0.1:8080/v1",
        allow_non_loopback: bool = False,
        prices: TokenPrices | None = None,
    ) -> None:
        super().__init__(transport, prices)
        parsed = urlparse(base_url)
        if not allow_non_loopback and parsed.hostname not in {"127.0.0.1", "::1", "localhost"}:
            raise ValueError(
                "Local OpenAI-compatible endpoint must be loopback unless explicitly allowed"
            )
        self.base_url = base_url.rstrip("/")
        self.descriptor = default_catalog().get("openai-compatible-local")

    def build_request(self, request: TextRequest, context: RequestContext) -> HttpRequest:
        messages: list[dict[str, str]] = []
        if request.system:
            messages.append({"role": "system", "content": request.system})
        messages.append({"role": "user", "content": request.prompt})
        body: dict[str, Any] = {
            "model": request.model,
            "messages": messages,
            "max_tokens": request.max_output_tokens,
        }
        if request.temperature is not None:
            body["temperature"] = request.temperature
        if request.json_schema is not None:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": request.schema_name,
                    "schema": request.json_schema,
                    "strict": True,
                },
            }
        headers = {"Content-Type": "application/json"}
        if context.credential:
            headers["Authorization"] = f"Bearer {context.credential}"
        return HttpRequest(
            "POST",
            f"{self.base_url}/chat/completions",
            headers=headers,
            json_body=body,
        )

    def parse_response(
        self, request: TextRequest, payload: dict[str, Any]
    ) -> ProviderResult[TextOutput]:
        choices = _list(payload.get("choices"))
        if not choices:
            raise _malformed(self.descriptor.provider_id, "Local endpoint returned no choices")
        message = _dict(choices[0].get("message"))
        content = message.get("content")
        if isinstance(content, list):
            text = "".join(
                item.get("text", "")
                for item in content
                if isinstance(item, dict) and item.get("type") in {"text", "output_text"}
            )
        else:
            text = content if isinstance(content, str) else ""
        if not text:
            raise _malformed(self.descriptor.provider_id, "Local endpoint returned no message text")
        usage = _dict(payload.get("usage"))
        result_usage = self._usage(
            request.model,
            _int(usage.get("prompt_tokens")),
            _int(usage.get("completion_tokens")),
            _string(payload.get("id")),
        )
        return ProviderResult(
            self.descriptor.provider_id,
            _string(payload.get("model")) or request.model,
            TextOutput(text, _parse_structured(text, request, self.descriptor.provider_id)),
            result_usage,
            _string(payload.get("id")),
        )


def _token_cost(input_tokens: int, output_tokens: int, prices: TokenPrices) -> int:
    numerator = (
        input_tokens * prices.input_micros_per_million
        + output_tokens * prices.output_micros_per_million
    )
    return (numerator + 999_999) // 1_000_000


def _parse_structured(text: str, request: TextRequest, provider_id: str) -> Any | None:
    if request.json_schema is None:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ProviderFailure(
            FailureCode.MALFORMED_RESPONSE,
            "Structured-output provider returned invalid JSON",
            provider_id=provider_id,
        ) from exc


def _collect_citations(value: Any) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    def visit(item: Any) -> None:
        if isinstance(item, dict):
            kind = item.get("type")
            url = item.get("url") or item.get("uri")
            if isinstance(url, str) and (
                kind in {"url_citation", "web_search_result", "grounding_attribution"}
                or "citation" in item
                or "title" in item
            ):
                title = _string(item.get("title")) or ""
                key = (url, title)
                if key not in seen:
                    citations.append({"url": url, "title": title, "type": kind or "citation"})
                    seen.add(key)
            for child in item.values():
                visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)

    visit(value)
    return citations


def _count_type(value: Any, expected: str) -> int:
    if isinstance(value, dict):
        return int(value.get("type") == expected) + sum(
            _count_type(child, expected) for child in value.values()
        )
    if isinstance(value, list):
        return sum(_count_type(child, expected) for child in value)
    return 0


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _int(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _string(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _malformed(provider_id: str, message: str) -> ProviderFailure:
    return ProviderFailure(
        FailureCode.MALFORMED_RESPONSE,
        message,
        provider_id=provider_id,
    )
