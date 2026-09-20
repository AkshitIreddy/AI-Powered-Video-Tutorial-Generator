/* global AbortController, Buffer, crypto, document, fetch, Image, localStorage, performance, setTimeout, window */

import { chromium, expect } from "@playwright/test";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  copySupplementalProject,
  inspectPackagedPresenterPlatform,
  inspectPresenterAcceptance,
  installSupplementalProject,
  preparePresenterComparison,
  recordNativeWalkthrough,
} from "./native-walkthrough-recording.mjs";

// Opt-in real native acceptance. The cloud path uses the product's smallest
// one-minute duration, stops before media unless planning produced three scenes,
// and reads existing OS-vault references without printing credentials. Grounded
// research is the default; --creative-only proves an explicit zero-research run.
// The local-image mode creates one reviewed SDXL scene through the same native UI.
const execFileAsync = promisify(execFile);
const completedWalkthroughRunId = "20260920082752680-25172";
const localImageWalkthroughRunId = "20260920083800359-5800";
const defaultPresenterAcceptanceRoot = "E:\\temp\\AI Video Tutorial Generator Test Sandbox\\Presenter Acceptance\\casual-four-20260920-161859";
const defaultGifsmithRoot = "C:\\Users\\akshi\\Desktop\\Code Palace\\gifsmith";
const parsed = parseArguments(process.argv.slice(2));
const portableRoot = path.resolve(parsed.portableRoot);
const executable = path.join(portableRoot, "App", "AI Video Tutorial Generator.exe");
const workerExecutable = path.join(portableRoot, "Runtime", "alystria-pipeline.exe");
const ffmpegPath = path.join(portableRoot, "Runtime", "ffmpeg", "ffmpeg.exe");
const ffprobePath = path.join(portableRoot, "Runtime", "ffmpeg", "ffprobe.exe");
const starterVisualManifestPath = path.join(portableRoot, "Runtime", "assets", "starter", "visuals", "packages", "themes", "starter-kits", "core.v1.json");
const appDataPath = path.join(portableRoot, "App Data");
const projectsPath = path.join(portableRoot, "Projects");
const readyPath = path.join(portableRoot, "Evidence", "native-headless-ready.json");
const evidenceRoot = path.join(portableRoot, "Evidence", "native-generation-smoke");
const runId = `${new Date().toISOString().replace(/[^0-9]/gu, "")}-${process.pid}`;
const runRoot = path.join(evidenceRoot, "runs", runId);
const journalPath = path.join(evidenceRoot, "owner-isolation.json");
const reportPath = path.join(runRoot, "report.json");
const failurePath = path.join(runRoot, "failure.json");
const latestReportPath = path.join(evidenceRoot, "report.json");
const latestFailurePath = path.join(evidenceRoot, "failure.json");
const packageManifestPath = path.join(portableRoot, "test-area-manifest.json");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const editorSmokeScript = path.join(repoRoot, "apps", "desktop", "e2e", "native-editor-smoke.mjs");
const recoverySmokeScript = path.join(repoRoot, "apps", "desktop", "e2e", "native-recovery.mjs");
const projectTitle = titleFromTopic(parsed.topic);
const selectedGroundingMode = parsed.creativeOnly ? "creative" : "grounded";
const selectedGroundingLabel = parsed.creativeOnly ? "Creative" : "Grounded";
const configureProfileScript = path.join(repoRoot, "scripts", "configure-portable-test-profile.ps1");
const creativeResumeBaselineRunId = "20260920072848479-11328";
const localImagePrompt = "Decorative chapter-slide background, abstract cream, navy, and cool teal palette, subtle paper texture, restrained diagonal shapes at the edges, large empty center for editable lesson content, no objects, no celestial bodies, no text, no letters, no logos";
const researchRoute = Object.freeze({ providerId: "gemini", model: "gemini-3.8-flash" });

