import assert from "node:assert/strict";
import test from "node:test";

import { canTolerateWmCloseHelperFailure, waitForSpawnExit } from "./native-process-lifecycle.mjs";

test("WM_CLOSE helper failure is tolerated only after a clean desktop and worker exit", () => {
  assert.equal(canTolerateWmCloseHelperFailure({ desktopExitCode: 0, workerExited: true }), true);
  assert.equal(canTolerateWmCloseHelperFailure({ desktopExitCode: null, workerExited: true }), false);
  assert.equal(canTolerateWmCloseHelperFailure({ desktopExitCode: 1, workerExited: true }), false);
  assert.equal(canTolerateWmCloseHelperFailure({ desktopExitCode: 0, workerExited: false }), false);
});

test("spawn exit wait observes an exit that races the WM_CLOSE helper", async () => {
  const child = { exitCode: null };
  setTimeout(() => { child.exitCode = 0; }, 5);
  assert.equal(await waitForSpawnExit(child, 200, 5), true);
  assert.equal(child.exitCode, 0);
});

test("spawn exit wait remains bounded when a process is still alive", async () => {
  const child = { exitCode: null };
  assert.equal(await waitForSpawnExit(child, 15, 5), false);
});
