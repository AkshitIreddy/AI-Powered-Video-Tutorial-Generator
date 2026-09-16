import type { SceneEditCandidate, SceneEditCandidateStatus, SceneEditFocus } from "./types";

const STATUSES = new Set<SceneEditCandidateStatus>(["ready", "accepted", "rejected", "failed"]);
const FOCUSES = new Set<SceneEditFocus>(["explanation", "pacing"]);
const SHA_256 = /^[a-f0-9]{64}$/u;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function optionalText(value: unknown, maximum: number): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= maximum);
}

function timestamp(value: unknown): value is string {
  return boundedText(value, 100) && Number.isFinite(Date.parse(value));
}

function candidate(value: unknown): value is SceneEditCandidate {
  const item = record(value);
  const proposed = record(item?.proposed);
  if (!item || !proposed) return false;

  return boundedText(item.id, 240)
    && boundedText(item.sceneId, 240)
    && STATUSES.has(item.status as SceneEditCandidateStatus)
    && boundedText(item.instruction, 8_000)
    && FOCUSES.has(item.focus as SceneEditFocus)
    && boundedText(proposed.title, 1_000)
    && boundedText(proposed.narration, 30_000)
    && boundedText(proposed.objective, 4_000)
    && typeof proposed.durationSeconds === "number"
    && Number.isFinite(proposed.durationSeconds)
    && proposed.durationSeconds > 0
    && proposed.durationSeconds <= 86_400
    && optionalText(proposed.visualIntent, 8_000)
    && typeof item.originalHash === "string"
    && SHA_256.test(item.originalHash)
    && timestamp(item.createdAt)
    && boundedText(item.provider, 240)
    && boundedText(item.model, 500)
    && optionalText(item.error, 4_000);
}

/**
 * Parses an atomic candidate payload. A malformed member invalidates the whole
 * payload so callers cannot accidentally present a partial, misleading review.
 */
export function parseSceneEditCandidates(value: unknown): SceneEditCandidate[] {
  if (!Array.isArray(value) || !value.every(candidate)) return [];
  return value;
}
