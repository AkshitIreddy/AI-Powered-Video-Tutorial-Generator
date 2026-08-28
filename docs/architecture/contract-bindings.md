# Canonical contract bindings

`packages/contracts/schema/*.schema.json` is the only source of truth for Alystria's
cross-process data contracts. The schemas use JSON Schema 2020-12. Rich, hand-authored
domain models remain in each language; generated files provide a deterministic registry
that lets those models and validators detect schema drift without replacing them.

Run `pnpm contracts:generate` after changing a canonical schema. The generator validates
the declared draft, unique HTTPS schema IDs, and every local `$ref`, then writes:

- `packages/contracts/generated/schema-manifest.json`
- `packages/contracts/src/generated/schemaRegistry.ts`
- `services/pipeline/src/alystria/contracts/generated_schema_registry.py`
- `apps/desktop/src-tauri/src/generated/schema_registry.rs`

Each representation includes the contract-set hash, per-schema semantic hashes, schema
IDs, definition names, object properties, required fields, types, and references. Hashes
are computed from recursively key-sorted JSON, so whitespace-only formatting changes do
not cause churn.

`pnpm contracts:check` performs a read-only regeneration and fails if any committed
output differs. The contracts package test/lint commands and the first CI validation job
run this check. Never edit an `@generated` file directly.
