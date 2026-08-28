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
    WindowsFallbackMediaClient,
    default_local_media_client,
)


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
