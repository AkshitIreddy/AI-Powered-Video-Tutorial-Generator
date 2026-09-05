import { expect, test } from "@playwright/test";
import { configureE2eWorkspace } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await configureE2eWorkspace(page, "example");
});

test("home, project, and studio flows render without page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.getByRole("heading", { name: /turn a difficult idea/i })).toBeVisible();
  await page.getByRole("button", { name: /continue working/i }).click();
  await expect(page.getByRole("heading", { name: /shape the learning journey/i })).toBeVisible();
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /studio/i }).click();
  await expect(page.locator(".studio-workspace")).toBeVisible();
  await page.getByRole("button", { name: /new candidate/i }).click();
  await expect(page.getByRole("heading", { name: /create a new candidate/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test("new tutorial wizard exposes privacy and cost before creation", async ({ page }, testInfo) => {
  await configureLocalRouting(page);
  await page.getByRole("button", { name: /create a tutorial/i }).click();
  await page.getByPlaceholder(/explain why karatsuba/i).fill("Explain stable sorting visually");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText(/no cloud call happens/i)).toBeVisible();
  await page.getByRole("button", { name: /^creative/i }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText(/hard creation budget/i)).toBeVisible();
  await page.getByRole("checkbox", { name: /approve this exact routing policy/i }).check();
  await expect(page.locator(".routing-readiness")).toContainText("Ready");
  await page.locator(".routing-review").screenshot({ path: testInfo.outputPath("routing-review-approved.png") });
  await page.getByRole("button", { name: /create learning plan/i }).click();
  await expect(page.getByText(/Explain stable sorting visually is stored under/i)).toBeVisible();
});

test("selected sources remain visible through review and portable export is wired", async ({ page }, testInfo) => {
  await configureLocalRouting(page);
  await page.getByRole("button", { name: /create a tutorial/i }).click();
  await page.getByPlaceholder(/explain why karatsuba/i).fill("Explain source-backed recursion trees");
  await page.locator(".source-drop input[type=file]").setInputFiles({
    name: "recursion-notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Recursion tree notes\nPrivate fixture content."),
  });
  await expect(page.getByLabel(/selected source files/i)).toContainText("recursion-notes.md");
  await page.screenshot({ path: testInfo.outputPath("wizard-source-selection.png"), fullPage: true });
  await page.locator(".wizard-modal").screenshot({ path: testInfo.outputPath("wizard-source-selection-detail.png") });

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /^creative/i }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText(/1 private file/i)).toBeVisible();
  await page.getByRole("checkbox", { name: /approve this exact routing policy/i }).check();
  await page.getByRole("button", { name: /create learning plan/i }).click();
  await page.getByRole("button", { name: /^sources$/i }).click();
  await expect(page.getByText(/recursion-notes.md/i)).toBeVisible();

  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /export/i }).click();
  await expect(page.getByRole("radio", { name: /sidecar files/i })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/clean picture · no caption pixels/i)).toBeVisible();
  await page.locator(".jobs-drawer > header .icon-button").click();
  await page.getByRole("radio", { name: /always visible open captions/i }).click();
  await expect(page.getByText(/open captions in picture/i)).toBeVisible();
  await expect(page.getByText(/cannot be hidden after export/i)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("open-caption-export-warning.png"), fullPage: true });
  await page.getByRole("radio", { name: /sidecar files/i }).click();
  await page.getByRole("button", { name: /export portable/i }).click();
  await expect(page.getByText(/portable project archived/i)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("project-archive-export.png"), fullPage: true });
  await page.locator(".export-settings").screenshot({ path: testInfo.outputPath("project-archive-export-detail.png") });
});

test("narrow desktop does not overflow horizontally", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "narrow", "Narrow layout check only");
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasOverflow).toBe(false);
  await page.getByRole("button", { name: /continue working/i }).click();
  const projectOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(projectOverflow).toBe(false);
});

