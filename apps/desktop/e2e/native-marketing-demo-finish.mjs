import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  marketingCaptionStyle,
  marketingPresenterOrder,
  validateMarketingAssetManifest,
} from "./native-marketing-demo-edit.mjs";

const execFileAsync = promisify(execFile);
const modulePath = fileURLToPath(import.meta.url);
const productBeatIds = ["native-review", "native-editor", "native-assets", "native-models", "native-export"];
const transitionSeconds = 0.16;

export function buildMarketingFinishPlan(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || !["draft", "final"].includes(manifest.mode)) throw new Error("Marketing finish manifest must use schemaVersion 1 and mode draft/final");
  if (manifest.mode === "draft" && !String(manifest.draftWatermark ?? "").trim()) throw new Error("Draft finishing requires a visible draftWatermark");
  const edit = manifest.adaptiveEdit;
  if (!edit?.mp4 || !edit?.webp || edit.mp4.width !== 1440 || edit.mp4.height !== 810 || edit.mp4.fps !== 25) throw new Error("Marketing finish manifest needs the prepared 1440x810/25fps adaptive edit");
  const tutorialBeats = edit.mp4.beats.filter((beat) => beat.id.startsWith("tutorial-"));
  const productBeats = edit.mp4.beats.filter((beat) => productBeatIds.includes(beat.id));
  const endCard = edit.mp4.beats.find((beat) => beat.id === "end-card");
  if (tutorialBeats.length !== 3 || productBeats.length !== productBeatIds.length || !endCard) throw new Error("Marketing MP4 edit has an incomplete tutorial/product/end-card sequence");
  if (productBeats.some((beat, index) => beat.id !== productBeatIds[index] || !Number.isFinite(beat.editorialZoom) || beat.editorialZoom < 1 || beat.editorialZoom > 1.4 || !beat.focusRegion)) {
    throw new Error("Marketing product beats need ordered bounded editorial close-ups");
  }
  const sourceSegments = manifest.assets?.nativeUiCapture?.segments;
  if (!sourceSegments || productBeatIds.some((id) => !validSourceRange(sourceSegments[id]))) throw new Error("Native UI capture needs encoded-frame source ranges for every product beat");
  const productSegments = manifest.productSegments;
  if (!Array.isArray(productSegments) || productSegments.length !== productBeatIds.length || productSegments.some((segment, index) => segment.id !== productBeatIds[index] || !validSourceRange(segment))) {
    throw new Error("Product narration needs five ordered verified source ranges");
  }
  const teachingDuration = Number(manifest.assets?.teachingVoice?.durationSeconds);
  const teachingBeatDuration = round3(productBeats[0].in);
  if (!Number.isFinite(teachingDuration) || teachingDuration <= 0 || teachingBeatDuration < teachingDuration) throw new Error("Teaching audio cannot fit the tutorial block");
  const mp4Segments = [
    { id: "tutorial", durationSeconds: teachingBeatDuration, source: "nativeTutorialExport", sourceIn: 0, sourceOut: teachingDuration, editorialZoom: 1.035, focusX: 0.5, focusY: 0.5 },
    ...productBeats.map((beat) => ({
      id: beat.id,
      durationSeconds: round3(beat.out - beat.in),
      source: "nativeUiCapture",
      sourceIn: Number(sourceSegments[beat.id].sourceIn),
      sourceOut: Number(sourceSegments[beat.id].sourceOut),
      editorialZoom: Number(beat.editorialZoom),
      focusX: Number(sourceSegments[beat.id].focusX ?? focusFor(beat.id).x),
      focusY: Number(sourceSegments[beat.id].focusY ?? focusFor(beat.id).y),
      captionText: productSegments[productBeatIds.indexOf(beat.id)].text,
      captionPlacement: beat.id === "native-editor" ? "top-left" : beat.id === "native-models" ? "top-right" : "bottom-center",
      focusRegion: beat.focusRegion,
    })),
    { id: "end-card", durationSeconds: round3(endCard.out - endCard.in), source: "nativeUiCaptureStill", sourceSeconds: Number(manifest.assets.nativeUiCapture.endCardSourceSeconds ?? sourceSegments["native-export"].sourceOut - 0.04), editorialZoom: 1.08, focusX: 0.5, focusY: 0.5, captionText: "From question to clear lesson." },
  ];
  const durationSeconds = round3(mp4Segments.reduce((sum, segment) => sum + segment.durationSeconds, 0));
  if (Math.abs(durationSeconds - edit.mp4.durationSeconds) > 0.08 || durationSeconds < 35 || durationSeconds > 50) throw new Error("Finishing segments do not cover the prepared 35–50 second MP4");
  const webpBeats = edit.webp.beats;
  if (!Array.isArray(webpBeats) || webpBeats.length !== 5 || webpBeats.slice(0, 4).some((beat, index) => beat.presenterStyle !== marketingPresenterOrder[index] || !validSourceRange(beat))) {
    throw new Error("Animated WebP must sample the four ordered presenter styles before the editor");
  }
  return {
    schemaVersion: 1,
    mode: manifest.mode,
    draftWatermark: manifest.mode === "draft" ? manifest.draftWatermark : null,
    mp4: { durationSeconds, width: 1440, height: 810, fps: 25, transitionSeconds, segments: mp4Segments },
    webp: {
      durationSeconds: Number(edit.webp.durationSeconds), width: 960, height: 540, fps: Number(edit.webp.fps),
      segments: [
        ...webpBeats.slice(0, 4).map((beat) => ({ id: beat.id, presenterStyle: beat.presenterStyle, durationSeconds: round3(beat.out - beat.in), source: "nativeTutorialExport", sourceIn: Number(beat.sourceIn), sourceOut: Number(beat.sourceOut), editorialZoom: 1.035, focusX: 0.5, focusY: 0.5 })),
        { id: "actual-native-editor", durationSeconds: round3(webpBeats[4].out - webpBeats[4].in), source: "nativeUiCapture", sourceIn: Number(sourceSegments["native-editor"].sourceIn), sourceOut: Number(sourceSegments["native-editor"].sourceOut), editorialZoom: 1.34, focusX: Number(sourceSegments["native-editor"].focusX ?? 0.48), focusY: Number(sourceSegments["native-editor"].focusY ?? 0.58), captionText: "Edit every word and beat." },
      ],
    },
    audio: {
      teachingDurationSeconds: teachingDuration,
      teachingHoldSeconds: round3(teachingBeatDuration - teachingDuration),
      productSegments: productBeats.map((beat, index) => ({ id: beat.id, sourceIn: Number(productSegments[index].startSeconds), sourceOut: Number(productSegments[index].endSeconds), durationSeconds: round3(beat.out - beat.in) })),
      endSilenceSeconds: round3(endCard.out - endCard.in),
      targetIntegratedLufs: Number(manifest.audioFinishContract?.targetIntegratedLufs ?? -16),
      maximumTruePeakDbtp: Number(manifest.audioFinishContract?.maximumTruePeakDbtp ?? -1.5),
      loudnessRangeLu: 7,
    },
  };
}