const expectedRoutes = Object.freeze({
  "llm.structured": ["groq", "openai/gpt-oss-20b"],
  "research.web": [researchRoute.providerId, researchRoute.model],
  "image.generate": ["nvidia-nim", "black-forest-labs/flux.2-klein-4b"],
  "audio.tts": ["nvidia-nim", "nvidia/magpie-tts-multilingual"],
  "vlm.chat": ["nvidia-nim", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"],
});
const forbiddenProviders = new Set(["deepgram", "inworld", "cartesia"]);
assertWindowsContainmentContracts();

let rotationSequence = 0;
let launch;
let bootstrapLaunch;
let workError;
let cleanupError;
let report;
let isolation;
let isolatedAppDataEvidencePath;
let isolatedProjectsEvidencePath;
let ownerStateRestored = false;
let ownerProjectsRestored = false;
let activeProjectIdentity;
let activeGenerationId;
let failureDiagnostics = null;
let failureScreenshotPath = null;
let localPreviewDiagnostics = null;
let localPreviewDiagnosticsPath = null;
let walkthroughEvidence = null;

await mkdir(runRoot, { recursive: true });
await recoverInterruptedOwnerIsolation();
await assertNoForeignOwnerIsolation();
await assertNoPortableOwnedProcesses();
const resumeSource = parsed.resumeCompletedRun
  ? await inspectCompletedCreativeSource(parsed.resumeCompletedRun)
  : parsed.resumeCreativeRun ? await inspectCreativeResumeSource(parsed.resumeCreativeRun) : null;
const resumeLocalImageSource = parsed.resumeLocalImageRun
  ? await inspectAcceptedLocalImageSource(parsed.resumeLocalImageRun)
  : null;
const walkthroughLocalImageSource = parsed.recordWalkthrough
  ? await inspectAcceptedLocalImageSource(parsed.walkthroughLocalImageRun)
  : null;
const presenterAcceptance = parsed.recordWalkthrough
  ? await inspectPresenterAcceptance({ root: parsed.presenterAcceptanceRoot, ffprobePath })
  : null;
await rotateExistingPath(readyPath);

try {
  await assertRegularFile(executable, "packaged desktop executable");
  await assertRegularFile(workerExecutable, "packaged pipeline worker");
  await assertRegularFile(ffmpegPath, "packaged ffmpeg");
  await assertRegularFile(ffprobePath, "packaged ffprobe");
  isolation = await isolateOwnerDirectories();
  if (resumeSource || resumeLocalImageSource) await hydrateResumeSource(resumeSource ?? resumeLocalImageSource);
  const walkthroughLocalProjectDirectory = walkthroughLocalImageSource
    ? await copySupplementalProject({ source: walkthroughLocalImageSource, projectsPath })
    : null;

  bootstrapLaunch = await startBootstrapNative();
  const bootstrapDesktopPid = bootstrapLaunch.child.pid;
  const bootstrapWorkerPid = bootstrapLaunch.workerPid;
  await closeBootstrapNative(bootstrapLaunch);
  bootstrapLaunch = undefined;
  await rotateExistingPath(readyPath, "bootstrap-ready");
  await configurePortableTestProfile();
  const alignmentRuntime = parsed.localImageOnly ? null : await assertInstalledAlignmentRuntime();

  launch = await startNative("desktop");
  const { page } = launch;
  const pageErrors = [];
  const consoleErrors = [];
  const consoleMessages = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    consoleMessages.push({
      type: message.type(),
      text: message.text().slice(0, 2_000),
      location: message.location(),
    });
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  if (!resumeSource && !resumeLocalImageSource) {
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
  await expect(page.locator(".aly-onboarding-dialog")).toBeHidden();
  const walkthroughLocalProject = walkthroughLocalImageSource && walkthroughLocalProjectDirectory
    ? await installSupplementalProject({
      page,
      source: walkthroughLocalImageSource,
      projectDirectory: walkthroughLocalProjectDirectory,
      invokeNative,
    })
    : null;
  await page.screenshot({ path: path.join(runRoot, "01-native-home.png"), fullPage: true });

  if (parsed.localImageOnly) {
    const localImage = resumeLocalImageSource
      ? await continueAcceptedLocalImage(page, resumeLocalImageSource, consoleMessages, pageErrors)
      : await runLocalImageOnlyAcceptance(page);
    if (pageErrors.length || consoleErrors.length) {
      throw new Error(`Native WebView emitted errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
    }
    const packageManifestText = await readFile(packageManifestPath, "utf8");
    const packageManifest = JSON.parse(packageManifestText);
    await writeFile(path.join(runRoot, "test-area-manifest.json"), packageManifestText, "utf8");
    report = {
      schemaVersion: 1,
      state: "passed",
      evidenceClass: parsed.resumeLocalImageRun
        ? "bounded-real-native-local-sdxl-image-continuation"
        : "bounded-real-native-local-sdxl-image",
      actualNativeWebView: true,
      hiddenLaunch: true,
      realProviderCalls: false,
      localGpuGeneration: !parsed.resumeLocalImageRun,
      reusedAcceptedLocalImageEvidence: Boolean(parsed.resumeLocalImageRun),
      presenterMode: "off",
      loraCount: 0,
      projectId: localImage.projectId,
      relativeProjectDirectory: localImage.relativeProjectDirectory,
      relativeMediaPath: localImage.relativeImagePath,
      localImage,
      packageManifest: {
        createdAt: packageManifest.createdAt,
        desktop: packageManifest.desktop,
        pipelineWorker: packageManifest.pipelineWorker,
        rendererRuntime: packageManifest.rendererRuntime,
      },
      executableSha256: await sha256File(executable),
      workerSha256: await sha256File(workerExecutable),
      bootstrapDesktopPid,
      bootstrapWorkerPid,
      desktopPid: launch.child.pid,
      workerPid: launch.workerPid,
      finishedAtUtc: new Date().toISOString(),
    };
  } else {
  const prepared = parsed.resumeCompletedRun
    ? await continueCompletedCreativeGeneration(page, resumeSource)
    : resumeSource ? await resumeCreativeGeneration(page, resumeSource) : await createAndGenerateCloudTutorial(page);
  const {
    identity,
    generationId,
    planned,
    plannedScenes,
    researchEvidence,
    jobs,
    approvedBranch,
    resumeEvidence,
  } = prepared;

  const renderStage = readGenerationStage(
    identity.projectDirectory,
    generationId,
    "generation.render",
    approvedBranch.approvalRevisionId,
  );
  const qaStage = readGenerationStage(
    identity.projectDirectory,
    generationId,
    "generation.qa_final",
    approvedBranch.approvalRevisionId,
  );
  const exportStage = readGenerationStage(
    identity.projectDirectory,
    generationId,
    "generation.export",
    approvedBranch.approvalRevisionId,
  );
  const candidate = renderStage.payload?.candidate;
  if (!candidate || !/^[0-9a-f]{64}$/u.test(candidate.renderArtifactHash ?? "")) {
    throw new Error("Successful render stage returned no content-addressed media artifact");
  }
  if (qaStage.payload?.qualityGate?.status !== "PASS" || qaStage.payload?.passed !== true) {
    throw new Error(`Final quality review did not pass: ${qaStage.payload?.qualityGate?.status ?? "missing"}`);
  }
  if (exportStage.payload?.videoArtifactHash !== candidate.renderArtifactHash) {
    throw new Error("Export did not promote the exact reviewed render artifact");
  }

  const resolved = await invokeNative(page, "project_asset_resolve", {
    projectId: identity.projectId,
    projectDirectory: identity.projectDirectory,
    artifactHash: candidate.renderArtifactHash,
  });
  const mediaDetails = await assertRegularFile(resolved.path, "generated tutorial media");
  const mediaSha256 = await sha256File(resolved.path);
  if (mediaSha256 !== candidate.renderArtifactHash) {
    throw new Error("Resolved tutorial media does not match its content-addressed hash");
  }
  const exportDetails = await assertRegularFile(exportStage.payload.path, "promoted tutorial export");
  const exportSha256 = await sha256File(exportStage.payload.path);
  if (exportSha256 !== candidate.renderArtifactHash) {
    throw new Error("Promoted tutorial export differs from the reviewed render artifact");
  }
  const fittedNarrationStage = readGenerationStage(
    identity.projectDirectory,
    generationId,
    "generation.narration",
    approvedBranch.approvalRevisionId,
  );
  const fittedScenes = fittedNarrationStage.payload?.storyboard?.scenes;
  const fittedDurationTicks = Array.isArray(fittedScenes)
    ? fittedScenes.reduce((total, scene) => total + Number(scene?.durationTicks ?? 0), 0)
    : 0;
  if (!Number.isSafeInteger(fittedDurationTicks) || fittedDurationTicks <= 0) {
    throw new Error("Successful narration stage returned no authoritative fitted storyboard duration");
  }
  const fittedDurationSeconds = fittedDurationTicks / 240_000;
  const mediaProbe = await probeMedia(resolved.path);
  if (Math.abs(mediaProbe.durationSeconds - fittedDurationSeconds) > 0.25) {
    throw new Error(`Generated tutorial is ${mediaProbe.durationSeconds.toFixed(3)} seconds; fitted storyboard is ${fittedDurationSeconds.toFixed(3)} seconds`);
  }
  if (!mediaProbe.video || !mediaProbe.audio) {
    throw new Error("Generated tutorial does not contain both decodable video and audio streams");
  }
  await decodeMediaSample(resolved.path);

  const usage = readUsageRecords(identity.projectDirectory);
  if (parsed.resumeCompletedRun) {
    assertUsageRecordsMatch(resumeSource.baselineUsage, usage, "completed continuation before playback and editor checks");
  }
  const providerFootprint = assertBoundedProviderFootprint(usage, plannedScenes.length, parsed.creativeOnly ? 0 : 1);
  await page.screenshot({ path: path.join(runRoot, "04-generation-succeeded.png"), fullPage: true });
  if (!(await page.getByRole("heading", { name: /review the whole argument/i }).isVisible())) {
    if (await jobs.isVisible()) await jobs.locator("header .icon-button").click();
    await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /^review$/i }).click();
  }
  await expect(page.getByRole("heading", { name: /review the whole argument/i })).toBeVisible();
  const reviewVideo = page.getByLabel("Authoritative generated tutorial media");
  await expect(reviewVideo).toBeVisible();
  const playback = await verifyVideoPlayback(reviewVideo, parsed.actionTimeoutMs);
  await page.screenshot({ path: path.join(runRoot, "05-generated-review.png"), fullPage: true });

  if (parsed.recordWalkthrough) {
    if (!presenterAcceptance || !walkthroughLocalProject || !walkthroughLocalImageSource) {
      throw new Error("Walkthrough recording prerequisites were not loaded");
    }
    const presenterPlatform = await inspectPackagedPresenterPlatform({
      starterManifestPath: starterVisualManifestPath,
      runtimeStatuses: await invokeNativeWithoutInput(page, "local_presenter_runtime_status"),
    });
    const comparison = await preparePresenterComparison({
      page,
      presenterAcceptance,
      projectsPath,
      invokeNative,
      actionTimeoutMs: parsed.actionTimeoutMs,
      jobTimeoutMs: parsed.jobTimeoutMs,
      ffprobePath,
      onIdentity: (nextIdentity) => {
        activeProjectIdentity = nextIdentity;
        activeGenerationId = undefined;
      },
    });
    walkthroughEvidence = await recordNativeWalkthrough({
      page,
      cdpPort: launch.port,
      gifsmithRoot: parsed.gifsmithRoot,
      runRoot,
      ffmpegPath,
      ffprobePath,
      skyProjectTitle: planned.project.title,
      localImageProjectTitle: walkthroughLocalProject.title,
      comparison,
      presenterPlatform,
    });
    assertUsageRecordsMatch(
      walkthroughLocalImageSource.baselineUsage,
      readUsageRecords(walkthroughLocalProject.nativeProjectDirectory),
      "walkthrough accepted local-image project",
    );
    if (readUsageRecords(comparison.identity.projectDirectory).length !== 0) {
      throw new Error("Presenter comparison editor project unexpectedly recorded provider usage");
    }
    if (await sha256File(walkthroughLocalImageSource.failurePath) !== walkthroughLocalImageSource.failureSha256
      || await sha256File(walkthroughLocalImageSource.sourceProjectDatabasePath) !== walkthroughLocalImageSource.sourceProjectDatabaseSha256) {
      throw new Error("Walkthrough changed the preserved local-image source evidence");
    }
    const comparisonRelativeProjectDirectory = containedRelativePath(projectsPath, comparison.identity.projectDirectory, "presenter comparison project");
    const comparisonRelativeOutputPath = containedRelativePath(comparison.identity.projectDirectory, comparison.outputPath, "presenter comparison export");
    const comparisonReport = { ...comparison };
    delete comparisonReport.identity;
    delete comparisonReport.outputPath;
    walkthroughEvidence.comparison = {
      ...comparisonReport,
      identity: { projectId: comparison.identity.projectId },
      relativeProjectDirectory: comparisonRelativeProjectDirectory,
      relativeOutputPath: comparisonRelativeOutputPath,
    };
    walkthroughEvidence.localImageSource = {
      runId: walkthroughLocalImageSource.runId,
      projectId: walkthroughLocalImageSource.projectId,
      relativeProjectDirectory: containedRelativePath(projectsPath, walkthroughLocalProject.nativeProjectDirectory, "walkthrough local-image project"),
      candidateId: walkthroughLocalImageSource.acceptedCandidate.id,
      artifactHash: walkthroughLocalImageSource.acceptedCandidate.artifactHash,
      providerCalls: 0,
      localInferenceCalls: 0,
    };
    walkthroughEvidence.presenterAcceptance = {
      reportPath: presenterAcceptance.reportPath,
      reportSha256: presenterAcceptance.reportSha256,
      sourceAudioSha256: presenterAcceptance.audioSha256,
      modelId: presenterAcceptance.modelId,
      runtimeRevision: presenterAcceptance.runtimeRevision,
      clips: presenterAcceptance.clips.map((clip) => ({ slug: clip.slug, profileId: clip.profileId, sha256: clip.videoSha256 })),
    };
  }

  if (pageErrors.length || consoleErrors.length) {
    throw new Error(`Native WebView emitted errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  }
  const packageManifestText = await readFile(packageManifestPath, "utf8");
  const packageManifest = JSON.parse(packageManifestText);
  await writeFile(path.join(runRoot, "test-area-manifest.json"), packageManifestText, "utf8");
  const relativeProjectDirectory = containedRelativePath(projectsPath, identity.projectDirectory, "native project");
  const relativeMediaPath = containedRelativePath(identity.projectDirectory, resolved.path, "generated media");
  const relativeExportPath = containedRelativePath(identity.projectDirectory, exportStage.payload.path, "promoted export");

  report = {
    schemaVersion: 1,
    state: "passed",
    evidenceClass: parsed.recordWalkthrough
      ? "actual-native-gifsmith-walkthrough"
      : parsed.resumeCompletedRun
      ? "bounded-real-creative-native-generation-completed-continuation"
      : parsed.resumeCreativeRun ? "bounded-real-creative-native-generation-resume"
      : parsed.creativeOnly ? "bounded-real-creative-native-generation" : "bounded-real-grounded-native-generation",
    actualNativeWebView: true,
    hiddenLaunch: !parsed.recordWalkthrough,
    realProviderCalls: !parsed.resumeCompletedRun,
    reusedAcceptedProviderEvidence: Boolean(parsed.resumeCompletedRun),
    selectedProfileId: parsed.profileId,
    groundingMode: selectedGroundingMode,
    visualMode: "designed",
    presenterMode: "off",
    requestedDurationSeconds: 60,
    projectId: identity.projectId,
    generationId,
    approvalRevisionId: approvedBranch.approvalRevisionId,
    relativeProjectDirectory,
    relativeMediaPath,
    sceneCount: plannedScenes.length,
    providerRoutingPolicy: planned.project.providerRoutingPolicy,
    researchEvidence,
      ...(resumeEvidence ? { resumeEvidence } : {}),
      providerFootprint,
      alignmentRuntime,
      media: {
      artifactHash: candidate.renderArtifactHash,
      mediaType: candidate.renderMediaType,
      byteSize: mediaDetails.size,
      sha256: mediaSha256,
      ...mediaProbe,
      fittedDurationTicks,
      fittedDurationSeconds,
      oneSecondDecodePassed: true,
      inAppPlayback: playback,
    },
    promotedExport: {
      relativePath: relativeExportPath,
      byteSize: exportDetails.size,
      sha256: exportSha256,
    },
    qualityGate: qaStage.payload.qualityGate,
    relativeExportPath,
    packageManifest: {
      createdAt: packageManifest.createdAt,
      desktop: packageManifest.desktop,
      pipelineWorker: packageManifest.pipelineWorker,
      rendererRuntime: packageManifest.rendererRuntime,
    },
    executableSha256: await sha256File(executable),
    workerSha256: await sha256File(workerExecutable),
    bootstrapDesktopPid,
    bootstrapWorkerPid,
    desktopPid: launch.child.pid,
    workerPid: launch.workerPid,
    finishedAtUtc: new Date().toISOString(),
    ...(walkthroughEvidence ? { walkthrough: walkthroughEvidence } : {}),
  };
  if (parsed.editorSmoke) {
    const generatedMediaPath = exportStage.payload.path;
    await closeNative(launch);
    launch = undefined;
    report.editorSmoke = await runEditorSmoke({
      projectDirectory: identity.projectDirectory,
      projectId: identity.projectId,
      projectTitle: planned.project.title,
      generatedMediaPath,
      generatedMediaSha256: mediaSha256,
    });
  }
  if (parsed.recoverySmoke) {
    if (launch) {
      await closeNative(launch);
      launch = undefined;
    }
    report.recoverySmoke = await runRecoverySmoke();
  }
  if (parsed.resumeCompletedRun) {
    assertUsageRecordsMatch(
      resumeSource.baselineUsage,
      readUsageRecords(identity.projectDirectory),
      "completed continuation after playback, editor, and recovery checks",
    );
    assertGenerationJobRecordsMatch(
      resumeSource.baselineJobs,
      readGenerationJobRecords(identity.projectDirectory, generationId),
      "completed continuation after playback, editor, and recovery checks",
    );
    if (await sha256File(resumeSource.failurePath) !== resumeSource.failureSha256
      || await sha256File(resumeSource.sourceProjectDatabasePath) !== resumeSource.sourceProjectDatabaseSha256) {
      throw new Error("Original completed-generation evidence changed during editor or recovery continuation checks");
    }
    report.resumeEvidence.acceptedUsageRecordsPreservedAfterAllChecks = true;
  }
  }
} catch (error) {
  workError = error;
  if (launch?.page && !launch.page.isClosed()) {
    const candidate = path.join(runRoot, "failure.png");
    try {
      await launch.page.screenshot({ path: candidate, fullPage: true, timeout: 15_000 });
      failureScreenshotPath = candidate;
    } catch {
      // Preserve the original acceptance failure; diagnostics and logs remain available.
    }
  }
  if (activeProjectIdentity?.projectDirectory && activeGenerationId) {
    try {
      failureDiagnostics = readGenerationDiagnostics(activeProjectIdentity.projectDirectory, activeGenerationId);
    } catch (diagnosticError) {
      failureDiagnostics = { unavailable: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError) };
    }
  } else if (activeProjectIdentity?.projectDirectory) {
    try {
      failureDiagnostics = readNativeProjectDiagnostics(activeProjectIdentity.projectDirectory);
    } catch (diagnosticError) {
      failureDiagnostics = { unavailable: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError) };
    }
  }
} finally {
  const cleanupErrors = [];
  if (bootstrapLaunch) await closeBootstrapNative(bootstrapLaunch).catch((error) => cleanupErrors.push(error));
  if (launch) await closeNative(launch).catch((error) => cleanupErrors.push(error));
  if (isolation) {
    await preserveIsolatedStateAndRestoreOwner(isolation).then((evidence) => {
      isolatedAppDataEvidencePath = evidence.appData;
      isolatedProjectsEvidencePath = evidence.projects;
      ownerStateRestored = true;
      ownerProjectsRestored = true;
    }).catch((error) => cleanupErrors.push(error));
  }
  if (cleanupErrors.length) {
    cleanupError = workError
      ? new AggregateError([workError, ...cleanupErrors], "Native generation smoke failed and cleanup also failed")
      : new AggregateError(cleanupErrors, "Native generation smoke cleanup failed");
  }
}

if (report && !workError && !cleanupError) {
  report.runId = runId;
  report.runEvidenceDirectory = runRoot;
  report.gracefulShutdown = true;
  report.workerExitedWithApp = true;
  report.isolatedPortableAppData = true;
  report.isolatedAppDataEvidencePath = isolatedAppDataEvidencePath;
  report.isolatedPortableProjects = true;
  report.isolatedProjectsEvidencePath = isolatedProjectsEvidencePath;
  report.ownerStateRestored = ownerStateRestored;
  report.ownerProjectsRestored = ownerProjectsRestored;
  report.projectEvidenceDirectory = path.join(isolatedProjectsEvidencePath, report.relativeProjectDirectory);
  report.mediaEvidencePath = path.join(report.projectEvidenceDirectory, report.relativeMediaPath);
  if (report.relativeExportPath) report.exportEvidencePath = path.join(report.projectEvidenceDirectory, report.relativeExportPath);
  if (report.editorSmoke?.relativeOutputPath) {
    report.editorSmoke.outputEvidencePath = path.join(report.projectEvidenceDirectory, report.editorSmoke.relativeOutputPath);
  }
  if (report.recoverySmoke?.relativeProjectDirectory) {
    report.recoverySmoke.projectEvidenceDirectory = path.join(isolatedProjectsEvidencePath, report.recoverySmoke.relativeProjectDirectory);
  }
  if (report.walkthrough?.comparison?.relativeProjectDirectory) {
    report.walkthrough.comparison.projectEvidenceDirectory = path.join(isolatedProjectsEvidencePath, report.walkthrough.comparison.relativeProjectDirectory);
    report.walkthrough.comparison.outputEvidencePath = path.join(report.walkthrough.comparison.projectEvidenceDirectory, report.walkthrough.comparison.relativeOutputPath);
  }
  if (report.walkthrough?.localImageSource?.relativeProjectDirectory) {
    report.walkthrough.localImageSource.projectEvidenceDirectory = path.join(isolatedProjectsEvidencePath, report.walkthrough.localImageSource.relativeProjectDirectory);
  }
  await rm(latestFailurePath, { force: true });
  await writeJson(reportPath, report);
  await writeJson(latestReportPath, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
if (workError || cleanupError) {
  const error = cleanupError ?? workError;
  const failure = {
    schemaVersion: 1,
    state: "failed",
    runId,
    runEvidenceDirectory: runRoot,
    evidenceClass: parsed.recordWalkthrough
      ? "actual-native-gifsmith-walkthrough"
      : parsed.localImageOnly
      ? parsed.resumeLocalImageRun
        ? "bounded-real-native-local-sdxl-image-continuation"
        : "bounded-real-native-local-sdxl-image"
      : parsed.resumeCompletedRun
        ? "bounded-real-creative-native-generation-completed-continuation"
        : parsed.resumeCreativeRun ? "bounded-real-creative-native-generation-resume"
        : parsed.creativeOnly ? "bounded-real-creative-native-generation" : "bounded-real-grounded-native-generation",
    reason: error instanceof Error ? error.message : String(error),
    ownerStateRestored,
    ownerProjectsRestored,
    isolatedAppDataEvidencePath: isolatedAppDataEvidencePath ?? null,
    isolatedProjectsEvidencePath: isolatedProjectsEvidencePath ?? null,
    failureScreenshotPath,
    localPreviewDiagnosticsPath,
    localPreviewDiagnostics,
    generationDiagnostics: failureDiagnostics,
    finishedAtUtc: new Date().toISOString(),
  };
  await rm(latestReportPath, { force: true });
  await writeJson(failurePath, failure);
  await writeJson(latestFailurePath, failure);
  throw error;
}

async function configurePortableTestProfile() {
  await assertRegularFile(configureProfileScript, "portable test-profile configurator");
  const arguments_ = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", configureProfileScript,
    "-PortableRoot", portableRoot,
  ];
  if (parsed.alignmentConfigPath) arguments_.push("-ForcedAlignerConfigPath", parsed.alignmentConfigPath);
  await execFileAsync("powershell.exe", arguments_, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}

async function createAndGenerateCloudTutorial(page) {
  await page.locator("button.new-project-button").click();
  const wizard = page.locator(".wizard-modal");
  await expect(wizard).toBeVisible();
  await expect(wizard.getByText(/budget|privacy boundary|data classification|cloud approval/i)).toHaveCount(0);
  await wizard.getByPlaceholder("What would you like to teach? Describe your topic, question, or learning goal.").fill(parsed.topic);
  await wizard.getByRole("button", { name: /continue/i }).click();
  await wizard.getByRole("textbox", { name: /^Audience$/u }).fill("Curious adults with no physics background");
  await wizard.getByRole("combobox", { name: /^Target duration$/u }).selectOption("1");
  await wizard.getByRole("combobox", { name: /^Language$/u }).selectOption("English");
  await wizard.getByRole("combobox", { name: /^Tutorial method/u }).selectOption("visual-explanation");
  await wizard.getByRole("button", { name: /continue/i }).click();
  await expect(wizard.getByRole("heading", { name: "Who will teach?" })).toBeVisible();
  await expect(wizard.getByRole("button", { name: "Just the lesson" })).toHaveAttribute("aria-pressed", "true");
  await wizard.getByRole("button", { name: /continue/i }).click();
  const groundingChoice = wizard.getByRole("button", { name: new RegExp(`^${selectedGroundingLabel}`, "iu") });
  await groundingChoice.click();
  await expect(groundingChoice).toHaveClass(/active/u);
  await wizard.getByRole("button", { name: /continue/i }).click();
  await wizard.getByRole("button", { name: "Standard", exact: true }).click();
  await expect(wizard.getByText(/budget|privacy boundary|data classification|cloud approval/i)).toHaveCount(0);
  await wizard.getByLabel("Creation profile").selectOption(parsed.profileId);
  const routingReadiness = wizard.locator(".routing-readiness");
  await expect(routingReadiness).not.toContainText("Loading", { timeout: parsed.startupTimeoutMs });
  const setupError = wizard.locator(".create-error");
  if (await setupError.count() && await setupError.isVisible()) {
    throw new Error(`Selected provider profile is not ready: ${(await setupError.innerText()).trim()}`);
  }
  await expect(routingReadiness).toContainText("Ready");
  const routeReview = await wizard.locator(".routing-route-list").innerText();
  for (const value of ["research", researchRoute.providerId, researchRoute.model, "writing", "groq"]) {
    if (!routeReview.toLowerCase().includes(value.toLowerCase())) throw new Error(`Selected-profile review omitted ${value}`);
  }
  const researchReview = wizard.locator(".brief-preview dl > div").filter({ hasText: "Research" });
  await expect(researchReview.locator("dd")).toHaveText(selectedGroundingLabel);
  await page.screenshot({ path: path.join(runRoot, `02-${selectedGroundingMode}-profile-ready.png`), fullPage: true });
  await wizard.getByRole("button", { name: /create learning plan/i }).click();

  const persisted = await waitForPersistedProjectByTitle(page, projectTitle, parsed.actionTimeoutMs);
  const identity = { projectId: persisted.project.nativeProjectId, projectDirectory: persisted.project.nativeProjectDirectory };
  const generationId = persisted.generationJob.id;
  activeProjectIdentity = identity;
  activeGenerationId = generationId;
  const approval = await waitForPlanningApproval(identity.projectDirectory, generationId, parsed.jobTimeoutMs);
  if (approval.generationId !== generationId) throw new Error("Planning approval returned a different generation identity");
  const planned = await persistedProject(page, identity);
  assertProviderPolicy(planned.project.providerRoutingPolicy);
  const preApprovalStages = readPreApprovalStages(identity.projectDirectory, generationId);
  const plannedScenes = assertThreePlannedScenes(preApprovalStages);
  const preApprovalUsage = readUsageRecords(identity.projectDirectory);
  const researchEvidence = parsed.creativeOnly
    ? assertCreativeResearchBypass(preApprovalStages.research, preApprovalUsage, identity.projectDirectory)
    : assertRealGroundedResearch(preApprovalStages.research.payload, preApprovalUsage, identity.projectDirectory);

  const jobs = page.getByRole("complementary", { name: /background jobs/i });
  if (await jobs.evaluate((element) => element.classList.contains("open"))) await jobs.locator("header .icon-button").click();
  const projectNavigation = page.getByRole("navigation", { name: /project workspace/i });
  await projectNavigation.getByRole("button", { name: /^studio$/i }).click();
  await page.locator(".inspector-tabs").getByRole("button", { name: /^generate$/i }).click();
  const creativeInspector = page.locator(".creative-inspector");
  const designedLayout = creativeInspector.getByRole("button", { name: /^designed layout/i });
  await designedLayout.click();
  await expect(designedLayout).toHaveClass(/active/);
  await expect.poll(async () => {
    const durable = await invokeNative(page, "project_snapshot_get", identity);
    return durable.snapshot?.creative?.slide?.mode ?? null;
  }, { timeout: parsed.actionTimeoutMs }).toBe("designed");
  await page.screenshot({ path: path.join(runRoot, "03-designed-no-presenter.png"), fullPage: true });

  await projectNavigation.getByRole("button", { name: /^plan$/i }).click();
  await page.locator(".plan-progress button").filter({ hasText: "Script" }).click();
  await page.getByRole("button", { name: /approve learning plan/i }).click();
  await expect(jobs).toHaveClass(/open/, { timeout: parsed.actionTimeoutMs });
  const generationJob = jobs.locator(".job-card").filter({ hasText: "Creating learning plan" });
  await expect(generationJob).toBeVisible();
  const approvedBranch = await waitForApprovedMediaBranch(identity.projectDirectory, generationId, parsed.actionTimeoutMs);
  await assertApprovedBranchSucceeded(identity.projectDirectory, approvedBranch);
  await expect(generationJob).toContainText("succeeded", { timeout: parsed.actionTimeoutMs });
  return { identity, generationId, planned, plannedScenes, researchEvidence, jobs, generationJob, approvedBranch, resumeEvidence: null };
}

async function resumeCreativeGeneration(page, source) {
  const identity = {
    projectId: source.projectId,
    projectDirectory: path.join(projectsPath, source.relativeProjectDirectory),
  };
  const generationId = source.generationId;
  activeProjectIdentity = identity;
  activeGenerationId = generationId;
  const planned = await persistedProject(page, identity);
  if (planned.project.nativeGenerationId !== generationId) {
    throw new Error("Preserved UI state does not point to the exact failed generation being resumed");
  }
  assertProviderPolicy(planned.project.providerRoutingPolicy);
  const preApprovalStages = readPreApprovalStages(identity.projectDirectory, generationId);
  const plannedScenes = assertThreePlannedScenes(preApprovalStages);
  const beforeUsage = readUsageRecords(identity.projectDirectory);
  assertUsageRecordsMatch(source.baselineUsage, beforeUsage, "hydrated resume baseline");
  const researchEvidence = assertCreativeResearchBypass(preApprovalStages.research, beforeUsage, identity.projectDirectory);
  await openRestoredProjectFromHome(page, identity, planned.project.title);
  const jobs = page.getByRole("complementary", { name: /background jobs/i });
  if (!await jobs.isVisible()) {
    await page.getByRole("button", { name: "Jobs", exact: true }).click();
  }
  await expect(jobs).toHaveClass(/open/u);
  const generationJob = jobs.locator(".job-card").filter({ hasText: "Creating learning plan" });
  await expect(generationJob).toBeVisible();
  const retry = generationJob.getByRole("button", { name: /^Retry Creating learning plan$/u });
  await expect(retry).toBeVisible({ timeout: parsed.actionTimeoutMs });
  const approvedBranch = await waitForApprovedMediaBranch(identity.projectDirectory, generationId, parsed.actionTimeoutMs);
  await page.screenshot({ path: path.join(runRoot, "02-resume-ready.png"), fullPage: true });
  await retry.click();
  await expect(generationJob).toContainText(/queued|running|in progress/iu, { timeout: parsed.actionTimeoutMs });
  await assertApprovedBranchSucceeded(identity.projectDirectory, approvedBranch);
  await expect(generationJob).toContainText("succeeded", { timeout: parsed.actionTimeoutMs });

  const finalUsage = readUsageRecords(identity.projectDirectory);
  assertResumedStageAttempts(source.baselineJobs, readGenerationJobRecords(identity.projectDirectory, generationId));
  assertAuthoringAndNarrationUsageUnchanged(source.baselineUsage, finalUsage);
  const reuse = assertResumedNarrationEvidence(identity.projectDirectory, generationId, approvedBranch.approvalRevisionId);
  if (await sha256File(source.failurePath) !== source.failureSha256) {
    throw new Error("The original failed-run evidence changed while resuming its copied state");
  }
  if (await sha256File(source.sourceProjectDatabasePath) !== source.sourceProjectDatabaseSha256) {
    throw new Error("The original failed project database changed while resuming its copied state");
  }
  await page.screenshot({ path: path.join(runRoot, "03-resume-generation-succeeded.png"), fullPage: true });
  return {
    identity,
    generationId,
    planned,
    plannedScenes,
    researchEvidence,
    jobs,
    generationJob,
    approvedBranch,
    resumeEvidence: {
      sourceRunId: source.runId,
      sourceFailureSha256: source.failureSha256,
      sourceProjectDatabaseSha256: source.sourceProjectDatabaseSha256,
      sourceEvidencePreserved: true,
      copiedAppDataEntries: source.appDataEntries,
      projectId: identity.projectId,
      generationId,
      authoringAndNarrationUsageIdsPreserved: true,
      baselineUsageIds: source.baselineUsage.map((row) => row.usageId).sort(),
      narrationReuse: reuse,
    },
  };
}

async function continueCompletedCreativeGeneration(page, source) {
  const identity = {
    projectId: source.projectId,
    projectDirectory: path.join(projectsPath, source.relativeProjectDirectory),
  };
  const generationId = source.generationId;
  activeProjectIdentity = identity;
  activeGenerationId = generationId;
  const planned = await persistedProject(page, identity);
  if (planned.project.nativeGenerationId !== generationId) {
    throw new Error("Preserved UI state does not point to the exact completed generation being continued");
  }
  assertProviderPolicy(planned.project.providerRoutingPolicy);
  const preApprovalStages = readPreApprovalStages(identity.projectDirectory, generationId);
  const plannedScenes = assertThreePlannedScenes(preApprovalStages);
  const researchEvidence = assertCreativeResearchBypass(preApprovalStages.research, source.baselineUsage, identity.projectDirectory);
  assertUsageRecordsMatch(source.baselineUsage, readUsageRecords(identity.projectDirectory), "hydrated completed generation");
  const hydratedJobs = readGenerationJobRecords(identity.projectDirectory, generationId);
  assertCompletedGenerationJobs(hydratedJobs, source.approvalRevisionId);
  assertGenerationJobRecordsMatch(source.baselineJobs, hydratedJobs, "hydrated completed generation");
  const reuse = assertResumedNarrationEvidence(identity.projectDirectory, generationId, source.approvalRevisionId);
  await openRestoredProjectFromHome(page, identity, planned.project.title);
  assertUsageRecordsMatch(source.baselineUsage, readUsageRecords(identity.projectDirectory), "completed generation after UI open");
  if (await sha256File(source.failurePath) !== source.failureSha256
    || await sha256File(source.sourceProjectDatabasePath) !== source.sourceProjectDatabaseSha256
    || await sha256File(source.originalBaseline.failurePath) !== source.originalBaseline.failureSha256
    || await sha256File(source.originalBaseline.sourceProjectDatabasePath) !== source.originalBaseline.sourceProjectDatabaseSha256) {
    throw new Error("Preserved completed-generation evidence or its original Creative baseline changed during continuation");
  }
  await page.screenshot({ path: path.join(runRoot, "02-completed-generation-reused.png"), fullPage: true });
  return {
    identity,
    generationId,
    planned,
    plannedScenes,
    researchEvidence,
    jobs: page.getByRole("complementary", { name: /background jobs/i }),
    approvedBranch: { generationId, approvalRevisionId: source.approvalRevisionId },
    resumeEvidence: {
      mode: "completed-continuation",
      sourceRunId: source.runId,
      originalCreativeBaselineRunId: source.originalBaseline.runId,
      sourceFailureSha256: source.failureSha256,
      sourceProjectDatabaseSha256: source.sourceProjectDatabaseSha256,
      originalCreativeBaselineFailureSha256: source.originalBaseline.failureSha256,
      originalCreativeBaselineProjectDatabaseSha256: source.originalBaseline.sourceProjectDatabaseSha256,
      sourceEvidencePreserved: true,
      copiedAppDataEntries: source.appDataEntries,
      projectId: identity.projectId,
      generationId,
      approvalRevisionId: source.approvalRevisionId,
      generationPipelineInvoked: false,
      acceptedUsageRecordsPreserved: true,
      baselineUsageIds: source.baselineUsage.map((row) => row.usageId).sort(),
      narrationReuse: reuse,
    },
  };
}

async function openRestoredProjectFromHome(page, identity, title) {
  const projectNavigation = page.getByRole("navigation", { name: /project workspace/i });
  if (!await projectNavigation.isVisible()) {
    const featured = page.locator(".continue-section");
    await expect(featured.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: parsed.actionTimeoutMs });
    const selectedId = await page.evaluate(() => {
      const workspace = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
      return workspace.recentProjectId ?? null;
    });
    if (selectedId !== identity.projectId) {
      throw new Error("Preserved Home state does not feature the exact project selected for continuation");
    }
    await featured.getByRole("button", { name: /^Open project/u }).click();
  }
  await expect(projectNavigation).toBeVisible({ timeout: parsed.actionTimeoutMs });
  await expect(page.locator(".project-switcher strong")).toHaveText(title);
}

async function assertApprovedBranchSucceeded(projectDirectory, approvedBranch) {
  const completion = await waitForApprovedBranchCompletion(projectDirectory, approvedBranch, parsed.jobTimeoutMs);
  if (completion.state !== "SUCCEEDED") {
    throw new Error(`${completion.kind} finished in ${completion.state}: ${completion.message ?? "no durable error"}`);
  }
}

function assertThreePlannedScenes(preApprovalStages) {
  const plannedScenes = preApprovalStages.storyboard.payload?.storyboard?.scenes;
  if (!Array.isArray(plannedScenes) || plannedScenes.length !== 3) {
    throw new Error(`Bounded acceptance requires exactly three planned scenes before media calls; received ${plannedScenes?.length ?? "none"}`);
  }
  return plannedScenes;
}

async function runLocalImageOnlyAcceptance(page) {
  await assertGpuMarkerReady(parsed.gpuCoordinationPath);
  let installedStatuses = [];
  await expect.poll(async () => {
    installedStatuses = await invokeNativeWithoutInput(page, "local_model_download_status");
    return ["runtime/comfyui-0.9.2", "local/sdxl-base-1.0"].map((modelId) => {
      const phase = installedStatuses.find((status) => status.modelId === modelId)?.phase;
      return ["ready", "inUse"].includes(phase) ? "ready" : phase ?? "missing";
    });
  }, { timeout: parsed.startupTimeoutMs, message: "Wait for startup hash verification before using installed models" }).toEqual(["ready", "ready"]);
  const install = assertManagedSdxlReady(installedStatuses);
  const initialSnapshot = localImageProjectDocument();
  const handle = await invokeNative(page, "project_create", {
    parentDirectory: projectsPath,
    directoryName: `local-sdxl-smoke-${Date.now().toString(36)}`,
    title: initialSnapshot.title,
    locale: "en-US",
    groundingMode: "creative",
    initialSnapshot,
  });
  const identity = {
    projectId: handle.manifest.projectId,
    projectDirectory: handle.projectDirectory,
  };
  activeProjectIdentity = identity;
  const durable = await invokeNative(page, "project_snapshot_get", identity);
  const project = {
    ...initialSnapshot,
    id: identity.projectId,
    nativeProjectId: identity.projectId,
    nativeProjectDirectory: identity.projectDirectory,
    nativeHeadRevisionId: durable.headRevisionId,
    nativeRevisionNumber: durable.revisionNumber,
  };
  await page.evaluate(({ project, onboarding }) => {
    localStorage.setItem("alystria-onboarding-v1", JSON.stringify(onboarding));
    localStorage.setItem("alystria-guided-tour-v1", "completed");
    localStorage.setItem("alystria-studio-v2", JSON.stringify({
      projects: [project],
      recentProjectId: project.id,
      studioMode: "guided",
      version: 0,
      jobs: [],
    }));
  }, { project, onboarding: completedOnboarding() });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".runtime-badge")).toContainText("Worker ready", { timeout: parsed.actionTimeoutMs });
  await page.locator(".continue-section").getByRole("button", { name: /^Open project/u }).click();
  const projectNavigation = page.getByRole("navigation", { name: /project workspace/i });
  await expect(projectNavigation).toBeVisible();
  await projectNavigation.getByRole("button", { name: /^studio$/i }).click();
  await page.locator(".inspector-tabs").getByRole("button", { name: /^generate$/i }).click();

  const creativeInspector = page.locator(".creative-inspector");
  const slideControls = creativeInspector.locator(".creative-inspector__body");
  const illustrated = creativeInspector.getByRole("button", { name: /^Illustrated canvas/u });
  await illustrated.click();
  await expect(illustrated).toHaveClass(/active/);
  await slideControls.getByRole("combobox", { name: /^Image route/u }).selectOption("local/sdxl-base-1.0");
  const offsetLora = slideControls.getByRole("checkbox", { name: /^Official SDXL offset LoRA/u });
  if (await offsetLora.isChecked()) await offsetLora.uncheck();
  await expect(offsetLora).not.toBeChecked();
  await slideControls.getByRole("textbox", { name: /^Artwork direction/u }).fill(localImagePrompt);
  await slideControls.getByRole("textbox", { name: /^Seed/u }).fill("424242");
  await expect.poll(async () => {
    const current = await invokeNative(page, "project_snapshot_get", identity);
    const slide = current.snapshot?.creative?.slide;
    return {
      mode: slide?.mode,
      imageModel: slide?.imageModel,
      prompt: slide?.prompt,
      loras: slide?.loras,
      seed: slide?.seed,
    };
  }, { timeout: parsed.actionTimeoutMs }).toEqual({
    mode: "illustrated",
    imageModel: "local/sdxl-base-1.0",
    prompt: localImagePrompt,
    loras: [],
    seed: 424242,
  });
  await page.screenshot({ path: path.join(runRoot, "02-local-sdxl-ready.png"), fullPage: true });

  const controller = new AbortController();
  const observationPromise = observeGpuCoordination(parsed.gpuCoordinationPath, controller.signal);
  let gpuObservation;
  try {
    await creativeInspector.getByRole("button", { name: /^Generate scene artwork$/u }).click();
    await waitForLocalImageJobTerminal(identity.projectDirectory, parsed.jobTimeoutMs);
    const review = page.getByRole("region", { name: "Generated image candidates" });
    await expect(review).toBeVisible({ timeout: parsed.actionTimeoutMs });
    const image = review.locator("img");
    await expect(image).toBeVisible({ timeout: parsed.actionTimeoutMs });
    await expect.poll(
      () => image.evaluate((element) => ({ complete: element.complete, width: element.naturalWidth, height: element.naturalHeight })),
      { timeout: parsed.actionTimeoutMs },
    ).toEqual({ complete: true, width: 1344, height: 768 });
    await waitForGpuState(parsed.gpuCoordinationPath, "no", 30_000);
    const jobs = page.getByRole("complementary", { name: /background jobs/i });
    if (await jobs.count() && await jobs.evaluate((element) => element.classList.contains("open"))) {
      await jobs.locator("header .icon-button").click();
    }
    await review.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(runRoot, "03-local-sdxl-candidate.png"), fullPage: true });
  } finally {
    controller.abort();
    gpuObservation = await observationPromise;
  }
  assertGpuLeaseCycle(gpuObservation);

  const generated = await invokeNative(page, "project_snapshot_get", identity);
  const candidates = Array.isArray(generated.snapshot.sceneCandidates)
    ? generated.snapshot.sceneCandidates.filter((candidate) => candidate?.role === "scene")
    : [];
  if (candidates.length !== 1) throw new Error(`Expected one local scene image candidate, found ${candidates.length}`);
  const candidate = candidates[0];
  assertLocalSdxlCandidate(candidate);
  const job = readLocalImageJob(identity.projectDirectory);
  if (job.result?.candidateIds?.length !== 1 || job.result.candidateIds[0] !== candidate.id) {
    throw new Error("The native regeneration receipt does not identify the one visible SDXL candidate");
  }
  const acceptance = readLocalImageProviderAcceptance(identity.projectDirectory, job.jobId);
  if (acceptance.provider !== "comfyui-local" || acceptance.model !== candidate.model
    || acceptance.result?.id !== candidate.id || acceptance.result?.artifactHash !== candidate.artifactHash) {
    throw new Error("The exactly-once local provider receipt does not match the visible SDXL candidate");
  }
  const usage = readUsageRecords(identity.projectDirectory).filter((row) => row.jobId === job.jobId);
  if (usage.length !== 1
    || usage[0].provider !== "comfyui-local"
    || usage[0].unit !== "image"
    || usage[0].quantity !== 1
    || usage[0].costMicros !== 0
    || usage[0].metadata?.providerUnits?.images !== 1
    || usage[0].metadata?.providerUnits?.steps !== 25) {
    throw new Error(`Expected exactly one zero-cost 25-step ComfyUI usage record: ${JSON.stringify(usage)}`);
  }
  const resolved = await invokeNative(page, "project_asset_resolve", {
    ...identity,
    artifactHash: candidate.artifactHash,
  });
  const imageDetails = await assertRegularFile(resolved.path, "local SDXL CAS image");
  const imageSha256 = await sha256File(resolved.path);
  if (imageSha256 !== candidate.artifactHash) throw new Error("Resolved SDXL image differs from its CAS hash");
  const dimensions = await pngDimensions(resolved.path);
  if (dimensions.width !== 1344 || dimensions.height !== 768) {
    throw new Error(`Local SDXL returned ${dimensions.width}x${dimensions.height}; expected the reviewed 1344x768 scene recipe`);
  }

  const useArtwork = page.getByRole("button", { name: /use this scene artwork/i });
  await expect(useArtwork).toBeEnabled();
  await useArtwork.click();
  await expect(page.getByText("This image is selected for the tutorial.")).toBeVisible({ timeout: parsed.actionTimeoutMs });
  const accepted = await invokeNative(page, "project_snapshot_get", identity);
  const acceptedCandidate = accepted.snapshot.sceneCandidates?.find((item) => item?.id === candidate.id);
  const acceptedScene = accepted.snapshot.scenes?.find((item) => item?.id === "scene-local-sdxl");
  if (acceptedCandidate?.status !== "accepted"
    || acceptedScene?.visualArtifactHash !== candidate.artifactHash
    || !accepted.snapshot.customization?.assets?.some((asset) => asset?.sha256 === candidate.artifactHash && asset?.kind === "background")) {
    throw new Error("The reviewed SDXL candidate was not promoted into the durable scene and asset ledger");
  }
  const acceptedPreview = await waitForAcceptedScenePreview(page);
  await page.screenshot({ path: path.join(runRoot, "04-local-sdxl-accepted.png"), fullPage: true });

  return {
    projectId: identity.projectId,
    relativeProjectDirectory: containedRelativePath(projectsPath, identity.projectDirectory, "local SDXL project"),
    relativeImagePath: containedRelativePath(identity.projectDirectory, resolved.path, "local SDXL CAS image"),
    imageJobId: job.jobId,
    imageJobState: job.state,
    providerAcceptanceCheckpointId: acceptance.checkpointId,
    acceptedHeadRevisionId: accepted.headRevisionId,
    candidateId: candidate.id,
    artifactHash: candidate.artifactHash,
    mediaType: candidate.mediaType,
    byteSize: imageDetails.size,
    sha256: imageSha256,
    dimensions,
    provider: candidate.provider,
    model: candidate.model,
    recipeId: candidate.recipeId,
    seed: candidate.seed,
    steps: 25,
    sampler: "dpmpp_2m",
    scheduler: "karras",
    cfg: 6.5,
    runtimeInstall: install,
    usage: usage[0],
    gpuCoordination: gpuObservation,
    visibleDecodedCandidate: true,
    acceptedIntoScene: true,
    acceptedPreview,
  };
}

