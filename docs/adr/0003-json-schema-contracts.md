# ADR 0003: JSON Schema 2020-12 is the contract source of truth

- Status: Accepted; binding generation gate open
- Date: 2026-08-28

## Context

The React UI, Rust broker, Python pipeline, TypeScript renderer, archives, and
extensions exchange long-lived structured data. Hand-maintained types alone can
drift across languages and allow invalid data through a privileged boundary.

## Decision

Use versioned JSON Schema 2020-12 documents as the canonical cross-language
contract. Schemas define projects, research, storyboards, media, execution, and
shared values. Privileged boundaries reject unknown fields unless a schema
explicitly provides an extension point. Commands and events carry versions and
correlation identifiers.

Generate Rust, Python, and TypeScript bindings from the schemas and enforce a CI
drift check. Migration code, stored documents, and portable archives must name
their schema versions; compatibility is explicit rather than inferred.

## Consequences

- Contract review is centralized and language-neutral.
- Schema evolution requires versioning, migration tests, and generated-binding
  updates in one change.
- Validation is still required at runtime; static types are not a trust
  boundary.
- Extension data must use declared capability-scoped locations.

## Current evidence and release gates

Six versioned schemas, exhaustive TypeScript domain types, runtime validators,
and schema tests are implemented. Python and Rust domain models also exist.

The drift-checked direct generation of Rust and Python bindings from the
canonical schemas is not complete. That CI/reproducibility gate must pass before
the cross-language binding requirement is represented as release-complete.
