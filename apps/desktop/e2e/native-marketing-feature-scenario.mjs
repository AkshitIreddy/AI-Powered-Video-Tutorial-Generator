import { expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  buildMarketingNativeCaptureTimeline,
  marketingDemoTitle,
  marketingFrameRate,
  prepareMarketingTutorialInNativeEditor,
  validateMarketingAssetManifest,
} from "./native-marketing-demo-edit.mjs";

const execFileAsync = promisify(execFile);

export const soulxModelContract = Object.freeze({
  modelId: "local/soulx-flashhead-pro",
  engineId: "soulx-flashhead-pro",
  workerContractId: "alystria.soulx-flashhead.worker.v1",
  catalogDisplayName: "SoulX-FlashHead Pro 1.3B",
  uiHeading: "SoulX-FlashHead Pro",
  minimumPreviewMs: 4_000,
  maximumPreviewMs: 7_000,
});

export const soulxInstallContract = Object.freeze({
  manifestSha256: "b8e3e9859911e798c18054f4921d637800afd5a45717015c3c20cc4203537106",
  immutableRevision: "soulx-9bc03de0+pro-59119b6c+wav2vec-22aad52d+py3106+cu128",
  artifactCount: 75,
  totalBytes: 10_394_156_663,
});

const readyDownloadPhases = new Set(["ready", "inUse"]);
const finalJobStates = new Set(["SUCCEEDED", "FAILED", "BLOCKED", "CANCELLED", "STALE"]);

export async function preflightNativeMarketingFeatureScenario({
  manifestPath,
  customPortraitPath,
  customPortraitSha256,
  ffprobePath,
  gpuCoordinationPath,
  gifsmithRoot = null,
  recordCapture = false,
}) {
  const validation = await validateMarketingAssetManifest(manifestPath, { ffprobePath, stage: "preflight" });
  if (validation.manifest.mode !== "final") throw new Error("The native marketing feature scenario requires a final asset manifest");
  const portrait = await inspectPortrait(customPortraitPath, customPortraitSha256);
  const coordination = await stat(gpuCoordinationPath).catch(() => null);
  if (!coordination?.isFile()) throw new Error("The native SoulX preview requires the explicit GPU coordination marker path");
  const capture = recordCapture
    ? await preflightMarketingCapture({ gifsmithRoot, edit: validation.edit, projectTitle: marketingDemoTitle })
    : null;
  return {
    schemaVersion: 1,
    evidenceClass: "source-verified-native-marketing-feature-preflight",
    assetManifest: validation.manifest,
    marketingValidation: { edit: validation.edit, stage: validation.stage },
    portrait,
    soulx: soulxModelContract,
    gpuCoordinationPath: path.resolve(gpuCoordinationPath),
    permitsProviderCalls: false,
    permitsManagedInstallationActivation: true,
    requiresHydratedManagedPackage: true,
    permitsNetworkModelDownload: false,
    permitsLocalInference: true,
    expectedLocalInferenceCalls: 1,
    expectedMusicSearches: 1,
    capture,
  };
}

export function assertSoulxNativeReadiness({ catalog, statuses, setup, runtimeStatuses }) {
  if (!Array.isArray(catalog) || !Array.isArray(statuses) || !setup || !Array.isArray(runtimeStatuses)) {
    throw new Error("SoulX readiness needs catalog, download status, setup, and presenter runtime receipts");
  }
  const packageEntry = catalog.find((entry) => entry.modelId === soulxModelContract.modelId);
  if (!packageEntry?.available || packageEntry.displayName !== soulxModelContract.catalogDisplayName
    || !packageEntry.immutableRevision || !Number.isSafeInteger(packageEntry.totalBytes) || packageEntry.totalBytes <= 0) {
    throw new Error("The managed SoulX download declaration is missing or incomplete");
  }
  const status = statuses.find((entry) => entry.modelId === soulxModelContract.modelId);
  if (!status || !readyDownloadPhases.has(status.phase) || status.activationBlocked !== false
    || status.downloadedBytes !== status.totalBytes || status.totalBytes !== packageEntry.totalBytes
    || !/^[0-9a-f]{64}$/u.test(status.installFingerprint ?? "") || !status.runtimeRevision?.trim()) {
    throw new Error("SoulX is not fully downloaded, hash-verified, activated, and ready");
  }
  if (setup.lipSyncModelId !== soulxModelContract.modelId
    || setup.portraitAnimationModelId !== soulxModelContract.modelId
    || !setup.selectedModelIds?.includes(soulxModelContract.modelId)) {
    throw new Error("SoulX is installed but not selected for both presenter motion and lip-sync");
  }
  const relevant = runtimeStatuses.filter((entry) => entry.modelId === soulxModelContract.engineId);
  const primary = relevant.find((entry) => entry.portraitArtifactHash === null);
  if (!primary?.configured || primary.modelRevision !== status.runtimeRevision
    || primary.installFingerprint !== status.installFingerprint || !primary.reason?.trim()) {
    throw new Error("SoulX presenter runtime status has no matching configured primary route");
  }
  return {
    modelId: packageEntry.modelId,
    displayName: packageEntry.displayName,
    immutableRevision: packageEntry.immutableRevision,
    totalBytes: packageEntry.totalBytes,
    phase: status.phase,
    runtimeRevision: status.runtimeRevision,
    installFingerprint: status.installFingerprint,
    selectedForPortraitAnimation: true,
    selectedForLipSync: true,
    runtimeStatusCount: relevant.length,
    primaryRuntimeReason: primary.reason,
  };
}

