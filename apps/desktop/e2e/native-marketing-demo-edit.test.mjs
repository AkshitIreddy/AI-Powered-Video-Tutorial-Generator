import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildMarketingTutorialProjectDocument,
  buildMarketingNativeCaptureTimeline,
  deriveAdaptiveMarketingEdit,
  marketingTeachingScript,
  rayleighVisuals,
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

test("adaptive edit follows verified narration durations and covers 35–50 seconds without a gap", () => {
  const edit = deriveAdaptiveMarketingEdit({ teachingDurationSeconds: 12.4, productSegments });
  assert.equal(edit.mp4.durationSeconds, 35);
  assert.equal(edit.webp.durationSeconds, 14.8);
  assert.equal(edit.webp.startsWithVisibleMotion, true);
  assert.deepEqual(edit.mp4.beats.slice(0, 3).map((beat) => beat.visualId), rayleighVisuals.map((visual) => visual.id));
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

test("native tutorial project uses three factual scenes and exact phrase captions", () => {
  const project = buildMarketingTutorialProjectDocument({ teachingDurationSeconds: 12.4, captions: teachingCaptions, mode: "final" });
  assert.equal(project.title, "Why the daytime sky looks blue");
  assert.equal(project.scenes.length, 3);
  assert.deepEqual(project.scenes.map((scene) => scene.visual), rayleighVisuals.map((visual) => visual.id));
  assert.equal(project.scenes.map((scene) => scene.narration).join(" "), marketingTeachingScript);
  assert.equal(project.marketingDemo.exactTeachingScript, marketingTeachingScript);
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
      presenterVideo: await asset("presenter.mp4", { publicDemoCleared: true, temporalReviewPassed: true, naturalBlinkVerified: true }),
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
