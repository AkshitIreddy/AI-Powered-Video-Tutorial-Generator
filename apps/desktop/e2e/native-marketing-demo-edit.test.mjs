import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildMarketingTutorialProjectDocument,
  buildMarketingNativeCaptureTimeline,
  deriveMarketingPresenterTransform,
  deriveSentenceSegmentsFromAsr,
  deriveAdaptiveMarketingEdit,
  inspectMarketingTimelineDocument,
  marketingCaptionStyle,
  marketingTeachingScript,
  nativeProjectCardIdentityToken,
  rayleighVisuals,
  resolveNativeProjectCardChoice,
  validateMarketingAssetManifest,
} from "./native-marketing-demo-edit.mjs";

const productSegments = [
  { id: "native-review", durationSeconds: 2.6 },
  { id: "native-editor", durationSeconds: 4.1 },
  { id: "native-assets", durationSeconds: 3.1 },
  { id: "native-models", durationSeconds: 3.0 },
  { id: "native-export", durationSeconds: 2.8 },
];

const teachingCaptions = [
  { id: "white-light", startSeconds: 0, endSeconds: 3.2, text: "Sunlight looks white, but it carries every visible color." },
  { id: "molecule-scattering", startSeconds: 3.2, endSeconds: 8.4, text: "In Earth's atmosphere, tiny molecules scatter shorter blue wavelengths much more strongly than red ones." },
  { id: "viewer-conclusion", startSeconds: 8.4, endSeconds: 12.4, text: "That scattered blue reaches your eyes from every direction, so the daytime sky looks blue." },
];

test("native project reopening prefers the exact persisted identity and rejects ambiguous title fallbacks", () => {
  assert.equal(nativeProjectCardIdentityToken("project-2f8b7a"), "art-project-2f8b7a");
  assert.equal(resolveNativeProjectCardChoice({ identityMatches: 1, titleMatches: 2 }), "identity");
  assert.equal(resolveNativeProjectCardChoice({ identityMatches: 0, titleMatches: 1 }), "title");
  assert.throws(() => resolveNativeProjectCardChoice({ identityMatches: 0, titleMatches: 2 }), /title fallback matched 2/u);
  assert.throws(() => nativeProjectCardIdentityToken('project"unsafe'), /not safe/u);
});

test("durable marketing timeline inspection requires exact ranges, presenter transforms, and no overlap", () => {
  const transform = { x: 550, y: 110, scaleX: 0.68, scaleY: 0.68 };
  const contract = {
    timing: {
      durationFrames: 300,
      scenes: [
        { startFrame: 0, endFrame: 90 },
        { startFrame: 90, endFrame: 180 },
        { startFrame: 180, endFrame: 300 },
      ],
    },
    presenters: [
      { name: "emma.mp4", startFrame: 0, endFrame: 70 },
      { name: "yuki.mp4", startFrame: 70, endFrame: 145 },
      { name: "noah.mp4", startFrame: 145, endFrame: 225 },
      { name: "chloe.mp4", startFrame: 225, endFrame: 300 },
    ],
    presenterTransform: transform,
    captions: ["First", "Second", "Third"],
    captionsHidden: false,
    music: null,
  };
  const rangeClip = (kind, startFrame, endFrame, extra = {}) => ({ kind, timelineRange: { startFrame, durationFrames: endFrame - startFrame }, ...extra });
  const document = {
    tracks: [
      { kind: "slides", clips: contract.timing.scenes.map((scene) => rangeClip("slides", scene.startFrame, scene.endFrame)) },
      { kind: "presenter", clips: contract.presenters.map((presenter) => rangeClip("presenter", presenter.startFrame, presenter.endFrame, { name: presenter.name, transform, audio: { muted: true } })) },
      { kind: "captions", hidden: false, clips: contract.timing.scenes.map((scene, index) => rangeClip("captions", scene.startFrame, scene.endFrame, { text: contract.captions[index] })) },
      { kind: "narration", clips: [rangeClip("narration", 0, 300)] },
      { kind: "music", clips: [] },
    ],
  };
  assert.equal(inspectMarketingTimelineDocument(document, contract).matches, true);
  document.tracks[1].clips[1].timelineRange.startFrame = 69;
  const invalid = inspectMarketingTimelineDocument(document, contract);
  assert.equal(invalid.matches, false);
  assert.equal(invalid.diagnostic.overlaps.presenter, 1);
  assert.equal(invalid.diagnostic.exactPresenterRanges, false);
});