test("local model and provider profiles remain explicit and saveable", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: /models & providers/i }).click();
  await expect(page.getByRole("heading", { name: /local models, without surprise downloads/i })).toBeVisible();
  await expect(page.getByRole("radio", { name: /liveportrait/i })).toBeChecked();
  await page.getByRole("radio", { name: /musetalk 1.5/i }).check();
  await expect(page.getByRole("radio", { name: /musetalk 1.5/i })).toBeChecked();
  await expect(page.getByText(/download-only pack/i)).toBeVisible();
  await expect(page.getByText(/browser preview never fetches model bytes/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /start verified download/i })).toBeDisabled();
  await page.getByRole("button", { name: /add profile/i }).click();
  await page.getByLabel("Name", { exact: true }).fill("Offline presenter review");
  await page.getByRole("button", { name: /save setup & active profile/i }).click();
  await expect(page.getByText(/setup saved locally/i)).toBeVisible();
  await expect(page.getByRole("radio", { name: /liveportrait/i })).toBeChecked();
  await expect(page.getByRole("radio", { name: /musetalk 1.5/i })).toBeChecked();
  await page.locator(".toast button").click();
  await page.locator(".model-setup-panel").screenshot({ path: testInfo.outputPath("local-model-setup.png") });
  await page.locator(".model-download-panel").screenshot({ path: testInfo.outputPath("local-model-download-detail.png") });
  await page.locator(".profile-panel").screenshot({ path: testInfo.outputPath("provider-profiles.png") });
});

test("visual bible customizes typography, captions, backgrounds, presenter, and licensed uploads", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Full studio inspection uses the desktop viewport");
  await page.getByRole("button", { name: /continue working/i }).click();
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /studio/i }).click();
  await page.getByRole("button", { name: "Design" }).click();
  await page.getByRole("button", { name: /cinematic lecture/i }).click();
  await page.getByRole("button", { name: /modern signal/i }).click();
  await page.getByRole("tab", { name: /captions/i }).click();
  await page.getByRole("button", { name: /top/i }).click();
  await page.getByRole("slider", { name: /caption size/i }).fill("116");
  await page.getByRole("tab", { name: /media/i }).click();
  await page.getByRole("button", { name: /minji · modern tech/i }).click();
  await page.getByLabel(/presenter layout/i).selectOption("picture-in-picture");
  await expect(page.getByTestId("presenter-preview")).toBeVisible();
  await expect(page.getByTestId("caption-preview")).toHaveClass(/position-top/);

  await page.screenshot({ path: testInfo.outputPath("visual-bible-full.png") });
  await page.locator(".canvas-stage").screenshot({ path: testInfo.outputPath("visual-bible-canvas.png") });
  await page.locator(".inspector").screenshot({ path: testInfo.outputPath("visual-bible-media-inspector.png") });

  await page.getByRole("button", { name: /licensed/i }).click();
  await page.getByLabel("License", { exact: true }).fill("CC BY 4.0");
  await page.getByLabel(/required attribution/i).fill("Alystria QA fixture · CC BY 4.0");
  await page.locator('.license-fields label:has-text("Commercial use") select').selectOption("allowed");
  await page.locator('.license-fields label:has-text("Redistribution in exported video") select').selectOption("allowed");
  await page.locator('.license-fields label:has-text("AI / model input") select').selectOption("allowed");
  await page.getByRole("button", { name: /fictional \/ generated/i }).click();
  await page.getByText(/i attest this identity is fictional or generated/i).click();
  await page.locator('.asset-upload:has-text("Upload your presenter picture") input').setInputFiles({
    name: "presenter-owned.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await expect(page.getByText(/asset added to visual bible/i)).toBeVisible();
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}"));
  const customization = persisted.projects.find((project: { id: string }) => project.id === "karatsuba")?.customization;
  expect(customization.presenter.placement).toBe("picture-in-picture");
  expect(customization.assets.some((asset: { filename?: string; rightsStatus: string }) => asset.filename === "presenter-owned.png" && asset.rightsStatus === "cleared")).toBe(true);
});

async function configureLocalRouting(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /models & providers/i }).click();
  await expect(page.getByRole("heading", { name: /provider & model profiles/i })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Local deterministic");
  const routes = page.locator(".profile-route-grid");
  for (const label of ["Writing & review", "Images", "Narration"]) {
    await routes.locator("label", { hasText: label }).locator("select").selectOption("local-runtime");
  }
  await page.getByLabel("Writing & review model", { exact: true }).fill("local/qwen3.5-9b-gguf");
  await page.getByLabel("Images model", { exact: true }).fill("local/flux2-klein-4b");
  await page.getByLabel("Narration model", { exact: true }).fill("local/kokoro");
  await page.getByRole("button", { name: /save setup & active profile/i }).click();
  await expect(page.getByText(/setup saved locally/i)).toBeVisible();
  await page.getByRole("button", { name: /^home$/i }).click();
}
