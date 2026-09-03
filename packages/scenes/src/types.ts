import type { ComponentType, ReactNode } from "react";

export const TIMEBASE_TICKS_PER_SECOND = 240_000 as const;

export const BUILTIN_SCENE_KINDS = [
  "title",
  "section-intro",
  "definition",
  "bullets",
  "comparison",
  "diagram",
  "timeline",
  "formula",
  "derivation",
  "graph",
  "whiteboard",
  "code",
  "live-code",
  "walkthrough",
  "diff",
  "file-tree",
  "terminal",
  "execution-trace",
  "variable-state",
  "chart",
  "table",
  "map",
  "image-focus",
  "image-comparison",
  "document-focus",
  "ui-demo",
  "screen-recording",
  "simulation",
  "presenter",
  "presenter-slide",
  "quote",
  "question",
  "worked-example",
  "quiz",
  "recap",
  "summary",
  "sources",
  "outro",
] as const;

export type BuiltinSceneKind = (typeof BUILTIN_SCENE_KINDS)[number];
export type SceneKind = BuiltinSceneKind | `plugin:${string}/${string}`;
export type TargetProfile = "landscape" | "portrait" | "square" | "custom";
export type SemanticRole =
  | "title"
  | "subtitle"
  | "content"
  | "visual"
  | "code"
  | "data"
  | "source"
  | "presenter"
  | "navigation"
  | "caption-safe"
  | "decorative";

export interface Dimensions {
  readonly width: number;
  readonly height: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SemanticRegion extends Rect {
  readonly id: string;
  readonly role: SemanticRole;
  readonly label: string;
  readonly readingOrder: number;
  readonly essential: boolean;
}

export interface CaptionAvoidZone extends Rect {
  readonly id: string;
  readonly reason: "essential-text" | "essential-visual" | "presenter" | "interaction" | "source";
  readonly priority: "required" | "preferred";
}

export type EasingName = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "spring-soft" | "spring-snappy";
export type AnimationProperty = "opacity" | "translate-x" | "translate-y" | "scale" | "reveal" | "highlight" | "draw";

export interface ChoreographyKeyframe {
  readonly tick: number;
  readonly value: number;
  readonly easing?: EasingName;
}

export interface ChoreographyTrack {
  readonly id: string;
  readonly target: string;
  readonly property: AnimationProperty;
  readonly keyframes: readonly ChoreographyKeyframe[];
  readonly reducedMotionBehavior?: "freeze-start" | "freeze-end" | "crossfade" | "disable";
}

export interface SceneTheme {
  readonly id: string;
  readonly name: string;
  readonly paper: string;
  readonly ink: string;
  readonly mutedInk: string;
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
  readonly warning: string;
  readonly critical: string;
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly line: string;
  readonly codeBackground: string;
  readonly codeInk: string;
  readonly fontDisplay: string;
  readonly fontBody: string;
  readonly fontMono: string;
  readonly radius: number;
}

export interface TextItem {
  readonly id: string;
  readonly text: string;
  readonly emphasis?: "none" | "primary" | "secondary" | "warning";
  readonly supportingText?: string;
}

export interface DiagramNode {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly tone?: "primary" | "secondary" | "neutral" | "warning";
}

export interface DiagramEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly style?: "solid" | "dashed" | "emphasis";
}

export interface DataSeries {
  readonly id: string;
  readonly label: string;
  readonly color?: string;
  readonly values: readonly { readonly x: number; readonly y: number; readonly label?: string }[];
}

export interface CodeLine {
  readonly id: string;
  readonly text: string;
  readonly tokenClass?: "plain" | "keyword" | "string" | "number" | "comment" | "function";
  readonly highlight?: boolean;
  readonly annotation?: string;
}

export interface WhiteboardStroke {
  readonly id: string;
  /** Board-relative points in the inclusive 0..1 range. */
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly startTick: number;
  readonly endTick: number;
  readonly color?: "ink" | "primary" | "secondary" | "warning";
  readonly width?: number;
  readonly tool?: "pencil" | "marker" | "chalk";
}

export interface WhiteboardLabel {
  readonly id: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly startTick: number;
  readonly color?: "ink" | "primary" | "secondary" | "warning";
}

export interface CodeTimelineAction {
  readonly id: string;
  readonly type: "type" | "highlight" | "run" | "explain";
  readonly lineId?: string;
  readonly startTick: number;
  readonly endTick: number;
  readonly output?: string;
  readonly narrationAnchor?: string;
}

export interface AssetReference {
  readonly id: string;
  readonly sha256?: string;
  readonly alt: string;
  readonly fit?: "contain" | "cover";
}

