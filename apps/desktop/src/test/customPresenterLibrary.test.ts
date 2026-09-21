import { describe, expect, it, vi } from "vitest";
import {
  buildPresenterGenerationRequest,
  materializeLibraryPresenters,
  mergeMaterializedPresenterAssets,
  presenterAnimationPreviewFromJob,
  presenterLibraryChoice,
  presenterChoicesForProject,
  type ResolvedPresenterLibraryEntry,
} from "../customPresenterLibrary";

const entry: ResolvedPresenterLibraryEntry = {
  id: "custom-presenter-abc",
  displayName: "Nova",
  sha256: "a".repeat(64),
  byteSize: 128,
  mediaType: "image/png",
  originalFilename: "nova.png",
  addedAt: "2026-09-21T00:00:00Z",
  source: { kind: "upload" },
  rights: { status: "owned", commercialUse: "allowed", redistribution: "allowed", modelInput: "allowed" },
  presenter: { identityType: "synthetic", displayName: "Nova", syntheticOriginAttested: true, selectAfterImport: false },
  animationReview: "notReviewed",
  previewUrl: "asset://nova.png",
};

describe("custom presenter library", () => {
  it("accepts only an exact hash-bound SoulX preview receipt", () => {
    const preview = {
      schemaVersion: 1 as const,
      id: "presenter-preview-proof",
      status: "ready" as const,
      baseRevisionId: "revision-1",
      profileId: "profile-nova",
      portraitArtifactId: "asset-nova",
      portraitArtifactHash: "a".repeat(64),
      narrationArtifactHash: "b".repeat(64),
      outputArtifactHash: "c".repeat(64),
      mediaType: "video/mp4" as const,
      byteSize: 1_024,
      durationMs: 5_080,
      engineId: "soulx-flashhead-pro" as const,
      modelRevision: "soulx-code-a+weights-b",
      workerContractId: "alystria.soulx-flashhead.worker.v1" as const,
      seed: 42,
      createdAt: "2026-09-21T00:00:00Z",
    };
    expect(presenterAnimationPreviewFromJob({ jobId: "job", state: "SUCCEEDED", acceptedAt: "now", message: "ready", retryable: false, result: { preview } })).toEqual(preview);
    expect(() => presenterAnimationPreviewFromJob({ jobId: "job", state: "SUCCEEDED", acceptedAt: "now", message: "ready", retryable: false, result: { preview: { ...preview, modelRevision: "" } } })).toThrow(/invalid provenance/i);
  });
  it("routes presenter creation through the project's selected image route", () => {
    const request = buildPresenterGenerationRequest({
      projectId: "project-1",
      projectDirectory: "C:/Projects/One",
      headRevisionId: "revision-1",
      baseJobId: "job-1",
      sceneId: "scene-1",
      displayName: "Nova",
      prompt: "A friendly anime physics teacher",
      seed: 42,
    });
    expect(request).toMatchObject({ role: "presenter", presenterDisplayName: "Nova", alternatives: 3, baseRevisionId: "revision-1", baseJobId: "job-1", seed: 42 });
    expect(request.instruction).toMatch(/anime physics teacher.*closed resting mouth/i);
    expect(request).not.toHaveProperty("imageRecipe");
  });
  it("builds an honest custom choice without claiming animation qualification", () => {
    expect(presenterLibraryChoice(entry)).toMatchObject({
      id: entry.id,
      src: entry.previewUrl,
      portraitArtifactHash: entry.sha256,
      customPortrait: { animationReview: "notReviewed", source: "upload", libraryEntryId: entry.id },
    });
  });

  it("imports reusable portraits sequentially and rewrites cast plus scene assignments", async () => {
    const importer = vi.fn()
      .mockResolvedValueOnce({
        headRevisionId: "revision-2",
        revisionNumber: 2,
        presenterProfile: { profileId: "profile-nova", portraitArtifactId: "asset-nova" },
      })
      .mockResolvedValueOnce({
        headRevisionId: "revision-3",
        revisionNumber: 3,
        presenterProfile: { profileId: "profile-echo", portraitArtifactId: "asset-echo" },
      });
    const result = await materializeLibraryPresenters({
      schemaVersion: 1,
      mode: "on",
      presenters: [
        { presenterId: "custom-presenter-nova", portraitAssetId: "custom-presenter-nova" },
        { presenterId: "speaker-echo", portraitAssetId: "custom-presenter-echo", voiceId: "voice-2" },
      ],
      sceneAssignments: [{ sceneId: "scene-1", presenterId: "speaker-echo" }],
    }, {
      projectId: "project-1",
      projectDirectory: "C:/Projects/One",
      headRevisionId: "revision-1",
    }, new Set(["custom-presenter-nova", "custom-presenter-echo"]), importer);

    expect(importer).toHaveBeenNthCalledWith(1, expect.objectContaining({ entryId: "custom-presenter-nova", expectedHeadRevisionId: "revision-1" }));
    expect(importer).toHaveBeenNthCalledWith(2, expect.objectContaining({ entryId: "custom-presenter-echo", expectedHeadRevisionId: "revision-2" }));
    expect(result).toMatchObject({
      headRevisionId: "revision-3",
      revisionNumber: 3,
      selection: {
        presenters: [
          { presenterId: "profile-nova", portraitAssetId: "asset-nova" },
          { presenterId: "profile-echo", portraitAssetId: "asset-echo", voiceId: "voice-2" },
        ],
        sceneAssignments: [{ sceneId: "scene-1", presenterId: "profile-echo" }],
      },
    });
  });

  it("replaces a global gallery identity with its durable project asset and profile", () => {
    const choices = presenterChoicesForProject([], [entry], [{
      id: "asset-nova",
      kind: "presenter",
      label: "Nova",
      source: "user-upload",
      sha256: entry.sha256,
      creator: "Project owner",
      license: "Owned",
      attribution: "",
      rightsStatus: "cleared",
    }], {
      schemaVersion: 1,
      mode: "on",
      presenters: [{ presenterId: "profile-nova", portraitAssetId: "asset-nova" }],
      sceneAssignments: [],
    });
    expect(choices).toEqual([expect.objectContaining({ id: "asset-nova", presenterId: "profile-nova", src: entry.previewUrl })]);
  });

  it("persists a materialized library portrait as one project alias without importing it again", async () => {
    const receipt = {
      projectId: "project-1",
      headRevisionId: "revision-2",
      revisionNumber: 2,
      artifact: {
        id: "asset-nova",
        kind: "presenterPortrait" as const,
        sha256: entry.sha256,
        byteSize: entry.byteSize,
        mediaType: entry.mediaType,
        originalFilename: entry.originalFilename,
        state: "promoted",
      },
      provenance: {
        id: "provenance-nova",
        origin: "userImport",
        rightsStatus: "owned" as const,
        creator: "Project owner",
        license: "User owned",
        attribution: "No attribution required",
        exportEligible: true,
        blockers: [],
        modelInputEligible: true,
        modelInputBlockers: [],
      },
      presenterProfile: {
        profileId: "profile-nova",
        displayName: "Nova",
        portraitArtifactId: "asset-nova",
        identityType: "synthetic" as const,
        disclosureRequired: true,
        authorizedDistributionScope: "publicCommercial" as const,
      },
    };
    const assets = mergeMaterializedPresenterAssets([], [entry], [receipt]);
    expect(assets).toEqual([expect.objectContaining({
      id: "asset-nova",
      kind: "presenter",
      label: "Nova",
      source: "user-upload",
      sha256: entry.sha256,
      rightsStatus: "cleared",
    })]);
    const selection = {
      schemaVersion: 1 as const,
      mode: "on" as const,
      presenters: [{ presenterId: "profile-nova", portraitAssetId: "asset-nova" }],
      sceneAssignments: [],
    };
    expect(presenterChoicesForProject([], [entry], assets, selection)).toEqual([
      expect.objectContaining({ id: "asset-nova", presenterId: "profile-nova", customPortrait: { libraryEntryId: entry.id, animationReview: "notReviewed", source: "upload" } }),
    ]);
    const importer = vi.fn();
    const repeated = await materializeLibraryPresenters(selection, {
      projectId: "project-1",
      projectDirectory: "C:/Projects/One",
      headRevisionId: "revision-2",
    }, new Set([entry.id]), importer);
    expect(importer).not.toHaveBeenCalled();
    expect(repeated).toMatchObject({ selection, receipts: [], headRevisionId: "revision-2" });
  });
});
