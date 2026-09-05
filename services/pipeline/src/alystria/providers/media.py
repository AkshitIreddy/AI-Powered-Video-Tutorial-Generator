"""Launch media-provider request builders and async operation lifecycle.

These adapters deliberately stop at the provider boundary: returned remote
assets must still pass Alystria's quarantine, provenance and CAS promotion
pipeline before they can enter a project.
"""

from __future__ import annotations

import base64
import json
import secrets
from collections.abc import Callable
from dataclasses import asdict, dataclass, replace
from enum import StrEnum
from html import escape
from typing import Any
from urllib.parse import urlencode

from .base import GuardedAdapter
from .catalog import default_catalog
from .errors import FailureCode, ProviderFailure
from .transport import HttpRequest, HttpResponse, HttpTransport
from .types import (
    AssetInput,
    AsyncHandle,
    Capability,
    CostEstimate,
    ImageRequest,
    MediaAsset,
    MediaOutput,
    MediaSearchRequest,
    MotionRequest,
    OperationState,
    OperationStatus,
    PresenterRequest,
    ProviderRequest,
    ProviderResult,
    RequestContext,
    SpeechRequest,
    TranscriptionRequest,
    Usage,
)


class AuthMode(StrEnum):
    NONE = "none"
    BEARER = "bearer"
    X_API_KEY = "x_api_key"
    X_GOOG_API_KEY = "x_goog_api_key"
    XI_API_KEY = "xi_api_key"
    AZURE_KEY = "azure_key"
    PEXELS = "pexels"
    BFL = "bfl"


@dataclass(frozen=True, slots=True)
class UnitPrice:
    capability: Capability
    unit: str
    micros_per_unit: int
    catalog_version: str


# ElevenLabs bills these launch models per text character. Keep the table
# deliberately narrow: an unknown or newly named model must remain unbounded
# and fail Alystria's require-known-pricing gate until its price is reviewed.
ELEVENLABS_TTS_MICROS_PER_CHARACTER: dict[str, int] = {
    "eleven_flash_v2": 50,
    "eleven_flash_v2_5": 50,
    "eleven_turbo_v2": 50,
    "eleven_turbo_v2_5": 50,
    "eleven_multilingual_v2": 100,
    "eleven_v3": 100,
}
ELEVENLABS_PRICING_CATALOG_VERSION = "elevenlabs-api-pricing-2026-09-01"
LICENSED_MEDIA_ACCESS_CATALOG_VERSION = "licensed-media-api-access-2026-09-05"


RequestBuilder = Callable[[ProviderRequest, RequestContext], HttpRequest]


@dataclass(frozen=True, slots=True)
class OperationSpec:
    capability: Capability
    builder: RequestBuilder
    asynchronous: bool = False
    poll_path: str | None = None
    cancel_path: str | None = None
    operation_id_paths: tuple[str, ...] = ("id", "operation_id", "data.id")
    state_paths: tuple[str, ...] = ("status", "state", "data.status")


@dataclass(frozen=True, slots=True)
class LaunchProviderConfig:
    provider_id: str
    base_url: str
    auth: AuthMode
    operations: dict[Capability, OperationSpec]
    extra_headers: dict[str, str] | None = None