export interface SourceItem {
  readonly id: string;
  readonly title: string;
  readonly creator?: string;
  readonly locator?: string;
  readonly license?: string;
  readonly marker?: string;
}

interface TitledContent {
  readonly title: string;
  readonly eyebrow?: string;
  readonly subtitle?: string;
  /** Optional immutable backdrop resolved by the host through an opaque asset id. */
  readonly background?: AssetReference;
}

export interface TitleContent extends TitledContent {
  readonly kind: "title";
  readonly author?: string;
  readonly module?: string;
}

export interface SectionIntroContent extends TitledContent {
  readonly kind: "section-intro";
  readonly sectionNumber?: string;
  readonly objectives?: readonly string[];
}

export interface DefinitionContent extends TitledContent {
  readonly kind: "definition";
  readonly term: string;
  readonly definition: string;
  readonly example?: string;
  /** Optional exact two-line place-value relationship for mathematical definitions. */
  readonly placeValueRelationship?: {
    readonly symbolic: readonly [string, string];
    readonly concrete: readonly [string, string];
    readonly rule: string;
  };
}

export interface BulletsContent extends TitledContent {
  readonly kind: "bullets" | "recap" | "summary";
  readonly items: readonly TextItem[];
}

export interface ComparisonContent extends TitledContent {
  readonly kind: "comparison";
  readonly left: { readonly label: string; readonly items: readonly string[]; readonly count?: number; readonly countLabel?: string };
  readonly right: { readonly label: string; readonly items: readonly string[]; readonly count?: number; readonly countLabel?: string };
  readonly verdict?: string;
  readonly curveComparison?: {
    readonly firstLabel: string;
    readonly firstExponent: number;
    readonly secondLabel: string;
    readonly secondExponent: number;
    readonly xLabel?: string;
    readonly yLabel?: string;
  };
}

export interface DiagramContent extends TitledContent {
  readonly kind: "diagram";
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
  readonly direction?: "left-to-right" | "top-to-bottom" | "radial";
}

export interface TimelineContent extends TitledContent {
  readonly kind: "timeline";
  readonly events: readonly { readonly id: string; readonly date: string; readonly label: string; readonly detail?: string }[];
}

export interface FormulaContent extends TitledContent {
  readonly kind: "formula" | "derivation";
  readonly expression: string;
  readonly steps?: readonly { readonly id: string; readonly expression: string; readonly reason?: string }[];
  readonly result?: string;
}

export interface GraphContent extends TitledContent {
  readonly kind: "graph";
  readonly xLabel?: string;
  readonly yLabel?: string;
  readonly series: readonly DataSeries[];
  readonly domain?: { readonly x: readonly [number, number]; readonly y: readonly [number, number] };
}

export interface WhiteboardContent extends TitledContent {
  readonly kind: "whiteboard";
  readonly boardStyle?: "whiteboard" | "paper" | "chalkboard";
  readonly strokes: readonly WhiteboardStroke[];
  readonly labels?: readonly WhiteboardLabel[];
  readonly finalBoardDescription: string;
}

export interface CodeContent extends TitledContent {
  readonly kind: "code" | "live-code" | "walkthrough" | "diff" | "terminal";
  readonly language?: string;
  readonly filename?: string;
  readonly lines: readonly CodeLine[];
  readonly step?: number;
  readonly totalSteps?: number;
  readonly actions?: readonly CodeTimelineAction[];
}

export interface FileTreeContent extends TitledContent {
  readonly kind: "file-tree";
  readonly entries: readonly { readonly id: string; readonly path: string; readonly type: "file" | "folder"; readonly emphasis?: boolean }[];
}

export interface TraceContent extends TitledContent {
  readonly kind: "execution-trace";
  readonly frames: readonly { readonly id: string; readonly label: string; readonly line: number; readonly variables: Readonly<Record<string, string>> }[];
  readonly activeFrame?: number;
}

export interface VariableStateContent extends TitledContent {
  readonly kind: "variable-state";
  readonly before: Readonly<Record<string, string>>;
  readonly after: Readonly<Record<string, string>>;
  readonly operation?: string;
}

export interface ChartContent extends TitledContent {
  readonly kind: "chart";
  readonly chartType: "bar" | "line" | "area" | "dot";
  readonly series: readonly DataSeries[];
  readonly xLabel?: string;
  readonly yLabel?: string;
}

export interface TableContent extends TitledContent {
  readonly kind: "table";
  readonly columns: readonly { readonly id: string; readonly label: string; readonly align?: "left" | "center" | "right" }[];
  readonly rows: readonly { readonly id: string; readonly cells: readonly string[]; readonly emphasis?: boolean }[];
}

