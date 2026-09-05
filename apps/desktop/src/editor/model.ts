import { EDITOR_PROJECT_SCHEMA, EDITOR_STATE_SCHEMA, type EditProposal, type EditorClip, type EditorProject, type EditorState, type EditorTrack, type FrameRate, type TrackKind } from "./types";

export const trackKinds: readonly TrackKind[] = ["slides", "presenter", "titles", "captions", "narration", "music", "sfx"];

const trackNames: Record<TrackKind, string> = {
  slides: "Slides",
  presenter: "Presenter",
  titles: "Titles",
  captions: "Captions",
  narration: "Narration",
  music: "Music",
  sfx: "Sound effects",
};

export function createTrack(kind: TrackKind, index = trackKinds.indexOf(kind)): EditorTrack {
  return {
    id: `track-${kind}`,
    name: trackNames[kind],
    kind,
    index,
    locked: false,
    muted: false,
    solo: false,
    hidden: false,
    clips: [],
  };
}

export function createEmptyEditorProject({
  id,
  name,
  now,
  frameRate = { numerator: 30, denominator: 1 },
  width = 1920,
  height = 1080,
}: {
  id: string;
  name: string;
  now: string;
  frameRate?: FrameRate;
  width?: number;
  height?: number;
}): EditorProject {
  return {
    schema: EDITOR_PROJECT_SCHEMA,
    id,
    name,
    frameRate,
    canvas: { width, height, pixelAspectRatio: 1, backgroundColor: "#101116" },
    durationFrames: 0,
    tracks: trackKinds.map((kind, index) => createTrack(kind, index)),
    assets: [],
    importReceipts: [],
    markers: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultClipValues(): Pick<EditorClip, "enabled" | "locked" | "transform" | "opacity" | "playbackRate" | "audio" | "keyframes" | "metadata"> {
  return {
    enabled: true,
    locked: false,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 },
    opacity: 1,
    playbackRate: 1,
    audio: { volumeDb: 0, pan: 0, muted: false, fadeInFrames: 0, fadeOutFrames: 0 },
    keyframes: [],
    metadata: {},
  };
}

export function calculateProjectDuration(project: Pick<EditorProject, "tracks">): number {
  return project.tracks.reduce((maximum, track) => track.clips.reduce(
    (trackMaximum, clip) => Math.max(trackMaximum, clip.timelineRange.startFrame + clip.timelineRange.durationFrames),
    maximum,
  ), 0);
}

export function sortClips(clips: readonly EditorClip[]): EditorClip[] {
  return [...clips].sort((left, right) => left.timelineRange.startFrame - right.timelineRange.startFrame || left.id.localeCompare(right.id));
}

export function normalizeEditorProject(project: EditorProject): EditorProject {
  const existingKinds = new Set(project.tracks.map((track) => track.kind));
  const tracks = [
    ...project.tracks.map((track, index) => ({
      ...track,
      index,
      clips: sortClips(track.clips.map((clip) => ({
        ...clip,
        trackId: track.id,
        kind: track.kind,
        timelineRange: {
          startFrame: Math.max(0, Math.floor(clip.timelineRange.startFrame)),
          durationFrames: Math.max(1, Math.floor(clip.timelineRange.durationFrames)),
        },
        sourceRange: {
          startFrame: Math.max(0, Math.floor(clip.sourceRange.startFrame)),
          durationFrames: Math.max(1, Math.floor(clip.sourceRange.durationFrames)),
        },
        opacity: Math.min(1, Math.max(0, clip.opacity)),
        playbackRate: clip.playbackRate ?? 1,
      }))),
    })),
    ...trackKinds.filter((kind) => !existingKinds.has(kind)).map((kind) => createTrack(kind, project.tracks.length + trackKinds.indexOf(kind))),
  ];
  const normalized = { ...project, schema: EDITOR_PROJECT_SCHEMA, tracks };
  return { ...normalized, durationFrames: calculateProjectDuration(normalized) };
}

export function createEditorState(project: EditorProject, proposals: readonly EditProposal[] = []): EditorState {
  const normalized = normalizeEditorProject(structuredClone(project));
  return {
    schema: EDITOR_STATE_SCHEMA,
    project: normalized,
    selection: { clipIds: [], trackId: normalized.tracks[0]?.id ?? null, assetId: null },
    transport: { status: "stopped", playheadFrame: 0, inFrame: null, outFrame: null, playbackRate: 1, loop: false },
    view: {
      pixelsPerSecond: 72,
      horizontalScrollFrame: 0,
      activePanel: "media",
      inspectorOpen: true,
      guides: ["safe-action", "safe-title", "center"],
      snappingEnabled: true,
      snapThresholdFrames: 5,
      rippleEnabled: false,
    },
    proposals: structuredClone([...proposals]),
    activeProposalId: null,
    versions: [],
    versionIndex: -1,
    revision: 0,
    lastCreatedCopy: null,
    announcement: "Editor ready.",
  };
}

export function findClip(project: EditorProject, clipId: string): { track: EditorTrack; clip: EditorClip; trackIndex: number; clipIndex: number } | null {
  for (let trackIndex = 0; trackIndex < project.tracks.length; trackIndex += 1) {
    const track = project.tracks[trackIndex];
    if (!track) continue;
    const clipIndex = track.clips.findIndex((clip) => clip.id === clipId);
    const clip = track.clips[clipIndex];
    if (clipIndex >= 0 && clip) return { track, clip, trackIndex, clipIndex };
  }
  return null;
}

export function selectedClips(state: Pick<EditorState, "project" | "selection">): EditorClip[] {
  return state.selection.clipIds.flatMap((clipId) => {
    const match = findClip(state.project, clipId);
    return match ? [match.clip] : [];
  });
}

export function cloneProject(project: EditorProject): EditorProject {
  return structuredClone(project);
}
