# Alystria Studio 2.0 implementation ledger

This file is the durable source of truth for the full 2.0 implementation. An
item is complete only after its implementation and relevant verification pass.

## Repository and foundation

- [x] Flatten the nested repository without changing HEAD, remote, or semantic status.
- [x] Create the isolated `feat/alystria-studio-v2` branch.
- [x] Preserve the v1 prototype under `legacy/v1` and establish an LF policy.
- [x] Replace the root license with MIT and ignore secrets/generated artifacts.
- [ ] Establish pnpm, Python, Rust, Chromium, FFmpeg, and model/runtime locks.
- [ ] Provide one-command setup, development, testing, diagnostics, benchmark, and package flows.

## Contracts, persistence, jobs, and security

- [ ] Implement versioned JSON Schema 2020-12 contracts and generated bindings.
- [ ] Implement `.alytutorial` project storage, SQLite migrations, revision history, and CAS.
- [ ] Implement durable jobs, task states, retries, cancellation, crash recovery, events, and budgets.
- [ ] Implement secure credential references, privacy routing, provenance, rights, and export gates.
- [ ] Implement hardware, model, provider, FFmpeg, storage, and project diagnostics.

## Research and education

- [ ] Implement modular source ingestion for topics, files, URLs, repositories, scripts, slides, and datasets.
- [ ] Implement academic/documentation/web discovery and an evidence/claim graph.
- [ ] Implement Creative, Grounded, and Strict research modes.
- [ ] Implement learner profiles, prerequisites, objectives, misconceptions, examples, and concept ordering.
- [ ] Implement outline, script, critique, verification, pacing, and storyboard stages.

## Studio UI and editing

- [ ] Implement Home, Projects, New Tutorial, Templates, Library, Providers, and Diagnostics.
- [ ] Implement Plan, Storyboard, Studio, Review, and Export workspaces.
- [ ] Implement Guided/Studio disclosure, durable jobs drawer, cost/privacy indicators, and recovery states.
- [ ] Implement scene/section/project editing, scoped regeneration, locks, alternatives, versions, and undo/redo.
- [ ] Meet keyboard, contrast, reduced-motion, narrow-window, 1440p, and 4K requirements.

## Scene and render systems

- [ ] Implement the full typed educational scene catalog and ten theme packs.
- [ ] Implement the VisualBible, responsive layout compiler, choreography, and 240 kHz timeline.
- [ ] Implement deterministic Chromium rendering, partial previews, mezzanine cache, and FFmpeg assembly.
- [ ] Implement 16:9, 9:16, 1:1, custom, 1080p, 1440p, 4K, FPS, bitrate, and codec exports.
- [ ] Implement diagrams, math, code, terminal, traces, charts, maps, documents, simulations, and UI demos.

## Providers, local models, narration, and presenter

- [ ] Implement OpenAI, Anthropic, Gemini, and OpenAI-compatible LLM adapters.
- [ ] Implement image, licensed-media, motion, TTS, alignment, transcription, and presenter adapters.
- [ ] Implement model manager, checksums, licenses, capability routing, and GPU scheduling.
- [ ] Implement voice preview, pronunciation dictionaries, alignment, captions, transcript, and mastering.
- [ ] Implement optional presenter direction, consent, lip-sync/identity QA, music, SFX, and audio description.

## Full product breadth

- [ ] Implement course hierarchy, interactions, quizzes, exercises, and chapter exports.
- [ ] Deeply verify English, Spanish, and Hindi localization and capability-gate other locales.
- [ ] Implement thumbnail, title, description, tags, summary, chapters, sources, and project archive exports.
- [ ] Implement internal extension registries and out-of-process capability-scoped plugin contracts.
- [ ] Rewrite README, architecture, provider, privacy, troubleshooting, contribution, and roadmap docs.

## QA, examples, and release candidate

- [ ] Implement content, citation, math, code, visual, audio, timeline, accessibility, and licensing QA.
- [ ] Limit automatic repair to two attempts before human review.
- [ ] Build deterministic history, math, programming, science, data, analogy, course, and locale fixtures.
- [ ] Render and inspect the Karatsuba flagship and all canonical examples.
- [ ] Compare 2.0 with preserved 1.0 evidence using the agreed rubric.
- [ ] Run unit, property, contract, migration, cache, crash, visual, audio, security, and package tests.
- [ ] Produce a local Windows-first release candidate, screenshots, demos, change summary, and test instructions.
- [ ] Do not push, merge, publish, deploy, or release without explicit approval.
