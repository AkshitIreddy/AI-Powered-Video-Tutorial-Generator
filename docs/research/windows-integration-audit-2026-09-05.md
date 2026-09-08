# Windows integration audit

> Work-in-progress historical audit, preserved at the owner's September 7 pause.
> Later successful fixes and the interrupted current render are recorded in
> [the pause handoff](../../CONTINUE_2026-09-07.md). The older pending/pass labels
> below must be reconciled with those exact package receipts before final acceptance.

**Date:** 2026-09-05  
**Scope:** native Tauri shell, supervised worker lifecycle, portable Windows packaging, clean first launch, recovery, advanced editor, and representative provider generation  
**Delivery boundary:** local `main`; no push, signing, release, installer, or external distribution

## Current qualification boundary

The actual packaged Windows application is materially qualified for startup, hidden execution, and worker supervision on the current September 7 payload. Clean onboarding-state inspection after a disclosed first-profile WebView2 bootstrap, setup replay, normal relaunch, and restart/cancel recovery passed on the exact September 5 desktop `d5d13d9d...` / worker `02133044...` package. Durable editor media, playback, waveform generation, save-on-close, and a short native editor export passed on the earlier desktop `4ef44269...` / worker `5eebbf2d...` package at 2026-09-05T12:22:28.357Z. Those state and editor results have not yet been repeated with the current worker. The representative three-minute provider tutorial is **not yet qualified**. Two exact root-reviewed narration mappings were approved through the packaged native UI on September 7. The first produced five real Aria clips but failed the measured pacing gate; the second preserved four cached clips but its longer final scene exceeded the hosted response-size limit. The explicitly approved NVIDIA image route returned empty, unusable output on both integrated attempts; a separate exact-prompt diagnostic identified the hosted result as content-filtered. Presenter inference, final rendering, and GPU work did not begin.

Current package ledger:

| Component | Path | SHA-256 / version |
| --- | --- | --- |
| Desktop GUI | `E:\temp\AI Video Tutorial Generator Test Sandbox\App\AI Video Tutorial Generator.exe` | `d5d13d9de6cece38a885280d4fd9600314250e13395520b4787e02639ddfc1ec` |
| Pipeline worker | `E:\temp\AI Video Tutorial Generator Test Sandbox\Runtime\alystria-pipeline.exe` | `0eec8acbadf691a721e91792a3c6b01711239c144e28ccc47475611f325a118a` |
| Runtime manifest | `E:\temp\AI Video Tutorial Generator Test Sandbox\Runtime\runtime-manifest.json` | `998d4a096daa6289d5af3dd4082ee5cc06d5035019b6cc9b170f5c1504294969` |
| Portable manifest | `E:\temp\AI Video Tutorial Generator Test Sandbox\test-area-manifest.json` | `4a494df3066e00a94285f68ff2a5726d05c1cbb079e1c86ffd651acd7aaff9dc` |
| Runtime Node | packaged runtime | `24.20.0` |
| Chromium | packaged runtime | `151.0.7922.34`, Playwright revision 1234 |
| FFmpeg | packaged runtime | `9.0.1 LGPL` |
| Frontend build Node | local build input | `24.20.0` |

The latest frontend checkpoint passed 238/238 tests and a production build under the repository's pinned Node 24.20.0. Those unchanged frontend sources are embedded in the desktop listed above. The current worker was built from source checkpoint `d539109`, retaining the narration fixes and cache while adding shared-GPU ownership guards for local image and presenter inference. Its recursive PyInstaller archive listing contains `alystria.gpu_guard`.

## Native lifecycle and clean launch

`E:\temp\AI Video Tutorial Generator Test Sandbox\Evidence\packaged-headless-smoke.json` is the exact-package lifecycle receipt. It records:

