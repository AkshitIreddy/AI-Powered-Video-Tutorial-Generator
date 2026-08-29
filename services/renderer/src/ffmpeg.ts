import type { AudioInput, FrameRate, RenderTarget } from "./contracts.js";
import type { PresenterCompositeLayer } from "./presenter.js";
import { ticksToSeconds } from "./timebase.js";

export interface CommandPlan {
  readonly executable: "ffmpeg" | "ffprobe";
  readonly args: readonly string[];
  readonly expectedOutputs: readonly string[];
  readonly description: string;
  readonly licensingWarnings: readonly string[];
}

export type DeliveryCodec = "h264_nvenc" | "h264_mf" | "libx264" | "hevc_nvenc" | "vp9" | "av1";

export interface DeliveryOptions {
  readonly codec: DeliveryCodec;
  readonly quality?: number;
  readonly bitrate?: string;
  readonly pixelFormat?: "yuv420p" | "yuv420p10le";
  readonly audioBitrate?: string;
  readonly fastStart?: boolean;
  readonly captionPath?: string;
}

export interface AudioMasterOptions {
  /** Global timeline origin of this export. */
  readonly timelineStartTick?: number;
  /** Exact output duration. Audio is padded or trimmed to this duration. */
  readonly durationTicks?: number;
}

export interface FfmpegCapabilities {
  readonly version: string;
  readonly configuration: string;
  readonly encoders: ReadonlySet<string>;
  readonly isGpl: boolean;
  readonly isNonfree: boolean;
}

const PATH_CONTROL_CHARACTERS = /[\u0000\r\n]/;
const BITRATE = /^\d+(?:\.\d+)?[kKmM]?$/;

function pathArgument(value: string, label: string): string {
  if (!value || PATH_CONTROL_CHARACTERS.test(value)) throw new TypeError(`${label} is empty or contains control characters`);
  return value;
}

function frameRateArgument(rate: FrameRate): string {
  if (!Number.isSafeInteger(rate.numerator) || !Number.isSafeInteger(rate.denominator) || rate.numerator <= 0 || rate.denominator <= 0) {
    throw new RangeError("Frame rate must contain positive safe integers");
  }
  return `${rate.numerator}/${rate.denominator}`;
}

function quality(value: number | undefined, fallback: number): number {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected < 0 || selected > 63) throw new RangeError(`Quality must be an integer in [0, 63], got ${selected}`);
  return selected;
}

function mediaFoundationQuality(value: number | undefined): number {
  const selected = value ?? 75;
  if (!Number.isInteger(selected) || selected < 1 || selected > 100) {
    throw new RangeError(`Media Foundation quality must be an integer in [1, 100], got ${selected}`);
  }
  return selected;
}

function bitrate(value: string | undefined, fallback: string): string {
  const selected = value ?? fallback;
  if (!BITRATE.test(selected)) throw new TypeError(`Invalid bitrate ${selected}`);
  return selected;
}

export function planFrameSequenceToFfv1(inputPattern: string, outputPath: string, target: RenderTarget, startFrame = 0): CommandPlan {
  if (!Number.isSafeInteger(startFrame) || startFrame < 0) throw new RangeError("startFrame must be non-negative");
  return {
    executable: "ffmpeg",
    args: [
      "-hide_banner", "-nostdin", "-y",
      "-framerate", frameRateArgument(target.frameRate),
      "-start_number", String(startFrame),
      "-i", pathArgument(inputPattern, "input pattern"),
      "-map_metadata", "-1", "-fflags", "+bitexact",
      "-an", "-c:v", "ffv1", "-flags:v", "+bitexact", "-level", "3", "-coder", "1", "-context", "1", "-g", "1",
      "-pix_fmt", "gbrp10le", "-color_primaries", "bt709", "-color_trc", "iec61966-2-1", "-colorspace", "bt709",
      "-f", "matroska", pathArgument(outputPath, "output path"),
    ],
    expectedOutputs: [outputPath],
    description: "Encode authoritative PNG frames to a lossless FFV1 scene mezzanine",
    licensingWarnings: [],
  };
}

