import { chromium, expect } from "@playwright/test";
import { spawn, execFile } from "node:child_process";
import { open, readFile, rename, stat, writeFile, mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const portableIndex = process.argv.indexOf("--portable-root");
const mediaIndex = process.argv.indexOf("--media");
const projectTitleIndex = process.argv.indexOf("--project-title");
if (portableIndex < 0 || !process.argv[portableIndex + 1]) throw new Error("--portable-root is required");
if (mediaIndex < 0 || !process.argv[mediaIndex + 1]) throw new Error("--media is required");
const portableRoot = path.resolve(process.argv[portableIndex + 1]);
const mediaPath = path.resolve(process.argv[mediaIndex + 1]);
const requestedProjectTitle = projectTitleIndex >= 0 ? process.argv[projectTitleIndex + 1]?.trim() : null;
if (projectTitleIndex >= 0 && !requestedProjectTitle) throw new Error("--project-title requires a value");
const executable = path.join(portableRoot, "App", "AI Video Tutorial Generator.exe");
const appDataPath = path.join(portableRoot, "App Data");
const ffprobe = path.join(portableRoot, "Runtime", "ffmpeg", "ffprobe.exe");
const ffmpeg = path.join(portableRoot, "Runtime", "ffmpeg", "ffmpeg.exe");
const readyPath = path.join(portableRoot, "Evidence", "native-headless-ready.json");
const evidenceRoot = path.join(portableRoot, "Evidence", "native-editor-smoke");
const reportPath = path.join(evidenceRoot, "report.json");
const importedName = path.basename(mediaPath);
const editedTitle = "Durable media\nsurvives restart";
const closeProofTitle = "Durable media\nsurvives close";
let launch;
let report;
let workError;
let rotationSequence = 0;

await rotateExistingPath(evidenceRoot);
await mkdir(evidenceRoot, { recursive: true });
await rotateExistingPath(readyPath);
await stat(mediaPath);
try {
  launch = await startNative();
  const { page } = launch;
  await expect(page.locator(".runtime-badge")).toContainText("Worker ready", { timeout: 45_000 });
  let workspace = await page.evaluate(() => JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}"));
  const project = requestedProjectTitle
    ? workspace.projects?.find((candidate) => candidate.title === requestedProjectTitle)
    : workspace.projects?.find((candidate) => candidate.id === workspace.recentProjectId);
  if (!project?.nativeProjectId || !project?.nativeProjectDirectory) throw new Error("A recent native project is required; run native-recovery.mjs first");
  if (workspace.recentProjectId !== project.id) {
    await page.evaluate((projectId) => {
      const current = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
      localStorage.setItem("alystria-studio-v2", JSON.stringify({ ...current, recentProjectId: projectId }));
    }, project.id);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".runtime-badge")).toContainText("Worker ready", { timeout: 45_000 });
    workspace = await page.evaluate(() => JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}"));
  }
  await installNativeInvokeFailureRecorder(page);

  await page.getByRole("button", { name: /open project/i }).click();
  await expect(page.getByRole("navigation", { name: /project workspace/i })).toBeVisible({ timeout: 45_000 });
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /^studio$/i }).click();
  await page.getByRole("button", { name: /^edit tracks & timing/i }).click();
  let editor = page.getByRole("dialog", { name: "Integrated advanced video editor" });
  await expect(editor).toBeVisible({ timeout: 45_000 });

  const shortProject = editorFixture(project.nativeProjectId, project.title);
  await editor.getByLabel("Import editor project file").setInputFiles({
    name: "native-editor-cpu-proof.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(shortProject)),
  });
  await expect(editor.getByRole("heading", { name: shortProject.name })).toBeVisible();
  await editor.getByLabel("Rights for new editor media").selectOption("owned");
  await editor.getByLabel("Import media files").setInputFiles(mediaPath);
  let card = editor.getByRole("listitem").filter({ hasText: importedName });
  const importReceipt = editor.locator(".aly-editor-media-bin__receipts li").filter({ hasText: importedName });
  await expect.poll(async () => await card.count() + await importReceipt.count(), { timeout: 90_000 }).toBeGreaterThan(0);
  if (await card.count() === 0) {
    const persistedImport = await page.evaluate(({ id, name }) => {
      const state = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
      const document = state.projects?.find((candidate) => candidate.nativeProjectId === id)?.editorDocument;
      return document?.importReceipts?.findLast((receipt) => receipt.fileName === name) ?? null;
    }, { id: project.nativeProjectId, name: importedName });
    const rejectedNativeCommands = await page.evaluate(() => globalThis.__alystriaRejectedNativeCommands ?? []);
    const contentBase64 = (await readFile(mediaPath)).toString("base64");
    const directDiagnostic = await page.evaluate(async ({ identity, contentBase64, fileName }) => {
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (typeof invoke !== "function") return { unavailable: true };
      try {
        const snapshot = await invoke("project_snapshot_get", { input: identity });
        const result = await invoke("project_asset_import", { input: {
          ...identity,
          expectedHeadRevisionId: snapshot.headRevisionId,
          kind: "editorVideo",
          filename: fileName,
          mimeType: "video/webm",
          privacy: "project_local",
          rights: { status: "owned", commercialUse: "allowed", redistribution: "allowed", modelInput: "notAllowed" },
          contentBase64,
        } });
        return { succeeded: true, result };
      } catch (error) {
        return { succeeded: false, text: String(error), json: JSON.stringify(error), keys: error && typeof error === "object" ? Object.keys(error) : [] };
      }
    }, { identity: { projectId: project.nativeProjectId, projectDirectory: project.nativeProjectDirectory }, contentBase64, fileName: importedName });
    throw new Error(`Native editor import failed: ${JSON.stringify({ persistedImport, rejectedNativeCommands, directDiagnostic })}`);
  }
  await expect(card).toContainText("ready", { timeout: 90_000 });
  await card.getByRole("button", { name: `Place ${importedName} at playhead` }).click();

  let videoClip = editor.locator(".aly-editor-clip--slides").filter({ hasText: importedName }).first();
  await expect(videoClip).toBeVisible();
  await videoClip.click();
  await editor.getByRole("button", { name: "Inspector", exact: true }).click();
  await editor.getByLabel("End frame").fill("90");
  await editor.getByLabel("End frame").press("Enter");
  const titleClip = editor.locator(".aly-editor-clip--titles").first();
  await titleClip.click();
  await editor.getByRole("button", { name: "Inspector", exact: true }).click();
  await editor.getByLabel("On-screen text").fill(editedTitle);
  await expect.poll(() => editor.locator(".aly-editor-clip__waveform img").count(), { timeout: 90_000 }).toBeGreaterThan(0);
  await expect.poll(() => editor.locator(".aly-editor-clip__waveform img").first().evaluate((image) => image.complete && image.naturalWidth > 0), { timeout: 90_000 }).toBe(true);
  const preview = editor.getByLabel(`Preview of ${importedName}`);
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((video) => video.readyState >= 1 && Number.isFinite(video.duration)), { timeout: 45_000 }).toBe(true);
  await page.screenshot({ path: path.join(evidenceRoot, "01-imported-trimmed-waveform.png"), fullPage: true });

  await page.waitForFunction(({ id, name, text }) => {
    const state = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    const saved = state.projects?.find((candidate) => candidate.nativeProjectId === id)?.editorDocument;
    const clips = saved?.tracks?.flatMap((track) => track.clips ?? []) ?? [];
    return saved?.assets?.some((asset) => asset.name === name && /^[0-9a-f]{64}$/u.test(asset.hash ?? ""))
      && clips.some((clip) => clip.name === name && clip.timelineRange?.durationFrames === 90)
      && clips.some((clip) => clip.kind === "titles" && clip.text === text);
  }, { id: project.nativeProjectId, name: importedName, text: editedTitle });
  await expect.poll(async () => {
    const durable = await invokeNative(page, "project_snapshot_get", {
      projectId: project.nativeProjectId,
      projectDirectory: project.nativeProjectDirectory,
    });
    const saved = durable.snapshot?.editorDocument;
    const clips = saved?.tracks?.flatMap((track) => track.clips ?? []) ?? [];
    return Boolean(saved?.assets?.some((asset) => asset.name === importedName && /^[0-9a-f]{64}$/u.test(asset.hash ?? ""))
      && clips.some((clip) => clip.name === importedName && clip.timelineRange?.durationFrames === 90)
      && clips.some((clip) => clip.kind === "titles" && clip.text === editedTitle));
  }, { timeout: 90_000 }).toBe(true);

  await editor.getByRole("button", { name: /return to scene/i }).click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".runtime-badge")).toContainText("Worker ready", { timeout: 45_000 });
  if (await page.getByRole("navigation", { name: /project workspace/i }).count() === 0) {
    await page.getByRole("button", { name: /open project/i }).click();
  }
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /^studio$/i }).click();
  await page.getByRole("button", { name: /^edit tracks & timing/i }).click();
  editor = page.getByRole("dialog", { name: "Integrated advanced video editor" });
  await expect(editor).toBeVisible({ timeout: 45_000 });
  card = editor.getByRole("listitem").filter({ hasText: importedName });
  await expect(card).toContainText("ready", { timeout: 45_000 });
  videoClip = editor.locator(".aly-editor-clip--slides").filter({ hasText: importedName }).first();
  await videoClip.click();
  await editor.getByRole("button", { name: "Inspector", exact: true }).click();
  await expect(editor.getByLabel("End frame")).toHaveValue("90");
  const reloadedPreview = editor.getByLabel(`Preview of ${importedName}`);
  const reloadedUrl = await reloadedPreview.getAttribute("src");
  if (!reloadedUrl || !/^(asset:|http:\/\/asset\.localhost)/u.test(reloadedUrl)) throw new Error(`Reloaded media did not use Tauri's asset protocol: ${reloadedUrl}`);
  await expect.poll(() => reloadedPreview.evaluate((video) => video.readyState >= 1), { timeout: 45_000 }).toBe(true);
  await expect.poll(() => editor.locator(".aly-editor-clip__waveform img").count(), { timeout: 90_000 }).toBeGreaterThan(0);
  await expect.poll(() => editor.locator(".aly-editor-clip__waveform img").first().evaluate((image) => image.complete && image.naturalWidth > 0), { timeout: 90_000 }).toBe(true);
  const playback = await verifyEditorVideoPlayback(editor, reloadedPreview, 20_000);
  await page.screenshot({ path: path.join(evidenceRoot, "02-reloaded-durable-media.png"), fullPage: true });

  await editor.getByRole("button", { name: "Render timeline" }).click();
  const status = editor.locator(".aly-editor-shell__status");
  const statusText = await waitForEditorRender(status, 600_000);
  if (!statusText.startsWith("Timeline rendered to ")) throw new Error(`Native editor render failed: ${statusText}`);
  const outputPath = statusText.match(/^Timeline rendered to (.+?)(?: ·|$)/u)?.[1];
  if (!outputPath) throw new Error(`Could not read the rendered timeline path from: ${statusText}`);
  const outputStat = await stat(outputPath);
  if (!outputStat.isFile() || outputStat.size <= 0) throw new Error("Rendered timeline output is empty");
  const probe = await probeMedia(outputPath);
  if (probe.duration < 2.9 || probe.duration > 3.1) throw new Error(`Rendered duration was ${probe.duration}, expected three seconds`);
  if (!probe.video) throw new Error("Rendered editor proof has no video stream");
  if (!probe.audio) throw new Error("Rendered editor proof did not preserve imported source audio");
  const renderedFramePath = path.join(evidenceRoot, "rendered-frame-at-1s.png");
  await execFileAsync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", outputPath, "-frames:v", "1", renderedFramePath], { windowsHide: true });
  const renderedFrameStat = await stat(renderedFramePath);
  if (!renderedFrameStat.isFile() || renderedFrameStat.size <= 0) throw new Error("Rendered editor proof frame is empty");
  await page.screenshot({ path: path.join(evidenceRoot, "03-render-complete.png"), fullPage: true });

  const initialDesktopPid = launch.child.pid;
  const initialWorkerPid = launch.workerPid;
  await editor.locator(".aly-editor-clip--titles").first().click();
  await editor.getByRole("button", { name: "Inspector", exact: true }).click();
  await editor.getByLabel("On-screen text").fill(closeProofTitle);
  await closeNative(launch);
  launch = undefined;

  launch = await startNative();
  const reopenedPage = launch.page;
  await expect(reopenedPage.locator(".runtime-badge")).toContainText("Worker ready", { timeout: 45_000 });
  if (await reopenedPage.getByRole("navigation", { name: /project workspace/i }).count() === 0) {
    await reopenedPage.getByRole("button", { name: /open project/i }).click();
  }
  await expect(reopenedPage.getByRole("navigation", { name: /project workspace/i })).toBeVisible({ timeout: 45_000 });
  await reopenedPage.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /^studio$/i }).click();
  await reopenedPage.getByRole("button", { name: /^edit tracks & timing/i }).click();
  const reopenedEditor = reopenedPage.getByRole("dialog", { name: "Integrated advanced video editor" });
  await expect(reopenedEditor).toBeVisible({ timeout: 45_000 });
  await reopenedEditor.locator(".aly-editor-clip--titles").first().click();
  await reopenedEditor.getByRole("button", { name: "Inspector", exact: true }).click();
  await expect(reopenedEditor.getByLabel("On-screen text")).toHaveValue(closeProofTitle);
  await reopenedPage.screenshot({ path: path.join(evidenceRoot, "04-close-flush-reopened.png"), fullPage: true });

  report = {
    schemaVersion: 1,
    state: "passed",
    actualNativeWebView: true,
    hiddenLaunch: true,
    projectId: project.nativeProjectId,
    importedPath: mediaPath,
    importedName,
    reloadPreservedCasMedia: true,
    immediateClosePreservedEditorSave: true,
    reloadedMediaPlayback: playback,
    waveformRendered: true,
    editedTitle,
    closeProofTitle,
    trimmedEndFrame: 90,
    outputPath,
    outputBytes: outputStat.size,
    outputDurationSeconds: probe.duration,
    outputVideoCodec: probe.video,
    outputAudioCodec: probe.audio,
    desktopPids: [initialDesktopPid, launch.child.pid],
    workerPids: [initialWorkerPid, launch.workerPid],
    renderedFramePath,
    finishedAtUtc: new Date().toISOString(),
  };
} catch (error) {
  workError = error;
  throw error;
} finally {
  if (launch) {
    try {
      await closeNative(launch);
    } catch (error) {
      if (!workError) throw error;
    }
  }
}

