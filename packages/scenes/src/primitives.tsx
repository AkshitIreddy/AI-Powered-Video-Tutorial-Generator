import { createElement, type CSSProperties, type ReactNode } from "react";
import { animationStyle } from "./choreography.js";
import { insetRect } from "./layout.js";
import { SeededRandom } from "./random.js";
import type { AssetReference, CompiledScene, FrameContext, Rect, SceneRendererProps, SceneTheme } from "./types.js";

export const PRECISION_THEME: SceneTheme = {
  id: "precision-studio",
  name: "Precision Studio",
  paper: "#F7F8FC",
  ink: "#151827",
  mutedInk: "#596077",
  primary: "#5658E8",
  secondary: "#168F88",
  accent: "#F0D35E",
  warning: "#DF922E",
  critical: "#C94B67",
  surface: "#FFFFFF",
  surfaceRaised: "#EEF0F8",
  line: "#D7DBE9",
  codeBackground: "#171A29",
  codeInk: "#F4F5FA",
  fontDisplay: '"Bricolage Grotesque", "Segoe UI", sans-serif',
  fontBody: '"Atkinson Hyperlegible Next", "Segoe UI", sans-serif',
  fontMono: '"JetBrains Mono", "Cascadia Code", monospace',
  radius: 22,
};

export function SceneCanvas({ scene, frame, theme = PRECISION_THEME, children, resolveAsset, debugRegions = false }: SceneRendererProps & { readonly children: ReactNode }) {
  const { width, height } = scene.target;
  const random = new SeededRandom(scene.spec.seed);
  const patternId = `pattern-${safeId(scene.spec.id)}`;
  const background = "background" in scene.spec.content ? scene.spec.content.background : undefined;
  const backgroundHref = background ? resolveAsset?.(background) : undefined;
  const safeBackgroundHref = backgroundHref && (backgroundHref.startsWith("blob:") || backgroundHref.startsWith("alystria-asset:"))
    ? backgroundHref
    : undefined;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-labelledby={`${safeId(scene.spec.id)}-title ${safeId(scene.spec.id)}-desc`}
      data-scene-id={scene.spec.id}
      data-scene-kind={scene.spec.content.kind}
      data-profile={scene.metrics.profile}
      data-tick={frame.tick}
    >
      <title id={`${safeId(scene.spec.id)}-title`}>{scene.spec.content.title}</title>
      <desc id={`${safeId(scene.spec.id)}-desc`}>{scene.accessibilityDescription}</desc>
      <defs>
        <pattern id={patternId} width={Math.max(24, scene.metrics.unit * 4)} height={Math.max(24, scene.metrics.unit * 4)} patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill={theme.line} opacity="0.55" />
        </pattern>
        <filter id={`shadow-${safeId(scene.spec.id)}`} x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy={Math.max(3, scene.metrics.unit * 0.5)} stdDeviation={Math.max(5, scene.metrics.unit * 0.8)} floodColor={theme.ink} floodOpacity="0.12" />
        </filter>
        <linearGradient id={`thread-${safeId(scene.spec.id)}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={theme.primary} />
          <stop offset="0.62" stopColor={theme.secondary} />
          <stop offset="1" stopColor={theme.accent} />
        </linearGradient>
      </defs>
      <rect width={width} height={height} fill={theme.paper} />
      {safeBackgroundHref ? (
        <g data-semantic-role="visual" aria-label={background?.alt}>
          <image
            href={safeBackgroundHref}
            x="0"
            y="0"
            width={width}
            height={height}
            preserveAspectRatio={background?.fit === "contain" ? "xMidYMid meet" : "xMidYMid slice"}
            // Keep a selected background visibly present. The old two-layer
            // wash left less than 8% of its colour contribution, which made
            // an owned background look like a failed upload in final frames.
            opacity="0.80"
          />
          {/* The light paper veil keeps bare header and footer text readable
              without bleaching the user's selected image away. Cards still
              provide the stronger local contrast for dense teaching copy. */}
          <rect width={width} height={height} fill={theme.paper} opacity="0.52" />
        </g>
      ) : null}
      <rect width={width} height={height} fill={`url(#${patternId})`} opacity={safeBackgroundHref ? "0.28" : "0.46"} />
      <AmbientMarks scene={scene} theme={theme} random={random} />
      <ConceptThread scene={scene} theme={theme} />
      {children}
      <FrameFurniture scene={scene} theme={theme} />
      {debugRegions ? <RegionDebug scene={scene} /> : null}
    </svg>
  );
}

function AmbientMarks({ scene, theme, random }: { readonly scene: CompiledScene; readonly theme: SceneTheme; readonly random: SeededRandom }) {
  const count = scene.metrics.profile === "portrait" ? 7 : 11;
  return (
    <g aria-hidden="true" opacity="0.12">
      {Array.from({ length: count }, (_, index) => {
        const radius = random.between(scene.metrics.unit * 0.8, scene.metrics.unit * 3.8);
        return (
          <circle
            key={index}
            cx={random.between(scene.target.width * 0.06, scene.target.width * 0.95)}
            cy={random.between(scene.target.height * 0.05, scene.target.height * 0.92)}
            r={radius}
            fill={index % 3 === 0 ? theme.primary : index % 3 === 1 ? theme.secondary : theme.accent}
          />
        );
      })}
    </g>
  );
}

function ConceptThread({ scene, theme }: { readonly scene: CompiledScene; readonly theme: SceneTheme }) {
  const x = scene.metrics.safe.x - scene.metrics.gutter * 0.48;
  const y1 = scene.metrics.safe.y + scene.metrics.unit;
  const y2 = scene.metrics.safe.y + scene.metrics.safe.height - scene.metrics.unit;
  return (
    <g aria-hidden="true">
      <line x1={x} x2={x} y1={y1} y2={y2} stroke={`url(#thread-${safeId(scene.spec.id)})`} strokeWidth={Math.max(3, scene.metrics.unit * 0.34)} strokeLinecap="round" />
      {[0, 0.38, 0.72, 1].map((progress, index) => (
        <circle key={progress} cx={x} cy={y1 + (y2 - y1) * progress} r={index === 0 ? scene.metrics.unit * 0.58 : scene.metrics.unit * 0.38} fill={theme.surface} stroke={index % 2 ? theme.secondary : theme.primary} strokeWidth={Math.max(2, scene.metrics.unit * 0.2)} />
      ))}
    </g>
  );
}

function FrameFurniture({ scene, theme }: { readonly scene: CompiledScene; readonly theme: SceneTheme }) {
  const { safe, smallSize } = scene.metrics;
  return (
    <g aria-hidden="true" fill={theme.mutedInk} fontFamily={theme.fontMono} fontSize={smallSize * 0.72} letterSpacing={1.2}>
      <text x={safe.x} y={scene.target.height - Math.max(12, safe.y * 0.35)}>ALYSTRIA / {scene.spec.content.kind.toUpperCase()}</text>
      <text x={safe.x + safe.width} y={scene.target.height - Math.max(12, safe.y * 0.35)} textAnchor="end">{scene.metrics.profile.toUpperCase()}</text>
    </g>
  );
}

function RegionDebug({ scene }: { readonly scene: CompiledScene }) {
  return (
    <g aria-hidden="true" pointerEvents="none">
      {scene.regions.map((region) => (
        <g key={region.id}>
          <rect {...region} fill="none" stroke="#C94B67" strokeWidth="2" strokeDasharray="8 6" />
          <text x={region.x + 6} y={region.y + 16} fontSize="12" fill="#C94B67">{region.role}:{region.id}</text>
        </g>
      ))}
    </g>
  );
}

export function SceneHeader({ scene, frame, theme = PRECISION_THEME, title, eyebrow, subtitle, align = "left" }: {
  readonly scene: CompiledScene;
  readonly frame: FrameContext;
  readonly theme?: SceneTheme;
  readonly title: string;
  readonly eyebrow?: string | undefined;
  readonly subtitle?: string | undefined;
  readonly align?: "left" | "center" | undefined;
}) {
  const region = scene.regions.find((item) => item.id === "header") ?? scene.metrics.safe;
  const textAnchor = align === "center" ? "middle" : "start";
  const x = align === "center" ? region.x + region.width / 2 : region.x;
  const maxChars = Math.max(15, Math.floor(region.width / (scene.metrics.titleSize * 0.56)));
  const titleLines = wrapText(title, maxChars).slice(0, 2);
  const style = animationStyle(scene.choreography, "header", frame.tick, frame.reducedMotion) as CSSProperties;
  return (
    <g id="header" data-semantic-role="title" style={style}>
      {eyebrow ? <text x={x} y={region.y + scene.metrics.smallSize} textAnchor={textAnchor} fill={theme.primary} fontFamily={theme.fontMono} fontSize={scene.metrics.smallSize} fontWeight="700" letterSpacing={2}>{eyebrow.toUpperCase()}</text> : null}
      <MultilineText
        x={x}
        y={region.y + (eyebrow ? scene.metrics.titleSize * 1.05 : scene.metrics.titleSize * 0.75)}
        lines={titleLines}
        lineHeight={scene.metrics.titleSize * 1.05}
        textAnchor={textAnchor}
        fill={theme.ink}
        fontFamily={theme.fontDisplay}
        fontSize={scene.metrics.titleSize}
        fontWeight="750"
        letterSpacing={-1.1}
      />
      {subtitle ? <text x={x} y={region.y + region.height - scene.metrics.smallSize * 0.4} textAnchor={textAnchor} fill={theme.mutedInk} fontFamily={theme.fontBody} fontSize={scene.metrics.subtitleSize}>{truncate(subtitle, maxChars * 2)}</text> : null}
    </g>
  );
}

export function Card({ rect, theme = PRECISION_THEME, tone = "neutral", children, id, elevated = false, padding = 0 }: {
  readonly rect: Rect;
  readonly theme?: SceneTheme;
  readonly tone?: "neutral" | "primary" | "secondary" | "warning" | "dark";
  readonly children?: ReactNode;
  readonly id?: string;
  readonly elevated?: boolean;
  readonly padding?: number;
}) {
  const fill = tone === "primary" ? tint(theme.primary, 0.91) : tone === "secondary" ? tint(theme.secondary, 0.91) : tone === "warning" ? tint(theme.warning, 0.9) : tone === "dark" ? theme.codeBackground : theme.surface;
  const stroke = tone === "primary" ? theme.primary : tone === "secondary" ? theme.secondary : tone === "warning" ? theme.warning : tone === "dark" ? theme.codeBackground : theme.line;
  const childRect = insetRect(rect, padding);
  return (
    <g id={id} data-card-tone={tone}>
      <rect {...rect} rx={theme.radius} fill={fill} stroke={stroke} strokeWidth="1.5" style={elevated ? { filter: "drop-shadow(0 8px 14px rgba(21, 24, 39, 0.12))" } : undefined} />
      {padding > 0 ? createElement("g", { transform: `translate(${childRect.x - rect.x} ${childRect.y - rect.y})` }, children) : children}
    </g>
  );
}

export function MultilineText(props: {
  readonly x: number;
  readonly y: number;
  readonly lines: readonly string[];
  readonly lineHeight: number;
  readonly fill: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly fontWeight?: number | string | undefined;
  readonly textAnchor?: "start" | "middle" | "end" | undefined;
  readonly letterSpacing?: number | undefined;
  readonly maxLines?: number | undefined;
}) {
  const lines = props.lines.slice(0, props.maxLines ?? props.lines.length);
  return (
    <text x={props.x} y={props.y} fill={props.fill} fontFamily={props.fontFamily} fontSize={props.fontSize} fontWeight={props.fontWeight} textAnchor={props.textAnchor} letterSpacing={props.letterSpacing}>
      {lines.map((line, index) => <tspan key={`${index}-${line}`} x={props.x} dy={index === 0 ? 0 : props.lineHeight}>{line}</tspan>)}
    </text>
  );
}

export function WrappedText({ text, rect, theme = PRECISION_THEME, fontSize, fill, fontFamily, fontWeight, maxLines, textAnchor = "start", lineHeight = 1.3 }: {
  readonly text: string;
  readonly rect: Rect;
  readonly theme?: SceneTheme;
  readonly fontSize: number;
  readonly fill?: string;
  readonly fontFamily?: string;
  readonly fontWeight?: number | string | undefined;
  readonly maxLines?: number | undefined;
  readonly textAnchor?: "start" | "middle" | "end" | undefined;
  readonly lineHeight?: number | undefined;
}) {
  const chars = Math.max(4, Math.floor(rect.width / (fontSize * 0.56)));
  const lines = wrapText(text, chars);
  const limit = Math.max(1, Math.min(maxLines ?? Math.floor(rect.height / (fontSize * lineHeight)), lines.length));
  const x = textAnchor === "middle" ? rect.x + rect.width / 2 : textAnchor === "end" ? rect.x + rect.width : rect.x;
  return <MultilineText x={x} y={rect.y + fontSize} lines={ellipsizeLines(lines, limit)} lineHeight={fontSize * lineHeight} textAnchor={textAnchor} fill={fill ?? theme.ink} fontFamily={fontFamily ?? theme.fontBody} fontSize={fontSize} fontWeight={fontWeight} maxLines={limit} />;
}

export function Pill({ x, y, label, theme = PRECISION_THEME, tone = "primary", fontSize = 16 }: {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly theme?: SceneTheme;
  readonly tone?: "primary" | "secondary" | "warning" | "neutral";
  readonly fontSize?: number;
}) {
  const color = tone === "secondary" ? theme.secondary : tone === "warning" ? theme.warning : tone === "neutral" ? theme.mutedInk : theme.primary;
  const width = Math.max(fontSize * 4, label.length * fontSize * 0.61 + fontSize * 2);
  return (
    <g>
      <rect x={x} y={y} width={width} height={fontSize * 2.1} rx={fontSize * 1.05} fill={tint(color, 0.88)} />
      <text x={x + width / 2} y={y + fontSize * 1.4} textAnchor="middle" fill={color} fontFamily={theme.fontMono} fontSize={fontSize} fontWeight="700">{label}</text>
    </g>
  );
}

export function BulletList({ items, rect, scene, frame, theme = PRECISION_THEME, ordered = false }: {
  readonly items: readonly { readonly id: string; readonly text: string; readonly supportingText?: string; readonly emphasis?: string }[];
  readonly rect: Rect;
  readonly scene: CompiledScene;
  readonly frame: FrameContext;
  readonly theme?: SceneTheme;
  readonly ordered?: boolean;
}) {
  const visible = items.slice(0, scene.metrics.profile === "portrait" ? 6 : 7);
  const rowHeight = rect.height / Math.max(1, visible.length);
  return (
    <g data-semantic-role="content">
      {visible.map((item, index) => {
        const y = rect.y + index * rowHeight;
        const style = animationStyle(scene.choreography, item.id, frame.tick, frame.reducedMotion) as CSSProperties;
        const color = item.emphasis === "secondary" ? theme.secondary : item.emphasis === "warning" ? theme.warning : theme.primary;
        return (
          <g key={item.id} id={item.id} style={style}>
            {ordered ? (
              <text x={rect.x + scene.metrics.bodySize * 0.7} y={y + scene.metrics.bodySize * 1.2} textAnchor="middle" fill={color} fontFamily={theme.fontMono} fontWeight="800" fontSize={scene.metrics.bodySize}>{index + 1}</text>
            ) : (
              <circle cx={rect.x + scene.metrics.bodySize * 0.65} cy={y + scene.metrics.bodySize * 0.88} r={scene.metrics.bodySize * 0.28} fill={color} />
            )}
            <WrappedText text={item.text} rect={{ x: rect.x + scene.metrics.bodySize * 1.8, y: y + scene.metrics.bodySize * 0.18, width: rect.width - scene.metrics.bodySize * 2, height: rowHeight * 0.58 }} theme={theme} fontSize={scene.metrics.bodySize} fontWeight="650" maxLines={2} />
            {item.supportingText ? <WrappedText text={item.supportingText} rect={{ x: rect.x + scene.metrics.bodySize * 1.8, y: y + rowHeight * 0.56, width: rect.width - scene.metrics.bodySize * 2, height: rowHeight * 0.38 }} theme={theme} fontSize={scene.metrics.smallSize} fill={theme.mutedInk} maxLines={1} /> : null}
          </g>
        );
      })}
    </g>
  );
}

export function AssetFrame({ asset, rect, resolveAsset, theme = PRECISION_THEME, label }: {
  readonly asset: AssetReference;
  readonly rect: Rect;
  readonly resolveAsset?: ((asset: AssetReference) => string | undefined) | undefined;
  readonly theme?: SceneTheme | undefined;
  readonly label?: string | undefined;
}) {
  const href = resolveAsset?.(asset);
  const safeHref = href && (href.startsWith("blob:") || href.startsWith("alystria-asset:")) ? href : undefined;
  const clipId = `asset-${safeId(asset.id)}`;
  return (
    <g role="img" aria-label={asset.alt}>
      <defs><clipPath id={clipId}><rect {...rect} rx={theme.radius} /></clipPath></defs>
      <rect {...rect} rx={theme.radius} fill={theme.surfaceRaised} stroke={theme.line} strokeWidth="2" />
      {safeHref ? <image href={safeHref} {...rect} preserveAspectRatio={asset.fit === "contain" ? "xMidYMid meet" : "xMidYMid slice"} clipPath={`url(#${clipId})`} /> : <AssetPlaceholder rect={rect} theme={theme} label={label ?? asset.alt} />}
    </g>
  );
}

function AssetPlaceholder({ rect, theme, label }: { readonly rect: Rect; readonly theme: SceneTheme; readonly label: string }) {
  const inset = Math.min(rect.width, rect.height) * 0.14;
  return (
    <g aria-hidden="true">
      <path d={`M ${rect.x + inset} ${rect.y + rect.height - inset} L ${rect.x + rect.width * 0.42} ${rect.y + rect.height * 0.48} L ${rect.x + rect.width * 0.6} ${rect.y + rect.height * 0.68} L ${rect.x + rect.width - inset} ${rect.y + rect.height * 0.3} L ${rect.x + rect.width - inset} ${rect.y + rect.height - inset} Z`} fill={tint(theme.secondary, 0.66)} />
      <circle cx={rect.x + rect.width * 0.7} cy={rect.y + rect.height * 0.28} r={Math.min(rect.width, rect.height) * 0.08} fill={theme.accent} />
      <text x={rect.x + rect.width / 2} y={rect.y + rect.height - inset * 0.35} textAnchor="middle" fill={theme.mutedInk} fontFamily={theme.fontBody} fontSize={Math.max(13, Math.min(22, rect.width / 25))}>{truncate(label, 48)}</text>
    </g>
  );
}

export function ProgressDots({ x, y, count, active, theme = PRECISION_THEME, gap = 18 }: { readonly x: number; readonly y: number; readonly count: number; readonly active: number; readonly theme?: SceneTheme; readonly gap?: number }) {
  return <g aria-hidden="true">{Array.from({ length: count }, (_, index) => <circle key={index} cx={x + index * gap} cy={y} r={index === active ? 5 : 3.5} fill={index === active ? theme.primary : theme.line} />)}</g>;
}

export function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function wrapText(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const rawWord of words) {
    const pieces = rawWord.length > maxChars ? chunkWord(rawWord, maxChars) : [rawWord];
    for (const word of pieces) {
      if (!current) current = word;
      else if (`${current} ${word}`.length <= maxChars) current += ` ${word}`;
      else { lines.push(current); current = word; }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function chunkWord(word: string, size: number): string[] {
  const pieces: string[] = [];
  for (let index = 0; index < word.length; index += size) pieces.push(word.slice(index, index + size));
  return pieces;
}

function ellipsizeLines(lines: readonly string[], limit: number): string[] {
  if (lines.length <= limit) return [...lines];
  const result = lines.slice(0, limit);
  const last = result[result.length - 1] ?? "";
  result[result.length - 1] = `${last.replace(/[.\s]+$/g, "")}…`;
  return result;
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function tint(hex: string, amount: number): string {
  const clean = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return hex;
  const channel = (offset: number) => {
    const value = Number.parseInt(clean.slice(offset, offset + 2), 16);
    return Math.round(value + (255 - value) * amount).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}
