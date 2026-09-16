# AI Video Tutorial Generator implementation ledger

Current audit: **2026-09-16**, local `main`. The historical checklist below records the August 28 baseline; it is not a substitute for current integrated acceptance.

## September 16 product follow-up

New tutorials use an open topic prompt without fixed suggestions or monetary
budgets. Creation asks explicitly for no presenter or a cast of up to four,
with scene speaker assignments and optional voice overrides. Twelve original
portraits add six anime settings and six other illustration styles. Selected
onboarding packs use the native download manager after license acceptance;
fresh setup selects no optional downloads. The onboarding styling matches the
workbench. Model catalog rendering and provider polling have been reduced to
address navigation stalls.

The [September 16 work record](WORK_2026-09-16.md) records exact builds, source
checks, native recovery, performance measurements, and the failures caught
during integration. Multiple presenters take turns across scenes; simultaneous
animated faces and animation quality on every new portrait are not claimed.
The September 8 long-form media qualification below remains historical proof,
not a new generation with the September 16 source. No push or release.

## September 8 verification

The accepted Karatsuba master is 180 seconds, 1920×1080 at 30 fps, with 5,400
decoded frames and independently measured -16.24 LUFS / -1.96 dBTP audio.
Sixteen decoded teaching/presenter checkpoints were visually inspected. Its
49 caption cues satisfy the configured duration, line-length and reading-rate
bounds. Exact paths and hashes are in the generation audit and continuation.
This is sampled visual inspection and measured audio, not an auditory listening
or every-frame lip-sync claim.

The first full native editor journey passed automation but produced only
56.35 seconds of overlapping, clipped audio. That artifact is explicitly
rejected. Source fixes restore sample-clock timestamps after timeline delays,
preserve silence gaps, and decode both delivery streams before promotion.
Four real FFmpeg regressions failed before the correction and pass afterward.
Windows caption line endings and literal percent text are also corrected.

The corrected native editor journey completed at 11:24 UTC with 5,400 frames,
exactly 180 seconds of audio, zero clipping, and all 18 visual checkpoints
inspected. Peak renderer RSS was 1.157 GiB. Its default Opus bitrate still
missed the -1.5 dBTP delivery target. Worker 69f8c59 therefore sets 192 kbps:
an actual full-duration audio comparison measured -16.24 LUFS / -1.79 dBTP.
The final integrated export completed at 12:05:35 UTC. Independent full audio
decode measures exactly 180 seconds, zero clipping, -16.24 LUFS / -1.79 dBTP.
All 18 decoded frame hashes match the previously inspected candidate. The
final edited video is accepted within the documented sampled-review limits.

Desktop a4e4e8a presents usable media first, keeps 38 unlinked library references
behind an explicit toggle, and resolves saved portrait type/thumbnail from
verified CAS media. The current native close-up confirms the portrait image
and readable still-image label. The final full desktop suite passed 255 cases in 35 files (209.69 seconds).
Typecheck, lint,
desktop build, and 22 focused pipeline tests pass. Package verification on
65ae46f matched all 762 components at 11:45 UTC. The full native journey passed
with normal close and no surviving workers; peak FFmpeg RSS was 1.158 GiB.
Current-package clean profile passed at 12:07:20 UTC, including setup reuse,
replay, zero seeded work and normal relaunch. Recovery passed at 12:09:09 UTC:
BLOCKED survived restart and cancellation persisted CANCELLED. Both checks
restored owner state and left no workers. The initial empty-WebView bootstrap
was uninstrumented; subsequent launches were driven through native WebView.

Official OpenTimelineIO 0.18.1 parsed and round-tripped an actual native export
with 55 clips, five resolving CAS file references, and 180-second duration.
This does not qualify effect parity or a named Windows NLE. Frame-accurate
editor preview, proxies, transitions, overlap/slip/roll tools, nested sequences,
and timeline-range regeneration remain unfinished product work. Installer,
signing and distribution remain separate owner-approved release work.

## Earlier checkpoints

See [Product](docs/research/product-audit-2026-09-05.md), [Generation](docs/research/generation-audit-2026-09-05.md), [Editor](docs/research/editor-audit-2026-09-05.md), [Onboarding](docs/research/onboarding-audit-2026-09-05.md), [Catalog](docs/research/catalog-audit-2026-09-05.md), [Presenter and voice](docs/research/presenter-voice-audit-2026-09-05.md), and [Windows integration](docs/research/windows-integration-audit-2026-09-05.md) for current findings, fixes, measurements, and remaining gates.

