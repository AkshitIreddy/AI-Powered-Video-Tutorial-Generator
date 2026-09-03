import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import {
  auditVisualObservations,
  compositionFamilyForKind,
  inspectRenderedTextContrast,
  type VisualFrameObservation,
} from "./visual-policy.js";
import {
  analyzeStructuralGeometry,
  inspectStructuralGeometry,
  type RenderedGeometryElement,
  type StructuralGeometryFinding,
} from "../src/geometry.js";
import { specimenFor } from "@alystria/scenes";
import { fixtureTarget } from "../src/fixture.js";
import { SceneViewStaticAdapter } from "../src/scene-view.js";

function observation(overrides: Partial<VisualFrameObservation> = {}): VisualFrameObservation {
  return {
    sceneId: "scene.title",
    sampleId: "scene.title:middle:12",
    sampleLabel: "middle",
    localFrame: 12,
    globalFrame: 12,
    kind: "title",
    family: "cinematic-scale",
    visibleWordCount: 18,
    textOutsideFrameCount: 0,
    textInsideUnsafeMarginCount: 0,
    overflowingContainerCount: 0,
    cardCount: 0,
    pillLikeShapeCount: 0,
    captionOverlayCount: 0,
    tinyTextCount: 0,
    lowContrastTextCount: 0,
    unmeasurableContrastTextCount: 0,
    minimumTextContrastRatio: 12,
    lumaStandardDeviation: 38,
    colorBucketCount: 64,
    edgeEnergy: 12,
    geometryElementCount: 12,
    geometryTextIntersectionCount: 0,
    geometryOutsideFrameCount: 0,
    geometryOutsideSafeAreaCount: 0,
    geometryContainerOverflowCount: 0,
    geometryLineLimitCount: 0,
    geometryFindings: [],
    ...overrides,
  };
}

const chromiumPath = process.env.ALYSTRIA_CHROMIUM_PATH ?? chromium.executablePath();
const canRunChromiumContrastTest = existsSync(chromiumPath);

test("composition families express educational visual beats", () => {
  assert.equal(compositionFamilyForKind("title"), "cinematic-scale");
  assert.equal(compositionFamilyForKind("diagram"), "diagram");
  assert.equal(compositionFamilyForKind("worked-example"), "worked-example");
  assert.equal(compositionFamilyForKind("presenter-slide"), "presenter");
  assert.equal(compositionFamilyForKind("plugin:example/custom"), "object-stage");
});

test("clean varied observations pass the hard art-direction policy", () => {
  const families = ["title", "definition", "diagram", "comparison", "worked-example", "code", "graph", "outro"];
  const observations = families.map((kind, index) => observation({
    sceneId: `scene.${index}`,
    kind,
    family: compositionFamilyForKind(kind),
  }));
  assert.deepEqual(auditVisualObservations(observations), []);
});

test("multiple temporal samples count as coverage for one scene without inventing repeated compositions", () => {
  const kinds = ["title", "definition", "diagram", "comparison", "worked-example", "code", "graph", "outro"];
  const observations = kinds.flatMap((kind, sceneIndex) =>
    ["entry-transition", "entry-settled", "middle", "exit-motion", "exit-transition"].map((sampleLabel, sampleIndex) => observation({
      sceneId: `scene.${sceneIndex}`,
      sampleId: `scene.${sceneIndex}:${sampleLabel}:${sampleIndex}`,
      sampleLabel,
      localFrame: sampleIndex * 12,
      globalFrame: sceneIndex * 60 + sampleIndex * 12,
      kind,
      family: compositionFamilyForKind(kind),
    })),
  );
  assert.deepEqual(auditVisualObservations(observations), []);
});

