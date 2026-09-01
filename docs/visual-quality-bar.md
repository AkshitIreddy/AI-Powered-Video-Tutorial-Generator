# Tutorial visual-quality acceptance bar

This specification is a release gate for rendered tutorials. It exists to prevent a technically valid export from passing when it still looks like an application dashboard, a slide template, or debug output. Schema validity, deterministic hashes, successful encoding, and automated layout checks are necessary but are not visual acceptance.

The requirements below apply to preview, scene mezzanines, final delivery video, thumbnails, and the English, Spanish, and Hindi canonical fixtures. “Must” and “must not” are release-blocking. Any exception must be attached to the affected scene as a reviewed, target-specific waiver with a rationale and screenshot; a project-wide waiver is invalid.

## Required review evidence

Each candidate render must produce one review packet per target and locale:

1. A clean delivery master, subtitle sidecars, and the exact render manifest and theme revision.
2. A contact sheet containing the opening, closing, and at least one peak-information frame from every scene. Animated explanations must also include frames immediately before, during, and after their principal transformation.
3. Full-resolution stills for every distinct scene family, every presenter composition, every caption-placement region used by an open-caption export, and every automated warning.
4. A scene ledger recording semantic intent, composition family, focal anchor, information-unit count, on-screen word count, continuity key, target, locale, and any waiver.
5. A full-speed playback review with sound, followed by a silent playback review. The silent pass tests visual intelligibility; it does not require visuals to duplicate narration.

Review evidence is invalid if it comes only from the DOM, component stories, layout boxes, unit tests, or a scaled-down preview. A reviewer must inspect the authoritative pinned-Chromium frames at delivery resolution and watch the encoded output from beginning to end.

## Immediate rejection conditions

One occurrence of any item below fails the candidate unless the scene type inherently requires it and the reviewer records why:

- Application chrome presented as tutorial art: navigation rails, toolbar-like headers, inspector panels, status pills, card grids, fake window frames, generic metric tiles, or a permanent top/bottom information band.
- A generic rounded rectangle around every idea, or three or more visually interchangeable cards used as the primary composition.
- Narration pasted into a centered paragraph, bullet list, or subtitle-like text block. On-screen prose may quote a source or show a necessary instruction, but it must be deliberately typeset and readable within the allotted time.
- A frame with no clear first-look focal point, multiple elements competing at equal weight, or decorative texture that reduces figure/ground separation.
- Text crossing its container, safe area, image crop, presenter, citation marker, or another text block; orphaned headings; visibly unbalanced centering; inconsistent baselines within a row; or a one-word final line caused by avoidable measure.
- Default browser controls, unresolved placeholders, missing glyphs, stretched media, visibly low-resolution assets, or unlicensed watermarks.
- A crop that removes a face, hand gesture, equation term, code cursor, diagram endpoint, chart label, document evidence, or other essential content.
- A transition, zoom, bounce, glow, or parallax effect that decorates the scene but does not direct attention, communicate a relationship, preserve continuity, or mark a semantic change.
- Three consecutive scenes with the same composition family, or two consecutive scenes that are materially the same arrangement with only text substituted.
- Burned-in captions in a standard export when the user selected the default caption policy.

## Frame composition and alignment

### Grid and safe regions

- Every target must compile its own layout. Portrait and square outputs must reflow; they must not crop a landscape composition.
- Essential content must remain inside a target-safe inset of at least 5% of frame width and 5% of frame height. Platform overlays, open captions, and known player controls require an additional authored exclusion region.
- A composition must use a declared alignment system: a 12-column grid, a deliberate object-stage axis, or an equivalent scene-specific geometric construction. Arbitrary offsets without a shared edge, axis, or optical rationale fail review.
- Text blocks that are meant to align must share an exact edge or baseline. Elements intended to be centered must be optically centered, accounting for asymmetric shapes and glyphs, not merely assigned the same numeric midpoint.
- The focal object, not a decorative container, receives the strongest contrast. Backgrounds must support subject separation at every sampled frame.

### Typography

