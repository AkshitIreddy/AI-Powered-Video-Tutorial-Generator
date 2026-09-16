import { mkdir } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { configureE2eWorkspace } from "./fixtures";

test("authored proposal comparison is readable in the integrated inspector", async ({ page }, testInfo) => {
  await configureE2eWorkspace(page, "example");
  await page.evaluate(() => {
    const workspace = JSON.parse(localStorage.getItem("alystria-studio-v2")!);
    const project = workspace.projects[0];
    const scene = project.scenes.find((item: { id: string }) => item.id === "scene-insight");
    project.sceneEditCandidates = [{ id: "visual-test-proposal", sceneId: scene.id, status: "ready", focus: "explanation", instruction: "Explain the shared product more concretely.", originalHash: "a".repeat(64), createdAt: "2026-09-16T10:00:00Z", provider: "Explicit visual test fixture", model: "no provider request", proposed: { title: "One product, two useful terms", narration: "Expand the product of the two sums. Subtract the two outer products to reveal the middle terms.", objective: scene.objective, durationSeconds: 45, visualIntent: "" } }];
    localStorage.setItem("alystria-studio-v2", JSON.stringify(workspace));
  });
  await page.reload();
  await page.getByRole("button", { name: /^open project$/i }).click();
  await page.getByRole("navigation", { name: "Project workspace" }).getByRole("button", { name: "Studio", exact: true }).click();
  await page.locator(".inspector-tabs").getByRole("button", { name: "Generate", exact: true }).click();
  const review = page.locator(".scene-edit-review");
  await expect(review.getByRole("heading", { name: "Review suggested wording" })).toBeVisible();
  await review.scrollIntoViewIfNeeded();
  await mkdir("E:/temp/avt-controls-20260916", { recursive: true });
  await review.screenshot({ path: `E:/temp/avt-controls-20260916/scene-edit-review-${testInfo.project.name}.png` });
  await review.locator(".scene-edit-review__header").screenshot({ path: `E:/temp/avt-controls-20260916/scene-edit-heading-${testInfo.project.name}.png` });
  await review.locator(".scene-edit-review__actions").screenshot({ path: `E:/temp/avt-controls-20260916/scene-edit-actions-${testInfo.project.name}.png` });
  expect(await review.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
  await review.getByRole("button", { name: "Accept change" }).click();
  await expect(review.getByRole("alert")).toContainText("Open a desktop project");
  await expect(review.getByRole("button", { name: "Try accepting again" })).toBeEnabled();
});
