import { defaultCaptionZone, createLayoutMetrics, contains, normalizedToPixels } from "./layout.js";
import { createSceneLayoutManifest, layoutSlot } from "./layout-manifest.js";
import { stableHash } from "./random.js";
import { builtinSceneRegistry } from "./registry.js";
import { TIMEBASE_TICKS_PER_SECOND, type CaptionAvoidZone, type CompileTarget, type CompiledScene, type Diagnostic, type PreflightResult, type SceneRegistry, type SceneSpec, type SemanticRegion } from "./types.js";

const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9._:-]{2,127}$/;
const DEFAULT_TARGET: Required<CompileTarget> = {
  width: 1920,
  height: 1080,
  fps: 30,
  pixelRatio: 1,
  safeAreaPercent: 0.05,
  reducedMotion: false,
  locale: "en",
};

export function compileScene(spec: SceneSpec, targetInput: CompileTarget, registry: SceneRegistry = builtinSceneRegistry): CompiledScene {
  const target: Required<CompileTarget> = { ...DEFAULT_TARGET, ...targetInput };
  const diagnostics = validateInput(spec, target, registry);
  const metrics = createLayoutMetrics(target);
  const definition = registry.get(spec.content.kind);
  const captionAvoidZones = compileCaptionZones(spec.captionAvoidZones, target, metrics);
  const layout = createSceneLayoutManifest(spec, target, metrics, captionAvoidZones);
  const regions = createSemanticRegions(spec, layout);
  const choreography = spec.choreography ?? definition?.defaultChoreography(spec) ?? [];
  const accessibilityDescription = spec.accessibilityDescription?.trim() || definition?.describe(spec.content) || `Scene titled ${spec.content.title}.`;
  diagnostics.push(...lintChoreography(choreography, spec.durationTicks));
  diagnostics.push(...lintGeometry(regions, captionAvoidZones, target));
  return {
    spec,
    target,
    metrics,
    layout,
    regions,
    captionAvoidZones,
    choreography,
    accessibilityDescription,
    diagnostics,
    contentHash: stableHash({ spec, target, implementation: "alystria-scenes-v2.1.0-constraint-layout" }),
  };
}

export function preflightScene(spec: SceneSpec, target: CompileTarget, registry: SceneRegistry = builtinSceneRegistry): PreflightResult {
  const scene = compileScene(spec, target, registry);
  return {
    ok: !scene.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    diagnostics: scene.diagnostics,
    scene,
  };
}

export function lintScene(spec: SceneSpec, target: CompileTarget, registry: SceneRegistry = builtinSceneRegistry): readonly Diagnostic[] {
  return compileScene(spec, target, registry).diagnostics;
}

function validateInput(spec: SceneSpec, target: Required<CompileTarget>, registry: SceneRegistry): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!ID_PATTERN.test(spec.id)) diagnostics.push({ code: "scene.id.invalid", severity: "error", message: "Scene ID must begin with a letter and contain only letters, digits, dots, underscores, colons, or hyphens.", path: "id" });
  if (!registry.has(spec.content.kind)) diagnostics.push({ code: "scene.kind.unknown", severity: "error", message: `No scene renderer is registered for ${spec.content.kind}.`, path: "content.kind" });
  if (!Number.isSafeInteger(spec.durationTicks) || spec.durationTicks <= 0) diagnostics.push({ code: "scene.duration.invalid", severity: "error", message: "Scene duration must be a positive integer tick count.", path: "durationTicks" });
  const ticksPerFrame = TIMEBASE_TICKS_PER_SECOND / target.fps;
  if (spec.durationTicks > 0 && spec.durationTicks % ticksPerFrame !== 0) diagnostics.push({ code: "scene.duration.frame-alignment", severity: "warning", message: `Duration is not aligned to the ${target.fps} fps frame grid.`, path: "durationTicks", remediation: `Round to a multiple of ${ticksPerFrame} ticks.` });
  if (!Number.isSafeInteger(spec.seed)) diagnostics.push({ code: "scene.seed.invalid", severity: "error", message: "Deterministic seed must be a safe integer.", path: "seed" });
  if (!Number.isInteger(target.width) || target.width < 64 || target.width > 16_384 || !Number.isInteger(target.height) || target.height < 64 || target.height > 16_384) diagnostics.push({ code: "scene.target.dimensions", severity: "error", message: "Target dimensions must be integers from 64 to 16384 pixels.", path: "target" });
  if (target.safeAreaPercent < 0 || target.safeAreaPercent > 0.2) diagnostics.push({ code: "scene.target.safe-area", severity: "error", message: "Safe area must be between 0% and 20%.", path: "target.safeAreaPercent" });
  const definition = registry.get(spec.content.kind);
  if (definition) diagnostics.push(...definition.lint(spec.content));
  diagnostics.push(...timedContentDiagnostics(spec));
  diagnostics.push(...duplicateIdDiagnostics(spec));
  return diagnostics;
}

function timedContentDiagnostics(spec: SceneSpec): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (spec.content.kind === "whiteboard") {
    for (const stroke of spec.content.strokes) {
      if (stroke.startTick < 0 || stroke.endTick > spec.durationTicks) diagnostics.push({
        code: "scene.whiteboard.stroke.timeline",
        severity: "error",
        message: `Stroke ${stroke.id} must stay inside the scene timeline.`,
        path: "content.strokes",
      });
    }
    for (const label of spec.content.labels ?? []) {
      if (label.startTick < 0 || label.startTick >= spec.durationTicks || (label.endTick !== undefined && label.endTick > spec.durationTicks)) diagnostics.push({
        code: "scene.whiteboard.label.timeline",
        severity: "error",
        message: `Label ${label.id} must stay inside the scene timeline.`,
        path: "content.labels",
      });
    }
  }
  if (spec.content.kind === "live-code") {
    for (const action of spec.content.actions ?? []) {
      if (action.startTick < 0 || action.endTick > spec.durationTicks) diagnostics.push({
        code: "scene.live-code.action.timeline",
        severity: "error",
        message: `Action ${action.id} must stay inside the scene timeline.`,
        path: "content.actions",
      });
    }
  }
  return diagnostics;
}

