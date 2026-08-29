from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from alystria.audio import (
    WINDOWS_SPEECH_MODEL,
    WINDOWS_SPEECH_PROVIDER_ID,
    AudioStemSpec,
    SpeechRequest,
    WavFixtureSpec,
    WindowsSpeechAudio,
    WindowsSpeechCancelledError,
    WindowsSpeechCapabilities,
    WindowsSpeechUnavailableError,
    WindowsVoice,
    generate_sine_wav,
    measure_wav,
)
from alystria.generation import (
    DeterministicMediaClient,
    RuntimeGenerationMediaClient,
    WindowsFallbackMediaClient,
    default_local_media_client,
)
from alystria.providers import ProviderRuntimeFactory, parse_routing_policy


def _capabilities(*, available: bool = True) -> WindowsSpeechCapabilities:
    voice = WindowsVoice(
        "Microsoft Zira Desktop",
        "Microsoft Zira Desktop",
        "en-US",
        "Female",
        "Adult",
        "English fallback",
    )
    return WindowsSpeechCapabilities(
        available=available,
        provider_id=WINDOWS_SPEECH_PROVIDER_ID,
        model=WINDOWS_SPEECH_MODEL,
        fallback=True,
        local_only=True,
        sample_rate_hz=AudioStemSpec().sample_rate_hz,
        locales=("en-US",) if available else (),
        voices=(voice,) if available else (),
        reason=None if available else "System.Speech unavailable",
    )


@dataclass
class FakeWindowsSpeech:
    available: bool = True
    failure: Exception | None = None
    requests: list[SpeechRequest] = field(default_factory=list)

    def capabilities(self) -> WindowsSpeechCapabilities:
        return _capabilities(available=self.available)

    def synthesize(self, request: SpeechRequest) -> WindowsSpeechAudio:
        self.requests.append(request)
        if self.failure is not None:
            raise self.failure
        content = generate_sine_wav(
            WavFixtureSpec(duration_ms=650, frequency_hz=220, amplitude=0.2)
        )
        return WindowsSpeechAudio(
            request_id=request.request_id,
            provider_id=WINDOWS_SPEECH_PROVIDER_ID,
            model=WINDOWS_SPEECH_MODEL,
            voice_id="Microsoft Zira Desktop",
            locale=request.locale,
            wav_bytes=content,
            sample_rate_hz=48_000,
            channels=1,
            duration_ms=650,
        )


def _scene() -> dict[str, object]:
    return {
        "id": "scene-introduction",
        "title": "Binary search",
        "narration": "Binary search halves the remaining interval.",
    }


def _hybrid_media_policy(*, speech_model: str = WINDOWS_SPEECH_MODEL) -> dict[str, object]:
    return {
        "version": 1,
        "privacyMode": "hybrid",
        "dataClassification": "project",
        "budget": {
            "currency": "USD",
            "hardLimitMicros": 0,
            "requireKnownPricing": True,
            "approved": True,
        },
        "approvals": [
            {
                "providerId": "mock",
                "capabilities": ["image.generate"],
                "credentialRef": None,
                "boundary": "local",
                "retention": "local_only",
                "regions": ["local"],
                "dataClasses": ["project"],
                "privacyApproved": True,
                "retentionApproved": True,
                "regionApproved": True,
                "budgetApproved": True,
            },
            {
                "providerId": "local-runtime",
                "capabilities": ["audio.tts"],
                "credentialRef": None,
                "boundary": "local",
                "retention": "local_only",
                "regions": ["local"],
                "dataClasses": ["project"],
                "privacyApproved": True,
                "retentionApproved": True,
                "regionApproved": True,
                "budgetApproved": True,
            },
        ],
        "routes": [
            {
                "capability": "image.generate",
                "providerIds": ["mock"],
                "model": "mock-image-v1",
                "voice": None,
            },
            {
                "capability": "audio.tts",
                "providerIds": ["local-runtime"],
                "model": speech_model,
                "voice": "Microsoft Zira Desktop",
            },
        ],
    }


def _hybrid_runtime(policy: dict[str, object]):
    transports: list[str] = []
    runtime = ProviderRuntimeFactory(
        transport_factory=lambda provider_id: transports.append(provider_id)
    ).build(parse_routing_policy(policy))
    return runtime, transports


def test_factory_selects_deterministic_outside_windows() -> None:
    client = default_local_media_client(
        windows_speech=FakeWindowsSpeech(),
        platform_name="linux",
    )
    assert type(client) is DeterministicMediaClient


