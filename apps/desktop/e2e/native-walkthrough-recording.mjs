/* global document, Event, HTMLButtonElement, HTMLElement, HTMLSelectElement, HTMLVideoElement, localStorage, setTimeout, window */

import { expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const comparisonTitle = "Presenter style comparison";
const expectedAudioSha256 = "aba3ba62f6b29285fb01694df08baa4cad237bb97cb93f3ffcba14472425a1db";
const expectedBaseConfigSha256 = "0b1bf11a4f927eeaf9fe0ce5439d438a880074a23f25ecc9c1360766494a622a";
const expectedPresenters = Object.freeze([
  { slug: "emma", label: "Emma · realistic", profileId: "presenter-portrait.casual-emma-v1", videoSha256: "e86b11f911ddb2743d9cf0f94ddde8e807bb7dc686fab23c1e9a7fa6f1e4c84f" },
  { slug: "yuki", label: "Yuki · anime", profileId: "presenter-portrait.casual-yuki-v1", videoSha256: "c758f3fbb2d32919ac9a7c47311bd3ca44ab20953b0887981f4bf1b481ce942d" },
  { slug: "noah", label: "Noah · realistic", profileId: "presenter-portrait.casual-noah-v1", videoSha256: "45487cb1f5868c78ad43ab3ea566f83527292201b70c54380d3b56205b262839" },
  { slug: "chloe", label: "Chloe · cartoon", profileId: "presenter-portrait.casual-chloe-v1", videoSha256: "a451cac003cbc7aebaa091dec9ba2691ee9b9b7cb79b36acd2c8e9fa339f89d5" },
]);
const expectedGalleryPresenters = Object.freeze([
  { id: "presenter-portrait.casual-realistic-emma-v1", label: "Emma · casual home-studio tutor", hash: "27ac749dc0b30c2676d327e2a14fd05f873aee401d4b97bdd684eaab7c42a7f7", runtimeModel: "liveportrait-musetalk-1.5" },
  { id: "presenter-portrait.casual-anime-yuki-v1", label: "Yuki · casual anime coding tutor", hash: "54f695769e64273cc3a6e7f12742df8b8bfb7b6e844f302daabbf270e6a3aebb", runtimeModel: "liveportrait-musetalk-1.5" },
  { id: "presenter-portrait.casual-realistic-noah-v1", label: "Noah · casual maker tutor", hash: "6f83257ec713c8d0df42ebb1506b9be32735bec9934aa5c2e946e24cbed8c0bd", runtimeModel: "liveportrait-musetalk-1.5" },
  { id: "presenter-portrait.casual-cartoon-chloe-v1", label: "Chloe · cartoon science creator", hash: "4afecb9e0141a3bcb933aca577222adfa7819fd3dc49a9b437f1b1bc0f3437ca", runtimeModel: "liveportrait-musetalk-1.5" },
  { id: "presenter-portrait.casual-realistic-maya-v1", label: "Maya · casual science tutor", hash: "62ee0fd94a0e92114e000e89a6420e9ce0c7726e5b4b8ec2165c041f2252e79b", runtimeModel: "liveportrait-musetalk-1.5" },
  { id: "presenter-portrait.casual-anime-finn-v1", label: "Finn · retro anime maker tutor", hash: "98ff859669a316dcbf2f1b8edd30941b355ee244308a3b755ffd51e4630a8494", runtimeModel: "joyvasa-human" },
  { id: "presenter-portrait.casual-anime-lena-v1", label: "Lena · hand-painted anime nature tutor", hash: "280c530e69c08737698c0fff8b0a582ac76fb9799cf0ad6a780d540c68f667f1", runtimeModel: "liveportrait-musetalk-1.5" },
  { id: "presenter-portrait.casual-cartoon-robot-pip-v1", label: "Pip · cartoon robot tutor", hash: "b0163d6e3250d345c97e1c261fa3ff69cf0dcab70f248cad27a06dfe5e818d29", runtimeModel: "joyvasa-animal" },
  { id: "presenter-portrait.animal-cat-milo-v1", label: "Milo · cat science tutor", hash: "f47095f9b54b54d53fecfa49a93241544869aa359d8ce3273b38a8575965bafd", runtimeModel: "joyvasa-animal", animal: true },
  { id: "presenter-portrait.animal-kitten-peaches-v1", label: "Peaches · clay kitten tutor", hash: "6cb3c5727c422ac6e717f64c8c345abb757f65c5399555e5c0058f7db3524ab1", runtimeModel: "joyvasa-animal", animal: true },
  { id: "presenter-portrait.animal-dog-buddy-v1", label: "Buddy · dog workshop tutor", hash: "68fa5cd79ebb50e9b0a5b00d2c28d2d636bee695f0b579f1a36afaa62aa25062", runtimeModel: "joyvasa-animal", animal: true },
  { id: "presenter-portrait.animal-puppy-poppy-v1", label: "Poppy · storybook puppy tutor", hash: "704dce7be0612822ff0dc10ebfce8627cd808e63a0b3e158fa070fe19f8d633a", runtimeModel: "joyvasa-animal", animal: true },
  { id: "presenter-portrait.animal-tiger-tavi-v1", label: "Tavi · tiger science tutor", hash: "e8fb1f4d917377a68d379ffd734463f97b20ef2238b7f9d32fff389c86000ae5", runtimeModel: "joyvasa-animal", animal: true },
  { id: "presenter-portrait.animal-lion-leo-v1", label: "Leo · clay lion tutor", hash: "7694fb148894a41dcf4df55182bd803946a3d18f9a7a81daaf3cb3987411894e", runtimeModel: "joyvasa-animal", animal: true },
]);

export async function inspectPackagedPresenterPlatform({ starterManifestPath, runtimeStatuses }) {
  await assertRegularFile(starterManifestPath, "packaged starter visual manifest");
  const manifest = JSON.parse(await readFile(starterManifestPath, "utf8"));
  if (!Array.isArray(manifest.assets)) throw new Error("Packaged starter visual manifest has no asset catalog");
  const readyVisuals = manifest.assets.filter((asset) => (
    asset?.source?.availability === "ready"
    && typeof asset?.technical?.mediaType === "string"
    && asset.technical.mediaType.startsWith("image/")
  ));
  if (readyVisuals.length !== 55) {
    throw new Error(`Packaged starter visual manifest has ${readyVisuals.length} ready images instead of 55`);
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
    return { id: asset.id, label: asset.name, sha256: asset.source.contentHash, mediaType: asset.technical.mediaType };
  });

  if (!Array.isArray(runtimeStatuses)) throw new Error("Native presenter runtime status did not return an array");
  const primary = runtimeStatuses.filter((status) => status?.portraitArtifactHash === null);
  const overrides = runtimeStatuses.filter((status) => typeof status?.portraitArtifactHash === "string");
  if (runtimeStatuses.length !== 9 || primary.length !== 1 || overrides.length !== 8
    || primary[0].configured !== true || primary[0].modelId !== "liveportrait-musetalk-1.5") {
    throw new Error(`Native presenter runtime status does not contain one configured MuseTalk primary and eight exact overrides: ${JSON.stringify(runtimeStatuses)}`);
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
    };
  });
  if (!isDigest(primary[0].installFingerprint) || typeof primary[0].modelRevision !== "string" || !primary[0].modelRevision.trim()) {
    throw new Error("Native primary presenter runtime has no pinned installation identity");
  }
  return {
    starterManifestPath,
    starterManifestSha256: await sha256File(starterManifestPath),
    readyVisualCount: readyVisuals.length,
    casualAndAnimalPresenterCount: catalog.length,
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

export async function inspectPresenterAcceptance({ root, ffprobePath }) {
  const resolvedRoot = path.resolve(root);
  const reportPath = path.join(resolvedRoot, "probe-report.json");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  if (report?.schemaVersion !== 1 || report.status !== "complete"
    || report.audioSha256 !== expectedAudioSha256
    || report.baseConfigSha256 !== expectedBaseConfigSha256
    || typeof report.audioSource !== "string" || !report.audioSource
    || !Array.isArray(report.results) || report.results.length !== expectedPresenters.length) {
    throw new Error("Presenter comparison source report is not the reviewed four-style acceptance set");
  }
  await assertRegularFile(report.audioSource, "presenter comparison source narration");
  if (await sha256File(report.audioSource) !== expectedAudioSha256) {
    throw new Error("Presenter comparison source narration differs from the reviewed audio hash");
  }
  const clips = [];
  let runtimeRevision = null;
  for (const expected of expectedPresenters) {
    const result = report.results.find((item) => item?.slug === expected.slug);
    const videoPath = path.join(resolvedRoot, "clips", `${expected.slug}.mp4`);
    const details = await assertRegularFile(videoPath, `${expected.slug} presenter clip`);
    const probe = await probeMedia(ffprobePath, videoPath);
    if (!result || result.status !== "complete" || result.profileId !== expected.profileId
      || result.videoSha256 !== expected.videoSha256 || await sha256File(videoPath) !== expected.videoSha256
      || result.metadata?.narrationArtifactHash !== expectedAudioSha256
      || result.metadata?.modelId !== "liveportrait-musetalk-1.5"
      || result.metadata?.provider !== "local-presenter"
      || result.metadata?.localOnly !== true
      || result.metadata?.probe?.verified !== true
      || typeof result.metadata?.modelRevision !== "string" || !result.metadata.modelRevision
      || Math.abs(probe.durationSeconds - 8.2) > 0.04
      || probe.video?.codec_name !== "h264" || probe.video.width !== 1254 || probe.video.height !== 1254
      || probe.audio?.codec_name !== "aac") {
      throw new Error(`Presenter comparison source ${expected.slug} does not match its reviewed real lip-sync receipt`);
    }
    runtimeRevision ??= result.metadata.modelRevision;
    if (result.metadata.modelRevision !== runtimeRevision) throw new Error("Presenter comparison clips do not share one pinned runtime revision");
    clips.push({ ...expected, path: videoPath, bytes: details.size, probe });
  }
  return {
    root: resolvedRoot,
    reportPath,
    reportSha256: await sha256File(reportPath),
    audioSource: report.audioSource,
    audioSha256: report.audioSha256,
    baseConfigSha256: report.baseConfigSha256,
    modelId: "liveportrait-musetalk-1.5",
    runtimeRevision,
    clips,
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
  onIdentity,
}) {
  const initialSnapshot = comparisonProjectDocument();
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
    const startFrame = index * 246;
    await editor.getByLabel("Playhead timecode").fill(frameTimecode(startFrame));
    await editor.getByLabel("Playhead timecode").press("Enter");
    await presenterTrackButton.click();
    await editor.getByRole("button", { name: "Media", exact: true }).click();
    const card = editor.getByRole("listitem").filter({ hasText: `${clip.slug}.mp4` });
    await card.getByRole("button", { name: `Place ${clip.slug}.mp4 at playhead` }).click();
    await expect(editor.locator(".aly-editor-clip--presenter").filter({ hasText: `${clip.slug}.mp4` })).toBeVisible();
    await editor.getByRole("button", { name: "Add title", exact: true }).click();
    await editor.getByLabel("On-screen text").fill(clip.label);
  }
  await expect(editor.locator(".aly-editor-clip--presenter")).toHaveCount(4);
  await expect(editor.locator(".aly-editor-clip--titles")).toHaveCount(4);
  await expect.poll(() => editor.locator(".aly-editor-clip__waveform img").count(), { timeout: 90_000 }).toBeGreaterThanOrEqual(4);

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
  if (!outputProbe.video || !outputProbe.audio || Math.abs(outputProbe.durationSeconds - 32.8) > 0.15) {
    throw new Error(`Presenter comparison export is not an audible 32.8 second video: ${JSON.stringify(outputProbe)}`);
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
  return {
    title: comparisonTitle,
    identity,
    outputPath,
    outputSha256: await sha256File(outputPath),
    outputBytes: outputDetails.size,
    outputProbe,
    durableHeadRevisionId: saved.headRevisionId,
    durableRevisionNumber: saved.revisionNumber,
    persistedTimeline: persisted,
    sourceAudioSha256: presenterAcceptance.audioSha256,
    presenterOrder: presenterAcceptance.clips.map((clip) => ({
      slug: clip.slug,
      label: clip.label,
      profileId: clip.profileId,
      sourceSha256: clip.videoSha256,
      startFrame: presenterAcceptance.clips.indexOf(clip) * 246,
      durationFrames: 246,
    })),
    builtThroughNativeEditorUi: true,
    generatedProviderCalls: 0,
    localInferenceCalls: 0,
  };
}

export async function recordNativeWalkthrough({
  page,
  cdpPort,
  gifsmithRoot,
  runRoot,
  ffmpegPath,
  ffprobePath,
  skyProjectTitle,
  localImageProjectTitle,
  comparison,
  presenterPlatform,
}) {
  if (presenterPlatform?.readyVisualCount !== 55 || presenterPlatform?.casualAndAnimalPresenterCount !== 14
    || presenterPlatform?.runtimeStatusCount !== 9 || presenterPlatform?.exactJoyRoutes?.length !== 8) {
    throw new Error("Presenter platform evidence was not validated before native walkthrough capture");
  }
  const recordingWindow = await showRecordingWindow(page);
  await navigateGlobal(page, "Home");
  const gifsmithEntry = path.join(path.resolve(gifsmithRoot), "dist", "index.js");
  await assertRegularFile(gifsmithEntry, "built Gifsmith entrypoint");
  const { cursor, render, timeline, tauri } = await import(pathToFileURL(gifsmithEntry).href);
  const silentPath = path.join(runRoot, "alystria-native-walkthrough.silent.mp4");
  let comparisonPlaybackOffsetMs = null;
  let comparisonPlayingEventMediaTime = null;
  let editorLayoutBefore = null;
  let editorLayoutAfter = null;
  let presenterGalleryEvidence = null;
  const walkthrough = timeline((t) => {
    t.waitFor(".app-shell", { timeoutMs: 30_000 });
    t.cue("Home");
    t.hold(4);
    t.call(async (gifPage, ctx) => {
      await clickAria(gifPage, ctx, "Projects");
      await waitText(gifPage, ctx, "h1", "Projects");
    }, { name: "Open project gallery", seconds: 1 });
    t.cue("Project gallery");
    t.hold(5);
    t.call(async (gifPage, ctx) => {
      await clickAria(gifPage, ctx, "Models & providers");
      await waitText(gifPage, ctx, "h1", "Models & providers");
    }, { name: "Open model manager", seconds: 1 });
    t.cue("Models and downloads");
    t.hold(8);
    t.call(async (gifPage, ctx) => {
      await clickAriaPrefix(gifPage, ctx, "Downloads");
      await ctx.settle(gifPage.waitForSelector('[aria-label="Model downloads"]', { visible: true }), { label: "model downloads panel" });
    }, { name: "Open download panel", seconds: 1 });
    t.hold(5);
    t.call(async (gifPage, ctx) => { await clickAria(gifPage, ctx, "Minimize downloads"); }, { name: "Minimize download panel", seconds: 0.5 });
    t.call(async (gifPage, ctx) => {
      await clickAria(gifPage, ctx, "Library");
      await waitText(gifPage, ctx, "h1", "Library");
    }, { name: "Open included asset library", seconds: 1 });
    t.cue("Included teaching assets");
    t.hold(5);
    t.scroll(".main-content", 420, 1.5);
    t.hold(2);
    t.call(async (gifPage, ctx) => {
      await clickAria(gifPage, ctx, "Projects");
      await waitText(gifPage, ctx, "h1", "Projects");
      await clickProjectCard(gifPage, ctx, comparison.title);
      await clickAria(gifPage, ctx, "Plan");
      await clickTextButton(gifPage, ctx, "Presenters");
      await ctx.settle(gifPage.waitForSelector(".presenter-picker__gallery", { visible: true }), { label: "presenter gallery" });
      presenterGalleryEvidence = {
        allStyles: await ctx.settle(readPresenterGallery(gifPage, expectedGalleryPresenters, false), { label: "read all casual presenter cards" }),
      };
    }, { name: "Open actual presenter cast gallery", seconds: 2 });
    t.cue("Fourteen casual and animal presenters");
    t.hold(5);
    t.call(async (gifPage, ctx) => {
      await selectAriaOption(gifPage, ctx, "Presenter visual style", "Animal");
      const animals = expectedGalleryPresenters.filter((presenter) => presenter.animal);
      presenterGalleryEvidence.animals = await ctx.settle(readPresenterGallery(gifPage, animals, true), { label: "read animal presenter cards" });
    }, { name: "Filter presenter gallery to animals", seconds: 1 });
    t.cue("Animal presenter collection");
    t.hold(7);
    t.call(async (gifPage, ctx) => { await clickCss(gifPage, ctx, ".project-switcher"); await waitText(gifPage, ctx, "h1", "Projects"); }, { name: "Return to project gallery", seconds: 1 });
    t.call(async (gifPage, ctx) => { await clickProjectCard(gifPage, ctx, localImageProjectTitle); await clickAria(gifPage, ctx, "Studio"); }, { name: "Open accepted local artwork", seconds: 1 });
    t.cue("Accepted local SDXL artwork");
    t.hold(10);
    t.call(async (gifPage, ctx) => { await clickCss(gifPage, ctx, ".project-switcher"); await clickProjectCard(gifPage, ctx, skyProjectTitle); await clickAria(gifPage, ctx, "Review"); }, { name: "Open completed generated tutorial", seconds: 1 });
    t.cue("Completed tutorial");
    t.hold(4);
    t.call(async (gifPage, ctx) => {
      await ctx.settle(gifPage.evaluate(async () => {
        const video = document.querySelector('video[aria-label="Authoritative generated tutorial media"]');
        if (!(video instanceof HTMLVideoElement)) throw new Error("Completed tutorial review video is missing");
        video.muted = true;
        video.currentTime = 0;
        await video.play();
      }), { label: "play completed tutorial" });
      await ctx.advance(9_000);
      await ctx.settle(gifPage.evaluate(() => {
        const video = document.querySelector('video[aria-label="Authoritative generated tutorial media"]');
        if (video instanceof HTMLVideoElement) video.pause();
      }));
    }, { name: "Play completed tutorial excerpt", seconds: 9 });
    t.call(async (gifPage, ctx) => { await clickAria(gifPage, ctx, "Studio"); await clickTextButton(gifPage, ctx, "Advanced editor"); }, { name: "Open integrated editor", seconds: 1 });
    t.cue("Integrated editor");
    t.hold(4);
    t.call(async (gifPage, ctx) => { await clickAria(gifPage, ctx, "Transcript"); }, { name: "Open transcript panel", seconds: 0.5 });
    t.hold(5);
    t.call(async (gifPage, ctx) => {
      editorLayoutBefore = await ctx.settle(readEditorLayout(gifPage), { label: "read editor layout before resize" });
    }, { name: "Measure editor layout before resize" });
    t.drag('[role="separator"][aria-label="Resize side panel width"]', { dx: 170, dy: 0 }, 1.2);
    t.drag('[role="separator"][aria-label="Resize timeline height"]', { dx: 0, dy: -120 }, 1.2);
    t.call(async (gifPage, ctx) => {
      editorLayoutAfter = await ctx.settle(readEditorLayout(gifPage), { label: "read editor layout after resize" });
      if (editorLayoutAfter.dockWidth <= editorLayoutBefore.dockWidth || editorLayoutAfter.timelineHeight <= editorLayoutBefore.timelineHeight) {
        throw new Error(`Editor panel drags did not enlarge both regions: ${JSON.stringify({ editorLayoutBefore, editorLayoutAfter })}`);
      }
    }, { name: "Verify editor panel resize" });
    t.hold(5);
    t.call(async (gifPage, ctx) => { await clickAria(gifPage, ctx, "Media"); }, { name: "Open editor media panel", seconds: 0.5 });
    t.hold(4);
    t.call(async (gifPage, ctx) => { await clickAriaPrefix(gifPage, ctx, "Return to scene"); await clickCss(gifPage, ctx, ".project-switcher"); await clickProjectCard(gifPage, ctx, comparison.title); await clickAria(gifPage, ctx, "Review"); }, { name: "Open presenter style comparison", seconds: 1.5 });
    t.cue("Presenter style comparison");
    t.hold(4);
    t.call(async (gifPage, ctx) => {
      const event = await ctx.settle(gifPage.evaluate(async () => {
        const video = document.querySelector('video[aria-label="Authoritative generated tutorial media"]');
        if (!(video instanceof HTMLVideoElement)) throw new Error("Presenter comparison Review video is missing");
        video.currentTime = 0;
        video.muted = true;
        await new Promise((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error("Comparison video never emitted playing")), 10_000);
          video.addEventListener("playing", () => { window.clearTimeout(timeout); resolve(); }, { once: true });
          void video.play().catch(reject);
        });
        return { currentTime: video.currentTime, readyState: video.readyState };
      }), { capMs: 12_000, label: "comparison playing event" });
      comparisonPlaybackOffsetMs = ctx.nowMs();
      comparisonPlayingEventMediaTime = event.currentTime;
      await ctx.advance(33_200);
      await ctx.settle(gifPage.evaluate(() => {
        const video = document.querySelector('video[aria-label="Authoritative generated tutorial media"]');
        if (video instanceof HTMLVideoElement) video.pause();
      }));
    }, { name: "Play four presenter styles", seconds: 33.2 });
    t.cue("Four real lip-sync styles complete");
    t.hold(4);
  });
  const result = await render({
    target: tauri({ port: cdpPort }),
    out: silentPath,
    format: "mp4",
    alsoEmit: ["gif"],
    viewport: { width: 1920, height: 1080 },
    capture: "screencast",
    compose: "overlay",
    props: [cursor({ start: { x: 112, y: 96 } })],
    loop: "none",
    review: true,
    timeline: walkthrough,
    encode: { width: 1440, fps: 16, speed: 1, colors: 160, mp4Crf: 18 },
    logLevel: "info",
  });
  if (!Number.isFinite(comparisonPlaybackOffsetMs) || comparisonPlaybackOffsetMs <= 0
    || !Number.isFinite(comparisonPlayingEventMediaTime) || comparisonPlayingEventMediaTime < 0 || comparisonPlayingEventMediaTime > 0.08) {
    throw new Error("Gifsmith recording did not observe the comparison Review playing event");
  }
  if (!editorLayoutBefore || !editorLayoutAfter) throw new Error("Gifsmith recording did not verify the editor panel resizes");
  if (!presenterGalleryEvidence?.allStyles || !presenterGalleryEvidence?.animals) {
    throw new Error("Gifsmith recording did not verify the actual casual and animal presenter gallery");
  }
  const silentOutput = result.outputs.find((output) => output.format === "mp4")?.path ?? silentPath;
  const gifOutput = result.outputs.find((output) => output.format === "gif")?.path;
  const finalPath = path.join(runRoot, "alystria-native-walkthrough.mp4");
  const offsetSeconds = comparisonPlaybackOffsetMs / 1000;
  await execFileAsync(ffmpegPath, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", silentOutput,
    "-itsoffset", offsetSeconds.toFixed(6), "-i", comparison.outputPath,
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart", finalPath,
  ], { windowsHide: true, timeout: 300_000 });
  const [silentProbe, finalProbe, firstAudioPacketSeconds] = await Promise.all([
    probeMedia(ffprobePath, silentOutput),
    probeMedia(ffprobePath, finalPath),
    probeFirstAudioPacket(ffprobePath, finalPath),
  ]);
  const driftMs = Math.abs(firstAudioPacketSeconds * 1000 - comparisonPlaybackOffsetMs);
  if (finalProbe.video?.codec_name !== "h264" || finalProbe.video.width !== 1440 || finalProbe.video.height !== 810
    || finalProbe.video.pix_fmt !== "yuv420p" || finalProbe.video.r_frame_rate !== "16/1" || finalProbe.audio?.codec_name !== "aac"
    || finalProbe.durationSeconds < 90 || finalProbe.durationSeconds > 150
    || Math.abs(finalProbe.durationSeconds - silentProbe.durationSeconds) > 0.12 || driftMs > 80) {
    throw new Error(`Recorded walkthrough media failed duration/audio timing validation: ${JSON.stringify({ silentProbe, finalProbe, firstAudioPacketSeconds, comparisonPlaybackOffsetMs, driftMs })}`);
  }
  return {
    evidenceClass: "actual-native-gifsmith-walkthrough-with-measured-review-audio-mux",
    actualNativeWebView: true,
    fixtureUi: false,
    providerCalls: 0,
    localInferenceCalls: 0,
    completedTutorialKeptSeparate: true,
    presenterPlatform,
    presenterGalleryEvidence,
    recordingWindow,
    editorResizeEvidence: { before: editorLayoutBefore, after: editorLayoutAfter },
    comparisonAudioSource: "exact native editor comparison export",
    comparisonAudioSourceSha256: comparison.outputSha256,
    comparisonPlaybackOffsetMs,
    comparisonPlayingEventMediaTime,
    firstMuxedAudioPacketMs: firstAudioPacketSeconds * 1000,
    audioEventDriftMs: driftMs,
    maxAllowedAudioEventDriftMs: 80,
    silentCapture: { path: silentOutput, sha256: await sha256File(silentOutput), ...silentProbe },
    finalVideo: { path: finalPath, sha256: await sha256File(finalPath), ...finalProbe },
    ...(gifOutput ? { gif: { path: gifOutput, sha256: await sha256File(gifOutput) } } : {}),
    gifsmith: {
      entrypoint: gifsmithEntry,
      entrypointSha256: await sha256File(gifsmithEntry),
      sourceFrames: result.sourceFrames,
      pacedFrames: result.pacedFrames,
      achievedCaptureFps: result.achievedCaptureFps,
      durationSeconds: result.durationSeconds,
      temporalReview: result.review ?? null,
      warnings: result.warnings,
    },
  };
}

