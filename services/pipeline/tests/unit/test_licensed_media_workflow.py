from __future__ import annotations

import binascii
import copy
import hashlib
import io
import json
import random
import re
import struct
import uuid
import zlib
from pathlib import Path
from typing import Any

import pytest

from alystria.licensed_media_workflow import _judge_preview, search_visual_candidates
from alystria.project import ProjectStore
from alystria.providers.licensed_media_selection import LicensedMediaVisionSelector
from alystria.providers.types import (
    MediaAsset,
    MediaOutput,
    MediaSearchRequest,
    ProviderResult,
    TextOutput,
    Usage,
    VisionLanguageRequest,
)
from alystria.service import PipelineService
from alystria.sources.safety import HttpResponse
from alystria.visual_candidates import accept_visual_candidate


def _chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)
    )


def _png(red: int) -> bytes:
    width, height = 960, 540
    rows = b"".join(b"\x00" + bytes((red, 80, 120)) * width for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + _chunk(b"tEXt", b"Comment\x00metadata removed in quarantine")
        + _chunk(b"IDAT", zlib.compress(rows, 9))
        + _chunk(b"IEND", b"")
    )


class SearchRuntime:
    def __init__(self, provider_id: str = "pexels") -> None:
        self.provider_id = provider_id
        self.requests: list[MediaSearchRequest] = []

    def invoke(
        self, request: MediaSearchRequest, *, idempotency_key: str
    ) -> ProviderResult[Any]:
        assert len(idempotency_key) == 64
        self.requests.append(request)
        license_id = "Pexels" if self.provider_id == "pexels" else "cc0"
        return ProviderResult(
            self.provider_id,
            "licensed-media",
            MediaOutput(
                tuple(
                    MediaAsset(
                        uri=f"https://images.test/{index}.png",
                        media_type="image/png",
                        width=960,
                        height=540,
                        license=license_id,
                        attribution=f"Creator {index}",
                        source_url=f"https://source.test/photo/{index}",
                    )
                    for index in range(3)
                )
            ),
            Usage(self.provider_id, "licensed-media", {"requests": 1.0}, 0),
            "search-result-1",
        )


class PreviewTransport:
    def __init__(self) -> None:
        self.requests: list[str] = []

    def get(self, url: str, *, headers: dict[str, str] | None = None) -> HttpResponse:
        assert headers is not None and "image/jpeg" in headers["Accept"]
        self.requests.append(url)
        index = int(url.rsplit("/", 1)[1].removesuffix(".png"))
        return HttpResponse(url, 200, {"content-type": "image/png"}, _png(60 + index))


class VisionRuntime:
    def __init__(self, *, risks: tuple[str, ...] = ()) -> None:
        self.risks = risks
        self.requests: list[VisionLanguageRequest] = []

    def invoke(
        self, request: VisionLanguageRequest, *, idempotency_key: str
    ) -> ProviderResult[Any]:
        assert len(idempotency_key) == 64
        self.requests.append(request)
        ids = re.findall(r'"candidateId":"([^"]+)"', request.prompt)
        rankings = [
            {
                "candidateId": candidate_id,
                "lessonFit": 90 - index,
                "composition": 88 - index,
                "technicalQuality": 92 - index,
                "overall": 89 - index,
                "risks": list(self.risks if index == 0 else ()),
                "rationale": "Literal lesson support with useful negative space.",
            }
            for index, candidate_id in enumerate(ids)
        ]
        value = TextOutput(
            json.dumps(
                {
                    "recommendedCandidateId": ids[0] if ids else None,
                    "rankings": rankings,
                }
            )
        )
        return ProviderResult(
            "nvidia",
            request.model,
            value,
            Usage("nvidia", request.model, {"requests": 1.0}, 0),
            "judge-result-1",
        )


