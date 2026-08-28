const UINT32_RANGE = 0x1_0000_0000;

function xmur3(input: string): () => number {
  let hash = 1_779_033_703 ^ input.length;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 3_432_918_353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2_246_822_507);
    hash = Math.imul(hash ^ (hash >>> 13), 3_266_489_909);
    return (hash ^= hash >>> 16) >>> 0;
  };
}

/** A portable sfc32 generator: deterministic in every supported JS engine. */
export class SeededRandom {
  readonly #initialSeed: string;
  #a: number;
  #b: number;
  #c: number;
  #d: number;

  constructor(seed: string) {
    if (seed.length === 0) throw new TypeError("Random seed must not be empty");
    this.#initialSeed = seed;
    const hash = xmur3(seed);
    this.#a = hash();
    this.#b = hash();
    this.#c = hash();
    this.#d = hash();
  }

  get seed(): string {
    return this.#initialSeed;
  }

  nextUint32(): number {
    this.#a >>>= 0;
    this.#b >>>= 0;
    this.#c >>>= 0;
    this.#d >>>= 0;
    const value = (((this.#a + this.#b) | 0) + this.#d) | 0;
    this.#d = (this.#d + 1) | 0;
    this.#a = this.#b ^ (this.#b >>> 9);
    this.#b = (this.#c + (this.#c << 3)) | 0;
    this.#c = ((this.#c << 21) | (this.#c >>> 11)) + value | 0;
    return value >>> 0;
  }

  next(): number {
    return this.nextUint32() / UINT32_RANGE;
  }

  integer(minimum: number, maximumExclusive: number): number {
    if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximumExclusive) || maximumExclusive <= minimum) {
      throw new RangeError("Random integer bounds must be safe integers with maximum > minimum");
    }
    return minimum + Math.floor(this.next() * (maximumExclusive - minimum));
  }

  between(minimum: number, maximum: number): number {
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum < minimum) {
      throw new RangeError("Random bounds must be finite with maximum >= minimum");
    }
    return minimum + this.next() * (maximum - minimum);
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new RangeError("Cannot pick from an empty collection");
    return values[this.integer(0, values.length)] as T;
  }

  fork(namespace: string): SeededRandom {
    return new SeededRandom(`${this.#initialSeed}\u0000${namespace}`);
  }
}

export class NondeterminismError extends Error {
  constructor(api: string) {
    super(`Nondeterministic API ${api} is forbidden during frame rendering; use FrameContext or SeededRandom`);
    this.name = "NondeterminismError";
  }
}

export interface DeterminismGuardOptions {
  readonly forbidDate?: boolean;
  readonly forbidMathRandom?: boolean;
  readonly forbidPerformanceNow?: boolean;
  readonly forbidCryptoRandom?: boolean;
}

/**
 * Runs synchronously with wall-clock/random APIs trapped. Guards are intentionally
 * scoped: patching globals across an await would leak into unrelated work.
 */
export function withDeterminismGuard<T>(operation: () => T, options: DeterminismGuardOptions = {}): T {
  const originalRandom = Math.random;
  const originalDate = globalThis.Date;
  const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis.performance ?? {}, "now");
  const cryptoRandomDescriptor = Object.getOwnPropertyDescriptor(globalThis.crypto ?? {}, "getRandomValues");
  const cryptoUuidDescriptor = Object.getOwnPropertyDescriptor(globalThis.crypto ?? {}, "randomUUID");
  const forbidRandom = options.forbidMathRandom ?? true;
  const forbidDate = options.forbidDate ?? true;
  const forbidPerformance = options.forbidPerformanceNow ?? true;
  const forbidCrypto = options.forbidCryptoRandom ?? true;
  if (forbidRandom) Math.random = () => { throw new NondeterminismError("Math.random"); };
  if (forbidDate) {
    const guardedDate = new Proxy(originalDate, {
      apply(target, thisArgument, argumentsList) {
        if (argumentsList.length === 0) throw new NondeterminismError("Date()");
        return Reflect.apply(target, thisArgument, argumentsList) as string;
      },
      construct(target, argumentsList, newTarget) {
        if (argumentsList.length === 0) throw new NondeterminismError("new Date()");
        return Reflect.construct(target, argumentsList, newTarget) as Date;
      },
      get(target, property, receiver) {
        if (property === "now") return () => { throw new NondeterminismError("Date.now"); };
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    globalThis.Date = guardedDate;
  }
  let performancePatched = false;
  if (forbidPerformance && globalThis.performance) {
    try {
      Object.defineProperty(globalThis.performance, "now", {
        configurable: true,
        value: () => { throw new NondeterminismError("performance.now"); },
      });
      performancePatched = true;
    } catch {
      // Some runtimes expose a non-configurable Performance prototype. Math/Date remain guarded.
    }
  }
  let cryptoRandomPatched = false;
  let cryptoUuidPatched = false;
  if (forbidCrypto && globalThis.crypto) {
    try {
      Object.defineProperty(globalThis.crypto, "getRandomValues", {
        configurable: true,
        value: () => { throw new NondeterminismError("crypto.getRandomValues"); },
      });
      cryptoRandomPatched = true;
    } catch {
      // Browser policies can expose this as non-configurable.
    }
    try {
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        configurable: true,
        value: () => { throw new NondeterminismError("crypto.randomUUID"); },
      });
      cryptoUuidPatched = true;
    } catch {
      // Browser policies can expose this as non-configurable.
    }
  }
  try {
    return operation();
  } finally {
    Math.random = originalRandom;
    globalThis.Date = originalDate;
    if (performancePatched && globalThis.performance) {
      if (performanceDescriptor) Object.defineProperty(globalThis.performance, "now", performanceDescriptor);
      else Reflect.deleteProperty(globalThis.performance, "now");
    }
    if (cryptoRandomPatched && globalThis.crypto) {
      if (cryptoRandomDescriptor) Object.defineProperty(globalThis.crypto, "getRandomValues", cryptoRandomDescriptor);
      else Reflect.deleteProperty(globalThis.crypto, "getRandomValues");
    }
    if (cryptoUuidPatched && globalThis.crypto) {
      if (cryptoUuidDescriptor) Object.defineProperty(globalThis.crypto, "randomUUID", cryptoUuidDescriptor);
      else Reflect.deleteProperty(globalThis.crypto, "randomUUID");
    }
  }
}
