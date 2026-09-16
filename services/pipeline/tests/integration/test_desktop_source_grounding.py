from __future__ import annotations

import base64
import uuid
from pathlib import Path

import pytest

from alystria.generation import GenerationCoordinator, GenerationStage, request_from_desktop
from alystria.project import ProjectStore
from alystria.service import PipelineService
from alystria.sources import DoclingUnavailableError, FileExtractionResult


def _desktop_params() -> dict[str, object]:
    return {
        "snapshotId": None,
        "scope": {"kind": "project"},
        "quality": "standard",
        "privacy": "local",
        "approvedProviderIds": [],
        "preservationLocks": [],
    }


def _source_snapshot(source: dict[str, object]) -> dict[str, object]:
    return {
        "brief": {
            "topic": "Imported source grounding",
            "audience": "General learners",
            "durationSeconds": 120,
            "locale": "en-US",
        },
        "groundingMode": "grounded",
        "sources": [source],
    }


def test_imported_markdown_reaches_generation_evidence(tmp_path: Path) -> None:
    project_id = str(uuid.uuid4())
    root = tmp_path / "Grounded Project"
    with ProjectStore.create(
        root,
        name="Grounded Project",
        project_id=project_id,
        initial_snapshot=_source_snapshot({}) | {"sources": []},
    ) as store:
        head = store.head_revision()
        assert head is not None
        expected_head = head.revision_id

    unique_fact = "The cobalt-kestrel invariant appears only in the imported course note."
    imported = PipelineService().source_import(
        {
            "projectId": project_id,
            "projectDirectory": str(root),
            "expectedHeadRevisionId": expected_head,
            "filename": "course-note.md",
            "mimeType": "text/markdown",
            "privacy": "project_local",
            "rightsStatus": "owned",
            "license": "User supplied",
            "attribution": "Course author",
            "contentBase64": base64.b64encode(
                f"# Verified note\n\n{unique_fact}\n".encode()
            ).decode("ascii"),
        }
    )

    with ProjectStore.open(root) as store:
        request = request_from_desktop(store, _desktop_params())
        assert request.sources[0].artifact_hash == imported["artifactHash"]
        assert unique_fact in request.sources[0].content
        assert request.sources[0].locator == f"cas:sha256:{imported['artifactHash']}"
        assert request.sources[0].locator_metadata["filename"] == "course-note.md"

        coordinator = GenerationCoordinator(store)
        generation_id = coordinator.start(request).generation_id
        coordinator.run_pending()
        ingest = next(
            job
            for job in coordinator._jobs(generation_id)
            if job.parameters["stage"] == GenerationStage.INGEST_RESEARCH.value
        )
        assert ingest.result is not None
        payload = ingest.result["payload"]
        evidence_text = "\n".join(item["text"] for item in payload["evidenceChunks"])
        assert unique_fact in evidence_text
        imported_source = next(item for item in payload["sources"] if item["id"] != "topic")
        assert imported_source["artifactHash"] == imported["artifactHash"]
        assert imported_source["locatorMetadata"]["storedRelativePath"].startswith(
            "sources/original/"
        )


def test_corrupted_source_artifact_is_rejected(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Corrupt Project", name="Corrupt Project")
    try:
        artifact = store.cas.add_bytes(b"Trusted original\n", original_name="note.md")
        store.cas.object_path(artifact.hash).write_bytes(b"Tampered object\n")
        store.create_revision(
            snapshot=_source_snapshot(
                {
                    "id": "source.corrupt",
                    "title": "Corrupt note",
                    "filename": "note.md",
                    "mediaType": "text/markdown",
                    "artifactHash": artifact.hash,
                }
            ),
            kind="edit",
        )
        with pytest.raises(ValueError, match="artifact is corrupt"):
            request_from_desktop(store, _desktop_params())
    finally:
        store.close()


def test_unsupported_recorded_source_is_rejected(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Unsupported Project", name="Unsupported Project")
    try:
        artifact = store.cas.add_bytes(
            b"RIFF\x00\x00\x00\x00WAVE",
            media_type="audio/wav",
            original_name="recording.wav",
        )
        store.create_revision(
            snapshot=_source_snapshot(
                {
                    "id": "source.audio",
                    "title": "Recorded audio",
                    "filename": "recording.wav",
                    "mediaType": "audio/wav",
                    "artifactHash": artifact.hash,
                }
            ),
            kind="edit",
        )
        with pytest.raises(ValueError, match="is not extractable"):
            request_from_desktop(store, _desktop_params())
    finally:
        store.close()


class _UnavailableDocumentExtractor:
    def extract(self, path: Path, *, max_chars: int) -> FileExtractionResult:
        del path, max_chars
        raise DoclingUnavailableError("isolated document parser is unavailable")


def test_unavailable_document_parser_is_rejected(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "PDF Project", name="PDF Project")
    try:
        artifact = store.cas.add_bytes(
            b"%PDF-1.7\n% bounded fixture\n",
            media_type="application/pdf",
            original_name="paper.pdf",
        )
        store.create_revision(
            snapshot=_source_snapshot(
                {
                    "id": "source.paper",
                    "title": "Paper",
                    "filename": "paper.pdf",
                    "mediaType": "application/pdf",
                    "artifactHash": artifact.hash,
                }
            ),
            kind="edit",
        )
        with pytest.raises(ValueError, match="isolated document parser is unavailable"):
            request_from_desktop(
                store,
                _desktop_params(),
                document_extractor=_UnavailableDocumentExtractor(),
            )
    finally:
        store.close()
