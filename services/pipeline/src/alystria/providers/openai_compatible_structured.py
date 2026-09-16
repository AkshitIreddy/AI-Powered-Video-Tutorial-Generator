"""Strict, model-scoped chat adapters for reviewed OpenAI-compatible clouds.

OpenAI compatibility establishes an HTTP shape, not capability parity. Each
entry below pins one provider host and one model whose current provider metadata
explicitly declares JSON Schema output. Unknown models fail before transport.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, replace
from typing import Any

from .errors import FailureCode, ProviderFailure, failure_from_http
from .llm import BaseLLMAdapter, TokenPrices
from .transport import HttpRequest, HttpResponse, HttpTransport
from .types import (
    Capability,
    CostEstimate,
    DataBoundary,
    DataPolicy,
    ProviderDescriptor,
    ProviderRequest,
    ProviderResult,
    RequestContext,
    RetentionMode,
    TextOutput,
    TextRequest,
    Usage,
)

GROQ_STRUCTURED_MODEL = "openai/gpt-oss-20b"
GROQ_STRUCTURED_120B_MODEL = "openai/gpt-oss-120b"
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

_GROQ_MODEL_SPECS: dict[str, StructuredCloudSpec] = {
    GROQ_STRUCTURED_MODEL: STRUCTURED_CLOUD_SPECS["groq"],
    GROQ_STRUCTURED_120B_MODEL: StructuredCloudSpec(
        provider_id="groq",
        display_name="Groq",
        base_url="https://api.groq.com/openai/v1",
        model=GROQ_STRUCTURED_120B_MODEL,
        docs_url="https://console.groq.com/docs/structured-outputs",
        prices=TokenPrices("groq-2026-09-05", 150_000, 600_000),
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

    def estimate(self, request: ProviderRequest) -> CostEstimate:
        if not isinstance(request, TextRequest):
            return super().estimate(request)
        body = self._request_body(request)
        # The submitted JSON body contains the projected schema and message
        # framing omitted by BaseLLMAdapter's prompt-only heuristic. One token
        # per UTF-8 byte plus fixed chat framing is a conservative upper bound.
        input_token_bound = len(
            json.dumps(
                body,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
        ) + 256
        micros = _bounded_token_cost(
            input_token_bound,
            request.max_output_tokens,
            self.spec.prices,
        )
        return CostEstimate(
            micros,
            "USD",
            True,
            "Serialized structured request byte bound plus maximum output tokens",
            self.spec.prices.catalog_version,
        )

    def build_request(self, request: TextRequest, context: RequestContext) -> HttpRequest:
        body = self._request_body(request)
        return HttpRequest(
            "POST",
            f"{self.spec.base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {context.credential or ''}",
                "Content-Type": "application/json",
            },
            json_body=body,
        )

    def _request_body(self, request: TextRequest) -> dict[str, Any]:
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
        }
        if self.spec.provider_id == "groq":
            # Groq deprecates max_tokens for chat completions. GPT-OSS defaults
            # to medium reasoning, which competes with a long structured
            # document for the same completion allowance. Low remains a
            # supported reasoning mode while reserving more room for JSON.
            body["max_completion_tokens"] = request.max_output_tokens
            body["reasoning_effort"] = "low"
        else:
            body["max_tokens"] = request.max_output_tokens
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
        return body

    def invoke(
        self, request: ProviderRequest, context: RequestContext
    ) -> ProviderResult[TextOutput]:
        """Make one bounded Groq correction for locally enforced schema bounds.

        Groq's supported schema subset omits array/string/numeric bounds, so
        Alystria validates those constraints after receipt. A single complete
        regeneration with the exact failing schema path is permitted for that
        narrow mismatch. HTTP failures, structural-schema failures, other
        providers, and a second invalid response remain terminal.
        """

        try:
            return super().invoke(request, context)
        except ProviderFailure as first_failure:
            if not isinstance(request, TextRequest) or not _repairable_groq_bounds_failure(
                self.spec.provider_id, request, first_failure
            ):
                raise

            repair_request = _groq_bounds_repair_request(request, first_failure)
            first_usage = _usage_from_failure(first_failure)
            repair_context = replace(
                context,
                idempotency_key=f"{context.idempotency_key}:schema-repair-1",
            )
            try:
                repaired = super().invoke(repair_request, repair_context)
            except ProviderFailure as repair_failure:
                repair_failure_usage = _usage_from_failure(repair_failure)
                combined_failure_usage = _combined_usage(first_usage, repair_failure_usage)
                repair_failure.details = {
                    **repair_failure.details,
                    "repairAttempted": True,
                    "attemptCount": 2,
                    "billableUsage": _usage_details(
                        combined_failure_usage,
                        complete=(
                            _usage_is_complete(first_usage)
                            and _usage_is_complete(repair_failure_usage)
                        ),
                    ),
                }
                raise
            if not (
                _usage_is_complete(first_usage)
                and _usage_is_complete(repaired.usage)
            ):
                missing_usage = self._malformed(
                    "Structured-output provider omitted billable token usage"
                )
                missing_usage.request_id = repaired.raw_id
                missing_usage.details = {
                    "repairAttempted": True,
                    "attemptCount": 2,
                    "billableUsage": _usage_details(
                        _combined_usage(first_usage, repaired.usage),
                        complete=False,
                    ),
                }
                raise missing_usage from first_failure
            return replace(
                repaired,
                usage=_combined_usage(first_usage, repaired.usage),
                correction_attempts=1,
            )

    generate = invoke

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
            "providerInvocationAttempted": True,
            "billableUsage": {
                "model": self.spec.model,
                "inputTokens": None,
                "outputTokens": None,
                "actualCostMicros": None,
                "usageComplete": False,
            },
        }
        raise failure

    def parse_response(
        self, request: TextRequest, payload: dict[str, Any]
    ) -> ProviderResult[TextOutput]:
        usage = self._usage_from_payload(payload, request.model)
        try:
            return self._parse_response_payload(request, payload, usage)
        except ProviderFailure as failure:
            failure.request_id = failure.request_id or usage.request_id
            failure.details = {
                **failure.details,
                "providerInvocationAttempted": True,
                "billableUsage": _usage_details(usage),
            }
            raise

    def _parse_response_payload(
        self,
        request: TextRequest,
        payload: dict[str, Any],
        usage: Usage,
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
                failure.details = {
                    "schemaKeyword": exc.keyword,
                    "schemaPath": exc.path,
                }
                raise failure from exc
        return ProviderResult(
            self.spec.provider_id,
            _string(payload.get("model")) or request.model,
            TextOutput(content, parsed),
            usage,
            usage.request_id,
        )

    def _usage_from_payload(self, payload: dict[str, Any], model: str) -> Usage:
        usage = payload.get("usage")
        if not isinstance(usage, dict):
            return Usage(
                self.spec.provider_id,
                model,
                {},
                None,
                request_id=_string(payload.get("id")),
            )
        input_tokens = _optional_integer(usage.get("prompt_tokens"))
        output_tokens = _optional_integer(usage.get("completion_tokens"))
        if input_tokens is None or output_tokens is None:
            return Usage(
                self.spec.provider_id,
                model,
                {},
                None,
                request_id=_string(payload.get("id")),
            )
        return self._usage(
            model,
            input_tokens,
            output_tokens,
            _string(payload.get("id")),
        )

    def _malformed(self, message: str) -> ProviderFailure:
        return ProviderFailure(
            FailureCode.MALFORMED_RESPONSE,
            message,
            provider_id=self.spec.provider_id,
        )


def launch_structured_cloud_adapter(
    provider_id: str,
    transport: HttpTransport,
    *,
    model: str | None = None,
) -> OpenAICompatibleStructuredAdapter:
    try:
        default_spec = STRUCTURED_CLOUD_SPECS[provider_id]
    except KeyError as exc:
        raise ValueError(
            f"provider {provider_id!r} has no reviewed structured-cloud adapter"
        ) from exc
    if model is None or model == default_spec.model:
        spec = default_spec
    elif provider_id == "groq":
        try:
            spec = _GROQ_MODEL_SPECS[model]
        except KeyError as exc:
            raise ValueError(
                f"provider {provider_id!r} model {model!r} is not reviewed for structured output"
            ) from exc
    else:
        raise ValueError(
            f"provider {provider_id!r} model {model!r} is not reviewed for structured output"
        )
    return OpenAICompatibleStructuredAdapter(transport, spec)


def _bounded_token_cost(
    input_tokens: int,
    output_tokens: int,
    prices: TokenPrices,
) -> int:
    numerator = (
        input_tokens * prices.input_micros_per_million
        + output_tokens * prices.output_micros_per_million
    )
    return (numerator + 999_999) // 1_000_000


def _repairable_groq_bounds_failure(
    provider_id: str,
    request: TextRequest,
    failure: ProviderFailure,
) -> bool:
    keyword = failure.details.get("schemaKeyword")
    path = failure.details.get("schemaPath")
    return (
        provider_id == "groq"
        and request.json_schema is not None
        and request.max_correction_attempts > 0
        and failure.code is FailureCode.MALFORMED_RESPONSE
        and keyword in _ALYSTRIA_LOCALLY_ENFORCED_SCHEMA_KEYS
        and isinstance(path, str)
        and 1 <= len(path) <= 256
    )


def _schema_contains_local_bounds(value: Any) -> bool:
    if isinstance(value, dict):
        return any(key in _ALYSTRIA_LOCALLY_ENFORCED_SCHEMA_KEYS for key in value) or any(
            _schema_contains_local_bounds(child) for child in value.values()
        )
    if isinstance(value, list):
        return any(_schema_contains_local_bounds(child) for child in value)
    return False


def _groq_bounds_repair_request(
    request: TextRequest, failure: ProviderFailure
) -> TextRequest:
    diagnostic = {
        "path": str(failure.details["schemaPath"]),
        "keyword": str(failure.details["schemaKeyword"]),
    }
    prompt = json.dumps(
        {
            "task": "Regenerate the complete structured response once.",
            "schemaViolation": diagnostic,
            "requirements": [
                "Return the complete response, not a patch or explanation.",
                "Correct the identified local schema-bound violation.",
                "Keep every other field within the same supplied schema and request.",
            ],
            "originalRequest": request.prompt,
        },
        ensure_ascii=False,
    )
    system_suffix = (
        " This is the single permitted schema-bound correction. Return only a complete "
        "response matching the original schema."
    )
    return replace(
        request,
        prompt=prompt,
        system=(request.system or "") + system_suffix,
        temperature=0.1,
        max_correction_attempts=0,
    )


def _usage_from_failure(failure: ProviderFailure) -> Usage:
    value = failure.details.get("billableUsage")
    usage = value if isinstance(value, dict) else {}
    input_tokens = _optional_integer(usage.get("inputTokens"))
    output_tokens = _optional_integer(usage.get("outputTokens"))
    units = {
        key: float(value)
        for key, value in (
            ("input_tokens", input_tokens),
            ("output_tokens", output_tokens),
        )
        if value is not None
    }
    return Usage(
        failure.provider_id or "groq",
        _string(usage.get("model")) or GROQ_STRUCTURED_MODEL,
        units,
        (
            usage.get("actualCostMicros")
            if isinstance(usage.get("actualCostMicros"), int)
            and not isinstance(usage.get("actualCostMicros"), bool)
            else None
        ),
        request_id=failure.request_id,
    )


def _combined_usage(first: Usage, repair: Usage) -> Usage:
    keys = set(first.units) | set(repair.units)
    reported_costs = tuple(
        cost
        for cost in (first.actual_cost_micros, repair.actual_cost_micros)
        if cost is not None
    )
    actual_cost = sum(reported_costs) if reported_costs else None
    return Usage(
        repair.provider_id,
        repair.model,
        {
            key: float(first.units.get(key, 0)) + float(repair.units.get(key, 0))
            for key in sorted(keys)
        },
        actual_cost,
        repair.currency,
        repair.request_id,
    )


def _usage_is_complete(usage: Usage) -> bool:
    return (
        usage.actual_cost_micros is not None
        and "input_tokens" in usage.units
        and "output_tokens" in usage.units
    )


def _usage_details(
    usage: Usage,
    *,
    complete: bool | None = None,
) -> dict[str, bool | int | str | None]:
    return {
        "model": usage.model,
        "inputTokens": (
            round(float(usage.units["input_tokens"]))
            if "input_tokens" in usage.units
            else None
        ),
        "outputTokens": (
            round(float(usage.units["output_tokens"]))
            if "output_tokens" in usage.units
            else None
        ),
        "actualCostMicros": usage.actual_cost_micros,
        "usageComplete": _usage_is_complete(usage) if complete is None else complete,
    }


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


def _optional_integer(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


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
