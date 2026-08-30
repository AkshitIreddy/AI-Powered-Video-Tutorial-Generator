import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import {
  createPlaywrightChromiumDriver,
  PinnedBrowserCapture,
  sha256File,
  type CaptureResult,
  type ChromiumDriver,
} from "./browser.js";
import { loadVisualAssetPayloads } from "./assets.js";
import { loadFontAssetPayloads } from "./fonts.js";
import { canonicalCaptionLedger, toSrt, toWebVtt } from "./captions.js";
import { assertRenderManifest, type AudioInput, type CaptionCue, type CaptionDeliveryMode, type CaptionRenderStyle, type RenderManifest } from "./contracts.js";
import {
  planAudioMaster,
  planAudioAnalysis,
  planDecodeValidation,
  planDeliveryEncode,
  planFrameSequenceToFfv1,
  planHardwareEncoderProbe,
  planPresenterComposite,
  planProbe,
  planSilentAudio,
  type CommandPlan,
  type DeliveryCodec,
  type DeliveryOptions,
  type HardwareDeliveryCodec,
} from "./ffmpeg.js";
import { resolvePresenterCompositeLayers, type PresenterCompositeLayer } from "./presenter.js";
import { missingRanges, planRenderChunks, type FrameRange } from "./ranges.js";
import { FrameRenderer, RENDERER_VERSION, totalFrames } from "./runtime.js";
import { frameToTick, tickToFrameCeil, ticksPerFrame, ticksToSeconds } from "./timebase.js";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const OUTPUT_SCHEMA_VERSION = 1;
const DEFAULT_CHUNK_FRAMES = 120;
const DEFAULT_CONCURRENCY = 2;
const MAX_CAPTURE_CONCURRENCY = 8;
const MAX_PROCESS_OUTPUT_BYTES = 16 * 1024 * 1024;
let atomicWriteSequence = 0;

export type RenderSelection =
  | Readonly<{ kind: "full" }>
  | Readonly<{ kind: "draft"; maximumDimension?: number }>
  | Readonly<{ kind: "range"; startFrame: number; endFrame: number }>
  | Readonly<{ kind: "scene"; sceneId: string }>;

