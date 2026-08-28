# Accessibility and inclusive media

Alystria targets WCAG 2.2 AA for the desktop interface and applies the same intent to exported media. The normative reference is [WCAG 2.2](https://www.w3.org/TR/WCAG22/). Accessibility is authored into scene data and quality gates; it is not a final caption checkbox.

## Desktop interface

- Every action is operable by keyboard with a visible focus indicator and predictable order.
- Semantic controls, names, descriptions, status messages, errors, and progress updates are available to assistive technology.
- Color is never the only indicator of job, evidence, rights, cost, or QA state.
- Text and essential non-text contrast meet AA targets. High-contrast mode preserves meaning.
- Zoom and narrow desktop windows reflow without loss of controls or horizontal page scrolling.
- Motion respects the operating-system reduced-motion preference. Pausing animation must not pause durable jobs.
- Guided and Studio modes retain the same project state, focus context, undo history, and accessibility semantics.
- Timed job updates avoid noisy live regions; significant state transitions are announced once.

## Exported tutorials

Every semantic scene carries a concise description, essential visual list, reading order, reduced-motion alternative, and color-independent flag. Exact text, formulae, charts, code, and diagram relationships must be available in transcripts or accessible sidecars when they cannot be conveyed adequately in narration.

WebVTT is canonical. Standard captions, SDH captions, translations, SRT, burn-in captions, and transcripts derive from the same time-aligned cues. Captions use semantic breaks, at most two lines by default, audience-appropriate reading rates, speaker identification when needed, sound descriptions when meaningful, and collision-aware placement. Essential visuals remain unobscured.

Audio description is authored for visual information that narration does not already communicate. A descriptive transcript includes narration, speakers, meaningful sound, on-screen text, and visual descriptions in reading order.

## Language and cognition

English, Spanish, and Hindi fixtures receive deep verification for rendering, line breaking, voice availability, pronunciation, alignment, captions, and transcript export. Other locales remain capability-gated. UI and tutorial copy avoid idioms when plain language is selected, expose prerequisites, define unfamiliar terms, and never encode difficulty solely with color or speed.

## Motion, flashing, and timing

Reduced-motion alternatives replace spatial travel, parallax, rapid zoom, and nonessential looping with static state, crossfade, or discrete steps. No output may contain flashes that exceed accessibility thresholds. Interactive or quiz scenes offer enough reading/response time and do not require fine motor precision in the editor.

## Acceptance evidence

- Keyboard-only journeys for creating, editing, reviewing, and exporting a fixture.
- Screen-reader smoke tests on Windows with meaningful control names and state announcements.
- Automated and human contrast checks in default and high-contrast themes.
- 200% zoom and narrow-window tests with no clipped primary action.
- Reduced-motion screenshots or renders for every animated scene family.
- Caption collision, line-count, reading-rate, safe-area, and essential-visual tests.
- English, Spanish, and Hindi glyph/render/alignment snapshots.
- Transcript and audio-description completeness checks against scene reading order.

An accessibility failure is release-blocking when it prevents completion, hides essential meaning, causes unsafe flashing, or produces inaccessible exported content without an equivalent alternative.
