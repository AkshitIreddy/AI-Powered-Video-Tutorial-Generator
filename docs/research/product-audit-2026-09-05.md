# Product audit and integrated acceptance — 2026-09-05

## Authority and comparison

The root `see` handoff is the current requested scope. The older user-owned `see me`, preserved `legacy/v1`, the `v1.0.0` tag, current README/status/handoff documents, and local Git history were inspected before changes. Legacy code was not executed. The previous implementation is evidence and a reversible baseline, not a design specification. Work stays on local `main`; no push, release, deployment, or signing is authorized.

The inspected v1 backend assembled randomly placed slides and narration. Current v2 already has durable jobs, typed project snapshots, a large scene renderer, provider routing, and isolated native workers. The audit retains useful foundations but rejects invented confidence badges, demo content presented as a user's generated scene, proposal-only jobs presented as executable, and forced termination presented as graceful native shutdown.

## Product changes

- Rebuilt Home as a teaching workbench with an explicitly authored interactive binary-search example, usable entry paths, and genuine empty states. No automatic projects or jobs.
- Replaced crowded icon artwork with an original book-and-play SVG, regenerated platform icons, and checked the sidebar rendering.
- Reworked the visual hierarchy around paper, plum, and muted lavender surfaces; inspected full-size and 860px layouts and high-detail crops. Templates now have original vector illustrations with stable loading.
- Planning displays and edits the current project's scene objectives; source review and claim support are separate. Script editing covers every scene.
- Preview compiles authored storyboard content through the same semantic scene resolver as final rendering. The playhead advances by elapsed time, can be scrubbed, and stops at scene end. Sample Karatsuba thumbnails are removed from generic projects.
- Review reads native promoted media and actual project records, keeps persistent annotations, and does not manufacture a quality score or approved evidence.
- Terminal native generation jobs refresh their durable project snapshots even with the Jobs drawer closed. Generated scenes and sources replace the temporary scaffold.
- Settings now apply reduced motion, higher control contrast, editor density, autosave interval, and the default export rate. Storage paths display native runtime values. Removed inert privacy, backup-count, and caption-language switches.
- Creative image requests use real native jobs and remain inactive candidates until the user reviews their decoded image and rights. The configured tutorial image route and optional local SDXL recipe are executable; unsupported advanced controls were removed. An accepted scene image is reused from the project asset store during export.
- Codec selection is forwarded through the typed native contract to the actual renderer. JSON/OTIO editor downloads are real files; temporary browser media URLs are detached on persistence.

- The included asset library contains four slide backgrounds and eight elements, all usable without a provider account. Backgrounds render through the shared scene engine; adding assets to an already saved advanced editor preserves its tracks and edits.
- Scene review marks clear after meaningful content edits. Generation approval targets the exact project job; queued work is labeled as queued, and project reset explains which workspace links it clears.

See the separate generation, editor, onboarding, catalog, presenter, and Windows audit reports for implementation and acceptance details.

## Current research used

Primary references were inspected rather than assuming old model lists and examples remain correct. Specialized audit reports contain the larger research ledger and method comparisons.

