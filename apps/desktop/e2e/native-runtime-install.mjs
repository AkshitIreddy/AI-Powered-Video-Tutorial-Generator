import { chromium, expect } from "@playwright/test";
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const RUNTIME = {
  modelId: "runtime/comfyui-0.9.2",
  displayName: "ComfyUI 0.9.2 portable runtime",
  immutableRevision: "comfyui-8f40b43e0204d5b9780f3e9618e140e929e80594",
  codeRevision: "8f40b43e0204d5b9780f3e9618e140e929e80594",
  weightRevision: "runtime-only",
  licenseId: "GPL-3.0",
  licenseSha256: "3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986",
  totalBytes: 1_803_412_624,
  artifactCount: 1,
  archiveName: "ComfyUI-v0.9.2-nvidia.7z",
  archiveSha256: "3a0707fbf1cf5dc8b5f1ab3abe8af104deffcb1acc27b8d27c484715dd41f4c5",
};
const SDXL = {
  modelId: "local/sdxl-base-1.0",
  displayName: "Stable Diffusion XL Base 1.0 + optional offset LoRA",
  immutableRevision: "comfyui-8f40b43e+sdxl-46216598",
  runtimeRevision: "comfyui-8f40b43e+sdxl-46216598",
  licenseId: "CreativeML Open RAIL++-M",
  licenseSha256: "19b6998b569b53ac1fc2158a8a3202c8699a9a4605b47075715d9c96be7fb6d0",
  totalBytes: 8_791_044_562,
  incrementalBytes: 6_987_631_938,
  artifactCount: 3,
  recipeId: "comfy-sdxl-1.0-portrait-v1",
  files: [
    {
      relativePath: "models/checkpoints/sd_xl_base_1.0.safetensors",
      size: 6_938_078_334,
      sha256: "31e35c80fc4829d14f90153f4c74cd59c90b779f6afe05a74cd6120b893f7e5b",
    },
    {
      relativePath: "models/loras/sd_xl_offset_example-lora_1.0.safetensors",
      size: 49_553_604,
      sha256: "4852686128f953d0277d0793e2f0335352f96a919c9c16a09787d77f55cbdf6f",
    },
  ],
};

const portableRoot = requiredPathArgument("--portable-root");
const allowExisting = process.argv.includes("--allow-existing");
const runtimeTimeoutMs = durationArgument("--runtime-timeout-minutes", 180) * 60_000;
const sdxlTimeoutMs = durationArgument("--sdxl-timeout-minutes", 480) * 60_000;
const executable = path.join(portableRoot, "App", "AI Video Tutorial Generator.exe");
const workerExecutable = path.join(portableRoot, "Runtime", "alystria-pipeline.exe");
const appDataPath = path.join(portableRoot, "App Data");
const projectsPath = path.join(portableRoot, "Projects");
const modelsPath = path.join(portableRoot, "Models");
const comfyRoot = path.join(modelsPath, "comfyui-local");
const comfyInstallRoot = path.join(comfyRoot, "ComfyUI_windows_portable");
const runtimeArchivePath = path.join(comfyRoot, RUNTIME.archiveName);
const sdxlManifestPath = path.join(comfyRoot, "manifests", "local-sdxl-base-1.0.json");
const runtimeStatusPath = durableStatusPath(RUNTIME);
const sdxlStatusPath = durableStatusPath(SDXL);
const readyPath = path.join(portableRoot, "Evidence", "native-headless-ready.json");
const evidenceRoot = path.join(portableRoot, "Evidence", "native-runtime-install");
const checkpointPath = path.join(evidenceRoot, "checkpoint.json");
const journalPath = path.join(evidenceRoot, "owner-isolation.json");
const runId = `${new Date().toISOString().replace(/[^0-9]/gu, "")}-${process.pid}`;
const runRoot = path.join(evidenceRoot, "runs", runId);
const breadcrumbPath = path.join(runRoot, "progress.jsonl");
const reportPath = path.join(runRoot, "report.json");
const latestReportPath = path.join(evidenceRoot, "report.json");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

let launch;
let bootstrapLaunch;
let isolation;
let report;
let workError;
let cleanupError;
let checkpoint = await readJson(checkpointPath, {});

await mkdir(runRoot, { recursive: true });
await validatePortableInputs();
if (checkpoint.portableRoot && path.resolve(checkpoint.portableRoot) !== portableRoot) {
  throw new Error(`The resumable checkpoint belongs to another portable root: ${checkpoint.portableRoot}`);
}
await recoverInterruptedOwnerIsolation();
await breadcrumb("run-started", { allowExisting, runtimeTimeoutMs, sdxlTimeoutMs });

