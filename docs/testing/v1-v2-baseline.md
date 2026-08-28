# V1 to V2 evidence baseline

This baseline compares only properties that the preserved artifacts can prove.
It does **not** claim that the current v2 fixture teaches better than v1, meets
the planned blind-review threshold, or wins nine subjective dimensions. The v1
demos cover thermodynamics, reaction rates, and quantum/physical properties;
the v2 canonical fixture covers Karatsuba multiplication. V1 retained no input
prompt, script, transcript, sources, provider metadata, storyboard, captions,
or reproducible generation settings, so a content-matched rerun is not
available.

## Material examined

The three v1 files were downloaded from the historical release links and match
`legacy/v1/DEMO_BASELINE.json`:

| Demo | MP4 SHA-256 | Duration | Streams |
| --- | --- | ---: | --- |
| `quick` | `225586a66baaf9bb33f0656aa902c4e8291e762c47089cc1ab504afbe6f633fb` | 88.833 s | H.264 1920x1080; no audio or subtitle stream |
| `full-a` | `e9866d7e74e4d5605da669c900af53af0315e941d90b275eb01e70b422cb4aa2` | 298.360 s | H.264 852x480; AAC 44.1 kHz stereo; no subtitle stream |
| `full-b` | `fd3392a25d190d5f43bda8daac94abce00c17198f0b6a8b9f2e1f2fe0d2798c6` | 133.600 s | H.264 852x480; AAC 44.1 kHz stereo; no subtitle stream |

FFmpeg extracted frames at 25%, 50%, and 75% of each duration. These ignored
files live under `dist/evaluation/v1/samples`:

| Sample | PNG SHA-256 | Pixel observation |
| --- | --- | --- |
| `quick-25` | `39a927044d6278d774837cd1a55a1bfa3662b432a3bb6c0270625e8b39ec0e99` | Screen recording of v1 settings; cursive labels and low-contrast glass styling, not tutorial output. |
| `quick-50` | `ad668d534223140c6272c4c06437a132331eb06e48765352d2d17d3951798aff` | Presenter beside a static NASA thermodynamics page; text is present but source/provenance is not visible. |
| `quick-75` | `2ce75003efa946f95a1928eceeb3192ae430eeaff1259e094be1acd95c41ffc9` | Presenter covers the lower-right of the main image and clips the large `QUANTUM COMP...` text. |
| `full-a-25` | `75770f17efde067cd84cb85cc53ded487ed288e49aac94127b159d6bbb7d5c7f` | Unlabelled stock match image beside a presenter; no visible caption or citation. |
| `full-a-50` | `3f52537411e4ab27b3f02901f5b17fea401efda713ce62f70f8b67fddc0182b3` | Presenter obscures the lower-left answer choices in a reaction-rate graphic. |
| `full-a-75` | `2ee7b2715652ec4ba1b4a019384ad72754b70e2585910629d1822a352089e2f2` | Presenter obscures part of the heat-transfer diagram and its labels. |
| `full-b-25` | `c01d8fdbf8cd2f68e342c14bc94249c92fe539b98364c33cc9c02bac388c7b36` | Presenter obscures the lower-right hydrogen-wave-function diagram. |
| `full-b-50` | `921730a9ae58e3af6549e0335d5c3560f5a59f204045836f0547b8ff44e6af58` | A low-resolution properties slide is tiled nine times; most text is too small to read and one tile is covered. |
| `full-b-75` | `852c94582d95594cc46855487b324fa380c0298eb7955ea86507481334929ebb` | Presenter covers the `Horizontally-polarized` label on an otherwise readable diagram. |

V1 audio was probed rather than judged by ear. `full-a` measured -25.1 dB mean
and -6.4 dB maximum; `full-b` measured -25.7 dB mean and -7.7 dB maximum using
FFmpeg `volumedetect`. Those numbers establish signal level only. They do not
prove narration clarity, naturalness, synchronization, or absence of local
clicks.

The v2 lane was run with:

```powershell
services\pipeline\.venv\Scripts\python.exe scripts\run-canonical-evaluation.py
```