function duplicateIdDiagnostics(spec: SceneSpec): readonly Diagnostic[] {
  const json = JSON.stringify(spec.content);
  const matches = [...json.matchAll(/"id":"([^"]+)"/g)].map((match) => match[1]).filter((id): id is string => Boolean(id));
  const duplicates = [...new Set(matches.filter((id, index) => matches.indexOf(id) !== index))];
  return duplicates.map((id) => ({ code: "scene.content.id.duplicate", severity: "error", message: `Content ID ${id} appears more than once.`, path: "content" }));
}

function createSemanticRegions(spec: SceneSpec, layout: ReturnType<typeof createSceneLayoutManifest>): readonly SemanticRegion[] {
  const title = layoutSlot(layout, "header.title");
  const bodySlot = layoutSlot(layout, "body");
  const headerTop = Math.min(...layout.slots.filter((item) => item.id.startsWith("header.")).map((item) => item.y));
  const headerBottom = Math.max(...layout.slots.filter((item) => item.id.startsWith("header.")).map((item) => item.y + item.height));
  const base: SemanticRegion[] = [
    {
      id: "header",
      role: "title",
      label: spec.content.title,
      readingOrder: 0,
      essential: true,
      x: title.x,
      y: headerTop,
      width: layout.graphicsSafe.width,
      height: headerBottom - headerTop,
    },
    {
      id: "body",
      role: "content",
      label: "Scene content",
      readingOrder: 1,
      essential: true,
      x: bodySlot.x,
      y: bodySlot.y,
      width: bodySlot.width,
      height: bodySlot.height,
    },
  ];
  const body = base.find((region) => region.id === "body");
  if (!body) return base;
  const role = spec.content.kind === "code" || spec.content.kind === "live-code" || spec.content.kind === "walkthrough" || spec.content.kind === "diff" || spec.content.kind === "file-tree" || spec.content.kind === "terminal" || spec.content.kind === "execution-trace" || spec.content.kind === "variable-state" ? "code"
    : spec.content.kind === "chart" || spec.content.kind === "graph" || spec.content.kind === "table" || spec.content.kind === "map" || spec.content.kind === "simulation" ? "data"
    : spec.content.kind === "presenter" || spec.content.kind === "presenter-slide" ? "presenter"
    : spec.content.kind === "sources" ? "source"
    : spec.content.kind === "image-focus" || spec.content.kind === "image-comparison" || spec.content.kind === "document-focus" || spec.content.kind === "ui-demo" || spec.content.kind === "screen-recording" || spec.content.kind === "diagram" || spec.content.kind === "timeline" ? "visual"
    : "content";
  base[base.indexOf(body)] = { ...body, role, label: `${spec.content.kind} content` };
  return base;
}

function compileCaptionZones(zones: readonly CaptionAvoidZone[] | undefined, target: Required<CompileTarget>, metrics: ReturnType<typeof createLayoutMetrics>): readonly CaptionAvoidZone[] {
  if (!zones?.length) return [defaultCaptionZone(metrics)];
  return zones.map((zone) => {
    const looksNormalized = zone.x >= 0 && zone.y >= 0 && zone.width <= 1 && zone.height <= 1;
    return looksNormalized ? { ...zone, ...normalizedToPixels(zone, target.width, target.height) } : zone;
  });
}

function lintChoreography(tracks: CompiledScene["choreography"], durationTicks: number): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const ids = new Set<string>();
  for (const track of tracks) {
    if (ids.has(track.id)) diagnostics.push({ code: "scene.choreography.id.duplicate", severity: "error", message: `Choreography track ${track.id} is duplicated.`, path: "choreography" });
    ids.add(track.id);
    if (track.keyframes.length < 2) diagnostics.push({ code: "scene.choreography.keyframes.few", severity: "warning", message: `Track ${track.id} should contain at least two keyframes.`, path: "choreography" });
    let last = -1;
    for (const keyframe of track.keyframes) {
      if (keyframe.tick < last) diagnostics.push({ code: "scene.choreography.order", severity: "error", message: `Track ${track.id} keyframes must be sorted.`, path: "choreography" });
      if (keyframe.tick < 0 || keyframe.tick > durationTicks) diagnostics.push({ code: "scene.choreography.bounds", severity: "error", message: `Track ${track.id} has a keyframe outside the scene duration.`, path: "choreography" });
      if (!Number.isFinite(keyframe.value)) diagnostics.push({ code: "scene.choreography.value", severity: "error", message: `Track ${track.id} has a non-finite value.`, path: "choreography" });
      last = keyframe.tick;
    }
  }
  return diagnostics;
}

function lintGeometry(regions: readonly SemanticRegion[], zones: readonly CaptionAvoidZone[], target: Required<CompileTarget>): readonly Diagnostic[] {
  const frame = { x: 0, y: 0, width: target.width, height: target.height };
  const diagnostics: Diagnostic[] = [];
  for (const region of regions) if (!contains(frame, region)) diagnostics.push({ code: "scene.region.out-of-bounds", severity: "error", message: `Semantic region ${region.id} exceeds the frame.`, path: "regions" });
  for (const zone of zones) if (!contains(frame, zone)) diagnostics.push({ code: "scene.caption-zone.out-of-bounds", severity: "error", message: `Caption avoid zone ${zone.id} exceeds the frame.`, path: "captionAvoidZones" });
  return diagnostics;
}
