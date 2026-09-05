import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

import { preflightScene, TIMEBASE_TICKS_PER_SECOND } from "../packages/scenes/dist/index.js";
import { executeRender } from "../services/renderer/dist/src/executor.js";
import { FrameRenderer } from "../services/renderer/dist/src/runtime.js";

const outputDirectory = resolve(process.argv[2] ?? "E:/temp/avt-audit-2026-09-05/teaching-proof");
const ffmpeg = process.env.ALYSTRIA_FFMPEG_PATH ?? "ffmpeg";
const ffprobe = process.env.ALYSTRIA_FFPROBE_PATH ?? "ffprobe";
const browser = process.env.ALYSTRIA_CHROMIUM_PATH;
const python = process.env.ALYSTRIA_PYTHON_PATH ?? "python";
const second = TIMEBASE_TICKS_PER_SECOND;
const fps = 24;
const target = Object.freeze({ name: "landscape", width: 960, height: 540, pixelRatio: 1, frameRate: { numerator: fps, denominator: 1 }, colorSpace: "srgb-rec709" });

const values = Object.freeze([2, 5, 8, 11, 14, 17, 20, 23, 26]);
function binarySearchTrace(items, targetValue) {
  let low = 0;
  let high = items.length - 1;
  const steps = [];
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const value = items[middle];
    steps.push({ low, middle, high, value, relation: value === targetValue ? "=" : value < targetValue ? "<" : ">" });
    if (value === targetValue) return { index: middle, steps };
    if (value < targetValue) low = middle + 1;
    else high = middle - 1;
  }
  return { index: -1, steps, finalLow: low, finalHigh: high };
}

const found = binarySearchTrace(values, 23);
const missing = binarySearchTrace(values, 15);
assert.equal(found.index, 7);
assert.equal(missing.index, -1);
assert.deepEqual(found.steps.map(({ middle, value }) => [middle, value]), [[4, 14], [6, 20], [7, 23]]);
assert.deepEqual(missing.steps.map(({ middle, value }) => [middle, value]), [[4, 14], [6, 20], [5, 17]]);
assert.ok(missing.finalLow > missing.finalHigh);

await mkdir(outputDirectory, { recursive: true });
const pythonSource = `import json

def binary_search(values, target):
    low, high = 0, len(values) - 1
    trace = []
    while low <= high:
        middle = (low + high) // 2
        value = values[middle]
        trace.append([low, middle, high, value])
        if value == target: return middle, trace
        if value < target: low = middle + 1
        else: high = middle - 1
    return -1, trace

values = [2, 5, 8, 11, 14, 17, 20, 23, 26]
found_index, found_trace = binary_search(values, 23)
missing_index, missing_trace = binary_search(values, 15)
assert found_index == 7
assert missing_index == -1
print(json.dumps({"foundIndex": found_index, "missingIndex": missing_index,
                  "foundTrace": found_trace, "missingTrace": missing_trace}))
`;
const pythonPath = join(outputDirectory, "validated-binary-search.py");
await writeFile(pythonPath, pythonSource, "utf8");
const pythonRun = spawnSync(python, [pythonPath], { encoding: "utf8", windowsHide: true });
if (pythonRun.status !== 0) throw new Error(`Python validation failed: ${pythonRun.stderr || pythonRun.stdout}`);
const pythonValidation = JSON.parse(pythonRun.stdout);
assert.equal(pythonValidation.foundIndex, found.index);
assert.equal(pythonValidation.missingIndex, missing.index);
assert.deepEqual(pythonValidation.foundTrace, found.steps.map(({ low, middle, high, value }) => [low, middle, high, value]));
assert.deepEqual(pythonValidation.missingTrace, missing.steps.map(({ low, middle, high, value }) => [low, middle, high, value]));

const codeLines = pythonSource.split("\n").slice(2, 13).map((text, index) => ({
  id: `binary.line.${index + 1}`,
  text,
  tokenClass: /^\s*(def|while|if|else|return)\b/u.test(text) ? "keyword" : /binary_search/u.test(text) ? "function" : "plain",
}));
const codeActions = codeLines.map((line, index) => ({
  id: `binary.type.${index + 1}`,
  type: "type",
  lineId: line.id,
  startTick: Math.round(second * (0.5 + index * 1.25)),
  endTick: Math.round(second * (1.45 + index * 1.25)),
  narrationAnchor: index === 0 ? "Define binary search" : index === 3 ? "Keep searching while the interval exists" : index === 4 ? "Read the middle value" : undefined,
}));
codeActions.push({ id: "binary.explain.return", type: "explain", lineId: "binary.line.11", startTick: second * 15, endTick: second * 16.5, narrationAnchor: "An empty interval proves the target is absent" });
codeActions.push({ id: "binary.run", type: "run", startTick: second * 16.5, endTick: second * 17.8, output: "PASS · found 7 · missing -1" });

