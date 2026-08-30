import type { CaptionAvoidZone, CompileTarget, LayoutMetrics, Rect, SemanticRegion, TargetProfile } from "./types.js";

export function targetProfile(target: Pick<CompileTarget, "width" | "height">): TargetProfile {
  const ratio = target.width / target.height;
  if (ratio >= 1.25) return "landscape";
  if (ratio <= 0.85) return "portrait";
  if (ratio >= 0.94 && ratio <= 1.06) return "square";
  return "custom";
}

export function createLayoutMetrics(target: Required<CompileTarget>): LayoutMetrics {
  const profile = targetProfile(target);
  const minDimension = Math.min(target.width, target.height);
  const scale = minDimension / 1080;
  // Graphics-safe percentages are axis-relative: 5% of frame width at the
  // left/right and 5% of frame height at the top/bottom. A single inset based
  // on the shorter side silently reduced 16:9 horizontal safety to 2.8%.
  const safeInsetX = Math.max(32 * scale, target.width * target.safeAreaPercent);
  const safeInsetY = Math.max(32 * scale, target.height * target.safeAreaPercent);
  const safe: Rect = {
    x: safeInsetX,
    y: safeInsetY,
    width: target.width - safeInsetX * 2,
    height: target.height - safeInsetY * 2,
  };
  const portraitFactor = profile === "portrait" ? 1.08 : 1;
  return {
    profile,
    frame: { x: 0, y: 0, width: target.width, height: target.height },
    safe,
    gutter: Math.max(18, 30 * scale),
    unit: Math.max(8, 12 * scale),
    titleSize: Math.round(clamp(44 * scale * portraitFactor, 34, 88)),
    subtitleSize: Math.round(clamp(25 * scale * portraitFactor, 20, 42)),
    bodySize: Math.round(clamp(22 * scale * portraitFactor, 18, 36)),
    smallSize: Math.round(clamp(16 * scale * portraitFactor, 14, 26)),
    lineHeight: 1.34,
    columns: profile === "landscape" || (profile === "custom" && target.width > target.height) ? 2 : 1,
  };
}

export function splitColumns(rect: Rect, gap: number, ratio = 0.5): readonly [Rect, Rect] {
  const leftWidth = (rect.width - gap) * ratio;
  return [
    { x: rect.x, y: rect.y, width: leftWidth, height: rect.height },
    { x: rect.x + leftWidth + gap, y: rect.y, width: rect.width - leftWidth - gap, height: rect.height },
  ];
}

export function stackRows(rect: Rect, count: number, gap: number): readonly Rect[] {
  if (count <= 0) return [];
  const height = (rect.height - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, index) => ({
    x: rect.x,
    y: rect.y + index * (height + gap),
    width: rect.width,
    height,
  }));
}

export function insetRect(rect: Rect, amount: number): Rect {
  return {
    x: rect.x + amount,
    y: rect.y + amount,
    width: Math.max(0, rect.width - amount * 2),
    height: Math.max(0, rect.height - amount * 2),
  };
}

export function normalizedToPixels(rect: Rect, width: number, height: number): Rect {
  return { x: rect.x * width, y: rect.y * height, width: rect.width * width, height: rect.height * height };
}

export function defaultRegions(metrics: LayoutMetrics, title: string): readonly SemanticRegion[] {
  const { safe, gutter, titleSize } = metrics;
  const headerHeight = Math.min(safe.height * 0.23, titleSize * 2.2);
  return [
    {
      id: "header",
      role: "title",
      label: title,
      readingOrder: 0,
      essential: true,
      x: safe.x,
      y: safe.y,
      width: safe.width,
      height: headerHeight,
    },
    {
      id: "body",
      role: "content",
      label: "Scene content",
      readingOrder: 1,
      essential: true,
      x: safe.x,
      y: safe.y + headerHeight + gutter,
      width: safe.width,
      height: safe.height - headerHeight - gutter,
    },
  ];
}

export function defaultCaptionZone(metrics: LayoutMetrics): CaptionAvoidZone {
  const { safe } = metrics;
  return {
    id: "default-essential-content",
    reason: "essential-visual",
    priority: "preferred",
    x: safe.x,
    y: safe.y,
    width: safe.width,
    height: safe.height * 0.72,
  };
}

export function contains(container: Rect, child: Rect): boolean {
  return child.x >= container.x && child.y >= container.y && child.x + child.width <= container.x + container.width && child.y + child.height <= container.y + container.height;
}

export function overlaps(left: Rect, right: Rect): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
