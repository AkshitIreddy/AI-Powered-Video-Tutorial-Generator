#!/usr/bin/env node

import { commandForPnpm, run } from "./lib/shared.mjs";

const pnpm = commandForPnpm();
if (!pnpm) {
  console.error("FAIL  pnpm is unavailable. Enable Corepack or install the pinned package manager.");
  process.exit(1);
}

const result = run(
  pnpm.command,
  [...(pnpm.prefix ?? []), ...process.argv.slice(2)],
  { inherit: true }
);
if (!result.ok) process.exit(result.status ?? 1);
