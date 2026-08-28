# Release policy

## Authorization boundary

Implementation, tests, commits, local packages, and a completed release-candidate packet are authorized engineering work. The following actions are not authorized without an explicit user instruction immediately applicable to the target and version:

- pushing a branch or tag;
- merging a branch or pull request;
- publishing a package, installer, model pack, container, or update manifest;
- deploying infrastructure or a hosted service;
- creating a GitHub/GitLab release;
- changing a production domain, feed, or signing channel;
- announcing or distributing a release.

Silence, prior approval for a different version, a green CI run, or “release candidate ready” is not approval.

## Local release candidate

The local RC is assembled only after roadmap exit criteria pass. It contains reproducible source/lock state, signed-or-development-labeled installer, checksums, SPDX SBOM, third-party and model notices, FFmpeg configuration/license report, provenance/C2PA report, migration/rollback evidence, clean-machine results, fixtures and evaluation, screenshots/sample media, and known limitations.

Development-signed or unsigned artifacts are visibly marked and cannot use the production update channel. Optional GPL runtime packs are separate, signed, checksum-verified artifacts with their own license notice and installation consent.

### Local compliance evidence

The compliance inventory is resolved offline from `pnpm-lock.yaml` plus installed npm metadata, the locked Windows Cargo dependency tree plus the local Cargo registry, and `uv.lock` plus installed Python distribution metadata. Run:

```text
node scripts/generate-third-party-notices.mjs --check --strict
node scripts/generate-sbom.mjs --check --strict
```

`--all-locked` expands the Python audit to optional/development lock entries that may not be installed; unresolved local metadata remains an explicit `NOASSERTION`, not a guessed license. `--release` is deliberately stricter than `--strict`: it fails while Chromium license material, signed FFmpeg packs, model artifacts, or other catalog-only components remain unassembled. Passing `--strict` therefore validates the present dependency evidence but does not certify a distributable release candidate, a signed pack, or C2PA output.

## Approval handoff

The final local handoff states exactly what was built, what passed, what remains, where artifacts live, their hashes, how to reproduce the checks, and which external actions are still prohibited. It then stops for inspection. Any approved release action is separately re-verified against branch, commit, target channel, version, signing identity, artifact hashes, remote state, and rollback plan before execution.
