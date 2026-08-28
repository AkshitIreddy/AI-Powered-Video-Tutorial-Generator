# ADR 0001: Tauri capability broker and authenticated sidecars

- Status: Accepted; development spike verified
- Date: 2026-08-28

## Context

Alystria is a local desktop application whose UI must not inherit generic
filesystem, shell, database, network, or secret access. The Python pipeline and
render/model workers need native runtimes and durable process supervision while
remaining outside the webview trust boundary.

## Decision

Use Tauri 2 with React/Vite. The Rust core is the narrow privilege broker and
exposes only typed commands. The main-window capability grants Tauri core
window/event/webview access and deliberately omits filesystem, shell, process,
and network plugins.

Rust supervises the Python pipeline as a sidecar. At startup it creates a
random 256-bit session token, transmits it through the child's stdin, requires a
versioned readiness message, accepts only a loopback endpoint, allow-lists RPC
method names, bounds request time and response size, and does not expose worker
stderr to the UI. On Windows the child is launched without a visible console.
Workers receive immutable inputs and staging locations; the pipeline remains
the only project-database writer.

## Consequences

- Native privileges remain auditable in one small Rust boundary.
- The desktop can still edit when a generation sidecar is unavailable.
- Sidecar protocol and application versions must be packaged compatibly.
- Loopback authentication protects the protocol from unrelated local
  processes, but does not turn worker code into trusted UI code.

## Current evidence and release gates

The typed command surface, restricted Tauri capability, authenticated loopback
protocol, worker lifecycle, development PyInstaller sidecar, and headless
handshake/shutdown smoke are implemented and locally verified.

Release remains blocked on signed immutable runtime manifests, clean-machine
installer/update/rollback tests, production runtime-pack installation, and the
portable macOS/Linux smoke matrix. The checked-in runtime manifest is explicitly
a development stub and is not distribution evidence.
