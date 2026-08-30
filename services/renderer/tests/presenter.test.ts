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
  assert.throws(() => assertRenderManifest({
    ...manifest,
    presenterVideos: [{ ...manifest.presenterVideos[0]!, activeDurationTicks: 0 }],
  }), /activeDurationTicks must be a positive safe integer/);
  assert.throws(() => assertRenderManifest({
    ...manifest,
    presenterVideos: [{ ...manifest.presenterVideos[0]!, activeDurationTicks: secondsToTicks(5) }],
  }), /activeDurationTicks cannot exceed scene guide duration/);
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

test("presenter active duration may end before its scene without extending lip-sync", () => {
  const base = presenterManifest();
  const sceneDuration = secondsToTicks(24);
  const activeDuration = secondsToTicks(23.224);
  const manifest = {
    ...base,
    scenes: [
      base.scenes[0]!,
      { ...base.scenes[1]!, durationTicks: sceneDuration },
    ],
    presenterVideos: [{
      ...base.presenterVideos[0]!,
      sourceStartTick: 0,
      activeDurationTicks: activeDuration,
    }],
  };

  assert.doesNotThrow(() => assertRenderManifest(manifest));
  const sceneStartFrame = 60;
  const sceneEndFrame = sceneStartFrame + 24 * 30;
  const layers = resolvePresenterCompositeLayers(manifest, {
    startFrame: sceneStartFrame,
    endFrame: sceneEndFrame,
  });
  assert.equal(layers.length, 1);
  assert.equal(layers[0]!.durationTicks, activeDuration);

  const firstTailFrame = sceneStartFrame + Math.ceil(23.224 * 30);
  assert.deepEqual(resolvePresenterCompositeLayers(manifest, {
    startFrame: firstTailFrame,
    endFrame: sceneEndFrame,
  }), [], "the authored scene remains visible after the presenter clip ends");
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

test("picture-in-picture composite follows the top-caption scene transform", () => {
  const target = fixtureTarget({ width: 1280, height: 720, frameRate: { numerator: 24, denominator: 1 } });
  const raw = presenterRect(target, "picture-in-picture");
  const withTopCaption = presenterRect(target, "picture-in-picture", {
    position: "top",
    style: "solid-panel",
    sizePercent: 106,
    safeInsetPercent: 9,
    maxLines: 2,
    textColor: "#F7F8FC",
    panelColor: "#102033",
    fontFamily: "Atkinson Hyperlegible Next",
    fallbackFamilies: ["Arial", "sans-serif"],
  });
  assert.ok(withTopCaption.y > raw.y, "top caption should translate the PIP below its reserved band");
  assert.ok(withTopCaption.width < raw.width, "top caption should scale the scene and PIP together");
  assert.equal(withTopCaption.x % 2, 0);
  assert.equal(withTopCaption.y % 2, 0);
});
