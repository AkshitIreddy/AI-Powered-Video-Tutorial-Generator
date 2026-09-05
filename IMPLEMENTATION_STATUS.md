# AI Video Tutorial Generator implementation ledger

Current audit: **2026-09-05**, local `main`. The historical checklist below records the August 28 baseline; it is not a substitute for current integrated acceptance.

See [Product](docs/research/product-audit-2026-09-05.md), [Generation](docs/research/generation-audit-2026-09-05.md), [Editor](docs/research/editor-audit-2026-09-05.md), [Onboarding](docs/research/onboarding-audit-2026-09-05.md), [Catalog](docs/research/catalog-audit-2026-09-05.md), [Presenter and voice](docs/research/presenter-voice-audit-2026-09-05.md), and [Windows integration](docs/research/windows-integration-audit-2026-09-05.md) for current findings, fixes, measurements, and remaining gates.

Current source evidence: **200 desktop tests**, **25 Playwright journeys** (3 intentional viewport skips), **63 Rust tests**, desktop typecheck, and lint passed. A separate real authored binary-search example is 84.008 seconds and has inspected teaching frames. The current final provider-generated three-minute tutorial, native editor journey, and recovery qualification are tracked in the Windows report; earlier counts and media below must not be substituted for them.

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

## Latest local verification evidence

These are the most recent completed checks in this implementation pass. They
are correctness evidence, not release benchmarks.

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

## Implemented surfaces that still need release-grade proof

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

## External and release blockers

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
