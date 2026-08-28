# ADR 0006: Project SQLite authority plus immutable content-addressed storage

- Status: Accepted and implemented
- Date: 2026-08-28

## Context

Alystria has no hosted backend or synchronization service. Projects need
portable ownership, durable history, efficient reuse of large media, atomic
promotion after worker validation, and recoverable schema migration.

## Decision

A working project is a normal local directory containing `manifest.json`,
`project.sqlite3`, `objects/sha256/`, `sources/original/`, `staging/`, and
`exports/`. SQLite is the sole authority for mutable metadata, revisions, jobs,
evidence, provenance, usage, and history. Immutable binary artifacts live in a
SHA-256 content-addressed store (CAS); database records refer to their hashes.

Only the Python project service writes SQLite. Workers write attempt-specific
staging directories; the service validates size, type, hash, expected shape,
and rights metadata before atomic CAS promotion and database commit. Accepted
outputs create revisions rather than overwriting history. Portable export uses
`.alytutorial`.

Live projects on network or synchronization filesystems are rejected or opened
read-only. Schema migration is copy-first, backed up, transactional, and
reversible; restore creates a new head instead of deleting later revisions.

## Consequences

- Users can inspect, back up, and move projects without an Alystria account.
- CAS deduplicates immutable artifacts and makes integrity checks explicit.
- SQLite and CAS consistency is a commit invariant; orphan cleanup must never
  delete referenced objects.
- Sync is archive-level rather than live multi-writer collaboration.

## Current evidence and release gates

Project creation/opening, SQLite migrations, CAS, revisions, optimistic
snapshot saves, source import, archive round trips, and durable jobs are
implemented and locally tested.

Release still requires full clean-machine and upgrade/rollback coverage,
network/sync-filesystem behavior checks, and the final provenance/archive
evidence bundle.
