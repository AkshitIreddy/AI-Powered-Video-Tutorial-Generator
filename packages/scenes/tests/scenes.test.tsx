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
  SPECIMEN_SCENES,
  specimenFor,
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

    const codeEarly = renderAt("live-code", TIMEBASE_TICKS_PER_SECOND * 1.5);
    const codeLate = renderAt("live-code", TIMEBASE_TICKS_PER_SECOND * 7);
    expect(codeEarly).toContain('data-tutorial-mode="live-code"');
    expect(codeEarly).toContain('data-typing-progress="0.5000"');
    expect(codeEarly).toContain("▌");
    expect(codeLate).toContain('data-typing-progress="1.0000"');
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
    const background = { id: "background.modern-tech-signal-v1", sha256: "b".repeat(64), alt: "Owned modern signal background", fit: "cover" as const };
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

    expect(markup).toContain('data-background-treatment="artwork-aperture"');
    expect(markup).toContain('data-readability-surface="header"');
    expect(markup).toContain('data-readability-surface="presenter-insight"');
    expect(markup).not.toContain('data-presenter-disclosure="true"');
    expect(markup).toContain('data-presenter-placement="picture-in-picture"');
    expect(markup).toContain("Pinned synthetic replay guide for end-to-end");
    expect(markup).toContain(">validation</tspan>");
    expect(markup).not.toContain("Previously generated synthetic presenter replay");
    expect(markup).not.toContain("Pinned synthetic replay gui…");
    expect(markup).not.toContain('fill="#F7F8FC" opacity="0.31"');
    expect(markup).toContain('data-background-mask="aperture-only"');
    expect(markup).not.toContain('fill="#FFFFFF" opacity="0.085"');
    expect(markup.match(/alystria-asset:sha256\//g)?.length).toBe(2);
    const insight = markup.match(/data-insight-x="(\d+)" data-insight-width="(\d+)"/);
    const stage = markup.match(/data-stage-x="(\d+)" data-stage-y="\d+" data-stage-width="(\d+)"/);
    expect(insight).not.toBeNull();
    expect(stage).not.toBeNull();
    expect(Number(insight?.[1]) + Number(insight?.[2])).toBeLessThanOrEqual(Number(stage?.[1]));
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
    expect(definition).toContain("HOW THE RELATIONSHIP WORKS");
    expect(definition).toContain("Solve similar parts");

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
