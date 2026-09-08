import type { CSSProperties, ReactNode } from "react";
import { animationStyle } from "./choreography.js";
import { clamp, insetRect, splitColumns, stackRows } from "./layout.js";
import { presenterLayoutFromBody } from "./presenter-layout.js";
import {
  AssetFrame,
  BulletList,
  Card,
  legible,
  MultilineText,
  Pill,
  PRECISION_THEME,
  ProgressDots,
  ReadabilitySurface,
  SceneCanvas,
  SceneHeader,
  safeId,
  shade,
  tint,
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
  WhiteboardContent,
  WhiteboardLabel,
  WorkedExampleContent,
  QuizContent,
} from "./types.js";

function bodyRect(props: SceneRendererProps): Rect {
  const region = props.scene.regions.find((item) => item.id === "body") ?? props.scene.metrics.safe;
  return { x: region.x, y: region.y, width: region.width, height: region.height };
}

/** Brand colors describe shapes; small copy on paper uses stronger text tones. */
function paperSecondary(theme: typeof PRECISION_THEME): string {
  return shade(theme.secondary, 0.25);
}

function paperWarning(theme: typeof PRECISION_THEME): string {
  return shade(theme.warning, 0.35);
}

function paperPrimary(theme: typeof PRECISION_THEME): string {
  return shade(theme.primary, 0.1);
}

function accentPlate(theme: typeof PRECISION_THEME, tone: "primary" | "secondary" | "warning" | "neutral"): string {
  if (tone === "secondary") return shade(theme.secondary, 0.25);
  if (tone === "warning") return shade(theme.warning, 0.35);
  if (tone === "neutral") return shade(theme.mutedInk, 0.15);
  return shade(theme.primary, 0.12);
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
  const isSquare = scene.metrics.profile === "square";
  const titleRect: Rect = isPortrait
    ? { x: safe.x, y: safe.y + safe.height * 0.13, width: safe.width, height: safe.height * 0.42 }
    : { x: safe.x, y: safe.y + safe.height * 0.18, width: safe.width * 0.61, height: safe.height * 0.5 };
  const subtitleRect: Rect = isPortrait
    ? { x: safe.x, y: safe.y + safe.height * 0.59, width: safe.width * 0.85, height: safe.height * 0.11 }
    : { x: safe.x, y: safe.y + safe.height * 0.73, width: safe.width * 0.54, height: safe.height * 0.12 };
  const stageX = isPortrait ? safe.x : safe.x + safe.width * 0.7;
  const stageY = isPortrait ? safe.y + safe.height * 0.76 : safe.y + safe.height * 0.17;
  const stageW = isPortrait ? safe.width : safe.width * 0.3;
  const stageH = isPortrait ? safe.height * 0.15 : safe.height * 0.66;
  const titleScale = content.title.length < 28
    ? (isPortrait ? 1.55 : isSquare ? 1.82 : 2.05)
    : (isPortrait ? 1.28 : isSquare ? 1.46 : 1.58);
  return (
    <SceneCanvas {...props} theme={theme}>
      <g id="body" style={style}>
        <text x={safe.x} y={safe.y + legible(scene.metrics.smallSize)} fill={theme.primary} fontFamily={theme.fontMono} fontSize={legible(scene.metrics.smallSize)} fontWeight="760" letterSpacing={2.6}>{truncate((content.eyebrow ?? "NEW TUTORIAL").toUpperCase(), 42)}</text>
        <WrappedText text={content.title} rect={titleRect} theme={theme} fontSize={scene.metrics.titleSize * titleScale} fontFamily={theme.fontDisplay} fontWeight="780" maxLines={isPortrait ? 4 : 3} lineHeight={0.94} />
        {content.subtitle ? <WrappedText text={content.subtitle} rect={subtitleRect} theme={theme} fontSize={scene.metrics.subtitleSize} fill={theme.mutedInk} maxLines={2} /> : null}
        <g aria-hidden="true">
          <path d={`M ${stageX - stageW * 0.05} ${stageY} H ${stageX + stageW} V ${stageY + stageH} H ${stageX + stageW * 0.08} L ${stageX - stageW * 0.05} ${stageY + stageH * 0.86} Z`} fill={`url(#ink-field-${safeId(scene.spec.id)})`} filter={`url(#soft-shadow-${safeId(scene.spec.id)})`} />
          <path d={`M ${stageX - stageW * 0.05} ${stageY} H ${stageX + stageW} V ${stageY + stageH} H ${stageX + stageW * 0.08} L ${stageX - stageW * 0.05} ${stageY + stageH * 0.86} Z`} fill={`url(#micro-grid-${safeId(scene.spec.id)})`} opacity="0.58" />
          <circle cx={stageX + stageW * 0.52} cy={stageY + stageH * 0.5} r={Math.min(stageW, stageH) * 0.38} fill={theme.primary} opacity="0.28" />
          {[0.16, 0.34, 0.58, 0.82].map((position, index) => <g key={position}><line x1={stageX} x2={stageX + stageW * 0.92} y1={stageY + stageH * position} y2={stageY + stageH * position} stroke={index === 2 ? theme.accent : "#8B94B0"} strokeWidth={index === 2 ? scene.metrics.unit * 0.7 : scene.metrics.unit * 0.22} /><circle cx={stageX + stageW * (index % 2 ? 0.7 : 0.32)} cy={stageY + stageH * position} r={scene.metrics.unit * (index === 2 ? 1.35 : 0.82)} fill={index === 2 ? theme.accent : theme.codeBackground} stroke={index % 2 ? theme.secondary : "#9EA6C2"} strokeWidth={scene.metrics.unit * 0.32} /></g>)}
          <path d={`M ${stageX + stageW * 0.31} ${stageY + stageH * 0.16} C ${stageX + stageW * 0.72} ${stageY + stageH * 0.28}, ${stageX + stageW * 0.25} ${stageY + stageH * 0.52}, ${stageX + stageW * 0.71} ${stageY + stageH * 0.82}`} fill="none" stroke="#75CFC4" strokeWidth={scene.metrics.unit * 0.34} strokeDasharray={`${scene.metrics.unit} ${scene.metrics.unit * 0.7}`} />
        </g>
        <text x={stageX} y={stageY + stageH + legible(scene.metrics.smallSize) * 1.5} fill={theme.mutedInk} fontFamily={theme.fontMono} fontWeight="700" fontSize={legible(scene.metrics.smallSize)} letterSpacing={1.6}>{truncate((content.module ?? "LEARNING PATH").toUpperCase(), 30)}</text>
        {content.author ? <text x={safe.x + safe.width} y={safe.y + safe.height * 0.96} textAnchor="end" fill={theme.ink} fontFamily={theme.fontBody} fontWeight="650" fontSize={legible(scene.metrics.smallSize)}>{content.author}</text> : null}
      </g>
    </SceneCanvas>
  );
}

export function SectionIntroRenderer(props: SceneRendererProps<SectionIntroContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const content = props.scene.spec.content;
  const safe = props.scene.metrics.safe;
  const isPortrait = props.scene.metrics.profile === "portrait";
  const titleRect: Rect = { x: safe.x + safe.width * (isPortrait ? 0 : 0.23), y: safe.y + safe.height * 0.18, width: safe.width * (isPortrait ? 1 : 0.72), height: safe.height * 0.35 };
  const objectives = content.objectives?.slice(0, 3) ?? [];
  return withFrame(props, (
    <g id="body" style={animationStyle(props.scene.choreography, "body", props.frame.tick, props.frame.reducedMotion) as CSSProperties}>
      <text x={safe.x} y={safe.y + safe.height * 0.42} fill={theme.primary} fontFamily={theme.fontDisplay} fontWeight="800" fontSize={props.scene.metrics.titleSize * 2.9} opacity="0.14">{content.sectionNumber ?? "01"}</text>
      <text x={safe.x} y={safe.y + props.scene.metrics.smallSize} fill={theme.primary} fontFamily={theme.fontMono} fontWeight="800" fontSize={props.scene.metrics.smallSize * 0.82} letterSpacing={3}>SECTION / {content.sectionNumber ?? "—"}</text>
      <WrappedText text={content.title} rect={titleRect} theme={theme} fontSize={props.scene.metrics.titleSize * 1.2} fontFamily={theme.fontDisplay} fontWeight="780" maxLines={isPortrait ? 4 : 3} lineHeight={1.02} />
      {objectives.length ? <g>{objectives.map((objective, index) => { const x = safe.x + safe.width * (isPortrait ? 0.08 : 0.26 + index * 0.24); const y = safe.y + safe.height * (isPortrait ? 0.61 + index * 0.1 : 0.72); return <g key={objective}><line x1={x} x2={x + (isPortrait ? safe.width * 0.07 : 0)} y1={y} y2={y + (isPortrait ? 0 : safe.height * 0.06)} stroke={index % 2 ? theme.secondary : theme.primary} strokeWidth={4} /><text x={x + (isPortrait ? safe.width * 0.1 : 0)} y={y + (isPortrait ? props.scene.metrics.smallSize * 0.3 : safe.height * 0.1)} fill={theme.mutedInk} fontFamily={theme.fontBody} fontWeight="650" fontSize={props.scene.metrics.smallSize}>{truncate(objective, isPortrait ? 48 : 25)}</text></g>; })}</g> : null}
    </g>
  ), { hideHeader: true });
}

export function DefinitionRenderer(props: SceneRendererProps<DefinitionContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const content = props.scene.spec.content;
  const isWide = props.scene.metrics.columns === 2;
  if (content.placeValueRelationship) {
    const relationship = content.placeValueRelationship;
    const relationshipStage: Rect = {
      x: body.x,
      y: body.y + body.height * 0.04,
      width: body.width,
      height: body.height * 0.76,
    };
    const ruleStage: Rect = {
      x: body.x,
      y: body.y + body.height * 0.84,
      width: body.width,
      height: body.height * 0.14,
    };
    const rows = stackRows(
      { x: relationshipStage.x + props.scene.metrics.gutter * 0.6, y: relationshipStage.y + relationshipStage.height * 0.14, width: relationshipStage.width - props.scene.metrics.gutter * 1.2, height: relationshipStage.height * 0.76 },
      2,
      props.scene.metrics.gutter * 0.75,
    );
    const parseConcrete = (text: string) => {
      const equals = text.indexOf("=");
      const divider = text.indexOf("|", equals + 1);
      if (equals < 1 || divider < equals + 2) return { whole: text, high: "", low: "" };
      return {
        whole: text.slice(0, equals).trim(),
        high: text.slice(equals + 1, divider).trim(),
        low: text.slice(divider + 1).trim(),
      };
    };
    return withFrame(props, (
      <g id="body" data-semantic-role="visual" data-visual-grammar="place-value-ruler">
        <path d={`M ${relationshipStage.x} ${relationshipStage.y} H ${relationshipStage.x + relationshipStage.width} V ${relationshipStage.y + relationshipStage.height} H ${relationshipStage.x + props.scene.metrics.unit * 1.2} L ${relationshipStage.x} ${relationshipStage.y + relationshipStage.height - props.scene.metrics.unit * 1.2} Z`} fill={`url(#ink-field-${safeId(props.scene.spec.id)})`} filter={`url(#soft-shadow-${safeId(props.scene.spec.id)})`} />
        <path d={`M ${relationshipStage.x} ${relationshipStage.y} H ${relationshipStage.x + relationshipStage.width} V ${relationshipStage.y + relationshipStage.height} H ${relationshipStage.x + props.scene.metrics.unit * 1.2} L ${relationshipStage.x} ${relationshipStage.y + relationshipStage.height - props.scene.metrics.unit * 1.2} Z`} fill={`url(#micro-grid-${safeId(props.scene.spec.id)})`} opacity="0.58" />
        <text x={relationshipStage.x + props.scene.metrics.gutter * 0.7} y={relationshipStage.y + legible(props.scene.metrics.smallSize) * 1.35} fill={theme.accent} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="820" letterSpacing="2.1">PLACE-VALUE RULER · EXACT BLOCK ALIGNMENT</text>
        {rows.map((rect, index) => {
          const symbolic = relationship.symbolic[index]!;
          const concrete = parseConcrete(relationship.concrete[index]!);
          const accent = index === 0 ? theme.primary : theme.secondary;
          const rulerX = rect.x + rect.width * (isWide ? 0.46 : 0.36);
          const rulerWidth = rect.width * (isWide ? 0.44 : 0.54);
          const labelWidth = rect.width * (isWide ? 0.37 : 0.3);
          const equalsX = rulerX - props.scene.metrics.gutter * 0.7;
          const blockWidth = rulerWidth / 2;
          return <g key={symbolic} data-place-value-row={index + 1}>
            <text x={rect.x} y={rect.y + rect.height * 0.32} fill={accent} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize * 0.9)} fontWeight="820" letterSpacing="1.8">{index === 0 ? "OPERAND X" : "OPERAND Y"}</text>
            <WrappedText text={symbolic} rect={{ x: rect.x, y: rect.y + rect.height * 0.43, width: labelWidth, height: rect.height * 0.43 }} theme={theme} fill={theme.surface} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.subtitleSize * 1.04)} fontWeight="760" maxLines={2} />
            <text x={equalsX - props.scene.metrics.gutter * 0.25} y={rect.y + rect.height * 0.63} textAnchor="end" fill="#DDE2F1" fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.bodySize)} fontWeight="720">{concrete.whole} =</text>
            {[concrete.high, concrete.low].map((value, blockIndex) => {
              const x = rulerX + blockIndex * blockWidth;
              const color = blockIndex === 0 ? accent : theme.warning;
              return <g key={`${value}-${blockIndex}`} data-place-value-block={blockIndex === 0 ? "high" : "low"}>
                <rect x={x} y={rect.y + rect.height * 0.21} width={blockWidth - props.scene.metrics.unit * 0.2} height={rect.height * 0.56} fill={blockIndex === 0 ? shade(color, 0.38) : shade(color, 0.48)} stroke={color} strokeWidth={Math.max(3, props.scene.metrics.unit * 0.28)} />
                <text x={x + (blockWidth - props.scene.metrics.unit * 0.2) / 2} y={rect.y + rect.height * 0.59} textAnchor="middle" fill={theme.surface} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.titleSize * 0.78)} fontWeight="840">{value}</text>
                <text x={x + (blockWidth - props.scene.metrics.unit * 0.2) / 2} y={rect.y + rect.height * 0.91} textAnchor="middle" fill={color} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize * 0.82)} fontWeight="820" letterSpacing="1.4">{blockIndex === 0 ? "HIGH · ×B" : "LOW · ×1"}</text>
              </g>;
            })}
          </g>;
        })}
        <line x1={ruleStage.x} x2={ruleStage.x + ruleStage.width} y1={ruleStage.y} y2={ruleStage.y} stroke={theme.secondary} strokeWidth={Math.max(4, props.scene.metrics.unit * 0.42)} />
        <text x={ruleStage.x} y={ruleStage.y + legible(props.scene.metrics.smallSize) * 1.55} fill={paperSecondary(theme)} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="820" letterSpacing="2">BASE RULE</text>
        <WrappedText text={relationship.rule} rect={{ x: ruleStage.x + ruleStage.width * (isWide ? 0.18 : 0), y: ruleStage.y + props.scene.metrics.unit * 0.45, width: ruleStage.width * (isWide ? 0.8 : 1), height: ruleStage.height * 0.72 }} theme={theme} fontSize={legible(props.scene.metrics.subtitleSize)} fontWeight="780" maxLines={2} />
      </g>
    ));
  }
  const inset = props.scene.metrics.gutter;
  const hasExample = Boolean(content.example);
  const definitionRect: Rect = {
    x: body.x + inset,
    y: body.y + body.height * 0.23,
    width: body.width - inset * 2,
    height: body.height * (hasExample ? 0.36 : 0.58),
  };
  return withFrame(props, (
    <g id="body" data-semantic-role="content" data-definition-layout="authored-editorial" style={animationStyle(props.scene.choreography, "body", props.frame.tick, props.frame.reducedMotion) as CSSProperties}>
      <line x1={body.x} x2={body.x} y1={body.y + body.height * 0.05} y2={body.y + body.height * 0.83} stroke={theme.primary} strokeWidth={Math.max(5, props.scene.metrics.unit * 0.55)} />
      <text x={body.x + inset} y={body.y + legible(props.scene.metrics.smallSize)} fill={theme.primary} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="760" letterSpacing="2.5">CORE IDEA</text>
      <WrappedText text={content.term} rect={{ x: body.x + inset, y: body.y + body.height * 0.08, width: body.width - inset * 2, height: body.height * 0.14 }} theme={theme} fill={theme.ink} fontFamily={theme.fontDisplay} fontSize={legible(props.scene.metrics.subtitleSize * 1.3)} fontWeight="790" maxLines={2} />
      <WrappedText text={content.definition} rect={definitionRect} theme={theme} fill={theme.ink} fontSize={legible(props.scene.metrics.titleSize * 0.83)} fontWeight="620" maxLines={hasExample ? 4 : 6} lineHeight={1.2} />
      {content.example ? <g data-text-role="paper-secondary">
        <line x1={body.x + inset} x2={body.x + body.width - inset} y1={body.y + body.height * 0.67} y2={body.y + body.height * 0.67} stroke={theme.line} strokeWidth="2" />
        <text x={body.x + inset} y={body.y + body.height * 0.72 + legible(props.scene.metrics.smallSize)} fill={theme.secondary} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="760" letterSpacing="2">IN PRACTICE</text>
        <WrappedText text={content.example} rect={{ x: body.x + inset, y: body.y + body.height * 0.79, width: body.width - inset * 2, height: body.height * 0.2 }} theme={theme} fill={theme.mutedInk} fontSize={legible(props.scene.metrics.bodySize * 1.05)} fontWeight="580" maxLines={3} />
      </g> : null}
    </g>
  ));
}

