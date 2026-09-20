/* global document, Event, HTMLButtonElement, HTMLDetailsElement, HTMLElement, HTMLMediaElement, HTMLSelectElement, HTMLVideoElement, localStorage, setTimeout, window */

import { expect } from "@playwright/test";
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const comparisonTitle = "Presenter style comparison";
const presenterDemoPhrase = "Watch your ideas become clear, engaging lessons.";
const walkthroughVideoFramesPerSecond = 25;
const minimumWalkthroughCaptureFramesPerSecond = 24;
const expectedVoiceoverManifestSha256 = "62f87c0d3305e8f8786c9f0bbfd3dc41432271e0824a32e29b63073d017504b2";
const expectedVoiceoverSegmentIds = Object.freeze(["home", "projects", "models", "library", "presenters", "artwork", "editor", "comparison", "outro"]);
const comparisonPresenterTransform = Object.freeze({ x: 0, y: -24, scaleX: 0.89, scaleY: 0.89, rotation: 0 });
const comparisonFilmedTailNavigationSeconds = 0.08;
const comparisonTailGuardSeconds = 0.12;
const expectedPresenters = Object.freeze([
  { slug: "emma", label: "Emma · realistic", modelId: "liveportrait-musetalk-1.5", profileId: "presenter-portrait.casual-realistic-emma-v1", portraitSha256: "27ac749dc0b30c2676d327e2a14fd05f873aee401d4b97bdd684eaab7c42a7f7", audioSha256: "664c0770b2cb463bc5585bb56942fa1caec058482d826d9d5f287bd590384fd3", videoSha256: "80eb90ca696e5be9ed644691114b5d109aad8e3b16dcdfaa797edb96bee8bb6c", width: 1254, height: 1254 },
  { slug: "yuki", label: "Yuki · anime", modelId: "joyvasa-human", profileId: "presenter-portrait.casual-anime-yuki-v1", portraitSha256: "54f695769e64273cc3a6e7f12742df8b8bfb7b6e844f302daabbf270e6a3aebb", audioSha256: "664c0770b2cb463bc5585bb56942fa1caec058482d826d9d5f287bd590384fd3", videoSha256: "2288cf9a0f4b80722a6e9d61b71ccf01d402639ba47c5316f64f4a39754b4a02", width: 512, height: 512 },
  { slug: "noah", label: "Noah · realistic", modelId: "liveportrait-musetalk-1.5", profileId: "presenter-portrait.casual-realistic-noah-v1", portraitSha256: "6f83257ec713c8d0df42ebb1506b9be32735bec9934aa5c2e946e24cbed8c0bd", audioSha256: "545b8ebfaf3ae50f4768560ea237b78b2a049da256551a2598bb9d15f595361e", videoSha256: "d39f8f2c8cd4d189a9e1a448e45460850a0aa309ed2b8df80207c23a12df672e", width: 1254, height: 1254 },
  { slug: "chloe", label: "Chloe · cartoon", modelId: "joyvasa-human", profileId: "presenter-portrait.casual-cartoon-chloe-v1", portraitSha256: "4afecb9e0141a3bcb933aca577222adfa7819fd3dc49a9b437f1b1bc0f3437ca", audioSha256: "664c0770b2cb463bc5585bb56942fa1caec058482d826d9d5f287bd590384fd3", videoSha256: "7b40e4f9d9453dd2686eb0bbad1ba67c13dbf30785082fe7eaf0e36a1c38d349", width: 512, height: 512 },
]);
const expectedGalleryPresenters = Object.freeze([
  { id: "presenter-portrait.casual-realistic-emma-v1", label: "Emma · casual home-studio tutor", hash: "27ac749dc0b30c2676d327e2a14fd05f873aee401d4b97bdd684eaab7c42a7f7", runtimeModel: "liveportrait-musetalk-1.5", animationState: "ready" },
  { id: "presenter-portrait.casual-anime-yuki-v1", label: "Yuki · casual anime coding tutor", hash: "54f695769e64273cc3a6e7f12742df8b8bfb7b6e844f302daabbf270e6a3aebb", runtimeModel: "joyvasa-human", animationState: "ready" },
  { id: "presenter-portrait.casual-realistic-noah-v1", label: "Noah · casual maker tutor", hash: "6f83257ec713c8d0df42ebb1506b9be32735bec9934aa5c2e946e24cbed8c0bd", runtimeModel: "liveportrait-musetalk-1.5", animationState: "ready" },
  { id: "presenter-portrait.casual-cartoon-chloe-v1", label: "Chloe · cartoon science creator", hash: "4afecb9e0141a3bcb933aca577222adfa7819fd3dc49a9b437f1b1bc0f3437ca", runtimeModel: "joyvasa-human", animationState: "ready" },
  { id: "presenter-portrait.casual-realistic-maya-v1", label: "Maya · casual science tutor", hash: "62ee0fd94a0e92114e000e89a6420e9ce0c7726e5b4b8ec2165c041f2252e79b", runtimeModel: "liveportrait-musetalk-1.5", animationState: "ready" },
  { id: "presenter-portrait.casual-anime-finn-v2", label: "Finn · retro anime maker tutor", hash: "74d2677cf5666de2bf2702da0ea24703d636dbcc121fa28735e20bfde86e43a1", runtimeModel: "joyvasa-human", animationState: "ready" },
  { id: "presenter-portrait.casual-anime-lena-v1", label: "Lena · hand-painted anime nature tutor", hash: "280c530e69c08737698c0fff8b0a582ac76fb9799cf0ad6a780d540c68f667f1", runtimeModel: "joyvasa-human", animationState: "ready" },
  { id: "presenter-portrait.casual-cartoon-robot-pip-v1", label: "Pip · cartoon robot tutor", hash: "b0163d6e3250d345c97e1c261fa3ff69cf0dcab70f248cad27a06dfe5e818d29", runtimeModel: "joyvasa-animal", animationState: "ready" },
  { id: "presenter-portrait.animal-cat-milo-v1", label: "Milo · cat science tutor", hash: "f47095f9b54b54d53fecfa49a93241544869aa359d8ce3273b38a8575965bafd", runtimeModel: "joyvasa-animal", animationState: "ready", animal: true },
  { id: "presenter-portrait.animal-kitten-peaches-v1", label: "Peaches · clay kitten tutor", hash: "6cb3c5727c422ac6e717f64c8c345abb757f65c5399555e5c0058f7db3524ab1", runtimeModel: "joyvasa-animal", animationState: "ready", animal: true },
  { id: "presenter-portrait.animal-dog-buddy-v1", label: "Buddy · dog workshop tutor", hash: "68fa5cd79ebb50e9b0a5b00d2c28d2d636bee695f0b579f1a36afaa62aa25062", runtimeModel: "joyvasa-animal", animationState: "ready", animal: true },
  { id: "presenter-portrait.animal-puppy-poppy-v1", label: "Poppy · storybook puppy tutor", hash: "704dce7be0612822ff0dc10ebfce8627cd808e63a0b3e158fa070fe19f8d633a", runtimeModel: "joyvasa-animal", animationState: "incompatible", animal: true },
  { id: "presenter-portrait.animal-tiger-tavi-v1", label: "Tavi · tiger science tutor", hash: "e8fb1f4d917377a68d379ffd734463f97b20ef2238b7f9d32fff389c86000ae5", runtimeModel: "joyvasa-animal", animationState: "ready", animal: true },
  { id: "presenter-portrait.animal-lion-leo-v1", label: "Leo · clay lion tutor", hash: "7694fb148894a41dcf4df55182bd803946a3d18f9a7a81daaf3cb3987411894e", runtimeModel: "joyvasa-animal", animationState: "incompatible", animal: true },
]);
const expectedGalleryContract = Object.freeze({
  total: expectedGalleryPresenters.length,
  animals: expectedGalleryPresenters.filter((presenter) => presenter.animal).length,
  animationReady: expectedGalleryPresenters.filter((presenter) => presenter.animationState === "ready").length,
  staticOnly: expectedGalleryPresenters.filter((presenter) => presenter.animationState === "incompatible").length,
  exactJoyRoutes: expectedGalleryPresenters.filter((presenter) => presenter.runtimeModel.startsWith("joyvasa-")).length,
});
if (expectedGalleryContract.total !== 14 || expectedGalleryContract.animals !== 6
  || expectedGalleryContract.animationReady !== 12 || expectedGalleryContract.staticOnly !== 2
  || expectedGalleryContract.exactJoyRoutes !== 11) {
  throw new Error(`Presenter walkthrough source contract drifted: ${JSON.stringify(expectedGalleryContract)}`);
}

export async function inspectPackagedPresenterPlatform({ starterManifestPath, runtimeStatuses }) {
  await assertRegularFile(starterManifestPath, "packaged starter visual manifest");
  const manifest = JSON.parse(await readFile(starterManifestPath, "utf8"));
  if (!Array.isArray(manifest.assets)) throw new Error("Packaged starter visual manifest has no asset catalog");
  const readyVisuals = manifest.assets.filter((asset) => (
    asset?.source?.availability === "ready"
    && typeof asset?.technical?.mediaType === "string"
    && asset.technical.mediaType.startsWith("image/")
  ));
  const readyPortraits = readyVisuals.filter((asset) => asset?.kind === "presenter-portrait");
  if (readyVisuals.length !== 57 || readyPortraits.length !== 54) {
    throw new Error(`Packaged starter visual manifest has ${readyVisuals.length} ready images and ${readyPortraits.length} ready portraits instead of 57 and 54`);
  }
  const catalog = expectedGalleryPresenters.map((expected) => {
    const matches = manifest.assets.filter((asset) => asset?.id === expected.id);
    const asset = matches[0];
    if (matches.length !== 1 || asset.kind !== "presenter-portrait" || asset.name !== expected.label
      || asset.source?.availability !== "ready" || asset.source?.delivery !== "bundled-file"
      || asset.source?.contentHash !== expected.hash || asset.technical?.mediaType !== "image/png"
      || asset.technical?.dimensions?.width !== 1254 || asset.technical?.dimensions?.height !== 1254) {
      throw new Error(`Packaged starter manifest does not contain the exact ready presenter ${expected.id}`);
    }
    return { id: asset.id, label: asset.name, sha256: asset.source.contentHash, mediaType: asset.technical.mediaType, animationState: expected.animationState };
  });

  if (!Array.isArray(runtimeStatuses)) throw new Error("Native presenter runtime status did not return an array");
  const primary = runtimeStatuses.filter((status) => status?.portraitArtifactHash === null);
  const overrides = runtimeStatuses.filter((status) => typeof status?.portraitArtifactHash === "string");
  if (runtimeStatuses.length !== 12 || primary.length !== 1 || overrides.length !== 11
    || primary[0].configured !== true || primary[0].modelId !== "liveportrait-musetalk-1.5") {
    throw new Error(`Native presenter runtime status does not contain one configured MuseTalk primary and eleven exact overrides: ${JSON.stringify(runtimeStatuses)}`);
  }
  const expectedOverrides = expectedGalleryPresenters.filter((presenter) => presenter.runtimeModel.startsWith("joyvasa-"));
  const routes = expectedOverrides.map((expected) => {
    const matches = overrides.filter((status) => status.portraitArtifactHash === expected.hash);
    const status = matches[0];
    if (matches.length !== 1 || status.configured !== true || status.modelId !== expected.runtimeModel
      || !isDigest(status.installFingerprint) || typeof status.modelRevision !== "string" || !status.modelRevision.trim()) {
      throw new Error(`Native presenter runtime status is not configured for ${expected.id}`);
    }
    return {
      presenterId: expected.id,
      portraitArtifactHash: status.portraitArtifactHash,
      modelId: status.modelId,
      modelRevision: status.modelRevision,
      installFingerprint: status.installFingerprint,
      animationState: expected.animationState,
    };
  });
  if (!isDigest(primary[0].installFingerprint) || typeof primary[0].modelRevision !== "string" || !primary[0].modelRevision.trim()) {
    throw new Error("Native primary presenter runtime has no pinned installation identity");
  }
  return {
    starterManifestPath,
    starterManifestSha256: await sha256File(starterManifestPath),
    readyVisualCount: readyVisuals.length,
    readyPortraitCount: readyPortraits.length,
    casualAndAnimalPresenterCount: catalog.length,
    animationReadyPresenterCount: catalog.filter((presenter) => presenter.animationState === "ready").length,
    staticOnlyPresenterCount: catalog.filter((presenter) => presenter.animationState === "incompatible").length,
    catalog,
    runtimeStatusCount: runtimeStatuses.length,
    primaryRuntime: {
      modelId: primary[0].modelId,
      modelRevision: primary[0].modelRevision,
      installFingerprint: primary[0].installFingerprint,
    },
    exactJoyRoutes: routes,
  };
}