export async function preflightSoulxHydratedCache({
  modelsRoot,
  manifestPath,
  expectedManifestSha256 = soulxInstallContract.manifestSha256,
  expectedIdentity = soulxInstallContract,
}) {
  const manifestBytes = await readFile(manifestPath);
  const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
  if (manifestSha256 !== expectedManifestSha256) {
    throw new Error(`SoulX install manifest hash mismatch: expected ${expectedManifestSha256}, received ${manifestSha256}`);
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.schemaVersion !== 1 || manifest.modelId !== soulxModelContract.modelId
    || manifest.displayName !== soulxModelContract.catalogDisplayName || !Array.isArray(manifest.artifacts)
    || manifest.immutableRevision !== expectedIdentity.immutableRevision
    || manifest.artifacts.length !== expectedIdentity.artifactCount) {
    throw new Error("SoulX install manifest identity does not match the reviewed managed package");
  }
  const artifacts = manifest.artifacts.map((artifact, index) => normalizeSoulxArtifact(artifact, index));
  const totalBytes = artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes !== expectedIdentity.totalBytes) {
    throw new Error(`SoulX install manifest byte total mismatch: expected ${expectedIdentity.totalBytes}, received ${totalBytes}`);
  }
  const cacheRoot = path.join(
    path.resolve(modelsRoot),
    "download-quarantine",
    manifest.modelId.replaceAll("/", "--"),
    manifest.immutableRevision,
  );
  const preparationPath = path.join(cacheRoot, "root-cache-preparation.json");
  const preparation = JSON.parse(await readFile(preparationPath, "utf8"));
  const preparedFiles = Array.isArray(preparation.files) ? preparation.files : [];
  const preparedPaths = preparedFiles.map((entry) => entry?.file);
  const expectedPaths = artifacts.map((artifact) => artifact.relativePath);
  if (preparation.manifestSha256 !== manifestSha256 || preparation.state !== "cache-prepared-not-installed"
    || preparation.artifactCount !== artifacts.length || preparation.bytes !== totalBytes
    || preparedPaths.length !== expectedPaths.length || new Set(preparedPaths).size !== expectedPaths.length
    || preparedFiles.some((entry) => entry?.source !== "verified-cache")
    || expectedPaths.some((relativePath) => !preparedPaths.includes(relativePath))) {
    throw new Error("SoulX root cache preparation receipt does not cover the exact reviewed manifest");
  }
  const ledger = createHash("sha256");
  for (const artifact of artifacts) {
    const artifactPath = path.join(cacheRoot, "files", ...artifact.relativePath.split("/"));
    assertContainedPath(path.join(cacheRoot, "files"), artifactPath, `SoulX cache artifact ${artifact.relativePath}`);
    const artifactStat = await lstat(artifactPath).catch(() => null);
    if (!artifactStat?.isFile() || artifactStat.isSymbolicLink() || artifactStat.size !== artifact.bytes) {
      throw new Error(`SoulX cached artifact is missing or has the wrong byte count: ${artifact.relativePath}`);
    }
    const actualSha256 = await sha256File(artifactPath);
    if (actualSha256 !== artifact.sha256) {
      throw new Error(`SoulX cached artifact hash mismatch: ${artifact.relativePath}`);
    }
    ledger.update(`${artifact.relativePath}\0${artifact.bytes}\0${actualSha256}\n`);
  }
  return {
    schemaVersion: 1,
    evidenceClass: "source-manifest-and-file-verified-soulx-cache",
    verifiedOfflineCache: true,
    modelId: manifest.modelId,
    displayName: manifest.displayName,
    immutableRevision: manifest.immutableRevision,
    manifestPath: path.resolve(manifestPath),
    manifestSha256,
    cacheRoot,
    preparationReceiptPath: preparationPath,
    artifactCount: artifacts.length,
    totalBytes,
    artifactLedgerSha256: ledger.digest("hex"),
  };
}

export function assertSoulxManagedStart({ catalog, statuses, cachePreflight }) {
  const packageEntry = catalog?.find((entry) => entry.modelId === soulxModelContract.modelId);
  if (!packageEntry?.available || packageEntry.displayName !== soulxModelContract.catalogDisplayName
    || packageEntry.immutableRevision !== cachePreflight?.immutableRevision
    || packageEntry.totalBytes !== cachePreflight?.totalBytes
    || packageEntry.artifactCount !== cachePreflight?.artifactCount
    || cachePreflight?.modelId !== soulxModelContract.modelId
    || cachePreflight?.evidenceClass !== "source-manifest-and-file-verified-soulx-cache"
    || cachePreflight?.verifiedOfflineCache !== true) {
    throw new Error("The packaged native SoulX managed download declaration is unavailable");
  }
  const status = statuses?.find((entry) => entry.modelId === soulxModelContract.modelId);
  const statusMatchesPackage = status?.immutableRevision === packageEntry.immutableRevision
    && status.totalBytes === packageEntry.totalBytes && status.artifactCount === packageEntry.artifactCount;
  const complete = statusMatchesPackage && status.downloadedBytes === packageEntry.totalBytes
    && status.totalBytes === packageEntry.totalBytes && status.verifiedArtifacts === packageEntry.artifactCount
    && ["downloadedQuarantined", "ready", "inUse"].includes(status.phase);
  const verifiedManifestOnly = statusMatchesPackage && status.phase === "manifestRequired" && status.downloadedBytes === 0
    && status.verifiedArtifacts === 0 && status.totalBytes === packageEntry.totalBytes
    && status.artifactCount === packageEntry.artifactCount;
  const verifiedFailedInstall = statusMatchesPackage && status.phase === "failed"
    && status.downloadedBytes === packageEntry.totalBytes && status.verifiedArtifacts === packageEntry.artifactCount
    && status.activationBlocked === true && status.runtimeRevision == null && status.installFingerprint == null
    && typeof status.licenseAcceptedAt === "string" && Boolean(status.licenseAcceptedAt.trim())
    && typeof status.detail === "string" && Boolean(status.detail.trim());
  if (!complete && !verifiedManifestOnly && !verifiedFailedInstall) {
    throw new Error(`SoulX managed setup refuses an incomplete or unverified cache state: ${JSON.stringify(status ?? null)}`);
  }
  return {
    packageEntry,
    status,
    requiresNativeDownloadStart: Boolean(verifiedManifestOnly || verifiedFailedInstall),
    startMode: verifiedManifestOnly ? "initial-download" : verifiedFailedInstall ? "retry-failed-install" : "already-complete",
  };
}

