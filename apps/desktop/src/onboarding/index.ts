export { GuidedTour } from "./GuidedTour";
export { OnboardingDialog, OnboardingReplayButton } from "./OnboardingDialog";
export { ProfileGallery } from "./ProfileGallery";
export {
  adjacentChapter,
  advanceOnboarding,
  canAdvanceOnboarding,
  canCompleteOnboarding,
  chapterIndex,
  configuredChapterIds,
  createOnboardingState,
  defaultOnboardingConfiguration,
  goToOnboardingChapter,
  isChapterConfigured,
  normalizeOnboardingState,
  onboardingChapters,
  replayOnboarding,
  retreatOnboarding,
  shouldOpenFirstRunOnboarding,
  skipOnboarding,
  startOnboarding,
  updateOnboardingConfiguration,
} from "./state";
export { clamp, computeSpotlightRect, computeTourPanelPosition, safeTourIndex } from "./tour";
export { useOnboardingController } from "./useOnboardingController";
export type { OnboardingController, UseOnboardingControllerOptions } from "./useOnboardingController";
export type * from "./types";
