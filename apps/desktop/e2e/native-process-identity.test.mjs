import assert from "node:assert/strict";
import test from "node:test";

import {
  ProcessIdentitySnapshotError,
  reconcileOwnedWorkerProcessSnapshots,
  verifyIncompleteProcessRows,
} from "./native-process-identity.mjs";

const workerPath = "C:\\Sandbox\\Runtime\\alystria-pipeline.exe";
test("verify enumerated incomplete children without chasing newer children or reused PIDs", () => {
  const weak = { pid: 20, parentPid: 10, creationDate: "time-a", executablePath: "" };
  const strong = { ...weak, executablePath: "C:\\Runtime\\chrome.exe" };
  const newer = { ...strong, pid: 21 };
  const normalize = (value) => value.toLowerCase();
  assert.deepEqual(verifyIncompleteProcessRows([weak], [strong, newer], normalize).rows, [strong]);
  const exited = verifyIncompleteProcessRows([weak], [newer], normalize);
  assert.deepEqual(exited.rows, []);
  assert.deepEqual(exited.diagnostics.exitedPids, [20]);
  const reused = verifyIncompleteProcessRows([weak], [{ ...strong, creationDate: "time-b" }], normalize);
  assert.deepEqual(reused.rows, [weak]);
  assert.deepEqual(reused.diagnostics.unresolvedPids, [20]);
});
const normalizePath = (value) => typeof value === "string"
  ? value.replaceAll("/", "\\").toLowerCase()
  : "";

function process(pid, parentPid, creationDate, executablePath) {
  return { pid, parentPid, creationDate, executablePath };
}

function baseSnapshot(extra = []) {
  return [
    process(10, 1, "2026-09-08T01:00:00.000Z", workerPath),
    process(11, 10, "2026-09-08T01:00:01.000Z", workerPath),
    ...extra,
  ];
}

function reconcile(first, second) {
  return reconcileOwnedWorkerProcessSnapshots({
    first,
    second,
    workerPath,
    desktopPid: 1,
    readyPid: 11,
    normalizePath,
    firstCapturedAtUtc: "2026-09-08T01:01:00.000Z",
    secondCapturedAtUtc: "2026-09-08T01:01:00.075Z",
  });
}

test("an incomplete descendant that exits before the verification snapshot is recorded and excluded", () => {
  const weak = process(12, 11, null, "C:\\Windows\\System32\\conhost.exe");
  const result = reconcile(baseSnapshot([weak]), baseSnapshot());

  assert.deepEqual(result.processTree.map((entry) => entry.pid), [10, 11]);
  assert.deepEqual(result.diagnostics.weakFirstDescendantsExited, [{
    pid: 12,
    parentPid: 11,
    missing: ["creationDate"],
  }]);
});

test("an incomplete first row is retained only after the second snapshot supplies a strong owned identity", () => {
  const weak = process(12, 11, null, "C:\\Renderer\\node.exe");
  const verified = process(12, 11, "2026-09-08T01:00:02.000Z", "C:\\Renderer\\node.exe");
  const result = reconcile(baseSnapshot([weak]), baseSnapshot([verified]));

  assert.deepEqual(result.processTree.map((entry) => entry.pid), [10, 11, 12]);
  assert.equal(result.processTree[2].creationDate, verified.creationDate);
  assert.deepEqual(result.diagnostics.weakFirstDescendantsResolved, [{
    pid: 12,
    parentPid: 11,
    missingInFirst: ["creationDate"],
  }]);
});

test("a descendant that remains incomplete fails closed with its exact PID", () => {
  const weak = process(12, 11, null, "C:\\Renderer\\node.exe");
  assert.throws(
    () => reconcile(baseSnapshot([weak]), baseSnapshot([weak])),
    (error) => {
      assert.ok(error instanceof ProcessIdentitySnapshotError);
      assert.match(error.message, /descendant 12 remained without a strong/i);
      assert.equal(error.diagnostics.failure.phase, "weak-first-unresolved");
      assert.deepEqual(error.diagnostics.failure.missing, ["creationDate"]);
      return true;
    },
  );
});

