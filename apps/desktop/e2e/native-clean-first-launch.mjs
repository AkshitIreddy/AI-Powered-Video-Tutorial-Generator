import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { lstat, mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const portableIndex = process.argv.indexOf("--portable-root");
if (portableIndex < 0 || !process.argv[portableIndex + 1]) throw new Error("--portable-root is required");
const portableRoot = path.resolve(process.argv[portableIndex + 1]);
const executable = path.join(portableRoot, "App", "AI Video Tutorial Generator.exe");
const evidenceRoot = path.join(portableRoot, "Evidence", "native-clean-first-launch");
const readyPath = path.join(portableRoot, "Evidence", "native-headless-ready.json");
const appDataPath = path.join(portableRoot, "App Data");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let rotationSequence = 0;
let launch;
let bootstrapLaunch;
let report;
let workError;
let ownerAppDataBackup;
let isolatedAppDataEvidencePath;
let ownerStateRestored = false;
let isolationActive = false;

await rotateExistingPath(evidenceRoot);
await mkdir(evidenceRoot, { recursive: true });
await rotateExistingPath(readyPath);

try {
  await waitForPortableWebViewExit(30_000);
  await isolateOwnerAppData();
  bootstrapLaunch = await startBootstrapNative();
  const bootstrapDesktopPid = bootstrapLaunch.child.pid;
  const bootstrapWorkerPid = bootstrapLaunch.workerPid;
  await closeBootstrapNative(bootstrapLaunch);
  bootstrapLaunch = undefined;
  await rotateExistingPath(readyPath, "bootstrap-ready");
  launch = await startNative();
  const { page } = launch;
  const dialog = page.locator(".aly-onboarding-dialog");
  await expect(dialog).toBeVisible({ timeout: 45_000 });
  await expect(dialog.getByRole("heading", { name: "Make AI Video Tutorial Generator yours" })).toBeVisible();
  const initialStorage = await page.evaluate(() => ({
    onboarding: localStorage.getItem("alystria-onboarding-v1"),
    workspace: JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}"),
  }));
  if (initialStorage.workspace.projects?.length || initialStorage.workspace.jobs?.length) {
    throw new Error("Clean first launch contained seeded projects or jobs");
  }
  const setupDetected = dialog.getByText("Your existing setup is already here.");
  await expect(setupDetected).toBeVisible();
  const setupSummary = (await setupDetected.locator("xpath=..").innerText()).trim();
  await page.screenshot({ path: path.join(evidenceRoot, "01-clean-first-launch.png"), fullPage: true });

  await continueOnboarding(dialog);
  await dialog.locator('input[type="checkbox"][value="tutorial"]').check();
  await continueOnboarding(dialog);
  await dialog.locator('input[type="radio"][value="hybrid"]').check();
  await continueOnboarding(dialog);
  await dialog.locator('input[type="radio"][value="ask-before-cloud"]').check();
  await continueOnboarding(dialog);
  await continueOnboarding(dialog);
  const hardwareReview = dialog.getByRole("checkbox", { name: /reviewed this system summary/i });
  if (!await hardwareReview.isChecked()) await hardwareReview.check();
  await continueOnboarding(dialog);
  await continueOnboarding(dialog);
  const displayName = dialog.getByLabel("Display name");
  if (!(await displayName.inputValue()).trim()) await displayName.fill("Akshit");
  if (!await dialog.locator('input[type="radio"]:checked').count()) {
    await dialog.locator(".aly-onboarding-profile__portrait:not(.aly-onboarding-profile__portrait--disabled)").first().click();
  }
  await continueOnboarding(dialog);
  await expect(dialog.getByRole("heading", { name: "Your studio is prepared" })).toBeVisible();
  await page.screenshot({ path: path.join(evidenceRoot, "02-ready-with-reused-setup.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Enter AI Video Tutorial Generator" }).click();

  const tour = page.locator(".aly-onboarding-tour");
  if (await tour.isVisible()) await tour.getByRole("button", { name: "Exit tour" }).click();
  await expect(page.getByRole("heading", { name: "Your teaching workbench." })).toBeVisible({ timeout: 45_000 });
  const finalWorkspace = await page.evaluate(() => JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}"));
  if (finalWorkspace.projects?.length || finalWorkspace.jobs?.length) {
    throw new Error("Completed onboarding seeded projects or jobs into the owner workspace");
  }
  await page.screenshot({ path: path.join(evidenceRoot, "03-empty-owner-home.png"), fullPage: true });

  await page.getByRole("button", { name: /settings & diagnostics/i }).click();
  await page.getByRole("button", { name: /replay setup/i }).click();
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: path.join(evidenceRoot, "04-replay-setup-control.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Exit onboarding" }).click();
  const finalOnboarding = await page.evaluate(() => JSON.parse(localStorage.getItem("alystria-onboarding-v1") ?? "{}"));
  if (finalOnboarding.status !== "completed") throw new Error(`Replay exit left onboarding in ${finalOnboarding.status ?? "unknown"}`);

  const firstDesktopPid = launch.child.pid;
  const firstWorkerPid = launch.workerPid;
  await closeNative(launch);
  launch = undefined;
  await rotateExistingPath(readyPath, "previous-ready");

  launch = await startNative("relaunch");
  const relaunchedDialog = launch.page.locator(".aly-onboarding-dialog");
  await expect(relaunchedDialog).toBeHidden({ timeout: 45_000 });
  await expect(launch.page.getByRole("heading", { name: "Your teaching workbench." })).toBeVisible({ timeout: 45_000 });
  const relaunchedStorage = await launch.page.evaluate(() => ({
    onboarding: JSON.parse(localStorage.getItem("alystria-onboarding-v1") ?? "{}"),
    workspace: JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}"),
  }));
  if (relaunchedStorage.onboarding.status !== "completed") {
    throw new Error(`Normal relaunch restored onboarding as ${relaunchedStorage.onboarding.status ?? "unknown"}`);
  }
  if (relaunchedStorage.workspace.projects?.length || relaunchedStorage.workspace.jobs?.length) {
    throw new Error("Normal relaunch restored seeded projects or jobs into the owner workspace");
  }
  await launch.page.screenshot({ path: path.join(evidenceRoot, "05-clean-normal-relaunch.png"), fullPage: true });

  const manifestText = await readFile(path.join(portableRoot, "test-area-manifest.json"), "utf8");
  const packageManifest = JSON.parse(manifestText);
  await writeFile(path.join(evidenceRoot, "test-area-manifest.json"), manifestText, "utf8");

  report = {
    schemaVersion: 1,
    state: "passed",
    actualNativeWebView: true,
    hiddenLaunch: true,
    cleanFirstLaunch: false,
    cleanInstrumentedRelaunch: true,
    setupReuseDetected: true,
    setupSummary,
    webViewProfileBootstrap: {
      desktopPid: bootstrapDesktopPid,
      workerPid: bootstrapWorkerPid,
      healthyNativeHandshake: true,
      cdpInspected: false,
      scriptedUiActions: 0,
      postBootstrapSeededProjectCount: initialStorage.workspace.projects?.length ?? 0,
      postBootstrapSeededJobCount: initialStorage.workspace.jobs?.length ?? 0,
    },
    seededProjectCount: finalWorkspace.projects?.length ?? 0,
    seededJobCount: finalWorkspace.jobs?.length ?? 0,
    onboardingStatus: finalOnboarding.status,
    replaySetupOpenedThroughUi: true,
    normalRelaunchCompleted: true,
    normalRelaunchSeededProjectCount: relaunchedStorage.workspace.projects?.length ?? 0,
    normalRelaunchSeededJobCount: relaunchedStorage.workspace.jobs?.length ?? 0,
    packageManifest: {
      createdAt: packageManifest.createdAt,
      desktop: packageManifest.desktop,
      pipelineWorker: packageManifest.pipelineWorker,
      rendererRuntime: packageManifest.rendererRuntime,
    },
    desktopPids: [firstDesktopPid, launch.child.pid],
    workerPids: [firstWorkerPid, launch.workerPid],
    finishedAtUtc: new Date().toISOString(),
  };
} catch (error) {
  workError = error;
  throw error;
} finally {
  let cleanupError;
  if (bootstrapLaunch) {
    try {
      await closeBootstrapNative(bootstrapLaunch);
    } catch (error) {
      cleanupError = error;
    }
  }
  if (launch) {
    try {
      await closeNative(launch);
    } catch (error) {
      cleanupError = cleanupError
        ? new AggregateError([cleanupError, error], "Bootstrap and instrumented native close both failed")
        : error;
    }
  }
  if (isolationActive) {
    try {
      await preserveIsolatedAppDataAndRestoreOwner();
    } catch (error) {
      cleanupError = cleanupError
        ? new AggregateError([cleanupError, error], "Native close and owner-profile restoration both failed")
        : error;
    }
  }
  if (cleanupError) {
    if (workError) throw new AggregateError([workError, cleanupError], "Clean-profile proof failed and cleanup also failed");
    throw cleanupError;
  }
}

