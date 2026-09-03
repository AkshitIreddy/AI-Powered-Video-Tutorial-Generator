import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachVisualAssetBootstrap, loadVisualAssetPayloads, type VisualAssetPayload } from "../src/assets.js";
import { assertRenderManifest, type RenderManifest, type ResolvedScene } from "../src/contracts.js";
import { fixtureManifest } from "../src/fixture.js";
import { FrameRenderer } from "../src/runtime.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const PNG_HASH = createHash("sha256").update(PNG).digest("hex");

function visualScene(kind: string, role: "background" | "primary" | "presenter-portrait"): ResolvedScene {
  const base = fixtureManifest().scenes[0]!;
  return {
    ...base,
    id: `scene-${role}`,
    kind,
    content: { title: `Verified ${role}`, body: "Only immutable project bytes may appear here." },
    visualAssets: [{
      assetId: `asset-${role}`,
      sha256: PNG_HASH,
      role,
      alt: `Owned ${role} image`,
      fit: role === "primary" ? "contain" : "cover",
    }],
  };
}

function visualManifest(scene: ResolvedScene, path = "C:\\attempt\\visuals\\asset.png"): RenderManifest {
  return {
    ...fixtureManifest(),
    scenes: [scene],
    outputDirectory: "C:\\attempt\\output",
    visualAssets: [{ id: scene.visualAssets![0]!.assetId, path, sha256: PNG_HASH, mediaType: "image/png" }],
  };
}

function payload(id: string): VisualAssetPayload {
  return { id, sha256: PNG_HASH, mediaType: "image/png", bytes: PNG };
}

test("visual manifest requires absolute, hash-matched, referenced bitmap inputs", () => {
  const scene = visualScene("image-focus", "primary");
  assert.doesNotThrow(() => assertRenderManifest(visualManifest(scene)));
  assert.throws(
    () => assertRenderManifest({ ...visualManifest(scene), visualAssets: [] }),
    /missing visual asset/,
  );
  assert.throws(
    () => assertRenderManifest({ ...visualManifest(scene), visualAssets: [{ id: "asset-primary", path: "relative.png", sha256: PNG_HASH, mediaType: "image/png" }] }),
    /plain absolute local filesystem path/,
  );
  assert.throws(
    () => assertRenderManifest({ ...visualManifest(scene), visualAssets: [{ id: "asset-primary", path: "https://example.test/a.png", sha256: PNG_HASH, mediaType: "image/png" }] }),
    /plain absolute local filesystem path/,
  );
});

test("manifest accepts provider-free timing and rejects malformed word ranges", () => {
  const base = fixtureManifest();
  const scene = {
    ...base.scenes[0]!,
    durationTicks: 1_200_000,
    narrationTiming: {
      schemaVersion: 1 as const,
      source: "provider-native" as const,
      alignedTokenRatio: 1,
      words: [{ token: "Portable", startTick: 24_000, endTick: 180_000 }],
    },
  };
  assert.doesNotThrow(() => assertRenderManifest({ ...base, scenes: [scene] }));
  assert.throws(
    () => assertRenderManifest({
      ...base,
      scenes: [{
        ...scene,
        narrationTiming: {
          ...scene.narrationTiming,
          words: [{ token: "Broken", startTick: 1_100_000, endTick: 1_300_000 }],
        },
      }],
    }),
    /narration word 0 has an invalid range/,
  );
});

test("attempt loader enforces containment, exact SHA-256, size, and image magic", async () => {
  const root = await mkdtemp(join(tmpdir(), "alystria-visual-assets-"));
  try {
    const output = join(root, "output");
    const visuals = join(root, "visuals");
    await Promise.all([mkdir(output), mkdir(visuals)]);
    const path = join(visuals, "owned.png");
    await writeFile(path, PNG);
    const scene = visualScene("image-focus", "primary");
    const manifest = { ...visualManifest(scene, path), outputDirectory: output };
    const loaded = await loadVisualAssetPayloads(manifest);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]!.sha256, PNG_HASH);
    assert.deepEqual(Buffer.from(loaded[0]!.bytes), PNG);

    await writeFile(path, Buffer.from("not a png"));
    await assert.rejects(() => loadVisualAssetPayloads(manifest), /SHA-256/);

    const disguised = Buffer.concat([PNG.subarray(0, 7), Buffer.from([0]), PNG.subarray(8)]);
    await writeFile(path, disguised);
    const disguisedHash = createHash("sha256").update(disguised).digest("hex");
    await assert.rejects(
      () => loadVisualAssetPayloads({
        ...manifest,
        scenes: [{ ...scene, visualAssets: [{ ...scene.visualAssets![0]!, sha256: disguisedHash }] }],
        visualAssets: [{ ...manifest.visualAssets![0]!, sha256: disguisedHash }],
      }),
      /bytes do not match declared media type/,
    );

    const outside = join(root, "..", `outside-${process.pid}.png`);
    await writeFile(outside, PNG);
    await assert.rejects(
      () => loadVisualAssetPayloads(visualManifest(scene, outside)),
      /inside the renderer attempt root/,
    );
    await rm(outside, { force: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("frame renderer routes bitmap bytes through custom SVG ids and a blob bootstrap", () => {
  for (const [kind, role] of [
    ["bullets", "background"],
    ["image-focus", "primary"],
    ["presenter", "presenter-portrait"],
  ] as const) {
    const scene = visualScene(kind, role);
    const manifest = visualManifest(scene);
    const rendered = new FrameRenderer({
      verifyRepeatability: true,
      visualAssetPayloads: [payload(`asset-${role}`)],
    }).render(manifest, 0);
    assert.match(rendered.svg, new RegExp(`href="alystria-asset:sha256/${PNG_HASH}"`));
    assert.doesNotMatch(rendered.svg, /(?:href|src)="(?:file:|https?:|data:|blob:)/);
    assert.match(rendered.html, /data-render-ready="false"/);
    assert.match(rendered.html, /URL\.createObjectURL\(new Blob/);
    assert.doesNotMatch(rendered.html, /C:\\attempt|file:\/\//);
  }
});

test("blob bootstrap waits for decoding and fails closed when verified bytes are absent", () => {
  const html = '<body data-render-ready="true"><svg><image href="alystria-asset:sha256/abc"/></svg></body>';
  const bootstrapped = attachVisualAssetBootstrap(html, [payload("asset")]);
  assert.match(bootstrapped, /data-render-ready="false"/);
  assert.match(bootstrapped, /await Promise\.all/);
  assert.match(bootstrapped, /dataset\.renderError/);
  const scene = visualScene("presenter", "presenter-portrait");
  assert.throws(
    () => new FrameRenderer().render(visualManifest(scene), 0),
    /missing verified bytes/,
  );
});