- a real hidden Tauri/WebView2 document at `http://tauri.localhost/`;
- WebView readiness in 1.953 seconds;
- authenticated packaged-worker readiness in 38.656 seconds on this cold September 7 run;
- Windows GUI subsystem value 2;
- `WM_CLOSE` posted only to the invisible class `Tauri Window` titled `AI Video Tutorial Generator`;
- desktop exit code zero and supervised worker exit;
- zero stdout bytes.

The receipt now has SHA-256 `df7c79bc7a9f127096ba5d292e244f156335ffbc5ff70e9bec90155ec0827cb3` and embeds the desktop SHA-256, worker SHA-256, and portable-manifest SHA-256, so it cannot be confused with an older package. An isolated benchmark showed the former startup delay was dominated by unoptimized `sha2` in the debug build: the same 759 files and 753,880,127 bytes took 53.707 seconds in the default dev profile and 1.008 seconds with only the SHA-256 package optimized, with identical aggregate digests. The desktop keeps every file check and adds `[profile.dev.package.sha2] opt-level=3`. The prior warm package reached worker readiness in 9.141 seconds; the refreshed worker's first measured run took 38.656 seconds. Both are below the former 72.234-second packaged run, while filesystem cache and antivirus activity can materially affect wall time.

The run recorded 115 bytes on stderr from WebView2 failing to unregister `Chrome_WidgetWin_0` with Windows error 1412 during shutdown. Process cleanup passed, and no console window appeared, but this run is not described as zero-diagnostic stderr.

The earlier close helper posted `WM_CLOSE` to Tao and IME helper windows as well as the main Tauri window. That was not a faithful user-close test and could terminate the event loop before the frontend save hook. `scripts/post-wm-close.py` and the Python smoke harness now select only the exact Tauri class/title pair.

`E:\temp\AI Video Tutorial Generator Test Sandbox\Evidence\native-clean-first-launch\report.json` and its copied `test-area-manifest.json` bind this historical check to desktop `d5d13d9d...` and worker `02133044...`. WebView2 accepted the requested remote-debugging flag but did not open its TCP listener on the first process that initialized a completely empty profile. The harness therefore records that first hidden process as a healthy native worker handshake with zero scripted UI actions and `cdpInspected=false`; it does not call it a full first-process GUI proof. After that profile-only bootstrap closed cleanly, the first instrumented launch displayed onboarding, detected the existing six-provider/five-model setup, and contained zero projects and jobs. The UI completed onboarding, opened Replay setup through Settings, exited replay while preserving `completed`, closed gracefully, and launched normally again without reopening onboarding. The normal relaunch again contained zero projects/jobs. Screenshots `01-clean-first-launch.png` through `05-clean-normal-relaunch.png` are actual hidden native WebView captures. The isolated clean profile is preserved under the evidence directory and the owner's original `App Data` was restored.

This proves the configured portable profile paths observed in the run: `App Data` for WebView/application state, `Projects` for SQLite/CAS projects, and the portable `Runtime`, `Models`, `Cache`, `Temp`, `Logs`, and `Evidence` roots. It does not claim an exhaustive whole-disk write inventory. Windows Credential Manager remains the explicit external secret-store exception; only opaque keyring references are persisted in app data. Presenter and forced-aligner runtimes remain separately pinned under the portable `Models` tree and `E:\temp\alystria-aligner-runtime`.

## Recovery and editor proof

`E:\temp\AI Video Tutorial Generator Test Sandbox\Evidence\native-recovery\report.json` is the hash-bound recovery receipt completed at `2026-09-05T14:01:40.817Z` (report SHA-256 `a86eb3ea3865493c2aff06c3bdc2460e157a77fbf5163ef18576108dfe13546f`). It records desktop PIDs 26544/34916 and worker PIDs 44648/12996 while proving that generation `ebda1915-9c68-4f9d-89dc-b92a02190364` remained `BLOCKED` across restart and then reached `CANCELLED` through the UI. The receipt embeds desktop SHA-256 `d5d13d9d...` and worker SHA-256 `02133044...`; its copied package manifest has SHA-256 `d244273e...`. It is exact historical evidence for that September 5 package rather than the refreshed `0eec8acb...` worker. The older unbound `2026-09-05T11:39:34.588Z` receipt remains historical evidence only.

