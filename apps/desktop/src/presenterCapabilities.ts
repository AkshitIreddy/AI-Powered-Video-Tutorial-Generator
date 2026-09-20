import type { CasualPresenterLipSyncEngineId, CasualPresenterLipSyncReview } from "@alystria/themes";
import type { PresenterSelection } from "./types";

export interface PresenterCapabilityChoice {
  id: string;
  label: string;
  portraitArtifactHash?: string;
  lipSync?: CasualPresenterLipSyncReview;
}

export interface PresenterPortraitRuntimeStatus {
  /** Null identifies the primary config's default route. */
  portraitArtifactHash: string | null;
  modelId: string | null;
  configured: boolean;
  reason: string;
}

export interface PresenterLipSyncRuntimeContext {
  /** Null means this profile uses the portrait as a still image. */
  activeEngineId: CasualPresenterLipSyncEngineId | null;
  /** Read-only native config discovery; workers still verify all runtime bytes at render. */
  portraitStatuses: readonly PresenterPortraitRuntimeStatus[];
  /** False only during the initial native read; omitted contexts are already settled. */
  statusLoaded?: boolean;
}

export interface PresenterAnimationReadiness {
  state: "static" | "checking" | "ready" | "runtime-required" | "pending-review" | "incompatible";
  badge: string;
  detail: string;
  blocksSelection: boolean;
}

export function presenterLipSyncEngineForRouteModel(modelId: string | null | undefined): CasualPresenterLipSyncEngineId | null {
  const normalized = modelId?.trim().toLowerCase() ?? "";
  if (!normalized || /^(?:off|none|disabled)\b/.test(normalized)) return null;
  if (normalized.includes("musetalk")) return "liveportrait-musetalk-1.5";
  if (normalized.includes("joyvasa") && normalized.includes("animal")) return "joyvasa-animal";
  if (normalized.includes("joyvasa")) return "joyvasa-human";
  return null;
}

function isLipSyncEngineId(value: string | null): value is CasualPresenterLipSyncEngineId {
  return value === "liveportrait-musetalk-1.5" || value === "joyvasa-human" || value === "joyvasa-animal";
}

export function presenterAnimationReadiness(
  choice: PresenterCapabilityChoice,
  runtime: PresenterLipSyncRuntimeContext,
): PresenterAnimationReadiness | null {
  const review = choice.lipSync;
  if (!review) return null;
  if (!runtime.activeEngineId) {
    const reviewed = review.qualifications.some((entry) => entry.outcome === "reviewed-compatible");
    return {
      state: "static",
      badge: reviewed ? "Lip-sync reviewed" : "Static ready",
      detail: reviewed
        ? "This portrait passed a bounded lip-sync review. This profile currently uses it as a still image."
        : "The portrait is ready for still-image use. Its preferred animation route has not completed review.",
      blocksSelection: false,
    };
  }
  const exactStatus = choice.portraitArtifactHash
    ? runtime.portraitStatuses.find((entry) => entry.portraitArtifactHash === choice.portraitArtifactHash)
    : undefined;
  const defaultStatus = runtime.portraitStatuses.find((entry) => entry.portraitArtifactHash === null);
  // The primary config binds exact portrait hashes to child routes. That override
  // wins over the profile's default MuseTalk route even when its child is missing.
  const effectiveStatus = exactStatus ?? defaultStatus;
  const effectiveEngineId = effectiveStatus && isLipSyncEngineId(effectiveStatus.modelId)
    ? effectiveStatus.modelId
    : runtime.activeEngineId;
  const qualification = review.qualifications.find((entry) => entry.engineId === effectiveEngineId);
  if (!qualification) {
    return {
      state: "incompatible",
      badge: "Static only",
      detail: `This portrait has no reviewed qualification for the active ${effectiveEngineId} route. Choose a profile with lip-sync off to use the still portrait.`,
      blocksSelection: true,
    };
  }
  if (qualification.outcome === "incompatible") {
    return {
      state: "incompatible",
      badge: "Static only",
      detail: `${qualification.notes} Choose a profile with lip-sync off to use the still portrait.`,
      blocksSelection: true,
    };
  }
  if (qualification.outcome === "pending-review") {
    return {
      state: "pending-review",
      badge: "Review pending",
      detail: `${qualification.displayName} is still under visual review for this portrait. Animated speech stays unavailable until that exact route is accepted and installed.`,
      blocksSelection: true,
    };
  }
  if (runtime.statusLoaded === false) {
    return {
      state: "checking",
      badge: "Checking runtime",
      detail: `Checking this PC for the pinned ${qualification.displayName} configuration.`,
      blocksSelection: true,
    };
  }
  if (!effectiveStatus?.configured || effectiveStatus.modelId !== qualification.engineId) {
    const nativeReason = effectiveStatus?.reason.trim();
    return {
      state: "runtime-required",
      badge: "Runtime required",
      detail: `${qualification.displayName} passed portrait review, but its exact local route is not configured on this PC.${nativeReason ? ` ${nativeReason}` : ""} Use a profile with lip-sync off until the matching runtime is installed.`,
      blocksSelection: true,
    };
  }
  return {
    state: "ready",
    badge: "Animated speech ready",
    detail: `${qualification.displayName} passed portrait review and its pinned local configuration is present on this PC. Full runtime hashes are verified again when rendering starts.`,
    blocksSelection: false,
  };
}

export function presenterSelectionAnimationIssues(
  choices: readonly PresenterCapabilityChoice[],
  selection: PresenterSelection,
  runtime: PresenterLipSyncRuntimeContext,
): string[] {
  if (selection.mode === "off" || !runtime.activeEngineId) return [];
  return selection.presenters.flatMap((presenter) => {
    const choice = choices.find((candidate) => candidate.id === presenter.portraitAssetId);
    if (!choice) return [];
    const readiness = presenterAnimationReadiness(choice, runtime);
    return readiness?.blocksSelection ? [`${choice.label}: ${readiness.detail}`] : [];
  });
}
