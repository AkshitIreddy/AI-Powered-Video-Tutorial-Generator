import { evaluateCatalogCompatibility } from "./compatibility";
import {
  emptyCatalogFilters,
  type CatalogFilterState,
  type CatalogItem,
  type CatalogSort,
  type CompatibilityContext,
  type CompatibilityLevel,
  type CompatibilityResult,
} from "./types";

export const catalogQueryFields = [
  "source", "provider", "publisher", "capability", "artifact", "boundary",
  "license", "compatibility", "base", "runtime", "format", "precision",
  "quantization", "tag", "installed", "gated", "safetensors", "vram",
  "ram", "downloads", "likes",
] as const;

export type CatalogQueryField = (typeof catalogQueryFields)[number];
export type CatalogQueryOperator = ":" | "=" | "<" | "<=" | ">" | ">=";

export interface CatalogQueryTerm {
  kind: "text" | "field";
  field: CatalogQueryField | null;
  operator: CatalogQueryOperator | null;
  value: string;
  negated: boolean;
  raw: string;
}

export interface CatalogQueryError {
  token: string;
  message: string;
}

export interface ParsedCatalogQuery {
  terms: readonly CatalogQueryTerm[];
  errors: readonly CatalogQueryError[];
}

export interface CatalogSearchResult {
  item: CatalogItem;
  compatibility: CompatibilityResult;
  score: number;
}

export interface CatalogQueryOptions {
  query?: string;
  filters?: CatalogFilterState;
  sort?: CatalogSort;
  context: CompatibilityContext;
}

const fieldPattern = /^([a-z-]+)(<=|>=|:|=|<|>)(.*)$/i;
const numericFields = new Set<CatalogQueryField>(["vram", "ram", "downloads", "likes"]);
const byteUnits: Readonly<Record<string, number>> = {
  b: 1,
  kb: 1_000,
  mb: 1_000_000,
  gb: 1_000_000_000,
  kib: 1_024,
  mib: 1_048_576,
  gib: 1_073_741_824,
};

function tokenize(query: string): readonly string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const character of query.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (quote !== null) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (escaped) current += "\\";
  if (current) tokens.push(current);
  return tokens;
}

function isQueryField(value: string): value is CatalogQueryField {
  return (catalogQueryFields as readonly string[]).includes(value);
}

export function parseCatalogQuery(query: string): ParsedCatalogQuery {
  const terms: CatalogQueryTerm[] = [];
  const errors: CatalogQueryError[] = [];
  for (const token of tokenize(query)) {
    const negated = token.startsWith("-") && token.length > 1;
    const raw = negated ? token.slice(1) : token;
    const match = raw.match(fieldPattern);
    if (!match) {
      terms.push({ kind: "text", field: null, operator: null, value: raw, negated, raw: token });
      continue;
    }
    const fieldName = (match[1] ?? "").toLowerCase();
    const operator = (match[2] ?? ":") as CatalogQueryOperator;
    const value = (match[3] ?? "").trim();
    if (!isQueryField(fieldName)) {
      errors.push({ token, message: `Unknown query field “${match[1]}”.` });
    } else if (!value) {
      errors.push({ token, message: `Query field “${fieldName}” needs a value.` });
    } else if (!numericFields.has(fieldName) && operator !== ":" && operator !== "=") {
      errors.push({ token, message: `Field “${fieldName}” only supports : or =.` });
    } else {
      terms.push({ kind: "field", field: fieldName, operator, value, negated, raw: token });
    }
  }
  return { terms, errors };
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase();
}

function textMatches(actual: string | null | undefined, expected: string): boolean {
  const haystack = normalize(actual);
  const needle = normalize(expected);
  return haystack === needle || haystack.includes(needle);
}

function anyMatches(values: readonly string[], expected: string): boolean {
  return values.some((value) => textMatches(value, expected));
}

function fullTextMatches(item: CatalogItem, value: string): boolean {
  return [
    item.identity.name,
    item.identity.publisher,
    item.identity.sourceId,
    item.identity.revision,
    item.presentation.description,
    item.classification.architecture,
    ...item.classification.baseFamilies,
    ...item.classification.tags,
    ...item.classification.capabilities,
  ].some((candidate) => textMatches(candidate, value));
}

function parseBoolean(value: string): boolean | null {
  if (["true", "yes", "1", "on"].includes(normalize(value))) return true;
  if (["false", "no", "0", "off"].includes(normalize(value))) return false;
  return null;
}

function parseQuantity(value: string, bytes: boolean): number | null {
  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*([a-z]+)?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  if (!bytes) return match[2] ? null : amount;
  const multiplier = byteUnits[normalize(match[2] ?? "b")];
  return multiplier === undefined ? null : amount * multiplier;
}

function compareNumber(actual: number | null, expected: number, operator: CatalogQueryOperator): boolean {
  if (actual === null) return false;
  if (operator === "<") return actual < expected;
  if (operator === "<=") return actual <= expected;
  if (operator === ">") return actual > expected;
  if (operator === ">=") return actual >= expected;
  return actual === expected;
}

