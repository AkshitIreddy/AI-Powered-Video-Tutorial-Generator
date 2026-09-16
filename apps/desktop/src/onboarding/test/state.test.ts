import { describe, expect, it } from "vitest";
import {
  advanceOnboarding,
  computeSpotlightRect,
  computeTourPanelPosition,
  createGuidedTourReplaySteps,
  createOnboardingState,
  exitOnboarding,
  normalizeOnboardingState,
  replayOnboarding,
  shouldOpenFirstRunOnboarding,
  skipOnboarding,
  startOnboarding,
  updateOnboardingConfiguration,
} from "..";
import type { OnboardingSetupState, PersistedOnboardingState } from "..";

const clock = () => "2026-09-02T08:00:00.000Z";

describe("onboarding state", () => {
  it.each(["completed", "skipped"] as const)("keeps a %s setup settled after replay exit or restart", (status) => {
    const previous = { ...createOnboardingState({}, clock), status };
    const replay = replayOnboarding(previous, {}, clock);
    expect(replay.status).toBe("in-progress");
    expect(shouldOpenFirstRunOnboarding(replay)).toBe(false);
    const restored = exitOnboarding(normalizeOnboardingState(JSON.parse(JSON.stringify(replay)), {}, clock), clock);
    expect(restored.status).toBe(status);
    expect(restored.replayReturnStatus).toBeNull();
    expect(restored.configuration).toEqual(previous.configuration);
    expect(shouldOpenFirstRunOnboarding(restored)).toBe(false);
  });

  it("keeps an unfinished first setup resumable after exit", () => {
    const started = startOnboarding(createOnboardingState({}, clock), {}, clock);
    const exited = exitOnboarding(started, clock);
    expect(exited).toEqual(started);
    expect(shouldOpenFirstRunOnboarding(exited)).toBe(true);
  });

  it("detects and preserves setup that is already configured", () => {
    const setup: OnboardingSetupState = {
      runtimeConfigured: true,
      detectedRuntime: "local",
      privacyConfigured: true,
      detectedPrivacy: "ask-before-cloud",
      connectedProviderIds: ["nvidia", "elevenlabs"],
      installedModelIds: ["local-llm"],
      hardwareInspected: true,
      existingProfile: { displayName: "Akshit", portraitAssetId: "portrait-2" },
    };

    const state = createOnboardingState(setup, clock);

    expect(state.configuration).toMatchObject({
      runtime: "local",
      privacy: "ask-before-cloud",
      providerIds: ["nvidia", "elevenlabs"],
      modelIds: ["local-llm"],
      hardwareReviewed: true,
      profile: { displayName: "Akshit", portraitAssetId: "portrait-2" },
    });
    expect(state.completedChapterIds).toEqual(expect.arrayContaining(["welcome", "runtime", "provider", "hardware", "model", "profile"]));
    expect(state.completedChapterIds).not.toContain("privacy");
    expect(state.status).toBe("not-started");
    expect(shouldOpenFirstRunOnboarding(state)).toBe(true);
  });

  it("progresses chapters without marking an incomplete required choice complete", () => {
    let state = startOnboarding(createOnboardingState({}, clock), {}, clock);
    expect(state.activeChapterId).toBe("welcome");
    state = advanceOnboarding(state, {}, clock);
    expect(state.activeChapterId).toBe("goal");
    expect(state.completedChapterIds).toContain("welcome");

    state = advanceOnboarding(state, {}, clock);
    expect(state.activeChapterId).toBe("goal");
    expect(state.completedChapterIds).not.toContain("goal");

    state = updateOnboardingConfiguration(state, { goals: ["tutorials"] }, {}, clock);
    state = advanceOnboarding(state, {}, clock);
    expect(state.activeChapterId).toBe("runtime");
    state = updateOnboardingConfiguration(state, { runtime: "hybrid" }, {}, clock);
    expect(state.completedChapterIds).toEqual(expect.arrayContaining(["goal", "runtime"]));
    expect(state.revision).toBeGreaterThan(1);
  });

  it("completes only after advancing from the ready chapter", () => {
    const setup: OnboardingSetupState = {
      runtimeConfigured: true,
      privacyConfigured: true,
      hardwareInspected: true,
      existingProfile: { displayName: "Studio Owner" },
    };
    let state = createOnboardingState(setup, clock);
    state = updateOnboardingConfiguration(state, { goals: ["tutorials"] }, setup, clock);
    state = { ...state, status: "in-progress", activeChapterId: "ready" };

    state = advanceOnboarding(state, setup, clock);

    expect(state.status).toBe("completed");
    expect(state.completedChapterIds).toContain("ready");
    expect(shouldOpenFirstRunOnboarding(state)).toBe(false);
  });

  it("replays skipped or completed onboarding while preserving every configured step", () => {
    let state = createOnboardingState({}, clock);
    state = updateOnboardingConfiguration(state, {
      goals: ["courses", "explainers"],
      runtime: "hybrid",
      privacy: "ask-before-cloud",
      providerIds: ["openai"],
      modelIds: ["gpt-image"],
      hardwareReviewed: true,
      profile: { displayName: "Studio Owner", portraitAssetId: "portrait-7" },
    }, {}, clock);
    state = skipOnboarding(state, clock);
    const beforeReplay = structuredClone(state.configuration);

    const replayed = replayOnboarding(state, { connectedProviderIds: ["elevenlabs"] }, clock);

    expect(replayed.status).toBe("in-progress");
    expect(replayed.activeChapterId).toBe("welcome");
    expect(replayed.visitedChapterIds).toEqual(["welcome"]);
    expect(replayed.configuration).toEqual({
      ...beforeReplay,
      providerIds: ["openai", "elevenlabs"],
    });
    expect(replayed.completedChapterIds).toEqual(expect.arrayContaining(["goal", "runtime", "provider", "hardware", "model", "profile"]));
    expect(replayed.completedChapterIds).not.toContain("privacy");
  });

  it("normalizes duplicate and stale state without erasing user configuration", () => {
    const persisted = {
      ...createOnboardingState({}, clock),
      status: "in-progress",
      activeChapterId: "unknown-chapter",
      completedChapterIds: ["goal", "goal", "unknown-chapter"],
      configuration: {
        ...createOnboardingState({}, clock).configuration,
        goals: ["tutorials", "tutorials"],
        providerIds: ["openai", "openai"],
      },
    } as unknown as PersistedOnboardingState;

    const normalized = normalizeOnboardingState(persisted, {}, clock);

    expect(normalized.activeChapterId).toBe("welcome");
    expect(normalized.configuration.goals).toEqual(["tutorials"]);
    expect(normalized.configuration.providerIds).toEqual(["openai"]);
    expect(normalized.completedChapterIds.filter((id) => id === "goal")).toHaveLength(1);
  });

  it("migrates a legacy privacy chapter to the next available setup step", () => {
    const persisted = {
      ...createOnboardingState({}, clock),
      status: "in-progress",
      activeChapterId: "privacy",
      completedChapterIds: ["goal", "runtime", "privacy"],
      visitedChapterIds: ["welcome", "goal", "runtime", "privacy"],
      configuration: {
        ...createOnboardingState({}, clock).configuration,
        privacy: "ask-before-cloud",
      },
    } as unknown as PersistedOnboardingState;

    const normalized = normalizeOnboardingState(persisted, {}, clock);

    expect(normalized.activeChapterId).toBe("provider");
    expect(normalized.completedChapterIds).not.toContain("privacy");
    expect(normalized.visitedChapterIds).not.toContain("privacy");
    expect(normalized.configuration.privacy).toBe("ask-before-cloud");
  });
});