try {
  await waitForPortableWebViewExit(30_000);
  isolation = await isolateOwnerDirectories();

  bootstrapLaunch = await startBootstrapNative();
  const completedBootstrap = bootstrapLaunch;
  bootstrapLaunch = undefined;
  await closeBootstrapNative(completedBootstrap);
  await rotateExistingPath(readyPath, "bootstrap-ready");

  launch = await startNative("install");
  const { page } = launch;
  await seedCleanWorkspace(page);
  await expect(page.locator(".runtime-badge")).toContainText("Worker ready", { timeout: 45_000 });
  await openModelsAndProviders(page);

  const catalog = await invokeNative(page, "local_model_download_catalog");
  const runtimeEntry = assertCatalogEntry(catalog, RUNTIME);
  const sdxlEntry = assertCatalogEntry(catalog, SDXL);
  if (!runtimeEntry.available || !sdxlEntry.available) {
    throw new Error("The rebuilt native package did not expose both managed download entries as available");
  }
  await breadcrumb("catalog-verified", {
    runtime: catalogEvidence(runtimeEntry),
    sdxl: catalogEvidence(sdxlEntry),
  });

  const initialRuntime = await modelStatus(page, RUNTIME.modelId);
  const runtimeStartedHere = await startRuntimeFromUi(page, initialRuntime);
  const runtimeProgress = runtimeStartedHere
    ? await exerciseDownloadDrawer(page, RUNTIME, runtimeTimeoutMs)
    : [];
  const runtimeReady = await waitForModelPhase(page, RUNTIME, new Set(["ready", "inUse"]), runtimeTimeoutMs);
  assertReadyStatus(runtimeReady, RUNTIME);
  await assertDrawerComplete(page, RUNTIME);
  await page.screenshot({ path: path.join(runRoot, "02-runtime-download-ready.png"), fullPage: true });

  await minimizeDownloads(page);
  await openModelsAndProviders(page);
  const runtimePanel = page.locator("section.local-runtime-panel");
  await expect(runtimePanel).toContainText("Ready", { timeout: 30_000 });
  await expect(runtimePanel).toContainText("Verified and ready for compatible local image models.");
  await page.screenshot({ path: path.join(runRoot, "03-runtime-panel-ready-before-sdxl.png"), fullPage: true });
  const runtimeFilesBeforeSdxl = await runtimeEntrypointEvidence();
  const runtimeArchiveBeforeSdxl = await fileStatEvidence(runtimeArchivePath);
  checkpoint = await updateCheckpoint({
    runtimeDownloadObserved: checkpoint.runtimeDownloadObserved || runtimeStartedHere,
    runtimeReady: true,
    runtimeProgress: mergeProgress(checkpoint.runtimeProgress, runtimeProgress),
    runtimeReadyAtUtc: new Date().toISOString(),
  });
  await breadcrumb("runtime-ready-before-sdxl", {
    status: statusEvidence(runtimeReady),
    entrypoints: runtimeFilesBeforeSdxl,
  });

  const initialSdxl = await modelStatus(page, SDXL.modelId);
  const sdxlStartedHere = await startSdxlFromUi(page, initialSdxl);
  const sdxlProgress = sdxlStartedHere
    ? await exerciseDownloadDrawer(page, SDXL, sdxlTimeoutMs)
    : [];
  const sdxlReady = await waitForModelPhase(page, SDXL, new Set(["ready", "inUse"]), sdxlTimeoutMs);
  assertReadyStatus(sdxlReady, SDXL);
  const runtimeAfterSdxl = await modelStatus(page, RUNTIME.modelId);
  assertReadyStatus(runtimeAfterSdxl, RUNTIME);
  await assertDrawerComplete(page, SDXL);
  await page.screenshot({ path: path.join(runRoot, "05-sdxl-download-ready.png"), fullPage: true });

  const runtimeFilesAfterSdxl = await runtimeEntrypointEvidence();
  const runtimeArchiveAfterSdxl = await fileStatEvidence(runtimeArchivePath);
  assertRuntimeWasNotReextracted(runtimeFilesBeforeSdxl, runtimeFilesAfterSdxl);
  assertFileStatUnchanged(runtimeArchiveBeforeSdxl, runtimeArchiveAfterSdxl, "The shared ComfyUI archive was replaced while installing SDXL");
  checkpoint = await updateCheckpoint({
    sdxlDownloadObserved: checkpoint.sdxlDownloadObserved || sdxlStartedHere,
    sdxlReady: true,
    sdxlProgress: mergeProgress(checkpoint.sdxlProgress, sdxlProgress),
    sdxlReadyAtUtc: new Date().toISOString(),
  });
  await breadcrumb("sdxl-ready", {
    status: statusEvidence(sdxlReady),
    runtimeStillReady: statusEvidence(runtimeAfterSdxl),
    runtimeEntrypointsUnchanged: true,
    runtimeArchiveUnchanged: true,
  });

  const receiptEvidence = await verifyDurableReceiptsAndFiles();
  await breadcrumb("hash-and-preflight-receipts-verified", receiptEvidence);

  const firstDesktopPid = launch.child.pid;
  const firstWorkerPid = launch.workerPid;
  const completedInstallLaunch = launch;
  launch = undefined;
  await closeNative(completedInstallLaunch);
  await rotateExistingPath(readyPath, "install-ready");

  launch = await startNative("relaunch");
  await seedCleanWorkspace(launch.page);
  await openModelsAndProviders(launch.page);
  const relaunchedRuntime = await waitForModelPhase(launch.page, RUNTIME, new Set(["ready", "inUse"]), 120_000);
  const relaunchedSdxl = await waitForModelPhase(launch.page, SDXL, new Set(["ready", "inUse"]), 600_000);
  assertReadyStatus(relaunchedRuntime, RUNTIME);
  assertReadyStatus(relaunchedSdxl, SDXL);
  const runtimeFilesAfterRestart = await runtimeEntrypointEvidence();
  const runtimeArchiveAfterRestart = await fileStatEvidence(runtimeArchivePath);
  assertRuntimeWasNotReextracted(runtimeFilesBeforeSdxl, runtimeFilesAfterRestart);
  assertFileStatUnchanged(runtimeArchiveBeforeSdxl, runtimeArchiveAfterRestart, "The shared ComfyUI archive changed during native restart");
  await launch.page.getByRole("button", { name: "Downloads", exact: true }).click();
  await assertDrawerComplete(launch.page, RUNTIME);
  await assertDrawerComplete(launch.page, SDXL);
  await launch.page.screenshot({ path: path.join(runRoot, "06-ready-after-native-restart.png"), fullPage: true });

  report = {
    schemaVersion: 1,
    state: "passed",
    evidenceClass: "packaged-native-runtime-and-sdxl-install",
    runId,
    actualNativeWebView: true,
    hiddenLaunch: true,
    ownerStateIsolated: true,
    managedModelsRetainedInPortableSandbox: true,
    runtimeDownloadedThroughProductionUi: hasIncreasingProgress(mergeProgress(checkpoint.runtimeProgress, runtimeProgress)),
    sdxlDownloadedThroughProductionUi: hasIncreasingProgress(mergeProgress(checkpoint.sdxlProgress, sdxlProgress)),
    acceptedExistingInstall: !runtimeStartedHere || !sdxlStartedHere,
    runtimeProgress: mergeProgress(checkpoint.runtimeProgress, runtimeProgress),
    sdxlProgress: mergeProgress(checkpoint.sdxlProgress, sdxlProgress),
    minimizedDuringDownload: true,
    navigatedWhileMinimized: true,
    reopenedDownloads: true,
    runtimeReadyBeforeSdxl: true,
    runtimeReextractedForSdxl: false,
    runtimeEntrypointsBeforeSdxl: runtimeFilesBeforeSdxl,
    runtimeEntrypointsAfterSdxl: runtimeFilesAfterSdxl,
    runtimeEntrypointsAfterRestart: runtimeFilesAfterRestart,
    runtimeArchiveBeforeSdxl,
    runtimeArchiveAfterSdxl,
    runtimeArchiveAfterRestart,
    runtimeStatus: statusEvidence(runtimeReady),
    sdxlStatus: statusEvidence(sdxlReady),
    relaunchedRuntimeStatus: statusEvidence(relaunchedRuntime),
    relaunchedSdxlStatus: statusEvidence(relaunchedSdxl),
    receipts: receiptEvidence,
    firstDesktopPid,
    firstWorkerPid,
    secondDesktopPid: launch.child.pid,
    secondWorkerPid: launch.workerPid,
    executableSha256: await sha256File(executable, "desktop-executable-hash"),
    workerSha256: await sha256File(workerExecutable, "pipeline-worker-hash"),
    runEvidenceDirectory: runRoot,
    finishedAtUtc: new Date().toISOString(),
  };
} catch (error) {
  workError = error;
  await breadcrumb("run-failed", { message: error instanceof Error ? error.message : String(error) }).catch(() => {});
} finally {
  const cleanupErrors = [];
  if (bootstrapLaunch) await closeBootstrapNative(bootstrapLaunch).catch((error) => cleanupErrors.push(error));
  if (launch) await closeNative(launch).catch((error) => cleanupErrors.push(error));
  if (isolation) await preserveIsolatedStateAndRestoreOwner(isolation).catch((error) => cleanupErrors.push(error));
  if (cleanupErrors.length) {
    cleanupError = workError
      ? new AggregateError([workError, ...cleanupErrors], "Runtime install acceptance failed and cleanup also failed")
      : new AggregateError(cleanupErrors, "Runtime install acceptance cleanup failed");
  }
}

