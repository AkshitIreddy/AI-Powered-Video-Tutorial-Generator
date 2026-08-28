import type { CompiledLayout, Insets, RenderTarget, ResolvedScene } from "./contracts.js";

export interface LayoutCompileContext {
  readonly target: RenderTarget;
  readonly scene: ResolvedScene;
}

export type LayoutCompiler = (context: LayoutCompileContext, base: CompiledLayout) => CompiledLayout;

const DEFAULT_SAFE_AREA_RATIO = 0.05;

function edge(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`Safe-area inset must be non-negative, got ${value}`);
  return Math.round(value);
}

export function resolveSafeArea(target: RenderTarget): Insets {
  const horizontal = Math.round(target.width * DEFAULT_SAFE_AREA_RATIO);
  const vertical = Math.round(target.height * DEFAULT_SAFE_AREA_RATIO);
  return {
    top: edge(target.safeArea?.top, vertical),
    right: edge(target.safeArea?.right, horizontal),
    bottom: edge(target.safeArea?.bottom, vertical),
    left: edge(target.safeArea?.left, horizontal),
  };
}

export function classifyLayout(target: RenderTarget): CompiledLayout["family"] {
  const ratio = target.width / target.height;
  if (ratio >= 1.25) return "wide";
  if (ratio <= 0.8) return "tall";
  return "balanced";
}

export function compileBaseLayout(target: RenderTarget): CompiledLayout {
  const safeArea = resolveSafeArea(target);
  const family = classifyLayout(target);
  const shortEdge = Math.min(target.width, target.height);
  const contentWidth = target.width - safeArea.left - safeArea.right;
  const contentHeight = target.height - safeArea.top - safeArea.bottom;
  if (contentWidth <= 0 || contentHeight <= 0) throw new RangeError("Safe area consumes the complete render target");
  return {
    family,
    safeArea,
    contentBox: { x: safeArea.left, y: safeArea.top, width: contentWidth, height: contentHeight },
    // Preserve readable preview typography at the smallest supported editor
    // canvases. Large targets still scale fluidly from the short edge.
    titleSize: Math.max(24, Math.round(shortEdge * (family === "tall" ? 0.072 : 0.064))),
    bodySize: Math.max(14, Math.round(shortEdge * (family === "tall" ? 0.034 : 0.028))),
    columns: family === "wide" ? 2 : 1,
  };
}

/** Registry is explicit and immutable after construction to keep compilation reproducible. */
export class ResponsiveLayoutCompiler {
  readonly #hooks: ReadonlyMap<string, LayoutCompiler>;

  constructor(hooks: Readonly<Record<string, LayoutCompiler>> = {}) {
    this.#hooks = new Map(Object.entries(hooks));
  }

  compile(context: LayoutCompileContext): CompiledLayout {
    const base = compileBaseLayout(context.target);
    const hook = this.#hooks.get(context.scene.kind) ?? this.#hooks.get("*");
    if (!hook) return base;
    const compiled = hook(context, base);
    if (compiled.contentBox.width <= 0 || compiled.contentBox.height <= 0) {
      throw new RangeError(`Layout hook for ${context.scene.kind} produced an empty content box`);
    }
    return Object.freeze(compiled);
  }
}