async function continueAcceptedLocalImage(page, source, consoleMessages, pageErrors) {
  const identity = {
    projectId: source.projectId,
    projectDirectory: path.join(projectsPath, source.relativeProjectDirectory),
  };
  activeProjectIdentity = identity;
  const consoleBeforeNavigation = consoleMessages.map((entry) => ({ ...entry }));
  const project = await page.evaluate((expectedProjectId) => {
    const workspace = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    return workspace.projects?.find((candidate) => candidate.nativeProjectId === expectedProjectId) ?? null;
  }, identity.projectId);
  if (!project) throw new Error("Accepted local-image project is missing from preserved UI state");
  await openRestoredProjectFromHome(page, identity, project.title);
  const projectNavigation = page.getByRole("navigation", { name: /project workspace/i });
  await projectNavigation.getByRole("button", { name: /^studio$/i }).click();

  const accepted = await invokeNative(page, "project_snapshot_get", identity);
  const candidates = Array.isArray(accepted.snapshot.sceneCandidates)
    ? accepted.snapshot.sceneCandidates.filter((candidate) => candidate?.role === "scene")
    : [];
  if (candidates.length !== 1) throw new Error(`Expected one preserved local scene image candidate, found ${candidates.length}`);
  const candidate = candidates[0];
  assertLocalSdxlCandidate(candidate, "accepted");
  if (stableJson(candidate) !== stableJson(source.acceptedCandidate)) {
    throw new Error("Preserved accepted local SDXL candidate changed during continuation hydration");
  }
  const acceptedScene = accepted.snapshot.scenes?.find((item) => item?.id === "scene-local-sdxl");
  if (acceptedScene?.visualArtifactHash !== candidate.artifactHash
    || !accepted.snapshot.customization?.assets?.some((asset) => asset?.sha256 === candidate.artifactHash && asset?.kind === "background")) {
    throw new Error("Preserved local SDXL candidate is not promoted into the durable scene and asset ledger");
  }
  const job = readLocalImageJob(identity.projectDirectory);
  const acceptance = readLocalImageProviderAcceptance(identity.projectDirectory, job.jobId);
  const usage = readUsageRecords(identity.projectDirectory);
  if (stableJson(job) !== stableJson(source.job)
    || stableJson(acceptance) !== stableJson(source.acceptance)) {
    throw new Error("Preserved local image job or exactly-once provider receipt changed during continuation");
  }
  assertUsageRecordsMatch(source.baselineUsage, usage, "accepted local image continuation");
  if (job.result?.candidateIds?.length !== 1 || job.result.candidateIds[0] !== candidate.id
    || acceptance.provider !== "comfyui-local" || acceptance.model !== candidate.model
    || acceptance.result?.id !== candidate.id || acceptance.result?.artifactHash !== candidate.artifactHash) {
    throw new Error("Preserved local image candidate does not match its one job and provider receipt");
  }
  const resolved = await invokeNative(page, "project_asset_resolve", { ...identity, artifactHash: candidate.artifactHash });
  const imageDetails = await assertRegularFile(resolved.path, "preserved local SDXL CAS image");
  const imageSha256 = await sha256File(resolved.path);
  if (imageSha256 !== candidate.artifactHash) throw new Error("Preserved SDXL image differs from its CAS hash");
  const dimensions = await pngDimensions(resolved.path);
  if (dimensions.width !== 1344 || dimensions.height !== 768) {
    throw new Error(`Preserved local SDXL image is ${dimensions.width}x${dimensions.height}; expected 1344x768`);
  }
  let acceptedPreview;
  try {
    acceptedPreview = await waitForAcceptedScenePreview(page);
  } catch (error) {
    localPreviewDiagnostics = await collectLocalPreviewDiagnostics({
      page,
      identity,
      accepted,
      candidate,
      resolved,
      consoleBeforeNavigation,
      consoleMessages,
      pageErrors,
    }).catch((diagnosticError) => ({
      collectionError: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
      consoleBeforeNavigation,
      consoleMessages: consoleMessages.map((entry) => ({ ...entry })),
      pageErrors: [...pageErrors],
    }));
    const svgOuterHtml = localPreviewDiagnostics.sceneSvgOuterHtml;
    if (typeof svgOuterHtml === "string" && svgOuterHtml) {
      const svgPath = path.join(runRoot, "local-preview.svg");
      await writeFile(svgPath, svgOuterHtml, "utf8");
      localPreviewDiagnostics.sceneSvg = {
        path: svgPath,
        byteSize: Buffer.byteLength(svgOuterHtml, "utf8"),
        sha256: createHash("sha256").update(svgOuterHtml).digest("hex"),
      };
    }
    delete localPreviewDiagnostics.sceneSvgOuterHtml;
    localPreviewDiagnosticsPath = path.join(runRoot, "local-preview-diagnostics.json");
    await writeJson(localPreviewDiagnosticsPath, localPreviewDiagnostics);
    throw error;
  }
  assertUsageRecordsMatch(source.baselineUsage, readUsageRecords(identity.projectDirectory), "accepted local image after preview decode");
  if (await sha256File(source.failurePath) !== source.failureSha256
    || await sha256File(source.sourceProjectDatabasePath) !== source.sourceProjectDatabaseSha256) {
    throw new Error("Original accepted local-image evidence changed during preview continuation");
  }
  await page.screenshot({ path: path.join(runRoot, "02-local-sdxl-reused-preview.png"), fullPage: true });
  return {
    projectId: identity.projectId,
    relativeProjectDirectory: containedRelativePath(projectsPath, identity.projectDirectory, "continued local SDXL project"),
    relativeImagePath: containedRelativePath(identity.projectDirectory, resolved.path, "continued local SDXL CAS image"),
    sourceRunId: source.runId,
    sourceFailureSha256: source.failureSha256,
    sourceProjectDatabaseSha256: source.sourceProjectDatabaseSha256,
    sourceEvidencePreserved: true,
    imageJobId: job.jobId,
    imageJobState: job.state,
    providerAcceptanceCheckpointId: acceptance.checkpointId,
    acceptedHeadRevisionId: accepted.headRevisionId,
    candidateId: candidate.id,
    artifactHash: candidate.artifactHash,
    mediaType: candidate.mediaType,
    byteSize: imageDetails.size,
    sha256: imageSha256,
    dimensions,
    provider: candidate.provider,
    model: candidate.model,
    recipeId: candidate.recipeId,
    seed: candidate.seed,
    steps: 25,
    sampler: "dpmpp_2m",
    scheduler: "karras",
    cfg: 6.5,
    usage: usage[0],
    gpuCoordination: { inferenceInvoked: false, acceptedArtifactReused: true },
    visibleDecodedCandidate: false,
    acceptedIntoScene: true,
    acceptedPreview,
  };
}

