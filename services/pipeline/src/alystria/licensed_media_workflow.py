"""Bounded, review-first stock-image search and ingestion.

Provider search, network ingestion, vision ranking, and project persistence are
kept distinct. Remote URLs are never promoted into project state: every review
candidate is a sanitized, content-addressed raster with an immutable source and
rights record. Acceptance remains a separate user action.
"""

from __future__ import annotations

import base64
import binascii
import copy
import hashlib
import io
import json
import re
import struct
import warnings
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from .project import ProjectHistory, ProjectStore
from .project.models import Revision, utc_now
from .providers.licensed_media_selection import (
    BLOCKING_RISKS,
    READY_SCORE,
    LicensedMediaVisionSelector,
    PreparedLicensedMediaCandidate,
)
from .providers.types import (
    AssetInput,
    MediaAsset,
    MediaOutput,
    MediaSearchRequest,
    ProviderResult,
)
from .security.files import ImportLimits, validate_file
from .sources.models import SourceLoadError
from .sources.safety import (
    HttpResponse,
    SafeHttpTransport,
    UrllibSafeHttpTransport,
    UrlSafetyPolicy,
)

MAX_SEARCH_RESULTS = 20
MAX_PREVIEW_CANDIDATES = 8
MAX_STOCK_ALTERNATIVES = 4
MAX_STOCK_IMAGE_BYTES = 4 * 1024 * 1024
MAX_STOCK_PIXELS = 40_000_000
MAX_INSTRUCTION_CHARS = 4_000
MAX_QUERY_CHARS = 240
APPROVED_PROVIDERS = frozenset({"openverse", "pexels"})
STOCK_RECIPE_ID = "licensed-stock-photo-v1"
_SCENE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")


class LicensedMediaInvoker(Protocol):
    def invoke(
        self, request: MediaSearchRequest, *, idempotency_key: str
    ) -> ProviderResult[Any]: ...


class StockCandidateJobContext(Protocol):
    job_id: str
    task_key: str

    def check_cancelled(self) -> None: ...

    def set_progress(self, progress: float, *, message: str | None = None) -> None: ...


@dataclass(frozen=True, slots=True)
class _DownloadedCandidate:
    prepared: PreparedLicensedMediaCandidate
    content: bytes
    width: int
    height: int


