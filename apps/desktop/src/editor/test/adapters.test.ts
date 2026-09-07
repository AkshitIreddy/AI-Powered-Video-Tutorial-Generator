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
    expect(project.tracks.find((track) => track.kind === "captions")?.clips).toHaveLength(0);
    expect(project.tracks.find((track) => track.kind === "narration")?.clips[0]?.text).toBe("Begin with a question.");
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

  it("uses verified scene-local caption cues instead of a whole-scene narration overlay", () => {
    const project = createEditorProjectFromAlystriaProject({
      id: "caption-project",
      title: "Timed captions",
      duration: 0.2,
      scenes: [{ id: "scene-1", title: "Rendered title", kind: "title", duration: 12, narration: "This complete narration must not become one caption." }],
    }, {
      now: "2026-09-05T12:00:00Z",
      frameRate: { numerator: 30, denominator: 1 },
      mediaBindings: {
        renders: [{ sceneId: "scene-1", artifactHash: "d".repeat(64), mediaType: "video/webm", durationTicks: 2_880_000, sourceStartTicks: 4_800_000, captionsBurnedIntoPixels: false }],
        captions: [
          { sceneId: "scene-1", id: "cue-1", startTicks: 120_000, endTicks: 360_000, text: "This complete narration" },
          { sceneId: "scene-1", id: "cue-2", startTicks: 480_000, endTicks: 720_000, text: "must not become one caption." },
        ],
        assets: [], narration: [], presenters: [],
      },
    });

    expect(project.tracks.find((track) => track.kind === "titles")?.clips).toHaveLength(0);
    expect(project.tracks.find((track) => track.kind === "captions")?.clips).toEqual([
      expect.objectContaining({
        id: "caption-cue-scene-1-cue-1",
        text: "This complete narration",
        enabled: true,
        timelineRange: { startFrame: 15, durationFrames: 30 },
        metadata: expect.objectContaining({ alystriaSceneLocalStartTicks: 120_000, alystriaSceneLocalEndTicks: 360_000, captionsBurnedIntoPixels: false }),
      }),
      expect.objectContaining({
        id: "caption-cue-scene-1-cue-2",
        text: "must not become one caption.",
        enabled: true,
        timelineRange: { startFrame: 60, durationFrames: 30 },
      }),
    ]);
  });

  it("suppresses verified burned-in captions and keeps unknown historic delivery cues disabled for review", () => {
    const record = {
      id: "caption-policy-project",
      title: "Caption policy",
      duration: 0.1,
      scenes: [{ id: "scene-1", title: "Rendered title", kind: "title", duration: 6, narration: "A timed line." }],
    } as const;
    const media = (captionsBurnedIntoPixels: boolean | null) => ({
      renders: [{ sceneId: "scene-1", artifactHash: "d".repeat(64), mediaType: "video/webm", durationTicks: 1_440_000, sourceStartTicks: 0, captionsBurnedIntoPixels }],
      captions: [{ sceneId: "scene-1", id: "cue-1", startTicks: 0, endTicks: 240_000, text: "A timed line." }],
      assets: [], narration: [], presenters: [],
    });

    const burned = createEditorProjectFromAlystriaProject(record, { now: "2026-09-05T12:00:00Z", mediaBindings: media(true) });
    expect(burned.tracks.find((track) => track.kind === "captions")?.clips).toHaveLength(0);
    expect(burned.tracks.find((track) => track.kind === "titles")?.clips).toHaveLength(0);

    const unknown = createEditorProjectFromAlystriaProject(record, { now: "2026-09-05T12:00:00Z", mediaBindings: media(null) });
    expect(unknown.tracks.find((track) => track.kind === "captions")?.clips[0]).toMatchObject({
      enabled: false,
      text: "A timed line.",
      metadata: { captionReviewRequired: true, captionsBurnedIntoPixels: null },
    });

    const verifiedNotBurned = mergeAlystriaMediaBindings(unknown, media(false), "2026-09-05T12:01:00Z");
    expect(verifiedNotBurned.tracks.find((track) => track.kind === "captions")?.clips).toEqual([
      expect.objectContaining({
        id: "caption-cue-scene-1-cue-1",
        enabled: true,
        metadata: expect.objectContaining({ captionReviewRequired: false, captionsBurnedIntoPixels: false }),
      }),
    ]);
  });

  it("migrates only provably untouched legacy overlays when a composite binding arrives", () => {
    const saved = createEditorProjectFromAlystriaProject({
      id: "legacy-caption-project",
      title: "Legacy captions",
      duration: 0.1,
      scenes: [{ id: "scene-1", title: "Legacy title", kind: "title", duration: 6, narration: "First cue. Second cue." }],
    }, { now: "2026-09-05T10:00:00Z", frameRate: { numerator: 30, denominator: 1 } });
    const slide = saved.tracks.find((track) => track.kind === "slides")!.clips[0]!;
    saved.tracks.find((track) => track.kind === "captions")!.clips.push({
      ...structuredClone(saved.tracks.find((track) => track.kind === "titles")!.clips[0]!),
      id: "caption-scene-1",
      trackId: "track-captions",
      kind: "captions",
      name: "Legacy title caption",
      text: "First cue. Second cue.",
      timelineRange: { ...slide.timelineRange },
      sourceRange: { ...slide.sourceRange },
      metadata: { ...slide.metadata },
    });
    const bindings = {
      renders: [{ sceneId: "scene-1", artifactHash: "d".repeat(64), mediaType: "video/webm", durationTicks: 1_440_000, sourceStartTicks: 0, captionsBurnedIntoPixels: true }],
      captions: [
        { sceneId: "scene-1", id: "cue-1", startTicks: 0, endTicks: 120_000, text: "First cue." },
        { sceneId: "scene-1", id: "cue-2", startTicks: 120_000, endTicks: 240_000, text: "Second cue." },
      ],
      assets: [], narration: [], presenters: [],
    } as const;

    const migrated = mergeAlystriaMediaBindings(saved, bindings, "2026-09-05T12:00:00Z");
    expect(migrated.tracks.find((track) => track.kind === "captions")?.clips).toHaveLength(0);
    expect(migrated.tracks.find((track) => track.kind === "titles")?.clips).toHaveLength(0);

    const edited = structuredClone(saved);
    edited.tracks.find((track) => track.kind === "captions")!.clips[0]!.text = "My corrected caption.";
    edited.tracks.find((track) => track.kind === "titles")!.clips[0]!.text = "My corrected title";
    const preserved = mergeAlystriaMediaBindings(edited, bindings, "2026-09-05T12:00:00Z");
    expect(preserved.tracks.find((track) => track.kind === "captions")?.clips[0]?.text).toBe("My corrected caption.");
    expect(preserved.tracks.find((track) => track.kind === "titles")?.clips[0]?.text).toBe("My corrected title");
  });

  it("initializes contiguous master scenes from measured windows rather than planned durations", () => {
    const document = createEditorProjectFromAlystriaProject({
      id: "measured-project", title: "Measured timing", duration: 0.5,
      scenes: [
        { id: "scene-1", index: 1, title: "Short opening", duration: 15, narration: "Opening." },
        { id: "scene-2", index: 2, title: "Long explanation", duration: 15, narration: "Explanation." },
      ],
    }, { now: "2026-09-07T08:00:00Z", mediaBindings: {
      renders: [
        { sceneId: "scene-1", artifactHash: "a".repeat(64), mediaType: "video/mp4", durationTicks: 1_200_000, sourceStartTicks: 0 },
        { sceneId: "scene-2", artifactHash: "a".repeat(64), mediaType: "video/mp4", durationTicks: 6_000_000, sourceStartTicks: 1_200_000 },
      ], assets: [], narration: [], presenters: [],
    } });
    const clips = document.tracks.find((track) => track.kind === "slides")!.clips;
    expect(clips.map((clip) => clip.timelineRange)).toEqual([
      { startFrame: 0, durationFrames: 150 }, { startFrame: 150, durationFrames: 750 },
    ]);
    expect(clips.map((clip) => clip.sourceRange)).toEqual(clips.map((clip) => clip.timelineRange));
    expect(document.durationFrames).toBe(900);
  });

  it("preserves trimmed composite offsets across reopen and master promotion", () => {
    const bindings = {
      renders: [{ sceneId: "scene-1", artifactHash: "a".repeat(64), mediaType: "video/mp4", durationTicks: 2_880_000, sourceStartTicks: 480_000, captionsBurnedIntoPixels: true }],
      assets: [], narration: [], presenters: [],
    };
    const saved = createEditorProjectFromAlystriaProject({
      id: "record-project", title: "Trimmed master", duration: 0.2,
      scenes: [{ id: "scene-1", index: 1, title: "Scene", duration: 12, narration: "Narration." }],
    }, { now: "2026-09-07T08:00:00Z", mediaBindings: bindings });
    const clip = saved.tracks.find((track) => track.kind === "slides")!.clips[0]!;
    clip.sourceRange = { startFrame: 90, durationFrames: 90 };
    clip.timelineRange = { startFrame: 45, durationFrames: 90 };
    clip.transform.x = 84;
    saved.assets[0]!.uri = "asset://old-master";
    saved.assets[0]!.previewUrl = "asset://old-master";
    saved.assets[0]!.thumbnailUrl = "asset://old-thumbnail";
    const reopened = mergeAlystriaMediaBindings(saved, bindings, "2026-09-07T08:01:00Z");
    expect(reopened.tracks.find((track) => track.kind === "slides")!.clips[0]).toMatchObject({
      sourceRange: { startFrame: 90, durationFrames: 90 }, timelineRange: { startFrame: 45, durationFrames: 90 }, transform: { x: 84 },
    });
    expect(reopened.assets[0]!.uri).toBe("asset://old-master");
    const promoted = mergeAlystriaMediaBindings(reopened, {
      ...bindings, renders: [{ ...bindings.renders[0]!, artifactHash: "b".repeat(64), sourceStartTicks: 960_000 }],
    }, "2026-09-07T08:02:00Z");
    expect(promoted.tracks.find((track) => track.kind === "slides")!.clips[0]).toMatchObject({
      sourceRange: { startFrame: 150, durationFrames: 90 }, timelineRange: { startFrame: 45, durationFrames: 90 }, transform: { x: 84 },
    });
    expect(promoted.assets[0]!.hash).toBe("b".repeat(64));
    expect(promoted.assets[0]!.uri).toBeUndefined();
    expect(promoted.assets[0]!.previewUrl).toBeUndefined();
    expect(promoted.assets[0]!.thumbnailUrl).toBeUndefined();
    delete saved.assets[0]!.metadata.generatedSourceStartFrame;
    const legacy = mergeAlystriaMediaBindings(saved, bindings, "2026-09-07T08:03:00Z");
    expect(legacy.tracks.find((track) => track.kind === "slides")!.clips[0]!.sourceRange.startFrame).toBe(90);
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
      renders: [{ sceneId: "scene-1", artifactHash: "d".repeat(64), mediaType: "video/webm", durationTicks: 2_880_000, sourceStartTicks: 4_800_000, captionsBurnedIntoPixels: false }],
      captions: [
        { sceneId: "scene-1", id: "cue-1", startTicks: 0, endTicks: 480_000, text: "First timed cue." },
        { sceneId: "scene-1", id: "cue-2", startTicks: 480_000, endTicks: 960_000, text: "Second timed cue." },
      ],
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
    expect(merged.tracks.find((track) => track.kind === "captions")!.clips).toEqual([
      expect.objectContaining({ text: "First timed cue.", timelineRange: { startFrame: 45, durationFrames: 30 } }),
      expect.objectContaining({ text: "Second timed cue.", timelineRange: { startFrame: 75, durationFrames: 60 } }),
    ]);
  });
});
