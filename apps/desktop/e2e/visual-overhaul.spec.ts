import { mkdir } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { exampleSnapshot } from "../src/data";
import { completedOnboarding as onboarding } from "./fixtures";

const output = "E:/temp/AI Video Tutorial Generator Visual Acceptance/2026-09-03";
async function readyPage(page: Page, withProject = false) {
  await page.addInitScript(({ snapshot, onboardingState, withProject: seedProject }) => {
    localStorage.clear();
    localStorage.setItem("alystria-onboarding-v1", JSON.stringify(onboardingState));
    localStorage.setItem("alystria-guided-tour-v1", "completed");
    if (seedProject) localStorage.setItem("alystria-studio-v2", JSON.stringify(snapshot));
  }, { snapshot: exampleSnapshot, onboardingState: onboarding, withProject });
  await page.goto("/", { waitUntil: "networkidle" });
}

async function waitForDecodedImages(page: Page, selector: string) {
  await page.locator(selector).evaluateAll(async (images: HTMLImageElement[]) => {
    await Promise.all(images.map(async (image) => {
      if (!image.complete) await new Promise<void>((resolve) => image.addEventListener("load", () => resolve(), { once: true }));
      await image.decode();
    }));
  });
}

test.beforeAll(async () => { await mkdir(output, { recursive: true }); });

test("captures the clean first launch and redesigned global surfaces", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByRole("dialog", { name: /make ai video tutorial generator yours/i })).toBeVisible();
  await page.screenshot({ path: `${output}/01-first-launch-onboarding.png` });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("checkbox", { name: /tutorial or explainer/i }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("radio", { name: /choose per task/i }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("radio", { name: /ask before cloud use/i }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /continue without this/i }).click();
  const hardwareReview = page.getByRole("checkbox", { name: /reviewed this system summary/i });
  if (!(await hardwareReview.isChecked())) await hardwareReview.check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: /review your model toolkit/i })).toBeVisible();
  await page.screenshot({ path: `${output}/01-model-toolkit-required-downloads.png` });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: /create your studio profile/i })).toBeVisible();
  await waitForDecodedImages(page, ".aly-onboarding-profile__gallery img");
  await page.screenshot({ path: `${output}/01a-onboarding-profile-gallery.png` });
  await page.locator('label:has(.aly-onboarding-profile__portrait-radio[value="presenter-portrait.educator-maya-v2"])').click();
  await page.getByLabel("Display name", { exact: true }).fill("Akshit");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: /your studio is prepared/i })).toBeVisible();
  await page.screenshot({ path: `${output}/01b-onboarding-ready.png` });
  await page.getByRole("button", { name: /enter ai video tutorial generator/i }).click();
  await expect(page.getByRole("dialog", { name: /make ai video tutorial generator yours/i })).toHaveCount(0);
  await expect(page.locator(".aly-onboarding-tour")).toBeVisible();
  await page.screenshot({ path: `${output}/01c-contextual-guided-tour.png` });
});

test("captures home, templates, model catalog, settings, studio and editor", async ({ page }) => {
  await readyPage(page, true);
  await expect(page.getByRole("heading", { name: /turn a difficult idea/i })).toBeVisible();
  await page.screenshot({ path: `${output}/02-home.png` });
  await page.locator(".home-hero").screenshot({ path: `${output}/02a-home-hero-closeup.png` });
  await page.locator(".sidebar").screenshot({ path: `${output}/02b-sidebar-closeup.png` });

  await page.getByRole("button", { name: "Templates" }).click();
  await expect(page.getByRole("heading", { name: "Templates" })).toBeVisible();
  await waitForDecodedImages(page, ".template-grid img");
  await page.screenshot({ path: `${output}/03-templates.png` });
  await page.locator(".template-grid").screenshot({ path: `${output}/03a-template-grid-closeup.png` });

  await page.getByRole("button", { name: /models & providers/i }).click();
  await expect(page.getByRole("heading", { name: /one model library/i })).toBeVisible();
  await page.locator(".federated-catalog-panel").screenshot({ path: `${output}/04-model-catalog.png` });
  await page.locator(".catalog-source-strip").screenshot({ path: `${output}/04a-provider-sources-closeup.png` });

  await page.getByRole("button", { name: /settings & diagnostics/i }).click();
  await expect(page.getByRole("heading", { name: /healthy studio/i })).toBeVisible();
  await page.screenshot({ path: `${output}/05-settings.png`, fullPage: true });
  await page.locator(".intricate-settings").first().screenshot({ path: `${output}/05a-storage-settings-closeup.png` });

  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("button", { name: /karatsuba, visually/i }).click();
  await page.getByLabel("Studio", { exact: true }).click();
  await expect(page.locator(".studio-workspace")).toBeVisible();
  await page.screenshot({ path: `${output}/06-studio.png` });
  await page.getByRole("button", { name: "Generate" }).click();
  await page.locator(".creative-inspector").screenshot({ path: `${output}/06a-slide-presenter-controls-closeup.png` });
  await page.getByRole("button", { name: /advanced editor/i }).click();
  await expect(page.getByRole("application", { name: /advanced video editor/i })).toBeVisible();
  await page.screenshot({ path: `${output}/07-advanced-editor.png` });
  await page.locator(".aly-editor-shell__workspace").screenshot({ path: `${output}/07a-editor-workspace-closeup.png` });
  await page.locator(".aly-editor-timeline").screenshot({ path: `${output}/07b-editor-timeline-closeup.png` });
});