export async function inspectPresenterAcceptance({ roots, ffmpegPath, ffprobePath }) {
  const reports = [];
  const clips = [];
  const engines = new Map();
  for (const expected of expectedPresenters) {
    const root = path.resolve(roots?.[expected.slug] ?? "");
    const reportPath = path.join(root, "probe-report.json");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const result = report.results?.[0];
    const videoPath = path.join(root, "clips", `${expected.slug}.mp4`);
    const details = await assertRegularFile(videoPath, `${expected.slug} presenter clip`);
    const audioDetails = await assertRegularFile(report.audioSource, `${expected.slug} presenter narration`);
    const probe = await probeMedia(ffprobePath, videoPath);
    const backgroundStability = await measurePresenterBackgroundStability(ffmpegPath, videoPath);
    if (report.schemaVersion !== 1 || report.status !== "complete" || report.audioSha256 !== expected.audioSha256
      || !isDigest(report.baseConfigSha256) || typeof report.audioSource !== "string" || !report.audioSource
      || !Array.isArray(report.results) || report.results.length !== 1
      || !result || result.slug !== expected.slug || result.status !== "complete" || result.profileId !== expected.profileId
      || result.videoSha256 !== expected.videoSha256 || await sha256File(videoPath) !== expected.videoSha256
      || result.portraitSha256 !== expected.portraitSha256 || result.metadata?.portraitArtifactHash !== expected.portraitSha256
      || result.metadata?.narrationArtifactHash !== expected.audioSha256 || await sha256File(report.audioSource) !== expected.audioSha256
      || result.metadata?.modelId !== expected.modelId
      || result.metadata?.presenterProfileId !== expected.profileId
      || result.metadata?.outputSha256 !== expected.videoSha256
      || result.metadata?.provider !== "local-presenter"
      || result.metadata?.localOnly !== true
      || result.metadata?.probe?.verified !== true
      || typeof result.metadata?.modelRevision !== "string" || !result.metadata.modelRevision
      || Math.abs(probe.durationSeconds - Number(result.metadata.probe.durationSeconds)) > 0.04
      || probe.video?.codec_name !== "h264" || probe.video.width !== expected.width || probe.video.height !== expected.height
      || probe.video.r_frame_rate !== "25/1"
      || probe.audio?.codec_name !== "aac") {
      throw new Error(`Presenter comparison source ${expected.slug} does not match its reviewed real lip-sync receipt`);
    }
    if (backgroundStability.backgroundCornerP95Mad > 0.5 || backgroundStability.backgroundCornerActivePixelsOver3Percent > 1
      || backgroundStability.nonFacialAnchorConsecutiveP95Mad > 0.5 || backgroundStability.nonFacialAnchorSourceP95Mad > 0.75
      || backgroundStability.nonFacialAnchorSourceActivePixelsOver3Percent > 2) {
      throw new Error(`Presenter comparison source ${expected.slug} moves the portrait background between frames: ${JSON.stringify(backgroundStability)}`);
    }
    const priorRevision = engines.get(expected.modelId);
    if (priorRevision && priorRevision !== result.metadata.modelRevision) throw new Error(`${expected.modelId} presenter clips do not share one pinned runtime revision`);
    engines.set(expected.modelId, result.metadata.modelRevision);
    reports.push({
      slug: expected.slug,
      path: reportPath,
      sha256: await sha256File(reportPath),
      baseConfigSha256: report.baseConfigSha256,
      audioSource: report.audioSource,
      audioSha256: report.audioSha256,
      audioBytes: audioDetails.size,
      modelId: expected.modelId,
    });
    clips.push({ ...expected, path: videoPath, bytes: details.size, probe, backgroundStability, runtimeRevision: result.metadata.modelRevision });
  }
  return {
    reports,
    audioSha256ByPresenter: Object.fromEntries(expectedPresenters.map((presenter) => [presenter.slug, presenter.audioSha256])),
    engines: [...engines].map(([modelId, runtimeRevision]) => ({ modelId, runtimeRevision })),
    clips,
    durationSeconds: deriveComparisonTiming(clips).durationSeconds,
  };
}

export async function inspectReadmeVoiceover({ manifestPath, ffprobePath }) {
  const resolvedManifestPath = path.resolve(manifestPath);
  await assertRegularFile(resolvedManifestPath, "README voiceover manifest");
  const manifestSha256 = await sha256File(resolvedManifestPath);
  if (manifestSha256 !== expectedVoiceoverManifestSha256) {
    throw new Error(`README voiceover manifest is not the reviewed receipt: ${manifestSha256}`);
  }
  const manifest = JSON.parse(await readFile(resolvedManifestPath, "utf8"));
  if (manifest?.purpose !== "Ordered chapter voiceover files for README demo recorder"
    || manifest.voice !== "Sulafat" || manifest.ttsModel !== "gemini-3.1-flash-tts-preview"
    || manifest.ttsProvider !== "google-gemini-api" || manifest.asrExactNormalizedWordMatch !== true
    || manifest.verification?.strictNormalizedWordsPassed !== true
    || !Array.isArray(manifest.orderedSegments) || manifest.orderedSegments.length !== expectedVoiceoverSegmentIds.length) {
    throw new Error("README voiceover manifest does not preserve the reviewed synthesis and ASR contract");
  }
  const manifestDirectory = path.dirname(resolvedManifestPath);
  const segments = [];
  for (let index = 0; index < expectedVoiceoverSegmentIds.length; index += 1) {
    const expectedId = expectedVoiceoverSegmentIds[index];
    const segment = manifest.orderedSegments[index];
    const wavPath = path.resolve(manifestDirectory, segment?.wavFile ?? "");
    const trimInSeconds = Number(segment?.recommendedTimelineInSeconds);
    const trimOutSeconds = Number(segment?.recommendedTimelineOutSeconds);
    const durationSeconds = Number(segment?.recommendedTimelineDurationSeconds);
    const details = await assertRegularFile(wavPath, `${expectedId} README voiceover WAV`);
    const probe = await probeMedia(ffprobePath, wavPath);
    if (segment?.order !== index + 1 || segment?.id !== expectedId || typeof segment.cue !== "string" || !segment.cue
      || segment.wavSha256 !== await sha256File(wavPath) || segment.wavBytes !== details.size
      || segment.sampleRateHz !== 24_000 || segment.channels !== 1 || segment.sampleWidthBits !== 16
      || probe.video !== null || probe.audio?.codec_name !== "pcm_s16le" || Number(probe.audio.sample_rate) !== 24_000 || probe.audio.channels !== 1
      || !Number.isFinite(trimInSeconds) || trimInSeconds < 0 || !Number.isFinite(trimOutSeconds) || trimOutSeconds <= trimInSeconds
      || trimOutSeconds > probe.durationSeconds + 0.01 || !Number.isFinite(durationSeconds)
      || Math.abs(durationSeconds - (trimOutSeconds - trimInSeconds)) > 0.001) {
      throw new Error(`README voiceover segment ${expectedId} does not match its reviewed WAV and trim receipt`);
    }
    segments.push({
      order: segment.order,
      id: segment.id,
      cue: segment.cue,
      text: segment.text,
      wavPath,
      wavSha256: segment.wavSha256,
      wavBytes: details.size,
      trimInSeconds,
      trimOutSeconds,
      durationSeconds,
      probe,
    });
  }
  return {
    manifestPath: resolvedManifestPath,
    manifestSha256,
    voice: manifest.voice,
    model: manifest.ttsModel,
    provider: manifest.ttsProvider,
    asrProvider: manifest.asrProvider,
    asrModel: manifest.asrModel,
    asrExactNormalizedWordMatch: true,
    durationsSecondsById: Object.fromEntries(segments.map((segment) => [segment.id, segment.durationSeconds])),
    segments,
  };
}

export async function copySupplementalProject({ source, projectsPath }) {
  const projectsRoot = path.resolve(projectsPath);
  const targetDirectory = path.resolve(projectsRoot, source.relativeProjectDirectory);
  const targetRelation = path.relative(projectsRoot, targetDirectory);
  if (!targetRelation || targetRelation === ".." || targetRelation.startsWith(`..${path.sep}`) || path.isAbsolute(targetRelation)) {
    throw new Error("Supplemental local-image project path escapes or aliases the isolated Projects root");
  }
  if (path.resolve(targetDirectory).toLowerCase() === path.resolve(source.sourceProjectDirectory).toLowerCase()) {
    throw new Error("Supplemental local-image project must be copied into the isolated Projects directory");
  }
  await cp(source.sourceProjectDirectory, targetDirectory, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
  });
  const databaseRelation = path.relative(source.sourceProjectDirectory, source.sourceProjectDatabasePath);
  if (!databaseRelation || databaseRelation === ".." || databaseRelation.startsWith(`..${path.sep}`) || path.isAbsolute(databaseRelation)
    || await sha256File(path.join(targetDirectory, databaseRelation)) !== source.sourceProjectDatabaseSha256) {
    throw new Error("Supplemental local-image project copy does not preserve its reviewed native database");
  }
  return targetDirectory;
}

export async function installSupplementalProject({ page, source, projectDirectory, invokeNative }) {
  const durable = await invokeNative(page, "project_snapshot_get", {
    projectId: source.projectId,
    projectDirectory,
  });
  const project = {
    ...source.sourceSnapshot,
    id: source.projectId,
    nativeProjectId: source.projectId,
    nativeProjectDirectory: projectDirectory,
    nativeHeadRevisionId: durable.headRevisionId,
    nativeRevisionNumber: durable.revisionNumber,
  };
  await page.evaluate((supplemental) => {
    const workspace = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    const projects = (workspace.projects ?? []).filter((candidate) => candidate.id !== supplemental.id);
    localStorage.setItem("alystria-studio-v2", JSON.stringify({ ...workspace, projects: [...projects, supplemental] }));
  }, project);
  return project;
}

