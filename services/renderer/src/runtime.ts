import { createHash } from "node:crypto";
import {
  authoredSemanticScene,
  compileVisualBeatSequence,
  PRECISION_THEME,
  resolveBuiltinSceneSpec,
  roleMatches,
  targetAwareInformationLabel,
  unitText,
  type AuthoredSemanticScene,
  type SceneTheme,
  type VisualBeat,
} from "@alystria/scenes";

export { compileVisualBeatSequence, resolveBuiltinSceneSpec } from "@alystria/scenes";
import type {
  CompiledLayout,
  FrameContext,
  RenderManifest,
  RenderedFrame,
  ResolvedScene,
} from "./contracts.js";
import { assertRenderManifest } from "./contracts.js";
import { attachVisualAssetBootstrap, type VisualAssetPayload } from "./assets.js";
import { attachFontAssetBootstrap, type FontAssetPayload } from "./fonts.js";
import { captionTopBandHeight, escapeMarkup, renderCaptionSvg } from "./captions.js";
import { ResponsiveLayoutCompiler } from "./layout.js";
import { SeededRandom, withDeterminismGuard } from "./random.js";
import {
  SceneViewStaticAdapter,
  assertSceneSpecMatchesResolvedScene,
  createLocalAssetResolver,
  type SceneSpecResolver,
  type SceneViewAdapterOptions,
} from "./scene-view.js";
import { frameToTick, tickToFrameCeil, ticksPerFrame } from "./timebase.js";

export const RENDERER_VERSION = "1.8.0";

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
  /** Hash-verified bytes loaded by the executor; never filesystem paths. */
  readonly visualAssetPayloads?: readonly VisualAssetPayload[];
  /** Hash-verified inspected font bytes loaded by the executor. */
  readonly fontAssetPayloads?: readonly FontAssetPayload[];
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

function sceneViewSupportsTarget(manifest: RenderManifest): boolean {
  const { numerator, denominator } = manifest.target.frameRate;
  if (numerator % denominator !== 0) return false;
  return [24, 25, 30, 48, 50, 60].includes(numerator / denominator);
}