export function wrapMarketingCaption(text, maximumCharacters = 44) {
  const words = String(text ?? "").trim().split(/\s+/u).filter(Boolean);
  if (!words.length) throw new Error("Caption text is empty");
  const lines = [""];
  for (const word of words) {
    const next = lines.at(-1) ? `${lines.at(-1)} ${word}` : word;
    if (next.length <= maximumCharacters || lines.at(-1) === "") lines[lines.length - 1] = next;
    else if (lines.length < marketingCaptionStyle.maximumLines) lines.push(word);
    else lines[lines.length - 1] = `${lines.at(-1)} ${word}`;
  }
  return lines;
}

export function inspectAnimatedWebp(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") throw new Error("Animated WebP does not have a RIFF/WEBP header");
  let offset = 12;
  let frameCount = 0;
  let durationMilliseconds = 0;
  let animated = false;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const payload = offset + 8;
    if (payload + size > buffer.length) throw new Error(`Animated WebP chunk ${type} exceeds the file`);
    if (type === "ANIM") animated = true;
    if (type === "ANMF") {
      if (size < 16) throw new Error("Animated WebP frame header is truncated");
      frameCount += 1;
      durationMilliseconds += buffer[payload + 12] | (buffer[payload + 13] << 8) | (buffer[payload + 14] << 16);
    }
    offset = payload + size + (size % 2);
  }
  if (!animated || frameCount < 2 || durationMilliseconds <= 0) throw new Error("WebP is not a multi-frame animation");
  return { animated, frameCount, durationMilliseconds };
}

