import { createHash } from "node:crypto";
import type {
  CompiledLayout,
  FrameContext,
  RenderManifest,
  RenderedFrame,
  ResolvedScene,
} from "./contracts.js";
import { assertRenderManifest } from "./contracts.js";
import { escapeMarkup, renderCaptionSvg } from "./captions.js";
import { ResponsiveLayoutCompiler } from "./layout.js";
import { SeededRandom, withDeterminismGuard } from "./random.js";
import {
  SceneViewStaticAdapter,
  assertSceneSpecMatchesResolvedScene,
  type SceneSpecResolver,
  type SceneViewAdapterOptions,
} from "./scene-view.js";
import { frameToTick, tickToFrameCeil, ticksPerFrame } from "./timebase.js";

export const RENDERER_VERSION = "2.0.0-rc.0";

export interface SceneRenderInput {
  readonly scene: ResolvedScene;
  readonly context: FrameContext;
  readonly layout: CompiledLayout;
  readonly random: SeededRandom;
}

export type SceneRenderer = (input: SceneRenderInput) => string;

export interface FrameRendererOptions {
  readonly sceneRenderers?: Readonly<Record<string, SceneRenderer>>;
  /** Resolves the immutable SceneSpec associated with a manifest scene. */
  readonly sceneSpecResolver?: SceneSpecResolver;
  readonly sceneView?: SceneViewAdapterOptions;
  readonly layoutCompiler?: ResponsiveLayoutCompiler;
  readonly verifyRepeatability?: boolean;
}