export interface MapContent extends TitledContent {
  readonly kind: "map";
  readonly regions?: readonly { readonly id: string; readonly label: string; readonly path: string; readonly value?: number }[];
  readonly points?: readonly { readonly id: string; readonly label: string; readonly x: number; readonly y: number; readonly detail?: string }[];
}

export interface ImageFocusContent extends TitledContent {
  readonly kind: "image-focus" | "document-focus" | "screen-recording";
  readonly asset: AssetReference;
  readonly callouts?: readonly { readonly id: string; readonly label: string; readonly x: number; readonly y: number }[];
  readonly citation?: string;
}

export interface ImageComparisonContent extends TitledContent {
  readonly kind: "image-comparison";
  readonly left: AssetReference;
  readonly right: AssetReference;
  readonly leftLabel?: string;
  readonly rightLabel?: string;
}

export interface UiDemoContent extends TitledContent {
  readonly kind: "ui-demo";
  readonly windowTitle?: string;
  readonly steps: readonly TextItem[];
  readonly activeStep?: number;
  readonly mockup?: "browser" | "desktop" | "mobile";
}

export interface SimulationContent extends TitledContent {
  readonly kind: "simulation";
  readonly variables: readonly { readonly id: string; readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly unit?: string }[];
  readonly observation: string;
  readonly series?: readonly DataSeries[];
}

export interface PresenterContent extends TitledContent {
  readonly kind: "presenter" | "presenter-slide";
  readonly presenterName?: string;
  readonly portrait?: AssetReference;
  readonly talkingPoint?: string;
  readonly slideItems?: readonly TextItem[];
  readonly disclosure?: string;
  readonly placement?: "full" | "picture-in-picture" | "split-left" | "split-right";
  readonly idleMotion?: {
    readonly enabled: boolean;
    readonly blink: boolean;
    readonly breathing: boolean;
    readonly restMouth: "closed";
  };
}

export interface QuoteContent extends TitledContent {
  readonly kind: "quote";
  readonly quote: string;
  readonly attribution: string;
  readonly source?: string;
}

export interface QuestionContent extends TitledContent {
  readonly kind: "question";
  readonly question: string;
  readonly prompt?: string;
  readonly thinkingTimeSeconds?: number;
}

export interface WorkedExampleContent extends TitledContent {
  readonly kind: "worked-example";
  readonly problem: string;
  readonly steps: readonly TextItem[];
  readonly answer: string;
}

export interface QuizContent extends TitledContent {
  readonly kind: "quiz";
  readonly question: string;
  readonly options: readonly { readonly id: string; readonly label: string; readonly correct?: boolean }[];
  readonly revealAnswer?: boolean;
  readonly explanation?: string;
}

export interface SourcesContent extends TitledContent {
  readonly kind: "sources";
  readonly sources: readonly SourceItem[];
}

export interface OutroContent extends TitledContent {
  readonly kind: "outro";
  readonly nextSteps?: readonly string[];
  readonly callToAction?: string;
}

export type BuiltinSceneContent =
  | TitleContent
  | SectionIntroContent
  | DefinitionContent
  | BulletsContent
  | ComparisonContent
  | DiagramContent
  | TimelineContent
  | FormulaContent
  | GraphContent
  | WhiteboardContent
  | CodeContent
  | FileTreeContent
  | TraceContent
  | VariableStateContent
  | ChartContent
  | TableContent
  | MapContent
  | ImageFocusContent
  | ImageComparisonContent
  | UiDemoContent
  | SimulationContent
  | PresenterContent
  | QuoteContent
  | QuestionContent
  | WorkedExampleContent
  | QuizContent
  | SourcesContent
  | OutroContent;