function comparisonProjectDocument() {
  return {
    title: comparisonTitle,
    topic: "Compare four presenter visual styles using the same spoken reference phrase",
    description: "An edited native showcase of four separately rendered presenter clips. Each clip uses the same accepted narration so visual style and lip-sync can be compared honestly.",
    locale: "English",
    audience: "Tutorial creators",
    duration: 0.55,
    updatedAt: "just now",
    progress: 100,
    status: "Complete",
    theme: "Presenter comparison",
    privacy: "Local only",
    scenes: [{ id: "presenter-style-comparison", index: 1, title: comparisonTitle, kind: "comparison", duration: 32.8, narration: "The same reference phrase is repeated once by each presenter style.", objective: "Compare four actual local lip-sync outputs without mixing them into an unrelated tutorial.", status: "approved", visual: "summary", citations: 0, locked: false }],
    sources: [],
    presenterSelection: { schemaVersion: 1, mode: "on", presenters: [], sceneAssignments: [] },
    sceneCandidates: [],
    providerRoutingPolicy: {
      version: 1,
      privacyMode: "local",
      dataClassification: "project",
      approvals: [],
      routes: [{ capability: "lipsync.generate", model: "local/musetalk-1.5", providerIds: ["local-runtime"], voice: null }],
    },
  };
}

