import type { EditorClip, InspectorProperty } from "./types";

function baseValue(clip: EditorClip, property: InspectorProperty): number {
  switch (property) {
    case "transform.x": return clip.transform.x;
    case "transform.y": return clip.transform.y;
    case "transform.scaleX": return clip.transform.scaleX;
    case "transform.scaleY": return clip.transform.scaleY;
    case "transform.rotation": return clip.transform.rotation;
    case "opacity": return clip.opacity;
    case "audio.volumeDb": return clip.audio.volumeDb;
    case "audio.pan": return clip.audio.pan;
  }
}

function interpolate(amount: number, mode: EditorClip["keyframes"][number]["interpolation"]): number {
  const t = Math.max(0, Math.min(1, amount));
  if (mode === "hold") return 0;
  if (mode === "ease-in") return t * t;
  if (mode === "ease-out") return 1 - ((1 - t) * (1 - t));
  if (mode === "ease-in-out") return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
  return t;
}

export function valueAtFrame(clip: EditorClip, property: InspectorProperty, frame: number): number {
  const keyframes = clip.keyframes.filter((keyframe) => keyframe.property === property).sort((left, right) => left.frame - right.frame);
  if (!keyframes.length) return baseValue(clip, property);
  const nextIndex = keyframes.findIndex((keyframe) => keyframe.frame > frame);
  if (nextIndex === 0) return baseValue(clip, property);
  if (nextIndex === -1) return keyframes[keyframes.length - 1]!.value;
  const previous = keyframes[nextIndex - 1]!;
  const next = keyframes[nextIndex]!;
  const progress = interpolate((frame - previous.frame) / Math.max(1, next.frame - previous.frame), previous.interpolation);
  return previous.value + ((next.value - previous.value) * progress);
}

export function previewStyleAtFrame(clip: EditorClip, frame: number): { transform: string; opacity: number } {
  const x = valueAtFrame(clip, "transform.x", frame);
  const y = valueAtFrame(clip, "transform.y", frame);
  const scaleX = valueAtFrame(clip, "transform.scaleX", frame);
  const scaleY = valueAtFrame(clip, "transform.scaleY", frame);
  const rotation = valueAtFrame(clip, "transform.rotation", frame);
  return {
    transform: `translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`,
    opacity: valueAtFrame(clip, "opacity", frame),
  };
}

export function volumeAtFrame(clip: EditorClip, frame: number): number {
  if (clip.audio.muted) return 0;
  const decibels = valueAtFrame(clip, "audio.volumeDb", frame);
  return Math.max(0, Math.min(1, 10 ** (decibels / 20)));
}
