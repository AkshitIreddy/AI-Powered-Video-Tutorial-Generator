#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, parseFlags, run } from "./lib/shared.mjs";
import { validateCatalogs } from "./validate-catalogs.mjs";

const { flags } = parseFlags(process.argv.slice(2));
const failures = [];
const warnings = [];

const required = [
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "runtime-manifest.json",
  "providers.catalog.json",
  "models.catalog.json",
  ".node-version",
  ".python-version",
  "rust-toolchain.toml",
  "services/pipeline/pyproject.toml",
  "services/pipeline/uv.lock"
];
for (const path of required) {
  if (!existsSync(resolve(ROOT, path))) failures.push(`required clean-checkout file is missing: ${path}`);
}
if (existsSync(resolve(ROOT, "apps/desktop/src-tauri/Cargo.toml")) &&
    !existsSync(resolve(ROOT, "Cargo.lock")) &&
    !existsSync(resolve(ROOT, "apps/desktop/src-tauri/Cargo.lock"))) {
  failures.push("desktop Rust workspace has no Cargo.lock");
}

const diffCheck = run("git", ["diff", "--check"]);
if (!diffCheck.ok) failures.push(`git diff --check failed: ${diffCheck.stdout || diffCheck.stderr}`);

if (flags.has("strict-worktree")) {
  const status = run("git", ["status", "--porcelain", "--untracked-files=all"]);
  if (!status.ok) failures.push("could not inspect Git worktree");
  else if (status.stdout) failures.push("worktree is not clean after reproducible setup/build");
}

const trackedResult = run("git", ["ls-files", "-z"]);
if (!trackedResult.ok) failures.push("could not enumerate tracked files");
const tracked = trackedResult.stdout.split("\0").filter(Boolean);
const versionableResult = run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
if (!versionableResult.ok) failures.push("could not enumerate versionable files");
const versionable = versionableResult.stdout.split("\0").filter(Boolean);
const forbiddenTracked = /(^|\/)(node_modules|\.venv|target|dist|coverage|runtime-packs|exports|staging)(\/|$)|^models(?:\/|$)|\.(?:sqlite3|alytutorial)$/i;
for (const path of tracked) if (forbiddenTracked.test(path)) failures.push(`generated/runtime artifact is tracked: ${path}`);

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bghp_[A-Za-z0-9]{30,}\b/,
  /\bsk[_-](?:ant[_-])?[A-Za-z0-9_-]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bnvapi-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:cohere|elevenlabs|assemblyai|gemini|google|runway|openai|anthropic)[_-]?(?:api[_-]?)?(?:key|token|secret)\s*[:=]\s*["']?[A-Za-z0-9._-]{20,}/i,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[A-Za-z0-9+/_=.-]{24,}/i
];
const suspiciousSecretFile = /(^|\/)[^/]*(?:api[-_. ]?keys?|credentials?|secrets?)[^/]*\.(?:txt|json|ya?ml|csv|env)$/i;
for (const path of versionable) {
  if (suspiciousSecretFile.test(path)) {
    const message = `credential-like file is versionable: ${path}`;
    if (/(^|\/)tests?(\/|$)/i.test(path)) warnings.push(`${message}; confirm it is synthetic`);
    else failures.push(message);
  }
  if (/\.(?:png|jpe?g|gif|webp|ico|woff2?|mp[34]|mkv|wav|sqlite3)$/i.test(path)) continue;
  const absolute = resolve(ROOT, path);
  if (!existsSync(absolute)) continue;
  let content;
  try { content = readFileSync(absolute, "utf8"); } catch { continue; }
  if (secretPatterns.some((pattern) => pattern.test(content))) {
    if (/(^|\/)tests?(\/|$)/i.test(path)) warnings.push(`secret-shaped test fixture found in ${path}; confirm it is synthetic`);
    else failures.push(`secret-shaped value found in tracked file: ${path}`);
  }
  if (!path.startsWith("legacy/") && /(?:C:\\Users\\|\/mnt\/c\/Users\/)[^\s"')]+/i.test(content)) {
    warnings.push(`machine-specific absolute path found in ${path}`);
  }
}

const stagedResult = run("git", ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"]);
if (!stagedResult.ok) failures.push("could not enumerate staged files for the secret scan");
const staged = stagedResult.stdout.split("\0").filter(Boolean);
for (const path of staged) {
  if (!versionable.includes(path) && !tracked.includes(path)) {
    failures.push(`staged file escaped the versionable-file secret scan: ${path}`);
  }
}

const catalogs = validateCatalogs();
failures.push(...catalogs.errors);
warnings.push(...catalogs.warnings);

for (const warning of warnings) console.warn(`WARN  ${warning}`);
for (const failure of failures) console.error(`FAIL  ${failure}`);
if (!failures.length) console.log(`PASS  clean-machine preflight (${tracked.length} tracked, ${versionable.length} versionable, ${staged.length} staged files inspected)`);
process.exitCode = failures.length ? 1 : 0;