export async function runSoulxSetupOnly({ page, invokeNativeWithoutInput, runRoot, cachePreflight, actionTimeoutMs = 60_000, jobTimeoutMs = 1_200_000 }) {
  await mkdir(runRoot, { recursive: true });
  const activation = await activateSoulxThroughModelsUi({ page, invokeNativeWithoutInput, runRoot, cachePreflight, actionTimeoutMs, jobTimeoutMs });
  const modelEvidence = await captureSoulxModelEvidence(page, runRoot, activation.soulx, actionTimeoutMs);
  return {
    schemaVersion: 1,
    evidenceClass: "actual-native-soulx-managed-setup",
    actualNativeWebView: true,
    providerCalls: 0,
    networkModelDownloads: 0,
    cachePreflight,
    managedPackageActivation: activation,
    modelEvidence,
  };
}

export async function runNativeMarketingFeatureScenario({
  page,
  projectsPath,
  invokeNative,
  invokeNativeWithoutInput,
  ffprobePath,
  assetManifest,
  preflight,
  cachePreflight,
  runRoot,
  customPresenterName,
  musicQuery,
  musicMood = "curious",
  actionTimeoutMs = 60_000,
  jobTimeoutMs = 900_000,
  recording = null,
}) {
  if (!preflight?.portrait || preflight.assetManifest !== assetManifest) throw new Error("Run the exact marketing feature preflight before native work");
  await mkdir(runRoot, { recursive: true });
  const activation = await activateSoulxThroughModelsUi({ page, invokeNativeWithoutInput, runRoot, cachePreflight, actionTimeoutMs, jobTimeoutMs });
  const soulx = activation.soulx;
  const modelEvidence = await captureSoulxModelEvidence(page, runRoot, soulx, actionTimeoutMs);
  const tutorial = await prepareMarketingTutorialInNativeEditor({
    page,
    projectsPath,
    invokeNative,
    ffprobePath,
    assetManifest,
    presenterRouteModel: soulxModelContract.modelId,
    actionTimeoutMs,
    jobTimeoutMs,
  });
  const presenter = await exerciseCustomPresenter({
    page,
    invokeNative,
    invokeNativeWithoutInput,
    identity: tutorial.identity,
    projectTitle: tutorial.title,
    portraitPath: preflight.portrait.path,
    portraitSha256: preflight.portrait.sha256,
    displayName: customPresenterName,
    runRoot,
    actionTimeoutMs,
    jobTimeoutMs,
  });
  const music = await exerciseMusicBrowser({
    page,
    invokeNative,
    identity: tutorial.identity,
    query: musicQuery,
    mood: musicMood,
    runRoot,
    actionTimeoutMs,
    jobTimeoutMs,
  });
  const finalEditorExport = await renderAcceptedMusicTimeline({
    page,
    invokeNative,
    identity: tutorial.identity,
    projectTitle: tutorial.title,
    music,
    durationFrames: tutorial.timing.durationFrames,
    expectedDurationSeconds: tutorial.timing.durationSeconds,
    ffprobePath,
    runRoot,
    actionTimeoutMs,
    jobTimeoutMs,
  });
  const finalSnapshot = await invokeNative(page, "project_snapshot_get", tutorial.identity);
  const persistedMusic = finalSnapshot.snapshot?.musicCandidates?.find((entry) => entry.id === music.candidateId);
  if (persistedMusic?.status !== "accepted" || !finalSnapshot.snapshot?.customization?.audio?.musicAssetId) {
    throw new Error("The accepted music candidate was not selected in the durable project customization");
  }
  const capture = recording
    ? await recordNativeMarketingCapture({
      page,
      cdpPort: recording.cdpPort,
      gifsmithRoot: recording.gifsmithRoot,
      runRoot,
      edit: preflight.marketingValidation.edit,
      projectTitle: tutorial.title,
      recordingWindow: recording.recordingWindow,
      preflight: preflight.capture,
    })
    : null;
  return {
    schemaVersion: 1,
    evidenceClass: "actual-native-marketing-feature-scenario",
    actualNativeWebView: true,
    fixtureUi: false,
    providerCalls: 0,
    openverseSearches: 1,
    externalMediaDownloadBound: "one search with at most three rights-eligible candidates",
    modelDownloadsStarted: activation.modelDownloadStartInvoked ? 1 : 0,
    networkModelDownloads: 0,
    cachePreflight,
    localPresenterPreviewInferenceCalls: 1,
    project: {
      id: tutorial.identity.projectId,
      directory: tutorial.identity.projectDirectory,
      title: tutorial.title,
      cleanEditorRenderPath: finalEditorExport.outputPath,
      cleanEditorRenderSha256: finalEditorExport.outputSha256,
      captionsPreservedInProject: tutorial.captionsPreservedInProject,
    },
    soulx,
    managedPackageActivation: activation,
    modelEvidence,
    presenter,
    music,
    finalEditorExport,
    capture,
    captureHook: {
      projectTitle: tutorial.title,
      cleanEditorRenderPath: finalEditorExport.outputPath,
      nativeProjectId: tutorial.identity.projectId,
      nativeProjectDirectory: tutorial.identity.projectDirectory,
      requiredViews: ["Review", "Studio advanced editor", "Plan presenters", "Models & providers", "Export"],
      note: "Pass this receipt and the validated final asset manifest to buildMarketingNativeCaptureTimeline. It is not a recorded or published final by itself.",
    },
  };
}

