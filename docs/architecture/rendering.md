# Deterministic rendering

## Canonical model

Alystria stores typed scene data, never executable renderer source. The canonical renderer is frame-driven React/DOM/SVG with Canvas or WebGL isolated to scene types that require it. Preview and final output use the same scene components and the same compiled layout. Remotion may be an optional adapter, but it is not required by the MIT core; its [license and pricing](https://www.remotion.dev/docs/license/pricing) must be reviewed before any optional integration is enabled.

The renderer may read only the compiled manifest, local hash-addressed assets, packaged fonts, explicit frame/tick position, and deterministic seed. It must not use wall clock, remote URLs, unseeded randomness, autonomous CSS animation, locale-sensitive host defaults, or host-installed fonts.

## Timebase

The project timebase is 240,000 ticks per second. It exactly represents common video frame rates and 48 kHz sample positions. Scene boundaries, narration spans, captions, animation keys, and presenter cues use integer ticks. Conversion to a target frame index is rational arithmetic with an explicitly defined rounding rule; cumulative floating-point time is forbidden.

## Scene compilation

Semantic scenes compile separately for landscape, portrait, square, and custom targets. Compilation resolves typography, safe areas, reading order, caption exclusion zones, presenter placement, chart/diagram layout, reduced-motion alternatives, and target-specific choreography. A portrait result is a reflowed layout, not a crop of landscape output.

Built-in families include title, section introduction, definition, bullets, comparison, diagram, timeline, formula/derivation/graph, code/walkthrough/diff/file tree/terminal/execution trace/variable state, chart/table/map, image focus/comparison, highlighted document, UI demonstration/screen recording, simulation, presenter, presenter with slide, quote, question, worked example, quiz, recap, summary, sources, and outro.

Deterministic graphics are preferred for exact text, math, code, data, diagrams, and timelines. Licensed or user evidence is preferred for real people, events, places, interfaces, and documents. Generated imagery is appropriate for conceptual illustration; generated motion is reserved for explanations that materially benefit from it. A presenter is sparse by default.

## Rendering pipeline

```text
semantic scene
→ target-specific compiled scene
→ validated render manifest
→ pinned Chromium frame capture
→ lossless scene mezzanine
→ FFmpeg assembly and audio mix
→ delivery encode
→ stream, timing, accessibility and rights validation
```

Pinned Chromium produces authoritative frames. Scene mezzanines use lossless RGB FFV1 in Matroska so unchanged sections can be reused without generational loss. FFmpeg/ffprobe performs media probing, assembly, audio mixing, EBU R128 loudness normalization, final codec conversion, and stream validation. See [FFmpeg](https://ffmpeg.org/ffmpeg.html), [filters](https://ffmpeg.org/ffmpeg-filters.html), and [licensing](https://ffmpeg.org/legal.html).

Standard output is sRGB/Rec.709 SDR. HDR is outside 2.0 core. H.264 uses available platform/hardware encoders. An optional, separately installed, signed GPL runtime pack may provide x264; it is never silently bundled with the MIT application.

## Captions and audio

WebVTT is canonical; SRT, styled burn-in captions, transcripts, descriptive transcripts, and optional audio-description tracks are derived from the same cue model. See [WebVTT](https://www.w3.org/TR/webvtt1/). Caption layout defaults to two lines, semantic phrase boundaries, audience-appropriate reading speed, collision-aware positioning, and no obstruction of essential visuals.

Provider-original speech is preserved, while the working stem is lossless 48 kHz. The standard master target is −16 ±1 LUFS and no more than −1.5 dBTP. Music and effects default off; enabled beds duck under speech and must have export-cleared rights.

## Render invariants

- Every frame is identical for identical inputs in the canonical environment.
- Unchanged scene object hashes and compiled manifests produce byte-identical mezzanines.
- Audio/video duration differs by no more than one target frame.
- No blank frame, invalid stream, clipped sample, missing glyph, caption collision, safe-area overflow, or unresolved asset placeholder passes final QA.
- Reduced-motion rendering uses authored alternatives rather than disabling time-dependent meaning.
- Final export is blocked by missing attribution, unknown/restricted rights, expired consent, or unsupported critical claims in Strict mode.

## Performance reporting

Benchmarks report preview latency, frames rendered per second, peak system/VRAM use, scene-cache hit rate, and export wall time. Each result records power mode and CPU boost state. Correctness and visual acceptance tests may run in silent mode with boost disabled; their numbers must not be represented as peak hardware capability.
