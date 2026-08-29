import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserPage, ChromiumDriver } from "../src/browser.js";
import {
  executeRender,
  parseAudioAnalysis,
  requireNonSilentAudio,
  SpawnCommandRunner,
  type CommandRunner,
  type ProcessResult,
} from "../src/executor.js";
import { fixtureManifest, fixtureTarget } from "../src/fixture.js";
import { planAudioAnalysis } from "../src/ffmpeg.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const AUDIO_ANALYSIS_STDERR = `
[Parsed_ebur128_1 @ fixture] Summary:
  Integrated loudness:
    I:         -70.0 LUFS
  True peak:
    Peak:        0.0 dBFS
[Parsed_astats_4 @ fixture] Overall
[Parsed_astats_4 @ fixture] Max level: 0.000000
[Parsed_astats_4 @ fixture] Abs Peak count: 48000.000000
[Parsed_astats_4 @ fixture] Number of samples: 48000
[Parsed_ebur128_1 @ fixture] Summary:
  Integrated loudness:
    I:         -16.1 LUFS
  Loudness range:
    LRA:         2.0 LU
  True peak:
    Peak:        -1.7 dBFS
`;

class FakeCommandRunner implements CommandRunner {
  readonly calls: Array<Readonly<{ executable: string; args: readonly string[] }>> = [];
  readonly #ffmpeg: string;
  readonly #ffprobe: string;
  readonly #width: number;
  readonly #height: number;
  readonly #duration: number;
  readonly #frameRate: string;

  constructor(input: Readonly<{ ffmpeg: string; ffprobe: string; width: number; height: number; duration: number; frameRate?: string }>) {
    this.#ffmpeg = input.ffmpeg;
    this.#ffprobe = input.ffprobe;
    this.#width = input.width;
    this.#height = input.height;
    this.#duration = input.duration;
    this.#frameRate = input.frameRate ?? "2/1";
  }

  async run(executable: string, args: readonly string[]): Promise<ProcessResult> {
    this.calls.push({ executable, args: [...args] });
    if (executable === this.#ffprobe) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          streams: [
            { codec_type: "video", codec_name: "vp9", width: this.#width, height: this.#height, avg_frame_rate: this.#frameRate, duration: String(this.#duration), start_time: "0", color_space: "bt709", color_transfer: "iec61966-2-1", color_primaries: "bt709" },
            { codec_type: "audio", codec_name: "opus", sample_rate: "48000", channels: 2, duration: String(this.#duration), start_time: "0" },
            { codec_type: "subtitle", codec_name: "webvtt" },
          ],
          format: { duration: String(this.#duration) },
        }),
        stderr: "",
      };
    }
    assert.equal(executable, this.#ffmpeg);
    if (args.some((argument) => argument.includes("ebur128=peak=true:framelog=verbose[loudness_out]"))) {
      return { exitCode: 0, stdout: "", stderr: AUDIO_ANALYSIS_STDERR };
    }
    const output = args.at(-1);
    if (output && output !== "-") await writeFile(output, Buffer.from(`fake media ${this.calls.length}`));
    return { exitCode: 0, stdout: "", stderr: "" };
  }
}

test("executor uses exact injected tools, resumes captured frames, and writes measured output manifest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alystria-executor-test-"));
  try {
    const browserPath = join(directory, "exact-browser.bin");
    const ffmpegPath = join(directory, "exact-ffmpeg.bin");
    const ffprobePath = join(directory, "exact-ffprobe.bin");
    await Promise.all([
      writeFile(browserPath, "browser"),
      writeFile(ffmpegPath, "ffmpeg"),
      writeFile(ffprobePath, "ffprobe"),
    ]);
    const outputDirectory = join(directory, "output");
    const manifest = fixtureManifest(fixtureTarget({ width: 320, height: 180, frameRate: { numerator: 2, denominator: 1 } }));
    let captures = 0;
    let injectedBrowserPath = "";
    const browserFactory = async (options: Readonly<{ executablePath?: string }>): Promise<ChromiumDriver> => {
      injectedBrowserPath = options.executablePath ?? "";
      return {
        name: "fake-playwright",
        executablePath: browserPath,
        version: "fixture-chromium-1",
        networkPolicy: "deny",
        async newPage(): Promise<BrowserPage> {
          let html = "";
          return {
            async setViewportSize() {},
            async setContent(value) { html = value; },
            async waitForRenderReady() { assert.match(html, /data-render-ready="true"/); },
            async screenshot(options) { captures += 1; await writeFile(options.path, ONE_PIXEL_PNG); },
            async close() {},
          };
        },
        async close() {},
      };
    };
    const firstRunner = new FakeCommandRunner({ ffmpeg: ffmpegPath, ffprobe: ffprobePath, width: 320, height: 180, duration: 1 });
    const first = await executeRender({
      manifest,
      inputManifestSha256: "f".repeat(64),
      selection: { kind: "range", startFrame: 1, endFrame: 3 },
      outputDirectory,
      executables: { browser: browserPath, ffmpeg: ffmpegPath, ffprobe: ffprobePath },
      delivery: { codec: "vp9" },
      concurrency: 2,
      maximumFramesPerChunk: 1,
      dependencies: { commandRunner: firstRunner, browserFactory },
    });
    assert.equal(injectedBrowserPath, browserPath);
    assert.equal(captures, 2);
    assert.deepEqual(new Set(firstRunner.calls.map((call) => call.executable)), new Set([ffmpegPath, ffprobePath]));
    assert.equal(first.frameCount, 2);
    assert.equal(first.inputManifestSha256, "f".repeat(64));
    assert.equal(first.probe.audioSampleRate, 48_000);
    assert.equal(first.qaMetrics.integratedLufs, -16.1);
    assert.equal(first.qaMetrics.truePeakDbtp, -1.7);
    assert.equal(first.qaMetrics.clippedSamples, 0);
    assert.equal(first.qaMetrics.avDriftFrames, 0);
    assert.equal(first.files.find((file) => file.kind === "delivery")?.path, join(outputDirectory, "delivery.webm"));
    assert.ok(firstRunner.calls.some((call) => call.args.includes("ffv1")));
    assert.ok(firstRunner.calls.some((call) => call.args.includes("anullsrc=r=48000:cl=stereo")));
    assert.ok(firstRunner.calls.some((call) => call.args.includes("webvtt")));
    assert.ok(firstRunner.calls.some((call) => call.args.includes("-xerror")));

    const progress = (await readFile(first.progressPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { sequence: number; phase: string });
    assert.deepEqual(progress.map((event) => event.sequence), progress.map((_, index) => index));
    assert.equal(progress.at(-1)?.phase, "complete");
    const written = JSON.parse(await readFile(first.outputManifestPath, "utf8")) as { renderKey: string; files: unknown[]; qaMetrics: { integratedLufs: number } };
    assert.equal(written.renderKey, first.renderKey);
    assert.equal(written.files.length, 5);
    assert.equal(written.qaMetrics.integratedLufs, -16.1);

    const secondRunner = new FakeCommandRunner({ ffmpeg: ffmpegPath, ffprobe: ffprobePath, width: 320, height: 180, duration: 1 });
    await executeRender({
      manifest,
      inputManifestSha256: "f".repeat(64),
      selection: { kind: "range", startFrame: 1, endFrame: 3 },
      outputDirectory,
      executables: { browser: browserPath, ffmpeg: ffmpegPath, ffprobe: ffprobePath },
      delivery: { codec: "vp9" },
      dependencies: { commandRunner: secondRunner, browserFactory },
    });
    assert.equal(captures, 2, "the second run must trust only hash-verified checkpoint frames and avoid recapture");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("audio analysis parser uses the final EBU summary and exact full-scale mask count", () => {
  const metrics = parseAudioAnalysis(`