It created a temporary project, blocked pipeline network access, used the
deterministic local media and renderer clients, paused after preapproval,
recorded the unapproved payload, approved through a named revision, ran all
sixteen stages, verified 28 CAS objects and 17 generation revisions, required a
passing final QA gate, and round-tripped `karatsuba-canonical.alytutorial`.
Normalized outputs and hashes are committed under
`fixtures/generated/karatsuba`; bulky run artifacts remain ignored under
`dist/evaluation/v2/karatsuba`.

## Objective rubric

| Criterion | V1 evidence | V2 evidence | Evidence-backed result |
| --- | --- | --- | --- |
| Reproducible inputs | Downloaded MP4 hashes are stable, but generation inputs and settings were not retained. | Fixed fixture/source hashes, seed 1962, blocked pipeline network, deterministic clients, and checked normalized output hashes. | V2 has a reproducible generation lane; v1 has only reproducible playback artifacts. |
| Evidence and provenance | No retained sources, claim links, licenses, provider/model record, or generation manifest. | Three claims link to immutable source chunks; the source is cleared CC0; the export and provenance summaries record provider/model/renderer/seed. | V2 provides machine-inspectable traceability. This does not independently prove that every explanation is pedagogically ideal. |
| Durable editing history | No project database, approval snapshot, artifact graph, or restorable revision history. | Explicit preapproval payload, approval revision, per-stage revisions, CAS verification, and archive import verification. | V2 proves durable project state and a recoverable portable archive. |
| Caption delivery | ffprobe found no subtitle stream in any v1 demo. | The representative v2 delivery contains WebVTT and also emits VTT/SRT sidecars from the canonical cue data. | V2 has verifiable caption delivery for the sample. Caption reading speed and full 12-minute coverage remain future evaluation work. |
| Sampled visual legibility | Six of nine sampled frames contain obvious presenter/content occlusion or unreadable tiling; one additional sample is the settings UI rather than output. | An initial 640x360 draft exposed a title/body collision and was rejected. After correction, frames 0, 15, 30, 45, and 59 show no clipping or essential-content collision. The active caption covers only nonessential footer metadata. | The short v2 sample is objectively cleaner at the inspected instants. Five frames cannot establish full-project or transient-motion quality. |
| Media structure | Mixed resolutions; two AAC 44.1 kHz audio tracks; no subtitle streams; `quick` has no audio stream. | 640x360 VP9 at 15 fps, Opus 48 kHz mono, embedded WebVTT, Rec.709/sRGB tags, and 4.008 s duration. | V2 sample passes the renderer's structural probe. Different delivery codecs are not a quality ranking. |
| Measured v2 audio safety | No comparable PCM master was retained. | 24-bit/48 kHz mono master, 4.0 s, peak 0.245333, RMS 0.173185, zero clipped samples, non-silent. | The deterministic tone is structurally safe and measurable. It is deliberately not natural speech, so voice quality is unscored. |

The inspected v2 delivery SHA-256 is
`f2a5592e6a39340a36f49b96a95e4bfddfb3910ea74562079b08116b82e30756`;
its PCM master SHA-256 is
`c0efe558f47bac03b75c4164eaab9c12e9055b113666c781bdea713fb950211c`.
The renderer used the pinned development Chromium hash
`409805a16d6416087e6b2f778df1cf8f7bbb267d6b99f6b5bb0a618eace234f2`
and local FFmpeg runtime recorded in `media-measurements.json`.

## Claims deliberately not made

- No blind reviewers scored either version.
- No content-matched v1 and v2 tutorial pair exists.
- The four-second v2 sample does not prove the full twelve-minute Karatsuba
  quality target, all scene families, or all aspect ratios.
- Deterministic sine narration proves the audio/render path, not TTS
  naturalness, pronunciation, ASR WER, or lip sync.
- The current evidence therefore cannot establish the planned mean score of
  4/5, a nine-dimension win, or an overall learning-quality release gate.

Those claims require a content-matched fixture, full render, transcripts,
source-aware factual review, real narration, and blinded human scoring.
