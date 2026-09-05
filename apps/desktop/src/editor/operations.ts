import { calculateProjectDuration, cloneProject, findClip, normalizeEditorProject, sortClips } from "./model";
import type { ClipPatch, EditOperation, EditorClip, EditorKeyframe, EditorProject, EditorTrack, FrameRange } from "./types";

export interface OperationResult {
  project: EditorProject;
  changed: boolean;
  announcement: string;
}

function result(project: EditorProject, changed: boolean, announcement: string): OperationResult {
  if (!changed) return { project, changed, announcement };
  const normalized = normalizeEditorProject(project);
  return { project: { ...normalized, durationFrames: calculateProjectDuration(normalized) }, changed, announcement };
}

function replaceTrack(project: EditorProject, trackId: string, update: (track: EditorTrack) => EditorTrack): EditorProject {
  return { ...project, tracks: project.tracks.map((track) => track.id === trackId ? update(track) : track) };
}

function replaceClip(project: EditorProject, clipId: string, update: (clip: EditorClip) => EditorClip): EditorProject {
  const match = findClip(project, clipId);
  if (!match || match.track.locked || match.clip.locked) return project;
  return replaceTrack(project, match.track.id, (track) => ({
    ...track,
    clips: track.clips.map((clip) => clip.id === clipId ? update(clip) : clip),
  }));
}

function rangesOverlap(start: number, duration: number, clip: EditorClip): boolean {
  return start < clipEnd(clip) && start + duration > clip.timelineRange.startFrame;
}

function playbackRate(clip: EditorClip): number {
  return clip.playbackRate ?? 1;
}

function sourceFrames(clip: EditorClip, timelineFrames: number): number {
  return Math.max(1, Math.round(timelineFrames * playbackRate(clip)));
}

export function clipEnd(clip: EditorClip): number {
  return clip.timelineRange.startFrame + clip.timelineRange.durationFrames;
}

export function mergeRanges(ranges: readonly FrameRange[]): FrameRange[] {
  const sorted = ranges
    .filter((range) => range.durationFrames > 0)
    .map((range) => ({ startFrame: Math.max(0, range.startFrame), durationFrames: range.durationFrames }))
    .sort((left, right) => left.startFrame - right.startFrame);
  const merged: FrameRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || previous.startFrame + previous.durationFrames < range.startFrame) {
      merged.push({ ...range });
      continue;
    }
    const end = Math.max(previous.startFrame + previous.durationFrames, range.startFrame + range.durationFrames);
    previous.durationFrames = end - previous.startFrame;
  }
  return merged;
}

export function snapFrame(
  project: EditorProject,
  requestedFrame: number,
  thresholdFrames: number,
  options: { excludeClipId?: string; playheadFrame?: number } = {},
): number {
  const requested = Math.max(0, Math.round(requestedFrame));
  const candidates = new Set<number>([0, project.durationFrames, ...project.markers.map((marker) => marker.frame)]);
  if (options.playheadFrame !== undefined) candidates.add(options.playheadFrame);
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.id === options.excludeClipId) continue;
      candidates.add(clip.timelineRange.startFrame);
      candidates.add(clipEnd(clip));
    }
  }
  let best = requested;
  let distance = thresholdFrames + 1;
  for (const candidate of candidates) {
    const candidateDistance = Math.abs(candidate - requested);
    if (candidateDistance < distance) {
      best = candidate;
      distance = candidateDistance;
    }
  }
  return distance <= thresholdFrames ? best : requested;
}

export function insertClip(project: EditorProject, trackId: string, clip: EditorClip): OperationResult {
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return result(project, false, "Clip was not inserted because the destination track does not exist.");
  if (track.locked) return result(project, false, `${track.name} is locked.`);
  if (findClip(project, clip.id)) return result(project, false, `A clip with ID ${clip.id} already exists.`);
  if (clip.kind !== track.kind) return result(project, false, `${clip.kind} clips cannot be inserted on ${track.name}.`);
  if (clip.assetId && !project.assets.some((asset) => asset.id === clip.assetId)) return result(project, false, `${clip.name} refers to media that is not in this project.`);
  if (track.clips.some((candidate) => rangesOverlap(clip.timelineRange.startFrame, clip.timelineRange.durationFrames, candidate))) return result(project, false, `${clip.name} overlaps another clip on ${track.name}. Split or trim the existing clip first.`);
  const next = replaceTrack(project, trackId, (current) => ({
    ...current,
    clips: sortClips([...current.clips, {
      ...structuredClone(clip),
      trackId,
      kind: current.kind,
      timelineRange: { ...clip.timelineRange, startFrame: Math.max(0, clip.timelineRange.startFrame), durationFrames: Math.max(1, clip.timelineRange.durationFrames) },
    }]),
  }));
  return result(next, true, `${clip.name} inserted on ${track.name}.`);
}

