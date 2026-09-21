export function canTolerateWmCloseHelperFailure({ desktopExitCode, workerExited }) {
  return desktopExitCode === 0 && workerExited === true;
}

export async function waitForSpawnExit(child, timeoutMs, pollMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return true;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
  }
  return child.exitCode !== null;
}