test("post-font structural geometry findings are hard-gate failures with exact renderer codes", () => {
  const rect = { x: 12, y: 12, width: 80, height: 24 };
  const geometryFindings: readonly StructuralGeometryFinding[] = [
    { severity: "error", code: "geometry.text-intersection", elementIds: ["a", "b"], message: "Visible text intersects.", rects: [rect] },
    { severity: "error", code: "geometry.outside-frame", elementIds: ["a"], message: "Text crosses the frame.", rects: [rect] },
    { severity: "error", code: "geometry.outside-safe-area", elementIds: ["a"], message: "Text crosses graphics safe.", rects: [rect] },
    { severity: "error", code: "geometry.container-overflow", elementIds: ["a"], message: "Text exceeds its planned box.", rects: [rect] },
    { severity: "error", code: "geometry.line-limit", elementIds: ["a"], message: "Text exceeds its line limit.", rects: [rect] },
  ];
  const kinds = ["title", "definition", "diagram", "comparison", "worked-example", "code", "graph", "outro"];
  const observations = kinds.map((kind, index) => observation({
    sceneId: `scene.${index}`,
    sampleId: `scene.${index}:middle:${index}`,
    kind,
    family: compositionFamilyForKind(kind),
    ...(index === 2 ? {
      geometryTextIntersectionCount: 1,
      geometryOutsideFrameCount: 1,
      geometryOutsideSafeAreaCount: 1,
      geometryContainerOverflowCount: 1,
      geometryLineLimitCount: 1,
      geometryFindings,
    } : {}),
  }));
  const findings = auditVisualObservations(observations);
  const byCode = new Map(findings.map((finding) => [finding.code, finding]));
  for (const expected of geometryFindings.map((finding) => finding.code)) {
    assert.equal(byCode.get(expected)?.severity, "error", `missing hard failure ${expected}`);
    assert.equal(byCode.get(expected)?.sampleId, "scene.2:middle:2");
  }
});

test("audit rejects caption overlays, unsafe type, dashboard grids, and repeated composition", () => {
  const observations = Array.from({ length: 8 }, (_, index) => observation({
    sceneId: `scene.${index}`,
    kind: "definition",
    family: "object-stage",
    visibleWordCount: index === 0 ? 140 : 20,
    textOutsideFrameCount: index === 1 ? 1 : 0,
    textInsideUnsafeMarginCount: index === 2 ? 1 : 0,
    overflowingContainerCount: index === 3 ? 1 : 0,
    cardCount: 3,
    pillLikeShapeCount: 5,
    captionOverlayCount: index === 4 ? 1 : 0,
  }));
  const codes = new Set(auditVisualObservations(observations).map((item) => item.code));
  for (const expected of [
    "captions.clean-master",
    "text.outside-frame",
    "text.unsafe-margin",
    "text.container-overflow",
    "text.excessive",
    "composition.card-grid",
    "composition.repeated-three",
    "composition.dashboard-repetition",
    "composition.adjacent-card-grids",
  ]) assert.ok(codes.has(expected), `missing ${expected}`);
  const safeFinding = auditVisualObservations(observations).find((item) => item.code === "text.unsafe-margin");
  assert.match(safeFinding?.message ?? "", /5% graphics-safe margin/u);
});

test("tiny type, composited contrast, and flat frames remain reviewer warnings", () => {
  const kinds = ["title", "definition", "diagram", "comparison", "worked-example", "code", "graph", "outro"];
  const observations = kinds.map((kind, index) => observation({
    sceneId: `scene.${index}`,
    kind,
    family: compositionFamilyForKind(kind),
    tinyTextCount: index === 2 ? 2 : 0,
    lowContrastTextCount: index === 3 ? 1 : 0,
    lumaStandardDeviation: index === 4 ? 4 : 38,
  }));
  const findings = auditVisualObservations(observations);
  assert.ok(findings.length >= 3);
  assert.ok(findings.every((item) => item.severity === "warning"));
});

test("unmeasurable text paint remains a manual-review warning", () => {
  const kinds = ["title", "definition", "diagram", "comparison", "worked-example", "code", "graph", "outro"];
  const observations = kinds.map((kind, index) => observation({
    sceneId: `scene.${index}`,
    kind,
    family: compositionFamilyForKind(kind),
    unmeasurableContrastTextCount: index === 4 ? 1 : 0,
  }));
  const finding = auditVisualObservations(observations).find((item) => item.code === "text.contrast-unmeasurable");
  assert.equal(finding?.severity, "warning");
  assert.equal(finding?.sceneId, "scene.4");
});

