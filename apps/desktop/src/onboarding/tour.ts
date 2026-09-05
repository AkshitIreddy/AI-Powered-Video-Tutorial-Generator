import type { GuidedTourStep, SpotlightRect, TourPlacement } from "./types";

export interface ViewportSize {
  width: number;
  height: number;
}

export interface RectLike {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TourPanelPosition {
  top: number;
  left: number;
  placement: TourPlacement;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function computeSpotlightRect(
  target: RectLike | null,
  viewport: ViewportSize,
  padding = 10,
  borderRadius = 16,
): SpotlightRect {
  if (!target) {
    return {
      top: viewport.height / 2,
      left: viewport.width / 2,
      width: 0,
      height: 0,
      borderRadius,
    };
  }

  const left = clamp(target.left - padding, 0, viewport.width);
  const top = clamp(target.top - padding, 0, viewport.height);
  const right = clamp(target.left + target.width + padding, 0, viewport.width);
  const bottom = clamp(target.top + target.height + padding, 0, viewport.height);
  return {
    top,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    borderRadius,
  };
}

export function computeTourPanelPosition(
  spotlight: SpotlightRect,
  viewport: ViewportSize,
  placement: TourPlacement = "bottom",
  panelSize = { width: 360, height: 240 },
  gap = 18,
): TourPanelPosition {
  const margin = 16;
  const centeredLeft = spotlight.left + spotlight.width / 2 - panelSize.width / 2;
  const centeredTop = spotlight.top + spotlight.height / 2 - panelSize.height / 2;
  const candidates: Record<TourPlacement, { top: number; left: number }> = {
    top: { top: spotlight.top - panelSize.height - gap, left: centeredLeft },
    right: { top: centeredTop, left: spotlight.left + spotlight.width + gap },
    bottom: { top: spotlight.top + spotlight.height + gap, left: centeredLeft },
    left: { top: centeredTop, left: spotlight.left - panelSize.width - gap },
    center: { top: viewport.height / 2 - panelSize.height / 2, left: viewport.width / 2 - panelSize.width / 2 },
  };
  const order: TourPlacement[] = [placement, "bottom", "right", "left", "top", "center"];
  const uniqueOrder = [...new Set(order)];
  let chosen: TourPlacement = "center";

  for (const candidate of uniqueOrder) {
    const point = candidates[candidate];
    if (
      point.top >= margin &&
      point.left >= margin &&
      point.top + panelSize.height <= viewport.height - margin &&
      point.left + panelSize.width <= viewport.width - margin
    ) {
      chosen = candidate;
      break;
    }
  }

  const point = candidates[chosen];
  return {
    placement: chosen,
    top: clamp(point.top, margin, Math.max(margin, viewport.height - panelSize.height - margin)),
    left: clamp(point.left, margin, Math.max(margin, viewport.width - panelSize.width - margin)),
  };
}

export function safeTourIndex(steps: readonly GuidedTourStep[], requestedIndex: number): number {
  if (steps.length === 0) return 0;
  return clamp(Math.trunc(requestedIndex), 0, steps.length - 1);
}

export function guidedTourCompletionKey(step: GuidedTourStep): string {
  return step.completion?.type === "external" && step.completion.key
    ? step.completion.key
    : step.id;
}

/**
 * Replays unfinished work first. When every step is already complete, the full
 * tour remains available as a read-only refresher instead of opening empty UI.
 */
export function createGuidedTourReplaySteps(
  steps: readonly GuidedTourStep[],
  completedStepIds: readonly string[],
): readonly GuidedTourStep[] {
  const completed = new Set(completedStepIds);
  const pending = steps.filter((step) => !completed.has(step.id) && !completed.has(guidedTourCompletionKey(step)));
  return pending.length > 0 ? pending : steps;
}
