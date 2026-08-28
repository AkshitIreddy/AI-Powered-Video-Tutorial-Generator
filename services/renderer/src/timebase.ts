import type { FrameRate } from "./contracts.js";

export const TICKS_PER_SECOND = 240_000;
export const AUDIO_SAMPLE_RATE = 48_000;
export const TICKS_PER_AUDIO_SAMPLE = TICKS_PER_SECOND / AUDIO_SAMPLE_RATE;

export const FRAME_RATES = {
  cinematic: { numerator: 24, denominator: 1 },
  pal: { numerator: 25, denominator: 1 },
  ntscFilm: { numerator: 24_000, denominator: 1_001 },
  ntsc: { numerator: 30_000, denominator: 1_001 },
  ntsc60: { numerator: 60_000, denominator: 1_001 },
  thirty: { numerator: 30, denominator: 1 },
  fifty: { numerator: 50, denominator: 1 },
  sixty: { numerator: 60, denominator: 1 },
} as const satisfies Record<string, FrameRate>;

function safeInteger(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer, got ${value}`);
  return BigInt(value);
}

export function gcd(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right !== 0n) [left, right] = [right, left % right];
  return left;
}

export function normalizeFrameRate(rate: FrameRate): FrameRate {
  const numerator = safeInteger(rate.numerator, "frame-rate numerator");
  const denominator = safeInteger(rate.denominator, "frame-rate denominator");
  if (numerator <= 0n || denominator <= 0n) throw new RangeError("Frame-rate components must be positive");
  const factor = gcd(numerator, denominator);
  return { numerator: Number(numerator / factor), denominator: Number(denominator / factor) };
}

export function ticksPerFrame(rate: FrameRate): number {
  const normalized = normalizeFrameRate(rate);
  const numerator = BigInt(TICKS_PER_SECOND) * BigInt(normalized.denominator);
  const denominator = BigInt(normalized.numerator);
  if (numerator % denominator !== 0n) {
    throw new RangeError(`${normalized.numerator}/${normalized.denominator} fps cannot be represented exactly by the ${TICKS_PER_SECOND} Hz timebase`);
  }
  return Number(numerator / denominator);
}

export function frameToTick(frame: number, rate: FrameRate): number {
  if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError(`Frame must be a non-negative safe integer, got ${frame}`);
  const result = BigInt(frame) * BigInt(ticksPerFrame(rate));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Frame tick exceeds JavaScript safe integer range");
  return Number(result);
}

export function tickToFrameFloor(tick: number, rate: FrameRate): number {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError(`Tick must be a non-negative safe integer, got ${tick}`);
  return Math.floor(tick / ticksPerFrame(rate));
}

export function tickToFrameCeil(tick: number, rate: FrameRate): number {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError(`Tick must be a non-negative safe integer, got ${tick}`);
  return Math.ceil(tick / ticksPerFrame(rate));
}

export function secondsToTicks(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError(`Seconds must be finite and non-negative, got ${seconds}`);
  const ticks = Math.round(seconds * TICKS_PER_SECOND);
  if (!Number.isSafeInteger(ticks)) throw new RangeError("Tick value exceeds JavaScript safe integer range");
  return ticks;
}

export function ticksToSeconds(ticks: number): number {
  if (!Number.isSafeInteger(ticks) || ticks < 0) throw new RangeError(`Ticks must be a non-negative safe integer, got ${ticks}`);
  return ticks / TICKS_PER_SECOND;
}

export function audioSampleToTick(sample: number): number {
  if (!Number.isSafeInteger(sample) || sample < 0) throw new RangeError(`Sample must be non-negative, got ${sample}`);
  return sample * TICKS_PER_AUDIO_SAMPLE;
}

export function tickToAudioSample(tick: number): number {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError(`Tick must be non-negative, got ${tick}`);
  if (tick % TICKS_PER_AUDIO_SAMPLE !== 0) throw new RangeError(`Tick ${tick} is not aligned to a 48 kHz sample`);
  return tick / TICKS_PER_AUDIO_SAMPLE;
}