class LaunchMediaAdapter(GuardedAdapter):
    """Concrete HTTP adapter driven by provider-specific, typed builders."""

    def __init__(
        self,
        transport: HttpTransport,
        config: LaunchProviderConfig,
        *,
        prices: tuple[UnitPrice, ...] = (),
    ) -> None:
        self.transport = transport
        self.config = config
        self.prices = {price.capability: price for price in prices}
        base_descriptor = default_catalog().get(config.provider_id)
        self.descriptor = replace(
            base_descriptor,
            capabilities=frozenset(config.operations),
            supports_cancellation=any(spec.cancel_path for spec in config.operations.values()),
        )
        self.requires_credential = config.auth is not AuthMode.NONE and (
            self.descriptor.data_policy.boundary.value != "local"
        )

    def estimate(self, request: ProviderRequest) -> CostEstimate:
        price = self.prices.get(request.capability)
        quantity = _quantity(request)
        if price is None or quantity is None:
            return CostEstimate(
                None,
                "USD",
                False,
                "No bounded current unit price or request quantity is available",
                self.descriptor.catalog_version,
            )
        return CostEstimate(
            round(quantity * price.micros_per_unit),
            "USD",
            True,
            f"{quantity:g} {price.unit} at catalog unit price",
            price.catalog_version,
        )

    def build_request(self, request: ProviderRequest, context: RequestContext) -> HttpRequest:
        self._guard(request.capability, context)
        self._guard_budget(request, context)
        try:
            spec = self.config.operations[request.capability]
        except KeyError as exc:
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                f"{self.descriptor.provider_id} has no builder for {request.capability.value}",
                provider_id=self.descriptor.provider_id,
            ) from exc
        built = spec.builder(request, context)
        headers = dict(self.config.extra_headers or {})
        headers.update(built.headers)
        headers.update(_auth_headers(self.config.auth, context.credential))
        if self.descriptor.supports_idempotency:
            headers.setdefault("Idempotency-Key", context.idempotency_key)
        url = (
            built.url
            if built.url.startswith(("http://", "https://"))
            else (f"{self.config.base_url.rstrip('/')}/{built.url.lstrip('/')}")
        )
        return replace(built, url=url, headers=headers)

    def invoke(
        self, request: ProviderRequest, context: RequestContext
    ) -> ProviderResult[MediaOutput]:
        spec = self.config.operations.get(request.capability)
        if spec is not None and spec.asynchronous:
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                "This provider operation is asynchronous; call submit and poll",
                provider_id=self.descriptor.provider_id,
            )
        response = self._send(self.build_request(request, context), context)
        return self._parse_media_result(request, response)

    def submit(self, request: ProviderRequest, context: RequestContext) -> AsyncHandle:
        spec = self.config.operations.get(request.capability)
        if spec is None or not spec.asynchronous:
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                "This provider operation is synchronous",
                provider_id=self.descriptor.provider_id,
            )
        response = self._send(self.build_request(request, context), context)
        payload = self._json_response(response)
        operation_id = next(
            (
                _string(_path(payload, path))
                for path in spec.operation_id_paths
                if _path(payload, path)
            ),
            None,
        )
        if operation_id is None:
            raise ProviderFailure(
                FailureCode.MALFORMED_RESPONSE,
                "Async provider response omitted its operation ID",
                provider_id=self.descriptor.provider_id,
            )
        return AsyncHandle(
            provider_id=self.descriptor.provider_id,
            operation_id=operation_id,
            capability=request.capability,
            model=_request_model(request),
            poll_url=_format_operation_url(self.config.base_url, spec.poll_path, operation_id),
            cancel_url=_format_operation_url(self.config.base_url, spec.cancel_path, operation_id),
        )

    def poll(self, handle: AsyncHandle, context: RequestContext) -> OperationStatus[MediaOutput]:
        self._guard_handle(handle, context)
        spec = self.config.operations[handle.capability]
        if not handle.poll_url:
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                "This provider does not declare a polling endpoint",
                provider_id=self.descriptor.provider_id,
            )
        response = self._send(
            HttpRequest(
                "GET",
                handle.poll_url,
                headers=_auth_headers(self.config.auth, context.credential),
            ),
            context,
        )
        payload = self._json_response(response)
        remote_state = next(
            (_string(_path(payload, path)) for path in spec.state_paths if _path(payload, path)),
            None,
        )
        state = _normalise_state(remote_state)
        if state is OperationState.FAILED:
            return OperationStatus(
                state,
                failure={
                    "code": FailureCode.PROVIDER_ERROR.value,
                    "message": "Provider job failed",
                },
            )
        if state is OperationState.CANCELLED:
            return OperationStatus(state)
        progress = _float(_path(payload, "progress")) or _float(_path(payload, "data.progress"))
        if state is not OperationState.SUCCEEDED:
            return OperationStatus(state, progress=progress)
        return OperationStatus(
            state,
            progress=1.0,
            result=_media_output(payload, self.descriptor.provider_id),
            usage=_usage_from_payload(self.descriptor.provider_id, handle.model, payload),
        )

    def cancel(self, handle: AsyncHandle, context: RequestContext) -> OperationStatus[MediaOutput]:
        self._guard_handle(handle, context)
        if not handle.cancel_url:
            raise ProviderFailure(
                FailureCode.UNSUPPORTED_CAPABILITY,
                "This provider does not declare cancellation for the operation",
                provider_id=self.descriptor.provider_id,
            )
        response = self._send(
            HttpRequest(
                "DELETE",
                handle.cancel_url,
                headers=_auth_headers(self.config.auth, context.credential),
            ),
            context,
        )
        if response.status in {202, 204}:
            return OperationStatus(OperationState.CANCELLED)
        payload = self._json_response(response)
        state = _normalise_state(_string(payload.get("status")) or "cancelled")
        return OperationStatus(state)

    def _guard_handle(self, handle: AsyncHandle, context: RequestContext) -> None:
        if handle.provider_id != self.descriptor.provider_id:
            raise ProviderFailure(
                FailureCode.INVALID_REQUEST,
                "Async handle belongs to a different provider",
                provider_id=self.descriptor.provider_id,
            )
        self._guard(handle.capability, context)

    def _parse_media_result(
        self, request: ProviderRequest, response: HttpResponse
    ) -> ProviderResult[MediaOutput]:
        if not 200 <= response.status < 300:
            self._json_response(response)
        content_type = next(
            (value for key, value in response.headers.items() if key.lower() == "content-type"), ""
        )
        if "json" not in content_type.lower():
            media_type = content_type.split(";", maxsplit=1)[0] or "application/octet-stream"
            is_elevenlabs_speech = (
                self.descriptor.provider_id == "elevenlabs"
                and isinstance(request, SpeechRequest)
            )
            output = MediaOutput(
                (
                    MediaAsset(
                        data_base64=base64.b64encode(response.body).decode(),
                        media_type=media_type,
                        license="ELEVENLABS-OUTPUT" if is_elevenlabs_speech else None,
                        attribution=(
                            "Generated with ElevenLabs (elevenlabs.io)"
                            if is_elevenlabs_speech
                            else None
                        ),
                    ),
                )
            )
            payload: dict[str, Any] = {}
        else:
            payload = self._json_response(response)
            output = _media_output(payload, self.descriptor.provider_id)
        raw_id = _string(payload.get("id")) or _string(_path(payload, "data.id"))
        model = _string(payload.get("model")) or _request_model(request)
        return ProviderResult(
            self.descriptor.provider_id,
            model,
            output,
            _usage_from_payload(self.descriptor.provider_id, model, payload),
            raw_id,
        )


