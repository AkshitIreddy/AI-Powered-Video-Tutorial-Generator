import { createElement, type CSSProperties, type ReactNode } from "react";
import { animationStyle } from "./choreography.js";
import { insetRect } from "./layout.js";
import { layoutSlot } from "./layout-manifest.js";
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
      data-visual-language="editorial-v2"
      data-composition-family={compositionFamily(scene)}
      data-visual-intent={visualTag(scene, "intent") ?? undefined}
      data-visual-motion={visualTag(scene, "motion") ?? undefined}
      data-visual-density={visualTag(scene, "density") ?? undefined}
      data-layout-compiler={scene.layout.compilerVersion}
      data-layout-locale={scene.layout.locale}
      data-layout-graphics-safe={`${scene.layout.graphicsSafe.x},${scene.layout.graphicsSafe.y},${scene.layout.graphicsSafe.width},${scene.layout.graphicsSafe.height}`}
      data-layout-action-safe={`${scene.layout.actionSafe.x},${scene.layout.actionSafe.y},${scene.layout.actionSafe.width},${scene.layout.actionSafe.height}`}
      data-layout-avoid-regions={JSON.stringify(scene.layout.avoidRegions)}
    >
      <title id={`${safeId(scene.spec.id)}-title`}>{scene.spec.content.title}</title>
      <desc id={`${safeId(scene.spec.id)}-desc`}>{scene.accessibilityDescription}</desc>
      <defs>
        <filter id={`shadow-${safeId(scene.spec.id)}`} x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy={Math.max(5, scene.metrics.unit * 0.62)} stdDeviation={Math.max(6, scene.metrics.unit * 0.9)} floodColor={theme.ink} floodOpacity="0.18" />
        </filter>
        <filter id={`soft-shadow-${safeId(scene.spec.id)}`} x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy={Math.max(8, scene.metrics.unit)} stdDeviation={Math.max(10, scene.metrics.unit * 1.4)} floodColor={theme.ink} floodOpacity="0.22" />
        </filter>
        <linearGradient id={`wash-${safeId(scene.spec.id)}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor={theme.primary} />
          <stop offset="0.56" stopColor={theme.secondary} />
          <stop offset="1" stopColor={theme.paper} />
        </linearGradient>
        <linearGradient id={`ink-field-${safeId(scene.spec.id)}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor={shade(theme.codeBackground, 0.05)} />
          <stop offset="0.58" stopColor={theme.codeBackground} />
          <stop offset="1" stopColor={shade(theme.primary, 0.42)} />
        </linearGradient>
        <linearGradient id={`signal-field-${safeId(scene.spec.id)}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={theme.primary} />
          <stop offset="0.55" stopColor={theme.primary} />
          <stop offset="1" stopColor={theme.secondary} />
        </linearGradient>
        <pattern id={`micro-grid-${safeId(scene.spec.id)}`} width={scene.metrics.unit * 2.2} height={scene.metrics.unit * 2.2} patternUnits="userSpaceOnUse">
          <path d={`M ${scene.metrics.unit * 2.2} 0 L 0 0 0 ${scene.metrics.unit * 2.2}`} fill="none" stroke={theme.surface} strokeWidth="1" opacity="0.12" />
        </pattern>
        <mask id={`background-treatment-${safeId(scene.spec.id)}`} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height}>
          <rect width={width} height={height} fill="#FFFFFF" opacity="0.085" />
          <path d={`M ${width * 0.865} 0 H ${width} V ${height} H ${width * 0.57} L ${width * 0.7} ${height * 0.885} L ${width * 0.79} ${height * 0.61} Z`} fill="#FFFFFF" />
        </mask>
      </defs>
      <rect width={width} height={height} fill={theme.paper} />
      {safeBackgroundHref ? (
        <g data-semantic-role="visual" aria-label={background?.alt} data-background-treatment="artwork-aperture">
          {/* A single asset is alpha-masked into two treatments: a faint paper
              texture and a full-colour editorial aperture. Keeping one image
              also preserves one-to-one provenance and browser asset mapping. */}
          <image
            href={safeBackgroundHref}
            x="0"
            y="0"
            width={width}
            height={height}
            preserveAspectRatio={background?.fit === "contain" ? "xMidYMid meet" : "xMidYMid slice"}
            mask={`url(#background-treatment-${safeId(scene.spec.id)})`}
          />
          <path
            d={`M ${width * 0.865} 0 V ${height * 0.52} C ${width * 0.865} ${height * 0.71}, ${width * 0.735} ${height * 0.83}, ${width * 0.57} ${height} H ${width * 0.63} C ${width * 0.79} ${height * 0.84}, ${width * 0.9} ${height * 0.7}, ${width * 0.9} ${height * 0.5} V 0 Z`}
            fill={theme.paper}
            opacity="0.16"
          />
          <path d={`M ${width * 0.865} 0 V ${height * 0.5} C ${width * 0.865} ${height * 0.7}, ${width * 0.735} ${height * 0.84}, ${width * 0.57} ${height}`} fill="none" stroke={theme.secondary} strokeWidth={Math.max(2, scene.metrics.unit * 0.22)} opacity="0.52" />
        </g>
      ) : null}
      <EditorialGround scene={scene} theme={theme} random={random} hasImage={Boolean(safeBackgroundHref)} />
      {children}
      {debugRegions ? <RegionDebug scene={scene} /> : null}
    </svg>
  );
}

