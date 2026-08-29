import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserPage, ChromiumDriver } from "../src/browser.js";
import { createPlaywrightChromiumDriver, PinnedBrowserCapture, sha256File } from "../src/browser.js";
import { fixtureManifest, fixtureTarget } from "../src/fixture.js";

test("capture verifies pinned browser before writing frames", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alystria-browser-test-"));
  try {
    const executablePath = join(directory, "chromium.bin");
    const bytes = Buffer.from("pinned chromium fixture");
    await writeFile(executablePath, bytes);
    let html = "";
    const page: BrowserPage = {
      async setViewportSize() {},
      async setContent(value) { html = value; },
      async waitForRenderReady() { assert.match(html, /data-render-ready="true"/); },
      async screenshot(options) { await writeFile(options.path, Buffer.from("PNG fixture")); },
      async close() {},
    };
    const driver: ChromiumDriver = {
      name: "test",
      executablePath,
      version: "123.0.1",
      networkPolicy: "deny",
      async newPage() { return page; },
      async close() {},
    };
    const capture = new PinnedBrowserCapture(driver, {
      expectedVersion: "123.0.1",
      expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    const output = join(directory, "frames", "00000000.png");
    const result = await capture.captureFrame(fixtureManifest(), 0, output);
    assert.equal(result.frame, 0);
    assert.match(result.outputSha256, /^[0-9a-f]{64}$/);
    assert.equal(result.browserVersion, "123.0.1");
    assert.equal((await readFile(output, "utf8")), "PNG fixture");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("capture rejects an unpinned browser", async () => {
  const driver: ChromiumDriver = {
    name: "test",
    executablePath: "missing",
    version: "124",
    networkPolicy: "deny",
    async newPage() { throw new Error("must not open"); },
    async close() {},
  };
  const capture = new PinnedBrowserCapture(driver, { expectedVersion: "123", expectedSha256: "00" });
  await assert.rejects(capture.verifyBrowser(), /version mismatch/);
});

test("authoritative Chromium capture does not emit alternating partial SVG text surfaces", {
  skip: process.env.ALYSTRIA_CHROMIUM_PATH ? false : "set ALYSTRIA_CHROMIUM_PATH to run the pinned-browser paint regression",
  timeout: 60_000,
}, async () => {
  const executablePath = process.env.ALYSTRIA_CHROMIUM_PATH!;
  const directory = await mkdtemp(join(tmpdir(), "alystria-browser-paint-test-"));
  const previousSoftwareOnly = process.env.ALYSTRIA_RENDERER_SOFTWARE_ONLY;
  process.env.ALYSTRIA_RENDERER_SOFTWARE_ONLY = "1";
  let capture: PinnedBrowserCapture | undefined;
  try {
    const driver = await createPlaywrightChromiumDriver({
      executablePath,
      width: 1_280,
      height: 720,
      deviceScaleFactor: 1,
    });
    capture = new PinnedBrowserCapture(driver, {
      expectedVersion: driver.version,
      expectedSha256: await sha256File(executablePath),
    });
    const manifest = fixtureManifest(fixtureTarget({
      width: 1_280,
      height: 720,
      frameRate: { numerator: 24, denominator: 1 },
    }));
    const hashes = new Set<string>();
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const output = join(directory, `settled-${String(attempt).padStart(2, "0")}.png`);
      const result = await capture.captureFrame(manifest, 72, output);
      hashes.add(result.outputSha256);
      assert.ok((await stat(output)).size > 20_000, `capture ${attempt} is unexpectedly sparse`);
    }
    assert.equal(hashes.size, 1, "identical SVG input produced partial or blank capture variants");
  } finally {
    await capture?.close();
    if (previousSoftwareOnly === undefined) delete process.env.ALYSTRIA_RENDERER_SOFTWARE_ONLY;
    else process.env.ALYSTRIA_RENDERER_SOFTWARE_ONLY = previousSoftwareOnly;
    await rm(directory, { recursive: true, force: true });
  }
});
