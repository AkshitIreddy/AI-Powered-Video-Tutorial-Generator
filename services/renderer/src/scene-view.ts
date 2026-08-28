import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SceneView,
  compileScene,
  type AssetReference,
  type CompileTarget,
  type CompiledScene,
  type Diagnostic,
  type FrameContext as SceneFrameContext,
  type SceneSpec,
  type SceneTheme,
} from "@alystria/scenes";
import { escapeMarkup } from "./captions.js";
import type { FrameContext, RenderTarget, ResolvedScene } from "./contracts.js";

const SUPPORTED_FRAME_RATES = new Set([24, 25, 30, 48, 50, 60]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export type SceneSpecResolver = (scene: ResolvedScene) => SceneSpec | undefined;
export type SceneAssetResolver = (asset: AssetReference) => string | undefined;

export interface LocalAssetBinding {
  /** The stable SceneSpec asset id, never a filesystem path or remote URL. */
  readonly id: string;
  /** Hash of an object already promoted into the local content-addressed store. */
  readonly sha256: string;
}

export interface SceneViewAdapterOptions {
  readonly locale?: string;
  readonly reducedMotion?: boolean;
  readonly theme?: SceneTheme;
  readonly resolveAsset?: SceneAssetResolver;
  readonly debugRegions?: boolean;
}

export interface StaticSceneViewRender {
  readonly scene: CompiledScene;
  readonly diagnostics: readonly Diagnostic[];
  readonly svg: string;
  readonly html: string;
  readonly contentHash: string;
}

function integerFrameRate(target: RenderTarget): CompileTarget["fps"] {
  const { numerator, denominator } = target.frameRate;
  if (numerator % denominator !== 0) {
    throw new RangeError(`SceneView requires an integer frame rate, got ${numerator}/${denominator}`);
  }
  const fps = numerator / denominator;
  if (!SUPPORTED_FRAME_RATES.has(fps)) {
    throw new RangeError(`SceneView does not support ${fps} fps; expected one of 24, 25, 30, 48, 50, or 60`);
  }
  return fps as CompileTarget["fps"];
}

function safeAreaPercent(target: RenderTarget): number | undefined {
  if (!target.safeArea) return undefined;
  const values = [
    (target.safeArea.top ?? 0) / target.height,
    (target.safeArea.bottom ?? 0) / target.height,
    (target.safeArea.left ?? 0) / target.width,
    (target.safeArea.right ?? 0) / target.width,
  ];
  return Math.max(...values);
}

/** Maps the renderer wire target into the scene library's responsive compiler target. */
export function mapRenderTargetToSceneTarget(
  target: RenderTarget,
  options: Pick<SceneViewAdapterOptions, "locale" | "reducedMotion"> = {},
): CompileTarget {
  const inset = safeAreaPercent(target);
  return {
    width: target.width,
    height: target.height,
    fps: integerFrameRate(target),
    pixelRatio: target.pixelRatio,
    ...(inset === undefined ? {} : { safeAreaPercent: inset }),
    ...(options.reducedMotion === undefined ? {} : { reducedMotion: options.reducedMotion }),
    ...(options.locale === undefined ? {} : { locale: options.locale }),
  };
}

/** Maps the canonical manifest-local tick into SceneView's pure frame contract. */
export function mapFrameContextToSceneFrame(
  context: Pick<FrameContext, "localTick">,
  reducedMotion = false,
): SceneFrameContext {
  if (!Number.isSafeInteger(context.localTick) || context.localTick < 0) {
    throw new RangeError(`Scene localTick must be a non-negative safe integer, got ${context.localTick}`);
  }
  return { tick: context.localTick, reducedMotion };
}

/**
 * Resolves only objects known to exist in the local CAS. The resulting custom
 * scheme is deterministic and cannot expose a host filesystem path or network URL.
 */
export function createLocalAssetResolver(bindings: readonly LocalAssetBinding[]): SceneAssetResolver {
  const assets = new Map<string, string>();
  for (const binding of bindings) {
    if (!binding.id.trim()) throw new TypeError("Local asset id must not be empty");
    if (assets.has(binding.id)) throw new TypeError(`Duplicate local asset binding ${binding.id}`);
    if (!SHA256_PATTERN.test(binding.sha256)) {
      throw new TypeError(`Local asset ${binding.id} must have a 64-character SHA-256 hash`);
    }
    assets.set(binding.id, binding.sha256.toLowerCase());
  }
  return (asset) => {
    const hash = assets.get(asset.id);
    if (!hash) return undefined;
    if (asset.sha256 && asset.sha256.toLowerCase() !== hash) return undefined;
    return `alystria-asset:sha256/${hash}`;
  };
}

function assertRenderable(scene: CompiledScene): void {
  const errors = scene.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length === 0) return;
  const details = errors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join("; ");
  throw new TypeError(`Scene ${scene.spec.id} failed preflight: ${details}`);
}