if (cleanupError) throw cleanupError;
if (workError) throw workError;

if (report) {
  report.gracefulShutdown = true;
  report.workerExitedWithApp = true;
  report.ownerStateRestored = true;
  report.isolatedAppDataEvidencePath = path.join(runRoot, "isolated-app-data");
  report.isolatedProjectsEvidencePath = path.join(runRoot, "isolated-projects");
  await writeJson(reportPath, report);
  await writeJson(latestReportPath, report);
  await breadcrumb("run-passed", { reportPath, latestReportPath });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function requiredPathArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return path.resolve(process.argv[index + 1]);
}

function durationArgument(name, fallbackMinutes) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallbackMinutes;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number of minutes`);
  return value;
}

function durableStatusPath(spec) {
  return path.join(
    modelsPath,
    "download-quarantine",
    spec.modelId.replaceAll("/", "--"),
    spec.immutableRevision,
    "download-status.json",
  );
}

async function validatePortableInputs() {
  for (const [label, target, kind] of [
    ["portable root", portableRoot, "directory"],
    ["packaged desktop", executable, "file"],
    ["packaged worker", workerExecutable, "file"],
    ["portable manifest", path.join(portableRoot, "test-area-manifest.json"), "file"],
  ]) {
    const details = await lstat(target).catch(() => null);
    const valid = details && !details.isSymbolicLink() && (kind === "file" ? details.isFile() : details.isDirectory());
    if (!valid) throw new Error(`${label} is missing, unsafe, or the wrong type: ${target}`);
  }
  await mkdir(modelsPath, { recursive: true });
  const models = await lstat(modelsPath);
  if (models.isSymbolicLink() || !models.isDirectory()) throw new Error(`Portable Models path is unsafe: ${modelsPath}`);
}

function assertCatalogEntry(catalog, expected) {
  const entry = catalog.find((candidate) => candidate.modelId === expected.modelId);
  if (!entry) throw new Error(`Native catalog omitted ${expected.modelId}`);
  for (const key of ["displayName", "immutableRevision", "licenseId", "licenseSha256", "totalBytes", "artifactCount"]) {
    if (entry[key] !== expected[key]) throw new Error(`${expected.modelId} catalog ${key} mismatch: ${JSON.stringify(entry[key])}`);
  }
  if (expected.codeRevision && entry.codeRevision !== expected.codeRevision) throw new Error(`${expected.modelId} code revision mismatch`);
  if (expected.weightRevision && entry.weightRevision !== expected.weightRevision) throw new Error(`${expected.modelId} weight revision mismatch`);
  return entry;
}

function catalogEvidence(entry) {
  return Object.fromEntries(["modelId", "displayName", "immutableRevision", "totalBytes", "artifactCount", "licenseId", "licenseSha256", "codeRevision", "weightRevision", "available"].map((key) => [key, entry[key]]));
}

async function startRuntimeFromUi(page, initial) {
  if (["ready", "inUse"].includes(initial?.phase)) {
    if (!allowExisting && !hasIncreasingProgress(checkpoint.runtimeProgress)) {
      throw new Error("ComfyUI is already installed without this harness's progress checkpoint. Use a clean sandbox for actual-download acceptance or pass --allow-existing for receipt-only revalidation.");
    }
    await breadcrumb("runtime-already-ready", { status: statusEvidence(initial) });
    return false;
  }
  const button = page.getByRole("button", { name: "Download ComfyUI", exact: true });
  await expect(button).toBeEnabled({ timeout: 60_000 });
  await button.click();
  checkpoint = await updateCheckpoint({ runtimeDownloadObserved: true, runtimeStartedAtUtc: new Date().toISOString() });
  await breadcrumb("runtime-ui-download-started");
  return true;
}

async function startSdxlFromUi(page, initial) {
  if (["ready", "inUse"].includes(initial?.phase)) {
    if (!allowExisting && !hasIncreasingProgress(checkpoint.sdxlProgress)) {
      throw new Error("SDXL is already installed without this harness's progress checkpoint. Use a clean sandbox for actual-download acceptance or pass --allow-existing for receipt-only revalidation.");
    }
    await breadcrumb("sdxl-already-ready", { status: statusEvidence(initial) });
    return false;
  }
  await minimizeDownloads(page);
  await openModelsAndProviders(page);
  const option = page.getByRole("radio", { name: /Stable Diffusion XL 1\.0/i });
  await expect(option).toBeEnabled({ timeout: 60_000 });
  await option.click();
  const downloadPanel = page.locator(".model-download-panel");
  await expect(downloadPanel).toContainText(SDXL.displayName, { timeout: 30_000 });
  await downloadPanel.getByRole("button", { name: /^(?:Download|Resume download)$/ }).click();
  await expect(page.getByRole("alertdialog", { name: /Install ComfyUI with/i })).toHaveCount(0);
  checkpoint = await updateCheckpoint({ sdxlDownloadObserved: true, sdxlStartedAtUtc: new Date().toISOString() });
  await breadcrumb("sdxl-ui-download-started");
  return true;
}

async function exerciseDownloadDrawer(page, spec, timeoutMs) {
  const status = await waitForModelPhase(page, spec, new Set(["downloading", "verifying", "installing", "activating", "ready", "inUse"]), 60_000);
  if (spec === SDXL && status.downloadedBytes < RUNTIME.totalBytes) {
    throw new Error(`SDXL did not account for the already verified shared runtime: ${status.downloadedBytes} bytes`);
  }
  const drawer = page.getByRole("region", { name: "Model downloads" });
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  const item = page.getByRole("article", { name: spec.displayName });
  await expect(item).toBeVisible();
  const progress = item.getByRole("progressbar", { name: `${spec.displayName} download progress` });
  const samples = await collectProgress(page, spec, progress, timeoutMs);
  await page.screenshot({ path: path.join(runRoot, spec === RUNTIME ? "01-runtime-real-progress.png" : "04-sdxl-real-progress.png"), fullPage: true });

  await drawer.getByRole("button", { name: "Minimize downloads" }).click();
  await expect(drawer).toBeHidden();
  const projects = page.getByRole("button", { name: "Projects", exact: true });
  await projects.click();
  await expect(projects).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: /Downloads(?: \(1 active\))?/ }).click();
  await expect(drawer).toBeVisible();
  await expect(item).toBeVisible();
  await breadcrumb("downloads-minimized-navigated-reopened", { modelId: spec.modelId, startingStatus: statusEvidence(status), progressSamples: samples });
  return samples;
}

async function collectProgress(page, spec, progress, timeoutMs) {
  const prior = spec === RUNTIME ? checkpoint.runtimeProgress : checkpoint.sdxlProgress;
  const samples = mergeProgress(prior, []);
  const deadline = Date.now() + timeoutMs;
  let lastBreadcrumbAt = 0;
  while (Date.now() < deadline) {
    const status = await modelStatus(page, spec.modelId);
    if (!status) throw new Error(`${spec.modelId} disappeared from native status`);
    if (["failed", "corrupt", "incompatible", "cancelled"].includes(status.phase)) throw new Error(`${spec.modelId} entered ${status.phase}: ${status.detail}`);
    const uiValue = Number(await progress.getAttribute("value"));
    const sample = { atUtc: new Date().toISOString(), phase: status.phase, downloadedBytes: status.downloadedBytes, totalBytes: status.totalBytes, uiPercent: uiValue };
    if (status.downloadedBytes > 0
      && status.downloadedBytes < status.totalBytes
      && Number.isFinite(uiValue)
      && uiValue > 0
      && uiValue < 100
      && samples.at(-1)?.downloadedBytes !== status.downloadedBytes) samples.push(sample);
    if (Date.now() - lastBreadcrumbAt >= 15_000 || samples.length <= 2 && samples.at(-1) === sample) {
      lastBreadcrumbAt = Date.now();
      await breadcrumb("download-progress", { modelId: spec.modelId, ...sample });
      checkpoint = await updateCheckpoint(spec === RUNTIME ? { runtimeProgress: mergeProgress(checkpoint.runtimeProgress, samples) } : { sdxlProgress: mergeProgress(checkpoint.sdxlProgress, samples) });
    }
    if (hasIncreasingProgress(samples)) return samples;
    if (["ready", "inUse"].includes(status.phase)) {
      if (samples.length === 0 && !allowExisting) throw new Error(`${spec.modelId} completed before the harness observed real byte progress`);
      return samples;
    }
    await delay(1_000);
  }
  throw new Error(`Timed out collecting real progress for ${spec.modelId}`);
}

async function waitForModelPhase(page, spec, terminalPhases, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastPhase;
  let lastBytes = -1;
  let lastBreadcrumbAt = 0;
  while (Date.now() < deadline) {
    const status = await modelStatus(page, spec.modelId);
    if (!status) throw new Error(`${spec.modelId} has no native status`);
    if (["failed", "corrupt", "incompatible", "cancelled"].includes(status.phase)) throw new Error(`${spec.modelId} entered ${status.phase}: ${status.detail}`);
    if (status.phase !== lastPhase || status.downloadedBytes !== lastBytes && Date.now() - lastBreadcrumbAt >= 15_000) {
      lastPhase = status.phase;
      lastBytes = status.downloadedBytes;
      lastBreadcrumbAt = Date.now();
      await breadcrumb("model-status", statusEvidence(status));
    }
    if (terminalPhases.has(status.phase)) return status;
    await delay(1_000);
  }
  throw new Error(`Timed out waiting for ${spec.modelId} to enter ${[...terminalPhases].join(" or ")}`);
}

function assertReadyStatus(status, expected) {
  if (!status || !["ready", "inUse"].includes(status.phase)
    || status.modelId !== expected.modelId
    || status.immutableRevision !== expected.immutableRevision
    || status.totalBytes !== expected.totalBytes
    || status.downloadedBytes !== expected.totalBytes
    || status.verifiedArtifacts !== expected.artifactCount
    || status.artifactCount !== expected.artifactCount
    || status.licenseId !== expected.licenseId
    || status.licenseSha256 !== expected.licenseSha256
    || status.activationBlocked !== false
    || !/^[a-f0-9]{64}$/u.test(status.installFingerprint ?? "")
    || status.runtimeRevision !== expected.immutableRevision
    || !status.licenseAcceptedAt) {
    throw new Error(`${expected.modelId} did not publish its exact ready identity: ${JSON.stringify(status)}`);
  }
}

async function assertDrawerComplete(page, spec) {
  const launcher = page.getByRole("button", { name: /^Downloads/ });
  const drawer = page.getByRole("region", { name: "Model downloads" });
  if (!await drawer.isVisible()) await launcher.click();
  const item = page.getByRole("article", { name: spec.displayName });
  await expect(item).toContainText("Installed", { timeout: 60_000 });
  await expect(item.getByRole("progressbar")).toHaveAttribute("value", "100");
}

async function minimizeDownloads(page) {
  const drawer = page.getByRole("region", { name: "Model downloads" });
  if (await drawer.isVisible()) await drawer.getByRole("button", { name: "Minimize downloads" }).click();
}

async function openModelsAndProviders(page) {
  const nav = page.getByRole("button", { name: "Models & providers", exact: true });
  await nav.click();
  await expect(nav).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Models & providers", exact: true })).toBeVisible({ timeout: 60_000 });
}

async function modelStatus(page, modelId) {
  const statuses = await invokeNative(page, "local_model_download_status");
  return statuses.find((status) => status.modelId === modelId) ?? null;
}

async function invokeNative(page, command, input) {
  return await page.evaluate(async ({ command, input }) => {
    const invoke = globalThis.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") throw new Error("Tauri IPC is unavailable in the native WebView");
    return await invoke(command, input === undefined ? undefined : { input });
  }, { command, input });
}

async function runtimeEntrypointEvidence() {
  const candidates = [
    path.join(comfyRoot, "ComfyUI_windows_portable", "python_embeded", "python.exe"),
    path.join(comfyRoot, "ComfyUI_windows_portable", "ComfyUI", "main.py"),
    path.join(comfyRoot, "venv", "Scripts", "python.exe"),
    path.join(comfyRoot, "ComfyUI", "main.py"),
  ];
  const evidence = [];
  for (const candidate of candidates) {
    const details = await stat(candidate).catch(() => null);
    if (!details?.isFile()) continue;
    evidence.push({ path: candidate, size: details.size, mtimeMs: details.mtimeMs, sha256: await sha256File(candidate, "runtime-entrypoint-hash") });
  }
  if (evidence.length !== 2) throw new Error(`Expected exactly one Python and one ComfyUI entry point, found ${evidence.length}`);
  return evidence;
}

function assertRuntimeWasNotReextracted(before, after) {
  if (before.length !== after.length) throw new Error("The ComfyUI runtime entrypoint set changed during SDXL installation");
  for (const expected of before) {
    const actual = after.find((candidate) => candidate.path === expected.path);
    if (!actual || actual.size !== expected.size || actual.sha256 !== expected.sha256 || actual.mtimeMs !== expected.mtimeMs) {
      throw new Error(`The verified ComfyUI runtime entrypoint changed or was re-extracted: ${expected.path}`);
    }
  }
}

async function fileStatEvidence(file) {
  const details = await stat(file).catch(() => null);
  if (!details?.isFile() || details.size <= 0) throw new Error(`Expected a non-empty regular file at ${file}`);
  return { path: file, size: details.size, mtimeMs: details.mtimeMs };
}

function assertFileStatUnchanged(before, after, message) {
  if (before.path !== after.path || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(message);
}

async function verifyDurableReceiptsAndFiles() {
  const runtimeStatus = await readJson(runtimeStatusPath);
  const sdxlStatus = await readJson(sdxlStatusPath);
  assertReadyStatus(runtimeStatus, RUNTIME);
  assertReadyStatus(sdxlStatus, SDXL);
  const archive = await verifyExactFile(runtimeArchivePath, RUNTIME.totalBytes, RUNTIME.archiveSha256, "runtime-archive");
  const manifest = await readJson(sdxlManifestPath);
  if (manifest.modelId !== SDXL.modelId
    || manifest.recipeId !== SDXL.recipeId
    || manifest.runtimeRevision !== RUNTIME.codeRevision
    || manifest.status !== "hardware-verified-12gb-windows"
    || manifest.license !== SDXL.licenseId) {
    throw new Error(`SDXL preflight manifest identity mismatch: ${JSON.stringify(manifest)}`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== SDXL.files.length) throw new Error("SDXL preflight manifest has an unexpected file list");
  const files = [];
  for (const expected of SDXL.files) {
    const receipt = manifest.files.find((candidate) => candidate.path === expected.relativePath);
    if (!receipt || receipt.size !== expected.size || receipt.sha256 !== expected.sha256) throw new Error(`SDXL preflight receipt mismatch for ${expected.relativePath}`);
    files.push(await verifyExactFile(path.join(comfyInstallRoot, "ComfyUI", ...expected.relativePath.split("/")), expected.size, expected.sha256, `sdxl-${path.basename(expected.relativePath)}`));
  }
  return {
    runtimeStatusPath,
    sdxlStatusPath,
    sdxlManifestPath,
    runtimeArchive: archive,
    sdxlFiles: files,
    runtimeFingerprint: runtimeStatus.installFingerprint,
    sdxlFingerprint: sdxlStatus.installFingerprint,
    recipeId: manifest.recipeId,
    preflightStatus: manifest.status,
  };
}

async function verifyExactFile(file, expectedSize, expectedSha256, label) {
  const details = await stat(file).catch(() => null);
  if (!details?.isFile() || details.size !== expectedSize) throw new Error(`${label} size mismatch at ${file}`);
  const sha256 = await sha256File(file, label);
  if (sha256 !== expectedSha256) throw new Error(`${label} SHA-256 mismatch at ${file}`);
  return { path: file, size: details.size, sha256, mtimeMs: details.mtimeMs };
}

async function sha256File(file, label) {
  const details = await stat(file);
  const hash = createHash("sha256");
  let read = 0;
  let lastReport = 0;
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => {
      hash.update(chunk);
      read += chunk.length;
      if (read - lastReport >= 512 * 1024 * 1024) {
        lastReport = read;
        void breadcrumb("hash-progress", { label, bytesRead: read, totalBytes: details.size }).catch(() => {});
      }
    });
    stream.once("end", resolve);
    stream.once("error", reject);
  });
  return hash.digest("hex");
}

function statusEvidence(status) {
  if (!status) return null;
  return Object.fromEntries(["modelId", "immutableRevision", "installFingerprint", "runtimeRevision", "phase", "downloadedBytes", "totalBytes", "verifiedArtifacts", "artifactCount", "licenseId", "licenseSha256", "activationBlocked", "detail", "updatedAt"].map((key) => [key, status[key]]));
}

function mergeProgress(left = [], right = []) {
  const merged = new Map();
  for (const sample of [...left, ...right]) merged.set(`${sample.phase}:${sample.downloadedBytes}`, sample);
  return [...merged.values()].sort((a, b) => a.downloadedBytes - b.downloadedBytes).slice(-250);
}

function hasIncreasingProgress(samples = []) {
  return samples.some((candidate, index) => index > 0
    && candidate.downloadedBytes > samples[index - 1].downloadedBytes
    && candidate.uiPercent > samples[index - 1].uiPercent);
}

async function updateCheckpoint(changes) {
  const next = { ...checkpoint, schemaVersion: 1, portableRoot, ...changes, updatedAtUtc: new Date().toISOString() };
  await writeJson(checkpointPath, next);
  return next;
}

async function breadcrumb(stage, details = {}) {
  const record = { schemaVersion: 1, runId, atUtc: new Date().toISOString(), stage, ...details };
  await appendFile(breadcrumbPath, `${JSON.stringify(record)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT" && arguments.length > 1) return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rm(file, { force: true });
  await rename(temporary, file);
}