describe("guided-tour geometry", () => {
  it("clamps a padded spotlight to the viewport", () => {
    expect(computeSpotlightRect({ top: -4, left: 980, width: 80, height: 40 }, { width: 1024, height: 768 }, 12, 20)).toEqual({
      top: 0,
      left: 968,
      width: 56,
      height: 48,
      borderRadius: 20,
    });
  });

  it("replays unfinished actions first and keeps a full refresher when all are done", () => {
    const steps = [
      { id: "create", target: "#create", title: "Create", description: "Create a tutorial", completion: { type: "external" as const, key: "project-created", label: "Create a project" } },
      { id: "review", target: "#review", title: "Review", description: "Review the result", completion: { type: "external" as const, label: "Open review" } },
      { id: "export", target: "#export", title: "Export", description: "Export the result", completion: { type: "external" as const, label: "Export a tutorial" } },
    ];

    expect(createGuidedTourReplaySteps(steps, ["project-created", "export"])).toEqual([steps[1]]);
    expect(createGuidedTourReplaySteps(steps, ["project-created", "review", "export"])).toEqual(steps);
  });

  it("falls back to a panel placement that remains visible", () => {
    const position = computeTourPanelPosition(
      { top: 700, left: 900, width: 100, height: 50, borderRadius: 16 },
      { width: 1024, height: 768 },
      "bottom",
    );
    expect(position.top).toBeGreaterThanOrEqual(16);
    expect(position.left).toBeGreaterThanOrEqual(16);
    expect(position.top + 240).toBeLessThanOrEqual(752);
    expect(position.left + 360).toBeLessThanOrEqual(1008);
  });
});