test("structural geometry rejects the kicker-title overlap reproduced in the rejected master", () => {
  const element = (
    id: string,
    role: string,
    text: string,
    rect: RenderedGeometryElement["rect"],
  ): RenderedGeometryElement => ({
    id,
    kind: "text",
    role,
    text,
    essential: true,
    rect,
    fontSize: 24,
    lineCount: 1,
    declaredMaxLines: 1,
    plannedRect: null,
    overflowPolicy: null,
  });
  const snapshot = analyzeStructuralGeometry(
    { x: 0, y: 0, width: 1280, height: 720 },
    { x: 64, y: 36, width: 1152, height: 648 },
    [
      element("header.eyebrow", "eyebrow", "THE CONTRACT", { x: 64, y: 37, width: 142.5, height: 19 }),
      element("header.title", "title", "SORTED INPUT IS NON-NEGOTIABLE", { x: 64, y: 37.08, width: 774, height: 46 }),
    ],
  );
  assert.ok(snapshot.findings.some((finding) => finding.code === "geometry.text-intersection"));
});

test("structural geometry rejects a diagram node that leaves its parent stage", () => {
  const snapshot = analyzeStructuralGeometry(
    { x: 0, y: 0, width: 1280, height: 720 },
    { x: 64, y: 36, width: 1152, height: 648 },
    [{
      id: "node.2",
      kind: "container",
      role: "diagram-node",
      text: "middle node",
      essential: true,
      rect: { x: 420, y: 310, width: 300, height: 260 },
      fontSize: null,
      lineCount: 0,
      declaredMaxLines: null,
      plannedRect: { x: 80, y: 280, width: 1120, height: 250 },
      overflowPolicy: "re-layout",
    }],
  );
  assert.ok(snapshot.findings.some((finding) => finding.code === "geometry.parent-overflow"));
});

test("horizontal diagram nodes stay inside the declared stage in Chromium", {
  skip: canRunChromiumContrastTest ? false : `Chromium not available at ${chromiumPath}`,
}, async () => {
  const rendered = new SceneViewStaticAdapter().renderSpec(specimenFor("diagram"), fixtureTarget({ width: 1280, height: 720 }), 480_000);
  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ["--disable-background-networking", "--disable-gpu", "--disable-gpu-compositing", "--no-first-run"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await page.setContent(rendered.html, { waitUntil: "load" });
    await page.evaluate(async () => { await document.fonts.ready; });
    const snapshot = await inspectStructuralGeometry(page, { width: 1280, height: 720 });
    assert.deepEqual(snapshot.findings.filter((finding) => finding.code === "geometry.parent-overflow"), []);
  } finally {
    await context.close();
    await browser.close();
  }
});

test("constraint-layout header keeps real Chromium kicker and title boxes disjoint", {
  skip: canRunChromiumContrastTest ? false : `Chromium not available at ${chromiumPath}`,
}, async () => {
  const rendered = new SceneViewStaticAdapter().renderSpec(specimenFor("title"), fixtureTarget({ width: 1280, height: 720 }), 0);
  const browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ["--disable-background-networking", "--disable-gpu", "--disable-gpu-compositing", "--no-first-run"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await page.setContent(rendered.html, { waitUntil: "load" });
    await page.evaluate(async () => { await document.fonts.ready; });
    const snapshot = await inspectStructuralGeometry(page, { width: 1280, height: 720 });
    const headerCollisions = snapshot.findings.filter((finding) =>
      finding.code === "geometry.text-intersection"
      && finding.elementIds.some((id) => id === "header.eyebrow")
      && finding.elementIds.some((id) => id === "header.title"));
    assert.deepEqual(headerCollisions, []);
  } finally {
    await context.close();
    await browser.close();
  }
});