The first current editor export exposed a real preview/render mismatch. A neutral 960x540 video appeared aspect-fitted in preview, while FFmpeg rendered it at source size and also called `rotw(iw)`/`roth(ih)`, treating dimensions as an angle. The decoded output cropped the instructional source. That run remains preserved and explicitly rejected as visual composition evidence.

The repaired exporter aspect-fits source media to the canvas before user scale, converts to RGBA before rotation, and allocates an even diagonal alpha surface for dynamic rotation. A real edge-color regression covers neutral 960x540 to 1280x720 output and a rotated half-scale case.

The accepted historical actual-app editor proof is:

- report: `E:\temp\AI Video Tutorial Generator Test Sandbox\Evidence\native-editor-smoke\report.json`;
- output: `E:\temp\AI Video Tutorial Generator Test Sandbox\Projects\karatsuba-multiplication-step-by-step-mtocor3r\exports\editor\editor-c0c3be4259734040943b1f2ae2bc35de.webm`;
- decoded frame: `E:\temp\AI Video Tutorial Generator Test Sandbox\Evidence\native-editor-smoke\rendered-frame-at-1s.png`.

The native UI imported an owned 84.008-second VP9/Opus WebM into CAS with `modelInput:notAllowed`, reloaded it from the verified asset protocol, rendered and loaded a native waveform, drove playback through the editor Play/Stop controls, and observed 11 presented frames with media time advancing to 0.40854 seconds. A last-second title edit survived immediate `WM_CLOSE` and reopen. The three-second native timeline export is 95,407 bytes, 3.004 seconds, VP9 video with Opus source audio, SHA-256 `7628cb4f162dc35a050ce452fe5520a28fda228e7bc291bf42bae8e078ce000e`. Visual inspection confirms the instructional source fills the 1280x720 canvas without crop and the two-line white title on its dark lower panel is readable. Decoded audio contains 143,845 mono 48 kHz samples over 2.99677 seconds, peak 0.80386, RMS 0.14094, and zero clipped samples.

`visual-inspection.json` binds that proof to desktop SHA-256 `4ef442696cb571a29eff5117ac552c295a8c1c79a101e5197e6303eaa22b8f78` and worker SHA-256 `5eebbf2dac89cce13f5371a799917190da0e68375f40052d63412a0e9c106e59`. It is functional and visual evidence for that exact historical package, not a current-package lifecycle claim or a substitute for the pending full-length editor acceptance.

This proves export rights are independent of model-input permission. The import remained ineligible for model input while its owned commercial/redistribution rights allowed export.

## Representative provider attempts

The intended final media profile is deliberately explicit:

- structured writing: one deliberately selected supported structured-writing route;
- illustration: NVIDIA NIM `black-forest-labs/flux.2-klein-4b`;
- narration: NVIDIA Magpie `nvidia/magpie-tts-multilingual`, voice `Magpie-Multilingual.EN-US.Aria`;
- presenter: local LivePortrait/MuseTalk with `presenter-portrait.broadcast-elena-v1`;
- optional rendered-frame review: NVIDIA `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`;
- hard budget: USD 1.00;
- target: 180 seconds;
- presenter coverage: one authored opening scene only.

Five independent plan-only histories are preserved; none is silently treated as a fallback or success:

