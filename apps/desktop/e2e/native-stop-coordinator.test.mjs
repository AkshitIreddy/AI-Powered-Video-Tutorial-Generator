import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createStopRequestCoordinator,
  runCooperativeNativeStop,
} from "./native-stop-coordinator.mjs";

test("a stop-request file starts the stop coordinator exactly once", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "alystria-stop-"));
  const requestPath = path.join(root, "stop.json");
  const observed = [];
  const coordinator = createStopRequestCoordinator({
    requestPath,
    pollIntervalMs: 10,
    signals: [],
    onStop: async (request) => { observed.push(request); },
  });
  coordinator.start();
  try {
    await writeFile(requestPath, JSON.stringify({
      schemaVersion: 1,
      reason: "owner requested pause",
      requestedAtUtc: "2026-09-08T00:00:00.000Z",
    }));
    await waitUntil(() => observed.length === 1);
    await coordinator.requestStop({ source: "programmatic", reason: "duplicate" });
    assert.equal(observed.length, 1);
    assert.equal(observed[0].source, "stop-request-file");
    assert.equal(observed[0].reason, "owner requested pause");
  } finally {
    coordinator.dispose();
  }
});

test("cooperative stop cancels before close and cleans only the captured identities", async () => {
  const calls = [];
  const identities = [
    { pid: 101, creationDate: "a", executablePath: "worker.exe" },
    { pid: 102, creationDate: "b", executablePath: "renderer.exe" },
  ];
  let exitCheck = 0;
  let written = null;
  const receipt = await runCooperativeNativeStop({
    request: { source: "stop-request-file", reason: "test" },
    activeJob: { jobId: "job.master", projectId: "project", projectDirectory: "C:\\project" },
    cancelActiveJob: async (job) => { calls.push(["cancel", job.jobId]); return { state: "RUNNING", cancelRequested: true }; },
    waitForActiveJobTerminal: async (job) => { calls.push(["terminal", job.jobId]); return { state: "CANCELLED" }; },
    snapshotOwnedProcessTree: async () => { calls.push(["snapshot"]); return identities; },
    requestDesktopClose: async () => { calls.push(["close"]); },
    waitForDesktopExit: async () => { calls.push(["desktop-exit"]); return { exitCode: 0 }; },
    forceStopDesktop: async () => assert.fail("desktop fallback was not expected"),
    waitForOwnedProcessTreeExit: async (expected) => {
      calls.push(["tree-exit", expected.map((item) => item.pid)]);
      exitCheck += 1;
      return { remaining: exitCheck === 1 ? [identities[1]] : [] };
    },
    forceStopOwnedProcessTree: async (remaining) => {
      calls.push(["tree-force", remaining.map((item) => item.pid)]);
      return remaining;
    },
    writeReceipt: async (value) => { written = value; },
  });

  assert.deepEqual(calls, [
    ["snapshot"],
    ["cancel", "job.master"],
    ["terminal", "job.master"],
    ["close"],
    ["desktop-exit"],
    ["tree-exit", [101, 102]],
    ["tree-force", [102]],
    ["tree-exit", [101, 102]],
  ]);
  assert.equal(receipt.state, "stopped");
  assert.deepEqual(receipt.fallback.ownedProcessTree, [identities[1]]);
  assert.equal(written, receipt);
});

test("stop cleanup continues after active-job resolution has already failed", async () => {
  const calls = [];
  const receipt = await runCooperativeNativeStop({
    request: { source: "signal", signal: "SIGINT" },
    activeJob: null,
    initialProblems: ["Active-job resolution failed: ambiguous jobs"],
    cancelActiveJob: async () => assert.fail("no job was safe to cancel"),
    waitForActiveJobTerminal: async () => assert.fail("no job was safe to wait for"),
    snapshotOwnedProcessTree: async () => { calls.push("snapshot"); return []; },
    requestDesktopClose: async () => { calls.push("close"); },
    waitForDesktopExit: async () => { calls.push("desktop-exit"); return { exitCode: 0 }; },
    forceStopDesktop: async () => assert.fail("desktop fallback was not expected"),
    waitForOwnedProcessTreeExit: async () => { calls.push("tree-exit"); return { remaining: [] }; },
    forceStopOwnedProcessTree: async () => assert.fail("worker fallback was not expected"),
    writeReceipt: async () => {},
  });

  assert.deepEqual(calls, ["snapshot", "close", "desktop-exit", "tree-exit"]);
  assert.deepEqual(receipt.problems, ["Active-job resolution failed: ambiguous jobs"]);
});

test("an unawaited asynchronously failing stop handler is observed and retained", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "alystria-stop-error-"));
  const coordinator = createStopRequestCoordinator({
    requestPath: path.join(root, "unused.json"),
    signals: [],
    onStop: async () => { throw new Error("receipt failed"); },
  });
  try {
    void coordinator.requestStop({ source: "programmatic" });
    await waitUntil(() => coordinator.stopError !== null);
    assert.match(coordinator.stopError.message, /receipt failed/u);
  } finally {
    coordinator.dispose();
  }
});

async function waitUntil(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(predicate(), "condition was not satisfied before the timeout");
}