if (report) {
  report.gracefulShutdown = true;
  report.workerExitedWithApp = true;
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function editorFixture(projectId, projectTitle) {
  const now = new Date().toISOString();
  const kinds = ["slides", "presenter", "titles", "captions", "narration", "music", "sfx"];
  const labels = { slides: "Slides", presenter: "Presenter", titles: "Titles", captions: "Captions", narration: "Narration", music: "Music", sfx: "Sound effects" };
  const tracks = kinds.map((kind, index) => ({ id: `track-${kind}`, name: labels[kind], kind, index, locked: false, muted: false, solo: false, hidden: false, clips: [] }));
  tracks[2].clips.push({
    id: "native-cpu-title", trackId: "track-titles", name: "CPU editor title", kind: "titles", assetId: null,
    timelineRange: { startFrame: 0, durationFrames: 90 }, sourceRange: { startFrame: 0, durationFrames: 90 }, enabled: true, locked: false,
    text: "Native editor CPU proof", transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 }, opacity: 1, playbackRate: 1,
    audio: { volumeDb: 0, pan: 0, muted: false, fadeInFrames: 0, fadeOutFrames: 0 },
    textStyle: { fontFamily: "Atkinson Hyperlegible Next", fontSize: 32, fontWeight: 700, color: "#FFFFFF", backgroundColor: "#30263F", align: "center", position: "bottom" },
    keyframes: [], metadata: {},
  });
  return { schema: "alystria.editor.project.v1", id: projectId, name: `${projectTitle} · CPU editor proof`, frameRate: { numerator: 30, denominator: 1 }, canvas: { width: 1280, height: 720, pixelAspectRatio: 1, backgroundColor: "#101726" }, durationFrames: 90, tracks, assets: [], importReceipts: [], markers: [], metadata: { evidenceClass: "native-cpu-editor-smoke" }, createdAt: now, updatedAt: now };
}