test("a strong PID identity change between snapshots fails closed", () => {
  const firstChild = process(12, 11, "2026-09-08T01:00:02.000Z", "C:\\Renderer\\node.exe");
  const replacement = process(12, 11, "2026-09-08T01:00:03.000Z", "C:\\Renderer\\node.exe");
  assert.throws(
    () => reconcile(baseSnapshot([firstChild]), baseSnapshot([replacement])),
    (error) => {
      assert.ok(error instanceof ProcessIdentitySnapshotError);
      assert.match(error.message, /PID 12 changed strong process identity/i);
      assert.equal(error.diagnostics.failure.phase, "strong-identity-conflict");
      return true;
    },
  );
});

test("a newly observed descendant must have a strong identity", () => {
  const newWeakChild = process(13, 11, null, "C:\\Renderer\\node.exe");
  assert.throws(
    () => reconcile(baseSnapshot(), baseSnapshot([newWeakChild])),
    (error) => {
      assert.ok(error instanceof ProcessIdentitySnapshotError);
      assert.match(error.message, /new owned worker descendant 13 lacked a strong/i);
      assert.equal(error.diagnostics.failure.phase, "new-second-incomplete");
      return true;
    },
  );
});

test("a newly spawned strongly identified descendant is included", () => {
  const newChild = process(13, 11, "2026-09-08T01:00:03.000Z", "C:\\Renderer\\node.exe");
  const result = reconcile(baseSnapshot(), baseSnapshot([newChild]));

  assert.deepEqual(result.processTree.map((entry) => entry.pid), [10, 11, 13]);
  assert.deepEqual(result.diagnostics.strongSecondDescendantsAdded, [13]);
});

test("a weak first row cannot resolve against conflicting known creation data", () => {
  const partial = process(12, 11, "2026-09-08T01:00:02.000Z", null);
  const replacement = process(12, 11, "2026-09-08T01:00:03.000Z", "C:\\Renderer\\node.exe");
  assert.throws(
    () => reconcile(baseSnapshot([partial]), baseSnapshot([replacement])),
    (error) => {
      assert.ok(error instanceof ProcessIdentitySnapshotError);
      assert.equal(error.diagnostics.failure.phase, "weak-first-partial-conflict");
      assert.equal(error.diagnostics.failure.conflict, "creationDate");
      return true;
    },
  );
});

test("a strong first identity rejects conflicting partial data in the second snapshot", () => {
  const firstChild = process(12, 11, "2026-09-08T01:00:02.000Z", "C:\\Renderer\\node.exe");
  const incompleteReplacement = process(12, 11, "2026-09-08T01:00:03.000Z", null);
  assert.throws(
    () => reconcile(baseSnapshot([firstChild]), baseSnapshot([incompleteReplacement])),
    (error) => {
      assert.ok(error instanceof ProcessIdentitySnapshotError);
      assert.equal(error.diagnostics.failure.phase, "strong-first-partial-conflict");
      assert.equal(error.diagnostics.failure.conflict, "creationDate");
      return true;
    },
  );
});

test("post-exit mode detects a worker tree that appears only in the verification snapshot", () => {
  const result = reconcileOwnedWorkerProcessSnapshots({
    first: [],
    second: baseSnapshot([process(13, 11, "2026-09-08T01:00:03.000Z", "C:\\Renderer\\node.exe")]),
    workerPath,
    desktopPid: 1,
    readyPid: null,
    normalizePath,
    allowNoWorkers: true,
  });

  assert.deepEqual(result.processTree.map((entry) => entry.pid), [10, 11, 13]);
  assert.deepEqual(result.diagnostics.firstWorkerRootPids, []);
  assert.deepEqual(result.diagnostics.secondWorkerRootPids, [10]);
});

test("post-exit mode returns an empty verified tree when neither snapshot has an owned worker", () => {
  const result = reconcileOwnedWorkerProcessSnapshots({
    first: [],
    second: [],
    workerPath,
    desktopPid: 1,
    readyPid: null,
    normalizePath,
    allowNoWorkers: true,
  });

  assert.deepEqual(result.processTree, []);
});

test("the readiness worker must have a strong identity in the first snapshot", () => {
  const first = baseSnapshot();
  first[1] = process(11, 10, null, workerPath);
  assert.throws(
    () => reconcile(first, baseSnapshot()),
    (error) => {
      assert.ok(error instanceof ProcessIdentitySnapshotError);
      assert.match(error.message, /Ready worker 11 has no strong/i);
      assert.equal(error.diagnostics.failure.phase, "first-ready");
      return true;
    },
  );
});
