"""Review-first discovery and promotion of openly licensed background music."""

from __future__ import annotations

import copy
import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from .project import ProjectHistory, ProjectStore
from .project.models import Revision, utc_now
from .providers.types import MediaAsset, MediaOutput, MediaSearchRequest, ProviderResult
from .security.files import ImportLimits, validate_file
from .sources.models import SourceLoadError
from .sources.safety import SafeHttpTransport, UrllibSafeHttpTransport, UrlSafetyPolicy

MAX_SEARCH_RESULTS = 20
MAX_MUSIC_ALTERNATIVES = 4
MAX_MUSIC_BYTES = 32 * 1024 * 1024
MAX_QUERY_CHARS = 240
MUSIC_RECIPE_ID = "openverse-background-music-v1"
ALLOWED_MOODS = frozenset(
    {"calm", "curious", "focused", "hopeful", "playful", "reflective", "energetic"}
)
ALLOWED_LICENSES = frozenset({"cc0", "by"})
SUPPORTED_AUDIO_TYPES = frozenset({"audio/mpeg", "audio/ogg", "audio/flac", "audio/wav"})
_SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}\Z")


class LicensedMusicInvoker(Protocol):
    def invoke(
        self, request: MediaSearchRequest, *, idempotency_key: str
    ) -> ProviderResult[Any]: ...


class MusicCandidateJobContext(Protocol):
    job_id: str
    task_key: str

    def check_cancelled(self) -> None: ...

    def set_progress(self, progress: float, *, message: str | None = None) -> None: ...


@dataclass(frozen=True, slots=True)
class _DownloadedMusic:
    asset: MediaAsset
    content: bytes
    media_type: str
    filename: str
    score: int
    matched_query: str