[Parsed_ebur128_1 @ fixture] Summary:
  Integrated loudness:
    I:         -70.0 LUFS
  True peak:
    Peak:        0.0 dBFS
[Parsed_astats_4 @ fixture] Overall
[Parsed_astats_4 @ fixture] Max level: 1000000000.000000
[Parsed_astats_4 @ fixture] Abs Peak count: 37.000000
[Parsed_astats_4 @ fixture] Number of samples: 96000
[Parsed_ebur128_1 @ fixture] Summary:
  Integrated loudness:
    I:         -15.9 LUFS
  True peak:
    Peak:         0.3 dBFS
`);
  assert.deepEqual(metrics, {
    integratedLufs: -15.9,
    truePeakDbtp: 0.3,
    clippedSamples: 37,
    decodedSamplesPerChannel: 96_000,
    audioIsSilent: false,
  });
});

test("audio analysis parser represents digital silence without inventing a finite true peak", () => {
  const metrics = parseAudioAnalysis(`
[Parsed_astats_4 @ fixture] Overall
[Parsed_astats_4 @ fixture] Max level: 0.000000
[Parsed_astats_4 @ fixture] Abs Peak count: 48000.000000
[Parsed_astats_4 @ fixture] Number of samples: 48000
[Parsed_ebur128_1 @ fixture] Summary:
  Integrated loudness:
    I:         -70.0 LUFS
  True peak:
    Peak:        -inf dBFS