async function collectLocalPreviewDiagnostics({
  page,
  identity,
  accepted,
  candidate,
  resolved,
  consoleBeforeNavigation,
  consoleMessages,
  pageErrors,
}) {
  const acceptedScene = accepted.snapshot.scenes?.find((scene) => scene?.id === "scene-local-sdxl") ?? null;
  const sceneDom = await page.evaluate((artifactHash) => {
    const preview = document.querySelector(".preview-canvas .shared-scene-preview");
    const svg = preview?.querySelector("svg") ?? null;
    const bounds = preview?.getBoundingClientRect();
    const computed = preview ? window.getComputedStyle(preview) : null;
    return {
      previewPresent: Boolean(preview),
      previewClassName: preview?.getAttribute("class") ?? null,
      previewText: preview?.textContent?.replace(/\s+/gu, " ").trim().slice(0, 2_000) ?? null,
      previewVisible: Boolean(bounds && bounds.width > 0 && bounds.height > 0 && computed?.display !== "none" && computed?.visibility !== "hidden"),
      fallbackVisible: Boolean(preview?.classList.contains("preview-not-authored")),
      svgCount: preview?.querySelectorAll("svg").length ?? 0,
      sceneSvgOuterHtml: svg?.outerHTML ?? null,
      sceneSvgOuterHtmlPrefix: svg?.outerHTML.slice(0, 4_000) ?? null,
      sceneId: svg?.getAttribute("data-scene-id") ?? null,
      sceneKind: svg?.getAttribute("data-scene-kind") ?? null,
      tick: svg?.getAttribute("data-tick") ?? null,
      backgroundTreatmentCount: svg?.querySelectorAll("g[data-background-treatment]").length ?? 0,
      backgroundMaskCount: svg?.querySelectorAll("[data-background-mask]").length ?? 0,
      semanticVisualCount: svg?.querySelectorAll("g[data-semantic-role='visual']").length ?? 0,
      images: [...(svg?.querySelectorAll("image") ?? [])].map((image) => ({
        attributes: Object.fromEntries([...image.attributes].map((attribute) => [attribute.name, attribute.value])),
        href: image.getAttribute("href"),
        xlinkHref: image.getAttributeNS("http://www.w3.org/1999/xlink", "href"),
        bounds: (() => {
          const rectangle = image.getBoundingClientRect();
          return { width: rectangle.width, height: rectangle.height };
        })(),
      })),
      resourceEntries: performance.getEntriesByType("resource")
        .filter((entry) => entry.name.includes("asset.localhost") || entry.name.includes(artifactHash))
        .map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          duration: entry.duration,
          transferSize: "transferSize" in entry ? entry.transferSize : null,
          encodedBodySize: "encodedBodySize" in entry ? entry.encodedBodySize : null,
          decodedBodySize: "decodedBodySize" in entry ? entry.decodedBodySize : null,
        })),
    };
  }, candidate.artifactHash);

  const directAssetTransport = await page.evaluate(async ({ resolvedPath, expectedHash }) => {
    const convertFileSrc = globalThis.__TAURI_INTERNALS__?.convertFileSrc;
    const result = {
      convertedUrl: null,
      fetch: null,
      imageDecode: null,
    };
    if (typeof convertFileSrc !== "function") return { ...result, error: "Tauri convertFileSrc is unavailable" };
    const url = convertFileSrc(resolvedPath, "asset");
    result.convertedUrl = url;
    try {
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)), (byte) => byte.toString(16).padStart(2, "0")).join("");
      result.fetch = {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type"),
        byteLength: buffer.byteLength,
        sha256: digest,
        matchesExpectedHash: digest === expectedHash,
      };
    } catch (error) {
      result.fetch = { error: error instanceof Error ? error.message : String(error) };
    }
    try {
      const probe = new Image();
      probe.src = url;
      await probe.decode();
      result.imageDecode = { succeeded: true, naturalWidth: probe.naturalWidth, naturalHeight: probe.naturalHeight };
    } catch (error) {
      result.imageDecode = { succeeded: false, error: error instanceof Error ? error.message : String(error) };
    }
    return result;
  }, { resolvedPath: resolved.path, expectedHash: candidate.artifactHash });

  let candidateReview = { present: false };
  try {
    const generateTab = page.locator(".inspector-tabs").getByRole("button", { name: /^generate$/i });
    if (await generateTab.isVisible()) await generateTab.click();
    const reviewImage = page.getByRole("region", { name: "Generated image candidates" }).locator("img");
    await reviewImage.waitFor({ state: "visible", timeout: 10_000 });
    candidateReview = await reviewImage.evaluate(async (element, expectedHash) => {
      const src = element.getAttribute("src");
      const currentSrc = element.currentSrc;
      let imageDecode;
      try {
        await element.decode();
        imageDecode = { succeeded: true, naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight };
      } catch (error) {
        imageDecode = { succeeded: false, error: error instanceof Error ? error.message : String(error) };
      }
      let fetchResult;
      try {
        const response = await fetch(currentSrc || src || "");
        const buffer = await response.arrayBuffer();
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)), (byte) => byte.toString(16).padStart(2, "0")).join("");
        fetchResult = {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get("content-type"),
          byteLength: buffer.byteLength,
          sha256: digest,
          matchesExpectedHash: digest === expectedHash,
        };
      } catch (error) {
        fetchResult = { error: error instanceof Error ? error.message : String(error) };
      }
      return {
        present: true,
        src,
        currentSrc,
        complete: element.complete,
        naturalWidth: element.naturalWidth,
        naturalHeight: element.naturalHeight,
        imageDecode,
        fetch: fetchResult,
      };
    }, candidate.artifactHash);
  } catch (error) {
    candidateReview = { present: false, error: error instanceof Error ? error.message : String(error) };
  }

  const finalResources = await page.evaluate((artifactHash) => performance.getEntriesByType("resource")
    .filter((entry) => entry.name.includes("asset.localhost") || entry.name.includes(artifactHash))
    .map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      duration: entry.duration,
      transferSize: "transferSize" in entry ? entry.transferSize : null,
      encodedBodySize: "encodedBodySize" in entry ? entry.encodedBodySize : null,
      decodedBodySize: "decodedBodySize" in entry ? entry.decodedBodySize : null,
    })), candidate.artifactHash);
  return {
    capturedAtUtc: new Date().toISOString(),
    identity,
    acceptedScene: acceptedScene ? {
      id: acceptedScene.id,
      kind: acceptedScene.kind,
      visualAssetId: acceptedScene.visualAssetId ?? null,
      visualArtifactHash: acceptedScene.visualArtifactHash ?? null,
    } : null,
    nativeProject: {
      projectId: accepted.manifest?.projectId ?? identity.projectId,
      projectDirectory: identity.projectDirectory,
      headRevisionId: accepted.headRevisionId,
      revisionNumber: accepted.revisionNumber,
    },
    candidate: {
      id: candidate.id,
      status: candidate.status,
      artifactHash: candidate.artifactHash,
      mediaType: candidate.mediaType,
      model: candidate.model,
    },
    projectAssetResolve: resolved,
    directAssetTransport,
    candidateReview,
    ...sceneDom,
    resourceEntriesAfterCandidateProbe: finalResources,
    consoleBeforeNavigation,
    consoleMessages: consoleMessages.map((entry) => ({ ...entry })),
    pageErrors: [...pageErrors],
  };
}

async function waitForAcceptedScenePreview(page) {
  const image = page.locator(".preview-canvas .shared-scene-preview svg image[href^='blob:']");
  await expect(image).toHaveCount(1, { timeout: parsed.actionTimeoutMs });
  await expect.poll(async () => await image.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const canvasBounds = element.ownerSVGElement?.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0
      && Boolean(canvasBounds && canvasBounds.width > 0 && canvasBounds.height > 0);
  }), { timeout: parsed.actionTimeoutMs, message: "Wait for accepted artwork geometry in the central scene preview" }).toBe(true);
  const decoded = await image.evaluate(async (element) => {
    const href = element.getAttribute("href") ?? "";
    if (!href.startsWith("blob:")) throw new Error("Accepted scene preview has no blob-backed image");
    const probe = new Image();
    probe.src = href;
    await probe.decode();
    const result = {
      decodedWidth: probe.naturalWidth,
      decodedHeight: probe.naturalHeight,
      renderedWidth: element.getBoundingClientRect().width,
      renderedHeight: element.getBoundingClientRect().height,
    };
    return result;
  });
  if (decoded.decodedWidth !== 1344 || decoded.decodedHeight !== 768
    || !(decoded.renderedWidth > 0) || !(decoded.renderedHeight > 0)) {
    throw new Error(`Accepted central scene preview did not decode the promoted 1344x768 SDXL image: ${JSON.stringify(decoded)}`);
  }
  return decoded;
}

function localImageProjectDocument() {
  const policy = {
    version: 1,
    privacyMode: "local",
    dataClassification: "project",
    approvals: [{
      providerId: "local-runtime",
      capabilities: ["image.generate"],
      credentialRef: null,
      boundary: "local",
      retention: "local_only",
      regions: ["local"],
      dataClasses: ["project"],
      privacyApproved: true,
      retentionApproved: true,
      regionApproved: true,
      termsApproved: false,
      modelAccessCheckedAt: null,
    }],
    routes: [{
      capability: "image.generate",
      providerIds: ["local-runtime"],
      model: "local/sdxl-base-1.0",
      voice: null,
    }],
  };
  return {
    title: "Local SDXL chapter-background acceptance",
    topic: "Design a reusable chapter-slide background",
    description: "One isolated decorative teaching asset used to verify the installed local image route through the real Studio UI.",
    locale: "English",
    audience: "Curious adults",
    duration: 1,
    updatedAt: "just now",
    progress: 0,
    status: "Planning",
    theme: "Precision paper",
    privacy: "Local only",
    scenes: [{
      id: "scene-local-sdxl",
      index: 1,
      title: "Editorial chapter backdrop",
      kind: "diagram",
      duration: 12,
      narration: "Use this quiet editorial background behind an editable chapter title and lesson subtitle.",
      objective: "Create a reusable text-free slide background with a clear central content area.",
      status: "draft",
      visual: "thread",
      citations: 0,
      locked: false,
    }],
    sources: [],
    presenterSelection: { schemaVersion: 1, mode: "off", presenters: [], sceneAssignments: [] },
    creative: {
      slide: {
        mode: "illustrated",
        layoutSystem: "editorial-grid",
        density: "balanced",
        alignmentGuides: true,
        safeAreas: true,
        visualReviewModel: "Choose a vision model",
        patchLimit: 3,
        imageModel: "local/sdxl-base-1.0",
        prompt: localImagePrompt,
        loras: [],
        controlAdapter: "None",
        referenceStrength: 55,
        seed: 424242,
        inpaintEnabled: false,
        upscaleModel: "None",
      },
      presenter: {
        workflow: "guided",
        baseModel: "tutorial-route",
        style: "Editorial portrait",
        prompt: "Unused in this presenter-free acceptance",
        negativePrompt: "text, watermark",
        loras: [],
        seed: 424242,
        controlAdapter: "None",
        referenceImageEnabled: false,
        faceDetailer: false,
        inpaintEnabled: false,
        upscaleModel: "None",
        provenanceRequired: true,
      },
    },
    sceneCandidates: [],
    providerRoutingPolicy: policy,
  };
}

function assertManagedSdxlReady(statuses) {
  if (!Array.isArray(statuses)) throw new Error("Native model status did not return an array");
  const runtime = statuses.find((status) => status?.modelId === "runtime/comfyui-0.9.2");
  const model = statuses.find((status) => status?.modelId === "local/sdxl-base-1.0");
  for (const [label, status] of [["ComfyUI runtime", runtime], ["SDXL model", model]]) {
    if (!status || !["ready", "inUse"].includes(status.phase) || status.activationBlocked !== false) {
      throw new Error(`${label} is not verified and executable: ${JSON.stringify(status ?? null)}`);
    }
    if (!status.runtimeRevision?.trim() || !/^[0-9a-f]{64}$/u.test(status.installFingerprint ?? "")) {
      throw new Error(`${label} has no immutable runtime revision and install fingerprint`);
    }
  }
  return {
    runtime: {
      modelId: runtime.modelId,
      phase: runtime.phase,
      runtimeRevision: runtime.runtimeRevision,
      installFingerprint: runtime.installFingerprint,
      verifiedArtifacts: runtime.verifiedArtifacts,
      totalBytes: runtime.totalBytes,
    },
    model: {
      modelId: model.modelId,
      phase: model.phase,
      runtimeRevision: model.runtimeRevision,
      installFingerprint: model.installFingerprint,
      verifiedArtifacts: model.verifiedArtifacts,
      totalBytes: model.totalBytes,
    },
  };
}

function assertLocalSdxlCandidate(candidate, expectedStatus = "ready") {
  if (!candidate
    || candidate.status !== expectedStatus
    || candidate.role !== "scene"
    || candidate.provider !== "comfyui-local"
    || !String(candidate.model ?? "").startsWith("local/sdxl-base-1.0@")
    || candidate.mediaType !== "image/png"
    || candidate.recipeId !== "comfy-sdxl-1.0-scene-v1"
    || candidate.seed !== 424242
    || candidate.imageRecipe?.model !== "local/sdxl-base-1.0"
    || !Array.isArray(candidate.imageRecipe?.loras)
    || candidate.imageRecipe.loras.length !== 0
    || candidate.rights?.exportEligible !== true
    || !/^[0-9a-f]{64}$/u.test(candidate.artifactHash ?? "")) {
    throw new Error(`The durable local SDXL candidate is incomplete: ${JSON.stringify(candidate ?? null)}`);
  }
}

async function waitForLocalImageJobTerminal(projectDirectory, timeoutMs) {
  const startedAt = Date.now();
  let lastState = "not created";
  while (Date.now() - startedAt < timeoutMs) {
    const job = readLatestLocalImageJob(projectDirectory);
    if (job) {
      lastState = job.state;
      if (job.state === "SUCCEEDED") return job;
      if (["FAILED", "BLOCKED", "CANCELLED", "STALE"].includes(job.state)) {
        throw new Error(`Local image job ${job.jobId} entered ${job.state}: ${JSON.stringify(job.error ?? job.result ?? null)}`);
      }
    }
    await delay(250);
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for the local image job; last durable state was ${lastState}`);
}

function readLatestLocalImageJob(projectDirectory) {
  const database = new DatabaseSync(path.join(projectDirectory, "project.sqlite3"), { readOnly: true });
  try {
    const row = database.prepare("SELECT job_id, state, attempt_count, result_json, error_json FROM jobs WHERE kind = 'native.regenerate_scene' ORDER BY created_at DESC LIMIT 1").get();
    if (!row) return null;
    return {
      jobId: row.job_id,
      state: row.state,
      attemptCount: row.attempt_count,
      result: row.result_json ? JSON.parse(row.result_json) : null,
      error: row.error_json ? JSON.parse(row.error_json) : null,
    };
  } finally {
    database.close();
  }
}

function readLocalImageJob(projectDirectory) {
  const database = new DatabaseSync(path.join(projectDirectory, "project.sqlite3"), { readOnly: true });
  try {
    const rows = database.prepare("SELECT job_id, state, attempt_count, result_json, error_json FROM jobs WHERE kind = 'native.regenerate_scene' ORDER BY created_at DESC").all();
    if (rows.length !== 1) throw new Error(`Expected one native scene-regeneration job, found ${rows.length}`);
    const row = rows[0];
    const result = row.result_json ? JSON.parse(row.result_json) : null;
    const error = row.error_json ? JSON.parse(row.error_json) : null;
    if (row.state !== "SUCCEEDED" || row.attempt_count !== 1 || result?.readyCount !== 1 || result?.failedCount !== 0) {
      throw new Error(`Local image job did not succeed once: ${JSON.stringify({ state: row.state, attemptCount: row.attempt_count, result, error })}`);
    }
    return { jobId: row.job_id, state: row.state, attemptCount: row.attempt_count, result };
  } finally {
    database.close();
  }
}

function readLocalImageProviderAcceptance(projectDirectory, jobId) {
  const database = new DatabaseSync(path.join(projectDirectory, "project.sqlite3"), { readOnly: true });
  try {
    const rows = database.prepare("SELECT checkpoint_id, provider, model, provider_request_id, result_json FROM provider_acceptance_checkpoints WHERE job_id = ?").all(jobId);
    if (rows.length !== 1) throw new Error(`Expected one exactly-once local provider receipt, found ${rows.length}`);
    const row = rows[0];
    return {
      checkpointId: row.checkpoint_id,
      provider: row.provider,
      model: row.model,
      providerRequestId: row.provider_request_id,
      result: JSON.parse(row.result_json),
    };
  } finally {
    database.close();
  }
}

async function pngDimensions(file) {
  const data = await readFile(file);
  if (data.length < 24 || data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Local SDXL artifact is not a valid PNG header");
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

async function assertGpuMarkerReady(markerPath) {
  const details = await lstat(markerPath).catch((error) => {
    throw new Error(`Shared GPU coordination file is unavailable at ${markerPath}: ${error.message}`);
  });
  if (details.isSymbolicLink() || !details.isFile() || details.size <= 0 || details.size > 64) {
    throw new Error("Shared GPU coordination file must be a small regular non-symlink file");
  }
  const state = (await readFile(markerPath, "utf8")).trim().toLowerCase();
  if (state !== "no") throw new Error(`Shared GPU is not available; marker state is ${JSON.stringify(state)}`);
  return { path: markerPath, initialState: state };
}

async function observeGpuCoordination(markerPath, signal) {
  const transitions = [];
  let previous = null;
  while (!signal.aborted) {
    const current = (await readFile(markerPath, "utf8")).trim().toLowerCase();
    if (!new Set(["yes", "no"]).has(current)) {
      throw new Error(`Shared GPU coordination file has invalid state ${JSON.stringify(current)}`);
    }
    if (current !== previous) {
      transitions.push({ state: current, observedAtUtc: new Date().toISOString() });
      previous = current;
    }
    await delay(25);
  }
  const finalState = (await readFile(markerPath, "utf8")).trim().toLowerCase();
  if (finalState !== previous) transitions.push({ state: finalState, observedAtUtc: new Date().toISOString() });
  return { path: markerPath, mode: "read-only-observer", transitions, finalState };
}

async function waitForGpuState(markerPath, expectedState, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await readFile(markerPath, "utf8")).trim().toLowerCase() === expectedState) return;
    await delay(50);
  }
  throw new Error(`Shared GPU marker did not return to ${expectedState} within ${timeoutMs} ms`);
}

function assertGpuLeaseCycle(observation) {
  const states = observation.transitions.map((entry) => entry.state);
  const claimedAt = states.indexOf("yes");
  const releasedAt = states.lastIndexOf("no");
  if (states[0] !== "no" || claimedAt < 1 || releasedAt <= claimedAt || observation.finalState !== "no") {
    throw new Error(`GPU lease did not complete the required no -> yes -> no cycle: ${JSON.stringify(observation)}`);
  }
}

async function assertInstalledAlignmentRuntime() {
  const configPath = path.join(portableRoot, "Models", "alignment-runtime.json");
  const configDetails = await lstat(configPath).catch((error) => {
    throw new Error(`Pinned alignment runtime is unavailable at ${configPath}; install the vetted runtime before starting provider work: ${error.message}`);
  });
  if (configDetails.isSymbolicLink() || !configDetails.isFile() || configDetails.size <= 0 || configDetails.size > 64 * 1024) {
    throw new Error("Pinned alignment configuration must be a bounded regular non-symlink file");
  }
  let config;
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Pinned alignment configuration is not valid JSON: ${error.message}`);
  }
  if (config?.schemaVersion !== 1 || typeof config.runtimeRoot !== "string" || !path.isAbsolute(config.runtimeRoot)) {
    throw new Error("Pinned alignment configuration must use schemaVersion 1 and an absolute runtime root");
  }
  const runtimeRoot = path.resolve(config.runtimeRoot);
  const rootDetails = await lstat(runtimeRoot).catch((error) => {
    throw new Error(`Pinned alignment runtime root is unavailable: ${error.message}`);
  });
  if (rootDetails.isSymbolicLink() || !rootDetails.isDirectory()) {
    throw new Error("Pinned alignment runtime root must be a regular non-symlink directory");
  }
  const artifacts = {};
  for (const role of ["python", "worker", "model", "vocab"]) {
    const entry = config[role];
    if (!entry || typeof entry.relativePath !== "string" || path.isAbsolute(entry.relativePath)
      || !/^[0-9a-f]{64}$/u.test(entry.sha256 ?? "")) {
      throw new Error(`Pinned alignment ${role} entry is incomplete`);
    }
    const artifactPath = path.resolve(runtimeRoot, entry.relativePath);
    containedRelativePath(runtimeRoot, artifactPath, `pinned alignment ${role} artifact`);
    const details = await lstat(artifactPath).catch((error) => {
      throw new Error(`Pinned alignment ${role} artifact is unavailable: ${error.message}`);
    });
    if (details.isSymbolicLink() || !details.isFile() || details.size <= 0) {
      throw new Error(`Pinned alignment ${role} artifact must be a non-empty regular non-symlink file`);
    }
    const actualSha256 = await sha256File(artifactPath);
    if (actualSha256 !== entry.sha256) throw new Error(`Pinned alignment ${role} artifact failed its SHA-256 pin`);
    artifacts[role] = { relativePath: entry.relativePath, sha256: actualSha256, byteSize: details.size };
  }
  return {
    configPath,
    configSha256: await sha256File(configPath),
    runtimeRoot,
    artifacts,
  };
}

