import { staggeredReveal, standardChoreography } from "./choreography.js";
import {
  BulletsRenderer,
  ChartRenderer,
  CodeRenderer,
  ComparisonRenderer,
  DefinitionRenderer,
  DiagramRenderer,
  FileTreeRenderer,
  FormulaRenderer,
  GraphRenderer,
  ImageComparisonRenderer,
  ImageFocusRenderer,
  MapRenderer,
  OutroRenderer,
  PresenterRenderer,
  QuestionRenderer,
  QuizRenderer,
  QuoteRenderer,
  SectionIntroRenderer,
  SimulationRenderer,
  SourcesRenderer,
  TableRenderer,
  TimelineRenderer,
  TitleRenderer,
  TraceRenderer,
  UiDemoRenderer,
  VariableStateRenderer,
  WorkedExampleRenderer,
} from "./renderers.js";
import type {
  BuiltinSceneContent,
  Diagnostic,
  SceneContent,
  SceneDefinition,
  SceneKind,
  SceneRegistry,
  SceneSpec,
} from "./types.js";

const ALL_TARGETS = ["landscape", "portrait", "square", "custom"] as const;

function definition<TContent extends BuiltinSceneContent>(value: Omit<SceneDefinition<TContent>, "supports" | "defaultChoreography" | "describe" | "lint"> & Partial<Pick<SceneDefinition<TContent>, "supports" | "defaultChoreography" | "describe" | "lint">>): SceneDefinition<TContent> {
  return {
    supports: ALL_TARGETS,
    defaultChoreography: (spec) => standardChoreography(spec),
    describe: (content) => `A ${value.displayName.toLowerCase()} scene titled ${content.title}.`,
    lint: (content) => lintCommon(content),
    ...value,
  };
}

function listReveal<T extends SceneSpec>(spec: T, ids: readonly string[]) {
  return [...standardChoreography(spec), ...staggeredReveal(spec, ids)];
}

