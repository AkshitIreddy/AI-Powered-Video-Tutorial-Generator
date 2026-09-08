import { readFile } from "node:fs/promises";

export class CooperativeStopRequested extends Error {
  constructor(request) {
    super(`Native acceptance stop requested by ${request.source}`);
    this.name = "CooperativeStopRequested";
    this.request = request;
  }
}

export function createStopRequestCoordinator({
  requestPath,
  onStop,
  pollIntervalMs = 100,
  signals = ["SIGINT", "SIGTERM", "SIGBREAK"],
}) {
  if (!requestPath) throw new Error("A stop-request path is required");
  if (typeof onStop !== "function") throw new TypeError("A stop handler is required");

  let timer = null;
  let request = null;
  let stopPromise = null;
  let stopError = null;
  const signalHandlers = new Map();

  const begin = (candidate) => {
    if (stopPromise) return stopPromise;
    request = normalizeStopRequest(candidate);
    stopPromise = Promise.resolve().then(() => onStop(request));
    // Signals and the file watcher cannot await in their callbacks. Attach an
    // observer immediately so a receipt/write failure is retained for the
    // harness finalizer instead of becoming an unhandled rejection.
    void stopPromise.catch((error) => { stopError = error; });
    return stopPromise;
  };

  const poll = async () => {
    if (stopPromise) return;
    try {
      const parsed = JSON.parse(await readFile(requestPath, "utf8"));
      if (parsed?.schemaVersion !== 1) return;
      void begin({
        source: "stop-request-file",
        reason: typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim()
          : "requested",
        requestedAtUtc: typeof parsed.requestedAtUtc === "string" ? parsed.requestedAtUtc : null,
      });
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) {
        void begin({ source: "stop-request-watch-error", reason: String(error), requestedAtUtc: null });
      }
    }
  };

  const start = () => {
    if (timer) return;
    for (const signal of signals) {
      const handler = () => {
        void begin({ source: "signal", signal, reason: signal, requestedAtUtc: new Date().toISOString() });
      };
      try {
        process.on(signal, handler);
        signalHandlers.set(signal, handler);
      } catch {
        // Some Node/host combinations do not expose every Windows signal.
      }
    }
    timer = setInterval(() => { void poll(); }, pollIntervalMs);
    timer.unref?.();
    void poll();
  };

  const dispose = () => {
    if (timer) clearInterval(timer);
    timer = null;
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    signalHandlers.clear();
  };

  return {
    start,
    dispose,
    requestStop: begin,
    get request() { return request; },
    get stopPromise() { return stopPromise; },
    get stopError() { return stopError; },
    throwIfRequested() {
      if (request) throw new CooperativeStopRequested(request);
    },
  };
}

export async function runCooperativeNativeStop({
  request,
  activeJob,
  initialProblems = [],
  cancelActiveJob,
  waitForActiveJobTerminal,
  snapshotOwnedProcessTree,
  requestDesktopClose,
  waitForDesktopExit,
  forceStopDesktop,
  waitForOwnedProcessTreeExit,
  forceStopOwnedProcessTree,
  writeReceipt,
  now = () => new Date(),
}) {
  const startedAt = now();
  const problems = [...initialProblems];
  let cancellation = null;
  let processTree = [];
  let desktopExit = null;
  let workerExit = null;
  let fallback = null;

  // Capture ownership while the desktop -> worker -> renderer ancestry still
  // exists. Cooperative cancellation may legitimately make one of these
  // processes exit before shutdown reaches its cleanup phase.
  try {
    processTree = await snapshotOwnedProcessTree();
  } catch (error) {
    problems.push(`Worker process-tree snapshot failed: ${errorMessage(error)}`);
  }

  if (activeJob) {
    try {
      const requested = await cancelActiveJob(activeJob);
      const terminal = await waitForActiveJobTerminal(activeJob);
      cancellation = { requested, terminal };
    } catch (error) {
      problems.push(`Active-job cancellation failed: ${errorMessage(error)}`);
    }
  }

  try {
    await requestDesktopClose();
    desktopExit = await waitForDesktopExit();
  } catch (error) {
    problems.push(`Desktop close failed: ${errorMessage(error)}`);
    try {
      desktopExit = await forceStopDesktop();
      fallback = { ...(fallback ?? {}), desktop: true };
    } catch (fallbackError) {
      problems.push(`Exact desktop fallback failed: ${errorMessage(fallbackError)}`);
    }
  }

  try {
    workerExit = await waitForOwnedProcessTreeExit(processTree);
    if (workerExit.remaining.length > 0) {
      const forced = await forceStopOwnedProcessTree(workerExit.remaining);
      fallback = { ...(fallback ?? {}), ownedProcessTree: forced };
      workerExit = await waitForOwnedProcessTreeExit(processTree);
      if (workerExit.remaining.length > 0) {
        problems.push(`Identity-bound worker processes remained after fallback: ${JSON.stringify(workerExit.remaining)}`);
      }
    }
  } catch (error) {
    problems.push(`Worker process-tree cleanup failed: ${errorMessage(error)}`);
  }

  const receipt = {
    schemaVersion: 1,
    state: problems.length === 0 ? "stopped" : "stopped-with-problems",
    request,
    startedAtUtc: startedAt.toISOString(),
    finishedAtUtc: now().toISOString(),
    activeJob,
    cancellation,
    desktopExit,
    workerProcessTree: processTree,
    workerExit,
    fallback,
    problems,
  };
  await writeReceipt(receipt);
  return receipt;
}

function normalizeStopRequest(candidate) {
  return {
    source: candidate?.source || "programmatic",
    reason: candidate?.reason || "requested",
    signal: candidate?.signal || null,
    requestedAtUtc: candidate?.requestedAtUtc || null,
    observedAtUtc: new Date().toISOString(),
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
