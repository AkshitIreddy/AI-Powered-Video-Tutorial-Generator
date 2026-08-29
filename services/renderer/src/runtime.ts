import { createHash } from "node:crypto";
import {
  BUILTIN_SCENE_KINDS,
  PRECISION_THEME,
  type BuiltinSceneKind,
  type SceneContent as BuiltinSceneContent,
  type SceneSpec,
  type SceneTheme,
  type TextItem,
} from "@alystria/scenes";
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
  /** Hash-verified bytes loaded by the executor; never filesystem paths. */
  readonly visualAssetPayloads?: readonly VisualAssetPayload[];
  /** Hash-verified inspected font bytes loaded by the executor. */
  readonly fontAssetPayloads?: readonly FontAssetPayload[];
  readonly layoutCompiler?: ResponsiveLayoutCompiler;
  readonly verifyRepeatability?: boolean;
}

const BUILTIN_SCENE_KIND_SET = new Set<string>(BUILTIN_SCENE_KINDS);

function stableNumericSeed(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function safeChildId(sceneId: string, suffix: string): string {
  const prefix = sceneId.replace(/[^a-zA-Z0-9._:-]/gu, "-").replace(/^-+/u, "");
  return `${prefix || "scene"}.${suffix}`;
}

function optionalMetadataString(scene: ResolvedScene, key: string): string | undefined {
  const value = scene.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sourceLines(scene: ResolvedScene): readonly string[] {
  const explicitItems = scene.content.items ?? [];
  const candidates = explicitItems.length
    ? explicitItems
    : scene.content.body
      ? [scene.content.body]
      : [scene.content.title];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const text = candidate.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    unique.push(text);
    if (unique.length === 7) break;
  }
  return unique.length ? unique : [scene.content.title];
}

function textItems(scene: ResolvedScene): readonly TextItem[] {
  return sourceLines(scene).map((text, index) => ({
    id: safeChildId(scene.id, `item-${index + 1}`),
    text,
    ...(index === 0 ? { emphasis: "primary" as const } : {}),
  }));
}

function compactInstruction(text: string, maximum = 54): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maximum) return normalized;
  const boundary = normalized.lastIndexOf(" ", maximum - 1);
  const end = boundary >= Math.floor(maximum * 0.55) ? boundary : maximum - 1;
  return `${normalized.slice(0, end).replace(/[,:;\s]+$/u, "")}…`;
}

function commonContent(scene: ResolvedScene) {
  const background = scene.visualAssets?.find((asset) => asset.role === "background");
  return {
    title: scene.content.title,
    ...(scene.content.eyebrow ? { eyebrow: scene.content.eyebrow } : {}),
    ...(scene.content.body ? { subtitle: scene.content.body } : {}),
    ...(background ? { background: {
      id: background.assetId,
      sha256: background.sha256,
      alt: background.alt,
      fit: background.fit ?? "cover" as const,
    } } : {}),
  };
}

function semanticVisual(scene: ResolvedScene, role: "primary" | "secondary" | "presenter-portrait") {
  return scene.visualAssets?.find((asset) => asset.role === role);
}

function assetReference(scene: ResolvedScene, role: "primary" | "secondary" | "presenter-portrait", fallbackId: string, fallbackAlt: string) {
  const visual = semanticVisual(scene, role);
  return visual
    ? { id: visual.assetId, sha256: visual.sha256, alt: visual.alt, fit: visual.fit ?? "contain" as const }
    : { id: fallbackId, alt: fallbackAlt, fit: "contain" as const };
}

/**
 * Deterministically upgrades the intentionally narrow renderer wire record to
 * the built-in semantic scene DSL. The bridge derives display-only data from
 * manifest text; it never interprets metadata as a path, URL, or executable
 * payload. Media scenes therefore receive stable asset ids and can only show
 * bytes supplied by the separately verified CAS asset resolver.
 */