- Each scene may use no more than three active text roles: display/title, explanatory/label, and technical/meta. Citation markers and code syntax are not additional roles when they inherit the technical system.
- Body and explanatory copy must be left aligned in left-to-right locales unless a scene-specific reason requires another alignment. Multi-line centered paragraphs are forbidden.
- A line must contain approximately 45–75 Latin characters at reading size. Short labels may be narrower. Spanish reflow must be tested rather than scaled down to fit. Hindi must use authored Devanagari line breaking and may not be forced through Latin character-count heuristics.
- Font size may not be reduced below the target's approved reading token to repair overflow. The compiler must reflow, shorten derived display copy, split the beat, or choose another composition.
- Display, body, code, math, and captions must use packaged fonts with complete required glyph coverage. Synthetic bold/italic and host-font fallback are prohibited in authoritative output.
- Text contrast must meet WCAG 2.2 AA: at least 4.5:1 for normal text and 3:1 for large text. Color may not be the only carrier of comparison, status, sequence, or emphasis.

## Visual-beat contract

Every scene must declare one primary semantic intent (`establish`, `define`, `compare`, `transform`, `demonstrate`, `prove`, `emphasize`, `question`, `resolve`, or `recap`) and one primary composition family (`full-bleed`, `editorial-type`, `object-stage`, `diagram`, `split-evidence`, `document-focus`, `data-canvas`, `worked-example`, `presenter`, or `cinematic-scale`). It must also identify its focal anchor, continuity key, essential information units, motion intent, reading order, and avoid regions.

The visual director and QA gate enforce these rules:

- One beat has one instructional focus. A frame may contain supporting context, but no more than three simultaneously competing information units.
- The focal anchor must be identifiable from a single frame and must remain stable or transition intentionally throughout the beat.
- New information is revealed when narration introduces it. Completed state may remain as context, but future steps may not appear merely because layout space is available.
- Motion must implement a named instructional action such as reveal, trace, transform, compare-shift, focus, or continuity match. Timing changes alone do not justify motion.
- In every rolling five-scene window, at least three composition families must appear. A continuous worked example may repeat a family only when its continuity key is unchanged and its state visibly advances.
- A single project-wide surface treatment may unify the tutorial, but scene families must not collapse into one reusable card layout. Variety comes from explanatory structure, not random styling.
- A presenter is an intentional beat, not persistent wallpaper. Presenter framing must preserve eye line, natural crop, clean subject separation, and enough adjacent space for the one visual the presenter is discussing.

## Narration and on-screen text

Narration and visuals must be complementary. A reviewer must be able to state what the picture contributes that the audio alone does not, such as spatial relation, exact notation, state change, comparison, evidence, or continuity.

- On-screen text must be distilled from the lesson model into titles, terms, values, labels, relationships, code, equations, evidence excerpts, or short prompts. It must not default to a transcript excerpt.
- A narrated sentence may appear verbatim only when exact wording is itself the subject: a quotation, definition under analysis, command, code, formula, legal wording, or source passage.
- Labels must sit next to the object or relation they describe. Legends separated from a simple object by avoidable eye travel fail spatial-contiguity review.
- A viewer must receive enough time to read essential text. Reading time is measured on the final target and locale, not inferred from narration duration.
- When content does not fit cleanly, split the beat or change composition. Shrinking the type, adding scroll-like UI, or placing the content inside another card is not an acceptable repair.

## Scene-family acceptance criteria

