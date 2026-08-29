import type {
  CaptionRenderStyle,
  PresenterVideoInput,
  PresenterVideoPlacement,
  RenderManifest,
  RenderTarget,
} from "./contracts.js";
import { captionTopBandHeight } from "./captions.js";
import type { FrameRange } from "./ranges.js";
import { frameToTick } from "./timebase.js";

export interface PresenterRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PresenterCompositeLayer extends PresenterRect {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
  readonly sceneId: string;
  readonly sourceStartTick: number;
  /** Position of the first presenter frame on the selected render timeline. */
  readonly timelineStartTick: number;
  readonly durationTicks: number;
  readonly fit: "cover" | "contain";
  readonly placement: PresenterVideoPlacement;
}

function even(value: number, minimum = 2): number {
  return Math.max(minimum, Math.round(value / 2) * 2);
}

function clampRect(rect: PresenterRect, target: RenderTarget): PresenterRect {
  const x = even(Math.max(0, Math.min(target.width - 2, rect.x)), 0);
  const y = even(Math.max(0, Math.min(target.height - 2, rect.y)), 0);
  return {
    x,
    y,
    width: even(Math.min(rect.width, target.width - x)),
    height: even(Math.min(rect.height, target.height - y)),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Match SceneCanvas/PresenterRenderer's deterministic PIP panel before any
 * caption-band transform. Keeping this in one explicit layout calculation
 * lets the FFmpeg video replace the preview portrait rather than appearing as
 * a second, offset presenter later in assembly.
 */
function scenePipRect(target: RenderTarget): PresenterRect {
  const minimum = Math.min(target.width, target.height);
  const scale = minimum / 1_080;
  const safeInset = Math.max(32 * scale, minimum * 0.05);
  const safeWidth = target.width - safeInset * 2;
  const safeHeight = target.height - safeInset * 2;
  const portrait = target.width / target.height <= 0.85;
  const titleSize = Math.round(clamp(44 * scale * (portrait ? 1.08 : 1), 34, 88));
  const headerHeight = Math.min(safeHeight * 0.23, titleSize * 2.2);
  const gutter = Math.max(18, 30 * scale);
  const body = {
    x: safeInset,
    y: safeInset + headerHeight + gutter,
    width: safeWidth,
    height: safeHeight - headerHeight - gutter,
  };
  return {
    x: body.x + body.width * 0.68,
    y: body.y + body.height * 0.22,
    width: body.width * 0.30,
    height: body.height * 0.58,
  };
}

function captionAdjustedRect(
  rect: PresenterRect,
  target: RenderTarget,
  captionStyle: CaptionRenderStyle | undefined,
): PresenterRect {
  const band = captionTopBandHeight(target, captionStyle);
  if (band <= 0) return rect;
  const scale = (target.height - band) / target.height;
  const translateX = target.width * (1 - scale) / 2;
  return {
    x: translateX + rect.x * scale,
    y: band + rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

/**
 * Fixed responsive presenter regions. They deliberately avoid the lower
 * caption safe area and never accept generated coordinates.
 */
export function presenterRect(
  target: RenderTarget,
  placement: PresenterVideoPlacement,
  captionStyle?: CaptionRenderStyle,
): PresenterRect {
  const left = target.safeArea?.left ?? Math.round(target.width * 0.04);
  const right = target.safeArea?.right ?? Math.round(target.width * 0.04);
  const top = target.safeArea?.top ?? Math.round(target.height * 0.05);
  const availableWidth = target.width - left - right;
  const tall = target.height > target.width;

  switch (placement) {
    case "full":
      return { x: 0, y: 0, width: even(target.width), height: even(target.height) };
    case "picture-in-picture":
      return clampRect(captionAdjustedRect(scenePipRect(target), target, captionStyle), target);
    case "split-left":
      return clampRect({
        x: left,
        y: top + target.height * 0.10,
        width: availableWidth * (tall ? 0.78 : 0.38),
        height: target.height * (tall ? 0.38 : 0.67),
      }, target);
    case "split-right": {
      const width = even(availableWidth * (tall ? 0.78 : 0.38));
      return clampRect({
        x: target.width - right - width,
        y: top + target.height * 0.10,
        width,
        height: target.height * (tall ? 0.38 : 0.67),
      }, target);
    }
  }
}

interface TimedPresenterVideo {
  readonly input: PresenterVideoInput;
  readonly sceneStartTick: number;
  readonly sceneEndTick: number;
}

function timedPresenterVideos(manifest: RenderManifest): readonly TimedPresenterVideo[] {
  const bindings = new Map((manifest.presenterVideos ?? []).map((input) => [input.sceneId, input] as const));
  const timed: TimedPresenterVideo[] = [];
  let sceneStartTick = 0;
  for (const scene of manifest.scenes) {
    const sceneEndTick = sceneStartTick + scene.durationTicks;
    const input = bindings.get(scene.id);
    if (input) timed.push({ input, sceneStartTick, sceneEndTick });
    sceneStartTick = sceneEndTick;
  }
  return timed;
}

/** Resolve source and selected-timeline offsets before generating FFmpeg args. */
export function resolvePresenterCompositeLayers(
  manifest: RenderManifest,
  range: FrameRange,
): readonly PresenterCompositeLayer[] {
  const selectionStartTick = frameToTick(range.startFrame, manifest.target.frameRate);
  const selectionEndTick = frameToTick(range.endFrame, manifest.target.frameRate);
  return timedPresenterVideos(manifest).flatMap(({ input, sceneStartTick, sceneEndTick }) => {
    const overlapStartTick = Math.max(selectionStartTick, sceneStartTick);
    const overlapEndTick = Math.min(selectionEndTick, sceneEndTick);
    if (overlapEndTick <= overlapStartTick) return [];
    const rect = presenterRect(manifest.target, input.placement, manifest.captionStyle);
    return [{
      ...rect,
      id: input.id,
      path: input.path,
      sha256: input.sha256.toLowerCase(),
      sceneId: input.sceneId,
      sourceStartTick: (input.sourceStartTick ?? 0) + overlapStartTick - sceneStartTick,
      timelineStartTick: overlapStartTick - selectionStartTick,
      durationTicks: overlapEndTick - overlapStartTick,
      fit: input.fit ?? "cover",
      placement: input.placement,
    }];
  });
}
