#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, openSync, readSync, rmSync, writeSync, closeSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { ROOT, parseFlags, readJson, redact } from "./lib/shared.mjs";
import { collectGpuContext, collectSystemContext } from "./lib/system-context.mjs";

const { flags } = parseFlags(process.argv.slice(2));
if (flags.has("help")) {
  console.log(`Usage: node scripts/benchmark.mjs [options]\n\n` +
    `  --estimate-only              Record environment without load tests\n` +
    `  --power-profile <name>       User-declared G-Helper/profile label\n` +
    `  --cpu-boost <state>          User-declared boost state (enabled/disabled)\n` +
    `  --concurrent-load <note>     User-declared competing workload context\n` +
    `  --notes <text>               Additional non-secret run context\n` +
    `  --output <path>              Write JSON report\n` +
    `  --json                       Print JSON only\n\n` +
    `This command only observes power state. It never changes Windows or G-Helper settings.`);
  process.exit(0);
}

const runtime = readJson(resolve(ROOT, "runtime-manifest.json"));
const system = collectSystemContext();
const gpus = collectGpuContext();
const userContext = {
  powerProfile: flags.get("power-profile") || process.env.ALYSTRIA_BENCH_POWER_PROFILE || null,
  cpuBoost: flags.get("cpu-boost") || process.env.ALYSTRIA_BENCH_CPU_BOOST || null,
  concurrentLoad: redact(flags.get("concurrent-load") || process.env.ALYSTRIA_BENCH_CONCURRENT_LOAD || "") || null,
  notes: redact(flags.get("notes") || process.env.ALYSTRIA_BENCH_NOTES || "") || null,
  source: "user-supplied-cli-or-environment"
};

function cpuCalibration(durationMs = 400) {
  const block = Buffer.alloc(1024 * 1024, 0x5a);
  let bytes = 0;
  let digest = Buffer.alloc(32);
  const start = performance.now();
  while (performance.now() - start < durationMs) {
    digest = createHash("sha256").update(digest).update(block).digest();
    bytes += block.length;
  }
  const seconds = (performance.now() - start) / 1000;
  return { durationSeconds: seconds, mebibytesPerSecond: bytes / (1024 ** 2) / seconds, verification: digest.toString("hex") };
}

function diskCalibration() {
  const directory = mkdtempSync(join(tmpdir(), "alystria-bench-"));
  const path = join(directory, "calibration.bin");
  const block = Buffer.alloc(4 * 1024 * 1024, 0xa5);
  const totalBytes = 32 * 1024 * 1024;
  try {
    const writeHandle = openSync(path, "w");
    const writeStart = performance.now();
    for (let written = 0; written < totalBytes; written += block.length) writeSync(writeHandle, block);
    closeSync(writeHandle);
    const writeSeconds = (performance.now() - writeStart) / 1000;
    const readHandle = openSync(path, "r");
    const readBuffer = Buffer.alloc(block.length);
    const readStart = performance.now();
    let bytesRead = 0;
    while (true) {
      const count = readSync(readHandle, readBuffer, 0, readBuffer.length, null);
      if (!count) break;
      bytesRead += count;
    }
    closeSync(readHandle);
    const readSeconds = (performance.now() - readStart) / 1000;
    return {
      bytes: totalBytes,
      writeMebibytesPerSecond: totalBytes / (1024 ** 2) / writeSeconds,
      readMebibytesPerSecond: bytesRead / (1024 ** 2) / readSeconds
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const estimatesOnly = flags.has("estimate-only");
const declaredConstrained = /silent|eco|disabled|other|concurrent|load/i.test(Object.values(userContext).filter(Boolean).join(" "));
const detectedContention = (system.power.cpuLoadPercent ?? 0) > 60;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runtimeManifestVersion: runtime.manifestVersion,
  mode: estimatesOnly ? "environment-estimate" : "short-calibration",
  comparableForReleaseGate: !estimatesOnly && !declaredConstrained && !detectedContention,
  userContext,
  detectedContext: { system, gpus },
  powerPolicy: {
    settingsChanged: false,
    statement: "Observational only. Alystria never changes Windows or G-Helper power settings."
  },
  calibration: estimatesOnly ? null : {
    cpuSha256: cpuCalibration(),
    temporaryDisk: diskCalibration()
  },
  interpretation: declaredConstrained || detectedContention
    ? "Use these results as a conservative development estimate, not a release benchmark. Re-run later under an explicitly recorded stable profile if release-grade numbers are needed."
    : "Short calibration only. Canonical render/model fixtures are still required for release-grade results."
};

if (flags.get("output")) {
  const output = resolve(ROOT, String(flags.get("output")));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

if (flags.has("json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Alystria Studio benchmark context");
  console.log(`Mode: ${report.mode}`);
  console.log(`Detected power scheme: ${system.power.activeScheme ?? "unavailable"}`);
  console.log(`G-Helper process: ${system.power.gHelperProcess}`);
  console.log(`User-declared profile: ${userContext.powerProfile ?? "not supplied"}`);
  console.log(`User-declared CPU boost: ${userContext.cpuBoost ?? "not supplied"}`);
  console.log(`Concurrent workload: ${userContext.concurrentLoad ?? "not supplied"}`);
  if (report.calibration) {
    console.log(`CPU SHA-256 calibration: ${report.calibration.cpuSha256.mebibytesPerSecond.toFixed(1)} MiB/s`);
    console.log(`Temporary disk write/read: ${report.calibration.temporaryDisk.writeMebibytesPerSecond.toFixed(1)} / ${report.calibration.temporaryDisk.readMebibytesPerSecond.toFixed(1)} MiB/s`);
  }
  console.log(`Release-comparable: ${report.comparableForReleaseGate ? "yes" : "no"}`);
  console.log(report.interpretation);
  console.log("Power settings changed: no");
}