export function planConcatFfv1(concatListPath: string, outputPath: string): CommandPlan {
  return {
    executable: "ffmpeg",
    args: ["-hide_banner", "-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", pathArgument(concatListPath, "concat list"), "-map", "0:v:0", "-c", "copy", pathArgument(outputPath, "output path")],
    expectedOutputs: [outputPath],
    description: "Concatenate lossless scene mezzanines without re-encoding",
    licensingWarnings: [],
  };
}

function fixedSeconds(ticks: number): string {
  return ticksToSeconds(ticks).toFixed(6);
}

/**
 * Composites immutable presenter clips into the lossless scene mezzanine.
 * All placement/filter values are derived from validated numeric contracts;
 * no provider-generated filter expression or argument is accepted.
 */
export function planPresenterComposite(
  baseVideoPath: string,
  layers: readonly PresenterCompositeLayer[],
  outputPath: string,
  target: RenderTarget,
): CommandPlan {
  if (layers.length === 0) throw new TypeError("Presenter composition requires at least one layer");
  const args = ["-hide_banner", "-nostdin", "-y", "-i", pathArgument(baseVideoPath, "base video input")];
  for (const layer of layers) args.push("-i", pathArgument(layer.path, `presenter video ${layer.id}`));

  const filters: string[] = [];
  let base = "0:v";
  layers.forEach((layer, index) => {
    const input = index + 1;
    const prepared = `presenter${index}`;
    const composed = `composed${index}`;
    const sourceStart = fixedSeconds(layer.sourceStartTick);
    const duration = fixedSeconds(layer.durationTicks);
    const timelineStart = fixedSeconds(layer.timelineStartTick);
    const timelineEnd = fixedSeconds(layer.timelineStartTick + layer.durationTicks);
    const fit = layer.fit === "cover"
      ? `scale=${layer.width}:${layer.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${layer.width}:${layer.height}`
      : `scale=${layer.width}:${layer.height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${layer.width}:${layer.height}:(ow-iw)/2:(oh-ih)/2:color=0xF7F8FC`;
    filters.push(
      `[${input}:v]trim=start=${sourceStart}:duration=${duration},setpts=PTS-STARTPTS+${timelineStart}/TB,fps=${frameRateArgument(target.frameRate)},${fit},setsar=1[${prepared}]`,
      `[${base}][${prepared}]overlay=x=${layer.x}:y=${layer.y}:eof_action=pass:repeatlast=0:shortest=0:enable='between(t,${timelineStart},${timelineEnd})'[${composed}]`,
    );
    base = composed;
  });

  args.push(
    "-filter_complex_threads", "1",
    "-filter_complex", filters.join(";"),
    "-map", `[${base}]`,
    "-map_metadata", "-1",
    "-fflags", "+bitexact",
    "-an", "-c:v", "ffv1", "-flags:v", "+bitexact", "-level", "3", "-coder", "1", "-context", "1", "-g", "1",
    "-pix_fmt", "gbrp10le", "-color_primaries", "bt709", "-color_trc", "iec61966-2-1", "-colorspace", "bt709",
    "-f", "matroska", pathArgument(outputPath, "presenter composite output"),
  );
  return {
    executable: "ffmpeg",
    args,
    expectedOutputs: [outputPath],
    description: `Composite ${layers.length} presenter video layer${layers.length === 1 ? "" : "s"} into the lossless mezzanine`,
    licensingWarnings: [],
  };
}

export function ffconcatDocument(paths: readonly string[]): string {
  if (paths.length === 0) throw new TypeError("FFconcat document requires at least one input");
  const escaped = paths.map((path) => {
    pathArgument(path, "concat input");
    return `file '${path.replaceAll("'", "'\\''")}'`;
  });
  return `ffconcat version 1.0\n${escaped.join("\n")}\n`;
}