function staticHtml(svg: string, scene: CompiledScene): string {
  const title = escapeMarkup(scene.accessibilityDescription || scene.spec.content.title);
  return `<!doctype html><html lang="${escapeMarkup(scene.target.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=${scene.target.width},initial-scale=1"><title>${title}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f7f8fc}svg{display:block;width:100%;height:100%}*{box-sizing:border-box}</style></head><body data-render-ready="true" data-scene-id="${escapeMarkup(scene.spec.id)}">${svg}</body></html>`;
}

/** React SceneView to deterministic static SVG/HTML, shared by preview and final. */
export class SceneViewStaticAdapter {
  readonly #options: SceneViewAdapterOptions;

  constructor(options: SceneViewAdapterOptions = {}) {
    this.#options = options;
  }

  compile(spec: SceneSpec, target: RenderTarget): CompiledScene {
    const compiled = compileScene(spec, mapRenderTargetToSceneTarget(target, this.#options));
    assertRenderable(compiled);
    return compiled;
  }

  renderSpec(spec: SceneSpec, target: RenderTarget, localTick: number): StaticSceneViewRender {
    return this.renderCompiled(this.compile(spec, target), localTick);
  }

  renderCompiled(scene: CompiledScene, localTick: number): StaticSceneViewRender {
    assertRenderable(scene);
    if (!Number.isSafeInteger(localTick) || localTick < 0 || localTick >= scene.spec.durationTicks) {
      throw new RangeError(`Scene ${scene.spec.id} tick ${localTick} is outside [0, ${scene.spec.durationTicks})`);
    }
    const frame = mapFrameContextToSceneFrame(
      { localTick },
      this.#options.reducedMotion ?? scene.target.reducedMotion,
    );
    const props = {
      scene,
      frame,
      ...(this.#options.theme === undefined ? {} : { theme: this.#options.theme }),
      ...(this.#options.resolveAsset === undefined ? {} : { resolveAsset: this.#options.resolveAsset }),
      ...(this.#options.debugRegions === undefined ? {} : { debugRegions: this.#options.debugRegions }),
    };
    const svg = renderToStaticMarkup(createElement(SceneView, props));
    if (!svg.startsWith("<svg") || !svg.endsWith("</svg>")) {
      throw new TypeError(`SceneView for ${scene.spec.id} did not emit one root SVG document`);
    }
    return {
      scene,
      diagnostics: scene.diagnostics,
      svg,
      html: staticHtml(svg, scene),
      contentHash: createHash("sha256").update(svg).digest("hex"),
    };
  }
}

/** Ensures a resolved manifest scene cannot silently substitute another SceneSpec. */
export function assertSceneSpecMatchesResolvedScene(spec: SceneSpec, scene: ResolvedScene): void {
  if (spec.id !== scene.id) throw new TypeError(`SceneSpec id ${spec.id} does not match resolved scene ${scene.id}`);
  if (spec.content.kind !== scene.kind) {
    throw new TypeError(`SceneSpec kind ${spec.content.kind} does not match resolved scene kind ${scene.kind}`);
  }
  if (spec.durationTicks !== scene.durationTicks) {
    throw new TypeError(`SceneSpec duration ${spec.durationTicks} does not match resolved scene duration ${scene.durationTicks}`);
  }
}
