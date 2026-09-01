import { createLayoutMetrics, splitColumns, stackRows } from "./layout.js";
import { commonSceneBodyRect } from "./layout-manifest.js";
import type { CompileTarget, LayoutMetrics, Rect } from "./types.js";

export type PresenterPlacement = "full" | "picture-in-picture" | "split-left" | "split-right";

export interface PresenterLayout {
  readonly body: Rect;
  readonly stage: Rect;
  readonly media: Rect;
  readonly insight?: Rect;
}

type PresenterLayoutTarget = Pick<Required<CompileTarget>, "width" | "height" | "safeAreaPercent">;

function even(value: number, minimum = 2): number {
  return Math.max(minimum, Math.round(value / 2) * 2);
}

function ffmpegSafeRect(rect: Rect): Rect {
  return {
    x: even(rect.x, 0),
    y: even(rect.y, 0),
    width: even(rect.width),
    height: even(rect.height),
  };
}

export function presenterLayoutFromBody(
  body: Rect,
  metrics: LayoutMetrics,
  placement: PresenterPlacement,
  withSlide: boolean,
): PresenterLayout {
  const isWide = metrics.columns === 2;
  const split = isWide
    ? splitColumns(body, metrics.gutter * 0.65, placement === "split-right" ? 0.59 : 0.42)
    : stackRows(body, 2, metrics.gutter * 0.55) as readonly [Rect, Rect];
  const presenterPanel = placement === "split-right" ? split[1] : split[0];
  const insightPanel = placement === "split-right" ? split[0] : split[1];
  const stage: Rect = placement === "picture-in-picture"
    ? { x: body.x + body.width * 0.68, y: body.y + body.height * 0.18, width: body.width * 0.3, height: body.height * 0.66 }
    : withSlide || placement !== "full"
      ? presenterPanel
      : isWide
        ? { x: body.x, y: body.y, width: body.width * 0.46, height: body.height }
        : { x: body.x + body.width * 0.08, y: body.y, width: body.width * 0.84, height: body.height * 0.62 };
  const media = ffmpegSafeRect(placement === "full" && !withSlide
    ? stage
    : {
        x: stage.x + stage.width * 0.07,
        y: stage.y + stage.height * 0.05,
        width: stage.width * 0.86,
        height: stage.height * 0.71,
      });
  const insight: Rect | undefined = withSlide
    ? placement === "picture-in-picture" && isWide
      ? { x: body.x, y: body.y, width: body.width * 0.64, height: body.height }
      : insightPanel
    : placement === "full"
      ? (isWide
          ? { x: body.x + body.width * 0.5, y: body.y, width: body.width * 0.5, height: body.height }
          : { x: body.x, y: body.y + body.height * 0.67, width: body.width, height: body.height * 0.3 })
      : undefined;
  return { body, stage, media, ...(insight ? { insight } : {}) };
}

export function createPresenterLayout(
  target: PresenterLayoutTarget,
  content: Readonly<{ eyebrow?: string | undefined; subtitle?: string | undefined }>,
  placement: PresenterPlacement,
  withSlide: boolean,
): PresenterLayout {
  const metrics = createLayoutMetrics({
    width: target.width,
    height: target.height,
    safeAreaPercent: target.safeAreaPercent,
  } as Required<CompileTarget>);
  const body = commonSceneBodyRect(content, metrics);
  return presenterLayoutFromBody(body, metrics, placement, withSlide);
}