if (report) {
  report.gracefulShutdown = true;
  report.workerExitedWithApp = true;
  report.isolatedPortableAppData = true;
  report.isolatedAppDataEvidencePath = isolatedAppDataEvidencePath;
  report.ownerStateRestored = ownerStateRestored;
  await writeFile(path.join(evidenceRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
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
    isolationActive = true;
  } catch (error) {
    if (ownerAppDataBackup) {
      try {
        await rename(ownerAppDataBackup, appDataPath);
        ownerAppDataBackup = undefined;
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], "Could not create isolated App Data or restore the owner profile");
      }
    }
    throw error;
  }
}

async function preserveIsolatedAppDataAndRestoreOwner() {
  await waitForPortableWebViewExit(30_000);
  const cleanDetails = await lstat(appDataPath);
  if (cleanDetails.isSymbolicLink()) throw new Error(`Isolated App Data became a symbolic link or junction: ${appDataPath}`);
  isolatedAppDataEvidencePath = path.join(evidenceRoot, "isolated-app-data");
  await rename(appDataPath, isolatedAppDataEvidencePath);
  if (ownerAppDataBackup) {
    const ownerDetails = await lstat(ownerAppDataBackup);
    if (ownerDetails.isSymbolicLink()) throw new Error(`Preserved owner App Data became a symbolic link or junction: ${ownerAppDataBackup}`);
    await rename(ownerAppDataBackup, appDataPath);
  } else {
    await mkdir(appDataPath, { recursive: false });
  }
  ownerStateRestored = true;
  isolationActive = false;
}

