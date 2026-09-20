# Continuation audit — 20 September 2026

The stopped agent's editor redesign and runtime work were reviewed against the owner's requests, source, recorded handoffs, Git history, and rendered behavior. Its results were retained selectively. Nothing was pushed or released.

## Disposition

| Inherited change or claim | Audit result |
| --- | --- |
| Single editor header, icon rail, consolidated side panels, saved layout | Useful foundation retained. Corrected control keyboard ownership, splitter direction/bounds, clipped playback, typography specificity, duplicate footer actions, and transient transcript draft loss. |
| Editor browser tests passed | The old tests checked DOM visibility while playback could sit outside the scrollport. New geometric assertions verify actual containment and absence of center scrolling at 1440×960, 1366×640, and the native minimum width of 860px. |
| Runtime panel and missing-runtime prompt | Replaced. The original runtime button downloaded the entire SDXL pack, inferred runtime readiness from SDXL, and offered a misleading model-only action. A dedicated package now installs only ComfyUI, with its own durable identity and verification. |
| Model selected in onboarding | Preserved through the runtime prompt and sequential queue. ComfyUI is an explicit optional runtime entry, separate from model preferences. |
| Grounded generation fixed by assigning Gemini | Assignment fixed the readiness error but did not perform research. The workflow now calls the actual research route, retains response provenance and usage, and passes findings to outline and script authoring. |
| Power panel removed; template card selects a template | Retained and verified. |
| Cleanup preserved alignment runtime | Incorrect. Only its configuration survived; its configured executable/model root had been deleted. Restored a pinned CPU ONNX aligner with a reproducible installer and verified all six words of a real 2.944-second speech sample. |

## Editor behavior

The preview fits both available width and height, leaving playback controls visible. Transcript text occupies the cue width; timing and optional speaker identity use compact controls. Side-panel and timeline dimensions are resizable, keyboard operable, and persisted. An interrupted transcript edit is stored separately from the saved cue and recovered on reopening; it is applied to the project only by **Save cue**. Source-version keys prevent an imported document with reused clip IDs from receiving an unrelated draft.

Focused buttons, inputs, and separators own their normal keyboard interactions. Timeline clips retain editor shortcuts. Disabled icon actions expose their explanation to keyboard users. Fresh layouts hide unused tracks; existing saved visibility preferences are respected. Empty tracks can be shown, compacted, or hidden without removing project data.

Native media import also raced the debounced editor save. The preserved database records a timeline-save revision between the import request and failure, with no imported asset until the later diagnostic call. Fresh-head lookup and import now execute together on the shared project save queue. Typed native error messages remain visible instead of collapsing to a generic import failure. A controlled concurrent-save regression covers the original race.

## Runtime contract

`runtime/comfyui-0.9.2` downloads the exact 1,803,412,624-byte portable archive pinned to commit `8f40b43e0204d5b9780f3e9618e140e929e80594`. Its readiness and fingerprint do not imply that model weights are installed. SDXL has a separate executable model receipt; other downloadable candidates retain their existing activation restrictions.

Managed downloads share the same archive and extracted runtime. The runtime prompt queues ComfyUI followed by the model the user actually selected. Displayed totals account for the shared archive once. Installing a model also publishes the independent runtime receipt if runtime extraction completed, even if a later model step fails.

An interrupted extraction leaves a marker. Native validation, Python preflight, and model installation reject that partial runtime; retry re-extracts it before publishing Ready. Extractor processes are launched with the Windows no-window flag. Downloading and extracting do not acquire the GPU.

Managed installer processes launch suspended, enter a Windows Job Object with kill-on-close ownership, and then resume. Normal application shutdown terminates that tree and waits for the root process with a bounded timeout; parent-process termination also closes the job. A Windows test exercised the handle-close behavior against an actual hidden child and descendant. Runtime resolution selects a complete manual or portable pair of Python and `main.py`, preventing partial manual folders from redirecting model files into the wrong tree.

The first actual SDXL invocation exposed a Windows integration defect: a verbatim path from Rust became ComfyUI's working directory, and bundled Python 3.13 resolved drive-rooted checkpoint names as malformed UNC paths. The launcher now supplies ordinary drive/UNC paths to the child while retaining canonical paths for verification. The exact failure and fix were reproduced using the bundled Python runtime; no downloaded ComfyUI source was modified.