class Context:
    job_id = "job-stock"
    task_key = "stock-task-key"

    def __init__(self) -> None:
        self.progress: list[tuple[float, str | None]] = []

    def check_cancelled(self) -> None:
        return None

    def set_progress(self, progress: float, *, message: str | None = None) -> None:
        self.progress.append((progress, message))


def _project(tmp_path: Path) -> ProjectStore:
    return ProjectStore.create(
        tmp_path / "stock-candidates",
        name="Stock candidates",
        project_id=str(uuid.uuid4()),
        initial_snapshot={
            "id": "temporary",
            "title": "Stock candidates",
            "scenes": [
                {
                    "id": "scene-one",
                    "title": "Ocean currents",
                    "objective": "Show warm and cold currents moving through the ocean.",
                    "narration": "The accepted narration remains unchanged.",
                }
            ],
            "customization": {"assets": [], "presenter": {"placement": "off"}},
        },
    )


def _params(head_id: str, **overrides: Any) -> dict[str, Any]:
    return {
        "expectedHeadRevisionId": head_id,
        "sceneId": "scene-one",
        "instruction": "Aerial photograph of a clear ocean current boundary",
        "searchQuery": "ocean current aerial",
        "preservationLocks": ["narration", "citations", "learningobjective", "timing"],
        "alternatives": 2,
        "providerId": "pexels",
        "desiredAspectRatio": "16:9",
        "locale": "en-US",
        **overrides,
    }


def _search(store: ProjectStore, *, risks: tuple[str, ...] = ()) -> dict[str, Any]:
    head = store.head_revision()
    assert head is not None
    return search_visual_candidates(
        store,
        SearchRuntime(),
        LicensedMediaVisionSelector(VisionRuntime(risks=risks), model="vision-model"),
        _params(head.revision_id),
        Context(),
        transport=PreviewTransport(),
    )


def test_stock_search_sanitizes_ranks_persists_and_accepts_without_remote_promotion(
    tmp_path: Path,
) -> None:
    with _project(tmp_path) as store:
        initial = store.head_revision()
        assert initial is not None
        accepted_scene = copy.deepcopy(initial.snapshot["scenes"][0])
        result = _search(store)

        assert result["readyCount"] == 2
        assert result["reviewRequired"] is True
        current = store.head_revision()
        assert current is not None
        assert current.snapshot["scenes"][0] == accepted_scene
        candidate = current.snapshot["sceneCandidates"][0]
        assert candidate["origin"] == "licensedMedia"
        assert candidate["rights"]["redistribution"] == "composedWorkOnly"
        assert candidate["licensedSource"]["sourceUrl"].startswith("https://source.test/")
        assert "images.test" not in json.dumps(candidate)
        sanitized = store.cas.object_path(candidate["artifactHash"]).read_bytes()
        assert b"metadata removed" not in sanitized

        receipt = accept_visual_candidate(
            store,
            {
                "expectedHeadRevisionId": current.revision_id,
                "candidateId": candidate["id"],
            },
        )
        accepted = store.head_revision()
        assert accepted is not None
        assert accepted.snapshot["scenes"][0]["visualArtifactHash"] == receipt["artifactHash"]
        provenance = accepted.snapshot["assetProvenance"][0]
        assert provenance["origin"] == "licensedMedia"
        assert provenance["rights"]["creator"] == "Creator 0"
        assert provenance["rights"]["redistribution"] == "composedWorkOnly"
        asset = accepted.snapshot["customization"]["assets"][0]
        assert asset["source"] == "licensed-media"
        assert asset["creator"] == "Creator 0"
        assert asset["sourceUrl"] == "https://source.test/photo/0"
        project_id = store.manifest.project_id
        project_root = store.root

    resolved = PipelineService().dispatch(
        "asset.resolve",
        {
            "projectId": project_id,
            "projectDirectory": str(project_root),
            "artifactHash": receipt["artifactHash"],
        },
    )
    assert Path(resolved["path"]).read_bytes() == sanitized


