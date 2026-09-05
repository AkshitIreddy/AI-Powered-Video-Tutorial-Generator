import type { CSSProperties } from "react";
import type { EditorCanvasSettings, EditorClip, InspectorProperty, TextStyle } from "./types";

export interface PreviewCanvasSize { width: number; height: number }
export interface PreviewCanvasScale { x: number; y: number }
export const PREVIEW_MEDIA_SYNC_TOLERANCE_SECONDS = 0.1;
export const PREVIEW_MEDIA_SEEK_COOLDOWN_SECONDS = 0.75;

export function previewCanvasScale(canvas: Pick<EditorCanvasSettings, "width" | "height">, preview: PreviewCanvasSize): PreviewCanvasScale {
  return {
    x: preview.width > 0 && canvas.width > 0 ? preview.width / canvas.width : 1,
    y: preview.height > 0 && canvas.height > 0 ? preview.height / canvas.height : 1,
  };
}

export function previewMediaShouldSeek(currentTime: number, expectedTime: number, options: { playing: boolean; enteringPlayback: boolean; clipChanged: boolean; secondsSinceLastSeek?: number }): boolean {
  if (!options.playing || options.enteringPlayback || options.clipChanged) return true;
  return Math.abs(currentTime - expectedTime) > PREVIEW_MEDIA_SYNC_TOLERANCE_SECONDS
    && (options.secondsSinceLastSeek ?? Number.POSITIVE_INFINITY) >= PREVIEW_MEDIA_SEEK_COOLDOWN_SECONDS;
}

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

export function previewStyleAtFrame(clip: EditorClip, frame: number, scale: PreviewCanvasScale = { x: 1, y: 1 }): { transform: string; opacity: number; transformOrigin: string } {
  const x = valueAtFrame(clip, "transform.x", frame);
  const y = valueAtFrame(clip, "transform.y", frame);
  const scaleX = valueAtFrame(clip, "transform.scaleX", frame);
  const scaleY = valueAtFrame(clip, "transform.scaleY", frame);
  const rotation = valueAtFrame(clip, "transform.rotation", frame);
  return {
    transform: `translate(${x * scale.x}px, ${y * scale.y}px) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`,
    transformOrigin: "center center",
    opacity: valueAtFrame(clip, "opacity", frame),
  };
}

export function resolvedTextStyle(clip: EditorClip): TextStyle {
  return clip.textStyle ?? {
    fontFamily: "sans-serif",
    fontSize: clip.kind === "titles" ? 64 : 42,
    fontWeight: 600,
    color: "#FFFFFF",
    backgroundColor: clip.kind === "captions" ? "#000000" : null,
    align: "center",
    position: clip.kind === "titles" ? "center" : "bottom",
  };
}

/** Mirrors the current native FFmpeg drawtext placement. The native exporter
 * intentionally uses its pinned Arial/DejaVu fallback until font assets are
 * bound, so the preview does not claim the authored family or weight. */
export function textPreviewStyleAtFrame(clip: EditorClip, frame: number, scale: PreviewCanvasScale = { x: 1, y: 1 }): CSSProperties {
  const style = resolvedTextStyle(clip);
  const x = valueAtFrame(clip, "transform.x", frame) * scale.x;
  const y = valueAtFrame(clip, "transform.y", frame) * scale.y;
  const anchorX = style.align === "left" ? 0 : style.align === "right" ? -100 : -50;
  const left = style.align === "left" ? "5%" : style.align === "right" ? "95%" : "50%";
  const anchorY = style.position === "top" ? 0 : style.position === "bottom" ? -100 : -50;
  const top = style.position === "top" ? "5%" : style.position === "bottom" ? "95%" : "50%";
  const uniformScale = Math.min(scale.x, scale.y);
  const backgroundSpread = style.backgroundColor ? 12 * uniformScale : 0;
  return {
    left,
    right: "auto",
    top,
    bottom: "auto",
    width: "max-content",
    maxWidth: "none",
    padding: 0,
    color: style.color,
    backgroundColor: style.backgroundColor ? `color-mix(in srgb, ${style.backgroundColor} 75%, transparent)` : "transparent",
    boxShadow: style.backgroundColor ? `0 0 0 ${backgroundSpread}px color-mix(in srgb, ${style.backgroundColor} 75%, transparent)` : "none",
    fontFamily: "Arial, 'DejaVu Sans', sans-serif",
    fontSize: `${style.fontSize * uniformScale}px`,
    fontWeight: 400,
    lineHeight: 1.2,
    textAlign: style.align,
    whiteSpace: "pre",
    textShadow: "none",
    borderRadius: 0,
    transform: `translate(calc(${anchorX}% + ${x}px), calc(${anchorY}% + ${y}px))`,
    transformOrigin: "center center",
    opacity: valueAtFrame(clip, "opacity", frame),
  };
}

export function volumeAtFrame(clip: EditorClip, frame: number): number {
  if (clip.audio.muted) return 0;
  const decibels = valueAtFrame(clip, "audio.volumeDb", frame);
  return Math.max(0, Math.min(1, 10 ** (decibels / 20)));
}