Earlier source evidence: the complete desktop suite passed **238 tests** after
the catalog writing-profile integration. Production build, typecheck, lint,
and the final staged-profile browser check passed under Node 24.20. The combined
narration-cache, coordinator, education, and NVIDIA accounting selection passed
**89 tests**; the subsequent visual-receipt adapter selection passed **19**.
An earlier browser matrix passed **25 Playwright journeys** (3 intentional
viewport skips), and the Rust source passed **65 tests** at that checkpoint.
A separate real authored binary-search example is 84.008 seconds with inspected
teaching frames. Actual packaged-native three-second editor export, reload,
playback, waveform, and close-save evidence is recorded in the Windows report.
The final provider-generated three-minute media and final-package recovery
checks remain separate requirements; source checks and short media do not
substitute for them.

September 7 native testing exposed and corrected two additional issues:
Designed layout was incorrectly invoking the configured image provider, and
long NVIDIA narration exceeded the hosted response-size limit. Reviewed slide
mode now controls image generation, and long narration uses complete validated
PCM chunks. The revised coordinator suite passed **53 tests**, with one
desktop-worker generation acceptance test; the NVIDIA adapter and focused
Magpie tests passed as recorded in the generation audit. The rebuilt native
run has since completed narration and the opening presenter. Independent PCM
inspection confirms four reused clips, one new four-chunk clip, and 173.778
seconds of narration on the measured 180-second timeline. The first full
render's teaching frames were rejected: undersized whiteboard content and a
prose-like code scene require correction. Final master/editor acceptance
remains open; see the generation audit for this distinction.

The subsequent September 7 corrections make teaching steps readable at delivery
resolution, compile supported arithmetic into verified executable assignments,
and preserve measured scene windows through master and editor export. The
caption compiler now uses one scene-aligned timeline for rendering, editor
bindings, WebVTT, and SRT: the exact approved case has 49 cues, all within the
configured 700 ms minimum, 20 characters/second, and two 42-character lines.
Each master has an immutable export-provenance receipt so caption-only exports
can safely share identical video bytes. The full generation coordinator suite
passed 53 tests; the final native-control/editor selection passed 45.

The desktop suite passed 240 tests before the strict snapshot-DTO regression
was added; its subsequent focused native bridge suite passed 19. The Rust suite
passed 68 tests after bounded worker shutdown was implemented. Actual packaged
testing verified snapshot refresh to the measured timeline and normal app
closure without surviving owned worker descendants. The final worker rebuild
and full master/editor media qualification are still pending at this checkpoint.

This ledger preserves the historical implementation checklist for the 2.0 worktree. A checked item means
the implementation exists and its relevant local verification passed. It does
not mean that live cloud providers, production signing, every export profile,
or release distribution have been approved or verified.

## Implemented and locally verified

### Repository, architecture, and development foundation

- [x] Flatten the nested repository without changing HEAD, remote, or semantic
  content, then preserve the v1 prototype under `legacy/v1`.
- [x] Isolate 2.0 work on `feat/alystria-studio-v2`, replace the license with
  MIT, establish EOL/ignore policy, remove the tracked key workflow, and
  quarantine legacy media whose rights are not established.
- [x] Establish pnpm, uv, Cargo, Node, Python, Rust, Playwright/Chromium, FFmpeg,
  provider, and model lock/catalog declarations.
- [x] Provide repository commands for setup, development, build, test, lint,
  typecheck, render testing, diagnostics, benchmarks, fixture/catalog checks,
  SBOM/notices generation, and desktop/sidecar packaging.
- [x] Implement the Tauri 2 desktop shell, narrow typed Rust commands, OS
  credential-vault references, authenticated loopback sidecar protocol, and a
  supervised Python worker entry point.

### Contracts, projects, jobs, and trust boundaries

- [x] Implement versioned JSON Schema 2020-12 contracts, exhaustive TypeScript
  domain types, runtime validation, and schema tests.
- [x] Implement the local project directory, SQLite schema/migrations, immutable
  SHA-256 CAS, revisions, optimistic snapshot saves, portable `.alytutorial`
  archives, and source import.
- [x] Implement the active `SQLiteWorkflowRuntime` lease scheduler with explicit
  job states, dependencies, task keys, attempts, events, retries, cancellation,
  recovery, approval waits, costs, and usage records.
- [x] Implement file/archive quarantine, path and SVG validation, URL SSRF and
  DNS-pin protections, project-content egress policy, privacy classifications,
  rights/provenance/consent checks, and fail-closed export gates.
