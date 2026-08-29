import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createPlaywrightChromiumDriver, PinnedBrowserCapture, sha256File } from "../dist/src/browser.js";
import { fixtureManifest, fixtureTarget } from "../dist/src/fixture.js";
import { loadFontAssetPayloads, rendererFontFamily } from "../dist/src/fonts.js";
import { FrameRenderer } from "../dist/src/runtime.js";

const [chromiumArgument, fontArgument, outputArgument] = process.argv.slice(2);
if (!chromiumArgument || !fontArgument || !outputArgument) {
  throw new Error("Usage: node render-font-specimen.mjs <chromium> <font.ttf> <output.png>");
}
const chromium = resolve(chromiumArgument);
const sourceFont = resolve(fontArgument);
const output = resolve(outputArgument);
const attemptRoot = join(dirname(output), ".font-specimen-attempt");
const outputDirectory = join(attemptRoot, "output");
const fontDirectory = join(attemptRoot, "fonts");
const fontPath = join(fontDirectory, "verified.ttf");
await rm(attemptRoot, { recursive: true, force: true });
await Promise.all([mkdir(outputDirectory, { recursive: true }), mkdir(fontDirectory, { recursive: true })]);
await copyFile(sourceFont, fontPath);
const digest = await sha256File(fontPath);
const family = rendererFontFamily(digest);
const base = fixtureManifest(fixtureTarget({ width: 1_280, height: 720, frameRate: { numerator: 24, denominator: 1 } }));
const scene = {
  ...base.scenes[0],
  content: {
    eyebrow: "CUSTOM FONT / HASH BOUND",
    title: "Typography should feel chosen",
    body: "This frame uses verified local font bytes. The renderer never sees the original path.",
    accent: "#5658E8",
    items: ["Display role: imported", "Body role: accessible fallback", "Caption role: imported"],
  },
  captions: [{ id: "font-caption", startTick: 0, endTick: base.scenes[0].durationTicks, text: "A selected font must load—or export stops.", position: "bottom" }],
};
const fontInput = {
  id: "font-specimen",
  path: fontPath,
  sha256: digest,
  mediaType: "font/ttf",
  family,
  roles: ["display", "caption"],
  weight: 400,
  style: "normal",
  inspectionStatus: "metadata-inspected",
  embeddingPermission: "installable",
  exportEligible: true,
};
const manifest = {
  ...base,
  outputDirectory,
  scenes: [scene],
  fontAssets: [fontInput],
  typography: {
    displayFamily: family,
    bodyFamily: "Atkinson Hyperlegible Next",
    codeFamily: "JetBrains Mono",
    captionFamily: family,
  },
  captionStyle: {
    position: "lower-third",
    style: "soft-panel",
    sizePercent: 100,
    safeInsetPercent: 6,
    maxLines: 2,
    textColor: "#FFFFFF",
    panelColor: "#151827",
    fontFamily: family,
    fallbackFamilies: ["Arial", "sans-serif"],
  },
};
const payloads = await loadFontAssetPayloads(manifest);
const driver = await createPlaywrightChromiumDriver({ executablePath: chromium, width: 1_280, height: 720, deviceScaleFactor: 1 });
const capture = new PinnedBrowserCapture(driver, {
  expectedVersion: driver.version,
  expectedSha256: await sha256File(chromium),
}, new FrameRenderer({ verifyRepeatability: true, fontAssetPayloads: payloads }));
try {
  await mkdir(dirname(output), { recursive: true });
  const result = await capture.captureFrame(manifest, 48, output);
  process.stdout.write(`${JSON.stringify({ output, family, fontSha256: digest, pngSha256: result.outputSha256 })}\n`);
} finally {
  await capture.close();
  await rm(attemptRoot, { recursive: true, force: true });
}
