import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const portableIndex = process.argv.indexOf("--portable-root");
if (portableIndex < 0 || !process.argv[portableIndex + 1]) throw new Error("--portable-root is required");
const portableRoot = path.resolve(process.argv[portableIndex + 1]);
const executable = path.join(portableRoot, "App", "AI Video Tutorial Generator.exe");
const stamp = new Date().toISOString().replace(/[^0-9]/gu, "");
const evidenceRoot = path.join(portableRoot, "Evidence", `native-navigation-performance-${stamp}`);
const readyPath = path.join(portableRoot, "Evidence", "native-headless-ready.json");
const preservedReadyPath = path.join(evidenceRoot, "preserved-native-headless-ready.json");
const measuredReadyPath = path.join(evidenceRoot, "measured-native-headless-ready.json");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let launch;
let preservedReady = false;
let preservedStorage;

await mkdir(evidenceRoot, { recursive: false });
try {
  await stat(readyPath);
  await rename(readyPath, preservedReadyPath);
  preservedReady = true;
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

try {
  launch = await startNative();
  const { page } = launch;
  await expect(page.getByRole("heading", { name: "Your teaching workbench." })).toBeVisible({ timeout: 45_000 });
  preservedStorage = await page.evaluate(() => ({
    onboarding: localStorage.getItem("alystria-onboarding-v1"),
    guidedTour: localStorage.getItem("alystria-guided-tour-v1"),
  }));
  const onboarding = page.locator(".aly-onboarding-dialog-layer");
  if (await onboarding.isVisible()) {
    await onboarding.getByRole("button", { name: "Exit onboarding" }).click();
    await expect(onboarding).toBeHidden();
  }
  const guidedTour = page.locator(".aly-onboarding-tour");
  if (await guidedTour.isVisible()) {
    await guidedTour.getByRole("button", { name: "Exit tour" }).click();
    await expect(guidedTour).toBeHidden();
  }
  await page.evaluate(() => {
    const state = {
      pendingInvokes: 0,
      invokes: [],
      longTasks: [],
    };
    globalThis.__alystriaNativeNavigationProbe = state;
    const internals = globalThis.__TAURI_INTERNALS__;
    if (internals && typeof internals.invoke === "function") {
      const original = internals.invoke.bind(internals);
      internals.invoke = async (...args) => {
        const startedAt = performance.now();
        state.pendingInvokes += 1;
        try {
          return await original(...args);
        } finally {
          state.pendingInvokes -= 1;
          state.invokes.push({ command: String(args[0]), startedAt, durationMs: performance.now() - startedAt });
        }
      };
    }
    new PerformanceObserver((list) => {
      state.longTasks.push(...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })));
    }).observe({ type: "longtask" });
  });

  const labels = ["Projects", "Templates", "Library", "Models & providers", "Settings & diagnostics", "Home"];
  const cold = [];
  const warm = [];
  for (const label of labels) cold.push(await measureNavigation(page, label));
  for (const label of labels) warm.push(await measureNavigation(page, label));
  const invocations = await page.evaluate(() => globalThis.__alystriaNativeNavigationProbe.invokes);
  const report = {
    schemaVersion: 1,
    evidenceClass: "packaged-native-navigation-performance",
    executable,
    desktopPid: launch.child.pid,
    workerPid: launch.workerPid,
    measuredAtUtc: new Date().toISOString(),
    cold,
    warm,
    invocations,
  };
  await writeFile(path.join(evidenceRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  if (launch && preservedStorage) {
    await launch.page.evaluate((saved) => {
      const restore = (key, value) => value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
      restore("alystria-onboarding-v1", saved.onboarding);
      restore("alystria-guided-tour-v1", saved.guidedTour);
    }, preservedStorage).catch(() => {});
  }
  if (launch) await closeNative(launch);
  try { await rename(readyPath, measuredReadyPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (preservedReady) await rename(preservedReadyPath, readyPath);
}

async function measureNavigation(page, label) {
  const start = await page.evaluate(() => performance.now());
  const control = page.getByRole("button", { name: label, exact: true });
  await control.click();
  await expect(control).toHaveAttribute("aria-current", "page");
  const paintedAt = await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return performance.now();
  });
  if (label === "Models & providers") {
    await expect(page.locator(".provider-progressive-placeholder")).toHaveCount(0, { timeout: 15_000 });
  }
  await page.waitForFunction(() => globalThis.__alystriaNativeNavigationProbe.pendingInvokes === 0, undefined, { timeout: 15_000, polling: 20 });
  await page.waitForTimeout(30);
  return await page.evaluate(({ label, start, paintedAt }) => {
    const state = globalThis.__alystriaNativeNavigationProbe;
    const settledAt = performance.now();
    const routeInvokes = state.invokes.filter((entry) => entry.startedAt >= start && entry.startedAt <= settledAt);
    const routeLongTasks = state.longTasks.filter((entry) => entry.startTime >= start && entry.startTime <= settledAt);
    return {
      label,
      clickToPaintMs: paintedAt - start,
      clickToSettleMs: settledAt - start,
      elementCount: document.querySelectorAll("main *").length,
      modelCardCount: document.querySelectorAll(".aly-catalog-card").length,
      progressivePlaceholderCount: document.querySelectorAll(".provider-progressive-placeholder").length,
      invokeCount: routeInvokes.length,
      invokeDurationMs: routeInvokes.reduce((total, entry) => total + entry.durationMs, 0),
      invokeCommands: [...new Set(routeInvokes.map((entry) => entry.command))],
      longTaskCount: routeLongTasks.length,
      longTaskDurationMs: routeLongTasks.reduce((total, entry) => total + entry.duration, 0),
    };
  }, { label, start, paintedAt });
}

async function startNative() {
  const port = await reservePort();
  const stdout = await open(path.join(evidenceRoot, "desktop.stdout.log"), "w");
  const stderr = await open(path.join(evidenceRoot, "desktop.stderr.log"), "w");
  const child = spawn(executable, [], {
    cwd: portableRoot,
    env: { ...process.env, ALYSTRIA_HEADLESS_ACCEPTANCE: "1", ALYSTRIA_HEADLESS_ACCEPTANCE_CDP_PORT: String(port) },
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
    return { child, browser, page: pages[0], workerPid, stdout, stderr };
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    if (child.exitCode === null) await postWmClose(child.pid).catch(() => {});
    await Promise.all([stdout.close(), stderr.close()]);
    throw error;
  }
}

async function closeNative(current) {
  let closeError;
  try {
    if (current.child.exitCode === null) {
      await postWmClose(current.child.pid);
      await Promise.race([new Promise((resolve) => current.child.once("exit", resolve)), delay(15_000)]);
    }
    if (current.child.exitCode === null) throw new Error("Native app did not exit within 15 seconds of WM_CLOSE");
    if (current.child.exitCode !== 0) throw new Error(`Native app exited with code ${current.child.exitCode}`);
    if (!await waitForProcessExit(current.workerPid, 10_000)) throw new Error(`Native worker ${current.workerPid} remained alive after WM_CLOSE`);
  } catch (error) {
    closeError = error;
  } finally {
    await current.browser.close().catch(() => {});
    await Promise.all([current.stdout.close(), current.stderr.close()]);
  }
  if (closeError) throw closeError;
}

function validatedReadyWorkerPid(ready, desktopPid) {
  const workerPid = Number(ready?.workerPid);
  if (ready?.schemaVersion !== 1 || ready?.workerHandshake !== true || Number(ready?.desktopPid) !== desktopPid) {
    throw new Error("Native readiness receipt does not identify this authenticated desktop launch");
  }
  if (!Number.isSafeInteger(workerPid) || workerPid <= 0) throw new Error("Native readiness receipt has an invalid worker PID");
  return workerPid;
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

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
