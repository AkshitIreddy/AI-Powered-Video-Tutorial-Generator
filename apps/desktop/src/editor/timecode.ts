import type { FrameRate } from "./types";

export function rateAsNumber(rate: FrameRate): number {
  if (!Number.isFinite(rate.numerator) || !Number.isFinite(rate.denominator) || rate.numerator <= 0 || rate.denominator <= 0) {
    throw new Error("Frame rate must have positive finite numerator and denominator values.");
  }
  return rate.numerator / rate.denominator;
}

export function nominalFramesPerSecond(rate: FrameRate): number {
  return Math.round(rateAsNumber(rate));
}

export function framesToSeconds(frame: number, rate: FrameRate): number {
  return Math.max(0, frame) / rateAsNumber(rate);
}

export function secondsToFrames(seconds: number, rate: FrameRate): number {
  return Math.max(0, Math.round(seconds * rateAsNumber(rate)));
}

export function formatTimecode(frame: number, rate: FrameRate): string {
  const fps = nominalFramesPerSecond(rate);
  const safeFrame = Math.max(0, Math.floor(frame));
  const frames = safeFrame % fps;
  const totalSeconds = Math.floor(safeFrame / fps);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const separator = rate.dropFrame ? ";" : ":";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(frames).padStart(2, "0")}`;
}

export function parseTimecode(value: string, rate: FrameRate): number | null {
  const match = value.trim().match(/^(\d{1,3}):(\d{1,2}):(\d{1,2})[:;](\d{1,3})$/);
  if (!match) return null;
  const [, hoursText, minutesText, secondsText, framesText] = match;
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  const seconds = Number(secondsText);
  const frames = Number(framesText);
  const fps = nominalFramesPerSecond(rate);
  if (minutes > 59 || seconds > 59 || frames >= fps) return null;
  return (((hours * 60 + minutes) * 60 + seconds) * fps) + frames;
}

export function formatDuration(frameCount: number, rate: FrameRate): string {
  const seconds = framesToSeconds(frameCount, rate);
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}
