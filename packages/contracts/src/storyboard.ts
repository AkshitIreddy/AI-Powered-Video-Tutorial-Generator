import type { BoundingBox, Dimensions, EntityId, EntityLock, IsoDateTime, JsonValue, Rational, Sha256 } from "./common.js";
import type { AccessibilitySpec, AudioMixSpec, CaptionTrack, NarrationSpec, PresenterSpec, TimingPolicy } from "./media.js";

export interface ColorToken {
  name: string; value: string; role: "background" | "surface" | "text" | "muted-text" | "primary" | "secondary" | "accent" | "positive" | "warning" | "critical" | "data";
}
export interface TypographyToken {
  name: string; family: string; fallbacks?: string[]; weight: number; sizePx: number; lineHeight: number; letterSpacingEm?: number;
}
export interface ThemeSpec {
  id: EntityId; name: string; version: string; colors: ColorToken[]; typography: TypographyToken[]; spacingScale: number[];
  cornerStyle: "square" | "subtle" | "rounded" | "pill" | "mixed"; motionStyle: "none" | "precise" | "gentle" | "energetic" | "cinematic" | "playful";
  logoAssetId?: EntityId; fontArtifactIds?: EntityId[]; customProperties?: Record<string, string | number>;
}
export interface VisualBible {
  id: EntityId; themeId: EntityId; direction: string; compositionRules: string[]; imageRules: string[]; motionRules: string[]; doNotUse: string[];
  characterAssetIds?: EntityId[]; seed: number;
}
export interface LayoutOverride {
  target: "landscape" | "portrait" | "square" | "custom"; strategy: "reflow" | "alternate" | "simplify" | "manual";
  templateId?: EntityId; safeArea?: BoundingBox; parameters?: JsonValue;
}
export interface ChoreographyCue {
  id: EntityId; targetId: EntityId; action: "enter" | "exit" | "emphasize" | "transform" | "highlight" | "focus" | "draw" | "count" | "camera" | "custom";
  startTick: number; durationTicks: number; easing: "linear" | "ease-in" | "ease-out" | "ease-in-out" | "spring" | "step";
  parameters?: JsonValue; reducedMotionAction?: "none" | "crossfade" | "step" | "instant";
}

export type TextVisualKind = "title" | "section-intro" | "definition" | "bullets" | "quote" | "question" | "recap" | "summary" | "outro";
export interface TextVisual { kind: TextVisualKind; heading: string; eyebrow?: string; blocks: string[]; attribution?: string; icon?: string }
export interface ComparisonColumn { id: EntityId; label: string; points: string[]; assetId?: EntityId; emphasis?: boolean }
export interface ComparisonVisual { kind: "comparison" | "image-comparison"; heading: string; columns: ComparisonColumn[] }
export interface DiagramNode { id: EntityId; label: string; description?: string; shape: "rectangle" | "rounded" | "circle" | "diamond" | "capsule" | "icon" | "image"; assetId?: EntityId }
export interface DiagramEdge { id: EntityId; from: EntityId; to: EntityId; label?: string; directed: boolean }
export interface DiagramVisual { kind: "diagram"; nodes: DiagramNode[]; edges: DiagramEdge[]; layout: "layered" | "tree" | "radial" | "force" | "manual" }
export interface TimelineEvent { id: EntityId; label: string; dateLabel: string; description?: string; assetId?: EntityId }
export interface TimelineVisual { kind: "timeline"; events: TimelineEvent[]; orientation: "horizontal" | "vertical" }
export interface MathExpression { id: EntityId; latex: string; spokenText?: string; justification?: string; verified?: boolean }
export interface MathVisual { kind: "formula" | "derivation" | "graph"; expressions: MathExpression[]; graphSpec?: JsonValue }
export interface WhiteboardVisual { kind: "whiteboard"; boardStyle: "whiteboard" | "paper" | "chalkboard"; strokeTimeline: JsonValue; finalBoardDescription: string }
export interface CodeHighlight { startLine: number; endLine: number; label: string }
export interface CodeVisual {
  kind: "code" | "live-code" | "code-walkthrough" | "diff" | "file-tree" | "terminal" | "execution-trace" | "variable-state";
  language: string; content: string; fileName?: string; highlights?: CodeHighlight[]; traceArtifactId?: EntityId; executionAllowed?: boolean;
}
export interface DataVisual { kind: "chart" | "table" | "map"; title: string; data: JsonValue; encoding: JsonValue; sourceClaimIds?: EntityId[]; mapProjection?: string }
export interface MediaAnnotation { id: EntityId; box: BoundingBox; label: string }
export interface MediaVisual {
  kind: "image-focus" | "highlighted-document" | "ui-demonstration" | "screen-recording"; assetIds: EntityId[]; fit: "contain" | "cover" | "actual-size";
  annotations?: MediaAnnotation[]; crop?: BoundingBox;
}
export interface SimulationVisual { kind: "simulation"; simulationId: EntityId; parameters: JsonValue; capturePolicy: "deterministic-frames" | "recorded-run" | "keyframes"; seed?: number }
export interface PresenterVisual { kind: "presenter" | "presenter-with-slide"; presenter: PresenterSpec; layout: "full" | "picture-in-picture" | "split-left" | "split-right"; slideAssetId?: EntityId }
export interface InstructionVisual { kind: "worked-example" | "quiz"; prompt: string; steps: string[]; choices?: string[]; answer?: string; explanation?: string }
export interface SourcesVisual { kind: "sources"; sourceVersionIds: EntityId[]; style: "bibliography" | "cards" | "compact" }