export function moveClip(
  project: EditorProject,
  clipId: string,
  destinationTrackId: string,
  startFrame: number,
  snap: { enabled: boolean; thresholdFrames: number; playheadFrame?: number },
): OperationResult {
  const match = findClip(project, clipId);
  const destination = project.tracks.find((track) => track.id === destinationTrackId);
  if (!match || !destination) return result(project, false, "Clip move could not find its source or destination.");
  if (match.track.locked || match.clip.locked || destination.locked) return result(project, false, "Clip move was blocked by a locked clip or track.");
  if (match.clip.kind !== destination.kind) return result(project, false, `${match.clip.kind} clips cannot move to ${destination.name}.`);
  const requested = snap.enabled ? snapFrame(project, startFrame, snap.thresholdFrames, { excludeClipId: clipId, ...(snap.playheadFrame !== undefined ? { playheadFrame: snap.playheadFrame } : {}) }) : Math.max(0, Math.round(startFrame));
  if (destination.clips.some((clip) => clip.id !== clipId && rangesOverlap(requested, match.clip.timelineRange.durationFrames, clip))) return result(project, false, `${match.clip.name} overlaps another clip on ${destination.name}.`);
  let next = replaceTrack(project, match.track.id, (track) => ({ ...track, clips: track.clips.filter((clip) => clip.id !== clipId) }));
  next = replaceTrack(next, destinationTrackId, (track) => ({
    ...track,
    clips: sortClips([...track.clips, { ...match.clip, trackId: destinationTrackId, kind: track.kind, timelineRange: { ...match.clip.timelineRange, startFrame: requested } }]),
  }));
  return result(next, true, `${match.clip.name} moved to ${destination.name} at frame ${requested}.`);
}

export function splitClip(project: EditorProject, clipId: string, frame: number, rightClipId: string): OperationResult {
  const match = findClip(project, clipId);
  if (!match || match.track.locked || match.clip.locked) return result(project, false, "The clip could not be split because it is missing or locked.");
  const splitAt = Math.round(frame);
  const start = match.clip.timelineRange.startFrame;
  const end = clipEnd(match.clip);
  if (splitAt <= start || splitAt >= end) return result(project, false, "Move the playhead inside the selected clip to split it.");
  if (findClip(project, rightClipId)) return result(project, false, "The split clip ID is already in use.");
  const leftDuration = splitAt - start;
  const rightDuration = end - splitAt;
  const leftSourceDuration = sourceFrames(match.clip, leftDuration);
  const left = {
    ...match.clip,
    timelineRange: { ...match.clip.timelineRange, durationFrames: leftDuration },
    sourceRange: { ...match.clip.sourceRange, durationFrames: leftSourceDuration },
    keyframes: match.clip.keyframes.filter((keyframe) => keyframe.frame < splitAt),
  };
  const right = {
    ...structuredClone(match.clip),
    id: rightClipId,
    name: `${match.clip.name} (right)`,
    timelineRange: { startFrame: splitAt, durationFrames: rightDuration },
    sourceRange: { startFrame: match.clip.sourceRange.startFrame + leftSourceDuration, durationFrames: sourceFrames(match.clip, rightDuration) },
    keyframes: match.clip.keyframes.filter((keyframe) => keyframe.frame >= splitAt),
  };
  const next = replaceTrack(project, match.track.id, (track) => ({
    ...track,
    clips: sortClips(track.clips.flatMap((clip) => clip.id === clipId ? [left, right] : [clip])),
  }));
  return result(next, true, `${match.clip.name} split at frame ${splitAt}.`);
}

