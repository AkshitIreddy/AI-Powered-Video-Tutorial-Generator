import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const portableArgument = process.argv[process.argv.indexOf("--portable-root") + 1];
if (!portableArgument || process.argv.indexOf("--portable-root") < 0) throw new Error("--portable-root is required");
const portableRoot = path.resolve(portableArgument);
const executable = path.join(portableRoot, "App", "AI Video Tutorial Generator.exe");
const readyPath = path.join(portableRoot, "Evidence", "native-headless-ready.json");
const evidenceRoot = path.join(portableRoot, "Evidence", "native-recovery");
const reportPath = path.join(evidenceRoot, "report.json");
const topic = `Native restart and cancellation ${Date.now()}`;

await mkdir(evidenceRoot, { recursive: true });
await rm(reportPath, { force: true });
let first;
let second;
try {
  first = await launch("first");
  await seedCleanWorkspace(first.page);
  await createBlockedTutorial(first.page);
  const beforeRestart = await persistedProject(first.page);
  const firstDesktopPid = first.child.pid;
  await first.page.screenshot({ path: path.join(evidenceRoot, "01-before-restart.png"), fullPage: true });
  const firstWorkerPid = first.workerPid;
  await closeLaunch(first);
  first = null;
  if (await processExists(firstWorkerPid)) throw new Error("The first supervised worker survived native app shutdown");

  second = await launch("second");
  const recovered = await persistedProject(second.page);
  if (recovered.project.nativeProjectId !== beforeRestart.project.nativeProjectId) {
    throw new Error("Restarted native app did not recover the same project identity");
  }
  if (receiptState(recovered.generationJob) !== "BLOCKED") {
    throw new Error(`Restarted native app recovered ${receiptState(recovered.generationJob) ?? "unknown"}, expected BLOCKED`);
  }
  await second.page.getByRole("button", { name: /open project/i }).click();
  await expect(second.page.getByRole("heading", { name: /shape the learning journey/i })).toBeVisible({ timeout: 30_000 });
  const jobs = second.page.getByRole("complementary", { name: /background jobs/i });
  if (await jobs.count() === 0 || !await jobs.evaluate((element) => element.classList.contains("open"))) {
    await second.page.getByRole("button", { name: /^jobs$/i }).click();
  }
  const card = jobs.locator(".job-card").filter({ hasText: "Creating learning plan" });
  await expect(card).toContainText("blocked", { timeout: 45_000 });
  await card.getByRole("button", { name: /cancel creating learning plan/i }).click();
  await expect(card).toContainText("cancelled", { timeout: 45_000 });
  await second.page.screenshot({ path: path.join(evidenceRoot, "02-recovered-and-cancelled.png"), fullPage: true });
  const afterCancel = await persistedProject(second.page);
  if (receiptState(afterCancel.generationJob) !== "CANCELLED") {
    throw new Error(`Native cancellation persisted ${receiptState(afterCancel.generationJob) ?? "unknown"}, expected CANCELLED`);
  }
  const report = {
    schemaVersion: 1,
    state: "passed",
    actualNativeWebView: true,
    hiddenLaunch: true,
    projectId: recovered.project.nativeProjectId,
    generationJobId: recovered.generationJob.id,
    stateBeforeRestart: "BLOCKED",
    stateAfterRestart: "BLOCKED",
    stateAfterCancel: "CANCELLED",
    firstWorkerExitedWithApp: true,
    firstDesktopPid,
    firstWorkerPid,
    secondDesktopPid: second.child.pid,
    secondWorkerPid: second.workerPid,
    finishedAtUtc: new Date().toISOString(),
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  if (first) await closeLaunch(first).catch(() => {});
  if (second) await closeLaunch(second).catch(() => {});
}

async function launch(label) {
  await rm(readyPath, { force: true });
  const port = await reservePort();
  const stdout = await open(path.join(evidenceRoot, `${label}.stdout.log`), "w");
  const stderr = await open(path.join(evidenceRoot, `${label}.stderr.log`), "w");
  const child = spawn(executable, [], {
    cwd: portableRoot,
    env: { ...process.env, ALYSTRIA_HEADLESS_ACCEPTANCE: "1", ALYSTRIA_HEADLESS_ACCEPTANCE_CDP_PORT: String(port) },
    windowsHide: true,
    stdio: ["ignore", stdout.fd, stderr.fd],
  });
  try {
    const ready = await waitForJson(readyPath, 120_000, child);
    const browser = await connectToWebView(port, 120_000);
    const pages = browser.contexts().flatMap((context) => context.pages());
    if (pages.length !== 1) throw new Error(`Expected one native WebView page, found ${pages.length}`);
    const launch = { child, browser, page: pages[0], workerPid: Number(ready.workerPid), stdout, stderr };
    await expect(launch.page.locator(".runtime-badge")).toContainText("Worker ready", { timeout: 45_000 });
    return launch;
  } catch (error) {
    if (child.exitCode === null) {
      await postWmClose(child.pid).catch(() => {});
      await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(15_000)]);
    }
    if (child.exitCode === null) child.kill();
    await Promise.all([stdout.close(), stderr.close()]);
    throw error;
  }
}

