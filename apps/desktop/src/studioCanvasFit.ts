export interface StudioCanvasSize {
  readonly width: number;
  readonly height: number;
}

/** Fits a fixed-ratio canvas inside the usable stage without clipping either axis. */
export function fitStudioCanvas(
  container: StudioCanvasSize,
  padding: StudioCanvasSize,
  aspectRatio = 16 / 9,
): StudioCanvasSize {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return { width: 0, height: 0 };
  const availableWidth = Math.max(0, container.width - padding.width);
  const availableHeight = Math.max(0, container.height - padding.height);
  const width = Math.min(availableWidth, availableHeight * aspectRatio);
  return { width, height: width / aspectRatio };
}
