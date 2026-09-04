import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpawnCommandRunner } from "../src/executor.js";
import { planPresenterComposite } from "../src/ffmpeg.js";
import { fixtureTarget } from "../src/fixture.js";
import { secondsToTicks } from "../src/timebase.js";

const ffmpeg = process.env.ALYSTRIA_TEST_FFMPEG_PATH;
const ffprobe = process.env.ALYSTRIA_TEST_FFPROBE_PATH;

test("real FFmpeg presenter composite produces decodable pixels", { skip: !(ffmpeg && ffprobe), timeout: 120_000 }, async () => {
  const requestedOutput = process.env.ALYSTRIA_TEST_PRESENTER_OUTPUT;
  const directory = requestedOutput ?? await mkdtemp(join(tmpdir(), "alystria-presenter-pixels-"));
  const runner = new SpawnCommandRunner();
  const run = async (executable: string, args: readonly string[]) => {
    const result = await runner.run(executable, args, { cwd: directory });
    assert.equal(result.exitCode, 0, result.stderr);
    return result;
  };
  try {
    const base = join(directory, "base.mkv");
    const presenter = join(directory, "presenter.mkv");
    const composite = join(directory, "composite.mkv");
    const before = join(directory, "background-before.png");
    const frame = join(directory, "presenter-frame.png");
    const after = join(directory, "background-after.png");
    await run(ffmpeg!, ["-hide_banner", "-nostdin", "-y", "-f", "lavfi", "-i", "color=c=0xf7f8fc:s=640x360:r=10:d=2", "-an", "-c:v", "ffv1", "-pix_fmt", "gbrp10le", base]);
    await run(ffmpeg!, ["-hide_banner", "-nostdin", "-y", "-f", "lavfi", "-i", "testsrc2=s=240x320:r=10:d=2", "-an", "-c:v", "ffv1", presenter]);
    const plan = planPresenterComposite(base, [{
      id: "real-fixture",
      path: presenter,
      sha256: "0".repeat(64),
      sceneId: "presenter",
      sourceStartTick: 0,
      timelineStartTick: secondsToTicks(0.5),
      durationTicks: secondsToTicks(1),
      placement: "picture-in-picture",
      fit: "cover",
      motionProfile: "native-idle",
      x: 420,
      y: 48,
      width: 192,
      height: 188,
    }], composite, fixtureTarget({ width: 640, height: 360, frameRate: { numerator: 10, denominator: 1 } }));
    await run(ffmpeg!, plan.args);
    const probe = await run(ffprobe!, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name", "-of", "json", composite]);
    const document = JSON.parse(probe.stdout) as { streams?: Array<{ width?: number; height?: number; codec_name?: string }> };
    assert.deepEqual(document.streams?.[0], { codec_name: "ffv1", width: 640, height: 360 });
    await run(ffmpeg!, ["-hide_banner", "-nostdin", "-y", "-ss", "0.2", "-i", composite, "-frames:v", "1", before]);
    await run(ffmpeg!, ["-hide_banner", "-nostdin", "-y", "-ss", "0.8", "-i", composite, "-frames:v", "1", frame]);
    await run(ffmpeg!, ["-hide_banner", "-nostdin", "-y", "-ss", "1.8", "-i", composite, "-frames:v", "1", after]);
    const pixels = await readFile(frame);
    const beforePixels = await readFile(before);
    const afterPixels = await readFile(after);
    assert.ok(pixels.length > 1_000);
    assert.deepEqual([...pixels.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    assert.equal(digest(beforePixels), digest(afterPixels), "background pixels must return after the timed presenter layer");
    assert.notEqual(digest(beforePixels), digest(pixels), "presenter pixels must exist only inside the scheduled interval");
  } finally {
    if (requestedOutput === undefined) await rm(directory, { recursive: true, force: true });
  }
});