const BUILTIN_DEFINITIONS: readonly SceneDefinition<any>[] = [
  definition({ kind: "title", displayName: "Title", category: "structure", description: "A high-impact tutorial or module opener.", renderer: TitleRenderer, describe: (content) => `Title card: ${content.title}${content.subtitle ? `. ${content.subtitle}` : ""}` }),
  definition({ kind: "section-intro", displayName: "Section intro", category: "structure", description: "Introduces a section and its objectives.", renderer: SectionIntroRenderer }),
  definition({ kind: "definition", displayName: "Definition", category: "explanation", description: "Defines one term and optionally grounds it with an example.", renderer: DefinitionRenderer, describe: (content) => `${content.term}: ${content.definition}${content.example ? ` Example: ${content.example}` : ""}` }),
  definition({ kind: "bullets", displayName: "Key points", category: "explanation", description: "Progressively reveals a concise list.", renderer: BulletsRenderer, defaultChoreography: (spec) => listReveal(spec, spec.content.kind === "bullets" ? spec.content.items.map((item) => item.id) : []) }),
  definition({ kind: "comparison", displayName: "Comparison", category: "explanation", description: "Contrasts two concepts without collapsing them into a table.", renderer: ComparisonRenderer }),
  definition({ kind: "diagram", displayName: "Diagram", category: "explanation", description: "Renders a semantic node-and-edge explanation.", renderer: DiagramRenderer, defaultChoreography: (spec) => listReveal(spec, spec.content.kind === "diagram" ? spec.content.nodes.map((node) => node.id) : []) }),
  definition({ kind: "timeline", displayName: "Timeline", category: "explanation", description: "Places events on responsive chronological tracks.", renderer: TimelineRenderer, defaultChoreography: (spec) => listReveal(spec, spec.content.kind === "timeline" ? spec.content.events.map((event) => event.id) : []) }),
  definition({ kind: "formula", displayName: "Formula", category: "explanation", description: "Presents a formula with semantic visual hierarchy.", renderer: FormulaRenderer }),
  definition({ kind: "derivation", displayName: "Derivation", category: "explanation", description: "Reveals verified mathematical steps and reasons.", renderer: FormulaRenderer, defaultChoreography: (spec) => listReveal(spec, spec.content.kind === "derivation" ? (spec.content.steps ?? []).map((step) => step.id) : []) }),
  definition({ kind: "graph", displayName: "Function graph", category: "data", description: "Plots mathematical series on deterministic SVG axes.", renderer: GraphRenderer }),
  definition({ kind: "code", displayName: "Code", category: "code", description: "Displays syntax-classed inert source code.", renderer: CodeRenderer }),
  definition({ kind: "walkthrough", displayName: "Code walkthrough", category: "code", description: "Steps through annotated code without executing it in the renderer.", renderer: CodeRenderer, defaultChoreography: (spec) => listReveal(spec, spec.content.kind === "walkthrough" ? spec.content.lines.map((line) => line.id) : []) }),
  definition({ kind: "diff", displayName: "Code diff", category: "code", description: "Shows a readable before/after patch.", renderer: CodeRenderer }),
  definition({ kind: "file-tree", displayName: "File tree", category: "code", description: "Explains a repository or document hierarchy.", renderer: FileTreeRenderer }),
  definition({ kind: "terminal", displayName: "Terminal", category: "code", description: "Displays inert command and output transcripts.", renderer: CodeRenderer }),
  definition({ kind: "execution-trace", displayName: "Execution trace", category: "code", description: "Shows stack frames, line positions, and variable snapshots.", renderer: TraceRenderer }),
  definition({ kind: "variable-state", displayName: "Variable state", category: "code", description: "Compares values before and after one operation.", renderer: VariableStateRenderer }),
  definition({ kind: "chart", displayName: "Chart", category: "data", description: "Renders compact bar, line, area, or dot charts.", renderer: ChartRenderer }),
  definition({ kind: "table", displayName: "Table", category: "data", description: "Renders accessible tabular comparisons.", renderer: TableRenderer }),
  definition({ kind: "map", displayName: "Map", category: "data", description: "Renders validated local SVG regions and point annotations.", renderer: MapRenderer }),
  definition({ kind: "image-focus", displayName: "Image focus", category: "media", description: "Frames a licensed local visual with callouts.", renderer: ImageFocusRenderer }),
  definition({ kind: "image-comparison", displayName: "Image comparison", category: "media", description: "Compares two licensed local visuals.", renderer: ImageComparisonRenderer }),
  definition({ kind: "document-focus", displayName: "Document focus", category: "media", description: "Highlights a locally ingested document or evidence image.", renderer: ImageFocusRenderer }),
  definition({ kind: "ui-demo", displayName: "UI demonstration", category: "media", description: "Pairs a deterministic interface mockup with guided steps.", renderer: UiDemoRenderer }),
  definition({ kind: "screen-recording", displayName: "Screen recording", category: "media", description: "Frames a trusted local recording with callouts and citations.", renderer: ImageFocusRenderer }),
  definition({ kind: "simulation", displayName: "Simulation", category: "data", description: "Explains parameter effects with frame-driven visual state.", renderer: SimulationRenderer }),
  definition({ kind: "presenter", displayName: "Presenter", category: "presenter", description: "Uses a presenter sparingly for human connection.", renderer: PresenterRenderer }),
  definition({ kind: "presenter-slide", displayName: "Presenter with slide", category: "presenter", description: "Balances presenter presence with structured teaching points.", renderer: PresenterRenderer }),
  definition({ kind: "quote", displayName: "Quote", category: "explanation", description: "Presents an attributed quotation with source context.", renderer: QuoteRenderer }),
  definition({ kind: "question", displayName: "Question", category: "assessment", description: "Prompts retrieval or reflection with optional thinking time.", renderer: QuestionRenderer }),
  definition({ kind: "worked-example", displayName: "Worked example", category: "explanation", description: "Walks from problem through reasoning to answer.", renderer: WorkedExampleRenderer, defaultChoreography: (spec) => listReveal(spec, spec.content.kind === "worked-example" ? spec.content.steps.map((step) => step.id) : []) }),
  definition({ kind: "quiz", displayName: "Quiz", category: "assessment", description: "Shows bounded multiple-choice assessment and explanation.", renderer: QuizRenderer, defaultChoreography: (spec) => listReveal(spec, spec.content.kind === "quiz" ? spec.content.options.map((option) => option.id) : []) }),
  definition({ kind: "recap", displayName: "Recap", category: "structure", description: "Reinforces recent learning before moving on.", renderer: BulletsRenderer, defaultChoreography: (spec) => listReveal(spec, spec.content.kind === "recap" ? spec.content.items.map((item) => item.id) : []) }),
  definition({ kind: "summary", displayName: "Summary", category: "structure", description: "Consolidates the tutorial's durable takeaways.", renderer: BulletsRenderer, defaultChoreography: (spec) => listReveal(spec, spec.content.kind === "summary" ? spec.content.items.map((item) => item.id) : []) }),
  definition({ kind: "sources", displayName: "Sources", category: "structure", description: "Credits evidence, media, creators, and licenses.", renderer: SourcesRenderer }),
  definition({ kind: "outro", displayName: "Outro", category: "structure", description: "Closes the learning loop and offers next steps.", renderer: OutroRenderer }),
];

