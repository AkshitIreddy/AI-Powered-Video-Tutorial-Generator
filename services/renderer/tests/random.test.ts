import test from "node:test";
import assert from "node:assert/strict";
import { NondeterminismError, SeededRandom, withDeterminismGuard } from "../src/random.js";

test("seeded PRNG is repeatable and forkable", () => {
  const first = new SeededRandom("alystria");
  const second = new SeededRandom("alystria");
  assert.deepEqual(Array.from({ length: 16 }, () => first.nextUint32()), Array.from({ length: 16 }, () => second.nextUint32()));
  assert.notDeepEqual(Array.from({ length: 4 }, () => first.fork("a").next()), Array.from({ length: 4 }, () => first.fork("b").next()));
});

test("determinism guard traps global randomness and restores it", () => {
  const original = Math.random;
  assert.throws(() => withDeterminismGuard(() => Math.random()), NondeterminismError);
  assert.equal(Math.random, original);
  assert.throws(() => withDeterminismGuard(() => Date.now()), /Date.now/);
  assert.throws(() => withDeterminismGuard(() => new Date()), /new Date/);
  assert.throws(() => withDeterminismGuard(() => crypto.randomUUID()), /crypto.randomUUID/);
  assert.equal(new Date(0).getTime(), 0);
});
