import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  readonly #presenterDuration: number | undefined;
  readonly #presenterPath: string | undefined;
  readonly #frameRate: string;
  readonly #embeddedCaptions: boolean;
  readonly #encoderExitCodes: Readonly<Record<string, number>>;

  constructor(input: Readonly<{ ffmpeg: string; ffprobe: string; width: number; height: number; duration: number; presenterDuration?: number; presenterPath?: string; frameRate?: string; embeddedCaptions?: boolean; encoderExitCodes?: Readonly<Record<string, number>> }>) {
    this.#ffmpeg = input.ffmpeg;
    this.#ffprobe = input.ffprobe;
    this.#width = input.width;
    this.#height = input.height;
    this.#duration = input.duration;
    this.#presenterDuration = input.presenterDuration;
    this.#presenterPath = input.presenterPath;
    this.#frameRate = input.frameRate ?? "2/1";
    this.#embeddedCaptions = input.embeddedCaptions ?? false;
    this.#encoderExitCodes = input.encoderExitCodes ?? {};
  }

  async run(executable: string, args: readonly string[]): Promise<ProcessResult> {
    this.calls.push({ executable, args: [...args] });
    if (executable === this.#ffprobe) {
      const duration = this.#presenterPath !== undefined
        && args.includes(this.#presenterPath)
        && this.#presenterDuration !== undefined
        ? this.#presenterDuration
        : this.#duration;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          streams: [
            { codec_type: "video", codec_name: "vp9", width: this.#width, height: this.#height, avg_frame_rate: this.#frameRate, duration: String(duration), start_time: "0", color_space: "bt709", color_transfer: "iec61966-2-1", color_primaries: "bt709" },
            { codec_type: "audio", codec_name: "opus", sample_rate: "48000", channels: 2, duration: String(duration), start_time: "0" },
            ...(this.#embeddedCaptions ? [{ codec_type: "subtitle", codec_name: "webvtt" }] : []),
          ],
          format: { duration: String(duration) },
        }),
        stderr: "",
      };
    }
    assert.equal(executable, this.#ffmpeg);
    if (args.includes("-frames:v") && args.includes("-f") && args.at(-1) === "-") {
      const encoder = args[args.indexOf("-c:v") + 1] ?? "unknown";
      const exitCode = this.#encoderExitCodes[encoder] ?? 0;
      return { exitCode, stdout: "", stderr: exitCode === 0 ? "" : `${encoder} unavailable in fixture` };
    }
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
            async setContent(value) { html = value; assert.doesNotMatch(value, /data-caption-id=/); },
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
    assert.ok(!firstRunner.calls.some((call) => call.args.includes("webvtt")));
    assert.ok(!firstRunner.calls.some((call) => call.args.some((argument) => /:s:0$/.test(argument))));
    assert.ok(firstRunner.calls.some((call) => call.args.includes("-xerror")));

    const progress = (await readFile(first.progressPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { sequence: number; phase: string });
    assert.deepEqual(progress.map((event) => event.sequence), progress.map((_, index) => index));
    assert.equal(progress.at(-1)?.phase, "complete");
    const written = JSON.parse(await readFile(first.outputManifestPath, "utf8")) as { renderKey: string; files: unknown[]; qaMetrics: { integratedLufs: number } };
    assert.equal(written.renderKey, first.renderKey);
    assert.equal(written.files.length, 6);
    assert.equal(written.qaMetrics.integratedLufs, -16.1);
    assert.equal(first.probe.captionCodec, "none");
    assert.deepEqual(first.stageTimings.map((timing) => timing.phase), ["prepare", "capture", "mezzanine", "audio", "delivery", "qa", "finalize"]);
    assert.ok(first.stageTimings.every((timing) => timing.durationMs >= 0 && Number.isFinite(Date.parse(timing.startedAtUtc))));
    assert.equal(first.hardwareProvenance.deliveryEncoder.requestedCodec, "vp9");
    assert.equal(first.hardwareProvenance.deliveryEncoder.selectedCodec, "vp9");
    assert.equal(first.hardwareProvenance.deliveryEncoder.acceleration, "software");
    assert.equal(first.hardwareProvenance.chromiumGpu.status, "unknown");
    assert.deepEqual(first.captionDelivery, {
      mode: "sidecar",
      language: "en",
      cueCount: 1,
      canonicalCueLedgerSha256: first.captionDelivery.canonicalCueLedgerSha256,
      burnedIntoVideo: false,
      embeddedSoftTrack: false,
      sidecars: {
        vtt: join(outputDirectory, "delivery.en.vtt"),
        srt: join(outputDirectory, "delivery.en.srt"),
        ledger: join(outputDirectory, "delivery.captions.json"),
      },
    });
    const checkpointLines = (await readFile(join(outputDirectory, ".render-cache", first.renderKey, "capture-state.json"), "utf8")).trim().split("\n");
    assert.equal(checkpointLines.length, 3, "checkpoint journal should contain one header and one bounded record per frame");
    assert.equal(JSON.parse(checkpointLines[0]!).schemaVersion, 2);
    assert.deepEqual(checkpointLines.slice(1).map((line) => JSON.parse(line).frame).sort(), [1, 2]);
    assert.ok(checkpointLines.slice(1).every((line) => line.length < 512), "checkpoint records must not grow with completed frame count");
    await appendFile(join(outputDirectory, ".render-cache", first.renderKey, "capture-state.json"), "{\"frame\":", "utf8");

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

test("executor probes requested NVENC and falls back to QSV with honest provenance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alystria-qsv-fallback-test-"));
  try {
    const browserPath = join(directory, "browser.bin");
    const ffmpegPath = join(directory, "ffmpeg.bin");
    const ffprobePath = join(directory, "ffprobe.bin");
    await Promise.all([writeFile(browserPath, "browser"), writeFile(ffmpegPath, "ffmpeg"), writeFile(ffprobePath, "ffprobe")]);
    const browserFactory = async (): Promise<ChromiumDriver> => ({
      name: "hardware-provenance-browser",
      executablePath: browserPath,
      version: "hardware-provenance-1",
      networkPolicy: "deny",
      async newPage(): Promise<BrowserPage> {
        return {
          async setViewportSize() {}, async setContent() {}, async waitForRenderReady() {},
          async screenshot(options) { await writeFile(options.path, ONE_PIXEL_PNG); }, async close() {},
        };
      },
      async close() {},
    });
    const runner = new FakeCommandRunner({
      ffmpeg: ffmpegPath,
      ffprobe: ffprobePath,
      width: 320,
      height: 180,
      duration: 1,
      frameRate: "1/1",
      encoderExitCodes: { h264_nvenc: 1, h264_qsv: 0 },
    });
    const base = fixtureManifest(fixtureTarget({ width: 320, height: 180, frameRate: { numerator: 1, denominator: 1 } }));
    const output = await executeRender({
      manifest: { ...base, scenes: [{ ...base.scenes[0]!, durationTicks: 240_000, captions: [] }] },
      outputDirectory: join(directory, "output"),
      outputName: "delivery.mp4",
      executables: { browser: browserPath, ffmpeg: ffmpegPath, ffprobe: ffprobePath },
      delivery: { codec: "h264_nvenc" },
      dependencies: { browserFactory, commandRunner: runner },
    });

    const encoderProbes = runner.calls.filter((call) => call.args.includes("-frames:v"));
    assert.deepEqual(encoderProbes.map((call) => call.args[call.args.indexOf("-c:v") + 1]), ["h264_nvenc", "h264_qsv"]);
    const delivery = runner.calls.find((call) => call.args.includes("-c:v") && !call.args.includes("-frames:v") && call.args.at(-1)?.endsWith("delivery.mp4"));
    assert.equal(delivery?.args[delivery.args.indexOf("-c:v") + 1], "h264_qsv");
    assert.equal(output.hardwareProvenance.deliveryEncoder.requestedCodec, "h264_nvenc");
    assert.equal(output.hardwareProvenance.deliveryEncoder.selectedCodec, "h264_qsv");
    assert.equal(output.hardwareProvenance.deliveryEncoder.acceleration, "hardware");
    assert.equal(output.hardwareProvenance.deliveryEncoder.backend, "intel-qsv");
    assert.deepEqual(output.hardwareProvenance.deliveryEncoder.probes.map((probe) => [probe.codec, probe.available]), [["h264_nvenc", false], ["h264_qsv", true]]);
    assert.ok(output.hardwareProvenance.deliveryEncoder.probes.every((probe) => probe.durationMs >= 0));
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

test("caption delivery modes independently control open captions and soft tracks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alystria-caption-modes-"));
  try {
    const browserPath = join(directory, "browser.bin");
    const ffmpegPath = join(directory, "ffmpeg.bin");
    const ffprobePath = join(directory, "ffprobe.bin");
    await Promise.all([writeFile(browserPath, "browser"), writeFile(ffmpegPath, "ffmpeg"), writeFile(ffprobePath, "ffprobe")]);
    const base = fixtureManifest(fixtureTarget({ width: 320, height: 180, frameRate: { numerator: 1, denominator: 1 } }));
    const manifest = {
      ...base,
      scenes: [{
        ...base.scenes[0]!,
        durationTicks: 240_000,
        captions: [{ id: "clean-master-proof", startTick: 0, endTick: 240_000, text: "नमस्ते clean master" }],
      }],
      metadata: { ...base.metadata, locale: "hi-IN" },
    };
    for (const mode of ["embedded", "burned", "both"] as const) {
      const captured: string[] = [];
      const browserFactory = async (): Promise<ChromiumDriver> => ({
        name: "caption-mode-browser",
        executablePath: browserPath,
        version: "caption-mode-1",
        networkPolicy: "deny",
        async newPage(): Promise<BrowserPage> {
          return {
            async setViewportSize() {},
            async setContent(value) { captured.push(value); },
            async waitForRenderReady() {},
            async screenshot(options) { await writeFile(options.path, ONE_PIXEL_PNG); },
            async close() {},
          };
        },
        async close() {},
      });
      const embedded = mode === "embedded" || mode === "both";
      const burned = mode === "burned" || mode === "both";
      const runner = new FakeCommandRunner({ ffmpeg: ffmpegPath, ffprobe: ffprobePath, width: 320, height: 180, duration: 1, frameRate: "1/1", embeddedCaptions: embedded });
      const output = await executeRender({
        manifest,
        outputDirectory: join(directory, mode),
        executables: { browser: browserPath, ffmpeg: ffmpegPath, ffprobe: ffprobePath },
        delivery: { codec: "vp9", captionMode: mode },
        dependencies: { browserFactory, commandRunner: runner },
      });
      assert.equal(captured.some((html) => html.includes("data-caption-id=")), burned, `${mode} open-caption pixels`);
      assert.equal(runner.calls.some((call) => call.args.includes("webvtt")), embedded, `${mode} embedded WebVTT track`);
      assert.equal(output.captionDelivery.burnedIntoVideo, burned);
      assert.equal(output.captionDelivery.embeddedSoftTrack, embedded);
      assert.equal(output.captionDelivery.language, "hi-IN");
      assert.equal(output.probe.captionCodec, embedded ? "webvtt" : "none");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
    const activeDurationTicks = Math.round(23.224 * 240_000);
    const manifest = {
      ...base,
      scenes: [{ ...base.scenes[0]!, kind: "presenter", durationTicks: 24 * 240_000, captions: [] }],
      presenterVideos: [{
        id: "guide",
        path: presenterPath,
        sha256: createHash("sha256").update(presenterBytes).digest("hex"),
        sceneId: base.scenes[0]!.id,
        activeDurationTicks,
        placement: "picture-in-picture" as const,
      }],
    };
    const runner = new FakeCommandRunner({
      ffmpeg: ffmpegPath,
      ffprobe: ffprobePath,
      width: 320,
      height: 180,
      duration: 24,
      presenterDuration: 23.224,
      presenterPath,
      frameRate: "1/1",
    });
    const output = await executeRender({
      manifest,
      outputDirectory: join(directory, "output"),
      executables: { browser: browserPath, ffmpeg: ffmpegPath, ffprobe: ffprobePath },
      dependencies: { browserFactory, commandRunner: runner },
    });
    const composite = runner.calls.find((call) => call.args.includes("-filter_complex") && call.args.includes(presenterPath));
    assert.ok(composite, "presenter clip must be a separate FFmpeg input to the lossless composite");
    const filter = composite.args[composite.args.indexOf("-filter_complex") + 1] ?? "";
    assert.match(filter, /trim=start=0\.000000:duration=23\.224000/);
    assert.match(filter, /overlay=x=.*eof_action=pass:repeatlast=0:shortest=0/);
    assert.equal(output.frameCount, 24);
    assert.equal(output.files.find((file) => file.kind === "mezzanine")?.path, join(directory, "output", "mezzanine.mkv"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("executor still rejects a presenter clip shorter than its active narration interval", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alystria-presenter-duration-test-"));
  try {
    const ffmpegPath = join(directory, "ffmpeg.bin");
    const ffprobePath = join(directory, "ffprobe.bin");
    const presenterPath = join(directory, "presenter.mp4");
    const presenterBytes = Buffer.from("short presenter fixture");
    await Promise.all([
      writeFile(ffmpegPath, "ffmpeg"),
      writeFile(ffprobePath, "ffprobe"),
      writeFile(presenterPath, presenterBytes),
    ]);
    const base = fixtureManifest(fixtureTarget({ width: 320, height: 180, frameRate: { numerator: 30, denominator: 1 } }));
    const activeDurationTicks = Math.round(23.224 * 240_000);
    await assert.rejects(executeRender({
      manifest: {
        ...base,
        scenes: [{ ...base.scenes[0]!, kind: "presenter", durationTicks: 24 * 240_000, captions: [] }],
        presenterVideos: [{
          id: "guide",
          path: presenterPath,
          sha256: createHash("sha256").update(presenterBytes).digest("hex"),
          sceneId: base.scenes[0]!.id,
          activeDurationTicks,
          placement: "full" as const,
        }],
      },
      outputDirectory: join(directory, "output"),
      executables: { ffmpeg: ffmpegPath, ffprobe: ffprobePath },
      dependencies: {
        commandRunner: new FakeCommandRunner({
          ffmpeg: ffmpegPath,
          ffprobe: ffprobePath,
          width: 320,
          height: 180,
          duration: 24,
          presenterDuration: 23,
          presenterPath,
          frameRate: "30/1",
        }),
      },
    }), /requires 23\.224s, found 23\.000s/);
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
    await mkdir(directory, { recursive: true });
    const narrationPath = join(directory, "real-narration.wav");
    const generated = await new SpawnCommandRunner().run(realFfmpeg!, [
      "-hide_banner", "-nostdin", "-y",
      "-f", "lavfi", "-i", "sine=frequency=330:duration=1:sample_rate=48000",
      "-c:a", "pcm_s24le", narrationPath,
    ], {});
    assert.equal(generated.exitCode, 0, generated.stderr);
    const narrationSha256 = createHash("sha256").update(await readFile(narrationPath)).digest("hex");
    const base = fixtureManifest(fixtureTarget({ width: 640, height: 360, frameRate: { numerator: 2, denominator: 1 } }));
    const manifest = {
      ...base,
      outputDirectory: directory,
      captionDeliveryMode: "sidecar" as const,
      audioInputs: [{
        id: "real-narration",
        assetId: "real-narration",
        path: narrationPath,
        sha256: narrationSha256,
        mediaType: "audio/wav" as const,
        role: "narration" as const,
        startTick: 0,
        endTick: 240_000,
      }],
      scenes: [{
        ...base.scenes[0]!,
        durationTicks: 240_000,
        captions: [{ id: "real-clean-master", startTick: 0, endTick: 240_000, text: "Clean pixels, selectable captions." }],
      }],
    };
    const output = await executeRender({
      manifest,
      outputDirectory: directory,
    executables: { browser: realBrowser!, ffmpeg: realFfmpeg!, ffprobe: realFfprobe! },
      delivery: { codec: "vp9", quality: 32 },
      concurrency: 1,
      maximumFramesPerChunk: 2,
      keepFrameCache: requestedOutput === undefined ? false : true,
    });
    assert.equal(output.frameCount, 2);
    assert.equal(output.probe.width, 640);
    assert.equal(output.probe.height, 360);
    assert.equal(output.probe.audioSampleRate, 48_000);
    assert.equal(output.probe.captionCodec, "none");
    assert.equal(output.captionDelivery.burnedIntoVideo, false);
    assert.equal(output.captionDelivery.embeddedSoftTrack, false);
    assert.equal(output.captionDelivery.cueCount, 1);
    assert.ok(output.files.find((file) => file.kind === "captions-srt")!.bytes > 0);
    assert.ok(output.files.find((file) => file.kind === "captions-vtt")!.bytes > 0);
    assert.equal(output.browser.executablePath.toLowerCase(), realBrowser!.toLowerCase());
    assert.ok(output.files.find((file) => file.kind === "delivery")!.bytes > 0);
  } finally {
    if (requestedOutput === undefined) await rm(directory, { recursive: true, force: true });
  }
});