export function planProbe(path: string): CommandPlan {
  return {
    executable: "ffprobe",
    args: ["-v", "error", "-show_error", "-show_format", "-show_streams", "-show_chapters", "-of", "json", pathArgument(path, "probe path")],
    expectedOutputs: [],
    description: "Probe streams, duration, color metadata, and decode errors as JSON",
    licensingWarnings: [],
  };
}

export function planDecodeValidation(path: string): CommandPlan {
  return {
    executable: "ffmpeg",
    args: ["-v", "error", "-nostdin", "-xerror", "-i", pathArgument(path, "validation path"), "-map", "0:v?", "-map", "0:a?", "-sn", "-f", "null", "-"],
    expectedOutputs: [],
    description: "Decode every audio/video output packet and fail on the first media error",
    licensingWarnings: [],
  };
}

/**
 * Fully decodes the delivery audio and emits machine-parseable measurements to
 * stderr.  The ebur128 branch supplies integrated LUFS and oversampled true
 * peak.  The astats branch receives a binary full-scale mask, amplified only
 * to preserve integer-count precision in FFmpeg's six-decimal log output.
 * When the mask has any non-zero value, `Abs Peak count` is therefore the
 * exact number of decoded channel samples at or beyond full scale.
 */
export function planAudioAnalysis(path: string): CommandPlan {
  const filter = [
    "[0:a:0]asplit=2[loudness][clip_source]",
    "[loudness]ebur128=peak=true:framelog=verbose[loudness_out]",
    "[clip_source]aformat=sample_fmts=dbl,aeval=exprs='gte(abs(val(ch)),1)*1000000000',astats=metadata=0:reset=0[clip_out]",
  ].join(";");
  return {
    executable: "ffmpeg",
    args: [
      "-hide_banner", "-nostdin", "-nostats",
      "-i", pathArgument(path, "audio analysis input"),
      "-filter_complex", filter,
      "-map", "[loudness_out]", "-map", "[clip_out]",
      "-f", "null", "-",
    ],
    expectedOutputs: [],
    description: "Measure decoded delivery loudness, true peak, and clipped samples",
    licensingWarnings: [],
  };
}

interface PreparedAudio {
  readonly inputs: readonly string[];
  readonly filter: string;
  readonly outputLabel: string;
}

