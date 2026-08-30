import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SceneView, compileScene, specimenFor } from "../dist/index.js";

const output = process.argv[2];
if (!output) throw new Error("Usage: node render-specimen-board.mjs <output.html>");
const requestedKind = process.argv[3];
const backgroundPath = resolve("apps/desktop/src/assets/backgrounds/modern-tech-signal-v1.png");
const portraitPath = resolve("apps/desktop/src/assets/presenters/modern-tech-minji-v1.png");
const backgroundBytes = readFileSync(backgroundPath);
const portraitBytes = readFileSync(portraitPath);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const background = { id: "background.modern-tech-signal-v1", sha256: digest(backgroundBytes), alt: "Owned modern signal background", fit: "cover" };
const portrait = { id: "presenter-portrait.modern-tech-minji-v1", sha256: digest(portraitBytes), alt: "Owned fictional synthetic presenter", fit: "cover" };
const assetUrls = {
  [`alystria-asset:sha256/${background.sha256}`]: `data:image/png;base64,${backgroundBytes.toString("base64")}`,
  [`alystria-asset:sha256/${portrait.sha256}`]: `data:image/png;base64,${portraitBytes.toString("base64")}`,
};

const hd = { width: 1280, height: 720, fps: 30 };
const specimens = [
  ["title", hd],
  ["definition", hd],
  ["comparison", hd],
  ["diagram", hd],
  ["worked-example", hd],
  ["code", hd],
  ["graph", hd],
  ["presenter-slide", hd],
  ["quiz", hd],
  ["outro", hd],
  ["chart", { width: 1080, height: 1080, fps: 30 }],
  ["presenter-slide", { width: 1080, height: 1920, fps: 30 }],
];

const selected = requestedKind ? specimens.filter(([kind]) => kind === requestedKind) : specimens;
if (selected.length === 0) throw new Error(`Unknown specimen ${requestedKind}`);

const cards = selected.map(([kind, target]) => {
  const base = specimenFor(kind);
  const presenter = base.content.kind === "presenter" || base.content.kind === "presenter-slide";
  const scene = compileScene({
    ...base,
    content: {
      ...base.content,
      background,
      ...(presenter ? {
        portrait,
        presenterName: "Pinned synthetic replay guide for end-to-end validation",
        disclosure: "Previously generated synthetic presenter replay",
      } : {}),
    },
  }, target);
  const svg = renderToStaticMarkup(createElement(SceneView, {
    scene,
    frame: { tick: 720_000, reducedMotion: false },
    resolveAsset: (asset) => `alystria-asset:sha256/${asset.sha256}`,
  }));
  return `<figure class="${target.height > target.width ? "portrait" : "wide"}">${svg}<figcaption>${kind} · ${target.width}×${target.height}</figcaption></figure>`;
}).join("");

writeFileSync(output, `<!doctype html><meta charset="utf-8"><title>Alystria scene specimens</title><style>
*{box-sizing:border-box} body{margin:0;background:#e6e8f1;color:#151827;font-family:Segoe UI,sans-serif;padding:28px}
h1{margin:0 0 20px;font-size:26px}.board{display:grid;grid-template-columns:${requestedKind ? "1fr" : "repeat(3,1fr)"};gap:24px;align-items:start;max-width:${requestedKind ? "1100px" : "none"};margin:auto}
figure{margin:0;background:#fff;border:1px solid #cdd2e1;border-radius:14px;box-shadow:0 10px 30px rgba(21,24,39,.11);overflow:hidden}
figure svg{display:block;width:100%;height:auto}figure.portrait svg{height:${requestedKind ? "900px" : "330px"};width:auto;margin:auto}figcaption{padding:10px 14px;font:600 13px ui-monospace,monospace;border-top:1px solid #e2e4ec}
</style><h1>Alystria Studio — deterministic asset-backed specimen board</h1><main class="board">${cards}</main><script>
const assetUrls=${JSON.stringify(assetUrls)};
for (const image of document.querySelectorAll("image")) {
  const href=image.getAttribute("href");
  if (href && assetUrls[href]) image.setAttribute("href", assetUrls[href]);
}
document.body.dataset.assetsReady="true";
</script>`);