export async function preparePresenterComparison({
  page,
  presenterAcceptance,
  projectsPath,
  invokeNative,
  actionTimeoutMs,
  jobTimeoutMs,
  ffprobePath,
  reviewScreenshotPath,
  onIdentity,
}) {
  const comparisonTiming = deriveComparisonTiming(presenterAcceptance.clips);
  const initialSnapshot = comparisonProjectDocument(comparisonTiming);
  const handle = await invokeNative(page, "project_create", {
    parentDirectory: projectsPath,
    directoryName: `presenter-style-comparison-${Date.now().toString(36)}`,
    title: comparisonTitle,
    locale: "en-US",
    groundingMode: "creative",
    initialSnapshot,
  });
  const identity = { projectId: handle.manifest.projectId, projectDirectory: handle.projectDirectory };
  onIdentity?.(identity);
  const durable = await invokeNative(page, "project_snapshot_get", identity);
  const project = {
    ...initialSnapshot,
    id: identity.projectId,
    nativeProjectId: identity.projectId,
    nativeProjectDirectory: identity.projectDirectory,
    nativeHeadRevisionId: durable.headRevisionId,
    nativeRevisionNumber: durable.revisionNumber,
  };
  await page.evaluate((created) => {
    const workspace = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    localStorage.setItem("alystria-studio-v2", JSON.stringify({
      ...workspace,
      projects: [created, ...(workspace.projects ?? []).filter((candidate) => candidate.id !== created.id)],
      recentProjectId: created.id,
      studioMode: "studio",
    }));
  }, project);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".runtime-badge")).toContainText("Worker ready", { timeout: actionTimeoutMs });
  const projectNavigation = page.getByRole("navigation", { name: /project workspace/i });
  if (!await projectNavigation.isVisible()) {
    const featured = page.locator(".continue-section");
    await expect(featured.getByRole("heading", { name: comparisonTitle, exact: true })).toBeVisible({ timeout: actionTimeoutMs });
    await featured.getByRole("button", { name: /^Open project/u }).click();
  }
  await expect(projectNavigation).toBeVisible({ timeout: actionTimeoutMs });
  await expect(page.locator(".project-switcher strong")).toHaveText(comparisonTitle);
  await projectNavigation.getByRole("button", { name: /^studio$/iu }).click();
  await page.getByRole("button", { name: /^edit tracks & timing/iu }).click();
  const editor = page.getByRole("dialog", { name: "Integrated advanced video editor" });
  await expect(editor).toBeVisible({ timeout: actionTimeoutMs });

  for (const kind of ["slides", "narration"]) {
    const clips = editor.locator(`.aly-editor-clip--${kind}`);
    while (await clips.count()) {
      await clips.first().click();
      await editor.getByRole("button", { name: "Lift", exact: true }).click();
    }
  }
  const presenterTrackButton = editor.getByRole("button", { name: "Presenter", exact: true });
  if (!await presenterTrackButton.isVisible()) {
    await editor.getByRole("button", { name: "Hide empty tracks", exact: true }).click();
    await expect(presenterTrackButton).toBeVisible();
  }
  await editor.getByLabel("Rights for new editor media").selectOption("owned");
  await editor.getByLabel("Import media files").setInputFiles(presenterAcceptance.clips.map((clip) => clip.path));
  for (const clip of presenterAcceptance.clips) {
    const card = editor.getByRole("listitem").filter({ hasText: `${clip.slug}.mp4` });
    await expect(card).toContainText("ready", { timeout: 90_000 });
  }

  for (let index = 0; index < presenterAcceptance.clips.length; index += 1) {
    const clip = presenterAcceptance.clips[index];
    const { startFrame, durationFrames } = comparisonTiming.clips[index];
    const endFrame = startFrame + durationFrames;
    await editor.getByLabel("Playhead timecode").fill(frameTimecode(startFrame));
    await editor.getByLabel("Playhead timecode").press("Enter");
    await presenterTrackButton.click();
    await editor.getByRole("button", { name: "Media", exact: true }).click();
    const card = editor.getByRole("listitem").filter({ hasText: `${clip.slug}.mp4` });
    await card.getByRole("button", { name: `Place ${clip.slug}.mp4 at playhead` }).click();
    const presenterClip = editor.locator(".aly-editor-clip--presenter").filter({ hasText: `${clip.slug}.mp4` });
    await expect(presenterClip).toBeVisible();
    await presenterClip.click();
    await editor.getByRole("button", { name: "Inspector", exact: true }).click();
    await setInspectorNumber(editor, "X", comparisonPresenterTransform.x);
    await setInspectorNumber(editor, "Y", comparisonPresenterTransform.y);
    await setInspectorNumber(editor, "Scale X", comparisonPresenterTransform.scaleX);
    await setInspectorNumber(editor, "Scale Y", comparisonPresenterTransform.scaleY);
    await editor.getByRole("button", { name: "Add title", exact: true }).click();
    await editor.getByLabel("On-screen text").fill(clip.label);
    await setInspectorNumber(editor, "End frame", endFrame);
    await editor.getByLabel("Text placement").selectOption("top");
    await editor.getByRole("button", { name: "Add caption", exact: true }).click();
    await editor.getByLabel("On-screen text").fill(presenterDemoPhrase);
    await setInspectorNumber(editor, "End frame", endFrame);
    await editor.getByLabel("Text placement").selectOption("bottom");
  }
  await expect(editor.locator(".aly-editor-clip--presenter")).toHaveCount(4);
  await expect(editor.locator(".aly-editor-clip--titles")).toHaveCount(4);
  await expect(editor.locator(".aly-editor-clip--captions")).toHaveCount(4);
  await expect.poll(() => editor.locator(".aly-editor-clip__waveform img").count(), { timeout: 90_000 }).toBeGreaterThanOrEqual(4);
  const hideEmptyTracks = editor.getByRole("button", { name: "Hide empty tracks", exact: true });
  if (await hideEmptyTracks.getAttribute("aria-pressed") !== "true") await hideEmptyTracks.click();
  await expect(editor.getByRole("button", { name: "Slides", exact: true })).toBeHidden();

  const dockSplitter = editor.getByRole("separator", { name: "Resize side panel width" });
  const timelineSplitter = editor.getByRole("separator", { name: "Resize timeline height" });
  await expect(dockSplitter).toBeVisible();
  await expect(timelineSplitter).toBeVisible();
  await editor.getByRole("button", { name: "Transcript", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "Transcript" })).toBeVisible();
  await editor.getByRole("button", { name: "Reset panel layout", exact: true }).click();
  await editor.getByRole("button", { name: "Media", exact: true }).click();

  await editor.getByRole("button", { name: "Render timeline" }).click();
  const status = editor.locator(".aly-editor-shell__status");
  const statusText = await waitForEditorRender(status, jobTimeoutMs);
  const outputPath = statusText.match(/^Timeline rendered to (.+?)(?: ·|$)/u)?.[1];
  if (!outputPath) throw new Error(`Presenter comparison editor render failed: ${statusText}`);
  const outputDetails = await assertRegularFile(outputPath, "presenter comparison export");
  const outputProbe = await probeMedia(ffprobePath, outputPath);
  if (!outputProbe.video || !outputProbe.audio || Math.abs(outputProbe.durationSeconds - comparisonTiming.durationSeconds) > 0.15) {
    throw new Error(`Presenter comparison export is not the expected audible ${comparisonTiming.durationSeconds.toFixed(3)} second video: ${JSON.stringify(outputProbe)}`);
  }
  await editor.getByRole("button", { name: /return to scene/iu }).click();
  await expect(editor).toBeHidden({ timeout: actionTimeoutMs });
  await page.waitForFunction(({ projectId, output }) => {
    const workspace = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    return workspace.jobs?.some((job) => job.projectId === projectId
      && job.operation === "editor_timeline_export"
      && job.status === "complete"
      && (job.result?.outputPath === output || job.result?.path === output));
  }, { projectId: identity.projectId, output: outputPath });
  const saved = await invokeNative(page, "project_snapshot_get", identity);
  const persisted = assertPersistedComparisonTimeline(saved.snapshot?.editorDocument, presenterAcceptance);
  await projectNavigation.getByRole("button", { name: /^review$/iu }).click();
  const reviewVideo = page.getByLabel("Authoritative generated tutorial media");
  await expect(reviewVideo).toBeVisible({ timeout: actionTimeoutMs });
  const representativeFrameSeconds = (() => {
    const finalClip = comparisonTiming.clips.at(-1);
    if (!finalClip) throw new Error("Presenter comparison has no final clip timing");
    return (finalClip.startFrame + Math.max(1, Math.floor(finalClip.durationFrames / 2))) / 30;
  })();
  const reviewFrame = await reviewVideo.evaluate(async (element, targetSeconds) => {
    if (!(element instanceof HTMLVideoElement)) throw new Error("Presenter comparison Review media is not a video");
    element.muted = true;
    element.preload = "auto";
    element.pause();
    if (element.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("Presenter comparison Review metadata timed out")), 10_000);
        element.addEventListener("loadedmetadata", () => { window.clearTimeout(timer); resolve(); }, { once: true });
      });
    }
    const seekTo = Math.max(0, Math.min(element.duration - 0.75, targetSeconds));
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Presenter comparison representative-frame seek timed out")), 10_000);
      element.addEventListener("seeked", () => { window.clearTimeout(timer); resolve(); }, { once: true });
      element.currentTime = seekTo;
    });
    if (element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      await new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("Presenter comparison representative frame never became playable")), 10_000);
        element.addEventListener("canplay", () => { window.clearTimeout(timer); resolve(); }, { once: true });
      });
    }
    let waitingEvents = 0;
    let stalledEvents = 0;
    const onWaiting = () => { waitingEvents += 1; };
    const onStalled = () => { stalledEvents += 1; };
    element.addEventListener("waiting", onWaiting);
    element.addEventListener("stalled", onStalled);
    const decodedFrame = new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Presenter comparison representative video frame did not decode during playback")), 10_000);
      element.requestVideoFrameCallback((_now, metadata) => {
        window.clearTimeout(timer);
        resolve({ mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames });
      });
    });
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Presenter comparison representative frame never entered playing state")), 10_000);
      element.addEventListener("playing", () => { window.clearTimeout(timer); resolve(); }, { once: true });
      void element.play().catch(reject);
    });
    const minimumPlaybackTime = seekTo + 0.2;
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Presenter comparison representative frame did not advance")), 10_000);
      const check = () => {
        if (element.currentTime >= minimumPlaybackTime) {
          window.clearTimeout(timer);
          resolve();
        } else {
          window.requestAnimationFrame(check);
        }
      };
      check();
    });
    element.pause();
    const frameCallback = await decodedFrame;
    element.removeEventListener("waiting", onWaiting);
    element.removeEventListener("stalled", onStalled);
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    return {
      currentTime: element.currentTime,
      duration: element.duration,
      videoWidth: element.videoWidth,
      videoHeight: element.videoHeight,
      readyState: element.readyState,
      networkState: element.networkState,
      paused: element.paused,
      seeking: element.seeking,
      decodedMediaTime: frameCallback.mediaTime,
      presentedFrames: frameCallback.presentedFrames,
      waitingEvents,
      stalledEvents,
      playbackAdvanceSeconds: element.currentTime - seekTo,
    };
  }, representativeFrameSeconds);
  if (!Number.isFinite(reviewFrame.currentTime) || Math.abs(reviewFrame.currentTime - representativeFrameSeconds) > 0.7
    || reviewFrame.videoWidth <= 0 || reviewFrame.videoHeight <= 0 || reviewFrame.readyState < 3
    || reviewFrame.seeking || !reviewFrame.paused || !Number.isFinite(reviewFrame.decodedMediaTime)
    || Math.abs(reviewFrame.decodedMediaTime - reviewFrame.currentTime) > 0.25 || reviewFrame.presentedFrames <= 0
    || reviewFrame.waitingEvents !== 0 || reviewFrame.stalledEvents !== 0 || reviewFrame.playbackAdvanceSeconds < 0.18) {
    throw new Error(`Presenter comparison representative Review frame did not play cleanly: ${JSON.stringify(reviewFrame)}`);
  }
  await page.screenshot({ path: reviewScreenshotPath, fullPage: true });
  const reviewScreenshot = await assertRegularFile(reviewScreenshotPath, "presenter comparison final Review screenshot");
  return {
    title: comparisonTitle,
    identity,
    outputPath,
    outputSha256: await sha256File(outputPath),
    outputBytes: outputDetails.size,
    outputProbe,
    durationFrames: comparisonTiming.durationFrames,
    durationSeconds: comparisonTiming.durationSeconds,
    durableHeadRevisionId: saved.headRevisionId,
    durableRevisionNumber: saved.revisionNumber,
    persistedTimeline: persisted,
    finalReviewFrame: {
      ...reviewFrame,
      screenshotPath: reviewScreenshotPath,
      screenshotSha256: await sha256File(reviewScreenshotPath),
      screenshotBytes: reviewScreenshot.size,
    },
    sourceAudioSha256ByPresenter: presenterAcceptance.audioSha256ByPresenter,
    presenterOrder: presenterAcceptance.clips.map((clip, index) => ({
      slug: clip.slug,
      label: clip.label,
      profileId: clip.profileId,
      sourceSha256: clip.videoSha256,
      startFrame: comparisonTiming.clips[index].startFrame,
      durationFrames: comparisonTiming.clips[index].durationFrames,
    })),
    builtThroughNativeEditorUi: true,
    generatedProviderCalls: 0,
    localInferenceCalls: 0,
  };
}

export async function preflightNativeWalkthroughRecording({ gifsmithRoot, comparisonDurationSeconds, voiceoverDurationsSeconds = {} }) {
  const resolvedRoot = path.resolve(gifsmithRoot);
  const entrypoint = path.join(resolvedRoot, "dist", "index.js");
  const packagePath = path.join(resolvedRoot, "package.json");
  await Promise.all([
    assertRegularFile(entrypoint, "built Gifsmith entrypoint"),
    assertRegularFile(packagePath, "Gifsmith package manifest"),
  ]);
  const api = await loadGifsmithApi(entrypoint);
  const state = createWalkthroughState();
  const compiled = buildNativeWalkthroughTimeline({
    timeline: api.timeline,
    localImageProjectTitle: "Preflight accepted artwork",
    comparisonTitle: comparisonTitle,
    comparisonDurationSeconds,
    modelsScreenshotPath: path.join(resolvedRoot, ".alystria-models-preflight.png"),
    voiceoverDurationsSeconds,
    state,
  });
  const cursorProp = api.props.cursor({ start: { x: 112, y: 96 } });
  const config = {
    target: api.tauri({ port: 65_535 }),
    out: path.join(resolvedRoot, ".alystria-walkthrough-preflight.mp4"),
    format: "mp4",
    viewport: { width: 1920, height: 1080 },
    capture: "screencast",
    compose: "overlay",
    props: [cursorProp],
    loop: "none",
    review: true,
    timeline: compiled,
    encode: { width: 1440, fps: walkthroughVideoFramesPerSecond, speed: 1, colors: 160, mp4Crf: 18 },
    logLevel: "info",
  };
  api.assertConfig(config);
  const kinds = countTimelineKinds(compiled.steps);
  const plannedSeconds = api.estimateSeconds(compiled.steps);
  const requiredCues = ["Home", "Models and downloads", "Fourteen casual and animal presenters", "Presenter comparison editor", "Presenter style comparison"];
  if (kinds.drag !== 2 || kinds.scroll !== 1 || kinds.call < 10
    || plannedSeconds < 90 || plannedSeconds > 150
    || requiredCues.some((cue) => !compiled.cues.includes(cue))
    || cursorProp?.id !== "cursor" || cursorProp?.layer !== "front") {
    throw new Error(`Gifsmith walkthrough timeline preflight failed: ${JSON.stringify({ kinds, plannedSeconds, cues: compiled.cues, cursorProp: { id: cursorProp?.id, layer: cursorProp?.layer } })}`);
  }
  const packageManifest = JSON.parse(await readFile(packagePath, "utf8"));
  return {
    validated: true,
    packageName: packageManifest.name,
    packageVersion: packageManifest.version,
    entrypoint,
    entrypointSha256: await sha256File(entrypoint),
    plannedSeconds,
    stepKinds: kinds,
    cues: compiled.cues,
    outputContract: ["outputs", "sourceFrames", "pacedFrames", "achievedCaptureFps", "durationSeconds", "review", "warnings"],
  };
}

async function setInspectorNumber(editor, label, value) {
  const control = editor.getByLabel(label, { exact: true });
  await control.fill(String(value));
  await control.press("Enter");
  await expect(control).toHaveValue(String(value));
}

export async function prepareNativeRecordingWindow({ page, desktopPid }) {
  return showRecordingWindow(page, desktopPid);
}

