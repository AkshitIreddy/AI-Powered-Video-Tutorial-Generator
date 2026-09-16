import { describe, expect, it } from "vitest";
import { parseSceneEditCandidates } from "../parseSceneEditCandidates";
import type { SceneEditCandidate } from "../types";

const valid: SceneEditCandidate = {
  id: "edit-one",
  sceneId: "scene-one",
  status: "ready",
  instruction: "Make the explanation more concrete.",
  focus: "explanation",
  proposed: {
    title: "Binary search halves the question",
    narration: "Check the middle value. That answer tells us which half can still contain the target.",
    objective: "Explain why each comparison removes half of the remaining values.",
    durationSeconds: 18.5,
    visualIntent: "Keep the interval and midpoint visible together.",
  },
  originalHash: "a".repeat(64),
  createdAt: "2026-09-16T08:30:00Z",
  provider: "local-runtime",
  model: "scene-writer-v1",
};

describe("parseSceneEditCandidates", () => {
  it("accepts a fully formed candidate payload", () => {
    expect(parseSceneEditCandidates([valid])).toEqual([valid]);
  });

  it("accepts an empty optional visual direction", () => {
    const withoutVisualDirection = {
      ...valid,
      proposed: { ...valid.proposed, visualIntent: "" },
    };
    expect(parseSceneEditCandidates([withoutVisualDirection])).toEqual([withoutVisualDirection]);
  });

  it("fails the whole payload closed when any candidate is malformed", () => {
    expect(parseSceneEditCandidates([valid, { ...valid, id: "bad", originalHash: "../scene.json" }])).toEqual([]);
    expect(parseSceneEditCandidates([{ ...valid, focus: "style" }])).toEqual([]);
    expect(parseSceneEditCandidates([{ ...valid, proposed: { ...valid.proposed, durationSeconds: Number.NaN } }])).toEqual([]);
  });

  it("rejects non-array and incomplete payloads", () => {
    expect(parseSceneEditCandidates(null)).toEqual([]);
    expect(parseSceneEditCandidates({ candidates: [valid] })).toEqual([]);
    expect(parseSceneEditCandidates([{ id: "edit-one" }])).toEqual([]);
  });
});
