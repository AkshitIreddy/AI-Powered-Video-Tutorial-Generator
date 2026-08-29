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

test("caption render style changes safe position, line count, colors, and font stack", () => {
  const styled = renderCaptionSvg(
    [{ id: "styled", startTick: 0, endTick: secondsToTicks(5), text: "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty" }],
    100,
    fixtureTarget(),
    {
      position: "top",
      style: "outline",
      sizePercent: 120,
      safeInsetPercent: 10,
      maxLines: 3,
      textColor: "#FFF4D6",
      panelColor: "#102033",
      fontFamily: "Atkinson Hyperlegible Next",
      fallbackFamilies: ["Arial", "sans-serif"],
    },
  );
  assert.match(styled, /y="72\.0"/); // 10% of the 720px target.
  assert.match(styled, /fill="#102033" fill-opacity="0\.3" stroke="#102033"/);
  assert.match(styled, /fill="#FFF4D6" font-family="'Atkinson Hyperlegible Next', 'Arial', sans-serif"/);
  assert.equal((styled.match(/<tspan x=/g) ?? []).length, 3);
});

test("active cue boundary is half-open", () => {
  assert.equal(activeCaptionCues(cues, 0).length, 1);
  assert.equal(activeCaptionCues(cues, cues[0]?.endTick ?? -1).length, 0);
});