export async function recordNativeWalkthrough({
  page,
  cdpPort,
  gifsmithRoot,
  runRoot,
  ffmpegPath,
  ffprobePath,
  localImageProjectTitle,
  comparison,
  presenterPlatform,
  recordingWindow,
  preflight,
  voiceover,
}) {
  if (presenterPlatform?.readyVisualCount !== 57 || presenterPlatform?.readyPortraitCount !== 54
    || presenterPlatform?.casualAndAnimalPresenterCount !== expectedGalleryContract.total
    || presenterPlatform?.animationReadyPresenterCount !== expectedGalleryContract.animationReady
    || presenterPlatform?.staticOnlyPresenterCount !== expectedGalleryContract.staticOnly
    || presenterPlatform?.runtimeStatusCount !== 12 || presenterPlatform?.exactJoyRoutes?.length !== expectedGalleryContract.exactJoyRoutes) {
    throw new Error("Presenter platform evidence was not validated before native walkthrough capture");
  }
  if (!voiceover || !Array.isArray(voiceover.segments) || voiceover.segments.length !== expectedVoiceoverSegmentIds.length) {
    throw new Error("Reviewed public README voiceover evidence was not validated before native walkthrough capture");
  }
  if (!recordingWindow || !Number.isSafeInteger(recordingWindow.captureViewport?.width)
    || !Number.isSafeInteger(recordingWindow.captureViewport?.height)
    || recordingWindow.win32?.contained !== true || recordingWindow.win32?.selectedMonitor?.primary !== false) {
    throw new Error("Native recording window was not prepared before comparison export");
  }
  await navigateGlobal(page, "Home");
  const gifsmithEntry = path.join(path.resolve(gifsmithRoot), "dist", "index.js");
  await assertRegularFile(gifsmithEntry, "built Gifsmith entrypoint");
  const { assertConfig, props, render, timeline, tauri } = await loadGifsmithApi(gifsmithEntry);
  if (!preflight?.validated || preflight.entrypointSha256 !== await sha256File(gifsmithEntry)) {
    throw new Error("Gifsmith recording was not preflighted against the current built entrypoint");
  }
  const silentPath = path.join(runRoot, "alystria-native-walkthrough.silent.mp4");
  const modelsScreenshotPath = path.join(runRoot, "07-models-and-providers.png");
  const walkthroughState = createWalkthroughState();
  const walkthrough = buildNativeWalkthroughTimeline({
    timeline,
    localImageProjectTitle,
    comparisonTitle: comparison.title,
    comparisonDurationSeconds: comparison.durationSeconds,
    modelsScreenshotPath,
    voiceoverDurationsSeconds: voiceover?.durationsSecondsById ?? {},
    state: walkthroughState,
  });
  const renderConfig = {
    target: tauri({ port: cdpPort }),
    out: silentPath,
    format: "mp4",
    viewport: recordingWindow.captureViewport,
    capture: "screencast",
    compose: "overlay",
    props: [props.cursor({ start: { x: 112, y: 96 } })],
    loop: "none",
    review: true,
    timeline: walkthrough,
    encode: { width: 1440, fps: walkthroughVideoFramesPerSecond, speed: 1, colors: 160, mp4Crf: 18 },
    logLevel: "info",
  };
  assertConfig(renderConfig);
  const result = await render(renderConfig);
  assertGifsmithResult(result);
  const silentOutput = result.outputs.find((output) => output.format === "mp4")?.path ?? silentPath;
  const captureReceiptPath = path.join(runRoot, "walkthrough-capture-receipt.json");
  await writeFile(captureReceiptPath, `${JSON.stringify({
    schemaVersion: 1,
    state: "capture-complete",
    evidenceClass: "actual-native-gifsmith-screencast-before-post-capture-assertions-and-audio-postprocess",
    createdAtUtc: new Date().toISOString(),
    silentOutput,
    silentOutputSha256: await sha256File(silentOutput),
    recordingWindow,
    audioCueTimingBasis: "monotonic real elapsed time from the first recorded cue; provisional until encoded-frame visual acceptance",
    audioVisualQualification: "pending encoded-frame visual acceptance; Gifsmith does not expose an absolute screencast-start timestamp",
    comparisonPlaybackOffsetMs: walkthroughState.comparisonPlaybackOffsetMs,
    comparisonPlayingEventMediaTime: walkthroughState.comparisonPlayingEventMediaTime,
    comparisonPlaybackEvidence: walkthroughState.comparisonPlaybackEvidence,
    voiceoverCueOffsetsMs: walkthroughState.voiceoverCueOffsetsMs,
    presenterGalleryEvidence: walkthroughState.presenterGalleryEvidence,
    modelsCardEvidence: walkthroughState.modelsCardEvidence,
    editorResizeEvidence: { before: walkthroughState.editorLayoutBefore, after: walkthroughState.editorLayoutAfter },
    gifsmith: {
      sourceFrames: result.sourceFrames,
      pacedFrames: result.pacedFrames,
      achievedCaptureFps: result.achievedCaptureFps,
      durationSeconds: result.durationSeconds,
      review: result.review ?? null,
      warnings: result.warnings,
    },
  }, null, 2)}\n`, "utf8");
  const expandedModelsEvidence = await captureExpandedNativeModelDetails({
    page,
    screenshotPath: path.join(runRoot, "08-model-local-technical-details.png"),
  });
  const naturalEndedReviewEvidence = await captureNaturalEndedReviewEvidence({
    page,
    comparisonTitle: comparison.title,
    expectedDurationSeconds: comparison.durationSeconds,
    screenshotPath: path.join(runRoot, "09-comparison-natural-ended.png"),
  });
  if (!Number.isFinite(walkthroughState.comparisonPlaybackOffsetMs) || walkthroughState.comparisonPlaybackOffsetMs <= 0
    || !Number.isFinite(walkthroughState.comparisonPlayingEventMediaTime) || walkthroughState.comparisonPlayingEventMediaTime < 0 || walkthroughState.comparisonPlayingEventMediaTime > 0.08) {
    throw new Error("Gifsmith recording did not observe the comparison Review playing event");
  }
  if (!walkthroughState.comparisonPlaybackEvidence || walkthroughState.comparisonPlaybackEvidence.waitingEvents !== 0
    || walkthroughState.comparisonPlaybackEvidence.stalledEvents !== 0
    || walkthroughState.comparisonPlaybackEvidence.readyState < 3
    || walkthroughState.comparisonPlaybackEvidence.currentTime < comparison.durationSeconds - 0.25) {
    throw new Error(`Gifsmith recording observed buffered or incomplete comparison playback: ${JSON.stringify(walkthroughState.comparisonPlaybackEvidence)}`);
  }
  if (!walkthroughState.editorLayoutBefore || !walkthroughState.editorLayoutAfter) throw new Error("Gifsmith recording did not verify the editor panel resizes");
  if (!walkthroughState.presenterGalleryEvidence?.allStyles || !walkthroughState.presenterGalleryEvidence?.animals) {
    throw new Error("Gifsmith recording did not verify the actual casual and animal presenter gallery");
  }
  const galleryCards = walkthroughState.presenterGalleryEvidence.allStyles.cards;
  const animalCards = walkthroughState.presenterGalleryEvidence.animals.cards;
  if (walkthroughState.presenterGalleryEvidence.allStyles.visibleCardCount < expectedGalleryContract.total || galleryCards.length !== expectedGalleryContract.total
    || walkthroughState.presenterGalleryEvidence.animals.visibleCardCount !== expectedGalleryContract.animals
    || animalCards.length !== expectedGalleryContract.animals || [...galleryCards, ...animalCards].some((card) => card.capabilityState !== "static" || card.disabled)) {
    throw new Error(`Gifsmith recording did not preserve the static showcase profile while inspecting all packaged presenters: ${JSON.stringify(walkthroughState.presenterGalleryEvidence)}`);
  }
  if (!walkthroughState.modelsCardEvidence || walkthroughState.modelsCardEvidence.visibleCardCount < 2
    || walkthroughState.modelsCardEvidence.cardsOnFirstRow < 2 || walkthroughState.modelsCardEvidence.firstCardWidth < 400
    || walkthroughState.modelsCardEvidence.openTechnicalDetails !== 0 || walkthroughState.modelsCardEvidence.horizontalOverflow) {
    throw new Error(`Gifsmith recording did not verify the clarified Models card layout: ${JSON.stringify(walkthroughState.modelsCardEvidence)}`);
  }
  const voiceoverCueIds = ["home", "projects", "models", "library", "presenters", "artwork", "editor", "comparison", "outro"];
  const voiceoverCueOffsets = voiceoverCueIds.map((id) => walkthroughState.voiceoverCueOffsetsMs[id]);
  if (voiceoverCueOffsets.some((offset) => !Number.isFinite(offset) || offset < 0)
    || voiceoverCueOffsets.some((offset, index) => index > 0 && offset <= voiceoverCueOffsets[index - 1])
    || walkthroughState.voiceoverCueOffsetsMs.comparison >= walkthroughState.comparisonPlaybackOffsetMs
    || walkthroughState.voiceoverCueOffsetsMs.outro < walkthroughState.comparisonPlaybackOffsetMs + comparison.durationSeconds * 1000 + 20) {
    throw new Error(`Gifsmith recording did not preserve ordered chapter voiceover cues outside actor playback: ${JSON.stringify(walkthroughState.voiceoverCueOffsetsMs)}`);
  }
  const finalPath = path.join(runRoot, "alystria-native-walkthrough.mp4");
  const audioMix = await muxWalkthroughAudio({
    ffmpegPath,
    silentOutput,
    finalPath,
    comparison,
    comparisonPlaybackOffsetMs: walkthroughState.comparisonPlaybackOffsetMs,
    voiceover,
    voiceoverCueOffsetsMs: walkthroughState.voiceoverCueOffsetsMs,
  });
  const [silentProbe, finalProbe, firstAudibleAudio, loudness] = await Promise.all([
    probeMedia(ffprobePath, silentOutput),
    probeMedia(ffprobePath, finalPath),
    probeFirstAudibleAudio(ffprobePath, finalPath),
    measureLoudness(ffmpegPath, finalPath),
  ]);
  const readmeWebp = await createReadmeWebp(ffmpegPath, ffprobePath, finalPath, path.join(runRoot, "alystria-native-walkthrough.webp"));
  const modelsScreenshot = await assertRegularFile(modelsScreenshotPath, "native Models card screenshot");
  const firstVoiceoverCueMs = walkthroughState.voiceoverCueOffsetsMs.home;
  const driftMs = Math.abs(firstAudibleAudio.audibleSeconds * 1000 - firstVoiceoverCueMs);
  if (finalProbe.video?.codec_name !== "h264" || finalProbe.video.width !== 1440 || finalProbe.video.height !== 810
    || finalProbe.video.pix_fmt !== "yuv420p" || finalProbe.video.r_frame_rate !== `${walkthroughVideoFramesPerSecond}/1` || finalProbe.audio?.codec_name !== "aac"
    || Number(finalProbe.audio.sample_rate) !== 48_000 || finalProbe.audio.channels !== 1
    || finalProbe.durationSeconds < 90 || finalProbe.durationSeconds > 180
    || Math.abs(finalProbe.durationSeconds - silentProbe.durationSeconds) > 0.12 || driftMs > 80
    || loudness.integratedLufs < -17 || loudness.integratedLufs > -15 || loudness.truePeakDbtp > -1.5) {
    throw new Error(`Recorded walkthrough media failed duration/audio timing validation: ${JSON.stringify({ silentProbe, finalProbe, firstAudibleAudio, firstVoiceoverCueMs, driftMs, loudness })}`);
  }
  return {
    evidenceClass: "actual-native-gifsmith-walkthrough-with-provisional-monotonic-audio-mux",
    actualNativeWebView: true,
    fixtureUi: false,
    providerCalls: 0,
    localInferenceCalls: 0,
    privateGeneratedTutorialNotShown: true,
    presenterPlatform,
    presenterGalleryEvidence: walkthroughState.presenterGalleryEvidence,
    modelsCardEvidence: {
      ...walkthroughState.modelsCardEvidence,
      screenshotPath: modelsScreenshotPath,
      screenshotSha256: await sha256File(modelsScreenshotPath),
      screenshotBytes: modelsScreenshot.size,
      expandedLocalTechnicalDetails: expandedModelsEvidence,
    },
    voiceoverCueOffsetsMs: walkthroughState.voiceoverCueOffsetsMs,
    audioCueTimingBasis: "monotonic real elapsed time from the first recorded cue; provisional until encoded-frame visual acceptance",
    audioVisualQualification: "requires encoded-frame visual acceptance because Gifsmith does not expose an absolute screencast-start timestamp",
    audioVisualSyncPassed: false,
    recordingWindow,
    editorResizeEvidence: { before: walkthroughState.editorLayoutBefore, after: walkthroughState.editorLayoutAfter },
    comparisonAudioSource: "exact native editor comparison export",
    comparisonAudioSourceSha256: comparison.outputSha256,
    comparisonPlaybackOffsetMs: walkthroughState.comparisonPlaybackOffsetMs,
    comparisonPlayingEventMediaTime: walkthroughState.comparisonPlayingEventMediaTime,
    comparisonPlaybackEvidence: walkthroughState.comparisonPlaybackEvidence,
    naturalEndedReviewEvidence,
    captureReceiptPath,
    firstMuxedAudibleSampleMs: firstAudibleAudio.audibleSeconds * 1000,
    firstMuxedAudioPacket: firstAudibleAudio,
    audioStartPacketDriftMs: driftMs,
    maximumAudioStartPacketDriftMs: 80,
    loudness,
    audioMix,
    silentCapture: { path: silentOutput, sha256: await sha256File(silentOutput), ...silentProbe },
    finalVideo: { path: finalPath, sha256: await sha256File(finalPath), ...finalProbe },
    webp: readmeWebp,
    gifsmith: {
      entrypoint: gifsmithEntry,
      entrypointSha256: await sha256File(gifsmithEntry),
      sourceFrames: result.sourceFrames,
      pacedFrames: result.pacedFrames,
      targetOutputFps: walkthroughVideoFramesPerSecond,
      minimumAcceptedProducerFps: minimumWalkthroughCaptureFramesPerSecond,
      achievedCaptureFps: result.achievedCaptureFps,
      pacedMinusSourceFrames: result.pacedFrames - result.sourceFrames,
      pacingMode: "timestamp-paced real screencast frames; no synthesized motion interpolation",
      producerShortfallWarningRetained: result.warnings.some((warning) => /capture averaged .* below the .* output/iu.test(warning)),
      durationSeconds: result.durationSeconds,
      temporalReview: result.review ?? null,
      warnings: result.warnings,
    },
  };
}

function comparisonProjectDocument(timing) {
  return {
    title: comparisonTitle,
    topic: "Compare four presenter visual styles using the same spoken reference phrase",
    description: "An edited native showcase of four separately rendered presenter clips. Each clip uses the same spoken phrase with reviewed public-demo narration so visual style and lip-sync can be compared honestly.",
    locale: "English",
    audience: "Tutorial creators",
    duration: Number((timing.durationSeconds / 60).toFixed(3)),
    updatedAt: "just now",
    progress: 100,
    status: "Complete",
    theme: "Presenter comparison",
    privacy: "Local only",
    scenes: [{ id: "presenter-style-comparison", index: 1, title: comparisonTitle, kind: "comparison", duration: timing.durationSeconds, narration: presenterDemoPhrase, objective: "Compare four actual local lip-sync outputs using public-cleared premium narration.", status: "approved", visual: "summary", citations: 0, locked: false }],
    sources: [],
    presenterSelection: { schemaVersion: 1, mode: "on", presenters: [], sceneAssignments: [] },
    sceneCandidates: [],
    providerRoutingPolicy: {
      version: 1,
      privacyMode: "local",
      dataClassification: "project",
      approvals: [],
      routes: [{ capability: "lipsync.generate", model: "local/presenter-runtime", providerIds: ["local-runtime"], voice: null }],
    },
  };
}

function deriveComparisonTiming(clips) {
  let nextFrame = 0;
  const timedClips = clips.map((clip) => {
    // The native importer retains the complete container duration so that a
    // short AAC tail is not cut from JoyVASA clips. Starting the next clip at
    // video-stream duration can overlap that retained audio by one or two
    // frames, so construction and persistence use ffprobe's container maximum.
    const durationSeconds = Number(clip.probe?.durationSeconds);
    const durationFrames = Math.round(durationSeconds * 30);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isSafeInteger(durationFrames) || durationFrames <= 0) {
      throw new Error(`Presenter clip ${clip.slug} has no authoritative container duration for the editor timeline`);
    }
    const timed = { slug: clip.slug, startFrame: nextFrame, durationFrames, durationSeconds };
    nextFrame += durationFrames;
    return timed;
  });
  return { clips: timedClips, durationFrames: nextFrame, durationSeconds: nextFrame / 30 };
}