def search_music_candidates(
    store: ProjectStore,
    media_client: LicensedMusicInvoker,
    params: Mapping[str, Any],
    context: MusicCandidateJobContext,
    *,
    transport: SafeHttpTransport | None = None,
) -> dict[str, Any]:
    """Search Openverse audio and persist bounded local review candidates."""

    _reject_unknown(params, {"projectId", "projectDirectory", "expectedHeadRevisionId", "topic", "mood", "alternatives", "locale"})
    head = _current_head(store, params)
    topic = _text(params.get("topic"), "topic", MAX_QUERY_CHARS)
    mood = _enum(params.get("mood", "curious"), ALLOWED_MOODS, "mood")
    alternatives = _integer(
        params.get("alternatives", 3), "alternatives", 1, MAX_MUSIC_ALTERNATIVES
    )
    locale = _text(params.get("locale", "en-US"), "locale", 40)
    queries = _search_queries(topic, mood)
    context.check_cancelled()
    context.set_progress(0.05, message="Searching Openverse for background music")
    search_results: list[ProviderResult[Any]] = []
    discovered_urls: set[str] = set()
    downloader = transport or UrllibSafeHttpTransport(
        UrlSafetyPolicy(max_redirects=3, max_bytes=MAX_MUSIC_BYTES, timeout_seconds=20)
    )
    downloaded: list[_DownloadedMusic] = []
    seen_hashes: set[str] = set()
    skipped = 0
    result_rank = 0
    for query in queries:
        request = MediaSearchRequest(
            query=query,
            media_type="audio",
            page_size=MAX_SEARCH_RESULTS,
            license_allowlist=("cc0", "by"),
            locale=locale,
        )
        request_key = hashlib.sha256(
            json.dumps(
                {"taskKey": context.task_key, "query": query, "locale": locale},
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()
        result = media_client.invoke(request, idempotency_key=request_key)
        if result.provider_id != "openverse" or not isinstance(result.value, MediaOutput):
            raise ValueError("Background-music search did not use the reviewed Openverse route")
        search_results.append(result)
        for asset in result.value.assets[:MAX_SEARCH_RESULTS]:
            if not _potential_candidate(asset) or asset.uri in discovered_urls:
                continue
            assert asset.uri is not None
            discovered_urls.add(asset.uri)
            context.check_cancelled()
            try:
                prepared = _download_music(
                    asset,
                    downloader,
                    topic=topic,
                    mood=mood,
                    rank=result_rank,
                    matched_query=query,
                )
            except (SourceLoadError, ValueError, OSError):
                skipped += 1
                result_rank += 1
                continue
            result_rank += 1
            digest = hashlib.sha256(prepared.content).hexdigest()
            if digest in seen_hashes:
                skipped += 1
                continue
            seen_hashes.add(digest)
            downloaded.append(prepared)
            context.set_progress(
                0.1 + 0.55 * len(downloaded) / alternatives,
                message=f"Prepared music candidate {len(downloaded)} of {alternatives}",
            )
            if len(downloaded) >= alternatives:
                break
        if len(downloaded) >= alternatives:
            break
    if not search_results:
        raise ValueError("Openverse background-music search did not run")
    if not downloaded:
        raise ValueError("Openverse returned no safe CC0 or CC BY background-music candidates")

    downloaded.sort(key=lambda item: (-item.score, _title(item.asset).casefold()))
    selected = downloaded[:alternatives]
    _current_head(store, {"expectedHeadRevisionId": head.revision_id})
    candidates: list[dict[str, Any]] = []
    links: list[dict[str, str]] = []
    for index, item in enumerate(selected):
        digest = hashlib.sha256(item.content).hexdigest()
        candidate_id = _candidate_id(context.task_key, digest)
        creator = _text(item.asset.creator or item.asset.attribution, "music creator", 500)
        source_url = _https_url(item.asset.source_url, "music source URL")
        license_id, license_url = _license(item.asset)
        attribution = _attribution(item.asset, creator, license_id, license_url)
        metadata = {
            "origin": "licensedMedia",
            "candidateId": candidate_id,
            "role": "music",
            "provider": "openverse",
            "model": search_results[0].model,
            "recipeId": MUSIC_RECIPE_ID,
            "sourceUri": source_url,
            "sourceAssetId": item.asset.foreign_identifier,
            "sourceProvider": item.asset.provider,
            "sourceCatalog": item.asset.source,
            "creator": creator,
            "creatorUrl": item.asset.creator_url,
            "licenseId": license_id,
            "licenseUrl": license_url,
            "attribution": attribution,
            "topic": topic,
            "mood": mood,
            "matchedQuery": item.matched_query,
        }
        artifact = store.add_artifact_bytes(
            item.content,
            media_type=item.media_type,
            original_name=item.filename,
            metadata=metadata,
        )
        candidate = {
            "id": candidate_id,
            "status": "ready",
            "baseRevisionId": head.revision_id,
            "artifactHash": artifact.hash,
            "mediaType": artifact.media_type,
            "byteSize": artifact.byte_size,
            "filename": item.filename,
            "title": _title(item.asset),
            "creator": creator,
            "creatorUrl": item.asset.creator_url,
            "durationSeconds": item.asset.duration_seconds,
            "provider": "openverse",
            "model": search_results[0].model,
            "sourceProvider": item.asset.provider,
            "sourceCatalog": item.asset.source,
            "sourceAssetId": item.asset.foreign_identifier,
            "sourceUrl": source_url,
            "license": license_id,
            "licenseUrl": license_url,
            "attribution": attribution,
            "topic": topic,
            "mood": mood,
            "matchedQuery": item.matched_query,
            "matchScore": item.score,
            "searchRank": index,
            "recipeId": MUSIC_RECIPE_ID,
            "rightsReviewRequired": True,
            "acceptedMusicUnchanged": True,
            "createdAt": utc_now(),
            "actualCostMicros": _total_cost(search_results),
            "usageUnits": _total_usage(search_results),
        }
        candidates.append(candidate)
        links.append(
            {"artifactHash": artifact.hash, "role": "music-candidate", "stableId": candidate_id}
        )

    snapshot = copy.deepcopy(head.snapshot)
    snapshot["musicCandidates"] = [*_records(snapshot, "musicCandidates"), *candidates]
    revision = store.create_revision(
        snapshot=snapshot,
        kind="generation",
        message=f"Prepared Openverse music candidates for {topic}",
        expected_head=head.revision_id,
        artifact_links=links,
    )
    ProjectHistory(store).record_new_revision(head.revision_id, revision)
    context.set_progress(1.0, message="Background-music candidates are ready for review")
    return {
        "operation": "search_music_candidates",
        "providerId": "openverse",
        "topic": topic,
        "mood": mood,
        "queriesAttempted": [query for query in queries[: len(search_results)]],
        "baseRevisionId": head.revision_id,
        "headRevisionId": revision.revision_id,
        "revisionNumber": revision.number,
        "candidateIds": [item["id"] for item in candidates],
        "candidates": candidates,
        "recommendedCandidateId": candidates[0]["id"],
        "readyCount": len(candidates),
        "skippedResultCount": skipped,
        "acceptedMusicUnchanged": True,
        "reviewRequired": True,
    }


def accept_music_candidate(store: ProjectStore, params: Mapping[str, Any]) -> dict[str, Any]:
    """Promote one reviewed candidate and select it as the project music bed."""

    _reject_unknown(params, {"projectId", "projectDirectory", "expectedHeadRevisionId", "candidateId"})
    head = _current_head(store, params)
    candidate_id = _stable_id(params.get("candidateId"), "candidateId")
    candidates = _records(head.snapshot, "musicCandidates")
    candidate = _unique(candidates, candidate_id, "music candidate")
    if candidate.get("status") != "ready":
        raise ValueError("Only a ready music candidate can be accepted")
    digest = _sha256(candidate.get("artifactHash"), "candidate artifactHash")
    media_type = _enum(candidate.get("mediaType"), SUPPORTED_AUDIO_TYPES, "candidate mediaType")
    if not store.cas.verify(digest):
        raise ValueError("Music candidate is missing or corrupt in the project CAS")
    row = store.connection.execute(
        "SELECT media_type, metadata_json FROM artifacts WHERE hash = ?", (digest,)
    ).fetchone()
    if row is None or str(row["media_type"]).casefold() != media_type:
        raise ValueError("Music candidate media registration does not match")
    metadata = json.loads(str(row["metadata_json"]))
    for field, expected in {
        "candidateId": candidate_id,
        "provider": "openverse",
        "sourceUri": candidate.get("sourceUrl"),
        "licenseId": candidate.get("license"),
        "attribution": candidate.get("attribution"),
    }.items():
        if metadata.get(field) != expected:
            raise ValueError(f"Music candidate {field} metadata does not match")

    now = utc_now()
    suffix = candidate_id.removeprefix("music_")
    asset_id = f"music_{suffix}"
    provenance_id = f"prov_music_{suffix}"
    asset_record = {
        "id": asset_id,
        "kind": "music",
        "artifactHash": digest,
        "filename": _text(candidate.get("filename"), "candidate filename", 240),
        "mediaType": media_type,
        "byteSize": _integer(candidate.get("byteSize"), "candidate byteSize", 1, MAX_MUSIC_BYTES),
        "privacy": "project_local",
        "state": "promoted",
        "provenanceId": provenance_id,
        "createdAt": now,
    }
    provenance: dict[str, Any] = {
        "id": provenance_id,
        "assetId": asset_id,
        "origin": "licensedMedia",
        "contentHash": digest,
        "createdAt": now,
        "provider": "openverse",
        "model": candidate.get("model"),
        "rights": {
            "status": "userReviewed",
            "license": candidate["license"],
            "licenseUrl": candidate["licenseUrl"],
            "source": candidate["sourceUrl"],
            "creator": candidate["creator"],
            "creatorUrl": candidate.get("creatorUrl"),
            "attribution": candidate["attribution"],
            "commercialUse": "allowed",
            "redistribution": "allowed",
            "modelInput": "reviewOnly",
        },
        "licensedSource": {
            "providerId": "openverse",
            "sourceProvider": candidate.get("sourceProvider"),
            "sourceCatalog": candidate.get("sourceCatalog"),
            "sourceAssetId": candidate.get("sourceAssetId"),
            "sourceUrl": candidate["sourceUrl"],
        },
        "exportEligible": True,
        "blockers": [],
    }

    snapshot = copy.deepcopy(head.snapshot)
    snapshot["mediaAssets"] = _upsert(_records(snapshot, "mediaAssets"), asset_record)
    snapshot["assetProvenance"] = _upsert(
        _records(snapshot, "assetProvenance"), provenance, key="assetId"
    )
    customization = copy.deepcopy(snapshot.get("customization", {}))
    if not isinstance(customization, dict):
        raise ValueError("Project customization must be an object")
    assets = customization.get("assets", [])
    if not isinstance(assets, list) or not all(isinstance(item, dict) for item in assets):
        raise ValueError("Project customization assets must be an array")
    customization["assets"] = _upsert(
        assets,
        {
            "id": asset_id,
            "kind": "music",
            "label": _text(candidate.get("title"), "candidate title", 500)[:160],
            "source": "licensed-media",
            "filename": asset_record["filename"],
            "mediaType": media_type,
            "byteSize": asset_record["byteSize"],
            "sha256": digest,
            "creator": candidate["creator"],
            "license": candidate["license"],
            "attribution": candidate["attribution"],
            "sourceUrl": candidate["sourceUrl"],
            "rightsStatus": "cleared",
        },
    )
    audio = customization.get("audio", {})
    if not isinstance(audio, dict):
        raise ValueError("Project audio customization must be an object")
    customization["audio"] = {
        **audio,
        "musicAssetId": asset_id,
        "musicLevel": audio.get("musicLevel", 12),
        "narrationDucking": audio.get("narrationDucking", 72),
    }
    snapshot["customization"] = customization
    for item in candidates:
        if item.get("id") == candidate_id:
            item.update({"status": "accepted", "acceptedAt": now, "assetId": asset_id})
        elif item.get("status") == "ready":
            item.update({"status": "superseded", "supersededAt": now})
    snapshot["musicCandidates"] = candidates
    revision = store.create_revision(
        snapshot=snapshot,
        kind="edit",
        message=f"Accepted background music {_text(candidate.get('title'), 'candidate title', 500)}",
        expected_head=head.revision_id,
        artifact_links=[{"artifactHash": digest, "role": "music", "stableId": asset_id}],
    )
    ProjectHistory(store).record_new_revision(head.revision_id, revision)
    return {
        "projectId": store.manifest.project_id,
        "candidateId": candidate_id,
        "status": "accepted",
        "assetId": asset_id,
        "artifactHash": digest,
        "headRevisionId": revision.revision_id,
        "revisionNumber": revision.number,
        "selected": True,
        "attribution": candidate["attribution"],
    }


def reject_music_candidate(store: ProjectStore, params: Mapping[str, Any]) -> dict[str, Any]:
    _reject_unknown(params, {"projectId", "projectDirectory", "expectedHeadRevisionId", "candidateId", "reason"})
    head = _current_head(store, params)
    candidate_id = _stable_id(params.get("candidateId"), "candidateId")
    reason = _text(params.get("reason", "Rejected during music review"), "reason", 500)
    candidates = _records(head.snapshot, "musicCandidates")
    candidate = _unique(candidates, candidate_id, "music candidate")
    if candidate.get("status") != "ready":
        raise ValueError("Only a ready music candidate can be rejected")
    now = utc_now()
    candidate.update({"status": "rejected", "rejectedAt": now, "rejectionReason": reason})
    snapshot = copy.deepcopy(head.snapshot)
    snapshot["musicCandidates"] = candidates
    revision = store.create_revision(
        snapshot=snapshot,
        kind="edit",
        message="Rejected a background-music candidate",
        expected_head=head.revision_id,
    )
    ProjectHistory(store).record_new_revision(head.revision_id, revision)
    return {
        "projectId": store.manifest.project_id,
        "candidateId": candidate_id,
        "status": "rejected",
        "headRevisionId": revision.revision_id,
        "revisionNumber": revision.number,
    }


def _download_music(
    asset: MediaAsset,
    transport: SafeHttpTransport,
    *,
    topic: str,
    mood: str,
    rank: int,
    matched_query: str,
) -> _DownloadedMusic:
    uri = _https_url(asset.uri, "music download URL")
    _https_url(asset.source_url, "music source URL")
    _text(asset.creator or asset.attribution, "music creator", 500)
    _license(asset)
    declared = (asset.media_type or "").split(";", 1)[0].casefold()
    if declared not in SUPPORTED_AUDIO_TYPES:
        raise ValueError("Music result is not a supported audio format")
    if asset.duration_seconds is not None and not 5 <= asset.duration_seconds <= 3600:
        raise ValueError("Music duration is outside the supported range")
    response = transport.get(
        uri,
        headers={
            "Accept": "audio/mpeg,audio/ogg,audio/flac,audio/wav",
            "User-Agent": "Alystria-Studio/2",
        },
    )
    response_type = response.headers.get("content-type", "").split(";", 1)[0].casefold()
    if response_type and response_type not in SUPPORTED_AUDIO_TYPES:
        raise ValueError("Music server returned a non-audio content type")
    extension = {
        "audio/mpeg": "mp3",
        "audio/ogg": "ogg",
        "audio/flac": "flac",
        "audio/wav": "wav",
    }[declared]
    filename = f"openverse-music-{rank + 1}.{extension}"
    validated = validate_file(
        filename,
        response.body,
        declared_mime=declared,
        limits=ImportLimits(max_files=1, max_file_bytes=MAX_MUSIC_BYTES, max_total_bytes=MAX_MUSIC_BYTES),
    )
    score = _match_score(asset, topic=topic, mood=mood, rank=rank)
    return _DownloadedMusic(
        asset,
        response.body,
        validated.detected_mime,
        filename,
        score,
        matched_query,
    )


def _search_queries(topic: str, mood: str) -> tuple[str, ...]:
    stop_words = {"about", "and", "for", "from", "how", "into", "lesson", "the", "this", "tutorial", "with"}
    topic_words = [
        word
        for word in re.findall(r"[A-Za-z0-9]+", topic.casefold())
        if len(word) > 2 and word not in stop_words
    ]
    focused_topic = " ".join(topic_words[:3]) or topic
    return tuple(dict.fromkeys((focused_topic, mood, "instrumental")))


def _potential_candidate(asset: MediaAsset) -> bool:
    return (
        asset.uri is not None
        and asset.source_url is not None
        and (asset.creator or asset.attribution) is not None
        and (asset.media_type or "").split(";", 1)[0].casefold() in SUPPORTED_AUDIO_TYPES
        and (asset.license or "").strip().casefold().replace("_", "-") in ALLOWED_LICENSES
    )


def _total_cost(results: list[ProviderResult[Any]]) -> int | None:
    values = [item.usage.actual_cost_micros for item in results]
    if any(value is None for value in values):
        return None
    return sum(value for value in values if value is not None)


def _total_usage(results: list[ProviderResult[Any]]) -> dict[str, float]:
    usage: dict[str, float] = {}
    for result in results:
        for key, value in result.usage.units.items():
            usage[key] = usage.get(key, 0.0) + value
    return usage


def _match_score(asset: MediaAsset, *, topic: str, mood: str, rank: int) -> int:
    haystack = " ".join((_title(asset), *asset.tags)).casefold()
    words = {word for word in re.findall(r"[a-z0-9]+", f"{topic} {mood}".casefold()) if len(word) > 2}
    score = max(0, 30 - rank)
    score += 12 * sum(word in haystack for word in words)
    if any(word in haystack for word in ("instrumental", "ambient", "background", "underscore")):
        score += 8
    if any(word in haystack for word in ("vocal", "speech", "podcast", "interview")):
        score -= 20
    return score


def _title(asset: MediaAsset) -> str:
    value = (asset.title or "Openverse background music").strip()
    return value[:500] or "Openverse background music"


def _license(asset: MediaAsset) -> tuple[str, str]:
    value = (asset.license or "").strip().casefold().replace("_", "-")
    if value not in ALLOWED_LICENSES:
        raise ValueError("Background music must use CC0 or CC BY")
    if value == "cc0":
        return "CC0-1.0", "https://creativecommons.org/publicdomain/zero/1.0/"
    version = (asset.license_version or "").strip()
    if not re.fullmatch(r"[1-4](?:\.0)?", version):
        raise ValueError("CC BY music has an unsupported license version")
    url = asset.license_url or f"https://creativecommons.org/licenses/by/{version}/"
    if not url.startswith("https://creativecommons.org/licenses/by/"):
        raise ValueError("CC BY music license URL is not canonical")
    return f"CC-BY-{version}", url


def _attribution(asset: MediaAsset, creator: str, license_id: str, license_url: str) -> str:
    title = _title(asset)
    source = _https_url(asset.source_url, "music source URL")
    return f'"{title}" by {creator} · {license_id} ({license_url}) · {source}'


def _candidate_id(task_key: str, digest: str) -> str:
    value = hashlib.sha256(f"music:{task_key}:{digest}".encode()).hexdigest()
    return f"music_{value[:32]}"


def _current_head(store: ProjectStore, params: Mapping[str, Any]) -> Revision:
    expected = _stable_id(params.get("expectedHeadRevisionId"), "expectedHeadRevisionId")
    head = store.head_revision()
    if head is None or head.revision_id != expected:
        actual = "none" if head is None else head.revision_id
        raise ValueError(f"Music candidate base revision became stale: expected {expected}, got {actual}")
    return head


def _records(snapshot: Mapping[str, Any], key: str) -> list[dict[str, Any]]:
    value = snapshot.get(key, [])
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise ValueError(f"Project {key} must be an array of records")
    return [copy.deepcopy(item) for item in value]


def _unique(records: list[dict[str, Any]], identity: str, label: str) -> dict[str, Any]:
    matches = [item for item in records if item.get("id") == identity]
    if len(matches) != 1:
        raise ValueError(f"Project must contain exactly one {label} {identity!r}")
    return matches[0]


def _upsert(records: list[dict[str, Any]], record: dict[str, Any], *, key: str = "id") -> list[dict[str, Any]]:
    identity = record[key]
    return [*(item for item in records if item.get(key) != identity), record]


def _reject_unknown(params: Mapping[str, Any], allowed: set[str]) -> None:
    unknown = set(params) - allowed
    if unknown:
        raise ValueError(f"Music request contains unsupported fields: {sorted(unknown)}")


def _text(value: object, label: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise ValueError(f"{label} must contain 1 to {maximum} characters")
    return value.strip()


def _stable_id(value: object, label: str) -> str:
    text = _text(value, label, 160)
    if not _SAFE_ID.fullmatch(text):
        raise ValueError(f"{label} is invalid")
    return text


def _https_url(value: object, label: str) -> str:
    text = _text(value, label, 2_000)
    if not text.casefold().startswith("https://"):
        raise ValueError(f"{label} must use HTTPS")
    return text


def _enum(value: object, allowed: frozenset[str], label: str) -> str:
    text = _text(value, label, 80)
    if text not in allowed:
        raise ValueError(f"{label} is unsupported")
    return text


def _integer(value: object, label: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{label} must be between {minimum} and {maximum}")
    return value


def _sha256(value: object, label: str) -> str:
    digest = _text(value, label, 64).casefold()
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError(f"{label} must be a SHA-256 digest")
    return digest