function EditorialGround({ scene, theme, random, hasImage }: { readonly scene: CompiledScene; readonly theme: SceneTheme; readonly random: SeededRandom; readonly hasImage: boolean }) {
  const family = compositionFamily(scene);
  const { width, height } = scene.target;
  const safe = scene.metrics.safe;
  const accent = family === "data-canvas" || family === "evidence" ? theme.secondary : family === "worked-example" || family === "question" ? theme.warning : theme.primary;
  const lineOpacity = hasImage ? 0.18 : 0.34;
  return (
    <g aria-hidden="true" data-background-family={family}>
      {!hasImage ? <path d={`M ${width * 0.64} 0 H ${width} V ${height * 0.36} Z`} fill={`url(#wash-${safeId(scene.spec.id)})`} opacity="0.12" /> : null}
      {family === "split-evidence" ? <g><path d={`M 0 ${height * 0.52} L ${width * 0.47} ${height * 0.28} V ${height} H 0 Z`} fill={theme.primary} opacity="0.07" /><path d={`M ${width} ${height * 0.29} L ${width * 0.53} ${height * 0.52} V ${height} H ${width} Z`} fill={theme.secondary} opacity="0.09" /></g> : null}
      {family === "worked-example" ? <g><path d={`M 0 ${height * 0.48} L ${width} ${height * 0.34} V ${height * 0.82} L 0 ${height * 0.94} Z`} fill={theme.warning} opacity="0.07" /><line x1="0" y1={height * 0.94} x2={width} y2={height * 0.82} stroke={theme.warning} strokeWidth={scene.metrics.unit * 0.45} opacity="0.42" /></g> : null}
      {family === "presenter" ? <g><path d={`M ${width * 0.54} 0 H ${width} V ${height} H ${width * 0.66} L ${width * 0.56} ${height * 0.58} Z`} fill={theme.secondary} opacity="0.10" /><path d={`M ${width * 0.83} 0 H ${width} V ${height * 0.48} Z`} fill={theme.primary} opacity="0.13" /></g> : null}
      {family === "question" ? <circle cx={width * 0.85} cy={height * 0.25} r={Math.min(width, height) * 0.23} fill={theme.primary} opacity="0.035" /> : null}
      <line x1={safe.x} x2={safe.x + safe.width} y1={safe.y - scene.metrics.unit * 0.7} y2={safe.y - scene.metrics.unit * 0.7} stroke={theme.line} strokeWidth="1" opacity={lineOpacity} />
      <line x1={safe.x} x2={safe.x + Math.min(safe.width * 0.12, scene.metrics.unit * 12)} y1={safe.y - scene.metrics.unit * 0.7} y2={safe.y - scene.metrics.unit * 0.7} stroke={accent} strokeWidth={Math.max(3, scene.metrics.unit * 0.32)} />
      {family === "diagram" || family === "data-canvas" ? (
        <g opacity={lineOpacity * 0.74}>
          {Array.from({ length: 5 }, (_, index) => <line key={index} x1={safe.x + safe.width * index / 4} x2={safe.x + safe.width * index / 4} y1={safe.y} y2={safe.y + safe.height} stroke={theme.line} />)}
          {Array.from({ length: 4 }, (_, index) => <line key={index} x1={safe.x} x2={safe.x + safe.width} y1={safe.y + safe.height * index / 3} y2={safe.y + safe.height * index / 3} stroke={theme.line} />)}
        </g>
      ) : null}
      {family === "editorial" ? <g><circle cx={width * 0.86} cy={height * 0.18} r={random.between(width * 0.08, width * 0.13)} fill="none" stroke={accent} strokeWidth={Math.max(2, scene.metrics.unit * 0.25)} opacity="0.22" /><circle cx={width * 0.86} cy={height * 0.18} r={random.between(width * 0.035, width * 0.06)} fill={accent} opacity="0.06" /></g> : null}
    </g>
  );
}

