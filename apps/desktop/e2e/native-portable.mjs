import { chromium, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const parsed = parseArguments(process.argv.slice(2));
const portableRoot = path.resolve(parsed.portableRoot);
const executable = path.join(portableRoot, "App", "AI Video Tutorial Generator.exe");
const readyPath = path.join(portableRoot, "Evidence", "native-headless-ready.json");
const evidenceRoot = path.join(portableRoot, "Evidence", "native-ui-acceptance");
const stdoutPath = path.join(portableRoot, "Logs", "native-ui.stdout.log");
const stderrPath = path.join(portableRoot, "Logs", "native-ui.stderr.log");
const reportPath = path.join(evidenceRoot, "report.json");
const failurePath = path.join(evidenceRoot, "failure.json");
const ffprobePath = path.join(portableRoot, "Runtime", "ffmpeg", "ffprobe.exe");
const projectTitle = parsed.topic;
const startedAt = new Date();
let child;
let browser;
let workerPid;
let completed = false;

await mkdir(evidenceRoot, { recursive: true });
await rm(readyPath, { force: true });
await rm(failurePath, { force: true });
const port = await reservePort();
const stdout = await open(stdoutPath, "w");
const stderr = await open(stderrPath, "w");

try {
  child = spawn(executable, [], {
    cwd: portableRoot,
    env: {
      ...process.env,
      ALYSTRIA_HEADLESS_ACCEPTANCE: "1",
      ALYSTRIA_HEADLESS_ACCEPTANCE_CDP_PORT: String(port),
    },
    detached: false,
    windowsHide: true,
    stdio: ["ignore", stdout.fd, stderr.fd],
  });

  const ready = await waitForJson(readyPath, parsed.startupTimeoutMs, (value) => value?.state === "ready");
  workerPid = Number(ready.workerPid);
  browser = await connectToWebView(port, parsed.startupTimeoutMs);
  const contexts = browser.contexts();
  if (contexts.length !== 1) throw new Error(`Expected one native WebView context, found ${contexts.length}`);
  const pages = contexts[0].pages();
  if (pages.length !== 1) throw new Error(`Expected one native WebView page, found ${pages.length}`);
  const page = pages[0];

  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

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

  const runtimeBadge = page.locator(".runtime-badge");
  await expect(runtimeBadge).toContainText("Native", { timeout: parsed.actionTimeoutMs });
  await expect(runtimeBadge).toContainText("Worker ready", { timeout: parsed.actionTimeoutMs });
  await expect(runtimeBadge).toHaveAttribute("title", /Packaged native runtime/i);
  const runtimeBoundary = await runtimeBadge.getAttribute("title");
  if (parsed.credentialFile) await configureNativeProviderSecrets(page, parsed.credentialFile);
  await page.screenshot({ path: path.join(evidenceRoot, "01-native-home.png"), fullPage: true });

  await page.getByRole("button", { name: /new tutorial/i }).click();
  const wizard = page.locator(".wizard-modal");
  await wizard.getByPlaceholder(/explain why karatsuba/i).fill(projectTitle);
  await wizard.getByRole("button", { name: /continue/i }).click();
  await wizard.getByLabel("Audience").fill("Windows native integration reviewers");
  await wizard.getByLabel("Target duration").selectOption("custom");
  await wizard.getByLabel("Exact duration in minutes").fill("3");
  await wizard.getByLabel("Language").selectOption("English");
  await wizard.getByRole("button", { name: /continue/i }).click();
  await wizard.getByRole("button", { name: /^creative/i }).click();
  await wizard.getByRole("button", { name: /continue/i }).click();
  await wizard.getByRole("button", { name: "Standard", exact: true }).click();
  await wizard.getByLabel("Creation profile").selectOption(parsed.profileId);
  await wizard.getByLabel("Content class", { exact: true }).selectOption("public");
  await wizard.getByLabel("Hard budget in cents").fill(String(parsed.hardBudgetCents));
  await wizard.getByRole("checkbox", { name: /approve this exact routing policy/i }).check();
  await expect(wizard.locator(".routing-readiness")).toContainText("Ready");
  await wizard.screenshot({ path: path.join(evidenceRoot, "02-reviewed-policy.png") });
  await wizard.getByRole("button", { name: /create learning plan/i }).click();

  const planningState = await waitForProjectGenerationState(page, projectTitle, ["BLOCKED", "FAILED", "CANCELLED", "STALE"], parsed.jobTimeoutMs);
  if (planningState !== "BLOCKED") throw new Error(`Native learning plan finished in ${planningState}, expected BLOCKED`);
  await expect(page.getByRole("heading", { name: /shape the learning journey/i })).toBeVisible({ timeout: parsed.actionTimeoutMs });
  const jobs = page.getByRole("complementary", { name: /background jobs/i });
  await expect(jobs).toHaveClass(/open/);
  await expect(jobs.locator(".job-card").filter({ hasText: "Creating learning plan" })).toContainText("blocked", { timeout: parsed.actionTimeoutMs });
  await page.screenshot({ path: path.join(evidenceRoot, "03-native-plan-blocked.png"), fullPage: true });
  await jobs.locator("header .icon-button").click();
  await page.getByRole("button", { name: /approve learning plan/i }).click();

  await expect(jobs).toHaveClass(/open/, { timeout: parsed.actionTimeoutMs });
  const generationJob = jobs.locator(".job-card").filter({ hasText: "Creating learning plan" });
  await expect(generationJob).toHaveClass(/complete/, { timeout: parsed.jobTimeoutMs });
  await expect(generationJob).toContainText("succeeded");
  await page.screenshot({ path: path.join(evidenceRoot, "04-native-generation-complete.png"), fullPage: true });

  if (!(await page.getByRole("heading", { name: /review the whole argument/i }).isVisible())) {
    await jobs.locator("header .icon-button").click();
    await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /^review$/i }).click();
  }
  await expect(page.getByRole("heading", { name: /review the whole argument/i })).toBeVisible();
  await page.screenshot({ path: path.join(evidenceRoot, "05-native-review.png"), fullPage: true });

  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /^export$/i }).click();
  await expect(page.getByRole("heading", { name: /package the finished lesson/i })).toBeVisible();
  await page.getByLabel("Resolution").selectOption("1080p");
  await page.getByLabel("Frame rate").selectOption("30");
  await page.getByLabel("Codec preference").selectOption(parsed.codecPreference);
  await page.getByRole("button", { name: /export portable/i }).click();
  await expect(page.getByText(/portable project archived/i)).toBeVisible({ timeout: parsed.actionTimeoutMs });
  const archivePathText = await page.locator(".archive-path").textContent();
  await page.getByRole("button", { name: /render 1080p master/i }).click();
  await expect(page.getByText(/export queued|export blocked/i)).toBeVisible({ timeout: parsed.actionTimeoutMs });
  await expect(jobs).toHaveClass(/open/);
  const exportJob = jobs.locator(".job-card").filter({ hasText: "1080p" }).first();
  await expect(exportJob).toContainText(/succeeded|failed|blocked|cancelled|stale/, { timeout: parsed.jobTimeoutMs });
  await page.screenshot({ path: path.join(evidenceRoot, "06-native-export.png"), fullPage: true });

  const importedImageName = "native-home-import.png";
  const editedTitle = "Karatsuba: three products, not four";
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /^studio$/i }).click();
  await page.getByRole("button", { name: /advanced editor/i }).first().click();
  let editor = page.getByRole("dialog", { name: "Integrated advanced video editor" });
  await expect(editor).toBeVisible({ timeout: parsed.actionTimeoutMs });
  await editor.getByLabel("Rights for new editor media").selectOption("owned");
  await editor.getByLabel("Import media files").setInputFiles({
    name: importedImageName,
    mimeType: "image/png",
    buffer: await readFile(path.join(evidenceRoot, "01-native-home.png")),
  });
  let importedCard = editor.getByRole("listitem").filter({ hasText: importedImageName });
  await expect(importedCard).toContainText("ready", { timeout: parsed.actionTimeoutMs });
  await expect.poll(async () => importedCard.locator("img").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await importedCard.getByRole("button", { name: `Place ${importedImageName} at playhead` }).click();

  let importedClip = editor.locator(".aly-editor-clip--slides").filter({ hasText: importedImageName }).first();
  await expect(importedClip).toBeVisible();
  await importedClip.click();
  const endFrame = editor.getByLabel("End frame");
  const originalEndFrame = Number(await endFrame.inputValue());
  if (!Number.isInteger(originalEndFrame) || originalEndFrame < 3) throw new Error(`Imported editor clip had invalid end frame ${originalEndFrame}`);
  const trimmedEndFrame = Math.max(2, Math.min(90, originalEndFrame - 1));
  await endFrame.fill(String(trimmedEndFrame));
  await endFrame.press("Enter");

  let titleClip = editor.locator(".aly-editor-clip--titles").first();
  await expect(titleClip).toBeVisible();
  await titleClip.click();
  await editor.getByLabel("On-screen text").fill(editedTitle);
  await page.waitForFunction(({ title, imported, text, trim }) => {
    const workspace = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    const project = workspace.projects?.find((candidate) => candidate.title === title);
    const document = project?.editorDocument;
    if (!document) return false;
    const clips = (document.tracks ?? []).flatMap((track) => track.clips ?? []);
    return document.assets?.some((asset) => asset.name === imported && /^[0-9a-f]{64}$/u.test(asset.hash ?? ""))
      && clips.some((clip) => clip.name === imported && clip.timelineRange?.startFrame + clip.timelineRange?.durationFrames === trim)
      && clips.some((clip) => clip.kind === "titles" && clip.text === text);
  }, { title: projectTitle, imported: importedImageName, text: editedTitle, trim: trimmedEndFrame });
  await expect.poll(async () => editor.locator(".aly-editor-clip__waveform img").count(), { timeout: parsed.actionTimeoutMs }).toBeGreaterThan(0);
  await expect.poll(async () => editor.locator(".aly-editor-clip__waveform img").first().evaluate((image) => image.complete && image.naturalWidth > 0), { timeout: parsed.actionTimeoutMs }).toBe(true);
  await page.screenshot({ path: path.join(evidenceRoot, "07-editor-import-trim-title-waveform.png"), fullPage: true });

  await editor.getByRole("button", { name: /return to scene/i }).click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(runtimeBadge).toContainText("Native", { timeout: parsed.actionTimeoutMs });
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /^studio$/i }).click();
  await page.getByRole("button", { name: /advanced editor/i }).first().click();
  editor = page.getByRole("dialog", { name: "Integrated advanced video editor" });
  await expect(editor).toBeVisible({ timeout: parsed.actionTimeoutMs });
  importedCard = editor.getByRole("listitem").filter({ hasText: importedImageName });
  await expect(importedCard).toContainText("ready", { timeout: parsed.actionTimeoutMs });
  const reloadedAssetUrl = await importedCard.locator("img").getAttribute("src");
  if (!reloadedAssetUrl || !/^(asset:|http:\/\/asset\.localhost)/u.test(reloadedAssetUrl)) {
    throw new Error(`Reloaded editor image did not resolve through Tauri's asset protocol: ${reloadedAssetUrl}`);
  }
  await expect.poll(async () => importedCard.locator("img").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  importedClip = editor.locator(".aly-editor-clip--slides").filter({ hasText: importedImageName }).first();
  await importedClip.click();
  await expect(editor.getByLabel("End frame")).toHaveValue(String(trimmedEndFrame));
  titleClip = editor.locator(".aly-editor-clip--titles").first();
  await titleClip.click();
  await expect(editor.getByLabel("On-screen text")).toHaveValue(editedTitle);
  await page.screenshot({ path: path.join(evidenceRoot, "08-editor-reloaded-cas-media.png"), fullPage: true });

  await editor.getByRole("button", { name: "Render timeline" }).click();
  const editorStatus = editor.getByRole("status");
  await expect(editorStatus).toContainText("Timeline rendered to", { timeout: parsed.jobTimeoutMs });
  await page.screenshot({ path: path.join(evidenceRoot, "09-editor-render-complete.png"), fullPage: true });
  await editor.getByRole("button", { name: /return to scene/i }).click();
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /^review$/i }).click();
  await expect(page.getByRole("heading", { name: /review the whole argument/i })).toBeVisible();
  await expect(page.locator(".review-controls")).toContainText("Edited timeline export", { timeout: parsed.actionTimeoutMs });
  const reviewVideo = page.getByLabel("Authoritative generated tutorial media");
  await expect(reviewVideo).toBeVisible();
  await expect.poll(async () => reviewVideo.evaluate((video) => Number.isFinite(video.duration) && video.duration > 0), { timeout: parsed.actionTimeoutMs }).toBe(true);
  await page.screenshot({ path: path.join(evidenceRoot, "10-review-edited-timeline.png"), fullPage: true });

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}"));
  const project = persisted.projects?.find((candidate) => candidate.title === projectTitle);
  if (!project) throw new Error("The native-created tutorial was not persisted in the desktop workspace");
  if (project.duration !== 3) throw new Error(`Native tutorial duration was ${project.duration}, expected 3`);
  const nativeExport = persisted.jobs?.find((job) => job.operation === "export_master" && job.projectId === project.nativeProjectId);
  const nativeEditorExport = persisted.jobs?.find((job) => job.operation === "editor_timeline_export" && job.projectId === project.nativeProjectId);
  const result = nativeExport?.result ?? null;
  const editorResult = nativeEditorExport?.result ?? null;
  const nativeGeneration = persisted.jobs?.find((job) => job.id === project.nativeGenerationId);
  const generationState = receiptState(nativeGeneration);
  const exportState = receiptState(nativeExport);
  const editorExportState = receiptState(nativeEditorExport);
  if (generationState !== "SUCCEEDED") {
    throw new Error(`Native generation finished in ${generationState ?? "an unknown state"}, expected SUCCEEDED`);
  }
  if (exportState !== "SUCCEEDED") {
    throw new Error(`Native export finished in ${exportState ?? "an unknown state"}, expected SUCCEEDED`);
  }
  if (editorExportState !== "SUCCEEDED") {
    throw new Error(`Native editor export finished in ${editorExportState ?? "an unknown state"}, expected SUCCEEDED`);
  }
  if (typeof result?.path !== "string" || !result.path.trim()) {
    throw new Error("Successful native export did not return a media path");
  }
  const mediaBindings = await invokeNative(page, "editor_bindings_get", {
    projectId: project.nativeProjectId,
    projectDirectory: project.nativeProjectDirectory,
    generationId: project.nativeGenerationId,
  });
  if (mediaBindings.projectId !== project.nativeProjectId || mediaBindings.generationId !== project.nativeGenerationId) {
    throw new Error("Native editor bindings returned mismatched project or generation identity");
  }
  const presenterEvidence = [];
  for (const binding of mediaBindings.presenters ?? []) {
    const resolved = await invokeNative(page, "project_asset_resolve", {
      projectId: project.nativeProjectId,
      projectDirectory: project.nativeProjectDirectory,
      artifactHash: binding.artifactHash,
    });
    const details = await assertRegularFile(resolved.path, "generated presenter binding");
    presenterEvidence.push({
      sceneId: binding.sceneId,
      artifactHash: binding.artifactHash,
      mediaType: binding.mediaType,
      activeDurationSeconds: bindingDurationSeconds(binding),
      byteSize: details.size,
      resolvedPath: resolved.path,
    });
  }
  if (parsed.requirePresenter && presenterEvidence.length === 0) {
    throw new Error("Representative native acceptance required a presenter, but the generated binding set had none");
  }
  if (parsed.requirePresenter && !presenterEvidence.some((binding) => binding.activeDurationSeconds > 0)) {
    throw new Error("Representative native acceptance returned no positive presenter duration");
  }
  if (parsed.profileId === "portable-test-groq-nvidia-presenter") {
    assertRepresentativeProviderPolicy(project.providerRoutingPolicy);
  }
  await assertRegularFile(result.path, "exported master");
  if (typeof editorResult?.outputPath !== "string" || !editorResult.outputPath.trim()) {
    throw new Error("Successful native editor export did not return an output path");
  }
  await assertRegularFile(editorResult.outputPath, "edited timeline export");
  if (!Array.isArray(result.sidecarPaths) || result.sidecarPaths.length < 2) {
    throw new Error("Successful native export did not return its VTT and SRT sidecars");
  }
  await Promise.all(result.sidecarPaths.map((sidecar) => assertRegularFile(sidecar, "export sidecar")));
  const archivePath = archivePathText?.replace(/^\s*Last archive:\s*/, "").trim() ?? "";
  if (!archivePath) throw new Error("Portable project archive path was not shown after export");
  await assertRegularFile(archivePath, "portable project archive");
  await assertRegularFile(ffprobePath, "packaged ffprobe runtime");
  const mediaDurationSeconds = await probeDurationSeconds(ffprobePath, result.path);
  if (mediaDurationSeconds < 178 || mediaDurationSeconds > 182) {
    throw new Error(`Export duration was ${mediaDurationSeconds.toFixed(3)} seconds, expected approximately 180 seconds`);
  }
  const editorDurationSeconds = await probeDurationSeconds(ffprobePath, editorResult.outputPath);
  if (editorDurationSeconds < 178 || editorDurationSeconds > 182) {
    throw new Error(`Editor export duration was ${editorDurationSeconds.toFixed(3)} seconds, expected approximately 180 seconds`);
  }
  const report = {
    schemaVersion: 1,
    state: "passed",
    evidenceClass: parsed.evidenceClass,
    actualNativeWebView: true,
    nativeIpcExercised: true,
    hiddenLaunch: true,
    runtimeBoundary,
    executable,
    executableSha256: await sha256(executable),
    desktopPid: child.pid,
    workerPid,
    project: {
      id: project.nativeProjectId,
      directory: project.nativeProjectDirectory,
      title: project.title,
      durationMinutes: project.duration,
      archivePath,
      profileId: parsed.profileId,
      providerRoutingPolicy: project.providerRoutingPolicy ?? null,
      presenterCustomization: project.customization?.presenter ?? null,
    },
    mediaBindings: {
      visualCount: mediaBindings.assets?.length ?? 0,
      narrationCount: mediaBindings.narration?.length ?? 0,
      presenterCount: mediaBindings.presenters?.length ?? 0,
      compositeRenderCount: mediaBindings.renders?.length ?? 0,
      presenterEvidence,
      totalPresenterDurationSeconds: presenterEvidence.reduce((total, item) => total + item.activeDurationSeconds, 0),
    },
    generationState,
    exportState,
    editorExportState,
    exportResult: result,
    editorProof: {
      importedImageName,
      importedImageAssetProtocolUrl: reloadedAssetUrl,
      trimmedEndFrame,
      editedTitle,
      outputPath: editorResult.outputPath,
      artifactHash: editorResult.artifactHash,
      mediaType: editorResult.mediaType,
      durationSeconds: editorDurationSeconds,
      waveformRendered: true,
      reloadPreservedCasMedia: true,
    },
    codecPreference: parsed.codecPreference,
    mediaDurationSeconds,
    pageErrors,
    consoleErrors,
    startedAtUtc: startedAt.toISOString(),
    finishedAtUtc: new Date().toISOString(),
  };
  if (pageErrors.length || consoleErrors.length) throw new Error(`Native WebView emitted errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  completed = true;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  const failure = {
    schemaVersion: 1,
    state: "failed",
    evidenceClass: parsed.evidenceClass,
    actualNativeWebView: true,
    hiddenLaunch: true,
    executable,
    desktopPid: child?.pid ?? null,
    workerPid: workerPid ?? null,
    reason: error instanceof Error ? error.message : String(error),
    startedAtUtc: startedAt.toISOString(),
    failedAtUtc: new Date().toISOString(),
  };
  await writeFile(failurePath, `${JSON.stringify(failure, null, 2)}\n`, "utf8").catch(() => {});
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (child && child.exitCode === null) {
    await postWmClose(child.pid).catch(() => {});
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(15_000)]);
  }
  if (child && child.exitCode === null) child.kill();
  await Promise.all([stdout.close(), stderr.close()]);
  if (!completed) await rm(reportPath, { force: true });
}

function parseArguments(arguments_) {
  const result = {
    startupTimeoutMs: 120_000,
    actionTimeoutMs: 45_000,
    jobTimeoutMs: 300_000,
    topic: "How does Karatsuba multiplication reduce recursive work?",
    profileId: "portable-test-local",
    hardBudgetCents: 0,
    evidenceClass: "deterministic-native-integration-smoke",
    codecPreference: "av1",
    requirePresenter: false,
    credentialFile: null,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const name = arguments_[index];
    if (name === "--require-presenter") {
      result.requirePresenter = true;
      continue;
    }
    const value = arguments_[index + 1];
    if (name === "--portable-root") result.portableRoot = value;
    else if (name === "--startup-timeout-ms") result.startupTimeoutMs = positiveNumber(value, name);
    else if (name === "--action-timeout-ms") result.actionTimeoutMs = positiveNumber(value, name);
    else if (name === "--job-timeout-ms") result.jobTimeoutMs = positiveNumber(value, name);
    else if (name === "--topic") result.topic = requiredText(value, name, 240);
    else if (name === "--profile-id") result.profileId = requiredText(value, name, 100);
    else if (name === "--hard-budget-cents") result.hardBudgetCents = nonNegativeInteger(value, name);
    else if (name === "--evidence-class") result.evidenceClass = requiredText(value, name, 100);
    else if (name === "--codec") result.codecPreference = codecPreference(value, name);
    else if (name === "--credential-file") result.credentialFile = path.resolve(requiredText(value, name, 500));
    else throw new Error(`Unknown or incomplete argument: ${name}`);
    index += 1;
  }
  if (!result.portableRoot) throw new Error("--portable-root is required");
  if (result.profileId === "portable-test-groq-nvidia-presenter" && !result.credentialFile) {
    throw new Error("--credential-file is required for representative provider acceptance");
  }
  return result;
}

function codecPreference(value, name) {
  if (!["h264-hardware", "hevc-hardware", "av1"].includes(value)) {
    throw new Error(`${name} must be h264-hardware, hevc-hardware, or av1`);
  }
  return value;
}

function requiredText(value, name, maximumLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximumLength) {
    throw new Error(`${name} must be between 1 and ${maximumLength} characters`);
  }
  return value.trim();
}

function nonNegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${name} must be a non-negative integer`);
  return number;
}