async function runEditorSmoke({ projectDirectory, projectId, projectTitle: selectedProjectTitle, generatedMediaPath, generatedMediaSha256 }) {
  await assertRegularFile(editorSmokeScript, "native editor smoke harness");
  const actualMediaSha256 = await sha256File(generatedMediaPath);
  if (actualMediaSha256 !== generatedMediaSha256) {
    throw new Error("Generated tutorial changed before the editor smoke started");
  }
  await execFileAsync(process.execPath, [
    editorSmokeScript,
    "--portable-root", portableRoot,
    "--media", generatedMediaPath,
    "--project-title", selectedProjectTitle,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: parsed.jobTimeoutMs,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  const childEvidenceRoot = path.join(portableRoot, "Evidence", "native-editor-smoke");
  await assertSafeDirectory(childEvidenceRoot, "fresh native editor evidence");
  const childReportPath = path.join(childEvidenceRoot, "report.json");
  const childReport = JSON.parse(await readFile(childReportPath, "utf8"));
  if (childReport?.state !== "passed" || childReport.projectId !== projectId
    || childReport.gracefulShutdown !== true || childReport.workerExitedWithApp !== true
    || !sameWindowsPath(childReport.importedPath, generatedMediaPath)) {
    throw new Error(`Native editor smoke did not qualify the generated tutorial project: ${JSON.stringify({
      state: childReport?.state,
      projectId: childReport?.projectId,
      gracefulShutdown: childReport?.gracefulShutdown,
      workerExitedWithApp: childReport?.workerExitedWithApp,
    })}`);
  }
  const outputDetails = await assertRegularFile(childReport.outputPath, "native editor smoke output");
  const childReportSha256 = await sha256File(childReportPath);
  const preservedEvidenceRoot = path.join(runRoot, "native-editor-smoke");
  if (await pathExists(preservedEvidenceRoot)) throw new Error(`Editor evidence destination already exists: ${preservedEvidenceRoot}`);
  await renameWithRetry(childEvidenceRoot, preservedEvidenceRoot, 30_000);
  return {
    childReportPath: path.join(preservedEvidenceRoot, "report.json"),
    childReportSha256,
    evidenceDirectory: preservedEvidenceRoot,
    state: childReport.state,
    projectId: childReport.projectId,
    importedGeneratedMediaSha256: actualMediaSha256,
    relativeOutputPath: containedRelativePath(projectDirectory, childReport.outputPath, "native editor smoke output"),
    outputBytes: outputDetails.size,
    outputDurationSeconds: childReport.outputDurationSeconds,
    outputVideoCodec: childReport.outputVideoCodec,
    outputAudioCodec: childReport.outputAudioCodec,
    trimmedEndFrame: childReport.trimmedEndFrame,
    waveformRendered: childReport.waveformRendered,
    reloadedMediaPlayback: childReport.reloadedMediaPlayback,
    immediateClosePreservedEditorSave: childReport.immediateClosePreservedEditorSave,
    desktopPids: childReport.desktopPids,
    workerPids: childReport.workerPids,
  };
}

async function runRecoverySmoke() {
  await assertRegularFile(recoverySmokeScript, "native recovery smoke harness");
  await assertNoPortableOwnedProcesses();
  await execFileAsync(process.execPath, [
    recoverySmokeScript,
    "--portable-root", portableRoot,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: parsed.jobTimeoutMs,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  await assertNoPortableOwnedProcesses();
  const childEvidenceRoot = path.join(portableRoot, "Evidence", "native-recovery");
  await assertSafeDirectory(childEvidenceRoot, "fresh native recovery evidence");
  const childReportPath = path.join(childEvidenceRoot, "report.json");
  const childReport = JSON.parse(await readFile(childReportPath, "utf8"));
  const packageManifest = JSON.parse(await readFile(packageManifestPath, "utf8"));
  const expectedPackage = {
    createdAt: packageManifest.createdAt,
    desktop: packageManifest.desktop,
    pipelineWorker: packageManifest.pipelineWorker,
    rendererRuntime: packageManifest.rendererRuntime,
  };
  const castIds = childReport?.presenterSelectionAfterRestart?.presenters?.map((entry) => entry?.presenterId);
  if (childReport?.state !== "passed"
    || childReport.actualNativeWebView !== true
    || childReport.hiddenLaunch !== true
    || childReport.stateBeforeRestart !== "BLOCKED"
    || childReport.stateAfterRestart !== "BLOCKED"
    || childReport.stateAfterCancel !== "CANCELLED"
    || childReport.castPreservedAcrossRestart !== true
    || JSON.stringify(castIds) !== JSON.stringify(["presenter-portrait.software-daniel-v1", "presenter-portrait.anime-astrid-v1"])
    || childReport.gracefulShutdown !== true
    || childReport.workerExitedWithApp !== true
    || childReport.firstWorkerExitedWithApp !== true
    || childReport.executableSha256 !== await sha256File(executable)
    || childReport.workerSha256 !== await sha256File(workerExecutable)
    || JSON.stringify(childReport.packageManifest) !== JSON.stringify(expectedPackage)) {
    throw new Error(`Native recovery smoke returned an incomplete or mismatched package report: ${JSON.stringify({
      state: childReport?.state,
      stateBeforeRestart: childReport?.stateBeforeRestart,
      stateAfterRestart: childReport?.stateAfterRestart,
      stateAfterCancel: childReport?.stateAfterCancel,
      castIds,
      gracefulShutdown: childReport?.gracefulShutdown,
      workerExitedWithApp: childReport?.workerExitedWithApp,
    })}`);
  }
  const recoveryProjectDirectory = await findProjectDirectoryById(childReport.projectId);
  const usage = readUsageRecords(recoveryProjectDirectory);
  if (usage.length !== 0) {
    throw new Error(`Blocked native recovery smoke unexpectedly incurred provider usage: ${JSON.stringify(usage.map((row) => ({ provider: row.provider, model: row.model, unit: row.unit })))}`);
  }
  const childReportSha256 = await sha256File(childReportPath);
  const preservedEvidenceRoot = path.join(runRoot, "native-recovery");
  if (await pathExists(preservedEvidenceRoot)) throw new Error(`Recovery evidence destination already exists: ${preservedEvidenceRoot}`);
  await renameWithRetry(childEvidenceRoot, preservedEvidenceRoot, 30_000);
  return {
    state: childReport.state,
    projectId: childReport.projectId,
    generationJobId: childReport.generationJobId,
    relativeProjectDirectory: containedRelativePath(projectsPath, recoveryProjectDirectory, "native recovery project"),
    reportPath: path.join(preservedEvidenceRoot, "report.json"),
    reportSha256: childReportSha256,
    evidenceDirectory: preservedEvidenceRoot,
    stateBeforeRestart: childReport.stateBeforeRestart,
    stateAfterRestart: childReport.stateAfterRestart,
    stateAfterCancel: childReport.stateAfterCancel,
    castPreservedAcrossRestart: childReport.castPreservedAcrossRestart,
    providerUsageRows: 0,
    desktopPids: [childReport.firstDesktopPid, childReport.secondDesktopPid],
    workerPids: [childReport.firstWorkerPid, childReport.secondWorkerPid],
  };
}

async function findProjectDirectoryById(projectId) {
  return await findProjectDirectoryByIdUnder(projectsPath, projectId);
}

async function findProjectDirectoryByIdUnder(root, projectId) {
  if (typeof projectId !== "string" || !projectId.trim()) throw new Error("Native recovery report omitted its project ID");
  const matches = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const candidate = path.join(root, entry.name);
    const manifestPath = path.join(candidate, "manifest.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (manifest.projectId === projectId) matches.push(candidate);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  if (matches.length !== 1) throw new Error(`Expected one native recovery project directory, found ${matches.length}`);
  return matches[0];
}

function parseArguments(arguments_) {
  const result = {
    portableRoot: null,
    profileId: "portable-test-groq-nvidia",
    localImageOnly: false,
    creativeOnly: false,
    resumeCreativeRun: null,
    resumeCompletedRun: null,
    resumeLocalImageRun: null,
    editorSmoke: false,
    recoverySmoke: false,
    recordWalkthrough: false,
    walkthroughLocalImageRun: localImageWalkthroughRunId,
    presenterAcceptanceRoot: defaultPresenterAcceptanceRoot,
    gifsmithRoot: defaultGifsmithRoot,
    gpuCoordinationPath: null,
    alignmentConfigPath: null,
    topic: "Explain why the daytime sky looks blue in one concise, factual, three-scene lesson. Keep the spoken explanation close to one minute.",
    startupTimeoutMs: 120_000,
    actionTimeoutMs: 60_000,
    jobTimeoutMs: 900_000,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const name = arguments_[index];
    if (name === "--local-image-only") {
      result.localImageOnly = true;
      continue;
    }
    if (name === "--creative-only") {
      result.creativeOnly = true;
      continue;
    }
    if (name === "--editor-smoke") {
      result.editorSmoke = true;
      continue;
    }
    if (name === "--recovery-smoke") {
      result.recoverySmoke = true;
      continue;
    }
    if (name === "--record-walkthrough") {
      result.recordWalkthrough = true;
      continue;
    }
    const value = arguments_[index + 1];
    if (name === "--portable-root") result.portableRoot = requiredText(value, name, 500);
    else if (name === "--profile-id") result.profileId = requiredText(value, name, 100);
    else if (name === "--gpu-coordination-path") result.gpuCoordinationPath = path.resolve(requiredText(value, name, 500));
    else if (name === "--alignment-config-path") result.alignmentConfigPath = path.resolve(requiredText(value, name, 500));
    else if (name === "--resume-creative-run") result.resumeCreativeRun = requiredText(value, name, 80);
    else if (name === "--resume-completed-run") result.resumeCompletedRun = requiredText(value, name, 80);
    else if (name === "--resume-local-image-run") result.resumeLocalImageRun = requiredText(value, name, 80);
    else if (name === "--walkthrough-local-image-run") result.walkthroughLocalImageRun = requiredText(value, name, 80);
    else if (name === "--presenter-acceptance-root") result.presenterAcceptanceRoot = path.resolve(requiredText(value, name, 500));
    else if (name === "--gifsmith-root") result.gifsmithRoot = path.resolve(requiredText(value, name, 500));
    else if (name === "--topic") result.topic = requiredText(value, name, 240);
    else if (name === "--startup-timeout-ms") result.startupTimeoutMs = positiveNumber(value, name);
    else if (name === "--action-timeout-ms") result.actionTimeoutMs = positiveNumber(value, name);
    else if (name === "--job-timeout-ms") result.jobTimeoutMs = positiveNumber(value, name);
    else throw new Error(`Unknown or incomplete argument: ${name}`);
    index += 1;
  }
  if (!result.portableRoot) throw new Error("--portable-root is required");
  if (result.recordWalkthrough && !result.resumeCompletedRun && !result.resumeCreativeRun && !result.resumeLocalImageRun) {
    result.resumeCompletedRun = completedWalkthroughRunId;
  }
  if (result.profileId !== "portable-test-groq-nvidia") {
    throw new Error("This bounded acceptance is pinned to portable-test-groq-nvidia");
  }
  if (result.resumeCreativeRun || result.resumeCompletedRun) {
    if (result.resumeCreativeRun && result.resumeCompletedRun) {
      throw new Error("Choose only one Creative resume source");
    }
    const resumeRunId = result.resumeCompletedRun ?? result.resumeCreativeRun;
    if (!/^[0-9]{17}-[1-9][0-9]*$/u.test(resumeRunId)) {
      throw new Error("Creative resume source must be one native generation evidence run ID");
    }
    result.creativeOnly = true;
  }
  if (result.resumeLocalImageRun) {
    if (!/^[0-9]{17}-[1-9][0-9]*$/u.test(result.resumeLocalImageRun)) {
      throw new Error("--resume-local-image-run must be one native generation evidence run ID");
    }
    if (result.localImageOnly || result.resumeCreativeRun || result.resumeCompletedRun) {
      throw new Error("Choose only one local or cloud generation acceptance mode");
    }
    result.localImageOnly = true;
  }
  if (result.localImageOnly && !result.resumeLocalImageRun && !result.gpuCoordinationPath) {
    throw new Error("--gpu-coordination-path is required with --local-image-only");
  }
  if (result.localImageOnly && result.creativeOnly) {
    throw new Error("--creative-only qualifies the cloud lifecycle path and cannot be combined with --local-image-only");
  }
  if (result.localImageOnly && result.editorSmoke) {
    throw new Error("--editor-smoke qualifies the full generated tutorial and cannot be combined with --local-image-only");
  }
  if (result.localImageOnly && result.recoverySmoke) {
    throw new Error("--recovery-smoke qualifies the cloud lifecycle path and cannot be combined with --local-image-only");
  }
  if (result.recordWalkthrough) {
    if (result.localImageOnly || result.resumeCreativeRun || !result.resumeCompletedRun) {
      throw new Error("--record-walkthrough requires the completed Creative continuation and cannot start or resume provider/GPU work");
    }
    if (result.resumeCompletedRun !== completedWalkthroughRunId || result.walkthroughLocalImageRun !== localImageWalkthroughRunId) {
      throw new Error(`--record-walkthrough is pinned to completed run ${completedWalkthroughRunId} and local-image run ${localImageWalkthroughRunId}`);
    }
    if (result.editorSmoke || result.recoverySmoke) {
      throw new Error("--record-walkthrough owns its native editor proof and cannot be combined with the separate editor or recovery smokes");
    }
    if (!/^[0-9]{17}-[1-9][0-9]*$/u.test(result.walkthroughLocalImageRun)) {
      throw new Error("--walkthrough-local-image-run must be one native generation evidence run ID");
    }
  }
  return result;
}

function requiredText(value, name, maximumLength) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximumLength) {
    throw new Error(`${name} must be between 1 and ${maximumLength} characters`);
  }
  return value.trim();
}

function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be positive`);
  return number;
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

function completedOnboarding() {
  const chapters = ["welcome", "goal", "runtime", "provider", "hardware", "model", "profile", "ready"];
  return {
    schemaVersion: 1,
    status: "completed",
    activeChapterId: "ready",
    completedChapterIds: chapters,
    visitedChapterIds: chapters,
    configuration: {
      goals: ["tutorial"],
      runtime: "hybrid",
      privacy: null,
      providerIds: ["groq", "gemini", "nvidia-nim"],
      modelIds: [],
      hardwareReviewed: true,
      profile: { displayName: "Native generation acceptance", portraitAssetId: "presenter-portrait.broadcast-elena-v1" },
    },
    revision: 9,
    updatedAt: new Date().toISOString(),
  };
}

function assertProviderPolicy(policy) {
  if (!policy || !Array.isArray(policy.routes)) throw new Error("Selected profile did not persist a provider routing policy");
  if (policy.privacyMode !== "cloud" || policy.dataClassification !== "public") {
    throw new Error(`Selected profile persisted an unexpected automatic policy: ${JSON.stringify({ privacyMode: policy.privacyMode, dataClassification: policy.dataClassification })}`);
  }
  for (const [capability, [providerId, model]] of Object.entries(expectedRoutes)) {
    const route = policy.routes.find((candidate) => candidate.capability === capability);
    if (!route || route.providerIds?.[0] !== providerId || route.model !== model) {
      throw new Error(`Selected profile route ${capability} did not persist ${providerId}/${model}`);
    }
  }
  const forbidden = policy.routes.flatMap((route) => route.providerIds ?? []).find((providerId) => forbiddenProviders.has(providerId));
  if (forbidden) throw new Error(`Selected profile unexpectedly routed through ${forbidden}`);
}

function parseProviderJsonObject(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsedValue = JSON.parse(value);
    return parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue) ? parsedValue : null;
  } catch {
    return null;
  }
}

function assertCreativeResearchBypass(stage, usage, projectDirectory) {
  const payload = stage?.payload;
  const sources = Array.isArray(payload?.sources) ? payload.sources : [];
  const geminiUsage = usage.filter((row) => row.provider === researchRoute.providerId);
  const providerCheckpoints = readProviderAcceptancesForJob(projectDirectory, stage?.stageJobId);
  if (!payload
    || stage?.persistedParameters?.request?.groundingMode !== "creative"
    || payload.request?.groundingMode !== "creative"
    || payload.policy?.mode !== "creative"
    || payload.policy?.accepted !== true
    || Object.hasOwn(payload, "webResearch")
    || sources.some((source) => typeof source?.locator === "string" && source.locator.startsWith("provider-research://"))
    || geminiUsage.length !== 0
    || providerCheckpoints.length !== 0) {
    throw new Error(`Creative planning did not preserve its zero-web-research boundary: ${JSON.stringify({
      groundingMode: stage?.persistedParameters?.request?.groundingMode ?? null,
      payloadGroundingMode: payload?.request?.groundingMode ?? null,
      researchPolicy: payload?.policy ?? null,
      hasWebResearch: Object.hasOwn(payload ?? {}, "webResearch"),
      providerResearchSources: sources.filter((source) => typeof source?.locator === "string" && source.locator.startsWith("provider-research://")).length,
      geminiUsageRows: geminiUsage.length,
      providerAcceptanceCheckpoints: providerCheckpoints.length,
    })}`);
  }
  return {
    mode: "creative",
    webResearchExecuted: false,
    geminiUsageRows: 0,
    geminiAcceptanceCheckpoints: 0,
    configuredResearchRoute: `${researchRoute.providerId}/${researchRoute.model}`,
  };
}

function assertRealGroundedResearch(payload, usage, projectDirectory) {
  const evidence = payload?.webResearch;
  if (!evidence || evidence.providerId !== researchRoute.providerId || evidence.model !== researchRoute.model) {
    throw new Error(`Grounded planning persisted no ${researchRoute.providerId}/${researchRoute.model} web-research receipt`);
  }
  if (!Array.isArray(evidence.findings) || evidence.findings.length === 0
    || !Array.isArray(evidence.citations) || evidence.citations.length === 0
    || evidence.resultCount !== evidence.findings.length
    || evidence.citationCount !== evidence.citations.length
    || evidence.provenanceScope !== "response"
    || typeof evidence.responseModel !== "string" || !evidence.responseModel.trim()
    || typeof evidence.requestId !== "string" || !evidence.requestId.trim()
    || typeof evidence.query !== "string" || !evidence.query.trim()
    || evidence.findings.some((finding) => typeof finding?.statement !== "string" || !finding.statement.trim()
      || typeof finding?.teachingUse !== "string" || !finding.teachingUse.trim())
    || evidence.citations.some((citation) => typeof citation?.title !== "string" || !citation.title.trim()
      || typeof citation?.url !== "string" || !/^https?:\/\//u.test(citation.url))) {
    throw new Error("Grounded planning persisted no web-research result evidence");
  }
  const gemini = usage.filter((row) => row.provider === researchRoute.providerId && row.model === researchRoute.model);
  const querySha256 = createHash("sha256").update(evidence.query).digest("hex");
  if (gemini.length !== 1
    || gemini[0].unit !== "tokens"
    || !(gemini[0].quantity > 0)
    || gemini[0].metadata.incurred !== true
    || gemini[0].metadata.kind !== "web-research"
    || gemini[0].metadata.capability !== "research.web"
    || gemini[0].metadata.usageComplete !== true
    || !(Number(gemini[0].metadata.searchRequests) >= 1)
    || gemini[0].metadata.providerRequestId !== evidence.requestId
    || typeof gemini[0].metadata.researchRequestId !== "string" || !gemini[0].metadata.researchRequestId.trim()
    || gemini[0].metadata.querySha256 !== querySha256
    || !(Number(gemini[0].metadata.inputTokens) > 0)
    || !(Number(gemini[0].metadata.outputTokens) > 0)
    || gemini[0].quantity !== Number(gemini[0].metadata.inputTokens) + Number(gemini[0].metadata.outputTokens)
    || !(Number(gemini[0].metadata.rawResponseChars) > 0)
    || !/^[0-9a-f]{64}$/u.test(gemini[0].metadata.rawResponseSha256 ?? "")
    || typeof gemini[0].metadata.rawResponseTruncated !== "boolean"
    || !(Number(gemini[0].metadata.rawCitationCount) >= 1)
    || typeof gemini[0].metadata.rawCitationsTruncated !== "boolean") {
    throw new Error(`Grounded planning recorded ${gemini.length} incurred Gemini research usage rows; expected exactly one`);
  }
  const checkpoint = readProviderAcceptance(projectDirectory, gemini[0].jobId);
  const raw = checkpoint.result;
  const storedTextSha256 = typeof raw?.rawText === "string"
    ? createHash("sha256").update(raw.rawText).digest("hex")
    : null;
  const rawParsed = parseProviderJsonObject(raw?.rawText);
  const normalizedRawFindings = Array.isArray(rawParsed?.findings)
    ? rawParsed.findings.map((finding) => ({
      statement: typeof finding?.statement === "string" ? finding.statement.replace(/\s+/gu, " ").trim().slice(0, 500) : null,
      teachingUse: typeof finding?.teachingUse === "string" ? finding.teachingUse.replace(/\s+/gu, " ").trim().slice(0, 240) : null,
    }))
    : null;
  const rawCitationUrls = new Set(Array.isArray(raw?.citations)
    ? raw.citations.flatMap((citation) => typeof citation?.url === "string" ? [citation.url.trim()] : [])
    : []);
  if (checkpoint.provider !== researchRoute.providerId
    || checkpoint.model !== researchRoute.model
    || checkpoint.providerRequestId !== evidence.requestId
    || raw?.schemaVersion !== 1
    || raw?.kind !== "web-research-raw-response"
    || raw.providerId !== evidence.providerId
    || raw.model !== evidence.model
    || raw.responseModel !== evidence.responseModel
    || raw.requestId !== evidence.requestId
    || raw.query !== evidence.query
    || typeof raw.rawText !== "string" || !raw.rawText.trim()
    || !Number.isInteger(raw.rawTextLength) || raw.rawTextLength < raw.rawText.length
    || !/^[0-9a-f]{64}$/u.test(raw.rawTextSha256 ?? "")
    || raw.storedTextSha256 !== storedTextSha256
    || raw.rawTextTruncated !== (raw.rawTextLength !== raw.rawText.length)
    || raw.rawTextTruncated !== false
    || JSON.stringify(normalizedRawFindings) !== JSON.stringify(evidence.findings)
    || !Array.isArray(raw.citations)
    || !Number.isInteger(raw.citationsObserved) || raw.citationsObserved < raw.citations.length
    || raw.citationsTruncated !== (raw.citationsObserved !== raw.citations.length)
    || evidence.citations.some((citation) => !rawCitationUrls.has(citation.url))
    || gemini[0].metadata.rawResponseChars !== raw.rawTextLength
    || gemini[0].metadata.rawResponseSha256 !== raw.rawTextSha256
    || gemini[0].metadata.rawResponseTruncated !== raw.rawTextTruncated
    || gemini[0].metadata.rawCitationCount !== raw.citationsObserved
    || gemini[0].metadata.rawCitationsTruncated !== raw.citationsTruncated) {
    throw new Error("Grounded planning did not retain one bounded exactly-once raw Gemini response before local normalization");
  }
  return {
    providerId: evidence.providerId,
    model: evidence.model,
    resultCount: evidence.resultCount,
    citationCount: evidence.citationCount,
    provenanceScope: evidence.provenanceScope,
    usageId: gemini[0].usageId,
    unit: gemini[0].unit,
    quantity: gemini[0].quantity,
    searchRequests: gemini[0].metadata.searchRequests,
    rawResponseCheckpointId: checkpoint.checkpointId,
    rawResponseSha256: raw.rawTextSha256,
    rawResponseChars: raw.rawTextLength,
  };
}

function assertBoundedProviderFootprint(usage, expectedNarrationCalls, expectedResearchCalls) {
  const maximumUsageRows = 9 + expectedResearchCalls;
  if (usage.length > maximumUsageRows) throw new Error(`Bounded generation recorded ${usage.length} provider usage rows; maximum is ${maximumUsageRows}`);
  const forbidden = usage.find((row) => forbiddenProviders.has(row.provider));
  if (forbidden) throw new Error(`Bounded generation unexpectedly used ${forbidden.provider}`);
  const imageCalls = usage.filter((row) => row.model === expectedRoutes["image.generate"][1]);
  if (imageCalls.length) throw new Error("Designed visual mode unexpectedly called the NVIDIA image model");
  const gemini = usage.filter((row) => row.provider === researchRoute.providerId);
  const groq = usage.filter((row) => row.provider === "groq" && row.model === expectedRoutes["llm.structured"][1]);
  const narration = usage.filter((row) => row.provider === "nvidia-nim" && row.model === expectedRoutes["audio.tts"][1]);
  const visualReview = usage.filter((row) => row.provider === "nvidia-nim" && row.model === expectedRoutes["vlm.chat"][1]);
  if (gemini.length !== expectedResearchCalls
    || gemini.some((row) => row.model !== expectedRoutes["research.web"][1])) {
    throw new Error(`Expected ${expectedResearchCalls} ${researchRoute.providerId}/${researchRoute.model} research requests and no other Gemini usage, found ${JSON.stringify(gemini.map((row) => row.model))}`);
  }
  if (groq.length < 2 || groq.length > 5) throw new Error(`Expected two to five Groq structured-writing requests, found ${groq.length}`);
  if (narration.length !== expectedNarrationCalls) {
    throw new Error(`Expected ${expectedNarrationCalls} NVIDIA narration requests, found ${narration.length}`);
  }
  if (visualReview.length !== 1) throw new Error(`Expected one NVIDIA final visual-review request, found ${visualReview.length}`);
  return {
    totalUsageRows: usage.length,
    maximumUsageRows,
    byProviderModel: Object.fromEntries(
      [...new Set(usage.map((row) => `${row.provider}/${row.model}`))].sort().map((key) => [key, usage.filter((row) => `${row.provider}/${row.model}` === key).length]),
    ),
    constraints: {
      geminiResearch: expectedResearchCalls,
      groqStructuredWritingMaximum: 5,
      nvidiaNarration: expectedNarrationCalls,
      nvidiaImageGeneration: 0,
      nvidiaVisualReview: 1,
      forbiddenTtsProviders: [...forbiddenProviders],
    },
  };
}

function readPreApprovalStages(projectDirectory, generationId) {
  return {
    research: readGenerationStage(projectDirectory, generationId, "generation.ingest_research"),
    learningPlan: readGenerationStage(projectDirectory, generationId, "generation.learning_plan"),
    script: readGenerationStage(projectDirectory, generationId, "generation.script"),
    storyboard: readGenerationStage(projectDirectory, generationId, "generation.storyboard"),
  };
}

function readGenerationStage(projectDirectory, generationId, kind, approvalRevisionId = null) {
  const database = new DatabaseSync(path.join(projectDirectory, "project.sqlite3"), { readOnly: true });
  try {
    const rows = database.prepare("SELECT job_id, parameters_json, result_json FROM jobs WHERE kind = ? AND state = 'SUCCEEDED' ORDER BY updated_at DESC").all(kind);
    for (const row of rows) {
      const parameters = JSON.parse(row.parameters_json);
      if (parameters.generationId !== generationId
        || (approvalRevisionId !== null && parameters.approvalRevisionId !== approvalRevisionId)) continue;
      const result = JSON.parse(row.result_json);
      if (!result?.payload || !/^[0-9a-f]{64}$/u.test(result.artifactHash ?? "")) {
        throw new Error(`${kind} returned an invalid persisted payload`);
      }
      return { ...result, stageJobId: row.job_id, persistedParameters: parameters };
    }
  } finally {
    database.close();
  }
  throw new Error(`No successful ${kind} stage exists for generation ${generationId}`);
}

function readProviderAcceptancesForJob(projectDirectory, jobId) {
  if (typeof jobId !== "string" || !jobId.trim()) throw new Error("Generation stage omitted its durable job identity");
  const database = new DatabaseSync(path.join(projectDirectory, "project.sqlite3"), { readOnly: true });
  try {
    return database.prepare("SELECT checkpoint_id, provider, model, provider_request_id FROM provider_acceptance_checkpoints WHERE job_id = ? ORDER BY checkpoint_id").all(jobId)
      .map((row) => ({
        checkpointId: row.checkpoint_id,
        provider: row.provider,
        model: row.model,
        providerRequestId: row.provider_request_id,
      }));
  } finally {
    database.close();
  }
}

function readUsageRecords(projectDirectory) {
  const database = new DatabaseSync(path.join(projectDirectory, "project.sqlite3"), { readOnly: true });
  try {
    return database.prepare("SELECT usage_id, job_id, provider, model, unit, quantity, cost_micros, metadata_json, created_at FROM usage_records ORDER BY created_at, usage_id").all()
      .map((row) => ({
        usageId: row.usage_id,
        jobId: row.job_id,
        provider: row.provider,
        model: row.model,
        unit: row.unit,
        quantity: row.quantity,
        costMicros: row.cost_micros,
        metadata: JSON.parse(row.metadata_json),
        createdAt: row.created_at,
      }));
  } finally {
    database.close();
  }
}

function readProviderAcceptance(projectDirectory, jobId) {
  const database = new DatabaseSync(path.join(projectDirectory, "project.sqlite3"), { readOnly: true });
  try {
    const rows = database.prepare("SELECT checkpoint_id, provider, model, provider_request_id, result_json FROM provider_acceptance_checkpoints WHERE job_id = ?").all(jobId);
    if (rows.length !== 1) throw new Error(`Expected one exactly-once provider checkpoint for ${jobId}, found ${rows.length}`);
    const row = rows[0];
    return {
      checkpointId: row.checkpoint_id,
      provider: row.provider,
      model: row.model,
      providerRequestId: row.provider_request_id,
      result: JSON.parse(row.result_json),
    };
  } finally {
    database.close();
  }
}

function readGenerationDiagnostics(projectDirectory, generationId) {
  const database = new DatabaseSync(path.join(projectDirectory, "project.sqlite3"), { readOnly: true });
  try {
    const stages = database.prepare("SELECT kind, state, attempt_count, parameters_json, error_json FROM jobs WHERE kind LIKE 'generation.%' ORDER BY created_at").all()
      .filter((row) => JSON.parse(row.parameters_json).generationId === generationId)
      .map((row) => {
        const error = row.error_json ? JSON.parse(row.error_json) : null;
        return {
          kind: row.kind,
          state: row.state,
          attemptCount: row.attempt_count,
          errorCode: error?.code ?? null,
          errorType: error?.exceptionType ?? null,
          errorMessage: error?.message ?? null,
        };
      });
    const usage = database.prepare("SELECT provider, model, COUNT(*) AS records FROM usage_records GROUP BY provider, model ORDER BY provider, model").all()
      .map((row) => ({ provider: row.provider, model: row.model, records: Number(row.records) }));
    return { projectId: activeProjectIdentity?.projectId ?? null, generationId, stages, usage };
  } finally {
    database.close();
  }
}

function readNativeProjectDiagnostics(projectDirectory) {
  const database = new DatabaseSync(path.join(projectDirectory, "project.sqlite3"), { readOnly: true });
  try {
    const jobs = database.prepare("SELECT job_id, kind, state, attempt_count, error_json FROM jobs ORDER BY created_at").all()
      .map((row) => {
        const error = row.error_json ? JSON.parse(row.error_json) : null;
        return {
          jobId: row.job_id,
          kind: row.kind,
          state: row.state,
          attemptCount: row.attempt_count,
          errorCode: error?.code ?? null,
          errorType: error?.exceptionType ?? null,
          errorMessage: error?.message ?? null,
        };
      });
    const usage = database.prepare("SELECT provider, model, COUNT(*) AS records FROM usage_records GROUP BY provider, model ORDER BY provider, model").all()
      .map((row) => ({ provider: row.provider, model: row.model, records: Number(row.records) }));
    return { projectId: activeProjectIdentity?.projectId ?? null, jobs, usage };
  } finally {
    database.close();
  }
}

async function waitForPersistedProjectByTitle(page, title, timeoutMs) {
  let current;
  await expect.poll(async () => {
    current = await page.evaluate((expectedTitle) => {
      const workspace = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
      const project = workspace.projects?.find((candidate) => candidate.title === expectedTitle);
      const generationJob = workspace.jobs?.find((job) => job.id === project?.nativeGenerationId);
      return project && generationJob ? { project, generationJob } : null;
    }, title);
    return current !== null;
  }, { timeout: timeoutMs }).toBe(true);
  return current;
}

async function persistedProject(page, identity) {
  const value = await page.evaluate((expected) => {
    const workspace = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    const project = workspace.projects?.find((candidate) => candidate.nativeProjectId === expected.projectId);
    const generationJob = workspace.jobs?.find((job) => job.id === project?.nativeGenerationId);
    return project && generationJob ? { project, generationJob } : null;
  }, identity);
  if (!value) throw new Error("Native project or generation job is missing from persisted UI state");
  return value;
}

async function waitForPlanningApproval(projectDirectory, generationId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const database = new DatabaseSync(path.join(projectDirectory, "project.sqlite3"), { readOnly: true });
    try {
      const rows = database.prepare("SELECT kind, state, error_json, parameters_json, result_json FROM jobs WHERE kind LIKE 'generation.%'").all();
      const stages = new Map(rows
        .filter((row) => JSON.parse(row.parameters_json).generationId === generationId)
        .map((row) => [row.kind, row]));
      for (const kind of ["generation.ingest_research", "generation.learning_plan", "generation.script", "generation.storyboard"]) {
        const stage = stages.get(kind);
        if (["FAILED", "CANCELLED", "STALE"].includes(stage?.state)) {
          const error = stage.error_json ? JSON.parse(stage.error_json) : null;
          throw new Error(`${kind} finished in ${stage.state}: ${error?.message ?? "no durable error"}`);
        }
      }
      const approval = stages.get("generation.approval");
      if (approval?.state === "SUCCEEDED") {
        const payload = JSON.parse(approval.result_json ?? "null")?.payload?.approval;
        if (payload?.required === true && payload?.approved === false) return { generationId };
      }
    } catch (error) {
      if (!/database is locked/iu.test(error instanceof Error ? error.message : String(error))) throw error;
    } finally {
      database.close();
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for the durable learning-plan review gate");
}

async function waitForApprovedMediaBranch(projectDirectory, generationId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const database = new DatabaseSync(path.join(projectDirectory, "project.sqlite3"), { readOnly: true });
    try {
      const rows = database.prepare("SELECT parameters_json, created_at FROM jobs WHERE kind = 'generation.narration' ORDER BY created_at DESC").all();
      for (const row of rows) {
        const parameters = JSON.parse(row.parameters_json);
        if (parameters.generationId === generationId && typeof parameters.approvalRevisionId === "string") {
          return { generationId, approvalRevisionId: parameters.approvalRevisionId, createdAt: row.created_at };
        }
      }
    } catch (error) {
      if (!/database is locked/iu.test(error instanceof Error ? error.message : String(error))) throw error;
    } finally {
      database.close();
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for approval to create a durable media branch");
}

async function waitForApprovedBranchCompletion(projectDirectory, approvedBranch, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const active = new Set(["READY", "QUEUED", "RUNNING", "RETRY_WAIT"]);
  while (Date.now() < deadline) {
    const database = new DatabaseSync(path.join(projectDirectory, "project.sqlite3"), { readOnly: true });
    try {
      const rows = database.prepare("SELECT kind, state, error_json, parameters_json FROM jobs WHERE kind LIKE 'generation.%' ORDER BY created_at DESC").all();
      const branch = rows.filter((row) => {
        const parameters = JSON.parse(row.parameters_json);
        return parameters.generationId === approvedBranch.generationId
          && parameters.approvalRevisionId === approvedBranch.approvalRevisionId;
      });
      const exportStage = branch.find((row) => row.kind === "generation.export");
      if (exportStage?.state === "SUCCEEDED") return { kind: exportStage.kind, state: exportStage.state, message: null };
      const failed = branch.find((row) => ["FAILED", "CANCELLED", "STALE"].includes(row.state));
      if (failed && !branch.some((row) => active.has(row.state))) {
        const error = failed.error_json ? JSON.parse(failed.error_json) : null;
        return { kind: failed.kind, state: failed.state, message: error?.message ?? null };
      }
    } catch (error) {
      if (!/database is locked/iu.test(error instanceof Error ? error.message : String(error))) throw error;
    } finally {
      database.close();
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for approved branch ${approvedBranch.approvalRevisionId}`);
}

async function invokeNative(page, command, input) {
  return await page.evaluate(async ({ command, input }) => {
    const invoke = globalThis.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") throw new Error("Tauri IPC is unavailable in the native WebView");
    return await invoke(command, { input });
  }, { command, input });
}

async function invokeNativeWithoutInput(page, command) {
  return await page.evaluate(async (commandName) => {
    const invoke = globalThis.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") throw new Error("Tauri IPC is unavailable in the native WebView");
    return await invoke(commandName);
  }, command);
}

async function probeMedia(mediaPath) {
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration:stream=index,codec_type,codec_name,width,height,sample_rate,channels",
    "-of", "json",
    mediaPath,
  ], { encoding: "utf8", timeout: 60_000, windowsHide: true });
  const value = JSON.parse(stdout);
  const durationSeconds = Number(value.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("ffprobe returned no positive media duration");
  const video = value.streams?.find((stream) => stream.codec_type === "video") ?? null;
  const audio = value.streams?.find((stream) => stream.codec_type === "audio") ?? null;
  return { durationSeconds, video, audio };
}

