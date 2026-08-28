# Contributing

## Ground rules

Alystria Studio is an MIT-licensed, local-first application. Preserve project ownership, explicit cloud approval, deterministic rendering, provenance, accessibility, and the narrow privilege model in every change. Do not add a hosted Alystria dependency, analytics, account requirement, silent network access, remote font, generic shell bridge, or plaintext secret flow.

Do not push, merge, publish packages, deploy, or create a public release without explicit user approval. A local branch, commit, test run, package, or release-candidate artifact does not imply that approval.

## Working in the repository

- Use pnpm workspaces, the locked Rust toolchain, and `uv`-locked Python environment.
- Keep cross-language contracts in JSON Schema 2020-12 and regenerate/check every binding.
- Preserve a dirty working tree and unrelated changes. Never reset user work to normalize line endings.
- Use small Conventional Commits that each leave a working state.
- Update architecture or policy documentation when a public contract, trust boundary, provider policy, project format, or release gate changes.
- Add deterministic fixtures for behavior changes; live provider calls are never the only test.

## Definition of done

A change is complete only when relevant unit/contract/integration tests pass, error/cancellation paths are exercised, provenance and security implications are handled, and visible output has been rendered and inspected. UI work includes keyboard, narrow-window, reduced-motion, high-contrast, 1440p, and 4K evidence where relevant. Audio changes require offline sample measurement, not code inspection alone.

## Provider changes

Adapters implement Alystria capability contracts and record provider/model revision, usage, cost, retention evidence, and provenance. Update the versioned catalog using primary vendor documentation with `lastVerifiedAt`. Never hard-code a “latest” model assumption, stale price, or unapproved fallback.

## Fixture rules

Canonical fixture source material is locally authored, license-declared, hash-pinned, and network-independent. Claims cite exact local locators and may also include an external evidence URI. Fixture output must be deterministic in the canonical environment. When updating source text, update hashes and explain why the expected evaluation changed.

## Security reports

Do not open a public issue containing a real key, private source, consent proof, unpublished project, or exploitable detail that would expose users. Prepare a minimal reproduction with synthetic data and coordinate privately with the project owner. Once safe, add a regression test covering the root cause.

## Architecture decisions

Record an ADR when changing process authority, IPC, workflow engine/fallback, project format, timing model, renderer, sandbox, key storage, provider policy, licensing boundary, or update system. The ADR states context, decision, alternatives, security/privacy impact, migration, and objective rollback criteria.