def launch_media_adapter(
    provider_id: str,
    transport: HttpTransport,
    *,
    base_url: str | None = None,
    prices: tuple[UnitPrice, ...] = (),
) -> LaunchMediaAdapter:
    """Create one concrete launch adapter from the pinned request catalog."""

    configs = _launch_configs()
    try:
        config = configs[provider_id]
    except KeyError as exc:
        raise KeyError(f"No launch media request builders for {provider_id!r}") from exc
    if base_url is not None:
        config = replace(config, base_url=base_url)
    return LaunchMediaAdapter(transport, config, prices=prices)


def launch_media_provider_ids() -> tuple[str, ...]:
    return tuple(_launch_configs())


def launch_route_unit_prices(
    provider_id: str,
    route_models: dict[Capability, str],
) -> tuple[UnitPrice, ...]:
    """Return reviewed prices only for exact models in this generation policy."""

    if (
        provider_id in {"openverse", "pexels"}
        and Capability.LICENSED_MEDIA in route_models
    ):
        return (
            UnitPrice(
                Capability.LICENSED_MEDIA,
                "requests",
                0,
                LICENSED_MEDIA_ACCESS_CATALOG_VERSION,
            ),
        )
    if provider_id != "elevenlabs":
        return ()
    model = route_models.get(Capability.TTS)
    micros_per_character = ELEVENLABS_TTS_MICROS_PER_CHARACTER.get(model or "")
    if micros_per_character is None:
        return ()
    return (
        UnitPrice(
            Capability.TTS,
            "characters",
            micros_per_character,
            ELEVENLABS_PRICING_CATALOG_VERSION,
        ),
    )


