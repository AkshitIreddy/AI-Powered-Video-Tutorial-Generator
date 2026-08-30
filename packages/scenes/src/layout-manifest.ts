import { insetRect } from "./layout.js";
import type {
  CaptionAvoidZone,
  CompileTarget,
  LayoutConstraint,
  LayoutMetrics,
  LayoutSlot,
  Rect,
  SceneLayoutManifest,
  SceneSpec,
} from "./types.js";

export const SCENE_LAYOUT_COMPILER_VERSION = "constraint-layout-v1";

function insetForRatio(frame: Rect, ratio: number): Rect {
  const x = frame.width * ratio;
  const y = frame.height * ratio;
  return { x, y, width: frame.width - x * 2, height: frame.height - y * 2 };
}

function slot(
  id: string,
  role: LayoutSlot["role"],
  rect: Rect,
  readingOrder: number,
  essential = true,
  allowedOverlapWith: readonly string[] = [],
): LayoutSlot {
  return { id, role, readingOrder, essential, allowedOverlapWith, ...rect };
}

function constraint(
  id: string,
  relation: LayoutConstraint["relation"],
  first: string,
  second: string,
  strength: LayoutConstraint["strength"],
  minimumGap?: number,
  tolerance?: number,
): LayoutConstraint {
  return {
    id,
    relation,
    first,
    second,
    strength,
    ...(minimumGap === undefined ? {} : { minimumGap }),
    ...(tolerance === undefined ? {} : { tolerance }),
  };
}

/**
 * Compiles the common frame into explicit slots and constraints. Individual
 * scene grammars may divide `body` further, but they may not move the shared
 * header or essential content outside these required regions.
 */
export function createSceneLayoutManifest(
  spec: SceneSpec,
  target: Required<CompileTarget>,
  metrics: LayoutMetrics,
  avoidRegions: readonly CaptionAvoidZone[],
): SceneLayoutManifest {
  const graphicsSafe = metrics.safe;
  // EBU R95's 3.5% action-safe inset remains useful for edge-to-edge art,
  // while essential graphics use the stricter project/target safe inset.
  const actionSafe = insetForRatio(metrics.frame, 0.035);
  const eyebrow = Boolean("eyebrow" in spec.content && spec.content.eyebrow);
  const subtitle = Boolean("subtitle" in spec.content && spec.content.subtitle);
  const eyebrowHeight = eyebrow ? Math.max(metrics.smallSize * 1.22, metrics.unit * 2) : 0;
  const titleLineCount = target.width / target.height <= 0.85 ? 3 : 2;
  const titleHeight = metrics.titleSize * titleLineCount * 1.04;
  const headerGap = eyebrow ? Math.max(metrics.unit, metrics.smallSize * 0.42) : 0;
  const headerHeight = Math.min(
    graphicsSafe.height * (metrics.profile === "portrait" ? 0.2 : 0.24),
    Math.max(metrics.titleSize * 2.2, eyebrowHeight + headerGap + titleHeight),
  );
  const subtitleWidth = subtitle && metrics.profile === "landscape" ? graphicsSafe.width * 0.28 : 0;
  const titleWidth = graphicsSafe.width - (subtitleWidth ? subtitleWidth + metrics.gutter : 0);
  const eyebrowRect: Rect = { x: graphicsSafe.x, y: graphicsSafe.y, width: titleWidth, height: eyebrowHeight };
  const titleRect: Rect = {
    x: graphicsSafe.x,
    y: graphicsSafe.y + eyebrowHeight + headerGap,
    width: titleWidth,
    height: Math.max(metrics.titleSize * 1.08, headerHeight - eyebrowHeight - headerGap),
  };
  const subtitleRect: Rect = subtitleWidth
    ? { x: graphicsSafe.x + graphicsSafe.width - subtitleWidth, y: graphicsSafe.y, width: subtitleWidth, height: headerHeight }
    : { x: graphicsSafe.x, y: titleRect.y + titleRect.height, width: graphicsSafe.width, height: 0 };
  const bodyRect: Rect = {
    x: graphicsSafe.x,
    y: graphicsSafe.y + headerHeight + metrics.gutter,
    width: graphicsSafe.width,
    height: graphicsSafe.height - headerHeight - metrics.gutter,
  };
  if (bodyRect.height <= 0) throw new RangeError(`Scene ${spec.id} header consumes the complete graphics-safe area`);

  const slots: LayoutSlot[] = [
    ...(eyebrow ? [slot("header.eyebrow", "eyebrow", eyebrowRect, 0)] : []),
    slot("header.title", "title", titleRect, eyebrow ? 1 : 0),
    ...(subtitle ? [slot("header.subtitle", "subtitle", subtitleRect, eyebrow ? 2 : 1)] : []),
    slot("body", "content", bodyRect, subtitle ? 3 : eyebrow ? 2 : 1),
  ];
  const constraints: LayoutConstraint[] = [
    ...slots.map((item) => constraint(`inside.${item.id}`, "inside", item.id, "graphics-safe", "required")),
    constraint("header-title-above-body", "above", "header.title", "body", "required", metrics.gutter),
    constraint("header-body-shared-start", "align-start", "header.title", "body", "strong", undefined, 0.5),
    ...(eyebrow ? [
      constraint("eyebrow-above-title", "above", "header.eyebrow", "header.title", "required", headerGap),
      constraint("eyebrow-title-shared-start", "align-start", "header.eyebrow", "header.title", "strong", undefined, 0.5),
    ] : []),
    ...(subtitle ? [constraint("title-left-of-subtitle", "left-of", "header.title", "header.subtitle", "required", metrics.gutter)] : []),
  ];

  return Object.freeze({
    schemaVersion: 1,
    compilerVersion: SCENE_LAYOUT_COMPILER_VERSION,
    targetProfile: metrics.profile,
    locale: target.locale,
    graphicsSafe,
    actionSafe,
    grid: {
      columns: 12 as const,
      columnGap: metrics.gutter,
      baselineStep: Math.max(4, Math.round(metrics.unit)),
      ...insetRect(graphicsSafe, 0),
    },
    slots: Object.freeze(slots),
    constraints: Object.freeze(constraints),
    avoidRegions: Object.freeze([...avoidRegions]),
  });
}

export function layoutSlot(manifest: SceneLayoutManifest, id: string): LayoutSlot {
  const result = manifest.slots.find((item) => item.id === id);
  if (!result) throw new RangeError(`Layout slot ${id} is not defined`);
  return result;
}
