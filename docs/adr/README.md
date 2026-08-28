# Architecture decision records

These records capture Alystria Studio 2.0's locked architectural choices and
their current implementation status. An accepted decision is not evidence that
every release gate named by that decision has passed.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-tauri-capability-broker-and-sidecars.md) | Tauri capability broker and authenticated sidecars | Accepted; development spike verified |
| [0002](0002-durable-workflows-and-sqlite-fallback.md) | DBOS gate with objective SQLite fallback | Accepted; SQLite fallback active |
| [0003](0003-json-schema-contracts.md) | JSON Schema 2020-12 cross-language contracts | Accepted; binding generation gate open |
| [0004](0004-custom-frame-renderer.md) | Custom deterministic frame renderer; Remotion optional | Accepted and implemented |
| [0005](0005-timebase-mezzanines-and-ffmpeg-packs.md) | 240 kHz timebase, FFV1 mezzanines, FFmpeg runtime packs | Accepted; release packs unverified |
| [0006](0006-local-project-store.md) | Project SQLite authority plus immutable CAS | Accepted and implemented |
| [0007](0007-provider-privacy-and-keyring.md) | Explicit provider privacy gates and OS keyring | Accepted; live-provider gate open |
| [0008](0008-untrusted-code-sandbox.md) | Out-of-process capability-limited code sandbox | Accepted and implemented |
| [0009](0009-signed-runtime-and-update-boundary.md) | Signed, immutable runtime/update boundary | Accepted; production signing blocked |

## Conventions

- **Accepted** means the architecture choice is locked for 2.0.
- **Implemented** means the corresponding local implementation and relevant
  development tests exist.
- **Release-blocked** means the implementation cannot be represented as
  production-ready until the listed evidence is complete.
- Superseding a record requires a new ADR that links to the old one; do not
  silently rewrite a decision's historical rationale.