export function BulletsRenderer(props: SceneRendererProps<BulletsContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  if (props.scene.spec.content.kind === "summary" || props.scene.spec.content.kind === "recap") {
    const items = props.scene.spec.content.items.slice(0, 4);
    const isWide = props.scene.metrics.columns === 2;
    const stage: Rect = { x: body.x, y: body.y + body.height * 0.08, width: body.width, height: body.height * 0.76 };
    const itemStage = isWide
      ? stage
      : { x: stage.x, y: stage.y + stage.height * 0.17, width: stage.width, height: stage.height * 0.8 };
    const rects = isWide ? splitSequenceColumns(itemStage, items.length, props.scene.metrics.gutter * 0.8) : stackRows(itemStage, items.length, props.scene.metrics.unit * 0.8);
    return withFrame(props, <g id="body" data-semantic-role="content">
      <path d={`M ${stage.x} ${stage.y} H ${stage.x + stage.width} V ${stage.y + stage.height} H ${stage.x + props.scene.metrics.unit * 1.2} L ${stage.x} ${stage.y + stage.height - props.scene.metrics.unit * 1.2} Z`} fill={`url(#ink-field-${safeId(props.scene.spec.id)})`} filter={`url(#soft-shadow-${safeId(props.scene.spec.id)})`} />
      <path d={`M ${stage.x} ${stage.y} H ${stage.x + stage.width} V ${stage.y + stage.height} H ${stage.x + props.scene.metrics.unit * 1.2} L ${stage.x} ${stage.y + stage.height - props.scene.metrics.unit * 1.2} Z`} fill={`url(#micro-grid-${safeId(props.scene.spec.id)})`} opacity="0.52" />
      <text x={stage.x + props.scene.metrics.gutter} y={stage.y + legible(props.scene.metrics.smallSize) * 1.35} fill={theme.accent} fontFamily={theme.fontMono} fontWeight="820" fontSize={legible(props.scene.metrics.smallSize)} letterSpacing={2.1}>{props.scene.spec.content.kind === "summary" ? "THE DURABLE THREAD" : "REINFORCE THE THREAD"}</text>
      <line x1={stage.x + props.scene.metrics.gutter} x2={stage.x + stage.width - props.scene.metrics.gutter} y1={stage.y + stage.height * (isWide ? 0.42 : 0.16)} y2={stage.y + stage.height * (isWide ? 0.42 : 0.16)} stroke="#7E87A4" strokeWidth={Math.max(3, props.scene.metrics.unit * 0.32)} />
      {items.map((item, index) => {
        const rect = rects[index]; if (!rect) return null;
        const color = item.emphasis === "secondary" ? theme.secondary : item.emphasis === "warning" ? theme.warning : index === 1 ? theme.accent : theme.primary;
        const anchorY = isWide ? stage.y + stage.height * 0.42 : rect.y + rect.height * 0.5;
        return <g key={item.id} id={item.id} style={animationStyle(props.scene.choreography, item.id, props.frame.tick, props.frame.reducedMotion) as CSSProperties}>
          <circle cx={isWide ? rect.x + rect.width * 0.5 : rect.x + props.scene.metrics.gutter} cy={anchorY} r={props.scene.metrics.unit * 0.78} fill={color} stroke={theme.codeBackground} strokeWidth={Math.max(4, props.scene.metrics.unit * 0.38)} />
          <text x={isWide ? rect.x + rect.width * 0.5 : rect.x + props.scene.metrics.gutter * 2.3} y={isWide ? rect.y + rect.height * 0.33 : rect.y + rect.height * 0.33} textAnchor={isWide ? "middle" : "start"} fill={tint(color, 0.28)} fontFamily={theme.fontDisplay} fontWeight="840" fontSize={props.scene.metrics.titleSize * (isWide ? 1.48 : 1.05)}>{String(index + 1).padStart(2, "0")}</text>
          <WrappedText text={item.text} rect={isWide ? { x: rect.x + rect.width * 0.06, y: rect.y + rect.height * 0.55, width: rect.width * 0.88, height: rect.height * 0.38 } : { x: rect.x + props.scene.metrics.gutter * 5.2, y: rect.y + rect.height * 0.2, width: rect.width - props.scene.metrics.gutter * 5.7, height: rect.height * 0.62 }} theme={theme} fill={theme.surface} fontSize={legible(props.scene.metrics.bodySize * 1.02)} fontWeight="710" textAnchor={isWide ? "middle" : "start"} maxLines={isWide ? 3 : 2} lineHeight={1.16} />
          {item.supportingText ? <WrappedText text={item.supportingText} rect={isWide ? { x: rect.x + rect.width * 0.08, y: rect.y + rect.height * 0.79, width: rect.width * 0.84, height: rect.height * 0.18 } : { x: rect.x + props.scene.metrics.gutter * 5.2, y: rect.y + rect.height * 0.68, width: rect.width - props.scene.metrics.gutter * 5.7, height: rect.height * 0.22 }} theme={theme} fill="#BFC6D9" fontSize={legible(props.scene.metrics.smallSize)} fontWeight="600" textAnchor={isWide ? "middle" : "start"} maxLines={2} /> : null}
        </g>;
      })}
    </g>);
  }
  return withFrame(props, <BulletList items={props.scene.spec.content.items} rect={insetRect(body, props.scene.metrics.gutter * 0.4)} scene={props.scene} frame={props.frame} theme={theme} />);
}

export function ComparisonRenderer(props: SceneRendererProps<ComparisonContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const content = props.scene.spec.content;
  const body = bodyRect(props);
  if (content.curveComparison) {
    const curve = content.curveComparison;
    const plot: Rect = { x: body.x + body.width * 0.08, y: body.y + body.height * 0.09, width: body.width * 0.84, height: body.height * 0.68 };
    const maxN = 64;
    const maxY = Math.pow(maxN, Math.max(curve.firstExponent, curve.secondExponent));
    const points = (exponent: number) => Array.from({ length: 33 }, (_, index) => {
      const n = 1 + (index / 32) * (maxN - 1);
      return `${(plot.x + (index / 32) * plot.width).toFixed(2)},${(plot.y + plot.height - (Math.pow(n, exponent) / maxY) * plot.height).toFixed(2)}`;
    }).join(" ");
    const verdict = content.verdict ?? `${curve.secondLabel} grows more slowly as n increases`;
    return withFrame(props, (
      <g id="body" data-semantic-role="visual" data-comparison-mode="growth-curves">
        <rect x={plot.x} y={plot.y} width={plot.width} height={plot.height} rx={props.scene.metrics.unit * 0.8} fill={shade(theme.primary, 0.42)} filter={`url(#shadow-${safeId(props.scene.spec.id)})`} />
        {[0.25, 0.5, 0.75].map((fraction) => <g key={fraction} opacity="0.3">
          <line x1={plot.x} x2={plot.x + plot.width} y1={plot.y + plot.height * fraction} y2={plot.y + plot.height * fraction} stroke={theme.surface} strokeWidth="1.5" />
          <line y1={plot.y} y2={plot.y + plot.height} x1={plot.x + plot.width * fraction} x2={plot.x + plot.width * fraction} stroke={theme.surface} strokeWidth="1.5" />
        </g>)}
        <line x1={plot.x} x2={plot.x} y1={plot.y} y2={plot.y + plot.height} stroke={theme.surface} strokeWidth="4" />
        <line x1={plot.x} x2={plot.x + plot.width} y1={plot.y + plot.height} y2={plot.y + plot.height} stroke={theme.surface} strokeWidth="4" />
        <polyline data-growth-curve="first" points={points(curve.firstExponent)} fill="none" stroke={theme.warning} strokeWidth={Math.max(6, props.scene.metrics.unit * 0.55)} strokeLinecap="round" strokeLinejoin="round" />
        <polyline data-growth-curve="second" points={points(curve.secondExponent)} fill="none" stroke={theme.accent} strokeWidth={Math.max(6, props.scene.metrics.unit * 0.55)} strokeLinecap="round" strokeLinejoin="round" />
        <g transform={`translate(${plot.x + plot.width * 0.06} ${plot.y + props.scene.metrics.gutter * 0.48})`}>
          <line x1="0" x2={props.scene.metrics.unit * 2.6} y1="0" y2="0" stroke={theme.warning} strokeWidth="7" strokeLinecap="round" />
          <text x={props.scene.metrics.unit * 3.2} y={legible(props.scene.metrics.smallSize) * 0.34} fill={theme.surface} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="820">{curve.firstLabel}</text>
          <line x1={props.scene.metrics.unit * 15} x2={props.scene.metrics.unit * 17.6} y1="0" y2="0" stroke={theme.accent} strokeWidth="7" strokeLinecap="round" />
          <text x={props.scene.metrics.unit * 18.2} y={legible(props.scene.metrics.smallSize) * 0.34} fill={theme.surface} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="820">{curve.secondLabel}</text>
        </g>
        <text x={plot.x + plot.width / 2} y={plot.y + plot.height + legible(props.scene.metrics.bodySize) * 1.7} textAnchor="middle" fill={theme.mutedInk} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="760">{curve.xLabel ?? "INPUT SIZE n"}</text>
        <text x={plot.x - props.scene.metrics.gutter * 0.8} y={plot.y + plot.height / 2} textAnchor="middle" fill={theme.mutedInk} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="760" transform={`rotate(-90 ${plot.x - props.scene.metrics.gutter * 0.8} ${plot.y + plot.height / 2})`}>{curve.yLabel ?? "RELATIVE WORK"}</text>
        <ReadabilitySurface scene={props.scene} rect={{ x: body.x + body.width * 0.12, y: body.y + body.height * 0.86, width: body.width * 0.76, height: body.height * 0.12 }} theme={theme} opacity={0.965} role="comparison-verdict" />
        <WrappedText text={verdict} rect={{ x: body.x + body.width * 0.16, y: body.y + body.height * 0.885, width: body.width * 0.68, height: body.height * 0.075 }} theme={theme} fill={theme.ink} fontFamily={theme.fontDisplay} fontSize={legible(props.scene.metrics.subtitleSize * 0.78)} fontWeight="790" textAnchor="middle" maxLines={2} lineHeight={1.02} />
      </g>
    ));
  }
  const isWide = props.scene.metrics.columns === 2;
  const [first, second] = isWide
    ? splitColumns({ x: body.x, y: body.y + body.height * 0.08, width: body.width, height: body.height * 0.72 }, props.scene.metrics.unit * 1.4)
    : stackRows({ x: body.x, y: body.y + body.height * 0.06, width: body.width, height: body.height * 0.76 }, 2, props.scene.metrics.unit * 1.2) as readonly [Rect, Rect];
  const renderSide = (rect: Rect, side: ComparisonContent["left"], tone: "primary" | "secondary") => {
    const { label, items } = side;
    const color = tone === "primary" ? theme.primary : theme.secondary;
    const dark = tone === "primary" ? shade(theme.primary, 0.4) : shade(theme.secondary, 0.34);
    const count = side.count ?? Math.max(1, items.length);
    const countLabel = side.countLabel ?? (count === 1 ? "operation" : "products");
    const countSize = props.scene.metrics.titleSize * (isWide ? 3.1 : 2.05);
    const tokenWidth = (rect.width - props.scene.metrics.gutter * 1.35) / Math.min(4, count);
    return <g data-comparison-side={tone}>
      <path d={`M ${rect.x} ${rect.y} H ${rect.x + rect.width} V ${rect.y + rect.height * 0.92} L ${rect.x + rect.width * (tone === "primary" ? 0.92 : 0.08)} ${rect.y + rect.height} H ${rect.x} Z`} fill={dark} filter={`url(#shadow-${safeId(props.scene.spec.id)})`} />
      <rect x={rect.x} y={rect.y} width={Math.max(8, props.scene.metrics.unit * 0.72)} height={rect.height} fill={tone === "primary" ? theme.accent : tint(theme.secondary, 0.28)} />
      <WrappedText text={label.toUpperCase()} rect={{ x: rect.x + props.scene.metrics.gutter, y: rect.y + legible(props.scene.metrics.smallSize) * 0.45, width: rect.width - props.scene.metrics.gutter * 1.5, height: rect.height * 0.13 }} theme={theme} fill={tone === "primary" ? theme.accent : "#9DE2D7"} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize * 0.9)} fontWeight="820" maxLines={2} lineHeight={1.04} />
      <text x={rect.x + props.scene.metrics.gutter} y={rect.y + rect.height * (isWide ? 0.48 : 0.53)} fill={theme.surface} fontFamily={theme.fontDisplay} fontSize={countSize} fontWeight="840" letterSpacing={-4}>{count}</text>
      <WrappedText text={countLabel} rect={{ x: rect.x + props.scene.metrics.gutter + countSize * 0.78, y: rect.y + rect.height * (isWide ? 0.29 : 0.31), width: rect.width * 0.38, height: rect.height * 0.18 }} theme={theme} fill="#C9CFDF" fontSize={legible(props.scene.metrics.bodySize)} fontWeight="680" maxLines={2} />
      <line x1={rect.x + props.scene.metrics.gutter} x2={rect.x + rect.width - props.scene.metrics.gutter * 0.5} y1={rect.y + rect.height * 0.6} y2={rect.y + rect.height * 0.6} stroke={theme.surface} strokeWidth="1.5" opacity="0.3" />
      {items.slice(0, 4).map((text, index) => {
        const x = rect.x + props.scene.metrics.gutter + index * tokenWidth;
        const y = rect.y + rect.height * 0.72;
        const evidenceLimit = isWide && items.length === 1 ? 48 : 22;
        return <g key={`${text}-${index}`}><rect x={x} y={y - props.scene.metrics.unit * 0.55} width={Math.max(8, props.scene.metrics.unit * 0.8)} height={Math.max(8, props.scene.metrics.unit * 0.8)} fill={color} transform={`rotate(45 ${x + props.scene.metrics.unit * 0.4} ${y - props.scene.metrics.unit * 0.15})`} />{text ? <text x={x + props.scene.metrics.unit * 1.35} y={y + legible(props.scene.metrics.bodySize) * 0.35} fill={theme.surface} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.bodySize * 0.82)} fontWeight="760">{truncate(text, evidenceLimit)}</text> : null}</g>;
      })}
    </g>;
  };
  const verdict = content.verdict ?? `${Math.max(0, content.left.items.length - content.right.items.length)} fewer recursive products`;
  return withFrame(props, (
    <g id="body" data-semantic-role="visual">
      <text x={body.x + body.width / 2} y={body.y + legible(props.scene.metrics.smallSize)} textAnchor="middle" fill={theme.mutedInk} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="820" letterSpacing={2.3}>SAME INPUT · SAME ANSWER</text>
      {renderSide(first, content.left, "primary")}
      {renderSide(second, content.right, "secondary")}
      {isWide ? <g aria-hidden="true"><path d={`M ${body.x + body.width * 0.47} ${body.y + body.height * 0.38} H ${body.x + body.width * 0.53}`} stroke={theme.accent} strokeWidth={props.scene.metrics.unit * 1.1} /><path d={`M ${body.x + body.width * 0.53} ${body.y + body.height * 0.38} l ${-props.scene.metrics.unit * 1.2} ${-props.scene.metrics.unit * 0.9} v ${props.scene.metrics.unit * 1.8} z`} fill={theme.accent} /></g> : null}
      <ReadabilitySurface scene={props.scene} rect={{ x: body.x + body.width * 0.08, y: body.y + body.height * 0.855, width: body.width * 0.84, height: body.height * 0.14 }} theme={theme} opacity={0.965} role="comparison-verdict" />
      <line x1={body.x + body.width * 0.12} x2={body.x + body.width * 0.88} y1={body.y + body.height * 0.9} y2={body.y + body.height * 0.9} stroke={theme.warning} strokeWidth={Math.max(4, props.scene.metrics.unit * 0.45)} />
      <WrappedText text={verdict} rect={{ x: body.x + body.width * 0.12, y: body.y + body.height * 0.91, width: body.width * 0.76, height: body.height * 0.085 }} theme={theme} fill={theme.ink} fontFamily={theme.fontDisplay} fontSize={legible(props.scene.metrics.subtitleSize * 0.84)} fontWeight="790" textAnchor="middle" maxLines={2} lineHeight={1.02} />
    </g>
  ));
}