export type VisualContent = TextVisual | ComparisonVisual | DiagramVisual | TimelineVisual | MathVisual | WhiteboardVisual | CodeVisual | DataVisual | MediaVisual | SimulationVisual | PresenterVisual | InstructionVisual | SourcesVisual;

export interface Scene {
  id: EntityId; sectionId: EntityId; title: string; objectiveIds: EntityId[]; prerequisiteIds: EntityId[]; visual: VisualContent;
  layouts: LayoutOverride[]; choreography: ChoreographyCue[]; narration: NarrationSpec; claimIds: EntityId[]; citationSupportIds: EntityId[];
  captions: CaptionTrack[]; audio: AudioMixSpec; timing: TimingPolicy; accessibility: AccessibilitySpec; artifactIds: EntityId[]; locks: EntityLock[]; revisionId: EntityId;
}

export interface StoryboardSnapshot {
  id: EntityId; projectId: EntityId; revisionId: EntityId; visualBible: VisualBible; theme: ThemeSpec; scenes: Scene[]; createdAt: IsoDateTime;
  status: "draft" | "proposed" | "approved" | "superseded";
}

export interface CompiledScene {
  id: EntityId; sourceSceneId: EntityId; sourceRevisionId: EntityId; target: "landscape" | "portrait" | "square" | "custom";
  dimensions: Dimensions; frameRate: Rational; tickRate: 240000; durationTicks: number; layout: JsonValue; artifactIds: EntityId[]; compileHash: Sha256;
}

export interface RenderManifest {
  id: EntityId; projectId: EntityId; revisionId: EntityId; target: "landscape" | "portrait" | "square" | "custom"; dimensions: Dimensions;
  frameRate: Rational; tickRate: 240000; compiledScenes: CompiledScene[]; totalDurationTicks: number; colorSpace: "rec709-sdr"; audioMix: AudioMixSpec;
  captionTrackIds?: EntityId[]; createdAt: IsoDateTime; renderHash: Sha256;
}

/** Stable list used by editors, renderers, and plugin collision checks. */
export const BUILT_IN_SCENE_KINDS = [
  "title", "section-intro", "definition", "bullets", "comparison", "diagram", "timeline", "formula", "derivation", "graph", "whiteboard", "code",
  "live-code", "code-walkthrough", "diff", "file-tree", "terminal", "execution-trace", "variable-state", "chart", "table", "map", "image-focus",
  "image-comparison", "highlighted-document", "ui-demonstration", "screen-recording", "simulation", "presenter", "presenter-with-slide", "quote",
  "question", "worked-example", "quiz", "recap", "summary", "sources", "outro",
] as const satisfies readonly VisualContent["kind"][];
