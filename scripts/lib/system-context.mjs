import { cpus, freemem, loadavg, platform, release, totalmem } from "node:os";
import { run } from "./shared.mjs";

function windowsPowerContext() {
  const power = run("powercfg.exe", ["/getactivescheme"]);
  const gHelper = run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "if (Get-Process GHelper -ErrorAction SilentlyContinue) { 'running' } else { 'not-running' }"
  ]);
  const load = run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"
  ]);
  const match = power.stdout.match(/\((?<id>[0-9a-f-]+)\)\s*(?<name>.*)$/i)
    ?? power.stdout.match(/:\s*(?<id>[0-9a-f-]+)\s*\((?<name>.*)\)/i);
  return {
    activeScheme: match?.groups?.name?.trim() || power.stdout || null,
    activeSchemeId: match?.groups?.id ?? null,
    gHelperProcess: gHelper.ok ? gHelper.stdout : "unknown",
    cpuLoadPercent: load.ok && Number.isFinite(Number(load.stdout)) ? Number(load.stdout) : null
  };
}

export function collectSystemContext() {
  const cpuList = cpus();
  const onWindows = platform() === "win32";
  const inWsl = !onWindows && /microsoft/i.test(release());
  return {
    platform: platform(),
    release: release(),
    wsl: inWsl,
    architecture: process.arch,
    cpu: {
      model: cpuList[0]?.model?.trim() ?? "unknown",
      logicalCores: cpuList.length,
      nodeLoadAverage: loadavg()
    },
    memory: {
      totalBytes: totalmem(),
      freeBytes: freemem()
    },
    power: onWindows || inWsl ? windowsPowerContext() : {
      activeScheme: null,
      activeSchemeId: null,
      gHelperProcess: "not-applicable",
      cpuLoadPercent: null
    }
  };
}

export function collectGpuContext() {
  if (platform() === "win32" || /microsoft/i.test(release())) {
    const result = run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress"
    ]);
    if (result.ok && result.stdout) {
      try {
        const parsed = JSON.parse(result.stdout);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [{ Name: result.stdout }];
      }
    }
  }
  const nvidia = run("nvidia-smi", ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"]);
  if (!nvidia.ok) return [];
  return nvidia.stdout.split("\n").filter(Boolean).map((line) => {
    const [name, memoryMiB, driverVersion] = line.split(",").map((value) => value.trim());
    return { Name: name, AdapterRAMMiB: Number(memoryMiB), DriverVersion: driverVersion };
  });
}
