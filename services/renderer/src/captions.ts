import type { CaptionCue, RenderTarget } from "./contracts.js";
import { TICKS_PER_SECOND } from "./timebase.js";

const XML_ESCAPE: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeMarkup(value: string): string {
  return value.replace(/[&<>"']/g, (character) => XML_ESCAPE[character] ?? character);
}

function escapeCaptionText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function validateCaptionCues(cues: readonly CaptionCue[]): void {
  let previousStart = -1;
  const ids = new Set<string>();
  for (const cue of cues) {
    if (!cue.id.trim() || ids.has(cue.id)) throw new TypeError(`Caption id must be unique and non-empty: ${cue.id}`);
    ids.add(cue.id);
    if (!Number.isSafeInteger(cue.startTick) || !Number.isSafeInteger(cue.endTick) || cue.startTick < 0 || cue.endTick <= cue.startTick) {
      throw new RangeError(`Caption ${cue.id} has an invalid tick interval`);
    }
    if (cue.startTick < previousStart) throw new RangeError("Caption cues must be sorted by startTick");
    if (!cue.text.trim()) throw new TypeError(`Caption ${cue.id} text must not be empty`);
    previousStart = cue.startTick;
  }
}

export function activeCaptionCues(cues: readonly CaptionCue[], tick: number): readonly CaptionCue[] {
  return cues.filter((cue) => cue.startTick <= tick && tick < cue.endTick);
}

function timestamp(tick: number, separator: "." | ","): string {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError(`Caption tick must be non-negative, got ${tick}`);
  const milliseconds = Math.round((tick * 1_000) / TICKS_PER_SECOND);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}

export function toWebVtt(cues: readonly CaptionCue[]): string {
  validateCaptionCues(cues);
  const blocks = cues.map((cue) => {
    const settings = cue.position === "top" ? " line:10%" : " line:90%";
    const speaker = cue.speaker ? `<v ${escapeCaptionText(cue.speaker)}>` : "";
    return `${cue.id}\n${timestamp(cue.startTick, ".")} --> ${timestamp(cue.endTick, ".")}${settings}\n${speaker}${escapeCaptionText(cue.text)}`;
  });
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

export function toSrt(cues: readonly CaptionCue[]): string {
  validateCaptionCues(cues);
  return `${cues.map((cue, index) => `${index + 1}\n${timestamp(cue.startTick, ",")} --> ${timestamp(cue.endTick, ",")}\n${cue.speaker ? `${escapeCaptionText(cue.speaker)}: ` : ""}${escapeCaptionText(cue.text)}`).join("\n\n")}\n`;
}

function wrapCaption(value: string, maximumCharacters: number): readonly string[] {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || (current.length + 1 + word.length > maximumCharacters && lines.length < 2)) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  return lines.slice(0, 2);
}

export function renderCaptionSvg(cues: readonly CaptionCue[], tick: number, target: RenderTarget): string {
  const active = activeCaptionCues(cues, tick);
  if (active.length === 0) return "";
  const cue = active[0] as CaptionCue;
  const position = cue.position === "top" ? Math.round(target.height * 0.12) : Math.round(target.height * 0.88);
  const baseFontSize = Math.max(22, Math.round(Math.min(target.width, target.height) * 0.034));
  const maxWidth = Math.round(target.width * 0.84);
  const maximumCharacters = Math.max(22, Math.floor(maxWidth / (baseFontSize * 0.55)));
  const lines = wrapCaption(cue.text, maximumCharacters);
  const text = escapeMarkup(cue.text);
  const longestLine = Math.max(...lines.map((line) => line.length + (cue.speaker ? cue.speaker.length + 2 : 0)));
  const fontSize = Math.max(18, Math.min(baseFontSize, Math.floor(maxWidth / Math.max(1, longestLine * 0.55))));
  const twoLines = lines.length > 1;
  const rectY = position - fontSize * (twoLines ? 1.75 : 1.35);
  const rectHeight = fontSize * (twoLines ? 2.65 : 1.8);
  const tspans = lines.map((line, index) => {
    const speaker = index === 0 && cue.speaker ? `<tspan font-weight="700">${escapeMarkup(cue.speaker)}: </tspan>` : "";
    const y = position + (index - (lines.length - 1) / 2) * fontSize * 1.18;
    return `<tspan x="${target.width / 2}" y="${y.toFixed(1)}">${speaker}${escapeMarkup(line)}</tspan>`;
  }).join("");
  return `<g data-caption-id="${escapeMarkup(cue.id)}" role="note" aria-label="${text}">
    <rect x="${Math.round((target.width - maxWidth) / 2)}" y="${rectY.toFixed(1)}" width="${maxWidth}" height="${rectHeight.toFixed(1)}" rx="${Math.round(fontSize * 0.4)}" fill="#151827" fill-opacity="0.9"/>
    <text text-anchor="middle" fill="#ffffff" font-family="Atkinson Hyperlegible, Arial, sans-serif" font-size="${fontSize}">${tspans}</text>
  </g>`;
}
