import test from "node:test";
import assert from "node:assert/strict";
import { fixtureManifest, fixtureTarget } from "../src/fixture.js";
import { FrameRenderer, totalFrames } from "../src/runtime.js";

test("same frame is byte deterministic and adjacent frames evolve", () => {
  const manifest = fixtureManifest();
  const renderer = new FrameRenderer({ verifyRepeatability: true });
  const first = renderer.render(manifest, 45);
  const repeated = renderer.render(manifest, 45);
  const adjacent = renderer.render(manifest, 46);
  assert.equal(first.svg, repeated.svg);
  assert.equal(first.contentHash, repeated.contentHash);
  assert.notEqual(first.contentHash, adjacent.contentHash);
  assert.match(first.html, /data-render-ready="true"/);
});

test("preview and final use the same component path", () => {
  assert.match(new FrameRenderer().verifyPreviewFinalParity(fixtureManifest(), 60), /^[0-9a-f]{64}$/);
});

test("responsive compilation changes composition instead of cropping", () => {
  const renderer = new FrameRenderer();
  const wide = renderer.render(fixtureManifest(fixtureTarget()), 30);
  const tall = renderer.render(fixtureManifest(fixtureTarget({ name: "portrait", width: 720, height: 1280 })), 30);
  assert.match(wide.svg, /width="1280" height="720"/);
  assert.match(tall.svg, /width="720" height="1280"/);
  assert.notEqual(wide.contentHash, tall.contentHash);
});

test("small preview targets keep readable type and anchor the footer inside the safe area", () => {
  const target = fixtureTarget({ width: 320, height: 180, frameRate: { numerator: 2, denominator: 1 } });
  const rendered = new FrameRenderer().render(fixtureManifest(target), 1);
  assert.match(rendered.svg, /font-size:24px/);
  assert.match(rendered.svg, /font-size="14"/);
  assert.match(rendered.svg, /<text x="304" y="171" text-anchor="end"[^>]*>ALYSTRIA \/ SCENE-TITLE<\/text>/);
  assert.doesNotMatch(rendered.svg, /translate\([^)]*-168/);
});

test("renderer rejects wall clock/random access from scene code", () => {
  const renderer = new FrameRenderer({ sceneRenderers: { forbidden: () => `<text>${Math.random()}</text>` } });
  const manifest = fixtureManifest();
  const forbidden = { ...manifest, scenes: [{ ...(manifest.scenes[0] as NonNullable<(typeof manifest.scenes)[0]>), kind: "forbidden" }] };
  assert.throws(() => renderer.render(forbidden, 0), /Math.random/);
});

test("renderer rejects executable or remote fragments from scene code", () => {
  const manifest = fixtureManifest();
  const unsafe = { ...manifest, scenes: [{ ...(manifest.scenes[0] as NonNullable<(typeof manifest.scenes)[0]>), kind: "unsafe" }] };
  assert.throws(() => new FrameRenderer({ sceneRenderers: { unsafe: () => "<script>alert(1)</script>" } }).render(unsafe, 0), /executable or remote/);
  assert.throws(() => new FrameRenderer({ sceneRenderers: { unsafe: () => '<image href="https://tracker.example/image.png"/>' } }).render(unsafe, 0), /executable or remote/);
});

test("out-of-range frames fail clearly", () => {
  const manifest = fixtureManifest();
  assert.equal(totalFrames(manifest), 150);
  assert.throws(() => new FrameRenderer().render(manifest, 150), /outside manifest duration/);
});
