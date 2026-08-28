# ADR 0007: Explicit provider privacy gates and OS credential storage

- Status: Accepted; live-provider gate open
- Date: 2026-08-28

## Context

Alystria supports bring-your-own-key cloud services and local models without an
Alystria account or backend. Provider fallback can change confidentiality,
retention, region, cost, or model behavior; plaintext credentials and invisible
egress are unacceptable.

## Decision

Store provider secrets only in Windows Credential Manager, macOS Keychain, or
Linux Secret Service. Projects and events hold opaque `keyring://` references,
never credential values. If the OS vault is unavailable, fail closed without a
plaintext fallback.

Before the first content-bearing cloud call, require approval of provider,
model, payload classes, purpose, local/cloud boundary, endpoint/region,
retention policy, and bounded estimated cost. Approval for one provider does
not authorize another. Switching provider, region, retention class, or
local/cloud boundary always requires new approval. Fully Local mode denies
project-content egress, remote assets/fonts, analytics, and cloud fallback.

Provider SDKs remain behind Alystria-owned capability contracts. Catalog facts
are versioned with `lastVerifiedAt`; stale or unbounded price/retention data
blocks automatic work.

## Consequences

- Secrets do not enter projects, command arguments, logs, diagnostics, archives,
  screenshots, or exports.
- Automatic routing is constrained to configured and explicitly approved
  capabilities.
- Some convenient fallbacks become user-visible pauses.
- Live adapters require recurring review as provider policy and pricing change.

## Current evidence and release gates

The Rust OS-keyring broker, opaque references, fail-closed errors, privacy
classifications, egress checks, approval/cost contracts, provider catalog, and
mocked adapter tests are implemented.

No live BYOK smoke is release evidence. The previously supplied credentials
must be rotated before any live test, and every launch provider still requires
real retention, region, pricing, cancellation, and billable-request
reconciliation. Fully Local network-isolation evidence remains a release gate.
