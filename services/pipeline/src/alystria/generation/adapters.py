"""Provider and renderer boundaries used by the generation workflow."""

from __future__ import annotations

import base64
import hashlib
import html
import json
import os
import sys
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Protocol

from alystria.audio import (
    WINDOWS_SPEECH_MODEL,
    WindowsSpeechAdapter,
    WindowsSpeechAudio,
    WindowsSpeechCapabilities,
    WindowsSpeechUnavailableError,
    measure_wav,
)
from alystria.audio import SpeechRequest as AudioSpeechRequest
from alystria.audio.wav import WavFixtureSpec, generate_sine_wav
from alystria.providers import (
    Capability,
    ImageRequest,
    MediaOutput,
    ProviderMediaClient,
    ProviderRouter,
    ProviderRuntime,
    RequestContext,
    RoutingPolicy,
)
from alystria.providers import SpeechRequest as ProviderSpeechRequest


@dataclass(frozen=True, slots=True)
class GeneratedMedia:
    content: bytes
    media_type: str
    original_name: str
    provider_id: str
    model_revision: str
    metadata: dict[str, Any] = field(default_factory=dict)
    actual_cost_micros: int | None = 0
    usage_units: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RenderedTutorial:
    content: bytes
    media_type: str
    original_name: str
    manifest: dict[str, Any]
    metrics: dict[str, Any]


class GenerationMediaClient(Protocol):
    provider_id: str
    model_revision: str

    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia: ...

    def synthesize_narration(
        self, scene: dict[str, Any], *, locale: str, seed: int
    ) -> GeneratedMedia: ...

    def create_presenter(
        self,
        scene: dict[str, Any],
        *,
        narration_hash: str,
        seed: int,
    ) -> GeneratedMedia | None: ...


class RendererClient(Protocol):
    renderer_id: str
    renderer_version: str

    def render(self, request: dict[str, Any]) -> RenderedTutorial: ...


class WindowsNarrationAdapter(Protocol):
    def capabilities(self) -> WindowsSpeechCapabilities: ...

    def synthesize(self, request: AudioSpeechRequest) -> WindowsSpeechAudio: ...


