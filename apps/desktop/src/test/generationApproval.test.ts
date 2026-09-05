import { describe, expect, it, vi } from "vitest";
import { mergeReviewedStoryboard, persistReviewedGenerationApproval, type FrozenGenerationReview } from "../generationApproval";

const review: FrozenGenerationReview = {
  projectId: "project-1", projectDirectory: "C:/projects/project-1", generationId: "generation-1", jobId: "job-1",
  scenes: [
    { id: "scene-1", title: "Find the midpoint", narration: "Use the latest reviewed narration.", objective: "Explain the invariant", duration: 12 },
    { id: "scene-2", title: "Choose a half", narration: "Discard the impossible half.", objective: "Update the bounds", duration: 15 },
  ],
};

function receipt(snapshot: Record<string, unknown>, headRevisionId = "rev-fresh") {
  return { projectId: "project-1", headRevisionId, revisionNumber: 4, rootHash: "hash", updatedAt: "now", snapshot };
}

function durableSnapshot() {
  return { generationId: "generation-1", payload: { pipelineArtifact: { hash: "preserve-this" }, storyboard: { reviewState: "ready", scenes: [
    { id: "scene-1", title: "Old", narration: "Old", visualIntent: "Old", durationTicks: 2_880_000, generatedAsset: "asset-1" },
    { id: "scene-2", title: "Old", narration: "Old", visualIntent: "Old", durationTicks: 3_600_000, generatedAsset: "asset-2" },
  ] } } };
}

describe("reviewed generation approval", () => {
  it("saves the frozen latest narration before approving the exact returned revision", async () => {
    const order: string[] = [];
    const approve = vi.fn(async ({ expectedHeadRevisionId }: { expectedHeadRevisionId: string }) => {
      order.push(`approve:${expectedHeadRevisionId}`);
      return { jobId: "job-1", state: "SUCCEEDED" as const, acceptedAt: "now", message: "Approved", retryable: false };
    });
    const saveSnapshot = vi.fn(async ({ expectedHeadRevisionId, snapshot }: { expectedHeadRevisionId: string; snapshot: Record<string, unknown> }) => {
      const scenes = (snapshot.payload as { storyboard: { scenes: Array<{ narration: string }> } }).storyboard.scenes;
      order.push(`save:${expectedHeadRevisionId}:${scenes[0]?.narration}`);
      expect((snapshot.payload as { pipelineArtifact: unknown }).pipelineArtifact).toEqual({ hash: "preserve-this" });
      return receipt(snapshot, "rev-reviewed");
    });
    const result = await persistReviewedGenerationApproval(review, {
      awaitPendingSaves: async () => { order.push("flush"); },
      getSnapshot: async () => { order.push("get"); return receipt(durableSnapshot()); },
      saveSnapshot,
      approve,
    });
    expect(order).toEqual(["flush", "get", "save:rev-fresh:Use the latest reviewed narration.", "approve:rev-reviewed"]);
    expect(result.saved.headRevisionId).toBe("rev-reviewed");
  });

  it.each([
    ["generation", { ...durableSnapshot(), generationId: "generation-2" }],
    ["scene set", { ...durableSnapshot(), payload: { ...durableSnapshot().payload, storyboard: { scenes: [{ id: "scene-1" }] } } }],
  ])("does not approve when the durable %s is stale", async (_label, snapshot) => {
    const approve = vi.fn();
    const saveSnapshot = vi.fn();
    await expect(persistReviewedGenerationApproval(review, { awaitPendingSaves: async () => undefined, getSnapshot: async () => receipt(snapshot), saveSnapshot, approve })).rejects.toThrow("APPROVAL_CONFLICT");
    expect(saveSnapshot).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  it("does not approve when the reviewed snapshot save conflicts", async () => {
    const approve = vi.fn();
    await expect(persistReviewedGenerationApproval(review, {
      awaitPendingSaves: async () => undefined, getSnapshot: async () => receipt(durableSnapshot()),
      saveSnapshot: async () => { throw new Error("REVISION_CONFLICT: another writer advanced the head"); }, approve,
    })).rejects.toThrow("REVISION_CONFLICT");
    expect(approve).not.toHaveBeenCalled();
  });

  it("does not approve when a queued save fails", async () => {
    const getSnapshot = vi.fn();
    const approve = vi.fn();
    await expect(persistReviewedGenerationApproval(review, {
      awaitPendingSaves: async () => { throw new Error("Could not persist queued customization"); }, getSnapshot, saveSnapshot: vi.fn(), approve,
    })).rejects.toThrow("Could not persist queued customization");
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  it("preserves unrelated fresh payload fields while applying reviewed fields", () => {
    const merged = mergeReviewedStoryboard(durableSnapshot(), review);
    const payload = merged.payload as { pipelineArtifact: unknown; storyboard: { reviewState: string; scenes: Array<Record<string, unknown>> } };
    expect(payload.pipelineArtifact).toEqual({ hash: "preserve-this" });
    expect(payload.storyboard.reviewState).toBe("ready");
    expect(payload.storyboard.scenes[0]).toMatchObject({ generatedAsset: "asset-1", narration: "Use the latest reviewed narration.", durationTicks: 2_880_000 });
  });

  it("refuses an unsupported timing edit rather than changing frozen generation timing", () => {
    expect(() => mergeReviewedStoryboard(durableSnapshot(), { ...review, scenes: review.scenes.map((scene, index) => index === 0 ? { ...scene, duration: 13 } : scene) })).toThrow("Scene timing changed during review");
  });
});