function frameTimecode(frame) {
  const seconds = Math.floor(frame / 30);
  const remainder = frame % 30;
  return `00:00:${String(seconds).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}


function createWalkthroughState() {
  return {
    recordingMonotonicOriginMs: null,
    comparisonPlaybackOffsetMs: null,
    comparisonPlayingEventMediaTime: null,
    comparisonPlaybackEvidence: null,
    editorLayoutBefore: null,
    editorLayoutAfter: null,
    presenterGalleryEvidence: null,
    modelsCardEvidence: null,
    voiceoverCueOffsetsMs: {},
  };
}

async function loadGifsmithApi(entrypoint) {
  const api = await import(pathToFileURL(entrypoint).href);
  const requiredFunctions = ["assertConfig", "estimateSeconds", "render", "timeline", "tauri"];
  const missing = requiredFunctions.filter((name) => typeof api[name] !== "function");
  if (missing.length || typeof api.props?.cursor !== "function") {
    throw new Error(`Built Gifsmith API is missing walkthrough exports: ${JSON.stringify({ missing, cursor: typeof api.props?.cursor })}`);
  }
  return api;
}

function countTimelineKinds(steps) {
  const counts = {};
  const visit = (items) => {
    for (const step of items) {
      counts[step.kind] = (counts[step.kind] ?? 0) + 1;
      if (step.kind === "parallel") step.branches.forEach(visit);
      if (step.kind === "sequence") visit(step.steps);
    }
  };
  visit(steps);
  return counts;
}

function assertGifsmithResult(result) {
  const formats = new Set(Array.isArray(result?.outputs) ? result.outputs.map((output) => output?.format) : []);
  const pacedFramesPerSecond = Number(result?.pacedFrames) / Number(result?.durationSeconds);
  if (!formats.has("mp4")
    || !Number.isSafeInteger(result?.sourceFrames) || result.sourceFrames <= 0
    || !Number.isSafeInteger(result?.pacedFrames) || result.pacedFrames <= 0
    || !Number.isFinite(result?.achievedCaptureFps) || result.achievedCaptureFps < minimumWalkthroughCaptureFramesPerSecond
    || !Number.isFinite(result?.durationSeconds) || result.durationSeconds <= 0
    || !Number.isFinite(pacedFramesPerSecond) || Math.abs(pacedFramesPerSecond - walkthroughVideoFramesPerSecond) > 0.1
    || !Array.isArray(result?.warnings) || !result.review || typeof result.review !== "object") {
    throw new Error(`Gifsmith returned an invalid recording result contract: ${JSON.stringify(result)}`);
  }
}

async function muxWalkthroughAudio({
  ffmpegPath,
  silentOutput,
  finalPath,
  comparison,
  comparisonPlaybackOffsetMs,
  voiceover,
  voiceoverCueOffsetsMs,
}) {
  const segments = expectedVoiceoverSegmentIds.map((id) => {
    const segment = voiceover.segments.find((candidate) => candidate.id === id);
    const cueOffsetMs = Number(voiceoverCueOffsetsMs[id]);
    if (!segment || !Number.isFinite(cueOffsetMs) || cueOffsetMs < 0) {
      throw new Error(`Walkthrough audio mix is missing the reviewed ${id} voiceover cue`);
    }
    return { ...segment, cueOffsetMs, endOffsetMs: cueOffsetMs + segment.durationSeconds * 1000 };
  });
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index - 1].endOffsetMs > segments[index].cueOffsetMs + 1) {
      throw new Error(`README voiceover segments ${segments[index - 1].id} and ${segments[index].id} overlap on the recorded timeline`);
    }
  }
  const comparisonEndMs = comparisonPlaybackOffsetMs + comparison.durationSeconds * 1000;
  for (const segment of segments) {
    if (Math.max(segment.cueOffsetMs, comparisonPlaybackOffsetMs) < Math.min(segment.endOffsetMs, comparisonEndMs) - 1) {
      throw new Error(`README voiceover segment ${segment.id} overlaps actor Review playback`);
    }
  }
  const arguments_ = ["-hide_banner", "-loglevel", "error", "-y", "-i", silentOutput, "-i", comparison.outputPath];
  for (const segment of segments) arguments_.push("-i", segment.wavPath);
  const filters = [
    `[1:a]atrim=start=0:end=${comparison.durationSeconds.toFixed(6)},asetpts=PTS-STARTPTS,aresample=48000,adelay=${Math.round(comparisonPlaybackOffsetMs)}:all=1[actors]`,
  ];
  const mixLabels = ["[actors]"];
  segments.forEach((segment, index) => {
    const label = `voice${index}`;
    filters.push(`[${index + 2}:a]atrim=start=${segment.trimInSeconds.toFixed(6)}:end=${segment.trimOutSeconds.toFixed(6)},asetpts=PTS-STARTPTS,aresample=48000,adelay=${Math.round(segment.cueOffsetMs)}:all=1[${label}]`);
    mixLabels.push(`[${label}]`);
  });
  filters.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=longest:dropout_transition=0:normalize=0,loudnorm=I=-16:TP=-1.8:LRA=11,aresample=48000[aout]`);
  arguments_.push(
    "-filter_complex", filters.join(";"),
    "-map", "0:v:0", "-map", "[aout]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart", finalPath,
  );
  await execFileAsync(ffmpegPath, arguments_, { windowsHide: true, timeout: 300_000 });
  return {
    comparison: {
      sourceSha256: comparison.outputSha256,
      offsetMs: comparisonPlaybackOffsetMs,
      durationSeconds: comparison.durationSeconds,
      endOffsetMs: comparisonEndMs,
    },
    voiceover: segments.map((segment) => ({
      id: segment.id,
      cue: segment.cue,
      sourceSha256: segment.wavSha256,
      trimInSeconds: segment.trimInSeconds,
      trimOutSeconds: segment.trimOutSeconds,
      durationSeconds: segment.durationSeconds,
      cueOffsetMs: segment.cueOffsetMs,
      endOffsetMs: segment.endOffsetMs,
    })),
    overlapPolicy: "chapter voiceover and actor Review audio are disjoint",
    audioEncoder: "aac",
    audioBitrate: "192k",
  };
}

function buildNativeWalkthroughTimeline({
  timeline,
  localImageProjectTitle,
  comparisonTitle,
  comparisonDurationSeconds,
  modelsScreenshotPath,
  voiceoverDurationsSeconds,
  state,
}) {
  return timeline((t) => {
    t.waitFor(".app-shell", { timeoutMs: 30_000 });
    cueWithTimestamp(t, state, "home", "Home");
    holdForVoiceover(t, "home", 4, voiceoverDurationsSeconds);
    t.call(async (gifPage, ctx) => {
      await clickAria(gifPage, ctx, "Projects");
      await waitText(gifPage, ctx, "h1", "Projects");
    }, { name: "Open project gallery", seconds: 1 });
    cueWithTimestamp(t, state, "projects", "Project gallery");
    holdForVoiceover(t, "projects", 5, voiceoverDurationsSeconds);
    t.call(async (gifPage, ctx) => {
      await clickAria(gifPage, ctx, "Models & providers");
      await waitText(gifPage, ctx, "h1", "Models & providers");
      await ctx.settle(gifPage.waitForSelector(".aly-catalog-card", { visible: true }), { label: "clarified model cards" });
      state.modelsCardEvidence = await ctx.settle(gifPage.evaluate(() => {
        const grid = document.querySelector(".aly-catalog-card-grid");
        if (!(grid instanceof HTMLElement)) throw new Error("Models card grid is missing");
        const cards = [...grid.querySelectorAll(":scope > .aly-catalog-card")].filter((card) => card instanceof HTMLElement && card.getBoundingClientRect().height > 0);
        const first = cards[0];
        const firstTop = first instanceof HTMLElement ? first.getBoundingClientRect().top : Number.NaN;
        return {
          visibleCardCount: cards.length,
          cardsOnFirstRow: cards.filter((card) => card instanceof HTMLElement && Math.abs(card.getBoundingClientRect().top - firstTop) < 2).length,
          firstCardWidth: first instanceof HTMLElement ? first.getBoundingClientRect().width : 0,
          openTechnicalDetails: grid.querySelectorAll(".aly-catalog-card__details[open]").length,
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          visibleTitles: cards.slice(0, 4).map((card) => card.querySelector("h3")?.textContent?.trim() ?? ""),
        };
      }), { label: "measure clarified model cards" });
      await ctx.settle(gifPage.screenshot({ path: modelsScreenshotPath }), { label: "capture native Models card screenshot" });
    }, { name: "Open model manager", seconds: 1 });
    cueWithTimestamp(t, state, "models", "Models and downloads");
    t.hold(8);
    t.call(async (gifPage, ctx) => {
      await clickAriaPrefix(gifPage, ctx, "Downloads");
      await ctx.settle(gifPage.waitForSelector('[aria-label="Model downloads"]', { visible: true }), { label: "model downloads panel" });
    }, { name: "Open download panel", seconds: 1 });
    tailHoldForVoiceover(t, "models", 2, 8, voiceoverDurationsSeconds);
    t.call(async (gifPage, ctx) => { await clickAria(gifPage, ctx, "Minimize downloads"); }, { name: "Minimize download panel", seconds: 0.5 });
    t.call(async (gifPage, ctx) => {
      await clickAria(gifPage, ctx, "Library");
      await waitText(gifPage, ctx, "h1", "Library");
    }, { name: "Open included asset library", seconds: 1 });
    cueWithTimestamp(t, state, "library", "Included teaching assets");
    holdForVoiceover(t, "library", 5, voiceoverDurationsSeconds);
    t.scroll(".main-content", 420, 1.5);
    t.hold(2);
    t.call(async (gifPage, ctx) => {
      await clickAria(gifPage, ctx, "Projects");
      await waitText(gifPage, ctx, "h1", "Projects");
      await clickProjectCard(gifPage, ctx, comparisonTitle);
      await clickAria(gifPage, ctx, "Plan");
      await clickTextButton(gifPage, ctx, "Presenters");
      await ctx.settle(gifPage.waitForSelector(".presenter-picker__gallery", { visible: true }), { label: "presenter gallery" });
      state.presenterGalleryEvidence = {
        allStyles: await ctx.settle(readPresenterGallery(gifPage, expectedGalleryPresenters, false), { label: "read all casual presenter cards" }),
      };
    }, { name: "Open actual presenter cast gallery", seconds: 2 });
    cueWithTimestamp(t, state, "presenters", "Fourteen casual and animal presenters");
    t.hold(5);
    t.call(async (gifPage, ctx) => {
      await selectAriaOption(gifPage, ctx, "Presenter visual style", "Animal");
      const animals = expectedGalleryPresenters.filter((presenter) => presenter.animal);
      state.presenterGalleryEvidence.animals = await ctx.settle(readPresenterGallery(gifPage, animals, true), { label: "read animal presenter cards" });
    }, { name: "Filter presenter gallery to animals", seconds: 1 });
    t.cue("Animal presenter collection");
    tailHoldForVoiceover(t, "presenters", 2, 5, voiceoverDurationsSeconds);
    t.call(async (gifPage, ctx) => { await clickCss(gifPage, ctx, ".project-switcher"); await waitText(gifPage, ctx, "h1", "Projects"); }, { name: "Return to project gallery", seconds: 1 });
    t.call(async (gifPage, ctx) => { await clickProjectCard(gifPage, ctx, localImageProjectTitle); await clickAria(gifPage, ctx, "Studio"); }, { name: "Open accepted local artwork", seconds: 1 });
    cueWithTimestamp(t, state, "artwork", "Accepted local SDXL artwork");
    holdForVoiceover(t, "artwork", 10, voiceoverDurationsSeconds);
    t.call(async (gifPage, ctx) => { await clickCss(gifPage, ctx, ".project-switcher"); await clickProjectCard(gifPage, ctx, comparisonTitle); await clickAria(gifPage, ctx, "Studio"); await clickTextButton(gifPage, ctx, "Advanced editor"); }, { name: "Open public presenter comparison editor", seconds: 1.5 });
    cueWithTimestamp(t, state, "editor", "Presenter comparison editor");
    t.hold(4);
    t.call(async (gifPage, ctx) => { await clickAria(gifPage, ctx, "Transcript"); }, { name: "Open transcript panel", seconds: 0.5 });
    t.hold(3);
    t.call(async (gifPage, ctx) => {
      state.editorLayoutBefore = await ctx.settle(readEditorLayout(gifPage), { label: "read editor layout before resize" });
    }, { name: "Measure editor layout before resize" });
    t.drag('[role="separator"][aria-label="Resize side panel width"]', { dx: 170, dy: 0 }, 1.2);
    t.drag('[role="separator"][aria-label="Resize timeline height"]', { dx: 0, dy: -120 }, 1.2);
    t.call(async (gifPage, ctx) => {
      state.editorLayoutAfter = await ctx.settle(readEditorLayout(gifPage), { label: "read editor layout after resize" });
      if (state.editorLayoutAfter.dockWidth <= state.editorLayoutBefore.dockWidth || state.editorLayoutAfter.timelineHeight <= state.editorLayoutBefore.timelineHeight) {
        throw new Error(`Editor panel drags did not enlarge both regions: ${JSON.stringify({ before: state.editorLayoutBefore, after: state.editorLayoutAfter })}`);
      }
    }, { name: "Verify editor panel resize" });
    t.hold(3);
    t.call(async (gifPage, ctx) => { await clickAria(gifPage, ctx, "Media"); }, { name: "Open editor media panel", seconds: 0.5 });
    tailHoldForVoiceover(t, "editor", 1, 12.4, voiceoverDurationsSeconds);
    t.call(async (gifPage, ctx) => { await clickAriaPrefix(gifPage, ctx, "Return to scene"); await clickAria(gifPage, ctx, "Review"); }, { name: "Open presenter style comparison", seconds: 1 });
    cueWithTimestamp(t, state, "comparison", "Presenter style comparison");
    holdForVoiceover(t, "comparison", 4, voiceoverDurationsSeconds);
    t.call(async (gifPage, ctx) => {
      const event = await ctx.settle(gifPage.evaluate(async () => {
        const video = document.querySelector('video[aria-label="Authoritative generated tutorial media"]');
        if (!(video instanceof HTMLVideoElement)) throw new Error("Presenter comparison Review video is missing");
        video.muted = true;
        video.preload = "auto";
        video.pause();
        if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
          await new Promise((resolve, reject) => {
            const timeout = window.setTimeout(() => reject(new Error("Comparison video metadata never loaded")), 10_000);
            video.addEventListener("loadedmetadata", () => { window.clearTimeout(timeout); resolve(); }, { once: true });
          });
        }
        if (video.currentTime > 0.01) {
          await new Promise((resolve, reject) => {
            const timeout = window.setTimeout(() => reject(new Error("Comparison video rewind timed out")), 10_000);
            video.addEventListener("seeked", () => { window.clearTimeout(timeout); resolve(); }, { once: true });
            video.currentTime = 0;
          });
        }
        if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
          await new Promise((resolve, reject) => {
            const timeout = window.setTimeout(() => reject(new Error("Comparison video never became playable")), 10_000);
            video.addEventListener("canplay", () => { window.clearTimeout(timeout); resolve(); }, { once: true });
            video.load();
          });
        }
        video.dataset.walkthroughWaitingEvents = "0";
        video.dataset.walkthroughStalledEvents = "0";
        video.addEventListener("waiting", () => { video.dataset.walkthroughWaitingEvents = String(Number(video.dataset.walkthroughWaitingEvents ?? 0) + 1); });
        video.addEventListener("stalled", () => { video.dataset.walkthroughStalledEvents = String(Number(video.dataset.walkthroughStalledEvents ?? 0) + 1); });
        await new Promise((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error("Comparison video never emitted playing")), 10_000);
          video.addEventListener("playing", () => { window.clearTimeout(timeout); resolve(); }, { once: true });
          void video.play().catch(reject);
        });
        return { currentTime: video.currentTime, readyState: video.readyState };
      }), { capMs: 12_000, label: "comparison playing event" });
      state.comparisonPlaybackOffsetMs = recordingElapsedMs(state);
      state.comparisonPlayingEventMediaTime = event.currentTime;
      // Stop just before Chromium's native controls enter their end-of-media
      // loading state. The exported audio mux retains the complete actor track,
      // including its silent tail, while the filmed UI never holds a buffering
      // spinner over Chloe's face.
      await ctx.advance(Math.max(0, comparisonDurationSeconds - comparisonFilmedTailNavigationSeconds) * 1000);
      state.comparisonPlaybackEvidence = await ctx.settle(gifPage.evaluate(() => {
        const video = document.querySelector('video[aria-label="Authoritative generated tutorial media"]');
        if (!(video instanceof HTMLVideoElement)) throw new Error("Presenter comparison Review video disappeared during playback");
        video.pause();
        return {
          currentTime: video.currentTime,
          duration: video.duration,
          readyState: video.readyState,
          networkState: video.networkState,
          seeking: video.seeking,
          ended: video.ended,
          waitingEvents: Number(video.dataset.walkthroughWaitingEvents ?? 0),
          stalledEvents: Number(video.dataset.walkthroughStalledEvents ?? 0),
        };
      }));
      await ctx.advance(comparisonTailGuardSeconds * 1000);
      await clickCss(gifPage, ctx, ".project-switcher");
      await waitText(gifPage, ctx, "h1", "Projects");
    }, { name: "Play four presenter styles", seconds: comparisonDurationSeconds + 0.4 });
    cueWithTimestamp(t, state, "outro", "Four real lip-sync styles complete");
    holdForVoiceover(t, "outro", 4, voiceoverDurationsSeconds);
  });
}