class DeterministicMediaClient:
    """Zero-network fixture media with stable bytes and cleared synthetic rights."""

    provider_id = "local-deterministic"
    model_revision = "fixture-media-v1"

    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        scene_id = str(scene["id"])
        title = html.escape(str(scene["title"]))
        accent = hashlib.sha256(f"{scene_id}:{seed}".encode()).hexdigest()[:6]
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" '
            'viewBox="0 0 1920 1080">'
            '<rect width="1920" height="1080" fill="#F7F8FC"/>'
            f'<path d="M120 720 C480 240 960 840 1800 300" fill="none" stroke="#{accent}" '
            'stroke-width="16"/>'
            f'<text x="120" y="210" font-size="72" fill="#151827">{title}</text>'
            f'<text x="120" y="950" font-size="28" fill="#5658E8">{html.escape(scene_id)}</text>'
            "</svg>\n"
        ).encode()
        return GeneratedMedia(
            svg,
            "image/svg+xml",
            f"{scene_id}.svg",
            self.provider_id,
            self.model_revision,
            {"rightsStatus": "owned", "licenseId": "USER-OWNED", "seed": seed},
        )

    def synthesize_narration(
        self, scene: dict[str, Any], *, locale: str, seed: int
    ) -> GeneratedMedia:
        words = max(1, len(str(scene["narration"]).split()))
        duration_ms = max(800, min(4_000, words * 120))
        frequency = (
            180 + int(hashlib.sha256(f"{scene['id']}:{seed}".encode()).hexdigest()[:4], 16) % 220
        )
        content = generate_sine_wav(
            WavFixtureSpec(duration_ms=duration_ms, frequency_hz=float(frequency), amplitude=0.15)
        )
        tokens = str(scene["narration"]).split()
        word_timings = [
            {
                "word": token,
                "startMs": round(index * duration_ms / len(tokens)),
                "endMs": round((index + 1) * duration_ms / len(tokens)),
            }
            for index, token in enumerate(tokens)
        ]
        return GeneratedMedia(
            content,
            "audio/wav",
            f"{scene['id']}.wav",
            self.provider_id,
            self.model_revision,
            {
                "locale": locale,
                "sampleRateHz": 48_000,
                "channels": 1,
                "durationMs": duration_ms,
                "wordTimings": word_timings,
                "alignmentSource": "provider-native",
                "alignmentEngine": "deterministic-fixture-clock-v1",
                "rightsStatus": "owned",
            },
        )

    def create_presenter(
        self,
        scene: dict[str, Any],
        *,
        narration_hash: str,
        seed: int,
    ) -> GeneratedMedia | None:
        payload = json.dumps(
            {
                "sceneId": scene["id"],
                "narrationHash": narration_hash,
                "seed": seed,
                "synthetic": True,
                "disclosureRequired": True,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        return GeneratedMedia(
            payload,
            "application/vnd.alystria.presenter+json",
            f"{scene['id']}.presenter.json",
            self.provider_id,
            self.model_revision,
            {"rightsStatus": "owned", "synthetic": True},
        )


class WindowsFallbackMediaClient:
    """Deterministic local media with native Windows narration when available.

    Visual and presenter artifacts deliberately come from the unchanged
    deterministic client. If ``System.Speech`` disappears after factory
    selection, only an availability failure falls back to deterministic audio;
    cancellations, timeouts, and malformed output remain actionable failures.
    """

    provider_id = "local-windows-fallback"
    model_revision = f"{DeterministicMediaClient.model_revision}+{WINDOWS_SPEECH_MODEL}"

    def __init__(
        self,
        windows_speech: WindowsNarrationAdapter,
        *,
        deterministic: DeterministicMediaClient | None = None,
    ) -> None:
        self.windows_speech = windows_speech
        self.deterministic = deterministic or DeterministicMediaClient()

    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        return self.deterministic.create_visual(scene, seed=seed)

    def synthesize_narration(
        self, scene: dict[str, Any], *, locale: str, seed: int
    ) -> GeneratedMedia:
        scene_id = str(scene["id"])
        narration = str(scene["narration"])
        try:
            audio = self.windows_speech.synthesize(
                AudioSpeechRequest(
                    request_id=scene_id,
                    text=narration,
                    locale=locale,
                    deterministic_seed=seed,
                )
            )
        except WindowsSpeechUnavailableError as error:
            fallback = self.deterministic.synthesize_narration(scene, locale=locale, seed=seed)
            return GeneratedMedia(
                fallback.content,
                fallback.media_type,
                fallback.original_name,
                fallback.provider_id,
                fallback.model_revision,
                {
                    **fallback.metadata,
                    "fallbackReason": str(error),
                    "requestedProvider": self.provider_id,
                },
                fallback.actual_cost_micros,
                dict(fallback.usage_units),
            )
        return GeneratedMedia(
            audio.wav_bytes,
            "audio/wav",
            f"{scene_id}.wav",
            audio.provider_id,
            audio.model,
            {
                "locale": audio.locale,
                "voiceId": audio.voice_id,
                "sampleRateHz": audio.sample_rate_hz,
                "channels": audio.channels,
                "durationMs": audio.duration_ms,
                "rightsStatus": "owned",
                "localOnly": True,
                "fallbackEngine": True,
            },
            0,
            {"characters": float(len(narration))},
        )

    def create_presenter(
        self,
        scene: dict[str, Any],
        *,
        narration_hash: str,
        seed: int,
    ) -> GeneratedMedia | None:
        return self.deterministic.create_presenter(
            scene,
            narration_hash=narration_hash,
            seed=seed,
        )


def default_local_media_client(
    *,
    windows_speech: WindowsNarrationAdapter | None = None,
    platform_name: str | None = None,
) -> GenerationMediaClient:
    """Select native Windows narration only after a successful capability probe."""

    if windows_speech is None and platform_name is None:
        return _cached_default_local_media_client()
    return _select_default_local_media_client(
        windows_speech=windows_speech,
        platform_name=platform_name,
    )


@lru_cache(maxsize=1)
def _cached_default_local_media_client() -> GenerationMediaClient:
    return _select_default_local_media_client()


def _select_default_local_media_client(
    *,
    windows_speech: WindowsNarrationAdapter | None = None,
    platform_name: str | None = None,
) -> GenerationMediaClient:

    if os.environ.get("ALYSTRIA_MEDIA_MODE") == "fixture" and windows_speech is None:
        return DeterministicMediaClient()

    current_platform = platform_name or sys.platform
    if not current_platform.casefold().startswith("win"):
        return DeterministicMediaClient()
    adapter = windows_speech or WindowsSpeechAdapter(platform_name=current_platform)
    capability = adapter.capabilities()
    if not capability.available:
        return DeterministicMediaClient()
    return WindowsFallbackMediaClient(adapter)


class DeterministicRendererClient:
    renderer_id = "alystria-deterministic-renderer"
    renderer_version = "fixture-render-v1"

    def render(self, request: dict[str, Any]) -> RenderedTutorial:
        canonical = json.dumps(request, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(canonical.encode()).hexdigest()
        manifest = {
            "renderer": self.renderer_id,
            "rendererVersion": self.renderer_version,
            "requestDigest": digest,
            "sceneCount": len(request.get("scenes", [])),
            "targets": request.get("targets", []),
        }
        content = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
        return RenderedTutorial(
            content,
            "application/vnd.alystria.render+json",
            "tutorial.render.json",
            manifest,
            {
                "deterministic": True,
                "blankFrames": 0,
                "captionCollisions": 0,
                "clippedSamples": 0,
                "integratedLufs": -16.0,
                "truePeakDbtp": -1.5,
                "alignedTokenRatio": 1.0,
                "asrWer": 0.0,
                "avDriftFrames": 0.0,
            },
        )


class RouterMediaClient:
    """Production media boundary backed by an already-approved ProviderRouter.

    The client deliberately refuses remote URI-only output. Fetching provider
    URLs belongs in a separately policy-checked media worker, not this project
    writer. It also never changes provider after a failed invocation.
    """

    def __init__(
        self,
        router: ProviderRouter,
        *,
        policy: RoutingPolicy,
        context: RequestContext,
        image_model: str,
        speech_model: str,
        voice: str,
    ) -> None:
        self.router = router
        self.policy = policy
        self.context = context
        self.image_model = image_model
        self.speech_model = speech_model
        self.voice = voice
        self.provider_id = context.approved_provider_id
        self.model_revision = f"{image_model}+{speech_model}"

    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        result = self.router.invoke(
            ImageRequest(
                prompt=str(scene.get("visualIntent") or scene["title"]),
                model=self.image_model,
                seed=seed,
            ),
            self.context,
            self.policy,
            explicit_provider_id=self.provider_id,
        )
        return self._media(
            result.value,
            f"{scene['id']}.png",
            result.provider_id,
            result.model,
            result.usage.actual_cost_micros,
            result.usage.units,
        )

    def synthesize_narration(
        self, scene: dict[str, Any], *, locale: str, seed: int
    ) -> GeneratedMedia:
        del seed
        result = self.router.invoke(
            ProviderSpeechRequest(
                text=str(scene["narration"]),
                model=self.speech_model,
                voice=self.voice,
                locale=locale,
            ),
            self.context,
            self.policy,
            explicit_provider_id=self.provider_id,
        )
        return self._media(
            result.value,
            f"{scene['id']}.wav",
            result.provider_id,
            result.model,
            result.usage.actual_cost_micros,
            result.usage.units,
        )

    def create_presenter(
        self,
        scene: dict[str, Any],
        *,
        narration_hash: str,
        seed: int,
    ) -> GeneratedMedia | None:
        del scene, narration_hash, seed
        return None

    @staticmethod
    def _media(
        value: Any,
        name: str,
        provider_id: str,
        model: str,
        actual_cost_micros: int | None,
        usage_units: dict[str, float],
    ) -> GeneratedMedia:
        if not isinstance(value, MediaOutput) or not value.assets:
            raise ValueError("Provider returned no media assets")
        asset = value.assets[0]
        if asset.data_base64 is None:
            raise ValueError("URI-only provider output requires the guarded media-fetch worker")
        content = base64.b64decode(asset.data_base64, validate=True)
        media_type = asset.media_type or "application/octet-stream"
        declared_license = asset.license.strip() if isinstance(asset.license, str) else ""
        rights_verified = bool(
            declared_license and declared_license.casefold() not in {"unknown", "unverified"}
        )
        metadata: dict[str, Any] = {
            "origin": "generated",
            "rightsStatus": "verified" if rights_verified else "unknown",
            "licenseId": declared_license or "UNKNOWN",
            "attribution": asset.attribution,
            "sourceUri": asset.source_url,
        }
        # Timestamp-bearing providers and independently selected aligners may
        # attach a provider-neutral timing envelope. Keep it inert here; the
        # workflow performs strict bounds, coverage, and monotonicity checks
        # before any timing reaches captions or renderer actions.
        if isinstance(value.metadata, dict):
            for key in (
                "wordTimings",
                "alignment",
                "alignmentSource",
                "alignmentEngine",
            ):
                candidate = value.metadata.get(key)
                if candidate is not None:
                    metadata[key] = candidate
        metadata.update(_measured_audio_metadata(content, media_type, asset.duration_seconds))
        return GeneratedMedia(
            content,
            media_type,
            _media_name(name, asset.media_type),
            provider_id,
            model,
            metadata,
            actual_cost_micros,
            dict(usage_units),
        )


def _media_name(name: str, media_type: str | None) -> str:
    suffix = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "video/mp4": ".mp4",
        "audio/wav": ".wav",
        "audio/mpeg": ".mp3",
    }.get((media_type or "").casefold())
    if suffix is None:
        return name
    stem = name.rsplit(".", 1)[0] if "." in name else name
    return f"{stem}{suffix}"


def _measured_audio_metadata(
    content: bytes, media_type: str, provider_duration_seconds: float | None
) -> dict[str, Any]:
    """Measure provider audio bytes so timeline trims never use text estimates."""

    normalized = media_type.casefold()
    if normalized in {"audio/wav", "audio/x-wav"}:
        measurement = measure_wav(content)
        return {
            "durationMs": round(measurement.duration_ms),
            "sampleRateHz": measurement.sample_rate_hz,
            "channels": measurement.channels,
            "durationSource": "decoded-audio-frames",
        }
    if normalized == "audio/mpeg":
        duration_ms, sample_rate_hz = _measure_mp3_frames(content)
        return {
            "durationMs": duration_ms,
            "sampleRateHz": sample_rate_hz,
            "durationSource": "mpeg-audio-frames",
        }
    if (
        provider_duration_seconds is not None
        and provider_duration_seconds > 0
        and provider_duration_seconds < 86_400
    ):
        return {
            "durationMs": round(provider_duration_seconds * 1_000),
            "durationSource": "provider-metadata",
        }
    return {}


def _measure_mp3_frames(content: bytes) -> tuple[int, int]:
    """Return exact MPEG Layer III frame duration and sample rate.

    Duration is the sum of decoded samples rather than a bitrate/filesize
    estimate, so CBR, VBR, encoder delay, and long-form ElevenLabs responses
    receive the same authoritative timeline treatment.
    """

    if len(content) < 4:
        raise ValueError("Provider MP3 response is too short")
    offset = _id3v2_end(content)
    search_limit = min(len(content) - 4, offset + 64 * 1024)
    while offset <= search_limit and _mp3_frame(content, offset) is None:
        offset += 1
    frames = 0
    duration_seconds = 0.0
    sample_rate_hz: int | None = None
    while offset + 4 <= len(content):
        parsed = _mp3_frame(content, offset)
        if parsed is None:
            trailing = content[offset:]
            if trailing.startswith(b"TAG") and len(trailing) >= 128:
                break
            if not trailing.strip(b"\x00"):
                break
            raise ValueError("Provider MP3 response contains an invalid frame sequence")
        frame_bytes, frame_samples, frame_sample_rate = parsed
        if offset + frame_bytes > len(content):
            raise ValueError("Provider MP3 response ends inside an audio frame")
        if sample_rate_hz is None:
            sample_rate_hz = frame_sample_rate
        elif sample_rate_hz != frame_sample_rate:
            raise ValueError("Provider MP3 response changes sample rate mid-stream")
        duration_seconds += frame_samples / frame_sample_rate
        frames += 1
        offset += frame_bytes
    if frames < 2 or sample_rate_hz is None:
        raise ValueError("Provider MP3 response has no complete audio frame sequence")
    return round(duration_seconds * 1_000), sample_rate_hz


def _id3v2_end(content: bytes) -> int:
    if not content.startswith(b"ID3"):
        return 0
    if len(content) < 10 or any(value & 0x80 for value in content[6:10]):
        raise ValueError("Provider MP3 response has an invalid ID3 header")
    tag_size = sum(
        value << shift
        for value, shift in zip(content[6:10], (21, 14, 7, 0), strict=True)
    )
    footer_size = 10 if content[5] & 0x10 else 0
    end = 10 + tag_size + footer_size
    if end > len(content):
        raise ValueError("Provider MP3 response ends inside its ID3 tag")
    return end


def _mp3_frame(content: bytes, offset: int) -> tuple[int, int, int] | None:
    if offset + 4 > len(content):
        return None
    header = int.from_bytes(content[offset : offset + 4], "big")
    if header & 0xFFE00000 != 0xFFE00000:
        return None
    version = (header >> 19) & 0b11
    layer = (header >> 17) & 0b11
    bitrate_index = (header >> 12) & 0b1111
    sample_rate_index = (header >> 10) & 0b11
    padding = (header >> 9) & 1
    if version == 0b01 or layer != 0b01 or bitrate_index in {0, 15} or sample_rate_index == 3:
        return None
    base_sample_rate = (44_100, 48_000, 32_000)[sample_rate_index]
    sample_rate = base_sample_rate if version == 0b11 else base_sample_rate // (2 if version == 0b10 else 4)
    if version == 0b11:
        bitrate_kbps = (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320)[
            bitrate_index
        ]
        samples = 1_152
        frame_bytes = 144_000 * bitrate_kbps // sample_rate + padding
    else:
        bitrate_kbps = (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160)[
            bitrate_index
        ]
        samples = 576
        frame_bytes = 72_000 * bitrate_kbps // sample_rate + padding
    return frame_bytes, samples, sample_rate


class RuntimeGenerationMediaClient:
    """Generation media client with separately approved image and TTS routes.

    ``local-runtime`` narration is a composition route, not a provider
    failover.  It is used only when the persisted policy explicitly names the
    local runtime for TTS and pins the Windows System.Speech model.  A missing,
    unavailable, or differently configured local engine fails closed instead
    of crossing a provider or local/cloud boundary silently.
    """

    def __init__(
        self,
        runtime: ProviderRuntime,
        *,
        windows_speech: WindowsNarrationAdapter | None = None,
        local_fallback: GenerationMediaClient | None = None,
    ) -> None:
        self.runtime = runtime
        self.client = ProviderMediaClient(runtime)
        image_route = next(
            (
                route
                for route in runtime.policy.routes
                if route.capability is Capability.IMAGE_GENERATION
            ),
            None,
        )
        speech_route = next(
            (route for route in runtime.policy.routes if route.capability is Capability.TTS),
            None,
        )
        if image_route is None and local_fallback is None:
            raise ValueError("no approved route exists for image.generate")
        if speech_route is None and local_fallback is None:
            raise ValueError("no approved route exists for audio.tts")
        provider_ids = tuple(
            dict.fromkeys(
                (
                    *(image_route.provider_ids if image_route is not None else ()),
                    *(speech_route.provider_ids if speech_route is not None else ()),
                )
            )
        )
        self.provider_id = "approved:" + "+".join(provider_ids)
        self.model_revision = "+".join(
            route.model for route in (image_route, speech_route) if route is not None
        )
        self._local_fallback = local_fallback
        self._image_model = None if image_route is None else image_route.model
        self._image_provider_ids = () if image_route is None else image_route.provider_ids
        self._speech_model = None if speech_route is None else speech_route.model
        self._speech_provider_ids = () if speech_route is None else speech_route.provider_ids
        self._voice = "default" if speech_route is None else speech_route.voice or "default"
        self._local_narration: WindowsNarrationAdapter | None = None
        if (
            speech_route is not None
            and "local-runtime" in speech_route.provider_ids
            and local_fallback is None
        ):
            if speech_route.provider_ids != ("local-runtime",):
                raise ValueError(
                    "The local narration route must be an explicit single-provider route"
                )
            if speech_route.model != WINDOWS_SPEECH_MODEL:
                raise ValueError(
                    "The local narration route must pin "
                    f"{WINDOWS_SPEECH_MODEL!r}; no implicit local model substitution is allowed"
                )
            approval = runtime.policy.approval_for("local-runtime")
            if (
                approval.boundary.value != "local"
                or approval.retention.value != "local_only"
                or Capability.TTS not in approval.capabilities
            ):
                raise ValueError(
                    "The local narration route requires an approved local-only TTS boundary"
                )
            adapter = windows_speech or WindowsSpeechAdapter()
            capabilities = adapter.capabilities()
            if (
                not capabilities.available
                or not capabilities.local_only
                or capabilities.model != WINDOWS_SPEECH_MODEL
            ):
                reason = capabilities.reason or "the approved System.Speech engine is unavailable"
                raise WindowsSpeechUnavailableError(reason)
            selected_voice = None if self._voice == "default" else self._voice
            if selected_voice is not None and selected_voice not in {
                voice.voice_id for voice in capabilities.voices
            }:
                raise WindowsSpeechUnavailableError(
                    f"The approved Windows voice is not installed: {selected_voice}"
                )
            self._local_narration = adapter

    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        if self._image_provider_ids in {(), ("local-runtime",)}:
            if self._local_fallback is None:
                raise ValueError("The local image route has no installed local media runtime")
            return self._local_fallback.create_visual(scene, seed=seed)
        assert self._image_model is not None
        is_nvidia_flux_klein = self._image_model == "black-forest-labs/flux.2-klein-4b"
        # This explicitly audited NVIDIA preview endpoint accepts only its
        # documented square shape. The scene renderer places the returned asset
        # within the authored landscape composition; no provider/model fallback.
        result = self.client.generate(
            ImageRequest(
                prompt=(
                    str(scene.get("visualIntent") or scene["title"]).strip()
                    + "\n\nCreate a clean, text-free educational supporting illustration. "
                    "Do not render letters, numbers, equations, captions, interface text, "
                    "logos, watermarks, signatures, or pseudo-text. Reserve generous negative "
                    "space for Alystria's native typography and diagrams."
                ),
                model=self._image_model,
                aspect_ratio="1:1" if is_nvidia_flux_klein else "16:9",
                size="1024x1024" if is_nvidia_flux_klein else None,
                seed=seed,
            ),
            idempotency_key=self._idempotency("image", scene, seed),
        )
        return RouterMediaClient._media(
            result.value,
            f"{scene['id']}.png",
            result.provider_id,
            result.model,
            result.usage.actual_cost_micros,
            result.usage.units,
        )

    def synthesize_narration(
        self, scene: dict[str, Any], *, locale: str, seed: int
    ) -> GeneratedMedia:
        if self._speech_provider_ids in {(), ("local-runtime",)} and self._local_fallback is not None:
            return self._local_fallback.synthesize_narration(scene, locale=locale, seed=seed)
        if self._local_narration is not None:
            narration = str(scene["narration"])
            audio = self._local_narration.synthesize(
                AudioSpeechRequest(
                    request_id=str(scene["id"]),
                    text=narration,
                    locale=locale,
                    voice_id=None if self._voice == "default" else self._voice,
                    deterministic_seed=seed,
                )
            )
            return GeneratedMedia(
                audio.wav_bytes,
                "audio/wav",
                f"{scene['id']}.wav",
                audio.provider_id,
                audio.model,
                {
                    "locale": audio.locale,
                    "voiceId": audio.voice_id,
                    "sampleRateHz": audio.sample_rate_hz,
                    "channels": audio.channels,
                    "durationMs": audio.duration_ms,
                    "rightsStatus": "owned",
                    "localOnly": True,
                    "approvedRouteProvider": "local-runtime",
                    "approvedRouteModel": self._speech_model,
                },
                0,
                {"characters": float(len(narration))},
            )
        assert self._speech_model is not None
        result = self.client.generate(
            ProviderSpeechRequest(
                text=str(scene["narration"]),
                model=self._speech_model,
                voice=self._voice,
                locale=locale,
                speed=0.86 if self._speech_provider_ids == ("elevenlabs",) else 1.0,
            ),
            idempotency_key=self._idempotency("speech", scene, seed),
        )
        return RouterMediaClient._media(
            result.value,
            f"{scene['id']}.wav",
            result.provider_id,
            result.model,
            result.usage.actual_cost_micros,
            result.usage.units,
        )

    def create_presenter(
        self,
        scene: dict[str, Any],
        *,
        narration_hash: str,
        seed: int,
    ) -> GeneratedMedia | None:
        if self._local_fallback is None:
            return None
        return self._local_fallback.create_presenter(
            scene,
            narration_hash=narration_hash,
            seed=seed,
        )

    @staticmethod
    def _idempotency(kind: str, scene: dict[str, Any], seed: int) -> str:
        canonical = json.dumps(
            {"kind": kind, "sceneId": scene["id"], "seed": seed},
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(canonical.encode()).hexdigest()