async function closeLaunch(launch) {
  await launch.browser.close().catch(() => {});
  if (launch.child.exitCode === null) {
    await postWmClose(launch.child.pid);
    await Promise.race([new Promise((resolve) => launch.child.once("exit", resolve)), delay(15_000)]);
  }
  let failure = null;
  if (launch.child.exitCode === null) {
    launch.child.kill();
    failure = new Error("The native app did not exit within 15 seconds of WM_CLOSE");
  }
  else if (launch.child.exitCode !== 0) failure = new Error(`The native app exited with code ${launch.child.exitCode}`);
  await Promise.all([launch.stdout.close(), launch.stderr.close()]);
  if (failure) throw failure;
}

async function seedCleanWorkspace(page) {
  await page.evaluate(({ onboarding, workspace }) => {
    localStorage.clear();
    localStorage.setItem("alystria-onboarding-v1", JSON.stringify(onboarding));
    localStorage.setItem("alystria-guided-tour-v1", "completed");
    localStorage.setItem("alystria-studio-v2", JSON.stringify(workspace));
  }, {
    onboarding: completedOnboarding(),
    workspace: { projects: [], recentProjectId: null, studioMode: "guided", version: 0, jobs: [] },
  });
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function createBlockedTutorial(page) {
  await page.getByRole("button", { name: /new tutorial/i }).click();
  const wizard = page.locator(".wizard-modal");
  await wizard.getByPlaceholder(/explain why karatsuba/i).fill(topic);
  await wizard.getByRole("button", { name: /continue/i }).click();
  await wizard.getByLabel("Audience").fill("Windows native recovery reviewers");
  await wizard.getByLabel("Target duration").selectOption("custom");
  await wizard.getByLabel("Exact duration in minutes").fill("3");
  await wizard.getByRole("button", { name: /continue/i }).click();
  await wizard.getByRole("button", { name: /^creative/i }).click();
  await wizard.getByRole("button", { name: /continue/i }).click();
  await wizard.getByRole("button", { name: "Standard", exact: true }).click();
  await wizard.getByLabel("Creation profile").selectOption("portable-test-local");
  await wizard.getByRole("checkbox", { name: /approve this exact routing policy/i }).check();
  await wizard.getByRole("button", { name: /create learning plan/i }).click();
  const jobs = page.getByRole("complementary", { name: /background jobs/i });
  await expect(jobs.locator(".job-card").filter({ hasText: "Creating learning plan" })).toContainText("blocked", { timeout: 120_000 });
}

async function persistedProject(page) {
  const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}"));
  const project = snapshot.projects?.find((candidate) => candidate.title === topic);
  if (!project) throw new Error("Native-created recovery project was not persisted");
  const generationJob = snapshot.jobs?.find((job) => job.id === project.nativeGenerationId);
  if (!generationJob) throw new Error("Native generation job was not persisted");
  return { project, generationJob };
}

function receiptState(job) { return job?.result?.receiptState ?? null; }

function completedOnboarding() {
  const chapters = ["welcome", "goal", "runtime", "privacy", "provider", "hardware", "model", "profile", "ready"];
  return { schemaVersion: 1, status: "completed", activeChapterId: "ready", completedChapterIds: chapters, visitedChapterIds: chapters, configuration: { goals: ["tutorial"], runtime: "local", privacy: "local-only", providerIds: [], modelIds: [], hardwareReviewed: true, profile: { displayName: "Recovery acceptance", portraitAssetId: "presenter-portrait.broadcast-elena-v1" } }, revision: 9, updatedAt: new Date().toISOString() };
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
    if (child.exitCode !== null) throw new Error(`Native app exited with code ${child.exitCode} before reporting readiness`);
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function connectToWebView(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${port}`); }
    catch (error) { lastError = error; await delay(200); }
  }
  throw new Error(`Could not attach Playwright to the native WebView: ${lastError}`);
}

async function postWmClose(pid) {
  const helper = path.resolve(process.cwd(), "..", "..", "scripts", "post-wm-close.py");
  const child = spawn(process.env.PYTHON ?? "python", [helper, "--pid", String(pid)], { windowsHide: true, stdio: "ignore" });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`WM_CLOSE helper exited ${code}`)));
  });
}

async function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`], { windowsHide: true, stdio: "ignore" });
  return await new Promise((resolve) => child.once("exit", (code) => resolve(code === 0)));
}

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
