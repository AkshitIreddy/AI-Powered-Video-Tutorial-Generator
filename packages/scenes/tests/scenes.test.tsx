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
      expect(markup).not.toMatch(/<(?:image|use)[^>]+href="https?:\/\//);
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
