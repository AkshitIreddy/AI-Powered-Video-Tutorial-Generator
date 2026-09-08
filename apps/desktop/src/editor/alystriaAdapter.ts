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
  kind: "presenter" | "background" | "element" | "font" | "music" | "sfx";
  label: string;
  source?: "starter-pack" | "user-upload" | "generated" | "licensed-media";
  filename?: string;
  mediaType?: string;
  sha256?: string;
  creator?: string;
  license?: string;
  attribution?: string;
  sourceUrl?: string;
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
  mediaBindings?: AlystriaEditorMediaBindings;
}

export interface AlystriaEditorMediaBinding {
  sceneId: string;
  artifactHash: string;
  mediaType: string;
  durationTicks?: number;
  activeDurationTicks?: number;
  durationMs?: number;
  sourceStartTicks?: number;
  exportEligible?: boolean;
  captionsBurnedIntoPixels?: boolean | null;
}

export interface AlystriaEditorCaptionBinding {
  sceneId: string;
  id: string;
  startTicks: number;
  endTicks: number;
  text: string;
}

export interface AlystriaEditorMediaBindings {
  assets: readonly AlystriaEditorMediaBinding[];
  narration: readonly AlystriaEditorMediaBinding[];
  presenters: readonly AlystriaEditorMediaBinding[];
  renders?: readonly AlystriaEditorMediaBinding[];
  captions?: readonly AlystriaEditorCaptionBinding[];
}

function bindingAsset(role: "visual" | "render" | "narration" | "presenter", binding: AlystriaEditorMediaBinding, now: string, frameRate: FrameRate): EditorMediaAsset {
  const mediaKind: MediaKind = role === "narration" ? "audio" : binding.mediaType.startsWith("image/") ? "image" : "video";
  const ticks = binding.durationTicks ?? binding.activeDurationTicks;
  const availableTicks = ticks === undefined ? undefined : ticks + (binding.sourceStartTicks ?? 0);
  const seconds = availableTicks !== undefined ? availableTicks / 240_000 : binding.durationMs !== undefined ? binding.durationMs / 1_000 : null;
  const exportEligible = binding.exportEligible !== false;
  return {
    id: `generated-${role}-${binding.sceneId}`,
    name: `${role === "visual" ? "Scene visual" : role === "render" ? "Rendered scene" : role === "narration" ? "Scene narration" : "Scene presenter"} · ${binding.sceneId}`,
    kind: mediaKind,
    status: "ready",
    durationFrames: seconds === null ? null : Math.max(1, secondsToFrames(seconds, frameRate)),
    mimeType: binding.mediaType,
    hash: binding.artifactHash,
    provenance: { origin: "local-generation", createdAt: now, sourceId: binding.sceneId, humanApproved: exportEligible },
    metadata: { nativeArtifactId: binding.artifactHash, exportEligible, generatedRole: role, alystriaSceneId: binding.sceneId,
      ...(role === "render" ? { generatedSourceStartFrame: Math.max(0, secondsToFrames((binding.sourceStartTicks ?? 0) / 240_000, frameRate)) } : {}) },
  };
}

function mediaKind(kind: AlystriaStudioAssetLike["kind"]): MediaKind {
  if (kind === "music" || kind === "sfx") return "audio";
  if (kind === "presenter") return "video";
  if (kind === "background" || kind === "element") return "image";
  return "document";
}

