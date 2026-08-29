import type { CSSProperties, ReactNode } from "react";
import { animationStyle } from "./choreography.js";
import { clamp, insetRect, splitColumns, stackRows } from "./layout.js";
import {
  AssetFrame,
  BulletList,
  Card,
  MultilineText,
  Pill,
  PRECISION_THEME,
  ProgressDots,
  SceneCanvas,
  SceneHeader,
  truncate,
  WrappedText,
  wrapText,
} from "./primitives.js";
import type {
  BulletsContent,
  ChartContent,
  CodeContent,
  ComparisonContent,
  DefinitionContent,
  DiagramContent,
  FileTreeContent,
  FormulaContent,
  GraphContent,
  ImageComparisonContent,
  ImageFocusContent,
  MapContent,
  OutroContent,
  PresenterContent,
  QuestionContent,
  QuoteContent,
  Rect,
  SceneContent,
  SceneRendererProps,
  SectionIntroContent,
  SimulationContent,
  SourcesContent,
  TableContent,
  TimelineContent,
  TitleContent,
  TraceContent,
  UiDemoContent,
  VariableStateContent,
  WorkedExampleContent,
  QuizContent,
} from "./types.js";

function bodyRect(props: SceneRendererProps): Rect {
  const region = props.scene.regions.find((item) => item.id === "body") ?? props.scene.metrics.safe;
  return { x: region.x, y: region.y, width: region.width, height: region.height };
}

function withFrame<T extends SceneContent>(props: SceneRendererProps<T>, content: ReactNode, options?: { readonly align?: "left" | "center"; readonly hideHeader?: boolean }) {
  const theme = props.theme ?? PRECISION_THEME;
  return (
    <SceneCanvas {...(props as SceneRendererProps)} theme={theme}>
      {!options?.hideHeader ? <SceneHeader scene={props.scene} frame={props.frame} theme={theme} title={props.scene.spec.content.title} eyebrow={(props.scene.spec.content as { eyebrow?: string }).eyebrow} subtitle={(props.scene.spec.content as { subtitle?: string }).subtitle} align={options?.align} /> : null}
      {content}
    </SceneCanvas>
  );
}

export function TitleRenderer(props: SceneRendererProps<TitleContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const { scene, frame } = props;
  const content = scene.spec.content;
  const safe = scene.metrics.safe;
  const style = animationStyle(scene.choreography, "body", frame.tick, frame.reducedMotion) as CSSProperties;
  const isPortrait = scene.metrics.profile === "portrait";
  // Keep a deliberate visual-safe gutter between the title copy and the
  // right-hand module card.  Imported display fonts can be substantially
  // wider than the bundled face, so the old 3% gap allowed a legitimate title
  // to intrude underneath the card even though its text box itself fit.
  const accentRect: Rect = isPortrait
    ? { x: safe.x + safe.width * 0.1, y: safe.y + safe.height * 0.66, width: safe.width * 0.8, height: safe.height * 0.18 }
    : { x: safe.x + safe.width * 0.66, y: safe.y + safe.height * 0.18, width: safe.width * 0.28, height: safe.height * 0.58 };
  const titleRect: Rect = isPortrait
    ? { x: safe.x + scene.metrics.gutter * 1.4, y: safe.y + safe.height * 0.2, width: safe.width * 0.95, height: safe.height * 0.38 }
    : { x: safe.x + scene.metrics.gutter * 1.4, y: safe.y + safe.height * 0.2, width: safe.width * 0.5, height: safe.height * 0.4 };
  const subtitleRect: Rect = isPortrait
    ? { x: safe.x + scene.metrics.gutter * 1.4, y: safe.y + safe.height * 0.61, width: safe.width * 0.92, height: safe.height * 0.13 }
    : { x: safe.x + scene.metrics.gutter * 1.4, y: safe.y + safe.height * 0.63, width: safe.width * 0.48, height: safe.height * 0.13 };
  return (
    <SceneCanvas {...props} theme={theme}>
      <g id="body" style={style}>
        <rect x={safe.x} y={safe.y + safe.height * 0.08} width={scene.metrics.unit * 1.1} height={safe.height * 0.5} rx={scene.metrics.unit * 0.5} fill={theme.primary} />
        <Pill x={safe.x + scene.metrics.gutter * 1.4} y={safe.y + safe.height * 0.08} label={content.eyebrow ?? "NEW TUTORIAL"} theme={theme} fontSize={scene.metrics.smallSize} />
        <WrappedText text={content.title} rect={titleRect} theme={theme} fontSize={scene.metrics.titleSize * 1.34} fontFamily={theme.fontDisplay} fontWeight="780" maxLines={isPortrait ? 4 : 3} lineHeight={1.03} />
        {content.subtitle ? <WrappedText text={content.subtitle} rect={subtitleRect} theme={theme} fontSize={scene.metrics.subtitleSize} fill={theme.mutedInk} maxLines={2} /> : null}
        <Card rect={accentRect} theme={theme} tone="primary">
          <g>
            <circle cx={accentRect.x + accentRect.width * 0.5} cy={accentRect.y + accentRect.height * 0.43} r={Math.min(accentRect.width, accentRect.height) * 0.2} fill={theme.surface} opacity="0.95" />
            <path d={`M ${accentRect.x + accentRect.width * 0.43} ${accentRect.y + accentRect.height * 0.31} L ${accentRect.x + accentRect.width * 0.65} ${accentRect.y + accentRect.height * 0.43} L ${accentRect.x + accentRect.width * 0.43} ${accentRect.y + accentRect.height * 0.55} Z`} fill={theme.primary} />
            <text x={accentRect.x + accentRect.width / 2} y={accentRect.y + accentRect.height * 0.76} textAnchor="middle" fill={theme.primary} fontFamily={theme.fontMono} fontWeight="700" fontSize={scene.metrics.smallSize}>{content.module ?? "LEARNING PATH"}</text>
          </g>
        </Card>
        {content.author ? <text x={safe.x + scene.metrics.gutter * 1.4} y={safe.y + safe.height * 0.91} fill={theme.ink} fontFamily={theme.fontBody} fontWeight="650" fontSize={scene.metrics.smallSize}>{content.author}</text> : null}
      </g>
    </SceneCanvas>
  );
}

export function SectionIntroRenderer(props: SceneRendererProps<SectionIntroContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const content = props.scene.spec.content;
  const safe = props.scene.metrics.safe;
  const isPortrait = props.scene.metrics.profile === "portrait";
  const titleRect: Rect = { x: safe.x + safe.width * 0.08, y: safe.y + safe.height * 0.22, width: safe.width * 0.84, height: safe.height * 0.28 };
  return withFrame(props, (
    <g id="body" style={animationStyle(props.scene.choreography, "body", props.frame.tick, props.frame.reducedMotion) as CSSProperties}>
      <text x={safe.x + safe.width / 2} y={safe.y + safe.height * 0.19} textAnchor="middle" fill={theme.primary} fontFamily={theme.fontMono} fontWeight="800" fontSize={props.scene.metrics.subtitleSize} letterSpacing={3}>SECTION {content.sectionNumber ?? "—"}</text>
      <WrappedText text={content.title} rect={titleRect} theme={theme} fontSize={props.scene.metrics.titleSize * 1.12} fontFamily={theme.fontDisplay} fontWeight="780" textAnchor="middle" maxLines={isPortrait ? 4 : 2} />
      {content.objectives?.length ? (
        <Card rect={{ x: safe.x + safe.width * 0.1, y: safe.y + safe.height * 0.58, width: safe.width * 0.8, height: safe.height * 0.24 }} theme={theme}>
          <BulletList items={content.objectives.slice(0, 3).map((text, index) => ({ id: `objective-${index}`, text }))} rect={{ x: safe.x + safe.width * 0.14, y: safe.y + safe.height * 0.61, width: safe.width * 0.72, height: safe.height * 0.18 }} scene={props.scene} frame={props.frame} theme={theme} ordered />
        </Card>
      ) : null}
    </g>
  ), { hideHeader: true });
}