export function trimClip(project: EditorProject, clipId: string, edge: "start" | "end", frame: number): OperationResult {
  const match = findClip(project, clipId);
  if (!match || match.track.locked || match.clip.locked) return result(project, false, "The clip could not be trimmed because it is missing or locked.");
  const requested = Math.round(frame);
  const start = match.clip.timelineRange.startFrame;
  const end = clipEnd(match.clip);
  if (edge === "start") {
    const earliest = Math.max(0, start - Math.floor(match.clip.sourceRange.startFrame / playbackRate(match.clip)));
    const nextStart = Math.min(end - 1, Math.max(earliest, requested));
    const delta = nextStart - start;
    if (delta === 0) return result(project, false, "Trim start did not change.");
    if (match.track.clips.some((clip) => clip.id !== clipId && rangesOverlap(nextStart, end - nextStart, clip))) return result(project, false, `${match.clip.name} would overlap another clip on ${match.track.name}.`);
    const next = replaceClip(project, clipId, (clip) => ({
      ...clip,
      timelineRange: { startFrame: nextStart, durationFrames: clip.timelineRange.durationFrames - delta },
      sourceRange: { startFrame: clip.sourceRange.startFrame + Math.round(delta * playbackRate(clip)), durationFrames: sourceFrames(clip, clip.timelineRange.durationFrames - delta) },
      keyframes: clip.keyframes.filter((keyframe) => keyframe.frame >= nextStart),
    }));
    return result(next, true, `${match.clip.name} start trimmed to frame ${nextStart}.`);
  }
  const nextEnd = Math.max(start + 1, requested);
  const duration = nextEnd - start;
  const asset = match.clip.assetId ? project.assets.find((candidate) => candidate.id === match.clip.assetId) : undefined;
  if (asset?.durationFrames !== null && asset?.durationFrames !== undefined) {
    const maximumEnd = start + Math.max(1, Math.floor((asset.durationFrames - match.clip.sourceRange.startFrame) / playbackRate(match.clip)));
    if (nextEnd > maximumEnd) return result(project, false, `${match.clip.name} source ends at frame ${maximumEnd}.`);
  }
  if (duration === match.clip.timelineRange.durationFrames) return result(project, false, "Trim end did not change.");
  if (match.track.clips.some((clip) => clip.id !== clipId && rangesOverlap(start, duration, clip))) return result(project, false, `${match.clip.name} would overlap another clip on ${match.track.name}.`);
  const next = replaceClip(project, clipId, (clip) => ({
    ...clip,
    timelineRange: { ...clip.timelineRange, durationFrames: duration },
    sourceRange: { ...clip.sourceRange, durationFrames: sourceFrames(clip, duration) },
    keyframes: clip.keyframes.filter((keyframe) => keyframe.frame < nextEnd),
  }));
  return result(next, true, `${match.clip.name} end trimmed to frame ${nextEnd}.`);
}

export function liftClips(project: EditorProject, clipIds: readonly string[]): OperationResult {
  const selected = new Set(clipIds);
  let removed = 0;
  const tracks = project.tracks.map((track) => {
    if (track.locked) return track;
    const clips = track.clips.filter((clip) => {
      const remove = selected.has(clip.id) && !clip.locked;
      if (remove) removed += 1;
      return !remove;
    });
    return clips.length === track.clips.length ? track : { ...track, clips };
  });
  return result({ ...project, tracks }, removed > 0, removed ? `${removed} clip${removed === 1 ? "" : "s"} lifted, leaving gaps.` : "No editable clips were selected.");
}

function shiftAfterRanges(frame: number, ranges: readonly FrameRange[]): number {
  let shift = 0;
  for (const range of ranges) {
    const end = range.startFrame + range.durationFrames;
    if (frame >= end) shift += range.durationFrames;
  }
  return Math.max(0, frame - shift);
}

function shiftKeyframes(keyframes: readonly EditorKeyframe[], delta: number): EditorKeyframe[] {
  return keyframes.map((keyframe) => ({ ...keyframe, frame: Math.max(0, keyframe.frame + delta) }));
}

