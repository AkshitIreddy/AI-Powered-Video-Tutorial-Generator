import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const portableArgument = process.argv[process.argv.indexOf("--portable-root") + 1];
if (!portableArgument || process.argv.indexOf("--portable-root") < 0) throw new Error("--portable-root is required");
const portableRoot = path.resolve(portableArgument);
const executable = path.join(portableRoot, "App", "AI Video Tutorial Generator.exe");
const appDataPath = path.join(portableRoot, "App Data");
const workerExecutable = path.join(portableRoot, "Runtime", "alystria-pipeline.exe");
const readyPath = path.join(portableRoot, "Evidence", "native-headless-ready.json");
const evidenceRoot = path.join(portableRoot, "Evidence", "native-recovery");
const reportPath = path.join(evidenceRoot, "report.json");
const topic = `Native restart and cancellation ${Date.now()}`;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let rotationSequence = 0;

await rotateExistingPath(evidenceRoot);
await mkdir(evidenceRoot, { recursive: true });
let first;
let second;
let report;
let workError;
try {
  first = await launch("first");
  await seedCleanWorkspace(first.page);
  await createBlockedTutorial(first.page);
  const beforeRestart = await persistedProject(first.page);
  assertRecoveredCast(beforeRestart.project, "before restart");
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
  assertRecoveredCast(recovered.project, "after restart");
  if (JSON.stringify(recovered.project.presenterSelection) !== JSON.stringify(beforeRestart.project.presenterSelection)) {
    throw new Error("Restarted native app changed the saved cast or scene assignment");
  }
  await second.page.getByRole("button", { name: /open project/i }).click();
  await expect(second.page.getByRole("heading", { name: /shape the learning journey/i })).toBeVisible({ timeout: 30_000 });
  // The drawer is aria-hidden after a restart until the user opens it.
  const jobs = second.page.locator('aside.jobs-drawer[aria-label="Background jobs"]');
  if (await jobs.evaluate((element) => element.classList.contains("open"))) {
    await jobs.locator("header .icon-button").click();
  }
  await second.page.locator(".plan-progress button").filter({ hasText: "Presenters" }).click();
  await expect(second.page.getByRole("button", { name: "Select Daniel · software instructor" })).toHaveAttribute("aria-pressed", "true");
  await expect(second.page.getByRole("button", { name: "Select Astrid · anime editorial" })).toHaveAttribute("aria-pressed", "true");
  await expect(second.page.locator(".scene-speaker-assignments select").first()).toHaveValue("presenter-portrait.anime-astrid-v1");
  if (!await jobs.evaluate((element) => element.classList.contains("open"))) {
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
  const manifestText = await readFile(path.join(portableRoot, "test-area-manifest.json"), "utf8");
  const packageManifest = JSON.parse(manifestText);
  await writeFile(path.join(evidenceRoot, "test-area-manifest.json"), manifestText, "utf8");
  report = {
    schemaVersion: 1,
    state: "passed",
    actualNativeWebView: true,
    hiddenLaunch: true,
    projectId: recovered.project.nativeProjectId,
    generationJobId: recovered.generationJob.id,
    stateBeforeRestart: "BLOCKED",
    stateAfterRestart: "BLOCKED",
    stateAfterCancel: "CANCELLED",
    presenterSelectionBeforeRestart: beforeRestart.project.presenterSelection,
    presenterSelectionAfterRestart: recovered.project.presenterSelection,
    castPreservedAcrossRestart: true,
    firstWorkerExitedWithApp: true,
    firstDesktopPid,
    firstWorkerPid,
    secondDesktopPid: second.child.pid,
    secondWorkerPid: second.workerPid,
    executableSha256: await sha256File(executable),
    workerSha256: await sha256File(workerExecutable),
    packageManifest: {
      createdAt: packageManifest.createdAt,
      desktop: packageManifest.desktop,
      pipelineWorker: packageManifest.pipelineWorker,
      rendererRuntime: packageManifest.rendererRuntime,
    },
    finishedAtUtc: new Date().toISOString(),
  };
  await closeLaunch(second);
  second = null;
  report.gracefulShutdown = true;
  report.workerExitedWithApp = true;
} catch (error) {
  workError = error;
  throw error;
} finally {
  for (const pending of [first, second]) {
    if (!pending) continue;
    try {
      await closeLaunch(pending);
    } catch (error) {
      if (!workError) throw error;
    }
  }
}

if (report) {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function launch(label) {
  await rotateExistingPath(readyPath);
  const port = await reservePort();
  const stdout = await open(path.join(evidenceRoot, `${label}.stdout.log`), "w");
  const stderr = await open(path.join(evidenceRoot, `${label}.stderr.log`), "w");
  const child = spawn(executable, [], {
    cwd: portableRoot,
    env: { ...process.env, ALYSTRIA_HEADLESS_ACCEPTANCE: "1", ALYSTRIA_HEADLESS_ACCEPTANCE_CDP_PORT: String(port) },
    windowsHide: true,
    stdio: ["ignore", stdout.fd, stderr.fd],
  });
  let browser;
  let workerPid;
  try {
    browser = await connectToWebView(port, 120_000);
    const ready = await waitForJson(readyPath, 120_000, child);
    workerPid = validatedReadyWorkerPid(ready, child.pid);
    const pages = browser.contexts().flatMap((context) => context.pages());
    if (pages.length !== 1) throw new Error(`Expected one native WebView page, found ${pages.length}`);
    const launch = { child, browser, page: pages[0], workerPid, stdout, stderr };
    await expect(launch.page.locator(".runtime-badge")).toContainText("Worker ready", { timeout: 45_000 });
    return launch;
  } catch (error) {
    workerPid ||= await readReadyWorkerPid(child.pid);
    const cleanupErrors = await cleanupFailedLaunch({ child, browser, workerPid, stdout, stderr });
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "Native recovery launch and startup cleanup both failed");
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

async function cleanupFailedLaunch({ child, browser, workerPid, stdout, stderr }) {
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
  if (workerPid && await processExists(workerPid)) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && await processExists(workerPid)) await delay(100);
    if (await processExists(workerPid)) {
      try { process.kill(workerPid); } catch (error) { if (error?.code !== "ESRCH") errors.push(error); }
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && await processExists(workerPid)) await delay(100);
      if (await processExists(workerPid)) errors.push(new Error(`Native worker ${workerPid} remained alive after failed startup cleanup`));
    }
  }
  await waitForPortableWebViewExit(30_000).catch((error) => errors.push(error));
  await Promise.all([stdout.close(), stderr.close()]).catch((error) => errors.push(error));
  return errors;
}