export const resolveBuiltinSceneSpec: SceneSpecResolver = (scene) => {
  if (!BUILTIN_SCENE_KIND_SET.has(scene.kind)) return undefined;
  const kind = scene.kind as BuiltinSceneKind;
  const lines = sourceLines(scene);
  const items = textItems(scene);
  const common = commonContent(scene);
  const child = (suffix: string) => safeChildId(scene.id, suffix);
  const dataSeries = [{
    id: child("series-1"),
    label: scene.content.title,
    values: lines.map((text, index) => ({
      x: index + 1,
      y: Math.max(1, Math.min(100, text.length)),
      label: text,
    })),
  }];
  let content: BuiltinSceneContent;

  switch (kind) {
    case "title": {
      const author = optionalMetadataString(scene, "author");
      content = {
        kind,
        ...common,
        ...(author ? { author } : {}),
        ...(scene.content.eyebrow ? { module: scene.content.eyebrow } : {}),
      };
      break;
    }
    case "section-intro":
      content = { kind, ...common, sectionNumber: optionalMetadataString(scene, "sectionNumber") ?? "01", objectives: lines.slice(0, 3) };
      break;
    case "definition":
      content = {
        kind,
        ...common,
        term: optionalMetadataString(scene, "term") ?? scene.content.title,
        definition: scene.content.body ?? lines[0]!,
        ...(lines[1] ? { example: lines[1] } : {}),
      };
      break;
    case "bullets":
    case "recap":
    case "summary":
      content = { kind, ...common, items };
      break;
    case "comparison": {
      const split = Math.max(1, Math.ceil(lines.length / 2));
      const left = lines.slice(0, split);
      const right = lines.slice(split);
      content = {
        kind,
        ...common,
        left: { label: optionalMetadataString(scene, "leftLabel") ?? "First view", items: left },
        right: { label: optionalMetadataString(scene, "rightLabel") ?? "Second view", items: right.length ? right : left },
        ...(scene.content.body ? { verdict: scene.content.body } : {}),
      };
      break;
    }
    case "diagram": {
      const nodes = lines.map((text, index) => ({
        id: child(`node-${index + 1}`),
        label: text,
        tone: index === 0 ? "primary" as const : index === lines.length - 1 ? "secondary" as const : "neutral" as const,
      }));
      content = {
        kind,
        ...common,
        nodes,
        edges: nodes.slice(1).map((node, index) => ({ id: child(`edge-${index + 1}`), from: nodes[index]!.id, to: node.id })),
        direction: "left-to-right",
      };
      break;
    }
    case "timeline":
      content = { kind, ...common, events: lines.map((text, index) => ({ id: child(`event-${index + 1}`), date: String(index + 1).padStart(2, "0"), label: text })) };
      break;
    case "formula":
    case "derivation":
      content = {
        kind,
        ...common,
        expression: lines[0]!,
        ...(lines.length > 1 ? { steps: lines.slice(1).map((expression, index) => ({ id: child(`step-${index + 1}`), expression })) } : {}),
        ...(scene.content.body ? { result: scene.content.body } : {}),
      };
      break;
    case "graph":
      content = { kind, ...common, series: dataSeries, xLabel: "Step", yLabel: "Relative emphasis" };
      break;
    case "code":
    case "walkthrough":
    case "diff":
    case "terminal":
      content = {
        kind,
        ...common,
        language: kind === "terminal" ? "text" : optionalMetadataString(scene, "language") ?? "text",
        filename: kind === "terminal" ? "Tutorial console" : "lesson.txt",
        lines: lines.map((text, index) => ({ id: child(`line-${index + 1}`), text, highlight: index === 0 })),
      };
      break;
    case "file-tree":
      content = {
        kind,
        ...common,
        entries: lines.map((_, index) => ({ id: child(`entry-${index + 1}`), path: `lesson/step-${String(index + 1).padStart(2, "0")}.md`, type: "file" as const, emphasis: index === 0 })),
      };
      break;
    case "execution-trace":
      content = {
        kind,
        ...common,
        frames: lines.map((text, index) => ({ id: child(`frame-${index + 1}`), label: text, line: index + 1, variables: { concept: text } })),
        activeFrame: 0,
      };
      break;
    case "variable-state":
      content = { kind, ...common, before: { concept: lines[0]! }, after: { concept: lines.at(-1)! }, operation: scene.content.body ?? "Transform" };
      break;
    case "chart":
      content = { kind, ...common, chartType: "bar", series: dataSeries, xLabel: "Step", yLabel: "Relative emphasis" };
      break;
    case "table":
      content = {
        kind,
        ...common,
        columns: [{ id: child("column-step"), label: "Step" }, { id: child("column-detail"), label: "Detail" }],
        rows: lines.map((text, index) => ({ id: child(`row-${index + 1}`), cells: [String(index + 1), text], emphasis: index === 0 })),
      };
      break;
    case "map":
      content = {
        kind,
        ...common,
        points: lines.map((text, index) => ({ id: child(`point-${index + 1}`), label: text, x: 0.18 + ((index * 0.29) % 0.68), y: 0.22 + ((index * 0.19) % 0.56) })),
      };
      break;
    case "image-focus":
    case "document-focus":
    case "screen-recording":
      content = { kind, ...common, asset: assetReference(scene, "primary", child("asset-primary"), scene.content.body ?? scene.content.title) };
      break;
    case "image-comparison":
      content = {
        kind,
        ...common,
        left: assetReference(scene, "primary", child("asset-left"), `${scene.content.title}, first view`),
        right: assetReference(scene, "secondary", child("asset-right"), `${scene.content.title}, second view`),
        leftLabel: optionalMetadataString(scene, "leftLabel") ?? "Before",
        rightLabel: optionalMetadataString(scene, "rightLabel") ?? "After",
      };
      break;
    case "ui-demo":
      content = { kind, ...common, windowTitle: optionalMetadataString(scene, "windowTitle") ?? "Tutorial workspace", steps: items, activeStep: 0, mockup: "desktop" };
      break;
    case "simulation":
      content = {
        kind,
        ...common,
        variables: lines.slice(0, 5).map((text, index) => ({ id: child(`variable-${index + 1}`), label: text, value: index + 1, min: 0, max: Math.max(2, lines.length) })),
        observation: scene.content.body ?? lines[0]!,
        series: dataSeries,
      };
      break;
    case "presenter":
    case "presenter-slide": {
      const requestedPlacement = optionalMetadataString(scene, "presenterPlacement") ?? "picture_in_picture";
      const placement = requestedPlacement === "full_frame" || requestedPlacement === "full"
        ? "full"
        : requestedPlacement === "left" || requestedPlacement === "split-left"
          ? "split-left"
          : requestedPlacement === "right" || requestedPlacement === "split-right"
            ? "split-right"
            : "picture-in-picture";
      content = {
        kind,
        ...common,
        presenterName: optionalMetadataString(scene, "presenterName") ?? "Alystria Guide",
        portrait: assetReference(scene, "presenter-portrait", "presenter-placeholder", "Presenter portrait"),
        talkingPoint: scene.content.body ?? lines[0]!,
        ...(kind === "presenter-slide" ? { slideItems: items } : {}),
        disclosure: optionalMetadataString(scene, "presenterDisclosure") ?? "Synthetic presenter",
        placement,
      };
      break;
    }
    case "quote":
      content = { kind, ...common, quote: scene.content.body ?? lines[0]!, attribution: optionalMetadataString(scene, "attribution") ?? "Tutorial narration" };
      break;
    case "question":
      content = { kind, ...common, question: scene.content.body ?? lines[0]!, ...(lines[1] ? { prompt: lines[1] } : {}), thinkingTimeSeconds: 5 };
      break;
    case "worked-example":
      // Worked-example cards need room for their answer and the persistent
      // caption-safe lower band. Keep instructional steps concise instead of
      // pouring narration paragraphs into a compact procedural layout.
      content = {
        kind,
        ...common,
        problem: compactInstruction(scene.content.body ?? scene.content.title, 76),
        steps: lines.slice(0, 4).map((text, index) => ({
          id: child(`worked-step-${index + 1}`),
          text: compactInstruction(text),
          ...(index === 0 ? { emphasis: "primary" as const } : {}),
        })),
        answer: compactInstruction(lines.at(-1)!, 72),
      };
      break;
    case "quiz": {
      const choices = lines.length > 1 ? lines.slice(0, 6) : [lines[0]!, "Review the explanation"];
      content = {
        kind,
        ...common,
        question: scene.content.body ?? scene.content.title,
        options: choices.map((label, index) => ({ id: child(`option-${index + 1}`), label, correct: index === 0 })),
        revealAnswer: false,
      };
      break;
    }
    case "sources":
      content = { kind, ...common, sources: lines.map((title, index) => ({ id: child(`source-${index + 1}`), title, license: "Project evidence" })) };
      break;
    case "outro":
      content = { kind, ...common, nextSteps: lines.slice(0, 4), callToAction: scene.content.body ?? "Continue learning" };
      break;
  }

  return {
    id: scene.id,
    content,
    durationTicks: scene.durationTicks,
    seed: stableNumericSeed(`${scene.id}:${scene.seed}`),
    ...(scene.accessibilityDescription ? { accessibilityDescription: scene.accessibilityDescription } : {}),
  };
};

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