test("adaptive edit follows verified narration durations and covers 35–50 seconds without a gap", () => {
  const edit = deriveAdaptiveMarketingEdit({ teachingDurationSeconds: 12.4, teachingSegments: teachingCaptions, productSegments });
  assert.equal(edit.mp4.durationSeconds, 35);
  assert.equal(edit.webp.durationSeconds, 14.8);
  assert.equal(edit.webp.startsWithVisibleMotion, true);
  assert.deepEqual(edit.webp.beats.map((beat) => beat.out), [3.2, 8.4, 11.4, 14.8]);
  assert.deepEqual(edit.mp4.beats.slice(0, 3).map((beat) => beat.visualId), rayleighVisuals.map((visual) => visual.id));
  assert.deepEqual(edit.mp4.beats.slice(0, 3).map((beat) => beat.out), [3.2, 8.4, 12.72]);
  for (let index = 1; index < edit.mp4.beats.length; index += 1) {
    assert.ok(Math.abs(edit.mp4.beats[index - 1].out - edit.mp4.beats[index].in) <= 0.001, `gap before ${edit.mp4.beats[index].id}`);
  }
  assert.equal(edit.mp4.beats.at(-1).out, edit.mp4.durationSeconds);
});

test("adaptive edit expands naturally for longer verified reads", () => {
  const edit = deriveAdaptiveMarketingEdit({
    teachingDurationSeconds: 17.25,
    productSegments: productSegments.map((segment) => ({ ...segment, durationSeconds: segment.durationSeconds + 0.7 })),
  });
  assert.ok(edit.mp4.durationSeconds > 35);
  assert.ok(edit.mp4.durationSeconds <= 50);
  assert.ok(edit.webp.durationSeconds >= 12 && edit.webp.durationSeconds <= 20);
  assert.equal(edit.mp4.beats[2].out, Number((17.25 + 0.32).toFixed(3)));
});

test("animated WebP samples all four presenter styles in order before the native editor", () => {
  const edit = deriveAdaptiveMarketingEdit({
    teachingDurationSeconds: 22.18,
    teachingSegments: [
      { id: "white-light", startSeconds: 0, endSeconds: 5.69 },
      { id: "molecule-scattering", startSeconds: 5.69, endSeconds: 13.6 },
      { id: "viewer-conclusion", startSeconds: 13.6, endSeconds: 22.18 },
    ],
    presenterSegments: [
      { style: "realistic-woman", startSeconds: 0, endSeconds: 5.69 },
      { style: "anime-woman", startSeconds: 5.69, endSeconds: 13.6 },
      { style: "realistic-man", startSeconds: 13.6, endSeconds: 18.8 },
      { style: "cartoon-woman", startSeconds: 18.8, endSeconds: 22.18 },
    ],
    productSegments,
  });
  assert.equal(edit.webp.durationSeconds, 17.28);
  assert.deepEqual(edit.webp.beats.map((beat) => beat.presenterStyle ?? beat.id), ["realistic-woman", "anime-woman", "realistic-man", "cartoon-woman", "actual-native-editor"]);
  assert.deepEqual(edit.webp.beats.slice(0, 4).map((beat) => [beat.sourceIn, beat.sourceOut]), [[0, 3.5], [5.69, 9.19], [13.6, 17.1], [18.8, 22.18]]);
  assert.equal(edit.webp.beats.at(-1).out, edit.webp.durationSeconds);
});

test("product UI beats use readable close-ups and compact blurred glass captions", () => {
  const edit = deriveAdaptiveMarketingEdit({ teachingDurationSeconds: 12.4, teachingSegments: teachingCaptions, productSegments });
  const productBeats = edit.mp4.beats.slice(3, 8);
  assert.deepEqual(productBeats.map((beat) => beat.focusRegion), ["review-player", "editor-transcript-dock-timeline", "presenter-gallery-and-teaching-library", "model-card-and-download-panel", "review-export"]);
  assert.ok(productBeats.slice(1, 4).every((beat) => beat.editorialZoom >= 1.2 && beat.editorialZoom <= 1.4));
  assert.equal(marketingCaptionStyle.maximumLines, 2);
  assert.equal(marketingCaptionStyle.maximumWidthPercent, 76);
  assert.equal(marketingCaptionStyle.treatment, "blurred-transparent-glass");
  assert.equal(marketingCaptionStyle.panelColor, "#101722");
  assert.deepEqual(marketingCaptionStyle.panelOpacityRange, [0.36, 0.48]);
  assert.equal(marketingCaptionStyle.backdropBlurRadius, 10);
  assert.equal(marketingCaptionStyle.borderOpacity, 0.3);
});