async function activateSoulxThroughModelsUi({ page, invokeNativeWithoutInput, runRoot, cachePreflight, actionTimeoutMs, jobTimeoutMs }) {
  await clickGlobalNavigation(page, "Models & providers");
  await expect(page.getByRole("heading", { name: "Models & providers", exact: true })).toBeVisible({ timeout: actionTimeoutMs });
  const catalog = await invokeNativeWithoutInput(page, "local_model_download_catalog");
  const initialStatuses = await invokeNativeWithoutInput(page, "local_model_download_status");
  const { packageEntry, status: initial, requiresNativeDownloadStart, startMode } = assertSoulxManagedStart({
    catalog,
    statuses: initialStatuses,
    cachePreflight,
  });
  const card = page.locator(".aly-catalog-card").filter({ has: page.getByRole("heading", { name: soulxModelContract.uiHeading, exact: true }) });
  await expect(card).toBeVisible({ timeout: actionTimeoutMs });
  const managedAction = card.locator(".aly-catalog-card__actions button").first();
  let failedInstallScreenshot = null;
  if (startMode === "retry-failed-install") {
    await expect(managedAction).toHaveText(/^Resume download$/iu);
    await page.getByRole("button", { name: /^Downloads(?: \(\d+ active\))?$/u }).click();
  } else {
    await expect(managedAction).toHaveText(startMode === "initial-download" ? /^Download$/iu : /Files downloaded|Installed/iu);
    await managedAction.click();
  }
  const downloads = page.getByRole("region", { name: "Model downloads" });
  await expect(downloads).toBeVisible({ timeout: actionTimeoutMs });
  const item = downloads.getByRole("article", { name: soulxModelContract.catalogDisplayName });
  if (startMode === "retry-failed-install") {
    await expect(item).toContainText("Needs attention", { timeout: actionTimeoutMs });
    failedInstallScreenshot = path.join(runRoot, "feature-00-soulx-failed-install-before-retry.png");
    await page.screenshot({ path: failedInstallScreenshot, fullPage: true });
    await item.getByRole("button", { name: "Resume download", exact: true }).click();
  }
  if (requiresNativeDownloadStart) {
    const downloadDeadline = Date.now() + jobTimeoutMs;
    let downloaded = initial;
    let nativeStartObserved = false;
    while (Date.now() < downloadDeadline) {
      const statuses = await invokeNativeWithoutInput(page, "local_model_download_status");
      downloaded = statuses.find((entry) => entry.modelId === soulxModelContract.modelId) ?? downloaded;
      nativeStartObserved ||= downloaded.phase !== initial.phase
        || (startMode === "retry-failed-install" && downloaded.updatedAt !== initial.updatedAt);
      if (nativeStartObserved && ["downloadedQuarantined", "ready", "inUse"].includes(downloaded.phase)
        && downloaded.downloadedBytes === packageEntry.totalBytes
        && downloaded.verifiedArtifacts === packageEntry.artifactCount) break;
      if (nativeStartObserved && ["failed", "corrupt", "incompatible", "cancelled"].includes(downloaded.phase)) {
        throw new Error(`SoulX cached native download/install failed: ${JSON.stringify(downloaded)}`);
      }
      await page.waitForTimeout(750);
    }
    if (!nativeStartObserved || !["downloadedQuarantined", "ready", "inUse"].includes(downloaded.phase)
      || downloaded.downloadedBytes !== packageEntry.totalBytes
      || downloaded.verifiedArtifacts !== packageEntry.artifactCount) {
      throw new Error(`Timed out waiting for native SoulX cache consumption and install: ${JSON.stringify(downloaded)}`);
    }
  }
  await expect(item).toContainText(/Files downloaded|Installed/iu, { timeout: jobTimeoutMs });
  const hydratedScreenshot = path.join(runRoot, "feature-00-soulx-hydrated-package.png");
  await page.screenshot({ path: hydratedScreenshot, fullPage: true });
  await page.getByRole("button", { name: "Minimize downloads", exact: true }).click();
  const useModel = page.getByRole("button", { name: "Use model", exact: true });
  await useModel.scrollIntoViewIfNeeded();
  await expect(useModel).toBeEnabled({ timeout: actionTimeoutMs });
  await useModel.click();
  const deadline = Date.now() + jobTimeoutMs;
  let finalStatus = initial;
  while (Date.now() < deadline) {
    const statuses = await invokeNativeWithoutInput(page, "local_model_download_status");
    finalStatus = statuses.find((entry) => entry.modelId === soulxModelContract.modelId) ?? finalStatus;
    if (readyDownloadPhases.has(finalStatus.phase) && finalStatus.activationBlocked === false
      && /^[0-9a-f]{64}$/u.test(finalStatus.installFingerprint ?? "") && finalStatus.runtimeRevision?.trim()) break;
    if (["failed", "corrupt", "incompatible", "cancelled"].includes(finalStatus.phase)) {
      throw new Error(`SoulX managed activation failed: ${JSON.stringify(finalStatus)}`);
    }
    await page.waitForTimeout(750);
  }
  if (!readyDownloadPhases.has(finalStatus.phase) || finalStatus.activationBlocked !== false
    || !/^[0-9a-f]{64}$/u.test(finalStatus.installFingerprint ?? "") || !finalStatus.runtimeRevision?.trim()) {
    throw new Error(`Timed out waiting for verified SoulX activation: ${JSON.stringify(finalStatus)}`);
  }
  await expect(page.getByRole("button", { name: "SoulX selected", exact: true })).toBeVisible({ timeout: actionTimeoutMs });
  const [statuses, setup, runtimeStatuses] = await Promise.all([
    invokeNativeWithoutInput(page, "local_model_download_status"),
    invokeNativeWithoutInput(page, "local_model_setup_get"),
    invokeNativeWithoutInput(page, "local_presenter_runtime_status"),
  ]);
  const soulx = assertSoulxNativeReadiness({ catalog, statuses, setup, runtimeStatuses });
  return {
    soulx,
    initialPhase: initial.phase,
    initialDownloadedBytes: initial.downloadedBytes,
    initialVerifiedArtifacts: initial.verifiedArtifacts,
    initialFailureDetail: startMode === "retry-failed-install" ? initial.detail : null,
    activationInvokedThroughModelsUi: true,
    modelDownloadStartInvoked: requiresNativeDownloadStart,
    modelDownloadStartMode: startMode,
    failedInstallScreenshot,
    cachePreflight,
    providerCalls: 0,
    hydratedScreenshot,
  };
}

