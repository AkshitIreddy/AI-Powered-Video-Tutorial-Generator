# ADR 0009: Signed immutable runtime and update boundary

- Status: Accepted; production signing blocked
- Date: 2026-08-28

## Context

The desktop depends on a Python pipeline, Node/Chromium renderer, FFmpeg,
sandbox engines, optional models, and potentially a GPL codec pack. Downloading
mutable binaries or silently using host tools would undermine reproducibility,
security, rollback, and license compliance.

## Decision

Treat the desktop application, core runtime packs, optional GPL pack, and model
artifacts as separately versioned components. Each installable component must
have an immutable manifest containing exact version/revision, platform and
architecture, digest, size, origin, license/notices, compatibility range, and a
trusted signature. Verify metadata and content before activation; install to a
versioned staging location and switch the `current` reference atomically only
after all checks pass.

Application updates and runtime/model updates are independent. A desktop update
must declare compatible runtime protocol/schema ranges and retain the last
known-good component for rollback. Models are downloaded through the manager,
never bundled; unsafe pickle loading and `trust_remote_code` are disabled by
default. The GPL x264 pack remains optional and physically/license-separated
from the MIT core.

Development overrides may locate local worker builds only in development
builds and must resolve to explicit files. They cannot weaken release signature
requirements or enter production packaging.

## Consequences

- Runtime provenance, compatibility, and license boundaries are explicit.
- Offline installs and rollback require retained signed manifests and artifacts.
- Missing, invalid, incompatible, or unsigned components fail closed instead of
  falling back to an arbitrary host binary.
- Packaging produces SPDX SBOMs, third-party/model notices, FFmpeg build
  configuration, provenance manifests, and C2PA data where supported.

## Current evidence and release gates

Exact runtime declarations, diagnostics, capability checks, safe model download
and resume logic, checksum/license policy, a development sidecar build, and a
development runtime-manifest stub exist. The stub has no components or
signature and must never be interpreted as a releasable pack.

Production signing material is unavailable and not authorized. Release remains
blocked on signed manifests and artifacts, license/SBOM resolution, installer
and update-feed implementation, clean-machine install/update/resume/rollback
tests, reviewed model revisions, and explicit owner approval. No push, publish,
deployment, signing, or distribution follows from local build success.
