# Alystria product-overhaul acceptance record

Completed 2026-09-02. An item is checked only where behavioral, rendered, packaged, or media evidence exists.

## Startup and trustworthy state

- [x] `Alystria.exe` uses the Windows GUI subsystem and its portable launcher is windowless.
- [x] Pipeline, renderer, model, development-server, and diagnostic child processes use hidden-process flags.
- [x] A clean first launch has no projects, recent project, jobs, or user-invisible work.
- [x] The exact old seeded-demo fingerprint is migrated away without removing real user-created projects.
- [x] User-facing product, window, executable, and launcher names are `Alystria`, without overhaul-version marketing.
- [x] The executable and Windows icon set use the original scene-thread/play Alystria mark.

## Visual system and assets

- [x] The desktop uses the original obsidian, cyan, violet, magenta, and gold Alystria visual system.
- [x] The supplied luminous reference informed the mood only; no unicorn artwork or silhouette was copied.
- [x] Six templates have distinct, semantically relevant generated artwork.
- [x] Twenty default profile/presenter portraits cover photoreal, editorial, anime, 3D, illustrated, and cartoon treatments.
- [x] Profile-photo selection and the default-profile padding defect are covered by rendered evidence.
- [x] Desktop and narrow layouts, keyboard focus, reduced motion, clean state, first-run state, studio, editor, model, and settings surfaces pass Playwright checks.

## First-launch interactive onboarding

- [x] A truly clean first launch opens onboarding until the user completes or skips it.
- [x] The contextual tutorial uses a scrim, highlighted target, coach panel, progress, forward/back controls, and safe exit.
- [x] Setup covers profile, storage, privacy, hardware, providers, local runtimes, routes, presenter choice, creative modes, editor, export, and recovery.
- [x] Existing setup is detected and summarized rather than silently repeated.
- [x] Setup and contextual tours are replayable from Settings and support keyboard navigation.

## Providers, models, and hardware safety

- [x] Search, role filters, source filters, compatibility filters, sort, pagination, and routing cover every Alystria model capability.
- [x] User-triggered Hugging Face and Civitai discovery normalizes metadata and rejects off-origin pagination cursors.
- [x] NVIDIA NIM discovery runs through the native broker and leases its key from the OS credential vault.
- [x] Official permitted Hugging Face and NVIDIA assets are bundled; other sources use governed local marks.
- [x] Capability routes independently cover writing, research, embeddings, transcription, voice, music, images, presenter animation, lip-sync, visual review, and upscaling.
- [x] Local and cloud OpenAI-compatible endpoints accept explicit endpoint and model identifiers.
- [x] RAM, VRAM, context, quantization, concurrency, thermal, power, disk, TTL, offload, and fallback limits are configurable.
- [x] Fit explanations and blocking resource-policy decisions are deterministic and unit tested.

## Presenter, image, and slide generation

- [x] Presenter provenance, rights, synthetic status, and generation controls are visible in the creative inspector.
- [x] The presenter lab exposes guided, advanced, and graph workflows with model, prompt, negative prompt, style, reference, LoRA, control, face-detail, inpaint, upscale, seed, and provenance controls.
- [x] Image routes cover Hugging Face, Civitai, NVIDIA NIM, connected APIs, and local installs with revision-aware adapters.
- [x] Designed-layout and illustrated-canvas slide schools keep text deterministic and editable.
- [x] Alignment guides, safe areas, visual-review routing, bounded patch proposals, inpaint repair, and upscale routing are configurable.
- [x] The second-slide alignment regression and presenter-card sequence geometry have deterministic renderer coverage and reviewed 1920x1080 evidence.
- [x] Generated-background pseudo-text is rejected; the approved three-minute candidate uses deterministic semantic diagrams and typography.

## Integrated AI video editor

- [x] The in-app editor has slide, presenter, title/overlay, caption, narration, music, and SFX tracks plus a governed media bin.
- [x] Split, trim, move, snap, lift, ripple delete, extract, reorder, transforms, opacity, audio level/pan/fades, keyframes, and transcript/caption edits are reversible transactions.
- [x] Undo/redo, version records, playhead, in/out, loop, playback rate, snapping, zoom, guides, keyboard shortcuts, JSON project export, and OTIO-like interchange are implemented.
- [x] AI/automation edit proposals expose their exact diff, policy impact, provider/model provenance, cost/retention warnings, and affected clips before apply.
- [x] Proposals can be rejected, undone, or applied to a new project copy without mutating the active edit.

## Acceptance and handoff

- [x] Repository lint and strict typecheck pass.
- [x] Tests pass: 105 desktop, 104 renderer, 65 contracts, 26 themes, 16 scenes, 50 Rust, and 476 Python; environment-gated skips remain explicit.
- [x] Playwright passes 18 desktop/narrow acceptance journeys with 2 deliberate project-specific skips.
- [x] Full-screen and close-up acceptance captures are under `E:\temp\Alystria Visual Acceptance\2026-09-02`.
- [x] NVIDIA NIM and ElevenLabs credentialed health checks passed without logging secret values.
- [x] A locked two-second MuseTalk GPU inference passed and restored `gpu use.txt` to `no`.
- [x] The 180.008-second female-presenter master is 1920x1080 VP9/Opus and its final six-slide contact sheet was reviewed.
- [x] The fresh 0.741 GiB portable package under `E:\temp\Alystria Test Sandbox` passed an invisible 12-second launch smoke with empty stdout/stderr.
- [x] Changes are split into working Conventional Commits directly on local `main`; `see me` is untouched and nothing is pushed.