const textItem = (id, text, emphasis = "none", supportingText) => ({ id, text, emphasis, ...(supportingText ? { supportingText } : {}) });
const makeSpec = (id, seconds, content, accessibilityDescription) => ({ id, content, durationTicks: seconds * second, seed: 7_301 + id.length, accessibilityDescription });
const traceFrames = (prefix, trace) => trace.steps.map((step, index) => ({
  id: `${prefix}.${index + 1}`,
  label: `Step ${index + 1}: values[${step.middle}] = ${step.value}`,
  line: step.relation === "=" ? 8 : step.relation === "<" ? 9 : 10,
  variables: { low: String(step.low), middle: String(step.middle), high: String(step.high), value: String(step.value), comparison: `${step.value} ${step.relation} ${prefix === "found" ? 23 : 15}` },
}));

const authoredScenes = [
  {
    spec: makeSpec("proof.binary.title", 8, { kind: "title", eyebrow: "ALGORITHMS · VERIFIED WALKTHROUGH", title: "Binary search keeps one promise", subtitle: "Trace the invariant, complete Python, and two tested outcomes", author: "AI Video Tutorial Generator", module: "Search · O(log n)" }, "Title card introducing a verified binary search lesson."),
    caption: "Binary search is fast because every comparison preserves one exact promise about where the target can still be.",
  },
  {
    spec: makeSpec("proof.binary.invariant", 8, { kind: "definition", title: "State the loop invariant before the code", term: "If the target exists, it is inside values[low : high + 1]", definition: "Before every comparison, every discarded index is already proven impossible. The remaining closed interval contains every candidate still consistent with sorted order.", example: "Start with low = 0 and high = 8. Stop with success at equality, or absence when low becomes greater than high." }, "The binary search invariant and the two valid stopping conditions."),
    caption: "At every loop entry, any possible target remains inside the closed interval from low through high.",
  },
  {
    spec: makeSpec("proof.binary.interval", 9, {
      kind: "diagram", title: "One comparison removes only impossible indices", direction: "left-to-right",
      nodes: [
        { id: "interval.all", label: "[0 … 8]", detail: "all 9 candidates", tone: "primary" },
        { id: "interval.mid", label: "mid = 4", detail: "values[4] = 14", tone: "warning" },
        { id: "interval.keep", label: "[5 … 8]", detail: "23 is larger", tone: "secondary" },
        { id: "interval.promise", label: "invariant holds", detail: "target stays possible", tone: "secondary" },
      ],
      edges: [
        { id: "interval.edge.1", from: "interval.all", to: "interval.mid" },
        { id: "interval.edge.2", from: "interval.mid", to: "interval.keep", style: "emphasis" },
        { id: "interval.edge.3", from: "interval.keep", to: "interval.promise" },
      ],
    }, "A concept diagram that narrows indices zero through eight to five through eight after comparing fourteen with twenty-three."),
    caption: "Fourteen is smaller than twenty-three, so sorted order proves that indices zero through four cannot contain the target.",
  },
  {
    spec: makeSpec("proof.binary.code", 18, { kind: "live-code", title: "Write the complete routine", filename: "binary_search.py", language: "python", lines: codeLines, actions: codeActions }, "The complete Python binary search routine, typed line by line and validated against found and missing targets."),
    caption: "The loop compares one middle value, returns on equality, moves exactly one boundary, and returns minus one only after the interval is empty.",
  },
  {
    spec: makeSpec("proof.binary.trace-found", 10, { kind: "execution-trace", title: "Trace target 23 to index 7", frames: traceFrames("found", found), activeFrame: found.steps.length - 1 }, "Three validated binary search states: fourteen, then twenty, then twenty-three at index seven."),
    caption: "The validated trace inspects fourteen at index four, twenty at index six, then finds twenty-three at index seven.",
  },
  {
    spec: makeSpec("proof.binary.trace-missing", 11, { kind: "execution-trace", title: "Missing target 15 empties the interval", frames: traceFrames("missing", missing), activeFrame: missing.steps.length - 1 }, "Three validated comparisons for missing target fifteen, ending with low greater than high."),
    caption: "For fifteen, compare fourteen, twenty, and seventeen. Then low is five and high is four, proving no candidate remains.",
  },
  {
    spec: makeSpec("proof.binary.validation", 10, { kind: "terminal", title: "Run the exact authored Python", filename: "Python 3.12 · local validation", lines: [
      { id: "validation.command", text: "> python validated-binary-search.py", tokenClass: "plain" },
      { id: "validation.data", text: "values = [2,5,8,11,14,17,20,23,26]", tokenClass: "number" },
      { id: "validation.found", text: `target 23 -> index ${pythonValidation.foundIndex} · trace 4,6,7`, tokenClass: "string" },
      { id: "validation.missing", text: `target 15 -> ${pythonValidation.missingIndex} · trace 4,6,5`, tokenClass: "string" },
      { id: "validation.pass", text: "PASS · JS trace = Python trace · 2 cases", tokenClass: "keyword", highlight: true },
    ] }, "Local Python validation output confirming a found target and a missing target against the same trace used by the lesson."),
    caption: "The exact Python routine passes both cases, and its state trace matches the independently computed proof data used on screen.",
  },
  {
    spec: makeSpec("proof.binary.recap", 10, { kind: "recap", title: "The reusable proof", items: [
      textItem("recap.sorted", "Sorted order proves discarded halves impossible", "primary"),
      textItem("recap.invariant", "If present, the target stays inside [low, high]", "secondary"),
      textItem("recap.stop", "Equality returns an index; an empty interval returns -1", "warning"),
      textItem("recap.cost", "Nine candidates need at most four comparisons", "none"),
    ] }, "Summary of binary search correctness, stopping conditions, and logarithmic work."),
    caption: "Binary search is correct because sorted order makes discarded indices impossible, and it is fast because the candidate interval halves.",
  },
];
const specs = authoredScenes.map(({ spec }) => spec);
const specsById = new Map(specs.map((spec) => [spec.id, spec]));
const captionById = new Map(authoredScenes.map(({ spec, caption }) => [spec.id, caption]));
const totalDurationSeconds = specs.reduce((total, spec) => total + spec.durationTicks / second, 0);
assert.ok(totalDurationSeconds >= 60, `Teaching proof must be at least 60 seconds, got ${totalDurationSeconds}`);