async function renderAcceptedMusicTimeline({ page, invokeNative, identity, projectTitle, music, durationFrames, expectedDurationSeconds, ffprobePath, runRoot, actionTimeoutMs, jobTimeoutMs }) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".runtime-badge")).toContainText("Worker ready", { timeout: actionTimeoutMs });
  await openExactProject(page, projectTitle, identity, actionTimeoutMs, true);
  await page.getByRole("navigation", { name: /project workspace/iu }).getByRole("button", { name: /^Studio$/iu }).click();
  await page.getByRole("button", { name: /^Edit tracks & timing$/iu }).click();
  const editor = page.getByRole("dialog", { name: "Integrated advanced video editor" });
  await expect(editor).toBeVisible({ timeout: actionTimeoutMs });
  await setEditorPlayhead(editor, 0);
  await editor.getByRole("button", { name: "Music", exact: true }).click();
  await editor.getByRole("button", { name: "Media", exact: true }).click();
  const card = editor.getByRole("listitem").filter({ hasText: music.title });
  await expect(card).toContainText("ready", { timeout: actionTimeoutMs });
  const place = card.getByRole("button", { name: new RegExp(`^Place ${escapeRegExp(music.title)} at playhead$`, "u") });
  await place.click();
  const clip = editor.locator(".aly-editor-clip--music").filter({ hasText: music.title });
  await expect(clip).toBeVisible({ timeout: actionTimeoutMs });
  await clip.click();
  await editor.getByRole("button", { name: "Inspector", exact: true }).click();
  await setEditorNumber(editor, "End frame", durationFrames);
  await setEditorNumber(editor, "Volume dB", -18);
  await editor.getByRole("button", { name: "Render timeline", exact: true }).click();
  const statusText = await waitForEditorRender(editor.locator(".aly-editor-shell__status"), jobTimeoutMs);
  const outputPath = statusText.match(/^Timeline rendered to (.+?)(?: ·|$)/u)?.[1];
  if (!outputPath) throw new Error(`Music-backed native editor export failed: ${statusText}`);
  const probe = await probeMedia(ffprobePath, outputPath);
  if (!probe.video || !probe.audio || Math.abs(probe.durationSeconds - expectedDurationSeconds) > 0.12) {
    throw new Error(`Music-backed native editor export has invalid streams or duration: ${JSON.stringify(probe)}`);
  }
  const saved = await invokeNative(page, "project_snapshot_get", identity);
  const musicClips = saved.snapshot?.editorDocument?.tracks?.find((track) => track.kind === "music")?.clips ?? [];
  const persisted = musicClips.find((entry) => entry.name === music.title);
  if (!persisted || persisted.timelineRange?.startFrame !== 0 || persisted.timelineRange?.durationFrames !== durationFrames
    || persisted.audio?.muted || persisted.audio?.volumeDb !== -18) {
    throw new Error("The accepted music did not persist as the exact audible full-timeline editor clip");
  }
  const screenshot = path.join(runRoot, "feature-05-music-track-exported.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await editor.getByRole("button", { name: /Return to scene/iu }).click();
  await expect(editor).toBeHidden({ timeout: actionTimeoutMs });
  await page.getByRole("navigation", { name: /project workspace/iu }).getByRole("button", { name: /^Review$/iu }).click();
  await expect(page.getByLabel("Authoritative generated tutorial media")).toBeVisible({ timeout: actionTimeoutMs });
  return {
    operation: "editor_timeline_export",
    acceptedMusicCandidateId: music.candidateId,
    outputPath,
    outputSha256: await sha256File(outputPath),
    probe,
    musicClip: { id: persisted.id, assetId: persisted.assetId, startFrame: 0, durationFrames, volumeDb: -18 },
    screenshot,
  };
}