| Family | Must communicate visually | Fails when |
|---|---|---|
| Title / section / outro | Clear hierarchy, tone, subject, and one memorable visual premise | It is a logo plus centered subtitle on an interchangeable gradient |
| Definition / concept | Term-to-meaning relationship and a concrete anchor, example, or boundary | It is a paragraph in a card or a dictionary layout with no explanatory visual |
| Comparison | A common baseline, directly comparable dimensions, and an explicit conclusion | Items float in unrelated cards, scales differ silently, or the conclusion exists only in narration |
| Diagram / timeline / map | Direction, grouping, labels adjacent to targets, and progressive emphasis | Connectors cross ambiguously, labels drift, the full finished diagram appears before explanation, or geography is decorative |
| Formula / derivation / worked example | Persistent state, exact substitutions, aligned operators, and a visible causal step | Equations jump between locations, intermediate terms disappear prematurely, or the answer appears without the transformation |
| Code / trace / terminal | Legible code, stable line numbers, current focus, state changes, and output causality | It resembles an editor screenshot without teaching focus, scrolls too quickly, or syntax decoration outranks the active line |
| Data / chart / table | Honest scale, direct labeling, units, source context, and the comparison the narration claims | It uses ornamental charts, unexplained axes, 3D distortion, tiny legends, or animation that changes scale |
| Evidence / document / image | Source identity, meaningful crop, evidence highlight, and rights-cleared asset quality | It shows a generic stock image, an unreadable full page, or a highlight that does not match the claim |
| UI demonstration / recording | Exact interaction target, cursor/focus continuity, readable crop, and deliberate pacing | It is an unedited full desktop, contains private content, or uses cursor wandering as motion |
| Presenter / presenter with visual | Purposeful human beat, natural framing, credible lip sync, and visual balance | The presenter is a permanent rectangular webcam tile, overlaps copy, or competes with a full slide |
| Question / quiz / recap | Clear prompt, deliberate thinking interval, answer reveal, and retrieval of taught structure | It presents the answer immediately, uses decorative cards, or introduces new unexplained content |

## Captions and delivery files

WebVTT is the canonical cue ledger. The default export is a clean video master plus UTF-8 `.srt` and `.vtt` sidecars for each selected language, and a transcript when requested. SRT is the compatibility-first upload file for services such as YouTube; WebVTT preserves the canonical timing representation. Basic sidecar text must not rely on color, font, position, or other styling that a player may ignore or override.

Embedded soft captions are optional. Open/burned captions are an explicit export choice for a target that needs them; they are never silently added to the clean master. If open captions are selected, they must:

- use no more than two lines by default, break at semantic phrase boundaries, and avoid a one-word second line;
- remain within the caption-safe region and never cover an essential object, face, mouth, equation, code focus, chart label, or evidence highlight;
- meet the project's audience reading-rate policy, with 20 characters per second as the adult review threshold and 17 characters per second for child-oriented output unless the locale policy defines a stricter value;
- identify speakers and meaningful non-speech sound where required, without encoding that information by color alone; and
- be reviewed over moving frames, not only at cue start.