export async function validateMarketingFinishManifest(manifestPath, { ffprobePath, stage = "preflight" } = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const plan = buildMarketingFinishPlan(manifest);
  if (manifest.mode === "final") await validateMarketingAssetManifest(manifestPath, { ffprobePath, stage: "final-edit" });
  for (const key of ["teachingVoice", "productVoice", "music", "nativeTutorialExport", "nativeUiCapture"]) await validateHashedFile(manifest.assets?.[key], key);
  if (manifest.mode === "final") {
    if (manifest.assets.nativeTutorialExport.actualNativeEditorRender !== true || manifest.assets.nativeTutorialExport.fixtureUi === true) throw new Error("Final teaching video is not an actual native editor render");
    if (manifest.assets.nativeUiCapture.actualNativeWebView !== true || manifest.assets.nativeUiCapture.fixtureUi === true || manifest.assets.nativeUiCapture.encodedFrameAnchors !== true) throw new Error("Final UI capture lacks actual-native encoded-frame evidence");
  }
  const probes = ffprobePath ? {
    nativeTutorialExport: await probeMedia(ffprobePath, manifest.assets.nativeTutorialExport.path),
    nativeUiCapture: await probeMedia(ffprobePath, manifest.assets.nativeUiCapture.path),
    teachingVoice: await probeMedia(ffprobePath, manifest.assets.teachingVoice.path),
    productVoice: await probeMedia(ffprobePath, manifest.assets.productVoice.path),
  } : {};
  if (ffprobePath) {
    if (!probes.nativeTutorialExport.video || !probes.nativeUiCapture.video || !probes.teachingVoice.audio || !probes.productVoice.audio) throw new Error("Finisher inputs have the wrong media streams");
    if (probes.nativeUiCapture.durationSeconds + 0.08 < Math.max(...Object.values(manifest.assets.nativeUiCapture.segments).map((segment) => segment.sourceOut))) throw new Error("Native capture ends before an encoded-frame source range");
  }
  return { manifest, plan, probes, stage };
}