def test_factory_selects_windows_only_after_successful_capability_probe() -> None:
    unavailable = default_local_media_client(
        windows_speech=FakeWindowsSpeech(available=False),
        platform_name="win32",
    )
    available = default_local_media_client(
        windows_speech=FakeWindowsSpeech(),
        platform_name="win32",
    )
    assert type(unavailable) is DeterministicMediaClient
    assert isinstance(available, WindowsFallbackMediaClient)


def test_windows_client_keeps_visuals_and_presenters_deterministic() -> None:
    baseline = DeterministicMediaClient()
    client = WindowsFallbackMediaClient(FakeWindowsSpeech())
    scene = _scene()

    assert client.create_visual(scene, seed=19) == baseline.create_visual(scene, seed=19)
    assert client.create_presenter(
        scene,
        narration_hash="sha256:narration",
        seed=19,
    ) == baseline.create_presenter(
        scene,
        narration_hash="sha256:narration",
        seed=19,
    )


def test_windows_client_returns_measured_local_narration_metadata() -> None:
    speech = FakeWindowsSpeech()
    client = WindowsFallbackMediaClient(speech)
    generated = client.synthesize_narration(_scene(), locale="en-US", seed=41)

    assert len(speech.requests) == 1
    assert speech.requests[0].request_id == "scene-introduction"
    assert speech.requests[0].deterministic_seed == 41
    assert generated.provider_id == WINDOWS_SPEECH_PROVIDER_ID
    assert generated.model_revision == WINDOWS_SPEECH_MODEL
    assert generated.actual_cost_micros == 0
    assert generated.metadata == {
        "locale": "en-US",
        "voiceId": "Microsoft Zira Desktop",
        "sampleRateHz": 48_000,
        "channels": 1,
        "durationMs": 650,
        "rightsStatus": "owned",
        "localOnly": True,
        "fallbackEngine": True,
    }
    measured = measure_wav(generated.content)
    assert measured.sample_rate_hz == 48_000
    assert measured.channels == 1
    assert measured.duration_ms == 650
    assert measured.clipped_sample_count == 0
    assert not measured.is_digital_silence


def test_runtime_unavailability_falls_back_but_cancellation_is_not_hidden() -> None:
    unavailable = WindowsFallbackMediaClient(
        FakeWindowsSpeech(failure=WindowsSpeechUnavailableError("voice removed"))
    )
    generated = unavailable.synthesize_narration(_scene(), locale="en-US", seed=7)
    assert generated.provider_id == DeterministicMediaClient.provider_id
    assert generated.metadata["requestedProvider"] == WindowsFallbackMediaClient.provider_id
    assert generated.metadata["fallbackReason"] == "voice removed"

    cancelled = WindowsFallbackMediaClient(
        FakeWindowsSpeech(failure=WindowsSpeechCancelledError("cancelled"))
    )
    with pytest.raises(WindowsSpeechCancelledError, match="cancelled"):
        cancelled.synthesize_narration(_scene(), locale="en-US", seed=7)


def test_runtime_client_composes_only_explicit_local_narration_route() -> None:
    runtime, transports = _hybrid_runtime(_hybrid_media_policy())
    speech = FakeWindowsSpeech()
    client = RuntimeGenerationMediaClient(runtime, windows_speech=speech)

    visual = client.create_visual(_scene(), seed=11)
    narration = client.synthesize_narration(_scene(), locale="en-US", seed=12)

    assert transports == []
    assert visual.provider_id == "mock"
    assert narration.provider_id == WINDOWS_SPEECH_PROVIDER_ID
    assert narration.model_revision == WINDOWS_SPEECH_MODEL
    assert narration.actual_cost_micros == 0
    assert narration.metadata["approvedRouteProvider"] == "local-runtime"
    assert narration.metadata["approvedRouteModel"] == WINDOWS_SPEECH_MODEL
    assert narration.metadata["localOnly"] is True
    assert speech.requests[0].voice_id == "Microsoft Zira Desktop"
    assert client.provider_id == "approved:mock+local-runtime"


def test_runtime_client_rejects_unapproved_local_model_substitution() -> None:
    runtime, _ = _hybrid_runtime(_hybrid_media_policy(speech_model="some-other-local-tts"))

    with pytest.raises(ValueError, match="no implicit local model substitution"):
        RuntimeGenerationMediaClient(runtime, windows_speech=FakeWindowsSpeech())


def test_runtime_client_rejects_unavailable_approved_local_narration() -> None:
    runtime, _ = _hybrid_runtime(_hybrid_media_policy())

    with pytest.raises(WindowsSpeechUnavailableError, match=r"System\.Speech unavailable"):
        RuntimeGenerationMediaClient(
            runtime,
            windows_speech=FakeWindowsSpeech(available=False),
        )
