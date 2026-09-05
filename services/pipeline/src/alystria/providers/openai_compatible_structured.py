"""Strict, model-scoped chat adapters for reviewed OpenAI-compatible clouds.

OpenAI compatibility establishes an HTTP shape, not capability parity. Each
entry below pins one provider host and one model whose current provider metadata
explicitly declares JSON Schema output. Unknown models fail before transport.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any

from .errors import FailureCode, ProviderFailure, failure_from_http
from .llm import BaseLLMAdapter, TokenPrices
from .transport import HttpRequest, HttpResponse, HttpTransport
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

_GROQ_STRUCTURAL_SCHEMA_KEYS = frozenset(
    {
        "$defs",
        "$ref",
        "additionalProperties",
        "anyOf",
        "description",
        "enum",
        "items",
        "properties",
        "required",
        "title",
        "type",
    }
)
_ALYSTRIA_LOCALLY_ENFORCED_SCHEMA_KEYS = frozenset(
    {
        "maxItems",
        "maxLength",
        "maximum",
        "minItems",
        "minLength",
        "minimum",
    }
)
_LOCALLY_VALIDATED_SCHEMA_KEYS = (
    _GROQ_STRUCTURAL_SCHEMA_KEYS | _ALYSTRIA_LOCALLY_ENFORCED_SCHEMA_KEYS
)


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
            _assert_supported_schema(request.json_schema, provider_id=self.spec.provider_id)
            schema = request.json_schema
            if self.spec.provider_id == "groq":
                schema = _groq_structural_schema(schema, provider_id=self.spec.provider_id)
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": request.schema_name,
                    "strict": True,
                    "schema": schema,
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

    def _json_response(self, response: HttpResponse) -> dict[str, Any]:
        if 200 <= response.status < 300:
            return super()._json_response(response)
        request_id = _header(response.headers, "x-request-id")
        error: dict[str, Any] = {}
        try:
            payload: Any = response.json()
            if isinstance(payload, dict):
                candidate = payload.get("error")
                if isinstance(candidate, dict):
                    error = candidate
        except (UnicodeDecodeError, ValueError):
            pass
        provider_code = _safe_error_atom(error.get("code"))
        provider_type = _safe_error_atom(error.get("type"))
        provider_param = _safe_error_atom(error.get("param"))
        failure = failure_from_http(
            self.spec.provider_id,
            response.status,
            request_id=request_id,
            message=(
                f"{self.spec.display_name} rejected generated JSON against the requested schema"
                if provider_code == "json_validate_failed"
                else None
            ),
        )
        failure.details = {
            "providerErrorCode": provider_code,
            "providerErrorType": provider_type,
            "providerErrorParam": provider_param,
            "failedGenerationPresent": "failed_generation" in error,
        }
        raise failure

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
                parsed = json.loads(content, parse_constant=_reject_non_finite_constant)
            except (json.JSONDecodeError, ValueError) as exc:
                raise self._malformed("Structured-output provider returned invalid JSON") from exc
            try:
                _validate_schema_subset(parsed, request.json_schema)
            except _SchemaViolation as exc:
                failure = self._malformed(
                    "Structured-output provider returned JSON outside the requested schema"
                )
                failure.details = {"schemaKeyword": exc.keyword, "schemaPath": exc.path}
                raise failure from exc
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
        raise ValueError(
            f"provider {provider_id!r} has no reviewed structured-cloud adapter"
        ) from exc
    return OpenAICompatibleStructuredAdapter(transport, spec)


def _groq_structural_schema(value: Any, *, provider_id: str) -> Any:
    """Keep Groq's constrained structural subset; Alystria validates bounds locally."""

    if isinstance(value, list):
        return [_groq_structural_schema(item, provider_id=provider_id) for item in value]
    if not isinstance(value, dict):
        return value
    projected: dict[str, Any] = {}
    constraint_note = _constraint_description(value)
    for key, child in value.items():
        if key in _ALYSTRIA_LOCALLY_ENFORCED_SCHEMA_KEYS:
            continue
        if key not in _GROQ_STRUCTURAL_SCHEMA_KEYS:
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                "Groq structured output received an unreviewed JSON Schema keyword",
                provider_id=provider_id,
                details={"schemaKeyword": _safe_error_atom(key) or "unrecognized"},
            )
        if key in {"properties", "$defs"}:
            if not isinstance(child, dict):
                raise ProviderFailure(
                    FailureCode.INVALID_REQUEST,
                    f"Groq structured output requires {key} to be an object",
                    provider_id=provider_id,
                )
            projected[key] = {
                name: _groq_structural_schema(schema, provider_id=provider_id)
                for name, schema in child.items()
            }
        else:
            projected[key] = _groq_structural_schema(child, provider_id=provider_id)
    if constraint_note:
        existing = projected.get("description")
        projected["description"] = (
            f"{existing.rstrip()} {constraint_note}"
            if isinstance(existing, str)
            else constraint_note
        )
    return projected


def _assert_supported_schema(value: Any, *, provider_id: str) -> None:
    if isinstance(value, list):
        for item in value:
            _assert_supported_schema(item, provider_id=provider_id)
        return
    if not isinstance(value, dict):
        return
    for key, child in value.items():
        if key not in _LOCALLY_VALIDATED_SCHEMA_KEYS:
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                "Structured output received an unreviewed JSON Schema keyword",
                provider_id=provider_id,
                details={"schemaKeyword": _safe_error_atom(key) or "unrecognized"},
            )
        if key in {"properties", "$defs"}:
            if not isinstance(child, dict):
                raise ProviderFailure(
                    FailureCode.INVALID_REQUEST,
                    f"Structured output requires {key} to be an object",
                    provider_id=provider_id,
                )
            for schema in child.values():
                _assert_supported_schema(schema, provider_id=provider_id)
        else:
            _assert_supported_schema(child, provider_id=provider_id)


