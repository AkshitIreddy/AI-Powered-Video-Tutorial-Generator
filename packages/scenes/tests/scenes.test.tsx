import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_SCENE_KINDS,
  SceneView,
  builtinSceneRegistry,
  compileScene,
  createSceneRegistry,
  preflightScene,
  resolveBuiltinSceneSpec,
  SPECIMEN_SCENES,
  specimenFor,
  sceneSpecFromStoryboard,
  TIMEBASE_TICKS_PER_SECOND,
  trackValue,
  validateScenePlugin,
  type PluginSceneContent,
  type SceneDefinition,
  type ScenePlugin,
  type SceneRendererProps,
} from "../src/index.js";

const landscape = { width: 1920, height: 1080, fps: 30 as const };
const portrait = { width: 1080, height: 1920, fps: 30 as const };
const square = { width: 1080, height: 1080, fps: 30 as const };

describe("built-in scene catalog", () => {
  it("rejects charts without authored numeric evidence instead of inventing values", () => {
    expect(() => sceneSpecFromStoryboard({
      id: "unsupported-chart",
      type: "chart",
      title: "Measured outcomes",
      durationTicks: TIMEBASE_TICKS_PER_SECOND,
      onScreenText: ["control", "treatment"],
    })).toThrow(/requires authored numeric values/u);
  });

  it("hydrates provider-authored storyboard content without specimen text", () => {
    const spec = sceneSpecFromStoryboard({
      id: "lesson-search",
      type: "live_code",
      title: "Binary search narrows the interval",
      narration: "Compare the midpoint and keep only the half that can still contain the target.",
      durationTicks: 2_913_600,
      duration: 1,
      objectiveIds: ["objective-search"],
      claimIds: ["claim-search"],
      onScreenText: ["mid = (low + high) // 2", "if value < target: low = mid + 1"],
      visualBeat: {
        schemaVersion: 1,
        semanticIntent: "demonstrate",
        compositionFamily: "document_focus",
        focalAnchor: "search-loop",
        continuityKey: "binary-search",
        informationUnits: [{ id: "result", role: "result", text: "target found" }],
        attentionCue: "active-line",
        motionIntent: ["evidence-focus"],
        textRoles: { result: "target found" },
        avoidRegions: [],
      },
    }, { seedScope: "project-one" });

    expect(spec?.durationTicks).toBe(2_913_600);
    expect(spec?.content.kind).toBe("live-code");
    expect(JSON.stringify(spec)).toContain("mid = (low + high) // 2");
    expect(JSON.stringify(spec)).toContain("target found");
    expect(JSON.stringify(spec)).not.toContain("karatsuba");
    expect(preflightScene(spec!, landscape).ok).toBe(true);
  });

  it("lays out approved whiteboard math as readable progressive writing", () => {
    const spec = sceneSpecFromStoryboard({
      id: "cross-term-board",
      type: "whiteboard",
      title: "Deriving the cross-term formula",
      durationTicks: TIMEBASE_TICKS_PER_SECOND * 20,
      narration: "Expand the grouped product, remove the two products already computed, and retain the cross term.",
      onScreenText: ["(a+b)(c+d) – ac – bd = ad + bc"],
      visualBeat: {
        schemaVersion: 1,
        semanticIntent: "demonstrate",
        compositionFamily: "worked_example",
        focalAnchor: "cross-term",
        continuityKey: "symbolic-derivation",
        informationUnits: [{ id: "formula", role: "formula", text: "(a+b)(c+d) – ac – bd = ad + bc" }],
        attentionCue: "trace-relationship",
        motionIntent: ["trace-relationship"],
        textRoles: { focus: "(a+b)(c+d) – ac – bd = ad + bc" },
        avoidRegions: [],
      },
    });
    if (spec?.content.kind !== "whiteboard") throw new Error("Expected a whiteboard scene");
    expect(spec.content.labels?.map((label) => label.text)).toEqual([
      "(a + b)(c + d) − ac − bd",
      "= ac + ad + bc + bd − ac − bd",
      "= ad + bc",
    ]);
    expect(preflightScene(spec, landscape).ok).toBe(true);

    const first = spec.content.labels![0]!;
    const renderAt = (tick: number) => renderToStaticMarkup(createElement(SceneView, {
      scene: compileScene(spec, landscape),
      frame: { tick, reducedMotion: false },
    }));
    const early = renderAt(first.startTick + Math.round((first.endTick! - first.startTick) * 0.35));
    const late = renderAt(first.startTick + Math.round((first.endTick! - first.startTick) * 0.75));
    const writingX = (markup: string) => Number(markup.match(/data-writing-x="([\d.]+)"/u)?.[1]);
    expect(writingX(late)).toBeGreaterThan(writingX(early));
    expect(writingX(late)).toBeLessThan(1_200);
    const fontSizes = [...late.matchAll(/data-whiteboard-font-size="([\d.]+)"/gu)].map((match) => Number(match[1]));
    expect(Math.min(...fontSizes)).toBeGreaterThanOrEqual(40);
    const portraitFinal = renderToStaticMarkup(createElement(SceneView, {
      scene: compileScene(spec, portrait),
      frame: { tick: spec.durationTicks, reducedMotion: true },
    }));
    expect(portraitFinal).toContain(">− ac − bd<");
  });

  it("wraps long approved whiteboard steps inside a portrait board", () => {
    const spec = sceneSpecFromStoryboard({
      id: "recursive-products-board",
      type: "whiteboard",
      title: "Recursive product breakdown",
      durationTicks: TIMEBASE_TICKS_PER_SECOND * 20,
      onScreenText: ["ac*100 + cross*10 + bd"],
      visualBeat: {
        schemaVersion: 1,
        semanticIntent: "demonstrate",
        compositionFamily: "worked_example",
        focalAnchor: "three-products",
        continuityKey: "symbolic-derivation",
        informationUnits: [
          { id: "products", role: "step", text: "Compute ac, bd, and (a+b)(c+d) recursively" },
          { id: "assembly", role: "result", text: "Reassemble with shifts" },
        ],
        attentionCue: "trace-relationship",
        motionIntent: ["trace-relationship"],
        textRoles: { focus: "Compute three recursive products" },
        avoidRegions: [],
      },
    });
    if (spec?.content.kind !== "whiteboard") throw new Error("Expected a whiteboard scene");
    expect(spec.content.labels?.map((label) => label.text)).toEqual([
      "Compute ac, bd, and (a+b)(c+d) recursively",
      "ac × 100 + cross × 10 + bd",
      "Reassemble with shifts",
    ]);
    const markup = renderToStaticMarkup(createElement(SceneView, {
      scene: compileScene(spec, portrait),
      frame: { tick: spec.durationTicks, reducedMotion: true },
    }));
    expect(markup).toContain('data-whiteboard-lines="2"');
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("undefined");
  });

  it("compiles approved worked arithmetic into executable Python with measured output", () => {
    const spec = sceneSpecFromStoryboard({
      id: "worked-arithmetic-code",
      type: "live_code",
      title: "Compute the three products",
      durationTicks: TIMEBASE_TICKS_PER_SECOND * 20,
      narration: "Compute the two outer products, derive the cross term, then assemble the result.",
      onScreenText: [
        "ac = 1*3 = 3",
        "bd = 2*4 = 8",
        "cross = (1+2)*(3+4) - 3 - 8 = 10",
        "result = 3*100 + 10*10 + 8 = 408",
      ],
    });
    if (spec?.content.kind !== "live-code") throw new Error("Expected a live-code scene");
    expect(spec.content.language).toBe("python");
    expect(spec.content.filename).toBe("lesson.py");
    expect(spec.content.lines).toEqual([
      expect.objectContaining({ text: "ac = 1*3", annotation: "ac = 3" }),
      expect.objectContaining({ text: "bd = 2*4", annotation: "bd = 8" }),
      expect.objectContaining({ text: "cross = (1+2)*(3+4) - 3 - 8", annotation: "cross = 10" }),
      expect.objectContaining({ text: "result = 3*100 + 10*10 + 8", annotation: "result = 408" }),
    ]);
    expect(spec.content.lines.map((line) => line.text).join("\n")).not.toMatch(/=\s*\d+\s*=\s*\d+/u);
    const runActions = spec.content.actions?.filter((action) => action.type === "run") ?? [];
    expect(runActions).toHaveLength(4);
    expect(runActions.map((action) => action.output)).toEqual(["ac = 3", "bd = 8", "cross = 10", "result = 408"]);

    const firstType = spec.content.actions!.find((action) => action.type === "type" && action.lineId === spec.content.lines[0]!.id)!;
    const firstRun = runActions[0]!;
    const renderAt = (tick: number) => renderToStaticMarkup(createElement(SceneView, {
      scene: compileScene(spec, landscape),
      frame: { tick, reducedMotion: false },
    }));
    const typing = renderAt(Math.round((firstType.startTick + firstType.endTick) / 2));
    expect(typing).toMatch(/data-code-annotation="pending"[^>]*opacity="0"/u);
    const running = renderAt(Math.round((firstRun.startTick + firstRun.endTick) / 2));
    expect(running).toContain('data-live-code-action="run"');
    expect(running).toMatch(/data-code-annotation="revealed"[^>]*opacity="1"/u);
    const fontSizes = [...running.matchAll(/data-code-font-size="([\d.]+)"/gu)].map((match) => Number(match[1]));
    expect(Math.min(...fontSizes)).toBeGreaterThanOrEqual(36);
  });

  it("labels non-executable live-code prose honestly and preserves declared source", () => {
    const prose = sceneSpecFromStoryboard({
      id: "worked-prose",
      type: "live_code",
      title: "Reason through the split",
      durationTicks: TIMEBASE_TICKS_PER_SECOND * 8,
      onScreenText: ["Split the input into balanced halves"],
    });
    if (prose?.content.kind !== "live-code") throw new Error("Expected live-code prose");
    expect(prose.content.filename).toBe("Worked steps");
    expect(prose.content.actions?.some((action) => action.type === "run")).toBe(false);

    const authored = resolveBuiltinSceneSpec({
      id: "authored-source",
      kind: "live-code",
      durationTicks: TIMEBASE_TICKS_PER_SECOND * 8,
      seed: "authored-source",
      content: { title: "Use the approved implementation", items: ["total = left + right"] },
      metadata: { language: "javascript", filename: "sum.js" },
    });
    if (authored?.content.kind !== "live-code") throw new Error("Expected authored live code");
    expect(authored.content.language).toBe("javascript");
    expect(authored.content.filename).toBe("sum.js");
    expect(authored.content.lines[0]?.text).toBe("total = left + right");
  });

  it("removes a punctuated copy of the title from presenter teaching points", () => {
    const spec = sceneSpecFromStoryboard({
      id: "presenter-title-deduplication",
      type: "presenter_slide",
      title: "1. Karatsuba Primer: Why Split Numbers",
      durationTicks: TIMEBASE_TICKS_PER_SECOND * 8,
      visualBeat: {
        schemaVersion: 1,
        semanticIntent: "establish",
        compositionFamily: "presenter",
        focalAnchor: "lesson-introduction",
        continuityKey: "karatsuba",
        informationUnits: [
          { id: "duplicate", role: "heading", text: "1. Karatsuba Primer: Why Split Numbers?" },
          { id: "purpose", role: "principle", text: "Split each input into high and low halves" },
        ],
        attentionCue: "presenter",
        motionIntent: ["evidence-focus"],
        textRoles: { focus: "Split each input into high and low halves" },
        avoidRegions: [],
      },
    });
    if (spec?.content.kind !== "presenter-slide") throw new Error("Expected presenter slide");
    expect(spec.content.slideItems?.map((item) => item.text)).toEqual(["Split each input into high and low halves"]);
  });

  it("preserves an accepted visual binding through the shared storyboard resolver", () => {
    const spec = sceneSpecFromStoryboard({
      id: "lesson-visual",
      type: "definition",
      title: "A balanced search tree",
      durationTicks: TIMEBASE_TICKS_PER_SECOND,
      onScreenText: ["Height stays logarithmic"],
      visualAssets: [{
        assetId: "asset-tree",
        sha256: "a".repeat(64),
        role: "background",
        alt: "A balanced binary search tree",
        fit: "cover",
        treatment: "full-frame",
      }],
    });

    expect("background" in spec!.content ? spec!.content.background : undefined).toEqual({
      id: "asset-tree",
      sha256: "a".repeat(64),
      alt: "A balanced binary search tree",
      fit: "cover",
      treatment: "full-frame",
    });
  });

  it("contains one definition and one specimen for every built-in kind", () => {
    expect(builtinSceneRegistry.list()).toHaveLength(BUILTIN_SCENE_KINDS.length);
    expect(SPECIMEN_SCENES).toHaveLength(BUILTIN_SCENE_KINDS.length);
    for (const kind of BUILTIN_SCENE_KINDS) {
      expect(builtinSceneRegistry.has(kind)).toBe(true);
      expect(specimenFor(kind).content.kind).toBe(kind);
    }
  });

  it.each([landscape, portrait, square])("preflights and renders every specimen at $width×$height", (target) => {
    for (const spec of SPECIMEN_SCENES) {
      const preflight = preflightScene(spec, target);
      expect(preflight.ok, `${spec.content.kind}: ${JSON.stringify(preflight.diagnostics)}`).toBe(true);
      expect(preflight.scene).toBeDefined();
      const markup = renderToStaticMarkup(createElement(SceneView, {
        scene: preflight.scene!,
        frame: { tick: TIMEBASE_TICKS_PER_SECOND * 2, reducedMotion: false },
      }));
      expect(markup).toContain("<svg");
      expect(markup).toContain(`data-scene-kind="${spec.content.kind}"`);
      expect(markup).toContain('data-visual-language="editorial-v2"');
      expect(markup).toContain("data-composition-family=");
      expect(markup).not.toMatch(/<(?:image|use)[^>]+href="https?:\/\//);
      expect(markup).not.toContain("data-card-tone=");
      expect(markup).not.toContain("ALYSTRIA / ");
      expect(markup).not.toContain("NaN");
      expect(markup).not.toContain("undefined");
    }
  });

  it("renders byte-identically for the same scene, target, and tick", () => {
    const scene = compileScene(specimenFor("diagram"), landscape);
    const props = { scene, frame: { tick: 480_000, reducedMotion: false } };
    const first = renderToStaticMarkup(createElement(SceneView, props));
    const second = renderToStaticMarkup(createElement(SceneView, props));
    expect(second).toBe(first);
    expect(compileScene(specimenFor("diagram"), landscape).contentHash).toBe(scene.contentHash);
  });

  it("keeps every horizontal diagram node on one shared baseline", () => {
    const scene = compileScene(specimenFor("diagram"), landscape);
    const markup = renderToStaticMarkup(createElement(SceneView, {
      scene,
      frame: { tick: TIMEBASE_TICKS_PER_SECOND * 2, reducedMotion: true },
    }));
    const nodeYValues = [...markup.matchAll(/data-signal-stage="\d+" data-layout-x="[^"]+" data-layout-y="([^"]+)"/g)]
      .map((match) => Number(match[1]));
    const stageMatch = markup.match(/data-diagram-stage="true" data-layout-x="([^"]+)" data-layout-y="([^"]+)" data-layout-width="([^"]+)" data-layout-height="([^"]+)"/);
    const nodeRects = [...markup.matchAll(/data-signal-stage="\d+" data-layout-x="([^"]+)" data-layout-y="([^"]+)" data-layout-width="([^"]+)" data-layout-height="([^"]+)"/g)]
      .map((match) => ({ x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) }));

    expect(nodeYValues).toHaveLength(scene.spec.content.kind === "diagram" ? scene.spec.content.nodes.length : 0);
    expect(new Set(nodeYValues).size).toBe(1);
    expect(stageMatch).not.toBeNull();
    const stage = { x: Number(stageMatch![1]), y: Number(stageMatch![2]), width: Number(stageMatch![3]), height: Number(stageMatch![4]) };
    for (const node of nodeRects) {
      expect(node.x).toBeGreaterThanOrEqual(stage.x);
      expect(node.y).toBeGreaterThanOrEqual(stage.y);
      expect(node.x + node.width).toBeLessThanOrEqual(stage.x + stage.width);
      expect(node.y + node.height).toBeLessThanOrEqual(stage.y + stage.height);
    }
  });

  it("renders an authored complexity comparison as measured growth curves", () => {
    const spec = specimenFor("comparison");
    if (spec.content.kind !== "comparison") throw new Error("Expected comparison specimen");
    const scene = compileScene({
      ...spec,
      content: {
        ...spec.content,
        curveComparison: {
          firstLabel: "Schoolbook O(n²)",
          firstExponent: 2,
          secondLabel: "Karatsuba O(n¹·⁵⁸⁵)",
          secondExponent: Math.log2(3),
        },
      },
    }, landscape);
    const markup = renderToStaticMarkup(createElement(SceneView, {
      scene,
      frame: { tick: TIMEBASE_TICKS_PER_SECOND * 2, reducedMotion: true },
    }));
    expect(markup).toContain('data-comparison-mode="growth-curves"');
    expect(markup).toContain('data-growth-curve="first"');
    expect(markup).toContain('data-growth-curve="second"');
    expect(markup).toContain("Karatsuba O(n¹·⁵⁸⁵)");
  });

  it("replays whiteboard strokes and live-code typing from the frame clock", () => {
    const renderAt = (kind: "whiteboard" | "live-code", tick: number, reducedMotion = false) => renderToStaticMarkup(createElement(SceneView, {
      scene: compileScene(specimenFor(kind), landscape),
      frame: { tick, reducedMotion },
    }));

    const boardEarly = renderAt("whiteboard", TIMEBASE_TICKS_PER_SECOND * 1.5);
    const boardLate = renderAt("whiteboard", TIMEBASE_TICKS_PER_SECOND * 5.5);
    expect(boardEarly).toContain('data-tutorial-mode="whiteboard"');
    expect(boardEarly).toContain('data-draw-progress="0.5000"');
    expect(boardLate).toContain('data-draw-progress="1.0000"');
    expect(boardLate).toContain('data-whiteboard-label="true"');
    expect(boardLate).toContain('id="label.input"');
    expect(boardLate).not.toContain('data-whiteboard-lines=');
    expect(boardLate).toMatch(/id="stroke\.number"[^>]*d="M [^"]+ L [^"]+ L [^"]+"/u);

    const codeEarly = renderAt("live-code", TIMEBASE_TICKS_PER_SECOND * 1.5);
    const codeLate = renderAt("live-code", TIMEBASE_TICKS_PER_SECOND * 7);
    expect(codeEarly).toContain('data-tutorial-mode="live-code"');
    expect(codeEarly).toContain('data-typing-progress="0.5000"');
    expect(codeEarly).toContain("▌");
    expect(codeLate).toContain('data-typing-progress="1.0000"');
  });

  it("reveals a derivation in order and keeps its labels inside the step cards", () => {
    const renderAt = (tick: number) => renderToStaticMarkup(createElement(SceneView, {
      scene: compileScene(specimenFor("derivation"), landscape),
      frame: { tick, reducedMotion: false },
    }));

    const early = renderAt(TIMEBASE_TICKS_PER_SECOND);
    expect(early).toContain('data-equation-step="1" data-step-reveal="revealed"');
    expect(early).toContain('data-equation-step="2" data-step-reveal="pending"');
    expect(early).toContain('data-result-reveal="pending"');
    expect(early).toMatch(/data-equation-step="2"[^>]*opacity="0"/u);
    expect(early).toMatch(/data-result-reveal="pending" opacity="0"/u);

    const middle = renderAt(TIMEBASE_TICKS_PER_SECOND * 4);
    expect(middle).toContain('data-equation-step="2" data-step-reveal="revealed"');
    expect(middle).toContain('data-result-reveal="pending"');

    const late = renderAt(TIMEBASE_TICKS_PER_SECOND * 7);
    expect(late).toContain('data-result-reveal="revealed"');
    const cardTops = [...late.matchAll(/data-step-card-top="([\d.]+)"/gu)].map((match) => Number(match[1]));
    const labelBaselines = [...late.matchAll(/data-step-label-y="([\d.]+)"/gu)].map((match) => Number(match[1]));
    expect(cardTops).toHaveLength(2);
    expect(labelBaselines).toHaveLength(2);
    labelBaselines.forEach((baseline, index) => expect(baseline - cardTops[index]!).toBeGreaterThanOrEqual(16));
  });

  it("keeps live-code line focus synchronized with the narrated action", () => {
    const renderAt = (tick: number) => renderToStaticMarkup(createElement(SceneView, {
      scene: compileScene(specimenFor("live-code"), landscape),
      frame: { tick, reducedMotion: false },
    }));

    const waiting = renderAt(0);
    expect(waiting).toContain('data-active-code-line="1"');

    const define = renderAt(TIMEBASE_TICKS_PER_SECOND * 1.5);
    expect(define).toContain('data-active-code-line="1"');
    expect(define).toMatch(/id="line\.1"[^>]*data-code-line-focus="active"/u);
    expect(define).toMatch(/id="line\.3"[^>]*data-code-line-focus="inactive"/u);

    const guard = renderAt(TIMEBASE_TICKS_PER_SECOND * 3);
    expect(guard).toContain('data-active-code-line="2"');
    expect(guard).toMatch(/id="line\.2"[^>]*data-code-line-focus="active"/u);

    const run = renderAt(TIMEBASE_TICKS_PER_SECOND * 6.5);
    expect(run).toContain('data-active-code-line="3"');
    expect(run).toMatch(/id="line\.3"[^>]*data-code-line-focus="active"/u);
    expect(run).toContain("PASS · 8 × 7 = 56");
  });

  it("reflows targets instead of cropping a landscape scene", () => {
    const spec = specimenFor("comparison");
    const wide = compileScene(spec, landscape);
    const tall = compileScene(spec, portrait);
    const even = compileScene(spec, square);
    expect(wide.metrics.profile).toBe("landscape");
    expect(wide.metrics.columns).toBe(2);
    expect(tall.metrics.profile).toBe("portrait");
    expect(tall.metrics.columns).toBe(1);
    expect(even.metrics.profile).toBe("square");
    expect(even.metrics.columns).toBe(1);
    expect(wide.contentHash).not.toBe(tall.contentHash);
  });

  it("freezes choreography to its declared reduced-motion state", () => {
    const scene = compileScene(specimenFor("bullets"), landscape);
    const track = scene.choreography.find((item) => item.id === "reveal-point.a");
    expect(track).toBeDefined();
    expect(trackValue(track!, 0, false)).toBe(0);
    expect(trackValue(track!, 0, true)).toBe(1);
  });

  it("never emits a remote asset URL supplied by a resolver", () => {
    const scene = compileScene(specimenFor("image-focus"), landscape);
    const markup = renderToStaticMarkup(createElement(SceneView, {
      scene,
      frame: { tick: 0, reducedMotion: true },
      resolveAsset: () => "https://example.com/tracking.png",
    }));
    expect(markup).not.toContain("example.com");
    expect(markup).toContain("local educational diagram");
  });

  it("honors the visual-director composition and motion tags", () => {
    const spec = specimenFor("worked-example");
    const scene = compileScene({
      ...spec,
      tags: [
        ...(spec.tags ?? []),
        "visual:intent=demonstrate",
        "visual:composition=worked_example",
        "visual:motion=trace-relationship",
        "visual:density=balanced",
        "visual:narration-on-screen=false",
      ],
    }, landscape);
    const markup = renderToStaticMarkup(createElement(SceneView, {
      scene,
      frame: { tick: 0, reducedMotion: true },
    }));
    expect(markup).toContain('data-composition-family="worked-example"');
    expect(markup).toContain('data-visual-intent="demonstrate"');
    expect(markup).toContain('data-visual-motion="trace-relationship"');
    expect(markup).toContain('data-visual-density="balanced"');
  });

  it("composes owned background and presenter assets without a full-frame veil or truncated identity", () => {
    const spec = specimenFor("presenter-slide");
    if (spec.content.kind !== "presenter-slide") throw new Error("Expected presenter-slide specimen");
    const background = { id: "background.modern-tech-signal-v1", sha256: "b".repeat(64), alt: "Owned modern signal background", fit: "cover" as const, treatment: "full-frame" as const };
    const portrait = { id: "presenter.synthetic.replay", sha256: "c".repeat(64), alt: "Owned fictional synthetic presenter", fit: "cover" as const };
    const presenterName = "Pinned synthetic replay guide for end-to-end validation";
    const scene = compileScene({
      ...spec,
      content: { ...spec.content, background, portrait, presenterName, disclosure: "Previously generated synthetic presenter replay", placement: "picture-in-picture" },
    }, landscape);
    const markup = renderToStaticMarkup(createElement(SceneView, {
      scene,
      frame: { tick: TIMEBASE_TICKS_PER_SECOND * 3, reducedMotion: true },
      resolveAsset: (asset) => `alystria-asset:sha256/${asset.sha256}`,
    }));

    expect(markup).toContain('data-background-treatment="full-frame"');
    expect(markup).toContain('data-readability-surface="header"');
    expect(markup).toContain('data-readability-surface="presenter-insight"');
    expect(markup).not.toContain('data-presenter-disclosure="true"');
    expect(markup).toContain('data-presenter-placement="picture-in-picture"');
    expect(markup).toContain("Pinned synthetic replay guide for end-to-end");
    expect(markup).toContain(">validation</tspan>");
    expect(markup).not.toContain("Previously generated synthetic presenter replay");
    expect(markup).not.toContain("Pinned synthetic replay gui…");
    expect(markup).not.toContain('fill="#F7F8FC" opacity="0.31"');
    expect(markup).not.toContain('mask="url(#background-treatment-');
    expect(markup).not.toContain('fill="#FFFFFF" opacity="0.085"');
    expect(markup.match(/alystria-asset:sha256\//g)?.length).toBe(2);
    const insight = markup.match(/data-insight-x="(\d+)" data-insight-width="(\d+)"/);
    const stage = markup.match(/data-stage-x="(\d+)" data-stage-y="\d+" data-stage-width="(\d+)"/);
    expect(insight).not.toBeNull();
    expect(stage).not.toBeNull();
    expect(Number(insight?.[1]) + Number(insight?.[2])).toBeLessThanOrEqual(Number(stage?.[1]));
  });

  it("removes an exact normalized title duplicated in pre-authored presenter slide items", () => {
    const specimen = specimenFor("presenter-slide");
    if (specimen.content.kind !== "presenter-slide") throw new Error("Expected presenter-slide specimen");
    const title = "1. Karatsuba Primer: Why Split Numbers?";
    const scene = compileScene({
      ...specimen,
      content: {
        ...specimen.content,
        title,
        slideItems: [
          { id: "duplicate-title", text: "  1.  Karatsuba Primer: Why Split Numbers  " },
          { id: "concept", text: "Split numbers into high and low halves" },
          { id: "example", text: "12 → a=1, b=2; 34 → c=3, d=4" },
        ],
      },
    }, landscape);
    const markup = renderToStaticMarkup(createElement(SceneView, {
      scene,
      frame: { tick: TIMEBASE_TICKS_PER_SECOND * 3, reducedMotion: true },
    }));

    expect(markup).not.toContain('id="duplicate-title"');
    expect(markup).toContain('id="concept"');
    expect(markup).toContain('id="example"');
    expect(markup.match(/data-sequence-number-right=/gu)).toHaveLength(2);
  });

  it("publishes deterministic presenter breathing and blink cues while keeping a closed rest mouth", () => {
    const spec = specimenFor("presenter-slide");
    if (spec.content.kind !== "presenter-slide") throw new Error("Expected presenter-slide specimen");
    const scene = compileScene({
      ...spec,
      content: {
        ...spec.content,
        idleMotion: { enabled: true, blink: true, breathing: true, restMouth: "closed" },
      },
    }, landscape);
    const animated = renderToStaticMarkup(createElement(SceneView, {
      scene,
      frame: { tick: TIMEBASE_TICKS_PER_SECOND * 2, reducedMotion: false },
    }));
    const reduced = renderToStaticMarkup(createElement(SceneView, {
      scene,
      frame: { tick: TIMEBASE_TICKS_PER_SECOND * 2, reducedMotion: true },
    }));

    expect(animated).toContain('data-idle-animation="enabled"');
    expect(animated).toContain('data-idle-blink="enabled"');
    expect(animated).toContain('data-idle-breathing="enabled"');
    expect(animated).toContain('data-rest-mouth="closed"');
    expect(animated).not.toContain('scale(1) translate');
    expect(reduced).toContain('scale(1) translate');
  });

  it("reserves collision-free presenter sequence columns and keeps the portrait inside its stage", () => {
    const spec = specimenFor("presenter-slide");
    if (spec.content.kind !== "presenter-slide") throw new Error("Expected presenter-slide specimen");
    const scene = compileScene({
      ...spec,
      content: { ...spec.content, placement: "picture-in-picture" },
    }, landscape);
    const markup = renderToStaticMarkup(createElement(SceneView, {
      scene,
      frame: { tick: TIMEBASE_TICKS_PER_SECOND * 3, reducedMotion: true },
    }));

    const rows = [...markup.matchAll(/data-sequence-number-right="([\d.]+)" data-sequence-divider-x="([\d.]+)" data-sequence-gutter-center-x="([\d.]+)" data-sequence-copy-x="([\d.]+)"/g)];
    expect(rows).toHaveLength(spec.content.slideItems?.length ?? 0);
    for (const row of rows) {
      expect(Number(row[1]) + scene.metrics.unit).toBeLessThanOrEqual(Number(row[2]));
      expect(Math.abs(Number(row[2]) - Number(row[3]))).toBeLessThanOrEqual(0.5);
      expect(Number(row[2])).toBeLessThan(Number(row[4]));
    }
    const centeredRows = [...markup.matchAll(/data-sequence-copy-center-y="([\d.]+)" data-sequence-copy-baseline-y="([\d.]+)" data-sequence-row-center-y="([\d.]+)"/g)];
    expect(centeredRows).toHaveLength(spec.content.slideItems?.length ?? 0);
    for (const row of centeredRows) {
      expect(Math.abs(Number(row[1]) - Number(row[3]))).toBeLessThanOrEqual(scene.metrics.bodySize);
    }
    const centeredNumbers = [...markup.matchAll(/data-sequence-row-center-y="([\d.]+)" data-sequence-number-center-y="([\d.]+)" data-sequence-number-font-size="([\d.]+)"/g)];
    expect(centeredNumbers).toHaveLength(spec.content.slideItems?.length ?? 0);
    for (const row of centeredNumbers) {
      expect(Number(row[1])).toBe(Number(row[2]));
      expect(Number(row[3])).toBeLessThan(scene.metrics.titleSize * 1.25);
    }

    const stage = markup.match(/data-presenter-stage="portrait" data-stage-x="([\d.]+)" data-stage-y="([\d.]+)" data-stage-width="([\d.]+)" data-stage-height="([\d.]+)"/);
    const media = markup.match(/data-presenter-media="true" data-media-x="([\d.]+)" data-media-y="([\d.]+)" data-media-width="([\d.]+)" data-media-height="([\d.]+)"/);
    expect(stage).not.toBeNull();
    expect(media).not.toBeNull();
    const [stageX, stageY, stageWidth, stageHeight] = stage!.slice(1).map(Number);
    const [mediaX, mediaY, mediaWidth, mediaHeight] = media!.slice(1).map(Number);
    expect(mediaX).toBeGreaterThanOrEqual(stageX);
    expect(mediaY).toBeGreaterThanOrEqual(stageY);
    expect(mediaX + mediaWidth).toBeLessThanOrEqual(stageX + stageWidth);
    expect(mediaY + mediaHeight).toBeLessThanOrEqual(stageY + stageHeight);
  });

  it("keeps the teaching relationship visible in the premium scene families", () => {
    const render = (kind: Parameters<typeof specimenFor>[0]) => renderToStaticMarkup(createElement(SceneView, {
      scene: compileScene(specimenFor(kind), landscape),
      frame: { tick: TIMEBASE_TICKS_PER_SECOND * 3, reducedMotion: true },
    }));

    const definition = render("definition");
    expect(definition).toContain('data-definition-layout="authored-editorial"');
    expect(definition).toContain("solve them recursively");
    expect(definition).not.toContain("Solve similar parts");

    const comparison = render("comparison");
    expect(comparison).toContain('data-comparison-side="primary"');
    expect(comparison).toContain('data-comparison-side="secondary"');
    expect(comparison).toContain("One recursive multiplication saved");

    const diagram = render("diagram");
    expect(diagram).toContain('data-signal-stage="1"');
    expect(diagram).toContain('data-signal-stage="4"');
    expect(diagram.match(/data-contrast-surface="diagram-stage-number"/g)).toHaveLength(4);

    const worked = render("worked-example");
    expect(worked).toContain('data-transformation-state="1"');
    expect(worked).toContain('data-transformation-state="3"');
    expect(worked.match(/data-contrast-surface="worked-step-number"/g)).toHaveLength(3);
    expect(worked).toContain("RESOLVED STATE");

    expect(render("code")).toContain('data-code-lens="execution"');
    expect(render("presenter-slide")).toContain('data-presenter-stage="portrait"');
    expect(render("summary")).toContain("THE DURABLE THREAD");
  });

  it("shows the authored live-code action and run result at the active tick", () => {
    const spec = specimenFor("live-code");
    const scene = compileScene(spec, landscape);
    const markup = renderToStaticMarkup(createElement(SceneView, {
      scene,
      frame: { tick: TIMEBASE_TICKS_PER_SECOND * 6.5, reducedMotion: false },
    }));

    expect(markup).toContain('data-live-code-action="run"');
    expect(markup).toContain("PASS · 8 × 7 = 56");
    expect(markup).not.toContain(">CALL<");
    expect(markup).not.toContain(">SPLIT<");
    expect(markup).not.toContain(">RETURN<");
  });

  it("keeps compact computed annotations and execution output legible without changing long-code fallback", () => {
    const compactSpec = {
      id: "compact-arithmetic",
      durationTicks: TIMEBASE_TICKS_PER_SECOND * 8,
      seed: "compact-arithmetic",
      content: {
        kind: "live-code" as const,
        title: "Worked example: 12 × 34",
        filename: "lesson.py",
        language: "python",
        lines: [
          { id: "compact.1", text: "ac = 1 * 3", annotation: "ac = 3" },
          { id: "compact.2", text: "bd = 2 * 4", annotation: "bd = 8" },
          { id: "compact.3", text: "cross = (1 + 2) * (3 + 4) - ac - bd", annotation: "cross = 10" },
          { id: "compact.4", text: "result = ac * 100 + cross * 10 + bd", annotation: "result = 408" },
        ],
        actions: [{ id: "compact.run", type: "run" as const, startTick: TIMEBASE_TICKS_PER_SECOND * 5, endTick: TIMEBASE_TICKS_PER_SECOND * 7, output: "result = 408" }],
      },
    };
    const render = (target: typeof landscape | typeof portrait) => renderToStaticMarkup(createElement(SceneView, {
      scene: compileScene(compactSpec, target),
      frame: { tick: TIMEBASE_TICKS_PER_SECOND * 6, reducedMotion: true },
    }));
    const landscapeMarkup = render(landscape);
    const portraitMarkup = render(portrait);

    for (const markup of [landscapeMarkup, portraitMarkup]) {
      expect(markup).toContain('data-compact-code-program="true"');
      const annotationSizes = [...markup.matchAll(/data-code-annotation-font-size="([\d.]+)"/gu)].map((match) => Number(match[1]));
      expect(annotationSizes).toHaveLength(4);
      expect(annotationSizes.every((size) => size >= 26 && size <= 32)).toBe(true);
    }
    const lensOutputSize = Number(landscapeMarkup.match(/data-code-lens-output-font-size="([\d.]+)"/u)?.[1]);
    expect(lensOutputSize).toBeGreaterThanOrEqual(26);
    expect(lensOutputSize).toBeLessThanOrEqual(32);
    expect(Number(landscapeMarkup.match(/data-code-annotation-reserve="([\d.]+)"/u)?.[1])).toBeGreaterThan(180);

    const explanationMarkup = renderToStaticMarkup(createElement(SceneView, {
      scene: compileScene({
        ...compactSpec,
        id: "compact-arithmetic-explanation",
        content: {
          ...compactSpec.content,
          actions: [{
            id: "compact.explain",
            type: "explain" as const,
            lineId: "compact.4",
            startTick: TIMEBASE_TICKS_PER_SECOND * 5,
            endTick: TIMEBASE_TICKS_PER_SECOND * 7,
            narrationAnchor: "Add the shifted high product, cross term, and low product to reconstruct the original multiplication.",
          }],
        },
      }, landscape),
      frame: { tick: TIMEBASE_TICKS_PER_SECOND * 6, reducedMotion: true },
    }));
    expect(Number(explanationMarkup.match(/data-code-lens-output-font-size="([\d.]+)"/u)?.[1])).toBeLessThan(26);

    const longSpec = {
      ...compactSpec,
      id: "long-program",
      content: {
        ...compactSpec.content,
        lines: Array.from({ length: 9 }, (_, index) => ({ id: `long.${index + 1}`, text: `value_${index + 1} = calculate_a_deliberately_long_intermediate_value_for_the_general_renderer()`, annotation: `value ${index + 1}` })),
      },
    };
    const longMarkup = renderToStaticMarkup(createElement(SceneView, {
      scene: compileScene(longSpec, landscape),
      frame: { tick: TIMEBASE_TICKS_PER_SECOND * 6, reducedMotion: true },
    }));
    expect(longMarkup).toContain('data-compact-code-program="false"');
    expect(Number(longMarkup.match(/data-code-annotation-font-size="([\d.]+)"/u)?.[1])).toBeLessThan(26);
  });
});

describe("preflight diagnostics", () => {
  it("reports unknown kinds, invalid IDs, and invalid frame alignment", () => {
    const result = preflightScene({
      id: "bad id",
      content: { kind: "plugin:missing/scene", title: "Missing", data: {} },
      durationTicks: 123,
      seed: 1,
    }, landscape);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["scene.id.invalid", "scene.kind.unknown", "scene.duration.frame-alignment"]));
  });

  it("rejects orphan diagram edges and malformed quiz answers", () => {
    const diagram = specimenFor("diagram");
    const badDiagram = { ...diagram, content: { ...diagram.content, kind: "diagram" as const, edges: [{ id: "edge.bad", from: "missing", to: "node.input" }] } };
    expect(preflightScene(badDiagram, landscape).diagnostics.some((item) => item.code === "scene.diagram.edge.orphan")).toBe(true);
    const quiz = specimenFor("quiz");
    const badQuiz = { ...quiz, content: { ...quiz.content, kind: "quiz" as const, options: [{ id: "only", label: "One" }] } };
    expect(preflightScene(badQuiz, landscape).diagnostics.some((item) => item.code === "scene.quiz.options.few")).toBe(true);
  });

  it("rejects whiteboard strokes outside the board and stale live-code line references", () => {
    const board = specimenFor("whiteboard");
    if (board.content.kind !== "whiteboard") throw new Error("Expected whiteboard specimen");
    const badBoard = { ...board, content: { ...board.content, strokes: [{ ...board.content.strokes[0]!, points: [{ x: -0.1, y: 0.2 }, { x: 0.5, y: 0.5 }] }] } };
    expect(preflightScene(badBoard, landscape).diagnostics.some((item) => item.code === "scene.whiteboard.stroke.bounds")).toBe(true);

    const code = specimenFor("live-code");
    if (code.content.kind !== "live-code") throw new Error("Expected live-code specimen");
    const badCode = { ...code, content: { ...code.content, actions: [{ id: "stale", type: "type" as const, lineId: "line.missing", startTick: 1, endTick: 2 }] } };
    expect(preflightScene(badCode, landscape).diagnostics.some((item) => item.code === "scene.live-code.action.line")).toBe(true);
  });

  it("rejects whiteboard and live-code events outside the scene timeline", () => {
    const board = specimenFor("whiteboard");
    if (board.content.kind !== "whiteboard") throw new Error("Expected whiteboard specimen");
    const lateBoard = {
      ...board,
      content: {
        ...board.content,
        strokes: [{ ...board.content.strokes[0]!, endTick: board.durationTicks + 1 }],
      },
    };
    expect(preflightScene(lateBoard, landscape).diagnostics.some((item) => item.code === "scene.whiteboard.stroke.timeline"))
      .toBe(true);

    const code = specimenFor("live-code");
    if (code.content.kind !== "live-code") throw new Error("Expected live-code specimen");
    const lateCode = {
      ...code,
      content: {
        ...code.content,
        actions: [{ ...code.content.actions![0]!, endTick: code.durationTicks + 1 }],
      },
    };
    expect(preflightScene(lateCode, landscape).diagnostics.some((item) => item.code === "scene.live-code.action.timeline"))
      .toBe(true);
  });
});

describe("plugin contract", () => {
  const renderer = ({ scene }: SceneRendererProps<PluginSceneContent>) => createElement("svg", { "data-plugin-scene": scene.spec.id });
  const pluginDefinition: SceneDefinition<PluginSceneContent> = {
    kind: "plugin:lesson-lab/flashcard",
    displayName: "Flashcard",
    category: "assessment",
    description: "A test plugin scene.",
    supports: ["landscape", "portrait", "square", "custom"],
    renderer,
    defaultChoreography: () => [],
    describe: (content) => content.title,
    lint: () => [],
  };
  const plugin: ScenePlugin = {
    manifest: { id: "lesson-lab", name: "Lesson Lab", version: "1.0.0", apiVersion: "2", license: "MIT", capabilities: ["render-svg"] },
    definitions: [pluginDefinition],
  };

  it("registers a correctly namespaced plugin without changing built-ins", () => {
    expect(validateScenePlugin(plugin)).toEqual([]);
    const result = createSceneRegistry([plugin]);
    expect(result.diagnostics).toEqual([]);
    expect(result.registry.has("plugin:lesson-lab/flashcard")).toBe(true);
    expect(result.registry.list()).toHaveLength(BUILTIN_SCENE_KINDS.length + 1);
  });

  it("rejects plugin definitions outside their namespace", () => {
    const broken = { ...plugin, definitions: [{ ...pluginDefinition, kind: "plugin:other/flashcard" as const }] };
    expect(validateScenePlugin(broken).some((item) => item.code === "scene.plugin.kind.namespace")).toBe(true);
  });
});