function frameTimecode(frame) {
  const seconds = Math.floor(frame / 30);
  const remainder = frame % 30;
  return `00:00:${String(seconds).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

async function navigateGlobal(page, label) {
  if (await page.getByRole("navigation", { name: /project workspace/i }).isVisible()) await page.locator(".project-switcher").click();
  await page.getByRole("navigation", { name: /areas/i }).getByRole("button", { name: label, exact: true }).click();
}

async function showRecordingWindow(page) {
  const metrics = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") throw new Error("Tauri window API is unavailable");
    await invoke("plugin:window|set_size", { label: "main", value: { Logical: { width: 1920, height: 1080 } } });
    await invoke("plugin:window|show", { label: "main" });
    const [scaleFactor, physicalSize] = await Promise.all([
      invoke("plugin:window|scale_factor", { label: "main" }),
      invoke("plugin:window|inner_size", { label: "main" }),
    ]);
    return { scaleFactor, physicalSize };
  });
  const scaleFactor = Number(metrics.scaleFactor);
  const width = Number(metrics.physicalSize?.width) / scaleFactor;
  const height = Number(metrics.physicalSize?.height) / scaleFactor;
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0 || Math.abs(width - 1920) > 2 || Math.abs(height - 1080) > 2) {
    throw new Error(`Native recording window did not reach 1920x1080 logical pixels: ${JSON.stringify(metrics)}`);
  }
  return { logicalWidth: width, logicalHeight: height, scaleFactor, physicalSize: metrics.physicalSize };
}

function assertPersistedComparisonTimeline(documentValue, presenterAcceptance) {
  if (!documentValue || documentValue.schema !== "alystria.editor.project.v1") {
    throw new Error("Presenter comparison editor document was not durably saved");
  }
  const presenterTrack = documentValue.tracks?.find((track) => track.kind === "presenter");
  const titleTrack = documentValue.tracks?.find((track) => track.kind === "titles");
  const clips = [...(presenterTrack?.clips ?? [])].sort((left, right) => left.timelineRange.startFrame - right.timelineRange.startFrame);
  const titles = [...(titleTrack?.clips ?? [])].sort((left, right) => left.timelineRange.startFrame - right.timelineRange.startFrame);
  if (clips.length !== expectedPresenters.length || titles.length !== expectedPresenters.length || documentValue.durationFrames !== 984) {
    throw new Error("Presenter comparison durable timeline does not contain four sequential clips and labels");
  }
  const assetById = new Map((documentValue.assets ?? []).map((asset) => [asset.id, asset]));
  const persistedOrder = clips.map((clip, index) => {
    const expected = presenterAcceptance.clips[index];
    const asset = assetById.get(clip.assetId);
    const title = titles[index];
    if (!expected || !asset || asset.hash !== expected.videoSha256
      || asset.provenance?.humanApproved !== true || asset.metadata?.exportEligible !== true
      || clip.timelineRange?.startFrame !== index * 246 || clip.timelineRange?.durationFrames !== 246
      || clip.sourceRange?.startFrame !== 0 || clip.sourceRange?.durationFrames !== 246
      || clip.metadata?.includeSourceAudio !== true || clip.audio?.muted !== false
      || title?.timelineRange?.startFrame !== index * 246 || title?.text !== expected.label) {
      throw new Error(`Presenter comparison durable clip ${index + 1} does not match ${expected?.slug ?? "the reviewed source"}`);
    }
    return {
      slug: expected.slug,
      assetHash: asset.hash,
      startFrame: clip.timelineRange.startFrame,
      durationFrames: clip.timelineRange.durationFrames,
      sourceAudioIncluded: true,
      label: title.text,
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
      cards.push({
        id: expectedCard.id,
        label: expectedCard.label,
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
        capabilityState: state,
        capabilityBadge: capability.textContent?.trim() ?? "",
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

async function probeMedia(ffprobePath, file) {
  const { stdout } = await execFileAsync(ffprobePath, ["-v", "error", "-show_entries", "format=duration:stream=index,codec_type,codec_name,width,height,pix_fmt,r_frame_rate,sample_rate,channels", "-of", "json", file], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
  const value = JSON.parse(stdout);
  const durationSeconds = Number(value.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error(`ffprobe returned no duration for ${file}`);
  return { durationSeconds, video: value.streams?.find((stream) => stream.codec_type === "video") ?? null, audio: value.streams?.find((stream) => stream.codec_type === "audio") ?? null };
}

async function probeFirstAudioPacket(ffprobePath, file) {
  const { stdout } = await execFileAsync(ffprobePath, ["-v", "error", "-select_streams", "a:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", "-read_intervals", "%+#1", file], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
  const value = Number(stdout.trim().split(/\r?\n/u)[0]);
  if (!Number.isFinite(value) || value < 0) throw new Error("Muxed walkthrough has no valid first audio packet timestamp");
  return value;
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
