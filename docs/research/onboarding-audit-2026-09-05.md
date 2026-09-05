# Onboarding audit: truthful guided practice

Date: 2026-09-05

Scope: `apps/desktop/src/onboarding`, its integration points in
`apps/desktop/src/App.tsx`, the current handoffs and documentation, Git history,
the preserved v1 source, and tag `v1.0.0`.

## Verdict

The first-run setup dialog has real value: it preserves detected configuration,
gates required choices, restores saved values on replay, and keeps setup separate
from product teaching. The contextual tour did not meet the product requirement.
It was a six-card slideshow over live controls. Every card could advance from
Next or Right Arrow without performing the named action, five of the six targets
were deliberately blocked, the one nominally interactive target was still under
a pointer-catching full-screen shade, and opening New tutorial caused later
targets to disappear behind a modal. Replay reset a single index and completion
was one global Boolean, so it could neither resume unfinished work nor acknowledge
what the user had already completed.

This mismatch matters more than its visual styling. The preserved 2023 version
was unsafe and technically primitive, but its single topic-to-video form made the
first action obvious. The current product has far greater control and safety, so
its teaching layer must reveal that complexity through actual work instead of
describing six unrelated surfaces.

## Findings mapped to evidence

| Finding | Before this audit | Required behavior |
|---|---|---|
| Advancement | Next and Right Arrow always changed the index. | An action step remains blocked until its observable completion rule is true. |
| Target input | The full-screen shade received pointer input; most steps also rendered an interaction guard. | The scrim is split around a real hole. The highlighted target stays sharp, focusable, and clickable when the step permits it. |
| Route changes | The target was resolved once per React step. A later-mounted or replaced element stayed missing. | A `MutationObserver` re-resolves replaced targets; `ResizeObserver`, scroll, resize, and `VisualViewport` events remeasure geometry. |
| Off-screen controls | The spotlight clamped to a zero-height or partial rectangle. | The target scrolls into view once per step, with instant movement under reduced-motion preference. |
| Panel placement | Geometry assumed a 360 by 240 panel even when copy wrapped or the viewport narrowed. | Placement uses the panel's rendered bounding box and recalculates when it resizes. |
| Keyboard | Escape worked only while the panel held focus; arrows bypassed actions. | Escape also works after focus moves to the taught control. Right Arrow obeys the same completion gate as Next. A visible control moves focus to the target. |
| Assistive technology | Step progress was visual and changing completion had no dedicated announcement. | Progress exposes range semantics, the target references the current explanation, and action state uses a polite status region. |
| Replay | A single `alystria-guided-tour-v1=completed` value restarted all six cards. | `createGuidedTourReplaySteps` selects unfinished durable action keys first and falls back to a full refresher when all are complete. |

## Implemented component contract

`GuidedTourStep.completion` now supports three levels of proof:

1. `target-event` is appropriate for reversible navigation and disclosure, such
   as opening Models or Jobs. A click, input, or change event completes the step.
2. `element-state` observes a real DOM result, such as a drawer appearing or a
   navigation item receiving `aria-current="page"`. This is stronger than
   counting the initiating click.
3. `external` accepts a durable application key through `completedStepIds`.
   Project creation, provider approval, plan review, generation, and export
   should use this form because their truth lives in application state.

`onStepEnter` is the route-preparation boundary. The app may navigate to the
correct workspace before the target is measured. `onStepComplete` is an audit
hook; it must not itself pretend a durable task succeeded. `autoAdvance` is
opt-in, delayed briefly for ordinary motion, and immediate in reduced-motion
mode. Existing steps without `completion` retain manual Next behavior for API
compatibility.

## Integrated first-project journey

The application now supplies one coherent six-step workflow. Each durable wait
uses the existing project snapshot or job receipts; the tour does not create a
sample project or mark work complete just because a screen was visited.

| Step | Real target/result | Completion proof |
|---|---|---|
| Create | New tutorial button and existing setup wizard | `project-created` only when the snapshot contains a project that was not present when this tour run began. |
| Source | Source import control in Plan | `source-added` only when the active project's source count increases. |
| Plan | Plan approval control | `plan-approved` only when that project's generation job reaches the completed receipt state. |
| Edit | Active scene narration in Studio | The actual input event records the scene update in the project snapshot and unlocks Next. |
| Render | Selected scene render control | `scene-rendered` only after a new `render_scene` job appears in the snapshot. |
| Export | Master render control | `export-submitted` only after a new `export_master` job appears in the snapshot. |

