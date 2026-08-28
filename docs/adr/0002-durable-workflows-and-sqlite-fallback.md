# ADR 0002: Durable workflows with an objective SQLite fallback

- Status: Accepted; `SQLiteWorkflowRuntime` active
- Date: 2026-08-28

## Context

Generation spans costly, interruptible tasks, approval waits, retries, and
partial artifacts. It must recover locally without a hosted queue or Alystria
backend and must not duplicate accepted provider charges after a crash.

## Decision

DBOS 2.x is the preferred workflow engine only if a packaged-Windows spike
passes every gate: recovery at five specified interruption points,
cancellation, upgrade compatibility, and no duplicated provider charge.
Failure or non-completion of any gate activates the repository's
`SQLiteWorkflowRuntime` lease scheduler behind the same higher-level contracts.

The fallback persists jobs, dependencies, attempts, events, approval waits,
leases, retries, cancellation, task keys, usage, and costs in project SQLite.
Interrupted work is recovered through lease expiry and explicit state
transitions; repair retries are bounded to two by default.

## Consequences

- Durable local operation is available without waiting for DBOS packaging.
- DBOS cannot be enabled by preference or an optimistic partial spike; all
  objective gates must pass.
- Provider idempotency and acceptance reconciliation remain application-level
  obligations whichever runtime is active.
- Runtime interchangeability depends on stable workflow contracts and tests.

## Current evidence and release gates

This machine's packaged sidecar spike did **not** activate DBOS. The implemented
and tested runtime is `SQLiteWorkflowRuntime`; documentation and UI must not
claim DBOS is active.

Release-grade DBOS evidence is still open: packaged-Windows crash tests at all
five points, cancellation, upgrade compatibility, and accepted-charge
deduplication. Until all pass, the SQLite fallback remains the selected runtime.