def _constraint_description(schema: dict[str, Any]) -> str:
    notes: list[str] = []
    if "minItems" in schema or "maxItems" in schema:
        minimum = schema.get("minItems")
        maximum = schema.get("maxItems")
        if isinstance(minimum, int) and isinstance(maximum, int):
            notes.append(f"Return between {minimum} and {maximum} items.")
        elif isinstance(minimum, int):
            notes.append(f"Return at least {minimum} items.")
        elif isinstance(maximum, int):
            notes.append(f"Return at most {maximum} items.")
    if "minLength" in schema or "maxLength" in schema:
        minimum = schema.get("minLength")
        maximum = schema.get("maxLength")
        if isinstance(minimum, int) and isinstance(maximum, int):
            notes.append(f"Use between {minimum} and {maximum} characters.")
        elif isinstance(minimum, int):
            notes.append(f"Use at least {minimum} characters.")
        elif isinstance(maximum, int):
            notes.append(f"Use at most {maximum} characters.")
    if isinstance(schema.get("minimum"), int | float):
        notes.append(f"Use a value of at least {schema['minimum']}.")
    if isinstance(schema.get("maximum"), int | float):
        notes.append(f"Use a value of at most {schema['maximum']}.")
    return " ".join(notes)


class _SchemaViolation(ValueError):
    def __init__(self, path: str, keyword: str) -> None:
        super().__init__(f"{path} violates {keyword}")
        self.path = path
        self.keyword = keyword


def _validate_schema_subset(
    value: Any,
    schema: Any,
    *,
    path: str = "$",
    root: dict[str, Any] | None = None,
) -> None:
    if not isinstance(schema, dict):
        raise _SchemaViolation(path, "schema")
    if isinstance(value, float) and not math.isfinite(value):
        raise _SchemaViolation(path, "type")
    root = schema if root is None else root
    reference = schema.get("$ref")
    if isinstance(reference, str):
        target: Any = root
        if not reference.startswith("#/"):
            raise _SchemaViolation(path, "$ref")
        for part in reference[2:].split("/"):
            if not isinstance(target, dict) or part not in target:
                raise _SchemaViolation(path, "$ref")
            target = target[part]
        _validate_schema_subset(value, target, path=path, root=root)
        return
    any_of = schema.get("anyOf")
    if isinstance(any_of, list):
        for option in any_of:
            try:
                _validate_schema_subset(value, option, path=path, root=root)
                break
            except _SchemaViolation:
                continue
        else:
            raise _SchemaViolation(path, "anyOf")
    expected = schema.get("type")
    if expected is not None and not _matches_schema_type(value, expected):
        raise _SchemaViolation(path, "type")
    enum = schema.get("enum")
    if isinstance(enum, list) and value not in enum:
        raise _SchemaViolation(path, "enum")
    if isinstance(value, dict):
        properties = schema.get("properties")
        if not isinstance(properties, dict):
            properties = {}
        required = schema.get("required")
        if isinstance(required, list):
            for key in required:
                if isinstance(key, str) and key not in value:
                    raise _SchemaViolation(f"{path}.{key}", "required")
        if schema.get("additionalProperties") is False:
            unexpected = next((key for key in value if key not in properties), None)
            if unexpected is not None:
                raise _SchemaViolation(f"{path}.{unexpected}", "additionalProperties")
        for key, child in value.items():
            child_schema = properties.get(key)
            if isinstance(child_schema, dict):
                _validate_schema_subset(child, child_schema, path=f"{path}.{key}", root=root)
    elif isinstance(value, list):
        minimum = schema.get("minItems")
        maximum = schema.get("maxItems")
        if isinstance(minimum, int) and len(value) < minimum:
            raise _SchemaViolation(path, "minItems")
        if isinstance(maximum, int) and len(value) > maximum:
            raise _SchemaViolation(path, "maxItems")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, child in enumerate(value):
                _validate_schema_subset(child, item_schema, path=f"{path}[{index}]", root=root)
    elif isinstance(value, str):
        minimum = schema.get("minLength")
        maximum = schema.get("maxLength")
        if isinstance(minimum, int) and len(value) < minimum:
            raise _SchemaViolation(path, "minLength")
        if isinstance(maximum, int) and len(value) > maximum:
            raise _SchemaViolation(path, "maxLength")
    elif isinstance(value, int | float) and not isinstance(value, bool):
        minimum = schema.get("minimum")
        maximum = schema.get("maximum")
        if isinstance(minimum, int | float) and value < minimum:
            raise _SchemaViolation(path, "minimum")
        if isinstance(maximum, int | float) and value > maximum:
            raise _SchemaViolation(path, "maximum")


def _matches_schema_type(value: Any, expected: Any) -> bool:
    if isinstance(expected, list):
        return any(_matches_schema_type(value, item) for item in expected)
    return {
        "array": isinstance(value, list),
        "boolean": isinstance(value, bool),
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "null": value is None,
        "number": isinstance(value, int | float)
        and not isinstance(value, bool)
        and math.isfinite(float(value)),
        "object": isinstance(value, dict),
        "string": isinstance(value, str),
    }.get(expected, False)


def _integer(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _string(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _safe_error_atom(value: object) -> str | None:
    if not isinstance(value, str) or not value or len(value) > 80:
        return None
    return value if all(character.isalnum() or character in "._-" for character in value) else None


def _header(headers: dict[str, str], name: str) -> str | None:
    lowered = name.lower()
    return next((value for key, value in headers.items() if key.lower() == lowered), None)


def _reject_non_finite_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON constant {value!r}")