def _launch_configs() -> dict[str, LaunchProviderConfig]:
    return {
        "openai": LaunchProviderConfig(
            "openai",
            "https://api.openai.com/v1",
            AuthMode.BEARER,
            {
                Capability.IMAGE_GENERATION: OperationSpec(
                    Capability.IMAGE_GENERATION, _openai_image
                ),
                Capability.IMAGE_EDITING: OperationSpec(Capability.IMAGE_EDITING, _openai_image),
                Capability.TTS: OperationSpec(Capability.TTS, _openai_audio),
                Capability.TRANSCRIPTION: OperationSpec(Capability.TRANSCRIPTION, _openai_audio),
                Capability.ALIGNMENT: OperationSpec(Capability.ALIGNMENT, _openai_audio),
            },
        ),
        "gemini": LaunchProviderConfig(
            "gemini",
            "https://generativelanguage.googleapis.com/v1beta",
            AuthMode.X_GOOG_API_KEY,
            {
                Capability.IMAGE_GENERATION: OperationSpec(
                    Capability.IMAGE_GENERATION, _gemini_media
                ),
                Capability.IMAGE_EDITING: OperationSpec(Capability.IMAGE_EDITING, _gemini_media),
                Capability.MOTION: OperationSpec(
                    Capability.MOTION,
                    _gemini_media,
                    asynchronous=True,
                    poll_path="/{id}",
                    cancel_path="/{id}:cancel",
                    operation_id_paths=("name", "id"),
                ),
                Capability.TTS: OperationSpec(Capability.TTS, _gemini_media),
                Capability.TRANSCRIPTION: OperationSpec(Capability.TRANSCRIPTION, _gemini_media),
            },
            extra_headers={"Api-Revision": "2026-05-20"},
        ),
        "black-forest-labs": LaunchProviderConfig(
            "black-forest-labs",
            "https://api.bfl.ai",
            AuthMode.BFL,
            {
                Capability.IMAGE_GENERATION: OperationSpec(
                    Capability.IMAGE_GENERATION,
                    _bfl_image,
                    asynchronous=True,
                    poll_path="/v1/get_result?id={id}",
                ),
                Capability.IMAGE_EDITING: OperationSpec(
                    Capability.IMAGE_EDITING,
                    _bfl_image,
                    asynchronous=True,
                    poll_path="/v1/get_result?id={id}",
                ),
            },
        ),
        "recraft": LaunchProviderConfig(
            "recraft",
            "https://external.api.recraft.ai/v1",
            AuthMode.BEARER,
            {
                Capability.IMAGE_GENERATION: OperationSpec(
                    Capability.IMAGE_GENERATION, _recraft_image
                ),
                Capability.IMAGE_EDITING: OperationSpec(Capability.IMAGE_EDITING, _recraft_image),
            },
        ),
        "openverse": LaunchProviderConfig(
            "openverse",
            "https://api.openverse.org/v1",
            AuthMode.NONE,
            {Capability.LICENSED_MEDIA: OperationSpec(Capability.LICENSED_MEDIA, _openverse)},
        ),
        "pexels": LaunchProviderConfig(
            "pexels",
            "https://api.pexels.com",
            AuthMode.PEXELS,
            {Capability.LICENSED_MEDIA: OperationSpec(Capability.LICENSED_MEDIA, _pexels)},
        ),
        "runway": LaunchProviderConfig(
            "runway",
            "https://api.dev.runwayml.com",
            AuthMode.BEARER,
            {
                Capability.MOTION: OperationSpec(
                    Capability.MOTION,
                    _runway_motion,
                    asynchronous=True,
                    poll_path="/v1/tasks/{id}",
                    cancel_path="/v1/tasks/{id}",
                )
            },
            extra_headers={"X-Runway-Version": "2024-11-06"},
        ),
        "elevenlabs": LaunchProviderConfig(
            "elevenlabs",
            "https://api.elevenlabs.io/v1",
            AuthMode.XI_API_KEY,
            {
                Capability.TTS: OperationSpec(Capability.TTS, _elevenlabs),
                Capability.TRANSCRIPTION: OperationSpec(Capability.TRANSCRIPTION, _elevenlabs),
                Capability.ALIGNMENT: OperationSpec(Capability.ALIGNMENT, _elevenlabs),
            },
        ),
        "azure-speech": LaunchProviderConfig(
            "azure-speech",
            "https://eastus.api.cognitive.microsoft.com",
            AuthMode.AZURE_KEY,
            {
                Capability.TTS: OperationSpec(Capability.TTS, _azure_speech),
                Capability.TRANSCRIPTION: OperationSpec(Capability.TRANSCRIPTION, _azure_speech),
            },
        ),
        "google-cloud-speech": LaunchProviderConfig(
            "google-cloud-speech",
            "https://texttospeech.googleapis.com",
            AuthMode.BEARER,
            {
                Capability.TTS: OperationSpec(Capability.TTS, _google_cloud_speech),
                Capability.TRANSCRIPTION: OperationSpec(
                    Capability.TRANSCRIPTION, _google_cloud_speech
                ),
            },
        ),
        "heygen": LaunchProviderConfig(
            "heygen",
            "https://api.heygen.com",
            AuthMode.X_API_KEY,
            {
                Capability.PRESENTER: OperationSpec(
                    Capability.PRESENTER,
                    _heygen,
                    asynchronous=True,
                    poll_path="/v1/video_status.get?video_id={id}",
                    operation_id_paths=("data.video_id", "video_id", "id"),
                )
            },
        ),
        "tavus": LaunchProviderConfig(
            "tavus",
            "https://tavusapi.com",
            AuthMode.X_API_KEY,
            {
                Capability.PRESENTER: OperationSpec(
                    Capability.PRESENTER,
                    _tavus,
                    asynchronous=True,
                    poll_path="/v2/videos/{id}",
                    cancel_path="/v2/videos/{id}",
                    operation_id_paths=("video_id", "id"),
                )
            },
        ),
        **{
            provider_id: LaunchProviderConfig(
                provider_id,
                "http://127.0.0.1:7391",
                AuthMode.NONE,
                {
                    capability: OperationSpec(
                        capability,
                        _local_worker,
                        asynchronous=capability is Capability.PRESENTER,
                        poll_path="/v1/jobs/{id}" if capability is Capability.PRESENTER else None,
                        cancel_path="/v1/jobs/{id}" if capability is Capability.PRESENTER else None,
                    )
                },
            )
            for provider_id, capability in {
                "qwen3-tts-local": Capability.TTS,
                "kokoro-local": Capability.TTS,
                "whisperx-local": Capability.TRANSCRIPTION,
                "mfa-local": Capability.ALIGNMENT,
                "presenter-local": Capability.PRESENTER,
            }.items()
        },
    }


def _openai_image(request: ProviderRequest, _context: RequestContext) -> HttpRequest:
    assert isinstance(request, ImageRequest)
    if not request.reference_images:
        body: dict[str, Any] = {
            "model": request.model,
            "prompt": request.prompt,
            "n": 1,
            "output_format": request.output_format,
        }
        if request.size:
            body["size"] = request.size
        return HttpRequest("POST", "/images/generations", json_body=body)
    fields = {
        "model": request.model,
        "prompt": request.prompt,
        "n": "1",
        "output_format": request.output_format,
    }
    if request.size:
        fields["size"] = request.size
    return _multipart_request("/images/edits", fields, "image[]", request.reference_images)