Changing delivery mode must not change narration timing, scene timing, camera framing, or the underlying canonical cue IDs. See [YouTube supported subtitle formats](https://support.google.com/youtube/answer/2734698?hl=en), [WebVTT](https://www.w3.org/TR/webvtt1/), and the [Netflix general timed-text requirements](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215758617-Timed-Text-Style-Guide-General-Requirements) for external interoperability context.

## Targets, locales, and accessibility

- Landscape, portrait, square, and custom targets must each pass the same checks at native resolution. Approval of one target does not approve another.
- English, Spanish, and Hindi must each receive native rendered inspection. Text expansion, script shaping, glyph fallback, punctuation, numeric notation, and reading order must be checked in the actual locale.
- Essential meaning must survive grayscale inspection and common color-vision-deficiency simulation. Non-color cues such as position, labels, shape, or pattern must remain.
- A reduced-motion render must preserve sequence, causality, and state changes through discrete steps, focus changes, or restrained dissolves. Removing motion without replacing its instructional meaning fails.
- Exact equations, code, data, document excerpts, and visual relations that narration does not fully convey must be present in a transcript or accessible sidecar in reading order.
- Open captions and audio-description variants must be reviewed as distinct outputs because each can change information density and avoid regions.

## Automated checks and severity

Automation must block objectively detectable failures: overflow, clipping, missing glyphs, blank frames, unsafe flashes, contrast violations, unresolved assets, caption collisions, stale placeholders, excessive text density, excessive consecutive composition reuse, and missing review artifacts. It must report scene ID, frame/tick, target, locale, bounding boxes, and a full-resolution image.

The renderer art-direction audit measures post-transform Chromium boxes only after packaged fonts have settled. It samples the entry boundary, an early settled frame, the midpoint, late motion, and the exit boundary for each specimen. Text intersections, frame crossings, violations of the 5% graphics-safe area, planned-container overflow, and declared line-limit violations retain the renderer geometry failure code and block the audit. Multiple temporal samples from one scene count as one scene for composition-variety and coverage policy.

Automated success cannot approve subjective composition. Human findings use these severities:

- **Critical:** inaccessible or incorrect essential meaning, unsafe flashing, deceptive data/evidence, illegible primary content, rights/provenance failure, or a broken/corrupt export. Release is blocked.
- **Major:** dashboard/template grammar, weak or missing focal hierarchy, repeated composition that makes the lesson visually monotonous, narration pasted on screen, essential crop/overlap, or a scene family failing its teaching purpose. Release is blocked.
- **Minor:** local optical alignment, spacing, transition, or polish defect that does not obscure meaning. It must be fixed or explicitly accepted before RC.

At most two automatic repair attempts are allowed. A remaining critical or major finding returns the scene to human review; the system must not re-label it as acceptable because retries were exhausted.

## Persistent refinement ledger

Visual acceptance is iterative and auditable. The release evidence packet must keep an append-only pass ledger; replacing an earlier unfavorable result with a later screenshot is prohibited. A pass is a deliberate review through one primary lens, not a generic development-status entry. Each row uses this form:

| Field | Required content |
|---|---|
| Pass | Monotonic identifier and review timestamp |
| Artifact | Video hash, render-manifest hash, target, locale, duration, and resolution |
| Evidence | Contact-sheet hash/path, full-resolution stills, playback notes, and automated report |
| Primary lens | The single question this pass was designed to challenge |
| Findings | Scene/frame-specific critical, major, and minor defects; `none` is allowed only after complete review |
| Decision | `reject`, `repair and rerender`, or `accept`; the reviewer and any waivers are named |
| Next lens | The distinct failure mode the next pass will challenge, even when this pass accepts |

### Pass 1 — current 2.0 baseline

| Field | Record |
|---|---|
| Pass | 1 — initial adversarial visual review |
| Artifact | `sha256:7bd1eb0ae007cd4288dbb043a7557331739a77196fcf1724a1a55769c55df9e2`; landscape; English; 69.008 s; 1280 × 720 |
| Evidence | Encoded full tutorial plus sampled delivery frames and the existing technical QA report |
| Primary lens | Does the exported tutorial read as authored educational motion design rather than product UI? |
| Findings | **Major:** repeated rounded cards/pills and interface-like panels create dashboard grammar. **Major:** narration-derived copy dominates several beats instead of the picture explaining the idea. **Major:** the permanent open-caption band competes with the scene and is present in the default master. **Major:** text alignment, measures, and internal spacing feel template-driven rather than composed. **Major:** the rectangular presenter treatment reads like a webcam tile rather than an integrated presenter beat. **Minor:** washed background treatment weakens focal contrast and makes scenes feel interchangeable. |
| Decision | `reject`; technical render/audio checks do not override the open major findings |
| Next lens | Rebuild the composition grammar and clean-master caption policy, then challenge focal hierarchy and explanatory motion in every scene at native resolution |

### Pass 2 — 160-second clean-master E2E candidate

| Field | Record |
|---|---|
| Pass | 2 — 2026-08-29 16:51:12 UTC adversarial visual review |
| Artifact | `C:\Users\akshi\Desktop\Code Palace\Alystria Studio Test Area\Test Data\full-real-e2e\runs\20260829T165112Z\exports\Alystria-Binary-Search-The-Vanishing-Interval.webm`; `sha256:692f629ff744d7448490c707649b35b7f7351f1a9c8a5899033ec02a422621d4`; render artifact `sha256:b91aa7c3ee9566561d6760d5cbf423abac62c189e75168ad9da6b241768c7ea6`; landscape; English (`en-US`); 160.008 s probed; 1280 × 720 at 24 fps |
| Evidence | `C:\Users\akshi\Desktop\Code Palace\Alystria Studio Test Area\Test Data\full-real-e2e\runs\20260829T165112Z\exports\run-evidence.json`; full-resolution review stills in adjacent `review-frames\` (`hook`, `contract`, `trace`, `absent`, `scale`, `code`, `invariant`, and `quiz`); clean-master probe contains VP9 video and Opus audio with no subtitle stream; upload-ready `en-US.srt`, canonical `en-US.vtt`, caption ledger, and transcript are adjacent to the master. The durable workflow completed every recorded stage and its final multimodal gate passed immutable-evidence, audio, timeline, renderer, objectives, claim-support, terminology, contradiction, and export-security subgates. These technical passes are recorded as pipeline evidence only and do not constitute visual acceptance. |
| Primary lens | Did the new scene grammar and clean-master delivery produce an authored, semantically specific tutorial rather than a technically correct template reel? |
| Findings | **Major:** the project-wide background treatment introduces a visible wash/haze that weakens figure/ground separation and reduces perceived sharpness across scenes. **Major:** definition, worked-example, comparison, and quiz beats fall back to a generic typed-beat composition instead of visual structures specific to defining, transforming, comparing, or testing recall; the declared variety therefore does not consistently survive into the rendered teaching grammar. **Major:** the presenter nameplate is visibly truncated, which is a direct typography/container failure. **Minor:** the customized modern-tech background is present as a selected asset but does not read as deliberately integrated art direction in the reviewed frames. Caption delivery itself passed this lens: the master is clean and the SRT/VTT files are sidecars rather than burned or embedded captions. |
| Decision | `repair and rerender`; reject this candidate for visual release despite successful E2E completion and passing automated gates; no waiver is granted for the three major findings |
| Next lens | Challenge semantic fidelity scene by scene: verify that definition, worked example, comparison, and quiz each use a purpose-built visual explanation, then verify customized backgrounds at native resolution for contrast, sharpness, and meaningful integration. Recheck presenter identity typography without truncation. |

### Pass 3 — user-rejected 160-second E2E candidate

| Field | Record |
|---|---|
| Pass | 3 — 2026-08-29 user acceptance review |
| Artifact | `C:\Users\akshi\Desktop\Code Palace\Alystria Studio Test Area\Test Data\full-real-e2e\runs\20260829T184002Z\exports\Alystria-Binary-Search-The-Vanishing-Interval.webm`; `sha256:04ef0288ebc0cc032e2aa7e86dc29324e7c11eff6f3daa8c11fc3b815efe696f`; landscape; English (`en-US`); 160.008 s; 1280 × 720 at 24 fps; VP9 video and Opus audio |
| Evidence | The encoded tutorial and adjacent SRT, VTT, transcript, caption ledger, project archive, run evidence, and six review frames under the `20260829T184002Z` run directory. The pipeline recorded `SUCCEEDED` and the automated multimodal gate recorded no findings. Those green results are retained as evidence that the automated gate did not detect the visible layout failures; they are not visual acceptance. The completed immutable audit packet is `artifacts/rejected-20260829T184002Z-audit/`: `AUDIT.md`, machine-readable `findings.json`, `SHA256SUMS.txt`, 320 native 1280 × 720 half-second frames, all 3,840 decoded frame hashes, 336 native-fps transition frames, eight aligned scene contact sheets, and seven transition sheets. |
| Primary lens | Does the repaired semantic transport actually preserve professional alignment, collision-free composition, and credible teaching quality throughout the complete encoded tutorial? |
| Findings | **Critical:** subtitle delivery drifts from the authoritative scene/audio timeline and ends at 176.045 s, 16.037 s beyond the video; all seven quiz cues occur after the master ends. **Critical:** the pseudocode returns unconditionally and never implements binary search. **Major:** every scene kicker overlaps its headline in the encoded master. **Major:** a generic presenter placeholder replaces the selected portrait from 23.208–24.000 s. **Major:** transition frames expose blank or partially initialized layouts. **Major:** worked trace values/indices are not aligned; the invariant is nearly empty and reports a fabricated `[6,6]` state; the absent-case label says four states while showing five; the scale scene collides and falsely claims at most ten probes; the quiz reveals its answer immediately. **Major:** all eight scenes remain essentially static after their entrance despite procedural narration. **Major process failure:** the automated multimodal gate reported no findings despite these release-blocking defects. |
| Decision | `reject`; the user's full-video review overrides prior automated success and any earlier assistant claim of visual acceptability; no waiver is granted |
| Next lens | Catalogue every scene and transition at native resolution, turn each reproduced overlap/alignment failure into structural and temporal red tests, rebuild layout from shared measured constraints, and independently audit the lesson's factual sequence and pedagogy before rendering another candidate. |

### Pass 4 — rejected interrupted-render recovery diagnostic

| Field | Record |
|---|---|
| Pass | 4 — 2026-09-01 adversarial long-form recovery review |
| Artifact | Generation `bf4ffa96-2a10-4aa2-80f1-96cf3a1c2478`; renderer attempt `attempt-ty12zl8j`; landscape; English; requested duration 720 s; 1920 × 1080 at 30 fps. No delivery artifact is claimed: the run was deliberately stopped during VP9 encoding after its recovery and rejection evidence was complete. The lossless diagnostic intermediates and incomplete delivery were discarded. |
| Evidence | Preserved under `E:\\temp\\Alystria Studio\\evidence\\rejected-diagnostic-bf4ffa96\\`: progress ledger `render-progress.jsonl` (`sha256:705654df791cf89539a0aebf1d0aaa7ece674e5c00d01acaac8323dc351d2f3d`), project manifest `project-manifest.json` (`sha256:9457ee5e2356b2c0b377dcfd7cccc6ffc9ea62b6339576113227df8a01b75628`), logs, and native authoritative frames 300 (`sha256:fdc2cf7c9d67a866503df8512a1482f387c75e3fee942051d64a1e41c64c5722`), 7500 (`sha256:13b6bef38f76be26f37895a290133fad9ec8b2e0669e9c02cd349015c3adb2dc`), and 15000 (`sha256:7df262c62f2966a1bedc886e1cc4cf27a08659f39805fc2e99382dd8e1abd59a`). The ledger records successful recovery at the interrupted frame cache, completion of all 21,600 authoritative frames, a 44.9 GB lossless presenter composite, exact-duration audio, and entry into delivery encoding. |
| Primary lens | Can an interrupted long-form render resume deterministically, and does the recovered content deserve release even if the technical pipeline completes? |
| Findings | **Recovery pass:** the renderer resumed the existing cache near frame 10,530 and completed all 21,600 authoritative frames, closing the page/context-closure failure that interrupted the earlier attempt. **Critical content failure:** only 257 narration words were stretched over 720 seconds, roughly 21 words per minute, while the new release gate requires at least 576 words at its conservative 48-wpm floor. **Major:** the deterministic offline fallback repeated fragments of the user's full request as headings and body copy instead of teaching Karatsuba. **Major:** frame 300 contains the request fragment `Explain Create the canonical 12-minute` and a synthetic-presenter card whose image is illegible pseudo-text. **Major:** frame 7500 substitutes a generic `Break / Solve similar parts / Combine` diagram for a mathematical explanation while leaking `Apply Create the canonical 12-minute Karatsuba` into the lower label. **Critical pedagogy failure:** frame 15000 is labeled `WORKED EXAMPLE` but contains no arithmetic, operands, substitutions, or Karatsuba intermediate values; it shows generic placeholder progression and truncated prose. **Major process failure:** the old automated pedagogy, factuality, and multimodal gates accepted this sparse fallback script. Root cause was a legacy project created before `canonicalFixtureId` was persisted; the backend trusted only that missing identifier and silently selected `DeterministicOfflineProvider`. |
| Decision | `reject`; the diagnostic proved renderer recovery but is not a releasable tutorial. Backend flagship-identity recovery and the long-form narration-density gate were added before any new candidate is allowed. The incomplete export and approximately 200 GB disposable C-drive sandbox were removed after the small hashed evidence packet was preserved on E:. |
| Next lens | Render a fresh project through the recovered canonical Karatsuba fixture and verify its 13 authored scenes, 1,640-word narration, exact arithmetic, scene-family-specific visuals, presenter treatment, subtitles, and native landscape output before testing portrait and square reflow separately. |

### Pass 5 — rejected canonical semantic-transport diagnostic

| Field | Record |
|---|---|
| Pass | 5 — 2026-09-01 native-frame semantic-fidelity review |
| Artifact | Project `f222d56f-26ac-42ff-a093-650eec757731`; generation `0ae9ce0b-6f38-49aa-b873-8866b6adeebf`; renderer attempt `attempt-bd69d6c29d0aa404`; landscape; English; requested duration 720 s; 1920 x 1080 at 30 fps. No delivery artifact is claimed: the task-owned render was deliberately stopped after the first two scenes supplied decisive rejection evidence. |
| Evidence | Preserved under `E:\\temp\\Alystria Studio\\evidence\\rejected-canonical-f222d56f\\`: render manifest (`sha256:dc1cf2f159a602e7c0c06a87ddb911f80c7829a430b3871e0ba151a1a3dc4527`), progress ledger (`sha256:c07a85bf27965b02b36052b0ab436fd5dcff27a99f58b85e529c93440e75aaa4`), headless generation and stop logs, scene-one frame 600 (`sha256:3a0bf7a7fff69b3575300d3c6e4c0466a4af51d4323932f8c8f581e0ec9a9498`), transition frame 1600 (`sha256:0990924bf2b0d3662a9f10c974ad76aa41567ce36a599fa44cbb6d0e78c88904`), and scene-two frame 1700 (`sha256:b4d677beeb32efa51c7ab145700003ce7072215c66b653bb71fc45b5411cf8db`). The canonical approval gate passed with 13 scenes and 1,640 narration words; the renderer was technically healthy and its error log was empty. |
| Primary lens | Does the recovered canonical fixture reach the renderer as authored mathematical visual structure rather than generic family fallback content? |
| Findings | **Major:** the presenter opening stays visually static and mostly empty across the sampled scene, while the requested four-to-three product transformation never appears. **Major:** the place-value scene does not show `x=aB+b`, `y=cB+d`, `12|34`, `56|78`, aligned block rulers, or a measurement axis; it substitutes the generic definition specimen with numbered circles and `Break / Solve similar parts / Combine`. **Major:** the generated background for the definition scene is barely perceptible and does not carry instructional meaning. **Major process failure:** the canonical fixture planner preserved narration and one caption-derived label but did not transport the renderer's structured `visualBeat` contract, so the automated gates could approve semantically unrelated visual grammar. The fully blank frame 1600 also confirms that transition-boundary review remains necessary even though this pass stopped before judging the whole sequence. |
| Decision | `repair and rerender`; reject before full encoding to avoid spending time and disk on a candidate with already-proven major defects. Preserve the diagnostic evidence, carry structured authored display units through fixture planning, and require a compact all-scene specimen to pass before another 720-second export. |
| Next lens | Verify all 13 scene contracts at compact specimen duration: exact symbolic and numeric information units, purpose-specific family grammar, transition boundaries, composition variety, and caption-safe native geometry. Only then allow another full app-driven landscape export. |

### Pass 6 — accepted compact authored-visual specimen

| Field | Record |
|---|---|
| Pass | 6 — 2026-09-01 native all-scene visual and transition review |
| Artifact | `E:\\temp\\Alystria Studio\\canonical-visual-specimen-authored-v2\\render\\canonical-all-scenes-specimen.webm`; `sha256:eabf78ce3561523d7e5ea13745aa51d684d6a6cb8626296e1d631ede3946920e`; render key `d58afa74e81067a3dc5ae541ddf274e8f6f228fee2587d4d9c9e74e73e77f1da`; landscape; English display content; 26.008 s; 1920 x 1080 at 30 fps; 780 frames. This is a compact visual gate, not the 12-minute release candidate. |
| Evidence | Render manifest `sha256:0bb7ec89e62a2f19a7f3a28a8e94b55088f3c7a79039c5c9f3f0c78460a8e660`, output record `sha256:d2115b65322f198243bb7a02ac943c3b686385d39fc09cc96212753bd57450e0`, transition contact sheet `transition-contact-sheet.png` (`sha256:645d354ff18188c631c7c7681951efbf0a96251e98729ee502d09cecc5dababc`), and the complete authoritative frame cache under the adjacent `.render-cache` directory. Every scene midpoint was inspected at native resolution. Frames immediately before and after all twelve scene boundaries were inspected together: 59/60 through 719/720, plus frame 779. A suspicious preview of frame 239 was independently recaptured; the cached and isolated PNGs were byte-identical (`sha256:b6d732a3897cbc7c4695b6bb9e7f2ee3078c4220b23a68ab826bdbf1f6c6fbad`), confirming a preview artifact rather than incomplete Chromium paint. The deterministic reference tone measured -15.9 LUFS in the delivery, -11.7 dBTP, zero clipped samples, and 0.240 frame A/V drift. |
| Primary lens | Did all 13 authored fixture contracts survive planning and render as mathematically specific teaching structures with complete transition-boundary frames? |
| Findings | The first audio-enabled specimen was rejected before this pass because scene 2 still used generic numbered shapes, scenes 3 and 4 were sparse text, scene 11 truncated its comparison, and scene 13 repeated placeholder source labels. The repaired candidate closes those majors: scene 2 uses aligned `12|34` and `56|78` place-value rulers with `B=100`; scenes 3 and 4 use causal equation transformations; scene 10 shows a six-stage recursion flow; scene 11 preserves the full labels and asymptotic conclusion; scene 13 uses a two-column concept/source ledger. Exact worked arithmetic `672`, `2652`, `6164`, `2840`, `7,006,652` is present in the applicable scenes. No critical or major visual defect remained in the native midpoint or boundary review. **Scope limitation:** the specimen intentionally uses a measured reference tone and compact timing, so it does not approve narration quality, lip sync, subtitle timing, 12-minute pacing, or the full app-driven export. |
| Decision | `accept` for the compact authored-visual prerequisite only; permit the full app-driven landscape candidate. No release approval or waiver is implied. |
| Next lens | Run the rebuilt desktop sandbox through the full 12-minute canonical workflow, then challenge narration naturalness and density, presenter integration and lip sync, subtitle coverage and terminal timing, exact-duration A/V sync, transition integrity, and complete native-resolution playback before release consideration. |

Every later pass must retain Pass 1 and add its own artifact hashes and evidence. A new encode invalidates visual approval from the previous pass, even if the change appears unrelated, because font loading, timing, compositing, or layout may have shifted.

## Human acceptance protocol

Two reviews are required for the flagship and at least one for every other canonical fixture. One reviewer may be the implementer; the other must not know which output is the candidate when a v1/v2 comparison is being scored.

1. Inspect the contact sheet at fit-to-page for rhythm and repetition, then at 100% for typography, crops, and artifacts.
2. Watch the complete tutorial at normal speed with audio. Record the first moment attention is uncertain, copy cannot be read, motion feels decorative, or a composition resembles app chrome.
3. Watch once without audio. For every beat, record the intended focal anchor and whether the visual adds a spatial, procedural, evidential, or comparative contribution.
4. Scrub every transition and all caption cue boundaries. Inspect presenter entrances/exits, responsive reflows, and the highest-density frame of each scene.
5. Compare landscape, portrait, and square contact sheets side by side. Reject cropped re-use disguised as responsive compilation.
6. Review English, Spanish, and Hindi packets at native resolution with a competent reader or documented locale-specific review support.
7. Record findings by scene ID and frame/tick, repair, regenerate the packet, and repeat. Old screenshots cannot close a finding after the manifest or renderer changes.

The candidate passes only when there are no open critical or major findings, every minor finding is fixed or explicitly accepted, and reviewers answer **yes** to all of these questions:

- Is the visual hierarchy obvious within one second of each sampled frame?
- Does each beat teach through its composition rather than decorate narrated copy?
- Is there deliberate visual rhythm without random style changes or template repetition?
- Are type, alignment, crops, and motion convincing at native resolution?
- Is the default master clean, with correctly timed upload-ready subtitle sidecars?
- Would a viewer reasonably read this as an authored tutorial rather than a dashboard, slide export, or AI-generated debug reel?

Relevant design rationale includes the multimedia-learning principles summarized in the [Cambridge Handbook of Multimedia Learning](https://www.cambridge.org/core/books/abs/cambridge-handbook-of-multimedia-learning/principles-for-managing-essential-processing-in-multimedia-learning-segmenting-pretraining-and-modality-principles/4110A2275F6DCD02DAB1F8B37BA7E5CE), [WCAG 2.2](https://www.w3.org/TR/WCAG22/), and the W3C technique for [visual illustrations, pictures, and symbols](https://www.w3.org/WAI/WCAG21/Techniques/general/G103.html).