`);
  assert.equal(metrics.audioIsSilent, true);
  assert.equal(metrics.truePeakDbtp, null);
  assert.equal(metrics.clippedSamples, 0);
  assert.throws(() => requireNonSilentAudio(metrics), /digital silence/);
});

test("audio analysis parser fails closed on truncated measurements", () => {
  assert.throws(() => parseAudioAnalysis("Summary: Integrated loudness: I: -16.0 LUFS"), /summary is missing/);
});

test("scene and draft selections compile to explicit frame and responsive target contracts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alystria-selection-test-"));
  try {
    const browserPath = join(directory, "browser.bin");
    const ffmpegPath = join(directory, "ffmpeg.bin");
    const ffprobePath = join(directory, "ffprobe.bin");
    await Promise.all([writeFile(browserPath, "browser"), writeFile(ffmpegPath, "ffmpeg"), writeFile(ffprobePath, "ffprobe")]);
    const browserFactory = async (): Promise<ChromiumDriver> => ({
      name: "selection-browser",
      executablePath: browserPath,
      version: "selection-1",
      networkPolicy: "deny",
      async newPage(): Promise<BrowserPage> {
        return {
          async setViewportSize() {},
          async setContent() {},
          async waitForRenderReady() {},
          async screenshot(options) { await writeFile(options.path, ONE_PIXEL_PNG); },
          async close() {},
        };
      },
      async close() {},
    });
    const manifest = fixtureManifest(fixtureTarget({ width: 320, height: 180, frameRate: { numerator: 1, denominator: 1 } }));
    const sceneRunner = new FakeCommandRunner({ ffmpeg: ffmpegPath, ffprobe: ffprobePath, width: 320, height: 180, duration: 5, frameRate: "1/1" });
    const scene = await executeRender({
      manifest,
      selection: { kind: "scene", sceneId: "scene-title" },
      outputDirectory: join(directory, "scene"),
      executables: { browser: browserPath, ffmpeg: ffmpegPath, ffprobe: ffprobePath },
      dependencies: { browserFactory, commandRunner: sceneRunner },
    });
    assert.deepEqual(scene.frameRange, { startFrame: 0, endFrame: 5 });
    assert.equal(scene.frameCount, 5);

    const draftRunner = new FakeCommandRunner({ ffmpeg: ffmpegPath, ffprobe: ffprobePath, width: 160, height: 90, duration: 5, frameRate: "1/1" });
    const draft = await executeRender({
      manifest,
      selection: { kind: "draft", maximumDimension: 160 },
      outputDirectory: join(directory, "draft"),
      executables: { browser: browserPath, ffmpeg: ffmpegPath, ffprobe: ffprobePath },
      dependencies: { browserFactory, commandRunner: draftRunner },
    });
    assert.equal(draft.target.width, 160);
    assert.equal(draft.target.height, 90);
    assert.equal(draft.target.pixelRatio, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("executor hash-verifies and composites presenter clips before delivery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alystria-presenter-executor-test-"));
  try {
    const browserPath = join(directory, "browser.bin");
    const ffmpegPath = join(directory, "ffmpeg.bin");
    const ffprobePath = join(directory, "ffprobe.bin");
    const presenterPath = join(directory, "presenter.mp4");
    const presenterBytes = Buffer.from("immutable presenter fixture");
    await Promise.all([
      writeFile(browserPath, "browser"),
      writeFile(ffmpegPath, "ffmpeg"),
      writeFile(ffprobePath, "ffprobe"),
      writeFile(presenterPath, presenterBytes),
    ]);
    const browserFactory = async (): Promise<ChromiumDriver> => ({
      name: "presenter-browser",
      executablePath: browserPath,
      version: "presenter-1",
      networkPolicy: "deny",
      async newPage(): Promise<BrowserPage> {
        return {
          async setViewportSize() {},
          async setContent() {},
          async waitForRenderReady() {},
          async screenshot(options) { await writeFile(options.path, ONE_PIXEL_PNG); },
          async close() {},
        };
      },
      async close() {},
    });
    const base = fixtureManifest(fixtureTarget({ width: 320, height: 180, frameRate: { numerator: 1, denominator: 1 } }));
    const manifest = {
      ...base,
      scenes: [{ ...base.scenes[0]!, kind: "presenter", durationTicks: 240_000, captions: [] }],
      presenterVideos: [{
        id: "guide",
        path: presenterPath,
        sha256: createHash("sha256").update(presenterBytes).digest("hex"),
        sceneId: base.scenes[0]!.id,
        placement: "picture-in-picture" as const,
      }],
    };
    const runner = new FakeCommandRunner({ ffmpeg: ffmpegPath, ffprobe: ffprobePath, width: 320, height: 180, duration: 1, frameRate: "1/1" });
    const output = await executeRender({
      manifest,
      outputDirectory: join(directory, "output"),
      executables: { browser: browserPath, ffmpeg: ffmpegPath, ffprobe: ffprobePath },
      dependencies: { browserFactory, commandRunner: runner },
    });
    const composite = runner.calls.find((call) => call.args.includes("-filter_complex") && call.args.includes(presenterPath));
    assert.ok(composite, "presenter clip must be a separate FFmpeg input to the lossless composite");
    assert.match(composite.args[composite.args.indexOf("-filter_complex") + 1] ?? "", /overlay=x=/);
    assert.equal(output.frameCount, 1);
    assert.equal(output.files.find((file) => file.kind === "mezzanine")?.path, join(directory, "output", "mezzanine.mkv"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("executor rejects presenter bytes that do not match the manifest hash", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alystria-presenter-hash-test-"));
  try {
    const ffmpegPath = join(directory, "ffmpeg.bin");
    const ffprobePath = join(directory, "ffprobe.bin");
    const presenterPath = join(directory, "presenter.mp4");
    await Promise.all([writeFile(ffmpegPath, "ffmpeg"), writeFile(ffprobePath, "ffprobe"), writeFile(presenterPath, "tampered")]);
    const base = fixtureManifest(fixtureTarget({ frameRate: { numerator: 1, denominator: 1 } }));
    await assert.rejects(executeRender({
      manifest: {
        ...base,
        scenes: [{ ...base.scenes[0]!, kind: "presenter", durationTicks: 240_000, captions: [] }],
        presenterVideos: [{ id: "guide", path: presenterPath, sha256: "0".repeat(64), sceneId: base.scenes[0]!.id, placement: "full" }],
      },
      outputDirectory: join(directory, "output"),
      executables: { ffmpeg: ffmpegPath, ffprobe: ffprobePath },
      dependencies: { commandRunner: new FakeCommandRunner({ ffmpeg: ffmpegPath, ffprobe: ffprobePath, width: 1280, height: 720, duration: 1, frameRate: "1/1" }) },
    }), /failed SHA-256 verification/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("executor honors an already-aborted cancellation signal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alystria-cancel-test-"));
  try {
    const ffmpegPath = join(directory, "ffmpeg.bin");
    const ffprobePath = join(directory, "ffprobe.bin");
    await writeFile(ffmpegPath, "ffmpeg");
    await writeFile(ffprobePath, "ffprobe");
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(executeRender({
      manifest: fixtureManifest(fixtureTarget({ frameRate: { numerator: 1, denominator: 1 } })),
      outputDirectory: join(directory, "output"),
      executables: { ffmpeg: ffmpegPath, ffprobe: ffprobePath },
      signal: controller.signal,
    }), (error: unknown) => error instanceof Error && error.name === "AbortError");
    const events = (await readFile(join(directory, "output", "render-progress.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { phase: string });
    assert.equal(events.at(-1)?.phase, "cancelled");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const realBrowser = process.env.ALYSTRIA_TEST_CHROMIUM_PATH;
const realFfmpeg = process.env.ALYSTRIA_TEST_FFMPEG_PATH;
const realFfprobe = process.env.ALYSTRIA_TEST_FFPROBE_PATH;

test("real FFmpeg analysis measures decoded samples instead of trusting encode settings", { skip: !realFfmpeg, timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "alystria-real-audio-analysis-"));
  try {
    const audioPath = join(directory, "full-scale-fixture.wav");
    const runner = new SpawnCommandRunner();
    const generated = await runner.run(realFfmpeg!, [
      "-hide_banner", "-nostdin", "-y",
      "-f", "lavfi", "-i", "sine=frequency=1000:duration=1:sample_rate=48000",
      "-af", "volume=20dB", "-c:a", "pcm_f32le", audioPath,
    ], {});
    assert.equal(generated.exitCode, 0, generated.stderr);
    const plan = planAudioAnalysis(audioPath);
    const measured = await runner.run(realFfmpeg!, plan.args, {});
    assert.equal(measured.exitCode, 0, measured.stderr);
    const metrics = parseAudioAnalysis(measured.stderr);
    assert.ok(metrics.integratedLufs > -5 && metrics.integratedLufs < 0);
    assert.ok(metrics.truePeakDbtp !== null && metrics.truePeakDbtp > 0);
    assert.equal(metrics.decodedSamplesPerChannel, 48_000);
    assert.ok(metrics.clippedSamples > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("short real Chromium and FFmpeg render", { skip: !(realBrowser && realFfmpeg && realFfprobe), timeout: 120_000 }, async () => {
  const requestedOutput = process.env.ALYSTRIA_TEST_OUTPUT_DIRECTORY;
  const directory = requestedOutput ?? await mkdtemp(join(tmpdir(), "alystria-real-render-"));
  try {
    const base = fixtureManifest(fixtureTarget({ width: 640, height: 360, frameRate: { numerator: 2, denominator: 1 } }));
    const manifest = { ...base, scenes: [{ ...base.scenes[0]!, durationTicks: 240_000, captions: [] }] };
    const output = await executeRender({
      manifest,
      outputDirectory: directory,
      executables: { ffmpeg: realFfmpeg!, ffprobe: realFfprobe! },
      delivery: { codec: "vp9", quality: 32 },
      concurrency: 1,
      maximumFramesPerChunk: 2,
      keepFrameCache: requestedOutput === undefined ? false : true,
    });
    assert.equal(output.frameCount, 2);
    assert.equal(output.probe.width, 640);
    assert.equal(output.probe.height, 360);
    assert.equal(output.probe.audioSampleRate, 48_000);
    assert.equal(output.browser.executablePath.toLowerCase(), realBrowser!.toLowerCase());
    assert.ok(output.files.find((file) => file.kind === "delivery")!.bytes > 0);
  } finally {
    if (requestedOutput === undefined) await rm(directory, { recursive: true, force: true });
  }
});
