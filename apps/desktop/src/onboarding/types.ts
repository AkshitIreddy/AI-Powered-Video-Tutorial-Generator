import type { ReactNode } from "react";

export const ONBOARDING_SCHEMA_VERSION = 1 as const;

export const onboardingChapterIds = [
  "welcome",
  "goal",
  "runtime",
  "privacy",
  "provider",
  "hardware",
  "model",
  "profile",
  "ready",
] as const;

export type OnboardingChapterId = (typeof onboardingChapterIds)[number];
export type OnboardingStatus = "not-started" | "in-progress" | "completed" | "skipped";
export type RuntimePreference = "local" | "hybrid" | "cloud";
export type PrivacyPreference = "local-only" | "ask-before-cloud" | "approved-cloud";

export interface OnboardingGoalOption {
  id: string;
  label: string;
  description: string;
}

export interface RuntimeOption {
  id: RuntimePreference;
  label: string;
  description: string;
  recommended?: boolean;
}

export interface ProviderOption {
  id: string;
  name: string;
  description: string;
  connected?: boolean;
  requiresCredential?: boolean;
  icon?: ReactNode;
}

export interface ModelOption {
  id: string;
  name: string;
  providerId: string;
  medium: "language" | "image" | "speech" | "transcription" | "presenter" | "lip-sync" | "other";
  description?: string;
  installed?: boolean;
  compatible?: boolean;
  recommended?: boolean;
}

export interface HardwareSummary {
  cpuLabel?: string;
  memoryGb?: number;
  gpuLabel?: string;
  vramGb?: number;
  localGenerationSupported?: boolean;
  warnings?: readonly string[];
}

export interface ProfilePortraitAsset {
  id: string;
  src: string;
  alt: string;
  label: string;
  style?: string;
  attribution?: string;
  disabled?: boolean;
}

export interface AccountProfileConfiguration {
  displayName: string;
  portraitAssetId: string | null;
}

export interface OnboardingConfiguration {
  goals: string[];
  runtime: RuntimePreference | null;
  privacy: PrivacyPreference | null;
  providerIds: string[];
  modelIds: string[];
  hardwareReviewed: boolean;
  profile: AccountProfileConfiguration;
}

export interface OnboardingSetupState {
  runtimeConfigured?: boolean;
  detectedRuntime?: RuntimePreference | null;
  privacyConfigured?: boolean;
  detectedPrivacy?: PrivacyPreference | null;
  connectedProviderIds?: readonly string[];
  installedModelIds?: readonly string[];
  hardware?: HardwareSummary | null;
  hardwareInspected?: boolean;
  existingProfile?: Partial<AccountProfileConfiguration> | null;
}

export interface PersistedOnboardingState {
  schemaVersion: typeof ONBOARDING_SCHEMA_VERSION;
  status: OnboardingStatus;
  activeChapterId: OnboardingChapterId;
  completedChapterIds: OnboardingChapterId[];
  visitedChapterIds: OnboardingChapterId[];
  configuration: OnboardingConfiguration;
  revision: number;
  updatedAt: string;
}

export interface OnboardingChapterDefinition {
  id: OnboardingChapterId;
  eyebrow: string;
  title: string;
  description: string;
  optional?: boolean;
}

export interface OnboardingCatalog {
  goals: readonly OnboardingGoalOption[];
  runtimes: readonly RuntimeOption[];
  providers: readonly ProviderOption[];
  models: readonly ModelOption[];
  portraits: readonly ProfilePortraitAsset[];
}

export interface ImportedProfileAsset {
  asset: ProfilePortraitAsset;
  accepted: boolean;
}

export interface ProfileGalleryProps {
  assets: readonly ProfilePortraitAsset[];
  profile: AccountProfileConfiguration;
  onChange: (profile: AccountProfileConfiguration) => void;
  onAcceptAsset?: ((file: File) => Promise<ImportedProfileAsset | ProfilePortraitAsset | null>) | undefined;
  acceptedFileTypes?: string;
  disabled?: boolean;
  heading?: string;
  description?: string;
}

export type TourPlacement = "top" | "right" | "bottom" | "left" | "center";

export interface GuidedTourStep {
  id: string;
  target: string | null;
  title: string;
  description: string;
  placement?: TourPlacement;
  padding?: number;
  allowTargetInteraction?: boolean;
  chapterId?: OnboardingChapterId;
}

export interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
  borderRadius: number;
}

export interface GuidedTourProps {
  open: boolean;
  steps: readonly GuidedTourStep[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onExit: () => void;
  onComplete: () => void;
  reducedMotion?: boolean;
  resolveTarget?: (selector: string) => HTMLElement | null;
  spotlightRadius?: number;
}
