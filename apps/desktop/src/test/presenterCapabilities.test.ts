import { describe, expect, it } from "vitest";
import { CASUAL_PRESENTER_CATALOG } from "@alystria/themes";
import type { PresenterChoice } from "../PresenterPicker";
import {
  presenterAnimationReadiness,
  presenterLipSyncEngineForRouteModel,
  presenterSelectionAnimationIssues,
} from "../presenterCapabilities";
import type { PresenterLipSyncRuntimeContext } from "../presenterCapabilities";

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
  it("requires the reviewed runtime revision for a bundled SoulX presenter", () => {
    const portrait = CASUAL_PRESENTER_CATALOG.find((entry) => entry.displayName === "Yuki")!;
    const choice: PresenterChoice = { ...emma, id: portrait.id, label: portrait.label, portraitArtifactHash: portrait.contentHash, lipSync: portrait.lipSync };
    const revision = portrait.lipSync.qualifications.find((entry) => entry.engineId === "soulx-flashhead-pro")?.modelRevision;
    expect(revision).toBeTruthy();
    const runtime: PresenterLipSyncRuntimeContext = {
      activeEngineId: "soulx-flashhead-pro",
      portraitStatuses: [{ portraitArtifactHash: null, modelId: "soulx-flashhead-pro", modelRevision: revision!, configured: true, reason: "Installed." }],
    };
    expect(presenterAnimationReadiness(choice, runtime)).toMatchObject({ state: "ready", blocksSelection: false });
    expect(presenterAnimationReadiness(choice, {
      ...runtime,
      portraitStatuses: [{ portraitArtifactHash: null, modelId: "soulx-flashhead-pro", modelRevision: "different-weights", configured: true, reason: "Installed." }],
    })).toMatchObject({ state: "runtime-required", blocksSelection: true });
  });
  it("allows a custom portrait as a still and requires a preview for animation", () => {
    const custom: PresenterChoice = { id: "custom-presenter", label: "Nova", src: "nova.png", focalPoint: "50% 38%", portraitArtifactHash: "d".repeat(64), customPortrait: { animationReview: "notReviewed", source: "upload", libraryEntryId: "custom-presenter" } };
    expect(presenterAnimationReadiness(custom, { activeEngineId: null, portraitStatuses: [] })).toMatchObject({ state: "static", badge: "Still image ready", blocksSelection: false });
    expect(presenterAnimationReadiness(custom, { activeEngineId: "soulx-flashhead-pro", portraitStatuses: [] })).toMatchObject({ state: "pending-review", badge: "Preview required", blocksSelection: false, blocksAnimation: true });
    expect(presenterSelectionAnimationIssues([custom], {
      schemaVersion: 1,
      mode: "on",
      presenters: [{ presenterId: "profile-nova", portraitAssetId: custom.id }],
      sceneAssignments: [],
    }, { activeEngineId: "soulx-flashhead-pro", portraitStatuses: [] })).toHaveLength(1);
  });

  it("unlocks only the exact SoulX model revision accepted for a custom portrait", () => {
    const portraitHash = "d".repeat(64);
    const custom: PresenterChoice = {
      id: "custom-presenter",
      label: "Nova",
      src: "nova.png",
      focalPoint: "50% 38%",
      portraitArtifactHash: portraitHash,
      customPortrait: {
        source: "upload",
        libraryEntryId: "custom-presenter",
        animationReview: {
          status: "accepted",
          previewId: "presenter-preview-proof",
          portraitArtifactHash: portraitHash,
          outputArtifactHash: "e".repeat(64),
          engineId: "soulx-flashhead-pro",
          modelRevision: "soulx-code-a+weights-b",
          workerContractId: "alystria.soulx-flashhead.worker.v1",
          acceptedAt: "2026-09-21T00:00:00Z",
        },
      },
    };
    const ready = presenterAnimationReadiness(custom, {
      activeEngineId: "soulx-flashhead-pro",
      portraitStatuses: [{ portraitArtifactHash: null, modelId: "soulx-flashhead-pro", modelRevision: "soulx-code-a+weights-b", configured: true, reason: "Installed." }],
    });
    expect(ready).toMatchObject({ state: "ready", blocksSelection: false, blocksAnimation: false });
    const changed = presenterAnimationReadiness(custom, {
      activeEngineId: "soulx-flashhead-pro",
      portraitStatuses: [{ portraitArtifactHash: null, modelId: "soulx-flashhead-pro", modelRevision: "new-weights", configured: true, reason: "Updated." }],
    });
    expect(changed).toMatchObject({ state: "pending-review", badge: "Preview again", blocksAnimation: true });
  });
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
    expect(presenterLipSyncEngineForRouteModel("local/soulx-flashhead-pro")).toBe("soulx-flashhead-pro");
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
        qualifications: [{ engineId: "joyvasa-animal", displayName: "JoyVASA animal route", outcome: "pending-review", notes: "This exact bundled route has not passed the current mouth-and-blink review." }],
      },
    };
    const runtime = {
      activeEngineId: "joyvasa-animal" as const,
      portraitStatuses: [{ portraitArtifactHash: HASH, modelId: "joyvasa-animal", configured: true, reason: "Configured." }],
    };
    expect(presenterAnimationReadiness(animal, runtime)).toMatchObject({
      state: "pending-review",
      blocksSelection: true,
      blocksAnimation: true,
      detail: expect.stringMatching(/exact bundled route.+mouth-and-blink review.+animated speech stays unavailable/i),
    });
    expect(presenterSelectionAnimationIssues([animal], {
      schemaVersion: 1,
      mode: "on",
      presenters: [{ presenterId: "milo", portraitAssetId: "milo" }],
      sceneAssignments: [],
    }, runtime)).toHaveLength(1);
  });
});
