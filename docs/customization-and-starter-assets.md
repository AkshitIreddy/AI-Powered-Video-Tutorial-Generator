# Customization and starter assets

Alystria treats customization as structured project data, not arbitrary CSS, React, shell commands, remote URLs, or renderer code. The starter-kit manifest is the inventory and rights boundary for built-in, optional local, generated, and user-supplied assets.

The canonical contract is `packages/contracts/schema/starter-kit.schema.json`; the built-in catalog is generated as `packages/themes/starter-kits/core.v1.json`. TypeScript, Python, and Rust apply the same critical invariants: referenced assets must exist and have the correct kind, file-backed assets must be hash-bound, render-time network access is forbidden, unknown rights block export, planned assets cannot masquerade as exportable media, and every first-party theme has a complete pack.

## Customization surface

The intended editor exposes controls in layers so beginners can choose a complete pack while advanced users can tune individual scenes.

| Area | Project-level choices | Scene-level choices | User content |
|---|---|---|---|
| Theme and brand | theme pack, brand kit, palette, density, corner/shadow language, concept-thread motif | per-scene theme or contrast override | logo, brand marks, palette tokens, data-only lower-third and caption presets |
| Typography | display, heading, body, utility, code, math, caption families; weights; scale; line height; tracking | emphasis role, measure, alignment, responsive size override | sanitized TTF, OTF, WOFF, or WOFF2 with embedding/redistribution rights |
| Backgrounds | default still, procedural field, texture, loop, gradient policy, text-safe-zone behavior | crop, focus point, fit, opacity, blur, grading, parallax/reduced-motion fallback | high-resolution images or short loopable video |
| Overlays and composition | texture, frame, semantic concept thread, figure margin, signal trace, working marks | mask, blend, intensity, anchors, occlusion exclusions | transparent image overlays or closed token presets |
| Motion | tempo, easing family, transition set, maximum simultaneous motion, reduced-motion policy | entrance, emphasis, exit, choreography, stagger, continuity anchor | data-only transition presets; executable animation code is not accepted |
| Presenter | visual style, supplied portrait, provider/local model profile, placement, framing, maximum coverage, backdrop, disclosure | usage moment, direction, gesture cue, eyeline, matte, crop, lower third | synthetic portraits, consented real-person portraits, consented presenter clips |
| Narration | provider/model profile, voice, locale, pace, energy, emotion, pronunciation dictionary | speaker, delivery, emphasis, pauses, aliases, timing policy | owned recordings and pronunciation lexicons |
| Music | off/on, track, stem/loop, gain, ducking, fade policy, section variation | cue in/out, intensity, beat alignment, hold/replace | owned or licensed WAV, FLAC, MP3, or M4A |
| Sound effects | off/on, effect palette, bus gain, density, semantic-only policy | cue, variant, gain, pan, pitch range, caption label | owned or licensed one-shots, ambiences, and transition cues |
| Captions | font, size, position, panel, speaker labels, SDH style, reading-rate target | cue correction, line break, collision override, emphasis | closed JSON style preset; captions remain derived from canonical cues |
| Images and evidence | treatment, border/mat, grading, attribution rail, crop policy | crop/focus, callout, comparison, source label | original work, licensed media, generated images, scans, screenshots |
| Diagrams and data | node/connector language, chart palette, grid, annotations, map style | layout pins, scales, labels, highlights, animation order | CSV/JSON data, validated Vega-Lite, sanitized SVG |
| Code and terminal | syntax theme, font, line-number and focus policy, window chrome | highlighted ranges, trace timing, variable panels | source files, inert terminal transcript, sandboxed examples |
| Audio mastering | loudness target, true-peak ceiling, stereo policy, audio-description track | per-scene gain, cleanup, room-tone policy | narration, effects, music, ambience, descriptions |
| Export identity | aspect-ratio layout variants, intro/outro, watermark, credits, thumbnail language | responsive overrides and safe areas | thumbnails, bibliography copy, metadata, cover art |

All customization is revisioned. Changing a font invalidates layout and render artifacts, but not research or narration. Changing music invalidates only mix, audio QA, and final composition. Changing a presenter portrait invalidates presenter generation, affected scene renders, presenter QA, and final composition. The regeneration sheet must show this impact before work begins.

## What is usable now

The core catalog describes ten coordinated theme packs and includes:

- deterministic procedural backgrounds, overlays, transitions, lower thirds, and caption styles that can render without external files;
- fourteen OFL-licensed local font families, with renderer-safe fallbacks and no remote font fetches;
- twelve presenter direction styles, including voice-only and user-supplied modes;
- fifty-two bundled fictional synthetic presenter portraits, of which forty-six are in the curated picker, plus three bundled theme backgrounds; every file is bound to its exact bytes by SHA-256 and records its available generator, synthetic-origin, C2PA, owner-rights, and license evidence;
- explicit presenter filters for realistic, anime, cartoon, illustration, character, and animal designs; the featured gallery begins with Emma, Yuki, Noah, and Chloe while retained portrait IDs continue to open existing projects;
- two seamless music loops, four intro/outro stingers, and ten semantic sound-effect variants; all sixteen are deterministic 48 kHz/24-bit PCM masters, hash-bound, verified, MIT-licensed, and authored without third-party samples or generative AI;
- separate import slots for backgrounds, overlays, fonts, music, effects, synthetic portraits, real-person portraits, presenter video, logos, lower thirds, and caption styles.

Music and sound effects remain off by default. Enabling them is an explicit project choice, narration ducking remains active, meaningful sounds receive caption labels, and any asset with unknown or pending rights blocks export.

Static portrait readiness and lip-sync readiness are separate. A verified portrait can be selected, placed, and exported as a still image while its animation compatibility remains under review. The app must only advertise or route lip-sync when the exact portrait and runtime combination has passed the relevant runtime check; the fourteen casual, character, and animal portraits added on 2026-09-20 remain explicitly pending until that qualification is recorded.

## Presenter imports and consent

Synthetic and real-person portraits use separate import slots. A synthetic portrait needs origin and generation provenance but not human likeness consent. A real-person portrait or clip requires immutable consent that covers the selected operations—such as portrait animation, lip-sync, likeness generation, and distribution—and the app must enforce the required synthetic-media disclosure. User-supplied media is quarantined, decoded outside the privileged UI, normalized to sRGB/Rec.709, stored in the project CAS, and referenced by hash rather than its original path.

## Adding shipped media safely

Adding or replacing shipped audio or images requires all of the following in one change:

1. Put the reviewed local file in the starter asset bundle.
2. Record its byte size and SHA-256 in the catalog.
3. Record delivery/status as `bundled-file` and `ready` only after the media and integrity checks pass.
4. Record creator, origin, creation method, source/model revision, prompt evidence where relevant, ingredient assets, and C2PA state.
5. Record a precise license expression, restrictions, attribution, redistribution, commercial-use, derivative, and export decisions.
6. Add accessibility description or sound label and technical normalization data.
7. Run schema, semantic, integrity, media-probe, visual/audio, license, and export-gate tests.

An absent file, stale hash, pending license, remote render dependency, unreviewed real-person consent, or unknown provenance keeps the asset out of an exportable default.