async function decodeMediaSample(mediaPath) {
  await execFileAsync(ffmpegPath, [
    "-v", "error",
    "-i", mediaPath,
    "-t", "1",
    "-map", "0:v:0",
    "-map", "0:a:0",
    "-f", "null",
    "-",
  ], { encoding: "utf8", timeout: 120_000, windowsHide: true });
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
      window.setTimeout(() => {
        window.clearTimeout(timeout);
        finish({ presented: element.currentTime > 0, currentTime: element.currentTime });
      }, 250);
    }
  }));
  await video.evaluate((element) => element.pause());
  if (!frame.presented) throw new Error(`Review video advanced without a decoded frame: ${JSON.stringify(frame)}`);
  return frame;
}

function containedRelativePath(root, target, label) {
  const normalizedRoot = normalizeWindowsAbsolutePath(root, `${label} root`);
  const normalizedTarget = normalizeWindowsAbsolutePath(target, label);
  const relative = path.win32.relative(normalizedRoot, normalizedTarget);
  if (!relative || path.win32.isAbsolute(relative) || relative.startsWith("..\\") || relative === "..") {
    throw new Error(`${label} is not a contained child of ${root}`);
  }
  return relative;
}

function normalizeWindowsAbsolutePath(value, label) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new Error(`${label} must be a non-empty Windows path`);
  }
  let candidate = value.trim();
  const verbatimUncPrefix = "\\\\?\\UNC\\";
  const verbatimPrefix = "\\\\?\\";
  if (candidate.slice(0, verbatimUncPrefix.length).toLowerCase() === verbatimUncPrefix.toLowerCase()) {
    candidate = `\\\\${candidate.slice(verbatimUncPrefix.length)}`;
  } else if (candidate.startsWith(verbatimPrefix)) {
    candidate = candidate.slice(verbatimPrefix.length);
  }
  if (candidate.startsWith("\\\\.\\") || !path.win32.isAbsolute(candidate)) {
    throw new Error(`${label} must be an absolute drive or UNC path`);
  }
  return path.win32.resolve(candidate);
}