function prepareAudio(inputs: readonly AudioInput[], options: AudioMasterOptions = {}): PreparedAudio {
  if (inputs.length === 0) throw new TypeError("Audio assembly needs at least one input");
  const timelineStartTick = options.timelineStartTick ?? 0;
  if (!Number.isSafeInteger(timelineStartTick) || timelineStartTick < 0) throw new RangeError("timelineStartTick must be a non-negative safe integer");
  if (options.durationTicks !== undefined && (!Number.isSafeInteger(options.durationTicks) || options.durationTicks <= 0)) {
    throw new RangeError("durationTicks must be a positive safe integer");
  }
  const args: string[] = [];
  const chains: string[] = [];
  const labels: Record<AudioInput["role"], string[]> = {
    narration: [],
    music: [],
    sfx: [],
    "audio-description": [],
  };
  inputs.forEach((input, index) => {
    if (!Object.hasOwn(labels, input.role)) throw new TypeError(`Audio input ${index} has unsupported role ${String(input.role)}`);
    if (input.loop) args.push("-stream_loop", "-1");
    args.push("-i", pathArgument(input.path, `audio input ${index}`));
    if (!Number.isSafeInteger(input.startTick) || input.startTick < 0) throw new RangeError(`Audio input ${index} has invalid startTick`);
    const delayTicks = Math.max(0, input.startTick - timelineStartTick);
    const sourceOffsetTicks = Math.max(0, timelineStartTick - input.startTick);
    const delayMs = Math.round(ticksToSeconds(delayTicks) * 1_000);
    const gain = input.gainDb ?? (input.role === "music" ? -18 : input.role === "sfx" ? -12 : 0);
    if (!Number.isFinite(gain) || gain < -96 || gain > 24) throw new RangeError(`Audio input ${index} gain is outside [-96, 24] dB`);
    const inputDurationTicks = input.endTick === undefined ? undefined : input.endTick - input.startTick;
    const remainingInputTicks = inputDurationTicks === undefined ? undefined : Math.max(0, inputDurationTicks - sourceOffsetTicks);
    const remainingTimelineTicks = options.durationTicks === undefined ? undefined : Math.max(0, options.durationTicks - delayTicks);
    const trimDurationTicks = remainingInputTicks === undefined
      ? remainingTimelineTicks
      : remainingTimelineTicks === undefined
        ? remainingInputTicks
        : Math.min(remainingInputTicks, remainingTimelineTicks);
    const trimParts = [`start=${ticksToSeconds(sourceOffsetTicks).toFixed(6)}`];
    if (trimDurationTicks !== undefined) trimParts.push(`duration=${ticksToSeconds(trimDurationTicks).toFixed(6)}`);
    const trim = `,atrim=${trimParts.join(":")},asetpts=PTS-STARTPTS`;
    const label = `a${index}`;
    chains.push(`[${index}:a]aresample=48000:resampler=soxr${trim},adelay=${delayMs}|${delayMs},volume=${gain.toFixed(2)}dB[${label}]`);
    labels[input.role].push(`[${label}]`);
  });
  const mixGroup = (group: readonly string[], label: string): string | undefined => {
    if (group.length === 0) return undefined;
    if (group.length === 1) chains.push(`${group[0]}anull[${label}]`);
    else chains.push(`${group.join("")}amix=inputs=${group.length}:duration=longest:normalize=0:dropout_transition=0[${label}]`);
    return `[${label}]`;
  };
  const voice = mixGroup([...labels.narration, ...labels["audio-description"]], "voice");
  const music = mixGroup(labels.music, "music");
  const effects = mixGroup(labels.sfx, "effects");
  const finalLabels: string[] = [];
  if (voice && music) {
    const configuredDucking = inputs
      .filter((input) => input.role === "music" && input.duckingDb !== undefined)
      .map((input) => input.duckingDb as number);
    const duckingDb = configuredDucking.length === 0 ? -12 : Math.min(...configuredDucking);
    if (!Number.isFinite(duckingDb) || duckingDb < -36 || duckingDb > 0) {
      throw new RangeError("Music ducking must be in [-36, 0] dB");
    }
    // sidechaincompress is programme-dependent, so duckingDb is a maximum
    // reduction policy rather than a promise that every voiced sample reaches
    // exactly that gain.  A ratio of one disables reduction; deeper requested
    // policies increase it monotonically to FFmpeg's documented ceiling.
    const duckingRatio = Math.min(20, Math.max(1, 1 + Math.abs(duckingDb) * 0.75));
    chains.push(`${voice}asplit=2[voice_mix][voice_sc]`);
    chains.push("[voice_sc]apad[voice_sc_pad]");
    chains.push(`${music}[voice_sc_pad]sidechaincompress=threshold=0.015:ratio=${duckingRatio.toFixed(3)}:attack=20:release=500[ducked_music]`);
    finalLabels.push("[voice_mix]", "[ducked_music]");
  } else {
    if (voice) finalLabels.push(voice);
    if (music) finalLabels.push(music);
  }
  if (effects) finalLabels.push(effects);
  if (finalLabels.length === 1) chains.push(`${finalLabels[0]}anull[mix]`);
  else chains.push(`${finalLabels.join("")}amix=inputs=${finalLabels.length}:duration=longest:normalize=0:dropout_transition=0[mix]`);
  // Pad/trim before normalization so integrated loudness is measured over the
  // exact programme duration. Normalizing first then appending intentional
  // scene silence makes a short tutorial appear artificially quiet at delivery.
  const exactDuration = options.durationTicks === undefined
    ? ""
    : `apad=whole_dur=${ticksToSeconds(options.durationTicks).toFixed(6)},atrim=duration=${ticksToSeconds(options.durationTicks).toFixed(6)},`;
  // Bring high speech transients under control before loudness normalization.
  // Without this gentle speech-focused compression, a programme can be too
  // quiet to meet -16 LUFS while still already sitting at the peak ceiling.
  // Reserve 0.5 dB beyond the public -1.5 dBTP ceiling because lossy delivery
  // codecs can raise reconstructed peaks slightly; full-decode QA remains the
  // authoritative release gate.
  chains.push(`[mix]${exactDuration}acompressor=threshold=0.05:ratio=8:attack=5:release=100,loudnorm=I=-16:LRA=11:TP=-2:linear=false,aresample=48000:async=1:first_pts=0[outa]`);
  return { inputs: args, filter: chains.join(";"), outputLabel: "[outa]" };
}