function fieldMatches(item: CatalogItem, compatibility: CompatibilityResult, term: CatalogQueryTerm): boolean {
  const field = term.field;
  const operator = term.operator ?? ":";
  const value = term.value;
  if (field === null) return false;
  switch (field) {
    case "source": return textMatches(item.identity.source, value);
    case "provider": return textMatches(item.identity.providerId, value);
    case "publisher": return textMatches(item.identity.publisher, value);
    case "capability": return anyMatches(item.classification.capabilities, value);
    case "artifact": return textMatches(item.classification.artifactType, value);
    case "boundary": return anyMatches(item.execution.boundaries, value);
    case "license": return textMatches(item.license.status, value) || textMatches(item.license.identifier, value) || textMatches(item.license.commercialUse, value);
    case "compatibility": return textMatches(compatibility.level, value);
    case "base": return anyMatches(item.classification.baseFamilies, value);
    case "runtime": return anyMatches(item.execution.runtimes, value);
    case "format": return anyMatches(item.execution.formats, value);
    case "precision": return anyMatches(item.execution.precisions, value);
    case "quantization": return anyMatches(item.execution.quantizations, value);
    case "tag": return anyMatches(item.classification.tags, value);
    case "installed": {
      const expected = parseBoolean(value);
      return expected !== null && (item.localInstall !== null && item.localInstall.status !== "missing") === expected;
    }
    case "gated": {
      const expected = parseBoolean(value);
      return expected !== null && item.trust.gated === expected;
    }
    case "safetensors": {
      const expected = parseBoolean(value);
      return expected !== null && item.trust.safetensors === expected;
    }
    case "vram":
    case "ram": {
      const expected = parseQuantity(value, true);
      const actual = field === "vram" ? item.requirements.estimatedVramBytes : item.requirements.estimatedRamBytes;
      return expected !== null && compareNumber(actual, expected, operator);
    }
    case "downloads":
    case "likes": {
      const expected = parseQuantity(value, false);
      const actual = field === "downloads" ? item.metrics.downloads : item.metrics.likes;
      return expected !== null && compareNumber(actual, expected, operator);
    }
  }
}

function termMatches(item: CatalogItem, compatibility: CompatibilityResult, term: CatalogQueryTerm): boolean {
  const matches = term.kind === "text" ? fullTextMatches(item, term.value) : fieldMatches(item, compatibility, term);
  return term.negated ? !matches : matches;
}

function intersects<T extends string>(actual: readonly T[], selected: readonly T[]): boolean {
  return selected.length === 0 || actual.some((value) => selected.includes(value));
}

function filtersMatch(item: CatalogItem, compatibility: CompatibilityResult, filters: CatalogFilterState): boolean {
  if (!intersects([item.identity.source], filters.sources)) return false;
  if (!intersects(item.classification.capabilities, filters.capabilities)) return false;
  if (!intersects(item.execution.boundaries, filters.boundaries)) return false;
  if (!intersects([compatibility.level], filters.compatibility)) return false;
  if (filters.license.length > 0 && !filters.license.includes(item.license.commercialUse)) return false;
  if (filters.installedOnly && (item.localInstall === null || item.localInstall.status === "missing")) return false;
  if (filters.safeTensorsOnly && item.trust.safetensors !== true) return false;
  if (filters.maxVramBytes !== null && (item.requirements.estimatedVramBytes === null || item.requirements.estimatedVramBytes > filters.maxVramBytes)) return false;
  if (filters.maxRamBytes !== null && (item.requirements.estimatedRamBytes === null || item.requirements.estimatedRamBytes > filters.maxRamBytes)) return false;
  return true;
}

function relevanceScore(item: CatalogItem, parsed: ParsedCatalogQuery): number {
  let score = 0;
  for (const term of parsed.terms) {
    if (term.negated) continue;
    if (term.kind === "field") score += 10;
    else if (normalize(item.identity.name) === normalize(term.value)) score += 100;
    else if (normalize(item.identity.name).startsWith(normalize(term.value))) score += 55;
    else if (normalize(item.identity.name).includes(normalize(term.value))) score += 35;
    else if (normalize(item.identity.publisher).includes(normalize(term.value))) score += 20;
    else score += 5;
  }
  return score;
}

const compatibilityOrder: Readonly<Record<CompatibilityLevel, number>> = {
  ready: 0,
  "ready-with-changes": 1,
  "needs-setup": 2,
  unknown: 3,
  blocked: 4,
};

function compareNullable(left: number | null, right: number | null, descending: boolean): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return descending ? right - left : left - right;
}

function compareResults(left: CatalogSearchResult, right: CatalogSearchResult, sort: CatalogSort): number {
  let result = 0;
  if (sort === "relevance") result = right.score - left.score;
  else if (sort === "name") result = left.item.identity.name.localeCompare(right.item.identity.name);
  else if (sort === "downloads") result = compareNullable(left.item.metrics.downloads, right.item.metrics.downloads, true);
  else if (sort === "likes") result = compareNullable(left.item.metrics.likes, right.item.metrics.likes, true);
  else if (sort === "updated") result = compareNullable(
    left.item.metrics.lastModifiedAt ? Date.parse(left.item.metrics.lastModifiedAt) : null,
    right.item.metrics.lastModifiedAt ? Date.parse(right.item.metrics.lastModifiedAt) : null,
    true,
  );
  else if (sort === "vram") result = compareNullable(left.item.requirements.estimatedVramBytes, right.item.requirements.estimatedVramBytes, false);
  return result || left.item.identity.name.localeCompare(right.item.identity.name) || compatibilityOrder[left.compatibility.level] - compatibilityOrder[right.compatibility.level];
}

export function filterCatalogItems(items: readonly CatalogItem[], options: CatalogQueryOptions): readonly CatalogSearchResult[] {
  const parsed = parseCatalogQuery(options.query ?? "");
  const filters = options.filters ?? emptyCatalogFilters;
  const sort = options.sort ?? "relevance";
  return items
    .map((item): CatalogSearchResult => {
      const compatibility = evaluateCatalogCompatibility(item, options.context);
      return { item, compatibility, score: relevanceScore(item, parsed) };
    })
    .filter(({ item, compatibility }) => filtersMatch(item, compatibility, filters)
      && parsed.terms.every((term) => termMatches(item, compatibility, term)))
    .sort((left, right) => compareResults(left, right, sort));
}

export function toggleFilterValue<T>(values: readonly T[], value: T): readonly T[] {
  return values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value];
}