export function DefinitionRenderer(props: SceneRendererProps<DefinitionContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const content = props.scene.spec.content;
  const cards = props.scene.metrics.columns === 2 ? splitColumns(body, props.scene.metrics.gutter, 0.6) : stackRows(body, content.example ? 2 : 1, props.scene.metrics.gutter);
  const definitionRect = cards[0] ?? body;
  const exampleRect = cards[1];
  return withFrame(props, (
    <g id="body" style={animationStyle(props.scene.choreography, "body", props.frame.tick, props.frame.reducedMotion) as CSSProperties}>
      <Card rect={definitionRect} theme={theme} tone="primary" elevated>
        <Pill x={definitionRect.x + props.scene.metrics.gutter} y={definitionRect.y + props.scene.metrics.gutter} label="DEFINITION" theme={theme} />
        <WrappedText text={content.term} rect={{ x: definitionRect.x + props.scene.metrics.gutter, y: definitionRect.y + definitionRect.height * 0.23, width: definitionRect.width - props.scene.metrics.gutter * 2, height: definitionRect.height * 0.2 }} theme={theme} fontSize={props.scene.metrics.titleSize * 0.8} fontFamily={theme.fontDisplay} fontWeight="780" maxLines={2} />
        <WrappedText text={content.definition} rect={{ x: definitionRect.x + props.scene.metrics.gutter, y: definitionRect.y + definitionRect.height * 0.48, width: definitionRect.width - props.scene.metrics.gutter * 2, height: definitionRect.height * 0.42 }} theme={theme} fontSize={props.scene.metrics.bodySize} maxLines={5} />
      </Card>
      {content.example && exampleRect ? <Card rect={exampleRect} theme={theme} tone="secondary"><Pill x={exampleRect.x + props.scene.metrics.gutter} y={exampleRect.y + props.scene.metrics.gutter} label="EXAMPLE" tone="secondary" theme={theme} /><WrappedText text={content.example} rect={{ x: exampleRect.x + props.scene.metrics.gutter, y: exampleRect.y + exampleRect.height * 0.28, width: exampleRect.width - props.scene.metrics.gutter * 2, height: exampleRect.height * 0.62 }} theme={theme} fontSize={props.scene.metrics.bodySize} maxLines={6} /></Card> : null}
    </g>
  ));
}

export function BulletsRenderer(props: SceneRendererProps<BulletsContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  return withFrame(props, <BulletList items={props.scene.spec.content.items} rect={insetRect(body, props.scene.metrics.gutter * 0.4)} scene={props.scene} frame={props.frame} theme={theme} />);
}

export function ComparisonRenderer(props: SceneRendererProps<ComparisonContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const content = props.scene.spec.content;
  const body = bodyRect(props);
  const [first, second] = props.scene.metrics.columns === 2 ? splitColumns(body, props.scene.metrics.gutter) : stackRows(body, 2, props.scene.metrics.gutter) as readonly [Rect, Rect];
  const renderSide = (rect: Rect, label: string, items: readonly string[], tone: "primary" | "secondary") => (
    <Card rect={rect} theme={theme} tone={tone}>
      <Pill x={rect.x + props.scene.metrics.gutter} y={rect.y + props.scene.metrics.gutter} label={label.toUpperCase()} tone={tone} theme={theme} />
      <BulletList items={items.map((text, index) => ({ id: `${tone}-${index}`, text }))} rect={{ x: rect.x + props.scene.metrics.gutter * 0.4, y: rect.y + props.scene.metrics.gutter * 2.5, width: rect.width - props.scene.metrics.gutter * 0.8, height: rect.height - props.scene.metrics.gutter * 3 }} scene={props.scene} frame={props.frame} theme={theme} />
    </Card>
  );
  return withFrame(props, (
    <g id="body">
      {renderSide(first, content.left.label, content.left.items, "primary")}
      {renderSide(second, content.right.label, content.right.items, "secondary")}
      {content.verdict ? <Pill x={body.x + body.width / 2 - content.verdict.length * props.scene.metrics.smallSize * 0.3} y={body.y + body.height - props.scene.metrics.smallSize * 2.4} label={content.verdict} tone="warning" theme={theme} /> : null}
    </g>
  ));
}

export function DiagramRenderer(props: SceneRendererProps<DiagramContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = insetRect(bodyRect(props), props.scene.metrics.gutter * 0.4);
  const content = props.scene.spec.content;
  const nodes = content.nodes.slice(0, 9);
  const positions = layoutDiagram(nodes.length, body, content.direction ?? (props.scene.metrics.columns === 2 ? "left-to-right" : "top-to-bottom"));
  const byId = new Map(nodes.map((node, index) => [node.id, positions[index]]));
  return withFrame(props, (
    <g id="body" data-semantic-role="visual">
      <defs><marker id={`arrow-${props.scene.spec.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill={theme.mutedInk} /></marker></defs>
      {content.edges.map((edge) => {
        const from = byId.get(edge.from); const to = byId.get(edge.to);
        if (!from || !to) return null;
        const start = edgePoint(from, to, false);
        const end = edgePoint(to, from, true);
        const x1 = start.x; const y1 = start.y;
        const x2 = end.x; const y2 = end.y;
        return <g key={edge.id}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke={edge.style === "emphasis" ? theme.primary : theme.mutedInk} strokeWidth={edge.style === "emphasis" ? 4 : 2.5} strokeDasharray={edge.style === "dashed" ? "9 7" : undefined} markerEnd={`url(#arrow-${props.scene.spec.id})`} opacity="0.75" />{edge.label ? <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8} textAnchor="middle" fill={theme.mutedInk} fontFamily={theme.fontMono} fontSize={props.scene.metrics.smallSize * 0.8}>{edge.label}</text> : null}</g>;
      })}
      {nodes.map((node, index) => {
        const rect = positions[index]; if (!rect) return null;
        const tone = node.tone === "secondary" ? "secondary" : node.tone === "warning" ? "warning" : node.tone === "neutral" ? "neutral" : "primary";
        return <Card key={node.id} id={node.id} rect={rect} theme={theme} tone={tone}><WrappedText text={node.label} rect={insetRect(rect, props.scene.metrics.unit)} theme={theme} fontSize={props.scene.metrics.bodySize * 0.9} fontWeight="700" textAnchor="middle" maxLines={2} />{node.detail ? <WrappedText text={node.detail} rect={{ x: rect.x + props.scene.metrics.unit, y: rect.y + rect.height * 0.58, width: rect.width - props.scene.metrics.unit * 2, height: rect.height * 0.3 }} theme={theme} fontSize={props.scene.metrics.smallSize * 0.82} fill={theme.mutedInk} textAnchor="middle" maxLines={2} /> : null}</Card>;
      })}
    </g>
  ));
}

function edgePoint(rect: Rect, other: Rect, inset: boolean): { readonly x: number; readonly y: number } {
  const cx = rect.x + rect.width / 2; const cy = rect.y + rect.height / 2;
  const ox = other.x + other.width / 2; const oy = other.y + other.height / 2;
  const dx = ox - cx; const dy = oy - cy;
  const pad = inset ? 8 : 0;
  if (Math.abs(dx / Math.max(1, rect.width)) >= Math.abs(dy / Math.max(1, rect.height))) {
    return { x: dx >= 0 ? rect.x + rect.width + pad : rect.x - pad, y: cy + dy / Math.max(1, Math.abs(dx)) * rect.width * 0.3 };
  }
  return { x: cx + dx / Math.max(1, Math.abs(dy)) * rect.height * 0.3, y: dy >= 0 ? rect.y + rect.height + pad : rect.y - pad };
}

function layoutDiagram(count: number, rect: Rect, direction: "left-to-right" | "top-to-bottom" | "radial"): readonly Rect[] {
  if (count === 0) return [];
  if (direction === "radial") {
    const radiusX = rect.width * 0.36; const radiusY = rect.height * 0.34;
    const width = Math.min(rect.width * 0.25, 260); const height = Math.min(rect.height * 0.2, 130);
    return Array.from({ length: count }, (_, index) => ({ x: rect.x + rect.width / 2 + Math.cos(index / count * Math.PI * 2 - Math.PI / 2) * radiusX - width / 2, y: rect.y + rect.height / 2 + Math.sin(index / count * Math.PI * 2 - Math.PI / 2) * radiusY - height / 2, width, height }));
  }
  const columns = direction === "left-to-right" ? Math.min(count, 4) : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const gap = Math.min(rect.width, rect.height) * 0.04;
  const width = (rect.width - gap * (columns - 1)) / columns;
  const height = Math.min((rect.height - gap * (rows - 1)) / rows, 180);
  return Array.from({ length: count }, (_, index) => ({ x: rect.x + (index % columns) * (width + gap), y: rect.y + Math.floor(index / columns) * (height + gap) + (rect.height - (height * rows + gap * (rows - 1))) / 2, width, height }));
}