export async function recordNativeMarketingCapture({ page, cdpPort, gifsmithRoot, runRoot, edit, projectTitle, recordingWindow, preflight }) {
  if (!preflight?.validated || recordingWindow?.win32?.contained !== true || recordingWindow.win32?.selectedMonitor?.primary !== false) {
    throw new Error("Marketing capture requires preflighted Gifsmith and a contained secondary-monitor native window");
  }
  const entrypoint = path.join(path.resolve(gifsmithRoot), "dist", "index.js");
  const api = await import(pathToFileURL(entrypoint).href);
  for (const name of ["assertConfig", "render", "timeline", "tauri"]) if (typeof api[name] !== "function") throw new Error(`Gifsmith is missing ${name}`);
  const state = {};
  const timeline = buildMarketingNativeCaptureTimeline({ timeline: api.timeline, edit, projectTitle, state });
  const output = path.join(runRoot, "native-marketing-product-capture.mp4");
  const config = {
    target: api.tauri({ port: cdpPort }),
    out: output,
    format: "mp4",
    viewport: recordingWindow.captureViewport,
    capture: "screencast",
    compose: "overlay",
    loop: "none",
    review: true,
    timeline,
    encode: { width: 1440, fps: 25, speed: 1, colors: 160, mp4Crf: 18 },
    logLevel: "info",
  };
  api.assertConfig(config);
  const result = await api.render(config);
  const mp4 = result?.outputs?.find((entry) => entry.format === "mp4" || /\.mp4$/iu.test(entry.path ?? ""));
  if (!mp4?.path || !Number.isFinite(result.durationSeconds) || result.durationSeconds <= 0 || !Number.isSafeInteger(result.sourceFrames) || result.sourceFrames <= 0) {
    throw new Error(`Gifsmith returned an invalid native marketing capture: ${JSON.stringify(result)}`);
  }
  const details = await stat(mp4.path);
  if (!details.isFile() || details.size <= 0) throw new Error("Gifsmith native marketing capture is empty");
  return {
    actualNativeWebView: true,
    outputPath: mp4.path,
    outputSha256: await sha256File(mp4.path),
    outputBytes: details.size,
    durationSeconds: result.durationSeconds,
    sourceFrames: result.sourceFrames,
    pacedFrames: result.pacedFrames,
    achievedCaptureFps: result.achievedCaptureFps,
    review: result.review,
    warnings: result.warnings,
    window: recordingWindow,
    state,
  };
}

async function preflightMarketingCapture({ gifsmithRoot, edit, projectTitle }) {
  if (!gifsmithRoot) throw new Error("--record-marketing-demo requires --gifsmith-root");
  const entrypoint = path.join(path.resolve(gifsmithRoot), "dist", "index.js");
  const details = await stat(entrypoint);
  if (!details.isFile() || details.size <= 0) throw new Error("Built Gifsmith entrypoint is missing");
  const api = await import(pathToFileURL(entrypoint).href);
  for (const name of ["assertConfig", "render", "timeline", "tauri"]) if (typeof api[name] !== "function") throw new Error(`Gifsmith is missing ${name}`);
  const compiled = buildMarketingNativeCaptureTimeline({ timeline: api.timeline, edit, projectTitle, state: {} });
  const config = {
    target: api.tauri({ port: 65_535 }), out: path.join(path.resolve(gifsmithRoot), ".alystria-marketing-preflight.mp4"), format: "mp4",
    viewport: { width: 1920, height: 1080 }, capture: "screencast", compose: "overlay", loop: "none", review: true,
    timeline: compiled, encode: { width: 1440, fps: 25, speed: 1, colors: 160, mp4Crf: 18 }, logLevel: "info",
  };
  api.assertConfig(config);
  return { validated: true, entrypoint, entrypointSha256: await sha256File(entrypoint), cueNames: compiled.cues, stepCount: compiled.steps.length };
}

