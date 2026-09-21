import { chromium, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const visualSourceDirectory = path.join(moduleDirectory, "marketing-demo");

export const marketingDemoTitle = "Why the daytime sky looks blue";
export const marketingTeachingScript = "Sunlight looks white, but it carries every visible color. In Earth's atmosphere, tiny molecules scatter shorter blue wavelengths much more strongly than red ones. That scattered blue reaches your eyes from every direction, so the daytime sky looks blue.";
export const marketingProductScript = "This is a real lesson, ready to refine. Edit the script, timing, captions, and layout in one timeline. Choose a presenter, or start with included teaching visuals. Use cloud providers or downloadable local models. Then review and export the finished tutorial.";
export const marketingFrameRate = 30;
export const presentersPlanSectionPattern = /Presenters$/u;

export function buildMarketingPresenterRoutingPolicy(presenterRouteModel = "receipt-bound-reviewed-output") {
  return {
    version: 1,
    privacyMode: "local",
    dataClassification: "project",
    approvals: [{
      providerId: "local-runtime",
      capabilities: ["lipsync.generate"],
      credentialRef: null,
      boundary: "local",
      retention: "local_only",
      regions: ["local"],
      dataClasses: ["project"],
      privacyApproved: true,
      retentionApproved: true,
      regionApproved: true,
      termsApproved: false,
      modelAccessCheckedAt: null,
    }],
    routes: [{ capability: "lipsync.generate", model: presenterRouteModel, providerIds: ["local-runtime"], voice: null }],
  };
}

export function inspectMarketingPresenterRoutingPolicy(policy, presenterRouteModel = "receipt-bound-reviewed-output") {
  const expected = buildMarketingPresenterRoutingPolicy(presenterRouteModel);
  const routeMatches = stableJson(policy?.routes) === stableJson(expected.routes);
  const approvalMatches = stableJson(policy?.approvals) === stableJson(expected.approvals);
  const commonMatches = policy?.version === expected.version
    && policy?.privacyMode === expected.privacyMode
    && policy?.dataClassification === expected.dataClassification;
  return {
    valid: commonMatches && routeMatches && approvalMatches,
    legacyMissingApproval: commonMatches && routeMatches && Array.isArray(policy?.approvals) && policy.approvals.length === 0,
    routeMatches,
    approvalMatches,
  };
}

function stableJson(value) {
  const normalize = (candidate) => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate && typeof candidate === "object") {
      return Object.fromEntries(Object.keys(candidate).sort().map((key) => [key, normalize(candidate[key])]));
    }
    return candidate;
  };
  return JSON.stringify(normalize(value));
}
export const marketingCaptionStyle = Object.freeze({
  fontFamily: "Segoe UI Semibold",
  fontSizeAt1440x810: 34,
  textColor: "#FFFDF8",
  treatment: "blurred-transparent-glass",
  panelColor: "#101722",
  panelOpacityRange: [0.36, 0.48],
  backdropBlurRadius: 10,
  borderColor: "#FFFFFF",
  borderOpacity: 0.3,
  maximumWidthPercent: 76,
  cornerRadiusPixels: 14,
  horizontalPaddingPixels: 28,
  verticalPaddingPixels: 14,
  maximumLines: 2,
});

export const rayleighVisuals = Object.freeze([
  {
    id: "spectrum-designed-visual",
    filename: "rayleigh-spectrum.png",
    source: path.join(visualSourceDirectory, "rayleigh-spectrum.svg"),
    title: "White sunlight carries every visible color",
  },
  {
    id: "rayleigh-scattering-designed-visual",
    filename: "rayleigh-scattering.png",
    source: path.join(visualSourceDirectory, "rayleigh-scattering.svg"),
    title: "Shorter blue wavelengths scatter more strongly",
  },
  {
    id: "viewer-blue-light-designed-visual",
    filename: "rayleigh-viewer.png",
    source: path.join(visualSourceDirectory, "rayleigh-viewer.svg"),
    title: "Scattered blue reaches the viewer from across the sky",
  },
]);

export function nativeProjectCardIdentityToken(projectId) {
  if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/u.test(projectId)) {
    throw new Error("Native project identity is not safe for an exact project-card class lookup");
  }
  return `art-${projectId}`;
}

export function resolveNativeProjectCardChoice({ identityMatches, titleMatches }) {
  if (identityMatches === 1) return "identity";
  if (identityMatches !== 0) throw new Error(`Native project identity matched ${identityMatches} project cards`);
  if (titleMatches === 1) return "title";
  throw new Error(`Native project title fallback matched ${titleMatches} project cards`);
}

export async function openExactNativeProject(page, { identity, fallbackLabel, timeout, forceProjects = false }) {
  const navigation = page.getByRole("navigation", { name: /project workspace/iu });
  if (!forceProjects && await navigation.isVisible()) return navigation;
  const projects = page.getByRole("button", { name: "Projects", exact: true });
  await expect(projects).toBeVisible({ timeout });
  await projects.click();
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible({ timeout });
  const identityToken = nativeProjectCardIdentityToken(identity?.projectId);
  const identityCard = page.locator("button.project-card").filter({
    has: page.locator(`.project-card-art[class~="${identityToken}"]`),
  });
  const titleCard = page.locator("button.project-card").filter({
    has: page.getByRole("heading", { name: fallbackLabel, exact: true }),
  });
  const choice = resolveNativeProjectCardChoice({
    identityMatches: await identityCard.count(),
    titleMatches: await titleCard.count(),
  });
  const card = choice === "identity" ? identityCard : titleCard;
  await expect(card).toBeVisible({ timeout });
  await card.click();
  await expect(navigation).toBeVisible({ timeout });
  return navigation;
}

const productBeatContract = Object.freeze([
  { id: "native-review", minimumSeconds: 2.4, source: "actual-native-tutorial-review", motion: "context-pull-1.08-to-1.00", editorialZoom: 1.08, focusRegion: "review-player" },
  { id: "native-editor", minimumSeconds: 4.2, source: "actual-native-ui-capture", motion: "ease-into-transcript-dock-and-timeline-resize", editorialZoom: 1.34, focusRegion: "editor-transcript-dock-timeline" },
  { id: "native-assets", minimumSeconds: 3.4, source: "actual-native-ui-capture", motion: "settled-presenter-gallery-to-library-close-up", editorialZoom: 1.26, focusRegion: "presenter-gallery-and-teaching-library" },
  { id: "native-models", minimumSeconds: 3.2, source: "actual-native-ui-capture", motion: "settled-model-card-and-download-panel-close-up", editorialZoom: 1.3, focusRegion: "model-card-and-download-panel" },
  { id: "native-export", minimumSeconds: 3.2, source: "actual-native-ui-capture", motion: "context-return-to-review-and-export", editorialZoom: 1.08, focusRegion: "review-export" },
]);

const tutorialCueIds = ["white-light", "molecule-scattering", "viewer-conclusion"];
const requiredPreflightAssetKeys = ["teachingVoice", "productVoice", "music"];
export const marketingPresenterOrder = Object.freeze(["realistic-woman", "anime-woman", "realistic-man", "cartoon-woman"]);

