import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { completedOnboarding } from "./fixtures";
import { defaultSnapshot } from "../src/data";

const evidence = "E:/temp/AI Video Tutorial Generator/editor-redesign-20260916/runtime-ui";
const runtimeId = "runtime/comfyui-0.9.2";
const sdxlId = "local/sdxl-base-1.0";
const fluxId = "local/flux.2-klein-4b-fp8";

const catalog = [
  {
    modelId: runtimeId,
    displayName: "ComfyUI 0.9.2 portable runtime",
    immutableRevision: "comfyui-8f40b43e0204d5b9780f3e9618e140e929e80594",
    totalBytes: 1_803_412_624,
    artifactCount: 1,
    licenseId: "GPL-3.0",
    licenseUrl: "https://github.com/comfyanonymous/ComfyUI",
    licenseSha256: "3".repeat(64),
    licenseScope: "Pinned ComfyUI runtime",
    codeRevision: "8".repeat(40),
    weightRevision: "runtime-only",
    available: true,
    downloadOnlyReason: "Verified shared local image runtime.",
  },
  {
    modelId: sdxlId,
    displayName: "Stable Diffusion XL Base 1.0",
    immutableRevision: "sdxl-pinned",
    totalBytes: 8_791_044_562,
    artifactCount: 3,
    licenseId: "OpenRAIL++",
    licenseUrl: "https://example.test/sdxl-license",
    licenseSha256: "4".repeat(64),
    licenseScope: "Pinned SDXL model",
    codeRevision: "8".repeat(40),
    weightRevision: "4".repeat(40),
    available: true,
    downloadOnlyReason: "Managed SDXL image model.",
  },
  {
    modelId: fluxId,
    displayName: "FLUX.2 Klein 4B FP8 bundle",
    immutableRevision: "flux-pinned",
    totalBytes: 10_058_462_434,
    artifactCount: 3,
    licenseId: "Apache-2.0",
    licenseUrl: "https://example.test/flux-license",
    licenseSha256: "5".repeat(64),
    licenseScope: "Pinned FLUX model",
    codeRevision: "8".repeat(40),
    weightRevision: "5".repeat(40),
    available: true,
    downloadOnlyReason: "Managed FLUX image model.",
  },
];