def _openai_audio(request: ProviderRequest, _context: RequestContext) -> HttpRequest:
    if isinstance(request, SpeechRequest):
        return HttpRequest(
            "POST",
            "/audio/speech",
            json_body={
                "model": request.model,
                "voice": request.voice,
                "input": request.text,
                "response_format": request.output_format,
                "speed": request.speed,
            },
        )
    assert isinstance(request, TranscriptionRequest)
    fields: dict[str, Any] = {
        "model": request.model,
        "response_format": "verbose_json" if request.word_timestamps else "json",
    }
    if request.locale:
        fields["language"] = request.locale.split("-", maxsplit=1)[0]
    if request.known_text:
        fields["prompt"] = request.known_text
    return _multipart_request("/audio/transcriptions", fields, "file", (request.audio,))


def _gemini_media(request: ProviderRequest, _context: RequestContext) -> HttpRequest:
    body: dict[str, Any] = {"model": _request_model(request), "store": False}
    if isinstance(request, ImageRequest):
        body["input"] = _gemini_input(request.prompt, request.reference_images)
        body["response_format"] = {
            "type": "image",
            "mime_type": f"image/{request.output_format}",
            "aspect_ratio": request.aspect_ratio,
        }
    elif isinstance(request, MotionRequest):
        body["input"] = _gemini_input(request.prompt, (request.image,) if request.image else ())
        body["response_format"] = {
            "type": "video",
            "aspect_ratio": request.aspect_ratio,
        }
        body["background"] = True
    elif isinstance(request, SpeechRequest):
        body["input"] = request.text
        body["response_format"] = {
            "type": "audio",
            "delivery": "inline",
            "sample_rate": request.sample_rate_hz,
        }
        body["generation_config"] = {
            "speech_config": {"voice": request.voice, "locale": request.locale}
        }
    else:
        assert isinstance(request, TranscriptionRequest)
        instruction = (
            "Transcribe this audio with word timestamps."
            if request.word_timestamps
            else "Transcribe."
        )
        body["input"] = _gemini_input(instruction, (request.audio,))
        body["response_format"] = {"type": "text", "mime_type": "application/json"}
    return HttpRequest("POST", "/interactions", json_body=body)


def _bfl_image(request: ProviderRequest, _context: RequestContext) -> HttpRequest:
    assert isinstance(request, ImageRequest)
    body: dict[str, Any] = {
        "prompt": request.prompt,
        "aspect_ratio": request.aspect_ratio,
        "output_format": request.output_format,
    }
    if request.seed is not None:
        body["seed"] = request.seed
    if request.reference_images:
        body["input_image"] = _inline_asset(request.reference_images[0])
    endpoint = "/v1/flux-kontext-pro" if request.reference_images else "/v1/flux-pro-1.1"
    return HttpRequest("POST", endpoint, json_body=body)


def _recraft_image(request: ProviderRequest, _context: RequestContext) -> HttpRequest:
    assert isinstance(request, ImageRequest)
    if request.reference_images:
        fields: dict[str, Any] = {
            "prompt": request.prompt,
            "model": request.model,
            "response_format": "b64_json",
        }
        if request.size:
            fields["size"] = request.size
        return _multipart_request(
            "/images/imageToImage", fields, "image", (request.reference_images[0],)
        )
    body: dict[str, Any] = {
        "prompt": request.prompt,
        "model": request.model,
        "size": request.size or request.aspect_ratio,
        "response_format": "b64_json",
    }
    if request.negative_prompt:
        body["negative_prompt"] = request.negative_prompt
    return HttpRequest("POST", "/images/generations", json_body=body)


def _openverse(request: ProviderRequest, _context: RequestContext) -> HttpRequest:
    assert isinstance(request, MediaSearchRequest)
    kind = "audio" if request.media_type == "audio" else "images"
    query = urlencode(
        {
            "q": request.query,
            "page_size": min(request.page_size, 20),
            "license": ",".join(request.license_allowlist),
        }
    )
    return HttpRequest("GET", f"/{kind}/?{query}")


def _pexels(request: ProviderRequest, _context: RequestContext) -> HttpRequest:
    assert isinstance(request, MediaSearchRequest)
    query = urlencode({"query": request.query, "per_page": min(request.page_size, 80)})
    path = "/v1/videos/search" if request.media_type == "video" else "/v1/search"
    return HttpRequest("GET", f"{path}?{query}")


def _runway_motion(request: ProviderRequest, _context: RequestContext) -> HttpRequest:
    assert isinstance(request, MotionRequest)
    body: dict[str, Any] = {
        "model": request.model,
        "promptText": request.prompt,
        "ratio": request.aspect_ratio,
        "duration": request.duration_seconds,
    }
    if request.seed is not None:
        body["seed"] = request.seed
    if request.image:
        body["promptImage"] = _inline_asset(request.image)
    endpoint = "/v1/image_to_video" if request.image else "/v1/text_to_video"
    return HttpRequest("POST", endpoint, json_body=body)