export function TimelineRenderer(props: SceneRendererProps<TimelineContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = insetRect(bodyRect(props), props.scene.metrics.gutter * 0.2);
  const events = props.scene.spec.content.events.slice(0, props.scene.metrics.profile === "portrait" ? 6 : 8);
  const vertical = props.scene.metrics.profile === "portrait";
  return withFrame(props, (
    <g id="body" data-semantic-role="visual">
      <line x1={vertical ? body.x + body.width * 0.18 : body.x} x2={vertical ? body.x + body.width * 0.18 : body.x + body.width} y1={vertical ? body.y : body.y + body.height * 0.52} y2={vertical ? body.y + body.height : body.y + body.height * 0.52} stroke={theme.line} strokeWidth={props.scene.metrics.unit * 0.55} strokeLinecap="round" />
      {events.map((event, index) => {
        const progress = events.length === 1 ? 0.5 : index / (events.length - 1);
        const x = vertical ? body.x + body.width * 0.18 : body.x + body.width * progress;
        const y = vertical ? body.y + body.height * progress : body.y + body.height * 0.52;
        const side = index % 2 === 0 ? -1 : 1;
        const labelRect: Rect = vertical ? { x: body.x + body.width * 0.28, y: y - props.scene.metrics.bodySize * 1.5, width: body.width * 0.68, height: props.scene.metrics.bodySize * 3.4 } : { x: x - body.width / Math.max(3, events.length) * 0.48, y: y + side * body.height * 0.2 - (side < 0 ? body.height * 0.16 : 0), width: body.width / Math.max(3, events.length) * 0.96, height: body.height * 0.17 };
        return <g key={event.id} id={event.id} style={animationStyle(props.scene.choreography, event.id, props.frame.tick, props.frame.reducedMotion) as CSSProperties}><circle cx={x} cy={y} r={props.scene.metrics.unit * 0.78} fill={theme.surface} stroke={index % 2 ? theme.secondary : theme.primary} strokeWidth={props.scene.metrics.unit * 0.32} /><text x={labelRect.x + (vertical ? 0 : labelRect.width / 2)} y={labelRect.y + props.scene.metrics.smallSize} textAnchor={vertical ? "start" : "middle"} fill={theme.primary} fontFamily={theme.fontMono} fontWeight="800" fontSize={props.scene.metrics.smallSize}>{event.date}</text><WrappedText text={event.label} rect={{ ...labelRect, y: labelRect.y + props.scene.metrics.smallSize * 1.2, height: labelRect.height - props.scene.metrics.smallSize * 1.2 }} theme={theme} fontSize={props.scene.metrics.smallSize} fontWeight="650" textAnchor={vertical ? "start" : "middle"} maxLines={2} /></g>;
      })}
    </g>
  ));
}

export function FormulaRenderer(props: SceneRendererProps<FormulaContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const content = props.scene.spec.content;
  const body = bodyRect(props);
  const steps = content.steps?.slice(0, 6) ?? [];
  const formulaRect: Rect = steps.length ? { x: body.x, y: body.y, width: body.width, height: body.height * 0.26 } : body;
  return withFrame(props, (
    <g id="body" data-semantic-role="content">
      <Card rect={formulaRect} theme={theme} tone="primary">
        <text x={formulaRect.x + formulaRect.width / 2} y={formulaRect.y + formulaRect.height * 0.58} textAnchor="middle" fill={theme.ink} fontFamily={theme.fontMono} fontWeight="750" fontSize={Math.min(props.scene.metrics.titleSize, formulaRect.width / Math.max(9, content.expression.length) * 1.45)}>{content.expression}</text>
      </Card>
      {steps.length ? <g>{stackRows({ x: body.x + body.width * 0.05, y: body.y + body.height * 0.31, width: body.width * 0.9, height: body.height * 0.58 }, steps.length, props.scene.metrics.unit).map((rect, index) => { const step = steps[index]; if (!step) return null; return <g key={step.id} id={step.id} style={animationStyle(props.scene.choreography, step.id, props.frame.tick, props.frame.reducedMotion) as CSSProperties}><text x={rect.x} y={rect.y + props.scene.metrics.bodySize} fill={theme.primary} fontFamily={theme.fontMono} fontWeight="800" fontSize={props.scene.metrics.bodySize}>{index + 1}</text><text x={rect.x + props.scene.metrics.bodySize * 2} y={rect.y + props.scene.metrics.bodySize} fill={theme.ink} fontFamily={theme.fontMono} fontWeight="650" fontSize={props.scene.metrics.bodySize}>{truncate(step.expression, 66)}</text>{step.reason ? <text x={rect.x + rect.width} y={rect.y + props.scene.metrics.bodySize} textAnchor="end" fill={theme.mutedInk} fontFamily={theme.fontBody} fontSize={props.scene.metrics.smallSize}>{truncate(step.reason, 34)}</text> : null}</g>; })}</g> : null}
      {content.result ? <Pill x={body.x + body.width * 0.25} y={body.y + body.height - props.scene.metrics.subtitleSize * 1.8} label={`RESULT  ${content.result}`} tone="secondary" theme={theme} fontSize={props.scene.metrics.smallSize} /> : null}
    </g>
  ));
}

export function GraphRenderer(props: SceneRendererProps<GraphContent>) {
  return withFrame(props, <Plot sceneProps={props} series={props.scene.spec.content.series} xLabel={props.scene.spec.content.xLabel} yLabel={props.scene.spec.content.yLabel} domain={props.scene.spec.content.domain} />);
}

function Plot({ sceneProps: props, series, xLabel, yLabel, domain, fillArea = false }: {
  readonly sceneProps: SceneRendererProps;
  readonly series: readonly { readonly id: string; readonly label: string; readonly color?: string; readonly values: readonly { readonly x: number; readonly y: number; readonly label?: string }[] }[];
  readonly xLabel?: string | undefined;
  readonly yLabel?: string | undefined;
  readonly domain?: { readonly x: readonly [number, number]; readonly y: readonly [number, number] } | undefined;
  readonly fillArea?: boolean;
}) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = insetRect(bodyRect(props), props.scene.metrics.gutter * 0.9);
  const plot: Rect = { x: body.x + props.scene.metrics.bodySize * 2.2, y: body.y + props.scene.metrics.smallSize, width: body.width - props.scene.metrics.bodySize * 3, height: body.height - props.scene.metrics.bodySize * 3 };
  const all = series.flatMap((entry) => entry.values);
  const minX = domain?.x[0] ?? Math.min(...all.map((point) => point.x), 0);
  const maxX = domain?.x[1] ?? Math.max(...all.map((point) => point.x), 1);
  const minY = domain?.y[0] ?? Math.min(...all.map((point) => point.y), 0);
  const maxY = domain?.y[1] ?? Math.max(...all.map((point) => point.y), 1);
  const scaleX = (value: number) => plot.x + (value - minX) / Math.max(0.00001, maxX - minX) * plot.width;
  const scaleY = (value: number) => plot.y + plot.height - (value - minY) / Math.max(0.00001, maxY - minY) * plot.height;
  const palette = [theme.primary, theme.secondary, theme.warning, theme.critical];
  return (
    <g id="body" data-semantic-role="data">
      {[0, 0.25, 0.5, 0.75, 1].map((value) => <g key={value}><line x1={plot.x} x2={plot.x + plot.width} y1={plot.y + plot.height * value} y2={plot.y + plot.height * value} stroke={theme.line} strokeWidth="1" /><text x={plot.x - props.scene.metrics.unit} y={plot.y + plot.height * value + 5} textAnchor="end" fill={theme.mutedInk} fontFamily={theme.fontMono} fontSize={props.scene.metrics.smallSize * 0.7}>{(maxY - (maxY - minY) * value).toFixed(0)}</text></g>)}
      <line x1={plot.x} x2={plot.x} y1={plot.y} y2={plot.y + plot.height} stroke={theme.ink} strokeWidth="2" />
      <line x1={plot.x} x2={plot.x + plot.width} y1={plot.y + plot.height} y2={plot.y + plot.height} stroke={theme.ink} strokeWidth="2" />
      {series.map((entry, seriesIndex) => {
        const points = entry.values.map((point) => `${scaleX(point.x)},${scaleY(point.y)}`).join(" ");
        const color = entry.color ?? palette[seriesIndex % palette.length] ?? theme.primary;
        const area = `${scaleX(entry.values[0]?.x ?? 0)},${plot.y + plot.height} ${points} ${scaleX(entry.values[entry.values.length - 1]?.x ?? 1)},${plot.y + plot.height}`;
        return <g key={entry.id}>{fillArea ? <polygon points={area} fill={color} opacity="0.14" /> : null}<polyline points={points} fill="none" stroke={color} strokeWidth={Math.max(3, props.scene.metrics.unit * 0.36)} strokeLinecap="round" strokeLinejoin="round" />{entry.values.map((point, pointIndex) => <circle key={pointIndex} cx={scaleX(point.x)} cy={scaleY(point.y)} r={props.scene.metrics.unit * 0.42} fill={theme.surface} stroke={color} strokeWidth="3" />)}<Pill x={plot.x + seriesIndex * props.scene.metrics.bodySize * 6.5} y={body.y + body.height - props.scene.metrics.smallSize * 1.55} label={entry.label} tone={seriesIndex % 2 ? "secondary" : "primary"} theme={theme} fontSize={props.scene.metrics.smallSize * 0.72} /></g>;
      })}
      {xLabel ? <text x={plot.x + plot.width / 2} y={body.y + body.height} textAnchor="middle" fill={theme.mutedInk} fontFamily={theme.fontBody} fontSize={props.scene.metrics.smallSize}>{xLabel}</text> : null}
      {yLabel ? <text x={body.x} y={plot.y + plot.height / 2} textAnchor="middle" transform={`rotate(-90 ${body.x} ${plot.y + plot.height / 2})`} fill={theme.mutedInk} fontFamily={theme.fontBody} fontSize={props.scene.metrics.smallSize}>{yLabel}</text> : null}
    </g>
  );
}

