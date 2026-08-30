#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { SceneView, compileScene, specimenFor } from "../packages/scenes/dist/index.js";

const output = process.argv[2];
if (!output) throw new Error("Usage: node render-locale-board.mjs <output.html>");
const requireFromScenes = createRequire(new URL("../packages/scenes/package.json", import.meta.url));
const { createElement } = requireFromScenes("react");
const { renderToStaticMarkup } = requireFromScenes("react-dom/server");
const definition = specimenFor("definition");
const worked = specimenFor("worked-example");
const quiz = specimenFor("quiz");
const cases = [
  {
    label: "Español · definición · 1280×720",
    locale: "es-ES",
    target: { width: 1280, height: 720, fps: 30 },
    spec: { ...definition, id: "board.es.definition", content: { ...definition.content, title: "La idea, sin perder el significado", term: "Divide y vencerás", definition: "Divide un problema en subproblemas semejantes, resuélvelos y combina sus resultados sin ocultar ningún paso esencial.", example: "Karatsuba separa cada número en una parte alta y otra baja." } },
  },
  {
    label: "हिन्दी · परिभाषा · 1280×720",
    locale: "hi-IN",
    target: { width: 1280, height: 720, fps: 30 },
    spec: { ...definition, id: "board.hi.definition", content: { ...definition.content, title: "विचार को स्पष्ट रूप से समझें", term: "विभाजित करें और हल करें", definition: "समस्या को समान छोटी समस्याओं में बाँटें, उन्हें हल करें, फिर परिणामों को सही क्रम में जोड़ें।", example: "करात्सुबा प्रत्येक संख्या को ऊपरी और निचले भाग में बाँटता है।" } },
  },
  {
    label: "Español · ejemplo · 720×1280",
    locale: "es-ES",
    target: { width: 720, height: 1280, fps: 30 },
    spec: { ...worked, id: "board.es.worked", content: { ...worked.content, title: "Multiplica 1234 por 5678, paso a paso", problem: "Separa cada número después de dos cifras.", steps: [{ id: "es.1", text: "Separa las partes altas y bajas" }, { id: "es.2", text: "Calcula tres productos recursivos", supportingText: "Este paso cambia la tasa de crecimiento." }, { id: "es.3", text: "Reconstruye el término central" }], answer: "1234 × 5678 = 7 006 652" } },
  },
  {
    label: "हिन्दी · प्रश्न · 720×1280",
    locale: "hi-IN",
    target: { width: 720, height: 1280, fps: 30 },
    spec: { ...quiz, id: "board.hi.quiz", content: { ...quiz.content, title: "अपनी समझ जाँचें", question: "हर विभाजन में करात्सुबा कितने पुनरावर्ती गुणन करता है?", options: [{ id: "hi.a", label: "दो" }, { id: "hi.b", label: "तीन", correct: true }, { id: "hi.c", label: "चार" }, { id: "hi.d", label: "आठ" }], explanation: "मध्य पद को शेष तीन गुणनों से पुनर्निर्मित किया जाता है।" } },
  },
  {
    label: "Español · pregunta · 1080×1080",
    locale: "es-ES",
    target: { width: 1080, height: 1080, fps: 30 },
    spec: { ...quiz, id: "board.es.quiz", content: { ...quiz.content, title: "Comprueba lo aprendido", question: "¿Cuántos productos recursivos calcula Karatsuba en cada división?", options: [{ id: "es.a", label: "Dos" }, { id: "es.b", label: "Tres", correct: true }, { id: "es.c", label: "Cuatro" }, { id: "es.d", label: "Ocho" }], explanation: "El término central se reconstruye a partir de los otros tres productos." } },
  },
  {
    label: "हिन्दी · उदाहरण · 1080×1080",
    locale: "hi-IN",
    target: { width: 1080, height: 1080, fps: 30 },
    spec: { ...worked, id: "board.hi.worked", content: { ...worked.content, title: "1234 × 5678 को चरणों में हल करें", problem: "दो अंकों के बाद दोनों संख्याओं को बाँटें।", steps: [{ id: "hi.1", text: "ऊपरी और निचले भाग अलग करें" }, { id: "hi.2", text: "तीन पुनरावर्ती गुणन निकालें" }, { id: "hi.3", text: "मध्य पद को फिर से बनाएँ" }], answer: "1234 × 5678 = 70,06,652" } },
  },
];
const cards = cases.map((item) => {
  const scene = compileScene(item.spec, { ...item.target, locale: item.locale });
  const svg = renderToStaticMarkup(createElement(SceneView, { scene, frame: { tick: Math.floor(item.spec.durationTicks * 0.72), reducedMotion: false } }));
  const portrait = item.target.height > item.target.width;
  return `<figure class="${portrait ? "portrait" : "standard"}">${svg}<figcaption lang="${item.locale}">${item.label}</figcaption></figure>`;
}).join("");
await writeFile(resolve(output), `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:28px;background:#e7e9f2;font-family:Segoe UI,Nirmala UI,Noto Sans Devanagari,sans-serif}.board{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;align-items:start}figure{margin:0;background:white;border:1px solid #cbd0df;box-shadow:0 10px 28px #1518271c}svg{display:block;width:100%;height:auto}.portrait svg{height:880px;width:auto;margin:auto}figcaption{padding:12px 15px;border-top:1px solid #daddE8;font-weight:700}</style></head><body><main class="board">${cards}</main></body></html>`, "utf8");