export interface PluginSceneContent {
  readonly kind: `plugin:${string}/${string}`;
  readonly title: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export type SceneContent = BuiltinSceneContent | PluginSceneContent;

export interface SceneSpec<TContent extends SceneContent = SceneContent> {
  readonly id: string;
  readonly content: TContent;
  readonly durationTicks: number;
  readonly seed: number;
  readonly objectiveIds?: readonly string[];
  readonly claimIds?: readonly string[];
  readonly accessibilityDescription?: string;
  readonly choreography?: readonly ChoreographyTrack[];
  readonly captionAvoidZones?: readonly CaptionAvoidZone[];
  readonly tags?: readonly string[];
}

export interface CompileTarget extends Dimensions {
  readonly fps: 24 | 25 | 30 | 48 | 50 | 60;
  readonly pixelRatio?: number;
  readonly safeAreaPercent?: number;
  readonly reducedMotion?: boolean;
  readonly locale?: string;
}

export interface LayoutMetrics {
  readonly profile: TargetProfile;
  readonly frame: Rect;
  readonly safe: Rect;
  readonly gutter: number;
  readonly unit: number;
  readonly titleSize: number;
  readonly subtitleSize: number;
  readonly bodySize: number;
  readonly smallSize: number;
  readonly lineHeight: number;
  readonly columns: 1 | 2;
}

export type LayoutConstraintStrength = "required" | "strong" | "medium" | "weak";
export type LayoutConstraintRelation =
  | "inside"
  | "above"
  | "below"
  | "left-of"
  | "right-of"
  | "align-start"
  | "align-end"
  | "align-center"
  | "align-baseline"
  | "avoid";

/**
 * A serializable relationship retained with the compiled scene so preview,
 * final rendering, and QA all reason about the same authored geometry.
 */
export interface LayoutConstraint {
  readonly id: string;
  readonly relation: LayoutConstraintRelation;
  readonly first: string;
  readonly second: string;
  readonly strength: LayoutConstraintStrength;
  readonly minimumGap?: number;
  readonly tolerance?: number;
}

export type LayoutSlotRole =
  | "eyebrow"
  | "title"
  | "subtitle"
  | "content"
  | "presenter"
  | "caption"
  | "citation"
  | "platform-overlay"
  | "decorative";

export interface LayoutSlot extends Rect {
  readonly id: string;
  readonly role: LayoutSlotRole;
  readonly essential: boolean;
  readonly readingOrder: number;
  /** Other slot ids this slot may intentionally overlap. Empty means none. */
  readonly allowedOverlapWith: readonly string[];
  readonly baselineGroup?: string;
}

export interface LayoutGrid {
  readonly columns: 12;
  readonly columnGap: number;
  readonly baselineStep: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Planned layout geometry. Browser-measured ink and line fragments are added
 * by the authoritative renderer audit; they never replace this design-space
 * contract.
 */
export interface SceneLayoutManifest {
  readonly schemaVersion: 1;
  readonly compilerVersion: string;
  readonly targetProfile: TargetProfile;
  readonly locale: string;
  readonly graphicsSafe: Rect;
  readonly actionSafe: Rect;
  readonly grid: LayoutGrid;
  readonly slots: readonly LayoutSlot[];
  readonly constraints: readonly LayoutConstraint[];
  readonly avoidRegions: readonly CaptionAvoidZone[];
}

export interface Diagnostic {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly path?: string;
  readonly remediation?: string;
}

export interface CompiledScene<TContent extends SceneContent = SceneContent> {
  readonly spec: SceneSpec<TContent>;
  readonly target: Required<CompileTarget>;
  readonly metrics: LayoutMetrics;
  readonly layout: SceneLayoutManifest;
  readonly regions: readonly SemanticRegion[];
  readonly captionAvoidZones: readonly CaptionAvoidZone[];
  readonly choreography: readonly ChoreographyTrack[];
  readonly accessibilityDescription: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly contentHash: string;
}

export interface FrameContext {
  readonly tick: number;
  readonly reducedMotion: boolean;
}

export interface SceneRendererProps<TContent extends SceneContent = SceneContent> {
  readonly scene: CompiledScene<TContent>;
  readonly frame: FrameContext;
  readonly theme?: SceneTheme | undefined;
  readonly resolveAsset?: ((asset: AssetReference) => string | undefined) | undefined;
  readonly debugRegions?: boolean | undefined;
}

export interface SceneDefinition<TContent extends SceneContent = SceneContent> {
  readonly kind: TContent["kind"];
  readonly displayName: string;
  readonly category: "structure" | "explanation" | "code" | "data" | "media" | "assessment" | "presenter";
  readonly description: string;
  readonly supports: readonly TargetProfile[];
  readonly renderer: ComponentType<SceneRendererProps<TContent>>;
  readonly defaultChoreography: (spec: SceneSpec<TContent>) => readonly ChoreographyTrack[];
  readonly describe: (content: TContent) => string;
  readonly lint: (content: TContent) => readonly Diagnostic[];
}

export interface SceneRegistry {
  readonly definitions: ReadonlyMap<SceneKind, SceneDefinition<any>>;
  get(kind: SceneKind): SceneDefinition<any> | undefined;
  has(kind: SceneKind): boolean;
  list(): readonly SceneDefinition<any>[];
}

export interface ScenePluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: "2";
  readonly license: string;
  readonly capabilities: readonly ("render-svg" | "asset-read")[];
}

export interface ScenePlugin {
  readonly manifest: ScenePluginManifest;
  readonly definitions: readonly SceneDefinition<PluginSceneContent>[];
}

export interface PreflightResult {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly scene?: CompiledScene;
}

export interface SceneSvgProps extends SceneRendererProps {
  readonly children?: ReactNode;
}