def test_visual_blocker_stays_rejected_and_cannot_be_accepted(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        result = _search(store, risks=("watermark",))
        assert result["rejectedCount"] == 1
        head = store.head_revision()
        assert head is not None
        blocked = result["candidates"][0]
        assert blocked["status"] == "rejected"
        with pytest.raises(ValueError, match="ready visual candidate"):
            accept_visual_candidate(
                store,
                {
                    "expectedHeadRevisionId": head.revision_id,
                    "candidateId": blocked["id"],
                },
            )


def test_licensed_media_cannot_be_relabelled_as_a_presenter(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        _search(store)
        head = store.head_revision()
        assert head is not None
        snapshot = copy.deepcopy(head.snapshot)
        candidate = snapshot["sceneCandidates"][0]
        candidate["role"] = "presenter"
        tampered = store.create_revision(
            snapshot=snapshot,
            expected_head=head.revision_id,
            message="Attempt to relabel licensed media",
        )
        with pytest.raises(ValueError, match="scene visuals"):
            accept_visual_candidate(
                store,
                {
                    "expectedHeadRevisionId": tampered.revision_id,
                    "candidateId": candidate["id"],
                },
            )


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (("origin",), "origin|rights source|metadata"),
        (("licensedSource", "sourceUrl"), "source URL|metadata"),
        (("rights", "license"), "rights source|metadata"),
        (("rights", "creator"), "rights source|metadata"),
        (("rights", "commercialUse"), "rights source|metadata"),
    ],
)
def test_stock_acceptance_rejects_snapshot_provenance_tampering(
    tmp_path: Path, mutation: tuple[str, ...], message: str
) -> None:
    with _project(tmp_path) as store:
        _search(store)
        head = store.head_revision()
        assert head is not None
        snapshot = copy.deepcopy(head.snapshot)
        candidate = snapshot["sceneCandidates"][0]
        if mutation == ("origin",):
            candidate["origin"] = "aiGenerated"
        else:
            candidate[mutation[0]][mutation[1]] = "tampered"
        tampered = store.create_revision(
            snapshot=snapshot,
            expected_head=head.revision_id,
            message="Tamper with stock provenance",
        )
        with pytest.raises(ValueError, match=message):
            accept_visual_candidate(
                store,
                {
                    "expectedHeadRevisionId": tampered.revision_id,
                    "candidateId": candidate["id"],
                },
            )


def test_stock_search_closes_provider_and_request_surface(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None
        runtime = SearchRuntime(provider_id="openverse")
        with pytest.raises(ValueError, match="reviewed provider"):
            search_visual_candidates(
                store,
                runtime,
                LicensedMediaVisionSelector(VisionRuntime(), model="vision-model"),
                _params(head.revision_id, providerId="pexels"),
                Context(),
                transport=PreviewTransport(),
            )
        with pytest.raises(ValueError, match="unsupported fields"):
            search_visual_candidates(
                store,
                SearchRuntime(),
                LicensedMediaVisionSelector(VisionRuntime(), model="vision-model"),
                {**_params(head.revision_id), "remoteUrl": "https://attacker.test/image.png"},
                Context(),
                transport=PreviewTransport(),
            )


def test_nvidia_judge_derivative_is_bounded_without_changing_source_bytes() -> None:
    image_module = pytest.importorskip("PIL.Image")
    source_image = image_module.frombytes(
        "RGB",
        (1600, 900),
        random.Random(1701).randbytes(1600 * 900 * 3),
    )
    encoded = io.BytesIO()
    source_image.save(encoded, format="JPEG", quality=95)
    source = encoded.getvalue()
    assert len(source) > 180 * 1024

    preview, media_type = _judge_preview(source, "image/jpeg", max_bytes=180 * 1024)

    assert media_type == "image/jpeg"
    assert 0 < len(preview) <= 180 * 1024
    assert hashlib.sha256(source).hexdigest() != hashlib.sha256(preview).hexdigest()