export function CodeRenderer(props: SceneRendererProps<CodeContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const content = props.scene.spec.content;
  const lines = content.lines.slice(0, props.scene.metrics.profile === "portrait" ? 15 : 18);
  const headerHeight = props.scene.metrics.bodySize * 2.1;
  const lineHeight = Math.min(props.scene.metrics.bodySize * 1.5, (body.height - headerHeight - props.scene.metrics.unit * 2) / Math.max(1, lines.length));
  return withFrame(props, (
    <g id="body" data-semantic-role="code">
      <rect {...body} rx={theme.radius} fill={theme.codeBackground} />
      <rect x={body.x} y={body.y} width={body.width} height={headerHeight} rx={theme.radius} fill="#23273A" />
      <rect x={body.x} y={body.y + headerHeight - theme.radius} width={body.width} height={theme.radius} fill="#23273A" />
      {[theme.critical, theme.warning, theme.secondary].map((color, index) => <circle key={color} cx={body.x + props.scene.metrics.bodySize * (1 + index * 0.9)} cy={body.y + headerHeight / 2} r={props.scene.metrics.bodySize * 0.25} fill={color} />)}
      <text x={body.x + props.scene.metrics.bodySize * 4.2} y={body.y + headerHeight * 0.64} fill="#B9BED0" fontFamily={theme.fontMono} fontSize={props.scene.metrics.smallSize}>{content.filename ?? content.language ?? (content.kind === "terminal" ? "Terminal" : "Code")}</text>
      {content.step !== undefined && content.totalSteps ? <ProgressDots x={body.x + body.width - content.totalSteps * 18 - props.scene.metrics.gutter} y={body.y + headerHeight / 2} count={content.totalSteps} active={Math.max(0, content.step - 1)} theme={theme} /> : null}
      {lines.map((line, index) => {
        const y = body.y + headerHeight + lineHeight * (index + 0.78);
        const color = line.tokenClass === "keyword" ? "#B7A5FF" : line.tokenClass === "string" ? "#9DE2C7" : line.tokenClass === "number" ? "#F4C56A" : line.tokenClass === "comment" ? "#798097" : line.tokenClass === "function" ? "#82C6F2" : theme.codeInk;
        const diffTone = content.kind === "diff" ? (line.text.startsWith("+") ? theme.secondary : line.text.startsWith("-") ? theme.critical : undefined) : undefined;
        return <g key={line.id} id={line.id} style={animationStyle(props.scene.choreography, line.id, props.frame.tick, props.frame.reducedMotion) as CSSProperties}>{line.highlight || diffTone ? <rect x={body.x + props.scene.metrics.bodySize * 0.2} y={y - lineHeight * 0.72} width={body.width - props.scene.metrics.bodySize * 0.4} height={lineHeight} fill={diffTone ?? theme.primary} opacity="0.17" /> : null}<text x={body.x + props.scene.metrics.bodySize * 0.85} y={y} textAnchor="end" fill="#61687D" fontFamily={theme.fontMono} fontSize={props.scene.metrics.smallSize * 0.9}>{index + 1}</text><text x={body.x + props.scene.metrics.bodySize * 1.7} y={y} fill={color} fontFamily={theme.fontMono} fontSize={props.scene.metrics.smallSize * 0.95} xmlSpace="preserve">{truncate(line.text.replace(/\t/g, "  "), props.scene.metrics.profile === "portrait" ? 52 : 92)}</text>{line.annotation ? <text x={body.x + body.width - props.scene.metrics.gutter} y={y} textAnchor="end" fill="#F4C56A" fontFamily={theme.fontBody} fontSize={props.scene.metrics.smallSize * 0.75}>{truncate(line.annotation, 28)}</text> : null}</g>;
      })}
    </g>
  ));
}

export function FileTreeRenderer(props: SceneRendererProps<FileTreeContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const entries = props.scene.spec.content.entries.slice(0, 18);
  const row = body.height / Math.max(entries.length, 1);
  return withFrame(props, (
    <g id="body" data-semantic-role="code">
      <Card rect={body} theme={theme}>
        {entries.map((entry, index) => { const depth = entry.path.split("/").length - 1; const name = entry.path.split("/").pop() ?? entry.path; const y = body.y + row * (index + 0.68); return <g key={entry.id} id={entry.id}><line x1={body.x + props.scene.metrics.gutter + depth * props.scene.metrics.bodySize} x2={body.x + props.scene.metrics.gutter + depth * props.scene.metrics.bodySize} y1={y - row * 0.8} y2={y + row * 0.25} stroke={theme.line} strokeWidth="2" /><rect x={body.x + props.scene.metrics.gutter + depth * props.scene.metrics.bodySize + 4} y={y - props.scene.metrics.smallSize * 0.72} width={props.scene.metrics.smallSize * 0.95} height={props.scene.metrics.smallSize * 0.78} rx="3" fill={entry.type === "folder" ? theme.accent : theme.surfaceRaised} stroke={entry.type === "folder" ? theme.warning : theme.mutedInk} /><text x={body.x + props.scene.metrics.gutter + (depth + 1.25) * props.scene.metrics.bodySize} y={y} fill={entry.emphasis ? theme.primary : theme.ink} fontFamily={theme.fontMono} fontWeight={entry.emphasis ? "800" : "500"} fontSize={props.scene.metrics.smallSize}>{name}</text></g>; })}
      </Card>
    </g>
  ));
}

export function TraceRenderer(props: SceneRendererProps<TraceContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const content = props.scene.spec.content;
  const body = bodyRect(props);
  const frames = content.frames.slice(0, 6);
  const active = clamp(content.activeFrame ?? 0, 0, Math.max(0, frames.length - 1));
  const rows = stackRows(body, frames.length, props.scene.metrics.unit);
  return withFrame(props, (
    <g id="body" data-semantic-role="code">
      {frames.map((trace, index) => { const rect = rows[index]; if (!rect) return null; const isActive = index === active; return <Card key={trace.id} rect={rect} theme={theme} tone={isActive ? "primary" : "neutral"}><text x={rect.x + props.scene.metrics.gutter} y={rect.y + rect.height * 0.6} fill={isActive ? theme.primary : theme.mutedInk} fontFamily={theme.fontMono} fontWeight="800" fontSize={props.scene.metrics.smallSize}>L{trace.line}</text><text x={rect.x + props.scene.metrics.gutter * 3} y={rect.y + rect.height * 0.6} fill={theme.ink} fontFamily={theme.fontBody} fontWeight={isActive ? "750" : "550"} fontSize={props.scene.metrics.bodySize}>{trace.label}</text><text x={rect.x + rect.width - props.scene.metrics.gutter} y={rect.y + rect.height * 0.6} textAnchor="end" fill={theme.secondary} fontFamily={theme.fontMono} fontSize={props.scene.metrics.smallSize}>{Object.entries(trace.variables).slice(0, 4).map(([key, value]) => `${key}=${value}`).join("  ·  ")}</text></Card>; })}
    </g>
  ));
}

