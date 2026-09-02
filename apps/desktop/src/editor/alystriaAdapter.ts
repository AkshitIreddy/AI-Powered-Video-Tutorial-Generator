import { createEmptyEditorProject, defaultClipValues, normalizeEditorProject } from "./model";
import { secondsToFrames } from "./timecode";
import type { EditorClip, EditorMediaAsset, EditorProject, FrameRate, MediaKind, TrackKind } from "./types";

export interface AlystriaSceneLike {
  id: string;
  index?: number;
  title: string;
  kind?: string;
  duration: number;
  narration: string;
  objective?: string;
  visual?: string;
  locked?: boolean;
}

export interface AlystriaStudioAssetLike {
  id: string;
  kind: "presenter" | "background" | "font" | "music" | "sfx";
  label: string;
  source?: "starter-pack" | "user-upload";
  filename?: string;
  mediaType?: string;
  sha256?: string;
  creator?: string;
  license?: string;
  attribution?: string;
  rightsStatus?: "cleared" | "review";
}

export interface AlystriaProjectRecordLike {
  id: string;
  title: string;
  topic?: string;
  description?: string;
  locale?: string;
  audience?: string;
  duration: number;
  updatedAt?: string;
  theme?: string;
  privacy?: string;
  scenes: readonly AlystriaSceneLike[];
  sources?: readonly { id: string; title: string; license?: string; attribution?: string | null }[];
  customization?: {
    colors?: { paper?: string; ink?: string; accent?: string };
    displayFont?: string;
    bodyFont?: string;
    typeScale?: number;
    captions?: { position?: "auto" | "top" | "lower-third"; size?: number; textColor?: string; panelColor?: string };
    presenter?: { assetId?: string | null; placement?: string; side?: string; scale?: number };
    audio?: { musicAssetId?: string | null; sfxAssetId?: string | null; musicLevel?: number; sfxLevel?: number };
    assets?: readonly AlystriaStudioAssetLike[];
  };
  nativeProjectId?: string;
  nativeHeadRevisionId?: string;
  nativeRevisionNumber?: number;
}

export interface AlystriaProjectAdapterOptions {
  now: string;
  frameRate?: FrameRate;
  width?: number;
  height?: number;
}

function mediaKind(kind: AlystriaStudioAssetLike["kind"]): MediaKind {
  if (kind === "music" || kind === "sfx") return "audio";
  if (kind === "presenter") return "video";
  if (kind === "background") return "image";
  return "document";
}

function projectAsset(asset: AlystriaStudioAssetLike, now: string): EditorMediaAsset {
  return {
    id: asset.id,
    name: asset.label,
    kind: mediaKind(asset.kind),
    // ProjectRecord carries identity and rights, not a verified playable URI.
    status: "pending",
    durationFrames: null,
    ...(asset.mediaType ? { mimeType: asset.mediaType } : {}),
    ...(asset.sha256 ? { hash: asset.sha256 } : {}),
    provenance: {
      origin: asset.source === "user-upload" ? "user-import" : "project-derived",
      createdAt: now,
      sourceId: asset.id,
      humanApproved: asset.rightsStatus === "cleared",
    },
    metadata: {
      alystriaAssetKind: asset.kind,
      filename: asset.filename ?? null,
      creator: asset.creator ?? null,
      license: asset.license ?? null,
      attribution: asset.attribution ?? null,
      rightsStatus: asset.rightsStatus ?? null,
      playableUriRequired: true,
    },
  };
}

function makeClip({
  id,
  trackId,
  kind,
  name,
  startFrame,
  durationFrames,
  assetId = null,
  text,
  locked = false,
  metadata = {},
}: {
  id: string;
  trackId: string;
  kind: TrackKind;
  name: string;
  startFrame: number;
  durationFrames: number;
  assetId?: string | null;
  text?: string;
  locked?: boolean;
  metadata?: EditorClip["metadata"];
}): EditorClip {
  return {
    id,
    trackId,
    kind,
    name,
    assetId,
    timelineRange: { startFrame, durationFrames },
    sourceRange: { startFrame: 0, durationFrames },
    ...defaultClipValues(),
    locked,
    ...(text !== undefined ? { text } : {}),
    metadata,
  };
}