export function DiagramRenderer(props: SceneRendererProps<DiagramContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = insetRect(bodyRect(props), props.scene.metrics.gutter * 0.2);
  const content = props.scene.spec.content;
  const nodes = content.nodes.slice(0, props.scene.metrics.profile === "portrait" ? 7 : 6);
  const direction = content.direction ?? (props.scene.metrics.columns === 2 ? "left-to-right" : "top-to-bottom");
  const positions = layoutSignalFlow(nodes.length, body, direction);
  const byId = new Map(nodes.map((node, index) => [node.id, positions[index]]));
  const isHorizontal = direction !== "top-to-bottom" && props.scene.metrics.columns === 2;
  return withFrame(props, (
    <g id="body" data-semantic-role="visual">
      <defs><marker id={`arrow-${safeId(props.scene.spec.id)}`} markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill={theme.accent} /></marker></defs>
      {isHorizontal ? <rect data-diagram-stage="true" data-layout-x={body.x} data-layout-y={body.y + body.height * 0.28} data-layout-width={body.width} data-layout-height={body.height * 0.49} x={body.x} y={body.y + body.height * 0.28} width={body.width} height={body.height * 0.49} fill="none" stroke="none" /> : null}
      <path d={isHorizontal
        ? `M ${body.x} ${body.y + body.height * 0.28} H ${body.x + body.width} V ${body.y + body.height * 0.77} H ${body.x} Z`
        : `M ${body.x + body.width * 0.16} ${body.y} H ${body.x + body.width * 0.84} V ${body.y + body.height} H ${body.x + body.width * 0.16} Z`}
        fill={`url(#ink-field-${safeId(props.scene.spec.id)})`} filter={`url(#soft-shadow-${safeId(props.scene.spec.id)})`} />
      <path d={isHorizontal
        ? `M ${body.x} ${body.y + body.height * 0.28} H ${body.x + body.width} V ${body.y + body.height * 0.77} H ${body.x} Z`
        : `M ${body.x + body.width * 0.16} ${body.y} H ${body.x + body.width * 0.84} V ${body.y + body.height} H ${body.x + body.width * 0.16} Z`}
        fill={`url(#micro-grid-${safeId(props.scene.spec.id)})`} opacity="0.82" />
      <text x={body.x + props.scene.metrics.unit} y={body.y + legible(props.scene.metrics.smallSize)} fill={theme.primary} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="820" letterSpacing={2.1}>ONE IDEA · FOUR STATES</text>
      {content.edges.map((edge) => {
        const from = byId.get(edge.from); const to = byId.get(edge.to);
        if (!from || !to) return null;
        const start = edgePoint(from, to, false);
        const end = edgePoint(to, from, true);
        const x1 = start.x; const y1 = start.y;
        const x2 = end.x; const y2 = end.y;
        const cx = (x1 + x2) / 2; const cy = (y1 + y2) / 2;
        return <g key={edge.id}><path d={`M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`} fill="none" stroke={edge.style === "emphasis" ? theme.accent : "#8F99B6"} strokeWidth={edge.style === "emphasis" ? 7 : 4} strokeDasharray={edge.style === "dashed" ? "10 8" : undefined} markerEnd={`url(#arrow-${safeId(props.scene.spec.id)})`} />{edge.label ? <text x={cx} y={cy - props.scene.metrics.unit * 1.3} textAnchor="middle" fill={theme.surface} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="760" letterSpacing="1">{truncate(edge.label.toUpperCase(), 24)}</text> : null}</g>;
      })}
      {nodes.map((node, index) => {
        const rect = positions[index]; if (!rect) return null;
        const color = node.tone === "secondary" ? theme.secondary : node.tone === "warning" ? theme.warning : node.tone === "neutral" ? theme.mutedInk : theme.primary;
        const tone = node.tone ?? "primary";
        const centerX = rect.x + rect.width / 2; const centerY = rect.y + rect.height / 2;
        const endpoint = index === 0 || index === nodes.length - 1;
        const fill = endpoint ? (index === 0 ? shade(theme.primary, 0.22) : shade(theme.secondary, 0.2)) : theme.surface;
        const textFill = endpoint ? theme.surface : theme.ink;
        const numberPlate = {
          x: rect.x + props.scene.metrics.unit * 0.88,
          y: rect.y + rect.height * 0.105,
          width: legible(props.scene.metrics.smallSize) * 2.55,
          height: legible(props.scene.metrics.smallSize) * 1.62,
        };
        return <g key={node.id} id={node.id} data-signal-stage={index + 1} data-layout-x={rect.x} data-layout-y={rect.y} data-layout-width={rect.width} data-layout-height={rect.height} style={animationStyle(props.scene.choreography, node.id, props.frame.tick, props.frame.reducedMotion) as CSSProperties}>
          <path d={`M ${rect.x} ${rect.y + rect.height * 0.12} L ${rect.x + rect.width * 0.1} ${rect.y} H ${rect.x + rect.width} V ${rect.y + rect.height * 0.88} L ${rect.x + rect.width * 0.9} ${rect.y + rect.height} H ${rect.x} Z`} fill={fill} stroke={endpoint ? color : tint(color, 0.3)} strokeWidth={endpoint ? 0 : Math.max(3, props.scene.metrics.unit * 0.3)} filter={`url(#shadow-${safeId(props.scene.spec.id)})`} />
          <rect x={rect.x} y={rect.y} width={Math.max(7, props.scene.metrics.unit * 0.62)} height={rect.height} fill={index === nodes.length - 1 ? theme.accent : color} />
          <g data-contrast-surface="diagram-stage-number">
            <rect {...numberPlate} fill={endpoint ? theme.surface : accentPlate(theme, tone)} />
            <text x={numberPlate.x + numberPlate.width / 2} y={numberPlate.y + legible(props.scene.metrics.smallSize) * 1.17} textAnchor="middle" fill={endpoint ? theme.ink : theme.surface} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="840">{String(index + 1).padStart(2, "0")}</text>
          </g>
          <WrappedText text={node.label} rect={{ x: rect.x + props.scene.metrics.unit * 1.45, y: centerY - props.scene.metrics.titleSize * 0.72, width: rect.width - props.scene.metrics.unit * 2.6, height: props.scene.metrics.titleSize * 1.55 }} theme={theme} fill={textFill} fontSize={legible(props.scene.metrics.bodySize * (node.label.length < 15 ? 1.28 : 1.05))} fontWeight="790" textAnchor="start" maxLines={3} lineHeight={1.04} />
          {node.detail ? <WrappedText text={node.detail} rect={{ x: rect.x + props.scene.metrics.unit * 1.45, y: rect.y + rect.height * 0.73, width: rect.width - props.scene.metrics.unit * 2.4, height: rect.height * 0.2 }} theme={theme} fill={endpoint ? "#C6CCE0" : theme.mutedInk} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="620" maxLines={2} /> : null}
        </g>;
      })}
    </g>
  ));
}

function layoutSignalFlow(count: number, rect: Rect, direction: "left-to-right" | "top-to-bottom" | "radial"): readonly Rect[] {
  if (count === 0) return [];
  const horizontal = direction !== "top-to-bottom" && rect.width > rect.height * 1.2;
  if (horizontal) {
    const gap = Math.max(40, rect.width * 0.04);
    const width = (rect.width - gap * (count - 1)) / count;
    const height = rect.height * 0.48;
    const baselineY = rect.y + rect.height * 0.29;
    return Array.from({ length: count }, (_, index) => ({
      x: rect.x + index * (width + gap),
      y: baselineY,
      width,
      height,
    }));
  }
  const gap = Math.max(28, rect.height * 0.025);
  const height = (rect.height - gap * (count - 1)) / count;
  const width = rect.width * 0.64;
  return Array.from({ length: count }, (_, index) => ({
    x: rect.x + rect.width * (index % 2 === 0 ? 0.12 : 0.24),
    y: rect.y + index * (height + gap),
    width,
    height,
  }));
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

export function TimelineRenderer(props: SceneRendererProps<TimelineContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = insetRect(bodyRect(props), props.scene.metrics.gutter * 0.2);
  const events = props.scene.spec.content.events.slice(0, props.scene.metrics.profile === "portrait" ? 6 : 8);
  const vertical = props.scene.metrics.profile === "portrait";
  return withFrame(props, (
    <g id="body" data-semantic-role="visual">
      <ReadabilitySurface scene={props.scene} rect={{ x: body.x - props.scene.metrics.gutter * 0.35, y: body.y - props.scene.metrics.gutter * 0.35, width: body.width + props.scene.metrics.gutter * 0.7, height: body.height + props.scene.metrics.gutter * 0.7 }} theme={theme} role="timeline" />
      <line x1={vertical ? body.x + body.width * 0.18 : body.x} x2={vertical ? body.x + body.width * 0.18 : body.x + body.width} y1={vertical ? body.y : body.y + body.height * 0.52} y2={vertical ? body.y + body.height : body.y + body.height * 0.52} stroke={theme.line} strokeWidth={props.scene.metrics.unit * 0.55} strokeLinecap="round" />
      {events.map((event, index) => {
        const progress = events.length === 1 ? 0.5 : index / (events.length - 1);
        const horizontalCellWidth = body.width / Math.max(3, events.length);
        const horizontalInset = horizontalCellWidth * 0.5;
        const x = vertical
          ? body.x + body.width * 0.18
          : body.x + horizontalInset + (body.width - horizontalInset * 2) * progress;
        const y = vertical
          ? body.y + body.height * 0.08 + body.height * 0.84 * progress
          : body.y + body.height * 0.52;
        const side = index % 2 === 0 ? -1 : 1;
        const labelRect: Rect = vertical
          ? { x: body.x + body.width * 0.28, y: y - props.scene.metrics.bodySize * 1.5, width: body.width * 0.68, height: props.scene.metrics.bodySize * 3.4 }
          : { x: x - horizontalCellWidth * 0.46, y: y + side * body.height * 0.2 - (side < 0 ? body.height * 0.16 : 0), width: horizontalCellWidth * 0.92, height: body.height * 0.17 };
        const dateY = labelRect.y + props.scene.metrics.smallSize * 1.05;
        const copyRect = { ...labelRect, y: labelRect.y + props.scene.metrics.smallSize * 1.55, height: labelRect.height - props.scene.metrics.smallSize * 1.55 };
        return <g key={event.id} id={event.id} style={animationStyle(props.scene.choreography, event.id, props.frame.tick, props.frame.reducedMotion) as CSSProperties}><circle cx={x} cy={y} r={props.scene.metrics.unit * 0.78} fill={theme.surface} stroke={index % 2 ? theme.secondary : theme.primary} strokeWidth={props.scene.metrics.unit * 0.32} /><text x={labelRect.x + (vertical ? 0 : labelRect.width / 2)} y={dateY} textAnchor={vertical ? "start" : "middle"} fill={theme.primary} fontFamily={theme.fontMono} fontWeight="800" fontSize={props.scene.metrics.smallSize}>{event.date}</text><WrappedText text={event.label} rect={copyRect} theme={theme} fontSize={props.scene.metrics.smallSize} fontWeight="650" textAnchor={vertical ? "start" : "middle"} maxLines={2} /></g>;
      })}
    </g>
  ));
}

export function FormulaRenderer(props: SceneRendererProps<FormulaContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const content = props.scene.spec.content;
  const body = bodyRect(props);
  const steps = content.steps?.slice(0, 6) ?? [];
  const formulaRect: Rect = steps.length ? { x: body.x, y: body.y, width: body.width, height: body.height * 0.29 } : body;
  const horizontalSteps = props.scene.metrics.columns === 2 && steps.length >= 2 && steps.length <= 4;
  const stepStage: Rect = { x: body.x + body.width * 0.025, y: body.y + body.height * 0.36, width: body.width * 0.95, height: body.height * 0.46 };
  const stepRects = horizontalSteps
    ? splitSequenceColumns(stepStage, steps.length, props.scene.metrics.gutter * 0.8)
    : stackRows(stepStage, steps.length, props.scene.metrics.unit * 0.6);
  const derivationRevealStart = props.scene.spec.durationTicks * 0.08;
  const derivationRevealStep = Math.min(
    props.scene.spec.durationTicks * 0.28,
    props.scene.spec.durationTicks * 0.54 / Math.max(1, steps.length - 1),
  );
  const resultRevealTick = props.scene.spec.durationTicks * 0.72;
  return withFrame(props, (
    <g id="body" data-semantic-role="content" data-visual-grammar="equation-transformation-lane">
      <path d={`M ${formulaRect.x} ${formulaRect.y} H ${formulaRect.x + formulaRect.width} V ${formulaRect.y + formulaRect.height} H ${formulaRect.x + props.scene.metrics.unit * 1.1} L ${formulaRect.x} ${formulaRect.y + formulaRect.height - props.scene.metrics.unit * 1.1} Z`} fill={theme.codeBackground} />
      <path d={`M ${formulaRect.x} ${formulaRect.y} H ${formulaRect.x + formulaRect.width} V ${formulaRect.y + formulaRect.height} H ${formulaRect.x + props.scene.metrics.unit * 1.1} L ${formulaRect.x} ${formulaRect.y + formulaRect.height - props.scene.metrics.unit * 1.1} Z`} fill={`url(#micro-grid-${safeId(props.scene.spec.id)})`} opacity="0.42" />
      <text x={formulaRect.x + props.scene.metrics.gutter} y={formulaRect.y + props.scene.metrics.smallSize * 1.5} fill={theme.secondary} fontFamily={theme.fontMono} fontWeight="800" fontSize={props.scene.metrics.smallSize * 0.7} letterSpacing="2">{content.kind === "derivation" ? "DERIVE" : "RELATION"}</text>
      <WrappedText text={content.expression} rect={{ x: formulaRect.x + formulaRect.width * 0.08, y: formulaRect.y + formulaRect.height * 0.37, width: formulaRect.width * 0.84, height: formulaRect.height * 0.42 }} theme={theme} fill={theme.codeInk} fontFamily={theme.fontMono} fontWeight="760" fontSize={Math.min(props.scene.metrics.titleSize * 1.08, formulaRect.width / Math.max(9, content.expression.length) * 1.4)} textAnchor="middle" maxLines={2} />
      {steps.length ? <g>{stepRects.map((rect, index) => {
        const step = steps[index];
        if (!step) return null;
        const color = index === steps.length - 1 ? theme.secondary : index % 2 ? theme.warning : theme.primary;
        const labelColor = index === steps.length - 1 ? theme.surface : color;
        const revealTick = derivationRevealStart + index * derivationRevealStep;
        const revealed = props.frame.reducedMotion || props.frame.tick >= revealTick;
        const revealProgress = props.frame.reducedMotion
          ? 1
          : clamp((props.frame.tick - revealTick) / Math.max(1, props.scene.spec.durationTicks * 0.08), 0, 1);
        const cardTop = rect.y + rect.height * 0.08;
        const labelY = cardTop + legible(props.scene.metrics.smallSize) * 1.3;
        const copyRect = horizontalSteps
          ? { x: rect.x + props.scene.metrics.gutter * 0.55, y: rect.y + rect.height * 0.3, width: rect.width - props.scene.metrics.gutter * 1.1, height: rect.height * 0.5 }
          : { x: rect.x + props.scene.metrics.bodySize * 2.4, y: rect.y + rect.height * 0.18, width: rect.width - props.scene.metrics.bodySize * 3.1, height: rect.height * 0.64 };
        return <g key={step.id} id={step.id} data-equation-step={index + 1} data-step-reveal={revealed ? "revealed" : "pending"} data-step-card-top={cardTop} data-step-label-y={labelY} opacity={revealProgress} transform={`translate(0 ${(1 - revealProgress) * props.scene.metrics.unit * 1.2})`}>
          <path d={`M ${rect.x} ${rect.y + rect.height * 0.08} H ${rect.x + rect.width} V ${rect.y + rect.height * 0.92} H ${rect.x + props.scene.metrics.unit * 0.8} L ${rect.x} ${rect.y + rect.height * 0.82} Z`} fill={index === steps.length - 1 ? shade(theme.secondary, 0.18) : theme.surface} stroke={color} strokeWidth={Math.max(3, props.scene.metrics.unit * 0.28)} filter={`url(#soft-shadow-${safeId(props.scene.spec.id)})`} />
          <rect x={rect.x} y={rect.y + rect.height * 0.08} width={Math.max(7, props.scene.metrics.unit * 0.62)} height={rect.height * 0.84} fill={color} />
          <text x={rect.x + props.scene.metrics.gutter * 0.6} y={labelY} fill={labelColor} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize * 0.82)} fontWeight="840" letterSpacing="1.4">{String(index + 1).padStart(2, "0")} · {step.reason?.toUpperCase() ?? "TRANSFORM"}</text>
          <WrappedText text={step.expression} rect={copyRect} theme={theme} fill={index === steps.length - 1 ? theme.surface : theme.ink} fontFamily={theme.fontMono} fontWeight="720" fontSize={legible(props.scene.metrics.bodySize * (horizontalSteps ? 0.84 : 0.96))} textAnchor={horizontalSteps ? "middle" : "start"} maxLines={horizontalSteps ? 4 : 2} lineHeight={1.14} />
          {horizontalSteps && index < steps.length - 1 ? <g aria-hidden="true" opacity={steps[index + 1] && (props.frame.reducedMotion || props.frame.tick >= derivationRevealStart + (index + 1) * derivationRevealStep) ? 1 : 0}><line x1={rect.x + rect.width} x2={rect.x + rect.width + props.scene.metrics.gutter * 0.68} y1={rect.y + rect.height * 0.5} y2={rect.y + rect.height * 0.5} stroke={theme.accent} strokeWidth={Math.max(4, props.scene.metrics.unit * 0.4)} /><path d={`M ${rect.x + rect.width + props.scene.metrics.gutter * 0.68} ${rect.y + rect.height * 0.5} l ${-props.scene.metrics.unit * 0.9} ${-props.scene.metrics.unit * 0.68} v ${props.scene.metrics.unit * 1.36} z`} fill={theme.accent} /></g> : null}
        </g>;
      })}</g> : null}
      {content.result ? <g data-result-reveal={props.frame.reducedMotion || props.frame.tick >= resultRevealTick ? "revealed" : "pending"} opacity={props.frame.reducedMotion ? 1 : clamp((props.frame.tick - resultRevealTick) / Math.max(1, props.scene.spec.durationTicks * 0.08), 0, 1)}><line x1={body.x} x2={body.x + body.width} y1={body.y + body.height * 0.89} y2={body.y + body.height * 0.89} stroke={theme.secondary} strokeWidth={Math.max(4, props.scene.metrics.unit * 0.42)} /><text x={body.x} y={body.y + body.height * 0.945} fill={paperSecondary(theme)} fontFamily={theme.fontMono} fontWeight="820" fontSize={legible(props.scene.metrics.smallSize * 0.82)} letterSpacing="1.8">RESOLVED RELATION</text><WrappedText text={content.result} rect={{ x: body.x + body.width * 0.2, y: body.y + body.height * 0.91, width: body.width * 0.78, height: body.height * 0.08 }} theme={theme} fill={paperSecondary(theme)} fontFamily={theme.fontMono} fontWeight="800" fontSize={legible(props.scene.metrics.bodySize * 0.88)} textAnchor="end" maxLines={2} /></g> : null}
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
  const plotBacking = {
    left: plot.x - props.scene.metrics.gutter * 1.42,
    top: plot.y - props.scene.metrics.gutter * 0.72,
    right: plot.x + plot.width + props.scene.metrics.gutter * 0.55,
    bottom: plot.y + plot.height + props.scene.metrics.gutter * 1.1,
  };
  const all = series.flatMap((entry) => entry.values);
  const minX = domain?.x[0] ?? Math.min(...all.map((point) => point.x), 0);
  const maxX = domain?.x[1] ?? Math.max(...all.map((point) => point.x), 1);
  const minY = domain?.y[0] ?? Math.min(...all.map((point) => point.y), 0);
  const maxY = domain?.y[1] ?? Math.max(...all.map((point) => point.y), 1);
  const scaleX = (value: number) => plot.x + (value - minX) / Math.max(0.00001, maxX - minX) * plot.width;
  const scaleY = (value: number) => plot.y + plot.height - (value - minY) / Math.max(0.00001, maxY - minY) * plot.height;
  const palette = ["#8C8EFF", "#43C2B8", "#F4C56A", "#EF7892"];
  return (
    <g id="body" data-semantic-role="data">
      <path d={`M ${plotBacking.left} ${plotBacking.top} H ${plotBacking.right} V ${plotBacking.bottom} H ${plotBacking.left} Z`} fill={`url(#ink-field-${safeId(props.scene.spec.id)})`} filter={`url(#shadow-${safeId(props.scene.spec.id)})`} />
      <path d={`M ${plotBacking.left} ${plotBacking.top} H ${plotBacking.right} V ${plotBacking.bottom} H ${plotBacking.left} Z`} fill={`url(#micro-grid-${safeId(props.scene.spec.id)})`} opacity="0.54" />
      {[0, 0.25, 0.5, 0.75, 1].map((value) => <g key={value}><line x1={plot.x} x2={plot.x + plot.width} y1={plot.y + plot.height * value} y2={plot.y + plot.height * value} stroke="#727A96" strokeWidth="1" opacity="0.48" /><text x={plot.x - props.scene.metrics.unit} y={plot.y + plot.height * value + 5} textAnchor="end" fill="#C2C8DA" fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)}>{(maxY - (maxY - minY) * value).toFixed(0)}</text></g>)}
      <line x1={plot.x} x2={plot.x} y1={plot.y} y2={plot.y + plot.height} stroke={theme.surface} strokeWidth="2" opacity="0.75" />
      <line x1={plot.x} x2={plot.x + plot.width} y1={plot.y + plot.height} y2={plot.y + plot.height} stroke={theme.surface} strokeWidth="2" opacity="0.75" />
      {series.map((entry, seriesIndex) => {
        const points = entry.values.map((point) => `${scaleX(point.x)},${scaleY(point.y)}`).join(" ");
        const color = entry.color ?? palette[seriesIndex % palette.length] ?? theme.primary;
        const area = `${scaleX(entry.values[0]?.x ?? 0)},${plot.y + plot.height} ${points} ${scaleX(entry.values[entry.values.length - 1]?.x ?? 1)},${plot.y + plot.height}`;
        const final = entry.values[entry.values.length - 1];
        const legendY = body.y + body.height - legible(props.scene.metrics.smallSize) * 1.8;
        return <g key={entry.id}><polygon points={area} fill={color} opacity={fillArea ? 0.2 : 0.085} /><polyline points={points} fill="none" stroke={color} strokeWidth={Math.max(4, props.scene.metrics.unit * 0.48)} strokeLinecap="round" strokeLinejoin="round" />{entry.values.map((point, pointIndex) => <circle key={pointIndex} cx={scaleX(point.x)} cy={scaleY(point.y)} r={props.scene.metrics.unit * (pointIndex === entry.values.length - 1 ? 0.62 : 0.42)} fill={theme.codeBackground} stroke={color} strokeWidth={pointIndex === entry.values.length - 1 ? 5 : 3} />)}{final ? <text x={scaleX(final.x) - props.scene.metrics.unit} y={scaleY(final.y) - props.scene.metrics.unit * 1.2} textAnchor="end" fill={color} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="820">{final.y}</text> : null}<line x1={plot.x + seriesIndex * props.scene.metrics.bodySize * 7.6} x2={plot.x + seriesIndex * props.scene.metrics.bodySize * 7.6 + props.scene.metrics.bodySize * 1.2} y1={legendY} y2={legendY} stroke={color} strokeWidth="5" /><text x={plot.x + seriesIndex * props.scene.metrics.bodySize * 7.6 + props.scene.metrics.bodySize * 1.55} y={legendY + legible(props.scene.metrics.smallSize) * 0.32} fill="#E3E6F1" fontFamily={theme.fontBody} fontWeight="720" fontSize={legible(props.scene.metrics.smallSize)}>{truncate(entry.label, 20)}</text></g>;
      })}
      {xLabel ? <text x={plot.x + plot.width / 2} y={body.y + body.height} textAnchor="middle" fill={theme.mutedInk} fontFamily={theme.fontBody} fontSize={legible(props.scene.metrics.smallSize)}>{xLabel}</text> : null}
      {yLabel ? <text x={body.x} y={plot.y + plot.height / 2} textAnchor="middle" transform={`rotate(-90 ${body.x} ${plot.y + plot.height / 2})`} fill={theme.mutedInk} fontFamily={theme.fontBody} fontSize={legible(props.scene.metrics.smallSize)}>{yLabel}</text> : null}
    </g>
  );
}