1. Groq `openai/gpt-oss-20b`, project `karatsuba-multiplication-through-three-recursive-pro-mtoa6xww`, generation `aa1f5058-215f-44e7-b436-3597b7d44ed9`. A bounded learning-plan retry succeeded and recorded 393 and 286 micros. Script attempt 2 then failed schema validation. Its terminal record is `incurred=true`, `usageComplete=false`, cost unknown; storyboard and approval remain blocked.
2. Mistral `mistral-small-2603`, project `karatsuba-multiplication-with-three-products-mtobt3yk`. Ingest succeeded; the one authorized learning-plan call returned HTTP 429. Its terminal record is `incurred=true`, `usageComplete=false`, cost unknown. It was not retried.
3. Groq `openai/gpt-oss-120b`, project `karatsuba-multiplication-step-by-step-mtocor3r`, generation `01a07182-db45-70a0-ad3e-98c9730046b9`. Learning plan succeeded with 607 input and 476 output tokens, 377 micros, and artifact `45ab0b1d17da22279c92dd61590725ab3db3387ab8095b356396c054772b3c10`. The script call failed schema validation; its failed-response token usage is unknown, so it was not retried.
4. NVIDIA NIM `openai/gpt-oss-20b`, project `karatsuba-multiplication-visually-mtocuiw9`, generation `5eceb99c-fda3-42dd-a73c-d16b98886ae1`. The hosted call returned structured content, but accounting rejected it because the prior adapter left actual cost unknown. The raw response was not retained, so the presence or absence of token telemetry cannot be established. The database contains no usage row or learning-plan result: only the Elena portrait and ingest-stage artifacts are registered. The exact failure is `ProviderFailure: Structured-writing provider omitted billable token usage`. No response body was persisted to task cache or CAS, and no retry was made while the zero-price developer-preview accounting contract was being reviewed.
5. NVIDIA NIM `openai/gpt-oss-20b`, project `explain-karatsuba-multiplication-using-12-34-derive--mtoekhmp`, generation `f5bfdc70-ce1d-488a-bc5c-6885ec907465`. The initial script attempt failed closed on a typographic-hyphen spoken-text check. After the contextual dash and quotation fix was packaged, the explicitly authorized retry reused the successful learning plan and reached the durable review gate. Ingest, learning plan, script attempt 2, storyboard, and approval all succeeded. The cumulative plan ledger records 8,649 tokens and zero micros across learning, the failed script, and the bounded two-call script correction. The preserved plan is `Evidence\native-ui-acceptance.previous-20260905143436334-27736-1\plan-report.json` (SHA-256 `18c025f9ddb5ec8fe5ef3c798642b8287116f1b81e15757b6cf2aadf4479aac7`); its compact scene ledger is beside it as `plan-scene-summary.json` (SHA-256 `94a68f65b6403090a55a8781b6512f386ae460bc84959f322da4b833052bf965`).

The fifth attempt's generated five-scene plan totals exactly 180 seconds and correctly derives the cross term, calculates `ac=3`, `bd=8`, `cross=10`, assembles `408`, and compares `T(n)=3T(n/2)+O(n)` with grade-school multiplication. Revision 9 (`rev_e4d1051dee794e49b9ae07f612fe14c9`) records the first exact packaged-UI approval at `2026-09-07T06:15:01.900Z`. Its five actual NVIDIA Magpie Aria WAVs total 160.3570625 seconds: 8.219875, 37.9414166667, 36.7339791667, 35.8051875, and 41.6566041667 seconds. They are 48 kHz mono, contain no clipped samples, and have no long leading or trailing silence. The stage correctly failed at progress 0.9 because it left 19,643 ms unvoiced while automatic visual tails are limited to 10,000 ms. Measurements and full hashes are in `E:\temp\avt-final-media-inspection-20260907\narration-v2-measurements.json`. The parallel image stage failed once with `NVIDIA NIM visual response contained no usable asset`; no usage row or raw response shape was retained.