async function configureRuntimeFixture(page: Page, onboarding = completedOnboarding) {
  let rejectStartup: ((error: Error) => void) | undefined;
  const startupError = new Promise<never>((_resolve, reject) => { rejectStartup = reject; });
  page.once("pageerror", (error) => rejectStartup?.(error));
  await page.addInitScript(({ entries, onboardingState, workspace, runtimePackageId }) => {
    const state = {
      starts: [] as string[],
      statuses: entries.map((entry) => ({
        modelId: entry.modelId,
        immutableRevision: entry.immutableRevision,
        phase: "manifestRequired",
        downloadedBytes: 0,
        totalBytes: entry.totalBytes,
        verifiedArtifacts: 0,
        artifactCount: entry.artifactCount,
        licenseId: entry.licenseId,
        licenseUrl: entry.licenseUrl,
        licenseSha256: entry.licenseSha256,
        licenseAcceptedAt: null,
        detail: "Ready to download.",
        activationBlocked: true,
        updatedAt: "2026-09-20T00:00:00.000Z",
      })),
    };
    const callbacks: Record<number, (payload: unknown) => void> = {};
    let callbackId = 0;
    Object.assign(window, { __runtimeHarness: state, isTauri: true });
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
        transformCallback: (callback: (payload: unknown) => void) => { callbackId += 1; callbacks[callbackId] = callback; return callbackId; },
        unregisterCallback: (id: number) => { delete callbacks[id]; },
        runCallback: (id: number, payload: unknown) => { callbacks[id]?.(payload); },
        callbacks,
        invoke: async (command: string, args?: { input?: { modelId?: string } }) => {
          if (command === "plugin:event|listen") return callbackId;
          if (command === "plugin:event|unlisten") return null;
          if (command === "local_model_download_catalog") return structuredClone(entries);
          if (command === "local_model_download_status") return structuredClone(state.statuses);
          if (command === "local_model_download_start") {
            const modelId = args?.input?.modelId;
            if (!modelId) throw new Error("Missing model ID");
            state.starts.push(modelId);
            const entry = entries.find((candidate) => candidate.modelId === modelId);
            if (!entry) throw new Error(`Unknown fixture package: ${modelId}`);
            const complete = {
              ...state.statuses.find((candidate) => candidate.modelId === modelId),
              phase: "ready",
              downloadedBytes: entry.totalBytes,
              verifiedArtifacts: entry.artifactCount,
              licenseAcceptedAt: "2026-09-20T00:00:01.000Z",
              detail: "Fixture package verified.",
              activationBlocked: false,
              installFingerprint: "a".repeat(64),
              runtimeRevision: modelId === runtimePackageId
                ? "comfyui-8f40b43e0204d5b9780f3e9618e140e929e80594"
                : `${entry.immutableRevision}+recipe-v1`,
              updatedAt: "2026-09-20T00:00:01.000Z",
            };
            state.statuses = [...state.statuses.filter((candidate) => candidate.modelId !== modelId), complete];
            return structuredClone(complete);
          }
          if (command === "app_bootstrap") return {
            appVersion: "2.0.0-e2e",
            platform: "windows",
            architecture: "x86_64",
            projectSchemaVersion: 1,
            ticksPerSecond: 240_000,
            paths: { appData: "E:/fixture/app", cache: "E:/fixture/cache", logs: "E:/fixture/logs", runtimes: "E:/fixture/runtimes", models: "E:/fixture/models", projects: "E:/fixture/projects", temp: "E:/fixture/temp" },
            worker: { state: "ready", pid: 100, endpoint: "fixture://pipeline" },
            runtimeChannel: "portable-debug",
          };
          if (command === "diagnostics_run") return {
            generatedAt: "2026-09-20T00:00:00.000Z",
            overall: "pass",
            checks: [],
            system: { os: "Windows", osVersion: "11", architecture: "x86_64", cpu: "Fixture CPU", logicalCpuCount: 8, totalMemoryBytes: 32 * 1024 ** 3, availableMemoryBytes: 16 * 1024 ** 3, gpu: [{ name: "Fixture GPU", dedicatedMemoryBytes: 12 * 1024 ** 3, driverVersion: "fixture" }] },
          };
          if (command === "local_model_setup_get") return {
            schemaVersion: 1,
            activeProfileId: "balanced-cloud",
            selectedModelIds: [],
            lipSyncModelId: null,
            portraitAnimationModelId: null,
            existingModelDirectory: null,
            updatedAt: "2026-09-20T00:00:00.000Z",
            profiles: [{
              id: "balanced-cloud",
              name: "Balanced cloud",
              description: "Fixture profile",
              routes: {
                writing: { providerId: "openai", modelId: "choose at generation" },
                research: { providerId: "openai", modelId: "choose at generation" },
                images: { providerId: "openai", modelId: "gpt-image-2" },
                voice: { providerId: "elevenlabs", modelId: "eleven_multilingual_v2", voiceId: "fixture" },
                transcription: { providerId: "openai", modelId: "choose at generation" },
                presenter: { providerId: "local-runtime", modelId: "off by default" },
                portraitAnimation: { providerId: "local-runtime", modelId: "off by default" },
                lipSync: { providerId: "local-runtime", modelId: "off by default" },
              },
            }],
          };
          if (command === "provider_secret_status") {
            const input = args?.input as { providerId?: string } | undefined;
            return { reference: `fixture://${input?.providerId ?? "provider"}/api_key`, providerId: input?.providerId ?? "provider", credentialKind: "api_key", availability: "missing", updatedAt: null };
          }
          if (command === "desktop_shutdown") return null;
          throw new Error(`Unhandled runtime UI fixture command: ${command}`);
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (_event: string, id: number) => { delete callbacks[id]; } },
    });
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("alystria-onboarding-v1", JSON.stringify(onboardingState));
    localStorage.setItem("alystria-guided-tour-v1", "completed");
    localStorage.setItem("alystria-studio-v2", JSON.stringify(workspace));
  }, { entries: catalog, onboardingState: onboarding, workspace: defaultSnapshot, runtimePackageId: runtimeId });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await Promise.race([page.locator(".app-shell").waitFor(), startupError]);
}

