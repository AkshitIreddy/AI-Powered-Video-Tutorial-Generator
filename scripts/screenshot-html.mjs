#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const [htmlInput, imageOutput, browserInput] = process.argv.slice(2);
if (!htmlInput || !imageOutput || !browserInput) {
  throw new Error("Usage: node screenshot-html.mjs <input.html> <output.png> <browser.exe>");
}
const requireFromRenderer = createRequire(new URL("../services/renderer/package.json", import.meta.url));
const { chromium } = requireFromRenderer("playwright-core");
const html = await readFile(resolve(htmlInput), "utf8");
const browser = await chromium.launch({
  executablePath: resolve(browserInput),
  headless: true,
  args: ["--disable-background-networking", "--no-first-run"],
});
try {
  const context = await browser.newContext({ viewport: { width: 1800, height: 1400 }, deviceScaleFactor: 1 });
  await context.route("**/*", (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: resolve(imageOutput), type: "png", fullPage: true, animations: "disabled", caret: "hide" });
  await context.close();
} finally {
  await browser.close();
}
process.stdout.write(`${JSON.stringify({ imageOutput: resolve(imageOutput) })}\n`);
