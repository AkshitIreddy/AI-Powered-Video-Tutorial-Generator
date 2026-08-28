#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { ROOT, commandForPnpm, commandForPython, parseFlags, readJson, run } from "./lib/shared.mjs";

const { flags } = parseFlags(process.argv.slice(2));
const fixtureRoot = resolve(ROOT, "fixtures");
const rendererManifest = resolve(ROOT, "services/renderer/package.json");
const errors = [];
const warnings = [];
const parsed = [];

function visit(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory).sort()) {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) visit(path);
    else if (entry.endsWith(".json")) {
      try {
        const document = JSON.parse(readFileSync(path, "utf8"));
        const serialized = JSON.stringify(document);
        if (/https?:\/\//i.test(serialized) && !/source|citation|provenance|license/i.test(serialized)) {
          warnings.push(`${relative(ROOT, path)} contains a remote URL; rendered assets must still resolve locally`);
        }
        if (/(?:sk-[A-Za-z0-9_-]{20,}|nvapi-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|ghp_[A-Za-z0-9]{30,})/.test(serialized)) {
          errors.push(`${relative(ROOT, path)} contains a secret-shaped value`);
        }
        if (!relative(fixtureRoot, path).startsWith(`schema${process.platform === "win32" ? "\\" : "/"}`)) {
          parsed.push({ path, id: typeof document.id === "string" ? document.id : null });
        }
      } catch (error) {
        errors.push(`${relative(ROOT, path)} is not valid JSON: ${error.message}`);
      }
    }
  }
}

// Only canonical fixture records participate in the fixture-ID contract.
// `fixtures/generated` contains inspectable stage summaries whose source input
// intentionally reuses the canonical fixture ID.
visit(resolve(fixtureRoot, "canonical"));
const ids = new Set();
for (const fixture of parsed) {
  if (!fixture.id) continue;
  if (ids.has(fixture.id)) errors.push(`duplicate fixture id: ${fixture.id}`);
  ids.add(fixture.id);
}
if (flags.has("require-fixtures") && parsed.length === 0) errors.push("no JSON fixtures were found");

if (!flags.has("validate-only") && !errors.length) {
  const fixtureValidator = resolve(fixtureRoot, "validate.py");
  if (existsSync(fixtureValidator)) {
    const python = commandForPython();
    if (!python) errors.push("Python is unavailable for canonical fixture validation");
    else {
      const result = run(python.command, [...(python.prefix ?? []), fixtureValidator], { inherit: true });
      if (!result.ok) errors.push(`canonical fixture validation failed with exit code ${result.status ?? "unknown"}`);
    }
  }
}

if (!existsSync(rendererManifest)) {
  const message = "renderer package is not present yet";
  if (flags.has("require-renderer")) errors.push(message);
  else warnings.push(message);
} else if (!flags.has("validate-only") && !errors.length) {
  const renderer = readJson(rendererManifest);
  if (!renderer.scripts?.["test:render"]) {
    errors.push(`${basename(rendererManifest)} has no test:render script`);
  } else {
    const pnpm = commandForPnpm();
    if (!pnpm) errors.push("pnpm is unavailable");
    else {
      const result = run(pnpm.command, [...(pnpm.prefix ?? []), "--filter", renderer.name, "test:render"], { inherit: true });
      if (!result.ok) errors.push(`renderer test command failed with exit code ${result.status ?? "unknown"}`);
    }
  }
}

for (const warning of warnings) console.warn(`WARN  ${warning}`);
for (const error of errors) console.error(`FAIL  ${error}`);
if (!errors.length) console.log(`PASS  ${parsed.length} fixture JSON file(s) validated${flags.has("validate-only") ? "" : " and render tests orchestrated"}`);
process.exitCode = errors.length ? 1 : 0;
