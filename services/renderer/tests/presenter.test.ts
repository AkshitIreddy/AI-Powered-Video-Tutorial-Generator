import test from "node:test";
import assert from "node:assert/strict";
import { assertRenderManifest } from "../src/contracts.js";
import { fixtureManifest, fixtureTarget } from "../src/fixture.js";
import { presenterRect, resolvePresenterCompositeLayers } from "../src/presenter.js";
import { secondsToTicks } from "../src/timebase.js";

const HASH = "a".repeat(64);

function presenterManifest() {
  const base = fixtureManifest(fixtureTarget({ width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 } }));
  return {
    ...base,
    scenes: [
      { ...base.scenes[0]!, id: "intro", kind: "title", durationTicks: secondsToTicks(2), captions: [] },
      { ...base.scenes[0]!, id: "guide", kind: "presenter-slide", durationTicks: secondsToTicks(4), captions: [] },
    ],
    presenterVideos: [{
      id: "presenter.guide",
      path: "C:\\Alystria\\objects\\guide.mp4",
      sha256: HASH,
      sceneId: "guide",
      sourceStartTick: secondsToTicks(0.5),
      placement: "split-left" as const,
      fit: "cover" as const,
    }],
  };
}

test("presenter bindings require a local hashed clip and a presenter scene", () => {
  const manifest = presenterManifest();
  assert.doesNotThrow(() => assertRenderManifest(manifest));
  assert.throws(() => assertRenderManifest({
    ...manifest,
    presenterVideos: [{ ...manifest.presenterVideos[0]!, path: "https://example.invalid/guide.mp4" }],
  }), /plain absolute local filesystem path/);
  assert.throws(() => assertRenderManifest({
    ...manifest,
    presenterVideos: [{ ...manifest.presenterVideos[0]!, path: "relative/guide.mp4" }],
  }), /plain absolute local filesystem path/);
  assert.throws(() => assertRenderManifest({
    ...manifest,
    presenterVideos: [{ ...manifest.presenterVideos[0]!, sceneId: "intro" }],
  }), /only bind to a presenter scene/);
  assert.throws(() => assertRenderManifest({
    ...manifest,
    presenterVideos: [manifest.presenterVideos[0]!, { ...manifest.presenterVideos[0]!, id: "duplicate" }],
  }), /more than one presenter video/);
});

test("presenter layers map selected timeline and source offsets exactly", () => {
  const manifest = presenterManifest();
  const layers = resolvePresenterCompositeLayers(manifest, { startFrame: 90, endFrame: 150 });
  assert.equal(layers.length, 1);
  assert.deepEqual(layers[0], {
    id: "presenter.guide",
    path: "C:\\Alystria\\objects\\guide.mp4",
    sha256: HASH,
    sceneId: "guide",
    sourceStartTick: secondsToTicks(1.5),
    timelineStartTick: 0,
    durationTicks: secondsToTicks(2),
    fit: "cover",
    placement: "split-left",
    x: 78,
    y: 162,
    width: 672,
    height: 724,
  });
});

test("responsive presenter regions stay even-sized and above caption space", () => {
  for (const target of [
    fixtureTarget({ width: 1920, height: 1080 }),
    fixtureTarget({ name: "portrait", width: 1080, height: 1920 }),
    fixtureTarget({ name: "square", width: 1080, height: 1080 }),
  ]) {
    for (const placement of ["picture-in-picture", "split-left", "split-right"] as const) {
      const rect = presenterRect(target, placement);
      assert.equal(rect.x % 2, 0);
      assert.equal(rect.y % 2, 0);
      assert.equal(rect.width % 2, 0);
      assert.equal(rect.height % 2, 0);
      assert.ok(rect.x >= 0 && rect.y >= 0);
      assert.ok(rect.x + rect.width <= target.width);
      assert.ok(rect.y + rect.height <= target.height * 0.83);
    }
  }
});
