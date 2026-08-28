# Project format and history

## Directory layout

A working project is an ordinary local directory:

```text
Tutorial Project/
  manifest.json
  project.sqlite3
  objects/sha256/ab/cdef…
  sources/original/
  staging/
  exports/
  backups/
```

`manifest.json` is the small discovery record. `project.sqlite3` is authoritative for metadata, relationships, revisions, jobs, and usage. `objects/sha256` stores immutable bytes. `sources/original` contains only source files whose storage policy permits copying. `staging` is disposable attempt-local work. `exports` is user-facing output and is not authoritative project state.

## Manifest

The manifest contains the schema version, stable project ID, display name, creation and update timestamps, database relative path, object-store relative path, and producing application/version. Paths must be relative, normalized, and incapable of traversing outside the project. The application must not trust a manifest merely because it parses; it verifies that the resolved paths remain within the selected directory.

## SQLite authority

SQLite uses foreign keys, a busy timeout, full synchronous durability, and WAL mode on supported local filesystems. Only the pipeline service writes. The desktop and workers query through typed pipeline APIs rather than opening the database independently.

Every accepted edit creates a revision. Revisions form an append-only parent chain and contain a canonical snapshot or immutable references to canonical entities. Named approvals are revisions, not mutable labels over a moving head. Restoring a prior revision creates a new head whose parent is the current head and whose content matches the selected historical snapshot; later work remains recoverable.

## Content-addressed objects

Objects are addressed by lowercase SHA-256. Promotion uses this sequence:

1. A worker writes only inside its attempt directory.
2. The pipeline verifies expected media type, byte limit, parser/probe result, and declared hash.
3. It streams the file through SHA-256 itself.
4. It fsyncs and atomically renames into the hash path when absent.
5. It records object metadata and revision references in one database transaction.
6. It deletes the attempt directory only after the transaction commits.

Existing objects are never overwritten. Hash collision or mismatched existing bytes is fatal. Garbage collection is opt-in and deletes only objects proven unreachable from every revision, backup, active job, export manifest, and consent/provenance record.

## Stable entities

Stable IDs identify Course, Module, Lesson, Section, Scene, SourceVersion, EvidenceChunk, AtomicClaim, ClaimSupport, LearningPlan, StoryboardSnapshot, VisualBible, ThemeSpec, Artifact, AssetProvenance, GenerationRun, TaskRun, TaskAttempt, UsageRecord, and QualityGate records.

A semantic Scene holds objectives and prerequisites, narration/delivery, atomic claims and citations, typed visual content, target-aware layout intent, choreography, presenter direction, captions, audio, timing policy, accessibility description, artifact references, locks, and revision metadata. Target-specific `CompiledScene` and `RenderManifest` objects are derived and replaceable.

## Migration

Opening an older schema is copy-first:

1. Refuse write access on network/sync filesystems; offer read-only or a verified local copy.
2. Check free space for the project database, WAL, backup, and migration headroom.
3. Run `PRAGMA integrity_check`.
4. Create a timestamped backup and hash it.
5. Migrate a copy inside one transaction per schema step.
6. Validate invariants and reopen the copy with the new reader.
7. Atomically switch the manifest/database only after validation.
8. Retain the prior database until the user accepts the upgrade.

A newer unsupported schema opens read-only with a clear compatibility message. There is no best-effort downgrade that could discard unknown fields.

## Portable `.alytutorial` archive

The archive is a deterministic ZIP profile containing a canonical manifest, SQLite database snapshot, reachable objects, permitted original sources, and a provenance/export report. Entries are lexicographically ordered, timestamps are normalized, path traversal and symlinks are forbidden, and decompressed byte/count limits are enforced before extraction.

Archive import occurs in quarantine, validates every declared hash and path, scans for collisions, and only then creates a new local project directory. Credentials, absolute paths, caches, temporary files, worker logs, and secret references are never exported.

## Backups and recovery

SQLite online backup is used for live projects. A backup is complete only after integrity check and hash verification. Startup recovery checks manifest/database agreement, WAL state, active leases, staging directories, and object references. Unknown staging content is quarantined, not promoted or deleted automatically.

## Network and synchronization filesystems

Live read/write projects on SMB, NFS, consumer sync folders, or removable filesystems with uncertain atomicity are not supported. The application offers a local working copy and explicit archive export. This prevents WAL corruption and conflicts that a local-first application cannot safely merge.
