"""NVIDIA-hosted NIM preview adapter.

The hosted catalog is a development and testing service, not a production
entitlement. Alystria therefore uses one keyring credential, fixed NVIDIA
hosts, exact visual endpoint allowlists, zero-dollar preview budgeting, and no
fallback. Model access and current per-model rate limits still have to be
confirmed in build.nvidia.com when a model is selected.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import wave
from dataclasses import dataclass, replace
from typing import Any

from ..security.privacy import DataClassification
from .base import GuardedAdapter
from .catalog import default_catalog
from .errors import FailureCode, ProviderFailure, failure_from_http
from .transport import HttpRequest, HttpResponse, HttpTransport
from .types import (
    Capability,
    CostEstimate,
    EmbeddingEncoding,
    EmbeddingOutput,
    EmbeddingRequest,
    ImageRequest,
    MediaAsset,
    MediaOutput,
    MotionRequest,
    ProviderRequest,
    ProviderResult,
    RequestContext,
    RerankOutput,
    RerankRequest,
    RerankScore,
    SpeechRequest,
    TextOutput,
    TextRequest,
    Usage,
    VisionLanguageRequest,
)

NVIDIA_CHAT_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions"
NVIDIA_EMBEDDING_ENDPOINT = "https://integrate.api.nvidia.com/v1/embeddings"
NVIDIA_RERANK_ENDPOINT = "https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking"
NVIDIA_MAGPIE_ENDPOINT = (
    "https://877104f7-e885-42b9-8de8-f6e4c6303969.invocation.api.nvcf.nvidia.com"
    "/v1/audio/synthesize"
)

NVIDIA_CHAT_MODELS = frozenset({"openai/gpt-oss-20b"})
NVIDIA_VLM_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
NVIDIA_VLM_MODELS = frozenset({NVIDIA_VLM_MODEL})
NVIDIA_RETIRED_VLM_MODELS = frozenset({"nvidia/nemotron-nano-12b-v2-vl"})
NVIDIA_EMBEDDING_MODELS = frozenset({"nvidia/nemotron-3-embed-1b"})
NVIDIA_RETIRED_EMBEDDING_MODELS = frozenset({"nvidia/nv-embed-v1"})
NVIDIA_RERANK_MODELS = frozenset({"nvidia/nv-rerankqa-mistral-4b-v3"})
NVIDIA_MAGPIE_MODEL = "nvidia/magpie-tts-multilingual"
NVIDIA_MAGPIE_MODELS = frozenset({NVIDIA_MAGPIE_MODEL})
NVIDIA_MAGPIE_VOICE = "Magpie-Multilingual.EN-US.Aria"


@dataclass(frozen=True, slots=True)
class NvidiaVisualEndpoint:
    model: str
    capability: Capability
    endpoint: str
    active: bool
    note: str


# Absolute URLs are copied from NVIDIA's per-model API reference. A model may
# never supply, suffix, or otherwise influence an endpoint path at runtime.
NVIDIA_VISUAL_ENDPOINTS: dict[str, NvidiaVisualEndpoint] = {
    "black-forest-labs/flux.2-klein-4b": NvidiaVisualEndpoint(
        "black-forest-labs/flux.2-klein-4b",
        Capability.IMAGE_GENERATION,
        "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b",
        True,
        "Availability and trial limits must be confirmed on the model page.",
    ),
    # Kept as a tombstone so persisted projects fail clearly instead of being
    # silently redirected to another vendor/model. NVIDIA currently marks it
    # deprecated, so it can never be enabled by this catalog snapshot.
    "stabilityai/stable-video-diffusion": NvidiaVisualEndpoint(
        "stabilityai/stable-video-diffusion",
        Capability.MOTION,
        "https://ai.api.nvidia.com/v1/genai/stabilityai/stable-video-diffusion",
        False,
        "Deprecated by NVIDIA; select an explicitly approved active model instead.",
    ),
}

# Model-license facts are exact allowlisted metadata, not inferred from the
# provider. FLUX.2 Klein 4B is published by Black Forest Labs under Apache-2.0;
# NVIDIA's API terms still apply to the hosted preview service itself.
NVIDIA_VISUAL_LICENSES = {
    "black-forest-labs/flux.2-klein-4b": "Apache-2.0",
}


class NvidiaNimAdapter(GuardedAdapter):
    """Typed adapter for one NVIDIA Developer API key and approved model routes."""

    def __init__(
        self,
        transport: HttpTransport,
        *,
        configured_visual_models: frozenset[str] = frozenset(),
        configured_rerank_models: frozenset[str] = frozenset(),
        configured_tts_models: frozenset[str] = frozenset(),
    ) -> None:
        self.transport = transport
        self.configured_visual_models = configured_visual_models
        if not configured_rerank_models <= NVIDIA_RERANK_MODELS:
            raise ValueError("NVIDIA reranking model is not in the endpoint allowlist")
        self.configured_rerank_models = configured_rerank_models
        if not configured_tts_models <= NVIDIA_MAGPIE_MODELS:
            raise ValueError("NVIDIA TTS model is not in the endpoint allowlist")
        self.configured_tts_models = configured_tts_models
        visual_capabilities: set[Capability] = set()
        for model in configured_visual_models:
            endpoint = NVIDIA_VISUAL_ENDPOINTS.get(model)
            if endpoint is None:
                raise ValueError(f"NVIDIA visual model {model!r} is not in the endpoint allowlist")
            if not endpoint.active:
                raise ValueError(f"NVIDIA visual model {model!r} is unavailable: {endpoint.note}")
            visual_capabilities.add(endpoint.capability)
        descriptor = default_catalog().get("nvidia-nim")
        self.descriptor = replace(
            descriptor,
            capabilities=frozenset(
                {
                    Capability.LLM_TEXT,
                    Capability.LLM_STRUCTURED,
                    Capability.VISION_LANGUAGE,
                    Capability.EMBEDDING,
                    *({Capability.RERANKING} if configured_rerank_models else set()),
                    *({Capability.TTS} if configured_tts_models else set()),
                    *visual_capabilities,
                }
            ),
        )

    def estimate(self, request: ProviderRequest) -> CostEstimate:
        del request
        return CostEstimate(
            0,
            "USD",
            True,
            "No-cost NVIDIA hosted Developer Preview; quota/rate limits remain model-specific",
            self.descriptor.catalog_version,
        )

    def invoke(self, request: ProviderRequest, context: RequestContext) -> ProviderResult[Any]:
        built = self.build_request(request, context)
        response = self._send(built, context)
        if isinstance(request, SpeechRequest):
            return self._parse_speech(request, response)
        payload = self._json_response(response)
        if isinstance(request, (TextRequest, VisionLanguageRequest)):
            return self._parse_chat(request, payload)
        if isinstance(request, EmbeddingRequest):
            return self._parse_embeddings(request, payload)
        if isinstance(request, RerankRequest):
            return self._parse_rerank(request, payload)
        if isinstance(request, (ImageRequest, MotionRequest)):
            return self._parse_visual(request, payload)
        raise ProviderFailure(
            FailureCode.UNSUPPORTED_CAPABILITY,
            "NVIDIA NIM does not implement this request contract",
            provider_id=self.descriptor.provider_id,
        )

    def build_request(self, request: ProviderRequest, context: RequestContext) -> HttpRequest:
        self._guard(request.capability, context)
        self._guard_hosted_preview(context)
        self._guard_budget(request, context)
        headers = {
            "Authorization": f"Bearer {context.credential}",
            "Content-Type": "application/json",
        }
        if isinstance(request, TextRequest):
            _require_model(request.model, NVIDIA_CHAT_MODELS, "chat")
            return HttpRequest(
                "POST",
                NVIDIA_CHAT_ENDPOINT,
                headers=headers,
                json_body=self._chat_body(request),
                # Long strict-schema responses from hosted gpt-oss can spend
                # more than two minutes in the model before returning a single
                # non-streamed JSON document. Keep the bounded request alive;
                # the durable workflow and idempotency key still own retries.
                timeout_seconds=300.0 if request.json_schema is not None else 120.0,
            )
        if isinstance(request, VisionLanguageRequest):
            if request.model in NVIDIA_RETIRED_VLM_MODELS:
                raise ProviderFailure(
                    FailureCode.PROVIDER_UNAVAILABLE,
                    "The selected NVIDIA hosted VLM endpoint is retired; explicitly select an audited active hosted model or a local NIM",
                    provider_id="nvidia-nim",
                )
            _require_model(request.model, NVIDIA_VLM_MODELS, "vision-language")
            return HttpRequest(
                "POST",
                NVIDIA_CHAT_ENDPOINT,
                headers=headers,
                json_body=self._vision_body(request),
            )
        if isinstance(request, EmbeddingRequest):
            if request.model in NVIDIA_RETIRED_EMBEDDING_MODELS:
                raise ProviderFailure(
                    FailureCode.PROVIDER_UNAVAILABLE,
                    "The selected NVIDIA embedding model is retired; reselect an audited current model",
                    provider_id="nvidia-nim",
                )
            _require_model(request.model, NVIDIA_EMBEDDING_MODELS, "embedding")
            return HttpRequest(
                "POST",
                NVIDIA_EMBEDDING_ENDPOINT,
                headers=headers,
                json_body={
                    "input": list(request.inputs),
                    "model": request.model,
                    "input_type": request.input_type.value,
                    "encoding_format": request.encoding_format.value,
                    "truncate": request.truncate.value,
                },
            )
        if isinstance(request, RerankRequest):
            _require_model(request.model, NVIDIA_RERANK_MODELS, "reranking")
            if request.model not in self.configured_rerank_models:
                raise ProviderFailure(
                    FailureCode.PROVIDER_UNAVAILABLE,
                    "NVIDIA hosted reranking is dormant until exact account access is confirmed",
                    provider_id="nvidia-nim",
                )
            body: dict[str, Any] = {
                "model": request.model,
                "query": {"text": request.query},
                "passages": [{"text": passage.text} for passage in request.passages],
            }
            return HttpRequest("POST", NVIDIA_RERANK_ENDPOINT, headers=headers, json_body=body)
        if isinstance(request, SpeechRequest):
            if request.model not in self.configured_tts_models:
                raise ProviderFailure(
                    FailureCode.UNSUPPORTED_CAPABILITY,
                    "The NVIDIA Magpie TTS endpoint was not explicitly configured and approved",
                    provider_id="nvidia-nim",
                )
            _require_model(request.model, NVIDIA_MAGPIE_MODELS, "speech")
            if request.voice != NVIDIA_MAGPIE_VOICE:
                raise ProviderFailure(
                    FailureCode.INVALID_REQUEST,
                    f"The approved NVIDIA Magpie route must pin {NVIDIA_MAGPIE_VOICE}",
                    provider_id="nvidia-nim",
                )
            if request.locale != "en-US" or request.output_format != "wav" or request.sample_rate_hz != 48_000:
                raise ProviderFailure(
                    FailureCode.INVALID_REQUEST,
                    "NVIDIA Magpie launch narration requires en-US, WAV, and 48 kHz",
                    provider_id="nvidia-nim",
                )
            boundary = "alystria-" + hashlib.sha256(
                context.idempotency_key.encode("utf-8")
            ).hexdigest()[:24]
            multipart_body = _multipart_body(
                boundary,
                {
                    "text": request.text,
                    "language": request.locale,
                    "voice": request.voice,
                    "encoding": "LINEAR_PCM",
                    "sample_rate_hz": str(request.sample_rate_hz),
                },
            )
            return HttpRequest(
                "POST",
                NVIDIA_MAGPIE_ENDPOINT,
                headers={
                    **headers,
                    "Content-Type": f"multipart/form-data; boundary={boundary}",
                    "Accept": "audio/wav, application/octet-stream",
                },
                body=multipart_body,
                timeout_seconds=180.0,
            )
        if isinstance(request, (ImageRequest, MotionRequest)):
            return self._visual_request(request, headers)
        raise ProviderFailure(
            FailureCode.UNSUPPORTED_CAPABILITY,
            "NVIDIA NIM does not implement this request contract",
            provider_id=self.descriptor.provider_id,
        )

    @staticmethod
    def _guard_hosted_preview(context: RequestContext) -> None:
        if context.data_classification is not DataClassification.PUBLIC:
            raise ProviderFailure(
                FailureCode.POLICY_BLOCKED,
                "NVIDIA hosted preview accepts public or synthetic content only",
                provider_id="nvidia-nim",
            )
        if context.metadata.get("termsApproved") != "true":
            raise ProviderFailure(
                FailureCode.ROUTING_CONSENT_REQUIRED,
                "NVIDIA API Trial Terms require explicit approval",
                provider_id="nvidia-nim",
            )
        if not context.metadata.get("modelAccessCheckedAt"):
            raise ProviderFailure(
                FailureCode.PROVIDER_UNAVAILABLE,
                "Check current model availability and rate limits in build.nvidia.com",
                provider_id="nvidia-nim",
            )

    @staticmethod
    def _chat_body(request: TextRequest) -> dict[str, Any]:
        messages: list[dict[str, Any]] = []
        if request.system:
            messages.append({"role": "system", "content": request.system})
        messages.append({"role": "user", "content": request.prompt})
        body: dict[str, Any] = {
            "model": request.model,
            "messages": messages,
            "max_tokens": request.max_output_tokens,
            "stream": False,
        }
        if request.temperature is not None:
            body["temperature"] = request.temperature
        if request.json_schema is not None:
            # gpt-oss exposes reasoning separately from message content. Low
            # effort leaves the bounded completion budget for schema-valid
            # application output instead of exhausting it on hidden analysis.
            body["reasoning_effort"] = "low"
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": request.schema_name,
                    "schema": request.json_schema,
                    "strict": True,
                },
            }
        if request.research:
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                "NVIDIA hosted chat does not provide Alystria's web-research contract",
                provider_id="nvidia-nim",
            )
        return body

    @staticmethod
    def _vision_body(request: VisionLanguageRequest) -> dict[str, Any]:
        content: list[dict[str, Any]] = [{"type": "text", "text": request.prompt}]
        for image in request.images:
            if image.uri is not None or image.data_base64 is None:
                raise ProviderFailure(
                    FailureCode.INVALID_REQUEST,
                    "NVIDIA VLM inputs must be quarantined inline image bytes, not remote URLs",
                    provider_id="nvidia-nim",
                )
            if image.media_type not in {"image/png", "image/jpeg"}:
                raise ProviderFailure(
                    FailureCode.INVALID_REQUEST,
                    "NVIDIA VLM inputs support PNG and JPEG only",
                    provider_id="nvidia-nim",
                )
            try:
                decoded = base64.b64decode(image.data_base64, validate=True)
            except (ValueError, TypeError) as exc:
                raise ProviderFailure(
                    FailureCode.INVALID_REQUEST,
                    "NVIDIA VLM input contains invalid base64",
                    provider_id="nvidia-nim",
                ) from exc
            if len(decoded) > 180 * 1024:
                raise ProviderFailure(
                    FailureCode.INVALID_REQUEST,
                    "NVIDIA VLM inline images are limited to 180 KiB; asset upload is not enabled",
                    provider_id="nvidia-nim",
                )
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{image.media_type};base64,{image.data_base64}"},
                }
            )
        messages: list[dict[str, Any]] = []
        if request.system:
            messages.append({"role": "system", "content": request.system})
        messages.append({"role": "user", "content": content})
        body: dict[str, Any] = {
            "model": request.model,
            "messages": messages,
            "max_tokens": request.max_output_tokens,
            "stream": False,
        }
        if request.temperature is not None:
            body["temperature"] = request.temperature
        if request.model == NVIDIA_VLM_MODEL:
            # NVIDIA documents thinking as enabled by default for this model.
            # Sparse visual QA needs its bounded completion budget for the
            # closed JSON response, so use the documented instruct-mode switch.
            body["chat_template_kwargs"] = {"enable_thinking": False}
            body["top_k"] = 1
        return body

    def _visual_request(
        self, request: ImageRequest | MotionRequest, headers: dict[str, str]
    ) -> HttpRequest:
        endpoint = NVIDIA_VISUAL_ENDPOINTS.get(request.model)
        if endpoint is None or request.model not in self.configured_visual_models:
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                "The NVIDIA visual model endpoint was not explicitly configured and approved",
                provider_id="nvidia-nim",
            )
        if not endpoint.active:
            raise ProviderFailure(
                FailureCode.PROVIDER_UNAVAILABLE,
                endpoint.note,
                provider_id="nvidia-nim",
            )
        if endpoint.capability is not request.capability:
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                "The configured NVIDIA endpoint does not support this request capability",
                provider_id="nvidia-nim",
            )
        if isinstance(request, ImageRequest):
            if request.reference_images:
                raise ProviderFailure(
                    FailureCode.UNSUPPORTED_CAPABILITY,
                    "This NVIDIA preview image endpoint does not accept Alystria image editing",
                    provider_id="nvidia-nim",
                )
            width, height = _nvidia_dimensions(request.size, request.aspect_ratio)
            body: dict[str, Any] = {
                "prompt": request.prompt,
                "width": width,
                "height": height,
                "cfg_scale": 1.0,
                "samples": 1,
                "steps": 1,
            }
            if request.seed is not None:
                body["seed"] = request.seed
            return HttpRequest("POST", endpoint.endpoint, headers=headers, json_body=body)

        # The only documented generation-video endpoint in this snapshot is a
        # deprecated image-to-video tombstone and can therefore never reach
        # this branch. Keep the exact builder for forward-compatible project
        # diagnostics without enabling an obsolete remote call.
        if request.image is None or request.image.data_base64 is None or request.image.uri:
            raise ProviderFailure(
                FailureCode.INVALID_REQUEST,
                "NVIDIA image-to-video requires one inline PNG or JPEG",
                provider_id="nvidia-nim",
            )
        if request.image.media_type not in {"image/png", "image/jpeg"}:
            raise ProviderFailure(
                FailureCode.INVALID_REQUEST,
                "NVIDIA image-to-video input must be PNG or JPEG",
                provider_id="nvidia-nim",
            )
        body = {
            "image": (f"data:{request.image.media_type};base64,{request.image.data_base64}"),
            "motion_bucket_id": 127,
        }
        if request.seed is not None:
            body["seed"] = request.seed
        return HttpRequest("POST", endpoint.endpoint, headers=headers, json_body=body)

    def _parse_chat(
        self, request: TextRequest | VisionLanguageRequest, payload: dict[str, Any]
    ) -> ProviderResult[TextOutput]:
        choices = _records(payload.get("choices"))
        message = _record(choices[0].get("message")) if choices else {}
        content = message.get("content")
        if isinstance(content, list):
            text = "".join(
                str(item.get("text", ""))
                for item in content
                if isinstance(item, dict) and item.get("type") in {"text", "output_text"}
            )
        else:
            text = content if isinstance(content, str) else ""
        if not text:
            raise _malformed("NVIDIA NIM chat returned no message text")
        parsed: Any | None = None
        if isinstance(request, TextRequest) and request.json_schema is not None:
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError as exc:
                raise _malformed("NVIDIA NIM structured output was not valid JSON") from exc
        usage_payload = _record(payload.get("usage"))
        token_units = {
            unit: float(value)
            for unit, value in (
                ("input_tokens", usage_payload.get("prompt_tokens")),
                ("output_tokens", usage_payload.get("completion_tokens")),
            )
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0
        }
        usage = Usage(
            "nvidia-nim",
            _string(payload.get("model")) or request.model,
            token_units,
            0,
            request_id=_string(payload.get("id")),
            billing_basis="nvidia-hosted-developer-preview-v1",
        )
        return ProviderResult(
            "nvidia-nim",
            usage.model,
            TextOutput(text, parsed),
            usage,
            _string(payload.get("id")),
        )

    def _parse_embeddings(
        self, request: EmbeddingRequest, payload: dict[str, Any]
    ) -> ProviderResult[EmbeddingOutput]:
        rows = _records(payload.get("data"))
        if len(rows) != len(request.inputs):
            raise _malformed("NVIDIA NIM embedding count did not match the request")
        vectors: list[tuple[float, ...] | str] = []
        dimensions: int | None = None
        for row in sorted(rows, key=lambda value: _integer(value.get("index"))):
            value = row.get("embedding")
            if request.encoding_format is EmbeddingEncoding.BASE64:
                if not isinstance(value, str) or not value:
                    raise _malformed("NVIDIA NIM returned an invalid base64 embedding")
                vectors.append(value)
                continue
            if (
                not isinstance(value, list)
                or not value
                or not all(
                    isinstance(item, (int, float)) and not isinstance(item, bool) for item in value
                )
            ):
                raise _malformed("NVIDIA NIM returned an invalid float embedding")
            vector = tuple(float(item) for item in value)
            dimensions = dimensions or len(vector)
            if len(vector) != dimensions:
                raise _malformed("NVIDIA NIM returned inconsistent embedding dimensions")
            vectors.append(vector)
        usage_payload = _record(payload.get("usage"))
        usage = Usage(
            "nvidia-nim",
            _string(payload.get("model")) or request.model,
            {"input_tokens": float(_integer(usage_payload.get("prompt_tokens")))},
            None,
            request_id=_string(payload.get("id")),
        )
        return ProviderResult(
            "nvidia-nim",
            usage.model,
            EmbeddingOutput(tuple(vectors), dimensions),
            usage,
            _string(payload.get("id")),
        )

    def _parse_rerank(
        self, request: RerankRequest, payload: dict[str, Any]
    ) -> ProviderResult[RerankOutput]:
        rows = _records(payload.get("rankings") or payload.get("data"))
        rankings: list[RerankScore] = []
        for row in rows:
            index = _integer(row.get("index"))
            score_value = row.get("logit", row.get("score", row.get("relevance_score")))
            if (
                not 0 <= index < len(request.passages)
                or not isinstance(score_value, (int, float))
                or isinstance(score_value, bool)
            ):
                raise _malformed("NVIDIA NIM returned an invalid ranking entry")
            rankings.append(RerankScore(index, float(score_value), request.passages[index].id))
        if not rankings:
            raise _malformed("NVIDIA NIM returned no rankings")
        rankings.sort(key=lambda value: value.score, reverse=True)
        if request.top_n is not None:
            rankings = rankings[: request.top_n]
        usage = Usage(
            "nvidia-nim",
            request.model,
            {"passages": float(len(request.passages))},
            None,
            request_id=_string(payload.get("id")),
        )
        return ProviderResult(
            "nvidia-nim",
            request.model,
            RerankOutput(tuple(rankings)),
            usage,
            _string(payload.get("id")),
        )

    def _parse_visual(
        self, request: ImageRequest | MotionRequest, payload: dict[str, Any]
    ) -> ProviderResult[MediaOutput]:
        assets: list[MediaAsset] = []
        license_id = NVIDIA_VISUAL_LICENSES.get(request.model)
        for row in _records(payload.get("artifacts") or payload.get("data")):
            encoded = row.get("base64") or row.get("b64_json")
            uri = row.get("url")
            if isinstance(encoded, str):
                try:
                    decoded = base64.b64decode(encoded, validate=True)
                except (ValueError, TypeError) as error:
                    raise _malformed(
                        "NVIDIA NIM visual response contained invalid base64"
                    ) from error
                assets.append(
                    MediaAsset(
                        data_base64=encoded,
                        media_type=_visual_media_type_from_bytes(request, decoded),
                        license=license_id,
                    )
                )
            elif isinstance(uri, str) and uri.startswith("https://"):
                assets.append(
                    MediaAsset(
                        uri=uri,
                        media_type=_media_type(request),
                        license=license_id,
                    )
                )
        if not assets:
            raise _malformed("NVIDIA NIM visual response contained no usable asset")
        usage = Usage(
            "nvidia-nim",
            request.model,
            {"outputs": float(len(assets))},
            0,
            request_id=_string(payload.get("id")),
        )
        return ProviderResult(
            "nvidia-nim",
            request.model,
            MediaOutput(tuple(assets), {"previewService": True}),
            usage,
            _string(payload.get("id")),
        )

    def _parse_speech(
        self,
        request: SpeechRequest,
        response: HttpResponse,
    ) -> ProviderResult[MediaOutput]:
        request_id = next(
            (value for key, value in response.headers.items() if key.casefold() == "x-request-id"),
            None,
        )
        if not 200 <= response.status < 300:
            raise failure_from_http("nvidia-nim", response.status, request_id=request_id)
        content = response.body
        try:
            with wave.open(io.BytesIO(content), "rb") as stream:
                channels = stream.getnchannels()
                sample_width = stream.getsampwidth()
                sample_rate = stream.getframerate()
                frame_count = stream.getnframes()
        except (EOFError, wave.Error) as error:
            raise _malformed("NVIDIA Magpie TTS response was not a valid WAV file") from error
        if channels not in {1, 2} or sample_width != 2 or sample_rate != 48_000 or frame_count <= 0:
            raise _malformed("NVIDIA Magpie TTS response was not non-empty 48 kHz 16-bit PCM")
        duration_seconds = frame_count / sample_rate
        asset = MediaAsset(
            data_base64=base64.b64encode(content).decode("ascii"),
            media_type="audio/wav",
            duration_seconds=duration_seconds,
            license="LicenseRef-NVIDIA-AI-FOUNDATION-MODELS",
        )
        return ProviderResult(
            "nvidia-nim",
            request.model,
            MediaOutput(
                (asset,),
                {
                    "voiceId": request.voice,
                    "locale": request.locale,
                    "sampleRateHz": sample_rate,
                    "channels": channels,
                    "durationMs": round(duration_seconds * 1_000),
                    "hostedPreview": True,
                },
            ),
            Usage(
                "nvidia-nim",
                request.model,
                {"characters": float(len(request.text))},
                0,
                request_id=request_id,
            ),
            request_id,
        )


def configured_nvidia_visual_models(models: tuple[str, ...]) -> frozenset[str]:
    """Return exact, active visual route models or fail closed on catalog drift."""

    selected: set[str] = set()
    for model in models:
        endpoint = NVIDIA_VISUAL_ENDPOINTS.get(model)
        if endpoint is None:
            continue
        if not endpoint.active:
            raise ValueError(f"NVIDIA visual model {model!r} is unavailable: {endpoint.note}")
        selected.add(model)
    return frozenset(selected)


def configured_nvidia_tts_models(models: tuple[str, ...]) -> frozenset[str]:
    return frozenset(model for model in models if model in NVIDIA_MAGPIE_MODELS)


def _multipart_body(boundary: str, fields: dict[str, str]) -> bytes:
    body = bytearray()
    for name, value in fields.items():
        body.extend(f"--{boundary}\r\n".encode("ascii"))
        body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("ascii"))
        body.extend(value.encode("utf-8"))
        body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode("ascii"))
    return bytes(body)


def _nvidia_dimensions(size: str | None, aspect_ratio: str) -> tuple[int, int]:
    if size not in {None, "1024x1024"} or aspect_ratio != "1:1":
        raise ProviderFailure(
            FailureCode.INVALID_REQUEST,
            "This NVIDIA FLUX.2 snapshot enables only the live-verified 1024x1024 shape",
            provider_id="nvidia-nim",
        )
    return (1024, 1024)


def _media_type(request: ImageRequest | MotionRequest) -> str:
    if isinstance(request, MotionRequest):
        return "video/mp4"
    return "image/png" if request.output_format == "png" else "image/jpeg"


def _visual_media_type_from_bytes(request: ImageRequest | MotionRequest, content: bytes) -> str:
    """Bind provider media metadata to the returned bytes, not requested intent."""

    if isinstance(request, MotionRequest):
        if len(content) >= 12 and content[4:8] == b"ftyp":
            return "video/mp4"
        raise _malformed("NVIDIA NIM motion response was not an MP4 file")
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return "image/webp"
    raise _malformed("NVIDIA NIM visual response was not a supported image file")


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _records(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _integer(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _string(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _malformed(message: str) -> ProviderFailure:
    return ProviderFailure(
        FailureCode.MALFORMED_RESPONSE,
        message,
        provider_id="nvidia-nim",
    )


def _require_model(model: str, allowed: frozenset[str], capability: str) -> None:
    if model not in allowed:
        raise ProviderFailure(
            FailureCode.UNSUPPORTED_CAPABILITY,
            f"NVIDIA model is not in the audited {capability} capability allowlist",
            provider_id="nvidia-nim",
        )
