import test from "node:test";
import assert from "node:assert/strict";
import { fixtureManifest, fixtureTarget } from "../src/fixture.js";
import { FrameRenderer } from "../src/runtime.js";

test("canonical fixture renders exact preview/final frames across target families", () => {
  const renderer = new FrameRenderer({ verifyRepeatability: true });
  for (const target of [
    fixtureTarget(),
    fixtureTarget({ name: "portrait", width: 720, height: 1280 }),
    fixtureTarget({ name: "square", width: 1080, height: 1080 }),
  ]) {
    const manifest = fixtureManifest(target);
    for (const frame of [0, 15, 45, 90, 149]) {
      const hash = renderer.verifyPreviewFinalParity(manifest, frame);
      assert.match(hash, /^[a-f0-9]{64}$/);
      const rendered = renderer.render(manifest, frame);
      assert.match(rendered.svg, /role="img"/);
      assert.doesNotMatch(rendered.svg, /<script|(?:href|src)="https?:\/\//);
    }
  }
});