function uniqueDerivedClipId(project: EditorProject, clipId: string, rangeStart: number, rangeEnd: number): string {
  const base = `${clipId}-extract-${rangeStart}-${rangeEnd}`;
  let candidate = base;
  let suffix = 2;
  while (findClip(project, candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function rippleDeleteClips(project: EditorProject, clipIds: readonly string[]): OperationResult {
  const selected = new Set(clipIds);
  let removed = 0;
  const tracks = project.tracks.map((track) => {
    if (track.locked) return track;
    const ranges = mergeRanges(track.clips.filter((clip) => selected.has(clip.id) && !clip.locked).map((clip) => clip.timelineRange));
    if (!ranges.length) return track;
    const clips = track.clips.flatMap((clip) => {
      if (selected.has(clip.id) && !clip.locked) {
        removed += 1;
        return [];
      }
      return [{ ...clip, timelineRange: { ...clip.timelineRange, startFrame: shiftAfterRanges(clip.timelineRange.startFrame, ranges) } }];
    });
    return { ...track, clips: sortClips(clips) };
  });
  return result({ ...project, tracks }, removed > 0, removed ? `${removed} clip${removed === 1 ? "" : "s"} ripple deleted.` : "No editable clips were selected.");
}

export function extractRange(project: EditorProject, range: FrameRange): OperationResult {
  const rangeStart = Math.max(0, Math.round(range.startFrame));
  const rangeEnd = rangeStart + Math.max(0, Math.round(range.durationFrames));
  if (rangeEnd <= rangeStart) return result(project, false, "Extract range is empty.");
  let changed = false;
  const removedDuration = rangeEnd - rangeStart;
  const tracks = project.tracks.map((track) => {
    if (track.locked) return track;
    const clips = track.clips.flatMap((clip) => {
      if (clip.locked) return [clip];
      const start = clip.timelineRange.startFrame;
      const end = clipEnd(clip);
      if (end <= rangeStart) return [clip];
      changed = true;
      if (start >= rangeEnd) return [{ ...clip, timelineRange: { ...clip.timelineRange, startFrame: start - removedDuration }, keyframes: shiftKeyframes(clip.keyframes, -removedDuration) }];
      if (start >= rangeStart && end <= rangeEnd) return [];
      if (start < rangeStart && end > rangeEnd) {
        const leftDuration = rangeStart - start;
        const rightDuration = end - rangeEnd;
        return [{
          ...clip,
          timelineRange: { ...clip.timelineRange, durationFrames: leftDuration },
          sourceRange: { ...clip.sourceRange, durationFrames: sourceFrames(clip, leftDuration) },
          keyframes: clip.keyframes.filter((keyframe) => keyframe.frame < rangeStart),
        }, {
          ...structuredClone(clip),
          id: uniqueDerivedClipId(project, clip.id, rangeStart, rangeEnd),
          name: `${clip.name} (after extract)`,
          timelineRange: { startFrame: rangeStart, durationFrames: rightDuration },
          sourceRange: { startFrame: clip.sourceRange.startFrame + Math.round((rangeEnd - start) * playbackRate(clip)), durationFrames: sourceFrames(clip, rightDuration) },
          keyframes: shiftKeyframes(clip.keyframes.filter((keyframe) => keyframe.frame >= rangeEnd), -removedDuration),
        }];
      }
      if (start < rangeStart) {
        const durationFrames = rangeStart - start;
        return [{ ...clip, timelineRange: { ...clip.timelineRange, durationFrames }, sourceRange: { ...clip.sourceRange, durationFrames: sourceFrames(clip, durationFrames) }, keyframes: clip.keyframes.filter((keyframe) => keyframe.frame < rangeStart) }];
      }
      const consumed = rangeEnd - start;
      return [{
        ...clip,
        timelineRange: { startFrame: rangeStart, durationFrames: end - rangeEnd },
        sourceRange: { startFrame: clip.sourceRange.startFrame + Math.round(consumed * playbackRate(clip)), durationFrames: sourceFrames(clip, end - rangeEnd) },
        keyframes: shiftKeyframes(clip.keyframes.filter((keyframe) => keyframe.frame >= rangeEnd), -removedDuration),
      }];
    });
    return { ...track, clips: sortClips(clips) };
  });
  const markers = project.markers.flatMap((marker) => marker.frame < rangeStart
    ? [marker]
    : marker.frame >= rangeEnd
      ? [{ ...marker, frame: marker.frame - removedDuration }]
      : []);
  return result({ ...project, tracks, markers }, changed, changed ? `Extracted frames ${rangeStart} through ${rangeEnd} across unlocked tracks.` : "Nothing intersects the extract range.");
}

export function reorderClip(project: EditorProject, clipId: string, direction: "previous" | "next"): OperationResult {
  const match = findClip(project, clipId);
  if (!match || match.track.locked || match.clip.locked) return result(project, false, "The clip could not be reordered because it is missing or locked.");
  const ordered = sortClips(match.track.clips);
  const selectedIndex = ordered.findIndex((clip) => clip.id === clipId);
  const selectedGroup = match.clip.linkedGroupId;
  const adjacent = direction === "previous"
    ? ordered.slice(0, selectedIndex).reverse().find((clip) => !selectedGroup || clip.linkedGroupId !== selectedGroup)
    : ordered.slice(selectedIndex + 1).find((clip) => !selectedGroup || clip.linkedGroupId !== selectedGroup);
  if (!adjacent) return result(project, false, `${match.clip.name} is already ${direction === "previous" ? "first" : "last"}.`);

  const adjacentGroup = adjacent.linkedGroupId;
  if (selectedGroup && adjacentGroup) {
    const affected = project.tracks.flatMap((track) => track.clips.filter((clip) => clip.linkedGroupId === selectedGroup || clip.linkedGroupId === adjacentGroup).map((clip) => ({ track, clip })));
    if (affected.some(({ track, clip }) => track.locked || clip.locked)) return result(project, false, "The linked scene could not be reordered because one of its clips or tracks is locked.");
    const selectedClips = affected.filter(({ clip }) => clip.linkedGroupId === selectedGroup).map(({ clip }) => clip);
    const adjacentClips = affected.filter(({ clip }) => clip.linkedGroupId === adjacentGroup).map(({ clip }) => clip);
    const selectedGroupStart = Math.min(...selectedClips.map((clip) => clip.timelineRange.startFrame));
    const selectedGroupEnd = Math.max(...selectedClips.map((clip) => clip.timelineRange.startFrame + clip.timelineRange.durationFrames));
    const adjacentGroupStart = Math.min(...adjacentClips.map((clip) => clip.timelineRange.startFrame));
    const adjacentGroupEnd = Math.max(...adjacentClips.map((clip) => clip.timelineRange.startFrame + clip.timelineRange.durationFrames));
    const selectedSpan = selectedGroupEnd - selectedGroupStart;
    const adjacentSpan = adjacentGroupEnd - adjacentGroupStart;
    const firstStart = Math.min(selectedGroupStart, adjacentGroupStart);
    const selectedTarget = direction === "previous" ? firstStart : firstStart + adjacentSpan;
    const adjacentTarget = direction === "previous" ? firstStart + selectedSpan : firstStart;
    const selectedDelta = selectedTarget - selectedGroupStart;
    const adjacentDelta = adjacentTarget - adjacentGroupStart;
    const tracks = project.tracks.map((track) => ({
      ...track,
      clips: sortClips(track.clips.map((clip) => clip.linkedGroupId === selectedGroup
        ? { ...clip, timelineRange: { ...clip.timelineRange, startFrame: clip.timelineRange.startFrame + selectedDelta }, keyframes: shiftKeyframes(clip.keyframes, selectedDelta) }
        : clip.linkedGroupId === adjacentGroup
          ? { ...clip, timelineRange: { ...clip.timelineRange, startFrame: clip.timelineRange.startFrame + adjacentDelta }, keyframes: shiftKeyframes(clip.keyframes, adjacentDelta) }
          : clip)),
    }));
    return result({ ...project, tracks }, true, `${match.clip.name} moved ${direction} with its linked scene clips.`);
  }

  if (selectedGroup || adjacentGroup) return result(project, false, "Linked scene clips can only be reordered beside another linked scene.");
  const firstStart = Math.min(match.clip.timelineRange.startFrame, adjacent.timelineRange.startFrame);
  const selectedStart = direction === "previous" ? firstStart : firstStart + adjacent.timelineRange.durationFrames;
  const adjacentStart = direction === "previous" ? firstStart + match.clip.timelineRange.durationFrames : firstStart;
  const next = replaceTrack(project, match.track.id, (track) => ({
    ...track,
    clips: sortClips(track.clips.map((clip) => clip.id === match.clip.id
      ? { ...clip, timelineRange: { ...clip.timelineRange, startFrame: selectedStart }, keyframes: shiftKeyframes(clip.keyframes, selectedStart - clip.timelineRange.startFrame) }
      : clip.id === adjacent.id
        ? { ...clip, timelineRange: { ...clip.timelineRange, startFrame: adjacentStart }, keyframes: shiftKeyframes(clip.keyframes, adjacentStart - clip.timelineRange.startFrame) }
        : clip)),
  }));
  return result(next, true, `${match.clip.name} moved ${direction}.`);
}

export function updateClip(project: EditorProject, clipId: string, patch: ClipPatch): OperationResult {
  const match = findClip(project, clipId);
  if (!match) return result(project, false, "Clip not found.");
  if (patch.playbackRate !== undefined) {
    if (!Number.isFinite(patch.playbackRate) || patch.playbackRate < 0.25 || patch.playbackRate > 4) return result(project, false, "Clip speed must be between 0.25× and 4×.");
    const durationFrames = Math.max(1, Math.round(match.clip.sourceRange.durationFrames / patch.playbackRate));
    if (match.track.clips.some((clip) => clip.id !== clipId && rangesOverlap(match.clip.timelineRange.startFrame, durationFrames, clip))) return result(project, false, `${match.clip.name} would overlap another clip at that speed.`);
    const oldDuration = match.clip.timelineRange.durationFrames;
    const startFrame = match.clip.timelineRange.startFrame;
    const speedAdjusted = replaceClip(project, clipId, (clip) => ({
      ...clip,
      ...structuredClone(patch),
      timelineRange: { ...clip.timelineRange, durationFrames },
      keyframes: clip.keyframes
        .map((keyframe) => ({ ...keyframe, frame: startFrame + Math.round(((keyframe.frame - startFrame) / oldDuration) * durationFrames) }))
        .filter((keyframe) => keyframe.frame < startFrame + durationFrames),
    }));
    return result(speedAdjusted, speedAdjusted !== project, speedAdjusted !== project ? `${match.clip.name} speed changed to ${patch.playbackRate}×.` : `${match.clip.name} is locked.`);
  }
  const next = replaceClip(project, clipId, (clip) => ({
    ...clip,
    ...structuredClone(patch),
    transform: patch.transform ? { ...clip.transform, ...patch.transform } : clip.transform,
    audio: patch.audio ? { ...clip.audio, ...patch.audio } : clip.audio,
    ...(patch.textStyle ? { textStyle: { ...(clip.textStyle ?? patch.textStyle), ...patch.textStyle } } : {}),
    metadata: patch.metadata ? { ...clip.metadata, ...patch.metadata } : clip.metadata,
  }));
  return result(next, next !== project, next !== project ? `${match.clip.name} updated.` : `${match.clip.name} is locked.`);
}

export function updateLinkedTranscript(project: EditorProject, clipId: string, text: string, speaker?: string): OperationResult {
  const match = findClip(project, clipId);
  if (!match) return result(project, false, "Transcript cue not found.");
  const linkedGroupId = match.clip.linkedGroupId;
  const captionCueId = typeof match.clip.metadata.alystriaCaptionCueId === "string"
    ? match.clip.metadata.alystriaCaptionCueId
    : null;
  const captionSceneId = typeof match.clip.metadata.alystriaSceneId === "string"
    ? match.clip.metadata.alystriaSceneId
    : null;
  const targets = captionCueId
    ? project.tracks.flatMap((track) => track.clips).filter((clip) => clip.metadata.alystriaCaptionCueId === captionCueId
      && (linkedGroupId ? clip.linkedGroupId === linkedGroupId : clip.metadata.alystriaSceneId === captionSceneId)
      && (clip.kind === "captions" || clip.kind === "narration"))
    : linkedGroupId
    ? project.tracks.flatMap((track) => track.clips).filter((clip) => clip.linkedGroupId === linkedGroupId && (clip.kind === "captions" || clip.kind === "narration"))
    : [match.clip];
  let current = project;
  let changed = 0;
  for (const target of targets) {
    const edit = updateClip(current, target.id, { text, ...(speaker !== undefined ? { speaker } : {}) });
    if (edit.changed) {
      current = edit.project;
      changed += 1;
    }
  }
  return result(current, changed > 0, changed > 1 ? "Caption and narration updated together." : `${match.clip.name} updated.`);
}

export function addKeyframe(project: EditorProject, clipId: string, keyframe: EditorKeyframe): OperationResult {
  const match = findClip(project, clipId);
  if (!match || match.track.locked || match.clip.locked) return result(project, false, "Keyframe was not added because the clip is missing or locked.");
  if (!Number.isFinite(keyframe.frame) || !Number.isFinite(keyframe.value) || keyframe.frame < match.clip.timelineRange.startFrame || keyframe.frame >= clipEnd(match.clip)) return result(project, false, "Place the playhead inside the clip before adding a keyframe.");
  const next = replaceClip(project, clipId, (clip) => ({
    ...clip,
    keyframes: [...clip.keyframes.filter((candidate) => candidate.id !== keyframe.id), structuredClone(keyframe)].sort((left, right) => left.frame - right.frame),
  }));
  return result(next, next !== project, next !== project ? `Keyframe added at frame ${keyframe.frame}.` : "Keyframe was not added.");
}

export function updateKeyframe(project: EditorProject, clipId: string, keyframeId: string, patch: Partial<EditorKeyframe>): OperationResult {
  const match = findClip(project, clipId);
  const existing = match?.clip.keyframes.find((keyframe) => keyframe.id === keyframeId);
  if (!match || !existing) return result(project, false, "Keyframe not found.");
  const nextFrame = patch.frame ?? existing.frame;
  const nextValue = patch.value ?? existing.value;
  if (!Number.isFinite(nextFrame) || !Number.isFinite(nextValue) || nextFrame < match.clip.timelineRange.startFrame || nextFrame >= clipEnd(match.clip)) return result(project, false, "Keyframe must remain inside its clip.");
  const next = replaceClip(project, clipId, (clip) => ({
    ...clip,
    keyframes: clip.keyframes.map((keyframe) => keyframe.id === keyframeId ? { ...keyframe, ...patch } : keyframe).sort((left, right) => left.frame - right.frame),
  }));
  return result(next, next !== project, next !== project ? "Keyframe updated." : "Keyframe was not updated.");
}

export function removeKeyframe(project: EditorProject, clipId: string, keyframeId: string): OperationResult {
  const match = findClip(project, clipId);
  if (!match || !match.clip.keyframes.some((keyframe) => keyframe.id === keyframeId)) return result(project, false, "Keyframe not found.");
  const next = replaceClip(project, clipId, (clip) => ({ ...clip, keyframes: clip.keyframes.filter((keyframe) => keyframe.id !== keyframeId) }));
  return result(next, next !== project, next !== project ? "Keyframe removed." : "Keyframe was not removed.");
}

export function applyEditOperation(
  project: EditorProject,
  operation: EditOperation,
  options: { snappingEnabled?: boolean; snapThresholdFrames?: number; playheadFrame?: number } = {},
): OperationResult {
  switch (operation.type) {
    case "insert-clip": return insertClip(project, operation.trackId, operation.clip);
    case "remove-clips": return operation.ripple ? rippleDeleteClips(project, operation.clipIds) : liftClips(project, operation.clipIds);
    case "move-clip": return moveClip(project, operation.clipId, operation.trackId, operation.startFrame, {
      enabled: operation.snap ?? options.snappingEnabled ?? false,
      thresholdFrames: options.snapThresholdFrames ?? 5,
      ...(options.playheadFrame !== undefined ? { playheadFrame: options.playheadFrame } : {}),
    });
    case "reorder-clip": return reorderClip(project, operation.clipId, operation.direction);
    case "trim-clip": return trimClip(project, operation.clipId, operation.edge, operation.frame);
    case "split-clip": return splitClip(project, operation.clipId, operation.frame, operation.rightClipId);
    case "update-clip": return updateClip(project, operation.clipId, operation.patch);
    case "set-transcript": return updateLinkedTranscript(project, operation.clipId, operation.text, operation.speaker);
    case "add-marker": {
      if (project.markers.some((marker) => marker.id === operation.marker.id)) return result(project, false, "Marker ID already exists.");
      return result({ ...project, markers: [...project.markers, structuredClone(operation.marker)].sort((left, right) => left.frame - right.frame) }, true, `${operation.marker.label} marker added.`);
    }
  }
}

export function applyEditOperations(project: EditorProject, operations: readonly EditOperation[]): OperationResult {
  let current = cloneProject(project);
  let changed = false;
  const announcements: string[] = [];
  for (const operation of operations) {
    const operationResult = applyEditOperation(current, operation);
    current = operationResult.project;
    changed ||= operationResult.changed;
    if (operationResult.changed) announcements.push(operationResult.announcement);
  }
  return result(current, changed, announcements.join(" ") || "Proposal made no applicable changes.");
}