class ImmutableSceneRegistry implements SceneRegistry {
  public readonly definitions: ReadonlyMap<SceneKind, SceneDefinition<any>>;
  public constructor(definitions: readonly SceneDefinition<any>[]) {
    this.definitions = new Map(definitions.map((item) => [item.kind, item]));
  }
  public get(kind: SceneKind): SceneDefinition<any> | undefined { return this.definitions.get(kind); }
  public has(kind: SceneKind): boolean { return this.definitions.has(kind); }
  public list(): readonly SceneDefinition<any>[] { return [...this.definitions.values()]; }
}

export const builtinSceneRegistry: SceneRegistry = new ImmutableSceneRegistry(BUILTIN_DEFINITIONS);
export const builtinSceneDefinitions: readonly SceneDefinition<any>[] = BUILTIN_DEFINITIONS;

function lintCommon(content: SceneContent): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!content.title.trim()) diagnostics.push({ code: "scene.content.title.empty", severity: "error", message: "Scene title must not be empty.", path: "content.title" });
  if (content.title.length > 180) diagnostics.push({ code: "scene.content.title.long", severity: "warning", message: "Scene title may overflow narrow targets.", path: "content.title", remediation: "Shorten the title or split it into title and subtitle." });
  switch (content.kind) {
    case "bullets": case "recap": case "summary":
      if (content.items.length === 0) diagnostics.push({ code: "scene.list.empty", severity: "error", message: "List scenes require at least one item.", path: "content.items" });
      if (content.items.length > 7) diagnostics.push({ code: "scene.list.dense", severity: "warning", message: "More than seven list items will be truncated in at least one target.", path: "content.items", remediation: "Split the list into multiple scenes." });
      break;
    case "diagram":
      if (content.nodes.length === 0) diagnostics.push({ code: "scene.diagram.empty", severity: "error", message: "Diagrams require at least one node.", path: "content.nodes" });
      for (const edge of content.edges) if (!content.nodes.some((node) => node.id === edge.from) || !content.nodes.some((node) => node.id === edge.to)) diagnostics.push({ code: "scene.diagram.edge.orphan", severity: "error", message: `Edge ${edge.id} references a missing node.`, path: "content.edges" });
      break;
    case "chart": case "graph":
      if (content.series.length === 0 || content.series.every((series) => series.values.length === 0)) diagnostics.push({ code: "scene.data.empty", severity: "error", message: "Data scenes require at least one value.", path: "content.series" });
      break;
    case "table":
      if (content.columns.length === 0) diagnostics.push({ code: "scene.table.columns.empty", severity: "error", message: "Tables require at least one column.", path: "content.columns" });
      if (content.rows.some((row) => row.cells.length !== content.columns.length)) diagnostics.push({ code: "scene.table.shape", severity: "error", message: "Every table row must have one cell per column.", path: "content.rows" });
      break;
    case "quiz":
      if (content.options.length < 2) diagnostics.push({ code: "scene.quiz.options.few", severity: "error", message: "A quiz requires at least two options.", path: "content.options" });
      if (content.options.filter((option) => option.correct).length !== 1) diagnostics.push({ code: "scene.quiz.answer", severity: "error", message: "A quiz requires exactly one correct answer.", path: "content.options" });
      break;
    case "image-focus": case "document-focus": case "screen-recording":
      if (!content.asset.alt.trim()) diagnostics.push({ code: "scene.asset.alt.empty", severity: "error", message: "Media assets require alternative text.", path: "content.asset.alt" });
      break;
    case "image-comparison":
      if (!content.left.alt.trim() || !content.right.alt.trim()) diagnostics.push({ code: "scene.asset.alt.empty", severity: "error", message: "Both compared assets require alternative text.", path: "content" });
      break;
  }
  return diagnostics;
}
