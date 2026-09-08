# AI Video Tutorial Generator local-overhaul acceptance record

Updated 2026-09-08. This replaces the obsolete September 2 all-green snapshot,
which used the old Alystria name, palette, assets, test counts, and prototype
controls. Git history preserves that record. A checked item below means the
current implementation has matching source-level or browser evidence. It does
not imply that the final packaged Windows journey or a public release passed.

Primary evidence:

- [Product and browser audit](research/product-audit-2026-09-05.md)
- [Generation audit](research/generation-audit-2026-09-05.md)
- [Editor audit](research/editor-audit-2026-09-05.md)
- [Presenter and voice audit](research/presenter-voice-audit-2026-09-05.md)
- [Catalog and routing audit](research/catalog-audit-2026-09-05.md)
- [Windows integration audit](research/windows-integration-audit-2026-09-05.md)

## Current verified implementation

### Product identity, state, and browser experience

- [x] User-facing identity is **AI Video Tutorial Generator**. The current
  paper, plum, and muted-lavender workbench and book/play mark replace the old
  Alystria obsidian/neon presentation.
- [x] A clean browser profile starts without invented projects or jobs, and the
  exact legacy seeded-project fingerprint is migrated without deleting normal
  user work.
- [x] Home, Templates, Models, Settings, Plan, Storyboard, Studio, Design,
  Review, Export, creation, and narrow layouts were captured and inspected. The
  September 5 13-route capture reported no page error or document horizontal overflow.
- [x] The September 5 UI matrix passed 25 Playwright cases with three intentional
  viewport skips. September 8 final desktop tests passed 255 cases in 35 files
  after the portrait-type correction.
- [x] First-run setup and contextual onboarding use real highlighted controls,
  meaningful actions, replay, completed-setup detection, keyboard navigation,
  and a non-blurred target.
- [x] Settings expose working UI preferences and native runtime/storage facts.
  Inert privacy, backup-count, caption-language, and unsupported Design
  Inspector controls were removed instead of being presented as functional.

### Providers, models, assets, and resource policy

- [x] Capability routing is explicit for writing, research, embeddings,
  transcription, voice, music, images, presenter animation, lip sync, visual
  review, and upscaling. An authored-layout profile can deliberately turn image
  generation off.
- [x] Hugging Face and Civitai discovery, provider catalogs, filtering,
  compatibility, route readiness, credential gating, and bounded resource
  policy are implemented and tested. Search metadata is not treated as proof
  that a model is installed or executable.
- [x] The local image installer pins the ComfyUI runtime and model artifacts,
  verifies hashes, reuses the existing E:-resident SDXL installation, and does
  not duplicate verified multi-gigabyte files.
- [x] Cloudflare Account ID and credential reference are persisted separately;
  secret values remain in the operating-system credential path.
- [x] The bundled teaching library provides distinct slide backgrounds and
  reusable slide elements with checked hashes and ImageGen provenance. Stock
  search and generated images remain review-first assets with rights records.

### Teaching generation, review, and export contracts

- [x] Preview and final rendering share authored scene data rather than fixture
  copy. Scene compilation covers landscape, portrait, and square targets.
- [x] Requested duration is represented on the 240 kHz timeline and reconciled
  against measured narration. Provider timing is retained when available;
  proportional estimates cannot claim complete alignment.
- [x] A pinned CPU forced-aligner passed an exact-token real-speech proof and is
  wired into generation. Whiteboard derivations and live-code actions use
  timed, editable scene structures.
- [x] Designed scenes can run without an image provider. Optional raster
  candidates are stored separately, visually reviewed, and explicitly accepted
  before the active scene changes.
- [x] Review can bind to the exact promoted render and generation, sample six
  decoded frames, retain timestamps and frame hashes, and reject stale reports.
  A failed optional VLM call is retained as a failure rather than a quality pass.
- [x] Codec and frame-rate intent reach the renderer. Captions derive from one
  cue model and produce UTF-8 WebVTT and SRT companions; open-caption styling is
  identified separately from viewer-controlled captions.

### Integrated editor

- [x] The editor provides slide, presenter, title, caption, narration, music,
  and SFX tracks with governed media import.
- [x] Split, trim, move, linked reorder, snap, lift, ripple delete, extract,
  speed, transforms, opacity, audio gain/fades, keyframes, and linked
  narration/caption edits are reversible transactions with undo/redo.
- [x] Project JSON and OTIO downloads write real validated files. The native app
  persists the validated editor document in the project snapshot and keeps
  browser-only blob URLs out of durable state.
- [x] Native imports and generated-stage bindings resolve through registered,
  contained CAS objects. Saved user edits are retained when later generated
  media bindings become available.
- [x] Native timeline export validates project identity, head revision, rights,
  assets, trims, source offsets, layers, speed, visual keyframes, title/caption
  layers, programme audio, audio gain/fades, codec, and output containment.
- [x] Real waveforms are generated from the selected CAS audio stream, cached by
  source hash and profile, and cropped according to source offsets and trims.
