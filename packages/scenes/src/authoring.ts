import {
  BUILTIN_SCENE_KINDS,
  type BuiltinSceneKind,
  type SceneContent as BuiltinSceneContent,
  type SceneSpec,
  type TextItem,
} from "./types.js";
import { compileArithmeticAssignmentProgram } from "./arithmetic-program.js";

export interface AuthoredNarrationWordTiming {
  readonly token: string;
  readonly startTick: number;
  readonly endTick: number;
}

export interface AuthoredNarrationTiming {
  readonly schemaVersion: 1;
  readonly source: "provider-native" | "forced-alignment" | "duration-proportional";
  readonly alignedTokenRatio?: number;
  readonly words: readonly AuthoredNarrationWordTiming[];
}

export interface AuthoredSceneVisualAssetReference {
  readonly assetId: string;
  readonly sha256: string;
  readonly role: "background" | "primary" | "secondary" | "presenter-portrait";
  readonly alt: string;
  readonly fit?: "cover" | "contain";
  readonly treatment?: "aperture" | "full-frame";
}

export interface AuthoredResolvedScene {
  readonly id: string;
  readonly kind: string;
  readonly durationTicks: number;
  readonly seed: string | number;
  readonly content: Readonly<{
    title: string;
    eyebrow?: string;
    body?: string;
    accent?: string;
    items?: readonly string[];
    onScreenText?: readonly string[];
    visualBeat?: unknown;
  }>;
  readonly narrationTiming?: AuthoredNarrationTiming;
  readonly accessibilityDescription?: string;
  readonly visualAssets?: readonly AuthoredSceneVisualAssetReference[];
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

const BUILTIN_SCENE_KIND_SET = new Set<string>(BUILTIN_SCENE_KINDS);

export type VisualSemanticIntent =
  | "establish"
  | "define"
  | "compare"
  | "transform"
  | "demonstrate"
  | "prove"
  | "emphasize"
  | "question"
  | "resolve"
  | "recap";

export type VisualCompositionFamily =
  | "full_bleed"
  | "editorial_type"
  | "object_stage"
  | "diagram"
  | "split_evidence"
  | "document_focus"
  | "data_canvas"
  | "worked_example"
  | "presenter"
  | "cinematic_scale";

export type VisualMotionIntent =
  | "reveal-primary"
  | "trace-relationship"
  | "transform-object"
  | "compare-shift"
  | "evidence-focus"
  | "resolve-hold"
  | "quiet-hold"
  | "match-transition"
  | "emphasize-result"
  | "resolve-answer"
  | "question-hold";

export interface VisualBeatAvoidRegion {
  readonly id: string;
  readonly role: "title" | "essential-visual" | "presenter" | "source";
  /** Normalized frame geometry, kept target-independent until scene compile. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly priority: "required" | "preferred";
}

/**
 * Deterministic art direction derived from semantic scene content.  The wire
 * manifest deliberately stays narrow; the renderer upgrades it into this
 * display-only contract without accepting executable templates or URLs.
 */
export interface VisualBeat {
  readonly sceneId: string;
  readonly semanticIntent: VisualSemanticIntent;
  readonly compositionFamily: VisualCompositionFamily;
  readonly focalAnchor: string;
  readonly continuityKey: string;
  readonly informationUnits: readonly string[];
  readonly visualMetaphor: string;
  readonly attentionCue: string;
  readonly motionIntent: VisualMotionIntent;
  /** Ordered authored motion beats. Derived scenes contain one entry. */
  readonly motionSequence: readonly VisualMotionIntent[];
  readonly textRoles: Readonly<{
    primary: string;
    labels: readonly string[];
    narrationOnScreen: false;
    authored: Readonly<Record<string, string>>;
  }>;
  readonly avoidRegions: readonly VisualBeatAvoidRegion[];
  /** Semantic regions without geometry remain inert hints for scene renderers. */
  readonly namedAvoidRegions: readonly string[];
  readonly density: "quiet" | "balanced" | "dense";
  readonly source: "authored" | "derived";
}

const SENTENCE_END = /(?<=[.!?])\s+/u;
const VISUAL_DIRECTIVE_PREFIX = /^(?:show|illustrate|visuali[sz]e|demonstrate|explain|highlight|depict|present|display|use)\s+(?:(?:a|an|the)\s+)?/iu;
const DISCOURSE_PREFIX = /^(?:now|first|next|then|finally|notice|remember|in other words|for example|this means|we can see that)\s*[,.:;-]?\s*/iu;
// Keep mathematical notation such as n/2 available to authored lessons while
// rejecting executable/remote schemes and strings that actually have path
// shape. This mirrors the Python manifest boundary rather than treating every
// slash as a locator.
const PATH_OR_URL = /(?:https?:\/\/|file:|data:|javascript:|[a-z]:[\\/]|(?:^|\s)\.\.?[\\/]|(?:^|\s)[\\/](?:Users|home|etc|tmp|mnt|var|Windows|Program\s+Files)[\\/])/iu;
const HTML_LIKE = /<\s*\/?\s*[a-z][^>]{0,200}>/iu;
const SAFE_VISUAL_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const AUTHORED_BEAT_KEYS = new Set([
  "schemaVersion", "semanticIntent", "compositionFamily", "focalAnchor", "continuityKey",
  "informationUnits", "visualMetaphor", "attentionCue", "motionIntent", "textRoles", "avoidRegions",
]);
const FORBIDDEN_VISUAL_KEYS = new Set([
  "argv", "code", "command", "component", "css", "executable", "href", "html", "javascript",
  "path", "render", "script", "src", "style", "template", "url",
]);
const INFORMATION_UNIT_KEYS = new Set(["id", "role", "text", "label", "value", "values", "low", "middle", "high", "relation"]);
const TEXT_ROLE_KEYS = new Set([
  "eyebrow", "hero", "support", "label", "markers", "principle", "focus", "proof", "result",
  "counterpoint", "formula", "answer", "title", "subtitle", "kicker", "value",
]);
const GENERIC_TEXT_ROLE_PLACEHOLDERS = new Set([
  "scene heading",
  "primary learner attention",
  "concise supporting information",
]);
const SEMANTIC_INTENTS = new Set<VisualSemanticIntent>([
  "establish", "define", "compare", "transform", "demonstrate", "prove", "emphasize", "question", "resolve", "recap",
]);
const COMPOSITION_FAMILIES = new Set<VisualCompositionFamily>([
  "full_bleed", "editorial_type", "object_stage", "diagram", "split_evidence", "document_focus",
  "data_canvas", "worked_example", "presenter", "cinematic_scale",
]);
const MOTION_INTENTS = new Set<VisualMotionIntent>([
  "reveal-primary", "trace-relationship", "transform-object", "compare-shift", "evidence-focus",
  "resolve-hold", "quiet-hold", "match-transition", "emphasize-result", "resolve-answer", "question-hold",
]);
const AVOID_REGION_ROLES = new Set<VisualBeatAvoidRegion["role"]>(["title", "essential-visual", "presenter", "source"]);
const AVOID_REGION_PRIORITIES = new Set<VisualBeatAvoidRegion["priority"]>(["required", "preferred"]);

export interface AuthoredVisualInformationUnit {
  readonly id: string;
  readonly role: string;
  readonly text?: string;
  readonly label?: string;
  readonly value?: string | number;
  readonly values?: readonly (string | number)[];
  readonly low?: string | number;
  readonly middle?: string | number;
  readonly high?: string | number;
  readonly relation?: string;
}

interface AuthoredVisualBeat {
  readonly semanticIntent: VisualSemanticIntent;
  readonly compositionFamily: VisualCompositionFamily;
  readonly focalAnchor: string;
  readonly continuityKey: string;
  readonly informationUnits: readonly AuthoredVisualInformationUnit[];
  readonly visualMetaphor?: string;
  readonly attentionCue: string;
  readonly motionSequence: readonly VisualMotionIntent[];
  readonly textRoles: Readonly<Record<string, string>>;
  readonly avoidRegions: readonly VisualBeatAvoidRegion[];
  readonly namedAvoidRegions: readonly string[];
}

function assertLiftedAuthoredMetadata(scene: AuthoredResolvedScene, beat: AuthoredVisualBeat): void {
  const bindings: readonly [string, string | undefined][] = [
    ["semanticIntent", beat.semanticIntent],
    ["compositionFamily", beat.compositionFamily],
    ["focalAnchor", beat.focalAnchor],
    ["continuityKey", beat.continuityKey],
    ["attentionCue", beat.attentionCue],
    ["visualMetaphor", beat.visualMetaphor],
  ];
  for (const [key, expected] of bindings) {
    const lifted = scene.metadata?.[key];
    if (lifted === undefined && expected === undefined) continue;
    if (lifted !== undefined && (typeof lifted !== "string" || lifted !== expected)) {
      throw new TypeError(`Scene ${scene.id} visualBeat does not match lifted ${key} metadata`);
    }
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(record: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_VISUAL_KEYS.has(key)) throw new TypeError(`${label} contains forbidden field ${key}`);
    if (!allowed.has(key)) throw new TypeError(`${label} contains unsupported field ${key}`);
  }
}

function safeAuthoredText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be text`);
  if (/[^\t\n\r\x20-\u{10ffff}]/u.test(value)) throw new TypeError(`${label} contains control characters`);
  const normalized = normalizedDisplayText(value);
  if (!normalized || normalized.length > maximum) throw new TypeError(`${label} must contain 1 to ${maximum} characters`);
  if (PATH_OR_URL.test(normalized) || HTML_LIKE.test(normalized)) throw new TypeError(`${label} cannot contain paths, URLs, URIs, or HTML`);
  return normalized;
}

function safeAuthoredIdentifier(value: unknown, label: string): string {
  const normalized = safeAuthoredText(value, label, 80);
  if (!SAFE_VISUAL_IDENTIFIER.test(normalized)) throw new TypeError(`${label} must be a bounded identifier`);
  return normalized;
}

function safeAuthoredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000) {
    throw new TypeError(`${label} must be a bounded finite number`);
  }
  return value;
}

function safeAuthoredScalar(value: unknown, label: string, maximum = 120): string | number {
  return typeof value === "string" ? safeAuthoredText(value, label, maximum) : safeAuthoredNumber(value, label);
}

function parseAuthoredInformationUnit(value: unknown, index: number): AuthoredVisualInformationUnit {
  if (!isRecord(value)) throw new TypeError(`visualBeat information unit ${index} must be an object`);
  assertExactKeys(value, INFORMATION_UNIT_KEYS, `visualBeat information unit ${index}`);
  const result: {
    id: string;
    role: string;
    text?: string;
    label?: string;
    value?: string | number;
    values?: readonly (string | number)[];
    low?: string | number;
    middle?: string | number;
    high?: string | number;
    relation?: string;
  } = {
    id: safeAuthoredIdentifier(value.id, `visualBeat information unit ${index} id`),
    role: safeAuthoredIdentifier(value.role, `visualBeat information unit ${index} role`),
  };
  for (const key of ["text", "label", "relation"] as const) {
    if (value[key] !== undefined) result[key] = safeAuthoredText(value[key], `visualBeat information unit ${index} ${key}`, 180);
  }
  for (const key of ["value", "low", "middle", "high"] as const) {
    if (value[key] !== undefined) result[key] = safeAuthoredScalar(value[key], `visualBeat information unit ${index} ${key}`);
  }
  if (value.values !== undefined) {
    if (!Array.isArray(value.values) || value.values.length < 1 || value.values.length > 32) {
      throw new TypeError(`visualBeat information unit ${index} values must contain 1 to 32 entries`);
    }
    result.values = Object.freeze(value.values.map((entry, valueIndex) => safeAuthoredScalar(entry, `visualBeat information unit ${index} value ${valueIndex}`)));
  }
  if (Object.keys(result).length === 2) throw new TypeError(`visualBeat information unit ${index} has no display data`);
  return Object.freeze(result);
}

function parseAuthoredAvoidRegion(value: unknown, index: number): VisualBeatAvoidRegion | string {
  if (typeof value === "string") return safeAuthoredIdentifier(value, `visualBeat avoid region ${index}`);
  if (!isRecord(value)) throw new TypeError(`visualBeat avoid region ${index} must be an identifier or object`);
  const allowed = new Set(["id", "role", "x", "y", "width", "height", "priority"]);
  assertExactKeys(value, allowed, `visualBeat avoid region ${index}`);
  const role = value.role;
  const priority = value.priority;
  if (typeof role !== "string" || !AVOID_REGION_ROLES.has(role as VisualBeatAvoidRegion["role"])) {
    throw new TypeError(`visualBeat avoid region ${index} has an unsupported role`);
  }
  if (typeof priority !== "string" || !AVOID_REGION_PRIORITIES.has(priority as VisualBeatAvoidRegion["priority"])) {
    throw new TypeError(`visualBeat avoid region ${index} has an unsupported priority`);
  }
  const x = safeAuthoredNumber(value.x, `visualBeat avoid region ${index} x`);
  const y = safeAuthoredNumber(value.y, `visualBeat avoid region ${index} y`);
  const width = safeAuthoredNumber(value.width, `visualBeat avoid region ${index} width`);
  const height = safeAuthoredNumber(value.height, `visualBeat avoid region ${index} height`);
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    throw new RangeError(`visualBeat avoid region ${index} must be positive normalized geometry inside the frame`);
  }
  return Object.freeze({
    id: safeAuthoredIdentifier(value.id, `visualBeat avoid region ${index} id`),
    role: role as VisualBeatAvoidRegion["role"],
    x, y, width, height,
    priority: priority as VisualBeatAvoidRegion["priority"],
  });
}

function parseAuthoredVisualBeat(scene: AuthoredResolvedScene): AuthoredVisualBeat | undefined {
  const raw = (scene.content as unknown as Readonly<Record<string, unknown>>).visualBeat;
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new TypeError(`Scene ${scene.id} visualBeat must be an object`);
  assertExactKeys(raw, AUTHORED_BEAT_KEYS, `Scene ${scene.id} visualBeat`);
  if (raw.schemaVersion !== 1) throw new TypeError(`Scene ${scene.id} visualBeat requires schemaVersion 1`);
  if (typeof raw.semanticIntent !== "string" || !SEMANTIC_INTENTS.has(raw.semanticIntent as VisualSemanticIntent)) {
    throw new TypeError(`Scene ${scene.id} visualBeat has unsupported semanticIntent`);
  }
  if (typeof raw.compositionFamily !== "string" || !COMPOSITION_FAMILIES.has(raw.compositionFamily as VisualCompositionFamily)) {
    throw new TypeError(`Scene ${scene.id} visualBeat has unsupported compositionFamily`);
  }
  if (!Array.isArray(raw.informationUnits) || raw.informationUnits.length < 1 || raw.informationUnits.length > 8) {
    throw new TypeError(`Scene ${scene.id} visualBeat informationUnits must contain 1 to 8 entries`);
  }
  const rawMotion = typeof raw.motionIntent === "string" ? [raw.motionIntent] : raw.motionIntent;
  if (!Array.isArray(rawMotion) || rawMotion.length < 1 || rawMotion.length > 4) {
    throw new TypeError(`Scene ${scene.id} visualBeat motionIntent must contain 1 to 4 entries`);
  }
  const motionSequence: VisualMotionIntent[] = [];
  for (const motion of rawMotion) {
    if (typeof motion !== "string" || !MOTION_INTENTS.has(motion as VisualMotionIntent)) {
      throw new TypeError(`Scene ${scene.id} visualBeat has unsupported motionIntent`);
    }
    if (!motionSequence.includes(motion as VisualMotionIntent)) motionSequence.push(motion as VisualMotionIntent);
  }
  if (!isRecord(raw.textRoles) || Object.keys(raw.textRoles).length < 1 || Object.keys(raw.textRoles).length > 8) {
    throw new TypeError(`Scene ${scene.id} visualBeat textRoles must contain 1 to 8 entries`);
  }
  const textRoles: Record<string, string> = {};
  for (const [role, label] of Object.entries(raw.textRoles)) {
    if (FORBIDDEN_VISUAL_KEYS.has(role) || !TEXT_ROLE_KEYS.has(role)) throw new TypeError(`Scene ${scene.id} visualBeat has unsupported text role ${role}`);
    textRoles[role] = safeAuthoredText(label, `Scene ${scene.id} visualBeat text role ${role}`, 120);
  }
  if (raw.avoidRegions !== undefined && (!Array.isArray(raw.avoidRegions) || raw.avoidRegions.length > 8)) {
    throw new TypeError(`Scene ${scene.id} visualBeat avoidRegions must contain at most 8 entries`);
  }
  const parsedRegions = (raw.avoidRegions ?? []).map(parseAuthoredAvoidRegion);
  const regionIds = new Set<string>();
  for (const region of parsedRegions) {
    const id = typeof region === "string" ? region : region.id;
    if (regionIds.has(id)) throw new TypeError(`Scene ${scene.id} visualBeat avoid region ${id} is duplicated`);
    regionIds.add(id);
  }
  const authored = Object.freeze({
    semanticIntent: raw.semanticIntent as VisualSemanticIntent,
    compositionFamily: raw.compositionFamily as VisualCompositionFamily,
    focalAnchor: safeAuthoredIdentifier(raw.focalAnchor, `Scene ${scene.id} visualBeat focalAnchor`),
    continuityKey: safeAuthoredIdentifier(raw.continuityKey, `Scene ${scene.id} visualBeat continuityKey`),
    informationUnits: Object.freeze(raw.informationUnits.map(parseAuthoredInformationUnit)),
    ...(raw.visualMetaphor !== undefined ? { visualMetaphor: safeAuthoredText(raw.visualMetaphor, `Scene ${scene.id} visualBeat visualMetaphor`, 240) } : {}),
    attentionCue: safeAuthoredIdentifier(raw.attentionCue, `Scene ${scene.id} visualBeat attentionCue`),
    motionSequence: Object.freeze(motionSequence),
    textRoles: Object.freeze(textRoles),
    avoidRegions: Object.freeze(parsedRegions.filter((region): region is VisualBeatAvoidRegion => typeof region !== "string")),
    namedAvoidRegions: Object.freeze(parsedRegions.filter((region): region is string => typeof region === "string")),
  });
  assertLiftedAuthoredMetadata(scene, authored);
  return authored;
}

function normalizedDisplayText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function compactDisplayLabel(value: string, maximum = 58): string {
  let normalized = normalizedDisplayText(value)
    .replace(DISCOURSE_PREFIX, "")
    .replace(/[.!?]+$/u, "")
    .trim();
  if (!normalized) normalized = normalizedDisplayText(value);
  if (normalized.length <= maximum) return normalized;

  // Prefer a self-contained clause over an arbitrary character crop. This is
  // display copy, not a transcript: narration remains available in captions
  // and audio while the frame carries only the semantic label.
  const clauses = normalized.split(/\s+(?:because|while|which|that|so that|and then)\s+|[;—]\s*/iu);
  const firstClause = clauses.find((clause) => clause.trim().length >= 8)?.trim();
  if (firstClause && firstClause.length <= maximum) return firstClause;
  const boundary = normalized.lastIndexOf(" ", maximum);
  const end = boundary >= Math.floor(maximum * 0.62) ? boundary : maximum;
  return normalized.slice(0, end).replace(/[,:;\s-]+$/u, "");
}

function semanticDisplayLabel(value: string, maximum = 58): string {
  const text = normalizedDisplayText(value).replace(DISCOURSE_PREFIX, "");
  const numberWord = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)";
  const number = `(?:[\\d][\\d,.]*|${numberWord}(?:[ -]${numberWord})*)`;
  const target = text.match(new RegExp(`(?:find|locate|search for)\\s+(${number})\\s+in\\s+(?:a|the)\\s+sorted`, "iu"));
  if (target?.[1]) return `target = ${target[1]} · sorted input`;
  const middle = text.match(new RegExp(`(?:new|next)?\\s*middle(?: value)?\\s+is\\s+(${number})`, "iu"));
  if (middle?.[1]) {
    const found = /(?:succeeds?|found|matches?|complete)/iu.test(text) ? " · target found" : "";
    return `${/new|next/iu.test(middle[0]) ? "new " : ""}mid = ${middle[1]}${found}`;
  }
  const interval = text.match(new RegExp(`(?:starts?|low)\\s+(?:at|=)?\\s*(?:index\\s*)?(${number}).*?(?:ends?|high)\\s+(?:at|=)?\\s*(?:index\\s*)?(${number})`, "iu"));
  if (interval?.[1] && interval[2]) return `search interval [${interval[1]}, ${interval[2]}]`;
  const comparison = text.match(new RegExp(`(${number})\\s+is\\s+(larger|greater|smaller|less)(?:\\s+than)?(?:\\s+(${number}|the middle|middle))?`, "iu"));
  if (comparison?.[1] && comparison[2]) {
    const right = comparison[3] ?? "mid";
    const relation = /larger|greater/iu.test(comparison[2]) ? ">" : "<";
    const discard = /remove|discard/iu.test(text) ? (relation === ">" ? " · discard left half" : " · discard right half") : "";
    return `${comparison[1]} ${relation} ${right.replace(/^the\s+/iu, "")}${discard}`;
  }
  const invariant = /target.*remain.*(?:inside|within).*(?:interval|range)/iu.test(text);
  if (invariant) return "invariant · target stays in retained range";
  const reduction = text.match(new RegExp(`(${number}).*?(${number})\\s+halvings?.*?(?:to|into)\\s+(${number})`, "iu"));
  if (reduction?.[1] && reduction[2] && reduction[3]) return `${reduction[1]} items → ${reduction[2]} halvings → ${reduction[3]} choice`;
  if (/must already be sorted|requires?\s+(?:the\s+)?(?:data|input).*(?:sorted|ordered)/iu.test(text)) return "requirement · sorted data";
  return compactDisplayLabel(text, maximum);
}

function visualDirectiveLabel(value: string): string {
  return compactDisplayLabel(normalizedDisplayText(value).replace(VISUAL_DIRECTIVE_PREFIX, ""), 72);
}

function authoredInformationLabel(unit: AuthoredVisualInformationUnit): string {
  const role = unit.role.toLocaleLowerCase("en-US");
  const value = unit.value === undefined ? undefined : displayScalar(unit.value);
  const low = unit.low === undefined ? undefined : displayScalar(unit.low);
  const middle = unit.middle === undefined ? undefined : displayScalar(unit.middle);
  const high = unit.high === undefined ? undefined : displayScalar(unit.high);
  if (unit.values) return compactDisplayLabel(unit.values.map(displayScalar).join(" · "), 120);
  if (role === "interval" && low !== undefined && high !== undefined) return `[${low}, ${high}]`;
  if (role === "state" && low !== undefined && middle !== undefined && high !== undefined) {
    return `low ${low} · mid ${middle}${value === undefined ? "" : ` = ${value}`} · high ${high}`;
  }
  if (role === "proof-state" && low !== undefined && high !== undefined) {
    return `low ${low} > high ${high}${unit.text ? ` · ${unit.text}` : ""}`;
  }
  if (role === "comparison" && middle !== undefined) {
    const relation = semanticRelationSymbol(unit.relation);
    return `${middle}${relation ? ` ${relation}` : ""}`;
  }
  if (role === "target" && value !== undefined) return `target = ${value}`;
  if (role === "population" && value !== undefined) return `${value} items`;
  if (role === "comparison-value" && value !== undefined) return `${unit.label ?? "value"} ≤ ${value}`;
  if (unit.text) return compactDisplayLabel(unit.text, 88);
  if (unit.label && value !== undefined) return compactDisplayLabel(`${unit.label} = ${value}`, 88);
  if (unit.label) return compactDisplayLabel(unit.label, 88);
  const state: string[] = [];
  if (low !== undefined) state.push(`low ${low}`);
  if (middle !== undefined) state.push(`mid ${middle}`);
  if (high !== undefined) state.push(`high ${high}`);
  if (value !== undefined) state.push(`${role === "target" ? "target" : "value"} ${value}`);
  if (unit.relation) state.push(unit.relation);
  return compactDisplayLabel(state.length ? state.join(" · ") : unit.role.replaceAll("-", " "), 88);
}

function displayScalar(value: string | number): string {
  if (typeof value === "string") return value;
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (!Number.isInteger(absolute)) return `${sign}${String(absolute)}`;
  return `${sign}${String(absolute).replace(/\B(?=(\d{3})+(?!\d))/gu, ",")}`;
}

function semanticRelationSymbol(relation: string | undefined): string | undefined {
  if (!relation) return undefined;
  const normalized = relation.trim().toLocaleLowerCase("en-US").replace(/[\s_]+/gu, "-");
  if (["less-than", "less", "lt", "<"].includes(normalized)) return "<";
  if (["less-than-or-equal", "less-or-equal", "lte", "≤"].includes(normalized)) return "≤";
  if (["greater-than", "greater", "gt", ">"].includes(normalized)) return ">";
  if (["greater-than-or-equal", "greater-or-equal", "gte", "≥"].includes(normalized)) return "≥";
  if (["equal", "equals", "eq", "="].includes(normalized)) return "=";
  if (["not-equal", "neq", "≠"].includes(normalized)) return "≠";
  return compactDisplayLabel(relation, 24);
}

function uniqueLabels(values: readonly string[], limit: number): readonly string[] {
  const result: string[] = [];
  const identities = new Set<string>();
  for (const raw of values) {
    const label = normalizedDisplayText(raw);
    const identity = label.toLocaleLowerCase("en-US");
    if (!label || identities.has(identity)) continue;
    identities.add(identity);
    result.push(label);
    if (result.length === limit) break;
  }
  return Object.freeze(result);
}

const PRIMARY_TEXT_ROLE_ORDER = [
  "hero", "title", "focus", "result", "answer", "formula", "value", "principle", "proof",
  "eyebrow", "kicker", "label", "markers", "support", "subtitle", "counterpoint",
] as const;

function authoredPrimaryLabel(roles: Readonly<Record<string, string>>, fallback: string): string {
  for (const role of PRIMARY_TEXT_ROLE_ORDER) {
    const label = roles[role];
    if (label) return compactDisplayLabel(label, 72);
  }
  return compactDisplayLabel(fallback, 72);
}

function displayInformationUnits(scene: AuthoredResolvedScene): readonly string[] {
  const explicitItems = scene.content.items ?? [];
  const raw = explicitItems.length
    ? explicitItems
    : scene.content.body
      ? scene.content.body.split(SENTENCE_END)
      : [scene.content.title];
  const codeLike = new Set(["code", "live-code", "walkthrough", "diff", "terminal", "formula", "derivation"]);
  const maximum = codeLike.has(scene.kind) ? 88 : 46;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const candidate of raw) {
    const text = semanticDisplayLabel(candidate, maximum);
    const key = text.toLocaleLowerCase("en-US");
    if (!text || seen.has(key)) continue;
    seen.add(key);
    unique.push(text);
    if (unique.length === 6) break;
  }
  return unique.length ? unique : [compactDisplayLabel(scene.content.title, maximum)];
}

function sceneIntent(kind: BuiltinSceneKind): VisualSemanticIntent {
  if (kind === "title" || kind === "section-intro" || kind === "outro") return "establish";
  if (kind === "definition") return "define";
  if (kind === "comparison" || kind === "image-comparison" || kind === "diff") return "compare";
  if (kind === "variable-state" || kind === "simulation") return "transform";
  if (["whiteboard", "code", "live-code", "walkthrough", "terminal", "execution-trace", "ui-demo", "screen-recording", "worked-example"].includes(kind)) return "demonstrate";
  if (["formula", "derivation", "graph", "chart", "table"].includes(kind)) return "prove";
  if (kind === "question" || kind === "quiz") return "question";
  if (kind === "recap" || kind === "summary" || kind === "sources") return "recap";
  if (kind === "quote" || kind === "image-focus" || kind === "document-focus") return "emphasize";
  return "resolve";
}

function primaryComposition(kind: BuiltinSceneKind): VisualCompositionFamily {
  if (kind === "title" || kind === "section-intro" || kind === "outro") return "cinematic_scale";
  if (kind === "presenter" || kind === "presenter-slide") return "presenter";
  if (["diagram", "timeline", "map", "file-tree", "execution-trace", "variable-state"].includes(kind)) return "diagram";
  if (["graph", "chart", "table", "simulation"].includes(kind)) return "data_canvas";
  if (["comparison", "image-comparison", "diff"].includes(kind)) return "split_evidence";
  if (["document-focus", "sources", "screen-recording", "ui-demo"].includes(kind)) return "document_focus";
  if (["whiteboard", "worked-example", "formula", "derivation", "code", "live-code", "walkthrough", "terminal"].includes(kind)) return "worked_example";
  if (kind === "image-focus") return "full_bleed";
  if (["definition", "question", "quote"].includes(kind)) return "object_stage";
  return "editorial_type";
}

const COMPOSITION_ALTERNATIVES: Readonly<Record<VisualCompositionFamily, readonly VisualCompositionFamily[]>> = {
  full_bleed: ["object_stage", "cinematic_scale"],
  editorial_type: ["object_stage", "diagram"],
  object_stage: ["editorial_type", "cinematic_scale"],
  diagram: ["object_stage", "data_canvas"],
  split_evidence: ["diagram", "object_stage"],
  document_focus: ["full_bleed", "split_evidence"],
  data_canvas: ["diagram", "split_evidence"],
  worked_example: ["diagram", "object_stage"],
  presenter: ["split_evidence", "cinematic_scale"],
  cinematic_scale: ["editorial_type", "full_bleed"],
};

function densityFor(scene: AuthoredResolvedScene, units: readonly string[]): VisualBeat["density"] {
  if (["title", "section-intro", "quote", "question", "outro", "presenter"].includes(scene.kind)) return "quiet";
  const characters = units.reduce((total, unit) => total + unit.length, 0);
  return units.length >= 5 || characters > 210 ? "dense" : "balanced";
}

function motionFor(intent: VisualSemanticIntent): VisualMotionIntent {
  if (intent === "compare") return "compare-shift";
  if (intent === "transform") return "transform-object";
  if (intent === "demonstrate" || intent === "prove") return "trace-relationship";
  if (intent === "emphasize") return "evidence-focus";
  if (intent === "resolve" || intent === "recap") return "resolve-hold";
  if (intent === "question") return "quiet-hold";
  return "reveal-primary";
}

function metaphorFor(kind: BuiltinSceneKind, intent: VisualSemanticIntent): string {
  if (["execution-trace", "live-code", "walkthrough", "worked-example"].includes(kind)) return "a retained state transformed one justified step at a time";
  if (kind === "comparison" || kind === "diff") return "two aligned states sharing one measurement axis";
  if (kind === "diagram") return "relationships carried by a continuous explanatory path";
  if (kind === "formula" || kind === "derivation") return "one expression preserving identity through each transformation";
  if (kind === "timeline") return "events placed on one causal thread";
  if (kind === "presenter" || kind === "presenter-slide") return "a guide directing attention toward the lesson object";
  return `${intent} one instructional focus`;
}

function safeMetadataDirection(scene: AuthoredResolvedScene, key: string): string | undefined {
  const value = optionalMetadataString(scene, key);
  if (!value || value.length > 80 || PATH_OR_URL.test(value)) return undefined;
  return compactDisplayLabel(value, 64);
}

function slug(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 48) || "lesson";
}

function avoidRegionsFor(scene: AuthoredResolvedScene): readonly VisualBeatAvoidRegion[] {
  const regions: VisualBeatAvoidRegion[] = [{ id: "visual-title", role: "title", x: 0.05, y: 0.05, width: 0.9, height: 0.2, priority: "preferred" }];
  if (scene.kind === "presenter" || scene.kind === "presenter-slide") {
    const placement = optionalMetadataString(scene, "presenterPlacement") ?? "picture-in-picture";
    if (placement.includes("left")) regions.push({ id: "visual-presenter", role: "presenter", x: 0.04, y: 0.22, width: 0.38, height: 0.7, priority: "required" });
    else if (placement.includes("right")) regions.push({ id: "visual-presenter", role: "presenter", x: 0.58, y: 0.22, width: 0.38, height: 0.7, priority: "required" });
    else regions.push({ id: "visual-presenter", role: "presenter", x: 0.68, y: 0.54, width: 0.28, height: 0.4, priority: "required" });
  } else if (["document-focus", "sources"].includes(scene.kind)) {
    regions.push({ id: "visual-source", role: "source", x: 0.06, y: 0.24, width: 0.88, height: 0.66, priority: "required" });
  } else if (!["title", "section-intro", "outro"].includes(scene.kind)) {
    regions.push({ id: "visual-focus", role: "essential-visual", x: 0.06, y: 0.25, width: 0.88, height: 0.66, priority: "required" });
  }
  return regions;
}

function captionZonesFromBeat(beat: VisualBeat): NonNullable<SceneSpec["captionAvoidZones"]> {
  return beat.avoidRegions.map((region) => ({
    id: region.id,
    reason: region.role === "presenter" ? "presenter" as const
      : region.role === "source" ? "source" as const
        : region.role === "title" ? "essential-text" as const
          : "essential-visual" as const,
    priority: region.priority,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
  }));
}

function visualBeatTags(beat: VisualBeat): readonly string[] {
  const base = [
    `visual:intent=${beat.semanticIntent}`,
    `visual:composition=${beat.compositionFamily}`,
    `visual:anchor=${slug(beat.focalAnchor)}`,
    `visual:continuity=${slug(beat.continuityKey)}`,
    `visual:motion=${beat.motionIntent}`,
    `visual:density=${beat.density}`,
    "visual:narration-on-screen=false",
  ];
  if (beat.source === "derived") return base;
  return [
    ...base,
    `visual:source=${beat.source}`,
    `visual:motion-sequence=${beat.motionSequence.join(",")}`,
    ...beat.namedAvoidRegions.map((region) => `visual:avoid=${region}`),
  ];
}

function visualStateSignature(beat: Pick<VisualBeat, "informationUnits" | "textRoles" | "motionSequence">): string {
  return JSON.stringify([beat.informationUnits, beat.textRoles.labels, beat.motionSequence]);
}

function authoredContinuationCanRepeat(recent: readonly VisualBeat[], candidate: VisualBeat): boolean {
  const first = recent.at(-2);
  const second = recent.at(-1);
  if (!first || !second || candidate.source !== "authored" || first.source !== "authored" || second.source !== "authored") return false;
  if (first.continuityKey !== candidate.continuityKey || second.continuityKey !== candidate.continuityKey) return false;
  const states = new Set([visualStateSignature(first), visualStateSignature(second), visualStateSignature(candidate)]);
  if (states.size !== 3) return false;
  return candidate.motionSequence.some((motion) =>
    motion === "trace-relationship" || motion === "transform-object" || motion === "match-transition" || motion === "emphasize-result",
  );
}

/** Compile the full sequence so composition variety is a project property. */
export function compileVisualBeatSequence(scenes: readonly AuthoredResolvedScene[]): ReadonlyMap<string, VisualBeat> {
  const beats = new Map<string, VisualBeat>();
  const recent: VisualBeat[] = [];
  const firstTitle = scenes[0]?.content.title ?? "lesson";
  const sequenceContinuity = `lesson-${slug(firstTitle)}`;
  scenes.forEach((scene, index) => {
    if (!BUILTIN_SCENE_KIND_SET.has(scene.kind)) return;
    const kind = scene.kind as BuiltinSceneKind;
    const authored = parseAuthoredVisualBeat(scene);
    const units = authored
      ? uniqueLabels(authored.informationUnits.map(authoredInformationLabel), 8)
      : displayInformationUnits(scene);
    const intent = authored?.semanticIntent ?? sceneIntent(kind);
    let composition = authored?.compositionFamily ?? primaryComposition(kind);
    const focalAnchor = authored?.focalAnchor
      ?? safeMetadataDirection(scene, "focalAnchor")
      ?? (kind === "definition" ? safeMetadataDirection(scene, "term") : undefined)
      ?? compactDisplayLabel(scene.content.title, 64);
    const continuityKey = authored?.continuityKey ?? safeMetadataDirection(scene, "continuityKey") ?? sequenceContinuity;
    const visualIntent = scene.content.body ? visualDirectiveLabel(scene.content.body) : undefined;
    const motionSequence = authored?.motionSequence ?? Object.freeze([motionFor(intent)]);
    const roleLabels = authored ? uniqueLabels(Object.values(authored.textRoles), 8) : Object.freeze([...units]);
    const derivedAvoidRegions = avoidRegionsFor(scene);
    const authoredAvoidRegions = authored?.avoidRegions ?? [];
    const avoidRegions = authored
      ? Object.freeze([
        ...authoredAvoidRegions,
        ...derivedAvoidRegions.filter((region) =>
          region.role === "title" && !authoredAvoidRegions.some((authoredRegion) => authoredRegion.role === "title"),
        ),
      ])
      : Object.freeze([...derivedAvoidRegions]);
    let beat: VisualBeat = Object.freeze({
      sceneId: scene.id,
      semanticIntent: intent,
      compositionFamily: composition,
      focalAnchor,
      continuityKey,
      informationUnits: Object.freeze([...units]),
      visualMetaphor: authored?.visualMetaphor ?? (visualIntent || metaphorFor(kind, intent)),
      attentionCue: authored?.attentionCue ?? (intent === "prove" || intent === "demonstrate" ? "attach focus to the changing object" : `hold focus on ${focalAnchor}`),
      motionIntent: motionSequence[0]!,
      motionSequence,
      textRoles: Object.freeze({
        primary: authoredPrimaryLabel(authored?.textRoles ?? {}, scene.content.title),
        labels: authored ? uniqueLabels([...roleLabels, ...units], 8) : roleLabels,
        narrationOnScreen: false as const,
        authored: Object.freeze({ ...(authored?.textRoles ?? {}) }),
      }),
      avoidRegions,
      namedAvoidRegions: authored?.namedAvoidRegions ?? Object.freeze([]),
      density: densityFor(scene, units),
      source: authored ? "authored" : "derived",
    });
    if (
      recent.length >= 2
      && recent.at(-1)?.compositionFamily === composition
      && recent.at(-2)?.compositionFamily === composition
      && !authoredContinuationCanRepeat(recent, beat)
    ) {
      const alternatives = COMPOSITION_ALTERNATIVES[composition];
      composition = alternatives[stableNumericSeed(`${scene.id}:${scene.seed}:${index}`) % alternatives.length]!;
      beat = Object.freeze({ ...beat, compositionFamily: composition });
    }
    beats.set(scene.id, beat);
    recent.push(beat);
    if (recent.length > 2) recent.shift();
  });
  return beats;
}

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

function optionalMetadataString(scene: AuthoredResolvedScene, key: string): string | undefined {
  const value = scene.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sourceLines(scene: AuthoredResolvedScene, beat?: VisualBeat): readonly string[] {
  if (beat?.source === "authored" && beat.informationUnits.length) {
    // Structured information units provide semantic truth, while explicit
    // scene items often carry the concrete numbers a learner needs to see.
    // Preserve both instead of allowing one provider field to erase the
    // other from sparse diagrams, comparisons, formulas, and recaps.
    return uniqueLabels(
      [
        ...beat.informationUnits,
        ...(scene.content.items?.length ? displayInformationUnits(scene) : []),
      ],
      8,
    );
  }
  return displayInformationUnits(scene);
}

function verifiedDistributiveWhiteboardSteps(equation: string): readonly string[] | undefined {
  const compact = equation.replace(/[−–]/gu, "-").replace(/\s+/gu, "");
  const match = compact.match(/^\(([A-Za-z])\+([A-Za-z])\)\(([A-Za-z])\+([A-Za-z])\)-([A-Za-z]{2})-([A-Za-z]{2})=([A-Za-z]{2})\+([A-Za-z]{2})$/u);
  if (!match) return undefined;
  const [, first, second, third, fourth, removedFirst, removedSecond, resultFirst, resultSecond] = match;
  const expanded = [`${first}${third}`, `${first}${fourth}`, `${second}${third}`, `${second}${fourth}`];
  const removed = new Set([removedFirst, removedSecond]);
  const result = new Set([resultFirst, resultSecond]);
  if (removed.size !== 2
    || result.size !== 2
    || !removed.has(expanded[0]!)
    || !removed.has(expanded[3]!)
    || !result.has(expanded[1]!)
    || !result.has(expanded[2]!)) return undefined;
  return Object.freeze([
    `(${first} + ${second})(${third} + ${fourth}) − ${removedFirst} − ${removedSecond}`,
    `= ${expanded.join(" + ")} − ${removedFirst} − ${removedSecond}`,
    `= ${resultFirst} + ${resultSecond}`,
  ]);
}

function whiteboardDisplayLines(
  scene: AuthoredResolvedScene,
  semantic: AuthoredSemanticScene | undefined,
  fallback: readonly string[],
): readonly string[] {
  const normalizeMath = (value: string) => normalizedDisplayText(value).replace(/\s*\*\s*/gu, " × ");
  const ordered = semantic
    ? uniqueLabels([
        ...semantic.units
          .filter((unit) => !roleMatches(unit, ["result", "answer", "conclusion"]))
          .map((unit) => targetAwareInformationLabel(unit, semantic)),
        ...(scene.content.items?.length ? displayInformationUnits(scene) : []),
        ...semantic.units
          .filter((unit) => roleMatches(unit, ["result", "answer", "conclusion"]))
          .map((unit) => targetAwareInformationLabel(unit, semantic)),
      ].map(normalizeMath), 6)
    : uniqueLabels(fallback.map(normalizeMath), 6);

  // A single compact equation makes a poor animated board: it appears once
  // and leaves the writing tool travelling across empty space. Preserve the
  // exact authored expression while exposing a closed, verified identity as a
  // short progressive derivation. Other equations are only split at equality.
  if (ordered.length === 1) {
    const equation = ordered[0]!;
    const verifiedExpansion = verifiedDistributiveWhiteboardSteps(equation);
    if (verifiedExpansion) return verifiedExpansion;
    const equals = [...equation.matchAll(/=/gu)];
    if (equals.length === 1) {
      const splitAt = equals[0]!.index!;
      const left = equation.slice(0, splitAt).trim();
      const right = equation.slice(splitAt + 1).trim();
      return Object.freeze([left, `= ${right}`].filter(Boolean));
    }
    const arrow = equation.split(/\s*→\s*/u);
    if (arrow.length === 2 && arrow.every(Boolean)) {
      return Object.freeze([arrow[0]!.trim(), `→ ${arrow[1]!.trim()}`]);
    }
  }
  return ordered;
}

export interface AuthoredSemanticScene {
  readonly beat: AuthoredVisualBeat;
  readonly units: readonly AuthoredVisualInformationUnit[];
  readonly target: AuthoredVisualInformationUnit | undefined;
  readonly sequence: AuthoredVisualInformationUnit | undefined;
  readonly states: readonly AuthoredVisualInformationUnit[];
  readonly comparisons: readonly AuthoredVisualInformationUnit[];
  readonly code: readonly AuthoredVisualInformationUnit[];
  readonly question: AuthoredVisualInformationUnit | undefined;
  readonly answer: AuthoredVisualInformationUnit | undefined;
  readonly principle: AuthoredVisualInformationUnit | undefined;
}

function normalizedSemanticRole(role: string): string {
  return role.trim().toLocaleLowerCase("en-US").replace(/[\s_]+/gu, "-");
}

export function roleMatches(unit: AuthoredVisualInformationUnit, roles: readonly string[]): boolean {
  const role = normalizedSemanticRole(unit.role);
  return roles.some((candidate) => role === candidate || role.endsWith(`-${candidate}`));
}

export function authoredSemanticScene(scene: AuthoredResolvedScene): AuthoredSemanticScene | undefined {
  const beat = parseAuthoredVisualBeat(scene);
  if (!beat) return undefined;
  const units = beat.informationUnits;
  const find = (roles: readonly string[]) => units.find((unit) => roleMatches(unit, roles));
  const filter = (roles: readonly string[]) => units.filter((unit) => roleMatches(unit, roles));
  return Object.freeze({
    beat,
    units,
    target: find(["target", "hero-value"]),
    sequence: find(["ordered-sequence", "sequence"]),
    states: Object.freeze(filter(["state", "interval", "proof-state"])),
    comparisons: Object.freeze(filter(["comparison", "comparison-value"])),
    code: Object.freeze(filter(["code", "code-line", "pseudocode"])),
    question: find(["question", "prompt"]),
    answer: find(["answer", "result"]),
    principle: find(["principle", "constraint", "rule", "causal-label"]),
  });
}

export function unitText(unit: AuthoredVisualInformationUnit | undefined): string | undefined {
  if (!unit) return undefined;
  return unit.text ?? unit.label;
}

function sequenceText(unit: AuthoredVisualInformationUnit | undefined): string | undefined {
  if (!unit?.values?.length) return unitText(unit);
  return unit.values.map(displayScalar).join(" · ");
}

function scalarText(unit: AuthoredVisualInformationUnit | undefined): string | undefined {
  if (!unit) return undefined;
  if (unit.value !== undefined) return displayScalar(unit.value);
  return unitText(unit);
}

export function targetAwareInformationLabel(unit: AuthoredVisualInformationUnit, semantic: AuthoredSemanticScene): string {
  const target = scalarText(semantic.target);
  const role = normalizedSemanticRole(unit.role);
  if (roleMatches(unit, ["comparison"]) && unit.middle !== undefined) {
    const left = displayScalar(unit.middle);
    const relation = semanticRelationSymbol(unit.relation);
    return `${left}${relation ? ` ${relation}` : ""}${target ? ` ${target}` : ""}`;
  }
  if (role === "state" && unit.low !== undefined && unit.middle !== undefined && unit.high !== undefined) {
    const value = unit.value === undefined ? "" : ` = ${displayScalar(unit.value)}`;
    return `low ${displayScalar(unit.low)} · mid ${displayScalar(unit.middle)}${value} · high ${displayScalar(unit.high)}`;
  }
  if (role === "interval" && unit.low !== undefined && unit.high !== undefined) {
    return `[${displayScalar(unit.low)}, ${displayScalar(unit.high)}]`;
  }
  if (role === "proof-state" && unit.low !== undefined && unit.high !== undefined) {
    return `low ${displayScalar(unit.low)} > high ${displayScalar(unit.high)}${unit.text ? ` · ${unit.text}` : ""}`;
  }
  return authoredInformationLabel(unit);
}

function semanticTextItem(scene: AuthoredResolvedScene, suffix: string, text: string, emphasis?: TextItem["emphasis"], supportingText?: string): TextItem {
  return {
    id: safeChildId(scene.id, suffix),
    text,
    ...(emphasis ? { emphasis } : {}),
    ...(supportingText ? { supportingText } : {}),
  };
}

function exactPositiveInteger(unit: AuthoredVisualInformationUnit | undefined): number | undefined {
  if (!unit || typeof unit.value !== "number" || !Number.isSafeInteger(unit.value) || unit.value < 1) return undefined;
  return unit.value;
}

/**
 * ComparisonRenderer uses item cardinality as its dominant numeric mark. Keep
 * that existing DSL contract meaningful without allowing authored values to
 * allocate unbounded memory. Values within the visual range remain exact;
 * larger magnitudes stay exact in the label and use a bounded density proxy.
 */
function comparisonMeasureItems(unit: AuthoredVisualInformationUnit): readonly string[] {
  const exact = exactPositiveInteger(unit);
  const count = exact === undefined ? 1 : Math.min(exact, 4_096);
  return Object.freeze(Array.from({ length: count }, () => ""));
}

function oppositeAnswer(answer: string): string {
  const normalized = answer.trim().toLocaleLowerCase("en-US");
  if (normalized === "no") return "YES";
  if (normalized === "yes") return "NO";
  if (normalized === "false") return "TRUE";
  if (normalized === "true") return "FALSE";
  return "Try another conclusion";
}

function textItems(scene: AuthoredResolvedScene, beat?: VisualBeat): readonly TextItem[] {
  return sourceLines(scene, beat).map((text, index) => ({
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

function commonContent(scene: AuthoredResolvedScene, kind: BuiltinSceneKind, beat?: VisualBeat) {
  // Unreviewed provider bitmaps commonly smuggle glyph-like marks into an
  // otherwise text-free prompt. Keep those generated candidates in immutable
  // provenance, but do not paint them behind authored typography. Explicit
  // project/starter background IDs remain fully supported.
  const background = scene.visualAssets?.find((asset) =>
    asset.role === "background" && !asset.assetId.startsWith("visual-"));
  const carriesSubtitle = kind === "title" || kind === "section-intro" || kind === "outro";
  const authoredRoles = beat?.source === "authored" ? beat.textRoles.authored : {};
  const authoredRole = (role: string): string | undefined => {
    const value = authoredRoles[role];
    return value && !GENERIC_TEXT_ROLE_PLACEHOLDERS.has(value.toLocaleLowerCase("en-US"))
      ? value
      : undefined;
  };
  const authoredTitle = authoredRole("title");
  const authoredEyebrow = authoredRole("eyebrow") ?? authoredRole("kicker");
  const authoredSubtitle = authoredRole("subtitle") ?? authoredRole("support");
  return {
    title: compactDisplayLabel(authoredTitle ?? scene.content.title, 72),
    ...((authoredEyebrow ?? scene.content.eyebrow) ? {
      eyebrow: compactDisplayLabel(authoredEyebrow ?? scene.content.eyebrow!, 42),
    } : {}),
    ...(carriesSubtitle && (authoredSubtitle ?? scene.content.body) ? {
      subtitle: visualDirectiveLabel(authoredSubtitle ?? scene.content.body!),
    } : {}),
    ...(background ? { background: {
      id: background.assetId,
      sha256: background.sha256,
      alt: background.alt,
      fit: background.fit ?? "cover" as const,
      treatment: background.treatment ?? "aperture" as const,
    } } : {}),
  };
}

function semanticVisual(scene: AuthoredResolvedScene, role: "primary" | "secondary" | "presenter-portrait") {
  return scene.visualAssets?.find((asset) => asset.role === role);
}

function assetReference(scene: AuthoredResolvedScene, role: "primary" | "secondary" | "presenter-portrait", fallbackId: string, fallbackAlt: string) {
  const visual = semanticVisual(scene, role);
  return visual
    ? { id: visual.assetId, sha256: visual.sha256, alt: visual.alt, fit: visual.fit ?? "contain" as const }
    : { id: fallbackId, alt: fallbackAlt, fit: "contain" as const };
}

interface NarrationActionWindow {
  readonly startTick: number;
  readonly endTick: number;
  readonly anchor: string;
}

function narrationActionWindows(scene: AuthoredResolvedScene, count: number): readonly NarrationActionWindow[] {
  if (count <= 0) return [];
  const words = scene.narrationTiming?.words;
  if (words && words.length >= count) {
    return Array.from({ length: count }, (_, index) => {
      const firstIndex = Math.floor(index * words.length / count);
      const exclusiveEnd = Math.max(firstIndex + 1, Math.floor((index + 1) * words.length / count));
      const windowWords = words.slice(firstIndex, exclusiveEnd);
      return {
        startTick: windowWords[0]!.startTick,
        endTick: windowWords[windowWords.length - 1]!.endTick,
        anchor: windowWords.map((word) => word.token).join(" "),
      };
    });
  }

  // Every speech model remains usable when it supplies no timing at all.
  // Reserve a small visual lead-in/tail, then spread actions deterministically
  // across the actual scene duration rather than assuming a fixed scene size.
  const start = Math.min(scene.durationTicks - 1, Math.min(240_000, Math.floor(scene.durationTicks * 0.08)));
  const end = Math.max(start + 1, Math.min(scene.durationTicks, Math.ceil(scene.durationTicks * 0.92)));
  const span = end - start;
  return Array.from({ length: count }, (_, index) => {
    const windowStart = start + Math.floor(index * span / count);
    const windowEnd = Math.max(windowStart + 1, start + Math.floor((index + 1) * span / count));
    return { startTick: windowStart, endTick: windowEnd, anchor: "" };
  });
}

/**
 * Deterministically upgrades the intentionally narrow renderer wire record to
 * the built-in semantic scene DSL. The bridge derives display-only data from
 * manifest text; it never interprets metadata as a path, URL, or executable
 * payload. Media scenes therefore receive stable asset ids and can only show
 * bytes supplied by the separately verified CAS asset resolver.
 */
export function resolveBuiltinSceneSpec(scene: AuthoredResolvedScene, suppliedBeat?: VisualBeat): SceneSpec | undefined {
  if (!BUILTIN_SCENE_KIND_SET.has(scene.kind)) return undefined;
  const kind = scene.kind as BuiltinSceneKind;
  const beat = suppliedBeat ?? compileVisualBeatSequence([scene]).get(scene.id)!;
  const lines = sourceLines(scene, beat);
  const items = textItems(scene, beat);
  const common = commonContent(scene, kind, beat);
  const semantic = beat.source === "authored" ? authoredSemanticScene(scene) : undefined;
  const child = (suffix: string) => safeChildId(scene.id, suffix);
  const semanticDataValues = semantic?.units.flatMap((unit, index) => {
    if (typeof unit.value === "number") return [{ x: index + 1, y: unit.value, label: authoredInformationLabel(unit) }];
    if (typeof unit.middle === "number") return [{ x: index + 1, y: unit.middle, label: targetAwareInformationLabel(unit, semantic) }];
    return [];
  }) ?? [];
  if (["graph", "chart", "simulation"].includes(kind) && semanticDataValues.length === 0) {
    throw new TypeError(`Scene ${scene.id} requires authored numeric values for ${kind}`);
  }
  const dataSeries = [{
    id: child("series-1"),
    label: scene.content.title,
    values: semanticDataValues,
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
      if (semantic) {
        const ordered = sequenceText(semantic.sequence);
        const middle = semantic.comparisons[0] ? targetAwareInformationLabel(semantic.comparisons[0], semantic) : undefined;
        const causal = unitText(semantic.principle);
        const label = semantic.beat.textRoles.label ?? "sorted input";
        const symbolicValues = semantic.sequence?.values?.map(displayScalar);
        const concreteValues = semantic.comparisons[0]?.values?.map(displayScalar);
        const placeValueRelationship = symbolicValues?.length === 2 && concreteValues?.length === 2 && causal
          ? {
              symbolic: [symbolicValues[0]!, symbolicValues[1]!] as const,
              concrete: [concreteValues[0]!, concreteValues[1]!] as const,
              rule: causal,
            }
          : undefined;
        content = {
          kind,
          ...common,
          term: label,
          definition: ordered ? `${label} · ${ordered}` : (middle ?? lines[0]!),
          ...((middle || causal) ? { example: [middle, causal].filter(Boolean).join(" · ") } : {}),
          ...(placeValueRelationship ? { placeValueRelationship } : {}),
        };
      } else {
        content = {
          kind,
          ...common,
          term: optionalMetadataString(scene, "term") ?? scene.content.title,
          definition: visualDirectiveLabel(scene.content.body ?? lines[0]!),
          ...(lines[1] ? { example: lines[1] } : {}),
        };
      }
      break;
    case "bullets":
    case "recap":
    case "summary":
      content = {
        kind,
        ...common,
        items: semantic?.units.length
          ? semantic.units.slice(0, 6).map((unit, index) => semanticTextItem(
              scene,
              `summary-unit-${index + 1}`,
              targetAwareInformationLabel(unit, semantic),
              index === 0 ? "primary" : undefined,
            ))
          : items,
      };
      break;
    case "comparison": {
      const contrastLine = lines.find((line) => /\s+vs\.?\s+/iu.test(line));
      const recurrence = lines.find((line) => /T\(n\)\s*=\s*3T\(n\s*\/\s*2\)/iu.test(line));
      const complexity = contrastLine?.split(/\s+vs\.?\s+/iu).map((value) => value.trim());
      if (recurrence && complexity?.length === 2) {
        const leftEvidence = recurrence.includes(complexity[0]!)
          ? recurrence
          : `${recurrence} → ${complexity[0]!}`;
        content = {
          kind,
          ...common,
          left: {
            label: "Three-product recurrence",
            items: [leftEvidence],
            count: 3,
            countLabel: "recursive products",
          },
          right: {
            label: "Four-product recurrence",
            items: [`T(n)=4T(n/2)+O(n) → ${complexity[1]!}`],
            count: 4,
            countLabel: "recursive products",
          },
          verdict: "Three recursive products replace four as input size grows",
          curveComparison: {
            firstLabel: "Schoolbook O(n²)",
            firstExponent: 2,
            secondLabel: "Karatsuba O(n¹·⁵⁸⁵)",
            secondExponent: Math.log2(3),
            xLabel: "INPUT SIZE n",
            yLabel: "RELATIVE MULTIPLICATIONS",
          },
        };
      } else if (semantic?.comparisons.length && semantic.comparisons.filter((unit) => unit.value !== undefined).length >= 2) {
        const measures = semantic.comparisons.filter((unit) => unit.value !== undefined).slice(0, 2);
        const leftUnit = measures[0]!;
        const rightUnit = measures[1] ?? measures[0]!;
        const verdictParts = [
          semantic.units.find((unit) => roleMatches(unit, ["formula"]))?.text,
          semantic.units.find((unit) => roleMatches(unit, ["constraint", "principle"]))?.text,
        ].filter((value): value is string => Boolean(value));
        content = {
          kind,
          ...common,
          left: {
            label: authoredInformationLabel(leftUnit),
            items: comparisonMeasureItems(leftUnit),
          },
          right: {
            label: authoredInformationLabel(rightUnit),
            items: comparisonMeasureItems(rightUnit),
          },
          ...(verdictParts.length ? { verdict: verdictParts.join(" · ") } : {}),
        };
      } else {
        const split = Math.max(1, Math.ceil(lines.length / 2));
        const left = lines.slice(0, split);
        const right = lines.slice(split);
        content = {
          kind,
          ...common,
          left: { label: optionalMetadataString(scene, "leftLabel") ?? "First view", items: left },
          right: { label: optionalMetadataString(scene, "rightLabel") ?? "Second view", items: right.length ? right : left },
          ...(scene.content.body ? { verdict: visualDirectiveLabel(scene.content.body) } : {}),
        };
      }
      break;
    }
    case "diagram": {
      const semanticLines = semantic
        ? uniqueLabels([
            ...semantic.units.map((unit) => targetAwareInformationLabel(unit, semantic)),
            ...(scene.content.items?.length ? displayInformationUnits(scene) : []),
          ], 8)
        : lines;
      const nodes = semanticLines.map((text, index) => ({
        id: child(`node-${index + 1}`),
        label: text,
        tone: index === 0 ? "primary" as const : index === semanticLines.length - 1 ? "secondary" as const : "neutral" as const,
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
      {
        const semanticResult = semantic
          ? unitText(semantic.answer)
            ?? unitText(semantic.principle)
            ?? unitText(semantic.units.find((unit) => roleMatches(unit, ["result"])))
          : undefined;
      content = {
        kind,
        ...common,
        expression: lines[0]!,
        ...(lines.length > 1 ? { steps: lines.slice(1).map((expression, index) => ({
          id: child(`step-${index + 1}`),
          expression,
          ...(semantic?.units[index + 1]?.role ? { reason: normalizedSemanticRole(semantic.units[index + 1]!.role).replaceAll("-", " ") } : {}),
        })) } : {}),
        ...(semanticResult ? { result: semanticResult } : scene.content.body ? { result: visualDirectiveLabel(scene.content.body) } : {}),
      };
      break;
      }
    case "graph":
      content = { kind, ...common, series: dataSeries, xLabel: "Step", yLabel: "Value" };
      break;
    case "whiteboard": {
      const boardLines = whiteboardDisplayLines(scene, semantic, lines);
      const actionWindows = narrationActionWindows(scene, boardLines.length);
      const derivation = boardLines.some((line) => /[=+\-×÷√²³∑]|\^\d/.test(line));
      const rowStep = boardLines.length > 4 ? 0.145 : boardLines.length > 2 ? 0.2 : 0.28;
      const firstRow = boardLines.length > 4 ? 0.12 : boardLines.length > 2 ? 0.18 : 0.3;
      content = {
        kind,
        ...common,
        boardStyle: "whiteboard",
        layout: derivation ? "derivation" : "notes",
        generatedLayout: "progressive-list",
        showWritingTool: true,
        finalBoardDescription: boardLines.join(". "),
        strokes: boardLines.map((text, index) => ({
          id: child(`stroke-${index + 1}`),
          points: [
            { x: 0.12, y: firstRow + 0.04 + index * rowStep },
            { x: Math.min(0.9, 0.12 + Math.max(0.2, text.length * 0.014)), y: firstRow + 0.04 + index * rowStep },
          ],
          startTick: Math.max(actionWindows[index]!.startTick + 1, Math.round(actionWindows[index]!.startTick + (actionWindows[index]!.endTick - actionWindows[index]!.startTick) * 0.76)),
          endTick: actionWindows[index]!.endTick,
          tool: "pencil" as const,
          color: index === boardLines.length - 1 ? "primary" as const : index % 2 === 0 ? "ink" as const : "secondary" as const,
        })),
        labels: boardLines.map((text, index) => ({
          id: child(`label-${index + 1}`),
          text,
          x: 0.12,
          y: firstRow + index * rowStep,
          startTick: actionWindows[index]!.startTick,
          endTick: Math.max(actionWindows[index]!.startTick + 1, Math.round(actionWindows[index]!.startTick + (actionWindows[index]!.endTick - actionWindows[index]!.startTick) * 0.72)),
          fontScale: boardLines.length > 4 ? 0.9 : 1,
          ...(index === boardLines.length - 1 ? { color: "primary" as const, emphasis: "result" as const } : {}),
        })),
      };
      break;
    }
    case "code":
    case "live-code":
    case "walkthrough":
    case "diff":
    case "terminal":
      {
      const declaredLanguage = optionalMetadataString(scene, "language");
      const arithmeticProgram = !semantic?.code.length && !declaredLanguage && kind !== "terminal" && kind !== "diff"
        ? compileArithmeticAssignmentProgram(scene.content.items ?? scene.content.onScreenText ?? [])
        : undefined;
      const resolvedLines: readonly { readonly id: string; readonly text: string; readonly annotation?: string; readonly highlight: boolean }[] = arithmeticProgram
        ? arithmeticProgram.lines.map((line, index) => ({ id: child(`line-${index + 1}`), text: line.text, annotation: line.annotation, highlight: index === 0 }))
        : (semantic?.code.length ? semantic.code.map((unit) => unitText(unit) ?? authoredInformationLabel(unit)) : lines)
          .map((text, index) => ({ id: child(`line-${index + 1}`), text, highlight: index === 0 }));
      const actionWindows = narrationActionWindows(scene, resolvedLines.length);
      content = {
        kind,
        ...common,
        language: kind === "terminal" ? "text" : arithmeticProgram?.language ?? declaredLanguage ?? "text",
        filename: kind === "terminal"
          ? "Tutorial console"
          : arithmeticProgram?.filename ?? optionalMetadataString(scene, "filename") ?? (declaredLanguage ? "Pseudocode" : "Worked steps"),
        lines: resolvedLines,
        ...(kind === "live-code" ? { actions: resolvedLines.flatMap((line, index) => {
          const window = actionWindows[index]!;
          const span = window.endTick - window.startTick;
          const typeEnd = Math.max(window.startTick + 1, Math.round(window.startTick + span * (arithmeticProgram ? 0.58 : 0.68)));
          const runStart = Math.min(window.endTick - 1, Math.max(typeEnd, Math.round(window.startTick + span * 0.64)));
          const runEnd = Math.min(window.endTick, Math.max(runStart + 1, Math.round(window.startTick + span * 0.82)));
          const explainStart = arithmeticProgram ? runEnd : Math.min(typeEnd, Math.max(window.startTick, window.endTick - 1));
          const narrationAnchor = window.anchor || undefined;
          return [
            { id: child(`type-${index + 1}`), type: "type" as const, lineId: line.id, startTick: window.startTick, endTick: typeEnd, ...(narrationAnchor ? { narrationAnchor } : {}) },
            ...(arithmeticProgram ? [{ id: child(`run-${index + 1}`), type: "run" as const, lineId: line.id, startTick: runStart, endTick: runEnd, output: line.annotation! }] : []),
            { id: child(`explain-${index + 1}`), type: "explain" as const, lineId: line.id, startTick: explainStart, endTick: window.endTick, ...(narrationAnchor ? { narrationAnchor } : {}) },
          ];
        }) } : {}),
      };
      break;
      }
    case "file-tree":
      content = {
        kind,
        ...common,
        entries: lines.map((_, index) => ({ id: child(`entry-${index + 1}`), path: `lesson/step-${String(index + 1).padStart(2, "0")}.md`, type: "file" as const, emphasis: index === 0 })),
      };
      break;
    case "execution-trace":
      if (semantic?.states.length) {
        const frames = semantic.states.map((unit, index) => {
          const variables: Record<string, string> = {};
          if (unit.low !== undefined) variables.low = displayScalar(unit.low);
          if (unit.middle !== undefined) variables.mid = displayScalar(unit.middle);
          if (unit.high !== undefined) variables.high = displayScalar(unit.high);
          if (unit.value !== undefined) variables.value = displayScalar(unit.value);
          return { id: child(`frame-${index + 1}`), label: targetAwareInformationLabel(unit, semantic), line: index + 1, variables };
        });
        content = { kind, ...common, frames, activeFrame: Math.max(0, frames.length - 1) };
      } else {
        content = {
          kind,
          ...common,
          frames: lines.map((text, index) => ({ id: child(`frame-${index + 1}`), label: text, line: index + 1, variables: { concept: text } })),
          activeFrame: 0,
        };
      }
      break;
    case "variable-state":
      content = { kind, ...common, before: { concept: lines[0]! }, after: { concept: lines.at(-1)! }, operation: visualDirectiveLabel(scene.content.body ?? "Transform") };
      break;
    case "chart":
      content = { kind, ...common, chartType: "bar", series: dataSeries, xLabel: "Step", yLabel: "Value" };
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
      {
        const values = semanticDataValues.map((point) => point.y);
        const minimum = Math.min(...values);
        const maximum = Math.max(...values);
        const padding = Math.max(1, (maximum - minimum) * 0.1);
      content = {
        kind,
        ...common,
        variables: semanticDataValues.slice(0, 5).map((point, index) => ({
          id: child(`variable-${index + 1}`),
          label: point.label ?? `Value ${index + 1}`,
          value: point.y,
          min: minimum - padding,
          max: maximum + padding,
        })),
        observation: visualDirectiveLabel(scene.content.body ?? lines[0]!),
        series: dataSeries,
      };
      break;
      }
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
      const comparableHeading = (value: string) => normalizedDisplayText(value)
        .toLocaleLowerCase("en-US")
        .replace(/^\d+[.):\s-]+/u, "")
        .replace(/[.!?:]+$/u, "")
        .trim();
      const titleHeading = comparableHeading(scene.content.title);
      const presenterItems = (semantic
        ? semantic.units.slice(0, 4).map((unit, index) => semanticTextItem(scene, `presenter-unit-${index + 1}`, targetAwareInformationLabel(unit, semantic), index === 0 ? "primary" : undefined))
        : items).filter((item) => comparableHeading(item.text) !== titleHeading);
      const authoredQuestion = normalizedDisplayText(scene.content.title);
      const questionLead = scene.content.title.trim().endsWith("?")
        ? semanticTextItem(
            scene,
            "presenter-question",
            authoredQuestion.length <= 120 ? authoredQuestion : `${compactDisplayLabel(authoredQuestion, 119)}?`,
            "primary",
          )
        : undefined;
      content = {
        kind,
        ...common,
        presenterName: optionalMetadataString(scene, "presenterName") ?? "AI Video Tutorial Guide",
        portrait: assetReference(scene, "presenter-portrait", "presenter-placeholder", "Presenter portrait"),
        talkingPoint: semantic?.target ? `Target ${scalarText(semantic.target)}` : visualDirectiveLabel(scene.content.body ?? lines[0]!),
        ...(kind === "presenter-slide" ? { slideItems: questionLead ? [questionLead, ...presenterItems.slice(0, 3)] : presenterItems } : {}),
        disclosure: optionalMetadataString(scene, "presenterDisclosure") ?? "Synthetic presenter",
        placement,
        idleMotion: {
          enabled: true,
          blink: true,
          breathing: true,
          restMouth: "closed",
        },
      };
      break;
    }
    case "quote":
      content = { kind, ...common, quote: compactInstruction(scene.content.body ?? lines[0]!, 150), attribution: optionalMetadataString(scene, "attribution") ?? "Tutorial narration" };
      break;
    case "question":
      content = { kind, ...common, question: visualDirectiveLabel(scene.content.body ?? lines[0]!), ...(lines[1] ? { prompt: lines[1] } : {}), thinkingTimeSeconds: 5 };
      break;
    case "worked-example":
      // Worked-example cards need room for their answer and the persistent
      // caption-safe lower band. Keep instructional steps concise instead of
      // pouring narration paragraphs into a compact procedural layout.
      if (semantic && (semantic.sequence || semantic.states.length)) {
        const sequence = sequenceText(semantic.sequence);
        const target = scalarText(semantic.target);
        const stateUnits = semantic.states.length ? semantic.states : semantic.units.filter((unit) => unit !== semantic.sequence && unit !== semantic.target);
        const found = semantic.states.find((unit) => target !== undefined && unit.value !== undefined && displayScalar(unit.value) === target);
        const foundIndex = found?.middle;
        content = {
          kind,
          ...common,
          problem: [target ? `Find ${target}` : undefined, sequence].filter(Boolean).join(" · "),
          steps: stateUnits.slice(0, 4).map((unit, index) => semanticTextItem(
            scene,
            `worked-step-${index + 1}`,
            targetAwareInformationLabel(unit, semantic),
            index === 0 ? "primary" : index === stateUnits.length - 1 ? "secondary" : undefined,
            index === 0 ? "compare the middle, then retain one justified interval" : undefined,
          )),
          answer: found
            ? `found ${target ?? displayScalar(found.value!)}${foundIndex === undefined ? "" : ` at index ${displayScalar(foundIndex)}`}`
            : (unitText(semantic.answer) ?? targetAwareInformationLabel(stateUnits.at(-1)!, semantic)),
        };
      } else {
        const answerLine = lines.find((line) => /(?:succeeds?|found|complete)/iu.test(line))
          ?? lines.find((line) => /(?:answer|result|therefore|thus|=)/iu.test(line))
          ?? lines.at(-1)!;
        const proceduralLines = lines.filter((line) => line !== answerLine);
        content = {
          kind,
          ...common,
          problem: compactDisplayLabel(scene.content.title, 96),
          steps: (proceduralLines.length ? proceduralLines : lines).slice(0, 4).map((text, index) => ({
            id: child(`worked-step-${index + 1}`),
            // The worked-example renderer has two deliberate lines per row.
            // Keep the visual explanation complete instead of pre-truncating it
            // to a single narration fragment with an ellipsis.
            text: compactInstruction(text, 180),
            ...(index === 0 ? { emphasis: "primary" as const } : {}),
          })),
          answer: compactInstruction(
            answerLine,
            112,
          ),
        };
      }
      break;
    case "quiz": {
      if (semantic?.question && semantic.answer) {
        const question = unitText(semantic.question) ?? authoredInformationLabel(semantic.question);
        const sequence = sequenceText(semantic.sequence);
        const answer = unitText(semantic.answer) ?? authoredInformationLabel(semantic.answer);
        const principle = unitText(semantic.principle);
        content = {
          kind,
          ...common,
          question: [sequence, question].filter(Boolean).join(" · "),
          options: [answer, oppositeAnswer(answer)].map((label, index) => ({ id: child(`option-${index + 1}`), label, correct: index === 0 })),
          revealAnswer: true,
          ...(principle ? { explanation: principle } : {}),
        };
      } else {
        const choices = lines.length > 1 ? lines.slice(0, 6) : [lines[0]!, "Review the explanation"];
        content = {
          kind,
          ...common,
          question: visualDirectiveLabel(scene.content.body ?? scene.content.title),
          options: choices.map((label, index) => ({ id: child(`option-${index + 1}`), label, correct: index === 0 })),
          revealAnswer: false,
        };
      }
      break;
    }
    case "sources":
      content = {
        kind,
        ...common,
        sources: semantic
          ? semantic.units.map((unit, index) => {
              const role = normalizedSemanticRole(unit.role);
              const isSource = roleMatches(unit, ["source"]);
              return {
                id: child(`source-${index + 1}`),
                title: authoredInformationLabel(unit),
                marker: String(index + 1),
                creator: isSource ? "VERIFIED SOURCE" : role.replaceAll("-", " ").toUpperCase(),
                ...(isSource ? { license: /CC0/iu.test(authoredInformationLabel(unit)) ? "CC0-1.0" : "HISTORICAL RECORD" } : {}),
              };
            })
          : lines.map((title, index) => ({ id: child(`source-${index + 1}`), title, creator: "PROJECT EVIDENCE" })),
      };
      break;
    case "outro":
      content = { kind, ...common, nextSteps: lines.slice(0, 4), callToAction: visualDirectiveLabel(scene.content.body ?? "Continue learning") };
      break;
  }

  return {
    id: scene.id,
    content,
    durationTicks: scene.durationTicks,
    seed: stableNumericSeed(`${scene.id}:${scene.seed}`),
    ...(scene.accessibilityDescription ? { accessibilityDescription: scene.accessibilityDescription } : {}),
    captionAvoidZones: captionZonesFromBeat(beat),
    tags: visualBeatTags(beat),
  };
}
