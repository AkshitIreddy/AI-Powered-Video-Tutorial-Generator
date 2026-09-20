import { expect, test } from "@playwright/test";
import { configureE2eWorkspace } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await configureE2eWorkspace(page, "example");
  await page.getByRole("button", { name: /^open project$/i }).click();
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /studio/i }).click();
  await expect(page.locator(".studio-workspace")).toBeVisible();
});

test("Studio fits the scene canvas on both axes and restores fit after zooming", async ({ page }, testInfo) => {
  const surround = page.locator(".canvas-surround");
  const canvas = page.getByTestId("customized-canvas");
  await expect(canvas).toBeVisible();

  const bounds = async () => {
    const [surroundBox, canvasBox] = await Promise.all([surround.boundingBox(), canvas.boundingBox()]);
    expect(surroundBox).not.toBeNull();
    expect(canvasBox).not.toBeNull();
    return { surround: surroundBox!, canvas: canvasBox! };
  };
  const fit = await bounds();
  expect(fit.canvas.width).toBeGreaterThan(fit.surround.width * 0.72);
  expect(fit.canvas.x).toBeGreaterThanOrEqual(fit.surround.x);
  expect(fit.canvas.y).toBeGreaterThanOrEqual(fit.surround.y);
  expect(fit.canvas.x + fit.canvas.width).toBeLessThanOrEqual(fit.surround.x + fit.surround.width + 1);
  expect(fit.canvas.y + fit.canvas.height).toBeLessThanOrEqual(fit.surround.y + fit.surround.height + 1);
  const topGap = fit.canvas.y - fit.surround.y;
  const bottomGap = fit.surround.y + fit.surround.height - fit.canvas.y - fit.canvas.height;
  expect(Math.abs(topGap - bottomGap)).toBeLessThan(10);

  const zoom = page.getByRole("slider", { name: "Canvas zoom" });
  await zoom.fill("60");
  await page.waitForTimeout(250);
  const reduced = await bounds();
  expect(reduced.canvas.width / fit.canvas.width).toBeGreaterThan(0.58);
  expect(reduced.canvas.width / fit.canvas.width).toBeLessThan(0.64);
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.waitForTimeout(250);
  const restored = await bounds();
  expect(Math.abs(restored.canvas.width - fit.canvas.width)).toBeLessThan(8);
  expect(zoom).toHaveValue("100");
  await page.screenshot({ path: testInfo.outputPath("studio-fit.png") });
});

test("advanced editor presenter preview uses the same full-canvas contain basis as export", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One desktop parity check covers shared editor CSS.");
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.getByRole("tab", { name: "Media", exact: true }).click();
  await page.getByRole("button", { name: /elena · news anchor/i }).click();
  await page.getByRole("button", { name: /advanced editor/i }).click();
  const stage = page.locator(".aly-editor-canvas-stage");
  await stage.evaluate((node) => {
    const presenter = document.createElement("video");
    presenter.dataset.testid = "presenter-layout-probe";
    presenter.className = "aly-editor-canvas-stage__media aly-editor-canvas-stage__media--presenter";
    node.append(presenter);
  });
  const presenter = page.getByTestId("presenter-layout-probe");
  await expect(presenter).toBeVisible();
  await expect(presenter).toHaveCSS("inset", "0px");
  const [presenterBox, stageBox] = await Promise.all([presenter.boundingBox(), stage.boundingBox()]);
  expect(presenterBox).not.toBeNull();
  expect(stageBox).not.toBeNull();
  expect(Math.abs(presenterBox!.width - stageBox!.width)).toBeLessThan(3);
  expect(Math.abs(presenterBox!.height - stageBox!.height)).toBeLessThan(3);
  await expect(presenter).toHaveCSS("object-fit", "contain");
});