export function VariableStateRenderer(props: SceneRendererProps<VariableStateContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const content = props.scene.spec.content;
  const body = bodyRect(props);
  const [before, after] = props.scene.metrics.columns === 2 ? splitColumns(body, props.scene.metrics.gutter) : stackRows(body, 2, props.scene.metrics.gutter) as readonly [Rect, Rect];
  const renderState = (rect: Rect, title: string, values: Readonly<Record<string, string>>, tone: "primary" | "secondary") => <Card rect={rect} theme={theme} tone={tone}><Pill x={rect.x + props.scene.metrics.gutter} y={rect.y + props.scene.metrics.gutter} label={title} tone={tone} theme={theme} />{Object.entries(values).slice(0, 8).map(([key, value], index) => <g key={key}><text x={rect.x + props.scene.metrics.gutter} y={rect.y + props.scene.metrics.gutter * 3 + index * props.scene.metrics.bodySize * 1.6} fill={theme.mutedInk} fontFamily={theme.fontMono} fontSize={props.scene.metrics.smallSize}>{key}</text><text x={rect.x + rect.width - props.scene.metrics.gutter} y={rect.y + props.scene.metrics.gutter * 3 + index * props.scene.metrics.bodySize * 1.6} textAnchor="end" fill={theme.ink} fontFamily={theme.fontMono} fontWeight="750" fontSize={props.scene.metrics.bodySize}>{value}</text></g>)}</Card>;
  return withFrame(props, <g id="body">{renderState(before, "BEFORE", content.before, "primary")}{renderState(after, "AFTER", content.after, "secondary")}{content.operation ? <Pill x={body.x + body.width * 0.36} y={body.y + body.height * 0.46} label={content.operation} tone="warning" theme={theme} /> : null}</g>);
}

export function ChartRenderer(props: SceneRendererProps<ChartContent>) {
  const content = props.scene.spec.content;
  if (content.chartType === "line" || content.chartType === "area") return withFrame(props, <Plot sceneProps={props} series={content.series} xLabel={content.xLabel} yLabel={content.yLabel} fillArea={content.chartType === "area"} />);
  const theme = props.theme ?? PRECISION_THEME;
  const body = insetRect(bodyRect(props), props.scene.metrics.gutter * 0.8);
  const values = content.series.flatMap((series) => series.values.map((point) => ({ ...point, series: series.label, color: series.color })));
  const max = Math.max(...values.map((value) => value.y), 1);
  const band = body.width / Math.max(1, values.length);
  const palette = [theme.primary, theme.secondary, theme.warning, theme.critical];
  return withFrame(props, (
    <g id="body" data-semantic-role="data">
      <line x1={body.x} x2={body.x} y1={body.y} y2={body.y + body.height} stroke={theme.ink} strokeWidth="2" />
      <line x1={body.x} x2={body.x + body.width} y1={body.y + body.height} y2={body.y + body.height} stroke={theme.ink} strokeWidth="2" />
      {values.map((value, index) => { const height = value.y / max * body.height * 0.82; const color = value.color ?? palette[index % palette.length] ?? theme.primary; const x = body.x + index * band + band * 0.18; return <g key={`${value.series}-${index}`}><rect x={x} y={body.y + body.height - height} width={band * 0.64} height={height} rx={content.chartType === "dot" ? band * 0.32 : props.scene.metrics.unit * 0.5} fill={color} opacity={content.chartType === "dot" ? 0.85 : 0.9} /><text x={x + band * 0.32} y={body.y + body.height - height - props.scene.metrics.unit} textAnchor="middle" fill={theme.ink} fontFamily={theme.fontMono} fontSize={props.scene.metrics.smallSize}>{value.y}</text><text x={x + band * 0.32} y={body.y + body.height + props.scene.metrics.smallSize * 1.3} textAnchor="middle" fill={theme.mutedInk} fontFamily={theme.fontBody} fontSize={props.scene.metrics.smallSize * 0.75}>{value.label ?? value.x}</text></g>; })}
    </g>
  ));
}

export function TableRenderer(props: SceneRendererProps<TableContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const content = props.scene.spec.content;
  const columns = content.columns.slice(0, 7);
  const rows = content.rows.slice(0, 9);
  const rowHeight = body.height / Math.max(2, rows.length + 1);
  const columnWidth = body.width / Math.max(1, columns.length);
  return withFrame(props, (
    <g id="body" data-semantic-role="data">
      <rect {...body} rx={theme.radius} fill={theme.surface} stroke={theme.line} strokeWidth="2" />
      <path d={`M ${body.x} ${body.y + theme.radius} Q ${body.x} ${body.y} ${body.x + theme.radius} ${body.y} H ${body.x + body.width - theme.radius} Q ${body.x + body.width} ${body.y} ${body.x + body.width} ${body.y + theme.radius} V ${body.y + rowHeight} H ${body.x} Z`} fill={theme.primary} />
      {columns.map((column, index) => <text key={column.id} x={body.x + index * columnWidth + (column.align === "right" ? columnWidth - props.scene.metrics.unit : column.align === "center" ? columnWidth / 2 : props.scene.metrics.unit)} y={body.y + rowHeight * 0.64} textAnchor={column.align === "right" ? "end" : column.align === "center" ? "middle" : "start"} fill={theme.surface} fontFamily={theme.fontBody} fontWeight="750" fontSize={props.scene.metrics.smallSize}>{truncate(column.label, 18)}</text>)}
      {rows.map((row, rowIndex) => <g key={row.id}>{row.emphasis ? <rect x={body.x} y={body.y + rowHeight * (rowIndex + 1)} width={body.width} height={rowHeight} fill={theme.secondary} opacity="0.1" /> : null}<line x1={body.x} x2={body.x + body.width} y1={body.y + rowHeight * (rowIndex + 1)} y2={body.y + rowHeight * (rowIndex + 1)} stroke={theme.line} />{columns.map((column, columnIndex) => { const text = row.cells[columnIndex] ?? "—"; return <text key={column.id} x={body.x + columnIndex * columnWidth + (column.align === "right" ? columnWidth - props.scene.metrics.unit : column.align === "center" ? columnWidth / 2 : props.scene.metrics.unit)} y={body.y + rowHeight * (rowIndex + 1.66)} textAnchor={column.align === "right" ? "end" : column.align === "center" ? "middle" : "start"} fill={row.emphasis ? theme.secondary : theme.ink} fontFamily={columnIndex === 0 ? theme.fontBody : theme.fontMono} fontWeight={row.emphasis || columnIndex === 0 ? "700" : "500"} fontSize={props.scene.metrics.smallSize}>{truncate(text, 22)}</text>; })}</g>)}
    </g>
  ));
}

export function MapRenderer(props: SceneRendererProps<MapContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const content = props.scene.spec.content;
  const regions = content.regions?.slice(0, 16) ?? [];
  const points = content.points?.slice(0, 12) ?? [];
  return withFrame(props, (
    <g id="body" data-semantic-role="visual">
      <Card rect={body} theme={theme}>
        <g transform={`translate(${body.x} ${body.y}) scale(${body.width / 1000} ${body.height / 600})`}>
          {regions.length ? regions.map((region, index) => <path key={region.id} d={region.path} fill={index % 2 ? "#CFE6E3" : "#D9DAFA"} stroke={theme.surface} strokeWidth="4" />) : <DefaultMap theme={theme} />}
        </g>
        {points.map((point, index) => { const x = body.x + clamp(point.x, 0, 1) * body.width; const y = body.y + clamp(point.y, 0, 1) * body.height; return <g key={point.id}><circle cx={x} cy={y} r={props.scene.metrics.unit * 0.85} fill={index % 2 ? theme.secondary : theme.primary} stroke={theme.surface} strokeWidth="4" /><rect x={x + props.scene.metrics.unit} y={y - props.scene.metrics.bodySize * 1.2} width={Math.min(240, body.width * 0.28)} height={props.scene.metrics.bodySize * 2.1} rx={props.scene.metrics.unit * 0.5} fill={theme.surface} stroke={theme.line} /><text x={x + props.scene.metrics.unit * 2} y={y + props.scene.metrics.smallSize * 0.1} fill={theme.ink} fontFamily={theme.fontBody} fontWeight="700" fontSize={props.scene.metrics.smallSize}>{truncate(point.label, 24)}</text></g>; })}
      </Card>
    </g>
  ));
}

function DefaultMap({ theme }: { readonly theme: typeof PRECISION_THEME }) {
  return <g><path d="M92 196l93-78 101 19 49 70 74-7 42-94 97 30 34 68 129-11 85 74-45 66-108 1-66 67-104-29-80 61-96-58-87-5-71-82z" fill="#D9DAFA" stroke={theme.surface} strokeWidth="8" /><path d="M511 125l41-58 108 23 51 54-65 34-89-10zM680 366l70-24 101 60-31 82-91-26z" fill="#CFE6E3" stroke={theme.surface} strokeWidth="8" /></g>;
}

