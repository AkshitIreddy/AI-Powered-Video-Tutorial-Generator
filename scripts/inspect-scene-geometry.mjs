#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { SPECIMEN_SCENES } from "../packages/scenes/dist/index.js";
import { inspectStructuralGeometry } from "../services/renderer/dist/src/geometry.js";
import { SceneViewStaticAdapter } from "../services/renderer/dist/src/scene-view.js";
import { fixtureTarget } from "../services/renderer/dist/src/fixture.js";

const requireFromRenderer = createRequire(new URL("../services/renderer/package.json", import.meta.url));
const { chromium } = requireFromRenderer("playwright-core");

const targets = [
  fixtureTarget({ name: "landscape", width: 1280, height: 720 }),
  fixtureTarget({ name: "portrait", width: 720, height: 1280 }),
  fixtureTarget({ name: "square", width: 1080, height: 1080 }),
];
const byKind = (kind) => {
  const specimen = SPECIMEN_SCENES.find((scene) => scene.content.kind === kind);
  if (!specimen) throw new Error(`Missing specimen ${kind}`);
  return specimen;
};
const localizedFixtures = [
  {
    locale: "es-ES",
    spec: {
      ...byKind("definition"),
      id: "locale.es.definition",
      content: {
        ...byKind("definition").content,
        title: "La idea, sin perder el significado",
        term: "Divide y vencerás",
        definition: "Divide un problema en subproblemas semejantes, resuélvelos y combina sus resultados sin ocultar ningún paso esencial.",
        example: "Karatsuba separa cada número en una parte alta y otra baja.",
      },
    },
  },
  {
    locale: "es-ES",
    spec: {
      ...byKind("worked-example"),
      id: "locale.es.worked-example",
      content: {
        ...byKind("worked-example").content,
        title: "Multiplica 1234 por 5678, paso a paso",
        problem: "Separa cada número después de dos cifras.",
        steps: [
          { id: "es.paso.1", text: "Separa las partes altas y bajas" },
          { id: "es.paso.2", text: "Calcula tres productos recursivos", supportingText: "Este paso cambia la tasa de crecimiento." },
          { id: "es.paso.3", text: "Reconstruye el término central" },
        ],
        answer: "1234 × 5678 = 7 006 652",
      },
    },
  },
  {
    locale: "hi-IN",
    spec: {
      ...byKind("definition"),
      id: "locale.hi.definition",
      content: {
        ...byKind("definition").content,
        title: "विचार को स्पष्ट रूप से समझें",
        term: "विभाजित करें और हल करें",
        definition: "समस्या को समान छोटी समस्याओं में बाँटें, उन्हें हल करें, फिर परिणामों को सही क्रम में जोड़ें।",
        example: "करात्सुबा प्रत्येक संख्या को ऊपरी और निचले भाग में बाँटता है।",
      },
    },
  },
  {
    locale: "hi-IN",
    spec: {
      ...byKind("quiz"),
      id: "locale.hi.quiz",
      content: {
        ...byKind("quiz").content,
        title: "अपनी समझ जाँचें",
        question: "हर विभाजन में करात्सुबा कितने पुनरावर्ती गुणन करता है?",
        options: [
          { id: "hi.a", label: "दो" },
          { id: "hi.b", label: "तीन", correct: true },
          { id: "hi.c", label: "चार" },
          { id: "hi.d", label: "आठ" },
        ],
        explanation: "मध्य पद को शेष तीन गुणनों से पुनर्निर्मित किया जाता है।",
      },
    },
  },
];
const chromiumPath = process.env.ALYSTRIA_CHROMIUM_PATH ?? chromium.executablePath();
const outputPath = resolve(process.argv[2] ?? "artifacts/scene-geometry-audit.json");
const browser = await chromium.launch({
  executablePath: chromiumPath,
  headless: true,
  args: ["--disable-background-networking", "--disable-gpu", "--disable-gpu-compositing", "--no-first-run"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const adapter = new SceneViewStaticAdapter();
const observations = [];
try {
  for (const target of targets) {
    await page.setViewportSize({ width: target.width, height: target.height });
    for (const spec of SPECIMEN_SCENES) {
      const ticks = [0, Math.floor(spec.durationTicks / 2), spec.durationTicks - 1];
      for (const tick of ticks) {
        const rendered = adapter.renderSpec(spec, target, tick);
        await page.setContent(rendered.html, { waitUntil: "domcontentloaded" });
        await page.evaluate(async () => { await document.fonts.ready; });
        const snapshot = await inspectStructuralGeometry(page, { width: target.width, height: target.height });
        observations.push({
          sceneId: spec.id,
          kind: spec.content.kind,
          target: target.name,
          tick,
          findings: snapshot.findings,
        });
      }
    }
  }
  for (const target of targets) {
    await page.setViewportSize({ width: target.width, height: target.height });
    for (const fixture of localizedFixtures) {
      const localizedAdapter = new SceneViewStaticAdapter({ locale: fixture.locale });
      const ticks = [0, Math.floor(fixture.spec.durationTicks / 2), fixture.spec.durationTicks - 1];
      for (const tick of ticks) {
        const rendered = localizedAdapter.renderSpec(fixture.spec, { ...target, name: `${target.name}-${fixture.locale}` }, tick);
        await page.setContent(rendered.html, { waitUntil: "domcontentloaded" });
        await page.evaluate(async () => { await document.fonts.ready; });
        const snapshot = await inspectStructuralGeometry(page, { width: target.width, height: target.height });
        observations.push({ sceneId: fixture.spec.id, kind: fixture.spec.content.kind, target: target.name, locale: fixture.locale, tick, findings: snapshot.findings });
      }
    }
  }
} finally {
  await context.close();
  await browser.close();
}
const findings = observations.flatMap((observation) => observation.findings.map((finding) => ({
  sceneId: observation.sceneId,
  kind: observation.kind,
  target: observation.target,
  locale: observation.locale ?? "en",
  tick: observation.tick,
  ...finding,
})));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  chromiumPath,
  specimenCount: SPECIMEN_SCENES.length,
  localizedFixtureCount: localizedFixtures.length,
  observationCount: observations.length,
  findingCount: findings.length,
  countsByCode: Object.fromEntries([...new Set(findings.map((finding) => finding.code))].sort().map((code) => [code, findings.filter((finding) => finding.code === code).length])),
  findings,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ outputPath, specimenCount: report.specimenCount, observationCount: report.observationCount, findingCount: report.findingCount, countsByCode: report.countsByCode })}\n`);
process.exitCode = findings.some((finding) => finding.severity === "error") ? 1 : 0;