export interface ExecutablePaths {
  /** Omit to use the Chromium revision owned by playwright-core. */
  readonly browser?: string;
  readonly ffmpeg: string;
  readonly ffprobe: string;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunner {
  run(executable: string, args: readonly string[], options: Readonly<{ signal?: AbortSignal; cwd?: string }>): Promise<ProcessResult>;
}

export interface RenderProgressEvent {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly manifestId: string;
  readonly phase: "prepare" | "capture" | "mezzanine" | "audio" | "delivery" | "qa" | "finalize" | "complete" | "cancelled" | "failed";
  readonly status: "started" | "progress" | "completed" | "failed";
  readonly message: string;
  readonly timestampUtc: string;
  /** Monotonic duration since this executor invocation began. */
  readonly elapsedMs: number;
  /** Monotonic duration since the latest started event for this phase. */
  readonly phaseElapsedMs?: number;
  readonly completed?: number;
  readonly total?: number;
  readonly frame?: number;
  readonly chunk?: number;
  readonly outputPath?: string;
}

export type TimedRenderPhase = "prepare" | "capture" | "mezzanine" | "audio" | "delivery" | "qa" | "finalize";

export interface RenderStageTiming {
  readonly phase: TimedRenderPhase;
  readonly startedAtUtc: string;
  readonly completedAtUtc: string;
  readonly durationMs: number;
}

export interface HardwareEncoderProbeSummary {
  readonly codec: HardwareDeliveryCodec;
  readonly available: boolean;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly detail: string;
}

export interface RenderHardwareProvenance {
  readonly chromiumGpu: Readonly<{
    readonly status: "unknown";
    readonly reason: "Chromium adapter telemetry is unavailable; GPU use is not inferred from launch flags";
  }>;
  readonly deliveryEncoder: Readonly<{
    readonly requestedCodec: DeliveryCodec;
    readonly selectedCodec: DeliveryCodec;
    readonly acceleration: "hardware" | "software";
    readonly backend: "nvidia-nvenc" | "intel-qsv" | "windows-media-foundation" | "none";
    readonly probes: readonly HardwareEncoderProbeSummary[];
  }>;
}

export interface RenderOutputFile {
  readonly kind: "mezzanine" | "delivery" | "audio-master" | "captions-vtt" | "captions-srt" | "captions-ledger";
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface RenderProbeSummary {
  readonly videoCodec: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: string;
  readonly durationSeconds: number;
  readonly audioCodec: string;
  readonly audioSampleRate: number;
  readonly audioChannels: number;
  readonly captionCodec: string;
  readonly colorSpace: string;
  readonly colorTransfer: string;
  readonly colorPrimaries: string;
  /** Full tags when the delivery container preserves them; VP9/AV1 WebM may retain only the matrix tag. */
  readonly colorTagStatus: "full" | "container-limited";
  readonly videoEndSeconds: number | null;
  readonly audioEndSeconds: number | null;
}

export interface CaptionDeliverySummary {
  readonly mode: CaptionDeliveryMode;
  readonly language: string;
  readonly cueCount: number;
  readonly canonicalCueLedgerSha256: string;
  readonly burnedIntoVideo: boolean;
  readonly embeddedSoftTrack: boolean;
  readonly sidecars: Readonly<{ vtt: string; srt: string; ledger: string }>;
}

export interface RenderQaMetrics {
  /** EBU R128 integrated loudness measured from the fully decoded delivery. */
  readonly integratedLufs: number;
  /** EBU R128 oversampled true peak from a non-silent delivery. */
  readonly truePeakDbtp: number;
  /** Exact decoded channel-sample count at or beyond full scale. */
  readonly clippedSamples: number;
  readonly decodedSamplesPerChannel: number;
  readonly audioIsSilent: false;
  /** Actual stream-end difference from ffprobe; null means the container did not expose it. */
  readonly avDriftSeconds: number | null;
  readonly avDriftFrames: number | null;
  readonly measurementSource: "delivery-full-decode:ffmpeg-ebur128+astats;timeline:ffprobe-streams";
}

export interface AudioAnalysisMetrics {
  readonly integratedLufs: number;
  /** Null is retained by the parser so the executor can reject digital silence explicitly. */
  readonly truePeakDbtp: number | null;
  readonly clippedSamples: number;
  readonly decodedSamplesPerChannel: number;
  readonly audioIsSilent: boolean;
}

export interface RenderOutputManifest {
  readonly schemaVersion: 1;
  readonly manifestId: string;
  readonly inputManifestSha256: string;
  readonly renderKey: string;
  readonly selection: RenderSelection;
  readonly frameRange: FrameRange;
  readonly frameCount: number;
  readonly startTick: number;
  readonly durationTicks: number;
  readonly target: RenderManifest["target"];
  readonly browser: Readonly<{ executablePath: string; version: string; sha256: string; networkPolicy: "deny" }>;
  readonly executables: Readonly<{ ffmpeg: string; ffprobe: string }>;
  readonly frames: readonly Readonly<{ frame: number; contentSha256: string; pngSha256: string }>[];
  readonly files: readonly RenderOutputFile[];
  readonly probe: RenderProbeSummary;
  readonly qaMetrics: RenderQaMetrics;
  readonly captionDelivery: CaptionDeliverySummary;
  readonly stageTimings: readonly RenderStageTiming[];
  readonly hardwareProvenance: RenderHardwareProvenance;
  readonly progressPath: string;
  readonly outputManifestPath: string;
}

export interface RenderExecutorDependencies {
  readonly commandRunner?: CommandRunner;
  readonly browserFactory?: (options: Readonly<{
    executablePath?: string;
    width: number;
    height: number;
    deviceScaleFactor: number;
  }>) => Promise<ChromiumDriver>;
  readonly frameRenderer?: FrameRenderer;
}

export interface RenderExecutorOptions {
  readonly manifest: RenderManifest;
  /** SHA-256 of the exact UTF-8 manifest document received by the CLI. */
  readonly inputManifestSha256?: string;
  readonly selection?: RenderSelection;
  readonly outputDirectory?: string;
  readonly outputName?: string;
  readonly executables: ExecutablePaths;
  readonly expectedBrowserVersion?: string;
  readonly expectedBrowserSha256?: string;
  readonly concurrency?: number;
  readonly maximumFramesPerChunk?: number;
  readonly resume?: boolean;
  readonly keepFrameCache?: boolean;
  readonly delivery?: DeliveryOptions;
  readonly progressPath?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (event: RenderProgressEvent) => void | Promise<void>;
  readonly dependencies?: RenderExecutorDependencies;
}

interface CaptureCheckpointFrame {
  readonly contentHash: string;
  readonly outputSha256: string;
  readonly browserVersion: string;
}

interface CaptureCheckpoint {
  readonly schemaVersion: 2;
  readonly renderKey: string;
  readonly frames: Record<string, CaptureCheckpointFrame>;
}

interface ProbeDocument {
  readonly streams?: readonly Readonly<Record<string, unknown>>[];
  readonly format?: Readonly<Record<string, unknown>>;
  readonly error?: unknown;
}

function abortError(): Error {
  const error = new Error("Render cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, part]) => part !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, part]) => `${JSON.stringify(key)}:${stableJson(part)}`).join(",")}}`;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function atomicWrite(path: string, contents: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const sequence = atomicWriteSequence;
  atomicWriteSequence += 1;
  const temporary = `${path}.tmp-${process.pid}-${sequence}`;
  await writeFile(temporary, contents);
  await rm(path, { force: true });
  await rename(temporary, path);
}

function positiveInteger(value: number, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${label} must be a positive safe integer no greater than ${maximum}`);
  }
  return value;
}

function sanitizeOutputName(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) || value === "." || value === "..") {
    throw new TypeError("outputName must be a plain filename containing only letters, digits, dot, underscore, or dash");
  }
  return value;
}

function scaleDraftManifest(manifest: RenderManifest, selection: Extract<RenderSelection, { kind: "draft" }>): RenderManifest {
  const maximumDimension = positiveInteger(selection.maximumDimension ?? 960, "draft maximumDimension", 2160);
  const largest = Math.max(manifest.target.width, manifest.target.height);
  if (largest <= maximumDimension && manifest.target.pixelRatio === 1) return manifest;
  const scale = Math.min(1, maximumDimension / largest);
  const even = (value: number): number => Math.max(64, Math.round(value / 2) * 2);
  return {
    ...manifest,
    target: {
      ...manifest.target,
      width: even(manifest.target.width * scale),
      height: even(manifest.target.height * scale),
      pixelRatio: 1,
    },
  };
}

function resolveFrameRange(manifest: RenderManifest, selection: RenderSelection): FrameRange {
  const allFrames = totalFrames(manifest);
  if (selection.kind === "full" || selection.kind === "draft") return { startFrame: 0, endFrame: allFrames };
  if (selection.kind === "range") {
    if (!Number.isSafeInteger(selection.startFrame) || !Number.isSafeInteger(selection.endFrame) || selection.startFrame < 0 || selection.endFrame <= selection.startFrame || selection.endFrame > allFrames) {
      throw new RangeError(`Requested frame range [${selection.startFrame}, ${selection.endFrame}) is outside [0, ${allFrames})`);
    }
    return { startFrame: selection.startFrame, endFrame: selection.endFrame };
  }
  let startTick = 0;
  for (const scene of manifest.scenes) {
    const endTick = startTick + scene.durationTicks;
    if (scene.id === selection.sceneId) {
      return {
        startFrame: tickToFrameCeil(startTick, manifest.target.frameRate),
        endFrame: tickToFrameCeil(endTick, manifest.target.frameRate),
      };
    }
    startTick = endTick;
  }
  throw new TypeError(`Unknown scene ${selection.sceneId}`);
}

function collectCaptions(manifest: RenderManifest, range: FrameRange): readonly CaptionCue[] {
  const rangeStartTick = frameToTick(range.startFrame, manifest.target.frameRate);
  const rangeEndTick = frameToTick(range.endFrame, manifest.target.frameRate);
  const cues: CaptionCue[] = [];
  let sceneStartTick = 0;
  for (const scene of manifest.scenes) {
    for (const cue of scene.captions ?? []) {
      const globalStart = sceneStartTick + cue.startTick;
      const globalEnd = sceneStartTick + cue.endTick;
      const clippedStart = Math.max(globalStart, rangeStartTick);
      const clippedEnd = Math.min(globalEnd, rangeEndTick);
      if (clippedEnd <= clippedStart) continue;
      cues.push({
        ...cue,
        id: `${scene.id}-${cue.id}`,
        startTick: clippedStart - rangeStartTick,
        endTick: clippedEnd - rangeStartTick,
      });
    }
    sceneStartTick += scene.durationTicks;
  }
  return cues;
}

function captionDeliveryMode(value: CaptionDeliveryMode | undefined): CaptionDeliveryMode {
  const selected = value ?? "sidecar";
  if (!(new Set<CaptionDeliveryMode>(["sidecar", "embedded", "burned", "both"])).has(selected)) {
    throw new TypeError(`Unsupported caption delivery mode ${String(selected)}`);
  }
  return selected;
}

function captionLanguage(value: string | undefined): string {
  const selected = value ?? "en";
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(selected)) {
    throw new TypeError(`Caption language must be a bounded BCP-47 tag, got ${selected}`);
  }
  return selected;
}

function captureManifestForCaptionMode(manifest: RenderManifest, mode: CaptionDeliveryMode): RenderManifest {
  if (mode === "burned" || mode === "both") return { ...manifest, captionDeliveryMode: mode };
  const clean = {
    ...manifest,
    captionDeliveryMode: mode,
    scenes: manifest.scenes.map((scene) => ({ ...scene, captions: [] })),
  } as RenderManifest & { captionStyle?: CaptionRenderStyle };
  // Without this deletion, a top-caption style can still reserve an empty band.
  delete clean.captionStyle;
  return clean;
}

function deliveryExtension(codec: DeliveryOptions["codec"]): ".mp4" | ".webm" {
  return codec === "vp9" || codec === "av1" ? ".webm" : ".mp4";
}

function assertOutputExtension(path: string, codec: DeliveryOptions["codec"]): void {
  const suffix = extname(path).toLowerCase();
  if (codec === "vp9" || codec === "av1") {
    if (suffix !== ".webm" && suffix !== ".mkv") throw new TypeError(`${codec} delivery output must use .webm or .mkv`);
  } else if (suffix !== ".mp4" && suffix !== ".mov" && suffix !== ".m4v") {
    throw new TypeError(`${codec} delivery output must use .mp4, .mov, or .m4v`);
  }
}

async function isValidPng(path: string): Promise<boolean> {
  try {
    const bytes = await readFile(path);
    return bytes.length > PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
  } catch {
    return false;
  }
}

async function outputFile(kind: RenderOutputFile["kind"], path: string): Promise<RenderOutputFile> {
  const info = await stat(path);
  if (!info.isFile() || info.size <= 0) throw new Error(`Expected ${kind} output is missing or empty: ${path}`);
  return { kind, path, bytes: info.size, sha256: await sha256File(path) };
}

function numberField(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function stringField(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function parseTimeBase(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const [numeratorText, denominatorText] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return undefined;
  return numerator / denominator;
}

function parseClockDuration(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const duration = hours * 3_600 + minutes * 60 + seconds;
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

function streamDurationSeconds(stream: Readonly<Record<string, unknown>>): number | null {
  const direct = numberField(stream.duration, Number.NaN);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const durationTicks = numberField(stream.duration_ts, Number.NaN);
  const timeBase = parseTimeBase(stream.time_base);
  if (Number.isFinite(durationTicks) && durationTicks >= 0 && timeBase !== undefined) {
    return durationTicks * timeBase;
  }
  const tags = stream.tags;
  if (tags && typeof tags === "object" && !Array.isArray(tags)) {
    return parseClockDuration((tags as Readonly<Record<string, unknown>>).DURATION) ?? null;
  }
  return null;
}

function streamEndSeconds(stream: Readonly<Record<string, unknown>>): number | null {
  const duration = streamDurationSeconds(stream);
  if (duration === null) return null;
  const start = numberField(stream.start_time, 0);
  return start + duration;
}

function stripFfmpegPrefix(line: string): string {
  return line.replace(/^\[[^\]]+\]\s*/, "");
}

/** Parse the final summaries emitted by planAudioAnalysis, rejecting partial logs. */
export function parseAudioAnalysis(stderr: string): AudioAnalysisMetrics {
  const clean = stderr.split(/\r?\n/).map(stripFfmpegPrefix).join("\n");
  const summaries = [...clean.matchAll(
    /Summary:\s*[\s\S]*?Integrated loudness:\s*I:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*LUFS[\s\S]*?True peak:\s*Peak:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dBFS/g,
  )];
  const summary = summaries.at(-1);
  if (!summary) throw new Error("Delivery audio QA failed: EBU R128 summary is missing");
  const integratedLufs = Number(summary[1]);
  if (!Number.isFinite(integratedLufs)) {
    throw new Error("Delivery audio QA failed: integrated loudness is not finite");
  }
  const rawTruePeak = summary[2]?.toLowerCase();
  const audioIsSilent = rawTruePeak === "-inf";
  const truePeakDbtp = audioIsSilent ? null : Number(rawTruePeak);
  if (!audioIsSilent && !Number.isFinite(truePeakDbtp)) {
    throw new Error("Delivery audio QA failed: true peak is not finite");
  }

  const overallIndex = clean.lastIndexOf("Overall");
  if (overallIndex < 0) throw new Error("Delivery audio QA failed: astats overall summary is missing");
  const overall = clean.slice(overallIndex);
  const maxLevel = Number(/Max level:\s*(-?\d+(?:\.\d+)?)/.exec(overall)?.[1]);
  const absolutePeakCount = Number(/Abs Peak count:\s*(\d+(?:\.\d+)?)/.exec(overall)?.[1]);
  const decodedSamplesPerChannel = Number(/Number of samples:\s*(\d+(?:\.\d+)?)/.exec(overall)?.[1]);
  if (![maxLevel, absolutePeakCount, decodedSamplesPerChannel].every(Number.isFinite) || decodedSamplesPerChannel <= 0) {
    throw new Error("Delivery audio QA failed: astats clipping measurements are incomplete");
  }
  const clippedSamples = maxLevel > 0 ? Math.round(absolutePeakCount) : 0;
  if (!Number.isSafeInteger(clippedSamples) || clippedSamples < 0 || !Number.isSafeInteger(Math.round(decodedSamplesPerChannel))) {
    throw new Error("Delivery audio QA failed: astats clipping measurements are outside the safe integer range");
  }
  return {
    integratedLufs,
    truePeakDbtp,
    clippedSamples,
    decodedSamplesPerChannel: Math.round(decodedSamplesPerChannel),
    audioIsSilent,
  };
}

export function requireNonSilentAudio(
  metrics: AudioAnalysisMetrics,
): asserts metrics is AudioAnalysisMetrics & Readonly<{ truePeakDbtp: number; audioIsSilent: false }> {
  if (metrics.audioIsSilent || metrics.truePeakDbtp === null) {
    throw new Error("Delivery audio QA failed: decoded delivery is digital silence");
  }
}

function validateProbe(document: ProbeDocument, manifest: RenderManifest, expectedDurationSeconds: number, expectEmbeddedCaptions: boolean): RenderProbeSummary {
  if (document.error) throw new Error(`ffprobe reported an error: ${JSON.stringify(document.error)}`);
  const streams = document.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const subtitle = streams.find((stream) => stream.codec_type === "subtitle");
  if (!video) throw new Error("Delivery QA failed: video stream is missing");
  if (!audio) throw new Error("Delivery QA failed: 48 kHz audio stream is missing");
  if (expectEmbeddedCaptions && !subtitle) throw new Error("Delivery QA failed: requested embedded caption stream is missing");
  if (!expectEmbeddedCaptions && subtitle) throw new Error("Delivery QA failed: clean master unexpectedly contains a caption stream");
  const width = numberField(video.width);
  const height = numberField(video.height);
  if (width !== manifest.target.width || height !== manifest.target.height) {
    throw new Error(`Delivery QA failed: expected ${manifest.target.width}x${manifest.target.height}, got ${width}x${height}`);
  }
  const audioSampleRate = numberField(audio.sample_rate);
  if (audioSampleRate !== 48_000) throw new Error(`Delivery QA failed: expected 48000 Hz audio, got ${audioSampleRate}`);
  const audioChannels = numberField(audio.channels);
  if (audioChannels < 1) throw new Error("Delivery QA failed: audio channel count is missing or zero");
  const frameRate = stringField(video.avg_frame_rate, stringField(video.r_frame_rate));
  const [rateNumeratorText, rateDenominatorText] = frameRate.split("/");
  const actualRate = Number(rateNumeratorText) / Number(rateDenominatorText);
  const expectedRate = manifest.target.frameRate.numerator / manifest.target.frameRate.denominator;
  if (!Number.isFinite(actualRate) || Math.abs(actualRate - expectedRate) > 0.000_001) {
    throw new Error(`Delivery QA failed: expected ${manifest.target.frameRate.numerator}/${manifest.target.frameRate.denominator} fps, got ${frameRate}`);
  }
  const colorSpace = stringField(video.color_space);
  const colorTransfer = stringField(video.color_transfer);
  const colorPrimaries = stringField(video.color_primaries);
  const fullSdrTags = colorSpace === "bt709"
    && colorTransfer === "iec61966-2-1"
    && colorPrimaries === "bt709";
  const containerLimitedWebmTags = (video.codec_name === "vp9" || video.codec_name === "av1")
    && colorSpace === "bt709"
    && colorTransfer === "unknown"
    && colorPrimaries === "unknown";
  if (!fullSdrTags && !containerLimitedWebmTags) {
    throw new Error(`Delivery QA failed: expected Rec.709/sRGB tags, got ${colorSpace}/${colorTransfer}/${colorPrimaries}`);
  }
  const durationSeconds = numberField(document.format?.duration, numberField(video.duration));
  const tolerance = (manifest.target.frameRate.denominator / manifest.target.frameRate.numerator) * 2 + 0.002;
  if (durationSeconds <= 0 || Math.abs(durationSeconds - expectedDurationSeconds) > tolerance) {
    throw new Error(`Delivery QA failed: expected duration ${expectedDurationSeconds.toFixed(6)}s, got ${durationSeconds.toFixed(6)}s`);
  }
  return {
    videoCodec: stringField(video.codec_name),
    width,
    height,
    frameRate,
    durationSeconds,
    audioCodec: stringField(audio.codec_name),
    audioSampleRate,
    audioChannels,
    captionCodec: subtitle ? stringField(subtitle.codec_name) : "none",
    colorSpace,
    colorTransfer,
    colorPrimaries,
    colorTagStatus: fullSdrTags ? "full" : "container-limited",
    videoEndSeconds: streamEndSeconds(video),
    audioEndSeconds: streamEndSeconds(audio),
  };
}

async function validatePresenterAssets(
  layers: readonly PresenterCompositeLayer[],
  executables: ExecutablePaths,
  runner: CommandRunner,
  signal: AbortSignal | undefined,
  cwd: string,
  frameDurationSeconds: number,
): Promise<void> {
  const verifiedFiles = new Map<string, string>();
  for (const layer of layers) {
    throwIfAborted(signal);
    const info = await stat(layer.path).catch(() => undefined);
    if (!info?.isFile() || info.size <= 0) {
      throw new Error(`Presenter video ${layer.id} is missing or empty: ${layer.path}`);
    }
    const previousHash = verifiedFiles.get(layer.path);
    const actualHash = previousHash ?? await sha256File(layer.path);
    verifiedFiles.set(layer.path, actualHash);
    if (actualHash.toLowerCase() !== layer.sha256.toLowerCase()) {
      throw new Error(`Presenter video ${layer.id} failed SHA-256 verification`);
    }
    const probeResult = await runPlan(planProbe(layer.path), executables, runner, signal, cwd);
    let probe: ProbeDocument;
    try {
      probe = JSON.parse(probeResult.stdout) as ProbeDocument;
    } catch (error) {
      throw new Error(`Presenter video ${layer.id} probe returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (probe.error) throw new Error(`Presenter video ${layer.id} probe reported an error`);
    const video = (probe.streams ?? []).find((stream) => stream.codec_type === "video");
    if (!video) throw new Error(`Presenter video ${layer.id} has no video stream`);
    if (numberField(video.width) <= 0 || numberField(video.height) <= 0) {
      throw new Error(`Presenter video ${layer.id} has invalid dimensions`);
    }
    const availableSeconds = numberField(probe.format?.duration, numberField(video.duration));
    const requiredSeconds = ticksToSeconds(layer.sourceStartTick + layer.durationTicks);
    if (availableSeconds <= 0 || availableSeconds + frameDurationSeconds < requiredSeconds) {
      throw new Error(`Presenter video ${layer.id} is too short: requires ${requiredSeconds.toFixed(3)}s, found ${availableSeconds.toFixed(3)}s`);
    }
  }
}

export class SpawnCommandRunner implements CommandRunner {
  async run(executable: string, args: readonly string[], options: Readonly<{ signal?: AbortSignal; cwd?: string }>): Promise<ProcessResult> {
    if (!executable.trim() || /[\u0000\r\n]/.test(executable)) throw new TypeError("Executable path is empty or contains control characters");
    throwIfAborted(options.signal);
    return await new Promise<ProcessResult>((resolvePromise, reject) => {
      const child = spawn(executable, [...args], {
        cwd: options.cwd,
        env: process.env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      const append = (current: Buffer, next: Buffer): Buffer => {
        const combined = Buffer.concat([current, next]);
        return combined.length <= MAX_PROCESS_OUTPUT_BYTES ? combined : combined.subarray(combined.length - MAX_PROCESS_OUTPUT_BYTES);
      };
      child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
      const abort = (): void => {
        child.kill("SIGTERM");
        const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
        timer.unref();
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      child.once("error", reject);
      child.once("close", (code) => {
        options.signal?.removeEventListener("abort", abort);
        if (options.signal?.aborted) {
          reject(abortError());
          return;
        }
        resolvePromise({ exitCode: code ?? -1, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8") });
      });
    });
  }
}

class ProgressReporter {
  readonly #path: string;
  readonly #manifestId: string;
  readonly #listener: RenderExecutorOptions["onProgress"];
  readonly #startedAt = performance.now();
  readonly #phaseStarts = new Map<TimedRenderPhase, Readonly<{ monotonic: number; utc: string }>>();
  readonly #timings: RenderStageTiming[] = [];
  #sequence = 0;
  #pending = Promise.resolve();

  constructor(path: string, manifestId: string, listener: RenderExecutorOptions["onProgress"]) {
    this.#path = path;
    this.#manifestId = manifestId;
    this.#listener = listener;
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(this.#path, "", "utf8");
  }

  async emit(event: Omit<RenderProgressEvent, "schemaVersion" | "sequence" | "manifestId" | "timestampUtc" | "elapsedMs" | "phaseElapsedMs">): Promise<void> {
    const now = performance.now();
    const timestampUtc = new Date().toISOString();
    const timedPhase = isTimedRenderPhase(event.phase) ? event.phase : undefined;
    if (timedPhase && event.status === "started") {
      this.#phaseStarts.set(timedPhase, { monotonic: now, utc: timestampUtc });
    }
    const phaseStart = timedPhase ? this.#phaseStarts.get(timedPhase) : undefined;
    const phaseElapsedMs = phaseStart ? Math.max(0, now - phaseStart.monotonic) : undefined;
    if (timedPhase && event.status === "completed" && phaseStart) {
      this.#timings.push(Object.freeze({
        phase: timedPhase,
        startedAtUtc: phaseStart.utc,
        completedAtUtc: timestampUtc,
        durationMs: phaseElapsedMs ?? 0,
      }));
      this.#phaseStarts.delete(timedPhase);
    }
    const complete: RenderProgressEvent = {
      schemaVersion: 1,
      sequence: this.#sequence,
      manifestId: this.#manifestId,
      timestampUtc,
      elapsedMs: Math.max(0, now - this.#startedAt),
      ...(phaseElapsedMs === undefined ? {} : { phaseElapsedMs }),
      ...event,
    };
    this.#sequence += 1;
    this.#pending = this.#pending.then(async () => {
      await appendFile(this.#path, `${JSON.stringify(complete)}\n`, "utf8");
      await this.#listener?.(complete);
    });
    await this.#pending;
  }

  timings(): readonly RenderStageTiming[] {
    return Object.freeze(this.#timings.map((timing) => Object.freeze({ ...timing })));
  }
}

function isTimedRenderPhase(phase: RenderProgressEvent["phase"]): phase is TimedRenderPhase {
  return phase === "prepare" || phase === "capture" || phase === "mezzanine" || phase === "audio" || phase === "delivery" || phase === "qa" || phase === "finalize";
}

async function runPlan(
  plan: CommandPlan,
  executables: ExecutablePaths,
  runner: CommandRunner,
  signal: AbortSignal | undefined,
  cwd: string,
): Promise<ProcessResult> {
  throwIfAborted(signal);
  const executable = plan.executable === "ffmpeg" ? executables.ffmpeg : executables.ffprobe;
  const result = await runner.run(executable, plan.args, { ...(signal === undefined ? {} : { signal }), cwd });
  if (result.exitCode !== 0) {
    throw new Error(`${plan.description} failed with exit code ${result.exitCode}: ${result.stderr.slice(-4_000)}`);
  }
  for (const expected of plan.expectedOutputs) {
    const info = await stat(expected).catch(() => undefined);
    if (!info?.isFile() || info.size <= 0) throw new Error(`${plan.description} did not create a non-empty output: ${expected}`);
  }
  return result;
}

function hardwareBackend(codec: DeliveryCodec): RenderHardwareProvenance["deliveryEncoder"]["backend"] {
  if (codec === "h264_nvenc" || codec === "hevc_nvenc") return "nvidia-nvenc";
  if (codec === "h264_qsv") return "intel-qsv";
  if (codec === "h264_mf") return "windows-media-foundation";
  return "none";
}

async function resolveDeliveryEncoder(
  requested: DeliveryOptions,
  target: RenderManifest["target"],
  executables: ExecutablePaths,
  runner: CommandRunner,
  signal: AbortSignal | undefined,
  cwd: string,
): Promise<Readonly<{ options: DeliveryOptions; provenance: RenderHardwareProvenance }>> {
  const requestedCodec = requested.codec;
  const requestedHardware = hardwareBackend(requestedCodec) !== "none";
  const candidates: readonly HardwareDeliveryCodec[] = requestedCodec === "h264_nvenc"
    ? ["h264_nvenc", "h264_qsv"]
    : requestedHardware
      ? [requestedCodec as HardwareDeliveryCodec]
      : [];
  const probes: HardwareEncoderProbeSummary[] = [];
  let selectedCodec: DeliveryCodec = requestedCodec;
  for (const codec of candidates) {
    throwIfAborted(signal);
    const plan = planHardwareEncoderProbe(codec, target);
    const probeStarted = performance.now();
    const result = await runner.run(executables.ffmpeg, plan.args, { ...(signal === undefined ? {} : { signal }), cwd });
    const durationMs = Math.max(0, performance.now() - probeStarted);
    const detail = (result.stderr || result.stdout).replace(/\s+/g, " ").trim().slice(-1_000);
    probes.push(Object.freeze({ codec, available: result.exitCode === 0, exitCode: result.exitCode, durationMs, detail }));
    if (result.exitCode === 0) {
      selectedCodec = codec;
      break;
    }
  }
  if (requestedHardware && !probes.some((probe) => probe.available)) {
    const summary = probes.map((probe) => `${probe.codec}: exit ${probe.exitCode}${probe.detail ? ` (${probe.detail})` : ""}`).join("; ");
    throw new Error(`No requested hardware encoder passed a real ${target.width}x${target.height} encode probe: ${summary}`);
  }
  const backend = hardwareBackend(selectedCodec);
  return Object.freeze({
    options: Object.freeze({ ...requested, codec: selectedCodec }),
    provenance: Object.freeze({
      chromiumGpu: Object.freeze({
        status: "unknown" as const,
        reason: "Chromium adapter telemetry is unavailable; GPU use is not inferred from launch flags" as const,
      }),
      deliveryEncoder: Object.freeze({
        requestedCodec,
        selectedCodec,
        acceleration: backend === "none" ? "software" as const : "hardware" as const,
        backend,
        probes: Object.freeze(probes),
      }),
    }),
  });
}

async function loadCheckpoint(path: string, renderKey: string): Promise<CaptureCheckpoint> {
  try {
    const document = await readFile(path, "utf8");
    const lines = document.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 1) {
      const legacy = JSON.parse(lines[0]!) as Readonly<{ schemaVersion?: number; renderKey?: string; frames?: Record<string, CaptureCheckpointFrame> }>;
      if (legacy.schemaVersion === 1 && legacy.renderKey === renderKey && legacy.frames && typeof legacy.frames === "object") {
        return { schemaVersion: 2, renderKey, frames: { ...legacy.frames } };
      }
    }
    const header = JSON.parse(lines[0] ?? "null") as Readonly<{ schemaVersion?: number; renderKey?: string }> | null;
    if (header?.schemaVersion !== 2 || header.renderKey !== renderKey) throw new TypeError("Stale checkpoint header");
    const frames: Record<string, CaptureCheckpointFrame> = {};
    for (const [index, line] of lines.slice(1).entries()) {
      let record: Readonly<{ frame?: number; contentHash?: string; outputSha256?: string; browserVersion?: string }>;
      try {
        record = JSON.parse(line) as typeof record;
      } catch {
        // A process can stop midway through its final append. Preserve every
        // prior complete record, but reject corruption in the journal middle.
        if (index === lines.length - 2) break;
        throw new TypeError("Checkpoint journal contains a corrupt record");
      }
      if (!Number.isSafeInteger(record.frame) || (record.frame ?? -1) < 0) continue;
      if (![record.contentHash, record.outputSha256].every((value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value))) continue;
      if (typeof record.browserVersion !== "string" || !record.browserVersion) continue;
      frames[String(record.frame)] = {
        contentHash: record.contentHash!,
        outputSha256: record.outputSha256!,
        browserVersion: record.browserVersion,
      };
    }
    return { schemaVersion: 2, renderKey, frames };
  } catch {
    // A missing, truncated, or stale checkpoint is safely rebuilt from scratch.
  }
  return { schemaVersion: 2, renderKey, frames: {} };
}

function checkpointJournal(checkpoint: CaptureCheckpoint): string {
  const records = Object.entries(checkpoint.frames)
    .map(([frame, record]) => ({ frame: Number(frame), ...record }))
    .filter((record) => Number.isSafeInteger(record.frame) && record.frame >= 0)
    .sort((left, right) => left.frame - right.frame);
  return [stableJson({ schemaVersion: 2, renderKey: checkpoint.renderKey }), ...records.map(stableJson)].join("\n") + "\n";
}

function checkpointFrameLine(frame: number, record: CaptureCheckpointFrame): string {
  return `${stableJson({ frame, ...record })}\n`;
}

async function completedFrameSet(checkpoint: CaptureCheckpoint, frameDirectory: string): Promise<Set<number>> {
  const complete = new Set<number>();
  for (const [frameText, record] of Object.entries(checkpoint.frames)) {
    const frame = Number(frameText);
    if (!Number.isSafeInteger(frame) || frame < 0) continue;
    const path = join(frameDirectory, `frame-${String(frame).padStart(8, "0")}.png`);
    if (await isValidPng(path) && await sha256File(path) === record.outputSha256) complete.add(frame);
  }
  return complete;
}

async function captureWithConcurrency(
  frames: readonly number[],
  concurrency: number,
  capture: PinnedBrowserCapture,
  manifest: RenderManifest,
  frameDirectory: string,
  signal: AbortSignal | undefined,
  onCaptured: (result: CaptureResult) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      throwIfAborted(signal);
      const index = cursor;
      cursor += 1;
      const frame = frames[index];
      if (frame === undefined) return;
      const path = join(frameDirectory, `frame-${String(frame).padStart(8, "0")}.png`);
      const result = await capture.captureFrame(manifest, frame, path);
      throwIfAborted(signal);
      await onCaptured(result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, frames.length) }, worker));
}

function audioInputsForRange(manifest: RenderManifest, startTick: number, endTick: number): readonly AudioInput[] {
  return (manifest.audioInputs ?? []).filter((input) => input.startTick < endTick && (input.endTick === undefined || input.endTick > startTick));
}

async function validateAudioAssets(manifest: RenderManifest): Promise<void> {
  const attemptRoot = dirname(resolve(manifest.outputDirectory));
  const hashesByPath = new Map<string, string>();
  for (const input of manifest.audioInputs ?? []) {
    const inputPath = resolve(input.path);
    const fromAttemptRoot = relative(attemptRoot, inputPath);
    if (
      fromAttemptRoot === ""
      || isAbsolute(fromAttemptRoot)
      || fromAttemptRoot === ".."
      || fromAttemptRoot.startsWith(`..${sep}`)
    ) {
      throw new TypeError(`Audio input ${input.id} escapes the guarded render attempt`);
    }
    const previous = hashesByPath.get(inputPath);
    if (previous !== undefined && previous !== input.sha256.toLowerCase()) {
      throw new TypeError(`Audio input ${input.id} reuses a path with a different hash`);
    }
    const info = await lstat(inputPath);
    if (info.isSymbolicLink() || !info.isFile() || info.size <= 0) {
      throw new TypeError(`Audio input ${input.id} must be a non-empty regular file`);
    }
    const actualHash = await sha256File(inputPath);
    if (actualHash.toLowerCase() !== input.sha256.toLowerCase()) {
      throw new TypeError(`Audio input ${input.id} SHA-256 does not match its bytes`);
    }
    hashesByPath.set(inputPath, actualHash.toLowerCase());
  }
}

export async function executeRender(options: RenderExecutorOptions): Promise<RenderOutputManifest> {
  assertRenderManifest(options.manifest);
  if (options.manifest.rendererVersion !== RENDERER_VERSION) {
    throw new TypeError(`Manifest requires renderer ${options.manifest.rendererVersion}; this executor is ${RENDERER_VERSION}`);
  }
  const selection = options.selection ?? { kind: "full" };
  const manifest = selection.kind === "draft" ? scaleDraftManifest(options.manifest, selection) : options.manifest;
  assertRenderManifest(manifest);
  const frameRange = resolveFrameRange(manifest, selection);
  const frameCount = frameRange.endFrame - frameRange.startFrame;
  const startTick = frameToTick(frameRange.startFrame, manifest.target.frameRate);
  const durationTicks = frameCount * ticksPerFrame(manifest.target.frameRate);
  const endTick = startTick + durationTicks;
  const presenterLayers = resolvePresenterCompositeLayers(manifest, frameRange);
  const concurrency = positiveInteger(options.concurrency ?? DEFAULT_CONCURRENCY, "concurrency", MAX_CAPTURE_CONCURRENCY);
  const maximumFramesPerChunk = positiveInteger(options.maximumFramesPerChunk ?? DEFAULT_CHUNK_FRAMES, "maximumFramesPerChunk");
  const inputManifestSha256 = options.inputManifestSha256 ?? sha256Text(stableJson(options.manifest));
  if (!/^[0-9a-f]{64}$/.test(inputManifestSha256)) {
    throw new TypeError("inputManifestSha256 must be 64 lowercase hexadecimal characters");
  }
  const requestedDeliveryOptions: DeliveryOptions = options.delivery ?? { codec: "vp9" };
  const selectedCaptionMode = captionDeliveryMode(requestedDeliveryOptions.captionMode ?? manifest.captionDeliveryMode);
  const selectedCaptionLanguage = captionLanguage(requestedDeliveryOptions.captionLanguage ?? manifest.metadata?.captionLanguage ?? manifest.metadata?.locale);
  const captureManifest = captureManifestForCaptionMode(manifest, selectedCaptionMode);
  assertRenderManifest(captureManifest);
  const renderKey = sha256Text(stableJson({
    inputManifestSha256,
    selection,
    target: manifest.target,
    rendererVersion: manifest.rendererVersion,
    captionDelivery: { mode: selectedCaptionMode, language: selectedCaptionLanguage },
  }));
  const outputDirectory = resolve(options.outputDirectory ?? manifest.outputDirectory);
  const progressPath = resolve(options.progressPath ?? join(outputDirectory, "render-progress.jsonl"));
  const outputName = sanitizeOutputName(options.outputName ?? `delivery${deliveryExtension(requestedDeliveryOptions.codec)}`);
  const deliveryPath = join(outputDirectory, outputName);
  assertOutputExtension(deliveryPath, requestedDeliveryOptions.codec);
  const reporter = new ProgressReporter(progressPath, manifest.id, options.onProgress);
  const commandRunner = options.dependencies?.commandRunner ?? new SpawnCommandRunner();
  const browserFactory = options.dependencies?.browserFactory ?? (async (input) => createPlaywrightChromiumDriver({
    ...(input.executablePath === undefined ? {} : { executablePath: input.executablePath }),
    width: input.width,
    height: input.height,
    deviceScaleFactor: input.deviceScaleFactor,
  }));
  const cacheDirectory = join(outputDirectory, ".render-cache", renderKey);
  const frameDirectory = join(cacheDirectory, "frames");
  const checkpointPath = join(cacheDirectory, "capture-state.json");
  const attemptDirectory = await mkdtemp(join(tmpdir(), `alystria-render-${manifest.id.replace(/[^a-zA-Z0-9_-]/g, "_")}-`));
  const mezzaninePath = join(outputDirectory, "mezzanine.mkv");
  const audioPath = join(outputDirectory, "audio-master.wav");
  const outputExtension = extname(outputName);
  const outputStem = outputName.slice(0, -outputExtension.length);
  const captionsVttPath = join(outputDirectory, `${outputStem}.${selectedCaptionLanguage}.vtt`);
  const captionsSrtPath = join(outputDirectory, `${outputStem}.${selectedCaptionLanguage}.srt`);
  const captionsLedgerPath = join(outputDirectory, `${outputStem}.captions.json`);
  const outputManifestPath = join(outputDirectory, "render-output.json");
  let capture: PinnedBrowserCapture | undefined;
  let abortBrowser: (() => void) | undefined;

  await mkdir(frameDirectory, { recursive: true });
  await reporter.initialize();
  await reporter.emit({ phase: "prepare", status: "started", message: "Validating render inputs and executable boundaries", total: frameCount });

  try {
    throwIfAborted(options.signal);
    for (const path of [options.executables.ffmpeg, options.executables.ffprobe]) {
      if (path.includes("/") || path.includes("\\")) await access(path, constants.R_OK);
    }
    const deliveryResolution = await resolveDeliveryEncoder(
      requestedDeliveryOptions,
      manifest.target,
      options.executables,
      commandRunner,
      options.signal,
      attemptDirectory,
    );
    await validateAudioAssets(manifest);
    if (presenterLayers.length > 0) {
      await validatePresenterAssets(
        presenterLayers,
        options.executables,
        commandRunner,
        options.signal,
        attemptDirectory,
        manifest.target.frameRate.denominator / manifest.target.frameRate.numerator,
      );
    }
    const visualAssetPayloads = await loadVisualAssetPayloads(manifest);
    const fontAssetPayloads = await loadFontAssetPayloads(manifest);
    const driver = await browserFactory({
      ...(options.executables.browser === undefined ? {} : { executablePath: options.executables.browser }),
      width: manifest.target.width,
      height: manifest.target.height,
      deviceScaleFactor: manifest.target.pixelRatio,
    });
    const browserSha256 = await sha256File(driver.executablePath);
    const expectedBrowserVersion = options.expectedBrowserVersion ?? driver.version;
    const expectedBrowserSha256 = options.expectedBrowserSha256 ?? browserSha256;
    if ((visualAssetPayloads.length > 0 || fontAssetPayloads.length > 0) && options.dependencies?.frameRenderer) {
      throw new TypeError("An injected frameRenderer cannot bypass visual or font asset payload validation");
    }
    capture = new PinnedBrowserCapture(driver, {
      expectedVersion: expectedBrowserVersion,
      expectedSha256: expectedBrowserSha256,
    }, options.dependencies?.frameRenderer ?? new FrameRenderer({ verifyRepeatability: true, visualAssetPayloads, fontAssetPayloads }));
    abortBrowser = (): void => { void capture?.close(); };
    options.signal?.addEventListener("abort", abortBrowser, { once: true });
    await capture.verifyBrowser();

    const checkpoint = options.resume === false
      ? { schemaVersion: 2 as const, renderKey, frames: {} }
      : await loadCheckpoint(checkpointPath, renderKey);
    if (options.resume === false) await rm(frameDirectory, { recursive: true, force: true });
    await mkdir(frameDirectory, { recursive: true });
    // Migrate legacy snapshots and compact any prior journal exactly once.
    // Every newly captured frame is appended as one bounded record below.
    await atomicWrite(checkpointPath, checkpointJournal(checkpoint));
    const completed = options.resume === false ? new Set<number>() : await completedFrameSet(checkpoint, frameDirectory);
    const initiallyComplete = [...completed].filter((frame) => frame >= frameRange.startFrame && frame < frameRange.endFrame).length;
    await reporter.emit({ phase: "prepare", status: "completed", message: `Browser pinned at ${driver.version}; ${initiallyComplete} frames resumable`, completed: initiallyComplete, total: frameCount });
    await reporter.emit({ phase: "capture", status: "started", message: "Capturing authoritative PNG frames with network denied", completed: initiallyComplete, total: frameCount });

    let completedCount = initiallyComplete;
    let checkpointWrite = Promise.resolve();
    const chunks = planRenderChunks(frameRange, maximumFramesPerChunk, "frames");
    for (const chunk of chunks) {
      throwIfAborted(options.signal);
      const absentRanges = missingRanges(chunk, completed);
      const frames = absentRanges.flatMap((range) => Array.from({ length: range.endFrame - range.startFrame }, (_, index) => range.startFrame + index));
      if (frames.length === 0) continue;
      await captureWithConcurrency(frames, concurrency, capture, captureManifest, frameDirectory, options.signal, async (result) => {
        completed.add(result.frame);
        completedCount += 1;
        const checkpointRecord: CaptureCheckpointFrame = {
          contentHash: result.contentHash,
          outputSha256: result.outputSha256,
          browserVersion: result.browserVersion,
        };
        checkpoint.frames[String(result.frame)] = checkpointRecord;
        checkpointWrite = checkpointWrite.then(async () => appendFile(checkpointPath, checkpointFrameLine(result.frame, checkpointRecord), "utf8"));
        await checkpointWrite;
        await reporter.emit({
          phase: "capture",
          status: "progress",
          message: `Captured frame ${result.frame}`,
          frame: result.frame,
          chunk: chunk.index,
          completed: completedCount,
          total: frameCount,
          outputPath: result.outputPath,
        });
      });
    }
    await checkpointWrite;
    await reporter.emit({ phase: "capture", status: "completed", message: `Captured ${frameCount} authoritative frames`, completed: frameCount, total: frameCount });

    const framePattern = join(frameDirectory, "frame-%08d.png");
    await reporter.emit({ phase: "mezzanine", status: "started", message: "Encoding lossless FFV1 mezzanine" });
    const baseMezzaninePath = presenterLayers.length > 0 ? join(attemptDirectory, "base-mezzanine.mkv") : mezzaninePath;
    await runPlan(planFrameSequenceToFfv1(framePattern, baseMezzaninePath, manifest.target, frameRange.startFrame), options.executables, commandRunner, options.signal, attemptDirectory);
    if (presenterLayers.length > 0) {
      await reporter.emit({ phase: "mezzanine", status: "progress", message: `Compositing ${presenterLayers.length} verified presenter clip${presenterLayers.length === 1 ? "" : "s"}` });
      await runPlan(planPresenterComposite(baseMezzaninePath, presenterLayers, mezzaninePath, manifest.target), options.executables, commandRunner, options.signal, attemptDirectory);
    }
    await reporter.emit({ phase: "mezzanine", status: "completed", message: presenterLayers.length > 0 ? "Lossless presenter composite encoded" : "Lossless FFV1 mezzanine encoded", outputPath: mezzaninePath });

    const cues = collectCaptions(manifest, frameRange);
    const captionLedger = canonicalCaptionLedger(cues, selectedCaptionLanguage);
    await atomicWrite(captionsVttPath, toWebVtt(cues));
    await atomicWrite(captionsSrtPath, toSrt(cues));
    await atomicWrite(captionsLedgerPath, captionLedger);

    await reporter.emit({ phase: "audio", status: "started", message: "Building exact-duration 48 kHz audio master" });
    const selectedAudio = audioInputsForRange(manifest, startTick, endTick);
    const audioPlan = selectedAudio.length === 0
      ? planSilentAudio(durationTicks, audioPath)
      : planAudioMaster(selectedAudio, audioPath, { timelineStartTick: startTick, durationTicks });
    await runPlan(audioPlan, options.executables, commandRunner, options.signal, attemptDirectory);
    await reporter.emit({ phase: "audio", status: "completed", message: selectedAudio.length === 0 ? "48 kHz silent master created" : "48 kHz program master created", outputPath: audioPath });

    const embedCaptions = (selectedCaptionMode === "embedded" || selectedCaptionMode === "both") && cues.length > 0;
    const burnedCaptions = selectedCaptionMode === "burned" || selectedCaptionMode === "both";
    const deliveryDescription = embedCaptions
      ? `${selectedCaptionMode} captions (soft track plus UTF-8 sidecars)`
      : burnedCaptions
        ? "open captions plus UTF-8 sidecars"
        : "a clean master plus UTF-8 caption sidecars";
    await reporter.emit({ phase: "delivery", status: "started", message: `Encoding ${deliveryResolution.options.codec} delivery with ${deliveryDescription}` });
    const deliveryPlan = planDeliveryEncode(mezzaninePath, audioPath, deliveryPath, {
      ...deliveryResolution.options,
      captionMode: selectedCaptionMode,
      captionLanguage: selectedCaptionLanguage,
      ...(embedCaptions ? { captionPath: captionsVttPath } : {}),
    });
    await runPlan(deliveryPlan, options.executables, commandRunner, options.signal, attemptDirectory);
    await reporter.emit({ phase: "delivery", status: "completed", message: "Delivery encode completed", outputPath: deliveryPath });

    await reporter.emit({ phase: "qa", status: "started", message: "Probing streams and measuring every decoded audio sample" });
    const probeResult = await runPlan(planProbe(deliveryPath), options.executables, commandRunner, options.signal, attemptDirectory);
    let probeDocument: ProbeDocument;
    try {
      probeDocument = JSON.parse(probeResult.stdout) as ProbeDocument;
    } catch (error) {
      throw new Error(`ffprobe returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const probe = validateProbe(probeDocument, manifest, ticksToSeconds(durationTicks), embedCaptions);
    await runPlan(planDecodeValidation(deliveryPath), options.executables, commandRunner, options.signal, attemptDirectory);
    const audioAnalysisResult = await runPlan(planAudioAnalysis(deliveryPath), options.executables, commandRunner, options.signal, attemptDirectory);
    const measuredAudio = parseAudioAnalysis(audioAnalysisResult.stderr);
    requireNonSilentAudio(measuredAudio);
    const avDriftSeconds = probe.videoEndSeconds === null || probe.audioEndSeconds === null
      ? null
      : probe.audioEndSeconds - probe.videoEndSeconds;
    const framesPerSecond = manifest.target.frameRate.numerator / manifest.target.frameRate.denominator;
    const qaMetrics: RenderQaMetrics = {
      ...measuredAudio,
      truePeakDbtp: measuredAudio.truePeakDbtp,
      audioIsSilent: false,
      avDriftSeconds,
      avDriftFrames: avDriftSeconds === null ? null : avDriftSeconds * framesPerSecond,
      measurementSource: "delivery-full-decode:ffmpeg-ebur128+astats;timeline:ffprobe-streams",
    };
    const driftSummary = qaMetrics.avDriftFrames === null ? "A/V drift unavailable" : `A/V drift ${qaMetrics.avDriftFrames.toFixed(3)} frames`;
    await reporter.emit({ phase: "qa", status: "completed", message: `QA measured: ${qaMetrics.integratedLufs.toFixed(1)} LUFS, ${qaMetrics.clippedSamples} clipped samples, ${driftSummary}` });

    await reporter.emit({ phase: "finalize", status: "started", message: "Hashing output artifacts and finalizing provenance" });
    const frameRecords = Object.entries(checkpoint.frames)
      .map(([frame, record]) => ({ frame: Number(frame), contentSha256: record.contentHash, pngSha256: record.outputSha256 }))
      .filter((record) => record.frame >= frameRange.startFrame && record.frame < frameRange.endFrame)
      .sort((left, right) => left.frame - right.frame);
    if (frameRecords.length !== frameCount) throw new Error(`Capture checkpoint has ${frameRecords.length} frames; expected ${frameCount}`);
    const files = await Promise.all([
      outputFile("mezzanine", mezzaninePath),
      outputFile("delivery", deliveryPath),
      outputFile("audio-master", audioPath),
      outputFile("captions-vtt", captionsVttPath),
      outputFile("captions-srt", captionsSrtPath),
      outputFile("captions-ledger", captionsLedgerPath),
    ]);
    await reporter.emit({ phase: "finalize", status: "completed", message: `Hashed ${files.length} output artifacts` });
    const output: RenderOutputManifest = {
      schemaVersion: OUTPUT_SCHEMA_VERSION,
      manifestId: manifest.id,
      inputManifestSha256,
      renderKey,
      selection,
      frameRange,
      frameCount,
      startTick,
      durationTicks,
      target: manifest.target,
      browser: {
        executablePath: driver.executablePath,
        version: driver.version,
        sha256: browserSha256,
        networkPolicy: "deny",
      },
      executables: { ffmpeg: options.executables.ffmpeg, ffprobe: options.executables.ffprobe },
      frames: frameRecords,
      files,
      probe,
      qaMetrics,
      captionDelivery: {
        mode: selectedCaptionMode,
        language: selectedCaptionLanguage,
        cueCount: cues.length,
        canonicalCueLedgerSha256: sha256Text(captionLedger),
        burnedIntoVideo: burnedCaptions,
        embeddedSoftTrack: embedCaptions,
        sidecars: {
          vtt: captionsVttPath,
          srt: captionsSrtPath,
          ledger: captionsLedgerPath,
        },
      },
      stageTimings: reporter.timings(),
      hardwareProvenance: deliveryResolution.provenance,
      progressPath,
      outputManifestPath,
    };
    await atomicWrite(outputManifestPath, `${stableJson(output)}\n`);
    await reporter.emit({ phase: "complete", status: "completed", message: "Authoritative render completed", completed: frameCount, total: frameCount, outputPath: outputManifestPath });
    if (options.keepFrameCache === false) await rm(cacheDirectory, { recursive: true, force: true });
    return output;
  } catch (error) {
    const cancelled = error instanceof Error && error.name === "AbortError";
    await reporter.emit({
      phase: cancelled ? "cancelled" : "failed",
      status: "failed",
      message: cancelled ? "Render cancelled; completed frame checkpoint preserved" : (error instanceof Error ? error.message : String(error)),
    }).catch(() => undefined);
    throw error;
  } finally {
    if (abortBrowser) options.signal?.removeEventListener("abort", abortBrowser);
    await capture?.close().catch(() => undefined);
    await rm(attemptDirectory, { recursive: true, force: true });
  }
}
