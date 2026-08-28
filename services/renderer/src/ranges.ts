export interface FrameRange {
  /** Inclusive. */
  readonly startFrame: number;
  /** Exclusive. */
  readonly endFrame: number;
}

export interface RenderChunk extends FrameRange {
  readonly index: number;
  readonly frameCount: number;
  readonly outputStem: string;
}

function assertFrame(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
}

export function validateFrameRange(range: FrameRange): void {
  assertFrame(range.startFrame, "startFrame");
  assertFrame(range.endFrame, "endFrame");
  if (range.endFrame <= range.startFrame) throw new RangeError("endFrame must be greater than startFrame");
}

export function planRenderChunks(range: FrameRange, maximumFramesPerChunk: number, stem = "chunk"): readonly RenderChunk[] {
  validateFrameRange(range);
  if (!Number.isSafeInteger(maximumFramesPerChunk) || maximumFramesPerChunk <= 0) {
    throw new RangeError("maximumFramesPerChunk must be a positive safe integer");
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(stem)) throw new TypeError("Chunk stem contains unsafe filename characters");
  const chunks: RenderChunk[] = [];
  for (let start = range.startFrame, index = 0; start < range.endFrame; index += 1) {
    const end = Math.min(range.endFrame, start + maximumFramesPerChunk);
    chunks.push({
      index,
      startFrame: start,
      endFrame: end,
      frameCount: end - start,
      outputStem: `${stem}-${String(index).padStart(5, "0")}`,
    });
    start = end;
  }
  return Object.freeze(chunks);
}

export function missingRanges(expected: FrameRange, completedFrames: ReadonlySet<number>): readonly FrameRange[] {
  validateFrameRange(expected);
  const ranges: FrameRange[] = [];
  let open: number | undefined;
  for (let frame = expected.startFrame; frame < expected.endFrame; frame += 1) {
    const missing = !completedFrames.has(frame);
    if (missing && open === undefined) open = frame;
    if (!missing && open !== undefined) {
      ranges.push({ startFrame: open, endFrame: frame });
      open = undefined;
    }
  }
  if (open !== undefined) ranges.push({ startFrame: open, endFrame: expected.endFrame });
  return ranges;
}