async function captureSoulxModelEvidence(page, runRoot, soulx, timeout) {
  await clickGlobalNavigation(page, "Models & providers");
  await expect(page.getByRole("heading", { name: "Models & providers", exact: true })).toBeVisible({ timeout });
  const card = page.locator(".aly-catalog-card").filter({ has: page.getByRole("heading", { name: soulxModelContract.uiHeading, exact: true }) });
  await expect(card).toBeVisible({ timeout });
  await expect(card).toContainText(/installed|ready|in use/iu);
  await card.locator("summary").filter({ hasText: "Technical details" }).click();
  await expect(card.locator(".aly-catalog-card__details-body")).toBeVisible();
  const screenshot = path.join(runRoot, "feature-01-soulx-installed-selected.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.getByRole("button", { name: /^Downloads/iu }).click();
  const downloads = page.getByRole("region", { name: "Model downloads" });
  await expect(downloads).toBeVisible({ timeout });
  const item = downloads.getByRole("article", { name: soulxModelContract.catalogDisplayName });
  await expect(item).toContainText(/ready|installed|in use/iu);
  const downloadScreenshot = path.join(runRoot, "feature-02-soulx-download-receipt.png");
  await page.screenshot({ path: downloadScreenshot, fullPage: true });
  await page.getByRole("button", { name: "Minimize downloads" }).click();
  return { ...soulx, screenshot, downloadScreenshot };
}

async function exerciseCustomPresenter({ page, invokeNative, invokeNativeWithoutInput, identity, projectTitle, portraitPath, portraitSha256, displayName, runRoot, actionTimeoutMs, jobTimeoutMs }) {
  await openExactProject(page, projectTitle, identity, actionTimeoutMs, false);
  const projectNavigation = page.getByRole("navigation", { name: /project workspace/iu });
  await projectNavigation.getByRole("button", { name: /^Plan$/iu }).click();
  await page.getByRole("button", { name: /^Presenters$/u }).click();
  await expect(page.getByRole("region", { name: "Custom presenter library" })).toBeVisible({ timeout: actionTimeoutMs });
  await page.getByTitle("Import a portrait you own").click();
  await page.getByLabel("Portrait file").setInputFiles(portraitPath);
  await expect(page.getByText("Portrait loaded", { exact: true })).toBeVisible({ timeout: actionTimeoutMs });
  await page.getByLabel("Presenter name", { exact: true }).fill(displayName);
  await page.getByLabel("This is a fictional or generated character I may use and animate.", { exact: true }).check();
  await page.getByRole("button", { name: "Save to my presenters", exact: true }).click();
  const select = page.getByRole("button", { name: `Select ${displayName}`, exact: true });
  await expect(select).toBeVisible({ timeout: actionTimeoutMs });
  const imported = (await invokeNativeWithoutInput(page, "presenter_library_list")).filter((entry) => entry.displayName === displayName && entry.sha256 === portraitSha256);
  if (imported.length !== 1 || imported[0].animationReview?.status === "accepted") throw new Error("Custom presenter did not persist exactly once in preview-required state");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".runtime-badge")).toContainText("Worker ready", { timeout: actionTimeoutMs });
  await openExactProject(page, projectTitle, identity, actionTimeoutMs, true);
  await page.getByRole("navigation", { name: /project workspace/iu }).getByRole("button", { name: /^Plan$/iu }).click();
  await page.getByRole("button", { name: /^Presenters$/u }).click();
  const persistedSelect = page.getByRole("button", { name: `Select ${displayName}`, exact: true });
  await expect(persistedSelect).toBeVisible({ timeout: actionTimeoutMs });
  await persistedSelect.click();
  await page.getByRole("button", { name: "Preview animation", exact: true }).click();
  const review = page.getByRole("region", { name: `Animation preview for ${displayName}` });
  await expect(review).toBeVisible({ timeout: jobTimeoutMs });
  const video = review.getByLabel(`Play ${displayName} animation preview`);
  await expect(video).toBeVisible();
  const playback = await verifyShortPreviewPlayback(video, soulxModelContract.minimumPreviewMs, soulxModelContract.maximumPreviewMs);
  const previewScreenshot = path.join(runRoot, "feature-03-custom-presenter-preview.png");
  await page.screenshot({ path: previewScreenshot, fullPage: true });
  await review.getByRole("button", { name: "Use animation", exact: true }).click();
  await expect(review).toBeHidden({ timeout: actionTimeoutMs });
  const accepted = (await invokeNativeWithoutInput(page, "presenter_library_list")).find((entry) => entry.id === imported[0].id);
  if (accepted?.animationReview?.status !== "accepted" || accepted.animationReview.engineId !== soulxModelContract.engineId
    || accepted.animationReview.workerContractId !== soulxModelContract.workerContractId) {
    throw new Error("The exact custom portrait did not retain an accepted SoulX animation receipt");
  }
  return { entryId: accepted.id, displayName, portraitSha256, playback, previewScreenshot, animationReview: accepted.animationReview };
}

