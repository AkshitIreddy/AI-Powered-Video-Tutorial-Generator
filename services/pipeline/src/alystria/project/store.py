"""Project lifecycle and revision history."""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import uuid
from collections.abc import Iterable
from contextlib import suppress
from pathlib import Path
from typing import Any

from .cas import Artifact, ContentAddressedStore
from .database import (
    LATEST_SCHEMA_VERSION,
    backup_database,
    connect,
    integrity_check,
    migrate,
    transaction,
)
from .errors import InvalidProjectError, ProjectExistsError, RevisionConflictError
from .models import Manifest, ProjectSummary, Revision, utc_now

MANIFEST_NAME = "manifest.json"
DATABASE_NAME = "project.sqlite3"
MAX_MANIFEST_BYTES = 1024 * 1024

DEFAULT_PROJECT_SETTINGS: dict[str, Any] = {
    "groundingMode": "grounded",
    "quality": "standard",
    "budgetProfile": "balanced",
    "executionMode": "hybrid",
    "captionsEnabled": True,
    "musicEnabled": False,
    "presenterMode": "auto",
    "repairLimit": 2,
    "privacyClassification": "private",
    "crossProviderCritique": False,
}


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


class ProjectStore:
    """The authoritative writer for one local project directory."""

    def __init__(self, root: Path, connection: sqlite3.Connection, manifest: Manifest) -> None:
        self.root = root.resolve()
        self.connection = connection
        self.manifest = manifest
        self.cas = ContentAddressedStore(self.root)

    @classmethod
    def create(
        cls,
        root: Path,
        *,
        name: str,
        project_id: str | None = None,
        initial_snapshot: dict[str, Any] | None = None,
    ) -> ProjectStore:
        if not name.strip():
            raise ValueError("Project name cannot be blank")
        root = root.absolute()
        if root.exists():
            raise ProjectExistsError(f"Project path already exists: {root}")
        root.parent.mkdir(parents=True, exist_ok=True)
        temporary = Path(tempfile.mkdtemp(prefix=f".{root.name}.creating-", dir=root.parent))
        connection: sqlite3.Connection | None = None
        try:
            for relative in ("objects/sha256", "sources/original", "staging", "exports", "backups"):
                (temporary / relative).mkdir(parents=True, exist_ok=True)
            now = utc_now()
            manifest = Manifest(1, project_id or _new_id("prj"), now)
            cls._write_manifest_at(temporary, manifest)
            connection = connect(temporary / DATABASE_NAME)
            migrate(connection)
            with transaction(connection):
                connection.execute(
                    """INSERT INTO project_meta(
                        singleton,project_id,name,created_at,updated_at,settings_json
                    ) VALUES(1,?,?,?,?,?)""",
                    (manifest.project_id, name.strip(), now, now, _canonical_json(DEFAULT_PROJECT_SETTINGS)),
                )
            connection.close()
            connection = None
            os.replace(temporary, root)
            store = cls.open(root)
            store.create_revision(
                snapshot=initial_snapshot or {"projectId": manifest.project_id, "name": name.strip()},
                kind="initial",
                message="Project created",
            )
            return store
        except BaseException:
            if connection is not None:
                connection.close()
            if temporary.exists():
                import shutil

                shutil.rmtree(temporary)
            raise

    @classmethod
    def initialize_existing(
        cls,
        root: Path,
        *,
        expected_project_id: str,
        expected_manifest_revision: int | None = None,
        initial_snapshot: dict[str, Any] | None = None,
    ) -> ProjectStore:
        """Initialize a desktop-created project skeleton without replacing it.

        The Rust broker creates ``manifest.json`` and the directory layout; the
        pipeline remains the sole owner of ``project.sqlite3``.  Initialization
        is idempotent, identity checked, and protected by a create-new lock so
        two worker requests cannot race an atomic database promotion.
        """

        root = root.resolve(strict=True)
        manifest_path = root / MANIFEST_NAME
        manifest_value, manifest = cls._read_manifest(manifest_path)
        if manifest.project_id != expected_project_id:
            raise InvalidProjectError("Manifest projectId does not match the initialization request")
        manifest_revision = manifest_value.get("manifestRevision")
        if (
            expected_manifest_revision is not None
            and manifest_revision is not None
            and int(manifest_revision) != expected_manifest_revision
        ):
            raise InvalidProjectError(
                "Manifest revision does not match the initialization request"
            )

        database_path = root / manifest.database_path
        cls._validate_project_relative_path(root, database_path, "database path")
        if not database_path.exists():
            temporary = database_path.with_name(
                f".{database_path.name}.initializing-{uuid.uuid4().hex}"
            )
            connection: sqlite3.Connection | None = None
            try:
                connection = connect(temporary)
                migrate(connection)
                now = utc_now()
                name = str(manifest_value.get("title", "Untitled tutorial")).strip()
                if not name:
                    name = "Untitled tutorial"
                settings = dict(DEFAULT_PROJECT_SETTINGS)
                settings["locale"] = str(manifest_value.get("locale", "en-US"))
                grounding = manifest_value.get("groundingMode")
                if isinstance(grounding, str) and grounding:
                    settings["groundingMode"] = grounding
                with transaction(connection):
                    connection.execute(
                        """INSERT INTO project_meta(
                            singleton,project_id,name,created_at,updated_at,settings_json
                        ) VALUES(1,?,?,?,?,?)""",
                        (
                            manifest.project_id,
                            name,
                            manifest.created_at,
                            now,
                            _canonical_json(settings),
                        ),
                    )
                integrity_check(connection)
                connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                connection.close()
                connection = None
                with suppress(FileExistsError):
                    # A hard-link promotion is atomic and refuses to replace an
                    # existing file on every supported desktop platform.  A
                    # competing initializer may win; both then open the same
                    # validated database.
                    os.link(temporary, database_path)
            except BaseException:
                if connection is not None:
                    connection.close()
                raise
            finally:
                temporary.unlink(missing_ok=True)
                temporary.with_name(temporary.name + "-wal").unlink(missing_ok=True)
                temporary.with_name(temporary.name + "-shm").unlink(missing_ok=True)

        store = cls.open(root)
        store._ensure_initial_revision(initial_snapshot=initial_snapshot)
        return store

    @classmethod
    def open(cls, root: Path, *, readonly: bool = False) -> ProjectStore:
        root = root.resolve(strict=True)
        manifest_path = root / MANIFEST_NAME
        if not manifest_path.is_file():
            raise InvalidProjectError("Project requires manifest.json and project.sqlite3")
        try:
            _, manifest = cls._read_manifest(manifest_path)
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
            raise InvalidProjectError(f"Invalid project manifest: {error}") from error
        if manifest.schema_version != 1:
            raise InvalidProjectError(f"Unsupported manifest schema {manifest.schema_version}")
        database_path = root / manifest.database_path
        cls._validate_project_relative_path(root, database_path, "database path")
        if not database_path.is_file():
            raise InvalidProjectError("Project requires manifest.json and project.sqlite3")
        connection = connect(database_path, readonly=readonly)
        if not readonly:
            database_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
            if database_version < LATEST_SCHEMA_VERSION:
                backup_name = (
                    f"pre-migration-v{database_version}-{utc_now().replace(':', '-')}.sqlite3"
                )
                backup_database(connection, root / "backups" / backup_name)
            migrate(connection)
        integrity_check(connection)
        row = connection.execute("SELECT project_id,name FROM project_meta WHERE singleton=1").fetchone()
        if row is None or row["project_id"] != manifest.project_id:
            connection.close()
            raise InvalidProjectError("Manifest and database identity do not match")
        return cls(root, connection, manifest)

    @staticmethod
    def _read_manifest(path: Path) -> tuple[dict[str, Any], Manifest]:
        try:
            metadata = path.stat()
            if not path.is_file() or metadata.st_size > MAX_MANIFEST_BYTES:
                raise InvalidProjectError(
                    "Project manifest is not a regular file or exceeds 1 MiB"
                )
            with path.open("r", encoding="utf-8") as stream:
                value = json.load(stream)
            if not isinstance(value, dict):
                raise InvalidProjectError("Project manifest must be a JSON object")
            return value, Manifest.from_dict(value)
        except InvalidProjectError:
            raise
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
            raise InvalidProjectError(f"Invalid project manifest: {error}") from error

    @staticmethod
    def _validate_project_relative_path(root: Path, path: Path, label: str) -> None:
        try:
            path.resolve(strict=False).relative_to(root)
        except ValueError as error:
            raise InvalidProjectError(f"Project {label} escapes the project directory") from error

    def _ensure_initial_revision(
        self, *, initial_snapshot: dict[str, Any] | None = None
    ) -> None:
        """Create exactly one initial revision, including under concurrent init."""

        with transaction(self.connection):
            row = self.connection.execute(
                "SELECT head_revision_id,name FROM project_meta WHERE singleton=1"
            ).fetchone()
            if row is None:
                raise InvalidProjectError("Project metadata is missing")
            if row["head_revision_id"] is not None:
                return
            existing = self.connection.execute(
                "SELECT revision_id FROM revisions ORDER BY revision_number DESC LIMIT 1"
            ).fetchone()
            if existing is not None:
                self.connection.execute(
                    "UPDATE project_meta SET head_revision_id=?,updated_at=? WHERE singleton=1",
                    (existing["revision_id"], utc_now()),
                )
                return

            revision_id = _new_id("rev")
            now = utc_now()
            snapshot = dict(
                initial_snapshot
                or {"projectId": self.manifest.project_id, "name": row["name"]}
            )
            # The desktop manifest is the identity authority. A provisional UI
            # id must never leak into the durable initial revision.
            snapshot["id"] = self.manifest.project_id
            snapshot_json = _canonical_json(snapshot)
            import hashlib

            root_hash = hashlib.sha256(snapshot_json.encode()).hexdigest()
            self.connection.execute(
                """INSERT INTO revisions(
                    revision_id,project_id,parent_revision_id,kind,name,message,snapshot_json,
                    revision_number,root_hash,author,approval_status,created_at
                ) VALUES(?,?,NULL,'initial',NULL,?,?,?,?,?,'draft',?)""",
                (
                    revision_id,
                    self.manifest.project_id,
                    "Project initialized",
                    snapshot_json,
                    1,
                    root_hash,
                    "system",
                    now,
                ),
            )
            self.connection.execute(
                "UPDATE project_meta SET head_revision_id=?,updated_at=? WHERE singleton=1",
                (revision_id, now),
            )

    def __enter__(self) -> ProjectStore:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        self.connection.close()

    def summary(self) -> ProjectSummary:
        row = self.connection.execute("SELECT * FROM project_meta WHERE singleton=1").fetchone()
        assert row is not None
        return ProjectSummary(
            project_id=row["project_id"],
            name=row["name"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            head_revision_id=row["head_revision_id"],
            settings=json.loads(row["settings_json"]),
        )

    def create_revision(
        self,
        *,
        snapshot: dict[str, Any],
        kind: str = "edit",
        name: str | None = None,
        message: str = "",
        expected_head: str | None = None,
        artifact_links: list[dict[str, str]] | None = None,
    ) -> Revision:
        if kind not in {"initial", "edit", "generation", "approval", "restore", "import"}:
            raise ValueError(f"Unsupported revision kind: {kind}")
        revision_id = _new_id("rev")
        now = utc_now()
        snapshot_json = _canonical_json(snapshot)
        import hashlib

        root_hash = hashlib.sha256(snapshot_json.encode()).hexdigest()
        author = "system" if kind in {"initial", "generation", "import"} else "user"
        approval_status = "approved" if kind == "approval" else "draft"
        with transaction(self.connection):
            meta = self.connection.execute(
                "SELECT project_id,head_revision_id FROM project_meta WHERE singleton=1"
            ).fetchone()
            assert meta is not None
            parent_id = meta["head_revision_id"]
            revision_number = int(
                self.connection.execute("SELECT COALESCE(MAX(revision_number),0)+1 FROM revisions").fetchone()[0]
            )
            if expected_head is not None and expected_head != parent_id:
                raise RevisionConflictError(
                    f"Expected head {expected_head}, but current head is {parent_id}"
                )
            self.connection.execute(
                """INSERT INTO revisions(
                    revision_id,project_id,parent_revision_id,kind,name,message,snapshot_json,
                    revision_number,root_hash,author,approval_status,created_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    revision_id,
                    meta["project_id"],
                    parent_id,
                    kind,
                    name,
                    message,
                    snapshot_json,
                    revision_number,
                    root_hash,
                    author,
                    approval_status,
                    now,
                ),
            )
            for link in artifact_links or []:
                self.connection.execute(
                    "INSERT INTO revision_artifacts(revision_id,artifact_hash,role,stable_id) VALUES(?,?,?,?)",
                    (revision_id, link["artifactHash"], link["role"], link.get("stableId", "")),
                )
            self.connection.execute(
                "UPDATE project_meta SET head_revision_id=?,updated_at=? WHERE singleton=1",
                (revision_id, now),
            )
        return Revision(
            revision_id,
            meta["project_id"],
            parent_id,
            kind,
            name,
            message,
            snapshot,
            now,
            revision_number,
            root_hash,
            author,
            approval_status,
        )

    def approve(self, *, name: str, message: str = "Approved snapshot") -> Revision:
        head = self.head_revision()
        if head is None:
            raise InvalidProjectError("Cannot approve a project with no revision")
        return self.create_revision(
            snapshot=head.snapshot,
            kind="approval",
            name=name,
            message=message,
            expected_head=head.revision_id,
        )

    def restore(self, revision_id: str, *, message: str | None = None) -> Revision:
        restored = self.get_revision(revision_id)
        return self.create_revision(
            snapshot=restored.snapshot,
            kind="restore",
            message=message or f"Restored {revision_id}",
        )

    def get_revision(self, revision_id: str) -> Revision:
        row = self.connection.execute(
            "SELECT * FROM revisions WHERE revision_id=?", (revision_id,)
        ).fetchone()
        if row is None:
            raise KeyError(revision_id)
        return self._revision_from_row(row)

    def head_revision(self) -> Revision | None:
        row = self.connection.execute(
            """SELECT r.* FROM revisions r
            JOIN project_meta p ON p.head_revision_id=r.revision_id WHERE p.singleton=1"""
        ).fetchone()
        return None if row is None else self._revision_from_row(row)

    def list_revisions(self, *, limit: int = 100) -> list[Revision]:
        if not 1 <= limit <= 1000:
            raise ValueError("Revision limit must be between 1 and 1000")
        rows = self.connection.execute(
            "SELECT * FROM revisions ORDER BY created_at DESC, rowid DESC LIMIT ?", (limit,)
        ).fetchall()
        return [self._revision_from_row(row) for row in rows]

    def register_artifact(self, artifact: Artifact) -> None:
        self.register_artifacts((artifact,))

    def register_artifacts(self, artifacts: Iterable[Artifact]) -> None:
        pending = tuple(artifacts)
        for artifact in pending:
            if not self.cas.verify(artifact.hash):
                raise InvalidProjectError(f"Cannot register missing or corrupt object {artifact.hash}")
        with transaction(self.connection):
            for artifact in pending:
                self.connection.execute(
                    """INSERT INTO artifacts(
                        hash,algorithm,byte_size,media_type,original_name,metadata_json,created_at
                    ) VALUES(?,?,?,?,?,?,?) ON CONFLICT(hash) DO NOTHING""",
                    (
                        artifact.hash,
                        "sha256",
                        artifact.byte_size,
                        artifact.media_type,
                        artifact.original_name,
                        _canonical_json(artifact.metadata or {}),
                        utc_now(),
                    ),
                )

    def add_artifact_bytes(
        self,
        content: bytes,
        *,
        media_type: str,
        original_name: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Artifact:
        artifact = self.cas.add_bytes(
            content, media_type=media_type, original_name=original_name, metadata=metadata
        )
        self.register_artifact(artifact)
        return artifact

    def backup(self, destination: Path | None = None) -> Path:
        if destination is None:
            destination = self.root / "backups" / f"project-{utc_now().replace(':', '-')}.sqlite3"
        if destination.exists():
            raise ProjectExistsError(f"Backup already exists: {destination}")
        backup_database(self.connection, destination)
        return destination

    @staticmethod
    def _revision_from_row(row: sqlite3.Row) -> Revision:
        return Revision(
            revision_id=row["revision_id"],
            project_id=row["project_id"],
            parent_revision_id=row["parent_revision_id"],
            kind=row["kind"],
            name=row["name"],
            message=row["message"],
            snapshot=json.loads(row["snapshot_json"]),
            created_at=row["created_at"],
            number=row["revision_number"],
            root_hash=row["root_hash"],
            author=row["author"],
            approval_status=row["approval_status"],
        )

    @staticmethod
    def _write_manifest_at(root: Path, manifest: Manifest) -> None:
        target = root / MANIFEST_NAME
        temporary = target.with_suffix(".json.tmp")
        content = json.dumps(manifest.to_dict(), ensure_ascii=False, indent=2) + "\n"
        with temporary.open("w", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