export function createEditorProjectFromAlystriaProject(
  record: AlystriaProjectRecordLike,
  options: AlystriaProjectAdapterOptions,
): EditorProject {
  if (!record.id || !record.title || !Array.isArray(record.scenes)) throw new Error("Alystria project ID, title, and scenes are required.");
  const frameRate = options.frameRate ?? { numerator: 30, denominator: 1 };
  const project = createEmptyEditorProject({ id: record.nativeProjectId ?? record.id, name: record.title, now: options.now, frameRate, width: options.width ?? 1920, height: options.height ?? 1080 });
  const track = (kind: TrackKind) => project.tracks.find((candidate) => candidate.kind === kind)!;
  const customization = record.customization;
  const sourceAssets = customization?.assets ?? [];
  project.assets = sourceAssets.map((asset) => projectAsset(asset, options.now));
  project.canvas.backgroundColor = customization?.colors?.paper ?? project.canvas.backgroundColor;

  let cursor = 0;
  for (const scene of [...record.scenes].sort((left, right) => (left.index ?? 0) - (right.index ?? 0))) {
    const durationFrames = Math.max(1, secondsToFrames(scene.duration, frameRate));
    const sceneMetadata = {
      alystriaSceneId: scene.id,
      sceneKind: scene.kind ?? null,
      objective: scene.objective ?? null,
      visual: scene.visual ?? null,
      authoredStructureOnly: true,
    };
    track("slides").clips.push(makeClip({ id: `scene-${scene.id}`, trackId: track("slides").id, kind: "slides", name: scene.title, startFrame: cursor, durationFrames, locked: scene.locked, metadata: sceneMetadata }));
    track("captions").clips.push(makeClip({ id: `caption-${scene.id}`, trackId: track("captions").id, kind: "captions", name: `${scene.title} caption`, startFrame: cursor, durationFrames, text: scene.narration, locked: scene.locked, metadata: sceneMetadata }));
    track("narration").clips.push(makeClip({ id: `narration-${scene.id}`, trackId: track("narration").id, kind: "narration", name: `${scene.title} narration script`, startFrame: cursor, durationFrames, text: scene.narration, locked: scene.locked, metadata: { ...sceneMetadata, scriptOnly: true, playableMediaRequired: true } }));
    if (scene.kind === "title") track("titles").clips.push(makeClip({ id: `title-${scene.id}`, trackId: track("titles").id, kind: "titles", name: scene.title, startFrame: cursor, durationFrames: Math.min(durationFrames, secondsToFrames(6, frameRate)), text: scene.title, locked: scene.locked, metadata: sceneMetadata }));
    cursor += durationFrames;
  }

  const configuredDuration = secondsToFrames(Math.max(0, record.duration) * 60, frameRate);
  const timelineDuration = Math.max(cursor, configuredDuration);
  const presenterId = customization?.presenter?.assetId ?? null;
  if (presenterId && sourceAssets.some((asset) => asset.id === presenterId)) {
    track("presenter").clips.push(makeClip({ id: `presenter-${presenterId}`, trackId: track("presenter").id, kind: "presenter", name: sourceAssets.find((asset) => asset.id === presenterId)?.label ?? "Presenter", startFrame: 0, durationFrames: Math.max(1, timelineDuration), assetId: presenterId, metadata: { placement: customization?.presenter?.placement ?? null, side: customization?.presenter?.side ?? null, sourceNeedsPlayableUri: true } }));
  }
  const musicId = customization?.audio?.musicAssetId ?? null;
  if (musicId && sourceAssets.some((asset) => asset.id === musicId)) {
    const musicClip = makeClip({ id: `music-${musicId}`, trackId: track("music").id, kind: "music", name: sourceAssets.find((asset) => asset.id === musicId)?.label ?? "Music", startFrame: 0, durationFrames: Math.max(1, timelineDuration), assetId: musicId, metadata: { sourceNeedsPlayableUri: true } });
    musicClip.audio.volumeDb = customization?.audio?.musicLevel ?? 0;
    track("music").clips.push(musicClip);
  }
  const sfxId = customization?.audio?.sfxAssetId ?? null;
  if (sfxId && sourceAssets.some((asset) => asset.id === sfxId)) {
    track("sfx").clips.push(makeClip({ id: `sfx-${sfxId}`, trackId: track("sfx").id, kind: "sfx", name: sourceAssets.find((asset) => asset.id === sfxId)?.label ?? "Sound effect", startFrame: 0, durationFrames: Math.max(1, Math.min(timelineDuration, secondsToFrames(2, frameRate))), assetId: sfxId, metadata: { placementNeedsReview: true, sourceNeedsPlayableUri: true } }));
  }

  project.durationFrames = timelineDuration;
  project.updatedAt = options.now;
  project.metadata = {
    alystriaProjectRecordId: record.id,
    nativeHeadRevisionId: record.nativeHeadRevisionId ?? null,
    nativeRevisionNumber: record.nativeRevisionNumber ?? null,
    topic: record.topic ?? null,
    description: record.description ?? null,
    locale: record.locale ?? null,
    audience: record.audience ?? null,
    privacy: record.privacy ?? null,
    theme: record.theme ?? null,
    sourceCount: record.sources?.length ?? 0,
    adapterNotice: "Scene, transcript, and asset-reference structure imported. Playable media URIs must be resolved by integration callbacks.",
  };
  return normalizeEditorProject(project);
}