export function deriveAdaptiveMarketingEdit({ teachingDurationSeconds, teachingSegments, presenterSegments, productSegments }) {
  assertDuration(teachingDurationSeconds, "teaching narration", 7, 25);
  if (!Array.isArray(productSegments) || productSegments.length !== productBeatContract.length) {
    throw new Error(`Product narration needs exactly ${productBeatContract.length} timed segments`);
  }
  const normalizedSegments = productSegments.map((segment, index) => {
    const durationSeconds = segmentDuration(segment);
    assertDuration(durationSeconds, `product narration segment ${index + 1}`, 0.4, 8);
    return { ...segment, durationSeconds };
  });
  const tutorialEnd = round3(teachingDurationSeconds + 0.32);
  const beats = [];
  let cursor = tutorialEnd;
  const productDurations = normalizedSegments.map((segment, index) => Math.max(productBeatContract[index].minimumSeconds, segment.durationSeconds + 0.28));
  const rawDuration = tutorialEnd + productDurations.reduce((sum, value) => sum + value, 0) + 1.15;
  const fillSeconds = Math.max(0, 35 - rawDuration);
  const fillWeights = [0.1, 0.38, 0.2, 0.2, 0.12];
  for (let index = 0; index < productBeatContract.length; index += 1) {
    const contract = productBeatContract[index];
    const durationSeconds = productDurations[index] + fillSeconds * fillWeights[index];
    const start = cursor;
    const end = start + durationSeconds;
    beats.push({ ...contract, in: round3(start), out: round3(end), narrationSegmentId: normalizedSegments[index].id });
    cursor = end;
  }
  const endCardIn = cursor;
  const totalDurationSeconds = round3(endCardIn + 1.15);
  if (totalDurationSeconds < 35 || totalDurationSeconds > 50) {
    throw new Error(`Adaptive marketing edit is ${totalDurationSeconds}s; expected 35–50s`);
  }

  const tutorialTiming = Array.isArray(teachingSegments)
    ? verifiedTeachingTiming(teachingSegments, teachingDurationSeconds, tutorialEnd)
    : (() => {
        const durations = proportionalDurations(teachingDurationSeconds, [10, 16, 12]);
        let cursor = 0;
        return durations.map((durationSeconds, index) => {
          const start = cursor;
          const end = index === durations.length - 1 ? tutorialEnd : start + durationSeconds;
          cursor = end;
          return { start, end };
        });
      })();
  const tutorialBeats = tutorialTiming.map(({ start, end }, index) => {
    return {
      id: `tutorial-${tutorialCueIds[index]}`,
      in: round3(start),
      out: round3(end),
      source: "actual-native-tutorial-export",
      visualId: rayleighVisuals[index].id,
      motion: index === 0 ? "speaking-presenter-plus-push-1.00-to-1.035" : index === 1 ? "push-1.00-to-1.06-on-blue-rays" : "resolve-and-0.32s-hold",
    };
  });
  const presenterWebp = Array.isArray(presenterSegments) ? derivePresenterWebpBeats(presenterSegments, teachingDurationSeconds) : null;
  const webpDurationSeconds = presenterWebp?.durationSeconds ?? round3(Math.min(20, Math.max(12, teachingDurationSeconds + 2.4)));
  const webpEditorStart = presenterWebp?.editorStart ?? round3(webpDurationSeconds - 3.4);
  const webpTutorialCuts = presenterWebp ? null : (Array.isArray(teachingSegments)
    ? [Number(teachingSegments[0].endSeconds), Number(teachingSegments[1].endSeconds)].map((value) => round3(Math.min(value, webpEditorStart)))
    : [round3(Math.min(teachingDurationSeconds, Math.max(4.2, teachingDurationSeconds * 0.42))), round3(Math.min(teachingDurationSeconds, webpEditorStart))]);
  return {
    schemaVersion: 2,
    timingBasis: "verified-source-audio-durations",
    teachingDurationSeconds: round3(teachingDurationSeconds),
    productNarrationDurationSeconds: round3(normalizedSegments.reduce((sum, segment) => sum + segment.durationSeconds, 0)),
    mp4: {
      durationSeconds: totalDurationSeconds,
      width: 1440,
      height: 810,
      fps: 25,
      beats: [...tutorialBeats, ...beats, { id: "end-card", in: round3(endCardIn), out: totalDurationSeconds, source: "actual-native-tutorial-review", motion: "350ms-fade" }],
    },
    webp: {
      durationSeconds: webpDurationSeconds,
      width: 960,
      height: 540,
      fps: 10,
      startsWithVisibleMotion: true,
      beats: presenterWebp ? [...presenterWebp.beats, { id: "actual-native-editor", in: webpEditorStart, out: webpDurationSeconds }] : [
        { id: "tutorial-speaking-hook", in: 0, out: webpTutorialCuts[0] },
        { id: "tutorial-scattering", in: webpTutorialCuts[0], out: webpTutorialCuts[1] },
        { id: "tutorial-viewer-conclusion", in: webpTutorialCuts[1], out: webpEditorStart },
        { id: "actual-native-editor", in: webpEditorStart, out: webpDurationSeconds },
      ],
    },
  };
}

function derivePresenterWebpBeats(segments, narrationDurationSeconds) {
  if (segments.length !== marketingPresenterOrder.length) throw new Error("Animated WebP needs the four ordered presenter segments");
  let sourceCursor = 0;
  let outputCursor = 0;
  const beats = segments.map((segment, index) => {
    const start = Number(segment.startSeconds);
    const end = Number(segment.endSeconds);
    if (segment.style !== marketingPresenterOrder[index] || !Number.isFinite(start) || !Number.isFinite(end)
      || Math.abs(start - sourceCursor) > 0.08 || end <= start) {
      throw new Error(`Animated WebP presenter segment ${index + 1} breaks the ordered source timeline`);
    }
    const sampleDuration = Math.min(3.5, end - start);
    const outputStart = outputCursor;
    outputCursor += sampleDuration;
    sourceCursor = end;
    return { id: `tutorial-${segment.style}`, presenterStyle: segment.style, in: round3(outputStart), out: round3(outputCursor), sourceIn: round3(start), sourceOut: round3(start + sampleDuration) };
  });
  if (Math.abs(sourceCursor - narrationDurationSeconds) > 0.08) throw new Error("Animated WebP presenter segments do not cover the verified teaching narration");
  const editorSeconds = 3.4;
  const durationSeconds = round3(outputCursor + editorSeconds);
  assertDuration(durationSeconds, "animated WebP", 12, 20);
  return { beats, editorStart: round3(outputCursor), durationSeconds };
}

function verifiedTeachingTiming(segments, narrationDurationSeconds, tutorialEndSeconds) {
  if (segments.length !== tutorialCueIds.length) throw new Error("Teaching narration needs exactly three timed segments");
  let previousEnd = 0;
  return segments.map((segment, index) => {
    if (segment.id !== tutorialCueIds[index] || !Number.isFinite(segment.startSeconds) || !Number.isFinite(segment.endSeconds)
      || Math.abs(segment.startSeconds - previousEnd) > 0.08 || segment.endSeconds <= segment.startSeconds) {
      throw new Error(`Teaching segment ${index + 1} does not preserve a contiguous verified phrase boundary`);
    }
    const start = Number(segment.startSeconds);
    const end = index === segments.length - 1 ? tutorialEndSeconds : Number(segment.endSeconds);
    previousEnd = Number(segment.endSeconds);
    if (index === segments.length - 1 && Math.abs(previousEnd - narrationDurationSeconds) > 0.08) throw new Error("Teaching segments do not reach the verified narration duration");
    return { start, end };
  });
}