function whiteboardPath(points: readonly { readonly x: number; readonly y: number }[], board: Rect): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${board.x + point.x * board.width} ${board.y + point.y * board.height}`).join(" ");
}

function whiteboardPathLength(points: readonly { readonly x: number; readonly y: number }[], board: Rect): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    total += Math.hypot((current.x - previous.x) * board.width, (current.y - previous.y) * board.height);
  }
  return Math.max(1, total);
}

function comparablePresenterHeading(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/^\d+[.):\s-]+/u, "")
    .replace(/[.!?:]+$/u, "")
    .trim();
}

interface WhiteboardLineLayout {
  readonly text: string;
  readonly width: number;
  readonly baseline: number;
}

interface WhiteboardLabelLayout {
  readonly label: WhiteboardLabel;
  readonly x: number;
  readonly top: number;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly lines: readonly WhiteboardLineLayout[];
  readonly width: number;
  readonly height: number;
}

function whiteboardTextWidth(text: string, fontSize: number): number {
  return Math.max(fontSize * 0.7, text.length * fontSize * 0.61);
}

function wrapWhiteboardText(text: string, maximumCharacters: number): readonly string[] {
  const lines = [...wrapText(text, maximumCharacters)];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const operation = lines[index]!.match(/\s+([+−-]\s+\S+\s+[+−-])$/u);
    if (operation) {
      lines[index] = lines[index]!.slice(0, -operation[0].length).trimEnd();
      lines[index + 1] = `${operation[1]} ${lines[index + 1]}`;
      continue;
    }
    const danglingOperator = lines[index]!.match(/\s+([+=×÷−-])$/u);
    if (danglingOperator) {
      lines[index] = lines[index]!.slice(0, -danglingOperator[0].length).trimEnd();
      lines[index + 1] = `${danglingOperator[1]} ${lines[index + 1]}`;
    }
  }
  return lines.filter(Boolean);
}

function whiteboardRevealProgress(label: WhiteboardLabel, tick: number, reducedMotion: boolean): number {
  if (reducedMotion) return tick >= label.startTick ? 1 : 0;
  if (label.endTick === undefined) return tick >= label.startTick ? 1 : 0;
  return clamp((tick - label.startTick) / Math.max(1, label.endTick - label.startTick), 0, 1);
}

function whiteboardLabelLayouts(
  labels: readonly WhiteboardLabel[],
  board: Rect,
  metrics: SceneRendererProps["scene"]["metrics"],
): readonly WhiteboardLabelLayout[] {
  if (!labels.length) return [];
  const landscape = metrics.profile === "landscape";
  const minimum = landscape ? 40 : 32;
  const maximum = landscape ? 60 : 52;
  let baseSize = clamp(metrics.bodySize * (landscape ? 2.65 : 2.15), minimum, maximum);
  const leftInset = Math.max(metrics.gutter * 0.9, baseSize * 0.85);
  const numberRail = baseSize * 1.05;
  const rightInset = Math.max(metrics.gutter * 1.1, baseSize * 0.8);
  const x = board.x + leftInset + numberRail;
  const availableWidth = Math.max(baseSize * 8, board.x + board.width - rightInset - x);
  const verticalInset = Math.max(metrics.gutter * 0.7, baseSize * 0.62);
  const availableHeight = Math.max(baseSize * 3, board.height - verticalInset * 2);

  const longestToken = Math.max(1, ...labels.flatMap((label) => label.text.split(/\s+/u).map((token) => token.length)));
  baseSize = Math.min(baseSize, availableWidth / (longestToken * 0.61));

  const draft = (size: number) => labels.map((label) => {
    const fontSize = size * clamp(label.fontScale ?? 1, 0.8, 1.12);
    const maxCharacters = Math.max(8, Math.floor(availableWidth / (fontSize * 0.61)));
    const textLines = wrapWhiteboardText(label.text, maxCharacters);
    const lineHeight = fontSize * 1.28;
    const lines = textLines.map((text) => ({ text, width: Math.min(availableWidth, whiteboardTextWidth(text, fontSize)) }));
    return { label, fontSize, lineHeight, lines, height: lines.length * lineHeight };
  });

  let blocks = draft(baseSize);
  const minimumGap = Math.max(metrics.unit * 0.8, minimum * 0.34);
  while (baseSize > (landscape ? 40 : 28)
    && blocks.reduce((sum, block) => sum + block.height, 0) + minimumGap * Math.max(0, blocks.length - 1) > availableHeight) {
    baseSize -= 2;
    blocks = draft(baseSize);
  }

  const textHeight = blocks.reduce((sum, block) => sum + block.height, 0);
  const freeHeight = Math.max(0, availableHeight - textHeight);
  const gap = blocks.length > 1
    ? clamp(freeHeight / (blocks.length + 1), minimumGap, baseSize * 1.8)
    : 0;
  let cursor = board.y + verticalInset + (blocks.length === 1 ? freeHeight / 2 : gap);
  return blocks.map((block) => {
    const top = cursor;
    const lines = block.lines.map((line, index) => ({
      ...line,
      baseline: top + block.fontSize + index * block.lineHeight,
    }));
    cursor += block.height + gap;
    return { ...block, x, top, lines, width: availableWidth };
  });
}

function whiteboardLineProgress(layout: WhiteboardLabelLayout, lineIndex: number, progress: number): number {
  const weights = layout.lines.map((line) => Math.max(1, line.text.length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const before = weights.slice(0, lineIndex).reduce((sum, weight) => sum + weight, 0);
  return clamp((progress * total - before) / weights[lineIndex]!, 0, 1);
}

function whiteboardWritingPosition(layout: WhiteboardLabelLayout, progress: number): { readonly x: number; readonly y: number; readonly line: number } {
  const weights = layout.lines.map((line) => Math.max(1, line.text.length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const revealed = progress * total;
  let before = 0;
  for (let index = 0; index < layout.lines.length; index += 1) {
    const line = layout.lines[index]!;
    const weight = weights[index]!;
    if (revealed <= before + weight || index === layout.lines.length - 1) {
      const lineProgress = clamp((revealed - before) / weight, 0, 1);
      return {
        x: layout.x + line.width * lineProgress,
        y: line.baseline - layout.fontSize * 0.3,
        line: index + 1,
      };
    }
    before += weight;
  }
  const last = layout.lines.at(-1)!;
  return { x: layout.x + last.width, y: last.baseline - layout.fontSize * 0.3, line: layout.lines.length };
}

export function WhiteboardRenderer(props: SceneRendererProps<WhiteboardContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = insetRect(bodyRect(props), props.scene.metrics.gutter * 0.18);
  const content = props.scene.spec.content;
  const style = content.boardStyle ?? "whiteboard";
  const boardFill = style === "chalkboard" ? "#173C35" : style === "paper" ? "#FFF9E9" : "#FCFDFB";
  const boardInk = style === "chalkboard" ? "#F3F0D2" : "#202530";
  const palette = { ink: boardInk, primary: theme.primary, secondary: theme.secondary, warning: theme.warning } as const;
  const rail = Math.max(16, props.scene.metrics.unit * 1.3);
  const board = { x: body.x, y: body.y, width: body.width, height: body.height - rail };
  const labels = content.labels ?? [];
  const generatedLayout = content.generatedLayout === "progressive-list";
  const labelLayouts = generatedLayout ? whiteboardLabelLayouts(labels, board, props.scene.metrics) : [];
  const writingLabel = labels.find((label) => (
    label.endTick !== undefined
    && props.frame.tick >= label.startTick
    && props.frame.tick < label.endTick
  ));
  return withFrame(props, (
    <g id="body" data-semantic-role="visual" data-tutorial-mode="whiteboard" data-board-style={style}>
      <rect x={board.x} y={board.y} width={board.width} height={board.height} rx={Math.max(4, props.scene.metrics.unit * 0.45)} fill={boardFill} stroke={style === "chalkboard" ? "#0D2A25" : "#CDD2D4"} strokeWidth={Math.max(3, props.scene.metrics.unit * 0.26)} filter={`url(#shadow-${safeId(props.scene.spec.id)})`} />
      {style === "paper" ? Array.from({ length: 9 }, (_, index) => <line key={index} x1={board.x + props.scene.metrics.gutter * 0.5} x2={board.x + board.width - props.scene.metrics.gutter * 0.5} y1={board.y + board.height * ((index + 1) / 10)} y2={board.y + board.height * ((index + 1) / 10)} stroke="#D7DDE6" strokeWidth="2" opacity="0.62" />) : null}
      {labelLayouts.length ? <line x1={labelLayouts[0]!.x - labelLayouts[0]!.fontSize * 0.58} x2={labelLayouts[0]!.x - labelLayouts[0]!.fontSize * 0.58} y1={board.y + props.scene.metrics.gutter} y2={board.y + board.height - props.scene.metrics.gutter} stroke={theme.primary} strokeWidth={Math.max(2, props.scene.metrics.unit * 0.22)} opacity="0.16" /> : null}
      {content.strokes.map((stroke, index) => {
        const rawProgress = (props.frame.tick - stroke.startTick) / Math.max(1, stroke.endTick - stroke.startTick);
        const progress = props.frame.reducedMotion ? (props.frame.tick >= stroke.startTick ? 1 : 0) : clamp(rawProgress, 0, 1);
        const layout = labelLayouts[index];
        const underlineY = layout ? layout.top + layout.height + layout.fontSize * 0.13 : 0;
        const underlineWidth = layout ? Math.max(layout.fontSize * 2.4, Math.max(...layout.lines.map((line) => line.width))) : 0;
        const path = layout
          ? `M ${layout.x} ${underlineY} L ${layout.x + Math.min(layout.width, underlineWidth)} ${underlineY}`
          : whiteboardPath(stroke.points, board);
        const length = layout ? Math.min(layout.width, underlineWidth) : whiteboardPathLength(stroke.points, board);
        const width = Math.max(3, props.scene.metrics.unit * (stroke.width ?? (stroke.tool === "pencil" ? 0.26 : 0.42)));
        return <path key={stroke.id} id={stroke.id} data-whiteboard-stroke="true" data-draw-progress={progress.toFixed(4)} d={path} fill="none" stroke={palette[stroke.color ?? "ink"]} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={length} strokeDashoffset={length * (1 - progress)} opacity={stroke.tool === "pencil" ? 0.84 : 0.96} />;
      })}
      {labelLayouts.map((layout, labelIndex) => {
        const { label } = layout;
        const progress = whiteboardRevealProgress(label, props.frame.tick, props.frame.reducedMotion);
        return <g key={label.id} id={label.id} data-whiteboard-label-group="true" data-whiteboard-lines={layout.lines.length} data-whiteboard-font-size={layout.fontSize.toFixed(2)}>
          {label.emphasis === "result" ? <rect x={layout.x - layout.fontSize * 0.26} y={layout.top - layout.fontSize * 0.18} width={layout.width + layout.fontSize * 0.38} height={layout.height + layout.fontSize * 0.36} rx={layout.fontSize * 0.22} fill={theme.primary} opacity="0.075" /> : null}
          <text x={layout.x - layout.fontSize * 0.72} y={layout.lines[0]!.baseline} textAnchor="end" fill={label.emphasis === "result" ? theme.primary : theme.mutedInk} fontFamily={theme.fontMono} fontSize={legible(layout.fontSize * 0.38)} fontWeight="850" opacity={progress > 0 ? 0.8 : 0}>{String(labelIndex + 1).padStart(2, "0")}</text>
          {layout.lines.map((line, lineIndex) => {
            const lineProgress = whiteboardLineProgress(layout, lineIndex, progress);
            const clipId = `${safeId(props.scene.spec.id)}-${safeId(label.id)}-${lineIndex}-write`;
            return <g key={clipId}>
              <defs><clipPath id={clipId}><rect x={layout.x - 2} y={line.baseline - layout.fontSize * 1.05} width={line.width * lineProgress + 4} height={layout.lineHeight * 1.08} /></clipPath></defs>
              <text data-whiteboard-label="true" data-whiteboard-line={lineIndex + 1} data-write-progress={lineProgress.toFixed(4)} x={layout.x} y={line.baseline} fill={palette[label.color ?? "ink"]} fontFamily={theme.fontMono} fontSize={legible(layout.fontSize)} fontWeight={label.emphasis === "result" ? "850" : "720"} opacity={lineProgress > 0 ? 1 : 0} clipPath={`url(#${clipId})`}>{line.text}</text>
            </g>;
          })}
        </g>;
      })}
      {!generatedLayout ? labels.map((label) => {
        const progress = whiteboardRevealProgress(label, props.frame.tick, props.frame.reducedMotion);
        const x = board.x + label.x * board.width;
        const y = board.y + label.y * board.height;
        const availableWidth = Math.max(1, board.width * (0.96 - label.x));
        const clipId = `${safeId(props.scene.spec.id)}-${safeId(label.id)}-write`;
        const scale = label.fontScale ?? (content.layout === "derivation" ? 0.78 : 0.9);
        return <g key={label.id} data-whiteboard-label-group="true">
          <defs><clipPath id={clipId}><rect x={x - 2} y={y - props.scene.metrics.bodySize * 1.3} width={availableWidth * progress + 4} height={props.scene.metrics.bodySize * 1.8} /></clipPath></defs>
          <text id={label.id} data-whiteboard-label="true" data-write-progress={progress.toFixed(4)} x={x} y={y} fill={palette[label.color ?? "ink"]} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.bodySize * scale)} fontWeight={label.emphasis === "result" ? "850" : "720"} opacity={progress > 0 ? 1 : 0} clipPath={`url(#${clipId})`}>{label.text}</text>
        </g>;
      }) : null}
      {content.showWritingTool && writingLabel ? (() => {
        const layout = labelLayouts.find((candidate) => candidate.label.id === writingLabel.id);
        if (!layout) {
          const progress = whiteboardRevealProgress(writingLabel, props.frame.tick, false);
          const x = board.x + (writingLabel.x + (0.96 - writingLabel.x) * progress) * board.width;
          const y = board.y + writingLabel.y * board.height - props.scene.metrics.unit * 0.4;
          return <g data-whiteboard-writing-tool="true" transform={`translate(${x} ${y}) rotate(-38)`}>
            <rect x={-props.scene.metrics.unit * 0.12} y={-props.scene.metrics.unit * 1.25} width={props.scene.metrics.unit * 0.24} height={props.scene.metrics.unit * 1.18} rx={props.scene.metrics.unit * 0.08} fill={theme.primary} />
            <path d={`M ${-props.scene.metrics.unit * 0.12} 0 L 0 ${props.scene.metrics.unit * 0.32} L ${props.scene.metrics.unit * 0.12} 0 Z`} fill="#D8B27C" />
          </g>;
        }
        const progress = whiteboardRevealProgress(writingLabel, props.frame.tick, false);
        const position = whiteboardWritingPosition(layout, progress);
        const tool = Math.max(props.scene.metrics.unit * 1.15, layout.fontSize * 0.32);
        return <g data-whiteboard-writing-tool="true" data-writing-label={writingLabel.id} data-writing-line={position.line} data-writing-x={position.x.toFixed(2)} transform={`translate(${position.x} ${position.y}) rotate(-38)`}>
          <rect x={-tool * 0.12} y={-tool * 1.25} width={tool * 0.24} height={tool * 1.18} rx={tool * 0.08} fill={theme.primary} />
          <path d={`M ${-tool * 0.12} 0 L 0 ${tool * 0.32} L ${tool * 0.12} 0 Z`} fill="#D8B27C" />
        </g>;
      })() : null}
      <rect x={body.x} y={board.y + board.height} width={body.width} height={rail} rx={rail * 0.22} fill={style === "chalkboard" ? "#A9794E" : "#D5D8D8"} />
      <rect x={body.x + body.width * 0.73} y={board.y + board.height - props.scene.metrics.unit * 0.42} width={body.width * 0.12} height={props.scene.metrics.unit * 0.58} rx={props.scene.metrics.unit * 0.2} fill={theme.primary} opacity="0.9" />
      <rect x={body.x + body.width * 0.86} y={board.y + board.height - props.scene.metrics.unit * 0.42} width={body.width * 0.08} height={props.scene.metrics.unit * 0.58} rx={props.scene.metrics.unit * 0.2} fill={theme.warning} opacity="0.9" />
    </g>
  ));
}

