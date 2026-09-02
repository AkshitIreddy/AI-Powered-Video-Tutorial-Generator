#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { ROOT, commandForPnpm } from "./lib/shared.mjs";

const checkOnly = process.argv.slice(2).includes("--check");
const developmentPort = 1438;
const workerName = process.platform === "win32" ? "alystria-pipeline.exe" : "alystria-pipeline";
const candidates = [
  process.env.ALYSTRIA_PIPELINE_WORKER,
  resolve(
    ROOT,
    "services/pipeline/.venv",
    process.platform === "win32" ? "Scripts" : "bin",
    workerName
  ),
  resolve(ROOT, "artifacts/windows-sidecar", workerName),
  resolve(ROOT, "dist/runtime-packs/pipeline/current", workerName)
].filter(Boolean);

const worker = candidates.find((candidate) => existsSync(candidate));
if (!worker) {
  console.error("FAIL  Alystria's local pipeline worker is unavailable.");
  console.error("Run the pinned setup command first: corepack pnpm setup");
  if (process.platform === "win32") {
    console.error("A packaged development worker can also be built with scripts\\build-windows-sidecar.ps1.");
  }
  process.exit(1);
}

const pnpm = commandForPnpm();
if (!pnpm) {
  console.error("FAIL  pnpm is unavailable. Enable Corepack and install the version in package.json.");
  process.exit(1);
}

const resolvedWorker = realpathSync(worker);
console.log(`PASS  pipeline worker ${resolvedWorker}`);
const portAvailable = await new Promise((resolvePort) => {
  const socket = createConnection({ host: "127.0.0.1", port: developmentPort });
  let settled = false;
  const finish = (available) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    resolvePort(available);
  };
  socket.setTimeout(500);
  socket.once("connect", () => finish(false));
  socket.once("timeout", () => finish(false));
  socket.once("error", (error) => finish(error.code === "ECONNREFUSED"));
});
if (!portAvailable) {
  console.error(`FAIL  Alystria development port ${developmentPort} is already in use or unavailable.`);
  console.error("No process was stopped. Close the owning app or choose a coordinated Alystria port before launch.");
  process.exit(1);
}
console.log(`PASS  development port ${developmentPort} is available`);
if (checkOnly) {
  console.log("PASS  native development launch is ready");
  process.exit(0);
}

const child = spawn(
  pnpm.command,
  [...(pnpm.prefix ?? []), "--filter", "@alystria/desktop", "tauri", "dev"],
  {
    cwd: ROOT,
    env: { ...process.env, ALYSTRIA_PIPELINE_WORKER: resolvedWorker },
    shell: false,
    stdio: "inherit",
    windowsHide: true
  }
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.once("error", (error) => {
  console.error(`FAIL  native development launch failed: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