function cueWithTimestamp(timelineBuilder, state, id, cue) {
  timelineBuilder.cue(cue);
  timelineBuilder.call(() => {
    state.voiceoverCueOffsetsMs[id] = recordingElapsedMs(state);
  }, { name: `Record ${id} voiceover cue`, seconds: 0 });
}

function recordingElapsedMs(state) {
  const now = performance.now();
  if (!Number.isFinite(state.recordingMonotonicOriginMs)) state.recordingMonotonicOriginMs = now;
  return now - state.recordingMonotonicOriginMs;
}

function holdForVoiceover(timelineBuilder, id, minimumSeconds, durationsSecondsById) {
  const narrationSeconds = Number(durationsSecondsById[id] ?? 0);
  if (!Number.isFinite(narrationSeconds) || narrationSeconds < 0) {
    throw new Error(`Voiceover segment ${id} has an invalid duration`);
  }
  timelineBuilder.hold(Math.max(minimumSeconds, narrationSeconds + 0.3));
}

function tailHoldForVoiceover(timelineBuilder, id, minimumSeconds, secondsBeforeTail, durationsSecondsById) {
  const narrationSeconds = Number(durationsSecondsById[id] ?? 0);
  if (!Number.isFinite(narrationSeconds) || narrationSeconds < 0) {
    throw new Error(`Voiceover segment ${id} has an invalid duration`);
  }
  timelineBuilder.hold(Math.max(minimumSeconds, narrationSeconds + 0.3 - secondsBeforeTail));
}

async function navigateGlobal(page, label) {
  if (await page.getByRole("navigation", { name: /project workspace/i }).isVisible()) await page.locator(".project-switcher").click();
  await page.getByRole("navigation", { name: /areas/i }).getByRole("button", { name: label, exact: true }).click();
}

async function captureExpandedNativeModelDetails({ page, screenshotPath }) {
  await navigateGlobal(page, "Models & providers");
  await expect(page.getByRole("heading", { name: "Models & providers", exact: true })).toBeVisible({ timeout: 30_000 });
  const localCard = page.locator(".aly-catalog-card")
    .filter({ has: page.locator(".aly-catalog-metrics dt", { hasText: /^License$/u }) })
    .filter({ hasNotText: /Download unavailable/iu })
    .first();
  await expect(localCard).toBeVisible({ timeout: 30_000 });
  await localCard.locator(".aly-catalog-card__details > summary").click();
  const layout = await localCard.evaluate((card) => {
    if (!(card instanceof HTMLElement)) throw new Error("Expanded local model card is not an HTML element");
    const details = card.querySelector(".aly-catalog-card__details");
    const body = card.querySelector(".aly-catalog-card__details-body");
    if (!(details instanceof HTMLDetailsElement) || !(body instanceof HTMLElement)) throw new Error("Local model technical details are missing");
    const overflow = [body, ...body.querySelectorAll("dd, p, section")]
      .filter((element) => element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 1)
      .map((element) => element.textContent?.trim().slice(0, 120) ?? "");
    return {
      cardTitle: card.querySelector("h3")?.textContent?.trim() ?? "",
      cardWidth: card.getBoundingClientRect().width,
      detailsOpen: details.open,
      detailsWidth: details.getBoundingClientRect().width,
      overflowingTechnicalValues: overflow,
      pageHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      technicalLabels: [...body.querySelectorAll("dt, h4")].map((element) => element.textContent?.trim() ?? "").filter(Boolean),
    };
  });
  if (!layout.cardTitle || layout.cardWidth < 400 || !layout.detailsOpen || layout.detailsWidth < 360
    || layout.overflowingTechnicalValues.length || layout.pageHorizontalOverflow || layout.technicalLabels.length < 2) {
    throw new Error(`Expanded native local model details are not readable and contained: ${JSON.stringify(layout)}`);
  }
  await page.screenshot({ path: screenshotPath, fullPage: false });
  const screenshot = await assertRegularFile(screenshotPath, "expanded native local model details screenshot");
  return {
    ...layout,
    screenshotPath,
    screenshotSha256: await sha256File(screenshotPath),
    screenshotBytes: screenshot.size,
    capturedAfterWalkthrough: true,
  };
}

async function captureNaturalEndedReviewEvidence({ page, comparisonTitle, expectedDurationSeconds, screenshotPath }) {
  await navigateGlobal(page, "Projects");
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible({ timeout: 30_000 });
  const card = page.locator("button.project-card").filter({ has: page.getByRole("heading", { name: comparisonTitle, exact: true }) });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  const projectNavigation = page.getByRole("navigation", { name: /project workspace/i });
  await expect(projectNavigation).toBeVisible({ timeout: 30_000 });
  await projectNavigation.getByRole("button", { name: /^review$/iu }).click();
  const video = page.getByLabel("Authoritative generated tutorial media");
  await expect(video).toBeVisible({ timeout: 30_000 });
  const playback = await video.evaluate(async (element) => {
    if (!(element instanceof HTMLVideoElement)) throw new Error("Natural-end Review evidence is not a video");
    element.muted = true;
    element.preload = "auto";
    element.pause();
    if (element.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("Natural-end Review metadata timed out")), 10_000);
        element.addEventListener("loadedmetadata", () => { window.clearTimeout(timer); resolve(); }, { once: true });
      });
    }
    const seekTo = Math.max(0, element.duration - 1.2);
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Natural-end Review seek timed out")), 10_000);
      element.addEventListener("seeked", () => { window.clearTimeout(timer); resolve(); }, { once: true });
      element.currentTime = seekTo;
    });
    if (element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      await new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("Natural-end Review never became playable")), 10_000);
        element.addEventListener("canplay", () => { window.clearTimeout(timer); resolve(); }, { once: true });
      });
    }
    let waitingEvents = 0;
    let stalledEvents = 0;
    const onWaiting = () => { waitingEvents += 1; };
    const onStalled = () => { stalledEvents += 1; };
    element.addEventListener("waiting", onWaiting);
    element.addEventListener("stalled", onStalled);
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Natural-end Review never entered playing state")), 10_000);
      element.addEventListener("playing", () => { window.clearTimeout(timer); resolve(); }, { once: true });
      void element.play().catch(reject);
    });
    if (!element.ended) {
      await new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("Natural-end Review did not reach ended state")), 10_000);
        element.addEventListener("ended", () => { window.clearTimeout(timer); resolve(); }, { once: true });
      });
    }
    element.removeEventListener("waiting", onWaiting);
    element.removeEventListener("stalled", onStalled);
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    return {
      seekTo,
      currentTime: element.currentTime,
      duration: element.duration,
      readyState: element.readyState,
      networkState: element.networkState,
      paused: element.paused,
      seeking: element.seeking,
      ended: element.ended,
      waitingEvents,
      stalledEvents,
      videoWidth: element.videoWidth,
      videoHeight: element.videoHeight,
    };
  });
  if (!playback.ended || !playback.paused || playback.seeking || playback.readyState < 2
    || playback.videoWidth <= 0 || playback.videoHeight <= 0 || playback.waitingEvents !== 0 || playback.stalledEvents !== 0
    || Math.abs(playback.duration - expectedDurationSeconds) > 0.15 || Math.abs(playback.currentTime - playback.duration) > 0.08) {
    throw new Error(`Natural-end Review playback was incomplete or buffered: ${JSON.stringify(playback)}`);
  }
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const screenshot = await assertRegularFile(screenshotPath, "natural-ended native Review screenshot");
  return {
    ...playback,
    screenshotPath,
    screenshotSha256: await sha256File(screenshotPath),
    screenshotBytes: screenshot.size,
    capturedAfterWalkthrough: true,
    filmedTimelineStoppedInsideSilentTail: true,
    filmedTimelineTailNavigationSeconds: comparisonFilmedTailNavigationSeconds,
    filmedTimelineTailGuardSeconds: comparisonTailGuardSeconds,
  };
}

async function showRecordingWindow(page, desktopPid) {
  const before = await page.evaluate(() => ({
    scaleFactor: window.devicePixelRatio,
    logicalWidth: window.innerWidth,
    logicalHeight: window.innerHeight,
    visibilityState: document.visibilityState,
  }));
  const scaleFactor = Number(before.scaleFactor);
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0 || !Number.isSafeInteger(desktopPid) || desktopPid <= 0) {
    throw new Error(`Native recording window returned invalid ownership or scale metrics: ${JSON.stringify({ desktopPid, before })}`);
  }
  const win32 = await showAndResizeOwnedNativeWindow(desktopPid);
  await page.waitForFunction(() => document.visibilityState === "visible" && window.innerWidth >= 960 && window.innerHeight >= 540, {}, { timeout: 10_000 });
  const metrics = await page.evaluate(() => ({
    scaleFactor: window.devicePixelRatio,
    logicalWidth: window.innerWidth,
    logicalHeight: window.innerHeight,
    visibilityState: document.visibilityState,
  }));
  const resizedScaleFactor = Number(metrics.scaleFactor);
  const width = Number(metrics.logicalWidth);
  const height = Number(metrics.logicalHeight);
  const aspectError = Math.abs((width / height) - (16 / 9));
  if (!Number.isFinite(resizedScaleFactor) || resizedScaleFactor <= 0 || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 960 || height < 540 || aspectError > 0.01 || metrics.visibilityState !== "visible") {
    throw new Error(`Native recording window is not a visible 16:9 WebView on the selected monitor: ${JSON.stringify({ metrics, aspectError, win32 })}`);
  }
  return {
    logicalWidth: width,
    logicalHeight: height,
    scaleFactor: resizedScaleFactor,
    visibilityState: metrics.visibilityState,
    aspectError,
    captureViewport: { width, height },
    win32,
  };
}