export function planAudioMaster(inputs: readonly AudioInput[], outputPath: string, options: AudioMasterOptions = {}): CommandPlan {
  const prepared = prepareAudio(inputs, options);
  return {
    executable: "ffmpeg",
    args: ["-hide_banner", "-nostdin", "-y", ...prepared.inputs, "-filter_complex", prepared.filter, "-map", prepared.outputLabel, "-c:a", "pcm_s24le", "-ar", "48000", pathArgument(outputPath, "audio output")],
    expectedOutputs: [outputPath],
    description: "Assemble an exact-duration 48 kHz master for -16 LUFS / <= -1.5 dBTP delivery",
    licensingWarnings: [],
  };
}

export function planSilentAudio(durationTicks: number, outputPath: string): CommandPlan {
  if (!Number.isSafeInteger(durationTicks) || durationTicks <= 0) throw new RangeError("Silent audio duration must be a positive safe integer");
  return {
    executable: "ffmpeg",
    args: [
      "-hide_banner", "-nostdin", "-y",
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
      "-t", ticksToSeconds(durationTicks).toFixed(6),
      "-c:a", "pcm_s24le", "-ar", "48000",
      pathArgument(outputPath, "silent audio output"),
    ],
    expectedOutputs: [outputPath],
    description: "Create an exact-duration 48 kHz stereo silent master",
    licensingWarnings: [],
  };
}

function videoCodecArguments(options: DeliveryOptions): { args: string[]; warnings: string[] } {
  const pixelFormat = options.pixelFormat ?? "yuv420p";
  switch (options.codec) {
    case "h264_nvenc":
      return { args: ["-c:v", "h264_nvenc", "-preset", "p7", "-tune", "hq", "-rc", "vbr", "-cq", String(quality(options.quality, 19)), "-b:v", bitrate(options.bitrate, "12M"), "-pix_fmt", pixelFormat], warnings: ["Requires a compatible NVIDIA driver and GPU; probe h264_nvenc before rendering."] };
    case "h264_mf":
      return { args: ["-c:v", "h264_mf", "-rate_control", "quality", "-quality", String(mediaFoundationQuality(options.quality)), "-b:v", bitrate(options.bitrate, "12M"), "-pix_fmt", pixelFormat], warnings: ["Windows Media Foundation output is platform-specific; verify the encoder is present."] };
    case "libx264":
      return { args: ["-c:v", "libx264", "-preset", "slow", "-crf", String(quality(options.quality, 18)), "-pix_fmt", pixelFormat], warnings: ["libx264 is GPL. Use only through the separately installed signed GPL runtime pack; never bundle it in the MIT core."] };
    case "hevc_nvenc":
      return { args: ["-c:v", "hevc_nvenc", "-preset", "p7", "-tune", "hq", "-rc", "vbr", "-cq", String(quality(options.quality, 21)), "-b:v", bitrate(options.bitrate, "10M"), "-pix_fmt", pixelFormat], warnings: ["HEVC playback and patent licensing vary by destination; verify before distribution."] };
    case "vp9":
      return { args: ["-c:v", "libvpx-vp9", "-crf", String(quality(options.quality, 24)), "-b:v", options.bitrate ? bitrate(options.bitrate, "0") : "0", "-pix_fmt", pixelFormat], warnings: [] };
    case "av1":
      return { args: ["-c:v", "libsvtav1", "-preset", "6", "-crf", String(quality(options.quality, 24)), "-pix_fmt", pixelFormat], warnings: ["AV1 software encoding can be slow; estimates must use the active power profile and current machine load."] };
  }
}

