import { createEmptyEditorProject, defaultClipValues } from "..";
import type { EditProposal, EditorClip, EditorMediaAsset, EditorProject, TrackKind } from "..";

const now = "2026-09-02T10:00:00.000Z";

function clip(id: string, trackId: string, kind: TrackKind, startFrame: number, durationFrames: number, options: Partial<EditorClip> = {}): EditorClip {
  return {
    id,
    trackId,
    kind,
    name: options.name ?? id,
    assetId: options.assetId ?? null,
    timelineRange: { startFrame, durationFrames },
    sourceRange: { startFrame: 0, durationFrames },
    ...defaultClipValues(),
    ...options,
  };
}

function asset(id: string, name: string, kind: EditorMediaAsset["kind"], durationFrames: number): EditorMediaAsset {
  return {
    id,
    name,
    kind,
    status: "ready",
    durationFrames,
    uri: `file:///E:/local-sample/${id}`,
    provenance: { origin: "user-import", createdAt: now, humanApproved: true },
    metadata: { fixture: true },
  };
}

export function makeSampleProject(): EditorProject {
  const project = createEmptyEditorProject({ id: "sample-project", name: "Explicit local sample", now, frameRate: { numerator: 30, denominator: 1 } });
  project.assets = [
    asset("asset-slide-a", "Slide A", "image", 90),
    asset("asset-slide-b", "Slide B", "image", 90),
    asset("asset-presenter", "Presenter recording", "video", 180),
    asset("asset-narration", "Narration recording", "audio", 180),
    asset("asset-music", "Music bed", "audio", 180),
    asset("asset-sfx", "Transition sound", "audio", 20),
  ];
  const byKind = (kind: TrackKind) => project.tracks.find((track) => track.kind === kind)!;
  byKind("slides").clips = [
    clip("slide-a", byKind("slides").id, "slides", 0, 90, { name: "Opening slide", assetId: "asset-slide-a" }),
    clip("slide-b", byKind("slides").id, "slides", 90, 90, { name: "Explanation slide", assetId: "asset-slide-b" }),
  ];
  byKind("presenter").clips = [clip("presenter-a", byKind("presenter").id, "presenter", 0, 180, { name: "Presenter", assetId: "asset-presenter" })];
  byKind("titles").clips = [clip("title-a", byKind("titles").id, "titles", 0, 45, { name: "Opening question", text: "Why does this work?" })];
  byKind("captions").clips = [
    clip("caption-a", byKind("captions").id, "captions", 0, 60, { name: "Caption one", text: "Start with the question.", speaker: "Narrator" }),
    clip("caption-b", byKind("captions").id, "captions", 60, 60, { name: "Caption two", text: "Then reveal the mechanism.", speaker: "Narrator" }),
  ];
  byKind("narration").clips = [clip("narration-a", byKind("narration").id, "narration", 0, 180, { name: "Narration", assetId: "asset-narration", text: "Start with the question. Then reveal the mechanism." })];
  byKind("music").clips = [clip("music-a", byKind("music").id, "music", 0, 180, { name: "Music", assetId: "asset-music" })];
  byKind("sfx").clips = [clip("sfx-a", byKind("sfx").id, "sfx", 80, 20, { name: "Transition", assetId: "asset-sfx" })];
  project.durationFrames = 180;
  return project;
}

export function makeProposal(): EditProposal {
  return {
    id: "proposal-tighten-title",
    title: "Tighten the opening title",
    summary: "Shorten the title and move the second slide to the beat.",
    operations: [
      { type: "update-clip", clipId: "title-a", patch: { text: "What changes?" } },
      { type: "move-clip", clipId: "slide-b", trackId: "track-slides", startFrame: 88, snap: false },
    ],
    provenance: { source: "ai", providerId: "local-test-provider", modelId: "test-editor-model", modelRevision: "sha256:test", requestId: "request-1", generatedAt: now, promptSummary: "Tighten pacing" },
    policyImpact: { usesCloudData: false, sendsSourceMedia: false, createsGeneratedMedia: false, changesAttribution: false, warnings: ["Review title timing against narration."] },
    status: "pending",
    createdFromProjectRevision: 0,
  };
}
