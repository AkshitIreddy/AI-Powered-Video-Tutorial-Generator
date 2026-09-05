import { describe, expect, it } from "vitest";
import { EditorProjectFormatError, createEditorProjectFromAlystriaProject, exportOtioLike, formatTimecode, importOtioLike, mergeAlystriaMediaBindings, parseEditorProject, parseTimecode, serializeEditorProject, type OtioLikeTimeline } from "..";
import { makeSampleProject } from "./fixtures";

describe("editor project adapters", () => {
  it("round-trips the serializable project format", () => {
    const project = makeSampleProject();
    expect(parseEditorProject(serializeEditorProject(project))).toEqual(project);
  });

  it("round-trips Alystria metadata through an OTIO-like timeline", () => {
    const project = makeSampleProject();
    const otio = exportOtioLike(project);
    expect(otio.OTIO_SCHEMA).toBe("Timeline.1");
    expect(otio.tracks.children).toHaveLength(7);
    expect(importOtioLike(otio)).toEqual(project);
  });

  it("rejects malformed or duplicate project identities", () => {
    const project = makeSampleProject();
    project.tracks[1]!.id = project.tracks[0]!.id;
    expect(() => serializeEditorProject(project)).toThrow(EditorProjectFormatError);
    expect(() => parseEditorProject("not json")).toThrow(/could not be parsed/i);
  });

  it("rejects clips that do not match their track or refer to missing media", () => {
    const wrongTrack = makeSampleProject();
    wrongTrack.tracks[0]!.clips[0]!.kind = "captions";
    expect(() => serializeEditorProject(wrongTrack)).toThrow(/does not match its containing track/i);

    const missingMedia = makeSampleProject();
    missingMedia.tracks[0]!.clips[0]!.assetId = "missing";
    expect(() => serializeEditorProject(missingMedia)).toThrow(/refers to missing asset/i);
  });

  it("keeps generic OTIO external references as offline assets that can be relinked", () => {
    const time = (value: number) => ({ value, rate: 30 });
    const timeline: OtioLikeTimeline = {
      OTIO_SCHEMA: "Timeline.1",
      name: "Interchange edit",
      global_start_time: time(0),
      metadata: {},
      tracks: {
        OTIO_SCHEMA: "Stack.1",
        name: "Tracks",
        metadata: {},
        children: [{
          OTIO_SCHEMA: "Track.1",
          name: "Video 1",
          kind: "Video",
          metadata: {},
          children: [{
            OTIO_SCHEMA: "Clip.2",
            name: "Diagram",
            metadata: {},
            source_range: { start_time: time(12), duration: time(60) },
            media_reference: {
              OTIO_SCHEMA: "ExternalReference.1",
              target_url: "file:///D:/lesson/diagram.png",
              available_range: { start_time: time(0), duration: time(90) },
              metadata: {},
            },
          }],
        }],
      },
    };
    const imported = importOtioLike(timeline);
    expect(imported.assets[0]).toMatchObject({ kind: "image", status: "pending", uri: "file:///D:/lesson/diagram.png" });
    expect(imported.tracks[0]!.clips[0]).toMatchObject({ assetId: imported.assets[0]!.id, sourceRange: { startFrame: 12, durationFrames: 60 } });
  });
});

describe("timecode", () => {
  it("formats and parses frame-accurate timecode", () => {
    const rate = { numerator: 30, denominator: 1 };
    expect(formatTimecode(3723, rate)).toBe("00:02:04:03");
    expect(parseTimecode("00:02:04:03", rate)).toBe(3723);
    expect(parseTimecode("00:00:00:30", rate)).toBeNull();
  });
});

