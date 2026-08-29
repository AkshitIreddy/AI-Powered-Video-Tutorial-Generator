import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertFontAssetInputs,
  attachFontAssetBootstrap,
  loadFontAssetPayloads,
  rendererFontFamily,
} from "../src/fonts.js";
import type { FontAssetInput } from "../src/contracts.js";
import { assertRenderManifest, type RenderManifest } from "../src/contracts.js";
import { fixtureManifest } from "../src/fixture.js";
import { FrameRenderer } from "../src/runtime.js";

const TTF = Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.alloc(124, 0x41)]);
const HASH = createHash("sha256").update(TTF).digest("hex");

function input(path: string): FontAssetInput {
  return {
    id: "font-owned-display",
    path,
    sha256: HASH,
    mediaType: "font/ttf",
    family: rendererFontFamily(HASH),
    roles: ["display", "caption"],
    weight: [100, 900],
    style: "normal",
    inspectionStatus: "metadata-inspected",
    embeddingPermission: "installable",
    exportEligible: true,
  };
}

test("font inputs require deterministic aliases, unique roles, and final-render clearance", () => {
  assert.doesNotThrow(() => assertFontAssetInputs([input("C:\\attempt\\fonts\\owned.ttf")]));
  assert.throws(() => assertFontAssetInputs([{ ...input("C:\\attempt\\fonts\\owned.ttf"), family: "User supplied);src:url(evil)" }]), /deterministic renderer family/);
  assert.throws(() => assertFontAssetInputs([
    input("C:\\attempt\\fonts\\owned.ttf"),
    { ...input("C:\\attempt\\fonts\\other.ttf"), id: "other", roles: ["display"] },
  ]), /display is bound by more than one/);
  assert.throws(
    () => assertFontAssetInputs([{ ...input("C:\\attempt\\fonts\\owned.ttf"), exportEligible: false as true }]),
    /not cleared for final rendering/,
  );
  assert.throws(
    () => assertFontAssetInputs([{ ...input("C:\\attempt\\fonts\\owned.ttf"), embeddingPermission: "restricted" as "installable" }]),
    /unsupported embedding permission/,
  );
});

test("attempt loader enforces containment, exact hash, size, and font magic", async () => {
  const root = await mkdtemp(join(tmpdir(), "alystria-font-assets-"));
  try {
    const output = join(root, "output");
    const fonts = join(root, "fonts");
    await Promise.all([mkdir(output), mkdir(fonts)]);
    const path = join(fonts, "owned.ttf");
    await writeFile(path, TTF);
    const loaded = await loadFontAssetPayloads({ outputDirectory: output, fontAssets: [input(path)] });
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]!.sha256, HASH);
    assert.deepEqual(Buffer.from(loaded[0]!.bytes), TTF);

    await writeFile(path, Buffer.from("not-a-font"));
    await assert.rejects(
      () => loadFontAssetPayloads({ outputDirectory: output, fontAssets: [input(path)] }),
      /SHA-256/,
    );

    const disguised = Buffer.concat([Buffer.from("OTTO"), TTF.subarray(4)]);
    await writeFile(path, disguised);
    const disguisedHash = createHash("sha256").update(disguised).digest("hex");
    await assert.rejects(
      () => loadFontAssetPayloads({ outputDirectory: output, fontAssets: [{ ...input(path), sha256: disguisedHash, family: rendererFontFamily(disguisedHash) }] }),
      /bytes do not match declared media type/,
    );

    const outside = join(root, "..", `outside-font-${process.pid}.ttf`);
    await writeFile(outside, TTF);
    await assert.rejects(
      () => loadFontAssetPayloads({ outputDirectory: output, fontAssets: [input(outside)] }),
      /inside the renderer attempt root/,
    );
    await rm(outside, { force: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("font bootstrap uses verified bytes and a fail-closed FontFace promise without paths", () => {
  const record = input("C:\\attempt\\fonts\\owned.ttf");
  const html = "<!doctype html><html><head></head><body data-render-ready=\"true\"><svg/></body></html>";
  const result = attachFontAssetBootstrap(html, [{ ...record, bytes: TTF }]);
  assert.match(result, /new FontFace/);
  assert.match(result, /__alystriaFontReady/);
  assert.match(result, /face\.status!==['"]loaded['"]/);
  assert.match(result, new RegExp(rendererFontFamily(HASH)));
  assert.doesNotMatch(result, /C:\\attempt|file:\/\//);
});

test("manifest binds imported font aliases to scene and caption typography", () => {
  const record = input("C:\\attempt\\fonts\\owned.ttf");
  const base = fixtureManifest();
  const manifest: RenderManifest = {
    ...base,
    fontAssets: [record],
    typography: {
      displayFamily: record.family,
      bodyFamily: "Atkinson Hyperlegible Next",
      codeFamily: "JetBrains Mono",
      captionFamily: record.family,
    },
    captionStyle: {
      position: "auto",
      style: "soft-panel",
      sizePercent: 100,
      safeInsetPercent: 6,
      maxLines: 2,
      textColor: "#FFFFFF",
      panelColor: "#151827",
      fontFamily: record.family,
      fallbackFamilies: ["Arial", "sans-serif"],
    },
  };
  assert.doesNotThrow(() => assertRenderManifest(manifest));
  const rendered = new FrameRenderer({ fontAssetPayloads: [{ ...record, bytes: TTF }] }).render(manifest, 0);
  assert.match(rendered.svg, new RegExp(`font-family="&quot;${record.family}&quot;`));
  assert.match(rendered.html, /__alystriaFontReady/);
  assert.doesNotMatch(rendered.html, /C:\\attempt|file:\/\//);

  assert.throws(
    () => assertRenderManifest({ ...manifest, typography: { ...manifest.typography!, displayFamily: "AlystriaImported-0000000000000000" } }),
    /unbound imported font/,
  );
  assert.throws(
    () => new FrameRenderer().render(manifest, 0),
    /missing verified bytes for font asset/,
  );
});