export function CodeRenderer(props: SceneRendererProps<CodeContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const content = props.scene.spec.content;
  const lines = content.lines.slice(0, props.scene.metrics.profile === "portrait" ? 15 : 18);
  const isWide = props.scene.metrics.columns === 2;
  const codeRect: Rect = isWide ? { x: body.x, y: body.y, width: body.width * 0.7, height: body.height } : body;
  const lensRect: Rect | undefined = isWide ? { x: body.x + body.width * 0.72, y: body.y, width: body.width * 0.28, height: body.height } : undefined;
  const headerHeight = Math.max(52, props.scene.metrics.bodySize * 2.5);
  const compactMinimum = props.scene.metrics.profile === "portrait" ? 30 : 36;
  const compactMaximum = props.scene.metrics.profile === "portrait" ? 38 : 44;
  const longestCodeLine = Math.max(1, ...lines.map((line) => line.text.length));
  const longestAnnotation = Math.max(0, ...lines.map((line) => line.annotation?.length ?? 0));
  const compactCandidate = lines.length <= 8 && lines.every((line) => line.text.length <= 56);
  const compactAnnotationFontSize = clamp(props.scene.metrics.bodySize * 1.18, 26, 32);
  const compactAnnotationReserve = longestAnnotation > 0
    ? Math.min(
        codeRect.width * 0.38,
        Math.max(props.scene.metrics.gutter * 3.2, longestAnnotation * compactAnnotationFontSize * 0.56 + props.scene.metrics.gutter * 1.4),
      )
    : props.scene.metrics.gutter;
  const compactAvailableCodeWidth = Math.max(1, codeRect.width - props.scene.metrics.bodySize * 1.85 - compactAnnotationReserve);
  const compactProgram = compactCandidate
    && longestCodeLine * compactMinimum * 0.61 <= compactAvailableCodeWidth;
  const annotationReserve = longestAnnotation > 0
    ? compactProgram
      ? compactAnnotationReserve
      : Math.max(props.scene.metrics.gutter * 3.2, props.scene.metrics.bodySize * 5)
    : props.scene.metrics.gutter;
  const annotationFontSize = compactProgram
    ? compactAnnotationFontSize
    : legible(props.scene.metrics.smallSize);
  const availableCodeWidth = Math.max(1, codeRect.width - props.scene.metrics.bodySize * 1.85 - annotationReserve);
  const codeFontSize = compactProgram
    ? clamp(Math.min(props.scene.metrics.bodySize * 1.8, availableCodeWidth / (longestCodeLine * 0.61)), compactMinimum, compactMaximum)
    : legible(props.scene.metrics.bodySize * 0.92);
  const lineHeight = Math.min(codeFontSize * 1.62, (codeRect.height - headerHeight - props.scene.metrics.unit * 2) / Math.max(1, lines.length));
  const activeActions = content.actions?.filter((action) => props.frame.tick >= action.startTick && props.frame.tick <= action.endTick) ?? [];
  const actionPriority = { run: 4, explain: 3, highlight: 2, type: 1 } as const;
  const activeAction = activeActions.toSorted((left, right) => actionPriority[right.type] - actionPriority[left.type])[0];
  const lensOutputText = activeAction?.output ?? activeAction?.narrationAnchor ?? "Follow the active statement";
  const lensOutputFontSize = compactProgram && activeAction?.output
    ? clamp(props.scene.metrics.bodySize * 1.15, 26, 32)
    : legible(props.scene.metrics.smallSize);
  const upcomingLineAction = content.kind === "live-code"
    ? content.actions?.find((action) => action.lineId && action.startTick > props.frame.tick)
    : undefined;
  const focusAction = activeAction ?? upcomingLineAction;
  const actionLineIndex = focusAction?.lineId ? lines.findIndex((line) => line.id === focusAction.lineId) : -1;
  const activeIndex = Math.max(0, actionLineIndex >= 0 ? actionLineIndex : lines.findIndex((line) => line.highlight));
  const activeLine = lines[activeIndex] ?? lines[0];
  const functionName = lines.find((line) => /\b(def|function|fn)\b/u.test(line.text))?.text.match(/(?:def|function|fn)\s+([A-Za-z_][\w]*)/u)?.[1] ?? content.filename ?? "program";
  return withFrame(props, (
    <g id="body" data-semantic-role="code" data-tutorial-mode={content.kind === "live-code" ? "live-code" : undefined} data-active-code-line={content.kind === "live-code" ? activeIndex + 1 : undefined} data-compact-code-program={compactProgram ? "true" : "false"} data-code-annotation-reserve={annotationReserve.toFixed(2)}>
      <path d={`M ${codeRect.x} ${codeRect.y} H ${codeRect.x + codeRect.width} V ${codeRect.y + codeRect.height} H ${codeRect.x + props.scene.metrics.unit * 1.2} L ${codeRect.x} ${codeRect.y + codeRect.height - props.scene.metrics.unit * 1.2} Z`} fill={theme.codeBackground} filter={`url(#soft-shadow-${safeId(props.scene.spec.id)})`} />
      <rect x={codeRect.x} y={codeRect.y} width={codeRect.width} height={headerHeight} fill="#252A3D" />
      <rect x={codeRect.x} y={codeRect.y} width={Math.max(8, props.scene.metrics.unit * 0.8)} height={headerHeight} fill={theme.primary} />
      {[theme.critical, theme.warning, theme.secondary].map((color, index) => <circle key={color} cx={codeRect.x + props.scene.metrics.bodySize * (1.25 + index * 0.92)} cy={codeRect.y + headerHeight / 2} r={Math.max(5, props.scene.metrics.bodySize * 0.25)} fill={color} />)}
      <text x={codeRect.x + props.scene.metrics.bodySize * 4.45} y={codeRect.y + headerHeight * 0.64} fill="#D4D8E6" fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="670">{content.filename ?? content.language ?? (content.kind === "terminal" ? "Terminal" : "Code")}</text>
      {content.step !== undefined && content.totalSteps ? <ProgressDots x={codeRect.x + codeRect.width - content.totalSteps * 18 - props.scene.metrics.gutter} y={codeRect.y + headerHeight / 2} count={content.totalSteps} active={Math.max(0, content.step - 1)} theme={theme} /> : null}
      {lines.map((line, index) => {
        const y = codeRect.y + headerHeight + lineHeight * (index + 0.78);
        const color = line.tokenClass === "keyword" ? "#B7A5FF" : line.tokenClass === "string" ? "#9DE2C7" : line.tokenClass === "number" ? "#F4C56A" : line.tokenClass === "comment" ? "#798097" : line.tokenClass === "function" ? "#82C6F2" : theme.codeInk;
        const diffTone = content.kind === "diff" ? (line.text.startsWith("+") ? theme.secondary : line.text.startsWith("-") ? theme.critical : undefined) : undefined;
        const typeAction = content.kind === "live-code" ? content.actions?.find((action) => action.type === "type" && action.lineId === line.id) : undefined;
        const typeProgress = typeAction
          ? props.frame.reducedMotion
            ? (props.frame.tick >= typeAction.startTick ? 1 : 0)
            : clamp((props.frame.tick - typeAction.startTick) / Math.max(1, typeAction.endTick - typeAction.startTick), 0, 1)
          : 1;
        const normalizedText = line.text.replace(/\t/g, "  ");
        const visibleText = typeAction ? normalizedText.slice(0, Math.round(normalizedText.length * typeProgress)) : normalizedText;
        const runAction = content.kind === "live-code" ? content.actions?.find((action) => action.type === "run" && action.lineId === line.id) : undefined;
        const annotationVisible = Boolean(line.annotation)
          && (!typeAction || props.frame.tick >= typeAction.endTick)
          && (!runAction || props.frame.tick >= runAction.startTick);
        const actionHighlight = content.actions?.some((action) => action.type === "highlight" && action.lineId === line.id && props.frame.tick >= action.startTick && props.frame.tick <= action.endTick);
        const lineFocused = content.kind === "live-code" ? Boolean(activeAction) && index === activeIndex : Boolean(line.highlight || actionHighlight);
        const typingNow = Boolean(typeAction && typeProgress > 0 && typeProgress < 1 && !props.frame.reducedMotion);
        return <g key={line.id} id={line.id} data-code-line={index + 1} data-code-line-focus={lineFocused ? "active" : "inactive"} data-code-font-size={codeFontSize.toFixed(2)} data-typing-progress={typeAction ? typeProgress.toFixed(4) : undefined} style={animationStyle(props.scene.choreography, line.id, props.frame.tick, props.frame.reducedMotion) as CSSProperties}>{lineFocused || diffTone ? <g><rect x={codeRect.x + props.scene.metrics.bodySize * 0.2} y={y - lineHeight * 0.72} width={codeRect.width - props.scene.metrics.bodySize * 0.4} height={lineHeight} fill={diffTone ?? theme.primary} opacity="0.22" /><rect x={codeRect.x} y={y - lineHeight * 0.72} width={Math.max(7, props.scene.metrics.unit * 0.7)} height={lineHeight} fill={diffTone ?? theme.accent} /></g> : null}<text x={codeRect.x + props.scene.metrics.bodySize * 0.95} y={y} textAnchor="end" fill="#949BB1" fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)}>{index + 1}</text><text x={codeRect.x + props.scene.metrics.bodySize * 1.85} y={y} fill={color} fontFamily={theme.fontMono} fontSize={codeFontSize} xmlSpace="preserve">{truncate(visibleText, props.scene.metrics.profile === "portrait" ? 52 : isWide ? 62 : 92)}{typingNow ? <tspan fill={theme.accent}>▌</tspan> : null}</text>{line.annotation ? <text data-code-annotation={annotationVisible ? "revealed" : "pending"} data-code-annotation-font-size={annotationFontSize.toFixed(2)} x={codeRect.x + codeRect.width - props.scene.metrics.gutter} y={y} textAnchor="end" fill="#F4C56A" fontFamily={theme.fontBody} fontSize={annotationFontSize} opacity={annotationVisible ? 1 : 0}>{truncate(line.annotation, 28)}</text> : null}</g>;
      })}
      {lensRect ? <g data-code-lens="execution" data-live-code-action={content.kind === "live-code" ? activeAction?.type ?? "idle" : undefined}>
        <path d={`M ${lensRect.x} ${lensRect.y} H ${lensRect.x + lensRect.width} V ${lensRect.y + lensRect.height} H ${lensRect.x} L ${lensRect.x + props.scene.metrics.unit * 1.2} ${lensRect.y + lensRect.height * 0.5} Z`} fill={shade(theme.primary, 0.28)} />
        <path d={`M ${lensRect.x} ${lensRect.y} H ${lensRect.x + lensRect.width} V ${lensRect.y + lensRect.height} H ${lensRect.x} L ${lensRect.x + props.scene.metrics.unit * 1.2} ${lensRect.y + lensRect.height * 0.5} Z`} fill={`url(#micro-grid-${safeId(props.scene.spec.id)})`} opacity="0.62" />
        <text x={lensRect.x + props.scene.metrics.gutter} y={lensRect.y + legible(props.scene.metrics.smallSize) * 1.3} fill={theme.accent} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="820" letterSpacing={1.8}>{content.kind === "live-code" ? "LIVE CODE TIMELINE" : "EXECUTION LENS"}</text>
        <text x={lensRect.x + props.scene.metrics.gutter} y={lensRect.y + lensRect.height * 0.33} fill={theme.surface} fontFamily={theme.fontDisplay} fontSize={props.scene.metrics.titleSize * 2.25} fontWeight="830" letterSpacing={-2}>{activeAction?.type === "run" ? "RUN" : `L${activeIndex + 1}`}</text>
        <g data-code-lens-output-font-size={lensOutputFontSize.toFixed(2)}>
          <WrappedText text={activeAction ? lensOutputText : activeLine?.text.trim() ?? lensOutputText} rect={{ x: lensRect.x + props.scene.metrics.gutter, y: lensRect.y + lensRect.height * 0.38, width: lensRect.width - props.scene.metrics.gutter * 2, height: lensRect.height * 0.22 }} theme={theme} fill="#E3E6F1" fontFamily={theme.fontMono} fontSize={lensOutputFontSize} fontWeight="650" maxLines={4} />
        </g>
        <line x1={lensRect.x + props.scene.metrics.gutter} x2={lensRect.x + lensRect.width - props.scene.metrics.gutter} y1={lensRect.y + lensRect.height * 0.64} y2={lensRect.y + lensRect.height * 0.64} stroke={theme.accent} strokeWidth={Math.max(3, props.scene.metrics.unit * 0.34)} />
        {(content.kind === "live-code"
          ? [
              activeAction?.type === "type" ? "TYPING" : "TYPE",
              activeAction?.type === "highlight" || activeAction?.type === "explain" ? "EXPLAINING" : "EXPLAIN",
              activeAction?.type === "run" ? "RUN RESULT" : "RUN",
            ]
          : ["ENTRY", truncate(functionName, 18), `${lines.length} LINES`]
        ).map((label, index) => { const selected = content.kind === "live-code" ? index === (activeAction?.type === "run" ? 2 : activeAction?.type === "highlight" || activeAction?.type === "explain" ? 1 : 0) : index === 1; const y = lensRect.y + lensRect.height * (0.72 + index * 0.09); return <g key={`${label}-${index}`}><circle cx={lensRect.x + props.scene.metrics.gutter + props.scene.metrics.unit * 0.5} cy={y - 5} r={props.scene.metrics.unit * (selected ? 0.58 : 0.38)} fill={selected ? theme.accent : "#B9C0D4"} /><text x={lensRect.x + props.scene.metrics.gutter + props.scene.metrics.unit * 1.7} y={y} fill={selected ? theme.surface : "#E3E6F1"} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight={selected ? "820" : "680"}>{label}</text></g>; })}
      </g> : null}
    </g>
  ));
}

export function FileTreeRenderer(props: SceneRendererProps<FileTreeContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const entries = props.scene.spec.content.entries.slice(0, 18);
  const row = Math.min(body.height / Math.max(entries.length, 1), props.scene.metrics.bodySize * 2.55);
  const treeHeight = Math.min(body.height, row * Math.max(entries.length, 1) + props.scene.metrics.gutter * 1.1);
  const treeTop = body.y + (body.height - treeHeight) / 2;
  const railX = body.x + props.scene.metrics.gutter * 0.48;
  return withFrame(props, (
    <g id="body" data-semantic-role="code">
      <path d={`M ${body.x} ${body.y} H ${body.x + body.width} V ${body.y + body.height} H ${body.x + props.scene.metrics.unit * 1.2} L ${body.x} ${body.y + body.height - props.scene.metrics.unit * 1.2} Z`} fill={`url(#ink-field-${safeId(props.scene.spec.id)})`} filter={`url(#shadow-${safeId(props.scene.spec.id)})`} />
      <path d={`M ${body.x} ${body.y} H ${body.x + body.width} V ${body.y + body.height} H ${body.x + props.scene.metrics.unit * 1.2} L ${body.x} ${body.y + body.height - props.scene.metrics.unit * 1.2} Z`} fill={`url(#micro-grid-${safeId(props.scene.spec.id)})`} opacity="0.62" />
      <rect x={body.x} y={body.y} width={Math.max(8, props.scene.metrics.unit * 0.8)} height={body.height} fill={theme.primary} />
      {Array.from({ length: 9 }, (_, index) => {
        const guideY = body.y + body.height * ((index + 1) / 10);
        return <line key={`repository-guide-${index}`} x1={body.x + props.scene.metrics.gutter * 0.7} x2={body.x + body.width - props.scene.metrics.gutter * 0.55} y1={guideY} y2={guideY} stroke="#707996" strokeWidth={Math.max(3, props.scene.metrics.unit * 0.34)} opacity="0.42" />;
      })}
      {[0.58, 0.72, 0.86].map((ratio) => <line key={`repository-column-${ratio}`} x1={body.x + body.width * ratio} x2={body.x + body.width * ratio} y1={body.y + props.scene.metrics.gutter * 0.5} y2={body.y + body.height - props.scene.metrics.gutter * 0.5} stroke="#707996" strokeWidth={Math.max(3, props.scene.metrics.unit * 0.3)} opacity="0.36" />)}
      <line x1={railX} x2={railX} y1={treeTop + row * 0.25} y2={treeTop + treeHeight - row * 0.3} stroke="#727A96" strokeWidth={Math.max(2, props.scene.metrics.unit * 0.22)} opacity="0.78" />
      {entries.map((entry, index) => {
        const depth = entry.path.split("/").length - 1;
        const name = entry.path.split("/").pop() ?? entry.path;
        const y = treeTop + props.scene.metrics.gutter * 0.52 + row * (index + 0.6);
        const guideX = body.x + props.scene.metrics.gutter + depth * props.scene.metrics.bodySize;
        const iconSize = legible(props.scene.metrics.bodySize * 0.9);
        return <g key={entry.id} id={entry.id}>
          {entry.emphasis ? <path d={`M ${body.x + props.scene.metrics.unit * 0.8} ${y - row * 0.58} H ${body.x + body.width} V ${y + row * 0.36} H ${body.x + props.scene.metrics.unit * 1.3} Z`} fill={theme.primary} opacity="0.18" /> : null}
          <line x1={railX} x2={guideX} y1={y - iconSize * 0.18} y2={y - iconSize * 0.18} stroke={entry.emphasis ? theme.primary : "#727A96"} strokeWidth={entry.emphasis ? 3 : 2} opacity="0.82" />
          <rect x={guideX + 4} y={y - iconSize * 0.82} width={iconSize * 1.02} height={iconSize * 0.78} rx="3" fill={entry.type === "folder" ? theme.warning : "#343A50"} stroke={entry.type === "folder" ? "#FFE0A0" : "#AAB2CA"} strokeWidth="2" />
          <text x={guideX + iconSize * 1.58} y={y} fill={entry.emphasis ? "#C6C3FF" : "#E3E6F1"} fontFamily={theme.fontMono} fontWeight={entry.emphasis ? "820" : "620"} fontSize={legible(props.scene.metrics.bodySize * 0.9)}>{name}</text>
        </g>;
      })}
    </g>
  ));
}

