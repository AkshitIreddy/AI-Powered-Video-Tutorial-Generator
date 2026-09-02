import { createEmptyEditorProject, defaultClipValues, normalizeEditorProject, sortClips } from "./model";
import { rateAsNumber } from "./timecode";
import { EDITOR_PROJECT_SCHEMA, type EditorClip, type EditorMediaAsset, type EditorProject, type EditorTrack, type OtioLikeClip, type OtioLikeRationalTime, type OtioLikeTimeRange, type OtioLikeTimeline, type TrackKind } from "./types";

export class EditorProjectFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditorProjectFormatError";
  }
}

function rational(value: number, rate: number): OtioLikeRationalTime {
  return { value, rate };
}

function timeRange(startFrame: number, durationFrames: number, rate: number): OtioLikeTimeRange {
  return { start_time: rational(startFrame, rate), duration: rational(durationFrames, rate) };
}

function trackOtioKind(kind: TrackKind): "Video" | "Audio" {
  return kind === "narration" || kind === "music" || kind === "sfx" ? "Audio" : "Video";
}

function assetForClip(project: EditorProject, clip: EditorClip): EditorMediaAsset | undefined {
  return clip.assetId ? project.assets.find((asset) => asset.id === clip.assetId) : undefined;
}

function exportClip(project: EditorProject, clip: EditorClip, rate: number): OtioLikeClip {
  const asset = assetForClip(project, clip);
  const mediaReference: OtioLikeClip["media_reference"] = asset?.uri
    ? {
        OTIO_SCHEMA: "ExternalReference.1",
        target_url: asset.uri,
        ...(asset.durationFrames ? { available_range: timeRange(0, asset.durationFrames, rate) } : {}),
        metadata: { alystria_asset_id: asset.id, alystria_asset: structuredClone(asset) },
      }
    : {
        OTIO_SCHEMA: "MissingReference.1",
        metadata: {
          alystria_asset_id: clip.assetId,
          reason: clip.assetId ? "Asset has no exportable URI." : "Clip is generated from text or project data.",
        },
      };
  return {
    OTIO_SCHEMA: "Clip.2",
    name: clip.name,
    metadata: {
      alystria_clip: structuredClone(clip),
      alystria_timeline_start_frame: clip.timelineRange.startFrame,
      alystria_track_kind: clip.kind,
    },
    source_range: timeRange(clip.sourceRange.startFrame, clip.timelineRange.durationFrames, rate),
    media_reference: mediaReference,
  };
}