async function recoverInterruptedOwnerIsolation() {
  const prior = await readJson(journalPath, null);
  if (!prior) return;
  await waitForPortableWebViewExit(30_000);
  const recoveryRoot = path.join(evidenceRoot, "recovered-isolation", runId);
  await mkdir(recoveryRoot, { recursive: true });
  for (const entry of prior.entries ?? []) {
    const backupExists = await pathExists(entry.backup);
    if (entry.hadOwner && !backupExists) {
      if (!await pathExists(entry.target)) throw new Error(`Interrupted isolation lost both owner paths for ${entry.label}`);
      continue;
    }
    if (await pathExists(entry.target)) await renameWithRetry(entry.target, path.join(recoveryRoot, entry.label), 30_000);
    if (entry.hadOwner) await renameWithRetry(entry.backup, entry.target, 30_000);
    else await mkdir(entry.target, { recursive: true });
  }
  await rm(journalPath, { force: true });
  await breadcrumb("interrupted-owner-isolation-recovered", { recoveryRoot });
}

async function isolateOwnerDirectories() {
  const stamp = `${new Date().toISOString().replace(/[^0-9]/gu, "")}-${process.pid}`;
  const entries = [
    { label: "app-data", target: appDataPath, backup: `${appDataPath}.owner-preserved-${stamp}` },
    { label: "projects", target: projectsPath, backup: `${projectsPath}.owner-preserved-${stamp}` },
  ];
  for (const entry of entries) {
    const details = await lstat(entry.target).catch(() => null);
    if (details?.isSymbolicLink() || details && !details.isDirectory()) throw new Error(`Owner ${entry.label} path is unsafe: ${entry.target}`);
    entry.hadOwner = Boolean(details);
  }
  await writeJson(journalPath, { schemaVersion: 1, runId, entries });
  for (const entry of entries) {
    if (entry.hadOwner) await renameWithRetry(entry.target, entry.backup, 30_000);
    await mkdir(entry.target, { recursive: false });
  }
  await breadcrumb("owner-state-isolated", { entries: entries.map(({ label, hadOwner }) => ({ label, hadOwner })) });
  return { entries };
}

