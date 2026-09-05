from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

from alystria.audio import WordTiming
from alystria.audio.wav import WavFixtureSpec, generate_sine_wav
from alystria.generation import DeterministicMediaClient
from alystria.generation.narration_cache import (
    alignment_runtime_identity,
    fingerprint,
    load_cached_narration,
    narration_request_identity,
    store_cached_narration,
    synthesis_runtime_identity,
)
from alystria.project import ProjectStore


class VoicePinnedFixtureClient(DeterministicMediaClient):
    def __init__(
        self,
        voice: str,
        runtime_version: str = "fixture-runtime-a",
        model: str = "fixture-media-v1",
    ) -> None:
        self.voice = voice
        self.runtime_version = runtime_version
        self.model = model

    def narration_cache_runtime_identity(self) -> dict[str, object]:
        value: dict[str, object] = {
            "contract": "voice-pinned-test-v1",
            "selectedProvider": self.provider_id,
            "requestedModel": self.model,
            "requestedVoice": self.voice,
            "runtimeVersion": self.runtime_version,
            "synthesisControls": {"speed": 1.0},
        }
        return {**value, "runtimeIdentitySha256": fingerprint(value)}


def _identity(
    *,
    text: str,
    voice: str = "Aria",
    runtime: str = "runtime-a",
    model: str = "fixture-media-v1",
) -> dict[str, object]:
    synthesis = synthesis_runtime_identity(VoicePinnedFixtureClient(voice, runtime, model))
    alignment = alignment_runtime_identity(None)
    assert synthesis is not None and alignment is not None
    return narration_request_identity(
        scene_id="scene-1",
        authored_text=text,
        spoken_text=text,
        locale="en-US",
        seed=17,
        synthesis_runtime=synthesis,
        alignment_runtime=alignment,
    )


def test_cache_reuses_only_verified_exact_text_voice_and_runtime(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Narration cache", name="Narration cache")
    try:
        text = "A verified narration clip remains reusable."
        identity = _identity(text=text)
        content = generate_sine_wav(WavFixtureSpec(duration_ms=1_000, frequency_hz=220.0))
        artifact = store.add_artifact_bytes(
            content,
            media_type="audio/wav",
            original_name="scene-1.wav",
            metadata={
                "provider": "local-deterministic",
                "modelRevision": "fixture-media-v1",
                "sceneId": "scene-1",
                "textSha256": identity["spokenTextSha256"],
                "authoredTextSha256": identity["authoredTextSha256"],
                "voiceId": "Aria",
                "rightsStatus": "owned",
            },
        )
        words = [WordTiming("verified", 0, 450), WordTiming("clip", 450, 1_000)]
        store_cached_narration(
            store,
            request_identity=identity,
            audio_hash=artifact.hash,
            media_type="audio/wav",
            original_name="scene-1.wav",
            provider_id="local-deterministic",
            model_revision="fixture-media-v1",
            duration_ms=1_000,
            word_timings=[asdict(word) for word in words],
            alignment={
                "schemaVersion": 1,
                "status": "COMPLETE",
                "source": "provider-native",
                "engine": "fixture-clock-v1",
                "alignedTokenRatio": 1.0,
            },
            actual_cost_micros=240,
            usage_units={"characters": 46.0},
        )

        cached = load_cached_narration(store, identity)
        assert cached is not None
        assert cached.audio == content
        assert cached.origin_usage == {
            "providerInvoked": True,
            "actualCostMicros": 240,
            "usageUnits": {"characters": 46.0},
        }
        assert load_cached_narration(store, _identity(text=text + " Changed.")) is None
        assert load_cached_narration(store, _identity(text=text, voice="Guy")) is None
        assert load_cached_narration(store, _identity(text=text, model="fixture-media-v2")) is None
        assert load_cached_narration(store, _identity(text=text, runtime="runtime-b")) is None

        # An indexed record never authorizes corrupt bytes. The CAS hash is
        # verified again at lookup time instead of trusting its database row.
        store.cas.object_path(artifact.hash).write_bytes(b"RIFF-corrupt")
        assert load_cached_narration(store, identity) is None
    finally:
        store.close()


def test_cache_rejects_declared_audio_with_the_wrong_binary_format(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Narration format", name="Narration format")
    try:
        identity = _identity(text="Format evidence stays exact.")
        artifact = store.add_artifact_bytes(
            b"not-wave-audio",
            media_type="audio/wav",
            original_name="scene-1.wav",
            metadata={
                "provider": "local-deterministic",
                "modelRevision": "fixture-media-v1",
                "sceneId": "scene-1",
                "textSha256": identity["spokenTextSha256"],
                "authoredTextSha256": identity["authoredTextSha256"],
            },
        )
        try:
            store_cached_narration(
                store,
                request_identity=identity,
                audio_hash=artifact.hash,
                media_type="audio/wav",
                original_name="scene-1.wav",
                provider_id="local-deterministic",
                model_revision="fixture-media-v1",
                duration_ms=1_000,
                word_timings=[asdict(WordTiming("format", 0, 1_000))],
                alignment={
                    "schemaVersion": 1,
                    "status": "COMPLETE",
                    "source": "provider-native",
                    "engine": "fixture-clock-v1",
                },
                actual_cost_micros=0,
                usage_units={},
            )
        except ValueError as error:
            assert "declared media type" in str(error)
        else:  # pragma: no cover - a failing assertion gives a clearer message
            raise AssertionError("wrong-format narration was cached")
    finally:
        store.close()


def test_unknown_media_client_subclass_cannot_inherit_a_cache_contract() -> None:
    class UnreviewedNarrationTransform(DeterministicMediaClient):
        pass

    assert synthesis_runtime_identity(UnreviewedNarrationTransform()) is None
