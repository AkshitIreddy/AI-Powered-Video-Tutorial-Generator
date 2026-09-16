import { chromium, expect } from "@playwright/test";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { lstat, mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const FIXTURE_ID = "acceptance/download-fixture-v1";
const FIXTURE_NAME = "Acceptance download fixture (4 MiB)";
const FIXTURE_LICENSE_SHA256 = "3333333333333333333333333333333333333333333333333333333333333333";
const FIXTURE_BYTES = 4 * 1024 * 1024;
const FIXTURE_SHA256 = "bb9f8df61474d25e71fa00722318cd387396ca1736605e1248821cc0de3d3af8";
const FIXTURE_PATH = "/alystria-model-download-fixture.bin";

const portableIndex = process.argv.indexOf("--portable-root");
if (portableIndex < 0 || !process.argv[portableIndex + 1]) throw new Error("--portable-root is required");
const portableRoot = path.resolve(process.argv[portableIndex + 1]);
const executable = path.join(portableRoot, "App", "AI Video Tutorial Generator.exe");
const evidenceRoot = path.join(portableRoot, "Evidence", "native-downloads");
const readyPath = path.join(portableRoot, "Evidence", "native-headless-ready.json");
const appDataPath = path.join(portableRoot, "App Data");
const fixturePackagePath = path.join(
  portableRoot,
  "Models",
  "download-quarantine",
  "acceptance--download-fixture-v1",
);
const fixtureArtifactPath = path.join(
  fixturePackagePath,
  "portable-debug-loopback-fixture-v1",
  "files",
  "fixture",
  "alystria-model-download-fixture.bin",
);
const fixtureStatusPath = path.join(
  fixturePackagePath,
  "portable-debug-loopback-fixture-v1",
  "download-status.json",
);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

let rotationSequence = 0;
let launch;
let bootstrapLaunch;
let fixtureServer;
let report;
let workError;
let cleanupError;
let ownerAppDataBackup;
let isolatedAppDataEvidencePath;
let ownerStateRestored = false;
let appDataIsolationActive = false;
let ownerFixtureBackup;
let fixturePackageEvidencePath;
let ownerFixtureRestored = false;
let fixtureIsolationActive = false;

await rotateExistingPath(evidenceRoot);
await mkdir(evidenceRoot, { recursive: true });
await rotateExistingPath(readyPath);

try {
  await waitForPortableWebViewExit(30_000);
  await isolateOwnerAppData();
  await isolateFixturePackage();
  fixtureServer = await startFixtureServer();

  bootstrapLaunch = await startBootstrapNative();
  const bootstrapDesktopPid = bootstrapLaunch.child.pid;
  const bootstrapWorkerPid = bootstrapLaunch.workerPid;
  await closeBootstrapNative(bootstrapLaunch);
  bootstrapLaunch = undefined;
  await rotateExistingPath(readyPath, "bootstrap-ready");

  launch = await startNative("desktop");
  const { page } = launch;
  const dialog = page.locator(".aly-onboarding-dialog");
  await expect(dialog).toBeVisible({ timeout: 45_000 });
  await expect(dialog.getByRole("heading", { name: "Make AI Video Tutorial Generator yours" })).toBeVisible();
  await continueOnboarding(dialog);
  await dialog.locator('input[type="checkbox"][value="tutorial"]').check();
  await continueOnboarding(dialog);
  await dialog.locator('input[type="radio"][value="hybrid"]').check();
  await continueOnboarding(dialog);
  await continueOnboarding(dialog);
  const hardwareReview = dialog.getByRole("checkbox", { name: /reviewed this system summary/i });
  if (!await hardwareReview.isChecked()) await hardwareReview.check();
  await continueOnboarding(dialog);
  await expect(dialog.getByRole("heading", { name: "Choose your model toolkit" })).toBeVisible();

  const mappedCatalog = await invokeNative(page, "local_model_download_catalog");
  const fixtureCatalogEntry = mappedCatalog.find((entry) => entry.modelId === FIXTURE_ID);
  if (!fixtureCatalogEntry
    || fixtureCatalogEntry.displayName !== FIXTURE_NAME
    || fixtureCatalogEntry.totalBytes !== FIXTURE_BYTES
    || fixtureCatalogEntry.licenseSha256 !== FIXTURE_LICENSE_SHA256
    || fixtureCatalogEntry.available !== true) {
    throw new Error(`The portable-debug native catalog did not expose the exact acceptance fixture declaration: ${JSON.stringify({
      entries: mappedCatalog.map(({ modelId, displayName, totalBytes, licenseSha256, available }) => ({ modelId, displayName, totalBytes, licenseSha256, available })),
    })}`);
  }
  const fixtureChoice = dialog.locator(`input[type="checkbox"][value="${FIXTURE_ID}"]`);
  const fixtureCardLabel = dialog.getByText(FIXTURE_NAME, { exact: true });
  await expect(fixtureCardLabel).toBeVisible();
  await expect(fixtureChoice).toBeVisible();
  await expect(fixtureChoice).toBeEnabled();
  await page.screenshot({ path: path.join(evidenceRoot, "01-onboarding-model-toolkit.png"), fullPage: true });

  await fixtureCardLabel.click();
  await expect(dialog).toBeHidden();
  await waitForFixturePhase(page, new Set(["downloading", "verifying"]), 30_000);
  const drawer = page.getByRole("region", { name: "Model downloads" });
  await expect(drawer).toBeVisible();
  const item = page.getByRole("article", { name: FIXTURE_NAME });
  await expect(item).toBeVisible({ timeout: 20_000 });
  const progress = item.getByRole("progressbar", { name: `${FIXTURE_NAME} download progress` });
  const progressSamples = await collectIncreasingProgress(progress, 30_000);
  await page.screenshot({ path: path.join(evidenceRoot, "02-real-byte-progress.png"), fullPage: true });

  await drawer.getByRole("button", { name: "Minimize downloads" }).click();
  await expect(drawer).toBeHidden();
  const projects = page.getByRole("button", { name: "Projects", exact: true });
  await projects.click();
  await expect(projects).toHaveAttribute("aria-current", "page");
  await page.screenshot({ path: path.join(evidenceRoot, "03-minimized-while-navigating.png"), fullPage: true });
  await page.waitForTimeout(1_500);
  await page.getByRole("button", { name: /Downloads(?: \(1 active\))?/ }).click();
  await expect(drawer).toBeVisible();
  await expect(item.getByText("Files downloaded", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(progress).toHaveAttribute("value", "100");
  await fixtureServer.completed;
  if (fixtureServer.requestCount !== 1) {
    throw new Error(`Expected one fixture request, observed ${fixtureServer.requestCount}`);
  }
  if (fixtureServer.errors.length) throw fixtureServer.errors[0];
  await page.screenshot({ path: path.join(evidenceRoot, "04-download-complete.png"), fullPage: true });

  const fixtureBytes = await readFile(fixtureArtifactPath);
  const fixtureHash = createHash("sha256").update(fixtureBytes).digest("hex");
  if (fixtureBytes.length !== FIXTURE_BYTES || fixtureHash !== FIXTURE_SHA256) {
    throw new Error(`Downloaded fixture identity mismatch: ${fixtureBytes.length} bytes, ${fixtureHash}`);
  }
  const durableStatus = JSON.parse(await readFile(fixtureStatusPath, "utf8"));
  if (durableStatus.modelId !== FIXTURE_ID
    || durableStatus.phase !== "downloadedQuarantined"
    || durableStatus.downloadedBytes !== FIXTURE_BYTES
    || durableStatus.verifiedArtifacts !== 1
    || durableStatus.activationBlocked !== true) {
    throw new Error("The durable native fixture status did not record verified quarantined completion");
  }

  await drawer.getByRole("button", { name: "Minimize downloads" }).click();
  const settings = page.getByRole("button", { name: "Settings & diagnostics", exact: true });
  await settings.click();
  await expect(page.getByRole("heading", { name: "A healthy studio is predictable." })).toBeVisible();
  await page.getByRole("button", { name: "Replay setup" }).click();
  await expect(dialog).toBeVisible({ timeout: 45_000 });
  await expect(dialog.getByRole("heading", { name: "Make AI Video Tutorial Generator yours" })).toBeVisible();
  await continueOnboarding(dialog);
  await continueOnboarding(dialog);
  await continueOnboarding(dialog);
  await continueOnboarding(dialog);
  await continueOnboarding(dialog);
  await expect(dialog.getByRole("heading", { name: "Choose your model toolkit" })).toBeVisible();
  await continueOnboarding(dialog);
  const displayName = dialog.getByLabel("Display name");
  if (!(await displayName.inputValue()).trim()) await displayName.fill("Akshit");
  if (!await dialog.locator('input[type="radio"]:checked').count()) {
    await dialog.locator(".aly-onboarding-profile__portrait:not(.aly-onboarding-profile__portrait--disabled)").first().click();
  }
  await continueOnboarding(dialog);
  await expect(dialog.getByRole("heading", { name: "Your studio plan is ready" })).toBeVisible();
  await dialog.getByRole("button", { name: "Enter AI Video Tutorial Generator" }).click();
  const tour = page.locator(".aly-onboarding-tour");
  if (await tour.isVisible()) await tour.getByRole("button", { name: "Exit tour" }).click();
  await expect(page.getByRole("heading", { name: "Your teaching workbench." })).toBeVisible({ timeout: 45_000 });

  const firstDesktopPid = launch.child.pid;
  const firstWorkerPid = launch.workerPid;
  await closeNative(launch);
  launch = undefined;
  await rotateExistingPath(readyPath, "first-launch-ready");

  launch = await startNative("relaunch");
  await expect(launch.page.locator(".aly-onboarding-dialog")).toBeHidden({ timeout: 45_000 });
  await expect(launch.page.getByRole("heading", { name: "Your teaching workbench." })).toBeVisible({ timeout: 45_000 });
  await launch.page.getByRole("button", { name: "Downloads", exact: true }).click();
  const relaunchedDrawer = launch.page.getByRole("region", { name: "Model downloads" });
  await expect(relaunchedDrawer).toBeVisible();
  const relaunchedItem = launch.page.getByRole("article", { name: FIXTURE_NAME });
  await expect(relaunchedItem.getByText("Files downloaded", { exact: true })).toBeVisible();
  await expect(relaunchedItem.getByRole("progressbar")).toHaveAttribute("value", "100");
  await launch.page.waitForTimeout(1_500);
  if (fixtureServer.requestCount !== 1) {
    throw new Error("A completed hash-pinned fixture was fetched again after normal restart");
  }
  const relaunchedStatus = await fixtureStatus(launch.page);
  if (relaunchedStatus?.phase !== "downloadedQuarantined" || relaunchedStatus.downloadedBytes !== FIXTURE_BYTES) {
    throw new Error("Normal restart did not restore the completed model download status");
  }
  await launch.page.screenshot({ path: path.join(evidenceRoot, "05-persisted-completion-after-restart.png"), fullPage: true });

  report = {
    schemaVersion: 1,
    state: "passed",
    evidenceClass: "packaged-native-model-download",
    actualNativeWebView: true,
    hiddenLaunch: true,
    fixtureProductionUiVisible: false,
    fixturePortableDebugUiVisible: true,
    fixtureStartMechanism: "portable-debug native catalog card selected in onboarding",
    fixtureModelId: FIXTURE_ID,
    instrumentation: {
      scope: "portable-debug native fixture enabled only by this harness's validated loopback endpoint environment variable",
      productionUiChanged: false,
      claim: "test fixture transport only; no real model was installed",
      onboardingCardClickProven: true,
    },
    fixtureBytes: FIXTURE_BYTES,
    fixtureSha256: fixtureHash,
    serverRequestCount: fixtureServer.requestCount,
    progressSamples,
    minimizedDuringDownload: true,
    navigatedDuringDownload: true,
    reopenedDuringDownload: true,
    durableCompletion: durableStatus,
    normalRelaunchCompleted: true,
    relaunchedStatus,
    webViewProfileBootstrap: {
      desktopPid: bootstrapDesktopPid,
      workerPid: bootstrapWorkerPid,
      healthyNativeHandshake: true,
      cdpInspected: false,
    },
    desktopPids: [firstDesktopPid, launch.child.pid],
    workerPids: [firstWorkerPid, launch.workerPid],
    finishedAtUtc: new Date().toISOString(),
  };
} catch (error) {
  workError = error;
} finally {
  const cleanupErrors = [];
  if (bootstrapLaunch) await closeBootstrapNative(bootstrapLaunch).catch((error) => cleanupErrors.push(error));
  if (launch) await closeNative(launch).catch((error) => cleanupErrors.push(error));
  if (fixtureServer) await fixtureServer.close().catch((error) => cleanupErrors.push(error));
  if (fixtureIsolationActive) await preserveFixturePackageAndRestoreOwner().catch((error) => cleanupErrors.push(error));
  if (appDataIsolationActive) await preserveIsolatedAppDataAndRestoreOwner().catch((error) => cleanupErrors.push(error));
  if (cleanupErrors.length) {
    cleanupError = workError
      ? new AggregateError([workError, ...cleanupErrors], "Native download proof failed and cleanup also failed")
      : new AggregateError(cleanupErrors, "Native download proof cleanup failed");
  }
}

if (cleanupError) throw cleanupError;
if (workError) throw workError;

if (report) {
  report.gracefulShutdown = true;
  report.workerExitedWithApp = true;
  report.isolatedPortableAppData = true;
  report.isolatedAppDataEvidencePath = isolatedAppDataEvidencePath;
  report.fixturePackageEvidencePath = fixturePackageEvidencePath;
  report.ownerStateRestored = ownerStateRestored;
  report.ownerFixtureRestored = ownerFixtureRestored;
  await writeFile(path.join(evidenceRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function collectIncreasingProgress(progress, timeoutMs) {
  const samples = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = Number(await progress.getAttribute("value"));
    if (Number.isFinite(value) && value > 0 && value < 100 && samples.at(-1) !== value) samples.push(value);
    if (samples.length >= 2 && samples[1] > samples[0]) return samples;
    await delay(200);
  }
  throw new Error(`The native drawer did not show two increasing real progress samples: ${samples.join(", ") || "none"}`);
}

async function waitForFixturePhase(page, phases, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await fixtureStatus(page);
    if (status && phases.has(status.phase)) return status;
    if (status?.phase === "failed") throw new Error(`Fixture download failed: ${status.detail}`);
    await delay(100);
  }
  throw new Error(`Fixture did not enter ${[...phases].join(" or ")}`);
}

async function fixtureStatus(page) {
  const statuses = await invokeNative(page, "local_model_download_status");
  return statuses.find((status) => status.modelId === FIXTURE_ID);
}

async function invokeNative(page, command, input) {
  return await page.evaluate(async ({ command, input }) => {
    const invoke = globalThis.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") throw new Error("Native Tauri invoke bridge is unavailable");
    return await invoke(command, input === undefined ? undefined : { input });
  }, { command, input });
}

async function startFixtureServer() {
  let requestCount = 0;
  const errors = [];
  let resolveCompleted;
  let rejectCompleted;
  let completionSettled = false;
  const completed = new Promise((resolve, reject) => {
    resolveCompleted = resolve;
    rejectCompleted = reject;
  });
  const server = createServer((request, response) => {
    requestCount += 1;
    void (async () => {
      if (requestCount !== 1) throw new Error("The acceptance fixture was requested more than once");
      if (request.method !== "GET" || request.url !== FIXTURE_PATH || request.headers.range !== undefined) {
        throw new Error("The acceptance fixture request did not match the pinned initial-download boundary");
      }
      const remote = request.socket.remoteAddress;
      if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") {
        throw new Error(`The acceptance fixture request was not loopback: ${remote ?? "unknown"}`);
      }
      response.writeHead(200, {
        "Content-Length": FIXTURE_BYTES,
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        Connection: "close",
      });
      const chunk = Buffer.alloc(32 * 1024);
      for (let written = 0; written < FIXTURE_BYTES; written += chunk.length) {
        if (!response.write(chunk)) await once(response, "drain");
        await delay(200);
      }
      response.end();
      completionSettled = true;
      resolveCompleted();
    })().catch((error) => {
      errors.push(error);
      if (!response.headersSent) response.writeHead(400, { Connection: "close" });
      response.destroy();
      if (!completionSettled) {
        completionSettled = true;
        rejectCompleted(error);
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not bind an IPv4 port");
  return {
    completed,
    errors,
    get requestCount() { return requestCount; },
    url: `http://127.0.0.1:${address.port}${FIXTURE_PATH}`,
    async close() {
      if (!server.listening) return;
      const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      server.closeAllConnections?.();
      await closed;
    },
  };
}

async function isolateOwnerAppData() {
  try {
    const details = await lstat(appDataPath);
    if (details.isSymbolicLink()) throw new Error(`Portable App Data is a symbolic link or junction: ${appDataPath}`);
    const stamp = new Date().toISOString().replace(/[^0-9]/gu, "");
    ownerAppDataBackup = path.join(portableRoot, `App Data.owner-preserved-${stamp}-${process.pid}`);
    await rename(appDataPath, ownerAppDataBackup);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    await mkdir(appDataPath, { recursive: false });
    appDataIsolationActive = true;
  } catch (error) {
    if (ownerAppDataBackup) await rename(ownerAppDataBackup, appDataPath);
    throw error;
  }
}

async function isolateFixturePackage() {
  await mkdir(path.dirname(fixturePackagePath), { recursive: true });
  try {
    const details = await lstat(fixturePackagePath);
    if (details.isSymbolicLink() || !details.isDirectory()) throw new Error(`Fixture package path is unsafe: ${fixturePackagePath}`);
    const stamp = new Date().toISOString().replace(/[^0-9]/gu, "");
    ownerFixtureBackup = `${fixturePackagePath}.owner-preserved-${stamp}-${process.pid}`;
    await rename(fixturePackagePath, ownerFixtureBackup);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  fixtureIsolationActive = true;
}

async function preserveIsolatedAppDataAndRestoreOwner() {
  await waitForPortableWebViewExit(30_000);
  const details = await lstat(appDataPath);
  if (details.isSymbolicLink()) throw new Error(`Isolated App Data became a symbolic link or junction: ${appDataPath}`);
  isolatedAppDataEvidencePath = path.join(evidenceRoot, "isolated-app-data");
  await renameWithRetry(appDataPath, isolatedAppDataEvidencePath, 15_000);
  if (ownerAppDataBackup) await renameWithRetry(ownerAppDataBackup, appDataPath, 15_000);
  else await mkdir(appDataPath, { recursive: false });
  ownerStateRestored = true;
  appDataIsolationActive = false;
}

async function preserveFixturePackageAndRestoreOwner() {
  await waitForPortableWebViewExit(30_000);
  try {
    const details = await lstat(fixturePackagePath);
    if (details.isSymbolicLink() || !details.isDirectory()) throw new Error(`Generated fixture package path is unsafe: ${fixturePackagePath}`);
    fixturePackageEvidencePath = path.join(evidenceRoot, "fixture-package");
    await renameWithRetry(fixturePackagePath, fixturePackageEvidencePath, 15_000);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (ownerFixtureBackup) await renameWithRetry(ownerFixtureBackup, fixturePackagePath, 15_000);
  ownerFixtureRestored = true;
  fixtureIsolationActive = false;
}

async function continueOnboarding(dialog) {
  await dialog.getByRole("button", { name: /continue/i }).click();
}

function nativeEnvironment(port) {
  return {
    ...process.env,
    ALYSTRIA_HEADLESS_ACCEPTANCE: "1",
    ALYSTRIA_HEADLESS_ACCEPTANCE_CDP_PORT: String(port),
    ALYSTRIA_ACCEPTANCE_MODEL_DOWNLOAD_URL: fixtureServer.url,
  };
}

async function startNative(logPrefix = "desktop") {
  const port = await reservePort();
  const stdout = await open(path.join(evidenceRoot, `${logPrefix}.stdout.log`), "w");
  const stderr = await open(path.join(evidenceRoot, `${logPrefix}.stderr.log`), "w");
  const child = spawn(executable, [], {
    cwd: portableRoot,
    env: nativeEnvironment(port),
    windowsHide: true,
    stdio: ["ignore", stdout.fd, stderr.fd],
  });
  let browser;
  let workerPid;
  try {
    browser = await connectToWebView(port, 120_000, child);
    const ready = await waitForJson(readyPath, 120_000, child);
    workerPid = validatedReadyWorkerPid(ready, child.pid);
    const pages = browser.contexts().flatMap((context) => context.pages());
    if (pages.length !== 1) throw new Error(`Expected one native WebView page, found ${pages.length}`);
    const page = pages[0];
    return { child, browser, page, workerPid, stdout, stderr };
  } catch (error) {
    workerPid ||= await readReadyWorkerPid(child.pid);
    const cleanupErrors = await cleanupFailedNativeStart({ child, browser, workerPid, stdout, stderr });
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "Native download launch and startup cleanup both failed");
    throw error;
  }
}

async function startBootstrapNative() {
  const port = await reservePort();
  const stdout = await open(path.join(evidenceRoot, "bootstrap.stdout.log"), "w");
  const stderr = await open(path.join(evidenceRoot, "bootstrap.stderr.log"), "w");
  const child = spawn(executable, [], {
    cwd: portableRoot,
    env: nativeEnvironment(port),
    windowsHide: true,
    stdio: ["ignore", stdout.fd, stderr.fd],
  });
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

async function readReadyWorkerPid(desktopPid) {
  try { return validatedReadyWorkerPid(JSON.parse(await readFile(readyPath, "utf8")), desktopPid); }
  catch { return undefined; }
}

function validatedReadyWorkerPid(ready, desktopPid) {
  const workerPid = Number(ready?.workerPid);
  if (ready?.schemaVersion !== 1 || ready?.workerHandshake !== true || Number(ready?.desktopPid) !== desktopPid) {
    throw new Error("Native readiness receipt does not identify this authenticated desktop launch");
  }
  if (!Number.isSafeInteger(workerPid) || workerPid <= 0) throw new Error("Native readiness receipt has an invalid worker PID");
  return workerPid;
}

async function cleanupFailedNativeStart({ child, browser, workerPid, stdout, stderr }) {
  const errors = [];
  if (browser) await browser.close().catch((error) => errors.push(error));
  if (child.exitCode === null) {
    await postWmClose(child.pid).catch((error) => errors.push(error));
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(15_000)]);
  }
  if (child.exitCode === null) {
    child.kill();
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(5_000)]);
  }
  if (workerPid && !await waitForProcessExit(workerPid, 10_000)) {
    try { process.kill(workerPid); } catch (error) { if (error?.code !== "ESRCH") errors.push(error); }
    if (!await waitForProcessExit(workerPid, 5_000)) errors.push(new Error(`Native worker ${workerPid} remained alive after failed startup cleanup`));
  }
  await waitForPortableWebViewExit(30_000).catch((error) => errors.push(error));
  await Promise.all([stdout.close(), stderr.close()]).catch((error) => errors.push(error));
  return errors;
}

async function closeBootstrapNative(current) {
  let closeError;
  try {
    if (current.child.exitCode === null) {
      await postWmClose(current.child.pid);
      await Promise.race([new Promise((resolve) => current.child.once("exit", resolve)), delay(15_000)]);
    }
    if (current.child.exitCode === null) {
      current.child.kill();
      throw new Error("Bootstrap native app did not exit within 15 seconds of WM_CLOSE");
    }
    if (current.child.exitCode !== 0) throw new Error(`Bootstrap native app exited with code ${current.child.exitCode}`);
    if (current.workerPid && !await waitForProcessExit(current.workerPid, 10_000)) {
      throw new Error(`Bootstrap native worker ${current.workerPid} remained alive after WM_CLOSE`);
    }
    await waitForPortableWebViewExit(30_000);
  } catch (error) {
    closeError = error;
    if (current.child.exitCode === null) current.child.kill();
  } finally {
    await Promise.all([current.stdout.close(), current.stderr.close()]);
  }
  if (closeError) throw closeError;
}

async function closeNative(current) {
  let closeError;
  try {
    if (current.child.exitCode === null) {
      await postWmClose(current.child.pid);
      await Promise.race([new Promise((resolve) => current.child.once("exit", resolve)), delay(15_000)]);
    }
    if (current.child.exitCode === null) {
      current.child.kill();
      throw new Error("Native app did not exit within 15 seconds of WM_CLOSE");
    }
    if (current.child.exitCode !== 0) throw new Error(`Native app exited with code ${current.child.exitCode}`);
    if (!await waitForProcessExit(current.workerPid, 10_000)) throw new Error(`Native worker ${current.workerPid} remained alive after WM_CLOSE`);
    await waitForPortableWebViewExit(30_000);
  } catch (error) {
    closeError = error;
    if (current.child.exitCode === null) current.child.kill();
  } finally {
    await current.browser.close().catch(() => {});
    await Promise.all([current.stdout.close(), current.stderr.close()]);
  }
  if (closeError) throw closeError;
}

async function rotateExistingPath(target, label = "previous") {
  try { await stat(target); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  rotationSequence += 1;
  const parsed = path.parse(target);
  const stamp = new Date().toISOString().replace(/[^0-9]/gu, "");
  const destination = path.join(parsed.dir, `${parsed.name}.${label}-${stamp}-${process.pid}-${rotationSequence}${parsed.ext}`);
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

async function waitForJson(file, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse(await readFile(file, "utf8"));
      if (value?.state === "failed") throw new Error(`Native startup failed: ${value.reason ?? "unknown"}`);
      if (value?.state === "ready") return value;
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    if (child.exitCode !== null) throw new Error(`Native app exited ${child.exitCode} before readiness`);
    await delay(100);
  }
  throw new Error("Timed out waiting for native readiness");
}

async function connectToWebView(port, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${port}`); }
    catch (error) { lastError = error; await delay(200); }
    if (child.exitCode !== null) throw new Error(`Native app exited ${child.exitCode} before WebView attachment`);
  }
  throw new Error(`Could not attach to native WebView: ${lastError}`);
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
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: true,
    stdio: "ignore",
  });
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(true);
      else if (code === 1) resolve(false);
      else reject(new Error(`Portable WebView process inspection failed with PowerShell exit code ${code}`));
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

function delay(milliseconds) { return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)); }
