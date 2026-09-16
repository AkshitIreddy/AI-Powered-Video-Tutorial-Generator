import type { JobReceipt, ProjectSnapshotReceipt } from "./native";
import type { CanvasCustomization, PresenterSelection } from "./types";

export interface ReviewedGenerationScene {
  id: string;
  title: string;
  narration: string;
  objective: string;
  duration: number;
}

export interface FrozenGenerationReview {
  projectId: string;
  projectDirectory: string;
  generationId: string;
  jobId: string;
  scenes: ReviewedGenerationScene[];
  presenterSelection?: PresenterSelection;
  customization?: CanvasCustomization;
}

interface ApprovalDependencies {
  awaitPendingSaves: () => Promise<void>;
  getSnapshot: () => Promise<ProjectSnapshotReceipt>;
  saveSnapshot: (input: { expectedHeadRevisionId: string; snapshot: Record<string, unknown> }) => Promise<ProjectSnapshotReceipt>;
  approve: (input: { expectedHeadRevisionId: string }) => Promise<JobReceipt>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function sceneIds(scenes: unknown[]): string[] {
  return scenes.map((scene) => record(scene)?.id).filter((id): id is string => typeof id === "string");
}

function assertSameSceneSet(durableScenes: unknown[], reviewedScenes: ReviewedGenerationScene[]): void {
  const durableIds = sceneIds(durableScenes);
  const reviewedIds = reviewedScenes.map((scene) => scene.id);
  if (
    durableIds.length !== durableScenes.length
    || new Set(durableIds).size !== durableIds.length
    || new Set(reviewedIds).size !== reviewedIds.length
    || durableIds.length !== reviewedIds.length
    || reviewedIds.some((id) => !durableIds.includes(id))
  ) throw new Error("APPROVAL_CONFLICT: This tutorial changed while you were reviewing it. Reopen it before approving.");
}

/** Merge only fields visible in the review UI into a newly loaded durable document. */
export function mergeReviewedStoryboard(durableSnapshot: Record<string, unknown>, review: FrozenGenerationReview): Record<string, unknown> {
  if (durableSnapshot.generationId !== review.generationId) {
    throw new Error("APPROVAL_CONFLICT: This tutorial changed while you were reviewing it. Reopen it before approving.");
  }
  const payload = record(durableSnapshot.payload);
  const storyboard = record(payload?.storyboard);
  if (!payload || !storyboard || !Array.isArray(storyboard.scenes)) {
    throw new Error("APPROVAL_CONFLICT: This tutorial changed while you were reviewing it. Reopen it before approving.");
  }
  assertSameSceneSet(storyboard.scenes, review.scenes);
  const reviewedById = new Map(review.scenes.map((scene) => [scene.id, scene]));
  const mergedStoryboardScenes = storyboard.scenes.map((raw) => {
    const durableScene = record(raw)!;
    const reviewed = reviewedById.get(durableScene.id as string)!;
    const durationTicks = durableScene.durationTicks;
    if (typeof durationTicks === "number" && Math.abs(reviewed.duration * 240_000 - durationTicks) > 0.5) {
      throw new Error("APPROVAL_CONFLICT: Scene timing changed during review, but this generation can only accept title, narration, and teaching-intent edits. Restore the generated timing before approving.");
    }
    return { ...durableScene, title: reviewed.title, narration: reviewed.narration, visualIntent: reviewed.objective };
  });
  const merged: Record<string, unknown> = {
    ...durableSnapshot,
    ...(review.presenterSelection ? { presenterSelection: structuredClone(review.presenterSelection) } : {}),
    ...(review.customization ? { customization: structuredClone(review.customization) } : {}),
    payload: { ...payload, storyboard: { ...storyboard, scenes: mergedStoryboardScenes } },
  };
  return merged;
}

/** Flush earlier writes, save the frozen review at a fresh revision, then approve exactly that returned revision. */
export async function persistReviewedGenerationApproval(
  review: FrozenGenerationReview,
  dependencies: ApprovalDependencies,
): Promise<{ saved: ProjectSnapshotReceipt; receipt: JobReceipt }> {
  await dependencies.awaitPendingSaves();
  const fresh = await dependencies.getSnapshot();
  const reviewedSnapshot = mergeReviewedStoryboard(fresh.snapshot, review);
  const saved = await dependencies.saveSnapshot({ expectedHeadRevisionId: fresh.headRevisionId, snapshot: reviewedSnapshot });
  const receipt = await dependencies.approve({ expectedHeadRevisionId: saved.headRevisionId });
  return { saved, receipt };
}