async function preserveIsolatedStateAndRestoreOwner(current) {
  await waitForPortableWebViewExit(30_000);
  for (const entry of current.entries) {
    const destination = path.join(runRoot, `isolated-${entry.label}`);
    if (await pathExists(entry.target)) await renameWithRetry(entry.target, destination, 30_000);
    if (entry.hadOwner) await renameWithRetry(entry.backup, entry.target, 30_000);
    else await mkdir(entry.target, { recursive: true });
  }
  await rm(journalPath, { force: true });
  isolation = undefined;
  await breadcrumb("owner-state-restored");
}

async function pathExists(target) {
  try { await lstat(target); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

async function seedCleanWorkspace(page) {
  await page.evaluate(({ onboarding, workspace }) => {
    globalThis.localStorage.clear();
    globalThis.localStorage.setItem("alystria-onboarding-v1", JSON.stringify(onboarding));
    globalThis.localStorage.setItem("alystria-guided-tour-v1", "completed");
    globalThis.localStorage.setItem("alystria-studio-v2", JSON.stringify(workspace));
  }, {
    onboarding: completedOnboarding(),
    workspace: { projects: [], recentProjectId: null, studioMode: "guided", version: 0, jobs: [] },
  });
  await page.reload({ waitUntil: "domcontentloaded" });
}

function completedOnboarding() {
  const chapters = ["welcome", "goal", "runtime", "provider", "hardware", "model", "profile", "ready"];
  return { schemaVersion: 1, status: "completed", activeChapterId: "ready", completedChapterIds: chapters, visitedChapterIds: chapters, configuration: { goals: ["tutorial"], runtime: "local", privacy: null, providerIds: [], modelIds: [], hardwareReviewed: true, profile: { displayName: "Runtime install acceptance", portraitAssetId: "presenter-portrait.broadcast-elena-v1" } }, revision: 8, updatedAt: new Date().toISOString() };
}

function nativeEnvironment(port) {
  return { ...process.env, ALYSTRIA_HEADLESS_ACCEPTANCE: "1", ALYSTRIA_HEADLESS_ACCEPTANCE_CDP_PORT: String(port) };
}

async function startNative(logPrefix) {
  await rotateExistingPath(readyPath, `${logPrefix}-previous`);
  const port = await reservePort();
  const stdout = await open(path.join(runRoot, `${logPrefix}.stdout.log`), "w");
  const stderr = await open(path.join(runRoot, `${logPrefix}.stderr.log`), "w");
  const child = spawn(executable, [], { cwd: portableRoot, env: nativeEnvironment(port), windowsHide: true, stdio: ["ignore", stdout.fd, stderr.fd] });
  let browser;
  let workerPid;
  try {
    browser = await connectToWebView(port, 120_000, child);
    const ready = await waitForJson(readyPath, 120_000, child);
    workerPid = validatedReadyWorkerPid(ready, child.pid);
    const pages = browser.contexts().flatMap((context) => context.pages());
    if (pages.length !== 1) throw new Error(`Expected one native WebView page, found ${pages.length}`);
    return { child, browser, page: pages[0], workerPid, stdout, stderr };
  } catch (error) {
    workerPid ||= await readReadyWorkerPid(child.pid);
    const errors = await cleanupFailedNativeStart({ child, browser, workerPid, stdout, stderr });
    if (errors.length) throw new AggregateError([error, ...errors], "Native runtime-install launch and cleanup both failed");
    throw error;
  }
}

async function startBootstrapNative() {
  await rotateExistingPath(readyPath, "bootstrap-previous");
  const port = await reservePort();
  const stdout = await open(path.join(runRoot, "bootstrap.stdout.log"), "w");
  const stderr = await open(path.join(runRoot, "bootstrap.stderr.log"), "w");
  const child = spawn(executable, [], { cwd: portableRoot, env: nativeEnvironment(port), windowsHide: true, stdio: ["ignore", stdout.fd, stderr.fd] });
  const current = { child, workerPid: undefined, stdout, stderr };
  bootstrapLaunch = current;
  try {
    const ready = await waitForJson(readyPath, 120_000, child);
    current.workerPid = validatedReadyWorkerPid(ready, child.pid);
    return current;
  } catch (error) {
    current.workerPid ||= await readReadyWorkerPid(child.pid);
    throw error;
  }
}

async function closeBootstrapNative(current) {
  let failure;
  try {
    await stopChildAndWorker(current);
  } catch (error) { failure = error; }
  finally { await Promise.all([current.stdout.close(), current.stderr.close()]); }
  if (failure) throw failure;
}

async function closeNative(current) {
  let failure;
  try { await stopChildAndWorker(current); }
  catch (error) { failure = error; }
  finally {
    await current.browser.close().catch(() => {});
    await Promise.all([current.stdout.close(), current.stderr.close()]);
  }
  if (failure) throw failure;
}

async function stopChildAndWorker(current) {
  let failure;
  try {
    if (current.child.exitCode === null) {
      await postWmClose(current.child.pid);
      await Promise.race([new Promise((resolve) => current.child.once("exit", resolve)), delay(15_000)]);
    }
    if (current.child.exitCode === null) throw new Error(`Native app ${current.child.pid} did not exit within 15 seconds of WM_CLOSE`);
    if (current.child.exitCode !== 0) throw new Error(`Native app exited with code ${current.child.exitCode}`);
  } catch (error) {
    failure = error;
    if (current.child.exitCode === null) {
      current.child.kill();
      await Promise.race([new Promise((resolve) => current.child.once("exit", resolve)), delay(5_000)]);
    }
  }
  if (current.workerPid && !await waitForProcessExit(current.workerPid, 10_000)) {
    try { process.kill(current.workerPid); } catch (error) { if (error?.code !== "ESRCH" && !failure) failure = error; }
    if (!await waitForProcessExit(current.workerPid, 5_000) && !failure) failure = new Error(`Native worker ${current.workerPid} remained alive after app shutdown`);
  }
  await waitForPortableWebViewExit(30_000).catch((error) => { if (!failure) failure = error; });
  if (failure) throw failure;
}

async function cleanupFailedNativeStart({ child, browser, workerPid, stdout, stderr }) {
  const errors = [];
  if (browser) await browser.close().catch((error) => errors.push(error));
  if (child.exitCode === null) await postWmClose(child.pid).catch((error) => errors.push(error));
  if (child.exitCode === null) await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(15_000)]);
  if (child.exitCode === null) child.kill();
  if (workerPid && !await waitForProcessExit(workerPid, 10_000)) {
    try { process.kill(workerPid); } catch (error) { if (error?.code !== "ESRCH") errors.push(error); }
  }
  await waitForPortableWebViewExit(30_000).catch((error) => errors.push(error));
  await Promise.all([stdout.close(), stderr.close()]).catch((error) => errors.push(error));
  return errors;
}

