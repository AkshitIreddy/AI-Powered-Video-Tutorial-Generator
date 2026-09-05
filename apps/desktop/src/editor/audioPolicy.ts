import type { EditorClip, EditorProject, EditorTrack } from "./types";

const audioTrackKinds = new Set<EditorTrack["kind"]>(["narration", "music", "sfx"]);

export function clipCarriesProgrammeAudio(track: EditorTrack, clip: EditorClip): boolean {
  return audioTrackKinds.has(track.kind) || clip.metadata.includeSourceAudio === true;
}

export function trackCarriesProgrammeAudio(track: EditorTrack): boolean {
  return track.clips.some((clip) => clip.enabled && clipCarriesProgrammeAudio(track, clip));
}

export function isTrackAudible(project: EditorProject, track: EditorTrack): boolean {
  if (track.hidden || track.muted || !trackCarriesProgrammeAudio(track)) return false;
  const anySolo = project.tracks.some((candidate) => !candidate.hidden && candidate.solo && trackCarriesProgrammeAudio(candidate));
  return !anySolo || track.solo;
}

export function isClipAudible(project: EditorProject, track: EditorTrack, clip: EditorClip): boolean {
  return clip.enabled && !clip.audio.muted && clipCarriesProgrammeAudio(track, clip) && isTrackAudible(project, track);
}
