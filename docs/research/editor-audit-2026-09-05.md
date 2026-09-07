# Editor audit and implementation decisions — 2026-09-05

## Scope and evidence

This audit covers the integrated editor under `apps/desktop/src/editor`, its read-only call site in `apps/desktop/src/App.tsx`, the current handoff files (`see` and `see me`), the preserved v1 source, the `v1.0.0` tag, current repository documentation, ADRs, and Git history. The previous implementation was treated as useful evidence rather than as a product specification.

The editor is a browser-rendered React surface inside a Windows desktop shell. Its validated document is stored in immutable project revisions. Native editor imports are promoted into the project content-addressed store and resolved through a checked media resolver. A typed render manifest and durable background job now render supported timeline edits with the pinned FFmpeg runtime; unsupported operations fail explicitly.

## Native composition correction

An earlier native import/export run passed CAS persistence, UI-driven playback,
waveform loading, durable export registration, immediate-close save recovery, and
worker shutdown, but visual inspection rejected its decoded output: the neutral
960 × 540 lesson was cropped inside a 1280 × 720 canvas.

Two source defects caused the mismatch. Export omitted the preview's
aspect-preserving contain fit, and its rotation surface used `rotw(iw)` and
`roth(ih)`, passing dimensions to functions that accept an angle. The latter can
crop media even with zero rotation. The corrected chain fits media before user
scale, preserves alpha before rotation, and reserves an even diagonal surface for
animated rotation. [FFmpeg's rotation implementation](https://www.ffmpeg.org/doxygen/8.0/vf__rotate_8c_source.html)
confirms the angle-based bounds calculation.

Commit `664fe60` includes a real FFmpeg regression with colored edges. Decoded
1280 × 720 output preserves every source edge at neutral scale and at 30-degree
rotation with half scale. Root inspected both proof images; the focused export
tests, Ruff, and strict mypy passed.

The corrected packaged Windows run is accepted for its stated three-second
scope. At `2026-09-05T11:41:19.591Z`, desktop SHA-256
`5bb7358788d889afde9de11ce503e6a7502173fc0a028358dcebfe1170a4602c`
and worker SHA-256
`73804d77da21025465fe5ce1becf9bd04cd4777eca574b577374e37fddb6b2ca`
imported and reloaded the canonical binary-search WebM, drove real editor
transport, rendered its CAS waveform, retained the immediate-close edit, and
shut down cleanly. Its VP9/Opus delivery is 96,409 bytes and 3.004 seconds:
`E:\temp\AI Video Tutorial Generator Test Sandbox\Projects\native-restart-and-cancellation-1788608309585-mtob82yi\exports\editor\editor-f1c7f40a6d8f45b7ade9021e816f7895.webm`.
The inspected frame at
`E:\temp\AI Video Tutorial Generator Test Sandbox\Evidence\native-editor-smoke\rendered-frame-at-1s.png`
shows the complete fitted lesson, readable left heading and diagram, current
product credit, and the edited two-line title. Decoded programme audio contains
143,845 mono samples at 48 kHz (2.99677 seconds), peak 0.80386, RMS 0.14094,
and zero clipped samples. The machine-readable acceptance records are
`report.json` and `visual-inspection.json` in that evidence directory. These
package hashes identify the inspected bundle; a later bundle supersedes this
checkpoint rather than silently extending its scope.

Commit `51c6208` removes two neutral-path costs without weakening animated
renders: rotation is omitted only when its base is zero and no rotation
keyframes exist, and per-pixel alpha multiplication is omitted only when opacity
is one and no opacity keyframes exist. RGBA conversion remains so transparent image edges still
composite correctly. On the same canonical source, a single three-second
1280 × 720 VP9/Opus render fell from 9.950763 seconds to 4.634293 seconds
(53.4%). The pre-change output is
`E:\temp\editor-export-neutral-benchmark-before-20260905\exports\editor\editor-f8fe241df72f4dbb8bc32e50bc0f18a6.webm`
(94,081 bytes; SHA-256
`6fd249b756474c9a5e65972e22f879bddc3704ce43570e713ab414b6f48e0be4`);
the optimized output is
`E:\temp\editor-export-neutral-benchmark-after-20260905\exports\editor\editor-e383f68e84c24cce947625c98bc573ec.webm`
(93,154 bytes; SHA-256
`c2d2c852924c716da892c820e1e5a5f872ac1c109c0ff7ac792b5b5f9023cfd5`).
Against the decoded and fitted source, PSNR improved from 26.70434 dB to
47.41778 dB; both decoded PCM streams have SHA-256
`d33dbc4746be241793d7ae885c99083f88683f8400332c31116018387fa0ca0e`.
The single-run fixture is
`E:\temp\editor-export-neutral-benchmark-20260905.py`, with inspected frames at
`E:\temp\editor-neutral-before-frame.png` and
`E:\temp\editor-neutral-after-frame.png`. Eleven focused tests include neutral
and rotated edge decoding plus transparent-PNG compositing.

This accepted short journey does not qualify the required edited three-minute
generated tutorial; that longer native proof remains pending.

## Findings before this pass

The previous editor was a substantial foundation: a seven-track timeline, local reducer history, OTIO-shaped interchange, proposals with provenance and policy previews, and deterministic project adapters. Several controls, however, overstated the implemented behavior or produced incorrect edits.

- An extract across the middle of a long clip shortened the clip and discarded its tail. It did not preserve source continuity.
- A clip could be moved onto a track with a different semantic role by changing its `kind`, for example turning a caption into a slide.
- A media trim could extend beyond the asset's known source duration.
- The canvas chose one last active track, allowing narration, music, or sound effects to mask an active visual.
- Preview elements did not follow timeline source offsets, playback, rate, volume, opacity, transform keyframes, or simultaneous title/caption layers.
- Caption and narration rows duplicated a transcript instead of representing one editable cue relationship.
- Numeric inspector fields committed each keystroke as a separate undo revision.
- Browser import and both export buttons depended on optional application callbacks. In the integrated app those callbacks were absent or notification-only, so no usable file was created.
- Browser blob URLs could be mistaken for durable media references if a document were saved unchanged.
- Generic OTIO external references were discarded unless they carried the editor's private metadata.
- The public shell delivered `onProjectChange` again whenever a parent recreated the callback, which could cause a render loop once persistence was wired inline.
- A visible ripple-mode toggle and pan keyframe control implied editing or preview semantics that were not actually present.

The v1 source and tag show an attractive prototype direction, but they do not supply a durable editing model, media engine, or evidence for current pipeline behavior. Current ADRs make determinism, a 240 kHz canonical timebase, immutable revisions, content-addressed assets, and explicit renderer qualification more authoritative than v1 visual affordances.

## Implemented corrections

The editor now enforces its actual model rather than coercing invalid edits.

- Insert and move reject incompatible track roles and same-track overlap. Trims respect the source asset boundary. Invalid operations leave the project unchanged with a clear reducer announcement.
- Middle extraction creates left and right clips with correct timeline ranges, source offsets, keyframe positions, and unique derived IDs. Ripple deletion remains a separate operation.
- Earlier/later reorder moves a clip to the adjacent edit position. Clips with a shared scene link move together across slide, caption, narration, and title tracks, while locked tracks block the group edit.
- Linked caption and narration text update in one undoable transaction.
- Preview resolves visual, title, caption, and audio layers independently. HTML media follows source time, transport play/pause, playback rate, mute/solo state, and volume. Visual opacity and transform values interpolate from keyframes. Missing scene media renders a structured placeholder instead of claiming generated imagery exists.
- Inspector number inputs commit on blur or Enter. Unsupported pan and ripple-mode controls were removed from the visible interface.
- Browser files can produce real session-scoped image, video, or audio preview assets. Metadata is probed for duration and dimensions, the file is hashed where Web Crypto is available, and owned blob URLs are revoked on failure or teardown. Unsupported caption import is reported as a failed receipt because caption reconciliation belongs to the native caption pipeline.
- Project JSON and OTIO buttons now create actual local downloads without application callbacks. Documents are validated before writing. Browser-only blob URLs are detached before persistence or export, leaving an offline asset record that can be relinked rather than a dead URL.
- Generic OTIO external and missing references become offline assets instead of disappearing. Validation rejects duplicate identities, missing assets, cross-role clips, invalid frame ranges, unsupported implicit retiming, overlaps without a transition model, out-of-range keyframes, and source reads beyond known asset duration.
- `onProjectChange` is stored in a ref and delivered once per new editor revision, making inline parent callbacks safe.
- Playback-rate edits preserve the selected source range while changing timeline duration. Preview and native render use the same source-time relationship.
- Native imports persist image, video, and audio bytes before exposing a playable URI. Generated stage bindings are recovered from verified CAS manifests. A composited scene render takes precedence over stills, retains its exact source interval and programme audio, and suppresses duplicate narration and presenter media.
- A CAS-only render manifest represents trims, ordering, layers, static and animated transforms/opacity, titles/captions, speed, static and animated audio gain, mute, fades, and codec choice. The pipeline validates project identity, project-linked provenance, CAS integrity, and feature support before queuing a durable export job.
- Edited caption cues are reconciled from the same canonical 240 kHz timeline ranges into UTF-8 WebVTT and SRT sidecars. Overlapping cues fail explicitly; sidecars are hashed into CAS and returned with the completed render receipt.
- Audio tracks and composite programme-video clips request a real FFmpeg `showwavespic` derivative from their verified CAS source. The PNG is registered in CAS and indexed by source hash plus bounded width/height profile. Alignment uses the selected `a:0` stream duration, with the container duration used only when that audio stream exists but omits its own duration; silent video is rejected. Timeline display crops the full-source waveform by `sourceRange`, then stretches that selected interval across the edited clip duration, so trims and speed changes remain truthful. Failed or absent analysis renders no waveform rather than synthetic bars.
- Scene-image regeneration now creates a durable, review-first candidate through the approved image route. The active scene remains unchanged until the user accepts the decoded candidate and its rights record; acceptance then binds the verified CAS artifact and invalidates downstream work.

## Current technical direction

### Timeline and interchange

OpenTimelineIO is the correct interchange boundary, not a complete playback engine. OTIO models timelines as tracks containing sequential clips, gaps, and transitions; stacks provide layering; media references keep timeline structure separate from media availability. `source_range` and `available_range` have different meanings. The editor therefore uses explicit gaps on export, preserves source offsets, treats offline media as first-class, rejects overlap until transitions exist, and keeps its richer application document embedded in OTIO metadata for lossless round trips.

The `.otio` export is JSON with OTIO `Timeline.1`, `Stack.1`, `Track.1`, `Clip.2`, `Gap.1`, `ExternalReference.1`, and `MissingReference.1` structures. It has not yet been qualified against every third-party adapter. The product should call it **OTIO export**, not promise interchange with a named NLE until an official OpenTimelineIO parser and target applications are in the automated compatibility matrix.

### Preview and media engine

For the current React shell, HTML media elements are the smallest honest preview path: they can seek to an asset source time, play at the transport rate, and compose with DOM title/caption layers. `requestVideoFrameCallback()` should be used when frame presentation callbacks are added, while `currentTime` and `fastSeek()` must still be treated as approximate browser seeks rather than a frame-accurate decode guarantee.

WebCodecs is a credible future decode layer when accurate frame access becomes necessary. It exposes low-level encoded chunks and decoded frames, supports workers, requires explicit resource lifetime management, and does not provide demuxing, muxing, timeline evaluation, effects, or compositing. A container library such as Mediabunny could fill demux/mux gaps, but adopting an MPL-2 dependency requires a licensing review and performance/codec validation in the packaged Windows WebView. No dependency was added in this pass.

For a native editing engine, GStreamer Editing Services and MLT are the strongest candidates reviewed. Both already model timelines, layered clips, assets/producers, preview, and rendering. GES has explicit project and missing-asset lifecycle APIs. MLT has mature producers, playlists, tractors, consumers, lazy frame evaluation, and preview scaling. Selecting either affects packaging, codec distribution, renderer ownership, and license obligations; it should follow a Windows spike with the repository's real formats and installer, not be introduced implicitly inside the UI.

FFmpeg remains suitable for deterministic final rendering and format work. The native lane resolves verified CAS hashes and compiles one shell-free graph for visual layers, source intervals, speed, static or keyframed transform/opacity, text position/opacity, programme audio, keyframed volume, mute, fades, and mixing. Keyframes use canonical 240 kHz times and the same hold, linear, ease-in, ease-out, and ease-in-out curves as preview. It rejects pan, invalid keyframe property/track pairs, non-centre anchors, invalid media combinations, missing rights, and outputs outside the project export root. FFmpeg is not used for per-scrub preview.

### Editing semantics

Current Kdenlive documentation clearly separates normal, overwrite, insert, ripple, slip, and spacer tools. Blender and Kdenlive both treat proxies as an explicit preview workflow. The product should expose only the semantics it implements and tests. This pass retains lift, ripple delete, extract, split, trim, reorder, snap, speed, undo/redo, and native CAS-derived waveforms. Overwrite, insert-mode ripple, slip, roll, slide, transitions, nested sequences, and proxy selection remain absent from the UI.

### Persistence boundary

The reusable browser bridge validates documents on load and save. It supports session recovery and portable local downloads. Native integration persists the validated editor document through `project.snapshot.save` and uses native history for durable revisions. Browser object URLs remain session-only. Native imports and generated artifacts use `asset.resolve`, which verifies artifact registration, media type, CAS integrity, and path containment before the desktop shell creates a playable URL.

## Current `App.tsx` integration

The application record stores `editorDocument: EditorProject` when an edit exists. The editor prefers that validated document, merges only missing generated bindings into project-derived placeholder assets, and preserves the user's tracks and edits. Otherwise the native app requests `editor.bindings.get` for the selected generation, passes the result as `mediaBindings` to `createEditorProjectFromAlystriaProject`, and resolves its CAS-backed assets before opening.

```tsx
<AdvancedVideoEditor
  key={project.id}
  project={editorProject}
  onImportMedia={importNativeEditorMedia}
  onRenderTimeline={renderEditorTimeline}
  onProjectChange={(editorDocument) => {
    onEditorDocumentChange(editorDocument);
  }}
/>
```

The inline callback is safe because the shell emits only when its reducer revision changes. The app persists the validated document through the native project snapshot path and uses native project history for durable revisions. `onExportProject` and `onExportOtio` remain unset so the real download bridge writes the local files. Native render snapshots the portable document, submits `editor.timeline.export`, records the receipt in the common jobs drawer, polls the existing job-status contract, and accepts the output only after `editorTimelineExportResult()` validates a successful result for the same project. `prepareEditorProjectForPersistence()` removes temporary browser-only preview URLs before the snapshot is saved.

Timeline edits now use a serialized save queue with a 750 ms debounce and
explicit saving, saved, and failure states. Return to scene and timeline export
wait for the latest validated document. Native window close first flushes
general edits, customization, and editor writes, then asks the Rust shell to
stop its worker and exit. A failed flush retains the local edits and keeps the
app open. Editor saves reload the durable head, merge only `editorDocument`,
and retry bounded revision conflicts; their receipts cannot replace unsaved
local prose. Pending documents also survive asynchronous job hydration.

General autosaves separately merge authored prose, creative settings, and
review notes into the current durable snapshot. They preserve newer generation
stages, rendered artifacts, candidates, media imports, customization, and editor
documents. Different generation identities or changes to the immutable scene
set, timing, or type fail visibly. Receipt-only updates no longer schedule a
redundant general autosave. Seven lifecycle regressions and seven approval
regressions pass after this correction. The accepted three-second packaged
journey now confirms immediate-close persistence and reload against a real
native project. The edited three-minute tutorial remains the longer durability
and editing acceptance gate.

### Corrections from packaged acceptance and final source review

An earlier packaged editor completed FFmpeg rendering but failed when attaching
its output to a revision: the delivery and subtitle objects existed in CAS
without artifact-registry rows. Export now registers the output batch atomically
before revision links are created. Sixteen export/service/store regressions
passed, and the accepted short native journey confirms that the corrected
delivery is durably returned from the packaged worker.

Editor bindings now read aligned caption cues from the verified immutable
caption stage. They expose scene-local ticks and the verified renderer's
burned-caption flag, keeping unknown historical flags distinct from false.
The adapter uses short timed cues instead of painting a whole narration
paragraph, avoids synthetic titles over composited lessons, and preserves
explicit saved text edits. Cue offsets survive linked scene reordering;
editing one cue does not replace neighboring cues. Nine backend binding tests
and the complete 235-test desktop suite pass at this checkpoint.

The timeline has explicit Add title and Add caption controls. They insert text
at an available playhead position, fit their default duration within an existing
lesson, respect locked tracks, and participate in undo. Their toolbar wraps in
narrow windows. The accepted short native journey exercises an explicitly added
two-line title through reload and export; the three-minute edit remains pending.

A separate headless browser proof uses the current 960×540 binary-search
delivery (SHA-256 `9910915d5291c78acff8666e089c8976cc711649445de18faa83312d4c9e523e`)
inside the actual editor canvas and timeline. At 760×1100, two inspected
playheads show the correct short cues after scene reorder and source offsets,
one caption element, no synthetic title element, no whole-narration overlay,
and a wrapped toolbar. The preview preserves aspect ratio with `contain` and
an identity transform. Editing guides remain visible in these captures.
Evidence: `E:\temp\alystria-clean-caption-preview-proof-2026-09-05-1700`.
An earlier diagnostic capture used an older composited test clip; it remains
historical timing evidence and is not the current visual-quality reference.

## Gates that remain open

- **Proxy generation:** create, cache, invalidate, and select lower-resolution video proxies based on source hash and preview profile.
- **Frame-accurate preview:** qualify WebView codecs, seeking, audio/video synchronization, and frame callbacks. Adopt WebCodecs or a native engine only after measurable Windows tests.
- **Transitions and overlap:** add an explicit transition schema and renderer support before permitting same-track overlap.
- **OTIO compatibility matrix:** parse exported files with the official OpenTimelineIO library and round-trip through selected current NLE versions on Windows.
- **Timeline-range regeneration:** scene-image candidate generation and explicit acceptance are now implemented, but the editor cannot regenerate an arbitrary selected time range and splice replacement audiovisual media into the timeline.
- **Advanced render parity:** pan, transform rotation/scale for text layers, font-family asset binding, transitions, effects, loudness analysis, proxy media, and independent stems from an already composited generation master remain explicitly blocked or absent.

## Primary and official source ledger

All sources were reviewed on 2026-09-05. The ledger records how each source affected the decision; entries marked “defer” explain why an attractive option was not added.

| Source | Evidence used | Decision |
|---|---|---|
| [OTIO timeline structure](https://opentimelineio.readthedocs.io/en/latest/tutorials/otio-timeline-structure.html) | Tracks are sequential; stacks layer compositions; gaps and transitions are schema items. | Export gaps; reject implicit overlap. |
| [OTIO time ranges](https://opentimelineio.readthedocs.io/en/latest/tutorials/time-ranges.html) | Source and available ranges represent different spans. | Preserve source offsets and enforce available media bounds. |
| [OTIO serialized schemas](https://opentimelineio.readthedocs.io/en/latest/tutorials/serialized-schema.html) | OTIO JSON uses versioned schema labels and metadata. | Keep versioned OTIO objects and lossless private metadata. |
| [OTIO write-to-file adapters](https://opentimelineio.readthedocs.io/en/latest/tutorials/write-to-file.html) | Adapter choice determines actual target interchange. | Label the current file OTIO; defer named-NLE compatibility claims. |
| [OTIO schema API](https://opentimelineio.readthedocs.io/en/latest/api/python/opentimelineio.schema.html) | Clip, track, stack, gap, transition, and media-reference types. | Match core schema roles; preserve missing references. |
| [OTIO algorithms API](https://opentimelineio.readthedocs.io/en/latest/api/python/opentimelineio.algorithms.html) | Flattening and timeline algorithms belong above basic schema serialization. | Keep app edit operations explicit and tested. |
| [OTIO releases](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/releases) | OTIO continues to evolve and adapters change independently. | Pin and test an official parser before compatibility claims. |
| [OTIO supported applications](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/wiki/Supported-Applications) | Application support is adapter/version specific. | Add a future compatibility matrix instead of assuming support. |
| [GES Timeline](https://gstreamer.freedesktop.org/documentation/gst-editing-services/gestimeline.html) | A central timeline owns layers and output tracks. | Candidate native architecture. |
| [GES Clip](https://gstreamer.freedesktop.org/documentation/gst-editing-services/gesclip.html) | Clips can create multiple track elements and have timeline/layer semantics. | Supports grouped scene-media thinking. |
| [GES Asset](https://gstreamer.freedesktop.org/documentation/gst-editing-services/gesasset.html) | Assets are discoverable resources separate from clips. | Keep asset IDs separate from timeline instances. |
| [GES Pipeline](https://gstreamer.freedesktop.org/documentation/gst-editing-services/gespipeline.html) | One pipeline can preview and render a timeline. | Candidate for a Windows spike; defer adoption. |
| [GES Project](https://gstreamer.freedesktop.org/documentation/gst-editing-services/gesproject.html) | Project load handles assets and missing-uri recovery. | Require an explicit relink lifecycle. |
| [GES Layer](https://gstreamer.freedesktop.org/documentation/gst-editing-services/geslayer.html) | Layers manage priority and clips; overlap semantics are explicit. | Avoid accidental overlap in the simpler current model. |
| [MLT framework overview](https://www.mltframework.org/docs/framework/) | Producers, playlists, tractors, filters, transitions, and consumers form an NLE engine. | Candidate native architecture. |
| [MLT XML](https://www.mltframework.org/docs/mltxml/) | A serial timeline representation can drive the engine. | Compare against OTIO-plus-renderer in a future spike. |
| [MLT preview scaling](https://www.mltframework.org/docs/preview-scaling/) | Preview resolution can differ from render resolution. | Require explicit proxy/preview profiles. |
| [FFmpeg filter documentation](https://ffmpeg.org/ffmpeg-filters.html) | Trim/atrim, concat, transforms, and audio filters support final composition. | Continue using FFmpeg-class tools for render, not per-scrub state. |
| [FFmpeg formats documentation](https://ffmpeg.org/ffmpeg-formats.html) | Demuxing/muxing and concat have format-specific constraints. | Validate actual codecs and containers at render boundaries. |
| [W3C WebCodecs](https://www.w3.org/TR/webcodecs/) | Low-level codecs expose frames/chunks, workers, support queries, and explicit cleanup. | Future accurate preview option; defer until packaged-WebView qualification. |
| [WebCodecs codec registry](https://www.w3.org/TR/webcodecs-codec-registry/) | Codec identifiers and registrations are separate from API availability. | Probe each required codec rather than treating API presence as support. |
| [W3C Media Capabilities](https://www.w3.org/TR/media-capabilities/) | Decode queries report support, smoothness, and power efficiency. | Add capability probing before enabling high-resolution previews. |
| [MDN requestVideoFrameCallback](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback) | Callback follows presented video frames and exposes timing metadata. | Preferred browser frame-presentation hook. |
| [MDN HTMLMediaElement currentTime](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime) | Setting time seeks media, with browser precision constraints. | Use for current preview and avoid frame-accuracy claims. |
| [MDN HTMLMediaElement fastSeek](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/fastSeek) | Fast seeking trades precision for speed and is not universal. | Do not use for exact trim-boundary proof. |
| [MDN createMediaElementSource](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaElementSource) | Media elements can feed a Web Audio graph. | Future richer browser audio monitoring path. |
| [MDN StereoPannerNode](https://developer.mozilla.org/en-US/docs/Web/API/StereoPannerNode) | Browser pan requires an audio graph, not an element property. | Remove the unsupported pan control. |
| [MDN createObjectURL](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static) | Blob URLs provide local object access and require lifecycle management. | Own and revoke browser preview URLs. |
| [MDN revokeObjectURL](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static) | Object URLs must be released to avoid leaks. | Revoke on failed probe and shell teardown. |
| [MDN File API](https://developer.mozilla.org/en-US/docs/Web/API/File_API) | File objects can be selected and read locally in the browser. | Provide a browser File-to-preview fallback. |
| [MDN showSaveFilePicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker) | The picker is limited-availability and secure-context dependent. | Use standard Blob-anchor downloads as the baseline. |
| [Kdenlive editing documentation](https://docs.kdenlive.org/en/cutting_and_assembling/editing.html) | Normal, overwrite, insert, and timeline operations have distinct semantics. | Expose only implemented edit modes. |
| [Kdenlive proxy clips](https://docs.kdenlive.org/en/project_and_asset_management/project_settings/proxy_settings.html) | Proxy rules are project-level and profile driven. | Require an explicit proxy/cache subsystem. |
| [Kdenlive tool menu](https://docs.kdenlive.org/en/user_interface/menu/tool_menu.html) | Selection, razor, spacer, slip, ripple, and multitrack tools are separate. | Keep current operation names precise; gate absent tools. |
| [Kdenlive media menu](https://docs.kdenlive.org/en/user_interface/menu/clip_menu.html) | Clips expose reload, replace, proxy, waveform, and media management. | Native relink/proxy lifecycle remains required. |
| [Kdenlive features](https://kdenlive.org/features/) | Production NLEs combine multitrack editing, scopes, proxies, subtitles, and effects. | Use as completeness reference, not as a promise for this app. |
| [Blender Video Sequencer manual](https://docs.blender.org/manual/en/latest/video_editing/index.html) | A mature sequencer separates setup, preview, sequencer, audio, and editing concerns. | Keep editor state separate from decode/render implementation. |
| [Blender video editing features](https://www.blender.org/features/video-editing/) | Waveforms, speed control, adjustment layers, transitions, and proxies are explicit features. | Gate each until modeled and rendered. |
| [Blender proxy setup](https://docs.blender.org/manual/en/latest/video_editing/edit/montage/strips/properties/proxy.html) | Proxy sizes and timecode indices affect preview behavior. | Include timecode/index policy in the future proxy spike. |
| [Mediabunny repository](https://github.com/Vanilagy/mediabunny) | A TypeScript media toolkit can demux/mux around browser codecs; project is MPL-2.0. | Promising browser spike; defer dependency and licensing choice. |

## Verification evidence

September 7 full-length preparation found that the native project record still
held planned durations while narration had produced different scene windows.
New editor documents now derive contiguous frame intervals from the verified
master boundaries. Reopening a trimmed composite preserves its local trim
instead of adding the master offset again. Promoting different media clears
the old URI and preview references before resolution by the new CAS hash.
The focused adapter suite passed 16 tests and desktop TypeScript passed after
these corrections. Native full-length verification remains pending at this
source checkpoint.

The subsequent preview audit corrected text that always appeared at the bottom
despite a top placement in the export. Preview now scales authored pixel offsets
and text sizes to the visible canvas, follows native top/center/bottom and
left/center/right anchors, respects colors and background panels, and retains
explicit line breaks without promising automatic export wrapping. Windows
export uses Arial; custom font assets remain unsupported. Playback only corrects
drift above 100 ms with a 750 ms cooldown instead of seeking on every transport
tick. The focused editor suite passes 54 tests, with TypeScript, ESLint, and the
production build passing under Node 24. Six inspected browser captures at
776 × 436.5 and 696 × 391.5 canvas sizes match the intended anchor equations
within one pixel. Real WebM playback advanced to 0.817 seconds with two seek
writes, including initial synchronization. Evidence is in
`E:\temp\avt-audit-2026-09-05\editor-preview-parity`. This does not qualify
frame-accurate seeking or pixel-identical font metrics in the packaged app.

The later imported-video audit corrected a preview/export mismatch: slide and presenter source audio now follows the same track mute/solo and clip-mute policy in both paths. The inspector exposes source gain and mute, and audible gain automation is retained. Native export probes each verified source before referencing its audio stream, so a silent video remains a valid visual input and produces an explicit warning instead of an invalid FFmpeg graph. Both media inspection and export use hidden Windows subprocesses. The updated editor suite passes 50 tests; the subsequent focused source-audio/manifest run passes 15, and nine Python export/service tests include actual audio-bearing and silent-video renders plus a Windows process-flag regression. The accepted short packaged journey now confirms real import, reload, programme-audio playback, waveform analysis, and VP9/Opus export for an audio-bearing WebM.

Focused reducer, adapter, browser bridge, manifest, native bridge, waveform, and React interaction tests cover trim limits, cross-role moves, source-preserving extract, linked reorder, transcript edits, speed, undo/redo, binding precedence/source intervals, saved-document binding merges, programme audio preservation, reviewed generated-asset provenance, durable import, downloads, document validation, OTIO references, job-result validation, waveform source cropping, and callback delivery. Before the source-audio additions above, the editor suite passed 47 tests; desktop TypeScript and editor ESLint also passed. Focused pipeline tests covering render dispatch, bindings, imports, asset resolution, and waveform derivation pass, with Ruff and strict Mypy clean. The waveform proof uses a known two-second PCM source with silence followed by a 220 Hz tone, verifies that the signal half has over eight times the plotted peak pixels, proves the audio-stream duration wins over a longer container duration, rejects silent video, and proves the source-hash/profile cache is reused unchanged. A checked-in real pinned-FFmpeg test produces a VP9/Opus delivery from CAS-bound video, decodes ten output frames, verifies animated x/scale/rotation/opacity at the first, middle, and last frames, detects rendered title and caption pixels, confirms preserved source audio, and validates the matching WebVTT/SRT caption cues. The accepted short packaged Windows/WebView evidence is recorded above; only the edited three-minute tutorial remains outside this editor acceptance scope.
