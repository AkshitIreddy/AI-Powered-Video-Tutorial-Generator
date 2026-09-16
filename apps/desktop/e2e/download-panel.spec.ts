import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { configureE2eWorkspace } from "./fixtures";

const evidence = "E:/temp/avt-controls-20260916";
test("download panel minimizes while navigation remains usable", async ({ page }, testInfo) => {
  await mkdir(evidence, { recursive: true });
  await configureE2eWorkspace(page, "clean");
  await page.getByRole("button", { name: /^Downloads$/ }).click();
  const panel = page.getByRole("region", { name: "Model downloads" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Your next tools start here")).toBeVisible();
  await page.screenshot({ path: `${evidence}/downloads-empty-${testInfo.project.name}.png` });
  await page.getByRole("button", { name: "Minimize downloads" }).click();
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "Models & providers" }).click();
  await expect(page.getByRole("heading", { name: "Model library" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Compare routes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Inspect/ })).toHaveCount(0);
  await page.screenshot({ path: `${evidence}/models-${testInfo.project.name}.png` });
  await page.getByRole("button", { name: /^Downloads$/ }).click();
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "Keep working" }).click();
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "Settings & diagnostics" }).click();
  await expect(page.getByRole("heading", { name: /healthy studio/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /privacy/i })).toHaveCount(0);
  await page.screenshot({ path: `${evidence}/settings-${testInfo.project.name}.png`, fullPage: true });
});
