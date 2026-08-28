import { writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SceneView, compileScene, specimenFor } from "../dist/index.js";

const output = process.argv[2];
if (!output) throw new Error("Usage: node render-specimen-board.mjs <output.html>");
const requestedKind = process.argv[3];

const specimens = [
  ["title", { width: 1920, height: 1080, fps: 30 }],
  ["diagram", { width: 1920, height: 1080, fps: 30 }],
  ["code", { width: 1920, height: 1080, fps: 30 }],
  ["chart", { width: 1080, height: 1080, fps: 30 }],
  ["presenter-slide", { width: 1080, height: 1920, fps: 30 }],
  ["quiz", { width: 1080, height: 1920, fps: 30 }],
];

const selected = requestedKind ? specimens.filter(([kind]) => kind === requestedKind) : specimens;
if (selected.length === 0) throw new Error(`Unknown specimen ${requestedKind}`);

const cards = selected.map(([kind, target]) => {
  const scene = compileScene(specimenFor(kind), target);
  const svg = renderToStaticMarkup(createElement(SceneView, { scene, frame: { tick: 720_000, reducedMotion: false } }));
  return `<figure class="${target.height > target.width ? "portrait" : "wide"}">${svg}<figcaption>${kind} · ${target.width}×${target.height}</figcaption></figure>`;
}).join("");

writeFileSync(output, `<!doctype html><meta charset="utf-8"><title>Alystria scene specimens</title><style>
*{box-sizing:border-box} body{margin:0;background:#e6e8f1;color:#151827;font-family:Segoe UI,sans-serif;padding:28px}
h1{margin:0 0 20px;font-size:26px}.board{display:grid;grid-template-columns:${requestedKind ? "1fr" : "repeat(3,1fr)"};gap:24px;align-items:start;max-width:${requestedKind ? "1100px" : "none"};margin:auto}
figure{margin:0;background:#fff;border:1px solid #cdd2e1;border-radius:14px;box-shadow:0 10px 30px rgba(21,24,39,.11);overflow:hidden}
figure svg{display:block;width:100%;height:auto}figure.portrait svg{height:${requestedKind ? "900px" : "330px"};width:auto;margin:auto}figcaption{padding:10px 14px;font:600 13px ui-monospace,monospace;border-top:1px solid #e2e4ec}
</style><h1>Alystria Studio — deterministic scene specimen board</h1><main class="board">${cards}</main>`);