async function continueOnboarding(dialog) {
  await dialog.getByRole("button", { name: /continue/i }).click();
}

async function startNative(logPrefix = "desktop") {
  const port = await reservePort();
  const stdout = await open(path.join(evidenceRoot, `${logPrefix}.stdout.log`), "w");
  const stderr = await open(path.join(evidenceRoot, `${logPrefix}.stderr.log`), "w");
  const child = spawn(executable, [], {
    cwd: portableRoot,
    env: { ...process.env, ALYSTRIA_HEADLESS_ACCEPTANCE: "1", ALYSTRIA_HEADLESS_ACCEPTANCE_CDP_PORT: String(port) },
    windowsHide: true,
    stdio: ["ignore", stdout.fd, stderr.fd],
  });
  let browser;
  let workerPid;
  try {
    // Attach while the WebView is starting; worker verification can take more
    // than a minute on a cold portable runtime and must not delay CDP attach.
    browser = await connectToWebView(port, 120_000, child);
    const ready = await waitForJson(readyPath, 120_000, child);
    workerPid = validatedReadyWorkerPid(ready, child.pid);
    const pages = browser.contexts().flatMap((context) => context.pages());
    if (pages.length !== 1) throw new Error(`Expected one native WebView page, found ${pages.length}`);
    return { child, browser, page: pages[0], workerPid, stdout, stderr };
  } catch (error) {
    workerPid ||= await readReadyWorkerPid(child.pid);
    const cleanupErrors = await cleanupFailedNativeStart({ child, browser, workerPid, stdout, stderr });
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "Native onboarding launch and startup cleanup both failed");
    throw error;
  }
}

async function startBootstrapNative() {
  const port = await reservePort();
  const stdout = await open(path.join(evidenceRoot, "bootstrap.stdout.log"), "w");
  const stderr = await open(path.join(evidenceRoot, "bootstrap.stderr.log"), "w");
  const child = spawn(executable, [], {
    cwd: portableRoot,
    env: { ...process.env, ALYSTRIA_HEADLESS_ACCEPTANCE: "1", ALYSTRIA_HEADLESS_ACCEPTANCE_CDP_PORT: String(port) },
    windowsHide: true,
    stdio: ["ignore", stdout.fd, stderr.fd],
  });
  let workerPid;
  try {
    const ready = await waitForJson(readyPath, 120_000, child);
    workerPid = validatedReadyWorkerPid(ready, child.pid);
    return { child, workerPid, stdout, stderr };
  } catch (error) {
    workerPid ||= await readReadyWorkerPid(child.pid);
    const cleanupErrors = await cleanupFailedNativeStart({ child, browser: null, workerPid, stdout, stderr });
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "Native onboarding bootstrap and startup cleanup both failed");
    throw error;
  }
}

async function readReadyWorkerPid(desktopPid) {
  try {
    const ready = JSON.parse(await readFile(readyPath, "utf8"));
    return validatedReadyWorkerPid(ready, desktopPid);
  } catch {
    return undefined;
  }
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
    if (!await waitForProcessExit(current.workerPid, 10_000)) {
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

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
