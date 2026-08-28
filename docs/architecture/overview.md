# Architecture overview

## Product boundary

Alystria Studio is a local desktop production system, not a web service. A project is owned by the user as an ordinary directory. The application can call approved third-party providers using user-managed credentials, but Alystria does not operate an account system, cloud control plane, synchronization service, or shared project database.

The architecture isolates privileges and keeps one authority for mutable project state:

```text
React/Vite interface inside Tauri
        │ narrow typed commands and events
        ▼
Rust desktop core
  ├─ project and file pickers
  ├─ OS credential broker
  ├─ runtime/model manager
  ├─ GPU, storage, Chromium and FFmpeg diagnostics
  ├─ signed application/runtime updates
  └─ authenticated worker supervision
        │
        ▼
Python pipeline service — only project database writer
  ├─ durable workflows and SQLite
  ├─ projects, revisions, evidence and artifacts
  ├─ source ingestion and provider routing
  └─ quality gates and bounded repair
        ├─ TypeScript render worker + pinned Chromium
        ├─ FFmpeg and ffprobe
        ├─ local model workers
        └─ isolated code/document/media workers
```

Tauri is selected for explicit capability boundaries and sidecar support, not merely bundle size. See [architecture](https://v2.tauri.app/concept/architecture/), [capabilities](https://v2.tauri.app/security/capabilities/), and [sidecars](https://v2.tauri.app/develop/sidecar/).

## Responsibilities and prohibitions

### React interface

The interface renders project state, sends schema-validated intents, and subscribes to durable job events. It has no generic shell, database, filesystem, secret, or network authority. Preview components consume typed scene data and local object references; stored projects never contain executable React code.

### Rust desktop core

The core is the privilege broker. It opens native dialogs, resolves user-approved paths, stores opaque secret references in the operating-system credential vault, launches workers with per-session authentication, probes dependencies, and enforces local-mode network policy. It must not embed provider keys in process arguments, logs, events, or project data.

### Python pipeline

The pipeline is the sole SQLite writer. All mutations pass through transactions that produce durable events and revisions. Provider calls use an idempotency ledger: an accepted remote request is recorded before downstream processing, and retry logic must reconcile existing remote work before issuing another billable request.

### Workers

Render, model, code, and parsing workers receive immutable inputs plus an attempt-specific staging directory. They never open the project database. The pipeline validates output type, size, hash, rights metadata, and expected shape before atomically promoting bytes into the content-addressed store.

## Typed interfaces

JSON Schema 2020-12 is the cross-language source of truth. TypeScript, Rust, and Python bindings are generated and checked for drift. Every command and event has a version and correlation identifier. Unknown fields are rejected at privileged boundaries unless the relevant schema explicitly allows extension data.

The minimum command families are project lifecycle, source import, revision/history, job control, provider/model configuration, diagnostics, preview/render, and export. Long work always returns a durable job identifier; no user-facing command waits synchronously for a complete tutorial.

## Durable workflow decision

DBOS 2.x is the preferred workflow runtime because it supplies SQLite-backed recovery, queues, cancellation, retries, and approval waits without requiring a hosted service. See [workflow model](https://docs.dbos.dev/python/tutorials/workflow-tutorial), [recovery](https://docs.dbos.dev/production/workflow-recovery), and [management](https://docs.dbos.dev/python/tutorials/workflow-management).

DBOS is gated by a Windows packaging spike. The spike must prove recovery at five interruption points, cancellation, upgrade compatibility, and exactly-once accounting for accepted provider work. Any failed gate activates the in-repository `SQLiteWorkflowRuntime` lease scheduler behind the same contracts. This is an objective fallback, not a discretionary late redesign.

Job states are:

```text
BLOCKED → READY → QUEUED → RUNNING
                         ├→ SUCCEEDED
                         ├→ RETRY_WAIT
                         ├→ FAILED
                         ├→ CANCELLED
                         └→ STALE
```

Cancellation is cooperative first and forced only after a bounded grace period. Interrupted `RUNNING` attempts become abandoned; recoverable jobs return to `READY` after lease expiry. A completed cache entry is usable only when all referenced object hashes exist and validate.

## Invalidation and caching

The task key is the SHA-256 of canonical task kind, implementation version, canonical parameters, ordered input hashes, provider/model revision, prompt/schema/toolchain versions, and deterministic seed. Environment-dependent fields such as temporary paths, wall-clock time, or worker identifiers are excluded.

Dependency edges are recorded between logical artifacts. An edit marks only transitive descendants stale. For example, a pronunciation edit invalidates affected narration, alignment, captions, presenter clip, timing, scene render, QA, and final composition; it must not invalidate unrelated scenes or source evidence.

## Process startup and shutdown

One development command and one installed application entry point supervise every required worker. On startup the core creates an unguessable session credential, chooses loopback-only or inherited-pipe IPC, starts the pipeline, verifies protocol and schema versions, then starts optional workers on demand. On shutdown it stops queue admission, requests job checkpoints, drains bounded work, terminates child processes, and leaves recoverable state.

## Platform and performance policy

Windows is the fully verified platform. macOS and Linux receive portable builds and smoke coverage. The reference GPU is an RTX 4080 Laptop GPU with 12 GB VRAM, but hardware availability is detected rather than assumed.

Performance results must record device, driver, operating system, power profile, CPU boost state, thermal state, background load, model revision, quantization, and input fixture. The default test pass does not change the user's Windows power profile or G-Helper settings. Silent mode with boost disabled is a valid realistic-use profile. Peak-performance characterization is a separate, explicitly labeled pass performed only after approval or a deliberate operator change; it is never required for functional correctness.

## Failure principles

- No silent provider, region, retention, or local/cloud fallback.
- No destructive migration without a verified backup and reversible path.
- No unbounded retries; all repair loops stop after the configured maximum, two by default.
- No success event before bytes, metadata, rights, and database state are durably consistent.
- No release action follows automatically from a successful local release-candidate build.