interface LocatedScene {
  readonly scene: ResolvedScene;
  readonly startTick: number;
  readonly endTick: number;
  readonly globalFrame: number;
  readonly localFrame: number;
  readonly tick: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function assertSafeSvgFragment(fragment: string, sceneId: string): void {
  const forbidden = [
    /<\s*script\b/i,
    /\son[a-z]+\s*=/i,
    /(?:href|src)\s*=\s*["']\s*(?:https?:|data:text\/html|javascript:)/i,
    /url\s*\(\s*["']?\s*(?:https?:|data:|javascript:)/i,
    /<\s*(?:iframe|object|embed)\b/i,
  ];
  if (forbidden.some((pattern) => pattern.test(fragment))) {
    throw new TypeError(`Scene ${sceneId} emitted executable or remote SVG content`);
  }
}

function locateScene(manifest: RenderManifest, requestedFrame: number): LocatedScene {
  if (!Number.isSafeInteger(requestedFrame) || requestedFrame < 0) {
    throw new RangeError(`Frame must be a non-negative safe integer, got ${requestedFrame}`);
  }
  const tick = frameToTick(requestedFrame, manifest.target.frameRate);
  let startTick = 0;
  for (const scene of manifest.scenes) {
    const endTick = startTick + scene.durationTicks;
    if (tick < endTick) {
      const localTick = tick - startTick;
      return {
        scene,
        startTick,
        endTick,
        tick,
        globalFrame: requestedFrame,
        localFrame: Math.floor(localTick / ticksPerFrame(manifest.target.frameRate)),
      };
    }
    startTick = endTick;
  }
  throw new RangeError(`Frame ${requestedFrame} is outside manifest duration (${totalFrames(manifest)} frames)`);
}

export function totalTicks(manifest: RenderManifest): number {
  return manifest.scenes.reduce((sum, scene) => sum + scene.durationTicks, 0);
}

export function totalFrames(manifest: RenderManifest): number {
  return tickToFrameCeil(totalTicks(manifest), manifest.target.frameRate);
}

function decorativeThread(input: SceneRenderInput): string {
  const { target } = input.context;
  const count = input.layout.family === "tall" ? 7 : 11;
  const points = Array.from({ length: count }, (_, index) => {
    const x = ((index + 0.5) / count) * target.width;
    const wave = Math.sin(index * 1.35 + input.context.progress * Math.PI * 2);
    const jitter = input.random.fork(`thread-${index}`).between(-0.018, 0.018) * target.height;
    const y = target.height * (0.17 + index / count * 0.64) + wave * target.height * 0.025 + jitter;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `<polyline points="${points.join(" ")}" fill="none" stroke="#5658e8" stroke-opacity="0.18" stroke-width="${Math.max(2, Math.round(target.width / 640))}"/>`;
}

export const fixtureSceneRenderer: SceneRenderer = (input) => {
  const { scene, context, layout } = input;
  const { target } = context;
  const content = scene.content;
  const accent = content.accent && /^#[0-9a-fA-F]{6}$/.test(content.accent) ? content.accent : "#5658e8";
  const enter = clamp(context.progress / 0.16, 0, 1);
  const eased = 1 - (1 - enter) ** 3;
  const titleY = layout.contentBox.y + layout.contentBox.height * (layout.family === "tall" ? 0.28 : 0.34);
  const titleX = layout.contentBox.x + (1 - eased) * target.width * 0.025;
  const titleWidth = layout.family === "wide" ? layout.contentBox.width * 0.64 : layout.contentBox.width;
  const titleTop = titleY - layout.titleSize;
  const eyebrowY = titleTop - layout.bodySize * 0.7;
  const bodyY = titleY + layout.titleSize * 1.55;
  const itemStart = bodyY + layout.bodySize * (content.body ? 4.45 : 1.35);
  const footerLabel = `ALYSTRIA / ${scene.id.toUpperCase()}`;
  const footerFontSize = Math.max(10, Math.round(layout.bodySize * 0.52));
  const estimatedFooterWidth = footerLabel.length * footerFontSize * 0.62;
  const constrainedFooterWidth = Math.min(layout.contentBox.width, estimatedFooterWidth);
  const footerLength = estimatedFooterWidth > layout.contentBox.width
    ? ` textLength="${constrainedFooterWidth.toFixed(1)}" lengthAdjust="spacingAndGlyphs"`
    : "";
  const items = (content.items ?? []).slice(0, 5).map((item, index) => {
    const y = itemStart + layout.bodySize * index * 1.55;
    return `<g transform="translate(0 ${(1 - clamp((enter - index * 0.07) / 0.72, 0, 1)) * 18})" opacity="${clamp((enter - index * 0.07) / 0.72, 0, 1).toFixed(3)}">
      <circle cx="${titleX + layout.bodySize * 0.35}" cy="${y - layout.bodySize * 0.28}" r="${layout.bodySize * 0.17}" fill="${accent}"/>
      <text x="${titleX + layout.bodySize * 0.85}" y="${y}" font-size="${layout.bodySize}" fill="#303448">${escapeMarkup(item)}</text>
    </g>`;
  }).join("\n");
  return `<rect width="${target.width}" height="${target.height}" fill="#f7f8fc"/>
  <rect x="0" y="0" width="${Math.max(8, target.width * 0.009)}" height="${target.height}" fill="${accent}"/>
  ${decorativeThread(input)}
  <circle cx="${target.width * 0.88}" cy="${target.height * 0.18}" r="${Math.min(target.width, target.height) * 0.14}" fill="${accent}" fill-opacity="0.065"/>
  <g font-family="Atkinson Hyperlegible, Arial, sans-serif">
    ${content.eyebrow ? `<text x="${titleX}" y="${eyebrowY}" font-family="JetBrains Mono, monospace" font-size="${Math.round(layout.bodySize * 0.72)}" letter-spacing="${Math.round(layout.bodySize * 0.12)}" fill="${accent}">${escapeMarkup(content.eyebrow.toUpperCase())}</text>` : ""}
    <foreignObject x="${titleX}" y="${titleTop}" width="${titleWidth}" height="${layout.titleSize * 2.8}" opacity="${eased.toFixed(3)}">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Atkinson Hyperlegible,Arial,sans-serif;font-size:${layout.titleSize}px;font-weight:760;line-height:1.04;color:#151827;letter-spacing:-0.035em">${escapeMarkup(content.title)}</div>
    </foreignObject>
    ${content.body ? `<foreignObject x="${titleX}" y="${bodyY}" width="${titleWidth * 0.94}" height="${layout.bodySize * 3.4}"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Atkinson Hyperlegible,Arial,sans-serif;font-size:${layout.bodySize}px;line-height:1.35;color:#565b70">${escapeMarkup(content.body)}</div></foreignObject>` : ""}
    ${items}
  </g>
  <text x="${target.width - layout.safeArea.right}" y="${target.height - layout.safeArea.bottom}" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="${footerFontSize}" fill="#6f7488"${footerLength}>${escapeMarkup(footerLabel)}</text>`;
};

function documentShell(svg: string, context: FrameContext, description: string): { html: string; svg: string } {
  const title = escapeMarkup(description || `Scene ${context.sceneId}`);
  const svgDocument = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${context.target.width}" height="${context.target.height}" viewBox="0 0 ${context.target.width} ${context.target.height}" role="img" aria-label="${title}">${svg}</svg>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=${context.target.width},initial-scale=1"><title>${title}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f7f8fc}svg{display:block;width:100%;height:100%}*{box-sizing:border-box}</style></head><body data-render-ready="true" data-frame="${context.globalFrame}">${svgDocument}</body></html>`;
  return { html, svg: svgDocument };
}

function appendSvgFragment(svg: string, fragment: string): string {
  if (!fragment) return svg;
  const close = svg.lastIndexOf("</svg>");
  if (close < 0) throw new TypeError("SceneView output is missing a closing SVG element");
  return `${svg.slice(0, close)}\n${fragment}\n${svg.slice(close)}`;
}

function htmlShellForSvg(svg: string, context: FrameContext, description: string, language: string): string {
  const title = escapeMarkup(description || `Scene ${context.sceneId}`);
  return `<!doctype html><html lang="${escapeMarkup(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=${context.target.width},initial-scale=1"><title>${title}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f7f8fc}svg{display:block;width:100%;height:100%}*{box-sizing:border-box}</style></head><body data-render-ready="true" data-frame="${context.globalFrame}">${svg}</body></html>`;
}

export class FrameRenderer {
  readonly #renderers: ReadonlyMap<string, SceneRenderer>;
  readonly #sceneSpecResolver: SceneSpecResolver | undefined;
  readonly #sceneView: SceneViewStaticAdapter;
  readonly #layoutCompiler: ResponsiveLayoutCompiler;
  readonly #verifyRepeatability: boolean;

  constructor(options: FrameRendererOptions = {}) {
    this.#renderers = new Map(Object.entries(options.sceneRenderers ?? {}));
    this.#sceneSpecResolver = options.sceneSpecResolver;
    this.#sceneView = new SceneViewStaticAdapter(options.sceneView);
    this.#layoutCompiler = options.layoutCompiler ?? new ResponsiveLayoutCompiler();
    this.#verifyRepeatability = options.verifyRepeatability ?? false;
  }

  render(manifest: RenderManifest, frame: number, mode: FrameContext["mode"] = "final"): RenderedFrame {
    assertRenderManifest(manifest);
    const located = locateScene(manifest, frame);
    const localTick = located.tick - located.startTick;
    const context: FrameContext = Object.freeze({
      manifestId: manifest.id,
      sceneId: located.scene.id,
      target: manifest.target,
      frame: located.localFrame,
      globalFrame: located.globalFrame,
      tick: located.tick,
      localTick,
      progress: clamp(localTick / located.scene.durationTicks, 0, 1),
      seed: `${located.scene.seed}:${located.localFrame}`,
      mode,
    });
    const layout = withDeterminismGuard(() => this.#layoutCompiler.compile({ target: manifest.target, scene: located.scene }));
    const customRenderer = this.#renderers.get(located.scene.kind) ?? this.#renderers.get("*");
    const sceneSpec = customRenderer ? undefined : this.#sceneSpecResolver?.(located.scene);
    if (sceneSpec) assertSceneSpecMatchesResolvedScene(sceneSpec, located.scene);
    const renderer = customRenderer ?? fixtureSceneRenderer;
    const run = (): { html: string; svg: string } => {
      if (sceneSpec) {
        // React's server renderer samples performance.now() internally for
        // scheduling. It never enters the markup, so retain every other guard
        // while allowing that implementation detail.
        return withDeterminismGuard(() => {
          const rendered = this.#sceneView.renderSpec(sceneSpec, manifest.target, localTick);
          const captionSvg = renderCaptionSvg(located.scene.captions ?? [], localTick, manifest.target);
          const svg = appendSvgFragment(rendered.svg, captionSvg);
          assertSafeSvgFragment(svg, located.scene.id);
          return {
            svg,
            html: htmlShellForSvg(svg, context, located.scene.accessibilityDescription ?? rendered.scene.accessibilityDescription, rendered.scene.target.locale),
          };
        }, { forbidPerformanceNow: false });
      }
      return withDeterminismGuard(() => {
        const random = new SeededRandom(context.seed);
        const sceneSvg = renderer({ scene: located.scene, context, layout, random });
        assertSafeSvgFragment(sceneSvg, located.scene.id);
        const captionSvg = renderCaptionSvg(located.scene.captions ?? [], localTick, manifest.target);
        return documentShell(`${sceneSvg}\n${captionSvg}`, context, located.scene.accessibilityDescription ?? located.scene.content.title);
      });
    };
    const output = run();
    if (this.#verifyRepeatability) {
      const repeated = run();
      if (output.html !== repeated.html || output.svg !== repeated.svg) {
        throw new Error(`Renderer for ${located.scene.kind} is nondeterministic at frame ${frame}`);
      }
    }
    return {
      frame,
      tick: located.tick,
      sceneId: located.scene.id,
      html: output.html,
      svg: output.svg,
      contentHash: createHash("sha256").update(output.svg).digest("hex"),
    };
  }

  /** Preview and final deliberately call the exact same pure render path. */
  verifyPreviewFinalParity(manifest: RenderManifest, frame: number): string {
    const preview = this.render(manifest, frame, "preview");
    const final = this.render(manifest, frame, "final");
    if (preview.contentHash !== final.contentHash || preview.svg !== final.svg) {
      throw new Error(`Preview/final mismatch at frame ${frame}: ${preview.contentHash} != ${final.contentHash}`);
    }
    return final.contentHash;
  }
}
