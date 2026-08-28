#!/usr/bin/env node

import { existsSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const requested = process.argv.slice(2);

if (requested.length === 0) {
  console.error("Usage: run-python.mjs <python arguments>");
  process.exit(2);
}

const configured = process.env.ALYSTRIA_PYTHON?.trim();
const candidates = [
  configured ? { command: configured, prefix: [] } : null,
  process.platform === "win32"
    ? { command: resolve(root, "services/pipeline/.venv/Scripts/python.exe"), prefix: [] }
    : { command: resolve(root, "services/pipeline/.venv/bin/python"), prefix: [] },
  process.platform === "win32" ? { command: "py", prefix: ["-3.12"] } : null,
  { command: "python3", prefix: [] },
  { command: "python", prefix: [] },
].filter(Boolean);

function available(candidate) {
  if (candidate.command.includes(delimiter) || candidate.command.includes("/") || candidate.command.includes("\\")) {
    if (!existsSync(candidate.command)) return false;
  }
  const probe = spawnSync(candidate.command, [...candidate.prefix, "--version"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  return probe.status === 0;
}

const python = candidates.find(available);
if (!python) {
  console.error(
    "Alystria Python 3.12 is unavailable. Run the setup command or set ALYSTRIA_PYTHON to an exact interpreter path.",
  );
  process.exit(1);
}

const result = spawnSync(python.command, [...python.prefix, ...requested], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    PYTHONPATH: [resolve(root, "services/pipeline/src"), process.env.PYTHONPATH]
      .filter(Boolean)
      .join(delimiter),
  },
});

if (result.error) {
  console.error(`Python command failed to start: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