function projectAsset(asset: AlystriaStudioAssetLike, now: string): EditorMediaAsset {
  const origin = asset.source === "user-upload"
    ? "user-import"
    : asset.source === "generated"
      ? "local-generation"
      : "project-derived";
  return {
    id: asset.id,
    name: asset.label,
    kind: asset.mediaType?.startsWith("image/") ? "image"
      : asset.mediaType?.startsWith("video/") ? "video"
        : asset.mediaType?.startsWith("audio/") ? "audio" : mediaKind(asset.kind),
    // ProjectRecord carries identity and rights, not a verified playable URI.
    status: "pending",
    durationFrames: null,
    ...(asset.mediaType ? { mimeType: asset.mediaType } : {}),
    ...(asset.sha256 ? { hash: asset.sha256 } : {}),
    provenance: {
      origin,
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
      sourceUrl: asset.sourceUrl ?? null,
      rightsStatus: asset.rightsStatus ?? null,
      alystriaAssetSource: asset.source ?? null,
      exportEligible: asset.rightsStatus === "cleared",
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
  sourceStartFrame = 0,
  text,
  linkedGroupId,
  locked = false,
  enabled = true,
  metadata = {},
}: {
  id: string;
  trackId: string;
  kind: TrackKind;
  name: string;
  startFrame: number;
  durationFrames: number;
  assetId?: string | null;
  sourceStartFrame?: number;
  text?: string;
  linkedGroupId?: string;
  locked?: boolean;
  enabled?: boolean;
  metadata?: EditorClip["metadata"];
}): EditorClip {
  return {
    id,
    trackId,
    kind,
    name,
    assetId,
    timelineRange: { startFrame, durationFrames },
    sourceRange: { startFrame: sourceStartFrame, durationFrames },
    ...defaultClipValues(),
    enabled,
    locked,
    ...(linkedGroupId ? { linkedGroupId } : {}),
    ...(text !== undefined ? { text } : {}),
    metadata,
  };
}

function normalizedCaptionText(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/gu, " ");
}

function sceneCaptionBindings(
  bindings: AlystriaEditorMediaBindings | undefined,
  sceneId: string,
): readonly AlystriaEditorCaptionBinding[] {
  return (bindings?.captions ?? [])
    .filter((cue) => cue.sceneId === sceneId
      && cue.id.trim().length > 0
      && cue.text.trim().length > 0
      && Number.isSafeInteger(cue.startTicks)
      && Number.isSafeInteger(cue.endTicks)
      && cue.startTicks >= 0
      && cue.endTicks > cue.startTicks)
    .sort((left, right) => left.startTicks - right.startTicks || left.endTicks - right.endTicks || left.id.localeCompare(right.id));
}

function captionClipId(sceneId: string, cueId: string): string {
  return `caption-cue-${sceneId}-${cueId}`;
}

function makeSceneCaptionClips({
  cues,
  sceneId,
  sceneStartFrame,
  sceneVisibleSourceStartFrame = 0,
  sceneVisibleSourceDurationFrames,
  playbackRate = 1,
  frameRate,
  trackId,
  linkedGroupId,
  locked,
  enabled,
  burnedIntoPixels,
}: {
  cues: readonly AlystriaEditorCaptionBinding[];
  sceneId: string;
  sceneStartFrame: number;
  sceneVisibleSourceStartFrame?: number;
  sceneVisibleSourceDurationFrames: number;
  playbackRate?: number;
  frameRate: FrameRate;
  trackId: string;
  linkedGroupId: string;
  locked: boolean | undefined;
  enabled: boolean;
  burnedIntoPixels: boolean | null | undefined;
}): EditorClip[] {
  return cues.flatMap((cue, index) => {
    const cueStartFrame = Math.max(0, secondsToFrames(cue.startTicks / 240_000, frameRate));
    const cueEndFrame = Math.max(cueStartFrame + 1, secondsToFrames(cue.endTicks / 240_000, frameRate));
    const visibleEndFrame = sceneVisibleSourceStartFrame + sceneVisibleSourceDurationFrames;
    const localStartFrame = Math.max(cueStartFrame, sceneVisibleSourceStartFrame);
    const localEndFrame = Math.min(cueEndFrame, visibleEndFrame);
    if (localEndFrame <= localStartFrame) return [];
    const timelineOffset = Math.round((localStartFrame - sceneVisibleSourceStartFrame) / playbackRate);
    const timelineDuration = Math.max(1, Math.round((localEndFrame - localStartFrame) / playbackRate));
    return [makeClip({
      id: captionClipId(sceneId, cue.id),
      trackId,
      kind: "captions",
      name: `Caption ${index + 1}`,
      startFrame: sceneStartFrame + timelineOffset,
      durationFrames: timelineDuration,
      linkedGroupId,
      text: cue.text.trim(),
      locked: locked ?? false,
      enabled,
      metadata: {
        alystriaSceneId: sceneId,
        alystriaCaptionCueId: cue.id,
        alystriaGeneratedCaptionCue: true,
        alystriaOriginalText: cue.text.trim(),
        alystriaSceneLocalStartTicks: cue.startTicks,
        alystriaSceneLocalEndTicks: cue.endTicks,
        captionsBurnedIntoPixels: burnedIntoPixels ?? null,
        captionReviewRequired: burnedIntoPixels === null || burnedIntoPixels === undefined,
      },
    })];
  });
}