export function exportOtioLike(projectInput: EditorProject): OtioLikeTimeline {
  const project = assertValidEditorProject(projectInput);
  const rate = rateAsNumber(project.frameRate);
  return {
    OTIO_SCHEMA: "Timeline.1",
    name: project.name,
    global_start_time: rational(0, rate),
    metadata: {
      alystria_schema: EDITOR_PROJECT_SCHEMA,
      alystria_project: structuredClone(project),
      canvas: structuredClone(project.canvas),
      frame_rate: structuredClone(project.frameRate),
    },
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: `${project.name} tracks`,
      metadata: {},
      children: project.tracks.map((track) => {
        let cursor = 0;
        const children: OtioLikeTimeline["tracks"]["children"][number]["children"] = [];
        for (const clip of sortClips(track.clips)) {
          if (clip.timelineRange.startFrame > cursor) {
            children.push({ OTIO_SCHEMA: "Gap.1", source_range: timeRange(0, clip.timelineRange.startFrame - cursor, rate), metadata: {} });
          }
          children.push(exportClip(project, clip, rate));
          cursor = Math.max(cursor, clip.timelineRange.startFrame + clip.timelineRange.durationFrames);
        }
        return {
          OTIO_SCHEMA: "Track.1",
          name: track.name,
          kind: trackOtioKind(track.kind),
          metadata: { alystria_track: structuredClone({ ...track, clips: [] }) },
          children,
        };
      }),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function inferTrackKind(track: OtioLikeTimeline["tracks"]["children"][number], index: number): TrackKind {
  const embedded = isRecord(track.metadata.alystria_track) ? track.metadata.alystria_track.kind : undefined;
  const allowed: TrackKind[] = ["slides", "presenter", "titles", "captions", "narration", "music", "sfx"];
  if (typeof embedded === "string" && allowed.includes(embedded as TrackKind)) return embedded as TrackKind;
  if (track.kind === "Audio") return index === 0 ? "narration" : index === 1 ? "music" : "sfx";
  return index === 0 ? "slides" : index === 1 ? "presenter" : index === 2 ? "titles" : "captions";
}

function frameFromRational(value: OtioLikeRationalTime, projectRate: number): number {
  return Math.round(value.value * projectRate / value.rate);
}

function importGenericOtio(timeline: OtioLikeTimeline): EditorProject {
  const globalRate = timeline.global_start_time.rate > 0 ? timeline.global_start_time.rate : 30;
  const now = typeof timeline.metadata.createdAt === "string" ? timeline.metadata.createdAt : "1970-01-01T00:00:00.000Z";
  const project = createEmptyEditorProject({
    id: typeof timeline.metadata.projectId === "string" ? timeline.metadata.projectId : "imported-otio-project",
    name: timeline.name || "Imported timeline",
    now,
    frameRate: { numerator: Math.round(globalRate * 1000), denominator: 1000 },
  });
  const assets = new Map<string, EditorMediaAsset>();
  const tracks: EditorTrack[] = timeline.tracks.children.map((otioTrack, trackIndex) => {
    const kind = inferTrackKind(otioTrack, trackIndex);
    const embeddedTrack = isRecord(otioTrack.metadata.alystria_track) ? otioTrack.metadata.alystria_track : {};
    let cursor = 0;
    const clips: EditorClip[] = [];
    for (const child of otioTrack.children) {
      const duration = frameFromRational(child.source_range.duration, globalRate);
      if (child.OTIO_SCHEMA === "Gap.1") {
        cursor += duration;
        continue;
      }
      const embeddedClip = isRecord(child.metadata.alystria_clip) ? child.metadata.alystria_clip as unknown as EditorClip : null;
      const importedAsset = isRecord(child.media_reference.metadata.alystria_asset)
        ? child.media_reference.metadata.alystria_asset as unknown as EditorMediaAsset
        : null;
      if (importedAsset?.id) assets.set(importedAsset.id, importedAsset);
      const assetId = typeof child.media_reference.metadata.alystria_asset_id === "string" ? child.media_reference.metadata.alystria_asset_id : importedAsset?.id ?? null;
      const timelineStart = asFiniteNumber(child.metadata.alystria_timeline_start_frame, cursor);
      const clip: EditorClip = embeddedClip ? structuredClone(embeddedClip) : {
        id: `otio-clip-${trackIndex}-${clips.length}`,
        trackId: typeof embeddedTrack.id === "string" ? embeddedTrack.id : `otio-track-${trackIndex}`,
        name: child.name || `Clip ${clips.length + 1}`,
        kind,
        assetId,
        timelineRange: { startFrame: timelineStart, durationFrames: Math.max(1, duration) },
        sourceRange: { startFrame: frameFromRational(child.source_range.start_time, globalRate), durationFrames: Math.max(1, duration) },
        ...defaultClipValues(),
      };
      clips.push(clip);
      cursor = Math.max(cursor, timelineStart + duration);
    }
    const trackId = typeof embeddedTrack.id === "string" ? embeddedTrack.id : `otio-track-${trackIndex}`;
    return {
      id: trackId,
      name: otioTrack.name || `Track ${trackIndex + 1}`,
      kind,
      index: trackIndex,
      locked: embeddedTrack.locked === true,
      muted: embeddedTrack.muted === true,
      solo: embeddedTrack.solo === true,
      hidden: embeddedTrack.hidden === true,
      clips: clips.map((clip) => ({ ...clip, trackId, kind })),
    };
  });
  return normalizeEditorProject({ ...project, tracks, assets: [...assets.values()] });
}

export function importOtioLike(value: unknown): EditorProject {
  if (!isRecord(value) || value.OTIO_SCHEMA !== "Timeline.1" || !isRecord(value.tracks) || value.tracks.OTIO_SCHEMA !== "Stack.1" || !Array.isArray(value.tracks.children)) {
    throw new EditorProjectFormatError("The document is not an OTIO-like Timeline.1 with a Stack.1 track collection.");
  }
  const timeline = value as unknown as OtioLikeTimeline;
  const embedded = timeline.metadata?.alystria_project;
  if (embedded) return assertValidEditorProject(embedded);
  return assertValidEditorProject(importGenericOtio(timeline));
}

export function assertValidEditorProject(value: unknown): EditorProject {
  if (!isRecord(value) || value.schema !== EDITOR_PROJECT_SCHEMA) throw new EditorProjectFormatError(`Expected schema ${EDITOR_PROJECT_SCHEMA}.`);
  if (typeof value.id !== "string" || !value.id || typeof value.name !== "string") throw new EditorProjectFormatError("Project ID and name are required.");
  if (!isRecord(value.frameRate)) throw new EditorProjectFormatError("Project frame rate is missing.");
  rateAsNumber(value.frameRate as unknown as EditorProject["frameRate"]);
  if (!Array.isArray(value.tracks) || !Array.isArray(value.assets) || !Array.isArray(value.importReceipts) || !Array.isArray(value.markers)) {
    throw new EditorProjectFormatError("Project tracks, assets, receipts, and markers must be arrays.");
  }
  const project = value as unknown as EditorProject;
  const trackIds = new Set<string>();
  const clipIds = new Set<string>();
  for (const track of project.tracks) {
    if (!track.id || trackIds.has(track.id)) throw new EditorProjectFormatError(`Duplicate or missing track ID: ${track.id || "(empty)"}.`);
    trackIds.add(track.id);
    if (!Array.isArray(track.clips)) throw new EditorProjectFormatError(`Track ${track.id} has no clip array.`);
    for (const clip of track.clips) {
      if (!clip.id || clipIds.has(clip.id)) throw new EditorProjectFormatError(`Duplicate or missing clip ID: ${clip.id || "(empty)"}.`);
      if (clip.timelineRange.startFrame < 0 || clip.timelineRange.durationFrames <= 0 || clip.sourceRange.startFrame < 0 || clip.sourceRange.durationFrames <= 0) {
        throw new EditorProjectFormatError(`Clip ${clip.id} contains an invalid frame range.`);
      }
      clipIds.add(clip.id);
    }
  }
  return normalizeEditorProject(structuredClone(project));
}

export function serializeEditorProject(project: EditorProject, pretty = true): string {
  return JSON.stringify(assertValidEditorProject(project), null, pretty ? 2 : 0);
}

export function parseEditorProject(serialized: string): EditorProject {
  try {
    return assertValidEditorProject(JSON.parse(serialized));
  } catch (error) {
    if (error instanceof EditorProjectFormatError) throw error;
    throw new EditorProjectFormatError(`Editor project JSON could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function serializeOtioLike(project: EditorProject, pretty = true): string {
  return JSON.stringify(exportOtioLike(project), null, pretty ? 2 : 0);
}

export function parseOtioLike(serialized: string): EditorProject {
  try {
    return importOtioLike(JSON.parse(serialized));
  } catch (error) {
    if (error instanceof EditorProjectFormatError) throw error;
    throw new EditorProjectFormatError(`OTIO-like JSON could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
