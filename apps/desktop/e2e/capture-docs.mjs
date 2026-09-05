import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = process.env.ALYSTRIA_PREVIEW_URL ?? "http://127.0.0.1:1438";
const output = resolve(import.meta.dirname, "../../../docs/images");
await mkdir(output, { recursive: true });

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

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: /your teaching workbench/i }).waitFor();
await page.screenshot({ path: resolve(output, "alystria-home.png"), fullPage: false });

await page.getByRole("button", { name: /^open project$/i }).click();
await page
  .getByRole("navigation", { name: /project workspace/i })
  .getByRole("button", { name: /^studio$/i })
  .click();
await page.getByTestId("shared-scene-preview").waitFor();
await page.screenshot({ path: resolve(output, "alystria-studio.png"), fullPage: false });

await page.getByRole("button", { name: /all projects/i }).click();
await page.getByRole("button", { name: /models & providers/i }).click();
await page.screenshot({ path: resolve(output, "alystria-providers.png"), fullPage: false });

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: /your teaching workbench/i }).waitFor();
await page.getByRole("button", { name: /new tutorial/i }).first().click();
await page.getByPlaceholder(/explain why karatsuba/i).fill(
  "Explain Karatsuba multiplication to an undergraduate using an intuitive visual analogy.",
);
await page.screenshot({ path: resolve(output, "alystria-new-tutorial.png"), fullPage: false });

await page.setViewportSize({ width: 860, height: 900 });
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: /your teaching workbench/i }).waitFor();
await page.screenshot({ path: resolve(output, "alystria-narrow.png"), fullPage: false });

await browser.close();
if (errors.length) {
  throw new Error(`Capture observed browser errors:\n${errors.join("\n")}`);
}
console.log(`Captured Alystria documentation images in ${output}`);
