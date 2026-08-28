import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserPage, ChromiumDriver } from "../src/browser.js";
import { PinnedBrowserCapture } from "../src/browser.js";
import { fixtureManifest } from "../src/fixture.js";

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
