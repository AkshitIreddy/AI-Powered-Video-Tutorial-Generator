#!/usr/bin/env node

import { commandForPnpm, run } from "./lib/shared.mjs";
import { delimiter, dirname } from "node:path";

if (Number(process.versions.node.split(".")[0]) < 24) {
  console.error(`FAIL  Node 24 or newer is required; this command is running Node ${process.versions.node}.`);
  process.exit(1);
}

// pnpm scripts resolve `node` from PATH. Keep an explicitly chosen runtime in
// child commands instead of silently falling back to an older system install.
process.env.PATH = [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter);

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