- [x] Editor tests are included in the 236-test desktop pass; TypeScript and
  editor lint pass. A pinned-FFmpeg proof verifies decoded first/middle/last
  keyframed frames, source audio, title/caption pixels, and matching VTT/SRT cues.
  Native inspection exposed an imported-media sizing and rotation-bounds
  defect. The corrected packaged three-second export now passes decoded frame
  and audio inspection; the full-length edited tutorial remains required below.

### Native source and lifecycle evidence

- [x] The current Rust broker and portable policy pass 65 tests and formatting.
  Desktop TypeScript builds with Node 24.20.0.
- [x] A prior packaged binary proved hidden WebView loading, authenticated worker
  startup, GUI-subsystem execution, `WM_CLOSE`, zero console output, and no
  orphan worker. It is lifecycle evidence only because it predates the final
  integrated source.
- [x] Native harnesses now cover the intended final generation, review, archive,
  export, editor, and restart/recovery journeys and fail closed when receipts or
  output files do not satisfy the contract.

## Remaining local-overhaul acceptance

These are required before the local overhaul can be called complete. Browser
tests or the older portable binary cannot substitute for them.

- [ ] Rebuild the desktop, renderer, and packaged worker from the frozen current
  source, then repeat hidden launch, worker handshake, normal close, no-console,
  and no-orphan checks against that exact package.
- [ ] Prove a fresh packaged profile starts with no invented projects/jobs,
  replays setup, reuses the configured E:-resident runtimes, and confines writes
  to the disposable sandbox apart from the documented credential-store path.
- [ ] Complete the representative 178-182 second native tutorial through the
  selected provider route, Magpie narration, forced alignment, sparse Elena
  opening, authored teaching scenes, current Review, archive, and master export.
  Inspect frames throughout the duration, audio, captions, pacing, presenter
  identity, mouth-at-rest behavior, and exact output receipts.
- [ ] Complete the packaged editor journey: CAS import, reload, playback,
  waveform, title and trim edit, durable revision, edited timeline render,
  preserved audio, and approximately three-minute output.
- [ ] Repeat cancellation and restart recovery through the final Tauri package
  and verify the durable terminal receipt after restart. An earlier package
  retained BLOCKED across restart and persisted CANCELLED afterward; both
  desktops and workers exited. Evidence:
  `E:\temp\AI Video Tutorial Generator Test Sandbox\Evidence\native-recovery\report.json`
  (2026-09-05 10:04:03 UTC). This receipt predates the final provider and editor
  changes. One WebView2 shutdown diagnostic was logged; this is not a
  zero-stderr claim.
- [x] Produce and inspect the current complex live-code proof: the 84.008-second
  binary-search lesson uses independently checked Python/JavaScript traces,
  timed code writing, found/missing cases, eight narration clips, and ten
  inspected decoded-delivery checkpoints. The video uses the current product name:
  `E:\temp\avt-audit-2026-09-05\teaching-proof-current\binary-search-teaching-proof.webm`,
  SHA-256 `9910915d5291c78acff8666e089c8976cc711649445de18faa83312d4c9e523e`.
  Full audio decode measures -16.5 LUFS, -1.5 dBTP, no clipped samples, and
  8 ms audio/video endpoint drift. WebM reports BT.709 matrix metadata, while
  transfer and primaries are unknown; this is not full color-tag qualification.
  This is distinct from the required native three-minute provider tutorial.
- [ ] Reconcile final documentation and Git status after the coordinated native
  run. Preserve the owner-owned `see me`, release our GPU lease only when owned, and record
  exact current artifact paths and hashes.

## Honest editor and media limitations

These are product-depth gaps, not claims hidden behind completed checkboxes.

- [ ] Preview uses HTML media seeking and is not qualified as frame-accurate.
  A bounded proxy generation/cache/invalidation workflow is still absent.
- [ ] Timeline transitions, same-track overlap, slip/roll/slide tools, nested
  sequences, and independent stems from an already composited generation master
  are not implemented.
- [ ] Timeline-range media regeneration and automatic splice-in are absent.
  Scene-image candidate generation and explicit acceptance are implemented, but
  they are not a general NLE segment-regeneration engine.
- [ ] Native render deliberately blocks unsupported pan, text rotation/scale,
  arbitrary effects, and custom font-asset binding instead of silently ignoring
  them.
- [ ] A named Windows NLE round-trip compatibility matrix remains open. Official
  OpenTimelineIO 0.18.1 parsing and round-trip of an actual native export passed:
  55 clips, five resolving file references and a 180-second timeline. This
  validates interchange structure, not effect-render parity.
- [ ] The accepted 180-second master includes the sparse 8.2-second Elena
  opening. Decoded samples show stable identity and closed-mouth rest. An
  every-frame synchronization/naturalness evaluation and auditory listening
  remain unproven; sampled inspection is not a complete presenter benchmark.

## Release-only and owner-approval gates

These are deliberately outside the authorized local overhaul and must remain
separate from the current native acceptance run.

- [ ] Qualify NSIS/MSI install, uninstall, update, and rollback on a clean
  Windows VM with production-ready runtime inputs.
- [ ] Sign the application, runtime/model manifests, installer, and updater feed
  with approved production keys.
- [ ] Complete portable macOS/Linux packaging and platform-specific validation.
- [ ] Push commits, publish packages, create a public release, deploy, or announce
  the product. Each action requires explicit owner approval.
