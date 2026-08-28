/** Small deterministic PRNG; never use Math.random in canonical rendering. */
export class SeededRandom {
  private state: number;

  public constructor(seed: number) {
    this.state = (seed | 0) || 0x6d2b79f5;
  }

  public next(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  public between(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  public integer(min: number, maxInclusive: number): number {
    return Math.floor(this.between(min, maxInclusive + 1));
  }

  public pick<T>(values: readonly T[]): T | undefined {
    if (values.length === 0) return undefined;
    return values[this.integer(0, values.length - 1)];
  }

  public fork(salt: number | string): SeededRandom {
    const saltNumber = typeof salt === "number" ? salt : stableHashNumber(salt);
    return new SeededRandom((this.state ^ saltNumber) >>> 0);
  }
}

export function stableHashNumber(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function stableHash(value: unknown): string {
  const serialized = canonicalJson(value);
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    for (let word = 0; word < words.length; word += 1) {
      words[word] = Math.imul((words[word] ?? 0) ^ (code + word * 31), 16777619 + word * 2) >>> 0;
    }
  }
  return words.map((word) => word.toString(16).padStart(8, "0")).join("").repeat(2);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
