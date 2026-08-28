import test from "node:test";
import assert from "node:assert/strict";
import { missingRanges, planRenderChunks } from "../src/ranges.js";

test("chunk plan is gapless, ordered, and exclusive-ended", () => {
  const chunks = planRenderChunks({ startFrame: 7, endFrame: 28 }, 8, "scene-a");
  assert.deepEqual(chunks, [
    { index: 0, startFrame: 7, endFrame: 15, frameCount: 8, outputStem: "scene-a-00000" },
    { index: 1, startFrame: 15, endFrame: 23, frameCount: 8, outputStem: "scene-a-00001" },
    { index: 2, startFrame: 23, endFrame: 28, frameCount: 5, outputStem: "scene-a-00002" },
  ]);
});

test("resume planner emits only missing runs", () => {
  assert.deepEqual(missingRanges({ startFrame: 0, endFrame: 10 }, new Set([0, 1, 4, 5, 6, 9])), [
    { startFrame: 2, endFrame: 4 },
    { startFrame: 7, endFrame: 9 },
  ]);
});