export function createEditorProjectFromAlystriaProject(
  record: AlystriaProjectRecordLike,
  options: AlystriaProjectAdapterOptions,
): EditorProject {
  if (!record.id || !record.title || !Array.isArray(record.scenes)) throw new Error("Project ID, title, and scenes are required.");
  const frameRate = options.frameRate ?? { numerator: 30, denominator: 1 };
  const project = createEmptyEditorProject({ id: record.nativeProjectId ?? record.id, name: record.title, now: options.now, frameRate, width: options.width ?? 1920, height: options.height ?? 1080 });
  const track = (kind: TrackKind) => project.tracks.find((candidate) => candidate.kind === kind)!;
  const customization = record.customization;
  const sourceAssets = customization?.assets ?? [];
  const bindings = options.mediaBindings;
  const generatedAssets = bindings ? [
    ...(bindings.renders ?? []).map((binding) => bindingAsset("render", binding, options.now, frameRate)),
    ...bindings.assets.map((binding) => bindingAsset("visual", binding, options.now, frameRate)),
    ...bindings.narration.map((binding) => bindingAsset("narration", binding, options.now, frameRate)),
    ...bindings.presenters.map((binding) => bindingAsset("presenter", binding, options.now, frameRate)),
  ] : [];
  project.assets = [...sourceAssets.map((asset) => projectAsset(asset, options.now)), ...generatedAssets];
  project.canvas.backgroundColor = customization?.colors?.paper ?? project.canvas.backgroundColor;

  let cursor = 0;
  for (const scene of [...record.scenes].sort((left, right) => (left.index ?? 0) - (right.index ?? 0))) {
    const renderBinding = bindings?.renders?.find((binding) => binding.sceneId === scene.id);
    const sourceStartFrame = Math.max(0, secondsToFrames((renderBinding?.sourceStartTicks ?? 0) / 240_000, frameRate));
    const durationFrames = renderBinding?.durationTicks === undefined
      ? Math.max(1, secondsToFrames(scene.duration, frameRate))
      : Math.max(1, secondsToFrames(((renderBinding.sourceStartTicks ?? 0) + renderBinding.durationTicks) / 240_000, frameRate) - sourceStartFrame);
    const linkedGroupId = `alystria-scene-${scene.id}`;
    const sceneMetadata = {
      alystriaSceneId: scene.id,
      sceneKind: scene.kind ?? null,
      objective: scene.objective ?? null,
      visual: scene.visual ?? null,
      authoredStructureOnly: true,
    };
    const renderAsset = generatedAssets.find((asset) => asset.id === `generated-render-${scene.id}`);
    const visualAsset = renderAsset ?? generatedAssets.find((asset) => asset.id === `generated-visual-${scene.id}`);
    const narrationAsset = generatedAssets.find((asset) => asset.id === `generated-narration-${scene.id}`);
    const presenterAsset = generatedAssets.find((asset) => asset.id === `generated-presenter-${scene.id}`);
    const narrationDuration = Math.min(durationFrames, narrationAsset?.durationFrames ?? durationFrames);
    const presenterDuration = Math.min(durationFrames, presenterAsset?.durationFrames ?? durationFrames);
    const renderDuration = durationFrames;
    track("slides").clips.push(makeClip({ id: `scene-${scene.id}`, trackId: track("slides").id, kind: "slides", name: scene.title, startFrame: cursor, durationFrames: renderAsset ? renderDuration : durationFrames, sourceStartFrame, assetId: visualAsset?.id ?? null, linkedGroupId, locked: scene.locked, metadata: { ...sceneMetadata, authoredStructureOnly: !visualAsset, ...(renderAsset ? { includeSourceAudio: true, preservedCompositeRender: true } : {}) } }));
    const cues = sceneCaptionBindings(bindings, scene.id);
    const burnedIntoPixels = renderBinding?.captionsBurnedIntoPixels;
    if (cues.length && burnedIntoPixels !== true) {
      track("captions").clips.push(...makeSceneCaptionClips({
        cues,
        sceneId: scene.id,
        sceneStartFrame: cursor,
        sceneVisibleSourceDurationFrames: renderAsset ? renderDuration : durationFrames,
        frameRate,
        trackId: track("captions").id,
        linkedGroupId,
        locked: scene.locked,
        enabled: !renderAsset || burnedIntoPixels === false,
        burnedIntoPixels: renderAsset ? burnedIntoPixels : false,
      }));
    }
    if (!renderAsset) track("narration").clips.push(makeClip({ id: `narration-${scene.id}`, trackId: track("narration").id, kind: "narration", name: `${scene.title} narration`, startFrame: cursor, durationFrames: narrationDuration, assetId: narrationAsset?.id ?? null, linkedGroupId, text: scene.narration, locked: scene.locked, metadata: { ...sceneMetadata, scriptOnly: !narrationAsset, playableMediaRequired: !narrationAsset } }));
    if (!renderAsset && presenterAsset) track("presenter").clips.push(makeClip({ id: `presenter-${scene.id}`, trackId: track("presenter").id, kind: "presenter", name: `${scene.title} presenter`, startFrame: cursor, durationFrames: presenterDuration, assetId: presenterAsset.id, linkedGroupId, locked: scene.locked, metadata: sceneMetadata }));
    if (!renderAsset && scene.kind === "title") track("titles").clips.push(makeClip({ id: `title-${scene.id}`, trackId: track("titles").id, kind: "titles", name: scene.title, startFrame: cursor, durationFrames: Math.min(durationFrames, secondsToFrames(6, frameRate)), linkedGroupId, text: scene.title, locked: scene.locked, metadata: { ...sceneMetadata, alystriaGeneratedSceneTitle: true, alystriaOriginalText: scene.title } }));
    cursor += durationFrames;
  }

  const configuredDuration = secondsToFrames(Math.max(0, record.duration) * 60, frameRate);
  const timelineDuration = Math.max(cursor, configuredDuration);
  const presenterId = customization?.presenter?.assetId ?? null;
  if (presenterId && !bindings?.presenters.length && !bindings?.renders?.length && sourceAssets.some((asset) => asset.id === presenterId)) {
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

function canReplaceProjectDerivedMedia(clip: EditorClip, assets: readonly EditorMediaAsset[]): boolean {
  if (clip.assetId === null) return clip.metadata.authoredStructureOnly === true || clip.metadata.scriptOnly === true || clip.metadata.playableMediaRequired === true;
  const current = assets.find((asset) => asset.id === clip.assetId);
  return Boolean(current && (current.metadata.generatedRole !== undefined || (current.status !== "ready" && current.provenance.origin === "project-derived")));
}

function hasDefaultTransform(clip: EditorClip): boolean {
  return clip.transform.x === 0
    && clip.transform.y === 0
    && clip.transform.scaleX === 1
    && clip.transform.scaleY === 1
    && clip.transform.rotation === 0
    && clip.transform.anchorX === 0.5
    && clip.transform.anchorY === 0.5
    && clip.opacity === 1
    && clip.keyframes.length === 0;
}

function isUnmodifiedGeneratedSceneTitle(
  clip: EditorClip,
  slide: EditorClip,
  frameRate: FrameRate,
): boolean {
  const sceneId = String(slide.metadata.alystriaSceneId ?? "");
  return clip.id === `title-${sceneId}`
    && clip.metadata.authoredStructureOnly === true
    && clip.text === clip.name
    && clip.textStyle === undefined
    && clip.enabled
    && hasDefaultTransform(clip)
    && clip.timelineRange.startFrame === slide.timelineRange.startFrame
    && clip.timelineRange.durationFrames === Math.min(slide.timelineRange.durationFrames, secondsToFrames(6, frameRate));
}

function isUnmodifiedLegacySceneCaption(
  clip: EditorClip,
  slide: EditorClip,
  cues: readonly AlystriaEditorCaptionBinding[],
): boolean {
  const sceneId = String(slide.metadata.alystriaSceneId ?? "");
  const cueText = normalizedCaptionText(cues.map((cue) => cue.text).join(" "));
  return cueText.length > 0
    && clip.id === `caption-${sceneId}`
    && clip.metadata.authoredStructureOnly === true
    && clip.metadata.alystriaCaptionCueId === undefined
    && normalizedCaptionText(clip.text) === cueText
    && clip.textStyle === undefined
    && clip.enabled
    && hasDefaultTransform(clip)
    && clip.timelineRange.startFrame === slide.timelineRange.startFrame
    && clip.timelineRange.durationFrames === slide.timelineRange.durationFrames;
}

function isUnmodifiedReviewCue(clip: EditorClip): boolean {
  return clip.metadata.alystriaGeneratedCaptionCue === true
    && clip.metadata.captionReviewRequired === true
    && clip.enabled === false
    && clip.text === clip.metadata.alystriaOriginalText
    && clip.textStyle === undefined
    && hasDefaultTransform(clip);
}

function reconcileBoundSceneText(
  project: EditorProject,
  bindings: AlystriaEditorMediaBindings,
): void {
  const captionTrack = project.tracks.find((track) => track.kind === "captions");
  const titleTrack = project.tracks.find((track) => track.kind === "titles");
  const slideTrack = project.tracks.find((track) => track.kind === "slides");
  if (!captionTrack || !titleTrack || !slideTrack) return;

  const sceneIds = new Set([
    ...(bindings.renders ?? []).map((binding) => binding.sceneId),
    ...(bindings.captions ?? []).map((binding) => binding.sceneId),
  ]);
  for (const sceneId of sceneIds) {
    const slide = slideTrack.clips.find((clip) => clip.metadata.alystriaSceneId === sceneId);
    if (!slide) continue;
    const render = bindings.renders?.find((binding) => binding.sceneId === sceneId);
    const cues = sceneCaptionBindings(bindings, sceneId);

    captionTrack.clips = captionTrack.clips.filter((clip) => {
      if (clip.metadata.alystriaSceneId !== sceneId) return true;
      if (isUnmodifiedLegacySceneCaption(clip, slide, cues)) return false;
      if ((render?.captionsBurnedIntoPixels === true || render?.captionsBurnedIntoPixels === false) && isUnmodifiedReviewCue(clip)) return false;
      return true;
    });
    if (render) {
      titleTrack.clips = titleTrack.clips.filter((clip) => clip.metadata.alystriaSceneId !== sceneId
        || !isUnmodifiedGeneratedSceneTitle(clip, slide, project.frameRate));
    }

    if (!cues.length || render?.captionsBurnedIntoPixels === true) continue;
    const existingIds = new Set(captionTrack.clips.map((clip) => clip.id));
    const renderBaseFrame = render?.sourceStartTicks === undefined
      ? 0
      : Math.max(0, secondsToFrames(render.sourceStartTicks / 240_000, project.frameRate));
    const sceneSourceStartFrame = Math.max(0, slide.sourceRange.startFrame - renderBaseFrame);
    const generated = makeSceneCaptionClips({
      cues,
      sceneId,
      sceneStartFrame: slide.timelineRange.startFrame,
      sceneVisibleSourceStartFrame: sceneSourceStartFrame,
      sceneVisibleSourceDurationFrames: slide.sourceRange.durationFrames,
      playbackRate: slide.playbackRate ?? 1,
      frameRate: project.frameRate,
      trackId: captionTrack.id,
      linkedGroupId: slide.linkedGroupId ?? `alystria-scene-${sceneId}`,
      locked: slide.locked,
      enabled: !render || render.captionsBurnedIntoPixels === false,
      burnedIntoPixels: render ? render.captionsBurnedIntoPixels : false,
    });
    captionTrack.clips.push(...generated.filter((clip) => !existingIds.has(clip.id)));
  }
}

/**
 * Attach newly completed generation media to a saved editor document without
 * rebuilding its timeline. User timing, transforms, text, track order, and
 * imported media remain untouched. Composite renders replace only unresolved
 * project-derived scene placeholders and retain their master source offset.
 */
export function mergeAlystriaMediaBindings(
  projectInput: EditorProject,
  bindings: AlystriaEditorMediaBindings,
  now: string,
): EditorProject {
  const project = normalizeEditorProject(projectInput);
  const generated = [
    ...(bindings.renders ?? []).map((binding) => bindingAsset("render", binding, now, project.frameRate)),
    ...bindings.assets.map((binding) => bindingAsset("visual", binding, now, project.frameRate)),
    ...bindings.narration.map((binding) => bindingAsset("narration", binding, now, project.frameRate)),
    ...bindings.presenters.map((binding) => bindingAsset("presenter", binding, now, project.frameRate)),
  ];
  const generatedById = new Map(generated.map((asset) => [asset.id, asset]));
  project.assets = [
    ...project.assets.filter((asset) => !generatedById.has(asset.id)),
    ...generated.map((asset) => {
      const current = project.assets.find((candidate) => candidate.id === asset.id);
      return current && current.hash === asset.hash ? { ...asset, ...(current.uri ? { uri: current.uri } : {}), ...(current.previewUrl ? { previewUrl: current.previewUrl } : {}), ...(current.thumbnailUrl ? { thumbnailUrl: current.thumbnailUrl } : {}) } : asset;
    }),
  ];

  for (const track of project.tracks) {
    track.clips = track.clips.map((clip) => {
      const sceneId = typeof clip.metadata.alystriaSceneId === "string" ? clip.metadata.alystriaSceneId : null;
      if (!sceneId) return clip;
      const render = bindings.renders?.find((binding) => binding.sceneId === sceneId);
      if (render) {
        if (track.kind === "slides" && canReplaceProjectDerivedMedia(clip, project.assets)) {
          const segmentFrames = Math.max(1, secondsToFrames((render.durationTicks ?? 0) / 240_000, project.frameRate));
          const baseFrame = Math.max(0, secondsToFrames((render.sourceStartTicks ?? 0) / 240_000, project.frameRate));
          const priorAsset = projectInput.assets.find((asset) => asset.id === clip.assetId);
          const priorBase = priorAsset?.metadata.generatedSourceStartFrame;
          // Existing composites already use master-relative offsets. Older
          // documents have the same verified scene window but no saved base.
          const previousBaseFrame = priorAsset?.metadata.generatedRole === "render"
            ? typeof priorBase === "number" && Number.isSafeInteger(priorBase) && priorBase >= 0 ? priorBase : baseFrame
            : 0;
          const localStartFrame = clip.sourceRange.startFrame - previousBaseFrame;
          if (localStartFrame < 0 || localStartFrame + clip.sourceRange.durationFrames > segmentFrames) return clip;
          return {
            ...clip,
            assetId: `generated-render-${sceneId}`,
            sourceRange: { ...clip.sourceRange, startFrame: baseFrame + localStartFrame },
            metadata: { ...clip.metadata, authoredStructureOnly: false, includeSourceAudio: true, preservedCompositeRender: true },
          };
        }
        if ((track.kind === "narration" || track.kind === "presenter") && canReplaceProjectDerivedMedia(clip, project.assets)) {
          return { ...clip, enabled: false, metadata: { ...clip.metadata, representedByCompositeRender: true } };
        }
        return clip;
      }

      const role = track.kind === "slides" ? "visual" : track.kind === "narration" ? "narration" : track.kind === "presenter" ? "presenter" : null;
      if (!role || !canReplaceProjectDerivedMedia(clip, project.assets)) return clip;
      const binding = (role === "visual" ? bindings.assets : role === "narration" ? bindings.narration : bindings.presenters).find((candidate) => candidate.sceneId === sceneId);
      if (!binding) return clip;
      const asset = generatedById.get(`generated-${role}-${sceneId}`);
      if (!asset) return clip;
      if (asset.durationFrames !== null && clip.sourceRange.startFrame + clip.sourceRange.durationFrames > asset.durationFrames) return clip;
      return { ...clip, assetId: `generated-${role}-${sceneId}`, metadata: { ...clip.metadata, authoredStructureOnly: false, scriptOnly: false, playableMediaRequired: false } };
    });
  }
  const slideTrack = project.tracks.find((track) => track.kind === "slides");
  const completeComposite = Boolean(slideTrack?.clips.length && slideTrack.clips.every((clip) => clip.assetId?.startsWith("generated-render-") === true));
  if (completeComposite) {
    for (const track of project.tracks.filter((candidate) => candidate.kind === "presenter" || candidate.kind === "music" || candidate.kind === "sfx")) {
      track.clips = track.clips.map((clip) => {
        if (clip.metadata.sourceNeedsPlayableUri !== true) return clip;
        const asset = clip.assetId ? project.assets.find((candidate) => candidate.id === clip.assetId) : null;
        if (asset?.status === "ready" || asset?.provenance.origin !== "project-derived") return clip;
        return { ...clip, enabled: false, metadata: { ...clip.metadata, representedByCompositeRender: true } };
      });
    }
  }
  reconcileBoundSceneText(project, bindings);
  project.updatedAt = now;
  return normalizeEditorProject(project);
}