export function TraceRenderer(props: SceneRendererProps<TraceContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const content = props.scene.spec.content;
  const body = bodyRect(props);
  const frames = content.frames.slice(0, 6);
  const active = clamp(content.activeFrame ?? 0, 0, Math.max(0, frames.length - 1));
  const rows = stackRows(body, frames.length, props.scene.metrics.unit * 0.4);
  return withFrame(props, (
    <g id="body" data-semantic-role="code">
      <ReadabilitySurface scene={props.scene} rect={{ x: body.x - props.scene.metrics.gutter * 0.35, y: body.y - props.scene.metrics.gutter * 0.35, width: body.width + props.scene.metrics.gutter * 0.7, height: body.height + props.scene.metrics.gutter * 0.7 }} theme={theme} role="execution-trace" />
      <line x1={body.x + props.scene.metrics.bodySize} x2={body.x + props.scene.metrics.bodySize} y1={body.y} y2={body.y + body.height} stroke={theme.line} strokeWidth="2" />
      {frames.map((trace, index) => { const rect = rows[index]; if (!rect) return null; const isActive = index === active; return <g key={trace.id}><circle cx={body.x + props.scene.metrics.bodySize} cy={rect.y + rect.height / 2} r={isActive ? props.scene.metrics.unit * 0.75 : props.scene.metrics.unit * 0.42} fill={isActive ? theme.primary : theme.paper} stroke={isActive ? theme.primary : theme.line} strokeWidth="3" /><text x={rect.x + props.scene.metrics.gutter * 2.2} y={rect.y + rect.height * 0.57} fill={isActive ? theme.primary : theme.mutedInk} fontFamily={theme.fontMono} fontWeight="800" fontSize={props.scene.metrics.smallSize}>L{trace.line}</text><text x={rect.x + props.scene.metrics.gutter * 4} y={rect.y + rect.height * 0.57} fill={theme.ink} fontFamily={theme.fontBody} fontWeight={isActive ? "750" : "550"} fontSize={props.scene.metrics.bodySize}>{truncate(trace.label, 42)}</text><text x={rect.x + rect.width} y={rect.y + rect.height * 0.57} textAnchor="end" fill={theme.secondary} fontFamily={theme.fontMono} fontSize={props.scene.metrics.smallSize}>{truncate(Object.entries(trace.variables).slice(0, 4).map(([key, value]) => `${key}=${value}`).join("  ·  "), 58)}</text></g>; })}
    </g>
  ));
}

export function VariableStateRenderer(props: SceneRendererProps<VariableStateContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const content = props.scene.spec.content;
  const body = bodyRect(props);
  const [before, after] = props.scene.metrics.columns === 2 ? splitColumns(body, props.scene.metrics.gutter) : stackRows(body, 2, props.scene.metrics.gutter) as readonly [Rect, Rect];
  const renderState = (rect: Rect, title: string, values: Readonly<Record<string, string>>, color: string) => <g><text x={rect.x} y={rect.y + props.scene.metrics.smallSize} fill={color} fontFamily={theme.fontMono} fontWeight="800" fontSize={props.scene.metrics.smallSize * 0.8} letterSpacing="2">{title}</text><line x1={rect.x} x2={rect.x + rect.width} y1={rect.y + props.scene.metrics.bodySize * 1.5} y2={rect.y + props.scene.metrics.bodySize * 1.5} stroke={color} strokeWidth="4" />{Object.entries(values).slice(0, 8).map(([key, value], index) => <g key={key}><text x={rect.x} y={rect.y + props.scene.metrics.gutter * 2.4 + index * props.scene.metrics.bodySize * 1.65} fill={theme.mutedInk} fontFamily={theme.fontMono} fontSize={props.scene.metrics.smallSize}>{key}</text><text x={rect.x + rect.width} y={rect.y + props.scene.metrics.gutter * 2.4 + index * props.scene.metrics.bodySize * 1.65} textAnchor="end" fill={theme.ink} fontFamily={theme.fontMono} fontWeight="750" fontSize={props.scene.metrics.bodySize}>{value}</text></g>)}</g>;
  return withFrame(props, <g id="body"><ReadabilitySurface scene={props.scene} rect={{ x: body.x - props.scene.metrics.gutter * 0.35, y: body.y - props.scene.metrics.gutter * 0.35, width: body.width + props.scene.metrics.gutter * 0.7, height: body.height + props.scene.metrics.gutter * 0.7 }} theme={theme} role="variable-state" />{renderState(before, "BEFORE", content.before, theme.primary)}{renderState(after, "AFTER", content.after, theme.secondary)}{content.operation ? <g><line x1={before.x + before.width} x2={after.x} y1={body.y + body.height * 0.5} y2={body.y + body.height * 0.5} stroke={theme.warning} strokeWidth="4" /><path d={`M ${after.x - props.scene.metrics.unit} ${body.y + body.height * 0.5 - props.scene.metrics.unit} L ${after.x} ${body.y + body.height * 0.5} L ${after.x - props.scene.metrics.unit} ${body.y + body.height * 0.5 + props.scene.metrics.unit}`} fill="none" stroke={theme.warning} strokeWidth="4" /><text x={body.x + body.width / 2} y={body.y + body.height * 0.45} textAnchor="middle" fill={theme.warning} fontFamily={theme.fontMono} fontWeight="800" fontSize={props.scene.metrics.smallSize}>{truncate(content.operation.toUpperCase(), 28)}</text></g> : null}</g>);
}