test("composited contrast measurement passes readable text, rejects low contrast, and preserves unknown paint", {
  skip: canRunChromiumContrastTest ? false : `Chromium not available at ${chromiumPath}`,
}, async () => {
  const browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ["--disable-background-networking", "--disable-gpu", "--disable-gpu-compositing", "--no-first-run"],
  });
  const context = await browser.newContext({ viewport: { width: 720, height: 480 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await page.setContent(`<!doctype html><html><head><style>
      * { box-sizing: border-box; }
      html, body { width: 720px; height: 480px; margin: 0; overflow: hidden; }
      svg { display: block; }
      text { font-family: Arial, sans-serif; font-size: 20px; font-weight: 400; }
    </style></head><body><svg width="720" height="480" viewBox="0 0 720 480" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="unknown-paint"><stop stop-color="#ffffff"/><stop offset="1" stop-color="#86efe3"/></linearGradient></defs>
      <rect width="720" height="360" fill="#f7f8fc"/>
      <g>
        <!-- This unrelated white sibling made the old nearest-rect heuristic report a false failure. -->
        <rect x="18" y="18" width="110" height="52" fill="#ffffff"/>
        <rect x="160" y="18" width="520" height="76" fill="#151827"/>
        <text x="184" y="67" fill="#ffffff">Readable white on navy</text>
      </g>
      <text x="32" y="145" fill="#151827">Readable ink on paper</text>
      <rect x="18" y="178" width="430" height="72" fill="#8c929b"/>
      <text x="38" y="224" fill="#9da3ac">Deliberately low contrast</text>
      <rect x="18" y="270" width="430" height="72" fill="#151827"/>
      <text x="38" y="316" fill="url(#unknown-paint)">Unsupported gradient paint</text>
      <rect x="18" y="360" width="430" height="72" fill="#ffffff"/>
      <rect x="270" y="360" width="178" height="72" fill="#151827"/>
      <text x="38" y="406" fill="#151827">Text crossing an obscuring surface</text>
      <g opacity="0"><text x="500" y="406" fill="#151827">Invisible transition text</text></g>
    </svg></body></html>`, { waitUntil: "load" });
    await page.evaluate(async () => { await document.fonts.ready; });
    const inspection = await inspectRenderedTextContrast(page);
    const byText = new Map(inspection.measurements.map((item) => [item.text, item]));
    const whiteOnNavy = byText.get("Readable white on navy");
    const inkOnPaper = byText.get("Readable ink on paper");
    const lowContrast = byText.get("Deliberately low contrast");
    const unknownPaint = byText.get("Unsupported gradient paint");
    const partiallyObscured = byText.get("Text crossing an obscuring surface");
    assert.equal(whiteOnNavy?.status, "pass", JSON.stringify(whiteOnNavy));
    assert.ok((whiteOnNavy?.contrastRatio ?? 0) >= 4.5, JSON.stringify(whiteOnNavy));
    assert.equal(inkOnPaper?.status, "pass", JSON.stringify(inkOnPaper));
    assert.ok((inkOnPaper?.contrastRatio ?? 0) >= 4.5, JSON.stringify(inkOnPaper));
    assert.equal(lowContrast?.status, "fail", JSON.stringify(lowContrast));
    assert.ok((lowContrast?.contrastRatio ?? Number.POSITIVE_INFINITY) < 4.5, JSON.stringify(lowContrast));
    assert.equal(partiallyObscured?.status, "fail", JSON.stringify(partiallyObscured));
    assert.ok((partiallyObscured?.contrastRatio ?? Number.POSITIVE_INFINITY) < 4.5, JSON.stringify(partiallyObscured));
    assert.equal(unknownPaint?.status, "unmeasurable", JSON.stringify(unknownPaint));
    assert.equal(byText.has("Invisible transition text"), false);
    assert.equal(inspection.lowContrastTextCount, 2);
    assert.equal(inspection.unmeasurableContrastTextCount, 1);
  } finally {
    await context.close();
    await browser.close();
  }
});
