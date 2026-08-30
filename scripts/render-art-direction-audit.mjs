#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArguments(args) {
  const values = new Map();
  const switches = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--strict") { switches.add(token); continue; }
    if (token === "--help" || token === "-h") { switches.add("--help"); continue; }
    if (token !== "--output-dir" && token !== "--browser") throw new TypeError(`Unknown option ${token}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new TypeError(`${token} needs a value`);
    values.set(token, value);
    index += 1;
  }
  return { values, switches };
}

const HELP = `Alystria renderer art-direction audit

Usage:
  node scripts/render-art-direction-audit.mjs [--output-dir <path>] [--browser <chromium>] [--strict]

Build @alystria/scenes and @alystria/renderer first. The audit uses headless,
software-only pinned Chromium, renders representative scene families, writes
individual PNG evidence and a contact sheet, and exits non-zero on hard visual
quality findings. --strict also treats review warnings as failures.`;

const args = parseArguments(process.argv.slice(2));
if (args.switches.has("--help")) {
  process.stdout.write(`${HELP}\n`);
  process.exit(0);
}

const outputDirectory = resolve(args.values.get("--output-dir") ?? join(ROOT, "artifacts", "render-art-direction-audit"));
const frameDirectory = join(outputDirectory, "frames");
const dist = (path) => pathToFileURL(join(ROOT, path)).href;

async function loadBuiltModules() {
  const required = [
    "packages/scenes/dist/index.js",
    "services/renderer/dist/src/geometry.js",
    "services/renderer/dist/src/runtime.js",
    "services/renderer/dist/tests/visual-policy.js",
  ];
  for (const path of required) {
    try { await access(join(ROOT, path), constants.R_OK); }
    catch { throw new Error(`Missing ${path}. Run: corepack pnpm --filter @alystria/scenes build && corepack pnpm --filter @alystria/renderer build`); }
  }
  const [scenes, geometry, runtime, policy] = await Promise.all([
    import(dist("packages/scenes/dist/index.js")),
    import(dist("services/renderer/dist/src/geometry.js")),
    import(dist("services/renderer/dist/src/runtime.js")),
    import(dist("services/renderer/dist/tests/visual-policy.js")),
  ]);
  return { scenes, geometry, runtime, policy };
}

function resolvedSceneFromSpec(spec) {
  const content = spec.content;
  const itemCandidates = [
    ...(Array.isArray(content.items) ? content.items.map((item) => typeof item === "string" ? item : item.text) : []),
    ...(Array.isArray(content.steps) ? content.steps.map((item) => typeof item === "string" ? item : item.text ?? item.expression ?? item.label) : []),
    ...(Array.isArray(content.options) ? content.options.map((item) => item.label) : []),
  ].filter(Boolean);
  return {
    id: spec.id,
    kind: content.kind,
    durationTicks: spec.durationTicks,
    seed: `visual-audit-${spec.seed}`,
    accessibilityDescription: spec.accessibilityDescription,
    content: {
      title: content.title,
      ...(content.eyebrow ? { eyebrow: content.eyebrow } : {}),
      ...(content.subtitle ? { body: content.subtitle } : {}),
      ...(itemCandidates.length ? { items: itemCandidates } : {}),
    },
    // The cue spans every temporal sample. A clean-master default must
    // therefore prove it did not draw the cue at transitions or settled ticks.
    captions: [{
      id: `${spec.id}.audit-caption`,
      startTick: 0,
      endTick: spec.durationTicks,
      text: "This caption belongs in the YouTube-ready sidecar, not on the clean master.",
      position: "bottom",
    }],
    metadata: { compositionFamily: "audit-derived" },
  };
}

const browserInspection = ({ width, height }) => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    let opacity = 1;
    let current = element;
    while (current) {
      const style = getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden") return false;
      opacity *= Math.min(1, Math.max(0, Number.parseFloat(style.opacity || "1")));
      current = current.parentElement;
    }
    return opacity > 0.01;
  };
  const texts = [...document.querySelectorAll("svg text, svg foreignObject div")].filter(visible);
  const safeInsetX = width * 0.05;
  const safeInsetY = height * 0.05;
  let textOutsideFrameCount = 0;
  let textInsideUnsafeMarginCount = 0;
  let tinyTextCount = 0;

  for (const element of texts) {
    const rect = element.getBoundingClientRect();
    if (rect.left < -0.5 || rect.top < -0.5 || rect.right > width + 0.5 || rect.bottom > height + 0.5) textOutsideFrameCount += 1;
    const semantic = element.closest("[data-semantic-role]");
    if (semantic && !element.closest("[aria-hidden='true']") && (rect.left < safeInsetX || rect.top < safeInsetY || rect.right > width - safeInsetX || rect.bottom > height - safeInsetY)) textInsideUnsafeMarginCount += 1;
    const fontSize = Number.parseFloat(getComputedStyle(element).fontSize || "0");
    if (fontSize > 0 && fontSize < 16) tinyTextCount += 1;
  }

  const overflowingContainerCount = [...document.querySelectorAll("foreignObject div")]
    .filter((element) => visible(element) && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)).length;
  const cardCount = document.querySelectorAll("[data-plane-tone]").length;
  const pillLikeShapeCount = [...document.querySelectorAll("svg rect")].filter((element) => {
    const rect = element.getBoundingClientRect();
    const rx = Number.parseFloat(element.getAttribute("rx") ?? "0");
    return rect.height >= 16 && rect.height <= height * 0.16 && rect.width >= rect.height * 1.8 && rx >= rect.height * 0.28;
  }).length;

  return {
    visibleWordCount: texts.map((element) => element.textContent ?? "").join(" ").trim().split(/\s+/u).filter(Boolean).length,
    textOutsideFrameCount,
    textInsideUnsafeMarginCount,
    overflowingContainerCount,
    cardCount,
    pillLikeShapeCount,
    captionOverlayCount: document.querySelectorAll("[data-caption-id]").length,
    tinyTextCount,
  };
};

async function inspectPixels(page, imagePath) {
  const bytes = await readFile(imagePath);
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
  return page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const lumas = [];
    const buckets = new Set();
    let edge = 0;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const offset = (y * canvas.width + x) * 4;
        const r = pixels[offset] ?? 0;
        const g = pixels[offset + 1] ?? 0;
        const b = pixels[offset + 2] ?? 0;
        const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
        lumas.push(luma);
        buckets.add(`${r >> 4}:${g >> 4}:${b >> 4}`);
        if (x > 0) {
          const previous = offset - 4;
          const previousLuma = (pixels[previous] ?? 0) * 0.2126 + (pixels[previous + 1] ?? 0) * 0.7152 + (pixels[previous + 2] ?? 0) * 0.0722;
          edge += Math.abs(luma - previousLuma);
        }
      }
    }
    const mean = lumas.reduce((sum, value) => sum + value, 0) / lumas.length;
    const variance = lumas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lumas.length;
    return {
      lumaStandardDeviation: Math.sqrt(variance),
      colorBucketCount: buckets.size,
      edgeEnergy: edge / Math.max(1, lumas.length),
    };
  }, dataUrl);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

async function writeReviewerArtifacts(page, observations, findings, frames) {
  const hardFindingCount = findings.filter((item) => item.severity === "error").length;
  const warningCount = findings.filter((item) => item.severity === "warning").length;
  const strict = args.switches.has("--strict");
  const failed = hardFindingCount > 0 || (strict && warningCount > 0);
  const findingsByScene = new Map();
  const findingsBySample = new Map();
  for (const item of findings) {
    if (!item.sceneId) continue;
    if (item.sampleId) {
      const sampleFindings = findingsBySample.get(item.sampleId) ?? [];
      sampleFindings.push(item);
      findingsBySample.set(item.sampleId, sampleFindings);
      continue;
    }
    const existing = findingsByScene.get(item.sceneId) ?? [];
    existing.push(item);
    findingsByScene.set(item.sceneId, existing);
  }
  const cards = [];
  for (const [index, frame] of frames.entries()) {
    const observation = observations[index];
    const data = (await readFile(frame.path)).toString("base64");
    const sceneFindings = [
      ...(findingsByScene.get(observation.sceneId) ?? []),
      ...(findingsBySample.get(observation.sampleId) ?? []),
    ];
    const errors = sceneFindings.filter((item) => item.severity === "error").length;
    const warnings = sceneFindings.filter((item) => item.severity === "warning").length;
    const contrastSummary = observation.unmeasurableContrastTextCount
      ? `${observation.unmeasurableContrastTextCount} unknown contrast`
      : observation.lowContrastTextCount
        ? `${observation.lowContrastTextCount} contrast fail`
        : `contrast ≥ ${observation.minimumTextContrastRatio?.toFixed(2) ?? "n/a"}`;
    cards.push(`<article><header><span>${String(index + 1).padStart(2, "0")} / ${escapeHtml(observation.kind)} / ${escapeHtml(observation.sampleLabel)}</span><strong class="${errors ? "bad" : warnings ? "warn" : "good"}">${errors ? `${errors} error` : warnings ? `${warnings} review` : "pass"}</strong></header><img alt="${escapeHtml(observation.sampleId)}" src="data:image/png;base64,${data}"><footer>local ${observation.localFrame} · ${escapeHtml(observation.family)} · ${observation.visibleWordCount} words · ${escapeHtml(contrastSummary)}</footer></article>`);
  }
  const globalFindings = findings.filter((item) => !item.sceneId);
  const document = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} html,body{margin:0;background:#10131f;color:#f7f8fc;font-family:Arial,sans-serif} body{padding:34px}
    h1{font-size:34px;margin:0 0 8px} .meta{color:#aeb5cb;margin-bottom:28px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
    article{background:#191d2c;border:1px solid #30364b;border-radius:14px;overflow:hidden}header,footer{height:42px;padding:11px 14px;display:flex;justify-content:space-between;gap:12px;font-size:14px}footer{height:38px;color:#aeb5cb;padding-top:9px}
    img{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#05060a}.good{color:#69d6c5}.warn{color:#f4b45b}.bad{color:#ef7892}
    .global{margin-top:26px;padding:16px;border:1px solid #30364b;border-radius:12px;color:#f4b45b}
  </style></head><body><h1>Alystria art-direction review</h1><div class="meta">Representative authoritative frames · clean-master, typography, geometry, density, and composition policy</div><section class="grid">${cards.join("")}</section>${globalFindings.length ? `<div class="global">${globalFindings.map((item) => `${escapeHtml(item.code)}: ${escapeHtml(item.message)}`).join("<br>")}</div>` : ""}</body></html>`;
  const htmlPath = join(outputDirectory, "contact-sheet.html");
  await writeFile(htmlPath, document, "utf8");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.setContent(document, { waitUntil: "load" });
  await page.screenshot({ path: join(outputDirectory, "contact-sheet.png"), fullPage: true, animations: "disabled", caret: "hide" });

  const report = [
    "# Alystria renderer art-direction audit",
    "",
    `- Result: ${failed ? "FAIL" : warningCount ? "PASS WITH REVIEW WARNINGS" : "PASS"}`,
    `- Policy mode: ${strict ? "strict (warnings fail)" : "standard"}`,
    `- Representative frames: ${observations.length}`,
    `- Hard findings: ${hardFindingCount}`,
    `- Review warnings: ${warningCount}`,
    "- Caption expectation: clean master, no open captions",
    "",
    "| Scene sample | Family | Frames | Words | Cards | Pills | Geometry | Result |",
    "|---|---:|---:|---:|---:|---:|---:|---|",
    ...observations.map((item) => {
      const local = [...(findingsByScene.get(item.sceneId) ?? []), ...(findingsBySample.get(item.sampleId) ?? [])];
      const geometryCount = item.geometryTextIntersectionCount + item.geometryOutsideFrameCount + item.geometryOutsideSafeAreaCount + item.geometryContainerOverflowCount + item.geometryLineLimitCount;
      return `| ${item.kind} / ${item.sampleLabel} | ${item.family} | ${item.localFrame}/${item.globalFrame} | ${item.visibleWordCount} | ${item.cardCount} | ${item.pillLikeShapeCount} | ${geometryCount} | ${local.some((finding) => finding.severity === "error") ? "FAIL" : local.length ? "REVIEW" : "PASS"} |`;
    }),
    "",
    "## Contrast evidence",
    "",
    "Chromium contrast is measured from pixel-identical-layout normal, text-transparent, black-text-probe, and white-text-probe captures. The probe difference identifies glyph positions even when the intended text disappears into its backdrop. The 5th-percentile glyph/backdrop ratio is checked at 4.5:1 for normal text or 3:1 for large text; the raw minimum is retained for review.",
    "",
    ...observations.flatMap((item) => (item.textContrastMeasurements ?? [])
      .filter((measurement) => measurement.status !== "pass")
      .map((measurement) => {
        const label = String(measurement.text || "(empty text)").replace(/\|/gu, "\\|");
        if (measurement.status === "unmeasurable") return `- **${item.kind} · ${label}**: unmeasurable — ${measurement.reason ?? "unknown paint"}`;
        return `- **${item.kind} · ${label}**: ${measurement.contrastRatio.toFixed(2)}:1 measured, ${measurement.requiredRatio}:1 required (raw minimum ${measurement.rawMinimumRatio?.toFixed(2) ?? "n/a"}:1).`;
      })),
    ...(observations.every((item) => (item.textContrastMeasurements ?? []).every((measurement) => measurement.status === "pass")) ? ["- All measured text passes."] : []),
    "",
    "## Findings",
    "",
    ...(findings.length ? findings.map((item) => `- **${item.severity.toUpperCase()} ${item.code}**${item.sceneId ? ` (${item.sceneId}${item.sampleId ? ` / ${item.sampleId}` : ""})` : ""}: ${item.message}`) : ["- None."]),
    "",
  ].join("\n");
  await writeFile(join(outputDirectory, "audit-report.md"), report, "utf8");
  await writeFile(join(outputDirectory, "audit-report.json"), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    policyMode: strict ? "strict" : "standard",
    result: failed ? "fail" : "pass",
    observations,
    findings,
  }, null, 2)}\n`, "utf8");
}

async function main() {
  await mkdir(frameDirectory, { recursive: true });
  const { scenes, geometry, runtime, policy } = await loadBuiltModules();
  const selectedKinds = [
    "title", "definition", "diagram", "comparison", "worked-example", "code",
    "file-tree", "graph", "presenter-slide", "question", "quiz", "summary", "outro",
  ];
  const specs = selectedKinds.map((kind) => scenes.specimenFor(kind));
  const specById = new Map(specs.map((spec) => [spec.id, spec]));
  const target = { name: "landscape", width: 1280, height: 720, pixelRatio: 1, frameRate: { numerator: 30, denominator: 1 }, colorSpace: "srgb-rec709", safeArea: { top: 36, right: 64, bottom: 36, left: 64 } };
  const manifest = {
    id: "art-direction-audit",
    schemaVersion: 1,
    rendererVersion: runtime.RENDERER_VERSION,
    target,
    outputDirectory,
    metadata: { fixture: "art-direction-audit", locale: "en-US" },
    scenes: specs.map(resolvedSceneFromSpec),
  };
  const renderer = new runtime.FrameRenderer({
    verifyRepeatability: true,
    sceneSpecResolver: (scene) => specById.get(scene.id),
    sceneView: { reducedMotion: false, locale: "en-US" },
  });

  // playwright-core is deliberately scoped to the renderer workspace rather
  // than hoisted as an undeclared root dependency.
  const playwright = await import(dist("services/renderer/node_modules/playwright-core/index.mjs"));
  const executablePath = resolve(args.values.get("--browser") ?? playwright.chromium.executablePath());
  await access(executablePath, constants.R_OK);
  const browser = await playwright.chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--disable-background-networking", "--disable-component-update", "--disable-default-apps",
      "--disable-domain-reliability", "--disable-features=MediaRouter,OptimizationHints,Translate",
      "--disable-sync", "--metrics-recording-only", "--no-first-run", "--no-pings",
      "--disable-gpu", "--disable-gpu-compositing", "--use-angle=swiftshader",
    ],
  });
  const context = await browser.newContext({
    viewport: { width: target.width, height: target.height },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "no-preference",
    serviceWorkers: "block",
  });
  await context.route("**/*", (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  const frames = [];
  const observations = [];
  let startFrame = 0;
  try {
    for (const [index, spec] of specs.entries()) {
      const sceneFrameCount = Math.round(spec.durationTicks / 240_000 * 30);
      const requestedSamples = [
        { label: "entry-transition", localFrame: 0 },
        { label: "entry-settled", localFrame: Math.floor(sceneFrameCount * 0.12) },
        { label: "middle", localFrame: Math.floor(sceneFrameCount * 0.5) },
        { label: "exit-motion", localFrame: Math.floor(sceneFrameCount * 0.88) },
        { label: "exit-transition", localFrame: Math.max(0, sceneFrameCount - 1) },
      ];
      const sampledFrames = requestedSamples.filter((sample, sampleIndex, samples) =>
        samples.findIndex((candidate) => candidate.localFrame === sample.localFrame) === sampleIndex,
      );
      for (const [sampleIndex, sample] of sampledFrames.entries()) {
        const globalFrame = startFrame + sample.localFrame;
        const sampleId = `${spec.id}:${sample.label}:${globalFrame}`;
        const rendered = renderer.render(manifest, globalFrame, "final");
        await page.setViewportSize({ width: target.width, height: target.height });
        await page.setContent(rendered.html, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => document.body?.dataset.renderReady === "true");
        await page.evaluate(async () => {
          const fontReady = globalThis.__alystriaFontReady;
          if (fontReady) await fontReady;
          await document.fonts.ready;
          await new Promise((done) => requestAnimationFrame(() => done()));
          await new Promise((done) => requestAnimationFrame(() => done()));
        });
        const path = join(frameDirectory, `${String(index + 1).padStart(2, "0")}-${String(sampleIndex + 1).padStart(2, "0")}-${spec.content.kind}-${sample.label}.png`);
        const metrics = await page.evaluate(browserInspection, { width: target.width, height: target.height });
        const structuralGeometry = await geometry.inspectStructuralGeometry(page, {
          width: target.width,
          height: target.height,
          safeArea: target.safeArea,
        });
        const countGeometry = (code) => structuralGeometry.findings.filter((finding) => finding.code === code).length;
        const contrastInspection = await policy.inspectRenderedTextContrast(page);
        await writeFile(path, contrastInspection.normalPng);
        const pixels = await inspectPixels(page, path);
        observations.push({
          sceneId: spec.id,
          sampleId,
          sampleLabel: sample.label,
          localFrame: sample.localFrame,
          globalFrame,
          kind: spec.content.kind,
          family: policy.compositionFamilyForKind(spec.content.kind),
          ...metrics,
          lowContrastTextCount: contrastInspection.lowContrastTextCount,
          unmeasurableContrastTextCount: contrastInspection.unmeasurableContrastTextCount,
          minimumTextContrastRatio: contrastInspection.minimumTextContrastRatio,
          textContrastMeasurements: contrastInspection.measurements,
          geometryElementCount: structuralGeometry.elements.length,
          geometryTextIntersectionCount: countGeometry("geometry.text-intersection"),
          geometryOutsideFrameCount: countGeometry("geometry.outside-frame"),
          geometryOutsideSafeAreaCount: countGeometry("geometry.outside-safe-area"),
          geometryContainerOverflowCount: countGeometry("geometry.container-overflow"),
          geometryLineLimitCount: countGeometry("geometry.line-limit"),
          geometryFindings: structuralGeometry.findings,
          ...pixels,
        });
        frames.push({ path, sceneId: spec.id, sampleId });
      }
      startFrame += sceneFrameCount;
    }
    const findings = policy.auditVisualObservations(observations);
    await writeReviewerArtifacts(page, observations, findings, frames);
    const errors = findings.filter((item) => item.severity === "error").length;
    const warnings = findings.filter((item) => item.severity === "warning").length;
    process.stdout.write(`${JSON.stringify({
      result: errors || (args.switches.has("--strict") && warnings) ? "fail" : "pass",
      chromium: browser.version(),
      executablePath,
      frames: observations.length,
      errors,
      warnings,
      contactSheet: join(outputDirectory, "contact-sheet.png"),
      report: join(outputDirectory, "audit-report.md"),
      relativeOutput: relative(ROOT, outputDirectory),
    }, null, 2)}\n`);
    if (errors || (args.switches.has("--strict") && warnings)) process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

await main();
