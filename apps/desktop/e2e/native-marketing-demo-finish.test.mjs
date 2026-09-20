import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketingFinishPlan, inspectAnimatedWebp, wrapMarketingCaption } from "./native-marketing-demo-finish.mjs";

function fixtureManifest(overrides = {}) {
  const manifest = {
    schemaVersion: 1,
    mode: "draft",
    draftWatermark: "DRAFT · NON-FINAL INPUTS",
    assets: {
      teachingVoice: { durationSeconds: 22.18 },
      nativeUiCapture: {
        endCardSourceSeconds: 42.8,
        segments: {
          "native-review": { sourceIn: 0, sourceOut: 4.21 },
          "native-editor": { sourceIn: 4.21, sourceOut: 9.79 },
          "native-assets": { sourceIn: 9.79, sourceOut: 13.83 },
          "native-models": { sourceIn: 13.83, sourceOut: 17.95 },
          "native-export": { sourceIn: 17.95, sourceOut: 22.32 },
        },
      },
    },
    productSegments: [
      { id: "native-review", startSeconds: 0, endSeconds: 3.93, text: "This is a real lesson, ready to refine." },
      { id: "native-editor", startSeconds: 3.93, endSeconds: 9.23, text: "Edit the script, timing, captions, and layout in one timeline." },
      { id: "native-assets", startSeconds: 9.23, endSeconds: 12.99, text: "Choose a presenter, or start with included teaching visuals." },
      { id: "native-models", startSeconds: 12.99, endSeconds: 16.83, text: "Use cloud providers or downloadable local models." },
      { id: "native-export", startSeconds: 16.83, endSeconds: 20.92, text: "Then review and export the finished tutorial." },
    ],
    adaptiveEdit: {
      mp4: {
        durationSeconds: 45.97, width: 1440, height: 810, fps: 25,
        beats: [
          { id: "tutorial-white-light", in: 0, out: 5.69 },
          { id: "tutorial-molecule-scattering", in: 5.69, out: 13.6 },
          { id: "tutorial-viewer-conclusion", in: 13.6, out: 22.5 },
          { id: "native-review", in: 22.5, out: 26.71, editorialZoom: 1.08, focusRegion: "review-player" },
          { id: "native-editor", in: 26.71, out: 32.29, editorialZoom: 1.34, focusRegion: "editor-transcript-dock-timeline" },
          { id: "native-assets", in: 32.29, out: 36.33, editorialZoom: 1.26, focusRegion: "presenter-gallery-and-teaching-library" },
          { id: "native-models", in: 36.33, out: 40.45, editorialZoom: 1.3, focusRegion: "model-card-and-download-panel" },
          { id: "native-export", in: 40.45, out: 44.82, editorialZoom: 1.08, focusRegion: "review-export" },
          { id: "end-card", in: 44.82, out: 45.97 },
        ],
      },
      webp: {
        durationSeconds: 17.28, width: 960, height: 540, fps: 10,
        beats: [
          { id: "tutorial-realistic-woman", presenterStyle: "realistic-woman", in: 0, out: 3.5, sourceIn: 0, sourceOut: 3.5 },
          { id: "tutorial-anime-woman", presenterStyle: "anime-woman", in: 3.5, out: 7, sourceIn: 5.69, sourceOut: 9.19 },
          { id: "tutorial-realistic-man", presenterStyle: "realistic-man", in: 7, out: 10.5, sourceIn: 13.6, sourceOut: 17.1 },
          { id: "tutorial-cartoon-woman", presenterStyle: "cartoon-woman", in: 10.5, out: 13.88, sourceIn: 18.8, sourceOut: 22.18 },
          { id: "actual-native-editor", in: 13.88, out: 17.28 },
        ],
      },
    },
    audioFinishContract: { targetIntegratedLufs: -16, maximumTruePeakDbtp: -1.5 },
  };
  return { ...manifest, ...overrides };
}

test("finishing plan preserves the 45.97 second EDL and readable UI close-ups", () => {
  const plan = buildMarketingFinishPlan(fixtureManifest());
  assert.equal(plan.mp4.durationSeconds, 45.97);
  assert.deepEqual(plan.mp4.segments.map((segment) => segment.id), ["tutorial", "native-review", "native-editor", "native-assets", "native-models", "native-export", "end-card"]);
  assert.deepEqual(plan.mp4.segments.slice(2, 5).map((segment) => segment.editorialZoom), [1.34, 1.26, 1.3]);
  assert.equal(plan.mp4.segments.find((segment) => segment.id === "native-editor").captionPlacement, "top-left");
  assert.equal(plan.mp4.segments.find((segment) => segment.id === "native-models").captionPlacement, "top-right");
  assert.equal(plan.audio.teachingHoldSeconds, 0.32);
  assert.equal(plan.webp.durationSeconds, 17.28);
  assert.deepEqual(plan.webp.segments.slice(0, 4).map((segment) => segment.presenterStyle), ["realistic-woman", "anime-woman", "realistic-man", "cartoon-woman"]);
});

test("finishing plan fails closed for unlabeled drafts and missing encoded-frame ranges", () => {
  assert.throws(() => buildMarketingFinishPlan(fixtureManifest({ draftWatermark: null })), /draftWatermark/);
  const missing = fixtureManifest();
  delete missing.assets.nativeUiCapture.segments["native-models"];
  assert.throws(() => buildMarketingFinishPlan(missing), /encoded-frame source ranges/);
});

test("caption wrapping stays on a compact two-line plate", () => {
  const lines = wrapMarketingCaption("Edit the script, timing, captions, and layout in one timeline.");
  assert.equal(lines.length, 2);
  assert.ok(lines.every((line) => line.length <= 50));
});

test("animated WebP inspection uses RIFF frame durations instead of ffprobe", () => {
  const chunk = (name, payload) => {
    const padding = payload.length % 2;
    const result = Buffer.alloc(8 + payload.length + padding);
    result.write(name, 0, 4, "ascii");
    result.writeUInt32LE(payload.length, 4);
    payload.copy(result, 8);
    return result;
  };
  const frame = (duration) => {
    const payload = Buffer.alloc(16);
    payload[12] = duration & 0xff;
    payload[13] = (duration >> 8) & 0xff;
    payload[14] = (duration >> 16) & 0xff;
    return chunk("ANMF", payload);
  };
  const body = Buffer.concat([Buffer.from("WEBP"), chunk("ANIM", Buffer.alloc(6)), frame(80), frame(120)]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, 4, "ascii");
  riff.writeUInt32LE(body.length, 4);
  const result = inspectAnimatedWebp(Buffer.concat([riff, body]));
  assert.deepEqual(result, { animated: true, frameCount: 2, durationMilliseconds: 200 });
});