- [x] Implement hardware, storage, FFmpeg, provider, model, runtime, and project
  diagnostics without changing machine settings.

### Research, education, and generation

- [x] Implement typed loaders for topics, questions, notes, scripts, files,
  URLs, repositories, presentations, and datasets, with optional isolated
  Docling extraction for structured documents.
- [x] Implement OpenAlex, Crossref, DataCite, OpenCitations, Europe PMC, and arXiv
  discovery adapters, reciprocal-rank fusion, immutable evidence chunks,
  atomic claims, and claim-support validation.
- [x] Implement Creative, Grounded, and Strict policies, including Strict-mode
  export blocking for unsupported externally verifiable claims.
- [x] Implement learner profiles, prerequisites, objectives, misconceptions,
  concept ordering, outline/script/storyboard stages, and pedagogy/factuality/
  pacing reviews.
- [x] Implement the durable 16-stage `GenerationCoordinator`, scoped dependency
  invalidation, immutable candidates/revisions, approval pauses, and a hard
  maximum of two automatic repair attempts.

### Precision-studio desktop experience

- [x] Implement Home, Projects, New Tutorial, Templates, Library, Models &
  Providers, and Settings & Diagnostics.
- [x] Implement Plan, Storyboard, Studio, Review, and Export workspaces, plus
  Guided/Studio disclosure, the durable Jobs drawer, provider privacy/cost
  indicators, recovery states, and credential-vault flows.
- [x] Implement durable project creation/opening, source import, snapshot saves,
  scene edits, preservation locks, regeneration impact/cost preview, approval,
  cancellation/retry, and archive export bridges.
- [x] Implement the bright precision-studio visual system, reduced-motion and
  high-contrast styles, keyboard-visible controls, responsive narrow-window
  behavior, and shared scene preview components.
- [x] Capture and inspect the final Home, Studio, Providers, New Tutorial, and
  narrow-window screenshots under `docs/images/`.

### Scene, renderer, media, and sandbox systems

- [x] Implement all 36 built-in educational scene kinds and ten hand-authored
  theme packs, with VisualBible/brand-kit contracts, responsive compilation,
  deterministic choreography, accessibility descriptions, and extension
  collision checks.
- [x] Implement the canonical frame-driven React/SVG renderer with a 240,000
  tick timebase, seeded randomness, CAS-only assets, remote-network denial,
  pinned-Chromium execution, captions, partial ranges, resumable frames, FFV1
  mezzanines, FFmpeg assembly, cancellation, progress, and output probing.
- [x] Implement render contracts for landscape, portrait, square, and custom
  dimensions; 24/25/30/48/50/60 fps; 1080p/1440p/4K-sized targets; bitrate
  control; VP9, AV1, H.264 NVENC/Media Foundation/x264, and HEVC NVENC paths.
- [x] Implement deterministic diagrams, math, code, terminal, trace, chart,
  table, map, document, simulation, presenter, quiz, and media scene renderers.
- [x] Implement capability-limited Wasmtime/WASI, Pyodide, and QuickJS-WASM
  workers with deterministic inputs, process/resource limits, Windows Job
  Objects, output validation, and no `node:vm` execution.

### Providers, local models, narration, presenters, and product breadth

- [x] Implement mocked/contract-tested OpenAI Responses, Anthropic Messages,
  Gemini generateContent, NVIDIA NIM hosted chat/VLM/embedding/image preview, and
  OpenAI-compatible local LLM adapters with structured output revalidation,
  privacy scope, idempotency, and budget guards.
- [x] Implement mocked/contract-tested request builders and async lifecycle for
  OpenAI/Gemini/BFL/Recraft images, Openverse/Pexels media, Runway/Gemini motion,
  OpenAI/ElevenLabs/Azure/Google speech, HeyGen/Tavus presenters, and local TTS,
  ASR, alignment, and presenter worker boundaries.
- [x] Implement model manifests, checksum/signature/license policy, safe download
  and resume logic, compatibility checks, and one-heavy-family-at-a-time
  resource scheduling. Models are not bundled.
- [x] Implement Windows System.Speech fallback, voice discovery/preview,
  pronunciation transforms, 48 kHz narration contracts, WebVTT/SRT/transcript
  derivation, mastering/ducking, music/SFX rights, audio descriptions, presenter
  direction, immutable consent, disclosure, and lip-sync/identity QA contracts.
