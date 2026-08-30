import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseAudioAnalysis, SpawnCommandRunner } from "../src/executor.js";
import { fixtureTarget } from "../src/fixture.js";
import {
  ffmpegDistributionWarnings,
  parseFfmpegCapabilities,
  planAudioAnalysis,
  planAudioMaster,
  planDeliveryEncode,
  planFrameSequenceToFfv1,
  planHardwareEncoderProbe,
  planPresenterComposite,
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

test("presenter plan trims, places, and losslessly composites local clips", () => {
  const plan = planPresenterComposite("base.mkv", [{
    id: "guide",
    path: "presenter.mp4",
    sha256: "a".repeat(64),
    sceneId: "scene.presenter",
    sourceStartTick: secondsToTicks(1.25),
    timelineStartTick: secondsToTicks(2),
    durationTicks: secondsToTicks(3),
    placement: "picture-in-picture",
    fit: "cover",
    x: 120,
    y: 80,
    width: 480,
    height: 540,
  }], "composite.mkv", fixtureTarget());
  assert.deepEqual(plan.args.slice(0, 8), ["-hide_banner", "-nostdin", "-y", "-i", "base.mkv", "-i", "presenter.mp4", "-filter_complex_threads"]);
  const filter = plan.args[plan.args.indexOf("-filter_complex") + 1] ?? "";
  assert.match(filter, /trim=start=1\.250000:duration=3\.000000/);
  assert.match(filter, /setpts=PTS-STARTPTS\+2\.000000\/TB/);
  assert.match(filter, /scale=480:540:force_original_aspect_ratio=increase/);
  assert.match(filter, /overlay=x=120:y=80/);
  assert.ok(plan.args.includes("ffv1"));
  assert.equal(plan.expectedOutputs[0], "composite.mkv");
});

test("GPL encoder stays visibly separated", () => {
  const plan = planDeliveryEncode("video.mkv", "audio.wav", "output.mp4", { codec: "libx264", quality: 18 });
  assert.ok(plan.args.includes("libx264"));
  assert.match(plan.licensingWarnings.join(" "), /GPL runtime pack/);
});

test("hardware H.264 plans force the selected backend and QSV is available as NVENC fallback", () => {
  const qsv = planDeliveryEncode("video.mkv", "audio.wav", "output.mp4", { codec: "h264_qsv", quality: 20 });
  assert.deepEqual(qsv.args.slice(qsv.args.indexOf("-c:v"), qsv.args.indexOf("-c:v") + 4), ["-c:v", "h264_qsv", "-global_quality", "20"]);
  const mediaFoundation = planDeliveryEncode("video.mkv", "audio.wav", "output.mp4", { codec: "h264_mf" });
  assert.deepEqual(mediaFoundation.args.slice(mediaFoundation.args.indexOf("-c:v"), mediaFoundation.args.indexOf("-c:v") + 4), ["-c:v", "h264_mf", "-hw_encoding", "1"]);
  const probe = planHardwareEncoderProbe("h264_qsv", fixtureTarget({ width: 1_280, height: 720 }));
  assert.ok(probe.args.includes("color=c=black:s=1280x720:r=1"));
  assert.deepEqual(probe.args.slice(probe.args.indexOf("-c:v"), probe.args.indexOf("-c:v") + 2), ["-c:v", "h264_qsv"]);
  assert.deepEqual(probe.args.slice(-3), ["-f", "null", "-"]);
});

test("WebM delivery uses compatible Opus audio and WebVTT captions", () => {
  const plan = planDeliveryEncode("video.mkv", "audio.wav", "output.webm", { codec: "vp9", captionMode: "embedded", captionLanguage: "es-MX", captionPath: "captions.vtt" });
  assert.ok(plan.args.includes("libopus"));
  assert.ok(plan.args.includes("webvtt"));
  assert.ok(plan.args.includes("2:s:0"));
  assert.ok(plan.args.includes("language=es-MX"));
});

test("clean sidecar delivery never adds a subtitle input or stream map", () => {
  const plan = planDeliveryEncode("video.mkv", "audio.wav", "output.webm", { codec: "vp9", captionMode: "sidecar" });
  assert.deepEqual(plan.args.filter((argument) => argument === "-i").length, 2);
  assert.ok(!plan.args.some((argument) => /:s:0$/.test(argument)));
  assert.ok(!plan.args.includes("webvtt"));
  assert.throws(
    () => planDeliveryEncode("video.mkv", "audio.wav", "output.webm", { codec: "vp9", captionMode: "sidecar", captionPath: "captions.vtt" }),
    /forbidden for sidecar delivery/,
  );
});

test("audio master uses 48 kHz and measurable loudness targets", () => {
  const plan = planAudioMaster([
    { id: "narration", assetId: "scene:narration", path: "narration.wav", sha256: "a".repeat(64), mediaType: "audio/wav", role: "narration", startTick: 0 },
    { id: "music", assetId: "starter.music", path: "music.wav", sha256: "b".repeat(64), mediaType: "audio/wav", role: "music", startTick: secondsToTicks(0.5), endTick: secondsToTicks(5), gainDb: -21, loop: true, duckingDb: -18 },
  ], "master.wav");
  assert.match(plan.args.join(" "), /loudnorm=I=-16:LRA=11:TP=-2/);
  assert.match(plan.args.join(" "), /acompressor=threshold=0\.05:ratio=8/);
  assert.match(plan.args.join(" "), /sidechaincompress=/);
  assert.match(plan.args.join(" "), /ratio=14\.500/);
  assert.deepEqual(plan.args.slice(plan.args.indexOf("-stream_loop"), plan.args.indexOf("-stream_loop") + 3), ["-stream_loop", "-1", "-i"]);
  assert.ok(plan.args.includes("pcm_s24le"));
  assert.ok(plan.args.includes("48000"));
});

test("range audio is source-trimmed, timeline-shifted, and exact duration", () => {
  const plan = planAudioMaster([
    { id: "narration", assetId: "scene:narration", path: "narration.wav", sha256: "a".repeat(64), mediaType: "audio/wav", role: "narration", startTick: 0 },
  ], "range.wav", { timelineStartTick: secondsToTicks(2), durationTicks: secondsToTicks(3) });
  const filter = plan.args[plan.args.indexOf("-filter_complex") + 1];
  assert.match(filter ?? "", /atrim=start=2\.000000:duration=3\.000000/);
  assert.match(filter ?? "", /apad=whole_dur=3\.000000,atrim=duration=3\.000000/);
});

test("real FFmpeg mixes narration, looped music, and SFX without clipping", { skip: !process.env.ALYSTRIA_TEST_FFMPEG_PATH, timeout: 30_000 }, async () => {
  const ffmpeg = process.env.ALYSTRIA_TEST_FFMPEG_PATH!;
  const directory = await mkdtemp(join(tmpdir(), "alystria-audio-mix-"));
  const runner = new SpawnCommandRunner();
  try {
    const narration = join(directory, "narration.wav");
    const master = join(directory, "master.wav");
    const generated = await runner.run(ffmpeg, [
      "-hide_banner", "-nostdin", "-y",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5:sample_rate=48000",
      "-c:a", "pcm_s24le", narration,
    ], {});
    assert.equal(generated.exitCode, 0, generated.stderr);
    const mix = planAudioMaster([
      { id: "voice", assetId: "scene:narration", path: narration, sha256: "a".repeat(64), mediaType: "audio/wav", role: "narration", startTick: 0, endTick: secondsToTicks(1.5) },
      { id: "music", assetId: "starter.audio.music.focus-loop", path: resolve("../..", "assets/starter/audio/music/focus-loop.wav"), sha256: "b".repeat(64), mediaType: "audio/wav", role: "music", startTick: 0, endTick: secondsToTicks(3), gainDb: -18, loop: true, duckingDb: -14 },
      { id: "cue", assetId: "starter.audio.sfx.emphasis-a", path: resolve("../..", "assets/starter/audio/sfx/emphasis-a.wav"), sha256: "c".repeat(64), mediaType: "audio/wav", role: "sfx", startTick: secondsToTicks(1), gainDb: -12 },
    ], master, { durationTicks: secondsToTicks(3) });
    const mixed = await runner.run(ffmpeg, mix.args, {});
    assert.equal(mixed.exitCode, 0, mixed.stderr);
    const analysis = planAudioAnalysis(master);
    const measured = await runner.run(ffmpeg, analysis.args, {});
    assert.equal(measured.exitCode, 0, measured.stderr);
    const metrics = parseAudioAnalysis(measured.stderr);
    assert.equal(metrics.audioIsSilent, false);
    assert.equal(metrics.clippedSamples, 0);
    assert.equal(metrics.decodedSamplesPerChannel, 144_000);
    assert.ok(metrics.integratedLufs >= -17 && metrics.integratedLufs <= -15);
    assert.ok(metrics.truePeakDbtp !== null && metrics.truePeakDbtp <= -1.5);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

test("audio analysis fully decodes delivery into loudness and full-scale sample meters", () => {
  const plan = planAudioAnalysis("delivery.mp4");
  const filter = plan.args[plan.args.indexOf("-filter_complex") + 1] ?? "";
  assert.equal(plan.executable, "ffmpeg");
  assert.match(filter, /ebur128=peak=true/);
  assert.match(filter, /gte\(abs\(val\(ch\)\),1\)\*1000000000/);
  assert.match(filter, /astats=metadata=0:reset=0/);
  assert.deepEqual(plan.args.slice(-3), ["-f", "null", "-"]);
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