const speechScript = [
  "Add-Type -AssemblyName System.Speech",
  "$voice = [System.Speech.Synthesis.SpeechSynthesizer]::new()",
  "$voice.Rate = -1",
  "$voice.Volume = 92",
  "$voice.SetOutputToWaveFile($env:ALYSTRIA_PROOF_NARRATION_PATH)",
  "$voice.Speak($env:ALYSTRIA_PROOF_NARRATION_TEXT)",
  "$voice.Dispose()",
].join("; ");

const audioInputs = [];
const narrationTracks = [];
const narrationOverruns = [];
let narrationStartTick = 0;
for (const [index, { spec, caption }] of authoredScenes.entries()) {
  const narrationPath = join(outputDirectory, `binary-search-scene-${String(index + 1).padStart(2, "0")}-narration.wav`);
  const speech = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", speechScript], { env: { ...process.env, ALYSTRIA_PROOF_NARRATION_PATH: narrationPath, ALYSTRIA_PROOF_NARRATION_TEXT: caption }, encoding: "utf8", windowsHide: true });
  if (speech.status !== 0) throw new Error(`Windows narration synthesis failed for ${spec.id}: ${speech.stderr || speech.stdout}`);
  const narrationSha256 = createHash("sha256").update(await readFile(narrationPath)).digest("hex");
  const durationProbe = spawnSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", narrationPath], { encoding: "utf8", windowsHide: true });
  if (durationProbe.status !== 0) throw new Error(`Narration duration probe failed for ${spec.id}: ${durationProbe.stderr || durationProbe.stdout}`);
  const durationSeconds = Number(durationProbe.stdout.trim());
  const sceneDurationSeconds = spec.durationTicks / second;
  if (durationSeconds > sceneDurationSeconds) narrationOverruns.push({ sceneId: spec.id, durationSeconds, sceneDurationSeconds });
  audioInputs.push({ id: `${spec.id}.narration`, assetId: `${spec.id}.narration`, path: narrationPath, sha256: narrationSha256, mediaType: "audio/wav", role: "narration", startTick: narrationStartTick, gainDb: -2 });
  narrationTracks.push({ sceneId: spec.id, startTick: narrationStartTick, durationSeconds, path: narrationPath, sha256: narrationSha256 });
  narrationStartTick += spec.durationTicks;
}
assert.deepEqual(narrationOverruns, [], `Narration clips exceed their scenes: ${JSON.stringify(narrationOverruns)}`);

