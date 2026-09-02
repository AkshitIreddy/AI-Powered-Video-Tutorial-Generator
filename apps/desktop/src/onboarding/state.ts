import {
  ONBOARDING_SCHEMA_VERSION,
  onboardingChapterIds,
  type OnboardingChapterDefinition,
  type OnboardingChapterId,
  type OnboardingConfiguration,
  type OnboardingSetupState,
  type PersistedOnboardingState,
} from "./types";

export const onboardingChapters: readonly OnboardingChapterDefinition[] = [
  { id: "welcome", eyebrow: "Welcome", title: "Make Alystria yours", description: "A short guided setup keeps every generation deliberate, private, and matched to your computer." },
  { id: "goal", eyebrow: "Chapter 1", title: "What will you create?", description: "Choose one or more goals. You can change these later in Settings." },
  { id: "runtime", eyebrow: "Chapter 2", title: "Choose where work runs", description: "Balance local control, cloud capability, and convenience." },
  { id: "privacy", eyebrow: "Chapter 3", title: "Set your privacy boundary", description: "Alystria should never send source material somewhere you did not approve." },
  { id: "provider", eyebrow: "Chapter 4", title: "Connect generation providers", description: "Use existing connections or select providers to configure after onboarding.", optional: true },
  { id: "hardware", eyebrow: "Chapter 5", title: "Review this system", description: "Confirm the detected hardware before selecting local workloads." },
  { id: "model", eyebrow: "Chapter 6", title: "Select your model toolkit", description: "Choose explicit models for the media you plan to generate.", optional: true },
  { id: "profile", eyebrow: "Chapter 7", title: "Create your studio profile", description: "Choose how your account appears in the workspace." },
  { id: "ready", eyebrow: "Ready", title: "Your studio is prepared", description: "Review the choices below, then enter Alystria." },
] as const;

export const defaultOnboardingConfiguration: OnboardingConfiguration = {
  goals: [],
  runtime: null,
  privacy: null,
  providerIds: [],
  modelIds: [],
  hardwareReviewed: false,
  profile: { displayName: "", portraitAssetId: null },
};

const chapterSet = new Set<string>(onboardingChapterIds);

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function validChapterIds(values: readonly string[] | undefined): OnboardingChapterId[] {
  return unique((values ?? []).filter((value): value is OnboardingChapterId => chapterSet.has(value)));
}

function mergeSetupConfiguration(
  configuration: OnboardingConfiguration,
  setup: OnboardingSetupState,
): OnboardingConfiguration {
  const existingProfile = setup.existingProfile;
  return {
    ...configuration,
    runtime: configuration.runtime ?? setup.detectedRuntime ?? null,
    privacy: configuration.privacy ?? setup.detectedPrivacy ?? null,
    providerIds: unique([...configuration.providerIds, ...(setup.connectedProviderIds ?? [])]),
    modelIds: unique([...configuration.modelIds, ...(setup.installedModelIds ?? [])]),
    hardwareReviewed: configuration.hardwareReviewed || setup.hardwareInspected === true,
    profile: {
      displayName: configuration.profile.displayName || existingProfile?.displayName || "",
      portraitAssetId: configuration.profile.portraitAssetId ?? existingProfile?.portraitAssetId ?? null,
    },
  };
}

export function isChapterConfigured(
  chapterId: OnboardingChapterId,
  configuration: OnboardingConfiguration,
  setup: OnboardingSetupState,
): boolean {
  switch (chapterId) {
    case "welcome":
      return true;
    case "goal":
      return configuration.goals.length > 0;
    case "runtime":
      return configuration.runtime !== null || setup.runtimeConfigured === true;
    case "privacy":
      return configuration.privacy !== null || setup.privacyConfigured === true;
    case "provider":
      return configuration.providerIds.length > 0 || (setup.connectedProviderIds?.length ?? 0) > 0;
    case "hardware":
      return configuration.hardwareReviewed || setup.hardwareInspected === true;
    case "model":
      return configuration.modelIds.length > 0 || (setup.installedModelIds?.length ?? 0) > 0;
    case "profile":
      return configuration.profile.displayName.trim().length > 0;
    case "ready":
      return false;
  }
}

export function configuredChapterIds(
  configuration: OnboardingConfiguration,
  setup: OnboardingSetupState,
): OnboardingChapterId[] {
  return onboardingChapterIds.filter((id) => id !== "ready" && isChapterConfigured(id, configuration, setup));
}

export function createOnboardingState(
  setup: OnboardingSetupState = {},
  now: () => string = () => new Date().toISOString(),
): PersistedOnboardingState {
  const configuration = mergeSetupConfiguration(defaultOnboardingConfiguration, setup);
  return {
    schemaVersion: ONBOARDING_SCHEMA_VERSION,
    status: "not-started",
    activeChapterId: "welcome",
    completedChapterIds: configuredChapterIds(configuration, setup),
    visitedChapterIds: [],
    configuration,
    revision: 0,
    updatedAt: now(),
  };
}

