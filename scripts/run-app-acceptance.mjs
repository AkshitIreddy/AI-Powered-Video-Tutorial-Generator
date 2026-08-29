#!/usr/bin/env node

import process from "node:process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { ROOT, commandForPnpm, commandForPython, parseFlags, redact, run } from "./lib/shared.mjs";

const { flags } = parseFlags(process.argv.slice(2));
const protocolOnly = flags.has("protocol-only");
const uiOnly = flags.has("ui-only");
const skipBuild = flags.has("skip-build");

if (protocolOnly && uiOnly) {
  console.error("Choose at most one of --protocol-only and --ui-only.");
  process.exit(2);
}

const checks = [];

if (!uiOnly) {
  const venvPython = process.platform === "win32"
    ? resolve(ROOT, "services/pipeline/.venv/Scripts/python.exe")
    : resolve(ROOT, "services/pipeline/.venv/bin/python");
  const python = existsSync(venvPython)
    ? { command: venvPython, prefix: [] }
    : commandForPython();
  if (!python) fail("sidecar lifecycle", "Python 3.12 and the pipeline test environment are unavailable.");
  execute(
    "sidecar lifecycle",
    python.command,
    [
      ...(python.prefix ?? []),
      "-m",
      "pytest",
      "services/pipeline/tests/integration/test_desktop_worker.py::test_acceptance_desktop_worker_creates_approves_generates_and_exports",
      "-q",
    ],
  );
}

if (!protocolOnly) {
  const pnpm = commandForPnpm();
  if (!pnpm) fail("app UI lifecycle", "The pinned pnpm toolchain is unavailable.");
  if (!skipBuild) {
    execute(
      "desktop production build",
      pnpm.command,
      [...(pnpm.prefix ?? []), "--filter", "@alystria/desktop", "build"],
    );
  }
  execute(
    "Playwright app lifecycle",
    pnpm.command,
    [
      ...(pnpm.prefix ?? []),
      "--filter",
      "@alystria/desktop",
      "exec",
      "playwright",
      "test",
      "e2e/acceptance.spec.ts",
      "--project",
      "desktop",
    ],
  );
}

console.log(`PASS  Alystria app acceptance (${checks.join(", ")})`);

function execute(label, command, args) {
  console.log(`RUN   ${label}`);
  const result = run(command, args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(redact(result.stderr));
  if (!result.ok) {
    console.error(`FAIL  ${label} exited with ${result.status ?? "an unknown status"}.`);
    process.exit(result.status ?? 1);
  }
  checks.push(label);
}

function fail(label, message) {
  console.error(`FAIL  ${label}: ${message}`);
  process.exit(1);
}