The runtime panel displays one status and action alongside compact version, size, and license metadata. Its previous repeated title/status rows were removed, bringing more model cards into view at both desktop and narrow widths.

The source release is pinned rather than silently updated to an unrelated ComfyUI build. See the [official v0.9.2 release](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.9.2).

## Grounded generation

The workflow uses the configured research route before planning for applicable Grounded/Strict cloud-writing runs. Findings require a real request identity, search usage, and citation metadata. The bounded raw provider response and incurred usage are stored together before local JSON/citation validation, so retry reuses an accepted response even when normalization fails. Raw receipts record full/stored hashes and truncation; existing successful normalized receipts remain readable. The workflow implementation version changed to prevent reuse of an old research-stage result that never searched.

Research synthesis is labeled as a provider response with response-level provenance; it is not represented as independently downloaded source text or proof of per-claim citation alignment. Its validated findings are supplied to subsequent authoring.

A real request exposed that Gemini 2.5 Flash was unavailable to the configured API key. Authenticated read-only model discovery confirmed Gemini 3.8 Flash and 3.7 Flash support `generateContent`; current profiles and the catalog now use 3.8. Saved 2.5 routes retain compatibility. The adapter accepts only reviewed models and keeps the legacy 2.5 restriction against combining search with API JSON schema. Unsupported or unavailable models produce an actionable model-selection error. See Google's [search grounding documentation](https://ai.google.dev/gemini-api/docs/google-search) and [structured outputs with tools](https://ai.google.dev/gemini-api/docs/structured-output#structured_outputs_with_tools).

