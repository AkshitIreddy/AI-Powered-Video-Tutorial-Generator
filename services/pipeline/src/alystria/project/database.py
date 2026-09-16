"""SQLite connection policy, migrations, transactions and online backups."""

from __future__ import annotations

import contextlib
import sqlite3
import uuid
from collections.abc import Iterator
from pathlib import Path

from .errors import InvalidProjectError

LATEST_SCHEMA_VERSION = 4

MIGRATIONS: dict[int, str] = {
    1: """
    CREATE TABLE project_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        project_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        head_revision_id TEXT,
        settings_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE revisions (
        revision_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        parent_revision_id TEXT REFERENCES revisions(revision_id),
        kind TEXT NOT NULL CHECK (kind IN ('initial','edit','generation','approval','restore','import')),
        name TEXT,
        message TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        revision_number INTEGER NOT NULL,
        root_hash TEXT NOT NULL,
        author TEXT NOT NULL CHECK (author IN ('user','system','provider','migration')),
        approval_status TEXT NOT NULL CHECK (approval_status IN ('draft','proposed','approved','rejected','superseded')),
        created_at TEXT NOT NULL
    );
    CREATE INDEX revisions_project_created ON revisions(project_id, created_at);
    CREATE TABLE artifacts (
        hash TEXT PRIMARY KEY,
        algorithm TEXT NOT NULL CHECK (algorithm = 'sha256'),
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        media_type TEXT NOT NULL,
        original_name TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
    );
    CREATE TABLE revision_artifacts (
        revision_id TEXT NOT NULL REFERENCES revisions(revision_id) ON DELETE CASCADE,
        artifact_hash TEXT NOT NULL REFERENCES artifacts(hash),
        role TEXT NOT NULL,
        stable_id TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (revision_id, artifact_hash, role, stable_id)
    );
    CREATE TABLE jobs (
        job_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        task_key TEXT NOT NULL,
        implementation_version TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('BLOCKED','READY','QUEUED','RUNNING','SUCCEEDED','RETRY_WAIT','FAILED','CANCELLED','STALE')),
        parameters_json TEXT NOT NULL,
        result_json TEXT,
        error_json TEXT,
        progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
        priority INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0,1)),
        estimated_cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (estimated_cost_micros >= 0),
        available_at TEXT NOT NULL,
        lease_owner TEXT,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        UNIQUE(project_id, task_key)
    );
    CREATE INDEX jobs_claim ON jobs(state, available_at, priority DESC, created_at);
    CREATE TABLE job_dependencies (
        job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
        dependency_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE RESTRICT,
        PRIMARY KEY(job_id, dependency_id),
        CHECK(job_id <> dependency_id)
    );
    CREATE TABLE job_attempts (
        attempt_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
        attempt_number INTEGER NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('RUNNING','SUCCEEDED','FAILED','CANCELLED','ABANDONED')),
        worker_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error_json TEXT,
        UNIQUE(job_id, attempt_number)
    );
    CREATE TABLE job_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX job_events_job_sequence ON job_events(job_id, sequence);
    CREATE TABLE usage_records (
        usage_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        unit TEXT NOT NULL,
        quantity REAL NOT NULL CHECK (quantity >= 0),
        cost_micros INTEGER NOT NULL CHECK (cost_micros >= 0),
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
    );
    CREATE INDEX usage_job ON usage_records(job_id);
    CREATE TABLE task_cache (
        project_id TEXT NOT NULL,
        task_key TEXT NOT NULL,
        result_json TEXT NOT NULL,
        artifact_hashes_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        PRIMARY KEY(project_id, task_key)
    );
    CREATE TABLE dependency_nodes (
        project_id TEXT NOT NULL,
        logical_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('CURRENT','STALE')),
        artifact_hash TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(project_id, logical_key)
    );
    CREATE TABLE dependency_edges (
        project_id TEXT NOT NULL,
        upstream_key TEXT NOT NULL,
        downstream_key TEXT NOT NULL,
        PRIMARY KEY(project_id, upstream_key, downstream_key),
        CHECK(upstream_key <> downstream_key)
    );
    PRAGMA user_version = 1;
    """,
    2: """
    CREATE TABLE generation_controls (
        generation_id TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK (state IN ('ACTIVE','CANCELLED')),
        updated_at TEXT NOT NULL
    );
    PRAGMA user_version = 2;
    """,
    3: """
    CREATE TABLE revision_navigation (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        head_revision_id TEXT NOT NULL REFERENCES revisions(revision_id),
        undo_stack_json TEXT NOT NULL DEFAULT '[]',
        redo_stack_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
    );
    PRAGMA user_version = 3;
    """,
    4: """
    CREATE TABLE provider_acceptance_checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        provider_request_id TEXT,
        result_json TEXT NOT NULL,
        accepted_at TEXT NOT NULL,
        UNIQUE(job_id, idempotency_key)
    );
    CREATE INDEX provider_acceptance_job ON provider_acceptance_checkpoints(job_id);
    PRAGMA user_version = 4;
    """,
}


def connect(database_path: Path, *, readonly: bool = False) -> sqlite3.Connection:
    if readonly:
        uri = f"file:{database_path.resolve().as_posix()}?mode=ro"
        connection = sqlite3.connect(uri, uri=True, timeout=15, isolation_level=None)
    else:
        connection = sqlite3.connect(database_path, timeout=15, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 15000")
    if not readonly:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA synchronous = FULL")
    return connection


def migrate(connection: sqlite3.Connection) -> None:
    current = int(connection.execute("PRAGMA user_version").fetchone()[0])
    if current > LATEST_SCHEMA_VERSION:
        raise InvalidProjectError(
            f"Project schema {current} is newer than supported schema {LATEST_SCHEMA_VERSION}"
        )
    for version in range(current + 1, LATEST_SCHEMA_VERSION + 1):
        try:
            connection.executescript(f"BEGIN IMMEDIATE;\n{MIGRATIONS[version]}\nCOMMIT;")
        except BaseException:
            if connection.in_transaction:
                connection.rollback()
            raise


@contextlib.contextmanager
def transaction(connection: sqlite3.Connection, *, immediate: bool = True) -> Iterator[None]:
    if connection.in_transaction:
        # Coordinators need one atomic mutation across helpers that are also
        # independently transactional. SQLite savepoints preserve those helper
        # boundaries without committing part of a generation graph early.
        savepoint = f"alystria_nested_{uuid.uuid4().hex}"
        connection.execute(f"SAVEPOINT {savepoint}")
        try:
            yield
        except BaseException:
            connection.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
            connection.execute(f"RELEASE SAVEPOINT {savepoint}")
            raise
        else:
            connection.execute(f"RELEASE SAVEPOINT {savepoint}")
        return
    connection.execute("BEGIN IMMEDIATE" if immediate else "BEGIN")
    try:
        yield
    except BaseException:
        connection.rollback()
        raise
    else:
        connection.commit()


def backup_database(source: sqlite3.Connection, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    target = sqlite3.connect(destination)
    try:
        source.backup(target)
        result = target.execute("PRAGMA integrity_check").fetchone()[0]
        if result != "ok":
            raise InvalidProjectError(f"Backup integrity check failed: {result}")
    finally:
        target.close()


def integrity_check(connection: sqlite3.Connection) -> None:
    result = connection.execute("PRAGMA integrity_check").fetchone()[0]
    if result != "ok":
        raise InvalidProjectError(f"SQLite integrity check failed: {result}")
