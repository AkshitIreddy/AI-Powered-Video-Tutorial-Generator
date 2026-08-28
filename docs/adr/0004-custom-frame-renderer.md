# ADR 0004: Custom deterministic frame renderer; Remotion is optional

- Status: Accepted and implemented
- Date: 2026-08-28

## Context

Preview and final output must share exact scene components, support responsive
educational layouts, and remain deterministic and replaceable. Remotion is
capable, but its current licensing, Automator pricing, and telemetry boundary
make it unsuitable as an invisible requirement of the MIT core.

## Decision

Use an Alystria-owned, frame-driven React/DOM/SVG compositor. Canvas/WebGL is
isolated to scenes that justify it. Stored projects contain typed semantic scene
data, never executable React code. Target-specific compiled scenes are derived
artifacts for landscape, portrait, square, or custom output, not crops of one
canonical layout.

Rendering consumes explicit tick/frame state, a deterministic seed, packaged
fonts, and local hash-addressed assets. It forbids wall clock, remote URLs,
unseeded randomness, autonomous CSS animation, host-font dependence, and
locale-sensitive host defaults. Pinned Chromium captures authoritative frames.
Remotion may be added only as an optional adapter after a separate license,
pricing, privacy, and substitution review.

## Consequences

- Editor preview and final rendering use the same scene library.
- Alystria owns renderer maintenance and deterministic regression coverage.
- Third-party renderer substitution remains possible through typed manifests.
- Remotion-specific APIs cannot become storyboard truth.

## Current evidence and release gates

The shared scene view, 36 built-in scene kinds, ten themes, responsive compiler,
seeded runtime, network-denied Chromium capture, resumable frames, partial
ranges, and deterministic development media smoke are implemented and tested.

Release still requires the complete signed-runtime target/codec matrix and
long-form visual inspection; the existing short 640x360 smoke does not prove
all resolutions, aspect ratios, frame rates, or codecs.