test("native tutorial project uses three factual scenes and exact phrase captions", () => {
  const project = buildMarketingTutorialProjectDocument({ teachingDurationSeconds: 12.4, captions: teachingCaptions, mode: "final" });
  assert.equal(project.title, "Why the daytime sky looks blue");
  assert.equal(project.scenes.length, 3);
  assert.deepEqual(project.scenes.map((scene) => scene.visual), rayleighVisuals.map((visual) => visual.id));
  assert.equal(project.scenes.map((scene) => scene.narration).join(" "), marketingTeachingScript);
  assert.equal(project.marketingDemo.exactTeachingScript, marketingTeachingScript);
});

test("native marketing scenario can bind the exact selected SoulX route without changing the lesson", () => {
  const document = buildMarketingTutorialProjectDocument({
    teachingDurationSeconds: 12.4,
    captions: teachingCaptions,
    presenterRouteModel: "local/soulx-flashhead-pro",
  });
  assert.deepEqual(document.providerRoutingPolicy.routes, [{
    capability: "lipsync.generate",
    model: "local/soulx-flashhead-pro",
    providerIds: ["local-runtime"],
    voice: null,
  }]);
  assert.equal(document.scenes.map((scene) => scene.narration).join(" "), marketingTeachingScript);
});

test("project construction rejects caption gaps and paraphrases", () => {
  assert.throws(
    () => buildMarketingTutorialProjectDocument({ teachingDurationSeconds: 12.4, captions: teachingCaptions.map((cue, index) => index === 1 ? { ...cue, startSeconds: 3.5 } : cue), mode: "final" }),
    /gap or overlap/,
  );
  assert.throws(
    () => buildMarketingTutorialProjectDocument({ teachingDurationSeconds: 12.4, captions: teachingCaptions.map((cue, index) => index === 2 ? { ...cue, text: "The sky is blue." } : cue), mode: "final" }),
    /approved narration exactly/,
  );
});

test("Gifsmith capture plan uses real Review, editor, gallery, models, downloads, and project-return actions", () => {
  const edit = deriveAdaptiveMarketingEdit({ teachingDurationSeconds: 12.4, productSegments });
  const operations = [];
  const timeline = (compile) => {
    const builder = {
      waitFor: (selector) => operations.push({ kind: "waitFor", selector }),
      cue: (name) => operations.push({ kind: "cue", name }),
      call: (_callback, options) => operations.push({ kind: "call", name: options?.name, seconds: options?.seconds ?? 0 }),
      hold: (seconds) => operations.push({ kind: "hold", seconds }),
      drag: (selector, delta, seconds) => operations.push({ kind: "drag", selector, delta, seconds }),
    };
    compile(builder);
    return { operations };
  };
  const result = buildMarketingNativeCaptureTimeline({ timeline, edit, projectTitle: "Why the daytime sky looks blue" });
  assert.equal(result.operations, operations);
  assert.deepEqual(operations.filter((operation) => operation.kind === "cue").map((operation) => operation.name), [
    "Actual tutorial in Review",
    "Edit every word and beat",
    "Presenters and included teaching visuals",
    "Cloud or downloadable local models",
    "Review and export the finished tutorial",
  ]);
  assert.ok(operations.some((operation) => operation.kind === "drag" && operation.selector.includes("side panel")));
  assert.ok(operations.some((operation) => operation.kind === "call" && operation.name === "Show downloads panel"));
  assert.ok(operations.some((operation) => operation.kind === "call" && operation.name === "Return to finished tutorial"));
  assert.ok(operations.filter((operation) => operation.kind === "hold").every((operation) => operation.seconds > 0));
});

