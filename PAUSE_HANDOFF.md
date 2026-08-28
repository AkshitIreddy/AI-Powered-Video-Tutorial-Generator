# Alystria Studio 2.0 pause handoff

Paused at the owner's request on **2026-08-28**. Do not resume implementation,
testing, packaging, benchmarking, provider calls, or documentation work until
the owner explicitly says to continue.

## Repository state

- Branch: `feat/alystria-studio-v2`
- Last pre-overhaul checkpoint: `32f4fc9 chore(repo): bootstrap alystria studio 2.0 workspace`
- No push, merge, publication, deployment, release, or production signing has
  occurred.
- The nested repository was flattened safely and the v1 source remains under
  `legacy/v1` with an explicit do-not-run security warning.
- The user-approved local checkpoint commit containing the current overhaul and
  this handoff should be treated as a **WIP pause checkpoint**, not a release
  candidate or a green final gate.

## Implemented before pause

- Tauri 2/React precision-studio desktop, Rust least-privilege broker, OS
  keyring, authenticated sidecar and signed-runtime-pack trust foundation.
- SQLite/CAS projects, migrations, append-only revisions, archives, durable
  background jobs, recovery, cancellation, approval waits and duplicate-charge
  checkpoints.
- Source quarantine/ingestion, Docling boundary, research/evidence/claims,
  strict grounding, pedagogy/script/storyboard and rendered-output QA.
- All 36 scene families, ten themes, deterministic 240 kHz Chromium renderer,
  FFV1/FFmpeg path, captions, audio, presenters and sandbox workers.
- Real native undo/redo, scoped regeneration, scene render, QA repair and master
  export jobs; browser simulations are explicitly demo-only.
- JSON Schema binding generation and drift checks for TypeScript, Python and
  Rust.
- Provider catalogs/routing for 22 providers, including the new safety-gated
  `nvidia-nim` provider.
- Canonical fixtures, v1 evidence baseline, final UI screenshots and a short
  deterministic Karatsuba media sample.
- Strict compliance inventory currently resolves 559 distributed dependencies
  with zero unknown licenses; release assembly/signing gates remain open.

## NVIDIA NIM checkpoint

- The new NVIDIA key was read only in memory from the user-specified file and
  never printed, placed in argv/environment, committed, or sent to an agent.
- The source key file was **copied, not moved**, to the ignored path
  `.alystria/private/Commonly used Keys.txt`; the original remains untouched.
- Live public/synthetic smokes with the one key:
  - model discovery: HTTP 200, 83 returned model IDs;
  - chat: `openai/gpt-oss-20b`, HTTP 200;
  - embeddings: `nvidia/nemotron-3-embed-1b`, HTTP 200, 2,048 finite values;
  - FLUX.2 Klein: HTTP 200, valid 1024x1024 JPEG, SHA-256
    `f369639665a769c9b28fbfc19ae7443e0b666de9d52198483aa5ff89aba05cee`.
- `nvidia/nv-embed-v1` returned HTTP 410 and is blocked as retired.
- Some heterogeneous model IDs returned by `/v1/models` are not chat routes;
  model capability must be rechecked before use.
- Hosted NIM remains public/synthetic-only and development/testing-only. It is
  not the global default for private projects. Reranking is dormant, video is a
  deprecated diagnostic tombstone, VoiceChat is not selectable-voice TTS, and
  NVIDIA LipSync requires the separate AI for Media Private Access Program and
  a self-hosted Linux/gRPC NIM.

## Last verification state

Green immediately before the NVIDIA addition:

- Python: Ruff clean, strict mypy clean, `301 passed, 1 skipped`.
- TypeScript/workspaces: contracts 51, scenes 12, themes 22, desktop 14,
  renderer 39 passed/1 skipped; builds passed.
- Rust: format/check/Clippy clean and 22 tests passed.
- Playwright: 7 passed, 1 intentional skip.
- Packaged Windows sidecar authenticated smoke passed; the pre-NVIDIA build
  SHA-256 was `ccd274dbaa1422f207cfb1dd6fe55ad69dbf4730db65686556421271adf63b6a`.

After NVIDIA NIM landed:

- Ruff is clean and strict mypy is clean across 113 Python source files.
- NVIDIA focused tests: 11 passed; provider-focused suite: 58 passed.
- Contracts: 52 passed. Desktop unit/native tests: 16 passed. Typecheck passed.
- The latest full Python run ended with **311 passed, 1 skipped, 1 failed**.
  The sole failure is
  `test_versioned_catalog_covers_every_launch_modality_and_is_conservative`:
  `Capability.RERANKING` is intentionally dormant after the hosted rerank model
  was removed from the active NIM descriptor, but the old test still requires
  every capability to be active somewhere.

## Resume TODO in order

1. Decide the dormant-reranking contract: update the conservative catalog test
   to distinguish implemented-but-dormant capabilities, or add an honest active
   adapter only if a currently hosted rerank endpoint is verified. Do not
   advertise a downloadable-only model as hosted/free.
2. Run the full Python gate again; expected target is 312 passed, 1 optional
   real-render skip after resolving the one catalog assertion.
3. Rerun catalog validation, contracts, desktop unit tests, typecheck/lint and
   production build after the NIM changes.
4. Run Playwright on the new isolated preview port `4178` (development port is
   `1438`) and visually inspect the NVIDIA provider card. Do not touch another
   project's ports or processes.
5. Rebuild and authenticate-smoke the packaged Windows sidecar again because
   the final NIM provider code landed after the last sidecar build.
6. Run Tauri `build --debug --no-bundle` headlessly. The production installer,
   updater and signed runtime packs remain blocked on real signing/release
   inputs.
7. Finish the interrupted `IMPLEMENTATION_STATUS.md` refresh with the final
   verified counts and NIM evidence; validate all Markdown links.
8. Rerun strict SBOM/notices, generated-binding drift, fixture/hash validation,
   secret scan, `git diff --check`, and post-commit clean-machine checks.
9. Replace this WIP checkpoint with atomic green commits if desired, then stop
   for owner inspection. Never push, merge, publish, deploy or release without
   explicit approval.

## External release gates still open

- Rotate the previously exposed Cohere trial/production, ElevenLabs and
  AssemblyAI credentials before any future live test. The newly added NVIDIA
  key was not exposed in this run.
- Exact pinned Node 24.20.0 and Python 3.12.13 environment.
- Production signing identity/public key, updater endpoint, signed pipeline,
  Node, Chromium and FFmpeg packs, optional GPL pack and clean-VM tests.
- Reviewed immutable model artifacts/licenses, DBOS packaged-Windows spike,
  macOS/Linux build smoke, full canonical/locale/media matrix and controlled RTX
  4080 benchmarks.
- Full 12-minute Karatsuba and remaining canonical renders plus blind v1/v2
  scoring.

The PC power profile was never changed: G-Helper remained in Silent mode with
CPU boost disabled, and no other user workload was stopped.