export function deriveSentenceSegmentsFromAsr({ asr, sentences, ids }) {
  if (asr?.state !== "verified" || asr.exactNormalizedTranscript !== true || !Array.isArray(asr.words) || !Number.isFinite(asr.durationSeconds)) {
    throw new Error("Sentence timing requires an exact verified ASR receipt with word timestamps");
  }
  if (!Array.isArray(sentences) || !Array.isArray(ids) || sentences.length === 0 || sentences.length !== ids.length) throw new Error("Sentence timing needs matching sentence and ID arrays");
  if (normalizeText(sentences.join(" ")) !== normalizeText(asr.expectedText)) throw new Error("Sentence text does not reconstruct the ASR expected transcript exactly");
  const expectedTokens = sentences.map((sentence) => transcriptTokens(sentence));
  const actualTokens = asr.words.map((entry) => transcriptTokens(entry.word)[0]).filter(Boolean);
  const flattenedExpected = expectedTokens.flat();
  if (flattenedExpected.length !== actualTokens.length || flattenedExpected.some((token, index) => token !== actualTokens[index])) {
    throw new Error("ASR word timestamps do not match the expected sentence tokens");
  }
  const segments = [];
  let tokenCursor = 0;
  let startSeconds = 0;
  for (let index = 0; index < sentences.length; index += 1) {
    tokenCursor += expectedTokens[index].length;
    const isLast = index === sentences.length - 1;
    const previousWord = asr.words[tokenCursor - 1];
    const nextWord = asr.words[tokenCursor];
    const endSeconds = isLast ? Number(asr.durationSeconds) : (Number(previousWord.end) + Number(nextWord.start)) / 2;
    if (!Number.isFinite(endSeconds) || endSeconds <= startSeconds) throw new Error(`ASR sentence ${ids[index]} has an invalid silence boundary`);
    segments.push({
      id: ids[index],
      startSeconds: round3(startSeconds),
      endSeconds: round3(endSeconds),
      durationSeconds: round3(endSeconds - startSeconds),
      firstWordSeconds: Number(asr.words[tokenCursor - expectedTokens[index].length].start),
      lastWordSeconds: Number(previousWord.end),
      text: sentences[index],
      boundaryMethod: isLast ? "verified-media-duration" : "midpoint-between-adjacent-sentence-word-timestamps",
    });
    startSeconds = endSeconds;
  }
  return segments;
}

export async function renderRayleighVisuals(outputDirectory, { browserType = chromium } = {}) {
  await mkdir(outputDirectory, { recursive: true });
  const browser = await browserType.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const receipts = [];
    for (const visual of rayleighVisuals) {
      const svg = await readFile(visual.source, "utf8");
      await page.setContent(`<style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#fff}svg{display:block;width:1920px;height:1080px}</style>${svg}`, { waitUntil: "load" });
      const outputPath = path.join(outputDirectory, visual.filename);
      await page.screenshot({ path: outputPath, type: "png", animations: "disabled" });
      const dimensions = await page.locator("svg").evaluate((element) => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }));
      if (dimensions.width !== 1920 || dimensions.height !== 1080) throw new Error(`Rendered ${visual.id} at ${dimensions.width}×${dimensions.height}`);
      const details = await stat(outputPath);
      if (!details.isFile() || details.size < 20_000) throw new Error(`Rendered ${visual.id} is unexpectedly small`);
      receipts.push({ ...visual, path: outputPath, sha256: await sha256File(outputPath), byteSize: details.size, mediaType: "image/png", width: 1920, height: 1080 });
    }
    const receiptPath = path.join(outputDirectory, "rayleigh-visuals.receipt.json");
    await writeFile(receiptPath, `${JSON.stringify({ schemaVersion: 1, evidenceClass: "deterministic-code-native-teaching-visuals", physicsReviewRequired: true, visuals: receipts }, null, 2)}\n`, "utf8");
    return { receiptPath, visuals: receipts };
  } finally {
    await browser.close();
  }
}

export async function validateMarketingAssetManifest(manifestPath, { ffprobePath, stage = "preflight" } = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || !["draft", "final"].includes(manifest.mode)) throw new Error("Marketing asset manifest must use schemaVersion 1 and draft/final mode");
  const finalMode = manifest.mode === "final";
  if (finalMode && manifest.draftWatermark) throw new Error("Final marketing manifests cannot retain a draft watermark");
  if (!finalMode && manifest.draftWatermark !== "DRAFT · PRESENTER / VOICE PENDING") throw new Error("Draft marketing manifests must burn the exact pending-assets watermark");
  if (!["preflight", "final-edit"].includes(stage)) throw new Error(`Unknown marketing validation stage ${stage}`);
  const requiredAssets = stage === "final-edit" ? [...requiredPreflightAssetKeys, "nativeUiCapture"] : requiredPreflightAssetKeys;
  for (const key of requiredAssets) {
    const asset = manifest.assets?.[key];
    if (!asset) throw new Error(`Marketing asset manifest is missing ${key}`);
    await validateHashedFile(asset, key);
    if (finalMode && asset.placeholder === true) throw new Error(`Final marketing manifest cannot use placeholder ${key}`);
  }
  const presenterClips = manifest.assets?.presenterClips;
  if (!Array.isArray(presenterClips) || presenterClips.length < 1) throw new Error(`${finalMode ? "Final" : "Draft"} marketing manifest needs presenter clips`);
  for (let index = 0; index < presenterClips.length; index += 1) await validateHashedFile(presenterClips[index], `presenterClips[${index}]`);
  if (finalMode) {
    if (presenterClips.length !== marketingPresenterOrder.length) throw new Error("Final marketing manifest needs four ordered presenter clips");
    let previousEnd = 0;
    for (let index = 0; index < presenterClips.length; index += 1) {
      const clip = presenterClips[index];
      if (clip.style !== marketingPresenterOrder[index] || clip.publicDemoCleared !== true || clip.temporalReviewPassed !== true || clip.naturalBlinkVerified !== true) {
        throw new Error(`Presenter clip ${index + 1} does not satisfy the reviewed ${marketingPresenterOrder[index]} contract`);
      }
      if (!Number.isFinite(clip.startSeconds) || !Number.isFinite(clip.endSeconds) || Math.abs(clip.startSeconds - previousEnd) > 0.08 || clip.endSeconds <= clip.startSeconds) {
        throw new Error(`Presenter clip ${index + 1} does not preserve a contiguous narration range`);
      }
      previousEnd = clip.endSeconds;
    }
    if (Math.abs(previousEnd - manifest.assets.teachingVoice.durationSeconds) > 0.08) throw new Error("Presenter clips do not cover the complete teaching narration");
  }
  const visuals = manifest.assets?.visuals;
  if (!Array.isArray(visuals) || visuals.length !== rayleighVisuals.length) throw new Error("Marketing asset manifest must contain exactly three Rayleigh visuals");
  for (const expected of rayleighVisuals) {
    const matches = visuals.filter((visual) => visual.id === expected.id);
    if (matches.length !== 1) throw new Error(`Marketing asset manifest is missing exact visual ${expected.id}`);
    const visual = matches[0];
    await validateHashedFile(visual, expected.id);
    if (visual.mediaType !== "image/png" || visual.width !== 1920 || visual.height !== 1080) throw new Error(`${expected.id} is not a 1920×1080 PNG`);
  }
  if (normalizeText(manifest.assets.teachingVoice.transcript) !== normalizeText(marketingTeachingScript)) throw new Error("Teaching voice transcript does not match the approved factual script");
  if (normalizeText(manifest.assets.productVoice.transcript) !== normalizeText(marketingProductScript)) throw new Error("Product voice transcript does not match the approved edit script");
  if (finalMode) {
    for (const key of ["teachingVoice", "productVoice"]) {
      if (manifest.assets[key].publicDemoCleared !== true) throw new Error(`${key} is not cleared for a public demo`);
    }
    if (stage === "final-edit" && (manifest.assets.nativeUiCapture.actualNativeWebView !== true || manifest.assets.nativeUiCapture.fixtureUi === true)) throw new Error("Final UI capture is not an actual native WebView capture");
  }
  if (!Array.isArray(manifest.teachingCaptions) || manifest.teachingCaptions.length !== 3) throw new Error("Teaching captions need three phrase-aligned cues");
  validateCaptionSequence(manifest.teachingCaptions, manifest.assets.teachingVoice.durationSeconds, marketingTeachingScript);
  if (!Array.isArray(manifest.productSegments) || manifest.productSegments.length !== productBeatContract.length) throw new Error("Product voice needs five timed segments");
  for (let index = 0; index < productBeatContract.length; index += 1) {
    if (manifest.productSegments[index].id !== productBeatContract[index].id || typeof manifest.productSegments[index].text !== "string") throw new Error(`Product segment ${index + 1} does not match ${productBeatContract[index].id}`);
  }
  if (normalizeText(manifest.productSegments.map((segment) => segment.text).join(" ")) !== normalizeText(marketingProductScript)) throw new Error("Product segment text does not reconstruct the approved narration exactly");
  const edit = deriveAdaptiveMarketingEdit({ teachingDurationSeconds: manifest.assets.teachingVoice.durationSeconds, teachingSegments: manifest.teachingCaptions, presenterSegments: presenterClips, productSegments: manifest.productSegments });
  const probes = {};
  if (ffprobePath) {
    probes.teachingVoice = await probeMedia(ffprobePath, manifest.assets.teachingVoice.path);
    probes.productVoice = await probeMedia(ffprobePath, manifest.assets.productVoice.path);
    probes.presenterClips = await Promise.all(presenterClips.map((clip) => probeMedia(ffprobePath, clip.path)));
    if (stage === "final-edit") probes.nativeUiCapture = await probeMedia(ffprobePath, manifest.assets.nativeUiCapture.path);
    if (!probes.teachingVoice.audio || probes.teachingVoice.video) throw new Error("Teaching voice must be an audio-only source");
    if (probes.presenterClips.some((probe) => !probe.video || !probe.audio)) throw new Error("Each presenter source must contain reviewed video and its matching utterance audio");
    if (Math.abs(probes.teachingVoice.durationSeconds - manifest.assets.teachingVoice.durationSeconds) > 0.08) throw new Error("Teaching voice duration differs from its manifest");
  }
  return { manifest, edit, probes };
}