function visualTag(scene: CompiledScene, key: string): string | undefined {
  const prefix = `visual:${key}=`;
  return scene.spec.tags?.find((tag) => tag.startsWith(prefix))?.slice(prefix.length);
}

function compositionFamily(scene: CompiledScene): string {
  const declared = visualTag(scene, "composition");
  if (declared) return declared.replaceAll("_", "-");
  const kind = scene.spec.content.kind;
  if (["title", "section-intro", "quote", "outro"].includes(kind)) return "editorial";
  if (["graph", "chart", "table", "map"].includes(kind)) return "data-canvas";
  if (["diagram", "timeline", "simulation", "variable-state", "execution-trace"].includes(kind)) return "diagram";
  if (["image-focus", "image-comparison", "document-focus", "screen-recording", "sources"].includes(kind)) return "evidence";
  if (["worked-example", "formula", "derivation", "code", "walkthrough", "diff", "terminal", "file-tree"].includes(kind)) return "worked-example";
  if (["comparison", "image-comparison"].includes(kind)) return "split-evidence";
  if (["question", "quiz"].includes(kind)) return "question";
  if (["presenter", "presenter-slide"].includes(kind)) return "presenter";
  return "object-stage";
}

function RegionDebug({ scene }: { readonly scene: CompiledScene }) {
  return (
    <g aria-hidden="true" pointerEvents="none">
      <rect {...scene.layout.graphicsSafe} fill="none" stroke="#C94B67" strokeWidth="2" strokeDasharray="10 6" />
      <rect {...scene.layout.actionSafe} fill="none" stroke="#DF922E" strokeWidth="1.5" strokeDasharray="4 5" />
      {scene.layout.slots.map((region) => (
        <g key={region.id}>
          <rect {...region} fill="none" stroke={region.essential ? "#C94B67" : "#DF922E"} strokeWidth="2" strokeDasharray="8 6" />
          <text x={region.x + 6} y={region.y + 16} fontSize="12" fill="#C94B67">{region.role}:{region.id}</text>
        </g>
      ))}
      {scene.layout.avoidRegions.map((region) => <g key={region.id}>
        <rect {...region} fill="#C94B67" fillOpacity="0.08" stroke="#C94B67" strokeWidth="1" strokeDasharray="3 4" />
        <text x={region.x + 5} y={region.y + 14} fontSize="11" fill="#C94B67">avoid:{region.id}</text>
      </g>)}
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
  const titleSlot = layoutSlot(scene.layout, "header.title");
  const eyebrowSlot = scene.layout.slots.find((item) => item.id === "header.eyebrow");
  const subtitleSlot = scene.layout.slots.find((item) => item.id === "header.subtitle");
  const textAnchor = align === "center" ? "middle" : "start";
  const x = align === "center" ? titleSlot.x + titleSlot.width / 2 : titleSlot.x + 2;
  const titleSize = scene.metrics.titleSize;
  const maxChars = Math.max(15, Math.floor(titleSlot.width / (titleSize * 0.54)));
  const titleLines = wrapText(title, maxChars);
  const style = animationStyle(scene.choreography, "header", frame.tick, frame.reducedMotion) as CSSProperties;
  const customizedBackground = sceneBackground(scene);
  const surfaceX = Math.max(0, region.x - scene.metrics.unit * 1.1);
  const surfaceY = Math.max(0, region.y - scene.metrics.unit * 1.15);
  const surfaceWidth = Math.min(scene.target.width - surfaceX, region.width + scene.metrics.unit * 2.2);
  const surfaceHeight = Math.min(scene.target.height - surfaceY, region.height + scene.metrics.unit * 0.45);
  return (
    <g id="header" data-semantic-role="title" data-layout-scope="header" style={style}>
      {customizedBackground ? <path
        d={`M ${surfaceX} ${surfaceY} H ${surfaceX + surfaceWidth} V ${surfaceY + surfaceHeight - scene.metrics.unit * 0.75} L ${surfaceX + surfaceWidth - scene.metrics.unit * 0.75} ${surfaceY + surfaceHeight} H ${surfaceX} Z`}
        fill={theme.paper}
        opacity="0.955"
        data-readability-surface="header"
      /> : null}
      {eyebrow && eyebrowSlot ? <text
        id="header-eyebrow"
        data-layout-box="header.eyebrow"
        data-layout-role="eyebrow"
        data-layout-essential="true"
        x={align === "center" ? eyebrowSlot.x + eyebrowSlot.width / 2 : eyebrowSlot.x}
        y={eyebrowSlot.y + legible(scene.metrics.smallSize * 0.88)}
        textAnchor={textAnchor}
        fill={theme.primary}
        fontFamily={theme.fontMono}
        fontSize={legible(scene.metrics.smallSize * 0.88)}
        fontWeight="760"
        letterSpacing={2.5}
      >{eyebrow.toUpperCase()}</text> : null}
      <MultilineText
        id="header-title"
        layoutRole="title"
        essential
        x={x}
        y={titleSlot.y + titleSize * 1.12}
        lines={titleLines}
        lineHeight={titleSize * 1.02}
        textAnchor={textAnchor}
        fill={theme.ink}
        fontFamily={theme.fontDisplay}
        fontSize={titleSize}
        fontWeight="750"
        letterSpacing={-1.1}
      />
      {subtitle && subtitleSlot ? <WrappedText id="header-subtitle" layoutRole="subtitle" essential text={subtitle} rect={subtitleSlot} theme={theme} fontSize={Math.max(15, scene.metrics.smallSize)} fill={theme.mutedInk} fontWeight="560" maxLines={3} lineHeight={1.22} /> : null}
      <line x1={region.x} x2={region.x + region.width} y1={region.y + region.height - scene.metrics.unit * 0.2} y2={region.y + region.height - scene.metrics.unit * 0.2} stroke={theme.line} strokeWidth="1.25" />
    </g>
  );
}

/** A single editorial field used only when user-selected artwork sits behind
 *  copy. It is intentionally not a rounded card: the cut corner reads as a
 *  page laid over artwork and keeps the instructional hierarchy continuous. */
export function ReadabilitySurface({ scene, rect, theme = PRECISION_THEME, opacity = 0.95, role = "content" }: {
  readonly scene: CompiledScene;
  readonly rect: Rect;
  readonly theme?: SceneTheme;
  readonly opacity?: number;
  readonly role?: string;
}) {
  if (!sceneBackground(scene)) return null;
  const cut = Math.min(rect.width, rect.height) * 0.045;
  return <g aria-hidden="true" data-readability-surface={role}>
    <path d={`M ${rect.x} ${rect.y} H ${rect.x + rect.width - cut} L ${rect.x + rect.width} ${rect.y + cut} V ${rect.y + rect.height} H ${rect.x + cut} L ${rect.x} ${rect.y + rect.height - cut} Z`} fill={theme.paper} opacity={opacity} />
    <path d={`M ${rect.x + cut} ${rect.y + rect.height} H ${rect.x + rect.width}`} fill="none" stroke={theme.secondary} strokeWidth={Math.max(2, scene.metrics.unit * 0.2)} opacity="0.54" />
  </g>;
}

function sceneBackground(scene: CompiledScene): AssetReference | undefined {
  return "background" in scene.spec.content ? scene.spec.content.background as AssetReference | undefined : undefined;
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
  const fill = tone === "primary" ? tint(theme.primary, 0.955) : tone === "secondary" ? tint(theme.secondary, 0.955) : tone === "warning" ? tint(theme.warning, 0.95) : tone === "dark" ? theme.codeBackground : theme.surface;
  const stroke = tone === "primary" ? theme.primary : tone === "secondary" ? theme.secondary : tone === "warning" ? theme.warning : tone === "dark" ? theme.codeBackground : theme.line;
  const childRect = insetRect(rect, padding);
  return (
    <g id={id} data-plane-tone={tone}>
      <rect {...rect} rx={Math.min(8, theme.radius * 0.32)} fill={fill} stroke={tone === "neutral" ? theme.line : "none"} strokeWidth="1" style={elevated ? { filter: "drop-shadow(0 8px 14px rgba(21, 24, 39, 0.08))" } : undefined} />
      <rect x={rect.x} y={rect.y} width={Math.max(3, Math.min(7, rect.width * 0.012))} height={rect.height} fill={stroke} />
      {padding > 0 ? createElement("g", { transform: `translate(${childRect.x - rect.x} ${childRect.y - rect.y})` }, children) : children}
    </g>
  );
}

export function MultilineText(props: {
  readonly id?: string;
  readonly layoutRole?: string;
  readonly essential?: boolean;
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
  const fontSize = legible(props.fontSize);
  const lineHeight = props.lineHeight * (fontSize / Math.max(1, props.fontSize));
  return (
    <text
      id={props.id}
      data-layout-box={props.id}
      data-layout-role={props.layoutRole}
      data-layout-essential={props.essential ? "true" : undefined}
      x={props.x}
      y={props.y}
      fill={props.fill}
      fontFamily={props.fontFamily}
      fontSize={fontSize}
      fontWeight={props.fontWeight}
      textAnchor={props.textAnchor}
      letterSpacing={props.letterSpacing}
    >
      {lines.map((line, index) => <tspan key={`${index}-${line}`} x={props.x} dy={index === 0 ? 0 : lineHeight}>{line}</tspan>)}
    </text>
  );
}

export function WrappedText({ id, layoutRole, essential, text, rect, theme = PRECISION_THEME, fontSize, fill, fontFamily, fontWeight, maxLines, textAnchor = "start", lineHeight = 1.3 }: {
  readonly id?: string;
  readonly layoutRole?: string;
  readonly essential?: boolean;
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
  const chars = Math.max(4, Math.floor(rect.width / (fontSize * 0.60)));
  const lines = wrapText(text, chars);
  const x = textAnchor === "middle" ? rect.x + rect.width / 2 : textAnchor === "end" ? rect.x + rect.width - 2 : rect.x + 2;
  // Essential copy is never silently ellipsized. Rendering every authored
  // line makes an infeasible layout visible to structural QA, which can then
  // choose another grammar/copy tier or fail compilation with evidence.
  return <g
    data-layout-container={id ?? ""}
    data-layout-max-lines={maxLines}
    data-layout-rect={`${rect.x},${rect.y},${rect.width},${rect.height}`}
    data-layout-overflow-policy="recompose"
  >
    <MultilineText
      {...(id === undefined ? {} : { id })}
      {...(layoutRole === undefined ? {} : { layoutRole })}
      {...(essential === undefined ? {} : { essential })}
      x={x}
      y={rect.y + fontSize * 1.22}
      lines={lines}
      lineHeight={fontSize * lineHeight}
      textAnchor={textAnchor}
      fill={fill ?? theme.ink}
      fontFamily={fontFamily ?? theme.fontBody}
      fontSize={fontSize}
      fontWeight={fontWeight}
    />
  </g>;
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
  const width = Math.max(fontSize * 4, label.length * fontSize * 0.61 + fontSize * 1.2);
  return (
    <g data-semantic-role="label">
      <rect x={x} y={y + fontSize * 1.55} width={Math.min(width, fontSize * 2.2)} height={Math.max(2, fontSize * 0.16)} fill={color} />
      <text x={x} y={y + fontSize * 1.15} fill={color} fontFamily={theme.fontMono} fontSize={fontSize * 0.88} fontWeight="760" letterSpacing={1.4}>{label}</text>
    </g>
  );
}

export function BulletList({ items, rect, scene, frame, theme = PRECISION_THEME, ordered = false, maxLinesPerItem = 2 }: {
  readonly items: readonly { readonly id: string; readonly text: string; readonly supportingText?: string; readonly emphasis?: string }[];
  readonly rect: Rect;
  readonly scene: CompiledScene;
  readonly frame: FrameContext;
  readonly theme?: SceneTheme;
  readonly ordered?: boolean;
  /** A reserved presenter panel can afford one extra line without overlap. */
  readonly maxLinesPerItem?: number;
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
            <line x1={rect.x} x2={rect.x + scene.metrics.bodySize * 1.15} y1={y + scene.metrics.bodySize * 0.85} y2={y + scene.metrics.bodySize * 0.85} stroke={color} strokeWidth={ordered ? 3.5 : 2.5} />
            {ordered ? <text x={rect.x} y={y + scene.metrics.smallSize * 0.72} fill={color} fontFamily={theme.fontMono} fontWeight="800" fontSize={scene.metrics.smallSize * 0.7}>{String(index + 1).padStart(2, "0")}</text> : null}
            <WrappedText text={item.text} rect={{ x: rect.x + scene.metrics.bodySize * 1.8, y: y + scene.metrics.bodySize * 0.18, width: rect.width - scene.metrics.bodySize * 2, height: rowHeight * 0.72 }} theme={theme} fontSize={scene.metrics.bodySize} fontWeight="650" maxLines={maxLinesPerItem} />
            {item.supportingText ? <WrappedText text={item.supportingText} rect={{ x: rect.x + scene.metrics.bodySize * 1.8, y: y + rowHeight * 0.53, width: rect.width - scene.metrics.bodySize * 2, height: rowHeight * 0.45 }} theme={theme} fontSize={scene.metrics.smallSize} fill={theme.mutedInk} maxLines={2} /> : null}
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
  // Include geometry so the same owned asset can be rendered in multiple
  // responsive specimens on one document without cross-SVG clipPath ID
  // collisions. A bare asset ID caused the portrait crop from the first
  // landscape SVG to mask the later portrait SVG.
  const clipId = `asset-${safeId(asset.id)}-${Math.round(rect.x)}-${Math.round(rect.y)}-${Math.round(rect.width)}-${Math.round(rect.height)}`;
  return (
    <g role="img" aria-label={asset.alt}>
      <defs><clipPath id={clipId}><rect {...rect} rx={Math.min(8, theme.radius * 0.3)} /></clipPath></defs>
      <rect {...rect} rx={Math.min(8, theme.radius * 0.3)} fill={theme.surfaceRaised} />
      {safeHref ? <image href={safeHref} {...rect} preserveAspectRatio={asset.fit === "contain" ? "xMidYMid meet" : "xMidYMid slice"} clipPath={`url(#${clipId})`} /> : <AssetPlaceholder rect={rect} theme={theme} label={label ?? asset.alt} />}
      <path d={`M ${rect.x} ${rect.y + rect.height} H ${rect.x + rect.width * 0.22}`} stroke={theme.primary} strokeWidth={Math.max(3, Math.min(8, rect.height * 0.012))} />
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
    // Never cut an unbreakable token by code-unit count. That corrupts
    // grapheme clusters and shaped scripts; an oversized token must trigger a
    // recompose/split diagnostic after authoritative measurement.
    const pieces = [rawWord];
    for (const word of pieces) {
      if (!current) current = word;
      else if (`${current} ${word}`.length <= maxChars) current += ` ${word}`;
      else { lines.push(current); current = word; }
    }
  }
  if (current) lines.push(current);
  return lines;
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

export function shade(hex: string, amount: number): string {
  const clean = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return hex;
  const channel = (offset: number) => Math.round(Number.parseInt(clean.slice(offset, offset + 2), 16) * (1 - amount)).toString(16).padStart(2, "0");
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

export function legible(size: number): number {
  return Math.max(16, size);
}