export function ImageFocusRenderer(props: SceneRendererProps<ImageFocusContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const content = props.scene.spec.content;
  const mediaRect = content.citation ? { x: body.x, y: body.y, width: body.width, height: body.height * 0.86 } : body;
  return withFrame(props, (
    <g id="body" data-semantic-role="visual">
      <AssetFrame asset={content.asset} rect={mediaRect} resolveAsset={props.resolveAsset} theme={theme} />
      {content.callouts?.slice(0, 6).map((callout, index) => { const x = mediaRect.x + callout.x * mediaRect.width; const y = mediaRect.y + callout.y * mediaRect.height; return <g key={callout.id}><circle cx={x} cy={y} r={props.scene.metrics.unit * 0.72} fill={index % 2 ? theme.secondary : theme.primary} stroke={theme.surface} strokeWidth="4" /><line x1={x} y1={y} x2={x + props.scene.metrics.gutter * 1.8} y2={y - props.scene.metrics.gutter * 1.2} stroke={theme.ink} strokeWidth="2" /><Pill x={x + props.scene.metrics.gutter * 1.6} y={y - props.scene.metrics.gutter * 1.8} label={truncate(callout.label, 28)} tone={index % 2 ? "secondary" : "primary"} theme={theme} fontSize={props.scene.metrics.smallSize * 0.8} /></g>; })}
      {content.citation ? <text x={body.x} y={body.y + body.height - props.scene.metrics.smallSize * 0.25} fill={theme.mutedInk} fontFamily={theme.fontBody} fontSize={props.scene.metrics.smallSize * 0.76}>{truncate(content.citation, 110)}</text> : null}
    </g>
  ));
}

export function ImageComparisonRenderer(props: SceneRendererProps<ImageComparisonContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const [left, right] = props.scene.metrics.columns === 2 ? splitColumns(body, props.scene.metrics.gutter) : stackRows(body, 2, props.scene.metrics.gutter) as readonly [Rect, Rect];
  return withFrame(props, <g id="body"><AssetFrame asset={props.scene.spec.content.left} rect={left} resolveAsset={props.resolveAsset} theme={theme} label={props.scene.spec.content.leftLabel} /><AssetFrame asset={props.scene.spec.content.right} rect={right} resolveAsset={props.resolveAsset} theme={theme} label={props.scene.spec.content.rightLabel} /><Pill x={body.x + body.width / 2 - props.scene.metrics.bodySize * 2.5} y={body.y + body.height / 2 - props.scene.metrics.bodySize} label="COMPARE" tone="warning" theme={theme} /></g>);
}

export function UiDemoRenderer(props: SceneRendererProps<UiDemoContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const content = props.scene.spec.content;
  const [windowRect, stepsRect] = props.scene.metrics.columns === 2 ? splitColumns(body, props.scene.metrics.gutter, 0.68) : stackRows(body, 2, props.scene.metrics.gutter) as readonly [Rect, Rect];
  const active = clamp(content.activeStep ?? 0, 0, Math.max(0, content.steps.length - 1));
  return withFrame(props, (
    <g id="body" data-semantic-role="visual">
      <rect {...windowRect} rx={theme.radius} fill={theme.surface} stroke={theme.line} strokeWidth="2" />
      <rect x={windowRect.x} y={windowRect.y} width={windowRect.width} height={props.scene.metrics.bodySize * 2.1} rx={theme.radius} fill={theme.surfaceRaised} />
      <rect x={windowRect.x} y={windowRect.y + props.scene.metrics.bodySize * 1.3} width={windowRect.width} height={props.scene.metrics.bodySize} fill={theme.surfaceRaised} />
      {[theme.critical, theme.warning, theme.secondary].map((color, index) => <circle key={color} cx={windowRect.x + props.scene.metrics.bodySize * (1 + index * 0.85)} cy={windowRect.y + props.scene.metrics.bodySize} r={props.scene.metrics.bodySize * 0.22} fill={color} />)}
      <text x={windowRect.x + windowRect.width / 2} y={windowRect.y + props.scene.metrics.bodySize * 1.25} textAnchor="middle" fill={theme.mutedInk} fontFamily={theme.fontBody} fontSize={props.scene.metrics.smallSize}>{content.windowTitle ?? "Application"}</text>
      <MockInterface rect={{ x: windowRect.x + props.scene.metrics.gutter, y: windowRect.y + props.scene.metrics.bodySize * 3, width: windowRect.width - props.scene.metrics.gutter * 2, height: windowRect.height - props.scene.metrics.bodySize * 4 }} theme={theme} active={active} />
      <Card rect={stepsRect} theme={theme} tone="primary"><BulletList items={content.steps} rect={insetRect(stepsRect, props.scene.metrics.gutter * 0.7)} scene={props.scene} frame={props.frame} theme={theme} ordered /></Card>
    </g>
  ));
}

function MockInterface({ rect, theme, active }: { readonly rect: Rect; readonly theme: typeof PRECISION_THEME; readonly active: number }) {
  return <g aria-hidden="true"><rect {...rect} rx="10" fill={theme.paper} /><rect x={rect.x} y={rect.y} width={rect.width * 0.22} height={rect.height} rx="10" fill={theme.codeBackground} /><rect x={rect.x + rect.width * 0.27} y={rect.y + rect.height * 0.1} width={rect.width * 0.66} height={rect.height * 0.14} rx="8" fill={theme.surfaceRaised} />{[0, 1, 2].map((index) => <rect key={index} x={rect.x + rect.width * 0.27} y={rect.y + rect.height * (0.33 + index * 0.19)} width={rect.width * (0.56 - index * 0.05)} height={rect.height * 0.1} rx="7" fill={index === active % 3 ? theme.primary : theme.line} opacity={index === active % 3 ? 0.82 : 1} />)}{[0, 1, 2, 3].map((index) => <rect key={index} x={rect.x + rect.width * 0.04} y={rect.y + rect.height * (0.12 + index * 0.16)} width={rect.width * 0.14} height={rect.height * 0.055} rx="5" fill={index === active % 4 ? theme.secondary : "#4D5367"} />)}</g>;
}

export function SimulationRenderer(props: SceneRendererProps<SimulationContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const content = props.scene.spec.content;
  const [controls, visual] = props.scene.metrics.columns === 2 ? splitColumns(body, props.scene.metrics.gutter, 0.36) : stackRows(body, 2, props.scene.metrics.gutter) as readonly [Rect, Rect];
  return withFrame(props, <g id="body"><Card rect={controls} theme={theme} tone="primary"><Pill x={controls.x + props.scene.metrics.gutter} y={controls.y + props.scene.metrics.gutter} label="PARAMETERS" theme={theme} />{content.variables.slice(0, 5).map((variable, index) => { const y = controls.y + props.scene.metrics.gutter * 3.3 + index * props.scene.metrics.bodySize * 2.8; const progress = clamp((variable.value - variable.min) / Math.max(0.0001, variable.max - variable.min), 0, 1); return <g key={variable.id}><text x={controls.x + props.scene.metrics.gutter} y={y} fill={theme.ink} fontFamily={theme.fontBody} fontWeight="650" fontSize={props.scene.metrics.smallSize}>{variable.label}</text><text x={controls.x + controls.width - props.scene.metrics.gutter} y={y} textAnchor="end" fill={theme.primary} fontFamily={theme.fontMono} fontWeight="750" fontSize={props.scene.metrics.smallSize}>{variable.value}{variable.unit ?? ""}</text><line x1={controls.x + props.scene.metrics.gutter} x2={controls.x + controls.width - props.scene.metrics.gutter} y1={y + props.scene.metrics.bodySize} y2={y + props.scene.metrics.bodySize} stroke={theme.line} strokeWidth={props.scene.metrics.unit * 0.55} strokeLinecap="round" /><circle cx={controls.x + props.scene.metrics.gutter + (controls.width - props.scene.metrics.gutter * 2) * progress} cy={y + props.scene.metrics.bodySize} r={props.scene.metrics.unit * 0.75} fill={theme.primary} stroke={theme.surface} strokeWidth="3" /></g>; })}</Card><Card rect={visual} theme={theme} tone="secondary"><WrappedText text={content.observation} rect={{ x: visual.x + props.scene.metrics.gutter, y: visual.y + visual.height * 0.12, width: visual.width - props.scene.metrics.gutter * 2, height: visual.height * 0.2 }} theme={theme} fontSize={props.scene.metrics.subtitleSize} fontWeight="700" textAnchor="middle" maxLines={3} /><SimulationOrbit rect={{ x: visual.x + visual.width * 0.12, y: visual.y + visual.height * 0.36, width: visual.width * 0.76, height: visual.height * 0.5 }} theme={theme} tick={props.frame.tick} reducedMotion={props.frame.reducedMotion} /></Card></g>);
}

