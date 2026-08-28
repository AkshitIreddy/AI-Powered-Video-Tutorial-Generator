#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  ROOT,
  commandForPnpm,
  commandForPython,
  commandForUv,
  normalizeVersion,
  parseFlags,
  readJson,
  run
} from "./lib/shared.mjs";
import { validateCatalogs } from "./validate-catalogs.mjs";

const { flags } = parseFlags(process.argv.slice(2));
const checkOnly = flags.has("check");
const allowMismatch = flags.has("allow-version-mismatch");
const offline = flags.has("offline");
const runtime = readJson(resolve(ROOT, "runtime-manifest.json"));
const failures = [];

function verify(name, actual, expected) {
  if (!actual) {
    failures.push(`${name} is not available (expected ${expected})`);
    return;
  }
  if (normalizeVersion(actual) !== expected) {
    const message = `${name} ${normalizeVersion(actual) ?? actual} does not match pinned ${expected}`;
    if (allowMismatch) console.warn(`WARN  ${message}`);
    else failures.push(message);
  } else {
    console.log(`PASS  ${name} ${expected}`);
  }
}

verify("Node.js", process.version, runtime.toolchains.node.version);
const pnpm = commandForPnpm();
if (!flags.has("skip-js")) verify("pnpm", pnpm?.result.stdout, runtime.toolchains.pnpm.version);
const python = commandForPython();
if (!flags.has("skip-python")) verify("Python", python?.result.stdout, runtime.toolchains.python.version);
const uv = commandForUv();
if (!flags.has("skip-python")) verify("uv", uv?.result.stdout, runtime.toolchains.uv.version);

const rust = run("rustc", ["--version"]);
const cargoVersion = run("cargo", ["--version"]);
if (!flags.has("skip-rust")) {
  if (rust.ok) verify("Rust", rust.stdout, runtime.toolchains.rust.version);
  else if (existsSync(resolve(ROOT, "apps/desktop/src-tauri/Cargo.toml"))) failures.push("Rust is required for the desktop workspace");
  if (cargoVersion.ok) verify("Cargo", cargoVersion.stdout, runtime.toolchains.rust.version);
  else if (existsSync(resolve(ROOT, "apps/desktop/src-tauri/Cargo.toml"))) failures.push("Cargo is required for the desktop workspace");
}

const catalogs = validateCatalogs();
for (const warning of catalogs.warnings) console.warn(`WARN  ${warning}`);
for (const error of catalogs.errors) failures.push(error);
if (!catalogs.errors.length) console.log(`PASS  catalogs (${catalogs.providerCount} providers, ${catalogs.modelCount} models)`);

const hasJsWorkspaces = existsSync(resolve(ROOT, "pnpm-workspace.yaml"));
const hasPythonWorkspace = existsSync(resolve(ROOT, "services/pipeline/pyproject.toml"));
const hasRustWorkspace = existsSync(resolve(ROOT, "apps/desktop/src-tauri/Cargo.toml"));
if (!flags.has("skip-js") && hasJsWorkspaces && !existsSync(resolve(ROOT, "pnpm-lock.yaml"))) failures.push("pnpm-lock.yaml is missing; setup will not create an unreviewed lockfile");
if (!flags.has("skip-python") && hasPythonWorkspace && !existsSync(resolve(ROOT, "services/pipeline/uv.lock"))) failures.push("services/pipeline/uv.lock is missing; setup will not create an unreviewed lockfile");
if (!flags.has("skip-rust") && hasRustWorkspace && !existsSync(resolve(ROOT, "Cargo.lock")) && !existsSync(resolve(ROOT, "apps/desktop/src-tauri/Cargo.lock"))) {
  failures.push("Cargo.lock is missing; setup will not create an unreviewed lockfile");
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL  ${failure}`);
  console.error("Setup stopped before installing anything.");
  process.exit(1);
}

if (checkOnly) {
  console.log("Setup check passed; no files or global settings were changed.");
  process.exit(0);
}

function execute(label, tool, args) {
  console.log(`RUN   ${label}`);
  const result = run(tool.command, [...(tool.prefix ?? []), ...args], { inherit: true });
  if (!result.ok) throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
}

try {
  if (!flags.has("skip-js") && hasJsWorkspaces) {
    execute("pnpm frozen install", pnpm, ["install", "--frozen-lockfile", ...(offline ? ["--offline"] : [])]);
  }
  if (!flags.has("skip-python") && hasPythonWorkspace) {
    execute("uv frozen sync", uv, ["sync", "--frozen", "--project", "services/pipeline", "--extra", "dev", "--extra", "full", ...(offline ? ["--offline"] : [])]);
  }
  if (!flags.has("skip-rust") && hasRustWorkspace) {
    const cargo = { command: "cargo", prefix: [] };
    execute("cargo locked fetch", cargo, ["fetch", "--locked", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml", ...(offline ? ["--offline"] : [])]);
  }
  console.log("Alystria Studio development dependencies are ready.");
} catch (error) {
  console.error(`FAIL  ${error.message}`);
  process.exit(1);
}