export function buildMarketingTutorialProjectDocument({
  teachingDurationSeconds,
  captions,
  mode = "final",
  presenterRouteModel = "receipt-bound-reviewed-output",
}) {
  assertDuration(teachingDurationSeconds, "teaching narration", 7, 25);
  validateCaptionSequence(captions, teachingDurationSeconds, marketingTeachingScript);
  return {
    title: `${marketingDemoTitle}${mode === "draft" ? " · DRAFT" : ""}`,
    topic: marketingDemoTitle,
    description: "A concise, accurate explanation of Rayleigh scattering built from three designed teaching visuals, exact captions, reviewed narration, and a presenter.",
    locale: "English",
    audience: "General learners",
    duration: Number((teachingDurationSeconds / 60).toFixed(3)),
    updatedAt: "just now",
    progress: 100,
    status: "Complete",
    theme: "Precision studio",
    privacy: "Local only",
    scenes: captions.map((cue, index) => ({
      id: `rayleigh-scene-${index + 1}`,
      index: index + 1,
      title: rayleighVisuals[index].title,
      kind: index === 0 ? "explain" : index === 1 ? "mechanism" : "summary",
      duration: round3(cue.endSeconds - cue.startSeconds),
      narration: cue.text,
      objective: index === 0 ? "Establish that white sunlight contains visible wavelengths." : index === 1 ? "Show that shorter wavelengths scatter more strongly from small atmospheric molecules." : "Connect scattered blue paths to the viewer's perception of the whole sky.",
      status: "approved",
      visual: rayleighVisuals[index].id,
      citations: 0,
      locked: false,
    })),
    sources: [],
    presenterSelection: { schemaVersion: 1, mode: "on", presenters: [], sceneAssignments: [] },
    sceneCandidates: [],
    providerRoutingPolicy: buildMarketingPresenterRoutingPolicy(presenterRouteModel),
    marketingDemo: { schemaVersion: 1, mode, exactTeachingScript: marketingTeachingScript, designedVisualIds: rayleighVisuals.map((visual) => visual.id) },
  };
}