async function readReadyWorkerPid(desktopPid) {
  try { return validatedReadyWorkerPid(await readJson(readyPath), desktopPid); }
  catch { return undefined; }
}

function validatedReadyWorkerPid(ready, desktopPid) {
  const workerPid = Number(ready?.workerPid);
  if (ready?.schemaVersion !== 1 || ready?.workerHandshake !== true || Number(ready?.desktopPid) !== desktopPid) throw new Error("Native readiness receipt does not identify this authenticated desktop launch");
  if (!Number.isSafeInteger(workerPid) || workerPid <= 0) throw new Error("Native readiness receipt has an invalid worker PID");
  return workerPid;
}

async function waitForJson(file, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await readJson(file);
      if (value?.state === "failed") throw new Error(`Native startup failed: ${value.reason ?? "unknown"}`);
      if (value?.state === "ready") return value;
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    if (child.exitCode !== null) throw new Error(`Native app exited ${child.exitCode} before readiness`);
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function connectToWebView(port, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${port}`); }
    catch (error) { lastError = error; }
    if (child.exitCode !== null) throw new Error(`Native app exited ${child.exitCode} before WebView attachment`);
    await delay(200);
  }
  throw new Error(`Could not attach to the native WebView: ${lastError}`);
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function postWmClose(pid) {
  const helper = path.join(repoRoot, "scripts", "post-wm-close.py");
  const child = spawn(process.env.PYTHON ?? "python", [helper, "--pid", String(pid)], { windowsHide: true, stdio: "ignore" });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`WM_CLOSE helper exited ${code}`)));
  });
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return true; }
    await delay(100);
  }
  return false;
}

async function portableWebViewExists() {
  const appDataNeedle = appDataPath.replaceAll("'", "''");
  const command = [
    `$needle = '${appDataNeedle}'`,
    "$match = Get-CimInstance Win32_Process | Where-Object {",
    "  $_.Name -eq 'msedgewebview2.exe' -and",
    "  $_.CommandLine -like \"*$needle*\" -and",
    "  $_.CommandLine -like '*webview-exe-name=*AI Video Tutorial Generator.exe*'",
    "}",
    "if ($match) { exit 0 } else { exit 1 }",
  ].join("; ");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, stdio: "ignore" });
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(true);
      else if (code === 1) resolve(false);
      else reject(new Error(`Portable WebView inspection failed with PowerShell exit code ${code}`));
    });
  });
}

async function waitForPortableWebViewExit(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await portableWebViewExists()) return;
    await delay(200);
  }
  throw new Error("Portable WebView processes remained alive after native shutdown");
}

async function rotateExistingPath(target, label) {
  const details = await stat(target).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!details) return null;
  const parsed = path.parse(target);
  const destination = path.join(parsed.dir, `${parsed.name}.${label}-${runId}${parsed.ext}`);
  await rename(target, destination);
  return destination;
}

async function renameWithRetry(source, destination, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { await rename(source, destination); return; }
    catch (error) {
      if (!["EACCES", "EBUSY", "EPERM"].includes(error?.code)) throw error;
      lastError = error;
      await delay(200);
    }
  }
  throw lastError ?? new Error(`Timed out moving ${source} to ${destination}`);
}

function delay(milliseconds) { return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)); }