test("final preflight validates real inputs before native capture but final-edit also requires the capture receipt", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "alystria-marketing-manifest-"));
  const asset = async (name, extras = {}) => {
    const file = path.join(directory, name);
    const bytes = Buffer.from(`asset:${name}`);
    await writeFile(file, bytes);
    return { path: file, sha256: createHash("sha256").update(bytes).digest("hex"), ...extras };
  };
  const manifest = {
    schemaVersion: 1,
    mode: "final",
    draftWatermark: null,
    assets: {
      teachingVoice: await asset("teaching.wav", { transcript: marketingTeachingScript, durationSeconds: 12.4, publicDemoCleared: true }),
      productVoice: await asset("product.wav", { transcript: "This is a real lesson, ready to refine. Edit the script, timing, captions, and layout in one timeline. Choose a presenter, or start with included teaching visuals. Use cloud providers or downloadable local models. Then review and export the finished tutorial.", publicDemoCleared: true }),
      presenterClips: await Promise.all([
        ["emma.mp4", "realistic-woman", 0, 3.2],
        ["yuki.mp4", "anime-woman", 3.2, 6.2],
        ["noah.mp4", "realistic-man", 6.2, 9.2],
        ["chloe.mp4", "cartoon-woman", 9.2, 12.4],
      ].map(async ([name, style, startSeconds, endSeconds]) => asset(name, { style, startSeconds, endSeconds, publicDemoCleared: true, temporalReviewPassed: true, naturalBlinkVerified: true }))),
      music: await asset("music.wav"),
      visuals: await Promise.all(rayleighVisuals.map((visual) => asset(visual.filename, { id: visual.id, mediaType: "image/png", width: 1920, height: 1080 }))),
    },
    teachingCaptions,
    productSegments: [
      { ...productSegments[0], text: "This is a real lesson, ready to refine." },
      { ...productSegments[1], text: "Edit the script, timing, captions, and layout in one timeline." },
      { ...productSegments[2], text: "Choose a presenter, or start with included teaching visuals." },
      { ...productSegments[3], text: "Use cloud providers or downloadable local models." },
      { ...productSegments[4], text: "Then review and export the finished tutorial." },
    ],
  };
  const manifestPath = path.join(directory, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  const preflight = await validateMarketingAssetManifest(manifestPath, { stage: "preflight" });
  assert.equal(preflight.edit.mp4.durationSeconds, 35);
  await assert.rejects(() => validateMarketingAssetManifest(manifestPath, { stage: "final-edit" }), /missing nativeUiCapture/);
});

test("presenter placement converts desired canvas center to bounded editor offsets", () => {
  const placement = deriveMarketingPresenterTransform();
  assert.deepEqual({ x: placement.x, y: placement.y, scaleX: placement.scaleX, scaleY: placement.scaleY }, { x: 550, y: 110, scaleX: 0.68, scaleY: 0.68 });
  assert.deepEqual(placement.bounds, { left: 1142.8, top: 282.8, right: 1877.2, bottom: 1017.2 });
  assert.ok(placement.bounds.left >= 0 && placement.bounds.top >= 0 && placement.bounds.right <= 1920 && placement.bounds.bottom <= 1080);
  assert.throws(() => deriveMarketingPresenterTransform({ desiredCenterX: 1900 }), /escapes/);
});

test("verified ASR sentence timings use silence midpoints and retain the complete media tail", () => {
  const segments = deriveSentenceSegmentsFromAsr({
    asr: {
      state: "verified",
      exactNormalizedTranscript: true,
      durationSeconds: 5,
      expectedText: "One clear sentence. Then another one.",
      words: [
        { word: "One", start: 0.2, end: 0.5 },
        { word: "clear", start: 0.5, end: 0.8 },
        { word: "sentence.", start: 0.8, end: 1.2 },
        { word: "Then", start: 1.8, end: 2.1 },
        { word: "another", start: 2.1, end: 2.5 },
        { word: "one.", start: 2.5, end: 3.1 },
      ],
    },
    sentences: ["One clear sentence.", "Then another one."],
    ids: ["first", "second"],
  });
  assert.deepEqual(segments.map(({ id, startSeconds, endSeconds, durationSeconds }) => ({ id, startSeconds, endSeconds, durationSeconds })), [
    { id: "first", startSeconds: 0, endSeconds: 1.5, durationSeconds: 1.5 },
    { id: "second", startSeconds: 1.5, endSeconds: 5, durationSeconds: 3.5 },
  ]);
  assert.equal(segments[0].boundaryMethod, "midpoint-between-adjacent-sentence-word-timestamps");
  assert.equal(segments[1].boundaryMethod, "verified-media-duration");
});