async function showAndResizeOwnedNativeWindow(desktopPid) {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AlystriaRecordingWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetClientRect(IntPtr hWnd, out Rect rect);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr dpiContext);
  public static IntPtr FindForProcess(int expectedProcessId) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      if (processId == (uint)expectedProcessId) { found = hWnd; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
$ownedPid = [int]$env:ALYSTRIA_RECORDING_PID
$null = Get-Process -Id $ownedPid -ErrorAction Stop
$previousDpiContext = [AlystriaRecordingWindow]::SetThreadDpiAwarenessContext([IntPtr](-4))
if ($previousDpiContext -eq [IntPtr]::Zero) { throw 'Could not enable per-monitor DPI awareness for recording placement.' }
Add-Type -AssemblyName System.Windows.Forms
$screens = @([System.Windows.Forms.Screen]::AllScreens)
$secondary = @($screens | Where-Object { -not $_.Primary } | Sort-Object { $_.WorkingArea.Width * $_.WorkingArea.Height } -Descending | Select-Object -First 1)
if ($secondary.Count -ne 1) { throw 'A secondary monitor is required for the authorized visible recording.' }
$selected = $secondary[0]
$work = $selected.WorkingArea
$handle = [AlystriaRecordingWindow]::FindForProcess($ownedPid)
if ($handle -eq [IntPtr]::Zero) { throw 'Owned native process has no top-level window.' }
$null = [AlystriaRecordingWindow]::ShowWindow($handle, 5)
[Threading.Thread]::Sleep(250)
$window = New-Object AlystriaRecordingWindow+Rect
$client = New-Object AlystriaRecordingWindow+Rect
$provisionalWidth = [Math]::Min(1280, $work.Width - 96)
$provisionalHeight = [Math]::Min(800, $work.Height - 96)
if (-not [AlystriaRecordingWindow]::SetWindowPos($handle, [IntPtr]::Zero, $work.X + 48, $work.Y + 48, $provisionalWidth, $provisionalHeight, 0x54)) { throw 'Initial secondary-monitor placement failed.' }
[Threading.Thread]::Sleep(500)
$iterations = 0
for ($iterations = 1; $iterations -le 4; $iterations++) {
  if (-not [AlystriaRecordingWindow]::GetWindowRect($handle, [ref]$window)) { throw 'GetWindowRect failed.' }
  if (-not [AlystriaRecordingWindow]::GetClientRect($handle, [ref]$client)) { throw 'GetClientRect failed.' }
  $actualWidth = $client.Right - $client.Left
  $actualHeight = $client.Bottom - $client.Top
  $chromeWidth = ($window.Right - $window.Left) - $actualWidth
  $chromeHeight = ($window.Bottom - $window.Top) - $actualHeight
  $availableClientWidth = $work.Width - 96 - $chromeWidth
  $availableClientHeight = $work.Height - 96 - $chromeHeight
  $units = [Math]::Min([Math]::Floor($availableClientWidth / 16), [Math]::Floor($availableClientHeight / 9))
  if ($units -lt 60) { throw 'Secondary monitor work area is too small for the native walkthrough.' }
  $targetWidth = [int]($units * 16)
  $targetHeight = [int]($units * 9)
  $outerWidth = $targetWidth + $chromeWidth
  $outerHeight = $targetHeight + $chromeHeight
  $targetX = [int]($work.X + (($work.Width - $outerWidth) / 2))
  $targetY = [int]($work.Y + (($work.Height - $outerHeight) / 2))
  if (-not [AlystriaRecordingWindow]::SetWindowPos($handle, [IntPtr]::Zero, $targetX, $targetY, $outerWidth, $outerHeight, 0x54)) { throw 'Contained secondary-monitor resize failed.' }
  [Threading.Thread]::Sleep(250)
}
if (-not [AlystriaRecordingWindow]::GetWindowRect($handle, [ref]$window)) { throw 'Final GetWindowRect failed.' }
if (-not [AlystriaRecordingWindow]::GetClientRect($handle, [ref]$client)) { throw 'Final GetClientRect failed.' }
$contained = $window.Left -ge $work.Left -and $window.Top -ge $work.Top -and $window.Right -le $work.Right -and $window.Bottom -le $work.Bottom
if (-not $contained) { throw 'Final native recording window spans outside the selected secondary monitor work area.' }
[pscustomobject]@{
  processId = $ownedPid
  iterations = $iterations
  requestedClientWidth = $targetWidth
  requestedClientHeight = $targetHeight
  actualClientWidth = $client.Right - $client.Left
  actualClientHeight = $client.Bottom - $client.Top
  outerRect = @{ left = $window.Left; top = $window.Top; right = $window.Right; bottom = $window.Bottom }
  selectedMonitor = @{ deviceName = $selected.DeviceName; primary = $selected.Primary; workArea = @{ left = $work.Left; top = $work.Top; right = $work.Right; bottom = $work.Bottom; width = $work.Width; height = $work.Height } }
  monitors = @($screens | ForEach-Object { @{ deviceName = $_.DeviceName; primary = $_.Primary; workArea = @{ left = $_.WorkingArea.Left; top = $_.WorkingArea.Top; right = $_.WorkingArea.Right; bottom = $_.WorkingArea.Bottom; width = $_.WorkingArea.Width; height = $_.WorkingArea.Height } } })
  contained = $contained
} | ConvertTo-Json -Depth 6 -Compress
`;
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], {
    windowsHide: true,
    timeout: 30_000,
    encoding: "utf8",
    env: {
      ...process.env,
      ALYSTRIA_RECORDING_PID: String(desktopPid),
    },
  });
  const receipt = JSON.parse(stdout.trim());
  if (receipt.processId !== desktopPid) {
    throw new Error(`Win32 recording window receipt did not match the owned process: ${JSON.stringify(receipt)}`);
  }
  return receipt;
}

function assertPersistedComparisonTimeline(documentValue, presenterAcceptance) {
  if (!documentValue || documentValue.schema !== "alystria.editor.project.v1") {
    throw new Error("Presenter comparison editor document was not durably saved");
  }
  const presenterTrack = documentValue.tracks?.find((track) => track.kind === "presenter");
  const titleTrack = documentValue.tracks?.find((track) => track.kind === "titles");
  const captionTrack = documentValue.tracks?.find((track) => track.kind === "captions");
  const timing = deriveComparisonTiming(presenterAcceptance.clips);
  const clips = [...(presenterTrack?.clips ?? [])].sort((left, right) => left.timelineRange.startFrame - right.timelineRange.startFrame);
  const titles = [...(titleTrack?.clips ?? [])].sort((left, right) => left.timelineRange.startFrame - right.timelineRange.startFrame);
  const captions = [...(captionTrack?.clips ?? [])].sort((left, right) => left.timelineRange.startFrame - right.timelineRange.startFrame);
  if (clips.length !== expectedPresenters.length || titles.length !== expectedPresenters.length
    || captions.length !== expectedPresenters.length || documentValue.durationFrames !== timing.durationFrames) {
    throw new Error("Presenter comparison durable timeline does not contain four sequential clips, labels, and captions");
  }
  const assetById = new Map((documentValue.assets ?? []).map((asset) => [asset.id, asset]));
  const persistedOrder = clips.map((clip, index) => {
    const expected = presenterAcceptance.clips[index];
    const expectedTiming = timing.clips[index];
    const asset = assetById.get(clip.assetId);
    const title = titles[index];
    const caption = captions[index];
    if (!expected || !asset || asset.hash !== expected.videoSha256
      || asset.provenance?.humanApproved !== true || asset.metadata?.exportEligible !== true
      || clip.timelineRange?.startFrame !== expectedTiming.startFrame || clip.timelineRange?.durationFrames !== expectedTiming.durationFrames
      || clip.sourceRange?.startFrame !== 0 || clip.sourceRange?.durationFrames !== expectedTiming.durationFrames
      || clip.transform?.x !== comparisonPresenterTransform.x || clip.transform?.y !== comparisonPresenterTransform.y
      || clip.transform?.scaleX !== comparisonPresenterTransform.scaleX || clip.transform?.scaleY !== comparisonPresenterTransform.scaleY
      || clip.transform?.rotation !== comparisonPresenterTransform.rotation
      || clip.metadata?.includeSourceAudio !== true || clip.audio?.muted !== false
      || title?.timelineRange?.startFrame !== expectedTiming.startFrame || title.timelineRange.durationFrames !== expectedTiming.durationFrames
      || title.sourceRange?.durationFrames !== expectedTiming.durationFrames || title?.text !== expected.label || title.textStyle?.position !== "top"
      || caption?.timelineRange?.startFrame !== expectedTiming.startFrame || caption.timelineRange.durationFrames !== expectedTiming.durationFrames
      || caption.sourceRange?.durationFrames !== expectedTiming.durationFrames || caption?.text !== presenterDemoPhrase || caption.textStyle?.position !== "bottom") {
      throw new Error(`Presenter comparison durable clip ${index + 1} does not match ${expected?.slug ?? "the reviewed source"}`);
    }
    return {
      slug: expected.slug,
      assetHash: asset.hash,
      startFrame: clip.timelineRange.startFrame,
      durationFrames: clip.timelineRange.durationFrames,
      transform: clip.transform,
      sourceAudioIncluded: true,
      label: title.text,
      caption: caption.text,
      titleDurationFrames: title.timelineRange.durationFrames,
      captionDurationFrames: caption.timelineRange.durationFrames,
    };
  });
  return { schema: documentValue.schema, durationFrames: documentValue.durationFrames, presenterOrder: persistedOrder };
}

async function clickAria(gifPage, ctx, label) {
  await ctx.settle(gifPage.evaluate((name) => {
    const element = [...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === name);
    if (!(element instanceof HTMLButtonElement)) throw new Error(`Button with aria-label ${name} is missing`);
    element.click();
  }, label), { label: `click ${label}` });
  await ctx.advance(250);
}

async function clickAriaPrefix(gifPage, ctx, prefix) {
  await ctx.settle(gifPage.evaluate((value) => {
    const element = [...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label")?.startsWith(value));
    if (!(element instanceof HTMLButtonElement)) throw new Error(`Button with aria-label prefix ${value} is missing`);
    element.click();
  }, prefix), { label: `click ${prefix}` });
  await ctx.advance(250);
}

async function clickCss(gifPage, ctx, selector) {
  await ctx.settle(gifPage.click(selector), { label: `click ${selector}` });
  await ctx.advance(250);
}

async function clickTextButton(gifPage, ctx, text) {
  await ctx.settle(gifPage.evaluate((value) => {
    const element = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim().includes(value));
    if (!(element instanceof HTMLButtonElement)) throw new Error(`Button containing ${value} is missing`);
    element.click();
  }, text), { label: `click ${text}` });
  await ctx.advance(250);
}

async function clickProjectCard(gifPage, ctx, title) {
  await ctx.settle(gifPage.waitForSelector(".project-grid", { visible: true }), { label: "project grid" });
  await ctx.settle(gifPage.evaluate((expected) => {
    const element = [...document.querySelectorAll("button.project-card")].find((button) => button.querySelector("h3")?.textContent?.trim() === expected);
    if (!(element instanceof HTMLButtonElement)) throw new Error(`Project card ${expected} is missing`);
    element.click();
  }, title), { label: `open ${title}` });
  await ctx.advance(500);
}

async function selectAriaOption(gifPage, ctx, label, value) {
  await ctx.settle(gifPage.evaluate(({ accessibleName, selectedValue }) => {
    const element = [...document.querySelectorAll("select")].find((select) => select.getAttribute("aria-label") === accessibleName);
    if (!(element instanceof HTMLSelectElement)) throw new Error(`Select with aria-label ${accessibleName} is missing`);
    const option = [...element.options].find((candidate) => candidate.value === selectedValue);
    if (!option) throw new Error(`Select ${accessibleName} has no option ${selectedValue}`);
    element.value = selectedValue;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, { accessibleName: label, selectedValue: value }), { label: `select ${value} in ${label}` });
  await ctx.advance(350);
}

function readPresenterGallery(gifPage, expected, exact) {
  return gifPage.evaluate(async ({ expectedCards, requireExact }) => {
    const gallery = document.querySelector(".presenter-picker__gallery");
    if (!(gallery instanceof HTMLElement)) throw new Error("Presenter gallery is missing");
    const buttons = [...gallery.querySelectorAll("button")];
    if (requireExact && buttons.length !== expectedCards.length) {
      throw new Error(`Presenter gallery contains ${buttons.length} cards instead of ${expectedCards.length}`);
    }
    const cards = [];
    for (const expectedCard of expectedCards) {
      const button = buttons.find((candidate) => candidate.getAttribute("aria-label") === `Select ${expectedCard.label}`);
      if (!(button instanceof HTMLButtonElement)) throw new Error(`Presenter card ${expectedCard.label} is missing`);
      const image = button.querySelector("img");
      if (!image) throw new Error(`Presenter card ${expectedCard.label} has no portrait`);
      await image.decode().catch(() => {});
      if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        throw new Error(`Presenter portrait ${expectedCard.label} did not decode`);
      }
      const capability = button.querySelector(".presenter-picker__capability");
      const state = ["ready", "static", "checking", "runtime-required", "pending-review", "incompatible"]
        .find((candidate) => capability?.classList.contains(candidate));
      if (!capability || !state || state === "checking" || state === "runtime-required") {
        throw new Error(`Presenter capability for ${expectedCard.label} did not settle against an installed runtime`);
      }
      // This showcase project deliberately keeps presenter animation off. The
      // gallery therefore reports the current project behavior (`static`) even
      // for portraits whose reviewed runtime route is installed. The separate
      // native platform receipt above proves the exact 12 ready / 2
      // incompatible qualification split and all configured runtime routes.
      if (state !== "static") {
        throw new Error(`Presenter capability for ${expectedCard.label} is ${state} instead of the showcase profile's static state`);
      }
      const expectedBadge = expectedCard.animationState === "ready" ? "Lip-sync reviewed" : "Static ready";
      const capabilityBadge = capability.textContent?.trim() ?? "";
      if (capabilityBadge !== expectedBadge) {
        throw new Error(`Presenter capability badge for ${expectedCard.label} is ${capabilityBadge} instead of ${expectedBadge}`);
      }
      cards.push({
        id: expectedCard.id,
        label: expectedCard.label,
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
        capabilityState: state,
        capabilityBadge,
        catalogAnimationState: expectedCard.animationState,
        disabled: button.disabled,
      });
    }
    return { visibleCardCount: buttons.length, expectedCardCount: expectedCards.length, cards };
  }, { expectedCards: expected, requireExact: exact });
}