export async function renderMarketingDemo({ manifestPath, outputDirectory, ffmpegPath, ffprobePath, browserType = chromium }) {
  const { manifest, plan, probes } = await validateMarketingFinishManifest(manifestPath, { ffprobePath, stage: "render" });
  await mkdir(outputDirectory, { recursive: true });
  const work = path.join(outputDirectory, "work");
  const captions = path.join(work, "captions");
  const mp4Segments = path.join(work, "mp4-segments");
  const webpSegments = path.join(work, "webp-segments");
  await Promise.all([mkdir(captions, { recursive: true }), mkdir(mp4Segments, { recursive: true }), mkdir(webpSegments, { recursive: true })]);
  const encoder = await detectH264Encoder(ffmpegPath);
  const captionReceipts = await renderCaptionOverlays({ plan, directory: captions, browserType });
  const renderedMp4Segments = [];
  for (let index = 0; index < plan.mp4.segments.length; index += 1) {
    const segment = plan.mp4.segments[index];
    const output = path.join(mp4Segments, `${String(index + 1).padStart(2, "0")}-${segment.id}.mp4`);
    await renderVideoSegment({ ffmpegPath, encoder, manifest, plan, segment, output, captionPath: captionReceipts[segment.id]?.path, width: plan.mp4.width, height: plan.mp4.height, fps: plan.mp4.fps, draftWatermark: plan.draftWatermark });
    renderedMp4Segments.push({ ...segment, path: output, sha256: await sha256File(output) });
  }
  const silentMaster = path.join(outputDirectory, "alystria-marketing.silent.mp4");
  await crossfadeSegments({ ffmpegPath, encoder, segments: renderedMp4Segments, output: silentMaster, transition: plan.mp4.transitionSeconds, fps: plan.mp4.fps });
  const programmeAudio = path.join(work, "programme.wav");
  await renderProgrammeAudio({ ffmpegPath, manifest, plan, output: programmeAudio });
  const premasterAudio = path.join(work, "music-ducked-premaster.wav");
  await renderDuckedPremaster({ ffmpegPath, manifest, plan, programmeAudio, output: premasterAudio });
  const loudness = await analyzeLoudness(ffmpegPath, premasterAudio, plan.audio);
  const mp4Path = path.join(outputDirectory, "alystria-short-demo.mp4");
  await muxMasteredOutput({ ffmpegPath, silentMaster, premasterAudio, loudness, plan, output: mp4Path });
  const mp4Probe = await probeMedia(ffprobePath, mp4Path);
  const measuredAudio = await measureEbur128(ffmpegPath, mp4Path);
  assertFinalMp4({ plan, probe: mp4Probe, measuredAudio });

  const renderedWebpSegments = [];
  for (let index = 0; index < plan.webp.segments.length; index += 1) {
    const segment = plan.webp.segments[index];
    const output = path.join(webpSegments, `${String(index + 1).padStart(2, "0")}-${segment.id}.mp4`);
    await renderVideoSegment({ ffmpegPath, encoder, manifest, plan, segment, output, captionPath: segment.captionText ? captionReceipts["native-editor-webp"]?.path : null, width: plan.webp.width, height: plan.webp.height, fps: plan.webp.fps, draftWatermark: plan.draftWatermark });
    renderedWebpSegments.push({ ...segment, path: output, sha256: await sha256File(output) });
  }
  const webpMaster = path.join(work, "webp-master.mp4");
  await crossfadeSegments({ ffmpegPath, encoder, segments: renderedWebpSegments, output: webpMaster, transition: 0.12, fps: plan.webp.fps });
  const webpPath = path.join(outputDirectory, "alystria-short-demo.webp");
  await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-i", webpMaster, "-an", "-vf", `fps=${plan.webp.fps},scale=${plan.webp.width}:${plan.webp.height}:flags=lanczos`, "-c:v", "libwebp_anim", "-q:v", "72", "-compression_level", "6", "-loop", "0", webpPath], 180_000);
  const webpBuffer = await readFile(webpPath);
  const webpInspection = inspectAnimatedWebp(webpBuffer);
  if (webpBuffer.length > 18 * 1024 * 1024 || Math.abs(webpInspection.durationMilliseconds / 1000 - plan.webp.durationSeconds) > 0.2) throw new Error("Animated WebP misses its size or duration contract");

  const receipt = {
    schemaVersion: 1,
    state: "completed",
    evidenceClass: manifest.mode === "final" ? "actual-native-marketing-edit" : "draft-marketing-edit",
    finalMarketingMedia: manifest.mode === "final",
    manifestPath: path.resolve(manifestPath),
    manifestSha256: await sha256File(manifestPath),
    encoder,
    plan,
    probes,
    captionReceipts,
    inputs: Object.fromEntries(["teachingVoice", "productVoice", "music", "nativeTutorialExport", "nativeUiCapture"].map((key) => [key, { path: manifest.assets[key].path, sha256: manifest.assets[key].sha256 }])),
    mp4: { path: mp4Path, sha256: await sha256File(mp4Path), byteSize: (await stat(mp4Path)).size, probe: mp4Probe, measuredAudio, loudnessPass: loudness },
    webp: { path: webpPath, sha256: createHash("sha256").update(webpBuffer).digest("hex"), byteSize: webpBuffer.length, inspection: webpInspection },
    transitions: { type: "crossfade", seconds: plan.mp4.transitionSeconds },
    provenance: { editorialCloseups: true, editorialCaptions: true, appUiIsActualNative: manifest.assets.nativeUiCapture.actualNativeWebView === true, noProviderCalls: true, noGpuInference: true },
  };
  const receiptPath = path.join(outputDirectory, "marketing-finish.receipt.json");
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return { ...receipt, receiptPath };
}

