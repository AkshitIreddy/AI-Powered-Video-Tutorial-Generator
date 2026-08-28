# ADR 0008: Out-of-process capability-limited code sandbox

- Status: Accepted and implemented
- Date: 2026-08-28

## Context

Tutorials may execute example code and collect traces. Source documents and
model-generated programs are untrusted; an in-process JavaScript realm such as
`node:vm` is not an operating-system security boundary.

## Decision

Run examples out of process through typed adapters for Wasmtime/WASI, Pyodide,
and QuickJS-WASM. Use only application-managed runtime roots; ignore executable
discovery through the host `PATH`. Never invoke a shell and do not inherit the
host environment beyond the minimum platform values needed to start a process.

Each attempt receives a private directory with read-only inputs, a bounded
output directory, and explicit control files. Enforce allow-listed runtimes,
absolute executable paths, no NUL-containing arguments, wall/CPU/memory/file/
descriptor/output limits, bounded protocol results, cancellation, and complete
process-tree teardown. Windows uses Job Objects; POSIX uses process groups and
resource limits. Network and undeclared host filesystem access remain denied by
the runtime/capability policy.

## Consequences

- Code demonstrations can produce deterministic output and traces without
  granting the UI or project arbitrary host execution.
- Runtime bundles and worker protocols are part of the trusted computing base.
- Resource limits reduce impact but do not replace runtime patching, signing,
  or adversarial testing.
- Third-party executable extensions must use a separate out-of-process,
  capability-scoped boundary; no marketplace is included in 2.0.

## Current evidence and release gates

The three adapters, isolated workspaces, typed protocol, output validation,
process/resource limits, Windows Job Objects, cancellation, and smoke tests are
implemented.

Release still requires signed immutable runtime bundles, clean-machine tests,
dependency/security review, and fuzz/adversarial coverage. This ADR does not
claim the development runtime artifacts are approved for redistribution.