function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be positive`);
  return number;
}

function completedOnboarding() {
  const chapters = ["welcome", "goal", "runtime", "privacy", "provider", "hardware", "model", "profile", "ready"];
  return {
    schemaVersion: 1,
    status: "completed",
    activeChapterId: "ready",
    completedChapterIds: chapters,
    visitedChapterIds: chapters,
    configuration: {
      goals: ["tutorial"], runtime: "local", privacy: "local-only", providerIds: [],
      modelIds: [], hardwareReviewed: true,
      profile: { displayName: "Native acceptance", portraitAssetId: "presenter-portrait.broadcast-elena-v1" },
    },
    revision: 9,
    updatedAt: new Date().toISOString(),
  };
}

function receiptState(job) {
  return job?.result?.receiptState ?? null;
}

async function waitForProjectGenerationState(page, title, terminalStates, timeoutMs) {
  let state = null;
  await expect.poll(async () => page.evaluate((projectTitle) => {
    const workspace = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    const project = workspace.projects?.find((candidate) => candidate.title === projectTitle);
    return Boolean(project && workspace.jobs?.some((candidate) => candidate.id === project.nativeGenerationId));
  }, title), { timeout: Math.min(timeoutMs, 30_000) }).toBe(true);
  await expect.poll(async () => {
    state = await page.evaluate((projectTitle) => {
      const workspace = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
      const project = workspace.projects?.find((candidate) => candidate.title === projectTitle);
      const job = workspace.jobs?.find((candidate) => candidate.id === project?.nativeGenerationId);
      return job?.result?.receiptState ?? null;
    }, title);
    return terminalStates.includes(state);
  }, { timeout: timeoutMs }).toBe(true);
  return state;
}

async function invokeNative(page, command, input) {
  return await page.evaluate(async ({ command, input }) => {
    const invoke = globalThis.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") throw new Error("Tauri IPC is unavailable in the native WebView");
    return await invoke(command, { input });
  }, { command, input });
}

async function configureNativeProviderSecrets(page, credentialFile) {
  const entries = new Map();
  for (const rawLine of (await readFile(credentialFile, "utf8")).split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separators = [line.indexOf(":"), line.indexOf("=")].filter((index) => index > 0);
    if (separators.length === 0) continue;
    const separator = Math.min(...separators);
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim().replace(/^(?:"|')|(?:"|')$/gu, "");
    if (value) entries.set(name, value);
  }
  const required = [
    { providerId: "groq", matches: (name) => name.includes("groq") },
    { providerId: "nvidia-nim", matches: (name) => name.includes("nvidia") && name.includes("nim") },
  ];
  try {
    for (const provider of required) {
      const match = [...entries].find(([name]) => provider.matches(name));
      if (!match) throw new Error(`Credential file has no ${provider.providerId} entry`);
      const receipt = await invokeNative(page, "provider_secret_set", {
        providerId: provider.providerId,
        credentialKind: "api_key",
        secret: match[1],
      });
      if (receipt?.availability !== "present" || receipt?.reference !== `keyring://alystria/${provider.providerId}/api_key`) {
        throw new Error(`Native vault did not confirm ${provider.providerId}`);
      }
      entries.set(match[0], "");
    }
  } finally {
    entries.clear();
  }
}

