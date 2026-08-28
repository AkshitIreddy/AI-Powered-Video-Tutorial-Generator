"""Provider and renderer boundaries used by the generation workflow."""

from __future__ import annotations

import base64
import hashlib
import html
import json
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
        return GeneratedMedia(
            base64.b64decode(asset.data_base64, validate=True),
            asset.media_type or "application/octet-stream",
            name,
            provider_id,
            model,
            {
                "license": asset.license,
                "attribution": asset.attribution,
                "sourceUrl": asset.source_url,
            },
            actual_cost_micros,
            dict(usage_units),
        )


class RuntimeGenerationMediaClient:
    """Generation media client with separately approved image and TTS routes."""

    def __init__(self, runtime: ProviderRuntime) -> None:
        self.runtime = runtime
        self.client = ProviderMediaClient(runtime)
        image_route = runtime.policy.route_for(Capability.IMAGE_GENERATION)
        speech_route = runtime.policy.route_for(Capability.TTS)
        provider_ids = tuple(dict.fromkeys((*image_route.provider_ids, *speech_route.provider_ids)))
        self.provider_id = "approved:" + "+".join(provider_ids)
        self.model_revision = f"{image_route.model}+{speech_route.model}"
        self._image_model = image_route.model
        self._speech_model = speech_route.model
        self._voice = speech_route.voice or "default"

    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        result = self.client.generate(
            ImageRequest(
                prompt=str(scene.get("visualIntent") or scene["title"]),
                model=self._image_model,
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
        result = self.client.generate(
            ProviderSpeechRequest(
                text=str(scene["narration"]),
                model=self._speech_model,
                voice=self._voice,
                locale=locale,
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
        del scene, narration_hash, seed
        return None

    @staticmethod
    def _idempotency(kind: str, scene: dict[str, Any], seed: int) -> str:
        canonical = json.dumps(
            {"kind": kind, "sceneId": scene["id"], "seed": seed},
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(canonical.encode()).hexdigest()