def _elevenlabs(request: ProviderRequest, _context: RequestContext) -> HttpRequest:
    if isinstance(request, SpeechRequest):
        return HttpRequest(
            "POST",
            f"/text-to-speech/{request.voice}",
            json_body={
                "text": request.text,
                "model_id": request.model,
                "language_code": request.locale.split("-", maxsplit=1)[0],
                # Stable long-form defaults recommended for a natural voice:
                # preserve speaker identity, avoid exaggerated style drift,
                # and let the user-selected speed remain authoritative.
                "voice_settings": {
                    "stability": 0.5,
                    "similarity_boost": 0.78,
                    "style": 0.0,
                    "use_speaker_boost": True,
                    "speed": request.speed,
                },
                "pronunciation_dictionary_locators": [
                    {"pronunciation": spoken, "word": word}
                    for word, spoken in request.pronunciation_lexicon
                ],
            },
        )
    assert isinstance(request, TranscriptionRequest)
    if request.known_text:
        return _multipart_request(
            "/forced-alignment", {"text": request.known_text}, "file", (request.audio,)
        )
    fields: dict[str, Any] = {"model_id": request.model}
    if request.locale:
        fields["language_code"] = request.locale.split("-", maxsplit=1)[0]
    return _multipart_request("/speech-to-text", fields, "file", (request.audio,))


def _azure_speech(request: ProviderRequest, _context: RequestContext) -> HttpRequest:
    if isinstance(request, SpeechRequest):
        style_open = f'<mstts:express-as style="{escape(request.style)}">' if request.style else ""
        style_close = "</mstts:express-as>" if request.style else ""
        ssml = (
            f'<speak version="1.0" xml:lang="{escape(request.locale)}" '
            'xmlns:mstts="https://www.w3.org/2001/mstts">'
            f'<voice name="{escape(request.voice)}">{style_open}'
            f'<prosody rate="{request.speed:g}">{escape(request.text)}</prosody>'
            f"{style_close}</voice></speak>"
        )
        return HttpRequest(
            "POST",
            "/cognitiveservices/v1",
            headers={
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": "riff-48khz-16bit-mono-pcm",
            },
            body=ssml.encode(),
        )
    if isinstance(request, TranscriptionRequest):
        fields = {"definition": json.dumps({"locales": [request.locale] if request.locale else []})}
        return _multipart_request(
            "/speechtotext/transcriptions:transcribe?api-version=2024-11-15",
            fields,
            "audio",
            (request.audio,),
        )
    raise ProviderFailure(
        FailureCode.UNSUPPORTED_CAPABILITY,
        "Azure avatar batch synthesis accepts text/SSML, not Alystria's "
        "approved final-audio presenter request",
        provider_id="azure-speech",
    )


def _google_cloud_speech(request: ProviderRequest, _context: RequestContext) -> HttpRequest:
    if isinstance(request, SpeechRequest):
        return HttpRequest(
            "POST",
            "https://texttospeech.googleapis.com/v1/text:synthesize",
            json_body={
                "input": {"text": request.text},
                "voice": {"languageCode": request.locale, "name": request.voice},
                "audioConfig": {
                    "audioEncoding": "LINEAR16",
                    "sampleRateHertz": request.sample_rate_hz,
                    "speakingRate": request.speed,
                },
            },
        )
    assert isinstance(request, TranscriptionRequest)
    return HttpRequest(
        "POST",
        "https://speech.googleapis.com/v1/speech:recognize",
        json_body={
            "config": {
                "languageCode": request.locale or "en-US",
                "model": request.model,
                "enableWordTimeOffsets": request.word_timestamps,
                "enableAutomaticPunctuation": True,
                "speechContexts": [{"phrases": [request.known_text]}] if request.known_text else [],
            },
            "audio": {"content": _asset_base64(request.audio)},
        },
    )


def _heygen(request: ProviderRequest, _context: RequestContext) -> HttpRequest:
    assert isinstance(request, PresenterRequest)
    _require_presenter_consent(request)
    return HttpRequest(
        "POST",
        "/v2/video/generate",
        json_body={
            "video_inputs": [
                {
                    "character": {
                        "type": "avatar",
                        "avatar_id": _asset_uri(request.presenter),
                    },
                    "voice": {"type": "audio", "audio_url": _asset_uri(request.audio)},
                }
            ],
            "dimension": _aspect_dimensions(request.aspect_ratio),
            "test": False,
        },
    )


def _tavus(request: ProviderRequest, _context: RequestContext) -> HttpRequest:
    assert isinstance(request, PresenterRequest)
    _require_presenter_consent(request)
    return HttpRequest(
        "POST",
        "/v2/videos",
        json_body={
            "replica_id": _asset_uri(request.presenter),
            "audio_url": _asset_uri(request.audio),
            "video_name": "Alystria presenter scene",
        },
    )


