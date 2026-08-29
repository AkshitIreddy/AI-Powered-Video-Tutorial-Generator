#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RenderManifest } from "./contracts.js";
import { assertRenderManifest } from "./contracts.js";
import { toSrt, toWebVtt } from "./captions.js";
import { planDeliveryEncode, planFrameSequenceToFfv1, planProbe } from "./ffmpeg.js";
import { executeRender, type RenderSelection } from "./executor.js";
import { fixtureManifest } from "./fixture.js";
import { planRenderChunks } from "./ranges.js";
import { FrameRenderer, totalFrames, totalTicks } from "./runtime.js";

const HELP = `Alystria deterministic renderer

Usage:
  alystria-renderer inspect <manifest.json>
  alystria-renderer frame <manifest.json|--fixture> <frame> <output.svg|output.html>
  alystria-renderer parity <manifest.json|--fixture> <frame>
  alystria-renderer chunks <manifest.json> <maximum-frames>
  alystria-renderer captions <manifest.json> <scene-id> <output.vtt|output.srt>
  alystria-renderer plan-ffv1 <manifest.json> <frames-pattern> <output.mkv>
  alystria-renderer plan-delivery <video.mkv> <audio.wav|-> <output.mp4> <codec>
  alystria-renderer plan-probe <media-path>
  alystria-renderer render <manifest.json|--fixture> [options]

Render options:
  --mode <full|draft|range|scene>   Export selection (default: full)
  --scene <id>                     Scene id for --mode scene
  --start-frame <n>                Inclusive frame for --mode range
  --end-frame <n>                  Exclusive frame for --mode range
  --draft-max <pixels>             Maximum draft width/height (default: 960)
  --output-dir <path>              Override manifest output directory
  --output <filename>              Delivery filename (.webm/.mkv or .mp4/.mov)
  --browser <path>                 Exact Chromium executable; otherwise pinned Playwright Chromium
  --browser-version <version>      Require this Chromium version
  --browser-sha256 <hex>           Require this Chromium executable digest
  --ffmpeg <path>                  Exact FFmpeg executable (default: ALYSTRIA_FFMPEG_PATH or ffmpeg)
  --ffprobe <path>                 Exact ffprobe executable (default: ALYSTRIA_FFPROBE_PATH or ffprobe)
  --codec <name>                   vp9, av1, h264_nvenc, h264_mf, libx264, hevc_nvenc
  --quality <n>                    Codec quality value
  --bitrate <rate>                 Video bitrate such as 12M
  --concurrency <n>                Browser page concurrency, 1-8 (default: 2)
  --chunk-frames <n>               Resume-checkpoint chunk size (default: 120)
  --progress <path>                Progress JSONL destination
  --no-resume                      Ignore an existing frame checkpoint
  --discard-frame-cache            Remove resumable PNG cache after success

The render command starts Chromium and FFmpeg directly with argument arrays. It
never invokes a shell. Planning commands remain side-effect-free.`;

export interface ManifestDocument {
  readonly manifest: RenderManifest;
  /** Hash of the exact bytes parsed, before JavaScript number normalization. */
  readonly sha256: string;
}

export async function manifestDocumentFrom(argument: string | undefined): Promise<ManifestDocument> {
  if (!argument) throw new TypeError("Manifest path is required");
  const bytes = argument === "--fixture"
    ? Buffer.from(JSON.stringify(fixtureManifest()), "utf8")
    : await readFile(resolve(argument));
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  assertRenderManifest(parsed as RenderManifest);
  return {
    manifest: parsed as RenderManifest,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function manifestFrom(argument: string | undefined): Promise<RenderManifest> {
  return (await manifestDocumentFrom(argument)).manifest;
}

function integer(value: string | undefined, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new RangeError(`${label} must be a non-negative integer`);
  return parsed;
}

async function write(path: string, contents: string): Promise<void> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, contents, "utf8");
}

interface ParsedFlags {
  readonly values: ReadonlyMap<string, string>;
  readonly switches: ReadonlySet<string>;
}

