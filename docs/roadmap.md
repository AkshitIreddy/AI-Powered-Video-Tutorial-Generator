# Alystria Studio 2.0 roadmap

The first release candidate covers the complete product brief. Milestones are dependency-ordered gates, not promises that an unfinished feature is already available. Each ends in a working, tested state and an atomic commit.

1. **Flatten and preserve.** Verify and flatten the nested repository without resetting CRLF-only changes; archive v1; quarantine unproven assets; adopt MIT; create the 2.0 feature branch.
2. **Architecture and packaging spikes.** Prove Tauri sidecars/authenticated IPC, durable recovery or its objective SQLite fallback, backup/migration, pinned Chromium, FFmpeg packs, keychain, diagnostics, and a packaged deterministic frame.
3. **Project and security foundation.** Ship schemas/bindings, project format, revisions, content-addressed artifacts, jobs/events, budgets, cancellation, provider catalog, credentials, diagnostics, models, backups, archives, and mock providers.
4. **Research and pedagogy.** Add safe source ingestion, academic/documentation adapters, evidence/claim ledgers, learner profiles, objectives, prerequisite/misconception planning, outlines, reviewed scripts, grounding modes, and approval gates.
5. **Precision-studio experience.** Build global areas, Plan/Storyboard/Studio/Review/Export workspaces, Guided/Studio modes, jobs, cost/privacy, revisions, undo/redo, scoped regeneration, annotations, brand kits, and complete loading/error/recovery states.
6. **Scenes and renderer.** Implement the full typed scene library, ten themes, VisualBible, responsive compilation, choreography, deterministic preview/export, captions, partial rendering, lossless cache, FFmpeg assembly, common aspect ratios, 1080p/1440p/4K, and optional GPL codec pack.
7. **Providers and local models.** Contract-test launch adapters, routing, Cloud/Local/Hybrid disclosures, costs, model download/checksum/license, resource scheduling, egress-isolated local mode, and reference-laptop benchmarks.
8. **Voice, captions, presenters, and audio.** Add voices, multilingual delivery, pronunciation, alignment, accessible captions, mastering, music/effects, multiple speakers, presenter direction, consent, identity/lip-sync QA, and timing repair.
9. **Full product breadth.** Complete course hierarchy, English/Spanish/Hindi verification, quizzes, thumbnails, metadata/chapters, demonstrations, simulations, code tracing, asset library, capability-scoped extension contracts, credits, audio description, and export sidecars.
10. **Hardening and local RC.** Complete all QA modalities, bounded repair, fault injection, deterministic visual/audio regressions, security fuzzing, SBOM/notices, Windows installer/update, macOS/Linux smoke builds, evaluation, docs, demos, and the v1 comparison packet.

## Release-candidate exit criteria

- Every brief requirement is traceable to implemented behavior or a documented brief-permitted boundary.
- Every canonical fixture renders and its release-blocking assertions pass.
- Windows clean-machine install/update/rollback and reference-laptop checks pass; macOS/Linux build smoke passes.
- Security, privacy, rights, consent, accessibility, deterministic rendering, project recovery, and provider-spend gates pass.
- README, demos, screenshots, exact local verification commands, SPDX SBOM, notices, provenance report, and comparison packet are ready.
- Known limitations are explicit and do not contradict a must-level requirement.

The exit condition produces a local release candidate and then stops. Push, merge, package publication, deployment, public release, and announcement require explicit user approval.
