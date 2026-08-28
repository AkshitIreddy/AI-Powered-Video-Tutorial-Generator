/** JSON-compatible values accepted at provider and plugin boundaries. */
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type EntityId = string;
export type Sha256 = string;
export type IsoDateTime = string;
export type IsoDate = string;
export type Locale = string;
export type RelativePath = string;

export interface Rational { numerator: number; denominator: number }
export interface TickRange { startTick: number; durationTicks: number }
export interface Dimensions { width: number; height: number }
export interface BoundingBox { x: number; y: number; width: number; height: number; unit: "normalized" | "pixel" | "point" }
export interface Money { currency: string; micros: number }

export type DiagnosticSeverity = "info" | "warning" | "error" | "fatal";
export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  path?: string;
  details?: JsonValue;
  remediation?: string;
}

export interface EntityRef {
  entityType: string;
  entityId: EntityId;
  revisionId?: EntityId;
}

export type LockScope = "content" | "visual" | "timing" | "narration" | "audio" | "citations" | "all";
export interface EntityLock {
  scope: LockScope;
  reason: string;
  createdAt: IsoDateTime;
  createdBy?: "user" | "system" | "policy";
}

export const TICKS_PER_SECOND = 240_000 as const;

export function assertNever(value: never, context = "Unhandled discriminant"): never {
  throw new Error(`${context}: ${JSON.stringify(value)}`);
}