Revision 11 (`rev_d0c7aee4df814741bc505b7d4a0b65ac`) records a second exact packaged-UI approval at `2026-09-07T06:27:33.749Z` using reviewed mapping `E:\temp\avt-audit-2026-09-05\karatsuba-root-reviewed-narration-v3.json` (SHA-256 `771e49116ed5ece91559992f2b4793ede3738d95e3aa776c159e780f838dc063`). It changes only the final scene, adding the recursion-tree explanation while preserving the four earlier narration cache inputs. A harness race closed the first narration attempt after it reached progress 0.44; a packaged-app relaunch recovered the expired lease and resumed the same approved branch. The retry failed with HTTP 400 before recording usage or a new artifact because the hosted response was 5,229,554 bytes against a 4,194,304-byte client message limit. The exact recovery receipt is `E:\temp\AI Video Tutorial Generator\acceptance-runs\20260907-d539109-v3-narration-resume\narration-resume.json`. The GPU marker remained `no` throughout.

The one authorized image retry on revision 11 again produced empty output and no usable asset. A separate exact-adapter, exact-prompt diagnostic retained sanitized status and request identity and established HTTP 200 with `CONTENT_FILTERED`, rather than a parser defect. No further image retry is authorized. These failed branches and the native screenshot `Evidence\native-ui-acceptance.previous-20260907062723955-27216-1\04-pacing-and-assets-failed.png` remain rejection evidence, not media acceptance.

A separate authorized public calibration made exactly one Aria request: 38 normalized words produced 14.442813 seconds of mono 48 kHz PCM, or 157.864 WPM, with zero clipped samples and zero micros. Evidence is under `E:\temp\Alystria Aria Calibration\20260905-190915-059662`. This short sample guides review but does not establish long-form rate. The reviewed v2 mapping contains 456 whitespace-delimited words; v3 contains 489 after adding 33 words to the final scene. The UI's required first-scene `We will` to `We’ll` edit makes the approved total 488 while keeping the opening at 21 effective whitespace words. Actual decoded per-scene audio remains the duration authority; the product must not pad silence or claim the calibration as a final voice-rate guarantee.

## Packaging and process policy

Large outputs stay on E:. Previous worker, package, and WebView payloads were moved intact into `E:\temp\AI Video Tutorial Generator\proof-history` after absolute-path, content-count, and reparse-point checks. No filesystem deletion was used in these refreshes. Sidecar builds used `-PreserveBuildWorkRoot`; previous output directories were rotated before rebuilding so the script's recursive cleanup path did not execute.

The package was refreshed only after all app/worker processes had exited. `App`, `Runtime`, `Models`, `Projects`, `App Data`, and `Evidence` contain no reparse point in the audited mutation paths. Models, project databases, proof media, and credentials were preserved. Four unreferenced aligner download fragments were released for reversible quarantine only after the active alignment manifest was shown to pin the assembled ONNX model rather than the fragments.

The 5.91 GB historical `E:\temp\Alystria Studio` tree was moved intact on the same volume to `E:\uesless\AI Video Tutorial Generator Historical Alystria Studio 2026-09-07` after a read-only dependency audit. The source path remained absent during both September 7 packaged-app narration attempts, and no historical-path dependency appeared. The moved tree retains 5,909,712,222 bytes, 6,823 files, and 1,384 directories with no reparse points; it remains available for exact rollback until the final Elena run completes.

## September 8 package and accepted master

The current portable package was independently verified at
`2026-09-08T11:45:26.784835+00:00`: all 762 manifest components matched, with a
BOM-free manifest. Desktop source is a4e4e8a and worker source is 69f8c59;
the source tree at verification was 65ae46f. Exact SHA-256 values:

| Component | SHA-256 |
| --- | --- |
| Desktop executable | `b0030358655844836386ff396783b15f1a5fe7c78bc6955c8a1c28702df477f6` |
| Pipeline executable | `67082407465d0a23136b4531a05be8682fa16c5a35581646a417d38307220432` |
| Runtime manifest | `5bbad842d0e0cdb5ae77ecbe6ea792d96d0b7f1fc2404cfb9e111d3d6304223f` |
| Portable manifest | `f27e570f111ca770cec92c0569838289e036574422b9dc808e68ccecbb85329b` |