describe("Alystria ProjectRecord adapter", () => {
  it("maps authored scenes and asset references without claiming playable media exists", () => {
    const project = createEditorProjectFromAlystriaProject({
      id: "aly-project",
      title: "Authored tutorial",
      duration: 1,
      privacy: "Local only",
      scenes: [
        { id: "hook", index: 1, title: "Opening question", kind: "title", duration: 12, narration: "Begin with a question.", locked: true },
        { id: "answer", index: 2, title: "Explanation", kind: "diagram", duration: 18, narration: "Now explain the mechanism." },
      ],
      customization: {
        presenter: { assetId: "presenter-ref", placement: "picture-in-picture" },
        audio: { musicAssetId: "music-ref", musicLevel: -14 },
        assets: [
          { id: "presenter-ref", kind: "presenter", label: "Selected presenter", source: "user-upload", rightsStatus: "cleared" },
          { id: "music-ref", kind: "music", label: "Selected music", source: "starter-pack", rightsStatus: "cleared" },
        ],
      },
    }, { now: "2026-09-02T13:00:00Z", frameRate: { numerator: 30, denominator: 1 } });

    expect(project.tracks.find((track) => track.kind === "slides")?.clips).toHaveLength(2);
    expect(project.tracks.find((track) => track.kind === "captions")?.clips[0]?.text).toBe("Begin with a question.");
    expect(project.tracks.find((track) => track.kind === "presenter")?.clips[0]?.assetId).toBe("presenter-ref");
    expect(project.assets.map((asset) => asset.status)).toEqual(["pending", "pending"]);
    expect(project.assets.every((asset) => asset.uri === undefined)).toBe(true);
    expect(project.metadata.adapterNotice).toMatch(/playable media uris must be resolved/i);
  });

  it("preserves reviewed generated-asset rights and local-generation provenance", () => {
    const project = createEditorProjectFromAlystriaProject({
      id: "generated-rights-project",
      title: "Generated rights",
      duration: 1,
      scenes: [{ id: "scene-1", title: "Opening", duration: 6, narration: "Opening narration." }],
      customization: {
        assets: [{
          id: "reviewed-generated-background",
          kind: "background",
          label: "Reviewed generated background",
          source: "generated",
          sha256: "e".repeat(64),
          mediaType: "image/png",
          creator: "Alystria local generator",
          license: "Project use and export allowed",
          attribution: "Generated and visually reviewed",
          rightsStatus: "cleared",
        }],
      },
    }, { now: "2026-09-05T12:00:00Z" });

    expect(project.assets[0]).toMatchObject({
      status: "pending",
      hash: "e".repeat(64),
      provenance: { origin: "local-generation", humanApproved: true },
      metadata: {
        alystriaAssetSource: "generated",
        rightsStatus: "cleared",
        license: "Project use and export allowed",
        exportEligible: true,
        playableUriRequired: true,
      },
    });
  });

  it("binds generated scene artifacts to renderable clips without duplicating a configured presenter", () => {
    const project = createEditorProjectFromAlystriaProject({
      id: "record-project",
      nativeProjectId: "native-project",
      title: "Rendered tutorial",
      duration: 0.2,
      scenes: [{ id: "scene-1", index: 1, title: "Bound scene", duration: 12, narration: "Bound narration." }],
      customization: {
        presenter: { assetId: "configured-presenter" },
        assets: [{ id: "configured-presenter", kind: "presenter", label: "Configured presenter", rightsStatus: "cleared" }],
      },
    }, {
      now: "2026-09-05T12:00:00Z",
      frameRate: { numerator: 30, denominator: 1 },
      mediaBindings: {
        assets: [{ sceneId: "scene-1", artifactHash: "a".repeat(64), mediaType: "video/webm", durationMs: 12_000, exportEligible: true }],
        narration: [{ sceneId: "scene-1", artifactHash: "b".repeat(64), mediaType: "audio/wav", durationTicks: 2_400_000, exportEligible: true }],
        presenters: [{ sceneId: "scene-1", artifactHash: "c".repeat(64), mediaType: "video/webm", durationTicks: 2_880_000, exportEligible: true }],
      },
    });

    expect(project.id).toBe("native-project");
    expect(project.assets.filter((asset) => asset.status === "ready")).toHaveLength(3);
    expect(project.tracks.find((track) => track.kind === "slides")?.clips[0]).toMatchObject({ assetId: "generated-visual-scene-1" });
    expect(project.tracks.find((track) => track.kind === "narration")?.clips[0]).toMatchObject({ assetId: "generated-narration-scene-1", timelineRange: { durationFrames: 300 } });
    expect(project.tracks.find((track) => track.kind === "presenter")?.clips).toEqual([
      expect.objectContaining({ assetId: "generated-presenter-scene-1", timelineRange: expect.objectContaining({ durationFrames: 360 }) }),
    ]);
  });

  it("prefers a verified composite render with its source interval and avoids duplicate programme media", () => {
    const project = createEditorProjectFromAlystriaProject({
      id: "record-project",
      nativeProjectId: "native-project",
      title: "Rendered tutorial",
      duration: 0.2,
      scenes: [{ id: "scene-1", index: 1, title: "Rendered scene", duration: 12, narration: "Already mixed narration." }],
    }, {
      now: "2026-09-05T12:00:00Z",
      frameRate: { numerator: 30, denominator: 1 },
      mediaBindings: {
        renders: [{ sceneId: "scene-1", artifactHash: "d".repeat(64), mediaType: "video/webm", durationTicks: 2_880_000, sourceStartTicks: 4_800_000 }],
        assets: [{ sceneId: "scene-1", artifactHash: "a".repeat(64), mediaType: "image/png" }],
        narration: [{ sceneId: "scene-1", artifactHash: "b".repeat(64), mediaType: "audio/wav", durationMs: 12_000 }],
        presenters: [{ sceneId: "scene-1", artifactHash: "c".repeat(64), mediaType: "video/webm", activeDurationTicks: 2_880_000 }],
      },
    });

    expect(project.tracks.find((track) => track.kind === "slides")?.clips[0]).toMatchObject({
      assetId: "generated-render-scene-1",
      sourceRange: { startFrame: 600, durationFrames: 360 },
      metadata: { includeSourceAudio: true, preservedCompositeRender: true },
    });
    expect(project.tracks.find((track) => track.kind === "narration")?.clips).toHaveLength(0);
    expect(project.tracks.find((track) => track.kind === "presenter")?.clips).toHaveLength(0);
  });

  it("attaches late render bindings to placeholders without rebuilding saved user edits", () => {
    const saved = createEditorProjectFromAlystriaProject({
      id: "record-project",
      nativeProjectId: "native-project",
      title: "Saved edit",
      duration: 0.2,
      scenes: [{ id: "scene-1", index: 1, title: "Scene", duration: 12, narration: "Narration." }],
      customization: {
        audio: { musicAssetId: "pending-music" },
        assets: [{ id: "pending-music", kind: "music", label: "Pending music", rightsStatus: "cleared" }],
      },
    }, { now: "2026-09-05T10:00:00Z", frameRate: { numerator: 30, denominator: 1 } });
    const slide = saved.tracks.find((track) => track.kind === "slides")!.clips[0]!;
    slide.timelineRange.startFrame = 45;
    slide.sourceRange = { startFrame: 30, durationFrames: 300 };
    slide.transform.x = 84;

    const merged = mergeAlystriaMediaBindings(saved, {
      renders: [{ sceneId: "scene-1", artifactHash: "d".repeat(64), mediaType: "video/webm", durationTicks: 2_880_000, sourceStartTicks: 4_800_000 }],
      assets: [], narration: [], presenters: [],
    }, "2026-09-05T12:00:00Z");
    const mergedSlide = merged.tracks.find((track) => track.kind === "slides")!.clips[0]!;

    expect(mergedSlide).toMatchObject({
      timelineRange: { startFrame: 45, durationFrames: 360 },
      sourceRange: { startFrame: 630, durationFrames: 300 },
      transform: { x: 84 },
      assetId: "generated-render-scene-1",
      metadata: { includeSourceAudio: true },
    });
    expect(merged.tracks.find((track) => track.kind === "narration")!.clips[0]).toMatchObject({ enabled: false, metadata: { representedByCompositeRender: true } });
    expect(merged.tracks.find((track) => track.kind === "music")!.clips[0]).toMatchObject({ enabled: false, metadata: { representedByCompositeRender: true } });
  });
});
