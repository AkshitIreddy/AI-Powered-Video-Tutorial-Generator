"""Strict, model-scoped chat adapters for reviewed OpenAI-compatible clouds.

OpenAI compatibility establishes an HTTP shape, not capability parity. Each
entry below pins one provider host and one model whose current provider metadata
explicitly declares JSON Schema output. Unknown models fail before transport.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from .errors import FailureCode, ProviderFailure
from .llm import BaseLLMAdapter, TokenPrices
from .transport import HttpRequest, HttpTransport
from .types import (
    Capability,
    DataBoundary,
    DataPolicy,
    ProviderDescriptor,
    ProviderResult,
    RequestContext,
    RetentionMode,
    TextOutput,
    TextRequest,
)

GROQ_STRUCTURED_MODEL = "openai/gpt-oss-20b"
MISTRAL_STRUCTURED_MODEL = "mistral-small-2603"
OPENROUTER_STRUCTURED_MODEL = "z-ai/glm-5.2:free"


@dataclass(frozen=True, slots=True)
class StructuredCloudSpec:
    provider_id: str
    display_name: str
    base_url: str
    model: str
    docs_url: str
    prices: TokenPrices
    require_parameter_routing: bool = False


STRUCTURED_CLOUD_SPECS: dict[str, StructuredCloudSpec] = {
    "groq": StructuredCloudSpec(
        provider_id="groq",
        display_name="Groq",
        base_url="https://api.groq.com/openai/v1",
        model=GROQ_STRUCTURED_MODEL,
        docs_url="https://console.groq.com/docs/structured-outputs",
        prices=TokenPrices("groq-2026-09-05", 75_000, 300_000),
    ),
    "mistral": StructuredCloudSpec(
        provider_id="mistral",
        display_name="Mistral AI",
        base_url="https://api.mistral.ai/v1",
        model=MISTRAL_STRUCTURED_MODEL,
        docs_url="https://docs.mistral.ai/api/endpoint/chat",
        prices=TokenPrices("mistral-2026-09-05", 150_000, 600_000),
    ),
    "openrouter": StructuredCloudSpec(
        provider_id="openrouter",
        display_name="OpenRouter",
        base_url="https://openrouter.ai/api/v1",
        model=OPENROUTER_STRUCTURED_MODEL,
        docs_url="https://openrouter.ai/docs/guides/features/structured-outputs",
        prices=TokenPrices("openrouter-model-list-2026-09-05", 0, 0),
        require_parameter_routing=True,
    ),
}


class OpenAICompatibleStructuredAdapter(BaseLLMAdapter):
    """One reviewed JSON-Schema model on one fixed cloud provider host."""

    def __init__(self, transport: HttpTransport, spec: StructuredCloudSpec) -> None:
        super().__init__(transport, spec.prices)
        self.spec = spec
        self.descriptor = ProviderDescriptor(
            provider_id=spec.provider_id,
            display_name=spec.display_name,
            capabilities=frozenset({Capability.LLM_TEXT, Capability.LLM_STRUCTURED}),
            data_policy=DataPolicy(
                boundary=DataBoundary.CLOUD,
                retention=RetentionMode.PROVIDER_DEFAULT,
                regions=("provider-managed",),
                stores_by_default=None,
                training_use=None,
                notes="Review current provider data controls before project approval.",
            ),
            catalog_version="2026.09.05.2",
            last_verified_at="2026-09-05",
            docs_url=spec.docs_url,
            models=(spec.model,),
        )

    def build_request(self, request: TextRequest, context: RequestContext) -> HttpRequest:
        if request.research:
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                f"{self.spec.display_name} launch support does not include web research",
                provider_id=self.spec.provider_id,
            )
        if request.model != self.spec.model:
            raise ProviderFailure(
                FailureCode.INVALID_REQUEST,
                f"{self.spec.display_name} model is not in the reviewed structured-output allowlist",
                provider_id=self.spec.provider_id,
            )
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
                    "strict": True,
                    "schema": request.json_schema,
                },
            }
            if self.spec.require_parameter_routing:
                # OpenRouter may choose between upstream providers. This keeps
                # only routes that accept the requested JSON-Schema parameter.
                body["provider"] = {"require_parameters": True}
        return HttpRequest(
            "POST",
            f"{self.spec.base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {context.credential or ''}",
                "Content-Type": "application/json",
            },
            json_body=body,
        )

    def parse_response(
        self, request: TextRequest, payload: dict[str, Any]
    ) -> ProviderResult[TextOutput]:
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise self._malformed("Provider returned no completion choice")
        message = choices[0].get("message")
        if not isinstance(message, dict):
            raise self._malformed("Provider returned no completion message")
        if message.get("refusal"):
            raise ProviderFailure(
                FailureCode.PROVIDER_ERROR,
                "Provider refused the structured-output request",
                provider_id=self.spec.provider_id,
                request_id=_string(payload.get("id")),
            )
        content = message.get("content")
        if not isinstance(content, str) or not content:
            raise self._malformed("Provider returned no completion text")
        parsed: Any | None = None
        if request.json_schema is not None:
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError as exc:
                raise self._malformed("Structured-output provider returned invalid JSON") from exc
        usage = payload.get("usage")
        if not isinstance(usage, dict):
            usage = {}
        request_id = _string(payload.get("id"))
        result_usage = self._usage(
            request.model,
            _integer(usage.get("prompt_tokens")),
            _integer(usage.get("completion_tokens")),
            request_id,
        )
        return ProviderResult(
            self.spec.provider_id,
            _string(payload.get("model")) or request.model,
            TextOutput(content, parsed),
            result_usage,
            request_id,
        )

    def _malformed(self, message: str) -> ProviderFailure:
        return ProviderFailure(
            FailureCode.MALFORMED_RESPONSE,
            message,
            provider_id=self.spec.provider_id,
        )


def launch_structured_cloud_adapter(
    provider_id: str, transport: HttpTransport
) -> OpenAICompatibleStructuredAdapter:
    try:
        spec = STRUCTURED_CLOUD_SPECS[provider_id]
    except KeyError as exc:
        raise ValueError(f"provider {provider_id!r} has no reviewed structured-cloud adapter") from exc
    return OpenAICompatibleStructuredAdapter(transport, spec)


def _integer(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _string(value: object) -> str | None:
    return value if isinstance(value, str) else None