function SimulationOrbit({ rect, theme, tick, reducedMotion }: { readonly rect: Rect; readonly theme: typeof PRECISION_THEME; readonly tick: number; readonly reducedMotion: boolean }) {
  const phase = reducedMotion ? 0.34 : (tick % 1_440_000) / 1_440_000;
  const cx = rect.x + rect.width / 2; const cy = rect.y + rect.height / 2;
  return <g aria-hidden="true"><ellipse cx={cx} cy={cy} rx={rect.width * 0.44} ry={rect.height * 0.3} fill="none" stroke={theme.line} strokeWidth="3" strokeDasharray="10 8" /><circle cx={cx} cy={cy} r={Math.min(rect.width, rect.height) * 0.13} fill={theme.accent} /><circle cx={cx + Math.cos(phase * Math.PI * 2) * rect.width * 0.44} cy={cy + Math.sin(phase * Math.PI * 2) * rect.height * 0.3} r={Math.min(rect.width, rect.height) * 0.07} fill={theme.primary} /><path d={`M ${cx - rect.width * 0.34} ${cy + rect.height * 0.34} Q ${cx} ${cy - rect.height * 0.46} ${cx + rect.width * 0.34} ${cy + rect.height * 0.34}`} fill="none" stroke={theme.secondary} strokeWidth="5" strokeLinecap="round" /></g>;
}

export function PresenterRenderer(props: SceneRendererProps<PresenterContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const content = props.scene.spec.content;
  const body = bodyRect(props);
  const withSlide = content.kind === "presenter-slide";
  const placement = content.placement ?? (withSlide ? "split-left" : "full");
  const split = props.scene.metrics.columns === 2
    ? splitColumns(body, props.scene.metrics.gutter, 0.39)
    : stackRows(body, 2, props.scene.metrics.gutter) as readonly [Rect, Rect];
  const presenterPanel = placement === "split-right" ? split[1] : split[0];
  const slideRect = !withSlide || placement === "full"
    ? undefined
    : placement === "picture-in-picture"
      // A PIP must reserve a real text panel rather than simply float above
      // the slide. Otherwise long bullets run underneath the portrait/video,
      // exactly where learners need to read them.
      ? {
          x: body.x,
          y: body.y,
          width: body.width * 0.62,
          height: body.height,
        }
      : placement === "split-right" ? split[0] : split[1];
  const portraitRect: Rect = placement === "full"
    ? body
    : placement === "picture-in-picture"
      ? {
          x: body.x + body.width * 0.68,
          y: body.y + body.height * 0.22,
          width: body.width * 0.3,
          height: body.height * 0.58,
        }
      : withSlide
        ? insetRect(presenterPanel, props.scene.metrics.gutter * 0.5)
        : { x: body.x + body.width * 0.22, y: body.y, width: body.width * 0.56, height: body.height * 0.75 };
  const nameplateHeight = Math.max(props.scene.metrics.bodySize * 1.9, portraitRect.height * 0.13);
  const nameplateY = portraitRect.y + portraitRect.height - nameplateHeight;
  return withFrame(props, (
    <g id="body" data-semantic-role="presenter">
      {withSlide && slideRect ? <Card rect={slideRect} theme={theme} tone="primary"><BulletList items={content.slideItems ?? []} rect={insetRect(slideRect, props.scene.metrics.gutter)} scene={props.scene} frame={props.frame} theme={theme} maxLinesPerItem={placement === "picture-in-picture" ? 3 : 2} /></Card> : null}
      <AssetFrame asset={content.portrait ?? { id: "presenter-placeholder", alt: content.presenterName ?? "Presenter portrait", fit: "cover" }} rect={portraitRect} resolveAsset={props.resolveAsset} theme={theme} label="" />
      <rect x={portraitRect.x} y={nameplateY} width={portraitRect.width} height={nameplateHeight} rx={theme.radius} fill={theme.codeBackground} opacity="0.92" />
      <text x={portraitRect.x + props.scene.metrics.gutter * 0.8} y={nameplateY + nameplateHeight * 0.62} fill={theme.surface} fontFamily={theme.fontBody} fontWeight="750" fontSize={props.scene.metrics.bodySize * 0.82}>{content.presenterName ?? "Presenter"}</text>
      {/* Presenter-slide scenes already devote the adjacent card to the idea.
          Keeping a second talking point in the portrait lower-third caused
          competing text layers over the face/nameplate. */}
      {!withSlide && content.talkingPoint ? <WrappedText text={content.talkingPoint} rect={{ x: body.x + body.width * 0.12, y: body.y + body.height * 0.81, width: body.width * 0.76, height: body.height * 0.16 }} theme={theme} fill={theme.ink} fontSize={props.scene.metrics.subtitleSize} fontWeight="650" textAnchor="middle" maxLines={3} /> : null}
      {content.disclosure ? <Pill x={body.x + body.width - Math.min(300, content.disclosure.length * props.scene.metrics.smallSize * 0.55) - props.scene.metrics.gutter} y={body.y + body.height - props.scene.metrics.smallSize * 2.3} label={content.disclosure} tone="neutral" theme={theme} fontSize={props.scene.metrics.smallSize * 0.72} /> : null}
    </g>
  ));
}

export function QuoteRenderer(props: SceneRendererProps<QuoteContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const content = props.scene.spec.content;
  return withFrame(props, (
    <g id="body" data-semantic-role="content">
      <text x={body.x + body.width * 0.08} y={body.y + body.height * 0.26} fill={theme.primary} fontFamily={theme.fontDisplay} fontWeight="800" fontSize={props.scene.metrics.titleSize * 2.4}>“</text>
      <WrappedText text={content.quote} rect={{ x: body.x + body.width * 0.12, y: body.y + body.height * 0.16, width: body.width * 0.76, height: body.height * 0.56 }} theme={theme} fontFamily={theme.fontDisplay} fontSize={props.scene.metrics.titleSize * 0.78} fontWeight="650" textAnchor="middle" maxLines={props.scene.metrics.profile === "portrait" ? 7 : 5} lineHeight={1.18} />
      <line x1={body.x + body.width * 0.35} x2={body.x + body.width * 0.65} y1={body.y + body.height * 0.76} y2={body.y + body.height * 0.76} stroke={theme.secondary} strokeWidth="4" strokeLinecap="round" />
      <text x={body.x + body.width / 2} y={body.y + body.height * 0.84} textAnchor="middle" fill={theme.ink} fontFamily={theme.fontBody} fontWeight="750" fontSize={props.scene.metrics.bodySize}>{content.attribution}</text>
      {content.source ? <text x={body.x + body.width / 2} y={body.y + body.height * 0.9} textAnchor="middle" fill={theme.mutedInk} fontFamily={theme.fontBody} fontSize={props.scene.metrics.smallSize}>{content.source}</text> : null}
    </g>
  ));
}

export function QuestionRenderer(props: SceneRendererProps<QuestionContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const content = props.scene.spec.content;
  const seconds = content.thinkingTimeSeconds ?? 0;
  const elapsed = props.frame.tick / 240_000;
  const remaining = Math.max(0, seconds - elapsed);
  return withFrame(props, (
    <g id="body" data-semantic-role="content">
      <circle cx={body.x + body.width / 2} cy={body.y + body.height * 0.18} r={props.scene.metrics.titleSize * 0.75} fill={theme.primary} />
      <text x={body.x + body.width / 2} y={body.y + body.height * 0.18 + props.scene.metrics.titleSize * 0.36} textAnchor="middle" fill={theme.surface} fontFamily={theme.fontDisplay} fontWeight="800" fontSize={props.scene.metrics.titleSize}>?</text>
      <WrappedText text={content.question} rect={{ x: body.x + body.width * 0.08, y: body.y + body.height * 0.32, width: body.width * 0.84, height: body.height * 0.35 }} theme={theme} fontFamily={theme.fontDisplay} fontSize={props.scene.metrics.titleSize * 0.8} fontWeight="750" textAnchor="middle" maxLines={5} />
      {content.prompt ? <WrappedText text={content.prompt} rect={{ x: body.x + body.width * 0.16, y: body.y + body.height * 0.72, width: body.width * 0.68, height: body.height * 0.12 }} theme={theme} fontSize={props.scene.metrics.subtitleSize} fill={theme.mutedInk} textAnchor="middle" maxLines={2} /> : null}
      {seconds > 0 ? <Pill x={body.x + body.width / 2 - props.scene.metrics.bodySize * 3} y={body.y + body.height * 0.87} label={`THINK  ${Math.ceil(remaining)}s`} tone="secondary" theme={theme} /> : null}
    </g>
  ));
}

