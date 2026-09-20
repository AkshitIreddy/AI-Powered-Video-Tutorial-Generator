import { describe, expect, it } from "vitest";
import { CASUAL_PRESENTER_CATALOG } from "@alystria/themes";
import type { PresenterChoice } from "../PresenterPicker";
import {
  presenterAnimationReadiness,
  presenterLipSyncEngineForRouteModel,
  presenterSelectionAnimationIssues,
} from "../presenterCapabilities";

const HASH = "a".repeat(64);
const emma: PresenterChoice = {
  id: "emma",
  label: "Emma",
  src: "emma.png",
  focalPoint: "50% 20%",
  portraitArtifactHash: HASH,
  lipSync: {
    preferredEngineId: "liveportrait-musetalk-1.5",
    qualifications: [{
      engineId: "liveportrait-musetalk-1.5",
      displayName: "LivePortrait + MuseTalk 1.5",
      outcome: "reviewed-compatible",
      notes: "Reviewed.",
    }],
  },
};

describe("presenter animation capabilities", () => {
  it.each(["Poppy", "Leo"])("blocks rejected %s animation even when its exact runtime is installed", (name) => {
    const portrait = CASUAL_PRESENTER_CATALOG.find((entry) => entry.displayName === name)!;
    const choice: PresenterChoice = {
      ...emma,
      id: portrait.id,
      label: portrait.label,
      portraitArtifactHash: portrait.contentHash,
      lipSync: portrait.lipSync,
    };
    expect(presenterAnimationReadiness(choice, {
      activeEngineId: "liveportrait-musetalk-1.5",
      portraitStatuses: [{ portraitArtifactHash: portrait.contentHash, modelId: "joyvasa-animal", configured: true, reason: "Installed." }],
    })).toMatchObject({ state: "incompatible", blocksSelection: true, detail: expect.stringContaining("teeth strips") });
  });

  it("maps saved route aliases to the exact worker model identity", () => {
    expect(presenterLipSyncEngineForRouteModel("local/musetalk-1.5")).toBe("liveportrait-musetalk-1.5");
    expect(presenterLipSyncEngineForRouteModel("joyvasa-animal")).toBe("joyvasa-animal");
    expect(presenterLipSyncEngineForRouteModel("off by default")).toBeNull();
  });

  it("lets an exact portrait override win over the default engine", () => {
    expect(presenterAnimationReadiness(emma, {
      activeEngineId: "liveportrait-musetalk-1.5",
      portraitStatuses: [{ portraitArtifactHash: HASH, modelId: "joyvasa-human", configured: true, reason: "Different child route." }],
    })).toMatchObject({ state: "incompatible", blocksSelection: true });
  });

  it("accepts the installed default MuseTalk route without a per-portrait override", () => {
    expect(presenterAnimationReadiness(emma, {
      activeEngineId: "liveportrait-musetalk-1.5",
      portraitStatuses: [{ portraitArtifactHash: null, modelId: "liveportrait-musetalk-1.5", configured: true, reason: "Primary route configured." }],
    })).toMatchObject({ state: "ready", blocksSelection: false });
  });

  it("reports native discovery honestly instead of flashing a missing-runtime claim", () => {
    expect(presenterAnimationReadiness(emma, {
      activeEngineId: "liveportrait-musetalk-1.5",
      portraitStatuses: [],
      statusLoaded: false,
    })).toMatchObject({ state: "checking", badge: "Checking runtime", blocksSelection: true });
  });

  it("does not fall back to MuseTalk when an exact JoyVASA override is unavailable", () => {
    const animal: PresenterChoice = {
      ...emma,
      id: "milo",
      label: "Milo",
      lipSync: {
        preferredEngineId: "joyvasa-animal",
        qualifications: [{ engineId: "joyvasa-animal", displayName: "JoyVASA animal route", outcome: "reviewed-compatible", notes: "Reviewed." }],
      },
    };
    expect(presenterAnimationReadiness(animal, {
      activeEngineId: "liveportrait-musetalk-1.5",
      portraitStatuses: [
        { portraitArtifactHash: null, modelId: "liveportrait-musetalk-1.5", configured: true, reason: "Primary route configured." },
        { portraitArtifactHash: HASH, modelId: "joyvasa-animal", configured: false, reason: "Child config is missing." },
      ],
    })).toMatchObject({ state: "runtime-required", blocksSelection: true });
    expect(presenterAnimationReadiness(animal, {
      activeEngineId: "liveportrait-musetalk-1.5",
      portraitStatuses: [
        { portraitArtifactHash: null, modelId: "liveportrait-musetalk-1.5", configured: true, reason: "Primary route configured." },
        { portraitArtifactHash: HASH, modelId: null, configured: false, reason: "Child config could not be read." },
      ],
    })).toMatchObject({
      state: "runtime-required",
      detail: expect.stringContaining("will not fall back"),
      blocksSelection: true,
    });
  });

  it("does not turn a configured child route into a compatibility claim before review", () => {
    const animal: PresenterChoice = {
      ...emma,
      id: "milo",
      label: "Milo",
      lipSync: {
        preferredEngineId: "joyvasa-animal",
        qualifications: [{ engineId: "joyvasa-animal", displayName: "JoyVASA animal route", outcome: "pending-review", notes: "Pending." }],
      },
    };
    const runtime = {
      activeEngineId: "joyvasa-animal" as const,
      portraitStatuses: [{ portraitArtifactHash: HASH, modelId: "joyvasa-animal", configured: true, reason: "Configured." }],
    };
    expect(presenterAnimationReadiness(animal, runtime)).toMatchObject({ state: "pending-review", blocksSelection: true });
    expect(presenterSelectionAnimationIssues([animal], {
      schemaVersion: 1,
      mode: "on",
      presenters: [{ presenterId: "milo", portraitAssetId: "milo" }],
      sceneAssignments: [],
    }, runtime)).toHaveLength(1);
  });
});