Gemini 3.x token free tiers and search allowances are distinct: Google Search grounding requires a billing-enabled project, with 5,000 shared monthly search requests included before per-request charges. The app does not enable billing or claim search works on an unbilled key. Pricing metadata retains the published paid-tier ceiling for accounting. See [Google's current pricing](https://ai.google.dev/gemini-api/docs/pricing).

## Image action persistence

The native local-image test revealed an eight-second autosave that created an identical-content revision while an artwork job ran, causing the worker to reject the result as stale. The explicit image save now reserves the general save queue immediately, reads and saves the authoritative head inside one serialized operation, and cancels only autosaves covered by the clicked version. Later edits remain dirty; backend compare-and-swap protection is unchanged.

Actual inference then exposed a local adapter contract mismatch: it labeled generated candidates `local-generated`, while the shared candidate schema accepts `aiGenerated` or `licensedMedia`. Local output now uses `aiGenerated`, retaining its precise local provider/model metadata. A composed adapter-to-candidate-to-acceptance regression verifies that boundary. The native app subsequently generated, decoded, and explicitly accepted a 1344×768 image with one local usage record and a released GPU lease. The generated sample was visually too busy for a clean chapter background and was not added to the bundled asset collection.

A stronger acceptance check waited for the promoted scene preview rather than only the candidate-selection label. That exposed a native CSP mismatch: `img-src` allowed the local asset URL, while `connect-src` blocked the preview's independent fetch and SHA-256 verification. The policy now permits only Tauri's scoped `asset:` and Windows `http://asset.localhost` transports for that read. Filesystem scope and content verification are unchanged; general HTTP/HTTPS and blob fetch permissions were not added.

Native diagnostics then proved the asset read, hash, MIME, and decoding succeeded, but the preview crashed when a native promotion created an assets-only customization record without a color palette. Theme projection now preserves the compiled defaults for absent choices, including typography-only records, and honors explicitly supplied partial or complete settings. Accepted asset records are untouched. Regressions cover assets-only, typography/radius-only, partial palette, and complete user settings.

## Narration pacing and visible duration

The Creative native run authored 130 words and synthesized three clips totaling 42.678 seconds. Its old writer target assumed the 123 WPM voice profile despite selecting NVIDIA Magpie Aria; the actual clips averaged about 183 WPM. Authoring now selects a reviewed 171 WPM estimate for that exact Aria route and retains the existing default for other routes.

Wizard durations are targets. A target can follow measured narration within 25%, preserving the existing 6%/2-second-per-scene maximum visual tails. Exact authored fixtures keep their strict contract. The retained failed project can reuse its three accepted clips and produce 46.278 seconds with 1.2 seconds of tail per scene; a durable receipt records requested, measured, fitted, and tail durations. Retry tests verify no additional synthesis call. The export summary now shows current timeline duration separately from the requested target, and custom-duration wording also says target.

The actual science lesson also exposed an unrelated `sorted input` label in the definition compositor. An omitted optional term label now falls back to the authored title and then the reviewed scene title. Explicitly authored algorithm labels remain unchanged. A rendered science regression and all 55 scene-package tests pass.

The retained lesson uses designed definition, process-card, and recap slides. Reviewed frames are legible and carry the lesson content, but the process cards are not a bespoke physical scattering simulation. Technical delivery checks must not be presented as proof of sophisticated instructional animation or a complete factual review.

## Qualification

Source and browser verification passed for the corrected editor and setup flows: the final frontend suite passed all 333 tests in 49 files, alongside fourteen editor browser cases and eleven runtime/onboarding/catalog browser cases. All 83 native library tests and 542 Python unit tests passed (one optional NumPy test skipped); subsequent focused suites covered the final narration fit, local image candidate contract, and Windows runtime launch fixes. Research tests covered actual routing, successful/raw/legacy checkpoints, malformed responses, citation bounds, and retry accounting. Native qualification uses the actual packaged Tauri WebView, Rust broker, authenticated Python worker, real file downloads, and isolated acceptance projects. Browser fixtures are not counted as native or provider evidence.

The CPU alignment runtime uses `onnx-community/wav2vec2-large-xlsr-english-ONNX` at immutable revision `a5a0efbf15dec1a4a0d46e8b9c0d207f0fc755e0`. `scripts/install-forced-alignment-runtime.ps1` verifies pinned model, vocabulary, and worker hashes; the portable profile uses the resulting configuration. The real-speech probe exercised the application loader and alignment client, with six of six words aligned in 2.99 seconds on CPU. This dependency probe does not substitute for a completed tutorial generation.

The real runtime download acceptance passed on 20 September at 06:35 UTC. It downloaded and verified ComfyUI and both SDXL files, demonstrated progress/minimize/navigation/reopen, resumed a network interruption, published runtime readiness before model readiness, avoided repeated extraction, and verified both packages after restart. Owner app data and projects were restored. The report is under the portable sandbox's `Evidence/native-runtime-install/report.json`.

Native navigation measured first-visit paint times of 77–286 ms and repeat-visit paint times of 47–180 ms across Projects, Templates, Library, Models, Settings, and Home. Repeat visits produced no long tasks; first-visit Models produced one. These are measured values from this local debug package, not a promise for all machines. Evidence: `Evidence/native-navigation-performance-20260920065820294/report.json`.

The portable test build uses 774 verified renderer/runtime components. It is a local debug test package, not a production installer or release qualification. Grounded generation currently fails at the first Gemini 3.8 request with HTTP 429 and no accepted usage; its successful live completion is not claimed.

The separate Creative run completed all sixteen generation stages through export after reusing the three accepted narration clips. It retained exactly three Groq writing, three NVIDIA Magpie narration, and one NVIDIA visual-review usage records. The 1080p/30 fps delivery contains 1,389 frames and runs 46.308 seconds including container rounding. Full-decode checks measured no blank frames or clipped samples, 8 ms audio/video drift, and thirteen caption cues with UTF-8 sidecars. Representative frames from all three scenes were inspected; no auditory listening claim is made. The completed run is `Evidence/native-generation-smoke/runs/20260920082752680-25172`; its harness initially rejected JSON field order after the successful export, which was corrected without changing the accepted result.

Native artwork continuation `20260920091914261-14244` passed against the rebuilt app: the already accepted image appeared on the central scene canvas and decoded at 1344×768, with unchanged receipt/usage records and no new inference or GPU lease. Its screenshot was inspected directly.

Native tutorial continuation `20260920092030648-21796` also passed, reusing the completed generation with zero new provider calls. The editor imported its verified WebM export, displayed a waveform, trimmed to 90 frames, saved a two-line title, rendered a 3.008-second VP9/Opus clip, and retained playable CAS media and the latest title across immediate close/reopen. The rendered frame and editor screenshots were inspected. Recovery preserved a blocked job across restart, cancelled it, and retained a two-presenter cast with its scene assignment. Both continuations restored owner App Data and Projects and verified graceful desktop/worker shutdown.

The owner's existing projects, app data, common credentials, and unrelated projects must remain intact. Native acceptance restores its temporarily isolated owner directories. The older ignored handoffs and current ignored progress record retain the detailed continuation context.