`onStepEnter` closes the Jobs drawer and moves among Plan, Studio, and Export so
the taught control is present before measurement. The source step opens the
Sources panel, then the mutation observer resolves its import button. The tour
is temporarily removed while setup, the project wizard, regeneration, or the
command dialog is open and resumes at the same action afterward. Runtime setup
is reported configured only when the active bootstrap worker says it is ready.

Replay derives completed action keys from the current project and Jobs state,
then calls `createGuidedTourReplaySteps`. It starts with unfinished work; after
all durable work is represented, it remains available as a full refresher.

## Visual direction

The tour should feel like a calm teaching coach inside a production workspace.
Its signature is the bright, undimmed live control cut through a quiet midnight
scrim. The panel remains compact and typographic; the action card carries the
only strong accent. This preserves the application's current cyan/violet language
without adding another decorative layer. The narrow layout becomes a scrollable
panel with stacked actions rather than clipping copy or covering the entire
target.

## Verification strategy

The component seam now has deterministic tests that fail on the original bug:

- Next and Right Arrow stay blocked before the taught event.
- Activating the real target completes the action and enables continuation.
- A target inserted after mount is found, described, and highlighted.
- Off-screen targets call `scrollIntoView`; reduced motion uses `behavior: auto`.
- Panel placement uses its measured 500 by 300 test rectangle instead of the old
  360 by 240 assumption.
- Focus can move to the real target and temporary classes/ARIA references are
  restored on cleanup.
- Durable completion keys and observed element-state completion are accepted.
- Replay selects pending steps and returns the full tour as a refresher once all
  durable steps are complete.

The integrated Playwright audit against the running application at
`127.0.0.1:1438` completed the full sequence at 1440 by 960 and 860 by 900 with
reduced motion. Both runs created one project, imported one source, recorded a
`SUCCEEDED` generation receipt, changed the scene snapshot, recorded one scene
render job, recorded one export job, and finished without page or console errors.
The audit also asserted that the tour disappears over the project wizard and
that the shade has no backdrop blur. Rendered screenshots were inspected for
all action types at both widths.

The complete browser Playwright regression then ran the desktop and narrow
projects together: 20 tests passed and the two intentionally viewport-specific
tests were skipped. This includes provider credentials and route persistence,
the custom-duration wizard, plan generation, the explicit no-authoritative-media
review boundary, portable archive state, a 24 fps AV1 export receipt, retry and
cancel eligibility, source persistence, no narrow horizontal overflow, and the
redesigned surface captures. TypeScript compilation, the 18 focused onboarding
component/state tests, and the owned source/E2E lint checks also passed.

A focused browser regression also verified the repaired Storyboard action at
both desktop and narrow widths. **Add a teaching moment** appended one draft,
opened that exact scene in Studio, accepted title and narration edits, and
restored the edited scene after a full page reload with the project scene count
increased by one. The desktop Studio result is preserved at
`E:\temp\avt-audit-2026-09-05\new-teaching-moment-studio.png`.

## Current source synthesis

The implementation follows points that converge across current platform and
accessibility sources: an interactive callout is a non-modal dialog rather than
a tooltip; focus order must remain meaningful; Escape must always dismiss; no
keyboard shortcut may bypass a task; focused controls must remain visible; state
changes need polite announcements; motion preference must change scrolling and
animation; element and viewport observers should drive geometry rather than
polling; and automated tests need user-facing locators plus rendered screenshots.

The evidence base is mostly standards and browser documentation because the
hard problem here is interaction correctness. Product-onboarding essays were
used only to choose the sequence; platform behavior and WCAG determine the
implementation.

## Evidence ledger

All sources were opened and reviewed on 2026-09-05.

