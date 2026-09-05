from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

import pytest

from alystria.project.cas import Artifact
from alystria.project.database import integrity_check
from alystria.project.errors import InvalidProjectError, ProjectExistsError, RevisionConflictError
from alystria.project.store import ProjectStore


def test_create_project_layout_and_initial_revision(tmp_path: Path) -> None:
    root = tmp_path / "My Tutorial"
    with ProjectStore.create(root, name="My Tutorial") as store:
        assert store.summary().name == "My Tutorial"
        assert store.head_revision() is not None
        assert store.head_revision().kind == "initial"
        assert (root / "objects" / "sha256").is_dir()
        assert (root / "sources" / "original").is_dir()
        manifest = json.loads((root / "manifest.json").read_text())
        assert manifest["format"] == "alystria-project"
        assert manifest["projectId"] == store.manifest.project_id
        integrity_check(store.connection)


def test_create_does_not_overwrite_existing_path(tmp_path: Path) -> None:
    target = tmp_path / "existing"
    target.mkdir()
    marker = target / "keep.txt"
    marker.write_text("keep")
    with pytest.raises(ProjectExistsError):
        ProjectStore.create(target, name="No")
    assert marker.read_text() == "keep"


def test_revisions_are_append_only_and_restore_creates_new_head(tmp_path: Path) -> None:
    with ProjectStore.create(tmp_path / "project", name="History") as store:
        initial = store.head_revision()
        assert initial is not None
        edit = store.create_revision(
            snapshot={"value": 2}, message="Edit", expected_head=initial.revision_id
        )
        approval = store.approve(name="Ready")
        restored = store.restore(initial.revision_id)
        assert restored.snapshot == initial.snapshot
        assert restored.parent_revision_id == approval.revision_id
        assert store.head_revision().revision_id == restored.revision_id
        assert len(store.list_revisions()) == 4
        assert store.get_revision(edit.revision_id).snapshot == {"value": 2}


def test_optimistic_revision_conflict_preserves_head(tmp_path: Path) -> None:
    with ProjectStore.create(tmp_path / "project", name="Conflict") as store:
        head = store.head_revision()
        assert head is not None
        newer = store.create_revision(snapshot={"value": "new"}, expected_head=head.revision_id)
        with pytest.raises(RevisionConflictError):
            store.create_revision(snapshot={"value": "lost"}, expected_head=head.revision_id)
        assert store.head_revision().revision_id == newer.revision_id


def test_cas_deduplicates_and_registers_content(tmp_path: Path) -> None:
    content = b"immutable artifact"
    with ProjectStore.create(tmp_path / "project", name="CAS") as store:
        first = store.add_artifact_bytes(content, media_type="text/plain", original_name="a.txt")
        second = store.add_artifact_bytes(content, media_type="text/plain", original_name="b.txt")
        assert first.hash == hashlib.sha256(content).hexdigest() == second.hash
        assert store.cas.object_path(first.hash).read_bytes() == content
        assert store.connection.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0] == 1


def test_artifact_batch_validation_registers_all_or_none(tmp_path: Path) -> None:
    with ProjectStore.create(tmp_path / "project", name="Artifact batch") as store:
        first = store.cas.add_bytes(b"delivery", media_type="video/webm", original_name="delivery.webm")
        second = store.cas.add_bytes(b"captions", media_type="text/vtt", original_name="captions.vtt")
        missing = Artifact("f" * 64, 1, "text/plain", "missing.txt")

        with pytest.raises(InvalidProjectError, match="missing or corrupt"):
            store.register_artifacts((first, missing))
        assert store.connection.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0] == 0

        store.register_artifacts((first, second))
        assert store.connection.execute("SELECT COUNT(*) FROM artifacts").fetchone()[0] == 2


def test_online_backup_is_consistent(tmp_path: Path) -> None:
    with ProjectStore.create(tmp_path / "project", name="Backup") as store:
        store.create_revision(snapshot={"a": 1})
        backup = store.backup(tmp_path / "snapshot.sqlite3")
        connection = sqlite3.connect(backup)
        try:
            assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
            assert connection.execute("SELECT COUNT(*) FROM revisions").fetchone()[0] == 2
        finally:
            connection.close()