function parseFlags(args: readonly string[], valueFlags: ReadonlySet<string>, switchFlags: ReadonlySet<string>): ParsedFlags {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag?.startsWith("--")) throw new TypeError(`Unexpected positional argument ${flag ?? ""}`);
    if (switchFlags.has(flag)) {
      switches.add(flag);
      continue;
    }
    if (!valueFlags.has(flag)) throw new TypeError(`Unknown render option ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new TypeError(`${flag} requires a value`);
    values.set(flag, value);
    index += 1;
  }
  return { values, switches };
}

function optionalInteger(value: string | undefined, label: string): number | undefined {
  return value === undefined ? undefined : integer(value, label);
}

function renderSelection(flags: ParsedFlags): RenderSelection {
  const mode = flags.values.get("--mode") ?? "full";
  switch (mode) {
    case "full": return { kind: "full" };
    case "draft": {
      const maximumDimension = optionalInteger(flags.values.get("--draft-max"), "draft-max");
      return maximumDimension === undefined ? { kind: "draft" } : { kind: "draft", maximumDimension };
    }
    case "range": {
      const startFrame = optionalInteger(flags.values.get("--start-frame"), "start-frame");
      const endFrame = optionalInteger(flags.values.get("--end-frame"), "end-frame");
      if (startFrame === undefined || endFrame === undefined) throw new TypeError("--mode range requires --start-frame and --end-frame");
      return { kind: "range", startFrame, endFrame };
    }
    case "scene": {
      const sceneId = flags.values.get("--scene");
      if (!sceneId) throw new TypeError("--mode scene requires --scene");
      return { kind: "scene", sceneId };
    }
    default: throw new TypeError(`Unsupported render mode ${mode}`);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  switch (command) {
    case "inspect": {
      const manifest = await manifestFrom(args[0]);
      process.stdout.write(`${JSON.stringify({ id: manifest.id, scenes: manifest.scenes.length, totalTicks: totalTicks(manifest), totalFrames: totalFrames(manifest), target: manifest.target }, null, 2)}\n`);
      return 0;
    }
    case "frame": {
      const manifest = await manifestFrom(args[0]);
      const frame = integer(args[1], "frame");
      if (!args[2]) throw new TypeError("Output path is required");
      const rendered = new FrameRenderer({ verifyRepeatability: true }).render(manifest, frame);
      const suffix = extname(args[2]).toLowerCase();
      if (suffix !== ".svg" && suffix !== ".html") throw new TypeError("Frame output must end in .svg or .html");
      await write(args[2], suffix === ".svg" ? rendered.svg : rendered.html);
      process.stdout.write(`${JSON.stringify({ frame, sceneId: rendered.sceneId, tick: rendered.tick, sha256: rendered.contentHash, output: resolve(args[2]) }, null, 2)}\n`);
      return 0;
    }
    case "parity": {
      const manifest = await manifestFrom(args[0]);
      const frame = integer(args[1], "frame");
      const sha256 = new FrameRenderer({ verifyRepeatability: true }).verifyPreviewFinalParity(manifest, frame);
      process.stdout.write(`${JSON.stringify({ frame, previewFinalParity: true, sha256 }, null, 2)}\n`);
      return 0;
    }
    case "chunks": {
      const manifest = await manifestFrom(args[0]);
      const maximum = integer(args[1], "maximum-frames");
      process.stdout.write(`${JSON.stringify(planRenderChunks({ startFrame: 0, endFrame: totalFrames(manifest) }, maximum), null, 2)}\n`);
      return 0;
    }
    case "captions": {
      const manifest = await manifestFrom(args[0]);
      const scene = manifest.scenes.find((candidate) => candidate.id === args[1]);
      if (!scene) throw new TypeError(`Unknown scene ${args[1] ?? ""}`);
      if (!args[2]) throw new TypeError("Caption output path is required");
      const suffix = extname(args[2]).toLowerCase();
      if (suffix !== ".vtt" && suffix !== ".srt") throw new TypeError("Caption output must end in .vtt or .srt");
      await write(args[2], suffix === ".vtt" ? toWebVtt(scene.captions ?? []) : toSrt(scene.captions ?? []));
      return 0;
    }
    case "plan-ffv1": {
      const manifest = await manifestFrom(args[0]);
      if (!args[1] || !args[2]) throw new TypeError("Frames pattern and output path are required");
      process.stdout.write(`${JSON.stringify(planFrameSequenceToFfv1(args[1], args[2], manifest.target), null, 2)}\n`);
      return 0;
    }
    case "plan-delivery": {
      if (!args[0] || !args[1] || !args[2] || !args[3]) throw new TypeError("Video, audio, output, and codec are required");
      const supported = new Set(["h264_nvenc", "h264_mf", "libx264", "hevc_nvenc", "vp9", "av1"]);
      if (!supported.has(args[3])) throw new TypeError(`Unsupported codec ${args[3]}`);
      const plan = planDeliveryEncode(args[0], args[1] === "-" ? undefined : args[1], args[2], { codec: args[3] as "h264_nvenc" });
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      return 0;
    }
    case "plan-probe": {
      if (!args[0]) throw new TypeError("Media path is required");
      process.stdout.write(`${JSON.stringify(planProbe(args[0]), null, 2)}\n`);
      return 0;
    }
    case "render": {
      const manifestDocument = await manifestDocumentFrom(args[0]);
      const manifest = manifestDocument.manifest;
      const flags = parseFlags(args.slice(1), new Set([
        "--mode", "--scene", "--start-frame", "--end-frame", "--draft-max",
        "--output-dir", "--output", "--browser", "--browser-version", "--browser-sha256",
        "--ffmpeg", "--ffprobe", "--codec", "--quality", "--bitrate", "--concurrency",
        "--chunk-frames", "--progress",
      ]), new Set(["--no-resume", "--discard-frame-cache"]));
      const codec = flags.values.get("--codec") ?? "vp9";
      const supported = new Set(["h264_nvenc", "h264_mf", "libx264", "hevc_nvenc", "vp9", "av1"]);
      if (!supported.has(codec)) throw new TypeError(`Unsupported codec ${codec}`);
      const quality = optionalInteger(flags.values.get("--quality"), "quality");
      const browserPath = flags.values.get("--browser") ?? process.env.ALYSTRIA_CHROMIUM_PATH;
      const concurrency = optionalInteger(flags.values.get("--concurrency"), "concurrency");
      const maximumFramesPerChunk = optionalInteger(flags.values.get("--chunk-frames"), "chunk-frames");
      const controller = new AbortController();
      const cancel = (): void => controller.abort();
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
      try {
        const output = await executeRender({
          manifest,
          inputManifestSha256: manifestDocument.sha256,
          selection: renderSelection(flags),
          executables: {
            ...(browserPath === undefined ? {} : { browser: browserPath }),
            ffmpeg: flags.values.get("--ffmpeg") ?? process.env.ALYSTRIA_FFMPEG_PATH ?? "ffmpeg",
            ffprobe: flags.values.get("--ffprobe") ?? process.env.ALYSTRIA_FFPROBE_PATH ?? "ffprobe",
          },
          delivery: {
            codec: codec as "vp9",
            ...(quality === undefined ? {} : { quality }),
            ...(flags.values.get("--bitrate") === undefined ? {} : { bitrate: flags.values.get("--bitrate") as string }),
          },
          ...(flags.values.get("--output-dir") === undefined ? {} : { outputDirectory: flags.values.get("--output-dir") as string }),
          ...(flags.values.get("--output") === undefined ? {} : { outputName: flags.values.get("--output") as string }),
          ...(flags.values.get("--browser-version") === undefined ? {} : { expectedBrowserVersion: flags.values.get("--browser-version") as string }),
          ...(flags.values.get("--browser-sha256") === undefined ? {} : { expectedBrowserSha256: flags.values.get("--browser-sha256") as string }),
          ...(concurrency === undefined ? {} : { concurrency }),
          ...(maximumFramesPerChunk === undefined ? {} : { maximumFramesPerChunk }),
          ...(flags.values.get("--progress") === undefined ? {} : { progressPath: flags.values.get("--progress") as string }),
          resume: !flags.switches.has("--no-resume"),
          keepFrameCache: !flags.switches.has("--discard-frame-cache"),
          signal: controller.signal,
        });
        process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
        return 0;
      } finally {
        process.removeListener("SIGINT", cancel);
        process.removeListener("SIGTERM", cancel);
      }
    }
    default:
      throw new TypeError(`Unknown command ${command}\n\n${HELP}`);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().then((exitCode) => { process.exitCode = exitCode; }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`alystria-renderer: ${message}\n`);
    process.exitCode = 1;
  });
}