async function exerciseMusicBrowser({ page, invokeNative, identity, query, mood, runRoot, actionTimeoutMs, jobTimeoutMs }) {
  await page.getByRole("navigation", { name: /project workspace/iu }).getByRole("button", { name: /^Studio$/iu }).click();
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.getByRole("tab", { name: "Media", exact: true }).click();
  const browser = page.getByRole("region", { name: "Find background music" });
  await expect(browser).toBeVisible({ timeout: actionTimeoutMs });
  await browser.getByLabel("Tutorial topic or musical direction").fill(query);
  await browser.getByRole("button", { name: new RegExp(`^${escapeRegExp(mood)}$`, "iu") }).click();
  await browser.getByRole("button", { name: "Find free music", exact: true }).click();
  const candidates = browser.locator('[aria-label="Music candidates"]');
  await expect(candidates).toBeVisible({ timeout: jobTimeoutMs });
  const useButtons = candidates.getByRole("button", { name: /^Use /u });
  if (await useButtons.count() < 1) throw new Error("Openverse music search produced no rights-eligible downloaded candidate");
  const useName = await useButtons.first().getAttribute("aria-label");
  const title = useName?.replace(/^Use /u, "").trim();
  if (!title) throw new Error("Music candidate has no exact title");
  const preview = candidates.getByRole("button", { name: `Preview ${title}`, exact: true });
  await preview.click();
  await expect(candidates.getByRole("button", { name: `Pause ${title}`, exact: true })).toBeVisible({ timeout: actionTimeoutMs });
  await page.waitForTimeout(1_200);
  await candidates.getByRole("button", { name: `Pause ${title}`, exact: true }).click();
  await candidates.getByRole("button", { name: `Use ${title}`, exact: true }).click();
  await expect(browser.getByText(new RegExp(`${escapeRegExp(title)} is selected`, "u"))).toBeVisible({ timeout: actionTimeoutMs });
  const snapshot = await invokeNative(page, "project_snapshot_get", identity);
  const accepted = snapshot.snapshot?.musicCandidates?.find((entry) => entry.title === title && entry.status === "accepted");
  if (!accepted || !/^[0-9a-f]{64}$/u.test(accepted.artifactHash ?? "") || !accepted.sourceUrl || !accepted.licenseUrl || !accepted.attribution) {
    throw new Error("Accepted music is missing the downloaded artifact or source/license provenance");
  }
  const selected = page.getByLabel("Music bed", { exact: true });
  await expect(selected).not.toHaveValue("music-none");
  const screenshot = path.join(runRoot, "feature-04-music-preview-accepted.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  return { candidateId: accepted.id, title, artifactHash: accepted.artifactHash, license: accepted.license, sourceUrl: accepted.sourceUrl, licenseUrl: accepted.licenseUrl, attribution: accepted.attribution, screenshot };
}

async function openExactProject(page, fallbackLabel, identity, timeout, forceHome) {
  const navigation = page.getByRole("navigation", { name: /project workspace/iu });
  if (!forceHome && await navigation.isVisible()) return;
  const projects = page.getByRole("button", { name: "Projects", exact: true });
  if (await projects.isVisible()) await projects.click();
  const exact = page.locator("button.project-card").filter({ hasText: identity.projectId });
  const fallback = page.locator("button.project-card").filter({ hasText: fallbackLabel });
  const card = await exact.count() === 1 ? exact : fallback;
  await expect(card).toBeVisible({ timeout });
  await card.click();
  await expect(navigation).toBeVisible({ timeout });
}

async function verifyShortPreviewPlayback(locator, minimumMs, maximumMs) {
  return await locator.evaluate(async (video, limits) => {
    if (!(video instanceof HTMLVideoElement)) throw new Error("Presenter preview is not a video element");
    video.muted = true;
    video.preload = "auto";
    if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Presenter preview did not become playable")), 15_000);
      video.addEventListener("canplay", () => { window.clearTimeout(timer); resolve(); }, { once: true });
      video.load();
    });
    const durationMs = Math.round(video.duration * 1000);
    if (durationMs < limits.minimumMs || durationMs > limits.maximumMs) throw new Error(`Presenter preview duration ${durationMs}ms is outside the reviewed bound`);
    const start = video.currentTime;
    await video.play();
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    const advancedSeconds = video.currentTime - start;
    video.pause();
    if (advancedSeconds < 0.2) throw new Error("Presenter preview did not advance during actual playback");
    return { durationMs, advancedSeconds, videoWidth: video.videoWidth, videoHeight: video.videoHeight, readyState: video.readyState };
  }, { minimumMs, maximumMs });
}

async function setEditorPlayhead(editor, frame) {
  const seconds = Math.floor(frame / marketingFrameRate);
  const remainder = frame % marketingFrameRate;
  const control = editor.getByLabel("Playhead timecode", { exact: true });
  await control.fill(`00:00:${String(seconds).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`);
  await control.press("Enter");
}

async function setEditorNumber(editor, label, value) {
  const control = editor.getByLabel(label, { exact: true });
  await control.fill(String(value));
  await control.press("Enter");
  await expect(control).toHaveValue(String(value));
}

async function waitForEditorRender(status, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = (await status.innerText()).trim();
    if (value.startsWith("Timeline rendered to ") || (value && value !== "Rendering the edited timeline…")) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the music-backed editor export");
}

async function probeMedia(ffprobePath, file) {
  const { stdout } = await execFileAsync(ffprobePath, ["-v", "error", "-show_entries", "format=duration:stream=index,codec_type,codec_name,width,height,pix_fmt,sample_rate,channels,r_frame_rate", "-of", "json", file], { windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  return {
    durationSeconds: Number(parsed.format?.duration),
    video: parsed.streams?.find((stream) => stream.codec_type === "video") ?? null,
    audio: parsed.streams?.find((stream) => stream.codec_type === "audio") ?? null,
  };
}

async function inspectPortrait(file, expectedSha256) {
  const resolved = path.resolve(file);
  const details = await stat(resolved);
  if (!details.isFile() || details.size <= 0 || details.size > 24 * 1024 * 1024) throw new Error("Custom portrait must be a non-empty image no larger than 24 MiB");
  if (!/\.(?:png|jpe?g|webp)$/iu.test(resolved)) throw new Error("Custom portrait must be PNG, JPEG, or WebP");
  if (!/^[0-9a-f]{64}$/u.test(expectedSha256 ?? "")) throw new Error("--custom-portrait-sha256 must pin the reviewed portrait bytes");
  const sha256 = await sha256File(resolved);
  if (sha256 !== expectedSha256) throw new Error("Custom portrait hash does not match the reviewed input");
  return { path: resolved, sha256, byteSize: details.size };
}

function normalizeSoulxArtifact(artifact, index) {
  const relativePath = artifact?.relativePath;
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\\")
    || path.isAbsolute(relativePath) || relativePath.split("/").some((part) => !part || part === "." || part === "..")
    || !Number.isSafeInteger(artifact?.bytes) || artifact.bytes <= 0
    || !/^[0-9a-f]{64}$/u.test(artifact?.sha256 ?? "")) {
    throw new Error(`SoulX install manifest artifact ${index + 1} is unsafe or incomplete`);
  }
  return { relativePath, bytes: artifact.bytes, sha256: artifact.sha256 };
}

function assertContainedPath(root, candidate, label) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escaped the managed cache root`);
  }
}

async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function clickGlobalNavigation(page, label) {
  const button = page.getByRole("button", { name: label, exact: true });
  await expect(button).toBeVisible();
  await button.click();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
