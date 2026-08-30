# Constraint layout and rendered-geometry evidence ledger

Status: implementation input for Alystria Studio 2.0. This is not an acceptance record. The visual pass ledger remains in `docs/visual-quality-bar.md`.

## Decision

Alystria compiles every scene into an immutable target- and locale-specific layout manifest before React renders it. The manifest owns the graphics-safe and action-safe rectangles, a 12-column grid, named semantic slots, reading order, required/soft relationships, and caption avoid regions. Scene renderers may subdivide the body slot, but may not independently reposition the shared header or essential content outside the manifest.

Chromium is the final geometry authority. After packaged fonts load, the audit reads transformed bounding boxes, computed visibility, line count, planned container geometry, and semantic roles from the rendered document. Required failures include visible text intersections, clipping, frame or graphics-safe violations, container overflow, and declared line-limit violations. Candidate repair changes composition or copy tier; it does not silently truncate essential text.

The audit must sample entrances, peak-density states, reveal boundaries, transitions, and exits. A single attractive still cannot approve a time-based scene.

## Why this architecture

- CSS layout algorithms and actual font shaping determine used geometry; character-count estimates are only candidate-planning hints.
- Required and soft constraints let the compiler reject an infeasible composition while retaining stable authorial preferences.
- Grapheme, line-break, and complex-script behavior make code-unit truncation unsafe for Spanish and Hindi.
- One shared manifest prevents preview/final, captions, presenter placement, QA overlays, and exported evidence from inventing incompatible geometry.
- Structural checks can block objective defects; contact sheets and normal-speed playback remain mandatory for hierarchy, rhythm, pedagogy, and art direction.

## Primary-source evidence

| Area | Source | Applied consequence |
|---|---|---|
| Grid sizing | [CSS Grid Layout Level 2](https://www.w3.org/TR/css-grid-2/) | Use explicit tracks/gaps and resolve intrinsic contributions before painting. |
| Alignment | [CSS Box Alignment Level 3](https://www.w3.org/TR/css-align-3/) | Model alignment and gap relationships instead of unrelated coordinates. |
| Intrinsic sizing | [CSS Sizing Level 3](https://www.w3.org/TR/css-sizing-3/) | Treat min/max content contribution as a feasibility input. |
| Overflow | [CSS Overflow Level 3](https://www.w3.org/TR/css-overflow-3/) | Overflow is a blocking result for essential copy, not permission to hide it. |
| Font readiness | [CSS Font Loading](https://www.w3.org/TR/css-font-loading/) | Wait on `document.fonts.ready` before geometry acceptance. |
| Font selection | [CSS Fonts Level 4](https://www.w3.org/TR/css-fonts-4/) | Record resolved font/fallback behavior per locale and target. |
| Text layout | [CSS Text Level 3](https://www.w3.org/TR/css-text-3/) | Let the shaping/layout engine resolve wrapping and spacing. |
| Used geometry | [CSSOM View](https://www.w3.org/TR/cssom-view-1/) | Read post-transform `getBoundingClientRect()` boxes in the browser. |
| Canvas measurement | [WHATWG Canvas `TextMetrics`](https://html.spec.whatwg.org/multipage/canvas.html#textmetrics) | Candidate scoring may use measured metrics, not `length × constant`. |
| Unicode line breaking | [Unicode UAX #14](https://www.unicode.org/reports/tr14/) | Follow language-aware break opportunities. |
| Grapheme boundaries | [Unicode UAX #29](https://www.unicode.org/reports/tr29/) | Never split a user-perceived character to force fit. |
| Shaping | [HarfBuzz shaping concepts](https://harfbuzz.github.io/shaping-concepts.html) | Validate the shaped result, especially for complex scripts. |
| Devanagari | [W3C Devanagari Layout Requirements](https://www.w3.org/TR/deva-lreq/) | Include real Hindi copy and packaged-font fallback in native renders. |
| OpenType shaping | [Microsoft OpenType Devanagari development](https://learn.microsoft.com/en-us/typography/script-development/devanagari) | Preserve conjunct/reordering behavior; avoid code-unit edits. |
| Linear constraints | [Cassowary technical report](https://constraints.cs.washington.edu/solvers/cassowary-tochi.pdf) | Separate required constraints from weighted authoring preferences. |
| Incremental solver | [Kiwi](https://github.com/nucleic/kiwi) | Reference implementation option for bounded incremental constraint solving. |
| Platform layout | [Apple Auto Layout guide](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/AutolayoutPG/) | Use priorities and intrinsic content sizes to explain infeasibility. |
| Animation timing | [Web Animations](https://www.w3.org/TR/web-animations-1/) | Audit values at deterministic ticks and reveal boundaries. |
| Browser automation | [Playwright screenshots](https://playwright.dev/docs/screenshots) | Capture native pixels, traces, and deterministic state evidence. |
| Accessibility | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Preserve readable contrast, non-color cues, and accessible alternatives. |
| Television safe areas | [EBU R 95](https://tech.ebu.ch/publications/r095) | Keep edge-to-edge art distinct from stricter graphics-safe content. |
| Caption interoperability | [WebVTT](https://www.w3.org/TR/webvtt1/) | Keep one canonical timed-text ledger and explicit delivery modes. |
| Timed-text practice | [Netflix general timed-text guide](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215758617-Timed-Text-Style-Guide-General-Requirements) | Review line breaks, reading speed, cue duration, and moving-frame occlusion. |
| Educational segmentation | [Cambridge Handbook of Multimedia Learning](https://www.cambridge.org/core/books/cambridge-handbook-of-multimedia-learning/) | Sequence information units and leave retrieval/processing time. |

## Current implementation evidence

- `packages/scenes/src/layout-manifest.ts` compiles shared slots and constraints.
- `packages/scenes/src/primitives.tsx` emits planned geometry and semantic annotations without hiding essential overflow.
- `services/renderer/src/geometry.ts` inspects post-font Chromium geometry and returns machine-readable findings.
- `scripts/inspect-scene-geometry.mjs` audits all 36 built-in specimens at entrance, midpoint, and exit across 1280 × 720, 720 × 1280, and 1080 × 1080 targets.
- The first full run found 965 objective failures. Repairs to axis-relative 5% graphics safety and scene-family layouts reduced the same 324 observations to zero findings without lowering the policy thresholds. Reports are retained under `artifacts/scene-geometry-audit*.json` as local evidence and are not release approval.

## Remaining acceptance work

Structural success does not approve the art direction. The flagship still needs real Spanish and Hindi content, packaged fonts, scene-aligned information-unit choreography, transition sampling, real presenter compositing/lip sync, clean timed-text sidecars, normal-speed playback, and a fresh complete app-driven render in the isolated sandbox.
