import { chromium, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

class PlanOnlyCompletion extends Error {}

const parsed = parseArguments(process.argv.slice(2));
const portableRoot = path.resolve(parsed.portableRoot);
const executable = path.join(portableRoot, "App", "AI Video Tutorial Generator.exe");
const workerExecutable = path.join(portableRoot, "Runtime", "alystria-pipeline.exe");
const packageManifestPath = path.join(portableRoot, "test-area-manifest.json");
const readyPath = path.join(portableRoot, "Evidence", "native-headless-ready.json");
const evidenceRoot = path.join(portableRoot, "Evidence", "native-ui-acceptance");
const stdoutPath = path.join(portableRoot, "Logs", "native-ui.stdout.log");
const stderrPath = path.join(portableRoot, "Logs", "native-ui.stderr.log");
const reportPath = path.join(evidenceRoot, "report.json");
const planReportPath = path.join(evidenceRoot, "plan-report.json");
const failurePath = path.join(evidenceRoot, "failure.json");
const ffprobePath = path.join(portableRoot, "Runtime", "ffmpeg", "ffprobe.exe");
const projectTitle = titleFromTopic(parsed.topic);
let activeProjectTitle = projectTitle;
const targetAudience = "Computer science learners familiar with multiplication and basic recursion";
const startedAt = new Date();
let child;
let browser;
let workerPid;
let completed = false;
let reviewedNarrationEdit = null;
let rootReviewedNarrationEdits = [];
let planningApproval = null;
let workError = null;
let finalReport = null;
let gpuObserverTask = null;
let gpuObserverAbort = null;
let gpuCoordinationEvidence = null;
let rotationSequence = 0;

await rotateExistingPath(evidenceRoot);
await mkdir(evidenceRoot, { recursive: true });
await rotateExistingPath(readyPath);
await rotateExistingPath(stdoutPath);
await rotateExistingPath(stderrPath);
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
  workerPid = validatedReadyWorkerPid(ready, child.pid);
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

  if (!parsed.resumeProject) {
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

  const runtimeBadge = page.locator(".runtime-badge");
  await expect(runtimeBadge).toContainText("Native", { timeout: parsed.actionTimeoutMs });
  await expect(runtimeBadge).toContainText("Worker ready", { timeout: parsed.actionTimeoutMs });
  await expect(runtimeBadge).toHaveAttribute("title", /Packaged native runtime/i);
  const runtimeBoundary = await runtimeBadge.getAttribute("title");
  if (parsed.credentialFile && !parsed.resumeProject) {
    await configureNativeProviderSecrets(page, parsed.credentialFile, parsed.profileId);
  }
  await page.screenshot({ path: path.join(evidenceRoot, "01-native-home.png"), fullPage: true });

  let jobs = page.getByRole("complementary", { name: /background jobs/i });
  if (parsed.resumeProject) {
    activeProjectTitle = await relinkNativeProjectIfMissing(page, projectTitle, parsed.resumeProjectDirectory);
    await waitForPersistedProjectByTitle(page, activeProjectTitle, parsed.actionTimeoutMs);
    const recovered = await persistedProjectByTitle(page, activeProjectTitle);
    await page.getByRole("button", { name: /open project/i }).click();
    await expect(page.getByRole("heading", { name: /shape the learning journey/i })).toBeVisible({ timeout: parsed.actionTimeoutMs });
    if (await jobs.count() === 0 || !await jobs.evaluate((element) => element.classList.contains("open"))) {
      await page.getByRole("button", { name: /^jobs$/i }).click();
    }
    if (parsed.retryFailedPlan) {
      const recoveredState = receiptState(recovered.generationJob);
      const planningJob = await jobCardById(page, jobs, recovered.generationJob.id);
      await expect(planningJob).toContainText("Creating learning plan");
      let currentState = recoveredState;
      if (currentState === "FAILED") {
        try {
          await expect.poll(async () => {
            currentState = receiptState((await persistedProjectByTitle(page, activeProjectTitle)).generationJob);
            return currentState;
          }, { timeout: 10_000 }).not.toBe("FAILED");
        } catch {
          await planningJob.getByRole("button", { name: /retry creating learning plan/i }).click();
          await expect.poll(async () => {
            currentState = receiptState((await persistedProjectByTitle(page, activeProjectTitle)).generationJob);
            return currentState;
          }, { timeout: parsed.actionTimeoutMs }).not.toBe("FAILED");
        }
      }
    }
    planningApproval = await waitForPlanningApproval(recovered.project.nativeProjectDirectory, recovered.generationJob.id, parsed.jobTimeoutMs);
  } else {
    await page.getByRole("button", { name: /new tutorial/i }).click();
    const wizard = page.locator(".wizard-modal");
    await wizard.getByPlaceholder(/explain why karatsuba/i).fill(parsed.topic);
    await wizard.getByRole("button", { name: /continue/i }).click();
    await wizard.getByLabel("Audience").fill(targetAudience);
    await wizard.getByLabel("Target duration").selectOption("custom");
    await wizard.getByLabel("Exact duration in minutes").fill("3");
    await wizard.getByLabel("Language").selectOption("English");
    await wizard.getByRole("button", { name: /continue/i }).click();
    await wizard.getByRole("button", { name: /^creative/i }).click();
    await wizard.getByRole("button", { name: /continue/i }).click();
    await wizard.getByRole("button", { name: "Standard", exact: true }).click();
    await expect(wizard.locator(".routing-readiness")).not.toContainText("Loading", { timeout: parsed.startupTimeoutMs });
    const providerSetupError = wizard.locator(".create-error");
    if (await providerSetupError.isVisible()) {
      throw new Error((await providerSetupError.textContent())?.trim() || "Provider setup failed to load");
    }
    await wizard.getByLabel("Creation profile").selectOption(parsed.profileId);
    await wizard.getByLabel("Content class", { exact: true }).selectOption("public");
    await wizard.getByLabel("Hard budget in cents").fill(String(parsed.hardBudgetCents));
    await wizard.getByRole("checkbox", { name: /approve this exact routing policy/i }).check();
    await expect(wizard.locator(".routing-readiness")).toContainText("Ready");
    await wizard.screenshot({ path: path.join(evidenceRoot, "02-reviewed-policy.png") });
    await wizard.getByRole("button", { name: /create learning plan/i }).click();

    await waitForPersistedProjectByTitle(page, projectTitle, parsed.actionTimeoutMs);
    const recovered = await persistedProjectByTitle(page, projectTitle);
    planningApproval = await waitForPlanningApproval(recovered.project.nativeProjectDirectory, recovered.generationJob.id, parsed.jobTimeoutMs);
    await expect(page.getByRole("heading", { name: /shape the learning journey/i })).toBeVisible({ timeout: parsed.actionTimeoutMs });
  }
  await expect(jobs).toHaveClass(/open/);
  const planProject = await persistedProjectByTitle(page, activeProjectTitle);
  const planningJob = await jobCardById(page, jobs, planProject.generationJob.id);
  await expect(planningJob).toContainText("blocked", { timeout: parsed.actionTimeoutMs });
  await page.screenshot({ path: path.join(evidenceRoot, "03-native-plan-blocked.png"), fullPage: true });
  if (!planningApproval?.generationId) throw new Error("The durable planning gate returned no generation identity");
  const planEvidence = readReviewablePlan(planProject.project.nativeProjectDirectory, planningApproval.generationId);
  if (parsed.requirePresenter) {
    assertRepresentativeProjectContract(planProject.project, planEvidence.storyboard.payload, parsed.profileId);
  }
  if (parsed.planOnly) {
    const planReport = {
      schemaVersion: 1,
      state: "blocked_for_review",
      actualNativeWebView: true,
      hiddenLaunch: true,
      projectId: planProject.project.nativeProjectId,
      projectDirectory: planProject.project.nativeProjectDirectory,
      generationJobId: planProject.generationJob.id,
      generationId: planningApproval.generationId,
      teachingBrief: parsed.topic,
      audience: targetAudience,
      providerRoutingPolicy: planProject.project.providerRoutingPolicy ?? null,
      presenter: planProject.project.customization?.presenter ?? null,
      stages: planEvidence,
      createdAtUtc: new Date().toISOString(),
    };
    await writeFile(planReportPath, `${JSON.stringify(planReport, null, 2)}\n`, "utf8");
    completed = true;
    process.stdout.write(`${JSON.stringify(planReport, null, 2)}\n`);
    throw new PlanOnlyCompletion();
  }
  await jobs.locator("header .icon-button").click();
  await page.locator(".plan-progress button").filter({ hasText: "Script" }).click();
  const reviewedProject = await persistedProjectByTitle(page, activeProjectTitle);
  if (parsed.reviewFile) {
    rootReviewedNarrationEdits = await applyReviewedNarrationFile(page, reviewedProject.project, parsed.reviewFile);
  }
  const reviewedScene = reviewedProject.project.scenes?.[0];
  if (!reviewedScene?.id) throw new Error("The reviewed plan has no first scene to edit");
  const narrationEditor = page.locator(".script-block").filter({ hasText: reviewedScene.title }).locator("p[contenteditable]").first();
  const beforeNarration = (await narrationEditor.innerText()).trim();
  const afterNarration = equivalentNarrationEdit(beforeNarration);
  await narrationEditor.fill(afterNarration);
  if (parsed.requirePresenter) {
    gpuObserverAbort = new AbortController();
    gpuObserverTask = observeGpuCoordination(parsed.gpuCoordinationPath, gpuObserverAbort.signal);
  }
  await page.getByRole("button", { name: /approve learning plan/i }).click();
  reviewedNarrationEdit = { sceneId: reviewedScene.id, before: beforeNarration, after: afterNarration };

  await expect(jobs).toHaveClass(/open/, { timeout: parsed.actionTimeoutMs });
  const generationJob = await jobCardById(page, jobs, reviewedProject.generationJob.id);
  const generationCompletion = (async () => {
    await expect(generationJob).toHaveClass(/complete/, { timeout: parsed.jobTimeoutMs });
    await expect(generationJob).toContainText("succeeded");
  })();
  await generationCompletion;
  if (gpuObserverTask) {
    gpuObserverAbort.abort();
    gpuCoordinationEvidence = await gpuObserverTask;
    if (!gpuCoordinationEvidence.transitions.some((event) => event.state === "yes")) {
      throw new Error("The backend presenter stage never recorded ownership in the shared GPU marker");
    }
    if (gpuCoordinationEvidence.finalState !== "no") {
      throw new Error(`The shared GPU marker finished in ${gpuCoordinationEvidence.finalState}, expected no`);
    }
  }
  await page.screenshot({ path: path.join(evidenceRoot, "04-native-generation-complete.png"), fullPage: true });

  if (!(await page.getByRole("heading", { name: /review the whole argument/i }).isVisible())) {
    await jobs.locator("header .icon-button").click();
    await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /^review$/i }).click();
  }
  await expect(page.getByRole("heading", { name: /review the whole argument/i })).toBeVisible();
  let reviewVideo = page.getByLabel("Authoritative generated tutorial media");
  await expect(reviewVideo).toBeVisible();
  await expect.poll(async () => reviewVideo.evaluate((video) => Number.isFinite(video.duration) && video.duration > 0), { timeout: parsed.actionTimeoutMs }).toBe(true);
  const generatedReviewPlayback = await verifyVideoPlayback(reviewVideo, parsed.actionTimeoutMs);
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

  const importedImageName = "included-chapter-frame.png";
  const importedImagePath = path.join(repoRoot, "apps", "desktop", "src", "assets", "teaching", "slide-chapter-v1.png");
  const editedTitle = "Karatsuba: three products";
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /^studio$/i }).click();
  await page.getByRole("button", { name: /^edit tracks & timing/i }).click();
  let editor = page.getByRole("dialog", { name: "Integrated advanced video editor" });
  await expect(editor).toBeVisible({ timeout: parsed.actionTimeoutMs });
  await editor.getByLabel("Rights for new editor media").selectOption("owned");
  await editor.getByLabel("Import media files").setInputFiles({
    name: importedImageName,
    mimeType: "image/png",
    buffer: await readFile(importedImagePath),
  });
  let importedCard = editor.getByRole("listitem").filter({ hasText: importedImageName });
  await expect(importedCard).toContainText("ready", { timeout: parsed.actionTimeoutMs });
  await expect.poll(async () => importedCard.locator("img").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);

  await editor.getByRole("button", { name: "Go to start" }).click();
  await editor.getByRole("button", { name: "Add title" }).click();
  let titleClip = editor.locator(".aly-editor-clip--titles").filter({ hasText: "New title" }).first();
  await expect(titleClip).toBeVisible();
  await editor.getByLabel("On-screen text").fill(editedTitle);
  await editor.getByLabel("Text size").fill("32");
  await editor.getByLabel("Text size").press("Enter");
  await editor.getByLabel("Text placement").selectOption("bottom");
  await page.waitForFunction(({ title, imported, text }) => {
    const workspace = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    const project = workspace.projects?.find((candidate) => candidate.title === title);
    const document = project?.editorDocument;
    if (!document) return false;
    const clips = (document.tracks ?? []).flatMap((track) => track.clips ?? []);
    return document.assets?.some((asset) => asset.name === imported && /^[0-9a-f]{64}$/u.test(asset.hash ?? ""))
      && clips.some((clip) => clip.kind === "titles" && clip.text === text);
  }, { title: activeProjectTitle, imported: importedImageName, text: editedTitle });
  await expect.poll(async () => {
    const durable = await invokeNative(page, "project_snapshot_get", {
      projectId: reviewedProject.project.nativeProjectId,
      projectDirectory: reviewedProject.project.nativeProjectDirectory,
    });
    const document = durable.snapshot?.editorDocument;
    const clips = document?.tracks?.flatMap((track) => track.clips ?? []) ?? [];
    return Boolean(document?.assets?.some((asset) => asset.name === importedImageName && /^[0-9a-f]{64}$/u.test(asset.hash ?? ""))
      && clips.some((clip) => clip.kind === "titles" && clip.text === editedTitle));
  }, { timeout: parsed.actionTimeoutMs }).toBe(true);
  await expect.poll(async () => editor.locator(".aly-editor-clip__waveform img").count(), { timeout: parsed.actionTimeoutMs }).toBeGreaterThan(0);
  await expect.poll(async () => editor.locator(".aly-editor-clip__waveform img").first().evaluate((image) => image.complete && image.naturalWidth > 0), { timeout: parsed.actionTimeoutMs }).toBe(true);
  await page.screenshot({ path: path.join(evidenceRoot, "07-editor-import-title-waveform.png"), fullPage: true });

  await editor.getByRole("button", { name: /return to scene/i }).click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(runtimeBadge).toContainText("Native", { timeout: parsed.actionTimeoutMs });
  if (await page.getByRole("navigation", { name: /project workspace/i }).count() === 0) {
    await page.getByRole("button", { name: /open project/i }).click();
  }
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /^studio$/i }).click();
  await page.getByRole("button", { name: /^edit tracks & timing/i }).click();
  editor = page.getByRole("dialog", { name: "Integrated advanced video editor" });
  await expect(editor).toBeVisible({ timeout: parsed.actionTimeoutMs });
  importedCard = editor.getByRole("listitem").filter({ hasText: importedImageName });
  await expect(importedCard).toContainText("ready", { timeout: parsed.actionTimeoutMs });
  const reloadedAssetUrl = await importedCard.locator("img").getAttribute("src");
  if (!reloadedAssetUrl || !/^(asset:|http:\/\/asset\.localhost)/u.test(reloadedAssetUrl)) {
    throw new Error(`Reloaded editor image did not resolve through Tauri's asset protocol: ${reloadedAssetUrl}`);
  }
  await expect.poll(async () => importedCard.locator("img").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  titleClip = editor.locator(".aly-editor-clip--titles").filter({ hasText: editedTitle }).first();
  await titleClip.click();
  await expect(editor.getByLabel("On-screen text")).toHaveValue(editedTitle);
  await page.screenshot({ path: path.join(evidenceRoot, "08-editor-reloaded-cas-media.png"), fullPage: true });

  await editor.getByRole("button", { name: "Render timeline" }).click();
  const editorStatus = editor.locator(".aly-editor-shell__status");
  await expect(editorStatus).toContainText("Timeline rendered to", { timeout: parsed.jobTimeoutMs });
  await page.screenshot({ path: path.join(evidenceRoot, "09-editor-render-complete.png"), fullPage: true });
  await editor.getByRole("button", { name: /return to scene/i }).click();
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /^review$/i }).click();
  await expect(page.getByRole("heading", { name: /review the whole argument/i })).toBeVisible();
  await expect(page.locator(".review-controls")).toContainText("Edited timeline export", { timeout: parsed.actionTimeoutMs });
  reviewVideo = page.getByLabel("Authoritative generated tutorial media");
  await expect(reviewVideo).toBeVisible();
  await expect.poll(async () => reviewVideo.evaluate((video) => Number.isFinite(video.duration) && video.duration > 0), { timeout: parsed.actionTimeoutMs }).toBe(true);
  const editedReviewPlayback = await verifyVideoPlayback(reviewVideo, parsed.actionTimeoutMs);
  await page.screenshot({ path: path.join(evidenceRoot, "10-review-edited-timeline.png"), fullPage: true });

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}"));
  const project = persisted.projects?.find((candidate) => candidate.title === activeProjectTitle);
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
  if (parsed.requirePresenter) {
    assertRepresentativeProviderPolicy(project.providerRoutingPolicy, parsed.profileId);
  }
  if (!reviewedNarrationEdit) throw new Error("The native journey did not record its pre-approval narration edit");
  const narrationStage = readGenerationStage(project.nativeProjectDirectory, project.nativeGenerationId, "generation.narration");
  const approvedNarration = narrationStage.payload?.narration?.find((item) => item.sceneId === reviewedNarrationEdit.sceneId);
  if (approvedNarration?.authoredText !== reviewedNarrationEdit.after) {
    throw new Error("Generated narration did not use the exact scene text reviewed immediately before approval");
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
  const packageManifestText = await readFile(packageManifestPath, "utf8");
  const packageManifest = JSON.parse(packageManifestText);
  await writeFile(path.join(evidenceRoot, "test-area-manifest.json"), packageManifestText, "utf8");
  finalReport = {
    schemaVersion: 1,
    state: "passed",
    evidenceClass: parsed.evidenceClass,
    actualNativeWebView: true,
    nativeIpcExercised: true,
    hiddenLaunch: true,
    runtimeBoundary,
    executable,
    executableSha256: await sha256(executable),
    workerExecutable,
    workerSha256: await sha256(workerExecutable),
    packageManifest: {
      createdAt: packageManifest.createdAt,
      desktop: packageManifest.desktop,
      pipelineWorker: packageManifest.pipelineWorker,
      rendererRuntime: packageManifest.rendererRuntime,
    },
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
      teachingBrief: parsed.topic,
      audience: targetAudience,
    },
    mediaBindings: {
      visualCount: mediaBindings.assets?.length ?? 0,
      narrationCount: mediaBindings.narration?.length ?? 0,
      presenterCount: mediaBindings.presenters?.length ?? 0,
      compositeRenderCount: mediaBindings.renders?.length ?? 0,
      presenterEvidence,
      totalPresenterDurationSeconds: presenterEvidence.reduce((total, item) => total + item.activeDurationSeconds, 0),
      gpuCoordination: gpuCoordinationEvidence,
    },
    generationState,
    exportState,
    editorExportState,
    exportResult: result,
    editorProof: {
      importedImageName,
      importedImageAssetProtocolUrl: reloadedAssetUrl,
      importedImagePlacement: "media-bin-only",
      editedTitle,
      outputPath: editorResult.outputPath,
      artifactHash: editorResult.artifactHash,
      mediaType: editorResult.mediaType,
      durationSeconds: editorDurationSeconds,
      waveformRendered: true,
      reloadPreservedCasMedia: true,
      editedReviewPlayback,
    },
    generatedReviewPlayback,
    reviewedNarrationEdit: {
      ...reviewedNarrationEdit,
      narrationStageArtifactHash: narrationStage.artifactHash,
      verifiedInGeneratedMedia: true,
    },
    rootReviewedNarrationEdits,
    codecPreference: parsed.codecPreference,
    mediaDurationSeconds,
    pageErrors,
    consoleErrors,
    startedAtUtc: startedAt.toISOString(),
    finishedAtUtc: null,
  };
  if (pageErrors.length || consoleErrors.length) throw new Error(`Native WebView emitted errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  completed = true;
} catch (error) {
  if (error instanceof PlanOnlyCompletion) {
    // The plan-only mode intentionally stops at the durable approval gate.
  } else {
  workError = error;
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
  }
} finally {
  let closeError = null;
  gpuObserverAbort?.abort();
  if (gpuObserverTask && !gpuCoordinationEvidence) {
    try {
      gpuCoordinationEvidence = await gpuObserverTask;
    } catch (error) {
      closeError = error;
    }
  }
  try {
    if (child && child.exitCode === null) {
      await postWmClose(child.pid);
      await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(15_000)]);
    }
    if (child && child.exitCode === null) {
      child.kill();
      throw new Error("Native app did not exit within 15 seconds of WM_CLOSE");
    }
    if (child && child.exitCode !== 0) throw new Error(`Native app exited with code ${child.exitCode}`);
    if (workerPid && !await waitForProcessExit(workerPid, 10_000)) throw new Error(`Native worker ${workerPid} remained alive after WM_CLOSE`);
  } catch (error) {
    closeError ??= error;
  }
  try {
    if (browser) await browser.close();
  } catch (error) {
    closeError ??= error;
  }
  await Promise.all([stdout.close(), stderr.close()]);
  if (completed && !closeError && finalReport) {
    finalReport.gracefulShutdown = true;
    finalReport.workerExitedWithApp = true;
    finalReport.finishedAtUtc = new Date().toISOString();
    await writeFile(reportPath, `${JSON.stringify(finalReport, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(finalReport, null, 2)}\n`);
  }
  if (!completed || closeError) {
    await rotateExistingPath(reportPath, "rejected");
    await rotateExistingPath(planReportPath, "rejected");
  }
  if (closeError && !workError) throw closeError;
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

function parseArguments(arguments_) {
  const result = {
    startupTimeoutMs: 120_000,
    actionTimeoutMs: 45_000,
    jobTimeoutMs: 300_000,
    topic:
      "Explain Karatsuba multiplication using 12 × 34, derive cross = (a + b)(c + d) - ac - bd, show how three recursive products give T(n) = 3T(n/2) + O(n), and recap when it helps.",
    profileId: "portable-test-local",
    hardBudgetCents: 0,
    evidenceClass: "deterministic-native-integration-smoke",
    codecPreference: "av1",
    requirePresenter: false,
    credentialFile: null,
    planOnly: false,
    resumeProject: false,
    resumeProjectDirectory: null,
    retryFailedPlan: false,
    reviewFile: null,
    gpuCoordinationPath: null,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const name = arguments_[index];
    if (name === "--require-presenter") {
      result.requirePresenter = true;
      continue;
    }
    if (name === "--plan-only") {
      result.planOnly = true;
      continue;
    }
    if (name === "--resume-project") {
      result.resumeProject = true;
      continue;
    }
    if (name === "--retry-failed-plan") {
      result.resumeProject = true;
      result.retryFailedPlan = true;
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
    else if (name === "--review-file") result.reviewFile = path.resolve(requiredText(value, name, 500));
    else if (name === "--gpu-coordination-path") result.gpuCoordinationPath = path.resolve(requiredText(value, name, 500));
    else if (name === "--resume-project-directory") {
      result.resumeProject = true;
      result.resumeProjectDirectory = path.resolve(requiredText(value, name, 500));
    }
    else throw new Error(`Unknown or incomplete argument: ${name}`);
    index += 1;
  }
  if (!result.portableRoot) throw new Error("--portable-root is required");
  if (/(?:groq|mistral)-nvidia|nvidia-writing/iu.test(result.profileId) && !result.credentialFile) {
    throw new Error("--credential-file is required for representative provider acceptance");
  }
  if (result.requirePresenter && !result.gpuCoordinationPath) {
    throw new Error("--gpu-coordination-path is required when --require-presenter is enabled");
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

function titleFromTopic(topic) {
  const normalized = topic.trim().replace(/\s+/gu, " ") || "Untitled tutorial";
  const firstClause = normalized.split(/[:\n.!?]/u, 1)[0]?.trim() ?? "";
  const candidate = firstClause.length >= 12 ? firstClause : normalized;
  if (candidate.length <= 160) return candidate;
  const prefix = candidate.slice(0, 157);
  const wordBoundary = prefix.lastIndexOf(" ");
  return `${wordBoundary >= 80 ? prefix.slice(0, wordBoundary) : prefix}…`;
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

async function persistedProjectByTitle(page, title) {
  return await page.evaluate((expectedTitle) => {
    const state = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    const project = state.projects?.find((candidate) => candidate.title === expectedTitle);
    if (!project?.nativeProjectId || !project?.nativeProjectDirectory) {
      throw new Error(`No native project is linked to ${expectedTitle}`);
    }
    const projectJobs = (state.jobs ?? []).filter((job) => job.projectId === project.nativeProjectId);
    const generationJob = projectJobs.find((job) => job.title === "Creating learning plan")
      ?? projectJobs.find((job) => job.operation === "generation_start");
    if (!generationJob) throw new Error(`No durable generation job is linked to ${expectedTitle}`);
    return { project, generationJob };
  }, title);
}

async function waitForPersistedProjectByTitle(page, title, timeoutMs) {
  await expect.poll(async () => page.evaluate((expectedTitle) => {
    const state = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    const project = state.projects?.find((candidate) => candidate.title === expectedTitle);
    return Boolean(project?.nativeProjectId && project?.nativeProjectDirectory);
  }, title), { timeout: timeoutMs }).toBe(true);
}

async function jobCardById(page, jobs, jobId) {
  const jobIndex = await page.evaluate((expectedJobId) => {
    const state = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    return (state.jobs ?? []).findIndex((job) => job.id === expectedJobId);
  }, jobId);
  if (jobIndex < 0) throw new Error(`No local job card is linked to ${jobId}`);
  return jobs.locator(".job-card").nth(jobIndex);
}

async function applyReviewedNarrationFile(page, project, reviewFile) {
  const mapping = JSON.parse(await readFile(reviewFile, "utf8"));
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    throw new Error("--review-file must contain a JSON object mapping scene IDs to narration strings");
  }
  const scenes = new Map((project.scenes ?? []).map((scene) => [scene.id, scene]));
  const edits = [];
  for (const [sceneId, narration] of Object.entries(mapping)) {
    const scene = scenes.get(sceneId);
    if (!scene) throw new Error(`Reviewed narration references unknown scene ${sceneId}`);
    if (typeof narration !== "string" || !narration.trim() || narration.trim().length > 20_000) {
      throw new Error(`Reviewed narration for ${sceneId} must be nonblank and at most 20000 characters`);
    }
    const editor = page.locator(".script-block").filter({ hasText: scene.title }).locator("p[contenteditable]").first();
    const before = (await editor.innerText()).trim();
    const after = narration.trim();
    await editor.fill(after);
    await editor.press("Tab");
    edits.push({ sceneId, before, after });
  }
  return edits;
}

async function relinkNativeProjectIfMissing(page, title, projectDirectory) {
  const alreadyLinked = await page.evaluate((expectedTitle) => {
    const state = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    const project = state.projects?.find((candidate) => candidate.title === expectedTitle);
    return Boolean(project?.nativeProjectId && project?.nativeProjectDirectory);
  }, title);
  if (alreadyLinked) return title;
  if (!projectDirectory) {
    throw new Error(`The native project ${title} is not linked in this WebView profile; pass --resume-project-directory to recover it`);
  }

  const handle = await invokeNative(page, "project_open", { projectDirectory, allowReadOnly: false });
  if (handle?.access !== "readWrite" || !handle?.manifest?.projectId) {
    throw new Error("The native project could not be reopened read-write for resume");
  }
  const identity = { projectId: handle.manifest.projectId, projectDirectory: handle.projectDirectory };
  const durable = await invokeNative(page, "project_snapshot_get", identity);
  const database = new DatabaseSync(path.join(handle.projectDirectory, "project.sqlite3"), { readOnly: true });
  let learningJob;
  try {
    learningJob = database.prepare("SELECT parameters_json FROM jobs WHERE kind = 'generation.learning_plan' ORDER BY created_at DESC LIMIT 1").get();
  } finally {
    database.close();
  }
  const generationId = typeof learningJob?.parameters_json === "string"
    ? JSON.parse(learningJob.parameters_json).generationId
    : null;
  if (typeof generationId !== "string") {
    throw new Error("The reopened project has no durable learning-plan job to resume");
  }
  const receipt = await invokeNative(page, "job_status", { ...identity, jobId: generationId });
  if (receipt?.jobId !== generationId || typeof receipt?.state !== "string") {
    throw new Error("The native worker returned an invalid learning-plan status while reopening the project");
  }

  await page.evaluate(({ durableSnapshot, projectIdentity, jobReceipt }) => {
    const current = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    const receiptState = jobReceipt.state;
    const status = receiptState === "SUCCEEDED"
      ? "complete"
      : receiptState === "RUNNING"
        ? "running"
        : ["QUEUED", "READY", "RETRY_WAIT"].includes(receiptState)
          ? "queued"
          : "attention";
    const project = {
      ...durableSnapshot.snapshot,
      id: projectIdentity.projectId,
      nativeProjectId: projectIdentity.projectId,
      nativeProjectDirectory: projectIdentity.projectDirectory,
      nativeHeadRevisionId: durableSnapshot.headRevisionId,
      nativeRevisionNumber: durableSnapshot.revisionNumber,
      nativeGenerationId: jobReceipt.jobId,
    };
    const job = {
      id: jobReceipt.jobId,
      title: "Creating learning plan",
      detail: jobReceipt.message || project.title,
      status,
      progress: status === "complete" ? 100 : status === "running" ? 12 : Number(jobReceipt.progress ?? 0),
      eta: status === "attention" ? (jobReceipt.retryable ? "retry available" : "review required") : status === "queued" ? "queued" : status === "running" ? "in progress" : undefined,
      projectId: projectIdentity.projectId,
      projectDirectory: projectIdentity.projectDirectory,
      retryable: Boolean(jobReceipt.retryable),
      result: { ...(jobReceipt.result ?? {}), receiptState },
    };
    localStorage.setItem("alystria-studio-v2", JSON.stringify({
      projects: [project, ...(current.projects ?? []).filter((candidate) => candidate.id !== project.id)],
      recentProjectId: project.id,
      studioMode: current.studioMode ?? "guided",
      jobs: [job, ...(current.jobs ?? []).filter((candidate) => candidate.id !== job.id)],
      version: Number(current.version ?? 0) + 1,
    }));
  }, { durableSnapshot: durable, projectIdentity: identity, jobReceipt: receipt });
  await page.reload({ waitUntil: "domcontentloaded" });
  const durableTitle = durable.snapshot?.title;
  if (typeof durableTitle !== "string" || !durableTitle.trim()) {
    throw new Error("The reopened project snapshot has no durable title");
  }
  return durableTitle;
}

function equivalentNarrationEdit(value) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("The first generated narration is empty");
  const substitutions = [
    [/\bWe will\b/iu, "We’ll"],
    [/\bWhy make\b/iu, "Why perform"],
  ];
  for (const [pattern, replacement] of substitutions) {
    if (pattern.test(trimmed)) return trimmed.replace(pattern, replacement);
  }
  throw new Error("The first reviewed narration has no natural bounded equivalent-edit target");
}

async function observeGpuCoordination(coordinationPath, signal) {
  const details = await assertRegularFile(coordinationPath, "shared GPU coordination file");
  if (details.size > 64) throw new Error("Shared GPU coordination file has an unexpected size");
  const transitions = [];
  let previous = null;
  while (!signal.aborted) {
    const current = (await readFile(coordinationPath, "utf8")).trim().toLowerCase();
    if (!new Set(["yes", "no"]).has(current)) {
      throw new Error(`Shared GPU coordination file has invalid state ${JSON.stringify(current)}`);
    }
    if (current !== previous) {
      transitions.push({ state: current, observedAtUtc: new Date().toISOString() });
      previous = current;
    }
    await delay(25);
  }
  const finalState = (await readFile(coordinationPath, "utf8")).trim().toLowerCase();
  if (finalState !== previous) transitions.push({ state: finalState, observedAtUtc: new Date().toISOString() });
  return { path: coordinationPath, mode: "read-only-observer", transitions, finalState };
}

function readGenerationStage(projectDirectory, generationId, kind) {
  const database = new DatabaseSync(path.join(projectDirectory, "project.sqlite3"), { readOnly: true });
  try {
    const rows = database.prepare("SELECT parameters_json, result_json FROM jobs WHERE kind = ? AND state = 'SUCCEEDED' ORDER BY updated_at DESC").all(kind);
    for (const row of rows) {
      const parameters = JSON.parse(row.parameters_json);
      if (parameters.generationId !== generationId) continue;
      const result = JSON.parse(row.result_json);
      if (!result?.payload || !/^[0-9a-f]{64}$/u.test(result.artifactHash ?? "")) throw new Error(`${kind} returned an invalid persisted payload`);
      return result;
    }
  } finally {
    database.close();
  }
  throw new Error(`No successful ${kind} stage exists for generation ${generationId}`);
}

function readReviewablePlan(projectDirectory, generationId) {
  const stages = Object.fromEntries([
    ["learningPlan", "generation.learning_plan"],
    ["script", "generation.script"],
    ["storyboard", "generation.storyboard"],
  ].map(([name, kind]) => {
    const result = readGenerationStage(projectDirectory, generationId, kind);
    return [name, { artifactHash: result.artifactHash, payload: result.payload }];
  }));
  return stages;
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

async function waitForPlanningApproval(projectDirectory, generationOrLearningJobId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const database = new DatabaseSync(path.join(projectDirectory, "project.sqlite3"), { readOnly: true });
    try {
      const learning = database.prepare("SELECT parameters_json FROM jobs WHERE job_id = ?").get(generationOrLearningJobId);
      const generationId = learning ? JSON.parse(learning.parameters_json).generationId : generationOrLearningJobId;
      const rows = database.prepare("SELECT kind, state, error_json, parameters_json, result_json FROM jobs WHERE kind LIKE 'generation.%'").all();
      const stages = new Map(rows
        .filter((row) => JSON.parse(row.parameters_json).generationId === generationId)
        .map((row) => [row.kind, row]));
      if (!stages.has("generation.learning_plan")) throw new Error(`Generation ${generationId} has no learning-plan job`);
      for (const kind of ["generation.learning_plan", "generation.script", "generation.storyboard"]) {
        const stage = stages.get(kind);
        if (["FAILED", "CANCELLED", "STALE"].includes(stage?.state)) {
          const error = stage.error_json ? JSON.parse(stage.error_json) : null;
          throw new Error(`${kind} finished in ${stage.state}: ${error?.message ?? "no durable error"}`);
        }
      }
      if (stages.get("generation.learning_plan")?.state === "SUCCEEDED"
        && stages.get("generation.script")?.state === "SUCCEEDED"
        && stages.get("generation.storyboard")?.state === "SUCCEEDED"
        && stages.get("generation.approval")?.state === "SUCCEEDED") {
        const approval = JSON.parse(stages.get("generation.approval").result_json ?? "null")?.payload?.approval;
        if (approval?.required === true && approval?.approved === false) return { generationId };
      }
    } catch (error) {
      if (!/database is locked/iu.test(error instanceof Error ? error.message : String(error))) throw error;
    } finally {
      database.close();
    }
    await delay(500);
  }
  throw new Error("Timed out waiting for learning plan, script, and storyboard to reach durable approval review");
}

async function invokeNative(page, command, input) {
  return await page.evaluate(async ({ command, input }) => {
    const invoke = globalThis.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") throw new Error("Tauri IPC is unavailable in the native WebView");
    return await invoke(command, { input });
  }, { command, input });
}

async function configureNativeProviderSecrets(page, credentialFile, profileId) {
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
  const writingProvider = profileId.includes("mistral")
    ? { providerId: "mistral", matches: (name) => name.includes("mistral") }
    : profileId.includes("nvidia-writing")
      ? { providerId: "nvidia-nim", matches: (name) => name.includes("nvidia") && name.includes("nim") }
      : { providerId: "groq", matches: (name) => name.includes("groq") };
  const required = [...new Map([
    writingProvider,
    { providerId: "nvidia-nim", matches: (name) => name.includes("nvidia") && name.includes("nim") },
  ].map((provider) => [provider.providerId, provider])).values()];
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

function assertRepresentativeProjectContract(project, storyboardPayload, profileId) {
  assertRepresentativeProviderPolicy(project?.providerRoutingPolicy, profileId);
  if (project?.customization?.presenter?.assetId !== "presenter-portrait.broadcast-elena-v1") {
    throw new Error("Representative project did not retain the reviewed Elena presenter profile");
  }
  const scenes = storyboardPayload?.storyboard?.scenes;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("Representative storyboard has no durable scenes to review");
  }
  const presenterIndexes = scenes.flatMap((scene, index) => String(scene?.type ?? scene?.kind ?? "").includes("presenter") ? [index] : []);
  if (presenterIndexes.length !== 1 || presenterIndexes[0] !== 0) {
    throw new Error(`Representative storyboard must use Elena only in the opening scene; found presenter scenes ${presenterIndexes.join(",") || "none"}`);
  }
}

function assertRepresentativeProviderPolicy(policy, profileId) {
  if (!policy || !Array.isArray(policy.routes)) throw new Error("Representative profile did not persist its approved routing policy");
  const route = (capability) => policy.routes.find((candidate) => candidate.capability === capability);
  const writing = profileId.includes("mistral")
    ? ["mistral", "mistral-small-2603"]
    : profileId.includes("nvidia-writing")
      ? ["nvidia-nim", "openai/gpt-oss-20b"]
    : profileId.includes("120b")
      ? ["groq", "openai/gpt-oss-120b"]
      : ["groq", "openai/gpt-oss-20b"];
  const expected = [
    ["llm.structured", writing[0], writing[1], null],
    ["image.generate", "nvidia-nim", "black-forest-labs/flux.2-klein-4b", null],
    ["audio.tts", "nvidia-nim", "nvidia/magpie-tts-multilingual", "Magpie-Multilingual.EN-US.Aria"],
    ["vlm.chat", "nvidia-nim", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", null],
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

function validatedReadyWorkerPid(ready, desktopPid) {
  const workerPid = Number(ready?.workerPid);
  if (ready?.schemaVersion !== 1 || ready?.workerHandshake !== true || Number(ready?.desktopPid) !== desktopPid) {
    throw new Error("Native readiness receipt does not identify this authenticated desktop launch");
  }
  if (!Number.isSafeInteger(workerPid) || workerPid <= 0) throw new Error("Native readiness receipt has an invalid worker PID");
  return workerPid;
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
  const helper = path.join(repoRoot, "scripts", "post-wm-close.py");
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

async function verifyVideoPlayback(video, timeoutMs) {
  await video.evaluate((element) => { element.muted = true; element.currentTime = 0; });
  const startedAt = await video.evaluate((element) => element.currentTime);
  await video.evaluate((element) => element.play());
  await expect.poll(() => video.evaluate((element) => element.currentTime), { timeout: timeoutMs }).toBeGreaterThan(startedAt + 0.1);
  const frame = await video.evaluate((element) => new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const timeout = window.setTimeout(() => finish({ presented: false, currentTime: element.currentTime }), 5_000);
    if (typeof element.requestVideoFrameCallback === "function") {
      element.requestVideoFrameCallback((_now, metadata) => {
        window.clearTimeout(timeout);
        finish({ presented: metadata.presentedFrames > 0, presentedFrames: metadata.presentedFrames, currentTime: element.currentTime });
      });
    } else {
      window.setTimeout(() => { window.clearTimeout(timeout); finish({ presented: element.currentTime > 0, currentTime: element.currentTime }); }, 250);
    }
  }));
  await video.evaluate((element) => element.pause());
  if (!frame.presented) throw new Error(`Review media advanced but did not present a decoded frame: ${JSON.stringify(frame)}`);
  return frame;
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return true; }
    await delay(100);
  }
  return false;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
