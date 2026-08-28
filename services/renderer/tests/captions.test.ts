import test from "node:test";
import assert from "node:assert/strict";
import type { CaptionCue } from "../src/contracts.js";
import { activeCaptionCues, escapeMarkup, renderCaptionSvg, toSrt, toWebVtt } from "../src/captions.js";
import { fixtureTarget } from "../src/fixture.js";
import { secondsToTicks } from "../src/timebase.js";

const cues: readonly CaptionCue[] = [
  { id: "one", startTick: 0, endTick: secondsToTicks(1.234), text: "A < B & B > C", speaker: "Tutor", position: "bottom" },
  { id: "two", startTick: secondsToTicks(1.5), endTick: secondsToTicks(3), text: "Second cue", position: "top" },
];

test("VTT and SRT share exact cue timing", () => {
  const vtt = toWebVtt(cues);
  const srt = toSrt(cues);
  assert.match(vtt, /00:00:00\.000 --> 00:00:01\.234 line:90%/);
  assert.match(srt, /00:00:00,000 --> 00:00:01,234/);
  assert.match(vtt, /<v Tutor>A &lt; B &amp; B &gt; C/);
  assert.match(srt, /Tutor: A &lt; B &amp; B &gt; C/);
});

test("caption overlay escapes untrusted markup", () => {
  const svg = renderCaptionSvg(cues, 100, fixtureTarget());
  assert.match(svg, /A &lt; B &amp; B &gt; C/);
  assert.doesNotMatch(svg, /A < B/);
  assert.equal(escapeMarkup(`'"&<>`), "&#39;&quot;&amp;&lt;&gt;");
});

test("active cue boundary is half-open", () => {
  assert.equal(activeCaptionCues(cues, 0).length, 1);
  assert.equal(activeCaptionCues(cues, cues[0]?.endTick ?? -1).length, 0);
});