function assertSafeSvgFragment(fragment: string, sceneId: string): void {
  const forbidden = [
    /<\s*script\b/i,
    /\son[a-z]+\s*=/i,
    /(?:href|src)\s*=\s*["']\s*(?:https?:|file:|data:|javascript:)/i,
    /url\s*\(\s*["']?\s*(?:https?:|data:|javascript:)/i,
    /<\s*(?:iframe|object|embed)\b/i,
  ];
  if (forbidden.some((pattern) => pattern.test(fragment))) {
    throw new TypeError(`Scene ${sceneId} emitted executable or remote SVG content`);
  }
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

function replaceStaticSvgText(svg: string, current: string, replacement: string): string {
  if (!current || current === replacement) return svg;
  const encoded = escapeMarkup(replacement);
  return svg
    .replaceAll(`>${current}</text>`, `>${encoded}</text>`)
    .replaceAll(`>${current}</tspan>`, `>${encoded}</tspan>`);
}

/**
 * A few built-in compositions include fixed explanatory micro-labels. For an
 * authored semantic beat those labels must describe the authored object, not
 * the specimen that originally demonstrated the renderer. Substitution is
 * deliberately closed to known static labels and already-validated text; it
 * cannot introduce markup, code, paths, or remote content.
 */
function applyAuthoredSemanticMicrocopy(svg: string, scene: ResolvedScene, semantic: AuthoredSemanticScene | undefined): string {
  if (!semantic) return svg;
  let resolved = svg;
  if (scene.kind === "definition") {
    const orderedLabel = semantic.beat.textRoles.label ?? semantic.beat.textRoles.focus ?? "ordered input";
    const comparison = semantic.comparisons[0] ? targetAwareInformationLabel(semantic.comparisons[0], semantic) : undefined;
    const consequence = unitText(semantic.principle);
    resolved = replaceStaticSvgText(resolved, "Break", orderedLabel);
    if (comparison) resolved = replaceStaticSvgText(resolved, "Solve similar parts", comparison);
    if (consequence) resolved = replaceStaticSvgText(resolved, "Combine", consequence);
  }
  if (scene.kind === "comparison" && semantic.comparisons.some((unit) => roleMatches(unit, ["comparison-value"]))) {
    // The authored comparison labels already carry their unit. The specimen's
    // secondary noun sits beside a two-digit sample and collides with larger
    // values such as 1,024, so omit it rather than misaligning semantic type.
    resolved = replaceStaticSvgText(resolved, "products", "");
    resolved = replaceStaticSvgText(resolved, "operation", "");
  }
  return resolved;
}

function reserveTopCaptionBand(svg: string, manifest: RenderManifest): string {
  const band = captionTopBandHeight(manifest.target, manifest.captionStyle);
  if (band <= 0) return svg;
  const scale = (manifest.target.height - band) / manifest.target.height;
  const translateX = manifest.target.width * (1 - scale) / 2;
  const wrapped = (content: string) => `<rect width="${manifest.target.width}" height="${manifest.target.height}" fill="#F7F8FC"/>
  <g data-caption-reserved-scene="top" transform="translate(${translateX.toFixed(3)} ${band}) scale(${scale.toFixed(6)})">${content}</g>`;
  const openingEnd = svg.indexOf(">");
  const closing = svg.lastIndexOf("</svg>");
  if (svg.startsWith("<svg") && openingEnd >= 0 && closing > openingEnd) {
    return `${svg.slice(0, openingEnd + 1)}${wrapped(svg.slice(openingEnd + 1, closing))}${svg.slice(closing)}`;
  }
  return wrapped(svg);
}

function burnsCaptionsIntoFrames(manifest: RenderManifest): boolean {
  // The executor also strips cue payloads from clean capture manifests. Keep
  // the frame renderer independently safe because preview/specimen callers can
  // invoke it directly without going through the delivery executor.
  const mode = manifest.captionDeliveryMode ?? "sidecar";
  return mode === "burned" || mode === "both";
}

function quotedFontStack(family: string, generic: "sans-serif" | "monospace"): string {
  const quoted = family === generic ? family : `"${family.replaceAll('"', "")}"`;
  const platform = generic === "monospace" ? '"Cascadia Code", monospace' : '"Segoe UI", Arial, sans-serif';
  return `${quoted}, ${platform}`;
}

function themeWithTypography(
  base: SceneTheme,
  typography: NonNullable<RenderManifest["typography"]>,
): SceneTheme {
  return Object.freeze({
    ...base,
    fontDisplay: quotedFontStack(typography.displayFamily, "sans-serif"),
    fontBody: quotedFontStack(typography.bodyFamily, "sans-serif"),
    fontMono: quotedFontStack(typography.codeFamily, "monospace"),
  });
}

function themeFromManifest(
  base: SceneTheme,
  customization: NonNullable<RenderManifest["sceneTheme"]> | undefined,
): SceneTheme {
  if (!customization) return base;
  return Object.freeze({
    ...base,
    paper: customization.paper,
    ink: customization.ink,
    primary: customization.primary,
    secondary: customization.secondary,
    mutedInk: mixHex(customization.ink, customization.paper, 0.34),
    surface: mixHex(customization.paper, customization.ink, 0.035),
    surfaceRaised: mixHex(customization.paper, customization.primary, 0.075),
    line: mixHex(customization.paper, customization.ink, 0.17),
    codeBackground: mixHex(customization.ink, customization.paper, 0.045),
    codeInk: customization.paper,
    radius: customization.radius,
  });
}

function mixHex(first: string, second: string, amount: number): string {
  const channels = (value: string): readonly number[] => [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
  const left = channels(first);
  const right = channels(second);
  return `#${left.map((value, index) => Math.round(value + (right[index]! - value) * amount).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

const FRAME_HTML_TOKEN = "__ALYSTRIA_PREPARED_FRAME_NUMBER__";
const FRAME_SVG_TOKEN = "<!--__ALYSTRIA_PREPARED_FRAME_SVG__-->";

interface PreparedSceneRender {
  readonly scene: ResolvedScene;
  readonly startTick: number;
  readonly endTick: number;
  readonly layout: CompiledLayout;
  readonly customRenderer: SceneRenderer | undefined;
  readonly visualBeat: VisualBeat | undefined;
  readonly authoredSemantic: AuthoredSemanticScene | undefined;
  readonly compiledScene: ReturnType<SceneViewStaticAdapter["compile"]> | undefined;
  readonly htmlTemplate: string;
}

interface PreparedManifestRender {
  readonly manifest: RenderManifest;
  readonly sceneView: SceneViewStaticAdapter;
  readonly scenes: readonly PreparedSceneRender[];
  readonly totalFrames: number;
}

function preparedHtmlTemplate(
  manifest: RenderManifest,
  scene: ResolvedScene,
  language: string,
  description: string,
  visualAssetPayloads: readonly VisualAssetPayload[],
  fontAssetPayloads: readonly FontAssetPayload[],
): string {
  const title = escapeMarkup(description || `Scene ${scene.id}`);
  const shell = `<!doctype html><html lang="${escapeMarkup(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=${manifest.target.width},initial-scale=1"><title>${title}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f7f8fc}svg{display:block;width:100%;height:100%}*{box-sizing:border-box}</style></head><body data-render-ready="true" data-frame="${FRAME_HTML_TOKEN}">${FRAME_SVG_TOKEN}</body></html>`;
  const withVisualAssets = attachVisualAssetBootstrap(shell, visualAssetPayloads);
  return attachFontAssetBootstrap(withVisualAssets, fontAssetPayloads);
}

export class FrameRenderer {
  readonly #renderers: ReadonlyMap<string, SceneRenderer>;
  readonly #sceneSpecResolver: SceneSpecResolver | undefined;
  readonly #sceneViewOptions: SceneViewAdapterOptions;
  readonly #visualAssetPayloads: ReadonlyMap<string, VisualAssetPayload>;
  readonly #fontAssetPayloads: readonly FontAssetPayload[];
  readonly #layoutCompiler: ResponsiveLayoutCompiler;
  readonly #verifyRepeatability: boolean;
  readonly #preparedManifests = new WeakMap<RenderManifest, PreparedManifestRender>();

  constructor(options: FrameRendererOptions = {}) {
    this.#renderers = new Map(Object.entries(options.sceneRenderers ?? {}));
    this.#sceneSpecResolver = options.sceneSpecResolver;
    this.#sceneViewOptions = options.sceneView ?? {};
    this.#visualAssetPayloads = new Map((options.visualAssetPayloads ?? []).map((payload) => [payload.id, payload]));
    this.#fontAssetPayloads = Object.freeze([...(options.fontAssetPayloads ?? [])]);
    this.#layoutCompiler = options.layoutCompiler ?? new ResponsiveLayoutCompiler();
    this.#verifyRepeatability = options.verifyRepeatability ?? false;
  }

  /**
   * Validates and compiles immutable manifest/scene work exactly once. The
   * renderer contract is readonly: callers that change a manifest must supply
   * a new object identity so it is prepared independently.
   */
  prepare(manifest: RenderManifest): void {
    void this.#prepareManifest(manifest);
  }

  render(manifest: RenderManifest, frame: number, mode: FrameContext["mode"] = "final"): RenderedFrame {
    const prepared = this.#prepareManifest(manifest);
    const located = this.#locatePreparedScene(prepared, frame);
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
    const run = (): { html: string; svg: string } => {
      let svg: string;
      if (located.prepared.compiledScene) {
        // React's server renderer samples performance.now() internally for
        // scheduling. It never enters the markup, so retain every other guard
        // while allowing that implementation detail.
        svg = withDeterminismGuard(() => {
          const rendered = prepared.sceneView.renderCompiled(located.prepared.compiledScene!, localTick);
          const burnCaptions = burnsCaptionsIntoFrames(manifest);
          const captionSvg = burnCaptions ? renderCaptionSvg(located.scene.captions ?? [], localTick, manifest.target, manifest.captionStyle) : "";
          const semanticSvg = applyAuthoredSemanticMicrocopy(rendered.svg, located.scene, located.prepared.authoredSemantic);
          const sceneSvg = burnCaptions ? reserveTopCaptionBand(semanticSvg, manifest) : semanticSvg;
          const completedSvg = appendSvgFragment(sceneSvg, captionSvg);
          assertSafeSvgFragment(completedSvg, located.scene.id);
          return completedSvg;
        }, { forbidPerformanceNow: false });
      } else {
        svg = withDeterminismGuard(() => {
          const random = new SeededRandom(context.seed);
          const renderer = located.prepared.customRenderer ?? fixtureSceneRenderer;
          const sceneSvg = renderer({ scene: located.scene, context, layout: located.prepared.layout, random });
          assertSafeSvgFragment(sceneSvg, located.scene.id);
          const burnCaptions = burnsCaptionsIntoFrames(manifest);
          const captionSvg = burnCaptions ? renderCaptionSvg(located.scene.captions ?? [], localTick, manifest.target, manifest.captionStyle) : "";
          const reservedScene = burnCaptions ? reserveTopCaptionBand(sceneSvg, manifest) : sceneSvg;
          return documentShell(`${reservedScene}\n${captionSvg}`, context, located.scene.accessibilityDescription ?? located.scene.content.title).svg;
        });
      }
      return {
        svg,
        html: located.prepared.htmlTemplate
          .replace(FRAME_HTML_TOKEN, String(frame))
          .replace(FRAME_SVG_TOKEN, () => svg),
      };
    };
    const rawOutput = run();
    if (this.#verifyRepeatability) {
      const repeated = run();
      if (rawOutput.html !== repeated.html || rawOutput.svg !== repeated.svg) {
        throw new Error(`Renderer for ${located.scene.kind} is nondeterministic at frame ${frame}`);
      }
    }
    return {
      frame,
      tick: located.tick,
      sceneId: located.scene.id,
      html: rawOutput.html,
      svg: rawOutput.svg,
      contentHash: createHash("sha256").update(rawOutput.svg).digest("hex"),
    };
  }

  #prepareManifest(manifest: RenderManifest): PreparedManifestRender {
    const cached = this.#preparedManifests.get(manifest);
    if (cached) return cached;
    assertRenderManifest(manifest);
    const visualBeats = withDeterminismGuard(() => compileVisualBeatSequence(manifest.scenes));
    const manifestBindings = (manifest.visualAssets ?? []).map((asset) => ({ id: asset.id, sha256: asset.sha256 }));
    const manifestResolver = manifestBindings.length ? createLocalAssetResolver(manifestBindings) : undefined;
    const fontPayloads = new Map(this.#fontAssetPayloads.map((payload) => [payload.id, payload]));
    for (const input of manifest.fontAssets ?? []) {
      const payload = fontPayloads.get(input.id);
      if (!payload || payload.sha256.toLowerCase() !== input.sha256.toLowerCase() || payload.family !== input.family) {
        throw new TypeError(`Manifest is missing verified bytes for font asset ${input.id}`);
      }
    }
    if (fontPayloads.size !== (manifest.fontAssets ?? []).length) {
      throw new TypeError("Renderer received font bytes that are not bound by the manifest");
    }
    const customizedTheme = themeFromManifest(
      this.#sceneViewOptions.theme ?? PRECISION_THEME,
      manifest.sceneTheme,
    );
    const typographyTheme = manifest.typography
      ? themeWithTypography(customizedTheme, manifest.typography)
      : customizedTheme;
    const sceneView = new SceneViewStaticAdapter({
      ...this.#sceneViewOptions,
      theme: typographyTheme,
      ...(manifest.reducedMotion === undefined ? {} : { reducedMotion: manifest.reducedMotion }),
      ...(manifestResolver ? { resolveAsset: manifestResolver } : {}),
    });
    let startTick = 0;
    const scenes = manifest.scenes.map((scene): PreparedSceneRender => {
      const visualBeat = visualBeats.get(scene.id);
      const customRenderer = this.#renderers.get(scene.kind) ?? this.#renderers.get("*");
      const layout = withDeterminismGuard(() => this.#layoutCompiler.compile({ target: manifest.target, scene }));
      const sceneSpec = customRenderer || !sceneViewSupportsTarget(manifest)
        ? undefined
        : this.#sceneSpecResolver
          ? this.#sceneSpecResolver(scene)
          : resolveBuiltinSceneSpec(scene, visualBeat);
      if (sceneSpec) assertSceneSpecMatchesResolvedScene(sceneSpec, scene);
      const compiledScene = sceneSpec
        ? withDeterminismGuard(() => sceneView.compile(sceneSpec, manifest.target), { forbidPerformanceNow: false })
        : undefined;
      const scenePayloads = (scene.visualAssets ?? []).map((reference) => {
        const payload = this.#visualAssetPayloads.get(reference.assetId);
        if (!payload || payload.sha256.toLowerCase() !== reference.sha256.toLowerCase()) {
          throw new TypeError(`Scene ${scene.id} is missing verified bytes for visual asset ${reference.assetId}`);
        }
        return payload;
      });
      const endTick = startTick + scene.durationTicks;
      const prepared: PreparedSceneRender = Object.freeze({
        scene,
        startTick,
        endTick,
        layout,
        customRenderer,
        visualBeat,
        authoredSemantic: visualBeat?.source === "authored" ? authoredSemanticScene(scene) : undefined,
        compiledScene,
        htmlTemplate: preparedHtmlTemplate(
          manifest,
          scene,
          compiledScene?.target.locale ?? "en",
          scene.accessibilityDescription ?? compiledScene?.accessibilityDescription ?? scene.content.title,
          compiledScene ? scenePayloads : [],
          this.#fontAssetPayloads,
        ),
      });
      startTick = endTick;
      return prepared;
    });
    const prepared = Object.freeze({ manifest, sceneView, scenes: Object.freeze(scenes), totalFrames: totalFrames(manifest) });
    this.#preparedManifests.set(manifest, prepared);
    return prepared;
  }

  #locatePreparedScene(prepared: PreparedManifestRender, requestedFrame: number): LocatedScene & { readonly prepared: PreparedSceneRender } {
    if (!Number.isSafeInteger(requestedFrame) || requestedFrame < 0) {
      throw new RangeError(`Frame must be a non-negative safe integer, got ${requestedFrame}`);
    }
    const tick = frameToTick(requestedFrame, prepared.manifest.target.frameRate);
    let low = 0;
    let high = prepared.scenes.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const scene = prepared.scenes[middle]!;
      if (tick < scene.startTick) high = middle - 1;
      else if (tick >= scene.endTick) low = middle + 1;
      else {
        const localTick = tick - scene.startTick;
        return {
          scene: scene.scene,
          startTick: scene.startTick,
          endTick: scene.endTick,
          tick,
          globalFrame: requestedFrame,
          localFrame: Math.floor(localTick / ticksPerFrame(prepared.manifest.target.frameRate)),
          prepared: scene,
        };
      }
    }
    throw new RangeError(`Frame ${requestedFrame} is outside manifest duration (${prepared.totalFrames} frames)`);
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