export function normalizeOnboardingState(
  persisted: PersistedOnboardingState | null | undefined,
  setup: OnboardingSetupState = {},
  now: () => string = () => new Date().toISOString(),
): PersistedOnboardingState {
  if (!persisted || persisted.schemaVersion !== ONBOARDING_SCHEMA_VERSION) {
    return createOnboardingState(setup, now);
  }

  const configuration = mergeSetupConfiguration({
    ...defaultOnboardingConfiguration,
    ...persisted.configuration,
    goals: unique(persisted.configuration?.goals ?? []),
    providerIds: unique(persisted.configuration?.providerIds ?? []),
    modelIds: unique(persisted.configuration?.modelIds ?? []),
    profile: { ...defaultOnboardingConfiguration.profile, ...persisted.configuration?.profile },
  }, setup);
  const configured = configuredChapterIds(configuration, setup);
  const activeChapterId = chapterSet.has(persisted.activeChapterId) ? persisted.activeChapterId : "welcome";

  return {
    ...persisted,
    schemaVersion: ONBOARDING_SCHEMA_VERSION,
    activeChapterId,
    configuration,
    completedChapterIds: unique([...validChapterIds(persisted.completedChapterIds), ...configured]),
    visitedChapterIds: validChapterIds(persisted.visitedChapterIds),
    revision: Number.isFinite(persisted.revision) ? Math.max(0, persisted.revision) : 0,
    updatedAt: persisted.updatedAt || now(),
  };
}

export function shouldOpenFirstRunOnboarding(state: PersistedOnboardingState | null | undefined): boolean {
  return !state || state.status === "not-started" || state.status === "in-progress";
}

export function chapterIndex(chapterId: OnboardingChapterId): number {
  return onboardingChapterIds.indexOf(chapterId);
}

export function canCompleteOnboarding(
  configuration: OnboardingConfiguration,
  setup: OnboardingSetupState = {},
): boolean {
  return onboardingChapters
    .filter((chapter) => chapter.id !== "ready" && chapter.optional !== true)
    .every((chapter) => isChapterConfigured(chapter.id, configuration, setup));
}

export function canAdvanceOnboarding(
  state: PersistedOnboardingState,
  setup: OnboardingSetupState = {},
): boolean {
  if (state.activeChapterId === "ready") return canCompleteOnboarding(state.configuration, setup);
  const chapter = onboardingChapters.find((candidate) => candidate.id === state.activeChapterId);
  return chapter?.optional === true || isChapterConfigured(state.activeChapterId, state.configuration, setup);
}

export function adjacentChapter(
  chapterId: OnboardingChapterId,
  direction: 1 | -1,
): OnboardingChapterId {
  const nextIndex = Math.min(
    onboardingChapterIds.length - 1,
    Math.max(0, chapterIndex(chapterId) + direction),
  );
  return onboardingChapterIds[nextIndex] ?? "welcome";
}

export function withStateChange(
  state: PersistedOnboardingState,
  change: Partial<PersistedOnboardingState>,
  now: () => string = () => new Date().toISOString(),
): PersistedOnboardingState {
  return {
    ...state,
    ...change,
    revision: state.revision + 1,
    updatedAt: now(),
  };
}

export function startOnboarding(
  state: PersistedOnboardingState,
  setup: OnboardingSetupState = {},
  now?: () => string,
): PersistedOnboardingState {
  const normalized = normalizeOnboardingState(state, setup, now);
  return withStateChange(normalized, {
    status: "in-progress",
    activeChapterId: normalized.activeChapterId,
    visitedChapterIds: unique([...normalized.visitedChapterIds, normalized.activeChapterId]),
  }, now);
}

export function updateOnboardingConfiguration(
  state: PersistedOnboardingState,
  patch: Partial<OnboardingConfiguration>,
  setup: OnboardingSetupState = {},
  now?: () => string,
): PersistedOnboardingState {
  const configuration = mergeSetupConfiguration({
    ...state.configuration,
    ...patch,
    profile: patch.profile ? { ...state.configuration.profile, ...patch.profile } : state.configuration.profile,
  }, setup);
  return withStateChange(state, {
    configuration,
    completedChapterIds: unique([...state.completedChapterIds, ...configuredChapterIds(configuration, setup)]),
  }, now);
}

export function goToOnboardingChapter(
  state: PersistedOnboardingState,
  chapterId: OnboardingChapterId,
  now?: () => string,
): PersistedOnboardingState {
  return withStateChange(state, {
    activeChapterId: chapterId,
    visitedChapterIds: unique([...state.visitedChapterIds, chapterId]),
  }, now);
}

export function advanceOnboarding(
  state: PersistedOnboardingState,
  setup: OnboardingSetupState = {},
  now?: () => string,
): PersistedOnboardingState {
  if (!canAdvanceOnboarding(state, setup)) return state;
  const current = state.activeChapterId;
  const completedChapterIds = unique([
    ...state.completedChapterIds,
    ...(isChapterConfigured(current, state.configuration, setup) ? [current] : []),
  ]);

  if (current === "ready") {
    return withStateChange(state, {
      status: "completed",
      completedChapterIds: unique([...completedChapterIds, "ready"]),
      visitedChapterIds: unique([...state.visitedChapterIds, "ready"]),
    }, now);
  }

  const next = adjacentChapter(current, 1);
  return withStateChange(state, {
    status: "in-progress",
    activeChapterId: next,
    completedChapterIds,
    visitedChapterIds: unique([...state.visitedChapterIds, current, next]),
  }, now);
}

export function retreatOnboarding(
  state: PersistedOnboardingState,
  now?: () => string,
): PersistedOnboardingState {
  return goToOnboardingChapter(state, adjacentChapter(state.activeChapterId, -1), now);
}

export function skipOnboarding(
  state: PersistedOnboardingState,
  now?: () => string,
): PersistedOnboardingState {
  return withStateChange(state, { status: "skipped" }, now);
}

export function replayOnboarding(
  state: PersistedOnboardingState,
  setup: OnboardingSetupState = {},
  now?: () => string,
): PersistedOnboardingState {
  const normalized = normalizeOnboardingState(state, setup, now);
  return withStateChange(normalized, {
    status: "in-progress",
    activeChapterId: "welcome",
    visitedChapterIds: ["welcome"],
  }, now);
}