| # | Source | Contribution |
|---:|---|---|
| 1 | [W3C APG tooltip pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/) | A popup with focusable controls is not a tooltip; use a non-modal dialog. |
| 2 | [W3C APG modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | Focus entry, return, Escape, and modal/inert distinctions. |
| 3 | [W3C APG modal dialog example](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/dialog/) | Concrete keyboard and labeling behavior. |
| 4 | [W3C APG keyboard interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/) | Use familiar platform keys and keep every action keyboard operable. |
| 5 | [W3C APG introduction](https://www.w3.org/WAI/ARIA/apg/about/introduction/) | Separates informative patterns from normative WCAG and ARIA requirements. |
| 6 | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Normative keyboard, focus, target-size, status, and motion criteria. |
| 7 | [WCAG focus order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order) | Focus must preserve meaning and operation. |
| 8 | [WCAG focus appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html) | Visible focus needs sufficient area and contrast. |
| 9 | [WCAG focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum) | Persistent overlays must leave focused controls visible. |
| 10 | [WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow) | Fixed panels cannot make narrow or zoomed content unusable. |
| 11 | [WCAG no keyboard trap](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html) | Keyboard users need a standard escape from the teaching layer. |
| 12 | [WCAG on focus](https://www.w3.org/WAI/WCAG22/Understanding/on-focus) | Focusing the target must not silently perform its action. |
| 13 | [WCAG status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages) | Completion and waiting changes should be programmatically announced without stealing focus. |
| 14 | [WCAG content on hover or focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html) | Added content must be dismissible, persistent, and perceivable. |
| 15 | [WCAG target size enhanced](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced) | Sequential controls benefit from generous hit areas. |
| 16 | [W3C HTML dialog technique](https://www.w3.org/WAI/WCAG21/Techniques/html/H102) | Native modal behavior and focus restoration are useful for setup, but do not fit an interactive spotlight. |
| 17 | [MDN dialog role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/dialog_role) | Non-modal dialogs still require labels and deliberate focus management. |
| 18 | [MDN status role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/status_role) | `role=status` supplies polite, atomic announcements. |
| 19 | [MDN aria-live](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-live) | Dynamic updates should announce at an appropriate priority. |
| 20 | [MDN aria-current](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-current) | Current route and process-step state can be observed semantically. |
| 21 | [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion) | Remove non-essential panning and transitions when the OS requests it. |
| 22 | [MDN accessible media queries](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Using_for_accessibility) | Reduced motion should cover interaction-triggered animation too. |
| 23 | [MDN Resize Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Resize_Observer_API) | Remeasure the target and panel when their boxes change. |
| 24 | [MDN Intersection Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API) | Visibility is relative to viewport and clipping ancestors. |
| 25 | [MDN MutationObserver](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver) | Re-resolve targets after dynamic route and drawer DOM changes. |
| 26 | [MDN getBoundingClientRect](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect) | Use current rendered geometry for the spotlight and panel. |
| 27 | [MDN scrollIntoView](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView) | Bring off-screen targets into the visible teaching context. |
| 28 | [MDN HTMLElement focus](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus) | Move focus without causing a second unwanted scroll. |
| 29 | [MDN VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport) | Track the visible viewport during zoom and viewport changes. |
| 30 | [MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) | Coalesce layout reads after scroll and mutation updates. |
| 31 | [MDN pointer-events](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/pointer-events) | A visual hole is not interactive unless overlay hit testing also leaves it open. |
| 32 | [MDN focus-visible](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/:focus-visible) | Keep keyboard focus visually distinct. |
| 33 | [Playwright locators](https://playwright.dev/docs/locators) | Prefer roles, labels, and explicit contracts that match user perception. |
| 34 | [Playwright actionability](https://playwright.dev/docs/actionability) | A target test should prove visibility, stability, event receipt, and enabled state. |
| 35 | [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing) | Combine automated checks with manual/rendered inspection. |
| 36 | [Microsoft Fluent onboarding](https://fluent2.microsoft.design/onboarding) | Keep onboarding contextual, optional, action-oriented, and replayable. |
| 37 | [Material onboarding](https://m1.material.io/growth-communications/onboarding.html) | Prefer a meaningful first action and contextual education over a detached feature list. |

## Limits

The integrated run uses the browser command adapter served by the Windows
development process. It proves the React product flow and its state contracts,
not the packaged Tauri command broker or native media bytes. The owner-level
packaged application and artifact gates remain separate acceptance evidence.