function sameWindowsPath(left, right) {
  try {
    return normalizeWindowsAbsolutePath(left, "left path").toLowerCase()
      === normalizeWindowsAbsolutePath(right, "right path").toLowerCase();
  } catch {
    return false;
  }
}

function assertWindowsContainmentContracts() {
  const driveRoot = "E:\\temp\\AI Video Tutorial Generator Test Sandbox\\Projects";
  const expectedDriveChild = "local-sdxl-smoke\\assets\\sha256\\ab\\candidate.png";
  const driveChild = `\\\\?\\${driveRoot}\\${expectedDriveChild}`;
  const cases = [
    [driveRoot, driveChild, expectedDriveChild],
    [`\\\\?\\${driveRoot}`, `${driveRoot}\\${expectedDriveChild}`, expectedDriveChild],
    [driveRoot.toLowerCase(), driveChild, expectedDriveChild],
    ["\\\\server\\share\\Projects", "\\\\?\\UNC\\server\\share\\Projects\\lesson\\project.sqlite3", "lesson\\project.sqlite3"],
  ];
  for (const [root, target, expected] of cases) {
    const actual = containedRelativePath(root, target, "Windows containment contract child");
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`Windows containment contract returned ${actual}; expected ${expected}`);
    }
  }
  for (const target of [
    driveRoot,
    `${driveRoot}\\..\\owner-data`,
    `${driveRoot}-sibling\\candidate.png`,
    "C:\\temp\\outside.png",
    "\\\\?\\UNC\\server\\other-share\\Projects\\candidate.png",
    "relative\\candidate.png",
    "\\\\.\\PhysicalDrive0",
  ]) {
    let rejected = false;
    try {
      containedRelativePath(driveRoot, target, "Windows containment contract escape");
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`Windows containment contract accepted escape path ${target}`);
  }
}

async function sha256File(file) {
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
  const details = await stat(file).catch((error) => {
    throw new Error(`${label} is unavailable at ${file}: ${error.message}`);
  });
  if (!details.isFile() || details.size <= 0) throw new Error(`${label} is not a non-empty regular file: ${file}`);
  return details;
}

async function inspectCreativeResumeSource(sourceRunId) {
  const runsRoot = path.join(evidenceRoot, "runs");
  const sourceRunRoot = path.join(runsRoot, sourceRunId);
  if (path.dirname(sourceRunRoot) !== runsRoot || sourceRunRoot === runRoot) {
    throw new Error("Creative resume source must be one prior contained generation-smoke run");
  }
  const failurePath = path.join(sourceRunRoot, "failure.json");
  const sourceAppDataPath = path.join(sourceRunRoot, "isolated-app-data");
  const sourceProjectsPath = path.join(sourceRunRoot, "isolated-projects");
  const failure = await readJson(failurePath);
  if (failure?.schemaVersion !== 1
    || failure.state !== "failed"
    || failure.runId !== sourceRunId
    || failure.evidenceClass !== "bounded-real-creative-native-generation"
    || failure.ownerStateRestored !== true
    || failure.ownerProjectsRestored !== true
    || !sameWindowsPath(failure.isolatedAppDataEvidencePath, sourceAppDataPath)
    || !sameWindowsPath(failure.isolatedProjectsEvidencePath, sourceProjectsPath)
    || typeof failure.generationDiagnostics?.projectId !== "string"
    || typeof failure.generationDiagnostics?.generationId !== "string") {
    throw new Error(`Run ${sourceRunId} is not a safely restored failed Creative generation`);
  }
  const appDataEntries = ["WebView2", "model-setup.json"];
  for (const entry of appDataEntries) await assertSafeCopyTree(path.join(sourceAppDataPath, entry), `resume App Data ${entry}`);
  await assertSafeCopyTree(sourceProjectsPath, "resume Projects");
  const projectId = failure.generationDiagnostics.projectId;
  const generationId = failure.generationDiagnostics.generationId;
  const sourceProjectDirectory = await findProjectDirectoryByIdUnder(sourceProjectsPath, projectId);
  const sourceProjectDatabasePath = path.join(sourceProjectDirectory, "project.sqlite3");
  const relativeProjectDirectory = containedRelativePath(sourceProjectsPath, sourceProjectDirectory, "resume source project");
  const jobs = readGenerationJobRecords(sourceProjectDirectory, generationId);
  const byKind = new Map(jobs.map((job) => [job.kind, job]));
  for (const kind of ["generation.ingest_research", "generation.learning_plan", "generation.script", "generation.storyboard", "generation.approval", "generation.assets"]) {
    if (byKind.get(kind)?.state !== "SUCCEEDED") throw new Error(`Resume source ${kind} is not durably complete`);
  }
  const narration = byKind.get("generation.narration");
  if (narration?.state !== "FAILED" || narration.attemptCount !== 1 || !/Measured narration leaves/iu.test(narration.error?.message ?? "")) {
    throw new Error("Resume source is not the one-attempt post-synthesis narration timing failure");
  }
  for (const kind of ["generation.captions", "generation.presenter", "generation.render", "generation.qa_initial", "generation.repair_one", "generation.qa_one", "generation.repair_two", "generation.qa_final", "generation.export"]) {
    const job = byKind.get(kind);
    if (job?.state !== "BLOCKED" || job.attemptCount !== 0) throw new Error(`Resume source ${kind} has already consumed an attempt`);
  }
  const baselineUsage = readUsageRecords(sourceProjectDirectory);
  const groq = baselineUsage.filter((row) => row.provider === "groq" && row.model === expectedRoutes["llm.structured"][1]);
  const narrationUsage = baselineUsage.filter((row) => row.provider === "nvidia-nim" && row.model === expectedRoutes["audio.tts"][1]);
  if (baselineUsage.length !== 6 || groq.length !== 3 || narrationUsage.length !== 3) {
    throw new Error(`Resume source has an unexpected accepted-provider footprint: ${JSON.stringify(baselineUsage.map((row) => `${row.provider}/${row.model}`))}`);
  }
  return {
    runId: sourceRunId,
    runRoot: sourceRunRoot,
    failurePath,
    failureSha256: await sha256File(failurePath),
    sourceAppDataPath,
    appDataEntries,
    sourceProjectsPath,
    sourceProjectDirectory,
    sourceProjectDatabasePath,
    sourceProjectDatabaseSha256: await sha256File(sourceProjectDatabasePath),
    relativeProjectDirectory,
    projectId,
    generationId,
    baselineJobs: jobs,
    baselineUsage,
  };
}

async function inspectCompletedCreativeSource(sourceRunId) {
  const originalBaseline = await inspectCreativeResumeSource(creativeResumeBaselineRunId);
  const runsRoot = path.join(evidenceRoot, "runs");
  const sourceRunRoot = path.join(runsRoot, sourceRunId);
  if (path.dirname(sourceRunRoot) !== runsRoot || sourceRunRoot === runRoot || sourceRunId === originalBaseline.runId) {
    throw new Error("Completed continuation source must be one later contained generation-smoke run");
  }
  const failurePath = path.join(sourceRunRoot, "failure.json");
  const sourceAppDataPath = path.join(sourceRunRoot, "isolated-app-data");
  const sourceProjectsPath = path.join(sourceRunRoot, "isolated-projects");
  const failure = await readJson(failurePath);
  if (failure?.schemaVersion !== 1
    || failure.state !== "failed"
    || failure.runId !== sourceRunId
    || failure.evidenceClass !== "bounded-real-creative-native-generation-resume"
    || !/Resumed narration did not reuse all accepted speech/iu.test(failure.reason ?? "")
    || failure.ownerStateRestored !== true
    || failure.ownerProjectsRestored !== true
    || !sameWindowsPath(failure.isolatedAppDataEvidencePath, sourceAppDataPath)
    || !sameWindowsPath(failure.isolatedProjectsEvidencePath, sourceProjectsPath)
    || failure.generationDiagnostics?.projectId !== originalBaseline.projectId
    || failure.generationDiagnostics?.generationId !== originalBaseline.generationId) {
    throw new Error(`Run ${sourceRunId} is not the safely restored completed continuation of ${originalBaseline.runId}`);
  }
  const appDataEntries = ["WebView2", "model-setup.json"];
  for (const entry of appDataEntries) await assertSafeCopyTree(path.join(sourceAppDataPath, entry), `completed App Data ${entry}`);
  await assertSafeCopyTree(sourceProjectsPath, "completed Projects");
  const projectId = failure.generationDiagnostics.projectId;
  const generationId = failure.generationDiagnostics.generationId;
  const sourceProjectDirectory = await findProjectDirectoryByIdUnder(sourceProjectsPath, projectId);
  const sourceProjectDatabasePath = path.join(sourceProjectDirectory, "project.sqlite3");
  const relativeProjectDirectory = containedRelativePath(sourceProjectsPath, sourceProjectDirectory, "completed source project");
  const baselineJobs = readGenerationJobRecords(sourceProjectDirectory, generationId);
  const narration = baselineJobs.find((job) => job.kind === "generation.narration");
  const approvalRevisionId = narration?.parameters?.approvalRevisionId;
  if (typeof approvalRevisionId !== "string" || !approvalRevisionId.trim()) {
    throw new Error("Completed continuation has no durable approval revision identity");
  }
  assertCompletedGenerationJobs(baselineJobs, approvalRevisionId);
  const baselineUsage = readUsageRecords(sourceProjectDirectory);
  const inheritedUsage = baselineUsage.filter((row) => (row.provider === "groq" && row.model === expectedRoutes["llm.structured"][1])
    || (row.provider === "nvidia-nim" && row.model === expectedRoutes["audio.tts"][1]));
  assertUsageRecordsMatch(originalBaseline.baselineUsage, inheritedUsage, "completed continuation versus original Creative baseline");
  assertBoundedProviderFootprint(baselineUsage, 3, 0);
  assertResumedNarrationEvidence(sourceProjectDirectory, generationId, approvalRevisionId);
  return {
    runId: sourceRunId,
    runRoot: sourceRunRoot,
    failurePath,
    failureSha256: await sha256File(failurePath),
    sourceAppDataPath,
    appDataEntries,
    sourceProjectsPath,
    sourceProjectDirectory,
    sourceProjectDatabasePath,
    sourceProjectDatabaseSha256: await sha256File(sourceProjectDatabasePath),
    relativeProjectDirectory,
    projectId,
    generationId,
    approvalRevisionId,
    baselineJobs,
    baselineUsage,
    originalBaseline,
  };
}

async function inspectAcceptedLocalImageSource(sourceRunId) {
  const runsRoot = path.join(evidenceRoot, "runs");
  const sourceRunRoot = path.join(runsRoot, sourceRunId);
  if (path.dirname(sourceRunRoot) !== runsRoot || sourceRunRoot === runRoot) {
    throw new Error("Local image continuation source must be one prior contained generation-smoke run");
  }
  const failurePath = path.join(sourceRunRoot, "failure.json");
  const sourceAppDataPath = path.join(sourceRunRoot, "isolated-app-data");
  const sourceProjectsPath = path.join(sourceRunRoot, "isolated-projects");
  const failure = await readJson(failurePath);
  if (failure?.schemaVersion !== 1
    || failure.state !== "failed"
    || failure.runId !== sourceRunId
    || failure.evidenceClass !== "bounded-real-native-local-sdxl-image"
    || !/shared-scene-preview svg image/iu.test(failure.reason ?? "")
    || failure.ownerStateRestored !== true
    || failure.ownerProjectsRestored !== true
    || !sameWindowsPath(failure.isolatedAppDataEvidencePath, sourceAppDataPath)
    || !sameWindowsPath(failure.isolatedProjectsEvidencePath, sourceProjectsPath)
    || typeof failure.generationDiagnostics?.projectId !== "string") {
    throw new Error(`Run ${sourceRunId} is not a safely restored accepted local-image preview failure`);
  }
  const appDataEntries = ["WebView2", "model-setup.json"];
  for (const entry of appDataEntries) await assertSafeCopyTree(path.join(sourceAppDataPath, entry), `local continuation App Data ${entry}`);
  await assertSafeCopyTree(sourceProjectsPath, "local continuation Projects");
  const projectId = failure.generationDiagnostics.projectId;
  const sourceProjectDirectory = await findProjectDirectoryByIdUnder(sourceProjectsPath, projectId);
  const sourceProjectDatabasePath = path.join(sourceProjectDirectory, "project.sqlite3");
  const relativeProjectDirectory = containedRelativePath(sourceProjectsPath, sourceProjectDirectory, "local continuation source project");
  const job = readLocalImageJob(sourceProjectDirectory);
  const acceptance = readLocalImageProviderAcceptance(sourceProjectDirectory, job.jobId);
  const baselineUsage = readUsageRecords(sourceProjectDirectory);
  if (job.result?.candidateIds?.length !== 1
    || acceptance.provider !== "comfyui-local"
    || acceptance.result?.id !== job.result.candidateIds[0]
    || acceptance.result?.artifactHash !== job.result.candidates?.[0]?.artifactHash) {
    throw new Error("Local continuation source job and provider acceptance do not identify one exact candidate");
  }
  assertLocalSdxlCandidate(acceptance.result);
  const sourceSnapshot = readHeadSnapshot(sourceProjectDirectory);
  const acceptedCandidates = Array.isArray(sourceSnapshot.sceneCandidates)
    ? sourceSnapshot.sceneCandidates.filter((candidate) => candidate?.role === "scene")
    : [];
  if (acceptedCandidates.length !== 1) {
    throw new Error(`Local continuation source has ${acceptedCandidates.length} accepted scene candidate records; expected one`);
  }
  const acceptedCandidate = acceptedCandidates[0];
  const acceptedScene = sourceSnapshot.scenes?.find((scene) => scene?.id === "scene-local-sdxl");
  assertLocalSdxlCandidate(acceptedCandidate, "accepted");
  if (acceptedCandidate.id !== acceptance.result.id
    || acceptedCandidate.artifactHash !== acceptance.result.artifactHash
    || acceptedScene?.visualArtifactHash !== acceptedCandidate.artifactHash
    || !sourceSnapshot.customization?.assets?.some((asset) => asset?.sha256 === acceptedCandidate.artifactHash && asset?.kind === "background")) {
    throw new Error("Local continuation source did not durably accept the exact provider candidate into its scene and asset ledger");
  }
  if (baselineUsage.length !== 1
    || baselineUsage[0].jobId !== job.jobId
    || baselineUsage[0].provider !== "comfyui-local"
    || baselineUsage[0].model !== acceptance.model
    || baselineUsage[0].unit !== "image"
    || baselineUsage[0].quantity !== 1
    || baselineUsage[0].costMicros !== 0
    || baselineUsage[0].metadata?.providerUnits?.images !== 1
    || baselineUsage[0].metadata?.providerUnits?.steps !== 25) {
    throw new Error(`Local continuation source has an unexpected usage footprint: ${JSON.stringify(baselineUsage)}`);
  }
  return {
    runId: sourceRunId,
    runRoot: sourceRunRoot,
    failurePath,
    failureSha256: await sha256File(failurePath),
    sourceAppDataPath,
    appDataEntries,
    sourceProjectsPath,
    sourceProjectDirectory,
    sourceProjectDatabasePath,
    sourceProjectDatabaseSha256: await sha256File(sourceProjectDatabasePath),
    relativeProjectDirectory,
    projectId,
    job,
    acceptance,
    acceptedCandidate,
    sourceSnapshot,
    baselineUsage,
  };
}

async function hydrateResumeSource(source) {
  if ((await readdir(appDataPath)).length !== 0 || (await readdir(projectsPath)).length !== 0) {
    throw new Error("Fresh isolated App Data and Projects must be empty before resume hydration");
  }
  for (const entry of source.appDataEntries) {
    await cp(path.join(source.sourceAppDataPath, entry), path.join(appDataPath, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
      preserveTimestamps: true,
    });
  }
  for (const entry of await readdir(source.sourceProjectsPath)) {
    await cp(path.join(source.sourceProjectsPath, entry), path.join(projectsPath, entry), {
      recursive: true,
      force: false,
      errorOnExist: true,
      preserveTimestamps: true,
    });
  }
  const copiedProject = path.join(projectsPath, source.relativeProjectDirectory);
  const manifest = await readJson(path.join(copiedProject, "manifest.json"));
  if (manifest?.projectId !== source.projectId) throw new Error("Hydrated resume project identity differs from its preserved source");
  assertUsageRecordsMatch(source.baselineUsage, readUsageRecords(copiedProject), "copied resume baseline");
}