- [LM Studio basics](https://lmstudio.ai/docs/app/basics): distinguish discovery, download, load, and inference readiness.
- [LM Studio model download CLI](https://lmstudio.ai/docs/cli/local-models/get): exact model/format/quantization selection.
- [Hugging Face GGUF](https://huggingface.co/docs/hub/gguf): file metadata and format handling.
- [Hugging Face inference-provider Hub API](https://huggingface.co/docs/inference-providers/en/hub-api): capability/provider discovery from actual metadata.
- [WAI-ARIA modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): focus and modal interaction behavior.
- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/): 10,000 free neurons daily; image usage depends on model, size, and steps. Free-plan calls stop at quota.
- [Cloudflare FLUX.1 Schnell model](https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/): supported image model and actual request contract.
- [Cloudflare REST setup](https://developers.cloudflare.com/workers-ai/get-started/rest-api/): API token plus account ID; recommended to user for optional app image generation.

## Test policy and evidence boundaries

All local commands, servers, Chromium/WebView2 acceptance, and workers must remain hidden. Large runtime/evidence/build files live in `E:\temp`. GPU work uses the shared ownership file; a free `no` must be claimed as `yes` and released back to `no` on completion or error.

The user reserved Deepgram, Inworld, and Cartesia common-file keys for other work. Keep integrations, but avoid those providers for long narration tests. If necessary, any smoke generation is at most 10 seconds per provider. NVIDIA Magpie is used for substantial narration tests; Elena is paired with the female Aria voice. The final representative presenter proof uses an opening presenter scene followed by narrated teaching scenes; it is not a claim of continuous three-minute presenter animation. Jason remains an explicit male voice choice. Do not print, pass in command arguments, or commit credential values.

Browser screenshots and simulated command tests prove UI behavior only. Deterministic local native generation proves integration only. Real provider-generated tutorial media, timeline composition, native lifecycle, and repaired presenter output require distinct current evidence. Older exported media is never relabeled as a fresh pass. Signing, clean-VM installer qualification, and release remain separate from local portable acceptance.

## Evidence location

September 5 root UI audit: `E:\temp\avt-audit-2026-09-05`. That browser-package route capture inspected Home, Templates, Models, Settings, Plan, Storyboard, Studio, Design, Review, Export, creation wizard, narrow Home, and narrow Models. All 13 captures reported no page error or document horizontal overflow. Detailed screenshots were inspected, and identified contrast/content defects were corrected. These are historical browser-package results. Native and final media evidence is recorded separately and is not inferred from these browser images.

## September 5 browser and optional-image checks

The September 5 UI matrix passed 25 Playwright cases with 3 intentional viewport skips and no failures. That desktop and narrow package included the stock-photo controls and licensed candidate details. The Images setup action saved an `off` route, reached a valid creation policy, and persisted a tutorial policy with writing and narration but no image-generation capability. The backend's matching authored-only path skipped image-provider calls and rendered semantic teaching scenes; it did not fabricate a generated raster.

Optional rendered-frame review is tied to the generation ID and exact video hash. It samples six decoded frames in order and displays coverage limits, findings and timestamps; a report for an earlier render is labeled stale. Missing, private, unavailable, or malformed review is never displayed as a quality pass. The September 5 production VLM smoke did not obtain findings; its original error diagnostics were insufficient to distinguish network/provider causes, so no successful assessment or provider outage was claimed. A later diagnostic returned HTTP 410 from the old NVIDIA hosted vision endpoint, matching its published deprecated status. Another bounded Omni diagnostic returned HTTP 503. Neither response established a general provider outage.

The September 7 native render later produced an Omni report with zero findings,
but direct full-resolution frame inspection rejected its tiny whiteboard text,
mostly empty board, and non-executable code scene. This is concrete evidence that
a structurally successful or empty semantic-review report cannot qualify visual
teaching quality. The rejected frames and subsequent source corrections are
recorded in [the generation audit](generation-audit-2026-09-05.md).

Review, stock-search and image-candidate unit checks passed 13 cases in that September 5 source/package state. The matched/stale review states were visually inspected at 860 pixels, and the stock UI was inspected at 1440 and 860 with no horizontal overflow. Evidence is under `E:\temp\avt-audit-2026-09-05\review-ui` and `stock-ui`.

## September 7 caption and visual regression status

The first successful caption stage had 103 scene-local chunks but reflowed them
again into 62 delivery cues, producing avoidable 400–540 ms fragments. The
single-pass compiler now produces the same 49 cues for renderer/editor data,
WebVTT, and SRT while preserving all 490 approved word tokens, a 700 ms minimum,
20-character-per-second maximum, two lines of at most 42 characters, and no
overlaps. Exact hashes, measurements, and limitations are in
[the generation audit](generation-audit-2026-09-05.md).
This source correction and the repaired whiteboard/code authoring do not qualify
a new master; packaged native rendering and direct media inspection remain pending.

## Source checks and capture conditions

The complete desktop Vitest run at the September 5 checkpoint passed **211 tests** under pinned Node 24.20.0 after the approval and source-audio fixes. The earlier 200-test run in 29 files took 143.58 seconds. That checkpoint's desktop TypeScript build and ESLint run also passed. A later September 7 checkpoint passed 240 desktop tests before a subsequent strict native DTO regression was added; the focused native bridge group then passed 19 tests including that case. These counts bind to their stated source checkpoints and are not a current full-suite or new-master acceptance claim. The browser matrix above exercises UI behavior independently of provider/native media qualification.

The owner runs a separate screen-dimming transparency overlay. It was left running. Visual acceptance uses captures from the hidden application WebView/Chromium render surface, rather than interpreting desktop-overlay darkness as an application palette defect. Other-project GPU work and its shared lease remain untouched; a busy lease delays our own model inference.
