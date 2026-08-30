# Alystria Studio documentation

Alystria Studio 2.0 is a Windows-first, local-first tutorial-production desktop application. Project content, artifacts, history, and durable job state remain on the user's machine. Cloud AI is bring-your-own-key and opt-in at the point where data would leave the device; a hosted Alystria account, backend, synchronization service, and collaboration service are deliberately out of scope.

This documentation is both an implementation contract and an operator guide. Where implementation is incomplete, documents say so explicitly rather than presenting a planned capability as shipped.

## Start here

- [Architecture](architecture/overview.md) — process boundaries, trust model, data flow, and failure recovery.
- [Architecture decision records](adr/README.md) — locked choices, implementation evidence, and remaining release gates.
- [Project format](architecture/project-format.md) — the local directory, SQLite authority, content-addressed objects, revisions, migration, and portable archives.
- [Rendering](architecture/rendering.md) — deterministic scenes, timing, responsive compilation, Chromium capture, and FFmpeg delivery.
- [Tutorial visual-quality bar](visual-quality-bar.md) — release-blocking composition, typography, scene-family, caption-delivery, and human review criteria.
- [Security and privacy](security/security-and-privacy.md) — threats, trust boundaries, local mode, secrets, import quarantine, and export gates.
- [Provider and model policy](providers/provider-and-model-policy.md) — capability contracts, cloud approvals, local model manifests, pricing freshness, and fallback rules.
- [Local model profiles](models/local-profiles.md) — evidence-backed 12 GB RTX 4080 Laptop candidates, LipSync options, and first-run setup flow.
- [Windows + NVIDIA runtime audit](models/windows-nvidia-runtime-audit.md) — workload-specific native runtimes, LM Studio CUDA 12, WSL boundaries, and the verified NVENC compatibility gate.
- [Free and trial provider guide](providers/free-and-trial.md) — dated, caveated signup options for experiments; not an adapter-availability promise.
- [Research and pedagogy](research/evidence-and-pedagogy.md) — safe ingestion, retrieval, atomic claims, instructional planning, grounding modes, and approval gates.
- [Accessibility](accessibility.md) — WCAG 2.2 AA product targets and accessible-media requirements.
- [Evaluation](testing/evaluation.md) — fixtures, measurable acceptance gates, reproducibility, and benchmark reporting.
- [App acceptance harness](testing/app-acceptance.md) — repeatable create/approve/generate/export checks and the exact native-GUI boundary.
- [Windows setup](setup/windows.md) and [troubleshooting](troubleshooting.md) — development and diagnostics without hidden prerequisites.
- [Contributing](contributing.md) and [roadmap](roadmap.md) — engineering rules and the ten implementation milestones.
- [Release policy](release-policy.md) — local release-candidate rules and the explicit approval boundary.

## Normative language

“Must,” “must not,” “required,” “shall,” and “shall not” are release-blocking requirements. “Should” identifies the default unless a documented architecture decision records a justified exception. “May” is optional.

## Evidence policy

Architecture decisions rely on primary or authoritative sources. Provider capabilities, retention, regional availability, license terms, model identifiers, and prices can change; the application must keep a versioned catalog with a `lastVerifiedAt` timestamp and must block unbounded or stale cost estimates rather than guess.

The principal external references are maintained next to the relevant decisions. Key starting points include [Tauri architecture](https://v2.tauri.app/concept/architecture/), [Tauri capabilities](https://v2.tauri.app/security/capabilities/), [DBOS workflow recovery](https://docs.dbos.dev/production/workflow-recovery), [JSON Schema 2020-12](https://json-schema.org/specification), [FFmpeg documentation](https://ffmpeg.org/ffmpeg.html), [WebVTT](https://www.w3.org/TR/webvtt1/), [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [SPDX](https://spdx.dev/learn/overview/), and [C2PA](https://spec.c2pa.org/post/contentcredentials/).

## Release boundary

All 2.0 work remains local. No push, merge, package publication, production deployment, public release, or release announcement is authorized by implementation completion, passing tests, or silence. A release candidate must stop for explicit user inspection and approval.