export function planDeliveryEncode(videoPath: string, audioPath: string | undefined, outputPath: string, options: DeliveryOptions): CommandPlan {
  const codec = videoCodecArguments(options);
  const audioBitrate = bitrate(options.audioBitrate, "192k");
  const args = ["-hide_banner", "-nostdin", "-y", "-i", pathArgument(videoPath, "video input")];
  if (audioPath) args.push("-i", pathArgument(audioPath, "audio input"));
  if (options.captionPath) args.push("-i", pathArgument(options.captionPath, "caption input"));
  args.push("-map", "0:v:0");
  const webm = /\.(?:webm|mkv)$/i.test(outputPath);
  if (audioPath) args.push("-map", "1:a:0", "-c:a", webm ? "libopus" : "aac", "-b:a", audioBitrate, "-ar", "48000");
  else args.push("-an");
  if (options.captionPath) {
    const captionInput = audioPath ? 2 : 1;
    args.push("-map", `${captionInput}:s:0`, "-c:s", webm ? "webvtt" : "mov_text", "-metadata:s:s:0", "language=eng");
  }
  args.push(...codec.args, "-color_primaries", "bt709", "-color_trc", "iec61966-2-1", "-colorspace", "bt709");
  args.push("-map_metadata", "-1", "-fflags", "+bitexact", "-flags:v", "+bitexact");
  if (audioPath) args.push("-flags:a", "+bitexact");
  if ((options.fastStart ?? true) && /\.(?:mp4|mov|m4v)$/i.test(outputPath)) args.push("-movflags", "+faststart");
  args.push(pathArgument(outputPath, "delivery output"));
  return {
    executable: "ffmpeg",
    args,
    expectedOutputs: [outputPath],
    description: `Encode delivery media with ${options.codec}`,
    licensingWarnings: codec.warnings,
  };
}

export function parseFfmpegCapabilities(versionOutput: string, encodersOutput: string): FfmpegCapabilities {
  const firstLine = versionOutput.split(/\r?\n/, 1)[0] ?? "unknown";
  const configuration = versionOutput.match(/^configuration:\s*(.+)$/m)?.[1] ?? "";
  const encoders = new Set<string>();
  for (const line of encodersOutput.split(/\r?\n/)) {
    const match = line.match(/^\s*[VAS.].....\s+([a-zA-Z0-9_]+)\s/);
    if (match?.[1]) encoders.add(match[1]);
  }
  return {
    version: firstLine,
    configuration,
    encoders,
    isGpl: configuration.includes("--enable-gpl"),
    isNonfree: configuration.includes("--enable-nonfree"),
  };
}

export function ffmpegDistributionWarnings(capabilities: FfmpegCapabilities): readonly string[] {
  const warnings: string[] = [];
  if (capabilities.isGpl) warnings.push("This FFmpeg build enables GPL components and must not be bundled with the MIT application core without a separate licensing review/runtime-pack boundary.");
  if (capabilities.isNonfree) warnings.push("This FFmpeg build is marked nonfree and is not redistributable under FFmpeg's standard terms.");
  if (!capabilities.configuration) warnings.push("FFmpeg build configuration is unknown; block redistribution until provenance and license flags are verified.");
  return warnings;
}