def search_visual_candidates(
    store: ProjectStore,
    media_client: LicensedMediaInvoker,
    vision_selector: LicensedMediaVisionSelector,
    params: Mapping[str, Any],
    context: StockCandidateJobContext,
    *,
    transport: SafeHttpTransport | None = None,
) -> dict[str, Any]:
    """Search, sanitize, rank, and persist stock images for explicit review."""

    _reject_unknown_params(params)
    head = _current_head(store, params)
    scene_id = _scene_id(params.get("sceneId"))
    scene = _scene(head.snapshot, scene_id)
    instruction = _text(params.get("instruction"), "instruction", MAX_INSTRUCTION_CHARS)
    query = _text(params.get("searchQuery", instruction), "searchQuery", MAX_QUERY_CHARS)
    provider_id = _enum(params.get("providerId"), APPROVED_PROVIDERS, "providerId")
    alternatives = _integer(
        params.get("alternatives", 3), "alternatives", 1, MAX_STOCK_ALTERNATIVES
    )
    locks = _preservation_locks(params.get("preservationLocks", []))
    aspect_ratio = _enum(
        params.get("desiredAspectRatio", "16:9"),
        frozenset({"16:9", "4:3", "1:1", "9:16"}),
        "desiredAspectRatio",
    )
    locale = _text(params.get("locale", "en-US"), "locale", 40)
    lesson_intent = _lesson_intent(scene, instruction)

    context.check_cancelled()
    context.set_progress(0.05, message=f"Searching {provider_id} for licensed images")
    request = MediaSearchRequest(
        query=query,
        media_type="image",
        page_size=MAX_SEARCH_RESULTS,
        license_allowlist=("cc0",) if provider_id == "openverse" else ("pexels",),
        locale=locale,
    )
    request_key = hashlib.sha256(
        json.dumps(
            {
                "taskKey": context.task_key,
                "providerId": provider_id,
                "query": query,
                "locale": locale,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    search = media_client.invoke(request, idempotency_key=request_key)
    if search.provider_id != provider_id:
        raise ValueError("Licensed-media route did not use the reviewed provider")
    if not isinstance(search.value, MediaOutput):
        raise ValueError("Licensed-media route returned an unexpected result")

    downloader = transport or UrllibSafeHttpTransport(
        UrlSafetyPolicy(max_redirects=3, max_bytes=MAX_STOCK_IMAGE_BYTES, timeout_seconds=15)
    )
    downloaded: list[_DownloadedCandidate] = []
    seen_hashes: set[str] = set()
    skipped = 0
    for rank, asset in enumerate(search.value.assets[:MAX_SEARCH_RESULTS]):
        if len(downloaded) >= MAX_PREVIEW_CANDIDATES:
            break
        context.check_cancelled()
        try:
            item = _download_candidate(
                provider_id,
                asset,
                rank,
                downloader,
                max_preview_bytes=vision_selector.max_preview_bytes,
            )
        except (SourceLoadError, ValueError, OSError):
            skipped += 1
            continue
        digest = hashlib.sha256(item.content).hexdigest()
        if digest in seen_hashes:
            skipped += 1
            continue
        seen_hashes.add(digest)
        downloaded.append(item)
        context.set_progress(
            0.15 + 0.35 * len(downloaded) / MAX_PREVIEW_CANDIDATES,
            message=f"Prepared licensed preview {len(downloaded)} of {MAX_PREVIEW_CANDIDATES}",
        )
    if not downloaded:
        raise ValueError("Licensed-media search produced no safe, attributable image previews")

    context.check_cancelled()
    context.set_progress(0.55, message="Reviewing lesson fit and visual quality")
    selection = vision_selector.select(
        lesson_intent=lesson_intent,
        candidates=tuple(item.prepared for item in downloaded),
        desired_aspect_ratio=aspect_ratio,
    )
    by_id = {item.prepared.candidate_id: item for item in downloaded}
    selected_rankings = selection.rankings[:alternatives]
    if not selected_rankings:
        raise ValueError("Licensed-media vision review returned no ranked candidates")

    context.check_cancelled()
    _current_head(store, {"expectedHeadRevisionId": head.revision_id})
    candidates: list[dict[str, Any]] = []
    artifact_links: list[dict[str, str]] = []
    for alternative_index, judgement in enumerate(selected_rankings):
        downloaded_item = by_id[judgement.candidate_id]
        asset = downloaded_item.prepared.asset
        content_hash = hashlib.sha256(downloaded_item.content).hexdigest()
        candidate_id = _candidate_id(context.task_key, scene_id, content_hash)
        creator = _text(asset.attribution, "licensed-media creator", 500)
        source_url = _text(asset.source_url, "licensed-media source URL", 2_000)
        license_id = _license(provider_id, asset.license)
        source_asset_id = hashlib.sha256(
            f"{provider_id}\0{source_url}".encode()
        ).hexdigest()
        permissions = _permissions(provider_id)
        status = (
            "ready"
            if judgement.overall >= READY_SCORE
            and not BLOCKING_RISKS.intersection(judgement.risks)
            else "rejected"
        )
        prompt_hash = hashlib.sha256(lesson_intent.encode()).hexdigest()
        rights = {
            "status": "verified",
            "license": license_id,
            "source": source_url,
            "attribution": creator,
            "creator": creator,
            **permissions,
            "exportEligible": True,
        }
        licensed_source = {
            "providerId": provider_id,
            "sourceAssetId": source_asset_id,
            "sourceUrl": source_url,
            "creator": creator,
            "licenseId": license_id,
        }
        filename = f"{candidate_id}.{_extension(asset.media_type)}"
        validated = validate_file(
            filename,
            downloaded_item.content,
            declared_mime=asset.media_type,
            limits=ImportLimits(
                max_files=1,
                max_file_bytes=MAX_STOCK_IMAGE_BYTES,
                max_total_bytes=MAX_STOCK_IMAGE_BYTES,
            ),
        )
        metadata = {
            "origin": "licensedMedia",
            "candidateId": candidate_id,
            "sceneId": scene_id,
            "role": "scene",
            "provider": provider_id,
            "model": search.model,
            "seed": 0,
            "promptHash": prompt_hash,
            "baseGenerationId": None,
            "preservationLocks": list(locks),
            "imageRecipe": {},
            "licensedSource": licensed_source,
            "rightsStatus": "verified",
            "licenseId": license_id,
            "sourceUri": source_url,
            "attribution": creator,
            "commercialUse": permissions["commercialUse"],
            "redistribution": permissions["redistribution"],
            "modelInput": permissions["modelInput"],
            "width": downloaded_item.width,
            "height": downloaded_item.height,
            "recipeId": STOCK_RECIPE_ID,
            "c2paStatus": "absent",
        }
        artifact = store.add_artifact_bytes(
            downloaded_item.content,
            media_type=validated.detected_mime,
            original_name=filename,
            metadata=metadata,
        )
        record = {
            "id": candidate_id,
            "sceneId": scene_id,
            "role": "scene",
            "origin": "licensedMedia",
            "status": status,
            "baseRevisionId": head.revision_id,
            "baseGenerationId": None,
            "artifactHash": artifact.hash,
            "mediaType": artifact.media_type,
            "byteSize": artifact.byte_size,
            "filename": filename,
            "prompt": lesson_intent,
            "promptHash": prompt_hash,
            "instruction": instruction,
            "provider": provider_id,
            "model": search.model,
            "seed": 0,
            "alternativeIndex": alternative_index,
            "preservationLocks": list(locks),
            "imageRecipe": {},
            "licensedSource": licensed_source,
            "rights": rights,
            "c2paStatus": "absent",
            "recipeId": STOCK_RECIPE_ID,
            "createdAt": utc_now(),
            "acceptedSceneUnchanged": True,
            "actualCostMicros": search.usage.actual_cost_micros,
            "usageUnits": copy.deepcopy(search.usage.units),
            "visualReview": {
                "judgeProviderId": selection.judge_provider_id,
                "judgeModel": selection.judge_model,
                "lessonFit": judgement.lesson_fit,
                "composition": judgement.composition,
                "technicalQuality": judgement.technical_quality,
                "overall": judgement.overall,
                "risks": list(judgement.risks),
                "rationale": judgement.rationale,
                "recommended": judgement.candidate_id == selection.recommended_candidate_id,
                "reviewRequired": True,
            },
        }
        if status == "rejected":
            record["rejectedAt"] = utc_now()
            record["rejectionReason"] = "Blocked by the licensed-media visual review"
        candidates.append(record)
        artifact_links.append(
            {
                "artifactHash": artifact.hash,
                "role": "scene-visual-candidate",
                "stableId": candidate_id,
            }
        )

    snapshot = copy.deepcopy(head.snapshot)
    snapshot["sceneCandidates"] = [*_records(snapshot, "sceneCandidates"), *candidates]
    revision = store.create_revision(
        snapshot=snapshot,
        kind="generation",
        message=f"Prepared licensed image candidates for scene {scene_id}",
        expected_head=head.revision_id,
        artifact_links=artifact_links,
    )
    ProjectHistory(store).record_new_revision(head.revision_id, revision)
    context.set_progress(1.0, message="Licensed image candidates are ready for review")
    ready = [item for item in candidates if item["status"] == "ready"]
    return {
        "operation": "search_visual_candidates",
        "sceneId": scene_id,
        "providerId": provider_id,
        "searchQuery": query,
        "baseRevisionId": head.revision_id,
        "headRevisionId": revision.revision_id,
        "revisionNumber": revision.number,
        "candidateIds": [item["id"] for item in candidates],
        "candidates": candidates,
        "recommendedCandidateId": next(
            (item["id"] for item in candidates if item["visualReview"]["recommended"]), None
        ),
        "readyCount": len(ready),
        "rejectedCount": len(candidates) - len(ready),
        "downloadedPreviewCount": len(downloaded),
        "skippedResultCount": skipped,
        "acceptedSceneUnchanged": True,
        "reviewRequired": True,
    }


def _download_candidate(
    provider_id: str,
    asset: MediaAsset,
    search_rank: int,
    transport: SafeHttpTransport,
    *,
    max_preview_bytes: int,
) -> _DownloadedCandidate:
    if asset.uri is None:
        raise ValueError("Licensed-media result has no downloadable URL")
    if asset.media_type not in {"image/jpeg", "image/png"}:
        raise ValueError("Licensed-media result is not a supported raster image")
    attribution = (asset.attribution or "").strip()
    if not attribution:
        raise ValueError("Licensed-media result has no creator attribution")
    response = transport.get(
        asset.uri,
        headers={"Accept": "image/jpeg,image/png", "User-Agent": "Alystria-Studio/2"},
    )
    content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().casefold()
    if content_type and content_type not in {"image/jpeg", "image/png"}:
        raise ValueError("Licensed-media server returned a non-image content type")
    content, media_type, width, height = _sanitize_raster(response, asset.media_type)
    preview, preview_media_type = _judge_preview(
        content,
        media_type,
        max_bytes=max_preview_bytes,
    )
    safe_asset = MediaAsset(
        uri=asset.uri,
        media_type=media_type,
        width=width,
        height=height,
        license=asset.license,
        attribution=attribution,
        source_url=asset.source_url,
    )
    digest = hashlib.sha256(content).hexdigest()
    prepared = PreparedLicensedMediaCandidate(
        candidate_id=f"stock:{provider_id}:{digest[:24]}",
        provider_id=provider_id,
        asset=safe_asset,
        preview=AssetInput(preview_media_type, data_base64=base64.b64encode(preview).decode()),
        search_rank=search_rank,
    )
    return _DownloadedCandidate(prepared, content, width, height)


def _judge_preview(content: bytes, media_type: str, *, max_bytes: int) -> tuple[bytes, str]:
    """Create a metadata-free judge derivative without altering accepted bytes."""

    if len(content) <= max_bytes:
        return content, media_type
    try:
        from PIL import Image, ImageOps
    except ImportError as error:
        raise ValueError("Licensed-media preview resizing requires the pinned Pillow runtime") from error
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            with Image.open(io.BytesIO(content)) as opened:
                image = ImageOps.exif_transpose(opened)
                image.load()
                if image.width * image.height > MAX_STOCK_PIXELS:
                    raise ValueError("Licensed-media image exceeds the decoded pixel limit")
                if image.mode in {"RGBA", "LA"}:
                    background = Image.new("RGB", image.size, "white")
                    alpha = image.getchannel("A")
                    background.paste(image.convert("RGB"), mask=alpha)
                    image = background
                else:
                    image = image.convert("RGB")
                image.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
                for quality in (82, 74, 66, 58, 50, 42):
                    output = io.BytesIO()
                    image.save(output, format="JPEG", quality=quality, optimize=True, progressive=False)
                    value = output.getvalue()
                    if len(value) <= max_bytes:
                        return value, "image/jpeg"
                    image.thumbnail(
                        (max(480, image.width * 4 // 5), max(270, image.height * 4 // 5)),
                        Image.Resampling.LANCZOS,
                    )
        except (Image.DecompressionBombError, Image.DecompressionBombWarning, OSError) as error:
            raise ValueError("Licensed-media image could not be decoded safely") from error
    raise ValueError("Licensed-media image could not fit the selected VLM byte limit")


def _sanitize_raster(
    response: HttpResponse, declared_media_type: str
) -> tuple[bytes, str, int, int]:
    data = response.body
    if not data or len(data) > MAX_STOCK_IMAGE_BYTES:
        raise ValueError("Licensed-media image exceeds the download byte limit")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        media_type = "image/png"
        sanitized, width, height = _sanitize_png(data)
    elif data.startswith(b"\xff\xd8"):
        media_type = "image/jpeg"
        sanitized, width, height = _sanitize_jpeg(data)
    else:
        raise ValueError("Licensed-media response is not a JPEG or PNG")
    if media_type != declared_media_type:
        raise ValueError("Licensed-media bytes do not match the declared image type")
    if width < 960 or height < 540 or width * height > MAX_STOCK_PIXELS:
        raise ValueError("Licensed-media image dimensions are outside the slide safety limits")
    return sanitized, media_type, width, height


def _sanitize_png(data: bytes) -> tuple[bytes, int, int]:
    offset = 8
    chunks: list[bytes] = [data[:8]]
    width = height = 0
    seen_ihdr = seen_idat = seen_iend = False
    keep_ancillary = {b"tRNS"}
    while offset + 12 <= len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        end = offset + 12 + length
        if length > MAX_STOCK_IMAGE_BYTES or end > len(data):
            raise ValueError("Licensed-media PNG has an invalid chunk length")
        kind = data[offset + 4 : offset + 8]
        payload = data[offset + 8 : offset + 8 + length]
        expected_crc = struct.unpack(">I", data[offset + 8 + length : end])[0]
        if binascii.crc32(kind + payload) & 0xFFFFFFFF != expected_crc:
            raise ValueError("Licensed-media PNG has an invalid chunk checksum")
        if kind == b"IHDR":
            if seen_ihdr or offset != 8 or length != 13:
                raise ValueError("Licensed-media PNG has an invalid header")
            width, height = struct.unpack(">II", payload[:8])
            if payload[8] not in {8, 16} or payload[10:13] != b"\x00\x00\x00":
                raise ValueError("Licensed-media PNG uses an unsupported encoding")
            seen_ihdr = True
        elif kind == b"IDAT":
            seen_idat = True
        elif kind == b"IEND":
            if length != 0:
                raise ValueError("Licensed-media PNG has an invalid end marker")
            seen_iend = True
        elif kind == b"acTL":
            raise ValueError("Animated PNG stock previews are not supported")
        if kind in {b"IHDR", b"PLTE", b"IDAT", b"IEND"} or kind in keep_ancillary:
            chunks.append(data[offset:end])
        offset = end
        if kind == b"IEND":
            break
    if not (seen_ihdr and seen_idat and seen_iend) or offset != len(data):
        raise ValueError("Licensed-media PNG is incomplete or has trailing data")
    return b"".join(chunks), width, height


def _sanitize_jpeg(data: bytes) -> tuple[bytes, int, int]:
    output = bytearray(b"\xff\xd8")
    offset = 2
    width = height = 0
    sof_markers = {
        0xC0,
        0xC1,
        0xC2,
        0xC3,
        0xC5,
        0xC6,
        0xC7,
        0xC9,
        0xCA,
        0xCB,
        0xCD,
        0xCE,
        0xCF,
    }
    while offset < len(data):
        if data[offset] != 0xFF:
            raise ValueError("Licensed-media JPEG has an invalid marker")
        while offset < len(data) and data[offset] == 0xFF:
            offset += 1
        if offset >= len(data):
            raise ValueError("Licensed-media JPEG is incomplete")
        marker = data[offset]
        marker_start = offset - 1
        offset += 1
        if marker == 0xD9:
            output.extend(b"\xff\xd9")
            if offset != len(data):
                raise ValueError("Licensed-media JPEG has trailing data")
            break
        if marker == 0xDA:
            if offset + 2 > len(data):
                raise ValueError("Licensed-media JPEG scan header is incomplete")
            length = struct.unpack(">H", data[offset : offset + 2])[0]
            scan_start = marker_start
            scan_data = data[scan_start:]
            if length < 2 or offset + length > len(data) or not scan_data.endswith(b"\xff\xd9"):
                raise ValueError("Licensed-media JPEG scan is incomplete")
            output.extend(scan_data)
            offset = len(data)
            break
        if marker in {0x01, *range(0xD0, 0xD8)}:
            output.extend((0xFF, marker))
            continue
        if offset + 2 > len(data):
            raise ValueError("Licensed-media JPEG segment is incomplete")
        length = struct.unpack(">H", data[offset : offset + 2])[0]
        end = offset + length
        if length < 2 or end > len(data):
            raise ValueError("Licensed-media JPEG has an invalid segment length")
        payload = data[offset + 2 : end]
        if marker in sof_markers:
            if len(payload) < 6:
                raise ValueError("Licensed-media JPEG frame header is incomplete")
            height, width = struct.unpack(">HH", payload[1:5])
        # Remove comments and APP metadata. Pixel-bearing JPEG tables, frames,
        # restart intervals, and scans are retained byte-for-byte.
        if marker != 0xFE and not 0xE0 <= marker <= 0xEF:
            output.extend(data[marker_start:end])
        offset = end
    if not output.endswith(b"\xff\xd9") or width <= 0 or height <= 0:
        raise ValueError("Licensed-media JPEG is missing its frame or end marker")
    return bytes(output), width, height


def _permissions(provider_id: str) -> dict[str, str]:
    if provider_id == "openverse":
        return {
            "commercialUse": "allowed",
            "redistribution": "allowed",
            "modelInput": "reviewOnly",
        }
    return {
        "commercialUse": "allowed",
        "redistribution": "composedWorkOnly",
        "modelInput": "reviewOnly",
    }


def _license(provider_id: str, value: str | None) -> str:
    normalized = (value or "").strip().casefold().replace("-", "")
    if provider_id == "openverse" and normalized != "cc0":
        raise ValueError("Openverse automatic selection is limited to CC0")
    if provider_id == "pexels" and normalized != "pexels":
        raise ValueError("Pexels results must preserve the Pexels license")
    return "CC0-1.0" if provider_id == "openverse" else "Pexels"


def _candidate_id(task_key: str, scene_id: str, content_hash: str) -> str:
    digest = hashlib.sha256(
        f"licensed-media:{task_key}:{scene_id}:{content_hash}".encode()
    ).hexdigest()
    return f"candidate_{digest[:32]}"


def _lesson_intent(scene: Mapping[str, Any], instruction: str) -> str:
    title = _text(scene.get("title", "Tutorial scene"), "scene title", 500)
    objective = _text(
        scene.get("objective") or scene.get("visualIntent") or title,
        "scene objective",
        2_000,
    )
    return f"{title}. Learning objective: {objective}. Artwork direction: {instruction}"[:4_000]


def _current_head(store: ProjectStore, params: Mapping[str, Any]) -> Revision:
    expected = _text(params.get("expectedHeadRevisionId"), "expectedHeadRevisionId", 160)
    head = store.head_revision()
    if head is None or head.revision_id != expected:
        actual = "none" if head is None else head.revision_id
        raise ValueError(
            f"Licensed-media candidate base revision became stale: expected {expected}, got {actual}"
        )
    return head


def _scene(snapshot: Mapping[str, Any], scene_id: str) -> dict[str, Any]:
    matches = [item for item in _records(snapshot, "scenes") if item.get("id") == scene_id]
    if len(matches) != 1:
        raise ValueError(f"Scene {scene_id} does not exist exactly once")
    return matches[0]


def _records(snapshot: Mapping[str, Any], key: str) -> list[dict[str, Any]]:
    value = snapshot.get(key, [])
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise ValueError(f"Project {key} must be an array of records")
    return [copy.deepcopy(item) for item in value]


def _scene_id(value: object) -> str:
    text = _text(value, "sceneId", 128)
    if not _SCENE_ID.fullmatch(text):
        raise ValueError("sceneId is invalid")
    return text


def _preservation_locks(value: object) -> tuple[str, ...]:
    allowed = {"narration", "citations", "learningobjective", "timing", "presenter"}
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError("preservationLocks must be an array of strings")
    normalized = tuple(sorted(set(item.strip().casefold() for item in value)))
    if set(normalized) - allowed:
        raise ValueError("preservationLocks contains an unsupported lock")
    return normalized


def _reject_unknown_params(params: Mapping[str, Any]) -> None:
    allowed = {
        "expectedHeadRevisionId",
        "sceneId",
        "instruction",
        "preservationLocks",
        "alternatives",
        "providerId",
        "searchQuery",
        "desiredAspectRatio",
        "locale",
    }
    unknown = set(params) - allowed
    if unknown:
        raise ValueError(f"Licensed-media search contains unsupported fields: {sorted(unknown)}")


def _text(value: object, label: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise ValueError(f"{label} must contain 1 to {maximum} characters")
    return value.strip()


def _enum(value: object, allowed: frozenset[str], label: str) -> str:
    text = _text(value, label, 80)
    if text not in allowed:
        raise ValueError(f"{label} is unsupported")
    return text


def _integer(value: object, label: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{label} must be between {minimum} and {maximum}")
    return value


def _extension(media_type: str | None) -> str:
    if media_type == "image/png":
        return "png"
    if media_type == "image/jpeg":
        return "jpg"
    raise ValueError("Licensed-media image type is unsupported")