async function openedModels(page: Page) {
  await page.getByRole("button", { name: "Models & providers" }).click();
  await expect(page.getByRole("heading", { name: "ComfyUI runtime" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose an image model to download" })).toBeVisible();
}

for (const model of [
  { id: fluxId, name: "FLUX.2 Klein 4B FP8", total: "9.4 GB" },
  { id: sdxlId, name: "Stable Diffusion XL 1.0", total: "8.2 GB" },
]) {
  test(`queues ComfyUI before ${model.name} and keeps the selected model`, async ({ page }, testInfo) => {
    await mkdir(evidence, { recursive: true });
    await configureRuntimeFixture(page);
    await openedModels(page);

    await page.getByRole("radio", { name: new RegExp(model.name.replaceAll(".", "\\."), "i") }).click();
    await page.locator(".model-download-panel").getByRole("button", { name: "Download", exact: true }).click();

    const prompt = page.getByRole("alertdialog", { name: new RegExp(`Install ComfyUI with ${model.name.replaceAll(".", "\\.")}`, "i") });
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText(`${model.total}`);
    await expect(prompt).toContainText("already includes the 1.7 GB shared runtime");
    const confirm = prompt.getByRole("button", { name: `Download ${model.name} + ComfyUI`, exact: true });
    await expect(confirm).toBeFocused();
    expect((await prompt.boundingBox())?.width).toBeLessThanOrEqual(480);
    await page.screenshot({ path: `${evidence}/runtime-prompt-${model.id === fluxId ? "flux" : "sdxl"}-${testInfo.project.name}.png`, animations: "disabled" });

    await confirm.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __runtimeHarness: { starts: string[] } }).__runtimeHarness.starts)).toEqual([runtimeId, model.id]);
    await page.getByRole("button", { name: "Minimize downloads" }).click();
    await expect(page.getByRole("radio", { name: new RegExp(model.name.replaceAll(".", "\\."), "i") })).toBeChecked();
  });
}

test("standalone runtime setup queues no model weights", async ({ page }, testInfo) => {
  await mkdir(evidence, { recursive: true });
  await configureRuntimeFixture(page);
  await openedModels(page);

  await page.getByRole("button", { name: "Download ComfyUI" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __runtimeHarness: { starts: string[] } }).__runtimeHarness.starts)).toEqual([runtimeId]);
  await expect(page.getByRole("region", { name: "Model downloads" })).toBeVisible();
  await page.screenshot({ path: `${evidence}/runtime-only-${testInfo.project.name}.png`, animations: "disabled" });
});

test("onboarding keeps the runtime separate from selected model configuration", async ({ page }, testInfo) => {
  await mkdir(evidence, { recursive: true });
  const onboarding = structuredClone(completedOnboarding);
  onboarding.status = "in-progress";
  onboarding.activeChapterId = "model";
  onboarding.completedChapterIds = ["welcome", "goal", "runtime", "provider", "hardware"];
  onboarding.visitedChapterIds = [...onboarding.completedChapterIds, "model"];
  onboarding.configuration.modelIds = [];
  await configureRuntimeFixture(page, onboarding);

  const dialog = page.getByRole("dialog", { name: "Choose your model toolkit" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("region", { name: "ComfyUI 0.9.2 portable runtime" })).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: /ComfyUI/i })).toHaveCount(0);
  await page.screenshot({ path: `${evidence}/runtime-onboarding-choice-${testInfo.project.name}.png`, animations: "disabled" });
  await dialog.getByRole("checkbox", { name: /FLUX\.2 Klein 4B FP8 bundle/i }).click();
  const prompt = page.getByRole("alertdialog", { name: /Install ComfyUI with FLUX\.2 Klein 4B FP8 bundle/i });
  await expect(prompt).toBeVisible();
  await page.screenshot({ path: `${evidence}/runtime-onboarding-${testInfo.project.name}.png`, animations: "disabled" });
  await prompt.getByRole("button", { name: "Download FLUX.2 Klein 4B FP8 bundle + ComfyUI", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __runtimeHarness: { starts: string[] } }).__runtimeHarness.starts)).toEqual([runtimeId, fluxId]);
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("alystria-onboarding-v1") ?? "{}") as { configuration?: { modelIds?: string[] } });
  expect(persisted.configuration?.modelIds).toContain(fluxId);
  expect(persisted.configuration?.modelIds).not.toContain(runtimeId);
});
