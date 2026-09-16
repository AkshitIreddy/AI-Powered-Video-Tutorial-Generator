# September 16: model downloads and control audit

Status: implemented, locally committed, and qualified within the evidence boundaries below. Local main only; nothing pushed or released.

## Requested behavior

Models offer Download; selecting an available model in onboarding starts its download and opens a minimizable global progress panel. Remove privacy settings and extra routing confirmation steps. Audit visible app options for missing or misleading behavior and connect them to their actual operations.

## Implemented behavior

- App-owned, persisted download queue, real native byte progress, queued removal, retry/resume, license links, and status that survives closing setup or navigating elsewhere.
- Native managed model installation uses resumable HTTP transfers and pinned size/SHA verification before extraction. Finished files are reused. The whole-transfer 120-second timeout is removed.
- Onboarding uses the same queue, closes to the progress panel on a new download, and has eight chapters with app-matching styling.
- Models catalog Download actions resolve exact native package IDs. Default discovery puts downloadable/installed models and usable cloud writing routes ahead of unavailable research entries; explicit sorting and searches keep their requested ordering. Details remain secondary. Temporary routing/resource comparison tabs were removed from the integrated screen; named provider profiles are the actual saved configuration.
- Settings and creation no longer expose privacy panels, classification controls, retention/region choices, or a separate routing-approval checkbox. Provider identity checks and key storage remain backend responsibilities. NVIDIA hosted previews still retain their actual public-input API restriction.
- Project filters now expose sorting, source/presenter filters, and Rendering status. Command palette keyboard selection and Enter activation work. Inspector sections expand/collapse. Reset view preserves projects and active jobs.
- Editor imported documents adopt the open native project identity. Track visibility is persisted and consumed by preview/rendering. Empty AI proposal tabs are absent when no proposal producer is connected.
- Generated presenter acceptance updates the current cast and scene assignment. Authored explanation/pacing regeneration uses the configured writing route and durable proposals with separate accept/reject operations, rather than sending every scope to image generation.

## Evidence boundaries

This verification used no live provider calls, paid TTS, GPU generation, or multi-GB model downloads. A portable-debug-only, hash-pinned 4 MiB loopback fixture exercises the native transport and panel through its actual onboarding checkbox. No bridge mapping or queue injection is used in the final harness. The fixture is not a usable AI model.

A model marked download-only is not advertised as inference-ready. There is no active-download cancellation API; only waiting requests expose removal. Removed temporary comparison screens and an unconnected empty AI proposal tab are not claimed as newly implemented product features.

## Verification log

- An early desktop unit run passed 290 tests and exposed one obsolete wording assertion. The corrected final run passed all 297 tests; details below.
- Rust native library: 77/77 passed with portable-debug-runtime, including actual loopback fixture transfer, intermediate bytes, final hash, runtime supervision, and download-state behavior.
- Rendered frame review + visual candidate backend: 31/31 passed. Authored candidate/provider/native-control/background-lifecycle tests: 47 passed; Ruff and mypy passed. Structured provider fixtures verify restart and acceptance without a live provider call.
- Browser workbench/acceptance/visual suite: 9 passed initially; three first-load HTTP timeouts and two obsolete wording selectors were diagnosed. All five affected cases passed on recheck after Vite became responsive and selectors reflected the revised controls. One narrow-only case was intentionally skipped in desktop mode.
- Download drawer: desktop and narrow interaction checks passed; inspected both captures. It is legible, contained within the viewport, and can minimize/reopen without blocking navigation. Evidence: E:\temp\avt-controls-20260916.
- Inspected onboarding model toolkit, model catalog, and download empty states. This exposed inert model selectors and unsupported entries leading the catalog; both were sent for correction before packaging.

Focused local implementation commits: `65a0bd6` editor; `2bc8fe7` frame review; `6e49bb2` presenter acceptance; `88a5ce9` native transfers; `3707332` authored scene proposals; `a3273cb` integrated desktop workflows; `b9591be` acceptance fixture visibility.

## Final source/package checks

- Full desktop suite on the pinned Node 24 runtime: **42 files, 297 tests passed** (`E:\temp\avt-controls-final-unit-24.log`). The final native-catalog discovery addition then passed 8 targeted tests, including the newly added unknown-package selection case; installed SDXL phase/activation coverage passed 3/3. TypeScript and ESLint passed. A run on host Node 20 was stopped after its unrelated cross-realm WebCrypto incompatibility; it is not qualification evidence.
- Final production frontend and portable-debug native executable built successfully. Existing Vite large-chunk warning remains; it is not a runtime test failure.
- Native catalog fixture visibility/transfer regression passed after the final filter change. The fixture is absent in production and hidden in ordinary portable runs unless its exact loopback endpoint is configured.
- Authored candidate review renders in the integrated inspector at desktop/narrow sizes. The initial three-column comparison was unreadable in that container; it now stacks current/proposed text. Inspected heading, body and action captures; UI failure/retry state also tested. This browser visual fixture is explicitly labeled and makes no provider request.

Final portable package (`E:\temp\AI Video Tutorial Generator Test Sandbox`), created **2026-09-16 15:24:22 UTC**:

- Desktop SHA-256: `d6b13e7321b6ded8ff43dcb6fb6ddfb82c44cb1fbd4280f9bd1c28bbaf7e0a19`
- Worker SHA-256: `7129c15b5c8cb6fd713ad30ac6868731ab858e1e4c32ccb265770b6fc118d71c`
- Runtime manifest SHA-256: `2693ff48a731f83ceb4a1657166aa64e10555532c035e7f1a53fa0b5eb995f4c`
- All **774 components** match declared sizes/hashes. Evidence: `Evidence/controls-package-verification.json`.

The final architecture lets onboarding discover native packages directly. Completed native results and profile restoration are recorded below.

## Audit disposition

| Surface | Result |
| --- | --- |
| Models and onboarding | Shared native download queue, actual progress, minimize/reopen, waiting-item removal, retry/resume, exact package matching. Undeclared installers disabled. |
| Generation inspector | Explanation and pacing changes use durable writing-provider proposals; comparison, accept, reject, stale revision protection, and media invalidation are wired through native commands and the worker. |
| Presenter candidates | Acceptance updates the saved cast and scene assignments. |
| Projects and command palette | Sort and source/presenter/status filters work; keyboard selection activates the chosen command. |
| Editor import and tracks | Imported project identity matches the open native project; hide/show persists and is consumed by preview and rendering. |
| Inspector and reset | Sections collapse independently; workspace reset preserves projects and active jobs. |
| Temporary controls | Unconnected routing/resource comparison screens and empty generic AI proposals are removed from the integrated UI. Existing injected proposal support is not a newly completed generic editor AI feature. |
| Privacy | Extra user-facing classification, retention/region, and route-confirmation controls removed. Selected provider profiles still determine exact backend routes. |

This audit does not qualify every external provider or optional model for execution. No new complete canonical video was generated in this turn. Production installer/release qualification remains separate from this portable Windows acceptance.

## Packaged Windows results

### Downloads: passed

Evidence: `E:\temp\AI Video Tutorial Generator Test Sandbox\Evidence\native-downloads\report.json` and its five PNGs.

The actual native-only onboarding card starts a 4,194,304-byte loopback transfer. Observed progress increased from 3.90625% to 7.8125%; minimizing the drawer allowed Projects navigation, and reopening showed verified completion. The file matched SHA-256 `bb9f8df61474d25e71fa00722318cd387396ca1736605e1248821cc0de3d3af8`. Normal app restart restored 100% without another network request (one request total). Both desktops closed normally; workers exited; owner App Data and prior fixture state were restored. Inspected all five native captures across root and audit agent.

One earlier harness attempt used a raw CDP page reload and then failed WM_CLOSE shutdown. The final harness uses the user-facing Settings > Replay setup action and passes normal close/relaunch. The reload cause is not conclusively established, and raw debug WebView reload is not qualified by this result. Failed attempts were retained separately; only verified task-owned processes were stopped during their cleanup.

### Empty setup and normal relaunch: passed

Evidence: `E:\temp\AI Video Tutorial Generator Test Sandbox\Evidence\native-clean-first-launch\report.json`.

A fresh isolated WebView profile was first bootstrapped without instrumentation, then inspected on its clean relaunch. This is explicitly **clean instrumented relaunch**, not scripted inspection of the very first process. It reused six connected provider records, contained zero projects/jobs, completed all eight setup chapters, selected/queued zero optional downloads, opened Replay setup through the UI, and remained completed after normal restart. Both app and worker exited cleanly; owner App Data was restored. The rendered model toolkit shows usable packs first and disabled unavailable installers.

### Project recovery and cancellation: passed

Evidence: `E:\temp\AI Video Tutorial Generator Test Sandbox\Evidence\native-recovery\report.json` and `Evidence/recovery-isolation-20260916T153342709083Z/isolation-report.json`.

A deliberately unavailable local route produced a real durable `BLOCKED` job. App restart preserved its identity, two-presenter cast, and scene assignment. The visible cancellation control transitioned the job to `CANCELLED`. The native screenshot shows the restored presenter panel and cancelled job. Both workers exited with their apps; the wrapper restored the exact owner directory identity and reported no remaining processes. These tests used the final package hashes above and made no live generation request.

### Page navigation: measured

Evidence: `E:\temp\AI Video Tutorial Generator Test Sandbox\Evidence\native-navigation-performance-20260916153451385\report.json`.

The final packaged native WebView traversed Projects, Templates, Library, Models, Settings, and Home twice. First-visit click-to-paint was 76–272 ms. Repeat click-to-paint was 53–131 ms, with zero recorded long tasks on the second traversal. Models was the slowest first visit (272 ms paint, 418 ms settled), then 131 ms paint / 183 ms settled on repeat. These are automated click-to-two-animation-frame measurements on this machine, not a universal latency guarantee or a new controlled before/after benchmark. The harness exited normally and restored onboarding/tour storage. Final process inspection found no sandbox desktop, pipeline worker, or WebView process left running.

## Commit and continuation state

Acceptance harnesses are committed as `740d18d`. Source implementation commits are listed above. User-owned untracked `see me` is preserved. No application test, provider request, generation, or download is left running.

The refreshed app is `E:\temp\AI Video Tutorial Generator Test Sandbox\App\AI Video Tutorial Generator.exe`. All evidence and exact package identities are recorded above. Production publication remains unapproved. The only observed unresolved diagnostic in this pass is raw debug WebView reload followed by close, described in the downloads result; ordinary UI replay, close, restart, and recovery all passed.