- [x] Implement course hierarchy, practice/quiz models, English/Spanish/Hindi
  fixtures and locale validation, metadata/title/tag/chapter/thumbnail bundles,
  source sidecars, and capability-scoped extension contracts.
- [x] Implement content, citation, math, code, visual, audio, timeline,
  accessibility, privacy, licensing, and release-evaluation QA policies.
- [x] Build and schema-validate deterministic history, math, programming,
  science, statistics, child-analogy, multi-lesson course, and locale fixtures.
- [x] Replace the root README and add architecture, setup, provider/free-trial,
  privacy/security, accessibility, evaluation, troubleshooting, contributing,
  roadmap, and release-policy documentation.

## Historical local verification evidence — August 28

These are the completed checks from the historical implementation baseline.
They are retained for comparison, not presented as current counts, binary
hashes, tool versions, or release benchmarks. Use the September 5 audits above
for subsequent verification and fixes.

| Area | Result | Scope |
|---|---:|---|
| Python pipeline | `312 passed, 1 skipped` | Full pytest suite after source/grounding/QA/background/runtime/NIM integrations; the skip is the opt-in real-renderer smoke |
| Python quality | clean | Ruff plus strict mypy over 113 source files |
| Contracts | `52 passed` | Schema/runtime/provider-catalog/generated-binding contract tests |
| Scene library | `12 passed` | Scene compiler and renderer tests |
| Theme library | `22 passed` | Theme, contrast, brand-kit, and specimen tests |
| Desktop unit/bridge | `17 passed` | React/native bridge/provider-key/model-profile tests and production Vite build |
| Renderer | `39 passed, 1 skipped` | Determinism, browser, FFmpeg, captions, range, and executor tests; opt-in real smoke skipped by default |
| Desktop Playwright | `9 passed, 1 skipped` | Desktop and narrow-window interaction/visual coverage, including model choices and profile save |
| Tauri/Rust | `24 passed` | Formatting, check, model-setup persistence, runtime-pack, command/sidecar/security tests |
| Tauri debug shell | passed | Headless `tauri build --debug --no-bundle`; native executable produced without opening a window |
| Canonical fixture schemas | `11 validated` | Topic/course and EN/ES/HI fixture records |
| Pipeline to real renderer | `1 passed` | Separate opt-in short integration smoke |
| Real media smoke | passed | Short 640x360 Chromium to FFV1 to WebM render, probed and visually inspected |
| Windows speech smoke | passed | 48 kHz mono, non-silent, zero clipped samples; not a voice-quality benchmark |
| Packaged Python sidecar | passed | Final development PyInstaller executable handshake, authenticated RPC, shutdown, exit 0; SHA-256 `0e61e37b98d5129b96ff0d864207778dcb19406e932b6f54df287a0b44a213a0` |
| NVIDIA NIM live smoke | passed | Redacted key: model discovery 83 IDs, GPT-OSS-20B chat 200, Nemotron-3 Embed 1B 200/2,048 dims, FLUX.2 Klein 200/1024 JPEG; no project content sent |
| NVIDIA LipSync local candidate | not enabled | Private Access Program/downloadable NIM; Ada-class compatibility is documented, but RTX 4080 Laptop/12 GB, Docker/WSL, and the required media stack are unverified |

The correctness runs above were performed on the current development machine,
whose Windows Node `20.20.2` and Python `3.12.2` do not match the release pins
Node `24.20.0` and Python `3.12.13`; Rust `1.96.1` matches. The local FFmpeg is
an older GPL-enabled development build and must never be substituted for the
declared signed LGPL core runtime pack in release evidence.

The machine remained in G-Helper **Silent** mode with CPU boost disabled, while
other workloads were present. No power setting was changed. Short render/audio
checks under that profile prove behavior only; there is no canonical RTX 4080
Laptop performance benchmark yet, and UI time/cost ranges are estimates rather
than measured release numbers.

## Historical release checklist — August 28

This preserved checklist describes the earlier gaps. Some have subsequent
bounded evidence in the September 5 audits; an unchecked historical item does
not override those newer results or establish full release qualification.

- [x] Generate drift-checked Rust, Python, and TypeScript schema registries from
  the canonical JSON Schemas. Rich domain models remain hand-authored over the
  generated registry, with CI freshness checks.
- [ ] Complete the DBOS 2.x packaged-Windows crash/recovery/upgrade/no-duplicate-
  charge spike. Until it passes, the deliberately selected and tested
  `SQLiteWorkflowRuntime` fallback remains active; DBOS is not claimed active.
