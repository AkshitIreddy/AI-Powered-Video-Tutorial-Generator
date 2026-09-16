"""Verified project-local reuse records for synthesized narration clips.

The cache deliberately stores no filesystem path.  Its dependency-node index
points to an immutable JSON record in the project's CAS, and that record points
to an independently registered audio artifact.  A lookup verifies both hashes,
their registry metadata, and the complete synthesis identity before returning
bytes to the workflow.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from alystria.jobs import DependencyGraph
from alystria.project import ProjectStore

NARRATION_CACHE_SCHEMA = "alystria.narration-clip-cache.v1"
NARRATION_CACHE_MEDIA_TYPE = "application/vnd.alystria.narration-clip-cache+json"
NARRATION_NORMALIZATION_VERSION = "english-spoken-text-v4-contextual-en-dash"
MAX_CACHE_RECORD_BYTES = 2 * 1024 * 1024
MAX_CACHED_AUDIO_BYTES = 512 * 1024 * 1024
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def fingerprint(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


@dataclass(frozen=True, slots=True)
class CachedNarrationClip:
    cache_record_hash: str
    request_identity_hash: str
    audio_hash: str
    audio: bytes
    media_type: str
    original_name: str
    provider_id: str
    model_revision: str
    media_metadata: dict[str, Any]
    duration_ms: int
    word_timings: tuple[dict[str, Any], ...]
    alignment: dict[str, Any]
    origin_usage: dict[str, Any]


def narration_request_identity(
    *,
    scene_id: str,
    authored_text: str,
    spoken_text: str,
    locale: str,
    seed: int,
    synthesis_runtime: Mapping[str, Any],
    alignment_runtime: Mapping[str, Any],
    voice_id: str | None = None,
) -> dict[str, Any]:
    """Create the exact, closed identity used before a provider invocation."""

    checked_synthesis = _closed_runtime_identity(synthesis_runtime)
    checked_alignment = _closed_runtime_identity(alignment_runtime)
    if checked_synthesis is None or checked_alignment is None:
        raise ValueError("Narration cache identity requires pinned synthesis and timing runtimes")
    identity = {
        "schema": NARRATION_CACHE_SCHEMA,
        "normalizationVersion": NARRATION_NORMALIZATION_VERSION,
        "sceneId": scene_id,
        "authoredTextSha256": hashlib.sha256(authored_text.encode()).hexdigest(),
        "spokenTextSha256": hashlib.sha256(spoken_text.encode()).hexdigest(),
        "locale": locale,
        "seed": seed,
        "synthesisRuntime": checked_synthesis,
        "alignmentRuntime": checked_alignment,
        **({"voiceId": voice_id.strip()} if isinstance(voice_id, str) and voice_id.strip() else {}),
    }
    # Round-trip through canonical JSON both proves serializability and strips
    # custom Mapping implementations from the durable contract.
    loaded = json.loads(canonical_json(identity))
    if not isinstance(loaded, dict):  # pragma: no cover - structurally impossible
        raise ValueError("Narration cache identity must be an object")
    return loaded


def synthesis_runtime_identity(media_client: Any) -> dict[str, Any] | None:
    """Return a pre-invocation identity only for fully understood TTS routes."""

    override = getattr(media_client, "narration_cache_runtime_identity", None)
    if callable(override):
        value = override()
        return _closed_runtime_identity(value)

    # Keep adapter imports local so this storage module stays outside adapter
    # construction and can be exercised independently.
    from .adapters import (
        DeterministicMediaClient,
        RouterMediaClient,
        RuntimeGenerationMediaClient,
        WindowsFallbackMediaClient,
    )

    if type(media_client) is WindowsFallbackMediaClient:
        # The system default voice can change between attempts.  Its actual
        # voice ID is only known after synthesis, so pre-invocation reuse is
        # intentionally disabled for this adapter.
        return None
    if type(media_client) is RuntimeGenerationMediaClient:
        fallback = media_client._local_fallback
        if media_client._speech_provider_ids in {(), ("local-runtime",)} and fallback is not None:
            base = synthesis_runtime_identity(fallback)
            if base is None:
                return None
            return _runtime_identity(
                {
                    "contract": "runtime-approved-local-fallback-v1",
                    "routeProviderIds": list(media_client._speech_provider_ids),
                    "requestedModel": media_client._speech_model,
                    "requestedVoice": media_client._voice,
                    "policySha256": fingerprint(media_client.runtime.policy.to_dict()),
                    "fallback": base,
                }
            )
        if media_client._local_narration is not None:
            if media_client._voice == "default":
                return None
            return _runtime_identity(
                {
                    "contract": "windows-system-speech-v1",
                    "selectedProvider": "local-runtime",
                    "requestedModel": media_client._speech_model,
                    "requestedVoice": media_client._voice,
                    "synthesisControls": {"rate": "adapter-default"},
                    "policySha256": fingerprint(media_client.runtime.policy.to_dict()),
                }
            )
        if not media_client._speech_provider_ids or media_client._speech_model is None:
            return None
        return _runtime_identity(
            {
                "contract": "provider-runtime-tts-v1",
                "selectedProvider": media_client._speech_provider_ids[0],
                "routeProviderIds": list(media_client._speech_provider_ids),
                "requestedModel": media_client._speech_model,
                "requestedVoice": media_client._voice,
                "synthesisControls": {
                    "speed": 0.86
                    if media_client._speech_provider_ids == ("elevenlabs",)
                    else 1.0
                },
                "policySha256": fingerprint(media_client.runtime.policy.to_dict()),
            }
        )
    if type(media_client) is RouterMediaClient:
        context = media_client.context
        policy = media_client.policy
        return _runtime_identity(
            {
                "contract": "provider-router-tts-v1",
                "selectedProvider": context.approved_provider_id,
                "routeProviderIds": list(policy.approved_provider_ids),
                "requestedModel": media_client.speech_model,
                "requestedVoice": media_client.voice,
                "synthesisControls": {"speed": 1.0},
                "approval": {
                    "boundary": None
                    if context.approved_boundary is None
                    else context.approved_boundary.value,
                    "retention": None
                    if context.approved_retention is None
                    else context.approved_retention.value,
                    "region": context.approved_region,
                    "metadata": dict(context.metadata),
                },
            }
        )
    if type(media_client) is DeterministicMediaClient:
        return _runtime_identity(
            {
                "contract": "deterministic-sine-narration-v1",
                "selectedProvider": media_client.provider_id,
                "requestedModel": media_client.model_revision,
                "requestedVoice": "deterministic-sine",
                "implementationClass": (
                    f"{type(media_client).__module__}.{type(media_client).__qualname__}"
                ),
                "synthesisControls": {
                    "sampleRateHz": 48_000,
                    "channels": 1,
                    "amplitude": 0.15,
                    "durationAlgorithm": "bounded-word-count-120ms-v1",
                    "frequencyAlgorithm": "scene-seed-sha256-v1",
                },
            }
        )
    from .local_presenter import LocalPresenterMediaClient

    if type(media_client) is LocalPresenterMediaClient:
        # This exact decorator delegates TTS byte-for-byte to ``base``; its
        # presenter runtime cannot alter narration synthesis.
        return synthesis_runtime_identity(media_client.base)
    return None


def alignment_runtime_identity(alignment_client: Any) -> dict[str, Any] | None:
    """Authenticate the selected aligner without storing host filesystem paths."""

    if alignment_client is None:
        return _runtime_identity({"contract": "provider-or-duration-timing-v1"})
    override = getattr(alignment_client, "narration_cache_runtime_identity", None)
    if callable(override):
        return _closed_runtime_identity(override())
    from .forced_alignment import DeferredPinnedOnnxCtcAligner, PinnedOnnxCtcAligner

    if type(alignment_client) is DeferredPinnedOnnxCtcAligner:
        try:
            config = alignment_client.config_path.read_bytes()
            # The loader revalidates containment and every configured runtime
            # hash.  It does not load the model or run a worker.
            from .forced_alignment import load_pinned_onnx_ctc_aligner

            resolved = load_pinned_onnx_ctc_aligner(
                alignment_client.store, alignment_client.config_path
            )
        except (OSError, RuntimeError, ValueError):
            return None
        return _pinned_aligner_identity(resolved, hashlib.sha256(config).hexdigest())
    if type(alignment_client) is PinnedOnnxCtcAligner:
        return _pinned_aligner_identity(alignment_client, None)
    return None


def _pinned_aligner_identity(client: Any, config_hash: str | None) -> dict[str, Any]:
    runtime = client.runtime
    return _runtime_identity(
        {
            "contract": "onnx-ctc-forced-alignment-v1",
            "configSha256": config_hash,
            "pythonSha256": runtime.python.sha256,
            "workerSha256": runtime.worker.sha256,
            "modelSha256": runtime.model.sha256,
            "vocabSha256": runtime.vocab.sha256,
            "timeoutSeconds": runtime.timeout_seconds,
        }
    )


def _runtime_identity(value: Mapping[str, Any]) -> dict[str, Any]:
    canonical = json.loads(canonical_json(dict(value)))
    if not isinstance(canonical, dict):  # pragma: no cover - structurally impossible
        raise ValueError("Narration runtime identity must be an object")
    canonical["runtimeIdentitySha256"] = fingerprint(canonical)
    return canonical


def _closed_runtime_identity(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise ValueError("Narration cache runtime identity must be an object")
    identity = json.loads(canonical_json(dict(value)))
    if not isinstance(identity, dict) or not isinstance(
        identity.get("runtimeIdentitySha256"), str
    ):
        raise ValueError("Narration cache runtime identity requires its runtime hash")
    claimed = str(identity.pop("runtimeIdentitySha256"))
    if claimed != fingerprint(identity):
        raise ValueError("Narration cache runtime identity hash is invalid")
    identity["runtimeIdentitySha256"] = claimed
    return identity


def load_cached_narration(
    store: ProjectStore,
    request_identity: Mapping[str, Any],
) -> CachedNarrationClip | None:
    identity = json.loads(canonical_json(dict(request_identity)))
    if not isinstance(identity, dict) or not _valid_request_identity(identity):
        return None
    identity_hash = fingerprint(identity)
    logical_key = _logical_key(identity_hash)
    node = store.connection.execute(
        """SELECT fingerprint,state,artifact_hash FROM dependency_nodes
           WHERE project_id=? AND logical_key=?""",
        (store.manifest.project_id, logical_key),
    ).fetchone()
    if (
        node is None
        or node["state"] != "CURRENT"
        or not isinstance(node["artifact_hash"], str)
        or not _SHA256.fullmatch(str(node["artifact_hash"]))
        or node["fingerprint"] != node["artifact_hash"]
    ):
        return None
    record_hash = str(node["artifact_hash"])
    record_row = store.connection.execute(
        "SELECT byte_size,media_type,metadata_json FROM artifacts WHERE hash=?",
        (record_hash,),
    ).fetchone()
    if (
        record_row is None
        or record_row["media_type"] != NARRATION_CACHE_MEDIA_TYPE
        or not isinstance(record_row["byte_size"], int)
        or not 0 < int(record_row["byte_size"]) <= MAX_CACHE_RECORD_BYTES
        or not store.cas.verify(record_hash)
    ):
        return None
    try:
        record_metadata = json.loads(str(record_row["metadata_json"]))
        with store.cas.open(record_hash) as stream:
            record_bytes = stream.read(MAX_CACHE_RECORD_BYTES + 1)
        if len(record_bytes) > MAX_CACHE_RECORD_BYTES:
            return None
        record = json.loads(record_bytes.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if (
        not isinstance(record_metadata, dict)
        or record_metadata.get("schema") != NARRATION_CACHE_SCHEMA
        or record_metadata.get("requestIdentityHash") != identity_hash
        or not isinstance(record, dict)
        or record.get("schema") != NARRATION_CACHE_SCHEMA
        or record.get("requestIdentity") != identity
        or record.get("requestIdentityHash") != identity_hash
    ):
        return None
    if len(record_bytes) != int(record_row["byte_size"]):
        return None

    audio_value = record.get("audio")
    if not isinstance(audio_value, dict):
        return None
    audio_hash = audio_value.get("artifactHash")
    media_type = audio_value.get("mediaType")
    original_name = audio_value.get("originalName")
    provider_id = audio_value.get("providerId")
    model_revision = audio_value.get("modelRevision")
    if (
        not isinstance(audio_hash, str)
        or not _SHA256.fullmatch(audio_hash)
        or not isinstance(media_type, str)
        or not media_type.startswith("audio/")
        or not isinstance(original_name, str)
        or not original_name
        or not isinstance(provider_id, str)
        or not provider_id
        or not isinstance(model_revision, str)
        or not model_revision
    ):
        return None
    audio_row = store.connection.execute(
        "SELECT byte_size,media_type,original_name,metadata_json FROM artifacts WHERE hash=?",
        (audio_hash,),
    ).fetchone()
    if (
        audio_row is None
        or audio_row["media_type"] != media_type
        or audio_row["byte_size"] != audio_value.get("byteSize")
        or not isinstance(audio_row["byte_size"], int)
        or not 0 < int(audio_row["byte_size"]) <= MAX_CACHED_AUDIO_BYTES
        or audio_row["original_name"] != original_name
        or not store.cas.verify(audio_hash)
    ):
        return None
    try:
        audio_metadata = json.loads(str(audio_row["metadata_json"]))
    except json.JSONDecodeError:
        return None
    if (
        not isinstance(audio_metadata, dict)
        or fingerprint(audio_metadata) != audio_value.get("metadataSha256")
        or audio_metadata.get("provider") != provider_id
        or audio_metadata.get("modelRevision") != model_revision
        or audio_metadata.get("sceneId") != identity.get("sceneId")
        or audio_metadata.get("textSha256") != identity.get("spokenTextSha256")
        or audio_metadata.get("authoredTextSha256") != identity.get("authoredTextSha256")
        or (
            identity.get("voiceId") is not None
            and audio_metadata.get("voiceId") != identity.get("voiceId")
        )
        or record_metadata.get("audioArtifactHash") != audio_hash
    ):
        return None

    duration_ms = record.get("durationMs")
    words = record.get("wordTimings")
    alignment = record.get("alignment")
    origin_usage = record.get("originUsage")
    if (
        not isinstance(duration_ms, int)
        or isinstance(duration_ms, bool)
        or duration_ms <= 0
        or not _valid_word_timings(words, duration_ms)
        or not _valid_alignment(alignment)
        or not _valid_origin_usage(origin_usage)
    ):
        return None
    assert isinstance(words, list)
    assert isinstance(alignment, dict)
    assert isinstance(origin_usage, dict)
    try:
        with store.cas.open(audio_hash) as stream:
            audio = stream.read()
    except OSError:
        return None
    if len(audio) != int(audio_row["byte_size"]) or not _matches_audio_format(
        audio, media_type
    ):
        return None
    return CachedNarrationClip(
        cache_record_hash=record_hash,
        request_identity_hash=identity_hash,
        audio_hash=audio_hash,
        audio=audio,
        media_type=media_type,
        original_name=original_name,
        provider_id=provider_id,
        model_revision=model_revision,
        media_metadata=audio_metadata,
        duration_ms=duration_ms,
        word_timings=tuple(dict(item) for item in words),
        alignment=dict(alignment),
        origin_usage=dict(origin_usage),
    )


def store_cached_narration(
    store: ProjectStore,
    *,
    request_identity: Mapping[str, Any],
    audio_hash: str,
    media_type: str,
    original_name: str,
    provider_id: str,
    model_revision: str,
    duration_ms: int,
    word_timings: list[dict[str, Any]],
    alignment: Mapping[str, Any],
    actual_cost_micros: int | None,
    usage_units: Mapping[str, float],
) -> str:
    """Persist a verified clip record before whole-storyboard pacing checks."""

    identity = json.loads(canonical_json(dict(request_identity)))
    if not isinstance(identity, dict) or not _valid_request_identity(identity):
        raise ValueError("Narration cache request identity is invalid")
    identity_hash = fingerprint(identity)
    audio_row = store.connection.execute(
        "SELECT byte_size,media_type,metadata_json FROM artifacts WHERE hash=?",
        (audio_hash,),
    ).fetchone()
    if (
        audio_row is None
        or audio_row["media_type"] != media_type
        or not store.cas.verify(audio_hash)
    ):
        raise ValueError("Narration cache requires a registered, verified CAS audio artifact")
    audio_metadata = json.loads(str(audio_row["metadata_json"]))
    if (
        not isinstance(audio_metadata, dict)
        or audio_metadata.get("provider") != provider_id
        or audio_metadata.get("modelRevision") != model_revision
    ):
        raise ValueError("Narration cache audio provenance does not match the synthesis result")
    with store.cas.open(audio_hash) as stream:
        audio_header = stream.read(4_096)
    if not _matches_audio_format(audio_header, media_type):
        raise ValueError("Narration cache audio bytes do not match their declared media type")
    if not _valid_word_timings(word_timings, duration_ms) or not _valid_alignment(alignment):
        raise ValueError("Narration cache timing evidence is invalid")
    origin_usage = {
        "providerInvoked": True,
        "actualCostMicros": actual_cost_micros,
        "usageUnits": dict(usage_units),
    }
    if not _valid_origin_usage(origin_usage):
        raise ValueError("Narration cache usage provenance is invalid")
    record = {
        "schema": NARRATION_CACHE_SCHEMA,
        "requestIdentity": identity,
        "requestIdentityHash": identity_hash,
        "audio": {
            "artifactHash": audio_hash,
            "byteSize": int(audio_row["byte_size"]),
            "mediaType": media_type,
            "originalName": original_name,
            "providerId": provider_id,
            "modelRevision": model_revision,
            "metadataSha256": fingerprint(audio_metadata),
        },
        "durationMs": duration_ms,
        "wordTimings": word_timings,
        "alignment": dict(alignment),
        "originUsage": origin_usage,
    }
    record_bytes = canonical_json(record).encode()
    if len(record_bytes) > MAX_CACHE_RECORD_BYTES:
        raise ValueError("Narration cache record exceeds its bounded size")
    artifact = store.add_artifact_bytes(
        record_bytes,
        media_type=NARRATION_CACHE_MEDIA_TYPE,
        original_name=f"narration-{identity_hash[:16]}.cache.json",
        metadata={
            "schema": NARRATION_CACHE_SCHEMA,
            "requestIdentityHash": identity_hash,
            "audioArtifactHash": audio_hash,
            "rightsStatus": audio_metadata.get("rightsStatus", "unknown"),
        },
    )
    DependencyGraph(store.connection, store.manifest.project_id).record_node(
        _logical_key(identity_hash),
        artifact.hash,
        artifact_hash=artifact.hash,
    )
    return artifact.hash


def _logical_key(identity_hash: str) -> str:
    return f"narration-cache:{identity_hash}"


def _valid_request_identity(value: dict[str, Any]) -> bool:
    if (
        value.get("schema") != NARRATION_CACHE_SCHEMA
        or value.get("normalizationVersion") != NARRATION_NORMALIZATION_VERSION
        or not isinstance(value.get("sceneId"), str)
        or not str(value["sceneId"]).strip()
        or not isinstance(value.get("locale"), str)
        or not str(value["locale"]).strip()
        or not isinstance(value.get("seed"), int)
        or isinstance(value.get("seed"), bool)
        or not isinstance(value.get("authoredTextSha256"), str)
        or not _SHA256.fullmatch(str(value["authoredTextSha256"]))
        or not isinstance(value.get("spokenTextSha256"), str)
        or not _SHA256.fullmatch(str(value["spokenTextSha256"]))
        or (
            value.get("voiceId") is not None
            and (
                not isinstance(value.get("voiceId"), str)
                or not str(value["voiceId"]).strip()
                or len(str(value["voiceId"])) > 256
                or not str(value["voiceId"]).isprintable()
            )
        )
    ):
        return False
    try:
        synthesis = _closed_runtime_identity(value.get("synthesisRuntime"))
        alignment = _closed_runtime_identity(value.get("alignmentRuntime"))
    except (TypeError, ValueError):
        return False
    return synthesis == value.get("synthesisRuntime") and alignment == value.get(
        "alignmentRuntime"
    )


def _valid_word_timings(value: Any, duration_ms: int) -> bool:
    if not isinstance(value, list) or not 0 < len(value) <= 4_096:
        return False
    previous_start = -1
    for item in value:
        if not isinstance(item, dict):
            return False
        token = item.get("token", item.get("word"))
        start = item.get("start_ms", item.get("startMs"))
        end = item.get("end_ms", item.get("endMs"))
        confidence = item.get("confidence")
        if (
            not isinstance(token, str)
            or not token.strip()
            or not isinstance(start, int)
            or isinstance(start, bool)
            or not isinstance(end, int)
            or isinstance(end, bool)
            or start < 0
            or start < previous_start
            or end <= start
            or end > duration_ms
            or (
                confidence is not None
                and (
                    not isinstance(confidence, int | float)
                    or isinstance(confidence, bool)
                    or not 0 <= float(confidence) <= 1
                )
            )
        ):
            return False
        previous_start = start
    return True


def _valid_alignment(value: Any) -> bool:
    if not (
        isinstance(value, dict)
        and value.get("schemaVersion") == 1
        and value.get("status") in {"COMPLETE", "PARTIAL", "ESTIMATED"}
        and value.get("source")
        in {"provider-native", "forced-alignment", "duration-proportional"}
        and isinstance(value.get("engine"), str)
        and bool(str(value["engine"]).strip())
    ):
        return False
    ratio = value.get("alignedTokenRatio")
    if value.get("status") == "ESTIMATED":
        return ratio is None
    return (
        isinstance(ratio, int | float)
        and not isinstance(ratio, bool)
        and math.isfinite(ratio)
        and 0 <= ratio <= 1
    )


def _valid_origin_usage(value: Any) -> bool:
    if not isinstance(value, dict) or value.get("providerInvoked") is not True:
        return False
    cost = value.get("actualCostMicros")
    units = value.get("usageUnits")
    return (
        (cost is None or (isinstance(cost, int) and not isinstance(cost, bool) and cost >= 0))
        and isinstance(units, dict)
        and all(
            isinstance(key, str)
            and isinstance(quantity, int | float)
            and not isinstance(quantity, bool)
            and math.isfinite(quantity)
            and quantity >= 0
            for key, quantity in units.items()
        )
    )


def _matches_audio_format(content: bytes, media_type: str) -> bool:
    normalized = media_type.casefold().split(";", 1)[0].strip()
    if normalized in {"audio/wav", "audio/x-wav"}:
        return len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WAVE"
    if normalized in {"audio/mpeg", "audio/mp3"}:
        return content.startswith(b"ID3") or (
            len(content) >= 2 and content[0] == 0xFF and content[1] & 0xE0 == 0xE0
        )
    if normalized in {"audio/ogg", "application/ogg"}:
        return content.startswith(b"OggS")
    if normalized in {"audio/webm", "video/webm"}:
        return content.startswith(b"\x1aE\xdf\xa3") and b"webm" in content[:4_096].lower()
    if normalized in {"audio/mp4", "audio/x-m4a", "video/mp4"}:
        return len(content) >= 12 and content[4:8] == b"ftyp"
    return False
