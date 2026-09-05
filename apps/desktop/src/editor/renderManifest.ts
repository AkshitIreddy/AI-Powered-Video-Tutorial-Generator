import { assertValidEditorProject } from "./otio";
import { clipCarriesProgrammeAudio, isTrackAudible } from "./audioPolicy";
import type { ClipTransform, EditorProject, InspectorProperty, KeyframeInterpolation, TextStyle, TrackKind } from "./types";

export const EDITOR_RENDER_MANIFEST_SCHEMA = "alystria.editor.render.v1" as const;
export const EDITOR_TIMEBASE_HZ = 240_000 as const;

export type EditorDeliveryCodec = "vp9" | "av1" | "h264_nvenc" | "h264_mf" | "libx264" | "hevc_nvenc";

export interface EditorRenderBlocker {
  code: "ASSET_NOT_READY" | "ASSET_NOT_IN_CAS" | "ASSET_RIGHTS_BLOCKED" | "MEDIA_REQUIRED" | "PAN_UNSUPPORTED" | "KEYFRAME_PROPERTY_UNSUPPORTED" | "TEXT_TRANSFORM_UNSUPPORTED";
  message: string;
  clipId?: string;
  assetId?: string;
}

export interface EditorRenderKeyframe {
  property: InspectorProperty;
  timelineTicks: number;
  value: number;
  interpolation: KeyframeInterpolation;
}

export interface EditorRenderAssetBinding {
  id: string;
  artifactHash: string;
  mediaType: string;
  kind: "image" | "video" | "audio";
  exportEligible: boolean;
}

export interface EditorRenderClip {
  id: string;
  trackId: string;
  kind: TrackKind;
  layer: number;
  assetId: string | null;
  timelineStartTicks: number;
  timelineDurationTicks: number;
  sourceStartTicks: number;
  sourceDurationTicks: number;
  playbackRate: number;
  transform: ClipTransform;
  opacity: number;
  audio: { volumeDb: number; pan: number; muted: boolean; fadeInTicks: number; fadeOutTicks: number };
  includeSourceAudio?: boolean;
  text?: string;
  textStyle?: TextStyle;
  keyframes: EditorRenderKeyframe[];
}

export interface EditorRenderManifest {
  schema: typeof EDITOR_RENDER_MANIFEST_SCHEMA;
  projectId: string;
  name: string;
  timebaseHz: typeof EDITOR_TIMEBASE_HZ;
  frameRate: EditorProject["frameRate"];
  canvas: EditorProject["canvas"];
  durationTicks: number;
  codec: { name: EditorDeliveryCodec; quality?: number; bitrate?: string };
  assets: EditorRenderAssetBinding[];
  clips: EditorRenderClip[];
}

export interface EditorRenderManifestCompilation {
  ready: boolean;
  manifest: EditorRenderManifest;
  blockers: EditorRenderBlocker[];
}

function framesToTicks(frames: number, project: EditorProject): number {
  const ticks = frames * EDITOR_TIMEBASE_HZ * project.frameRate.denominator / project.frameRate.numerator;
  if (!Number.isFinite(ticks) || Math.abs(ticks - Math.round(ticks)) > 1e-6) throw new Error(`Frame ${frames} cannot be represented exactly at the 240 kHz editor timebase.`);
  return Math.round(ticks);
}

function isCasHash(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{64}$/u.test(value));
}