async function startNative() {
  await rotateExistingPath(readyPath);
  const port = await reservePort();
  const stdout = await open(path.join(evidenceRoot, "desktop.stdout.log"), "w");
  const stderr = await open(path.join(evidenceRoot, "desktop.stderr.log"), "w");
  const child = spawn(executable, [], { cwd: portableRoot, env: { ...process.env, ALYSTRIA_HEADLESS_ACCEPTANCE: "1", ALYSTRIA_HEADLESS_ACCEPTANCE_CDP_PORT: String(port) }, windowsHide: true, stdio: ["ignore", stdout.fd, stderr.fd] });
  let browser;
  let workerPid;
  try {
    const ready = await waitForJson(readyPath, 120_000, child);
    workerPid = validatedReadyWorkerPid(ready, child.pid);
    browser = await connectToWebView(port, 120_000);
    const pages = browser.contexts().flatMap((context) => context.pages());
    if (pages.length !== 1) throw new Error(`Expected one native WebView page, found ${pages.length}`);
    return { child, browser, page: pages[0], workerPid, stdout, stderr };
  } catch (error) {
    workerPid ||= await readReadyWorkerPid(child.pid);
    const cleanupErrors = await cleanupFailedNativeStart({ child, browser, workerPid, stdout, stderr });
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "Native editor launch and startup cleanup both failed");
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
    const workerExited = await waitForProcessExit(current.workerPid, 10_000);
    if (!workerExited) throw new Error(`Native worker ${current.workerPid} remained alive after WM_CLOSE`);
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

async function invokeNative(page, command, input) {
  return await page.evaluate(async ({ command, input }) => {
    const invoke = globalThis.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") throw new Error("Tauri IPC is unavailable in the native WebView");
    return await invoke(command, { input });
  }, { command, input });
}

async function installNativeInvokeFailureRecorder(page) {
  await page.evaluate(() => {
    const internals = globalThis.__TAURI_INTERNALS__;
    const invoke = internals?.invoke;
    if (typeof invoke !== "function" || globalThis.__alystriaRejectedNativeCommands) return;
    const failures = [];
    globalThis.__alystriaRejectedNativeCommands = failures;
    internals.invoke = async (command, args, options) => {
      try {
        return await invoke.call(internals, command, args, options);
      } catch (error) {
        const record = { command: String(command) };
        if (typeof error === "string") record.message = error.slice(0, 1_000);
        else if (error && typeof error === "object") {
          if (typeof error.code === "string") record.code = error.code.slice(0, 160);
          if (typeof error.message === "string") record.message = error.message.slice(0, 1_000);
        }
        failures.push(record);
        throw error;
      }
    };
  });
}

async function verifyEditorVideoPlayback(editor, video, timeoutMs) {
  await editor.getByRole("button", { name: "Go to start" }).click();
  const startedAt = await video.evaluate((element) => element.currentTime);
  await editor.getByRole("button", { name: "Play", exact: true }).click();
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
  await editor.getByRole("button", { name: "Stop playback" }).click();
  if (!frame.presented) throw new Error(`Reloaded media advanced but did not present a decoded frame: ${JSON.stringify(frame)}`);
  return { ...frame, startedAt, drivenByEditorTransport: true, stoppedThroughEditorTransport: true };
}

async function waitForEditorRender(status, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = (await status.innerText()).trim();
    if (value.startsWith("Timeline rendered to ") || (value && value !== "Rendering the edited timeline…")) return value;
    await delay(250);
  }
  throw new Error("Timed out waiting for the native editor render");
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

async function probeMedia(file) {
  const { stdout } = await execFileAsync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type,codec_name", "-of", "json", file], { windowsHide: true });
  const value = JSON.parse(stdout);
  return { duration: Number(value.format?.duration), video: value.streams?.find((stream) => stream.codec_type === "video")?.codec_name ?? null, audio: value.streams?.find((stream) => stream.codec_type === "audio")?.codec_name ?? null };
}

async function reservePort() { return await new Promise((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close((error) => error ? reject(error) : resolve(address.port)); }); }); }
async function waitForJson(file, timeoutMs, child) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { try { const value = JSON.parse(await readFile(file, "utf8")); if (value?.state === "failed") throw new Error(`Native startup failed: ${value.reason ?? "unknown"}`); if (value?.state === "ready") return value; } catch (error) { if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; } if (child.exitCode !== null) throw new Error(`Native app exited ${child.exitCode} before readiness`); await delay(100); } throw new Error("Timed out waiting for native readiness"); }
async function connectToWebView(port, timeoutMs) { const deadline = Date.now() + timeoutMs; let lastError; while (Date.now() < deadline) { try { return await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch (error) { lastError = error; await delay(200); } } throw new Error(`Could not attach to the native WebView: ${lastError}`); }
async function postWmClose(pid) { const helper = path.join(repoRoot, "scripts", "post-wm-close.py"); const child = spawn(process.env.PYTHON ?? "python", [helper, "--pid", String(pid)], { windowsHide: true, stdio: "ignore" }); await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`WM_CLOSE helper exited ${code}`))); }); }
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
