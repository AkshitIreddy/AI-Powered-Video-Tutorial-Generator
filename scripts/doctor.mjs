#!/usr/bin/env node

import { existsSync, statfsSync } from "node:fs";
import { resolve } from "node:path";
import {
  ROOT,
  addCheck,
  commandForPnpm,
  commandForPython,
  commandForUv,
  normalizeVersion,
  parseFlags,
  printChecks,
  readJson,
  redact,
  run
} from "./lib/shared.mjs";
import { collectGpuContext, collectSystemContext } from "./lib/system-context.mjs";
import { validateCatalogs } from "./validate-catalogs.mjs";

const { flags } = parseFlags(process.argv.slice(2));
const strict = flags.has("strict");
const json = flags.has("json");
const runtime = readJson(resolve(ROOT, "runtime-manifest.json"));
const checks = [];

function versionCheck(name, result, expected, required = true) {
  if (!result?.ok) {
    addCheck(checks, required ? "fail" : "warn", name, `not found; pinned version is ${expected}`);
    return;
  }
  const actual = normalizeVersion(result.stdout);
  addCheck(
    checks,
    actual === expected ? "pass" : (required ? "fail" : "warn"),
    name,
    actual === expected ? actual : `${actual ?? "unknown"} installed; ${expected} pinned`
  );
}

versionCheck("Node.js", { ok: true, stdout: process.version }, runtime.toolchains.node.version);
const pnpm = commandForPnpm();
versionCheck("pnpm", pnpm?.result, runtime.toolchains.pnpm.version);
const python = commandForPython();
versionCheck("Python", python?.result, runtime.toolchains.python.version);
const uv = commandForUv();
versionCheck("uv", uv?.result, runtime.toolchains.uv.version);
versionCheck("Rust", run("rustc", ["--version"]), runtime.toolchains.rust.version, existsSync(resolve(ROOT, "apps/desktop/src-tauri/Cargo.toml")));
versionCheck("Cargo", run("cargo", ["--version"]), runtime.toolchains.rust.version, existsSync(resolve(ROOT, "apps/desktop/src-tauri/Cargo.toml")));

const git = run("git", ["--version"]);
addCheck(checks, git.ok ? "pass" : "fail", "Git", git.ok ? git.stdout : "not found");

for (const [name, path, needed] of [
  ["pnpm lock", "pnpm-lock.yaml", existsSync(resolve(ROOT, "pnpm-workspace.yaml"))],
  ["uv lock", "services/pipeline/uv.lock", existsSync(resolve(ROOT, "services/pipeline/pyproject.toml"))],
  ["Cargo lock", existsSync(resolve(ROOT, "Cargo.lock")) ? "Cargo.lock" : "apps/desktop/src-tauri/Cargo.lock", existsSync(resolve(ROOT, "apps/desktop/src-tauri/Cargo.toml"))]
]) {
  if (!needed) addCheck(checks, "warn", name, "workspace not present yet");
  else addCheck(checks, existsSync(resolve(ROOT, path)) ? "pass" : "fail", name, existsSync(resolve(ROOT, path)) ? "present" : `${path} is missing`);
}

const ffmpegCandidates = [
  process.env.ALYSTRIA_FFMPEG,
  "ffmpeg",
  "ffmpeg.exe",
  process.platform === "win32" ? "C:\\FFmpeg\\bin\\ffmpeg.exe" : "/mnt/c/FFmpeg/bin/ffmpeg.exe"
].filter(Boolean);
let ffmpeg = null;
for (const candidate of ffmpegCandidates) {
  const result = run(candidate, ["-hide_banner", "-version"]);
  if (result.ok) {
    ffmpeg = { command: candidate, result };
    break;
  }
}
if (!ffmpeg) {
  addCheck(checks, "warn", "FFmpeg", `not found; signed ${runtime.media.ffmpeg.version} runtime pack is not installed`);
} else {
  const firstLine = ffmpeg.result.stdout.split("\n")[0];
  const version = firstLine.match(/ffmpeg version\s+([^\s]+)/i)?.[1] ?? "unknown";
  const build = run(ffmpeg.command, ["-hide_banner", "-buildconf"]);
  const configuration = `${ffmpeg.result.stdout}\n${build.stdout}`;
  const isGpl = /--enable-gpl\b/.test(configuration);
  const hasX264 = /--enable-libx264\b/.test(configuration);
  const hasNvenc = /--enable-(?:ffnvcodec|nvenc)\b|--enable-nvenc\b/.test(configuration);
  addCheck(
    checks,
    "warn",
    "FFmpeg",
    `${version}; ${isGpl ? "GPL full build — development only, never package" : "non-GPL build"}`,
    { command: ffmpeg.command, hasX264, hasNvenc, buildConfiguration: redact(build.stdout) }
  );
}