function readEditorLayout(gifPage) {
  return gifPage.evaluate(() => {
    const dock = document.querySelector('[role="separator"][aria-label="Resize side panel width"]');
    const timeline = document.querySelector('[role="separator"][aria-label="Resize timeline height"]');
    const dockWidth = Number(dock?.getAttribute("aria-valuenow"));
    const timelineHeight = Number(timeline?.getAttribute("aria-valuenow"));
    if (!Number.isFinite(dockWidth) || !Number.isFinite(timelineHeight)) throw new Error("Editor resize separators are missing their current values");
    return { dockWidth, timelineHeight };
  });
}

async function waitText(gifPage, ctx, selector, text) {
  await ctx.settle(gifPage.waitForFunction((css, expected) => [...document.querySelectorAll(css)].some((element) => element.textContent?.trim() === expected), {}, selector, text), { label: `wait for ${text}` });
}

async function waitForEditorRender(status, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = (await status.innerText()).trim();
    if (value.startsWith("Timeline rendered to ") || (value && value !== "Rendering the edited timeline…")) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the presenter comparison editor render");
}

async function measurePresenterBackgroundStability(ffmpegPath, file) {
  const width = 256;
  const height = 256;
  const topRows = 80;
  const bottomRows = 55;
  const cornerColumns = 72;
  const faceExclusion = { left: 72, top: 40, right: 184, bottom: 168 };
  const frameBytes = width * height;
  const { stdout } = await execFileAsync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-i", file, "-an",
    "-vf", `scale=${width}:${height}:flags=area,format=gray`,
    "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
  ], { windowsHide: true, timeout: 60_000, maxBuffer: 16 * 1024 * 1024, encoding: "buffer" });
  if (!Buffer.isBuffer(stdout) || stdout.length < frameBytes * 2 || stdout.length % frameBytes !== 0) {
    throw new Error(`Presenter background stability decoder returned invalid raw frames for ${file}`);
  }
  const frameCount = stdout.length / frameBytes;
  const backgroundPixelsPerFrame = (topRows + bottomRows) * cornerColumns * 2;
  const anchorPixelsPerFrame = frameBytes - ((faceExclusion.right - faceExclusion.left) * (faceExclusion.bottom - faceExclusion.top));
  const backgroundPerFrameMad = [];
  const anchorConsecutivePerFrameMad = [];
  const anchorSourcePerFrameMad = [];
  let backgroundActivePixels = 0;
  let anchorSourceActivePixels = 0;
  for (let frame = 1; frame < frameCount; frame += 1) {
    const priorOffset = (frame - 1) * frameBytes;
    const currentOffset = frame * frameBytes;
    let backgroundAbsoluteDifference = 0;
    let anchorConsecutiveAbsoluteDifference = 0;
    let anchorSourceAbsoluteDifference = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        const consecutiveDifference = Math.abs(stdout[currentOffset + pixel] - stdout[priorOffset + pixel]);
        const inCornerRows = y < topRows || y >= height - bottomRows;
        const inCornerColumns = x < cornerColumns || x >= width - cornerColumns;
        if (inCornerRows && inCornerColumns) {
          backgroundAbsoluteDifference += consecutiveDifference;
          if (consecutiveDifference > 3) backgroundActivePixels += 1;
        }
        const insideFace = x >= faceExclusion.left && x < faceExclusion.right
          && y >= faceExclusion.top && y < faceExclusion.bottom;
        if (!insideFace) {
          const sourceDifference = Math.abs(stdout[currentOffset + pixel] - stdout[pixel]);
          anchorConsecutiveAbsoluteDifference += consecutiveDifference;
          anchorSourceAbsoluteDifference += sourceDifference;
          if (sourceDifference > 3) anchorSourceActivePixels += 1;
        }
      }
    }
    backgroundPerFrameMad.push(backgroundAbsoluteDifference / backgroundPixelsPerFrame);
    anchorConsecutivePerFrameMad.push(anchorConsecutiveAbsoluteDifference / anchorPixelsPerFrame);
    anchorSourcePerFrameMad.push(anchorSourceAbsoluteDifference / anchorPixelsPerFrame);
  }
  const percentile95 = (values) => {
    const ordered = [...values].sort((left, right) => left - right);
    return ordered[Math.max(0, Math.ceil(ordered.length * 0.95) - 1)];
  };
  return {
    method: "background-corner consecutive and non-facial anchor consecutive/source luma MAD at 256x256",
    decodedFrames: frameCount,
    backgroundCornerP95Mad: Number(percentile95(backgroundPerFrameMad).toFixed(4)),
    backgroundCornerMaximumMad: Number(Math.max(...backgroundPerFrameMad).toFixed(4)),
    backgroundCornerActivePixelsOver3Percent: Number(((backgroundActivePixels / (backgroundPixelsPerFrame * backgroundPerFrameMad.length)) * 100).toFixed(3)),
    nonFacialAnchorConsecutiveP95Mad: Number(percentile95(anchorConsecutivePerFrameMad).toFixed(4)),
    nonFacialAnchorSourceP95Mad: Number(percentile95(anchorSourcePerFrameMad).toFixed(4)),
    nonFacialAnchorSourceMaximumMad: Number(Math.max(...anchorSourcePerFrameMad).toFixed(4)),
    nonFacialAnchorSourceActivePixelsOver3Percent: Number(((anchorSourceActivePixels / (anchorPixelsPerFrame * anchorSourcePerFrameMad.length)) * 100).toFixed(3)),
    faceExclusion,
    limits: {
      backgroundCornerP95Mad: 0.5,
      backgroundCornerActivePixelsOver3Percent: 1,
      nonFacialAnchorConsecutiveP95Mad: 0.5,
      nonFacialAnchorSourceP95Mad: 0.75,
      nonFacialAnchorSourceActivePixelsOver3Percent: 2,
    },
  };
}

async function probeMedia(ffprobePath, file) {
  const { stdout } = await execFileAsync(ffprobePath, ["-v", "error", "-show_entries", "format=duration:stream=index,codec_type,codec_name,width,height,pix_fmt,r_frame_rate,sample_rate,channels,duration", "-of", "json", file], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
  const value = JSON.parse(stdout);
  const durationSeconds = Number(value.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error(`ffprobe returned no duration for ${file}`);
  return { durationSeconds, video: value.streams?.find((stream) => stream.codec_type === "video") ?? null, audio: value.streams?.find((stream) => stream.codec_type === "audio") ?? null };
}

export async function inspectAnimatedWebp(file) {
  const data = await readFile(file);
  if (data.length < 20 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error(`Animated WebP is not a RIFF WEBP file: ${file}`);
  }
  const declaredRiffBytes = data.readUInt32LE(4) + 8;
  if (declaredRiffBytes !== data.length) {
    throw new Error(`Animated WebP RIFF size ${declaredRiffBytes} does not match file size ${data.length}: ${file}`);
  }
  let cursor = 12;
  let canvas = null;
  let hasAnimationHeader = false;
  let frameCount = 0;
  let durationMs = 0;
  while (cursor + 8 <= data.length) {
    const fourCc = data.toString("ascii", cursor, cursor + 4);
    const payloadBytes = data.readUInt32LE(cursor + 4);
    const payloadStart = cursor + 8;
    const payloadEnd = payloadStart + payloadBytes;
    if (payloadEnd > data.length) throw new Error(`Animated WebP chunk ${fourCc} exceeds the RIFF boundary: ${file}`);
    if (fourCc === "VP8X") {
      if (payloadBytes < 10) throw new Error(`Animated WebP has a truncated VP8X chunk: ${file}`);
      canvas = {
        animationFlag: Boolean(data[payloadStart] & 0x02),
        width: 1 + data.readUIntLE(payloadStart + 4, 3),
        height: 1 + data.readUIntLE(payloadStart + 7, 3),
      };
    } else if (fourCc === "ANIM") {
      if (payloadBytes < 6) throw new Error(`Animated WebP has a truncated ANIM chunk: ${file}`);
      hasAnimationHeader = true;
    } else if (fourCc === "ANMF") {
      if (payloadBytes < 16) throw new Error(`Animated WebP has a truncated ANMF chunk: ${file}`);
      frameCount += 1;
      durationMs += data.readUIntLE(payloadStart + 12, 3);
    }
    cursor = payloadEnd + (payloadBytes % 2);
  }
  if (cursor !== data.length || !canvas?.animationFlag || !hasAnimationHeader || frameCount <= 1 || durationMs <= 0) {
    throw new Error(`Animated WebP is missing a complete VP8X/ANIM/ANMF sequence: ${JSON.stringify({ file, cursor, bytes: data.length, canvas, hasAnimationHeader, frameCount, durationMs })}`);
  }
  return {
    demux: "RIFF VP8X/ANIM/ANMF",
    durationSeconds: durationMs / 1000,
    frameCount,
    loopCount: data.readUInt16LE(findWebpChunkPayload(data, "ANIM") + 4),
    video: { codec_name: "webp", width: canvas.width, height: canvas.height },
    audio: null,
  };
}

function findWebpChunkPayload(data, expectedFourCc) {
  let cursor = 12;
  while (cursor + 8 <= data.length) {
    const fourCc = data.toString("ascii", cursor, cursor + 4);
    const payloadBytes = data.readUInt32LE(cursor + 4);
    if (fourCc === expectedFourCc) return cursor + 8;
    cursor += 8 + payloadBytes + (payloadBytes % 2);
  }
  throw new Error(`WebP has no ${expectedFourCc} chunk`);
}

async function probeFirstAudibleAudio(ffprobePath, file) {
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=sample_rate:packet=pts_time:packet_side_data=side_data_type,skip_samples",
    "-of", "json", "-read_intervals", "%+#1", file,
  ], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
  const value = JSON.parse(stdout);
  const packet = value.packets?.[0];
  const packetPtsSeconds = Number(packet?.pts_time);
  const sampleRateHz = Number(value.streams?.[0]?.sample_rate);
  const skipSamples = Number(packet?.side_data_list?.find((entry) => entry.side_data_type === "Skip Samples")?.skip_samples ?? 0);
  const audibleSeconds = packetPtsSeconds + (skipSamples / sampleRateHz);
  if (!Number.isFinite(packetPtsSeconds) || !Number.isFinite(sampleRateHz) || sampleRateHz <= 0
    || !Number.isSafeInteger(skipSamples) || skipSamples < 0 || !Number.isFinite(audibleSeconds) || audibleSeconds < -0.001) {
    throw new Error(`Muxed walkthrough has no valid first audible audio timestamp: ${JSON.stringify(value)}`);
  }
  return { packetPtsSeconds, skipSamples, sampleRateHz, audibleSeconds: Math.max(0, audibleSeconds) };
}

async function measureLoudness(ffmpegPath, file) {
  const { stderr } = await execFileAsync(ffmpegPath, [
    "-hide_banner", "-nostats", "-i", file,
    "-map", "0:a:0", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
    "-f", "null", "NUL",
  ], { encoding: "utf8", windowsHide: true, timeout: 300_000, maxBuffer: 2 * 1024 * 1024 });
  const match = stderr.match(/\{\s*"input_i"[\s\S]*?\}/u);
  if (!match) throw new Error("FFmpeg loudness analysis returned no JSON measurement");
  const measurement = JSON.parse(match[0]);
  const integratedLufs = Number(measurement.input_i);
  const truePeakDbtp = Number(measurement.input_tp);
  const loudnessRangeLu = Number(measurement.input_lra);
  if (![integratedLufs, truePeakDbtp, loudnessRangeLu].every(Number.isFinite)) {
    throw new Error(`FFmpeg loudness analysis returned invalid measurements: ${match[0]}`);
  }
  return {
    integratedLufs,
    truePeakDbtp,
    loudnessRangeLu,
    targetIntegratedLufs: -16,
    maximumTruePeakDbtp: -1.5,
    measurement: "EBU R128 loudnorm analysis of final mux",
  };
}

async function createReadmeWebp(ffmpegPath, ffprobePath, source, output) {
  const profiles = [
    { width: 960, fps: 8, quality: 72 },
    { width: 800, fps: 6, quality: 66 },
  ];
  const maximumBytes = 18 * 1024 * 1024;
  const sourceProbe = await probeMedia(ffprobePath, source);
  for (const profile of profiles) {
    await execFileAsync(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y", "-i", source, "-an",
      "-vf", `fps=${profile.fps},scale=${profile.width}:-2:flags=lanczos`,
      "-c:v", "libwebp", "-lossless", "0", "-quality", String(profile.quality),
      "-compression_level", "6", "-loop", "0", output,
    ], { windowsHide: true, timeout: 600_000 });
    const details = await assertRegularFile(output, "README animated WebP");
    if (details.size <= maximumBytes) {
      const probe = await inspectAnimatedWebp(output);
      const expectedHeight = Math.round(sourceProbe.video.height * profile.width / sourceProbe.video.width / 2) * 2;
      if (probe.video.codec_name !== "webp" || probe.video.width !== profile.width || probe.video.height !== expectedHeight
        || probe.audio !== null || Math.abs(probe.durationSeconds - sourceProbe.durationSeconds) > 0.5) {
        throw new Error(`README animated WebP failed media validation: ${JSON.stringify(probe)}`);
      }
      return {
        path: output,
        sha256: await sha256File(output),
        bytes: details.size,
        maximumBytes,
        profile,
        probe,
      };
    }
  }
  const details = await stat(output);
  throw new Error(`README animated WebP is ${details.size} bytes; maximum is ${maximumBytes}`);
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

function isDigest(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

async function assertRegularFile(file, label) {
  const details = await stat(file).catch((error) => { throw new Error(`${label} is unavailable at ${file}: ${error.message}`); });
  if (!details.isFile() || details.size <= 0) throw new Error(`${label} is not a non-empty regular file: ${file}`);
  return details;
}
