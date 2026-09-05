import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = process.env.ALYSTRIA_PREVIEW_URL ?? "http://127.0.0.1:1438";
const output = resolve(process.env.ALYSTRIA_CAPTURE_OUTPUT ?? `E:/temp/AI Video Tutorial Generator/doc-captures/${new Date().toISOString().replace(/[^0-9]/gu, "")}`);
// Preserve earlier captures; promote inspected images into docs separately.
await mkdir(resolve(output, ".."), { recursive: true });
await mkdir(output);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

const captures = [];
async function capture(name) {
  await page.evaluate(async () => { await document.fonts.ready; });
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (horizontalOverflow) throw new Error(`${name} has document horizontal overflow`);
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: false });
  captures.push({ name, viewport: page.viewportSize(), horizontalOverflow });
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Skip setup", exact: true }).click();
  const tour = page.locator(".aly-onboarding-tour");
  if (await tour.isVisible()) await tour.getByRole("button", { name: "Exit tour" }).click();
  await page.getByRole("heading", { name: /your teaching workbench/i }).waitFor();
  await capture("workbench-home");
  const workspace = await page.evaluate(() => JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}"));
  if (workspace.projects?.length || workspace.jobs?.length) throw new Error("Empty documentation profile contains seeded projects or jobs");

  await page.getByRole("button", { name: /models & providers/i }).click();
  await page.getByRole("heading", { name: "One model library for every capability" }).waitFor();
  await capture("models-providers");

  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
  await page.locator(".page img").evaluateAll(async (images) => {
    await Promise.all(images.map((image) => image.decode()));
  });
  await capture("included-library");

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: /new tutorial/i }).first().click();
  await page.getByPlaceholder(/explain why karatsuba/i).fill(
    "Explain why Karatsuba multiplication needs only three recursive products.",
  );
  await capture("new-tutorial");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.setViewportSize({ width: 860, height: 900 });
  await capture("workbench-narrow");
} finally {
  await browser.close();
}
if (errors.length) {
  throw new Error(`Capture observed browser errors:\n${errors.join("\n")}`);
}
await writeFile(resolve(output, "report.json"), `${JSON.stringify({ state: "passed", evidenceClass: "browser-documentation-captures", seededProjects: 0, seededJobs: 0, captures, errors }, null, 2)}\n`);
console.log(`Captured AI Video Tutorial Generator documentation images in ${output}`);