export function ChartRenderer(props: SceneRendererProps<ChartContent>) {
  const content = props.scene.spec.content;
  if (content.chartType === "line" || content.chartType === "area") return withFrame(props, <Plot sceneProps={props} series={content.series} xLabel={content.xLabel} yLabel={content.yLabel} fillArea={content.chartType === "area"} />);
  const theme = props.theme ?? PRECISION_THEME;
  const body = insetRect(bodyRect(props), props.scene.metrics.gutter * 0.8);
  const values = content.series.flatMap((series) => series.values.map((point) => ({ ...point, series: series.label, color: series.color })));
  const max = Math.max(...values.map((value) => value.y), 1);
  const band = body.width / Math.max(1, values.length);
  const axisBottom = body.y + body.height - legible(props.scene.metrics.smallSize) * 1.9;
  const chartHeight = Math.max(props.scene.metrics.bodySize * 3, axisBottom - body.y);
  const palette = [theme.primary, theme.secondary, theme.warning, theme.critical];
  return withFrame(props, (
    <g id="body" data-semantic-role="data">
      <line x1={body.x} x2={body.x} y1={body.y} y2={axisBottom} stroke={theme.ink} strokeWidth="2" />
      <line x1={body.x} x2={body.x + body.width} y1={axisBottom} y2={axisBottom} stroke={theme.ink} strokeWidth="2" />
      {values.map((value, index) => { const height = value.y / max * chartHeight * 0.82; const color = value.color ?? palette[index % palette.length] ?? theme.primary; const x = body.x + index * band + band * 0.18; return <g key={`${value.series}-${index}`}><rect x={x} y={axisBottom - height} width={band * 0.64} height={height} rx={content.chartType === "dot" ? band * 0.32 : props.scene.metrics.unit * 0.5} fill={color} opacity={content.chartType === "dot" ? 0.85 : 0.9} /><text x={x + band * 0.32} y={axisBottom - height - props.scene.metrics.unit} textAnchor="middle" fill={theme.ink} fontFamily={theme.fontMono} fontSize={props.scene.metrics.smallSize}>{value.y}</text><text x={x + band * 0.32} y={axisBottom + props.scene.metrics.smallSize * 1.3} textAnchor="middle" fill={theme.mutedInk} fontFamily={theme.fontBody} fontSize={props.scene.metrics.smallSize * 0.75}>{value.label ?? value.x}</text></g>; })}
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
  const layout = presenterLayoutFromBody(body, props.scene.metrics, placement, withSlide);
  const portraitRect = layout.stage;
  const unconstrainedSlideRect = layout.insight;
  const pictureInPictureOverlapsInsight = unconstrainedSlideRect
    && placement === "picture-in-picture"
    && unconstrainedSlideRect.x < portraitRect.x
    && unconstrainedSlideRect.x + unconstrainedSlideRect.width > portraitRect.x
    && unconstrainedSlideRect.y < portraitRect.y + portraitRect.height
    && unconstrainedSlideRect.y + unconstrainedSlideRect.height > portraitRect.y;
  const slideRect = unconstrainedSlideRect && props.scene.metrics.profile === "portrait" && pictureInPictureOverlapsInsight
    ? {
        ...unconstrainedSlideRect,
        width: Math.max(1, portraitRect.x - unconstrainedSlideRect.x - props.scene.metrics.gutter * 0.5),
      }
    : unconstrainedSlideRect;
  const titleHeading = comparablePresenterHeading(content.title);
  const points = (content.slideItems ?? [])
    .filter((point) => comparablePresenterHeading(point.text) !== titleHeading)
    .slice(0, 4);
  const pointRows = slideRect ? stackRows({ x: slideRect.x + props.scene.metrics.gutter * 0.6, y: slideRect.y + slideRect.height * 0.16, width: slideRect.width - props.scene.metrics.gutter * 1.2, height: slideRect.height * 0.71 }, Math.max(1, points.length), props.scene.metrics.unit * 0.4) : [];
  return withFrame(props, (
    <g id="body" data-semantic-role="presenter" data-presenter-placement={placement}>
      <PresenterPortraitStage props={props} rect={portraitRect} mediaRect={layout.media} />
      {slideRect ? <g data-presenter-insight="true" data-insight-x={Math.round(slideRect.x)} data-insight-width={Math.round(slideRect.width)}>
        <ReadabilitySurface scene={props.scene} rect={{ x: slideRect.x - props.scene.metrics.gutter * 0.25, y: slideRect.y - props.scene.metrics.gutter * 0.25, width: slideRect.width + props.scene.metrics.gutter * 0.5, height: slideRect.height + props.scene.metrics.gutter * 0.5 }} theme={theme} opacity={0.965} role="presenter-insight" />
        <text x={slideRect.x + props.scene.metrics.gutter * 0.6} y={slideRect.y + legible(props.scene.metrics.smallSize) * 1.2} fill={paperPrimary(theme)} fontFamily={theme.fontMono} fontWeight="820" fontSize={legible(props.scene.metrics.smallSize)} letterSpacing="2.2">{withSlide ? "KEEP THIS IN VIEW" : "PRESENTER NOTE"}</text>
        {withSlide ? points.map((point, index) => {
          const rect = pointRows[index]; if (!rect) return null;
          const color = point.emphasis === "secondary" ? theme.secondary : point.emphasis === "warning" ? theme.warning : index === 1 ? theme.accent : theme.primary;
          const numberColor = point.emphasis === "secondary"
            ? paperSecondary(theme)
            : point.emphasis === "warning" || index === 1
              ? paperWarning(theme)
              : paperPrimary(theme);
          const numberFontSize = legible(props.scene.metrics.titleSize * 1.18);
          const numberColumnWidth = numberFontSize * 1.55;
          const dividerGutter = props.scene.metrics.unit * 3.2;
          const numberRight = rect.x + numberColumnWidth;
          const copyX = numberRight + dividerGutter;
          const dividerX = numberRight + dividerGutter / 2;
          const copyWidth = Math.max(0, rect.x + rect.width - copyX);
          const copyFontSize = legible(props.scene.metrics.bodySize * 1.04);
          const copyLineHeight = copyFontSize * 1.16;
          const maximumCopyLines = props.scene.metrics.profile === "portrait" ? 3 : 2;
          const copyLines = wrapText(point.text, Math.max(8, Math.floor(copyWidth / (copyFontSize * 0.56)))).slice(0, maximumCopyLines);
          const supportingFontSize = legible(props.scene.metrics.smallSize);
          const supportingGap = point.supportingText ? props.scene.metrics.unit * 0.55 : 0;
          const copyBlockHeight = copyLines.length * copyLineHeight + supportingGap + (point.supportingText ? supportingFontSize * 1.08 : 0);
          const copyCenterY = rect.y + rect.height / 2;
          const copyBaselineY = copyCenterY - copyBlockHeight / 2 + copyFontSize;
          const supportingBaselineY = copyBaselineY + copyLines.length * copyLineHeight + supportingGap;
          return <g
            key={point.id}
            id={point.id}
            data-sequence-number-right={numberRight}
            data-sequence-divider-x={dividerX}
            data-sequence-gutter-center-x={dividerX}
            data-sequence-copy-x={copyX}
            data-sequence-copy-width={copyWidth}
            data-sequence-copy-center-y={copyCenterY}
            data-sequence-copy-baseline-y={copyBaselineY}
            data-sequence-row-center-y={rect.y + rect.height / 2}
            data-sequence-number-center-y={copyCenterY}
            data-sequence-number-font-size={numberFontSize}
            style={animationStyle(props.scene.choreography, point.id, props.frame.tick, props.frame.reducedMotion) as CSSProperties}
          >
            <text x={rect.x} y={copyCenterY} dominantBaseline="central" fill={numberColor} fontFamily={theme.fontDisplay} fontSize={numberFontSize} fontWeight="840" letterSpacing={-1.2}>{String(index + 1).padStart(2, "0")}</text>
            <line x1={dividerX} x2={dividerX} y1={rect.y + rect.height * 0.18} y2={rect.y + rect.height * 0.82} stroke={color} strokeWidth={Math.max(5, props.scene.metrics.unit * 0.48)} />
            <MultilineText x={copyX} y={copyBaselineY} lines={copyLines} lineHeight={copyLineHeight} fill={theme.ink} fontFamily={theme.fontBody} fontSize={copyFontSize} fontWeight="720" maxLines={maximumCopyLines} />
            {point.supportingText ? <MultilineText x={copyX} y={supportingBaselineY} lines={[truncate(point.supportingText, Math.max(12, Math.floor(copyWidth / (supportingFontSize * 0.56))))]} lineHeight={supportingFontSize * 1.08} fill={theme.mutedInk} fontFamily={theme.fontBody} fontSize={supportingFontSize} fontWeight="600" maxLines={1} /> : null}
          </g>;
        }) : content.talkingPoint ? <g><path d={`M ${slideRect.x + props.scene.metrics.gutter * 0.6} ${slideRect.y + slideRect.height * 0.24} H ${slideRect.x + slideRect.width - props.scene.metrics.gutter * 0.6}`} stroke={theme.secondary} strokeWidth={Math.max(5, props.scene.metrics.unit * 0.5)} /><WrappedText text={content.talkingPoint} rect={{ x: slideRect.x + props.scene.metrics.gutter * 0.6, y: slideRect.y + slideRect.height * 0.34, width: slideRect.width - props.scene.metrics.gutter * 1.2, height: slideRect.height * 0.48 }} theme={theme} fontFamily={theme.fontDisplay} fontSize={legible(props.scene.metrics.subtitleSize * 1.2)} fontWeight="730" maxLines={5} lineHeight={1.12} /></g> : null}
      </g> : null}
    </g>
  ));
}

function PresenterPortraitStage({ props, rect, mediaRect }: { readonly props: SceneRendererProps<PresenterContent>; readonly rect: Rect; readonly mediaRect: Rect }) {
  const theme = props.theme ?? PRECISION_THEME;
  const content = props.scene.spec.content;
  const name = content.presenterName ?? "Presenter";
  const nameFontSize = legible(props.scene.metrics.bodySize * (name.length > 44 ? 0.75 : name.length > 28 ? 0.88 : 1.04));
  const nameMaxChars = Math.max(12, Math.floor((rect.width - props.scene.metrics.gutter * 1.4) / (nameFontSize * 0.56)));
  const nameLines = wrapText(name, nameMaxChars);
  const nameLineHeight = nameFontSize * 1.08;
  const idle = content.idleMotion;
  const elapsedSeconds = props.frame.tick / 240_000;
  const breathingScale = idle?.enabled && idle.breathing && !props.frame.reducedMotion
    ? 1 + Math.sin((elapsedSeconds / 4.8) * Math.PI * 2) * 0.0035
    : 1;
  const blinkCycle = (elapsedSeconds + 1.35) % 4.7;
  const blinkPhase = idle?.enabled && idle.blink && !props.frame.reducedMotion && blinkCycle < 0.12
    ? Math.max(0, Math.min(1, Math.abs(blinkCycle - 0.06) / 0.06))
    : 1;
  const mediaCenterX = mediaRect.x + mediaRect.width / 2;
  const mediaCenterY = mediaRect.y + mediaRect.height * 0.78;
  return <g data-presenter-stage="portrait" data-stage-x={Math.round(rect.x)} data-stage-y={Math.round(rect.y)} data-stage-width={Math.round(rect.width)} data-stage-height={Math.round(rect.height)}>
    <path d={`M ${rect.x} ${rect.y} H ${rect.x + rect.width} V ${rect.y + rect.height} H ${rect.x + props.scene.metrics.unit * 1.2} L ${rect.x} ${rect.y + rect.height - props.scene.metrics.unit * 1.2} Z`} fill={`url(#ink-field-${safeId(props.scene.spec.id)})`} filter={`url(#soft-shadow-${safeId(props.scene.spec.id)})`} />
    <path d={`M ${rect.x} ${rect.y} H ${rect.x + rect.width} V ${rect.y + rect.height} H ${rect.x + props.scene.metrics.unit * 1.2} L ${rect.x} ${rect.y + rect.height - props.scene.metrics.unit * 1.2} Z`} fill={`url(#micro-grid-${safeId(props.scene.spec.id)})`} opacity="0.58" />
    <g
      data-presenter-media="true"
      data-media-x={Math.round(mediaRect.x)}
      data-media-y={Math.round(mediaRect.y)}
      data-media-width={Math.round(mediaRect.width)}
      data-media-height={Math.round(mediaRect.height)}
      data-idle-animation={idle?.enabled ? "enabled" : "disabled"}
      data-idle-blink={idle?.blink ? "enabled" : "disabled"}
      data-idle-blink-phase={blinkPhase.toFixed(4)}
      data-idle-breathing={idle?.breathing ? "enabled" : "disabled"}
      data-rest-mouth={idle?.restMouth ?? "closed"}
      transform={`translate(${mediaCenterX} ${mediaCenterY}) scale(${breathingScale}) translate(${-mediaCenterX} ${-mediaCenterY})`}
    >
      {content.portrait ? <AssetFrame asset={content.portrait} rect={mediaRect} resolveAsset={props.resolveAsset} theme={theme} label="" /> : <FictionalPresenterSilhouette rect={mediaRect} theme={theme} />}
    </g>
    <path d={`M ${rect.x} ${rect.y + rect.height * 0.74} H ${rect.x + rect.width} V ${rect.y + rect.height} H ${rect.x + props.scene.metrics.unit * 1.2} L ${rect.x} ${rect.y + rect.height - props.scene.metrics.unit * 1.2} Z`} fill={theme.codeBackground} opacity="0.97" />
    <line x1={rect.x + props.scene.metrics.gutter * 0.7} x2={rect.x + rect.width * 0.42} y1={rect.y + rect.height * 0.79} y2={rect.y + rect.height * 0.79} stroke={theme.accent} strokeWidth={Math.max(4, props.scene.metrics.unit * 0.42)} />
    <text x={rect.x + props.scene.metrics.gutter * 0.7} y={rect.y + rect.height * 0.845} fill="#AEB6CE" fontFamily={theme.fontMono} fontWeight="760" fontSize={legible(props.scene.metrics.smallSize * 0.76)} letterSpacing="1.6">YOUR INSTRUCTOR</text>
    <MultilineText x={rect.x + props.scene.metrics.gutter * 0.7} y={rect.y + rect.height * 0.955} lines={nameLines} lineHeight={nameLineHeight} fill={theme.surface} fontFamily={theme.fontDisplay} fontWeight="780" fontSize={nameFontSize} maxLines={3} />
  </g>;
}

function FictionalPresenterSilhouette({ rect, theme }: { readonly rect: Rect; readonly theme: typeof PRECISION_THEME }) {
  const cx = rect.x + rect.width * 0.5;
  const headY = rect.y + rect.height * 0.32;
  const headR = Math.min(rect.width, rect.height) * 0.135;
  return <g aria-label="Fictional presenter placeholder">
    <circle cx={rect.x + rect.width * 0.78} cy={rect.y + rect.height * 0.2} r={Math.min(rect.width, rect.height) * 0.2} fill={theme.accent} opacity="0.9" />
    <path d={`M ${rect.x + rect.width * 0.06} ${rect.y + rect.height * 0.86} C ${rect.x + rect.width * 0.16} ${rect.y + rect.height * 0.6}, ${rect.x + rect.width * 0.3} ${rect.y + rect.height * 0.5}, ${cx} ${rect.y + rect.height * 0.5} C ${rect.x + rect.width * 0.7} ${rect.y + rect.height * 0.5}, ${rect.x + rect.width * 0.84} ${rect.y + rect.height * 0.6}, ${rect.x + rect.width * 0.94} ${rect.y + rect.height * 0.86} Z`} fill={theme.secondary} />
    <path d={`M ${rect.x + rect.width * 0.08} ${rect.y + rect.height * 0.86} C ${rect.x + rect.width * 0.22} ${rect.y + rect.height * 0.68}, ${rect.x + rect.width * 0.34} ${rect.y + rect.height * 0.62}, ${cx} ${rect.y + rect.height * 0.62} C ${rect.x + rect.width * 0.66} ${rect.y + rect.height * 0.62}, ${rect.x + rect.width * 0.78} ${rect.y + rect.height * 0.68}, ${rect.x + rect.width * 0.92} ${rect.y + rect.height * 0.86}`} fill="none" stroke="#8BD7CF" strokeWidth={Math.max(5, headR * 0.12)} opacity="0.88" />
    <circle cx={cx} cy={headY} r={headR} fill="#D3A17D" />
    <path d={`M ${cx - headR * 0.96} ${headY - headR * 0.04} C ${cx - headR * 0.7} ${headY - headR * 1.15}, ${cx + headR * 0.68} ${headY - headR * 1.22}, ${cx + headR * 1.02} ${headY - headR * 0.02} C ${cx + headR * 0.52} ${headY - headR * 0.5}, ${cx - headR * 0.28} ${headY - headR * 0.36}, ${cx - headR * 0.96} ${headY - headR * 0.04} Z`} fill="#222538" />
    <circle cx={cx - headR * 0.36} cy={headY + headR * 0.08} r={Math.max(2, headR * 0.055)} fill={theme.ink} />
    <circle cx={cx + headR * 0.36} cy={headY + headR * 0.08} r={Math.max(2, headR * 0.055)} fill={theme.ink} />
    <path d={`M ${cx - headR * 0.22} ${headY + headR * 0.48} Q ${cx} ${headY + headR * 0.62} ${cx + headR * 0.22} ${headY + headR * 0.48}`} fill="none" stroke="#8C5144" strokeWidth={Math.max(2, headR * 0.05)} strokeLinecap="round" />
  </g>;
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
  const isWide = props.scene.metrics.columns === 2;
  const questionRect: Rect = isWide
    ? { x: body.x + body.width * 0.06, y: body.y + body.height * 0.13, width: body.width * 0.63, height: body.height * 0.58 }
    : { x: body.x + body.width * 0.08, y: body.y + body.height * 0.12, width: body.width * 0.84, height: body.height * 0.5 };
  const markX = isWide ? body.x + body.width * 0.84 : body.x + body.width * 0.5;
  const markY = isWide ? body.y + body.height * 0.41 : body.y + body.height * 0.76;
  return withFrame(props, (
    <g id="body" data-semantic-role="content">
      <path d={`M ${body.x} ${body.y + body.height * 0.04} H ${body.x + body.width * (isWide ? 0.73 : 1)} L ${body.x + body.width * (isWide ? 0.66 : 0.92)} ${body.y + body.height * 0.78} H ${body.x} Z`} fill={`url(#ink-field-${safeId(props.scene.spec.id)})`} filter={`url(#soft-shadow-${safeId(props.scene.spec.id)})`} />
      <path d={`M ${body.x} ${body.y + body.height * 0.04} H ${body.x + body.width * (isWide ? 0.73 : 1)} L ${body.x + body.width * (isWide ? 0.66 : 0.92)} ${body.y + body.height * 0.78} H ${body.x} Z`} fill={`url(#micro-grid-${safeId(props.scene.spec.id)})`} opacity="0.54" />
      <text x={questionRect.x} y={questionRect.y + legible(props.scene.metrics.smallSize)} fill={theme.accent} fontFamily={theme.fontMono} fontWeight="820" fontSize={legible(props.scene.metrics.smallSize)} letterSpacing={2.2}>MAKE A PREDICTION</text>
      <WrappedText text={content.question} rect={{ ...questionRect, y: questionRect.y + questionRect.height * 0.18, height: questionRect.height * 0.72 }} theme={theme} fill={theme.surface} fontFamily={theme.fontDisplay} fontSize={props.scene.metrics.titleSize * (isWide ? 1.05 : 0.82)} fontWeight="760" maxLines={isWide ? 4 : 6} lineHeight={1.08} />
      <circle cx={markX} cy={markY} r={props.scene.metrics.titleSize * 1.72} fill={theme.accent} opacity="0.2" />
      <circle cx={markX} cy={markY} r={props.scene.metrics.titleSize * 1.12} fill={theme.primary} />
      <text x={markX} y={markY + props.scene.metrics.titleSize * 0.5} textAnchor="middle" fill={theme.surface} fontFamily={theme.fontDisplay} fontWeight="840" fontSize={props.scene.metrics.titleSize * 1.45}>?</text>
      {content.prompt ? <g data-text-role="paper-secondary"><line x1={body.x + body.width * 0.1} x2={body.x + body.width * 0.9} y1={body.y + body.height * 0.85} y2={body.y + body.height * 0.85} stroke={theme.secondary} strokeWidth={Math.max(4, props.scene.metrics.unit * 0.4)} /><text x={body.x + body.width * 0.1} y={body.y + body.height * 0.94} fill={paperSecondary(theme)} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="820" letterSpacing={1.6}>HINT</text><WrappedText text={content.prompt} rect={{ x: body.x + body.width * 0.18, y: body.y + body.height * 0.88, width: body.width * 0.53, height: body.height * 0.1 }} theme={theme} fontSize={legible(props.scene.metrics.bodySize)} fill={theme.ink} fontWeight="660" maxLines={2} /></g> : null}
      {seconds > 0 ? <g><circle cx={body.x + body.width * 0.88} cy={body.y + body.height * 0.91} r={props.scene.metrics.bodySize * 1.35} fill="none" stroke={theme.line} strokeWidth={Math.max(4, props.scene.metrics.unit * 0.4)} /><path d={`M ${body.x + body.width * 0.88} ${body.y + body.height * 0.91 - props.scene.metrics.bodySize * 1.35} A ${props.scene.metrics.bodySize * 1.35} ${props.scene.metrics.bodySize * 1.35} 0 0 1 ${body.x + body.width * 0.88 + props.scene.metrics.bodySize * 1.35} ${body.y + body.height * 0.91}`} fill="none" stroke={theme.secondary} strokeWidth={Math.max(4, props.scene.metrics.unit * 0.4)} strokeLinecap="round" /><text x={body.x + body.width * 0.88} y={body.y + body.height * 0.91 + legible(props.scene.metrics.smallSize) * 0.36} textAnchor="middle" fill={theme.ink} fontFamily={theme.fontMono} fontWeight="820" fontSize={legible(props.scene.metrics.smallSize)}>{Math.ceil(remaining)}s</text></g> : null}
    </g>
  ));
}

export function WorkedExampleRenderer(props: SceneRendererProps<WorkedExampleContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const content = props.scene.spec.content;
  const isWide = props.scene.metrics.columns === 2;
  const stepItems = content.steps.slice(0, 4);
  const problem: Rect = { x: body.x, y: body.y, width: body.width, height: body.height * 0.14 };
  const stage: Rect = { x: body.x, y: body.y + body.height * 0.18, width: body.width, height: body.height * 0.58 };
  const answer: Rect = { x: body.x, y: body.y + body.height * 0.81, width: body.width, height: body.height * 0.17 };
  const stepRects = isWide
    ? splitSequenceColumns(stage, stepItems.length, props.scene.metrics.gutter * 0.8)
    : stackRows(stage, stepItems.length, props.scene.metrics.unit * 0.65);
  return withFrame(props, <g id="body" data-semantic-role="visual">
    <ReadabilitySurface scene={props.scene} rect={{ x: problem.x - props.scene.metrics.gutter * 0.25, y: problem.y - props.scene.metrics.gutter * 0.18, width: problem.width + props.scene.metrics.gutter * 0.5, height: problem.height + props.scene.metrics.gutter * 0.35 }} theme={theme} opacity={0.965} role="worked-problem" />
    <ReadabilitySurface scene={props.scene} rect={{ x: answer.x - props.scene.metrics.gutter * 0.25, y: answer.y - props.scene.metrics.gutter * 0.18, width: answer.width + props.scene.metrics.gutter * 0.5, height: answer.height + props.scene.metrics.gutter * 0.32 }} theme={theme} opacity={0.965} role="worked-answer" />
    <text x={problem.x} y={problem.y + legible(props.scene.metrics.smallSize)} fill={paperWarning(theme)} fontFamily={theme.fontMono} fontWeight="820" fontSize={legible(props.scene.metrics.smallSize)} letterSpacing="2">STARTING STATE</text>
    <WrappedText text={content.problem} rect={{ x: problem.x + body.width * (isWide ? 0.17 : 0), y: problem.y + (isWide ? -legible(props.scene.metrics.bodySize) * 0.36 : legible(props.scene.metrics.smallSize) * 1.55), width: problem.width * (isWide ? 0.81 : 1), height: problem.height * (isWide ? 1 : 0.58) }} theme={theme} fontSize={legible(props.scene.metrics.bodySize * 1.12)} fontWeight="710" maxLines={2} />
    <path d={`M ${stage.x} ${stage.y + stage.height * 0.05} H ${stage.x + stage.width} V ${stage.y + stage.height * 0.95} H ${stage.x} Z`} fill={`url(#ink-field-${safeId(props.scene.spec.id)})`} filter={`url(#soft-shadow-${safeId(props.scene.spec.id)})`} />
    <path d={`M ${stage.x} ${stage.y + stage.height * 0.05} H ${stage.x + stage.width} V ${stage.y + stage.height * 0.95} H ${stage.x} Z`} fill={`url(#micro-grid-${safeId(props.scene.spec.id)})`} opacity="0.64" />
    {stepItems.map((step, index) => {
      const rect = stepRects[index]; if (!rect) return null;
      const color = index === stepItems.length - 1 ? theme.secondary : index === 1 ? theme.accent : theme.primary;
      const glyphRect: Rect = isWide
        ? { x: rect.x + rect.width * 0.14, y: rect.y + rect.height * 0.16, width: rect.width * 0.72, height: rect.height * 0.42 }
        : { x: rect.x + rect.width * 0.04, y: rect.y + rect.height * 0.12, width: rect.width * 0.25, height: rect.height * 0.74 };
      const copyRect: Rect = isWide
        ? { x: rect.x + rect.width * 0.04, y: rect.y + rect.height * 0.64, width: rect.width * 0.92, height: rect.height * 0.28 }
        : { x: rect.x + rect.width * 0.34, y: rect.y + rect.height * 0.12, width: rect.width * 0.62, height: rect.height * 0.74 };
      const stepTone = index === stepItems.length - 1 ? "secondary" : index === 1 ? "warning" : "primary";
      const stepNumberPlate = {
        x: rect.x + props.scene.metrics.unit * 0.62,
        y: rect.y + rect.height * 0.073,
        width: legible(props.scene.metrics.smallSize) * 2.5,
        height: legible(props.scene.metrics.smallSize) * 1.62,
      };
      return <g key={step.id} id={step.id} data-transformation-state={index + 1} style={animationStyle(props.scene.choreography, step.id, props.frame.tick, props.frame.reducedMotion) as CSSProperties}>
        <g data-contrast-surface="worked-step-number">
          <rect {...stepNumberPlate} fill={accentPlate(theme, stepTone)} />
          <text x={stepNumberPlate.x + stepNumberPlate.width / 2} y={stepNumberPlate.y + legible(props.scene.metrics.smallSize) * 1.17} textAnchor="middle" fill={theme.surface} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="840">{String(index + 1).padStart(2, "0")}</text>
        </g>
        <TransformationGlyph index={index} count={stepItems.length} rect={glyphRect} color={color} theme={theme} />
        <WrappedText text={step.text} rect={copyRect} theme={theme} fill={theme.surface} fontSize={legible(props.scene.metrics.bodySize * (isWide ? 0.92 : 1.02))} fontWeight="720" textAnchor={isWide ? "middle" : "start"} maxLines={isWide ? 3 : 2} lineHeight={1.16} />
        {step.supportingText ? <WrappedText text={step.supportingText} rect={{ ...copyRect, y: copyRect.y + copyRect.height * 0.48, height: copyRect.height * 0.52 }} theme={theme} fill="#BFC6DA" fontSize={legible(props.scene.metrics.smallSize)} fontWeight="600" textAnchor={isWide ? "middle" : "start"} maxLines={2} /> : null}
        {index < stepItems.length - 1 ? <g aria-hidden="true"><line x1={isWide ? rect.x + rect.width : rect.x + rect.width * 0.18} x2={isWide ? rect.x + rect.width + props.scene.metrics.gutter * 0.66 : rect.x + rect.width * 0.18} y1={isWide ? stage.y + stage.height * 0.48 : rect.y + rect.height} y2={isWide ? stage.y + stage.height * 0.48 : rect.y + rect.height + props.scene.metrics.unit * 0.65} stroke={theme.accent} strokeWidth={Math.max(4, props.scene.metrics.unit * 0.42)} /><path d={isWide ? `M ${rect.x + rect.width + props.scene.metrics.gutter * 0.66} ${stage.y + stage.height * 0.48} l ${-props.scene.metrics.unit} ${-props.scene.metrics.unit * 0.72} v ${props.scene.metrics.unit * 1.44} z` : `M ${rect.x + rect.width * 0.18} ${rect.y + rect.height + props.scene.metrics.unit * 0.65} l ${-props.scene.metrics.unit * 0.72} ${-props.scene.metrics.unit} h ${props.scene.metrics.unit * 1.44} z`} fill={theme.accent} /></g> : null}
      </g>;
    })}
    <line x1={answer.x} x2={answer.x + answer.width} y1={answer.y} y2={answer.y} stroke={theme.secondary} strokeWidth={Math.max(5, props.scene.metrics.unit * 0.58)} />
    <text x={answer.x} y={answer.y + legible(props.scene.metrics.smallSize) * 1.55} fill={paperSecondary(theme)} fontFamily={theme.fontMono} fontWeight="820" fontSize={legible(props.scene.metrics.smallSize)} letterSpacing="2">RESOLVED STATE</text>
    <WrappedText text={content.answer} rect={{ x: answer.x + answer.width * (isWide ? 0.18 : 0), y: answer.y + (isWide ? props.scene.metrics.unit * 0.45 : legible(props.scene.metrics.smallSize) * 2.15), width: answer.width * (isWide ? 0.8 : 1), height: answer.height * (isWide ? 1 : 0.55) }} theme={theme} fontSize={legible(props.scene.metrics.subtitleSize * 1.08)} fontWeight="790" maxLines={2} />
  </g>);
}

function TransformationGlyph({ index, count, rect, color, theme }: { readonly index: number; readonly count: number; readonly rect: Rect; readonly color: string; readonly theme: typeof PRECISION_THEME }) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const unit = Math.min(rect.width, rect.height);
  if (index === 0) return <g aria-hidden="true"><rect x={cx - unit * 0.45} y={cy - unit * 0.22} width={unit * 0.9} height={unit * 0.44} fill={color} /><line x1={cx} x2={cx} y1={cy - unit * 0.35} y2={cy + unit * 0.35} stroke={theme.surface} strokeWidth={Math.max(3, unit * 0.05)} /><path d={`M ${cx - unit * 0.52} ${cy - unit * 0.35} v ${unit * 0.7} M ${cx + unit * 0.52} ${cy - unit * 0.35} v ${unit * 0.7}`} stroke={theme.surface} strokeWidth={Math.max(2, unit * 0.025)} opacity="0.65" /></g>;
  if (index === count - 1) return <g aria-hidden="true"><path d={`M ${cx - unit * 0.5} ${cy - unit * 0.28} C ${cx - unit * 0.18} ${cy - unit * 0.28}, ${cx - unit * 0.18} ${cy}, ${cx} ${cy} C ${cx + unit * 0.18} ${cy}, ${cx + unit * 0.18} ${cy + unit * 0.28}, ${cx + unit * 0.5} ${cy + unit * 0.28}`} fill="none" stroke={color} strokeWidth={Math.max(6, unit * 0.08)} strokeLinecap="round" /><path d={`M ${cx + unit * 0.5} ${cy + unit * 0.28} l ${-unit * 0.16} ${-unit * 0.16} v ${unit * 0.32} z`} fill={color} /></g>;
  return <g aria-hidden="true">{[-0.42, 0, 0.42].map((offset, nodeIndex) => <g key={offset}><circle cx={cx + offset * unit} cy={cy + (nodeIndex % 2 ? -0.12 : 0.12) * unit} r={unit * 0.2} fill={nodeIndex === 1 ? color : "none"} stroke={color} strokeWidth={Math.max(4, unit * 0.055)} /><path d={`M ${cx + offset * unit - unit * 0.08} ${cy + (nodeIndex % 2 ? -0.12 : 0.12) * unit} h ${unit * 0.16}`} stroke={nodeIndex === 1 ? theme.ink : theme.surface} strokeWidth={Math.max(2, unit * 0.03)} /></g>)}</g>;
}

function splitSequenceColumns(rect: Rect, count: number, gap: number): readonly Rect[] {
  if (count <= 0) return [];
  const width = (rect.width - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, index) => ({ x: rect.x + index * (width + gap), y: rect.y, width, height: rect.height }));
}

