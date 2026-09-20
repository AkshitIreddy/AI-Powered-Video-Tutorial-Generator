from __future__ import annotations

import copy
import io
import uuid
import wave
from pathlib import Path
from typing import Any

import pytest

from alystria.generation.audio_assets import resolve_audio_customization
from alystria.music_workflow import (
    accept_music_candidate,
    reject_music_candidate,
    search_music_candidates,
)
from alystria.project import ProjectStore
from alystria.providers.types import (
    MediaAsset,
    MediaOutput,
    MediaSearchRequest,
    ProviderResult,
    Usage,
)
from alystria.sources.safety import HttpResponse


def _wav(frequency: int) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(8_000)
        samples = bytearray()
        for index in range(8_000):
            value = 7_000 if (index * frequency // 8_000) % 2 else -7_000
            samples.extend(int(value).to_bytes(2, "little", signed=True))
        writer.writeframes(bytes(samples))
    return output.getvalue()


class SearchRuntime:
    def __init__(self) -> None:
        self.requests: list[MediaSearchRequest] = []

    def invoke(
        self, request: MediaSearchRequest, *, idempotency_key: str
    ) -> ProviderResult[Any]:
        assert len(idempotency_key) == 64
        self.requests.append(request)
        return ProviderResult(
            "openverse",
            "licensed-media",
            MediaOutput(
                (
                    MediaAsset(
                        uri="https://media.test/curious.wav",
                        media_type="audio/wav",
                        duration_seconds=60,
                        license="by",
                        license_version="4.0",
                        license_url="https://creativecommons.org/licenses/by/4.0/",
                        attribution='"Curious Motion" by Ada Artist · CC BY 4.0',
                        source_url="https://source.test/track/curious",
                        title="Curious scientific motion instrumental",
                        creator="Ada Artist",
                        creator_url="https://source.test/creators/ada",
                        foreign_identifier="track-curious",
                        provider="wikimedia_audio",
                        source="wikimedia",
                        tags=("curious", "ambient", "instrumental"),
                    ),
                    MediaAsset(
                        uri="https://media.test/calm.wav",
                        media_type="audio/wav",
                        duration_seconds=45,
                        license="cc0",
                        attribution="Calm loop by Example Composer",
                        source_url="https://source.test/track/calm",
                        title="Calm loop",
                        creator="Example Composer",
                        foreign_identifier="track-calm",
                        provider="freesound",
                        source="freesound",
                        tags=("calm", "loop"),
                    ),
                    MediaAsset(
                        uri="https://media.test/noncommercial.wav",
                        media_type="audio/wav",
                        duration_seconds=30,
                        license="by-nc",
                        attribution="Blocked creator",
                        source_url="https://source.test/track/blocked",
                        title="Blocked noncommercial track",
                        creator="Blocked creator",
                    ),
                )
            ),
            Usage("openverse", "licensed-media", {"requests": 1.0}, 0),
            "search-1",
        )


class Transport:
    def __init__(self) -> None:
        self.requests: list[str] = []

    def get(self, url: str, *, headers: dict[str, str] | None = None) -> HttpResponse:
        assert headers is not None and "audio/mpeg" in headers["Accept"]
        self.requests.append(url)
        frequency = 220 if "curious" in url else 330
        return HttpResponse(url, 200, {"content-type": "audio/wav"}, _wav(frequency))


class Context:
    job_id = "job-music"
    task_key = "music-task-key"

    def __init__(self) -> None:
        self.progress: list[tuple[float, str | None]] = []

    def check_cancelled(self) -> None:
        return None

    def set_progress(self, progress: float, *, message: str | None = None) -> None:
        self.progress.append((progress, message))


def _project(tmp_path: Path) -> ProjectStore:
    return ProjectStore.create(
        tmp_path / "music-project",
        name="Music project",
        project_id=str(uuid.uuid4()),
        initial_snapshot={
            "id": "temporary",
            "title": "How stars form",
            "scenes": [{"id": "scene-one", "title": "Stellar nursery"}],
            "customization": {
                "assets": [],
                "audio": {"musicAssetId": None, "musicLevel": 12, "narrationDucking": 72},
            },
            "mediaAssets": [],
            "assetProvenance": [],
        },
    )


def _search(store: ProjectStore) -> tuple[dict[str, Any], SearchRuntime, Transport]:
    head = store.head_revision()
    assert head is not None
    runtime = SearchRuntime()
    transport = Transport()
    receipt = search_music_candidates(
        store,
        runtime,
        {
            "expectedHeadRevisionId": head.revision_id,
            "topic": "How stars form",
            "mood": "curious",
            "alternatives": 2,
            "locale": "en-US",
        },
        Context(),
        transport=transport,
    )
    return receipt, runtime, transport


def test_search_downloads_only_safe_licenses_and_preserves_review_state(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        before = copy.deepcopy(store.head_revision().snapshot)  # type: ignore[union-attr]
        receipt, runtime, transport = _search(store)

        assert runtime.requests == [
            MediaSearchRequest(
                query="stars form",
                media_type="audio",
                page_size=20,
                license_allowlist=("cc0", "by"),
                locale="en-US",
            )
        ]
        assert len(transport.requests) == 2
        assert receipt["recommendedCandidateId"] == receipt["candidateIds"][0]
        head = store.head_revision()
        assert head is not None
        assert head.snapshot["customization"] == before["customization"]
        assert head.snapshot["mediaAssets"] == []
        candidates = head.snapshot["musicCandidates"]
        assert len(candidates) == 2
        assert candidates[0]["title"] == "Curious scientific motion instrumental"
        assert candidates[0]["license"] == "CC-BY-4.0"
        assert candidates[0]["attribution"] == (
            '"Curious scientific motion instrumental" by Ada Artist · CC-BY-4.0 '
            "(https://creativecommons.org/licenses/by/4.0/) · "
            "https://source.test/track/curious"
        )
        assert candidates[0]["rightsReviewRequired"] is True
        assert store.cas.verify(candidates[0]["artifactHash"])


def test_search_falls_back_from_topic_to_mood_without_hiding_attempts(tmp_path: Path) -> None:
    class FallbackRuntime(SearchRuntime):
        def invoke(
            self, request: MediaSearchRequest, *, idempotency_key: str
        ) -> ProviderResult[Any]:
            result = super().invoke(request, idempotency_key=idempotency_key)
            if request.query == "stars form":
                return ProviderResult(
                    "openverse",
                    "licensed-media",
                    MediaOutput(()),
                    result.usage,
                    "empty-topic",
                )
            return result

    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None
        runtime = FallbackRuntime()
        receipt = search_music_candidates(
            store,
            runtime,
            {
                "expectedHeadRevisionId": head.revision_id,
                "topic": "How stars form",
                "mood": "curious",
                "alternatives": 2,
                "locale": "en-US",
            },
            Context(),
            transport=Transport(),
        )

        assert [request.query for request in runtime.requests] == ["stars form", "curious"]
        assert receipt["queriesAttempted"] == ["stars form", "curious"]
        current = store.head_revision()
        assert current is not None
        assert all(
            candidate["matchedQuery"] == "curious"
            for candidate in current.snapshot["musicCandidates"]
        )


def test_search_falls_back_when_topic_result_fails_audio_validation(tmp_path: Path) -> None:
    class DownloadFallbackRuntime(SearchRuntime):
        def invoke(
            self, request: MediaSearchRequest, *, idempotency_key: str
        ) -> ProviderResult[Any]:
            result = super().invoke(request, idempotency_key=idempotency_key)
            if request.query != "stars form":
                return result
            return ProviderResult(
                "openverse",
                "licensed-media",
                MediaOutput(
                    (
                        MediaAsset(
                            uri="https://media.test/not-audio.wav",
                            media_type="audio/wav",
                            duration_seconds=30,
                            license="cc0",
                            attribution="Broken download",
                            source_url="https://source.test/track/broken",
                            title="Unavailable topic match",
                            creator="Example Creator",
                        ),
                    )
                ),
                result.usage,
                "invalid-topic-download",
            )

    class DownloadFallbackTransport(Transport):
        def get(self, url: str, *, headers: dict[str, str] | None = None) -> HttpResponse:
            if "not-audio" in url:
                self.requests.append(url)
                return HttpResponse(url, 200, {"content-type": "text/html"}, b"not audio")
            return super().get(url, headers=headers)

    with _project(tmp_path) as store:
        head = store.head_revision()
        assert head is not None
        runtime = DownloadFallbackRuntime()
        receipt = search_music_candidates(
            store,
            runtime,
            {
                "expectedHeadRevisionId": head.revision_id,
                "topic": "How stars form",
                "mood": "curious",
                "alternatives": 2,
                "locale": "en-US",
            },
            Context(),
            transport=DownloadFallbackTransport(),
        )

        assert [request.query for request in runtime.requests] == ["stars form", "curious"]
        assert receipt["queriesAttempted"] == ["stars form", "curious"]
        assert receipt["skippedResultCount"] == 1
        assert receipt["readyCount"] == 2


def test_accept_promotes_selected_music_with_attribution_and_render_binding(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        receipt, _, _ = _search(store)
        search_head = store.head_revision()
        assert search_head is not None
        accepted = accept_music_candidate(
            store,
            {
                "expectedHeadRevisionId": search_head.revision_id,
                "candidateId": receipt["recommendedCandidateId"],
            },
        )

        head = store.head_revision()
        assert head is not None
        assert head.snapshot["customization"]["audio"]["musicAssetId"] == accepted["assetId"]
        asset = head.snapshot["mediaAssets"][0]
        assert asset["kind"] == "music" and asset["state"] == "promoted"
        proof = head.snapshot["assetProvenance"][0]
        assert proof["rights"]["status"] == "userReviewed"
        assert proof["rights"]["license"] == "CC-BY-4.0"
        assert proof["rights"]["attribution"].startswith(
            '"Curious scientific motion instrumental" by Ada Artist'
        )
        assert proof["exportEligible"] is True
        binding = resolve_audio_customization(store, head.snapshot)
        assert binding["inputs"][0] == {
            "assetId": accepted["assetId"],
            "artifactHash": accepted["artifactHash"],
            "mediaType": "audio/wav",
            "role": "music",
            "source": "project",
            "gainDb": pytest.approx(-18.42),
            "schedule": "full-program-loop",
        }
        assert binding["mix"]["musicDuckingDb"] == -12.96


def test_reject_keeps_current_music_selection_unchanged(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        receipt, _, _ = _search(store)
        head = store.head_revision()
        assert head is not None
        rejected = reject_music_candidate(
            store,
            {
                "expectedHeadRevisionId": head.revision_id,
                "candidateId": receipt["candidateIds"][1],
                "reason": "Too slow for this lesson",
            },
        )
        current = store.head_revision()
        assert current is not None
        assert rejected["status"] == "rejected"
        assert current.snapshot["customization"]["audio"]["musicAssetId"] is None
        candidate = next(
            item for item in current.snapshot["musicCandidates"] if item["id"] == rejected["candidateId"]
        )
        assert candidate["rejectionReason"] == "Too slow for this lesson"


def test_accept_rejects_candidate_or_cas_metadata_tampering(tmp_path: Path) -> None:
    with _project(tmp_path) as store:
        receipt, _, _ = _search(store)
        head = store.head_revision()
        assert head is not None
        snapshot = copy.deepcopy(head.snapshot)
        snapshot["musicCandidates"][0]["sourceUrl"] = "https://attacker.test/music"
        tampered = store.create_revision(
            snapshot=snapshot,
            expected_head=head.revision_id,
            message="Tamper with music provenance",
        )
        with pytest.raises(ValueError, match="sourceUri metadata does not match"):
            accept_music_candidate(
                store,
                {
                    "expectedHeadRevisionId": tampered.revision_id,
                    "candidateId": receipt["candidateIds"][0],
                },
            )