export function WorkedExampleRenderer(props: SceneRendererProps<WorkedExampleContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const content = props.scene.spec.content;
  // Reserve the lower band for persistent captions. The old full-height
  // answer card collided with the accessible caption overlay and left too
  // little vertical room for procedural steps at 16:9.
  const problem: Rect = { x: body.x, y: body.y, width: body.width, height: body.height * 0.20 };
  const answer: Rect = { x: body.x, y: body.y + body.height * 0.61, width: body.width, height: body.height * 0.15 };
  const steps: Rect = { x: body.x + props.scene.metrics.gutter, y: body.y + body.height * 0.25, width: body.width - props.scene.metrics.gutter * 2, height: body.height * 0.30 };
  return withFrame(props, <g id="body"><Card rect={problem} theme={theme} tone="warning"><Pill x={problem.x + props.scene.metrics.gutter} y={problem.y + props.scene.metrics.gutter} label="PROBLEM" tone="warning" theme={theme} /><WrappedText text={content.problem} rect={{ x: problem.x + problem.width * 0.22, y: problem.y + props.scene.metrics.gutter * 0.45, width: problem.width * 0.74, height: problem.height - props.scene.metrics.gutter }} theme={theme} fontSize={props.scene.metrics.bodySize * 0.92} fontWeight="650" maxLines={2} /></Card><BulletList items={content.steps.slice(0, 4)} rect={steps} scene={props.scene} frame={props.frame} theme={theme} ordered /><Card rect={answer} theme={theme} tone="secondary"><Pill x={answer.x + props.scene.metrics.gutter} y={answer.y + props.scene.metrics.gutter * 0.55} label="ANSWER" tone="secondary" theme={theme} fontSize={props.scene.metrics.smallSize * 0.82} /><WrappedText text={content.answer} rect={{ x: answer.x + answer.width * 0.22, y: answer.y + props.scene.metrics.gutter * 0.25, width: answer.width * 0.74, height: answer.height - props.scene.metrics.gutter * 0.4 }} theme={theme} fontSize={props.scene.metrics.bodySize * 0.9} fontWeight="750" maxLines={2} /></Card></g>);
}

export function QuizRenderer(props: SceneRendererProps<QuizContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const content = props.scene.spec.content;
  const options = content.options.slice(0, 6);
  const optionArea: Rect = { x: body.x + body.width * 0.08, y: body.y + body.height * 0.34, width: body.width * 0.84, height: body.height * (content.explanation ? 0.46 : 0.58) };
  const rows = stackRows(optionArea, options.length, props.scene.metrics.unit);
  return withFrame(props, (
    <g id="body" data-semantic-role="content">
      <WrappedText text={content.question} rect={{ x: body.x + body.width * 0.07, y: body.y + body.height * 0.05, width: body.width * 0.86, height: body.height * 0.24 }} theme={theme} fontSize={props.scene.metrics.titleSize * 0.64} fontFamily={theme.fontDisplay} fontWeight="750" textAnchor="middle" maxLines={3} />
      {options.map((option, index) => { const rect = rows[index]; if (!rect) return null; const reveal = content.revealAnswer && option.correct; return <Card key={option.id} id={option.id} rect={rect} theme={theme} tone={reveal ? "secondary" : "neutral"}><circle cx={rect.x + props.scene.metrics.bodySize * 1.5} cy={rect.y + rect.height / 2} r={props.scene.metrics.bodySize * 0.7} fill={reveal ? theme.secondary : theme.surfaceRaised} /><text x={rect.x + props.scene.metrics.bodySize * 1.5} y={rect.y + rect.height / 2 + props.scene.metrics.smallSize * 0.36} textAnchor="middle" fill={reveal ? theme.surface : theme.primary} fontFamily={theme.fontMono} fontWeight="800" fontSize={props.scene.metrics.smallSize}>{String.fromCharCode(65 + index)}</text><text x={rect.x + props.scene.metrics.bodySize * 3} y={rect.y + rect.height / 2 + props.scene.metrics.smallSize * 0.36} fill={theme.ink} fontFamily={theme.fontBody} fontWeight={reveal ? "750" : "550"} fontSize={props.scene.metrics.bodySize}>{truncate(option.label, 72)}</text></Card>; })}
      {content.revealAnswer && content.explanation ? <WrappedText text={content.explanation} rect={{ x: body.x + body.width * 0.12, y: body.y + body.height * 0.84, width: body.width * 0.76, height: body.height * 0.14 }} theme={theme} fontSize={props.scene.metrics.smallSize} fill={theme.secondary} fontWeight="650" textAnchor="middle" maxLines={2} /> : null}
    </g>
  ));
}

export function SourcesRenderer(props: SceneRendererProps<SourcesContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const sources = props.scene.spec.content.sources.slice(0, props.scene.metrics.profile === "portrait" ? 8 : 10);
  const rows = stackRows(body, sources.length, props.scene.metrics.unit * 0.6);
  return withFrame(props, (
    <g id="body" data-semantic-role="source">
      {sources.map((source, index) => { const rect = rows[index]; if (!rect) return null; return <g key={source.id}><circle cx={rect.x + props.scene.metrics.smallSize} cy={rect.y + rect.height / 2} r={props.scene.metrics.smallSize * 0.65} fill={index % 2 ? theme.secondary : theme.primary} /><text x={rect.x + props.scene.metrics.smallSize} y={rect.y + rect.height / 2 + props.scene.metrics.smallSize * 0.32} textAnchor="middle" fill={theme.surface} fontFamily={theme.fontMono} fontWeight="800" fontSize={props.scene.metrics.smallSize * 0.7}>{source.marker ?? index + 1}</text><text x={rect.x + props.scene.metrics.bodySize * 2.1} y={rect.y + rect.height * 0.43} fill={theme.ink} fontFamily={theme.fontBody} fontWeight="700" fontSize={props.scene.metrics.smallSize}>{truncate(source.title, 82)}</text><text x={rect.x + props.scene.metrics.bodySize * 2.1} y={rect.y + rect.height * 0.78} fill={theme.mutedInk} fontFamily={theme.fontBody} fontSize={props.scene.metrics.smallSize * 0.72}>{truncate([source.creator, source.license, source.locator].filter(Boolean).join(" · "), 105)}</text></g>; })}
    </g>
  ));
}

export function OutroRenderer(props: SceneRendererProps<OutroContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const content = props.scene.spec.content;
  const safe = props.scene.metrics.safe;
  return withFrame(props, (
    <g id="body">
      <circle cx={safe.x + safe.width / 2} cy={safe.y + safe.height * 0.3} r={props.scene.metrics.titleSize * 1.2} fill={theme.primary} opacity="0.12" />
      <circle cx={safe.x + safe.width / 2} cy={safe.y + safe.height * 0.3} r={props.scene.metrics.titleSize * 0.72} fill={theme.primary} />
      <path d={`M ${safe.x + safe.width / 2 - props.scene.metrics.titleSize * 0.31} ${safe.y + safe.height * 0.3} L ${safe.x + safe.width / 2 - props.scene.metrics.titleSize * 0.07} ${safe.y + safe.height * 0.3 + props.scene.metrics.titleSize * 0.25} L ${safe.x + safe.width / 2 + props.scene.metrics.titleSize * 0.38} ${safe.y + safe.height * 0.3 - props.scene.metrics.titleSize * 0.24}`} fill="none" stroke={theme.surface} strokeWidth={props.scene.metrics.unit * 0.55} strokeLinecap="round" strokeLinejoin="round" />
      <WrappedText text={content.title} rect={{ x: safe.x + safe.width * 0.1, y: safe.y + safe.height * 0.47, width: safe.width * 0.8, height: safe.height * 0.2 }} theme={theme} fontSize={props.scene.metrics.titleSize * 0.98} fontFamily={theme.fontDisplay} fontWeight="780" textAnchor="middle" maxLines={3} />
      {content.nextSteps?.length ? <g>{content.nextSteps.slice(0, 3).map((step, index) => <Pill key={step} x={safe.x + safe.width * 0.18 + index * safe.width * 0.24} y={safe.y + safe.height * 0.72} label={truncate(step, 18)} tone={index % 2 ? "secondary" : "primary"} theme={theme} fontSize={props.scene.metrics.smallSize * 0.8} />)}</g> : null}
      {content.callToAction ? <text x={safe.x + safe.width / 2} y={safe.y + safe.height * 0.9} textAnchor="middle" fill={theme.secondary} fontFamily={theme.fontBody} fontWeight="750" fontSize={props.scene.metrics.subtitleSize}>{content.callToAction}</text> : null}
    </g>
  ), { hideHeader: true });
}