function bindingDurationSeconds(binding) {
  const ticks = Number(binding.activeDurationTicks ?? binding.durationTicks ?? 0);
  if (Number.isFinite(ticks) && ticks > 0) return ticks / 240_000;
  const milliseconds = Number(binding.durationMs ?? 0);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds / 1_000 : 0;
}

function assertRepresentativeProviderPolicy(policy) {
  if (!policy || !Array.isArray(policy.routes)) throw new Error("Representative profile did not persist its approved routing policy");
  const route = (capability) => policy.routes.find((candidate) => candidate.capability === capability);
  const expected = [
    ["llm.structured", "groq", "openai/gpt-oss-20b", null],
    ["image.generate", "nvidia-nim", "black-forest-labs/flux.2-klein-4b", null],
    ["audio.tts", "nvidia-nim", "nvidia/magpie-tts-multilingual", "Magpie-Multilingual.EN-US.Aria"],
  ];
  for (const [capability, providerId, model, voice] of expected) {
    const actual = route(capability);
    if (!actual || actual.providerIds?.[0] !== providerId || actual.model !== model || (actual.voice ?? null) !== voice) {
      throw new Error(`Representative route ${capability} did not match the reviewed ${providerId}/${model} contract`);
    }
  }
  const forbidden = new Set(["deepgram", "inworld", "cartesia"]);
  const usedForbidden = policy.routes.flatMap((candidate) => candidate.providerIds ?? []).find((providerId) => forbidden.has(providerId));
  if (usedForbidden) throw new Error(`Representative native acceptance unexpectedly routed through ${usedForbidden}`);
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForJson(file, timeoutMs, predicate) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse(await readFile(file, "utf8"));
      if (value?.state === "failed") throw new Error(`Native startup failed: ${value.reason ?? "unknown"}`);
      if (predicate(value)) return value;
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    if (child?.exitCode !== null) throw new Error(`Native app exited with code ${child.exitCode} before reporting readiness`);
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function connectToWebView(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch (error) {
      lastError = error;
      await delay(200);
    }
  }
  throw new Error(`Could not attach Playwright to the native WebView: ${lastError}`);
}

async function postWmClose(pid) {
  const helper = path.resolve(process.cwd(), "..", "..", "scripts", "post-wm-close.py");
  const python = process.env.PYTHON ?? "python";
  const close = spawn(python, [helper, "--pid", String(pid)], { windowsHide: true, stdio: "ignore" });
  await new Promise((resolve, reject) => {
    close.once("error", reject);
    close.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`WM_CLOSE helper exited ${code}`)));
  });
}

async function sha256(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", resolve);
    stream.once("error", reject);
  });
  return hash.digest("hex");
}

async function assertRegularFile(file, label) {
  if (typeof file !== "string" || !file.trim()) throw new Error(`${label} path is missing`);
  const details = await stat(file).catch((error) => {
    throw new Error(`${label} is unavailable at ${file}: ${error.message}`);
  });
  if (!details.isFile() || details.size <= 0) throw new Error(`${label} is not a non-empty regular file: ${file}`);
  return details;
}

async function probeDurationSeconds(ffprobe, media) {
  const { stdout } = await execFileAsync(ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    media,
  ], { encoding: "utf8", timeout: 60_000, windowsHide: true });
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Packaged ffprobe returned an invalid duration for ${media}`);
  }
  return seconds;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