export function deriveMarketingPresenterTransform({
  canvasWidth = 1920,
  canvasHeight = 1080,
  sourceWidth = 512,
  sourceHeight = 512,
  desiredCenterX = 1510,
  desiredCenterY = 650,
  scale = 0.68,
} = {}) {
  for (const [label, value] of Object.entries({ canvasWidth, canvasHeight, sourceWidth, sourceHeight, desiredCenterX, desiredCenterY, scale })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Presenter layout ${label} must be positive`);
  }
  const contain = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const width = sourceWidth * contain * scale;
  const height = sourceHeight * contain * scale;
  const x = desiredCenterX - canvasWidth / 2;
  const y = desiredCenterY - canvasHeight / 2;
  const bounds = { left: desiredCenterX - width / 2, top: desiredCenterY - height / 2, right: desiredCenterX + width / 2, bottom: desiredCenterY + height / 2 };
  if (bounds.left < 0 || bounds.top < 0 || bounds.right > canvasWidth || bounds.bottom > canvasHeight) throw new Error(`Presenter layout escapes the ${canvasWidth}×${canvasHeight} canvas`);
  return { x: round3(x), y: round3(y), scaleX: scale, scaleY: scale, desiredCenterX, desiredCenterY, renderedWidth: round3(width), renderedHeight: round3(height), bounds: Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, round3(value)])) };
}

export function buildMarketingTimelineContract(assetManifest) {
  if (!assetManifest?.assets?.teachingVoice || !Array.isArray(assetManifest?.assets?.presenterClips)
    || !Array.isArray(assetManifest?.teachingCaptions)) {
    throw new Error("Marketing timeline contract requires validated teaching voice, presenter clips, and captions");
  }
  const timing = deriveNativeSceneTiming(assetManifest.teachingCaptions, assetManifest.assets.teachingVoice.durationSeconds);
  return {
    timing,
    presenters: assetManifest.assets.presenterClips.map((presenter) => ({
      name: path.basename(presenter.path),
      startFrame: Math.round(presenter.startSeconds * marketingFrameRate),
      endFrame: Math.round(presenter.endSeconds * marketingFrameRate),
    })),
    presenterTransform: deriveMarketingPresenterTransform(),
    captions: assetManifest.teachingCaptions.map((caption) => caption.text),
  };
}

export function inspectMarketingTimelineDocument(document, contract) {
  const tracks = Array.isArray(document?.tracks) ? document.tracks : [];
  const clipsFor = (kind) => tracks.find((track) => track.kind === kind)?.clips ?? [];
  const ordered = (clips) => [...clips].sort((left, right) => left.timelineRange.startFrame - right.timelineRange.startFrame);
  const exactRanges = (clips, ranges) => clips.length === ranges.length && ordered(clips).every((clip, index) => (
    clip.timelineRange?.startFrame === ranges[index].startFrame
    && clip.timelineRange?.durationFrames === ranges[index].durationFrames
  ));
  const overlapCount = (clips) => {
    const sorted = ordered(clips);
    return sorted.slice(1).filter((clip, index) => (
      sorted[index].timelineRange.startFrame + sorted[index].timelineRange.durationFrames > clip.timelineRange.startFrame
    )).length;
  };
  const sceneRanges = contract.timing.scenes.map((scene) => ({ startFrame: scene.startFrame, durationFrames: scene.endFrame - scene.startFrame }));
  const presenterRanges = contract.presenters.map((presenter) => ({ startFrame: presenter.startFrame, durationFrames: presenter.endFrame - presenter.startFrame }));
  const slides = clipsFor("slides");
  const presenters = clipsFor("presenter");
  const captions = clipsFor("captions");
  const narration = clipsFor("narration");
  const music = clipsFor("music");
  const captionTrack = tracks.find((track) => track.kind === "captions");
  const presenterDetailsMatch = presenters.length === contract.presenters.length && presenters.every((clip) => {
    const expected = contract.presenters.find((candidate) => candidate.name === clip.name);
    return expected && clip.timelineRange?.startFrame === expected.startFrame
      && clip.timelineRange?.durationFrames === expected.endFrame - expected.startFrame
      && clip.audio?.muted === true
      && clip.transform?.x === contract.presenterTransform.x && clip.transform?.y === contract.presenterTransform.y
      && clip.transform?.scaleX === contract.presenterTransform.scaleX && clip.transform?.scaleY === contract.presenterTransform.scaleY;
  });
  const captionsMatch = exactRanges(captions, sceneRanges) && ordered(captions).every((clip, index) => clip.text === contract.captions[index]);
  const musicMatch = contract.music
    ? music.length === 1 && music[0].name === contract.music.name && music[0].timelineRange?.startFrame === 0
      && music[0].timelineRange?.durationFrames === contract.music.durationFrames
      && music[0].audio?.muted !== true && music[0].audio?.volumeDb === contract.music.volumeDb
    : music.length === 0;
  const overlaps = Object.fromEntries(["slides", "presenter", "captions", "narration", "music"].map((kind) => [kind, overlapCount(clipsFor(kind))]));
  const diagnostic = {
    counts: Object.fromEntries(["slides", "presenter", "captions", "narration", "music"].map((kind) => [kind, clipsFor(kind).length])),
    overlaps,
    captionsHidden: captionTrack?.hidden ?? null,
    exactSceneRanges: exactRanges(slides, sceneRanges),
    exactPresenterRanges: exactRanges(presenters, presenterRanges),
    presenterDetailsMatch,
    captionsMatch,
    narrationMatch: narration.length === 1 && narration[0].timelineRange?.startFrame === 0 && narration[0].timelineRange?.durationFrames === contract.timing.durationFrames,
    musicMatch,
  };
  return {
    matches: diagnostic.exactSceneRanges && diagnostic.exactPresenterRanges && diagnostic.presenterDetailsMatch
      && diagnostic.captionsMatch && diagnostic.narrationMatch && diagnostic.musicMatch
      && diagnostic.captionsHidden === contract.captionsHidden
      && Object.values(overlaps).every((count) => count === 0),
    diagnostic,
  };
}

export async function waitForDurableMarketingTimeline({ page, editor, invokeNative, identity, contract, timeoutMs, label }) {
  const saveStatus = editor.locator(".editor-save-status");
  const deadline = Date.now() + timeoutMs;
  let last = { saveStatus: null, diagnostic: null, revisionNumber: null };
  while (Date.now() < deadline) {
    const status = (await saveStatus.textContent().catch(() => null))?.trim() ?? null;
    if (status?.startsWith("Save failed")) throw new Error(`${label} failed to save: ${status}`);
    const saved = await invokeNative(page, "project_snapshot_get", identity);
    const inspection = inspectMarketingTimelineDocument(saved.snapshot?.editorDocument, contract);
    last = { saveStatus: status, diagnostic: inspection.diagnostic, revisionNumber: saved.revisionNumber ?? null };
    if (status === "Timeline saved" && inspection.matches) return saved;
    await page.waitForTimeout(150);
  }
  throw new Error(`${label} did not reach a settled durable editor revision: ${JSON.stringify(last)}`);
}

export async function prepareMarketingTutorialInNativeEditor({
  page,
  projectsPath,
  invokeNative,
  ffprobePath,
  assetManifest,
  presenterRouteModel = "receipt-bound-reviewed-output",
  actionTimeoutMs = 45_000,
  jobTimeoutMs = 600_000,
}) {
  const timelineContract = buildMarketingTimelineContract(assetManifest);
  const { timing, presenterTransform } = timelineContract;
  const initialSnapshot = buildMarketingTutorialProjectDocument({
    teachingDurationSeconds: timing.durationSeconds,
    captions: assetManifest.teachingCaptions,
    mode: assetManifest.mode,
    presenterRouteModel,
  });
  const handle = await invokeNative(page, "project_create", {
    parentDirectory: projectsPath,
    directoryName: `rayleigh-marketing-${Date.now().toString(36)}`,
    title: initialSnapshot.title,
    locale: "en-US",
    groundingMode: "creative",
    initialSnapshot,
  });
  const identity = { projectId: handle.manifest.projectId, projectDirectory: handle.projectDirectory };
  const durable = await invokeNative(page, "project_snapshot_get", identity);
  const project = { ...initialSnapshot, id: identity.projectId, nativeProjectId: identity.projectId, nativeProjectDirectory: identity.projectDirectory, nativeHeadRevisionId: durable.headRevisionId, nativeRevisionNumber: durable.revisionNumber };
  await page.evaluate((created) => {
    const workspace = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    localStorage.setItem("alystria-studio-v2", JSON.stringify({ ...workspace, projects: [created, ...(workspace.projects ?? []).filter((candidate) => candidate.id !== created.id)], recentProjectId: created.id, studioMode: "studio" }));
  }, project);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".runtime-badge")).toContainText("Worker ready", { timeout: actionTimeoutMs });
  const navigation = await openExactNativeProject(page, {
    identity,
    fallbackLabel: initialSnapshot.title,
    timeout: actionTimeoutMs,
    forceProjects: true,
  });
  await navigation.getByRole("button", { name: /^studio$/iu }).click();
  await page.getByRole("button", { name: /^edit tracks & timing/iu }).click();
  const editor = page.getByRole("dialog", { name: "Integrated advanced video editor" });
  await expect(editor).toBeVisible({ timeout: actionTimeoutMs });
  for (const kind of ["slides", "presenter", "titles", "captions", "narration", "music", "sfx"]) {
    const clips = editor.locator(`.aly-editor-clip--${kind}`);
    while (await clips.count()) {
      await clips.first().click();
      await editor.getByRole("button", { name: "Lift", exact: true }).click();
    }
  }
  const hideEmpty = editor.getByRole("button", { name: "Hide empty tracks", exact: true });
  if (await hideEmpty.getAttribute("aria-pressed") === "true") await hideEmpty.click();
  const presenterSources = assetManifest.assets.presenterClips;
  if (!Array.isArray(presenterSources) || presenterSources.length < 1) throw new Error("Marketing tutorial needs at least one presenter clip");
  const sources = [...assetManifest.assets.visuals.map((visual) => visual.path), ...presenterSources.map((clip) => clip.path), assetManifest.assets.teachingVoice.path];
  await editor.getByLabel("Rights for new editor media").selectOption("owned");
  await editor.getByLabel("Import media files").setInputFiles(sources);
  for (const source of sources) {
    const card = editor.getByRole("listitem").filter({ hasText: path.basename(source) });
    await expect(card).toContainText("ready", { timeout: 90_000 });
  }
  for (let index = 0; index < timing.scenes.length; index += 1) {
    const scene = timing.scenes[index];
    const visual = assetManifest.assets.visuals.find((candidate) => candidate.id === rayleighVisuals[index].id);
    await setPlayhead(editor, scene.startFrame);
    await editor.getByRole("button", { name: "Slides", exact: true }).click();
    await editor.getByRole("button", { name: "Media", exact: true }).click();
    const card = editor.getByRole("listitem").filter({ hasText: path.basename(visual.path) });
    await card.getByRole("button", { name: `Place ${path.basename(visual.path)} at playhead` }).click();
    const clip = editor.locator(".aly-editor-clip--slides").filter({ hasText: path.basename(visual.path) });
    await clip.click();
    await editor.getByRole("button", { name: "Inspector", exact: true }).click();
    await setInspectorNumber(editor, "End frame", scene.endFrame);
  }
  for (const presenter of presenterSources) {
    const startFrame = Math.round(presenter.startSeconds * marketingFrameRate);
    const endFrame = Math.round(presenter.endSeconds * marketingFrameRate);
    await setPlayhead(editor, startFrame);
    await editor.getByRole("button", { name: "Presenter", exact: true }).click();
    await editor.getByRole("button", { name: "Media", exact: true }).click();
    const presenterName = path.basename(presenter.path);
    await editor.getByRole("listitem").filter({ hasText: presenterName }).getByRole("button", { name: `Place ${presenterName} at playhead` }).click();
    const presenterClip = editor.locator(".aly-editor-clip--presenter").filter({ hasText: presenterName });
    await presenterClip.click();
    await editor.getByRole("button", { name: "Inspector", exact: true }).click();
    await setInspectorNumber(editor, "End frame", endFrame);
    await setInspectorNumber(editor, "X", presenterTransform.x);
    await setInspectorNumber(editor, "Y", presenterTransform.y);
    await setInspectorNumber(editor, "Scale X", presenterTransform.scaleX);
    await setInspectorNumber(editor, "Scale Y", presenterTransform.scaleY);
    // Each reviewed presenter MP4 carries its matching utterance. Keep it
    // visual-only so the stitched narration remains the only programme audio.
    await editor.getByLabel("Mute clip", { exact: true }).check();
  }

  await setPlayhead(editor, 0);
  await editor.getByRole("button", { name: "Narration", exact: true }).click();
  await editor.getByRole("button", { name: "Media", exact: true }).click();
  const narrationName = path.basename(assetManifest.assets.teachingVoice.path);
  await editor.getByRole("listitem").filter({ hasText: narrationName }).getByRole("button", { name: `Place ${narrationName} at playhead` }).click();
  const narrationClip = editor.locator(".aly-editor-clip--narration").filter({ hasText: narrationName });
  await narrationClip.click();
  await editor.getByRole("button", { name: "Inspector", exact: true }).click();
  await setInspectorNumber(editor, "End frame", timing.durationFrames);

  for (let index = 0; index < timing.scenes.length; index += 1) {
    const scene = timing.scenes[index];
    await setPlayhead(editor, scene.startFrame);
    await editor.getByRole("button", { name: "Add caption", exact: true }).click();
    await editor.getByLabel("On-screen text").fill(assetManifest.teachingCaptions[index].text);
    await setInspectorNumber(editor, "End frame", scene.endFrame);
    await setInspectorNumber(editor, "Text size", 46);
    await editor.getByLabel("Text placement").selectOption("bottom");
  }
  if (assetManifest.mode === "draft") {
    await setPlayhead(editor, 0);
    await editor.getByRole("button", { name: "Add title", exact: true }).click();
    await editor.getByLabel("On-screen text").fill("DRAFT · PRESENTER / VOICE PENDING");
    await setInspectorNumber(editor, "End frame", timing.durationFrames);
    await setInspectorNumber(editor, "Text size", 28);
    await editor.getByLabel("Text placement").selectOption("top");
  }
  if (await hideEmpty.getAttribute("aria-pressed") !== "true") await hideEmpty.click();
  const hideCaptions = editor.getByRole("button", { name: "Hide Captions", exact: true });
  await hideCaptions.click();
  await expect(hideCaptions).toHaveAttribute("aria-pressed", "true");
  const captionFreeSaved = await waitForDurableMarketingTimeline({
    page, editor, invokeNative, identity,
    contract: { ...timelineContract, captionsHidden: true, music: null },
    timeoutMs: actionTimeoutMs,
    label: "Caption-free marketing tutorial timeline",
  });
  await editor.getByRole("button", { name: "Render timeline" }).click();
  const statusText = await waitForEditorRender(editor.locator(".aly-editor-shell__status"), jobTimeoutMs);
  const outputPath = statusText.match(/^Timeline rendered to (.+?)(?: ·|$)/u)?.[1];
  if (!outputPath) throw new Error(`Marketing tutorial editor render failed: ${statusText}`);
  const probe = await probeMedia(ffprobePath, outputPath);
  if (!probe.video || !probe.audio || Math.abs(probe.durationSeconds - timing.durationSeconds) > 0.12) throw new Error(`Marketing tutorial render has an invalid duration or streams: ${JSON.stringify(probe)}`);
  await hideCaptions.click();
  await expect(hideCaptions).toHaveAttribute("aria-pressed", "false");
  const restoredCaptionSaved = await waitForDurableMarketingTimeline({
    page, editor, invokeNative, identity,
    contract: { ...timelineContract, captionsHidden: false, music: null },
    timeoutMs: actionTimeoutMs,
    label: "Restored-caption marketing tutorial timeline",
  });
  return {
    identity, title: initialSnapshot.title, outputPath, outputSha256: await sha256File(outputPath), probe, timing, presenterTransform, timelineContract,
    captionFreeRenderRevisionNumber: captionFreeSaved.revisionNumber,
    restoredCaptionRevisionNumber: restoredCaptionSaved.revisionNumber,
    actualNativeEditorRender: true, captionsBurnedIn: false, captionsPreservedInProject: true, fixtureUi: false,
  };
}

export function buildMarketingNativeCaptureTimeline({ timeline, edit, projectTitle, state = {} }) {
  if (typeof timeline !== "function") throw new Error("Gifsmith timeline() is required");
  if (!edit?.mp4?.beats || typeof projectTitle !== "string" || !projectTitle.trim()) throw new Error("A validated marketing edit and exact project title are required");
  const productBeats = new Map(edit.mp4.beats.filter((beat) => beat.id.startsWith("native-")).map((beat) => [beat.id, beat]));
  for (const contract of productBeatContract) if (!productBeats.has(contract.id)) throw new Error(`Marketing edit is missing ${contract.id}`);
  return timeline((t) => {
    t.waitFor(".app-shell", { timeoutMs: 30_000 });
    t.cue("Actual tutorial in Review");
    t.call(async (gifPage, ctx) => {
      state.reviewStart = await ctx.settle(gifPage.evaluate(async () => {
        const video = document.querySelector('video[aria-label="Authoritative generated tutorial media"]');
        if (!(video instanceof HTMLVideoElement)) throw new Error("Marketing tutorial Review video is missing");
        video.muted = true;
        video.preload = "auto";
        if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
          await new Promise((resolve, reject) => {
            const timeout = window.setTimeout(() => reject(new Error("Marketing tutorial Review did not become playable")), 10_000);
            video.addEventListener("canplay", () => { window.clearTimeout(timeout); resolve(); }, { once: true });
            video.load();
          });
        }
        if (video.currentTime > 0.04) video.currentTime = 0;
        await video.play();
        return { currentTime: video.currentTime, duration: video.duration, readyState: video.readyState };
      }), { label: "start actual tutorial Review playback" });
    }, { name: "Play actual tutorial in Review", seconds: 0.25 });
    t.hold(beatDuration(productBeats.get("native-review")) - 0.25);
    t.call(async (gifPage, ctx) => {
      await clickByAria(gifPage, ctx, "Studio");
      await clickByText(gifPage, ctx, /^Edit tracks & timing/iu);
      await ctx.settle(gifPage.waitForSelector('[role="dialog"][aria-label="Integrated advanced video editor"]', { visible: true }), { label: "marketing tutorial editor" });
    }, { name: "Open actual tutorial editor", seconds: 0.8 });
    t.cue("Edit every word and beat");
    t.call(async (gifPage, ctx) => { await clickByAria(gifPage, ctx, "Transcript"); }, { name: "Open transcript panel", seconds: 0.35 });
    t.hold(0.45);
    t.drag('[role="separator"][aria-label="Resize side panel width"]', { dx: 150, dy: 0 }, 0.7);
    t.drag('[role="separator"][aria-label="Resize timeline height"]', { dx: 0, dy: -105 }, 0.7);
    t.call(async (gifPage, ctx) => {
      state.editorLayout = await ctx.settle(gifPage.evaluate(() => {
        const dock = document.querySelector('[role="separator"][aria-label="Resize side panel width"]');
        const timeline = document.querySelector('[role="separator"][aria-label="Resize timeline height"]');
        return { dockWidth: Number(dock?.getAttribute("aria-valuenow")), timelineHeight: Number(timeline?.getAttribute("aria-valuenow")) };
      }), { label: "measure resized marketing editor" });
    }, { name: "Verify editor resize", seconds: 0 });
    t.hold(Math.max(0.2, beatDuration(productBeats.get("native-editor")) - 3));
    t.call(async (gifPage, ctx) => {
      await clickByAriaPrefix(gifPage, ctx, "Return to scene");
      await clickByAria(gifPage, ctx, "Plan");
      await clickByText(gifPage, ctx, presentersPlanSectionPattern);
      await ctx.settle(gifPage.waitForSelector(".presenter-picker__gallery", { visible: true }), { label: "presenter gallery" });
    }, { name: "Open presenter gallery", seconds: 0.8 });
    t.cue("Presenters and included teaching visuals");
    t.hold(Math.max(0.5, beatDuration(productBeats.get("native-assets")) - 1.5));
    t.call(async (gifPage, ctx) => {
      await clickCss(gifPage, ctx, ".project-switcher");
      await clickByAria(gifPage, ctx, "Library");
      await waitForHeading(gifPage, ctx, "Library");
    }, { name: "Open included teaching library", seconds: 0.7 });
    t.hold(0.8);
    t.call(async (gifPage, ctx) => {
      await clickByAria(gifPage, ctx, "Models & providers");
      await waitForHeading(gifPage, ctx, "Models & providers");
      await ctx.settle(gifPage.waitForSelector(".aly-catalog-card", { visible: true }), { label: "model cards" });
    }, { name: "Open Models and providers", seconds: 0.8 });
    t.cue("Cloud or downloadable local models");
    t.hold(Math.max(0.6, beatDuration(productBeats.get("native-models")) - 1.6));
    t.call(async (gifPage, ctx) => {
      await clickByAriaPrefix(gifPage, ctx, "Downloads");
      await ctx.settle(gifPage.waitForSelector('[aria-label="Model downloads"]', { visible: true }), { label: "model downloads" });
    }, { name: "Show downloads panel", seconds: 0.5 });
    t.call(async (gifPage, ctx) => { await clickByAria(gifPage, ctx, "Minimize downloads"); }, { name: "Minimize downloads panel", seconds: 0.3 });
    t.call(async (gifPage, ctx) => {
      await clickByAria(gifPage, ctx, "Projects");
      await waitForHeading(gifPage, ctx, "Projects");
      await openProjectByTitle(gifPage, ctx, projectTitle);
      await clickByAria(gifPage, ctx, "Review");
      await ctx.settle(gifPage.waitForSelector('video[aria-label="Authoritative generated tutorial media"]', { visible: true }), { label: "finished tutorial Review" });
    }, { name: "Return to finished tutorial", seconds: 1.1 });
    t.cue("Review and export the finished tutorial");
    t.hold(Math.max(0.4, beatDuration(productBeats.get("native-export")) - 1.1));
  });
}

function beatDuration(beat) {
  const value = Number(beat?.out) - Number(beat?.in);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Marketing beat has an invalid duration: ${JSON.stringify(beat)}`);
  return value;
}