async function renderCaptionOverlays({ plan, directory, browserType }) {
  const requested = [
    ...plan.mp4.segments.filter((segment) => segment.captionText).map((segment) => ({ id: segment.id, text: segment.captionText, width: plan.mp4.width, height: plan.mp4.height, placement: segment.captionPlacement ?? "bottom-center", label: segment.id === "end-card" ? "ALYSTRIA" : "EDITORIAL CLOSE-UP · ACTUAL NATIVE APP" })),
    { id: "native-editor-webp", text: "Edit every word and beat.", width: plan.webp.width, height: plan.webp.height, placement: "top-left", label: "ACTUAL NATIVE APP" },
  ];
  const browser = await browserType.launch({ headless: true });
  try {
    const receipts = {};
    for (const item of requested) {
      const output = path.join(directory, `${item.id}.png`);
      const page = await browser.newPage({ viewport: { width: item.width, height: item.height }, deviceScaleFactor: 1 });
      const scale = item.width / 1440;
      const lines = wrapMarketingCaption(item.text, item.width < 1200 ? 34 : 44);
      const longest = Math.max(...lines.map((line) => line.length));
      const panelWidth = Math.round(Math.min(item.width * marketingCaptionStyle.maximumWidthPercent / 100, Math.max(item.width * 0.38, longest * 21 * scale + 96 * scale)));
      const lineHeight = 48 * scale;
      const panelHeight = Math.round(lines.length * lineHeight + 40 * scale);
      const horizontalMargin = Math.round(48 * scale);
      const panelX = item.placement === "top-left" ? horizontalMargin : item.placement === "top-right" ? item.width - panelWidth - horizontalMargin : Math.round((item.width - panelWidth) / 2);
      const panelY = item.placement?.startsWith("top") ? Math.round(76 * scale) : Math.round(item.height - panelHeight - 42 * scale);
      const fontSize = marketingCaptionStyle.fontSizeAt1440x810 * scale;
      const tspans = lines.map((line, index) => `<tspan x="${panelX + panelWidth / 2}" y="${panelY + 32 * scale + index * lineHeight}">${escapeXml(line)}</tspan>`).join("");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${item.width}" height="${item.height}"><rect width="100%" height="100%" fill="none"/><text x="${panelX}" y="${panelY - 10 * scale}" fill="${marketingCaptionStyle.accentColor}" font-family="Segoe UI,Arial,sans-serif" font-size="${13 * scale}" font-weight="700" letter-spacing="${2 * scale}">${escapeXml(item.label)}</text><rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" rx="${marketingCaptionStyle.cornerRadiusPixels * scale}" fill="${marketingCaptionStyle.panelColor}" fill-opacity="${marketingCaptionStyle.panelOpacity}"/><rect x="${panelX}" y="${panelY}" width="${7 * scale}" height="${panelHeight}" rx="${3.5 * scale}" fill="${marketingCaptionStyle.accentColor}"/><text text-anchor="middle" fill="${marketingCaptionStyle.textColor}" font-family="Segoe UI,Arial,sans-serif" font-size="${fontSize}" font-weight="600">${tspans}</text></svg>`;
      await page.setContent(`<style>html,body{margin:0;background:transparent;overflow:hidden}</style>${svg}`);
      await page.screenshot({ path: output, omitBackground: true });
      await page.close();
      receipts[item.id] = { path: output, sha256: await sha256File(output), width: item.width, height: item.height, lines, panelWidth, panelHeight, panelX, panelY, placement: item.placement };
    }
    return receipts;
  } finally {
    await browser.close();
  }
}

async function renderVideoSegment({ ffmpegPath, encoder, manifest, segment, output, captionPath, width, height, fps, draftWatermark }) {
  const source = segment.source === "nativeTutorialExport" ? manifest.assets.nativeTutorialExport.path : manifest.assets.nativeUiCapture.path;
  const inputArgs = segment.source === "nativeUiCaptureStill"
    ? ["-ss", String(segment.sourceSeconds), "-i", source]
    : ["-ss", String(segment.sourceIn ?? 0), "-t", String(Math.max(0.04, (segment.sourceOut ?? segment.durationSeconds) - (segment.sourceIn ?? 0))), "-i", source];
  const filters = [];
  const zoom = Number(segment.editorialZoom ?? 1);
  const focusX = Number(segment.focusX ?? 0.5);
  const focusY = Number(segment.focusY ?? 0.5);
  const direction = segment.id === "tutorial" || segment.id === "native-review" || segment.id === "end-card" ? "out" : "in";
  const rampFrames = Math.max(1, Math.round(fps * 0.36));
  const zoomExpression = direction === "out" ? `${zoom}-(${zoom - 1})*min(on/${rampFrames},1)` : `1+(${zoom - 1})*min(on/${rampFrames},1)`;
  filters.push(`scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`);
  // Extend the decoded range before zoompan. When tpad followed zoompan, the
  // filter stopped with the source and short segments by up to one hold.
  filters.push(`tpad=stop_mode=clone:stop_duration=${segment.durationSeconds},trim=duration=${segment.durationSeconds},setpts=PTS-STARTPTS`);
  filters.push(`zoompan=z='${zoomExpression}':x='max(0,min(iw-iw/zoom,${focusX}*iw-iw/zoom/2))':y='max(0,min(ih-ih/zoom,${focusY}*ih-ih/zoom/2))':d=1:s=${width}x${height}:fps=${fps}`);
  const args = ["-hide_banner", "-loglevel", "error", "-y", ...inputArgs];
  if (captionPath) {
    args.push("-i", captionPath);
    filters.push("[base][1:v]overlay=0:0:format=auto[captioned]");
  }
  const watermark = draftWatermark ? `drawbox=x=0:y=0:w=${width}:h=${Math.round(30 * width / 1440)}:color=#9C3140@0.88:t=fill,drawtext=fontfile='C\\:/Windows/Fonts/seguisb.ttf':text='${escapeFilterText(draftWatermark)}':fontcolor=white:fontsize=${Math.round(15 * width / 1440)}:x=(w-text_w)/2:y=${Math.round(7 * width / 1440)}` : null;
  if (captionPath) {
    const chain = filters.slice(0, 3).join(",");
    const tailFilters = [watermark, segment.id === "end-card" ? `fade=t=out:st=${Math.max(0, segment.durationSeconds - 0.35)}:d=0.35` : null].filter(Boolean);
    const tail = `;[captioned]${tailFilters.length ? tailFilters.join(",") : "null"}[out]`;
    args.push("-filter_complex", `[0:v]${chain}[base];${filters[3]}${tail}`, "-map", "[out]");
  } else {
    if (watermark) filters.push(watermark);
    if (segment.id === "end-card") filters.push(`fade=t=out:st=${Math.max(0, segment.durationSeconds - 0.35)}:d=0.35`);
    args.push("-vf", filters.join(","));
  }
  args.push("-frames:v", String(Math.max(1, Math.round(segment.durationSeconds * fps))), "-an", ...encoderArgs(encoder), "-pix_fmt", "yuv420p", output);
  await run(ffmpegPath, args, 180_000);
}

async function crossfadeSegments({ ffmpegPath, encoder, segments, output, transition, fps }) {
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  segments.forEach((segment) => args.push("-i", segment.path));
  const filters = [];
  segments.forEach((segment, index) => filters.push(`[${index}:v]setpts=PTS-STARTPTS${index < segments.length - 1 ? `,tpad=stop_mode=clone:stop_duration=${transition}` : ""}[v${index}]`));
  let prior = "v0";
  let cursor = segments[0].durationSeconds;
  for (let index = 1; index < segments.length; index += 1) {
    const out = `x${index}`;
    filters.push(`[${prior}][v${index}]xfade=transition=fade:duration=${transition}:offset=${round3(cursor)}[${out}]`);
    prior = out;
    cursor += segments[index].durationSeconds;
  }
  args.push("-filter_complex", filters.join(";"), "-map", `[${prior}]`, "-r", String(fps), "-an", ...encoderArgs(encoder), "-pix_fmt", "yuv420p", output);
  await run(ffmpegPath, args, 180_000);
}

async function renderProgrammeAudio({ ffmpegPath, manifest, plan, output }) {
  const filters = [];
  filters.push(`[0:a]atrim=0:${plan.audio.teachingDurationSeconds},asetpts=PTS-STARTPTS,apad=pad_dur=${plan.audio.teachingHoldSeconds},atrim=duration=${plan.mp4.segments[0].durationSeconds}[a0]`);
  plan.audio.productSegments.forEach((segment, index) => {
    const sourceDuration = segment.sourceOut - segment.sourceIn;
    const pad = Math.max(0, segment.durationSeconds - sourceDuration);
    filters.push(`[1:a]atrim=start=${segment.sourceIn}:end=${segment.sourceOut},asetpts=PTS-STARTPTS,apad=pad_dur=${pad},atrim=duration=${segment.durationSeconds}[a${index + 1}]`);
  });
  filters.push(`anullsrc=r=48000:cl=mono:d=${plan.audio.endSilenceSeconds}[a6]`);
  filters.push(`${plan.mp4.segments.map((_segment, index) => `[a${index}]`).join("")}concat=n=${plan.mp4.segments.length}:v=0:a=1,aresample=48000[out]`);
  await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-i", manifest.assets.teachingVoice.path, "-i", manifest.assets.productVoice.path, "-filter_complex", filters.join(";"), "-map", "[out]", "-c:a", "pcm_s24le", "-ar", "48000", output], 120_000);
}

async function renderDuckedPremaster({ ffmpegPath, manifest, plan, programmeAudio, output }) {
  const duration = plan.mp4.durationSeconds;
  const fadeOutStart = Math.max(0, duration - 0.6);
  const filter = `[1:a]atrim=0:${duration},asetpts=PTS-STARTPTS,highpass=f=70,lowpass=f=15000,volume=0.19,afade=t=in:st=0:d=0.35,afade=t=out:st=${fadeOutStart}:d=0.6[music];[0:a]asplit=2[voice_sc][voice_mix];[music][voice_sc]sidechaincompress=threshold=0.025:ratio=9:attack=18:release=380[ducked];[voice_mix][ducked]amix=inputs=2:duration=first:normalize=0[out]`;
  await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-i", programmeAudio, "-stream_loop", "-1", "-i", manifest.assets.music.path, "-filter_complex", filter, "-map", "[out]", "-c:a", "pcm_s24le", "-ar", "48000", output], 120_000);
}

async function analyzeLoudness(ffmpegPath, input, contract) {
  const filter = `loudnorm=I=${contract.targetIntegratedLufs}:TP=${contract.maximumTruePeakDbtp}:LRA=${contract.loudnessRangeLu}:print_format=json`;
  let stderr = "";
  try {
    ({ stderr } = await run(ffmpegPath, ["-hide_banner", "-nostats", "-i", input, "-af", filter, "-f", "null", "NUL"], 120_000));
  } catch (error) {
    stderr = error.stderr ?? "";
  }
  const match = stderr.match(/\{\s*"input_i"[\s\S]*?\}/u);
  if (!match) throw new Error("Loudness analysis returned no JSON measurement");
  return JSON.parse(match[0]);
}

async function muxMasteredOutput({ ffmpegPath, silentMaster, premasterAudio, loudness, plan, output }) {
  const a = plan.audio;
  const filter = `loudnorm=I=${a.targetIntegratedLufs}:TP=${a.maximumTruePeakDbtp}:LRA=${a.loudnessRangeLu}:measured_I=${loudness.input_i}:measured_TP=${loudness.input_tp}:measured_LRA=${loudness.input_lra}:measured_thresh=${loudness.input_thresh}:offset=${loudness.target_offset}:linear=true:print_format=summary`;
  await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-i", silentMaster, "-i", premasterAudio, "-filter_complex", `[1:a]${filter}[a]`, "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", output], 180_000);
}

function assertFinalMp4({ plan, probe, measuredAudio }) {
  if (!probe.video || !probe.audio || probe.video.width !== plan.mp4.width || probe.video.height !== plan.mp4.height || probe.audio.sample_rate !== "48000") throw new Error("Finished MP4 has the wrong media streams or dimensions");
  if (Math.abs(probe.durationSeconds - plan.mp4.durationSeconds) > 0.12) throw new Error("Finished MP4 misses the planned duration");
  if (Math.abs(measuredAudio.integratedLufs - plan.audio.targetIntegratedLufs) > 1 || measuredAudio.truePeakDbtp > plan.audio.maximumTruePeakDbtp + 0.1) throw new Error("Finished MP4 misses its loudness/true-peak contract");
}

async function measureEbur128(ffmpegPath, input) {
  let stderr = "";
  try {
    ({ stderr } = await run(ffmpegPath, ["-hide_banner", "-nostats", "-i", input, "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "NUL"], 120_000));
  } catch (error) {
    stderr = error.stderr ?? "";
  }
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const integrated = summary.match(/I:\s+(-?[0-9.]+) LUFS/u);
  const range = summary.match(/LRA:\s+([0-9.]+) LU/u);
  const peak = summary.match(/Peak:\s+(-?[0-9.]+) dBFS/u);
  if (!integrated || !range || !peak) throw new Error("EBU R128 measurement returned no summary");
  return { integratedLufs: Number(integrated[1]), loudnessRangeLu: Number(range[1]), truePeakDbtp: Number(peak[1]) };
}

async function detectH264Encoder(ffmpegPath) {
  const { stdout } = await run(ffmpegPath, ["-hide_banner", "-encoders"], 30_000);
  if (/\blibx264\b/u.test(stdout)) return "libx264";
  if (/\blibopenh264\b/u.test(stdout)) return "libopenh264";
  throw new Error("Bundled FFmpeg has no CPU H.264 encoder");
}

function encoderArgs(encoder) {
  return encoder === "libx264" ? ["-c:v", encoder, "-preset", "medium", "-crf", "18"] : ["-c:v", encoder, "-b:v", "7M"];
}

function focusFor(id) {
  return ({ "native-review": { x: 0.5, y: 0.5 }, "native-editor": { x: 0.5, y: 0.6 }, "native-assets": { x: 0.52, y: 0.48 }, "native-models": { x: 0.58, y: 0.5 }, "native-export": { x: 0.5, y: 0.5 } })[id];
}

function validSourceRange(value) {
  return value && Number.isFinite(Number(value.sourceIn ?? value.startSeconds)) && Number.isFinite(Number(value.sourceOut ?? value.endSeconds)) && Number(value.sourceOut ?? value.endSeconds) > Number(value.sourceIn ?? value.startSeconds);
}

async function validateHashedFile(asset, label) {
  if (!asset || typeof asset.path !== "string" || !path.isAbsolute(asset.path) || !/^[0-9a-f]{64}$/u.test(asset.sha256 ?? "")) throw new Error(`${label} needs an absolute path and SHA-256`);
  const details = await stat(asset.path);
  if (!details.isFile() || details.size <= 0 || await sha256File(asset.path) !== asset.sha256) throw new Error(`${label} is missing, empty, or has a SHA mismatch`);
}

async function probeMedia(ffprobePath, file) {
  const { stdout } = await run(ffprobePath, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,pix_fmt,sample_rate,channels,r_frame_rate", "-of", "json", file], 30_000);
  const parsed = JSON.parse(stdout);
  return { durationSeconds: Number(parsed.format?.duration), video: parsed.streams?.find((stream) => stream.codec_type === "video") ?? null, audio: parsed.streams?.find((stream) => stream.codec_type === "audio") ?? null };
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeFilterText(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'");
}

function round3(value) {
  return Number(Number(value).toFixed(3));
}

async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function run(command, args, timeout) {
  return execFileAsync(command, args, { windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024 });
}

async function runCli() {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    if (!key.startsWith("--")) continue;
    const next = process.argv[index + 1];
    args.set(key, next && !next.startsWith("--") ? (index += 1, next) : true);
  }
  for (const required of ["--manifest", "--output", "--ffmpeg", "--ffprobe"]) if (typeof args.get(required) !== "string") throw new Error(`${required} is required`);
  const receipt = await renderMarketingDemo({ manifestPath: path.resolve(args.get("--manifest")), outputDirectory: path.resolve(args.get("--output")), ffmpegPath: path.resolve(args.get("--ffmpeg")), ffprobePath: path.resolve(args.get("--ffprobe")) });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(modulePath).href) await runCli();