Verification receipt:
`E:\temp\AI Video Tutorial Generator\build\acceptance-final-a4e4e8a-69f8c59\root-package-verification.json`.

The previously promoted master job
`e849d162-64fe-4d03-acb7-8bd75872836a` is accepted after independent decode and
sampled visual inspection. Its 180-second, 1080p/30 H.264/AAC output has SHA-256
`904b5e414303b0f79b9e48230a728afdae907257282fd8109404d0305222f1a6`.
Measured audio is -16.24 LUFS / -1.96 dBTP with zero clipped samples; 49 exact
caption cues pass the configured reading-rate and line-length bounds. Sixteen
decoded checkpoints include teaching progression, executable arithmetic, the
sparse Elena opening and closed-mouth rest. This is not auditory listening or
an exhaustive lip-sync benchmark. Evidence is preserved under
`E:\temp\avt-final-media-inspection-20260907\accepted-master-media-20260908`.

The final package reuses this approved master and generation without making
new provider requests or acquiring an AI GPU lease. The full editor journey
is running; its media is not accepted merely because the earlier package
passed automation. The earlier malformed edited audio remains rejected and
the corrected-but-low-bitrate replacement remains short of the true-peak
target, as detailed in the editor audit. A fresh native screenshot confirms
the final portrait type/thumbnail correction and collapsed unlinked catalog
references. Official OTIO 0.18.1 also parsed the current run's actual export,
SHA-256 `8034d7bcb17272d4a4cef4a28fdaa6b726755225e591ee143d2df0026bc6f696`,
with 55 clips and five resolving file references across 180 seconds.

## Historical September 5–7 gate snapshot

The table below predates the September 8 evidence above. Its pending entries
are preserved as history, not assertions about the accepted master.

| Gate | Status |
| --- | --- |
| Current packaged Tauri/WebView/worker startup and graceful close | Passed |
| GUI subsystem and hidden/no-console execution | Passed; one known WebView2 shutdown diagnostic remains on stderr |
| Clean profile, setup reuse, replay exit, normal relaunch, zero seeded work | Passed on desktop `d5d13d9d...` / worker `02133044...` after disclosed uninstrumented first-profile WebView2 bootstrap; refreshed-worker repetition pending |
| Restart/cancel durability | Passed on the hash-bound desktop `d5d13d9d...` / worker `02133044...` package at `2026-09-05T14:01:40.817Z`; refreshed-worker repetition pending |
| CAS import, reload, waveform, UI-driven playback, close flush | Passed on historical desktop `4ef44269...` / worker `5eebbf2d...`; current-package repetition pending |
| Short editor render with preserved source audio and inspected frame | Passed on that exact historical package |
| Structured-writing plan and script through approval | Passed; two exact reviewed mappings were saved and approved through the packaged native UI |
| Reviewed 178-182 second master with captions and delivery audio QA | Pending |
| Sparse Elena opening with matched Aria voice | Pending; real Aria audio exists, but pacing/response-size failures stopped the workflow before GPU inference |
| Optional VLM rendered-frame review | Pending; a provider failure must persist `not_reviewed` and cannot be called a quality pass |
| Final full-length editor export and frame/audio inspection | Pending |
| Signed installer, uninstall, updater, rollback, clean VM | Open release work requiring owner approval |

## Method references

Tauri distinguishes native application/WebDriver testing from mock-runtime frontend tests: <https://v2.tauri.app/develop/tests/> and <https://v2.tauri.app/develop/tests/webdriver/>. The harness uses an acceptance-only random loopback CDP port to drive the packaged WebView2; ordinary builds do not enable remote debugging. Microsoft's WebView2 documentation treats remote debugging flags as development features and advises against shipping them as ordinary runtime flags: <https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags>.

The portable directory is an unsigned local debug handoff. Its successful native checks do not qualify production signing, updater behavior, installer lifecycle, or distribution.
