import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright-core";
import { FrameRenderer } from "../dist/src/runtime.js";

const [backgroundPath, portraitPath, outputPath, browserPath] = process.argv.slice(2).map((value) => resolve(value));
if (!backgroundPath || !portraitPath || !outputPath || !browserPath) {
  throw new Error("Usage: node render-asset-specimen.mjs <background.png> <portrait.png> <output.png> <browser.exe>");
}
const background = await readFile(backgroundPath);
const portrait = await readFile(portraitPath);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const backgroundHash = sha(background);
const portraitHash = sha(portrait);
const frameRate = { numerator: 30, denominator: 1 };
const manifest = {
  id: "asset-transport-specimen",
  schemaVersion: 1,
  rendererVersion: "2.0.0-rc.0",
  target: { name: "landscape", width: 1280, height: 720, pixelRatio: 1, frameRate, colorSpace: "srgb-rec709" },
  scenes: [{
    id: "presenter-customization",
    kind: "presenter-slide",
    durationTicks: 2_400_000,
    seed: "asset-specimen-v1",
    content: {
      eyebrow: "CUSTOM STUDIO KIT",
      title: "Your presenter, your visual language",
      body: "Upload a portrait and background, then keep every render locally hash-bound.",
      items: [
        "A reserved side panel keeps a picture-in-picture presenter from covering the teaching copy.",
        "Three readable lines let a dense explanation remain complete without a clipped visual ellipsis.",
        "Every visible background and portrait remains hash-bound to its project provenance.",
      ],
    },
    captions: [{ id: "custom-caption", startTick: 0, endTick: 2_400_000, text: "Every visual choice stays traceable and export-safe." }],
    // Exercise the safety-critical mode: a presenter PIP gets a reserved
    // slide panel instead of obscuring bullets beneath it.
    metadata: { presenterName: "Minji", presenterPlacement: "picture_in_picture", presenterDisclosure: "Fictional synthetic presenter" },
    visualAssets: [
      { assetId: "background-owned", sha256: backgroundHash, role: "background", alt: "Modern abstract studio background", fit: "cover" },
      { assetId: "portrait-owned", sha256: portraitHash, role: "presenter-portrait", alt: "Selected synthetic presenter", fit: "cover" },
    ],
  }],
  outputDirectory: "C:\\alystria-specimen\\output",
  captionStyle: {
    position: "top",
    style: "solid-panel",
    sizePercent: 108,
    safeInsetPercent: 6,
    maxLines: 2,
    textColor: "#FFF4D6",
    panelColor: "#102033",
    fontFamily: "Atkinson Hyperlegible Next",
    fallbackFamilies: ["Arial", "sans-serif"],
  },
  visualAssets: [
    { id: "background-owned", path: "C:\\alystria-specimen\\visuals\\background.png", sha256: backgroundHash, mediaType: "image/png" },
    { id: "portrait-owned", path: "C:\\alystria-specimen\\visuals\\portrait.png", sha256: portraitHash, mediaType: "image/png" },
  ],
};
const rendered = new FrameRenderer({
  verifyRepeatability: true,
  visualAssetPayloads: [
    { id: "background-owned", sha256: backgroundHash, mediaType: "image/png", bytes: background },
    { id: "portrait-owned", sha256: portraitHash, mediaType: "image/png", bytes: portrait },
  ],
}).render(manifest, 24);
if (/(?:href|src)="(?:file|https?|data|blob):/i.test(rendered.svg)) throw new Error("Unsafe media URL escaped into SVG");
if (!rendered.svg.includes("alystria-asset:sha256/")) throw new Error("SVG lost its content-addressed references");

await mkdir(dirname(outputPath), { recursive: true });
const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true,
  args: ["--disable-gpu", "--disable-gpu-compositing", "--use-angle=swiftshader", "--disable-background-networking"],
});
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, colorScheme: "light", reducedMotion: "reduce" });
  await context.route("**/*", (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.setContent(rendered.html, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.renderReady === "true");
  const state = await page.evaluate(() => ({
    images: [...document.querySelectorAll("image")].map((image) => image.getAttribute("href")),
    error: document.body.dataset.renderError,
  }));
  if (state.error || state.images.length !== 2 || state.images.some((href) => !href?.startsWith("blob:"))) {
    throw new Error(`Browser asset mapping failed: ${JSON.stringify(state)}`);
  }
  await page.screenshot({ path: outputPath, type: "png" });
  await context.close();
} finally {
  await browser.close();
}
console.log(JSON.stringify({ outputPath, backgroundHash, portraitHash }));