async function assertSafeCopyTree(root, label) {
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    const details = await lstat(current).catch((error) => {
      throw new Error(`${label} is unavailable at ${current}: ${error.message}`);
    });
    if (details.isSymbolicLink() || (!details.isDirectory() && !details.isFile())) {
      throw new Error(`${label} contains an unsafe filesystem entry: ${current}`);
    }
    if (!details.isDirectory()) continue;
    for (const entry of await readdir(current)) pending.push(path.join(current, entry));
  }
}

function readGenerationJobRecords(projectDirectory, generationId) {
  const database = new DatabaseSync(path.join(projectDirectory, "project.sqlite3"), { readOnly: true });
  try {
    return database.prepare("SELECT job_id, kind, state, attempt_count, error_json, parameters_json FROM jobs WHERE kind LIKE 'generation.%' ORDER BY created_at").all()
      .map((row) => ({ ...row, parameters: JSON.parse(row.parameters_json) }))
      .filter((row) => row.parameters.generationId === generationId)
      .map((row) => ({
        jobId: row.job_id,
        kind: row.kind,
        state: row.state,
        attemptCount: row.attempt_count,
        error: row.error_json ? JSON.parse(row.error_json) : null,
        parameters: row.parameters,
      }));
  } finally {
    database.close();
  }
}

function readHeadSnapshot(projectDirectory) {
  const database = new DatabaseSync(path.join(projectDirectory, "project.sqlite3"), { readOnly: true });
  try {
    const row = database.prepare("SELECT revisions.snapshot_json FROM project_meta JOIN revisions ON revisions.revision_id = project_meta.head_revision_id WHERE project_meta.singleton = 1").get();
    if (typeof row?.snapshot_json !== "string") throw new Error("Native project has no durable head snapshot");
    return JSON.parse(row.snapshot_json);
  } finally {
    database.close();
  }
}

function assertUsageRecordsMatch(expected, actual, label) {
  const canonical = (rows) => rows.map((row) => ({
    usageId: row.usageId,
    jobId: row.jobId,
    provider: row.provider,
    model: row.model,
    unit: row.unit,
    quantity: row.quantity,
    costMicros: row.costMicros,
    metadata: row.metadata,
    createdAt: row.createdAt,
  })).sort((left, right) => left.usageId.localeCompare(right.usageId));
  if (stableJson(canonical(expected)) !== stableJson(canonical(actual))) {
    throw new Error(`${label} changed accepted provider usage records`);
  }
}

function assertCompletedGenerationJobs(jobs, approvalRevisionId) {
  const expectedAttempts = new Map([
    ["generation.ingest_research", 1],
    ["generation.learning_plan", 1],
    ["generation.script", 1],
    ["generation.storyboard", 1],
    ["generation.approval", 1],
    ["generation.assets", 1],
    ["generation.narration", 2],
    ["generation.captions", 1],
    ["generation.presenter", 1],
    ["generation.render", 1],
    ["generation.qa_initial", 1],
    ["generation.repair_one", 1],
    ["generation.qa_one", 1],
    ["generation.repair_two", 1],
    ["generation.qa_final", 1],
    ["generation.export", 1],
  ]);
  if (jobs.length !== expectedAttempts.size) {
    throw new Error(`Completed continuation has ${jobs.length} generation stages; expected ${expectedAttempts.size}`);
  }
  const approvedKinds = new Set([...expectedAttempts.keys()].slice(5));
  for (const [kind, expectedAttemptCount] of expectedAttempts) {
    const matches = jobs.filter((job) => job.kind === kind);
    const job = matches[0];
    if (matches.length !== 1 || job.state !== "SUCCEEDED" || job.attemptCount !== expectedAttemptCount
      || (approvedKinds.has(kind) && job.parameters?.approvalRevisionId !== approvalRevisionId)) {
      throw new Error(`Completed continuation does not have one accepted ${kind} stage at the reviewed attempt and approval revision`);
    }
  }
}

function assertGenerationJobRecordsMatch(expected, actual, label) {
  const canonical = (jobs) => jobs.map((job) => ({
    jobId: job.jobId,
    kind: job.kind,
    state: job.state,
    attemptCount: job.attemptCount,
    error: job.error,
    parameters: job.parameters,
  })).sort((left, right) => left.kind.localeCompare(right.kind));
  if (stableJson(canonical(expected)) !== stableJson(canonical(actual))) {
    throw new Error(`${label} changed accepted generation stage records`);
  }
}

function stableJson(value) {
  const canonicalize = (item) => {
    if (Array.isArray(item)) return item.map(canonicalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonicalize(item[key])]));
    }
    return item;
  };
  return JSON.stringify(canonicalize(value));
}

function assertAuthoringAndNarrationUsageUnchanged(before, after) {
  const isProtected = (row) => (row.provider === "groq" && row.model === expectedRoutes["llm.structured"][1])
    || (row.provider === "nvidia-nim" && row.model === expectedRoutes["audio.tts"][1]);
  assertUsageRecordsMatch(before.filter(isProtected), after.filter(isProtected), "resumed authoring and narration");
}

function assertResumedStageAttempts(before, after) {
  const completedBeforeFailure = new Set([
    "generation.ingest_research",
    "generation.learning_plan",
    "generation.script",
    "generation.storyboard",
    "generation.approval",
    "generation.assets",
  ]);
  const beforeByKind = new Map(before.map((job) => [job.kind, job]));
  const afterByKind = new Map(after.map((job) => [job.kind, job]));
  for (const kind of completedBeforeFailure) {
    const previous = beforeByKind.get(kind);
    const current = afterByKind.get(kind);
    if (previous?.state !== "SUCCEEDED"
      || current?.state !== "SUCCEEDED"
      || current.jobId !== previous.jobId
      || current.attemptCount !== previous.attemptCount) {
      throw new Error(`Resume unexpectedly reran the already accepted ${kind} stage`);
    }
  }
}

function assertResumedNarrationEvidence(projectDirectory, generationId, approvalRevisionId) {
  const stage = readGenerationStage(projectDirectory, generationId, "generation.narration", approvalRevisionId);
  const narration = stage.payload?.narration;
  const timingAdjustment = stage.payload?.storyboard?.timingAdjustment;
  const expectedTiming = {
    schemaVersion: 1,
    durationContract: "target",
    reason: "measured-narration-fit",
    requestedDurationTicks: 14_400_000,
    measuredNarrationTicks: 10_242_720,
    maximumVisualTailTicks: 864_000,
    appliedVisualTailTicks: 864_000,
    fittedDurationTicks: 11_106_720,
    adjustmentTicks: -3_293_280,
    adjustmentRatio: -0.2287,
  };
  const narrationJob = readGenerationJobRecords(projectDirectory, generationId).find((job) => job.kind === "generation.narration");
  if (!Array.isArray(narration)
    || narration.length !== 3
    || JSON.stringify(narration.map((item) => item.durationMs)) !== JSON.stringify([15_093, 13_514, 14_071])
    || narration.some((item) => item.synthesis?.reused !== true
      || item.synthesis?.providerInvoked !== false
      || item.synthesis?.newActualCostMicros !== 0)
    || stableJson(timingAdjustment) !== stableJson(expectedTiming)
    || narrationJob?.state !== "SUCCEEDED"
    || narrationJob.attemptCount !== 2) {
    throw new Error(`Resumed narration did not reuse all accepted speech with the reviewed target-duration fit: ${JSON.stringify({
      durationsMs: Array.isArray(narration) ? narration.map((item) => item.durationMs) : null,
      synthesis: Array.isArray(narration) ? narration.map((item) => item.synthesis) : null,
      timingAdjustment,
      narrationJob,
    })}`);
  }
  return {
    jobId: narrationJob.jobId,
    attemptCount: narrationJob.attemptCount,
    reusedSceneCount: narration.length,
    providerInvokedSceneCount: 0,
    newActualCostMicros: 0,
    durationsMs: narration.map((item) => item.durationMs),
    timingAdjustment,
  };
}

async function recoverInterruptedOwnerIsolation() {
  const prior = await readJson(journalPath, null);
  if (!prior) return;
  validateIsolationJournal(prior);
  await assertNoPortableOwnedProcesses();
  const recoveryRoot = path.join(evidenceRoot, "recovered-isolation", `${prior.runId}-recovered-by-${runId}`);
  await mkdir(recoveryRoot, { recursive: true });
  for (const entry of prior.entries) {
    const backupExists = await pathExists(entry.backup);
    const targetExists = await pathExists(entry.target);
    if (entry.hadOwner && !backupExists) {
      if (!targetExists) throw new Error(`Interrupted isolation lost both owner paths for ${entry.label}`);
      await assertSafeDirectory(entry.target, `restored owner ${entry.label}`);
      continue;
    }
    if (targetExists) {
      await assertSafeDirectory(entry.target, `interrupted isolated ${entry.label}`);
      await renameWithRetry(entry.target, path.join(recoveryRoot, entry.label), 30_000);
    }
    if (entry.hadOwner) {
      await assertSafeDirectory(entry.backup, `preserved owner ${entry.label}`);
      await renameWithRetry(entry.backup, entry.target, 30_000);
    } else {
      await mkdir(entry.target, { recursive: false });
    }
  }
  await rm(journalPath, { force: true });
}

async function isolateOwnerDirectories() {
  await assertNoPortableOwnedProcesses();
  const stamp = `${new Date().toISOString().replace(/[^0-9]/gu, "")}-${process.pid}`;
  const entries = [
    { label: "app-data", target: appDataPath, backup: `${appDataPath}.owner-preserved-${stamp}` },
    { label: "projects", target: projectsPath, backup: `${projectsPath}.owner-preserved-${stamp}` },
  ];
  for (const entry of entries) {
    const details = await lstat(entry.target).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (details && (details.isSymbolicLink() || !details.isDirectory())) {
      throw new Error(`Owner ${entry.label} path is unsafe: ${entry.target}`);
    }
    entry.hadOwner = Boolean(details);
  }
  const current = { schemaVersion: 1, runId, portableRoot, entries };
  await writeNewJournal(current);
  isolation = current;
  for (const entry of entries) {
    if (entry.hadOwner) await renameWithRetry(entry.target, entry.backup, 30_000);
    await mkdir(entry.target, { recursive: false });
  }
  return current;
}

async function preserveIsolatedStateAndRestoreOwner(current) {
  validateIsolationJournal(current);
  await assertNoPortableOwnedProcesses();
  const evidence = {};
  for (const entry of current.entries) {
    await assertSafeDirectory(entry.target, `isolated ${entry.label}`);
    const destination = path.join(runRoot, `isolated-${entry.label}`);
    if (await pathExists(destination)) throw new Error(`Isolation evidence destination already exists: ${destination}`);
    await renameWithRetry(entry.target, destination, 30_000);
    evidence[entry.label === "app-data" ? "appData" : "projects"] = destination;
    if (entry.hadOwner) {
      await assertSafeDirectory(entry.backup, `preserved owner ${entry.label}`);
      await renameWithRetry(entry.backup, entry.target, 30_000);
    } else {
      await mkdir(entry.target, { recursive: false });
    }
  }
  await rm(journalPath, { force: true });
  isolation = undefined;
  return evidence;
}

function validateIsolationJournal(value) {
  if (value?.schemaVersion !== 1 || typeof value.runId !== "string" || !/^[0-9-]+$/u.test(value.runId)
    || !sameWindowsPath(value.portableRoot, portableRoot) || !Array.isArray(value.entries) || value.entries.length !== 2) {
    throw new Error(`Owner isolation journal is invalid and requires manual review: ${journalPath}`);
  }
  const expected = new Map([
    ["app-data", appDataPath],
    ["projects", projectsPath],
  ]);
  for (const entry of value.entries) {
    const expectedTarget = expected.get(entry?.label);
    if (!expectedTarget || !sameWindowsPath(entry.target, expectedTarget) || typeof entry.hadOwner !== "boolean") {
      throw new Error(`Owner isolation journal contains an unexpected target: ${journalPath}`);
    }
    const resolvedBackup = typeof entry.backup === "string"
      ? normalizeWindowsAbsolutePath(entry.backup, "owner isolation backup")
      : "";
    const expectedBackupPrefix = `${path.basename(expectedTarget)}.owner-preserved-`;
    if (typeof entry.backup !== "string"
      || !sameWindowsPath(path.dirname(resolvedBackup), portableRoot)
      || !path.basename(resolvedBackup).toLowerCase().startsWith(expectedBackupPrefix.toLowerCase())) {
      throw new Error(`Owner isolation journal contains an unsafe backup path: ${journalPath}`);
    }
    expected.delete(entry.label);
  }
  if (expected.size) throw new Error(`Owner isolation journal is incomplete: ${journalPath}`);
}

async function assertSafeDirectory(target, label) {
  const details = await lstat(target).catch((error) => {
    throw new Error(`${label} directory is unavailable at ${target}: ${error.message}`);
  });
  if (details.isSymbolicLink() || !details.isDirectory()) throw new Error(`${label} path is unsafe: ${target}`);
}

async function writeNewJournal(value) {
  const temporary = `${journalPath}.tmp-${runId}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    await rename(temporary, journalPath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
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

async function pathExists(target) {
  try { await lstat(target); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

async function assertNoForeignOwnerIsolation() {
  const foreignJournals = [
    path.join(portableRoot, "Evidence", "native-runtime-install", "owner-isolation.json"),
  ];
  const activeJournals = [];
  for (const candidate of foreignJournals) if (await pathExists(candidate)) activeJournals.push(candidate);
  const preservedOwners = (await readdir(portableRoot))
    .filter((name) => name.startsWith("App Data.owner-preserved-") || name.startsWith("Projects.owner-preserved-"));
  if (activeJournals.length || preservedOwners.length) {
    throw new Error(`Another acceptance harness may still own the portable App Data or Projects; generation isolation was not started: ${JSON.stringify({ activeJournals, preservedOwners })}`);
  }
}

async function startNative(logPrefix) {
  const port = await reservePort();
  const stdout = await open(path.join(runRoot, `${logPrefix}.stdout.log`), "w");
  const stderr = await open(path.join(runRoot, `${logPrefix}.stderr.log`), "w");
  const child = spawn(executable, [], {
    cwd: portableRoot,
    env: nativeLaunchEnvironment(port),
    windowsHide: true,
    stdio: ["ignore", stdout.fd, stderr.fd],
  });
  let browser;
  let workerPid;
  try {
    browser = await connectToWebView(port, parsed.startupTimeoutMs, child);
    const ready = await waitForJson(readyPath, parsed.startupTimeoutMs, child);
    workerPid = validatedReadyWorkerPid(ready, child.pid);
    const pages = browser.contexts().flatMap((context) => context.pages());
    if (pages.length !== 1) throw new Error(`Expected one native WebView page, found ${pages.length}`);
    return { child, browser, page: pages[0], workerPid, stdout, stderr, port };
  } catch (error) {
    workerPid ||= await readReadyWorkerPid(child.pid);
    const cleanupErrors = await cleanupFailedNativeStart({ child, browser, workerPid, stdout, stderr });
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "Native generation startup and cleanup both failed");
    throw error;
  }
}

async function startBootstrapNative() {
  const port = await reservePort();
  const stdout = await open(path.join(runRoot, "bootstrap.stdout.log"), "w");
  const stderr = await open(path.join(runRoot, "bootstrap.stderr.log"), "w");
  const child = spawn(executable, [], {
    cwd: portableRoot,
    env: nativeLaunchEnvironment(port),
    windowsHide: true,
    stdio: ["ignore", stdout.fd, stderr.fd],
  });
  const current = { child, workerPid: undefined, stdout, stderr };
  bootstrapLaunch = current;
  try {
    const ready = await waitForJson(readyPath, parsed.startupTimeoutMs, child);
    current.workerPid = validatedReadyWorkerPid(ready, child.pid);
    return current;
  } catch (error) {
    current.workerPid ||= await readReadyWorkerPid(child.pid);
    throw error;
  }
}

function nativeLaunchEnvironment(port) {
  return {
    ...process.env,
    ALYSTRIA_HEADLESS_ACCEPTANCE: "1",
    ALYSTRIA_HEADLESS_ACCEPTANCE_CDP_PORT: String(port),
    ...(parsed.recordWalkthrough ? {
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*`,
    } : {}),
    ...(parsed.gpuCoordinationPath ? { ALYSTRIA_GPU_LOCK_PATH: parsed.gpuCoordinationPath } : {}),
  };
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

async function assertNoPortableOwnedProcesses() {
  await waitForPortableWebViewExit(30_000);
  const processes = await portableOwnedProcesses();
  if (processes.length) {
    throw new Error(`Portable desktop, worker, or runtime processes are still active; owner isolation was not changed: ${JSON.stringify(processes)}`);
  }
}

async function portableOwnedProcesses() {
  const desktopLiteral = executable.replaceAll("'", "''");
  const workerLiteral = workerExecutable.replaceAll("'", "''");
  const rootLiteral = portableRoot.replaceAll("'", "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "function Normalize-ProcessPath([string]$Value) {",
    "  if ([string]::IsNullOrWhiteSpace($Value)) { return '' }",
    "  $candidate = $Value.Trim()",
    "  if ($candidate.StartsWith('\\\\?\\UNC\\', [System.StringComparison]::OrdinalIgnoreCase)) {",
    "    $candidate = '\\\\' + $candidate.Substring(8)",
    "  } elseif ($candidate.StartsWith('\\\\?\\', [System.StringComparison]::OrdinalIgnoreCase)) {",
    "    $candidate = $candidate.Substring(4)",
    "  }",
    "  try { return [System.IO.Path]::GetFullPath($candidate).TrimEnd('\\') } catch { return $candidate.TrimEnd('\\') }",
    "}",
    `$desktop = Normalize-ProcessPath '${desktopLiteral}'`,
    `$worker = Normalize-ProcessPath '${workerLiteral}'`,
    `$root = Normalize-ProcessPath '${rootLiteral}'`,
    "$rootPrefix = $root + '\\'",
    `$selfPid = ${process.pid}`,
    "$matches = @(Get-CimInstance Win32_Process | Where-Object {",
    "  if ([int]$_.ProcessId -eq $selfPid) { return $false }",
    "  $image = Normalize-ProcessPath ([string]$_.ExecutablePath)",
    "  $command = [string]$_.CommandLine",
    "  ($image -and ($image -ieq $desktop -or $image -ieq $worker -or $image.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase))) -or",
    "  (($_.Name -ieq 'AI Video Tutorial Generator.exe' -or $_.Name -ieq 'alystria-pipeline.exe') -and $command -like \"*$root*\")",
    "} | Select-Object ProcessId, Name, ExecutablePath)",
    "if ($matches.Count -eq 0) { '[]' } else { $matches | ConvertTo-Json -Compress }",
  ].join("\n");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  const value = JSON.parse(stdout.trim() || "[]");
  const records = Array.isArray(value) ? value : [value];
  return records.map((record) => ({ pid: Number(record.ProcessId), name: String(record.Name ?? "unknown") }));
}

async function rotateExistingPath(target, label = "previous") {
  try { await stat(target); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  rotationSequence += 1;
  const parsedTarget = path.parse(target);
  const stamp = new Date().toISOString().replace(/[^0-9]/gu, "");
  const destination = path.join(parsedTarget.dir, `${parsedTarget.name}.${label}-${stamp}-${process.pid}-${rotationSequence}${parsedTarget.ext}`);
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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
