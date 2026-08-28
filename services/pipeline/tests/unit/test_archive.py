from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from alystria.project import ProjectStore, export_project, import_project
from alystria.project.archive import ArchiveLimits
from alystria.project.errors import ArchiveLimitError, UnsafePathError


def test_archive_round_trip_preserves_identity_history_and_objects(tmp_path: Path) -> None:
    original = tmp_path / "original"
    with ProjectStore.create(original, name="Portable") as store:
        artifact = store.add_artifact_bytes(b"hello", media_type="text/plain")
        revision = store.create_revision(
            snapshot={"artifact": artifact.hash},
            artifact_links=[{"artifactHash": artifact.hash, "role": "source"}],
        )
        project_id = store.manifest.project_id
        archive = export_project(store, tmp_path / "portable.alytutorial")
    with import_project(archive, tmp_path / "imported") as imported:
        assert imported.manifest.project_id == project_id
        assert imported.head_revision().revision_id == revision.revision_id
        assert imported.cas.verify(artifact.hash)


def test_archive_rejects_parent_traversal(tmp_path: Path) -> None:
    archive = tmp_path / "unsafe.alytutorial"
    with zipfile.ZipFile(archive, "w") as output:
        output.writestr("../escaped.txt", "bad")
    with pytest.raises(UnsafePathError):
        import_project(archive, tmp_path / "target")
    assert not (tmp_path / "escaped.txt").exists()


def test_archive_rejects_expansion_limits(tmp_path: Path) -> None:
    archive = tmp_path / "oversize.alytutorial"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED) as output:
        output.writestr("manifest.json", "x" * 20)
    with pytest.raises(ArchiveLimitError):
        import_project(
            archive,
            tmp_path / "target",
            limits=ArchiveLimits(max_file_bytes=10, max_total_bytes=100),
        )