function htmlShellForSvg(svg: string, context: FrameContext, description: string, language: string): string {
  const title = escapeMarkup(description || `Scene ${context.sceneId}`);
  return `<!doctype html><html lang="${escapeMarkup(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=${context.target.width},initial-scale=1"><title>${title}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f7f8fc}svg{display:block;width:100%;height:100%}*{box-sizing:border-box}</style></head><body data-render-ready="true" data-frame="${context.globalFrame}">${svg}</body></html>`;
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

export class FrameRenderer {
  readonly #renderers: ReadonlyMap<string, SceneRenderer>;
  readonly #sceneSpecResolver: SceneSpecResolver | undefined;
  readonly #sceneViewOptions: SceneViewAdapterOptions;
  readonly #visualAssetPayloads: ReadonlyMap<string, VisualAssetPayload>;
  readonly #fontAssetPayloads: readonly FontAssetPayload[];
  readonly #layoutCompiler: ResponsiveLayoutCompiler;
  readonly #verifyRepeatability: boolean;

  constructor(options: FrameRendererOptions = {}) {
    this.#renderers = new Map(Object.entries(options.sceneRenderers ?? {}));
    this.#sceneSpecResolver = options.sceneSpecResolver ?? resolveBuiltinSceneSpec;
    this.#sceneViewOptions = options.sceneView ?? {};
    this.#visualAssetPayloads = new Map((options.visualAssetPayloads ?? []).map((payload) => [payload.id, payload]));
    this.#fontAssetPayloads = Object.freeze([...(options.fontAssetPayloads ?? [])]);
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
    const sceneSpec = customRenderer || !sceneViewSupportsTarget(manifest)
      ? undefined
      : this.#sceneSpecResolver?.(located.scene);
    if (sceneSpec) assertSceneSpecMatchesResolvedScene(sceneSpec, located.scene);
    const renderer = customRenderer ?? fixtureSceneRenderer;
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
    const typographyTheme = manifest.typography
      ? themeWithTypography(this.#sceneViewOptions.theme ?? PRECISION_THEME, manifest.typography)
      : this.#sceneViewOptions.theme;
    const sceneView = new SceneViewStaticAdapter({
      ...this.#sceneViewOptions,
      ...(typographyTheme ? { theme: typographyTheme } : {}),
      ...(manifestResolver ? { resolveAsset: manifestResolver } : {}),
    });
    const scenePayloads = (located.scene.visualAssets ?? []).map((reference) => {
      const payload = this.#visualAssetPayloads.get(reference.assetId);
      if (!payload || payload.sha256.toLowerCase() !== reference.sha256.toLowerCase()) {
        throw new TypeError(`Scene ${located.scene.id} is missing verified bytes for visual asset ${reference.assetId}`);
      }
      return payload;
    });
    const run = (): { html: string; svg: string } => {
      if (sceneSpec) {
        // React's server renderer samples performance.now() internally for
        // scheduling. It never enters the markup, so retain every other guard
        // while allowing that implementation detail.
        return withDeterminismGuard(() => {
          const rendered = sceneView.renderSpec(sceneSpec, manifest.target, localTick);
          const captionSvg = renderCaptionSvg(located.scene.captions ?? [], localTick, manifest.target, manifest.captionStyle);
          const sceneSvg = reserveTopCaptionBand(rendered.svg, manifest);
          const svg = appendSvgFragment(sceneSvg, captionSvg);
          assertSafeSvgFragment(svg, located.scene.id);
          return {
            svg,
            html: attachVisualAssetBootstrap(
              htmlShellForSvg(svg, context, located.scene.accessibilityDescription ?? rendered.scene.accessibilityDescription, rendered.scene.target.locale),
              scenePayloads,
            ),
          };
        }, { forbidPerformanceNow: false });
      }
      return withDeterminismGuard(() => {
        const random = new SeededRandom(context.seed);
        const sceneSvg = renderer({ scene: located.scene, context, layout, random });
        assertSafeSvgFragment(sceneSvg, located.scene.id);
        const captionSvg = renderCaptionSvg(located.scene.captions ?? [], localTick, manifest.target, manifest.captionStyle);
        const reservedScene = reserveTopCaptionBand(sceneSvg, manifest);
        return documentShell(`${reservedScene}\n${captionSvg}`, context, located.scene.accessibilityDescription ?? located.scene.content.title);
      });
    };
    const rawOutput = run();
    if (this.#verifyRepeatability) {
      const repeated = run();
      if (rawOutput.html !== repeated.html || rawOutput.svg !== repeated.svg) {
        throw new Error(`Renderer for ${located.scene.kind} is nondeterministic at frame ${frame}`);
      }
    }
    const output = {
      ...rawOutput,
      html: attachFontAssetBootstrap(rawOutput.html, this.#fontAssetPayloads),
    };
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
