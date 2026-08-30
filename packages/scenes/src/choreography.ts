import type { ChoreographyTrack, EasingName, SceneSpec } from "./types.js";
import { TIMEBASE_TICKS_PER_SECOND } from "./types.js";
import { clamp } from "./layout.js";

export function standardChoreography<T extends SceneSpec>(spec: T, targets: readonly string[] = ["header", "body"]): readonly ChoreographyTrack[] {
  const entrance = Math.min(Math.round(TIMEBASE_TICKS_PER_SECOND * 0.55), Math.round(spec.durationTicks * 0.18));
  return targets.map((target, index) => ({
    id: `enter-${target}`,
    target,
    property: "opacity" as const,
    reducedMotionBehavior: "freeze-end" as const,
    keyframes: [
      // A hard cut must still arrive on a legible, intentionally composed
      // frame.  Starting from fully transparent made scene boundaries look
      // like accidental blank frames in the encoded tutorial.  The remaining
      // 2% is enough to make the entrance perceptible without hiding the
      // teaching object at the cut.
      { tick: Math.min(spec.durationTicks - 1, index * Math.round(TIMEBASE_TICKS_PER_SECOND * 0.1)), value: 0.98 },
      { tick: Math.min(spec.durationTicks, entrance + index * Math.round(TIMEBASE_TICKS_PER_SECOND * 0.1)), value: 1, easing: "ease-out" as const },
    ],
  }));
}

export function staggeredReveal(spec: SceneSpec, ids: readonly string[]): readonly ChoreographyTrack[] {
  const step = Math.max(1, Math.min(TIMEBASE_TICKS_PER_SECOND, Math.round(spec.durationTicks * 0.65)) / Math.max(1, ids.length));
  return ids.map((id, index) => ({
    id: `reveal-${id}`,
    target: id,
    property: "reveal",
    reducedMotionBehavior: "freeze-end",
    keyframes: [
      { tick: Math.round(index * step), value: 0 },
      { tick: Math.min(spec.durationTicks, Math.round((index + 0.72) * step)), value: 1, easing: "spring-soft" },
    ],
  }));
}

export function trackValue(track: ChoreographyTrack, tick: number, reducedMotion: boolean): number {
  const frames = track.keyframes;
  if (frames.length === 0) return 1;
  if (reducedMotion) {
    switch (track.reducedMotionBehavior ?? "freeze-end") {
      case "freeze-start": return frames[0]?.value ?? 1;
      case "disable": return 1;
      case "crossfade":
      case "freeze-end": return frames[frames.length - 1]?.value ?? 1;
    }
  }
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (!first || !last) return 1;
  if (tick <= first.tick) return first.value;
  if (tick >= last.tick) return last.value;
  for (let index = 1; index < frames.length; index += 1) {
    const right = frames[index];
    const left = frames[index - 1];
    if (left && right && tick <= right.tick) {
      const progress = clamp((tick - left.tick) / Math.max(1, right.tick - left.tick), 0, 1);
      const eased = ease(progress, right.easing ?? "linear");
      return left.value + (right.value - left.value) * eased;
    }
  }
  return last.value;
}

export function animationStyle(tracks: readonly ChoreographyTrack[], target: string, tick: number, reducedMotion: boolean): Readonly<Record<string, number | string>> {
  const style: Record<string, number | string> = {};
  for (const track of tracks) {
    if (track.target !== target) continue;
    const value = trackValue(track, tick, reducedMotion);
    switch (track.property) {
      case "opacity": style.opacity = value; break;
      case "translate-x": style.transform = `translate(${value}px 0)`; break;
      case "translate-y": style.transform = `translate(0 ${value}px)`; break;
      case "scale": style.transform = `scale(${value})`; break;
      // Reveal order is communicated through motion, not by withholding the
      // teaching content.  Keeping the object legible at the first frame also
      // prevents a cut from landing on an accidentally empty composition.
      case "reveal": style.opacity = 0.96 + value * 0.04; style.transform = `translate(0 ${(1 - value) * 16}px)`; break;
      case "highlight": style.opacity = 0.45 + value * 0.55; break;
      case "draw": style.strokeDashoffset = 1 - value; break;
    }
  }
  return style;
}

function ease(value: number, name: EasingName): number {
  switch (name) {
    case "linear": return value;
    case "ease-in": return value * value * value;
    case "ease-out": return 1 - (1 - value) ** 3;
    case "ease-in-out": return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
    case "spring-soft": return clamp(1 - Math.exp(-6 * value) * Math.cos(8 * value), 0, 1.08);
    case "spring-snappy": return clamp(1 - Math.exp(-9 * value) * Math.cos(12 * value), 0, 1.12);
  }
}