const scenes = specs.map((spec) => ({
  id: spec.id, kind: spec.content.kind, durationTicks: spec.durationTicks, seed: String(spec.seed), content: { title: spec.content.title, body: captionById.get(spec.id) },
  captions: [{ id: `${spec.id}.caption`, startTick: 120_000, endTick: spec.durationTicks - 120_000, text: captionById.get(spec.id), position: "bottom" }],
  accessibilityDescription: spec.accessibilityDescription,
}));
const manifest = {
  id: "authored-binary-search-teaching-proof", schemaVersion: 1, rendererVersion: "2.0.0-rc.0", target, scenes, outputDirectory,
  audioInputs,
  captionDeliveryMode: "sidecar",
  metadata: { locale: "en-US", fixture: "authored-binary-search-proof", disclosure: "Hand-authored deterministic renderer proof; not AI-generated tutorial output" },
};
await writeFile(join(outputDirectory, "binary-search-input-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const preflight = specs.map((spec) => {
  const result = preflightScene(spec, { width: target.width, height: target.height, fps, pixelRatio: target.pixelRatio });
  return { sceneId: spec.id, ok: result.ok, diagnostics: result.diagnostics };
});
const failed = preflight.filter((result) => !result.ok);
if (failed.length) throw new Error(`Authored scene preflight failed: ${JSON.stringify(failed)}`);

const frameRenderer = new FrameRenderer({ verifyRepeatability: true, sceneSpecResolver: (scene) => specsById.get(scene.id) });
const output = await executeRender({
  manifest, outputDirectory, outputName: "binary-search-teaching-proof.webm", executables: { ...(browser ? { browser } : {}), ffmpeg, ffprobe },
  concurrency: 3, maximumFramesPerChunk: 120, resume: false, keepFrameCache: true,
  delivery: { codec: "vp9", quality: 34, captionMode: "sidecar", captionLanguage: "en-US" }, dependencies: { frameRenderer },
});

const inspectionDirectory = join(outputDirectory, "binary-search-inspection-frames");
await mkdir(inspectionDirectory, { recursive: true });
const frameDirectory = join(outputDirectory, ".render-cache", output.renderKey, "frames");
const sceneStartFrame = new Map();
let frameCursor = 0;
for (const spec of specs) {
  sceneStartFrame.set(spec.id, frameCursor);
  frameCursor += spec.durationTicks / second * fps;
}
const requestedCheckpoints = [
  ["proof.binary.title", "promise", 3], ["proof.binary.invariant", "invariant", 4], ["proof.binary.interval", "discard-proof", 4],
  ["proof.binary.code", "loop", 5], ["proof.binary.code", "absent-return", 14.5], ["proof.binary.code", "validated-run", 17],
  ["proof.binary.trace-found", "found-trace", 5], ["proof.binary.trace-missing", "missing-trace", 5],
  ["proof.binary.validation", "two-case-pass", 4], ["proof.binary.recap", "proof-recap", 4],
];
const checkpoints = [];
for (const [sceneId, stage, localSecond] of requestedCheckpoints) {
  const frame = sceneStartFrame.get(sceneId) + localSecond * fps;
  const source = join(frameDirectory, `frame-${String(frame).padStart(8, "0")}.png`);
  const destination = join(inspectionDirectory, `${String(checkpoints.length + 1).padStart(2, "0")}-${stage}.png`);
  await copyFile(source, destination);
  checkpoints.push({ sceneId, stage, localSecond, frame, path: destination });
}

const summary = {
  proofKind: "authored-validated-binary-search", aiGeneratedTutorial: false, manifestId: manifest.id, totalDurationSeconds, target,
  sceneIds: specs.map((spec) => spec.id), validation: { values, found, missing, python: pythonValidation, pythonSourcePath: pythonPath }, narrationTracks,
  preflight, checkpoints, delivery: output.files.find((file) => file.kind === "delivery"), probe: output.probe, qaMetrics: output.qaMetrics,
  browser: output.browser, stageTimings: output.stageTimings, outputManifestPath: output.outputManifestPath,
};
await writeFile(join(outputDirectory, "binary-search-teaching-proof-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