async function rotateExistingPath(target, label = "previous") {
  try {
    await stat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  rotationSequence += 1;
  const parsedPath = path.parse(target);
  const stamp = new Date().toISOString().replace(/[^0-9]/gu, "");
  const destination = path.join(parsedPath.dir, `${parsedPath.name}.${label}-${stamp}-${process.pid}-${rotationSequence}${parsedPath.ext}`);
  await rename(target, destination);
  return destination;
}

async function closeLaunch(launch) {
  let failure = null;
  try {
    if (launch.child.exitCode === null) {
      await postWmClose(launch.child.pid);
      await Promise.race([new Promise((resolve) => launch.child.once("exit", resolve)), delay(15_000)]);
    }
    if (launch.child.exitCode === null) {
      launch.child.kill();
      failure = new Error("The native app did not exit within 15 seconds of WM_CLOSE");
    } else if (launch.child.exitCode !== 0) {
      failure = new Error(`The native app exited with code ${launch.child.exitCode}`);
    } else {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && await processExists(launch.workerPid)) await delay(100);
      if (await processExists(launch.workerPid)) failure = new Error(`Native worker ${launch.workerPid} remained alive after WM_CLOSE`);
      await waitForPortableWebViewExit(30_000);
    }
  } finally {
    await launch.browser.close().catch(() => {});
    await Promise.all([launch.stdout.close(), launch.stderr.close()]);
  }
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
  await expect(wizard).not.toContainText(/karatsuba|binary search/i);
  await wizard.getByPlaceholder("What would you like to teach? Describe your topic, question, or learning goal.").fill(topic);
  await wizard.getByRole("button", { name: /continue/i }).click();
  await wizard.getByLabel("Audience").fill("Windows native recovery reviewers");
  await wizard.getByLabel("Target duration").selectOption("custom");
  await wizard.getByLabel("Exact duration in minutes").fill("3");
  await wizard.getByRole("button", { name: /continue/i }).click();
  await expect(wizard.getByRole("heading", { name: "Who will teach?" })).toBeVisible();
  await wizard.getByRole("button", { name: "Choose a cast" }).click();
  await wizard.getByRole("button", { name: "Select Daniel · software instructor" }).click();
  await wizard.getByRole("button", { name: "Select Astrid · anime editorial" }).click();
  await expect(wizard.getByText("2 presenters selected", { exact: true })).toBeVisible();
  await wizard.getByRole("button", { name: /continue/i }).click();
  await wizard.getByRole("button", { name: /^creative/i }).click();
  await wizard.getByRole("button", { name: /continue/i }).click();
  await wizard.getByRole("button", { name: "Standard", exact: true }).click();
  await expect(wizard.getByLabel(/hard budget/i)).toHaveCount(0);
  await expect(wizard.getByText(/hard creation budget/i)).toHaveCount(0);
  await expect(wizard.locator(".routing-readiness")).not.toContainText("Loading", { timeout: 120_000 });
  const setupError = wizard.getByRole("alert");
  if (await setupError.count() && await setupError.isVisible()) throw new Error(`Native model setup failed: ${(await setupError.innerText()).trim()}`);
  await wizard.getByLabel("Creation profile").selectOption("portable-test-local");
  await wizard.getByRole("button", { name: /create learning plan/i }).click();
  const jobs = page.getByRole("complementary", { name: /background jobs/i });
  await expect(jobs.locator(".job-card").filter({ hasText: "Creating learning plan" })).toContainText("blocked", { timeout: 120_000 });
  if (await jobs.evaluate((element) => element.classList.contains("open"))) {
    await jobs.locator("header .icon-button").click();
  }
  await page.locator(".plan-progress button").filter({ hasText: "Presenters" }).click();
  const stepRows = await page.locator(".plan-progress button").evaluateAll((steps) => steps.map((step) => Math.round(step.getBoundingClientRect().top)));
  if (stepRows.length !== 6 || new Set(stepRows).size !== 1) throw new Error("The six plan steps did not fit on one navigation row");
  const assignments = page.locator(".scene-speaker-assignments select");
  await expect(assignments.first()).toBeVisible();
  await assignments.first().selectOption("presenter-portrait.anime-astrid-v1");
  await expect.poll(async () => {
    const saved = await persistedProject(page);
    return saved.project.presenterSelection?.sceneAssignments?.[0]?.presenterId;
  }).toBe("presenter-portrait.anime-astrid-v1");
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

function assertRecoveredCast(project, phase) {
  const selection = project?.presenterSelection;
  const expectedIds = [
    "presenter-portrait.software-daniel-v1",
    "presenter-portrait.anime-astrid-v1",
  ];
  if (selection?.mode !== "on"
    || selection.presenters?.length !== expectedIds.length
    || expectedIds.some((presenterId, index) => selection.presenters[index]?.presenterId !== presenterId
      || selection.presenters[index]?.portraitAssetId !== presenterId)) {
    throw new Error(`Native recovery ${phase} did not retain the selected two-presenter cast`);
  }
  const firstSceneId = project.scenes?.[0]?.id;
  if (!firstSceneId
    || selection.sceneAssignments?.length !== 1
    || selection.sceneAssignments[0]?.sceneId !== firstSceneId
    || selection.sceneAssignments[0]?.presenterId !== "presenter-portrait.anime-astrid-v1") {
    throw new Error(`Native recovery ${phase} did not retain the explicit first-scene speaker`);
  }
}

function completedOnboarding() {
  const chapters = ["welcome", "goal", "runtime", "provider", "hardware", "model", "profile", "ready"];
  return { schemaVersion: 1, status: "completed", activeChapterId: "ready", completedChapterIds: chapters, visitedChapterIds: chapters, configuration: { goals: ["tutorial"], runtime: "local", privacy: null, providerIds: [], modelIds: [], hardwareReviewed: true, profile: { displayName: "Recovery acceptance", portraitAssetId: "presenter-portrait.broadcast-elena-v1" } }, revision: 8, updatedAt: new Date().toISOString() };
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
  const helper = path.join(repoRoot, "scripts", "post-wm-close.py");
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

async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}
