import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_SCENE_KINDS } from "@alystria/scenes";
import { fixtureManifest, fixtureTarget } from "../src/fixture.js";
import { FrameRenderer, resolveBuiltinSceneSpec, totalFrames } from "../src/runtime.js";

test("production defaults resolve every built-in kind through SceneView", () => {
  const base = fixtureManifest();
  const renderer = new FrameRenderer({ verifyRepeatability: true });
  for (const kind of BUILTIN_SCENE_KINDS) {
    const manifest = {
      ...base,
      scenes: [{
        ...base.scenes[0]!,
        id: `production-${kind}`,
        kind,
        content: {
          title: `Production ${kind}`,
          body: "A manifest-derived explanation, kept inert and deterministic.",
          items: ["First teaching point", "Second teaching point", "Third teaching point"],
        },
      }],
    };
    const rendered = renderer.render(manifest, 15);
    assert.match(rendered.svg, new RegExp(`data-scene-kind="${kind}"`), kind);
    assert.doesNotMatch(rendered.svg, /<foreignObject/, kind);
  }
});

test("default presenter mapping is semantic and never consumes path-like metadata", () => {
  const base = fixtureManifest();
  const scene = {
    ...base.scenes[0]!,
    id: "guide-scene",
    kind: "presenter-slide",
    content: {
      title: "Meet the three-product insight",
      body: "One algebraic identity changes the recursion tree.",
      items: ["Split the inputs", "Compute three products", "Recombine"],
    },
    metadata: {
      presenterName: "Alystria Guide",
      presenterDisclosure: "Synthetic presenter",
      portraitPath: "C:\\untrusted\\portrait.png",
      portraitUrl: "https://tracker.invalid/portrait.png",
    },
  };
  const spec = resolveBuiltinSceneSpec(scene);
  assert.equal(spec?.content.kind, "presenter-slide");
  const rendered = new FrameRenderer().render({ ...base, scenes: [scene] }, 15);
  assert.match(rendered.svg, /data-scene-kind="presenter-slide"/);
  assert.match(rendered.svg, /Meet the three-product insight/);
  assert.doesNotMatch(rendered.svg, /C:\\untrusted/);
  assert.doesNotMatch(rendered.svg, /https:\/\/tracker\.invalid/);
});

test("worked examples compact narration into a caption-safe procedural layout", () => {
  const base = fixtureManifest();
  const scene = {
    ...base.scenes[0]!,
    id: "worked-caption-safe",
    kind: "worked-example",
    content: {
      title: "Trace the target",
      body: "Follow low, middle, and high without losing the invariant.",
      items: [
        "Find forty-four in a sorted list of three, eight, twelve, seventeen, twenty-three, thirty-one, forty-four, fifty-eight, and seventy-two.",
        "The middle value is twenty-three, so move the lower boundary past it.",
        "The next middle value is forty-four, which completes the search.",
        "State why the target remains inside the retained interval at every step.",
        "A fifth long narration sentence must remain in audio rather than overcrowding the card.",
      ],
    },
  };
  const spec = resolveBuiltinSceneSpec(scene);
  assert.equal(spec?.content.kind, "worked-example");
  if (spec?.content.kind !== "worked-example") throw new Error("Expected worked example content");
  assert.equal(spec.content.steps.length, 4);
  assert.ok(spec.content.steps.every((step) => step.text.length <= 180));
  const rendered = new FrameRenderer().render({ ...base, scenes: [scene] }, 24);
  assert.match(rendered.svg, /ANSWER/);
  assert.match(rendered.svg, /data-scene-kind="worked-example"/);
  assert.match(rendered.svg, /fifty-eight, and seventy-two/);
  assert.match(rendered.svg, /A fifth long narration sentence/);
});

test("top caption customization reserves a stable scene band instead of covering content", () => {
  const base = fixtureManifest();
  const manifest = {
    ...base,
    captionStyle: {
      position: "top" as const,
      style: "solid-panel" as const,
      sizePercent: 110,
      safeInsetPercent: 6,
      maxLines: 2 as const,
      textColor: "#FFF4D6",
      panelColor: "#102033",
      fontFamily: "Atkinson Hyperlegible Next",
      fallbackFamilies: ["Arial", "sans-serif"],
    },
    scenes: [{
      ...base.scenes[0]!,
      captions: [{ id: "safe-top", startTick: 0, endTick: base.scenes[0]!.durationTicks, text: "A caption with its own reserved band." }],
    }],
  };
  const rendered = new FrameRenderer().render(manifest, 15);
  assert.match(rendered.svg, /data-caption-reserved-scene="top"/);
  assert.match(rendered.svg, /data-caption-id="safe-top"/);
  assert.match(rendered.svg, /fill="#102033"/);
  assert.ok(rendered.svg.indexOf("data-caption-reserved-scene") < rendered.svg.indexOf("data-caption-id"));
});

test("unknown kinds and unsupported preview frame rates retain the inert fixture fallback", () => {
  const base = fixtureManifest(fixtureTarget({ frameRate: { numerator: 2, denominator: 1 } }));
  const unknownScene = { ...base.scenes[0]!, kind: "plugin:unknown/card" };
  assert.equal(resolveBuiltinSceneSpec(unknownScene), undefined);
  const rendered = new FrameRenderer().render({ ...base, scenes: [unknownScene] }, 1);
  assert.doesNotMatch(rendered.svg, /data-scene-kind=/);
  assert.match(rendered.svg, /ALYSTRIA \/ SCENE-TITLE/);
});

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