const ffprobeCommand = ffmpeg?.command?.replace(/ffmpeg(?:\.exe)?$/i, process.platform === "win32" ? "ffprobe.exe" : "ffprobe") ?? "ffprobe";
const ffprobe = run(ffprobeCommand, ["-hide_banner", "-version"]);
addCheck(checks, ffprobe.ok ? "pass" : "warn", "ffprobe", ffprobe.ok ? ffprobe.stdout.split("\n")[0] : "not found beside FFmpeg");

const catalogs = validateCatalogs();
addCheck(
  checks,
  catalogs.errors.length ? "fail" : "pass",
  "Catalogs",
  catalogs.errors.length ? catalogs.errors.join("; ") : `${catalogs.providerCount} providers, ${catalogs.modelCount} models`,
  { warnings: catalogs.warnings }
);

try {
  const disk = statfsSync(ROOT);
  const freeBytes = Number(disk.bavail) * Number(disk.bsize);
  const freeGiB = freeBytes / (1024 ** 3);
  addCheck(checks, freeGiB >= 20 ? "pass" : "warn", "Free disk", `${freeGiB.toFixed(1)} GiB available; 20 GiB recommended`);
} catch (error) {
  addCheck(checks, "warn", "Free disk", `could not inspect: ${error.message}`);
}

const system = collectSystemContext();
const gpus = collectGpuContext();
const targetGpu = gpus.find((gpu) => /RTX 4080 Laptop/i.test(gpu.Name ?? ""));
addCheck(checks, targetGpu ? "pass" : "warn", "Target GPU", targetGpu ? targetGpu.Name : (gpus.map((gpu) => gpu.Name).filter(Boolean).join(", ") || "no GPU probe available"), gpus);

if (process.platform === "win32") {
  const webView = run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "$keys=@('HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F1E7E8E8-4A39-4D78-9F84-BF5C9D5C0E20}','HKCU:\\Software\\Microsoft\\EdgeUpdate\\Clients\\{F1E7E8E8-4A39-4D78-9F84-BF5C9D5C0E20}'); foreach($k in $keys){if(Test-Path $k){(Get-ItemProperty $k).pv;break}}"
  ]);
  addCheck(checks, webView.ok && webView.stdout ? "pass" : "warn", "WebView2", webView.stdout || "runtime version not detected");
  const vault = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-Service VaultSvc -ErrorAction SilentlyContinue).Status"]);
  addCheck(checks, vault.ok && vault.stdout ? "pass" : "warn", "Credential vault", vault.stdout || "Windows Credential Manager service not detected");
}

const failures = checks.filter((check) => check.status === "fail");
const warnings = checks.filter((check) => check.status === "warn");
const report = {
  ok: failures.length === 0,
  strictOk: failures.length === 0 && warnings.length === 0,
  generatedAt: new Date().toISOString(),
  runtimeManifestVersion: runtime.manifestVersion,
  system,
  checks
};

if (json) console.log(JSON.stringify(report, null, 2));
else {
  console.log("Alystria Studio doctor\n");
  printChecks(checks);
  console.log(`\n${failures.length} failure(s), ${warnings.length} warning(s). No settings were changed.`);
}
process.exitCode = failures.length || (strict && warnings.length) ? 1 : 0;