- [ ] Replace catalog-only local-model entries with reviewed immutable revisions,
  artifact hashes, licenses, and signed manifests; then download, resume,
  rollback, and benchmark them on the target 12 GB RTX 4080 Laptop GPU.
- [~] Add the first-run Local model setup assistant. The desktop now persists
  no-secret, switchable profiles per medium; presents broad local-model and
  per-presenter LipSync choices; and rejects non-existent existing folders.
  It deliberately does **not** activate or download a model without a signed
  immutable manifest. Hardware-aware recommendation, full external-pack
  inspection, managed download/resume, license/hash/signature activation,
  rollback UI, and verified-pack scheduling await pinned artifacts and target
  benchmarks. The candidate matrix is recorded in `docs/models/local-profiles.md`.
- [ ] If LipSync is desired, obtain AI for Media Private Access, validate the
  NGC/container stack and target GPU, then add an authenticated local gRPC
  sidecar with presenter consent and lip-sync QA. The ordinary NIM hosted key
  is insufficient.
- [ ] Run live BYOK smoke/contract tests for every launch provider and reconcile
  real retention, region, capability, pricing, cancellation, and billable-request
  behavior. Current evidence includes an opt-in NVIDIA NIM smoke, while the
  remaining launch-provider evidence is mocked/contract-level only.
- [ ] Complete functional advanced editing for every visible control. Durable
  undo/redo, scoped regeneration, render, repair, and export jobs are wired and
  tested; timeline authoring, candidate comparison, and all responsive override
  controls are not yet release-proven end to end.
- [ ] Render and inspect the complete 16:9, 9:16, 1:1, custom, 1080p, 1440p, 4K,
  FPS/bitrate/codec matrix with the signed runtime. The current real render is a
  short 640x360 development smoke, not the final matrix.
- [ ] Deeply verify full English, Spanish, and Hindi tutorials, caption timing,
  ASR WER/alignment targets, audio descriptions, presenters, music/SFX, and all
  export sidecars. Current locale fixtures and component tests are not that gate.
- [ ] Complete long-form renders and human inspection for Karatsuba and every
  canonical example. The deterministic fixtures validate, but a complete
  twelve-minute flagship and the full canonical render set have not passed.
- [ ] Finish the blind v1-versus-v2 evaluation and prove the required scores and
  nine-dimension advantage. Preserved v1 demo hashes/inspection are baseline
  evidence only.
- [ ] Complete installer/update/rollback and clean-machine tests, production
  runtime-pack installation, macOS/Linux build smokes, dependency/model SBOM and
  notice resolution, FFmpeg license report, provenance/C2PA packet, and the final
  release-candidate evidence bundle.

## Historical external findings — August 28

These findings record that earlier environment and credential review. They
must be rechecked before release; they do not describe the current portable
test package or authorize reuse of exposed credentials.

1. **Rotate the previously exposed non-NVIDIA BYOK credentials.** Cohere
   trial/production, ElevenLabs, and AssemblyAI values from the earlier user
   key file inspection remain compromised and must not be used. The newly added
   NVIDIA NIM key was handled in-memory, never printed or committed, and was
   used only for public/synthetic smoke requests. The original key file was
   copied, not moved, to the ignored `.alystria/private/` path.
2. **Production signing material is not available or authorized.** The desktop
   installer, update feed, LGPL FFmpeg/Chromium/Python runtime packs, and optional
   separate GPL x264 pack require immutable manifests, checksums, license review,
   and production signatures.
3. **The exact pinned clean environment is not installed.** Reproducible RC
   verification must be rerun with Node `24.20.0`, Python `3.12.13`, the pinned
   Chromium, the signed FFmpeg runtime, and reviewed model artifacts.
4. **Hardware/load-sensitive evidence is intentionally deferred.** A controlled
   benchmark profile and workload window must be agreed before measurements;
   Alystria will not silently change G-Helper mode, enable CPU boost, or stop the
   user's other workloads.

## Release status and authorization boundary

The source tree is a **local, unreleased RC worktree**. It is not yet a
production-signed or distributable release candidate because the unchecked
release gates above remain.

- [x] Keep all current work local for user inspection.
- [x] Do not change the Windows power profile or CPU boost automatically.
- [x] Do not use previously exposed credentials or run unapproved/billable
  live-provider tests.
- [x] Do not push, merge, publish, deploy, sign a production feed, create a
  public release, distribute an installer, or announce Alystria Studio 2.0
  without explicit owner approval.

Silence, passing tests, local commits, or a locally built package are not release
approval.
