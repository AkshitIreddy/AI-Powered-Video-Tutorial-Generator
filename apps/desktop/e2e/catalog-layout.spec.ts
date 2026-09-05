import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { configureE2eWorkspace } from "./fixtures";

test("keeps catalog discovery visible and exposes only working model actions", async ({ page }, testInfo) => {
  await configureE2eWorkspace(page, "example");
  await page.getByRole("button", { name: "Models & providers" }).click();

  const catalog = page.locator(".federated-catalog-panel");
  const search = page.getByRole("searchbox", { name: "Search models" });
  const firstCard = catalog.locator(".aly-catalog-card").first();
  await expect(page.getByRole("heading", { name: "Model library" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Find the right engine/i })).toHaveCount(0);
  await expect(page.locator(".catalog-source-disclosure")).not.toHaveAttribute("open", "");
  await expect(search).toBeVisible();
  await expect(firstCard).toBeVisible();
  await expect(page.getByRole("button", { name: "Select model" })).toHaveCount(0);

  const viewport = page.viewportSize();
  const searchBox = await search.boundingBox();
  const cardBox = await firstCard.boundingBox();
  expect(viewport).not.toBeNull();
  expect(searchBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(searchBox!.y + searchBox!.height).toBeLessThanOrEqual(viewport!.height);
  expect(cardBox!.y).toBeLessThan(viewport!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport!.width);

  const evidenceDir = process.env.ALYSTRIA_CATALOG_PROOF_DIR;
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: `${evidenceDir}/catalog-${testInfo.project.name}.png` });
  }

  await page.getByRole("button", { name: "Inspect details" }).first().click();
  await expect(page.locator(".toast").filter({ hasText: "was reviewed here only" })).toBeVisible();
});

test("stages an eligible writing model and persists it only through the saved profile action", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The durable profile workflow is covered once at desktop size.");
  await configureE2eWorkspace(page, "example");
  await page.getByRole("button", { name: "Models & providers" }).click();

  const writingProvider = page.getByLabel("Writing & review provider");
  const writingModel = page.getByLabel("Writing & review model");
  await expect(writingProvider).toHaveValue("openai");
  await expect(writingModel).toHaveValue("choose at generation");

  const search = page.getByRole("searchbox", { name: "Search models" });
  await search.fill('provider:groq "GPT-OSS 120B"');
  const useForWriting = page.getByRole("button", { name: "Use in writing profile" });
  await expect(useForWriting).toBeDisabled();

  await page.getByRole("button", { name: "Add Groq credential" }).click();
  await page.getByLabel("API key").fill("browser-e2e-key-is-discarded");
  await page.getByRole("button", { name: "Store securely" }).click();
  await expect(useForWriting).toBeEnabled();
  await useForWriting.click();
  await expect(page.locator(".toast").filter({ hasText: "Use Save setup & active profile" })).toBeVisible();
  await expect(writingProvider).toHaveValue("groq");
  await expect(writingModel).toHaveValue("openai/gpt-oss-120b");
  await expect(writingModel).toBeFocused();
  if (process.env.ALYSTRIA_CATALOG_PROOF_DIR) {
    await mkdir(process.env.ALYSTRIA_CATALOG_PROOF_DIR, { recursive: true });
    await page.screenshot({ path: `${process.env.ALYSTRIA_CATALOG_PROOF_DIR}/writing-profile-staged-desktop.png` });
  }

  await page.getByRole("button", { name: "Home" }).click();
  await page.getByRole("button", { name: "Models & providers" }).click();
  await expect(page.getByLabel("Writing & review provider")).toHaveValue("openai");
  await expect(page.getByLabel("Writing & review model")).toHaveValue("choose at generation");

  await page.getByRole("searchbox", { name: "Search models" }).fill('provider:groq "GPT-OSS 120B"');
  await expect(page.getByRole("button", { name: "Use in writing profile" })).toBeEnabled();
  await page.getByRole("button", { name: "Use in writing profile" }).click();
  await page.getByRole("button", { name: "Save setup & active profile" }).click();
  await expect(page.locator(".toast").filter({ hasText: "Setup saved locally" })).toBeVisible();

  await page.getByRole("button", { name: "Home" }).click();
  await page.getByRole("button", { name: "Models & providers" }).click();
  await expect(page.getByLabel("Writing & review provider")).toHaveValue("groq");
  await expect(page.getByLabel("Writing & review model")).toHaveValue("openai/gpt-oss-120b");
});