export function compileEditorRenderManifest(
  projectInput: EditorProject,
  codec: EditorRenderManifest["codec"] = { name: "vp9" },
): EditorRenderManifestCompilation {
  const project = assertValidEditorProject(projectInput);
  const referencedAssetIds = new Set(project.tracks.flatMap((track) => track.clips.flatMap((clip) => clip.enabled && clip.assetId ? [clip.assetId] : [])));
  const blockers: EditorRenderBlocker[] = [];
  const assets = project.assets.flatMap((asset): EditorRenderAssetBinding[] => {
    if (!referencedAssetIds.has(asset.id)) return [];
    if (asset.status !== "ready") blockers.push({ code: "ASSET_NOT_READY", message: `${asset.name} is not ready for render.`, assetId: asset.id });
    if (!isCasHash(asset.hash) || asset.metadata.browserSessionOnly === true) blockers.push({ code: "ASSET_NOT_IN_CAS", message: `${asset.name} has no durable content-addressed media binding.`, assetId: asset.id });
    if (asset.metadata.exportEligible === false) blockers.push({ code: "ASSET_RIGHTS_BLOCKED", message: `${asset.name} is not cleared for export.`, assetId: asset.id });
    if ((asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio") || !isCasHash(asset.hash)) return [];
    return [{ id: asset.id, artifactHash: asset.hash, mediaType: asset.mimeType ?? "application/octet-stream", kind: asset.kind, exportEligible: asset.metadata.exportEligible !== false }];
  });

  const clips = project.tracks.flatMap((track): EditorRenderClip[] => {
    if (track.hidden) return [];
    const audioTrack = track.kind === "narration" || track.kind === "music" || track.kind === "sfx";
    const trackAudible = isTrackAudible(project, track);
    if (audioTrack && !trackAudible) return [];
    return track.clips.flatMap((clip): EditorRenderClip[] => {
      if (!clip.enabled) return [];
      const includeSourceAudio = clip.metadata.includeSourceAudio === true && trackAudible && !clip.audio.muted;
      const effectiveAudioMuted = clip.audio.muted || (clipCarriesProgrammeAudio(track, clip) && !trackAudible);
      if ((track.kind === "slides" || track.kind === "presenter" || audioTrack) && !clip.assetId) blockers.push({ code: "MEDIA_REQUIRED", message: `${clip.name} needs a durable media asset before render.`, clipId: clip.id });
      const unsupportedKeyframe = clip.keyframes.find((keyframe) =>
        keyframe.property === "audio.pan" ||
        ((track.kind === "titles" || track.kind === "captions") && keyframe.property !== "transform.x" && keyframe.property !== "transform.y" && keyframe.property !== "opacity") ||
        (audioTrack && keyframe.property !== "audio.volumeDb") ||
        ((track.kind === "slides" || track.kind === "presenter") && keyframe.property === "audio.volumeDb" && clip.metadata.includeSourceAudio !== true),
      );
      if (unsupportedKeyframe) blockers.push({ code: "KEYFRAME_PROPERTY_UNSUPPORTED", message: `${clip.name} cannot render ${unsupportedKeyframe.property} keyframes on its ${track.kind} track.`, clipId: clip.id });
      if (clip.audio.pan !== 0) blockers.push({ code: "PAN_UNSUPPORTED", message: `${clip.name} uses audio pan; native pan rendering is not available yet.`, clipId: clip.id });
      if ((track.kind === "titles" || track.kind === "captions") && (clip.transform.scaleX !== 1 || clip.transform.scaleY !== 1 || clip.transform.rotation !== 0)) blockers.push({ code: "TEXT_TRANSFORM_UNSUPPORTED", message: `${clip.name} uses text scale or rotation that the native title renderer cannot reproduce.`, clipId: clip.id });
      return [{
        id: clip.id,
        trackId: track.id,
        kind: track.kind,
        layer: track.index,
        assetId: clip.assetId,
        timelineStartTicks: framesToTicks(clip.timelineRange.startFrame, project),
        timelineDurationTicks: framesToTicks(clip.timelineRange.durationFrames, project),
        sourceStartTicks: framesToTicks(clip.sourceRange.startFrame, project),
        sourceDurationTicks: framesToTicks(clip.sourceRange.durationFrames, project),
        playbackRate: clip.playbackRate ?? 1,
        transform: structuredClone(clip.transform),
        opacity: clip.opacity,
        audio: {
          volumeDb: clip.audio.volumeDb,
          pan: clip.audio.pan,
          muted: effectiveAudioMuted,
          fadeInTicks: framesToTicks(clip.audio.fadeInFrames, project),
          fadeOutTicks: framesToTicks(clip.audio.fadeOutFrames, project),
        },
        ...(includeSourceAudio ? { includeSourceAudio: true } : {}),
        ...(clip.text !== undefined ? { text: clip.text } : {}),
        ...((track.kind === "titles" || track.kind === "captions") ? { textStyle: structuredClone(clip.textStyle ?? {
          fontFamily: "sans-serif",
          fontSize: track.kind === "titles" ? 64 : 42,
          fontWeight: 600,
          color: "#FFFFFF",
          backgroundColor: track.kind === "captions" ? "#000000" : null,
          align: "center",
          position: track.kind === "titles" ? "center" : "bottom",
        }) } : {}),
        keyframes: clip.keyframes.filter((keyframe) => !effectiveAudioMuted || keyframe.property !== "audio.volumeDb").map((keyframe) => ({
          property: keyframe.property,
          timelineTicks: framesToTicks(keyframe.frame, project),
          value: keyframe.value,
          interpolation: keyframe.interpolation,
        })),
      }];
    });
  });
  return {
    ready: blockers.length === 0,
    blockers,
    manifest: {
      schema: EDITOR_RENDER_MANIFEST_SCHEMA,
      projectId: project.id,
      name: project.name,
      timebaseHz: EDITOR_TIMEBASE_HZ,
      frameRate: structuredClone(project.frameRate),
      canvas: structuredClone(project.canvas),
      durationTicks: framesToTicks(project.durationFrames, project),
      codec: structuredClone(codec),
      assets,
      clips,
    },
  };
}
