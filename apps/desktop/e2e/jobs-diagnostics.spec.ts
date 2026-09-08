import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { exampleSnapshot } from "../src/data";
import { completedOnboarding } from "./fixtures";

test("failed export diagnostics stay readable and expandable", async ({ page }, testInfo) => {
  const detail = "Renderer exited with code 1: No requested hardware encoder passed a real 1920x1080 encode probe. "
    + "[hevc_nvenc @ 000001] Required nvenc API version 13.1. Found 13.0. ".repeat(18);
  await page.addInitScript(({ snapshot, onboarding, diagnostic }) => {
    localStorage.clear();
    localStorage.setItem("alystria-onboarding-v1", JSON.stringify(onboarding));
    localStorage.setItem("alystria-guided-tour-v1", "completed");
    localStorage.setItem("alystria-studio-v2", JSON.stringify({ ...snapshot, jobs: [
      { id: "diagnostic-export", title: "Karatsuba multiplication — three-minute master export", detail: diagnostic,
        status: "attention", progress: 0, eta: "retry available", result: { receiptState: "FAILED" } },
      { id: "short-blocker", title: "Narration", detail: "Choose a voice before generating narration.",
        status: "attention", progress: 0, result: { receiptState: "BLOCKED" } },
    ] }));
  }, { snapshot: exampleSnapshot, onboarding: completedOnboarding, diagnostic: detail });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^jobs$/i }).click();
  const drawer = page.getByRole("complementary", { name: "Background jobs" });
  await expect(drawer.getByText("The selected hardware encoder is unavailable. Review your export codec or runtime setup.")).toBeVisible();
  await expect(drawer.locator("pre")).toBeHidden();
  await expect(drawer.getByText("Choose a voice before generating narration.")).toBeVisible();
  const evidence = "E:/temp/avt-final-media-inspection-20260907/jobs-readability-20260908";
  await mkdir(evidence, { recursive: true });
  await drawer.screenshot({ path: `${evidence}/${testInfo.project.name}-collapsed.png` });
  const summary = drawer.locator("summary");
  await summary.focus();
  await summary.press("Enter");
  await expect(drawer.locator("pre")).toBeVisible();
  await expect(drawer.locator("pre")).toHaveText(detail);
  expect(await drawer.locator("pre").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await drawer.locator("pre").evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(202);
  await drawer.screenshot({ path: `${evidence}/${testInfo.project.name}-expanded.png` });
  await drawer.getByRole("button", { name: "Close background jobs" }).click();
  await expect(drawer).toBeHidden();
});
