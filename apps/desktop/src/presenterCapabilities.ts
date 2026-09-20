import type { CasualPresenterLipSyncEngineId, CasualPresenterLipSyncReview } from "@alystria/themes";
import type { PresenterAnimationReview } from "./native";
import type { PresenterSelection } from "./types";

export interface PresenterCapabilityChoice {
  id: string;
  label: string;
  portraitArtifactHash?: string;
  lipSync?: CasualPresenterLipSyncReview;
  customPortrait?: {
    animationReview: PresenterAnimationReview;
    source: "upload" | "generated";
  };
}

export type PresenterAnimationEngineId = CasualPresenterLipSyncEngineId | "soulx-flashhead-pro";

export interface PresenterPortraitRuntimeStatus {
  /** Null identifies the primary config's default route. */
  portraitArtifactHash: string | null;
  modelId: string | null;
  modelRevision?: string | null;
  configured: boolean;
  reason: string;
}

export interface PresenterLipSyncRuntimeContext {
  /** Null means this profile uses the portrait as a still image. */
  activeEngineId: PresenterAnimationEngineId | null;
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
  blocksAnimation?: boolean;
}

export function presenterLipSyncEngineForRouteModel(modelId: string | null | undefined): PresenterAnimationEngineId | null {
  const normalized = modelId?.trim().toLowerCase() ?? "";
  if (!normalized || /^(?:off|none|disabled)\b/.test(normalized)) return null;
  if (normalized.includes("musetalk")) return "liveportrait-musetalk-1.5";
  if (normalized.includes("joyvasa") && normalized.includes("animal")) return "joyvasa-animal";
  if (normalized.includes("joyvasa")) return "joyvasa-human";
  if (normalized.includes("soulx") || normalized.includes("flashhead")) return "soulx-flashhead-pro";
  return null;
}

function isAnimationEngineId(value: string | null): value is PresenterAnimationEngineId {
  return value === "liveportrait-musetalk-1.5" || value === "joyvasa-human" || value === "joyvasa-animal" || value === "soulx-flashhead-pro";
}

export function presenterAnimationReadiness(
  choice: PresenterCapabilityChoice,
  runtime: PresenterLipSyncRuntimeContext,
): PresenterAnimationReadiness | null {
  const review = choice.lipSync;
  if (!review && choice.customPortrait) {
    const animationReview = choice.customPortrait.animationReview;
    if (!runtime.activeEngineId) {
      return {
        state: "static",
        badge: animationReview === "notReviewed" ? "Still image ready" : "Animation reviewed",
        detail: animationReview === "notReviewed"
          ? "This saved portrait is ready for still-image use. Run and accept an animation preview before using it for animated speech."
          : "This saved portrait has an accepted animation preview and is ready whenever its matching local model is selected.",
        blocksSelection: false,
      };
    }
    if (animationReview !== "notReviewed") {
      const exactStatus = choice.portraitArtifactHash
        ? runtime.portraitStatuses.find((entry) => entry.portraitArtifactHash === choice.portraitArtifactHash)
        : undefined;
      const defaultStatus = runtime.portraitStatuses.find((entry) => entry.portraitArtifactHash === null);
      const effectiveStatus = exactStatus ?? defaultStatus;
      if (runtime.statusLoaded === false) {
        return {
          state: "checking",
          badge: "Checking runtime",
          detail: "Checking this PC for the exact SoulX-FlashHead revision used by the accepted preview.",
          blocksSelection: false,
          blocksAnimation: true,
        };
      }
      if (
        runtime.activeEngineId === animationReview.engineId
        && effectiveStatus?.configured
        && effectiveStatus.modelId === animationReview.engineId
        && effectiveStatus.modelRevision === animationReview.modelRevision
      ) {
        return {
          state: "ready",
          badge: "Animated speech ready",
          detail: "This exact portrait passed a local animation preview with the installed SoulX-FlashHead revision.",
          blocksSelection: false,
          blocksAnimation: false,
        };
      }
      return {
        state: "pending-review",
        badge: "Preview again",
        detail: "The accepted preview belongs to a different presenter model revision. Run a fresh preview before generating animated speech.",
        blocksSelection: false,
        blocksAnimation: true,
      };
    }
    return {
      state: "pending-review",
      badge: "Preview required",
      detail: runtime.activeEngineId === "soulx-flashhead-pro"
        ? "Run a short local preview for this exact portrait before generating animated speech."
        : "Custom portrait animation uses SoulX-FlashHead Pro. Select that local presenter model, then run a short preview.",
      blocksSelection: false,
      blocksAnimation: true,
    };
  }
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
  if (exactStatus && !isAnimationEngineId(exactStatus.modelId)) {
    const nativeReason = exactStatus.reason.trim();
    return {
      state: "runtime-required",
      badge: "Runtime required",
      detail: `This portrait has an exact local route override, but its pinned model configuration is unavailable.${nativeReason ? ` ${nativeReason}` : ""} It will not fall back to the default face model.`,
      blocksSelection: true,
    };
  }
  // The primary config binds exact portrait hashes to child routes. That override
  // wins over the profile's default MuseTalk route even when its child is missing.
  const effectiveStatus = exactStatus ?? defaultStatus;
  const effectiveEngineId = effectiveStatus && isAnimationEngineId(effectiveStatus.modelId)
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
    return readiness && (readiness.blocksAnimation ?? readiness.blocksSelection) ? [`${choice.label}: ${readiness.detail}`] : [];
  });
}