async function clickByAria(page, ctx, label) {
  await ctx.settle(page.evaluate((accessibleName) => {
    const target = [...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === accessibleName || button.textContent?.trim() === accessibleName);
    if (!(target instanceof HTMLButtonElement)) throw new Error(`Button ${accessibleName} is missing`);
    target.click();
  }, label), { label: `click ${label}` });
}

async function clickByAriaPrefix(page, ctx, prefix) {
  await ctx.settle(page.evaluate((value) => {
    const target = [...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label")?.startsWith(value));
    if (!(target instanceof HTMLButtonElement)) throw new Error(`Button starting ${value} is missing`);
    target.click();
  }, prefix), { label: `click ${prefix}` });
}

async function clickByText(page, ctx, pattern) {
  const source = pattern.source;
  const flags = pattern.flags;
  await ctx.settle(page.evaluate(({ source, flags }) => {
    const expression = new RegExp(source, flags);
    const target = [...document.querySelectorAll("button")].find((button) => expression.test(button.textContent?.trim() ?? ""));
    if (!(target instanceof HTMLButtonElement)) throw new Error(`Text button ${source} is missing`);
    target.click();
  }, { source, flags }), { label: `click ${source}` });
}

async function clickCss(page, ctx, selector) {
  await ctx.settle(page.evaluate((value) => {
    const target = document.querySelector(value);
    if (!(target instanceof HTMLElement)) throw new Error(`Control ${value} is missing`);
    target.click();
  }, selector), { label: `click ${selector}` });
}

async function waitForHeading(page, ctx, text) {
  await ctx.settle(page.waitForFunction((expected) => [...document.querySelectorAll("h1")].some((heading) => heading.textContent?.trim() === expected), {}, text), { label: `wait for ${text}` });
}

async function openProjectByTitle(page, ctx, title) {
  await ctx.settle(page.waitForSelector(".project-grid", { visible: true }), { label: "project grid" });
  await ctx.settle(page.evaluate((expected) => {
    const button = [...document.querySelectorAll("button.project-card")].find((candidate) => candidate.querySelector("h3")?.textContent?.trim() === expected);
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Project card ${expected} is missing`);
    button.click();
  }, title), { label: `open project ${title}` });
}

export async function writeMarketingPreparationReceipt({ manifestPath, outputPath, ffprobePath, stage = "preflight" }) {
  const validation = await validateMarketingAssetManifest(manifestPath, { ffprobePath, stage });
  const receipt = {
    schemaVersion: 1,
    state: "prepared",
    evidenceClass: validation.manifest.mode === "final" ? "final-assets-ready-native-capture-pending" : "draft-placeholder-assets-native-capture-pending",
    createdAtUtc: new Date().toISOString(),
    manifestPath: path.resolve(manifestPath),
    manifestSha256: await sha256File(manifestPath),
    edit: validation.edit,
    probes: validation.probes,
    finalMode: validation.manifest.mode === "final",
    validationStage: stage,
    noNativeLaunchPerformed: true,
    noProviderCallPerformed: true,
    noGpuInferencePerformed: true,
  };
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return receipt;
}

export function deriveNativeSceneTiming(captions, durationSeconds) {
  const durationFrames = Math.max(1, Math.round(durationSeconds * marketingFrameRate));
  const scenes = captions.map((cue, index) => {
    const startFrame = Math.round(cue.startSeconds * marketingFrameRate);
    const endFrame = index === captions.length - 1 ? durationFrames : Math.round(cue.endSeconds * marketingFrameRate);
    return { id: tutorialCueIds[index], startFrame, endFrame, durationFrames: endFrame - startFrame };
  });
  if (scenes.some((scene) => scene.durationFrames <= 0) || scenes[0].startFrame !== 0 || scenes.at(-1).endFrame !== durationFrames) throw new Error("Teaching caption timing does not cover the complete native tutorial timeline");
  return { durationFrames, durationSeconds: durationFrames / marketingFrameRate, scenes };
}

function validateCaptionSequence(captions, durationSeconds, fullText) {
  let previousEnd = 0;
  for (let index = 0; index < captions.length; index += 1) {
    const cue = captions[index];
    if (cue.id !== tutorialCueIds[index] || typeof cue.text !== "string" || !cue.text.trim()) throw new Error(`Teaching caption ${index + 1} has the wrong ID or no text`);
    if (!Number.isFinite(cue.startSeconds) || !Number.isFinite(cue.endSeconds) || cue.startSeconds < 0 || cue.endSeconds <= cue.startSeconds) throw new Error(`Teaching caption ${cue.id} has invalid timing`);
    if (Math.abs(cue.startSeconds - previousEnd) > 0.08) throw new Error(`Teaching caption ${cue.id} leaves a gap or overlap larger than 80 ms`);
    previousEnd = cue.endSeconds;
  }
  if (Math.abs(previousEnd - durationSeconds) > 0.08) throw new Error("Teaching captions do not cover the verified narration duration");
  if (normalizeText(captions.map((cue) => cue.text).join(" ")) !== normalizeText(fullText)) throw new Error("Teaching caption text does not reconstruct the approved narration exactly");
}

async function validateHashedFile(asset, label) {
  if (typeof asset.path !== "string" || !asset.path || !/^[0-9a-f]{64}$/u.test(asset.sha256 ?? "")) throw new Error(`${label} needs an absolute path and SHA-256`);
  if (!path.isAbsolute(asset.path)) throw new Error(`${label} path must be absolute`);
  const details = await stat(asset.path);
  if (!details.isFile() || details.size <= 0) throw new Error(`${label} is empty`);
  const actual = await sha256File(asset.path);
  if (actual !== asset.sha256) throw new Error(`${label} SHA-256 does not match its file`);
}

function proportionalDurations(total, weights) {
  const sum = weights.reduce((accumulator, value) => accumulator + value, 0);
  const values = weights.map((weight) => total * weight / sum);
  values[values.length - 1] = total - values.slice(0, -1).reduce((accumulator, value) => accumulator + value, 0);
  return values;
}

function segmentDuration(segment) {
  if (Number.isFinite(segment.durationSeconds)) return Number(segment.durationSeconds);
  if (Number.isFinite(segment.startSeconds) && Number.isFinite(segment.endSeconds)) return Number(segment.endSeconds) - Number(segment.startSeconds);
  return Number.NaN;
}

function assertDuration(value, label, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${label} duration ${value} is outside ${minimum}–${maximum}s`);
}

function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/gu, " ");
}

function transcriptTokens(value) {
  return String(value ?? "").toLocaleLowerCase("en-US").match(/[a-z]+(?:'[a-z]+)?/gu) ?? [];
}

function round3(value) {
  return Number(value.toFixed(3));
}

async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function probeMedia(ffprobePath, file) {
  const { stdout } = await execFileAsync(ffprobePath, ["-v", "error", "-show_entries", "format=duration:stream=index,codec_type,codec_name,width,height,pix_fmt,sample_rate,channels,r_frame_rate", "-of", "json", file], { windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  const video = parsed.streams?.find((stream) => stream.codec_type === "video") ?? null;
  const audio = parsed.streams?.find((stream) => stream.codec_type === "audio") ?? null;
  return { durationSeconds: Number(parsed.format?.duration), video, audio };
}

async function setPlayhead(editor, frame) {
  const seconds = Math.floor(frame / marketingFrameRate);
  const remainder = frame % marketingFrameRate;
  const timecode = `00:00:${String(seconds).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  const control = editor.getByLabel("Playhead timecode");
  await control.fill(timecode);
  await control.press("Enter");
}

async function setInspectorNumber(editor, label, value) {
  const control = editor.getByLabel(label, { exact: true });
  await control.fill(String(value));
  await control.press("Enter");
  await expect(control).toHaveValue(String(value));
}

async function waitForEditorRender(status, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = (await status.innerText()).trim();
    if (value.startsWith("Timeline rendered to ") || (value && value !== "Rendering the edited timeline…")) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the marketing tutorial editor render");
}

async function runCli() {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    if (!key.startsWith("--")) continue;
    const next = process.argv[index + 1];
    args.set(key, next && !next.startsWith("--") ? (index += 1, next) : true);
  }
  if (args.has("--render-visuals")) {
    const outputDirectory = args.get("--render-visuals");
    if (typeof outputDirectory !== "string") throw new Error("--render-visuals requires an output directory");
    process.stdout.write(`${JSON.stringify(await renderRayleighVisuals(path.resolve(outputDirectory)), null, 2)}\n`);
    return;
  }
  if (args.has("--validate-plan")) {
    const teachingDurationSeconds = Number(args.get("--teaching-seconds") ?? 12.4);
    const productDurations = String(args.get("--product-seconds") ?? "2.6,4.1,3.1,3.0,2.8").split(",").map(Number);
    const productSegments = productDurations.map((durationSeconds, index) => ({ id: productBeatContract[index]?.id, durationSeconds }));
    process.stdout.write(`${JSON.stringify(deriveAdaptiveMarketingEdit({ teachingDurationSeconds, productSegments }), null, 2)}\n`);
    return;
  }
  if (args.has("--manifest")) {
    const manifestPath = path.resolve(String(args.get("--manifest")));
    const outputPath = path.resolve(String(args.get("--receipt") ?? path.join(path.dirname(manifestPath), "marketing-preparation.receipt.json")));
    const ffprobePath = args.get("--ffprobe");
    const stage = args.get("--stage") ?? "preflight";
    process.stdout.write(`${JSON.stringify(await writeMarketingPreparationReceipt({ manifestPath, outputPath, ffprobePath: typeof ffprobePath === "string" ? path.resolve(ffprobePath) : undefined, stage: String(stage) }), null, 2)}\n`);
    return;
  }
  throw new Error("Use --render-visuals <dir>, --validate-plan, or --manifest <file> [--ffprobe <file>] [--receipt <file>]");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await runCli();
}