def _local_worker(request: ProviderRequest, context: RequestContext) -> HttpRequest:
    if isinstance(request, PresenterRequest):
        _require_presenter_consent(request)
    path = {
        Capability.TTS: "/v1/tts",
        Capability.TRANSCRIPTION: "/v1/transcribe",
        Capability.ALIGNMENT: "/v1/align",
        Capability.PRESENTER: "/v1/presenter/jobs",
    }[request.capability]
    body = asdict(request)
    body["idempotency_key"] = context.idempotency_key
    return HttpRequest("POST", path, json_body=body)


def _multipart_request(
    path: str,
    fields: dict[str, Any],
    file_field: str,
    assets: tuple[AssetInput, ...],
) -> HttpRequest:
    boundary = f"alystria-{secrets.token_hex(16)}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                str(value).encode(),
                b"\r\n",
            ]
        )
    for index, asset in enumerate(assets):
        data = _asset_bytes(asset)
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                (
                    f'Content-Disposition: form-data; name="{file_field}"; '
                    f'filename="asset-{index}"\r\n'
                ).encode(),
                f"Content-Type: {asset.media_type}\r\n\r\n".encode(),
                data,
                b"\r\n",
            ]
        )
    chunks.append(f"--{boundary}--\r\n".encode())
    return HttpRequest(
        "POST",
        path,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        body=b"".join(chunks),
    )


def _media_output(payload: dict[str, Any], provider_id: str | None = None) -> MediaOutput:
    if provider_id == "pexels":
        return _pexels_output(payload)
    candidates: list[dict[str, Any]] = []
    for key in ("data", "images", "results", "photos", "videos", "output", "assets"):
        value = payload.get(key)
        if isinstance(value, list):
            candidates.extend(item for item in value if isinstance(item, dict))
        elif isinstance(value, dict):
            nested = value.get("output") or value.get("results")
            if isinstance(nested, list):
                candidates.extend(item for item in nested if isinstance(item, dict))
            else:
                candidates.append(value)
    if not candidates:
        candidates = [payload]
    assets = tuple(asset for item in candidates if (asset := _asset_from_item(item)) is not None)
    return MediaOutput(assets, {"remoteResponseId": payload.get("id")})


def _pexels_output(payload: dict[str, Any]) -> MediaOutput:
    assets: list[MediaAsset] = []
    for photo in payload.get("photos", []):
        if not isinstance(photo, dict):
            continue
        source = _dictionary(photo.get("src"))
        uri = source.get("landscape") or source.get("large2x") or source.get("original")
        if not isinstance(uri, str):
            continue
        assets.append(
            MediaAsset(
                uri=uri,
                media_type="image/jpeg",
                width=_integer(photo.get("width")),
                height=_integer(photo.get("height")),
                license="Pexels",
                attribution=_string(photo.get("photographer")),
                source_url=_string(photo.get("url")),
            )
        )
    for video in payload.get("videos", []):
        if not isinstance(video, dict):
            continue
        files = [item for item in video.get("video_files", []) if isinstance(item, dict)]
        files.sort(
            key=lambda item: (
                (_integer(item.get("width")) or 0) * (_integer(item.get("height")) or 0)
            ),
            reverse=True,
        )
        if not files or not isinstance(files[0].get("link"), str):
            continue
        author = _dictionary(video.get("user"))
        assets.append(
            MediaAsset(
                uri=files[0]["link"],
                media_type=_string(files[0].get("file_type")),
                width=_integer(files[0].get("width")),
                height=_integer(files[0].get("height")),
                duration_seconds=_float(video.get("duration")),
                license="Pexels",
                attribution=_string(author.get("name")),
                source_url=_string(video.get("url")),
            )
        )
    return MediaOutput(tuple(assets), {"remoteResponseId": payload.get("id")})


def _asset_from_item(item: dict[str, Any]) -> MediaAsset | None:
    source = _dictionary(item.get("src"))
    uri = next(
        (
            value
            for value in (
                item.get("url"),
                item.get("uri"),
                item.get("video_url"),
                item.get("audio_url"),
                source.get("original"),
                source.get("large"),
            )
            if isinstance(value, str)
        ),
        None,
    )
    encoded = next(
        (
            value
            for key in ("b64_json", "base64", "data", "audioContent")
            if isinstance((value := item.get(key)), str) and not value.startswith("http")
        ),
        None,
    )
    if uri is None and encoded is None:
        return None
    return MediaAsset(
        uri=uri,
        data_base64=encoded,
        media_type=_string(item.get("mime_type")) or _string(item.get("media_type")),
        width=_integer(item.get("width")),
        height=_integer(item.get("height")),
        duration_seconds=_float(item.get("duration")),
        license=_string(item.get("license")),
        attribution=_string(item.get("attribution")) or _string(item.get("creator")),
        source_url=_string(item.get("foreign_landing_url")) or _string(item.get("source_url")),
    )


