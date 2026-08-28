import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function normalizeVersion(value) {
  const match = String(value ?? "").match(/\d+\.\d+\.\d+/);
  return match?.[0] ?? null;
}

export function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
    shell: false,
    stdio: options.inherit ? "inherit" : "pipe"
  });
  return {
    command,
    args,
    status: result.status,
    ok: result.status === 0,
    stdout: String(result.stdout ?? "").replaceAll("\r\n", "\n").trim(),
    stderr: String(result.stderr ?? "").replaceAll("\r\n", "\n").trim(),
    error: result.error?.message ?? null
  };
}

export function firstWorking(candidates, versionArgs = ["--version"]) {
  for (const candidate of candidates) {
    if (!candidate?.command) continue;
    const result = run(candidate.command, [...(candidate.prefix ?? []), ...versionArgs]);
    if (result.ok) return { ...candidate, result };
  }
  return null;
}

export function parseFlags(argv) {
  const flags = new Map();
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const equal = token.indexOf("=");
    if (equal >= 0) {
      flags.set(token.slice(2, equal), token.slice(equal + 1));
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index += 1;
    } else {
      flags.set(key, true);
    }
  }
  return { flags, positional };
}

export function commandForPnpm() {
  const bundledCorepack = process.platform === "win32" && process.env.ProgramFiles
    ? resolve(process.env.ProgramFiles, "nodejs/node_modules/corepack/dist/corepack.js")
    : null;
  return firstWorking([
    { command: "pnpm" },
    bundledCorepack && existsSync(bundledCorepack)
      ? { command: process.execPath, prefix: [bundledCorepack, "pnpm"] }
      : null,
    { command: "pnpm.cmd" },
    { command: "corepack", prefix: ["pnpm"] },
    { command: "corepack.cmd", prefix: ["pnpm"] }
  ]);
}

export function commandForUv() {
  const appData = process.env.APPDATA;
  return firstWorking([
    { command: "uv" },
    { command: "uv.exe" },
    appData ? { command: resolve(appData, "Python/Python312/Scripts/uv.exe") } : null,
    process.env.USERPROFILE
      ? { command: resolve(process.env.USERPROFILE, "AppData/Roaming/Python/Python312/Scripts/uv.exe") }
      : null,
  ]);
}

export function commandForPython() {
  return firstWorking([
    { command: "python3" },
    { command: "python" },
    { command: "python.exe" },
    { command: "py", prefix: ["-3.12"] },
    { command: "py.exe", prefix: ["-3.12"] }
  ]);
}

export function executableExists(path) {
  return Boolean(path && existsSync(path));
}

export function printChecks(checks) {
  const width = Math.max(10, ...checks.map((check) => check.name.length));
  for (const check of checks) {
    const marker = check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`${marker.padEnd(4)}  ${check.name.padEnd(width)}  ${check.message}`);
  }
}

export function redact(text) {
  return String(text ?? "")
    .replace(/(api[_-]?key|authorization|token|secret|password)\s*[:=]\s*\S+/gi, "$1=<redacted>")
    .slice(0, 4000);
}

export function addCheck(checks, status, name, message, detail = undefined) {
  checks.push({ status, name, message, ...(detail === undefined ? {} : { detail }) });
}

export function isCi() {
  return /^(1|true)$/i.test(process.env.CI ?? "");
}
