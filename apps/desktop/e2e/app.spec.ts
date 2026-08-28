import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
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

test("new tutorial wizard exposes privacy and cost before creation", async ({ page }) => {
  await page.getByRole("button", { name: /create a tutorial/i }).click();
  await page.getByPlaceholder(/explain why karatsuba/i).fill("Explain stable sorting visually");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText(/no cloud call happens/i)).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText(/estimated plan cost/i)).toBeVisible();
  await page.getByRole("button", { name: /create learning plan/i }).click();
  await expect(page.getByText(/Explain stable sorting visually is stored under/i)).toBeVisible();
});

test("selected sources remain visible through review and portable export is wired", async ({ page }, testInfo) => {
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
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText(/1 private file/i)).toBeVisible();
  await page.getByRole("button", { name: /create learning plan/i }).click();
  await page.getByRole("button", { name: /^sources$/i }).click();
  await expect(page.getByText(/recursion-notes.md/i)).toBeVisible();

  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /export/i }).click();
  await page.locator(".jobs-drawer > header .icon-button").click();
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