export function QuizRenderer(props: SceneRendererProps<QuizContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const content = props.scene.spec.content;
  const options = content.options.slice(0, 6);
  const isWide = props.scene.metrics.columns === 2;
  const questionPanel: Rect = isWide
    ? { x: body.x, y: body.y + body.height * 0.04, width: body.width * 0.4, height: body.height * 0.86 }
    : { x: body.x, y: body.y, width: body.width, height: body.height * 0.34 };
  const optionArea: Rect = isWide
    ? { x: body.x + body.width * 0.46, y: body.y + body.height * 0.04, width: body.width * 0.54, height: body.height * (content.explanation ? 0.69 : 0.84) }
    : { x: body.x, y: body.y + body.height * 0.4, width: body.width, height: body.height * (content.explanation ? 0.43 : 0.56) };
  const rows = stackRows(optionArea, options.length, props.scene.metrics.unit);
  const answerRevealed = content.revealAnswer && props.frame.tick >= Math.round(props.scene.spec.durationTicks * 0.58);
  return withFrame(props, (
    <g id="body" data-semantic-role="content">
      <ReadabilitySurface scene={props.scene} rect={{ x: optionArea.x - props.scene.metrics.gutter * 0.42, y: optionArea.y - props.scene.metrics.gutter * 0.35, width: optionArea.width + props.scene.metrics.gutter * 0.84, height: (content.explanation ? body.y + body.height - optionArea.y : optionArea.height) + props.scene.metrics.gutter * 0.7 }} theme={theme} opacity={0.965} role="quiz-options" />
      <path d={`M ${questionPanel.x} ${questionPanel.y} H ${questionPanel.x + questionPanel.width * 0.94} L ${questionPanel.x + questionPanel.width} ${questionPanel.y + questionPanel.height * 0.12} V ${questionPanel.y + questionPanel.height} H ${questionPanel.x} Z`} fill={`url(#ink-field-${safeId(props.scene.spec.id)})`} filter={`url(#shadow-${safeId(props.scene.spec.id)})`} />
      <path d={`M ${questionPanel.x} ${questionPanel.y} H ${questionPanel.x + questionPanel.width * 0.94} L ${questionPanel.x + questionPanel.width} ${questionPanel.y + questionPanel.height * 0.12} V ${questionPanel.y + questionPanel.height} H ${questionPanel.x} Z`} fill={`url(#micro-grid-${safeId(props.scene.spec.id)})`} opacity="0.52" />
      <text x={questionPanel.x + props.scene.metrics.gutter * 0.8} y={questionPanel.y + legible(props.scene.metrics.smallSize) * 1.35} fill={theme.accent} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="820" letterSpacing={2}>RETRIEVAL CHECK</text>
      <WrappedText text={content.question} rect={{ x: questionPanel.x + props.scene.metrics.gutter * 0.8, y: questionPanel.y + questionPanel.height * 0.23, width: questionPanel.width - props.scene.metrics.gutter * 1.6, height: questionPanel.height * 0.52 }} theme={theme} fill={theme.surface} fontSize={props.scene.metrics.titleSize * (isWide ? 0.92 : 0.72)} fontFamily={theme.fontDisplay} fontWeight="750" maxLines={isWide ? 5 : 3} lineHeight={1.12} />
      {options.map((option, index) => {
        const rect = rows[index]; if (!rect) return null;
        const reveal = answerRevealed && option.correct;
        const color = reveal ? theme.secondary : index % 2 ? theme.primary : theme.mutedInk;
        return <g key={option.id} id={option.id} data-answer-state={reveal ? "correct" : "option"}>
          {reveal ? <path d={`M ${rect.x - props.scene.metrics.unit} ${rect.y} H ${rect.x + rect.width} V ${rect.y + rect.height} H ${rect.x} Z`} fill={theme.secondary} opacity="0.12" /> : null}
          <text x={rect.x} y={rect.y + rect.height * 0.7} fill={reveal ? paperSecondary(theme) : color} fontFamily={theme.fontDisplay} fontWeight="840" fontSize={props.scene.metrics.titleSize * 1.28}>{String.fromCharCode(65 + index)}</text>
          <line x1={rect.x + props.scene.metrics.titleSize * 1.65} x2={rect.x + props.scene.metrics.titleSize * 1.65} y1={rect.y + rect.height * 0.16} y2={rect.y + rect.height * 0.84} stroke={color} strokeWidth={reveal ? Math.max(5, props.scene.metrics.unit * 0.5) : Math.max(2, props.scene.metrics.unit * 0.22)} />
          <text x={rect.x + props.scene.metrics.titleSize * 2.08} y={rect.y + rect.height * 0.63} fill={theme.ink} fontFamily={theme.fontBody} fontWeight={reveal ? "780" : "610"} fontSize={legible(props.scene.metrics.bodySize * 1.08)}>{truncate(option.label, 54)}</text>
          {reveal ? <g><circle cx={rect.x + rect.width - props.scene.metrics.bodySize * 0.8} cy={rect.y + rect.height * 0.5} r={props.scene.metrics.bodySize * 0.68} fill={theme.secondary} /><path d={`M ${rect.x + rect.width - props.scene.metrics.bodySize * 1.08} ${rect.y + rect.height * 0.5} l ${props.scene.metrics.bodySize * 0.2} ${props.scene.metrics.bodySize * 0.2} l ${props.scene.metrics.bodySize * 0.42} ${-props.scene.metrics.bodySize * 0.46}`} fill="none" stroke={theme.surface} strokeWidth={Math.max(3, props.scene.metrics.unit * 0.3)} strokeLinecap="round" strokeLinejoin="round" /></g> : null}
        </g>;
      })}
      {answerRevealed && content.explanation ? <g data-text-role="paper-secondary"><line x1={optionArea.x} x2={optionArea.x + optionArea.width} y1={body.y + body.height * 0.81} y2={body.y + body.height * 0.81} stroke={theme.secondary} strokeWidth={Math.max(4, props.scene.metrics.unit * 0.4)} /><WrappedText text={content.explanation} rect={{ x: optionArea.x, y: body.y + body.height * 0.84, width: optionArea.width, height: body.height * 0.13 }} theme={theme} fontSize={legible(props.scene.metrics.smallSize)} fill={paperSecondary(theme)} fontWeight="700" maxLines={2} /></g> : null}
    </g>
  ));
}

export function SourcesRenderer(props: SceneRendererProps<SourcesContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const body = bodyRect(props);
  const sources = props.scene.spec.content.sources.slice(0, props.scene.metrics.profile === "portrait" ? 8 : 10);
  const isWide = props.scene.metrics.columns === 2;
  const columns = isWide ? 2 : 1;
  const rowCount = Math.ceil(sources.length / columns);
  const columnGap = props.scene.metrics.gutter * 1.1;
  const columnWidth = (body.width - columnGap * (columns - 1)) / columns;
  const rowGap = props.scene.metrics.unit * 0.7;
  const rowHeight = (body.height - rowGap * Math.max(0, rowCount - 1)) / Math.max(1, rowCount);
  const sourceRects = sources.map((_, index) => {
    const column = isWide ? index % 2 : 0;
    const row = isWide ? Math.floor(index / 2) : index;
    return {
      x: body.x + column * (columnWidth + columnGap),
      y: body.y + row * (rowHeight + rowGap),
      width: columnWidth,
      height: rowHeight,
    };
  });
  return withFrame(props, (
    <g id="body" data-semantic-role="source" data-visual-grammar="recap-source-ledger">
      {sources.map((source, index) => {
        const rect = sourceRects[index];
        if (!rect) return null;
        const sourceRecord = source.creator === "VERIFIED SOURCE";
        const color = sourceRecord ? theme.secondary : index % 2 ? theme.warning : theme.primary;
        const meta = [source.creator, source.license, source.locator].filter(Boolean).join(" · ");
        return <g key={source.id} data-ledger-kind={sourceRecord ? "source" : "concept"}>
          <path d={`M ${rect.x} ${rect.y + rect.height * 0.06} H ${rect.x + rect.width} V ${rect.y + rect.height * 0.94} H ${rect.x + props.scene.metrics.unit * 0.72} L ${rect.x} ${rect.y + rect.height * 0.82} Z`} fill={sourceRecord ? shade(theme.secondary, 0.22) : theme.surface} stroke={color} strokeWidth={Math.max(2, props.scene.metrics.unit * 0.22)} filter={`url(#soft-shadow-${safeId(props.scene.spec.id)})`} />
          <rect x={rect.x} y={rect.y + rect.height * 0.06} width={Math.max(7, props.scene.metrics.unit * 0.58)} height={rect.height * 0.88} fill={color} />
          <circle cx={rect.x + props.scene.metrics.gutter * 0.72} cy={rect.y + rect.height / 2} r={props.scene.metrics.smallSize * 0.72} fill={color} />
          <text x={rect.x + props.scene.metrics.gutter * 0.72} y={rect.y + rect.height / 2 + props.scene.metrics.smallSize * 0.32} textAnchor="middle" fill={theme.surface} fontFamily={theme.fontMono} fontWeight="840" fontSize={props.scene.metrics.smallSize * 0.72}>{source.marker ?? index + 1}</text>
          <WrappedText text={source.title} rect={{ x: rect.x + props.scene.metrics.gutter * 1.4, y: rect.y + rect.height * 0.2, width: rect.width - props.scene.metrics.gutter * 1.8, height: rect.height * 0.42 }} theme={theme} fill={sourceRecord ? theme.surface : theme.ink} fontFamily={theme.fontBody} fontWeight="720" fontSize={legible(props.scene.metrics.smallSize * 0.9)} maxLines={2} lineHeight={1.1} />
          {meta ? <WrappedText text={meta} rect={{ x: rect.x + props.scene.metrics.gutter * 1.4, y: rect.y + rect.height * 0.66, width: rect.width - props.scene.metrics.gutter * 1.8, height: rect.height * 0.2 }} theme={theme} fill={sourceRecord ? "#C8EAE5" : theme.mutedInk} fontFamily={theme.fontMono} fontWeight="760" fontSize={legible(props.scene.metrics.smallSize * 0.65)} maxLines={1} /> : null}
        </g>;
      })}
    </g>
  ));
}

export function OutroRenderer(props: SceneRendererProps<OutroContent>) {
  const theme = props.theme ?? PRECISION_THEME;
  const content = props.scene.spec.content;
  const safe = props.scene.metrics.safe;
  return withFrame(props, (
    <g id="body" data-semantic-role="content">
      <path d={`M ${safe.x} ${safe.y + safe.height * 0.08} H ${safe.x + safe.width} V ${safe.y + safe.height * 0.78} H ${safe.x + safe.width * 0.05} L ${safe.x} ${safe.y + safe.height * 0.7} Z`} fill={`url(#ink-field-${safeId(props.scene.spec.id)})`} filter={`url(#soft-shadow-${safeId(props.scene.spec.id)})`} />
      <path d={`M ${safe.x} ${safe.y + safe.height * 0.08} H ${safe.x + safe.width} V ${safe.y + safe.height * 0.78} H ${safe.x + safe.width * 0.05} L ${safe.x} ${safe.y + safe.height * 0.7} Z`} fill={`url(#micro-grid-${safeId(props.scene.spec.id)})`} opacity="0.5" />
      <circle cx={safe.x + safe.width * 0.13} cy={safe.y + safe.height * 0.31} r={props.scene.metrics.titleSize * 1.22} fill={theme.accent} opacity="0.16" />
      <circle cx={safe.x + safe.width * 0.13} cy={safe.y + safe.height * 0.31} r={props.scene.metrics.titleSize * 0.76} fill={theme.secondary} />
      <path d={`M ${safe.x + safe.width * 0.13 - props.scene.metrics.titleSize * 0.34} ${safe.y + safe.height * 0.31} L ${safe.x + safe.width * 0.13 - props.scene.metrics.titleSize * 0.08} ${safe.y + safe.height * 0.31 + props.scene.metrics.titleSize * 0.26} L ${safe.x + safe.width * 0.13 + props.scene.metrics.titleSize * 0.4} ${safe.y + safe.height * 0.31 - props.scene.metrics.titleSize * 0.27}`} fill="none" stroke={theme.surface} strokeWidth={props.scene.metrics.unit * 0.58} strokeLinecap="round" strokeLinejoin="round" />
      <text x={safe.x + safe.width * 0.25} y={safe.y + safe.height * 0.19} fill={theme.accent} fontFamily={theme.fontMono} fontSize={legible(props.scene.metrics.smallSize)} fontWeight="820" letterSpacing={2.2}>CONCEPT THREAD COMPLETE</text>
      <WrappedText text={content.title} rect={{ x: safe.x + safe.width * 0.25, y: safe.y + safe.height * 0.27, width: safe.width * 0.66, height: safe.height * 0.24 }} theme={theme} fill={theme.surface} fontSize={props.scene.metrics.titleSize * 1.18} fontFamily={theme.fontDisplay} fontWeight="790" maxLines={3} lineHeight={1.02} />
      {content.nextSteps?.length ? <g>{content.nextSteps.slice(0, 3).map((step, index) => { const x = safe.x + safe.width * (0.13 + index * 0.29); const y = safe.y + safe.height * 0.62; const color = index === 1 ? theme.secondary : index === 2 ? theme.accent : theme.primary; return <g key={step}><circle cx={x} cy={y} r={props.scene.metrics.unit * 0.68} fill={color} /><line x1={x + props.scene.metrics.unit * 0.9} x2={x + safe.width * 0.2} y1={y} y2={y} stroke={color} strokeWidth={Math.max(3, props.scene.metrics.unit * 0.32)} /><text x={x} y={y - props.scene.metrics.bodySize * 1.3} fill={tint(color, 0.22)} fontFamily={theme.fontDisplay} fontWeight="840" fontSize={props.scene.metrics.titleSize * 1.28}>{String(index + 1).padStart(2, "0")}</text><text x={x} y={y + props.scene.metrics.bodySize * 2.15} fill={theme.surface} fontFamily={theme.fontBody} fontWeight="700" fontSize={legible(props.scene.metrics.bodySize)}>{truncate(step, 24)}</text></g>; })}</g> : null}
      {content.callToAction ? <g><line x1={safe.x + safe.width * 0.2} x2={safe.x + safe.width * 0.8} y1={safe.y + safe.height * 0.87} y2={safe.y + safe.height * 0.87} stroke={theme.secondary} strokeWidth={Math.max(4, props.scene.metrics.unit * 0.42)} /><text x={safe.x + safe.width / 2} y={safe.y + safe.height * 0.96} textAnchor="middle" fill={theme.secondary} fontFamily={theme.fontBody} fontWeight="760" fontSize={legible(props.scene.metrics.subtitleSize)}>{content.callToAction}</text></g> : null}
    </g>
  ), { hideHeader: true });
}
