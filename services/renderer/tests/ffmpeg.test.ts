import test from "node:test";
import assert from "node:assert/strict";
import { fixtureTarget } from "../src/fixture.js";
import {
  ffmpegDistributionWarnings,
  parseFfmpegCapabilities,
  planAudioMaster,
  planDeliveryEncode,
  planFrameSequenceToFfv1,
  planProbe,
  planSilentAudio,
} from "../src/ffmpeg.js";
import { secondsToTicks } from "../src/timebase.js";

test("FFV1 plan is lossless, intra-only, and color tagged", () => {
  const plan = planFrameSequenceToFfv1("frames/frame-%08d.png", "scene.mkv", fixtureTarget());
  assert.deepEqual(plan.args.slice(-18), ["-an", "-c:v", "ffv1", "-level", "3", "-coder", "1", "-context", "1", "-g", "1", "-pix_fmt", "gbrp10le", "-color_primaries", "bt709", "-color_trc", "iec61966-2-1", "-colorspace", "bt709", "-f", "matroska", "scene.mkv"].slice(-18));
  assert.ok(plan.args.includes("30000/1000") || plan.args.includes("30/1"));
  assert.ok(plan.args.includes("+bitexact"));
  assert.ok(plan.args.includes("-map_metadata"));
});

test("GPL encoder stays visibly separated", () => {
  const plan = planDeliveryEncode("video.mkv", "audio.wav", "output.mp4", { codec: "libx264", quality: 18 });
  assert.ok(plan.args.includes("libx264"));
  assert.match(plan.licensingWarnings.join(" "), /GPL runtime pack/);
});

test("WebM delivery uses compatible Opus audio and WebVTT captions", () => {
  const plan = planDeliveryEncode("video.mkv", "audio.wav", "output.webm", { codec: "vp9", captionPath: "captions.vtt" });
  assert.ok(plan.args.includes("libopus"));
  assert.ok(plan.args.includes("webvtt"));
  assert.ok(plan.args.includes("2:s:0"));
});

test("audio master uses 48 kHz and measurable loudness targets", () => {
  const plan = planAudioMaster([
    { path: "narration.wav", role: "narration", startTick: 0 },
    { path: "music.wav", role: "music", startTick: secondsToTicks(0.5), gainDb: -21 },
  ], "master.wav");
  assert.match(plan.args.join(" "), /loudnorm=I=-16:LRA=11:TP=-1\.5/);
  assert.match(plan.args.join(" "), /sidechaincompress=/);
  assert.ok(plan.args.includes("pcm_s24le"));
  assert.ok(plan.args.includes("48000"));
});

test("range audio is source-trimmed, timeline-shifted, and exact duration", () => {
  const plan = planAudioMaster([
    { path: "narration.wav", role: "narration", startTick: 0 },
  ], "range.wav", { timelineStartTick: secondsToTicks(2), durationTicks: secondsToTicks(3) });
  const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
  assert.match(filter ?? "", /atrim=start=2\.000000:duration=3\.000000/);
  assert.match(filter ?? "", /apad=whole_dur=3\.000000,atrim=duration=3\.000000/);
});

test("silent master is exact-duration stereo PCM at 48 kHz", () => {
  const plan = planSilentAudio(secondsToTicks(1.25), "silent.wav");
  assert.ok(plan.args.includes("anullsrc=r=48000:cl=stereo"));
  assert.ok(plan.args.includes("1.250000"));
  assert.ok(plan.args.includes("pcm_s24le"));
});

test("probe plan requests structured streams and format", () => {
  assert.deepEqual(planProbe("out.mp4").args.slice(-2), ["json", "out.mp4"]);
});

test("FFmpeg build flags produce redistribution warnings", () => {
  const capabilities = parseFfmpegCapabilities(
    "ffmpeg version test\nconfiguration: --enable-gpl --enable-libx264",
    " V....D h264_nvenc NVIDIA NVENC H.264 encoder\n V..... libx264 libx264 H.264",
  );
  assert.equal(capabilities.isGpl, true);
  assert.equal(capabilities.encoders.has("h264_nvenc"), true);
  assert.match(ffmpegDistributionWarnings(capabilities).join(" "), /must not be bundled/);
});

test("paths cannot smuggle response lines or shell control", () => {
  assert.throws(() => planProbe("ok.mp4\n-hide_banner"), /control characters/);
  const ordinary = planProbe("video; touch nope.mp4");
  assert.equal(ordinary.args.at(-1), "video; touch nope.mp4");
});
