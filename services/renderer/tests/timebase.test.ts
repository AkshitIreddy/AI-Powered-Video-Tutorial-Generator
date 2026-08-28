import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIO_SAMPLE_RATE,
  FRAME_RATES,
  TICKS_PER_AUDIO_SAMPLE,
  TICKS_PER_SECOND,
  audioSampleToTick,
  frameToTick,
  tickToAudioSample,
  tickToFrameCeil,
  tickToFrameFloor,
  ticksPerFrame,
} from "../src/timebase.js";

test("240 kHz timebase exactly represents launch frame rates", () => {
  assert.equal(TICKS_PER_SECOND, 240_000);
  assert.equal(AUDIO_SAMPLE_RATE, 48_000);
  assert.equal(TICKS_PER_AUDIO_SAMPLE, 5);
  assert.deepEqual(Object.values(FRAME_RATES).map(ticksPerFrame), [10_000, 9_600, 10_010, 8_008, 4_004, 8_000, 4_800, 4_000]);
});

test("frame and tick boundaries round deliberately", () => {
  assert.equal(frameToTick(30, FRAME_RATES.thirty), TICKS_PER_SECOND);
  assert.equal(tickToFrameFloor(239_999, FRAME_RATES.thirty), 29);
  assert.equal(tickToFrameCeil(239_999, FRAME_RATES.thirty), 30);
  assert.equal(tickToFrameFloor(240_000, FRAME_RATES.thirty), 30);
});

test("48 kHz sample conversion is lossless", () => {
  const sample = 1_234_567;
  assert.equal(tickToAudioSample(audioSampleToTick(sample)), sample);
  assert.throws(() => tickToAudioSample(6), /not aligned/);
});

test("unrepresentable frame rates fail instead of drifting", () => {
  assert.throws(() => ticksPerFrame({ numerator: 29, denominator: 1 }), /cannot be represented exactly/);
});
