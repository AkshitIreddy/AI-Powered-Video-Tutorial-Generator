import test from "node:test";
import assert from "node:assert/strict";
import { specimenFor, type SceneSpec } from "@alystria/scenes";
import { fixtureManifest, fixtureTarget } from "../src/fixture.js";
import { FrameRenderer } from "../src/runtime.js";
import {
  SceneViewStaticAdapter,
  createLocalAssetResolver,
  mapFrameContextToSceneFrame,
  mapRenderTargetToSceneTarget,
} from "../src/scene-view.js";

test("target and frame mappings preserve canonical dimensions, timing, and safe area", () => {
  const target = fixtureTarget({
    name: "portrait",
    width: 720,
    height: 1280,
    safeArea: { top: 128, right: 36, bottom: 64, left: 36 },
  });
  assert.deepEqual(mapRenderTargetToSceneTarget(target, { locale: "hi-IN", reducedMotion: true }), {
    width: 720,
    height: 1280,
    fps: 30,
    pixelRatio: 1,
    safeAreaPercent: 0.1,
    locale: "hi-IN",
    reducedMotion: true,
  });
  assert.deepEqual(mapFrameContextToSceneFrame({ localTick: 480_000 }, true), { tick: 480_000, reducedMotion: true });
  assert.throws(
    () => mapRenderTargetToSceneTarget(fixtureTarget({ frameRate: { numerator: 30_000, denominator: 1_001 } })),
    /integer frame rate/,
  );
});

test("SceneView adapter emits byte-identical static SVG and HTML", () => {
  const spec = specimenFor("diagram");
  const adapter = new SceneViewStaticAdapter();
  const first = adapter.renderSpec(spec, fixtureTarget(), 480_000);
  const repeated = adapter.renderSpec(spec, fixtureTarget(), 480_000);
  assert.equal(repeated.svg, first.svg);
  assert.equal(repeated.html, first.html);
  assert.equal(repeated.contentHash, first.contentHash);
  assert.match(first.contentHash, /^[0-9a-f]{64}$/);
  assert.match(first.svg, /data-scene-kind="diagram"/);
  assert.match(first.html, /data-render-ready="true"/);
  assert.match(first.html, /<html lang="en">/);
  assert.doesNotMatch(first.svg, /(?:href|src)="https?:\/\//);
});

test("SceneView adapter compiles responsive target variants instead of cropping", () => {
  const spec = specimenFor("comparison");
  const adapter = new SceneViewStaticAdapter();
  const landscape = adapter.renderSpec(spec, fixtureTarget(), 240_000);
  const portrait = adapter.renderSpec(spec, fixtureTarget({ name: "portrait", width: 720, height: 1280 }), 240_000);
  const square = adapter.renderSpec(spec, fixtureTarget({ name: "square", width: 1080, height: 1080 }), 240_000);
  assert.equal(landscape.scene.metrics.profile, "landscape");
  assert.equal(landscape.scene.metrics.columns, 2);
  assert.equal(portrait.scene.metrics.profile, "portrait");
  assert.equal(portrait.scene.metrics.columns, 1);
  assert.equal(square.scene.metrics.profile, "square");
  assert.equal(square.scene.metrics.columns, 1);
  assert.match(landscape.svg, /data-profile="landscape"/);
  assert.match(portrait.svg, /data-profile="portrait"/);
  assert.notEqual(landscape.contentHash, portrait.contentHash);
  assert.notEqual(portrait.contentHash, square.contentHash);
});

test("local asset resolver exposes only verified content-addressed custom URIs", () => {
  const hash = "a".repeat(64);
  const resolver = createLocalAssetResolver([{ id: "asset.local.diagram", sha256: hash }]);
  const adapter = new SceneViewStaticAdapter({ resolveAsset: resolver });
  const rendered = adapter.renderSpec(specimenFor("image-focus"), fixtureTarget(), 240_000);
  assert.match(rendered.svg, new RegExp(`href="alystria-asset:sha256/${hash}"`));
  assert.doesNotMatch(rendered.svg, /<image[^>]+href="(?:file|https?):/);
  assert.equal(resolver({ id: "asset.local.diagram", sha256: "b".repeat(64), alt: "mismatch" }), undefined);
  assert.throws(() => createLocalAssetResolver([{ id: "asset.bad", sha256: "not-a-hash" }]), /SHA-256/);
});

test("FrameRenderer routes resolved SceneSpecs through the same preview/final SceneView path", () => {
  const spec = specimenFor("comparison");
  const base = fixtureManifest();
  const manifest = {
    ...base,
    scenes: [{
      ...base.scenes[0]!,
      id: spec.id,
      kind: spec.content.kind,
      durationTicks: spec.durationTicks,
      content: { title: spec.content.title },
    }],
  };
  const renderer = new FrameRenderer({
    sceneSpecResolver: (scene) => scene.id === spec.id ? spec : undefined,
    sceneView: { locale: "es-ES" },
    verifyRepeatability: true,
  });
  const final = renderer.render(manifest, 15, "final");
  const preview = renderer.render(manifest, 15, "preview");
  assert.equal(preview.svg, final.svg);
  assert.equal(preview.contentHash, final.contentHash);
  assert.match(final.svg, /data-scene-kind="comparison"/);
  assert.doesNotMatch(final.svg, /data-caption-id=/, "sidecar delivery keeps preview/final frames clean");
  assert.match(final.html, /<html lang="es-ES">/);
  assert.doesNotMatch(final.svg, /foreignObject/);
});

test("FrameRenderer rejects a SceneSpec that does not match its resolved manifest scene", () => {
  const original = specimenFor("diagram");
  const mismatch: SceneSpec = { ...original, id: "specimen.different" };
  const base = fixtureManifest();
  const manifest = {
    ...base,
    scenes: [{
      ...base.scenes[0]!,
      id: original.id,
      kind: original.content.kind,
      durationTicks: original.durationTicks,
      content: { title: original.content.title },
    }],
  };
  assert.throws(
    () => new FrameRenderer({ sceneSpecResolver: () => mismatch }).render(manifest, 0),
    /does not match resolved scene/,
  );
});