def _usage_from_payload(provider_id: str, model: str, payload: dict[str, Any]) -> Usage:
    usage = _dictionary(payload.get("usage"))
    units = {
        key: float(value)
        for key, value in usage.items()
        if isinstance(value, (int, float)) and not isinstance(value, bool)
    }
    cost_micros = usage.get("cost_micros")
    if not isinstance(cost_micros, int):
        cost = usage.get("cost")
        cost_micros = round(cost * 1_000_000) if isinstance(cost, (int, float)) else None
    return Usage(
        provider_id,
        model,
        units,
        cost_micros,
        request_id=_string(payload.get("id")),
    )


def _auth_headers(mode: AuthMode, credential: str | None) -> dict[str, str]:
    if mode is AuthMode.NONE:
        return {}
    value = credential or ""
    if mode is AuthMode.BEARER:
        return {"Authorization": f"Bearer {value}"}
    if mode is AuthMode.X_API_KEY:
        return {"X-Api-Key": value}
    if mode is AuthMode.X_GOOG_API_KEY:
        return {"x-goog-api-key": value}
    if mode is AuthMode.XI_API_KEY:
        return {"xi-api-key": value}
    if mode is AuthMode.AZURE_KEY:
        return {"Ocp-Apim-Subscription-Key": value}
    if mode is AuthMode.PEXELS:
        return {"Authorization": value}
    if mode is AuthMode.BFL:
        return {"x-key": value}
    raise AssertionError(mode)


def _normalise_state(value: str | None) -> OperationState:
    state = (value or "running").lower()
    if state in {"queued", "pending", "created", "starting"}:
        return OperationState.QUEUED
    if state in {"running", "processing", "in_progress", "in-progress"}:
        return OperationState.RUNNING
    if state in {"completed", "complete", "succeeded", "success", "ready", "done"}:
        return OperationState.SUCCEEDED
    if state in {"cancelled", "canceled", "aborted"}:
        return OperationState.CANCELLED
    return OperationState.FAILED


def _format_operation_url(base_url: str, template: str | None, operation_id: str) -> str | None:
    if template is None:
        return None
    if operation_id.startswith(("http://", "https://")):
        return operation_id
    formatted = template.format(id=operation_id)
    return f"{base_url.rstrip('/')}/{formatted.lstrip('/')}"


def _quantity(request: ProviderRequest) -> float | None:
    if isinstance(request, SpeechRequest):
        return float(len(request.text))
    if isinstance(request, MotionRequest):
        return request.duration_seconds
    if isinstance(request, (ImageRequest, MediaSearchRequest)):
        return 1.0
    return None


def _request_model(request: ProviderRequest) -> str:
    return getattr(request, "model", "licensed-media")


def _asset_bytes(asset: AssetInput) -> bytes:
    if asset.data_base64 is None:
        raise ProviderFailure(
            FailureCode.INVALID_REQUEST,
            "This provider requires an ingested inline asset, not a remote URI",
        )
    try:
        return base64.b64decode(asset.data_base64, validate=True)
    except ValueError as exc:
        raise ProviderFailure(FailureCode.INVALID_REQUEST, "Asset base64 is invalid") from exc


def _asset_base64(asset: AssetInput) -> str:
    if asset.data_base64 is None:
        raise ProviderFailure(FailureCode.INVALID_REQUEST, "Inline base64 asset is required")
    return asset.data_base64


def _inline_asset(asset: AssetInput) -> str:
    if asset.data_base64:
        return f"data:{asset.media_type};base64,{asset.data_base64}"
    assert asset.uri is not None
    return asset.uri


def _asset_uri(asset: AssetInput) -> str:
    if asset.uri is None:
        raise ProviderFailure(
            FailureCode.INVALID_REQUEST,
            "This provider requires a previously approved provider asset ID or URL",
        )
    return asset.uri


def _gemini_input(prompt: str, assets: tuple[AssetInput, ...]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    for asset in assets:
        if asset.data_base64:
            result.append(
                {"type": "media", "data": asset.data_base64, "mime_type": asset.media_type}
            )
        else:
            result.append({"type": "media", "uri": asset.uri, "mime_type": asset.media_type})
    return result


def _aspect_dimensions(ratio: str) -> dict[str, int]:
    return {
        "16:9": {"width": 1280, "height": 720},
        "9:16": {"width": 720, "height": 1280},
        "1:1": {"width": 1080, "height": 1080},
    }.get(ratio, {"width": 1280, "height": 720})


def _require_presenter_consent(request: PresenterRequest) -> None:
    if not request.consent_record_id:
        raise ProviderFailure(
            FailureCode.POLICY_BLOCKED,
            "Presenter generation requires an immutable consent record",
        )
    if not request.disclosure:
        raise ProviderFailure(
            FailureCode.POLICY_BLOCKED,
            "Presenter generation requires synthetic-media disclosure",
        )


def _path(value: dict[str, Any], path: str) -> Any:
    current: Any = value
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def _dictionary(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _string(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _integer(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _float(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return None
