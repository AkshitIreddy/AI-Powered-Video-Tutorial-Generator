import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserPage, ChromiumDriver } from "../src/browser.js";
import { createPlaywrightChromiumDriver, PinnedBrowserCapture, sha256File } from "../src/browser.js";
import { fixtureManifest, fixtureTarget } from "../src/fixture.js";

function deferred(): Readonly<{
  promise: Promise<void>;
  resolve: () => void;
}> {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

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

test("capture reuses a bounded page pool under concurrent load", { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "alystria-browser-pool-test-"));
  try {
    const executablePath = join(directory, "chromium.bin");
    const bytes = Buffer.from("pinned chromium pool fixture");
    await writeFile(executablePath, bytes);
    const screenshotsMayFinish = deferred();
    let createdPages = 0;
    let activeScreenshots = 0;
    let peakActiveScreenshots = 0;
    let closedPages = 0;
    let resetPages = 0;
    let driverClosed = 0;
    const driver: ChromiumDriver = {
      name: "test",
      executablePath,
      version: "123.0.1",
      networkPolicy: "deny",
      async newPage() {
        createdPages += 1;
        return {
          async setViewportSize() {},
          async setContent() {},
          async waitForRenderReady() {},
          async screenshot(options) {
            activeScreenshots += 1;
            peakActiveScreenshots = Math.max(peakActiveScreenshots, activeScreenshots);
            await screenshotsMayFinish.promise;
            await writeFile(options.path, Buffer.from("PNG fixture"));
            activeScreenshots -= 1;
          },
          async resetForReuse() { resetPages += 1; },
          async close() { closedPages += 1; },
        };
      },
      async close() { driverClosed += 1; },
    };
    const capture = new PinnedBrowserCapture(driver, {
      expectedVersion: driver.version,
      expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    }, undefined, { maximumPages: 2 });
    const captures = Array.from({ length: 6 }, (_, frame) => (
      capture.captureFrame(fixtureManifest(), frame, join(directory, `${frame}.png`))
    ));

    while (activeScreenshots < 2) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(createdPages, 2);
    assert.equal(peakActiveScreenshots, 2);
    screenshotsMayFinish.resolve();
    await Promise.all(captures);
    assert.equal(createdPages, 2, "pages should be reused rather than recreated per frame");
    assert.equal(resetPages, 6, "every completed lease should be reset before reuse or idling");
    assert.equal(closedPages, 0, "pooled pages remain alive until teardown");

    await capture.close();
    assert.equal(closedPages, 2);
    assert.equal(driverClosed, 1);
    await capture.close();
    assert.equal(closedPages, 2, "teardown must be idempotent");
    assert.equal(driverClosed, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("capture resets persistent page state between frames", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alystria-browser-isolation-test-"));
  try {
    const executablePath = join(directory, "chromium.bin");
    const bytes = Buffer.from("pinned chromium isolation fixture");
    await writeFile(executablePath, bytes);
    let createdPages = 0;
    let leakedState: string | undefined;
    let html = "";
    const driver: ChromiumDriver = {
      name: "test",
      executablePath,
      version: "123.0.1",
      networkPolicy: "deny",
      async newPage() {
        createdPages += 1;
        return {
          async setViewportSize() {},
          async setContent(value) {
            assert.equal(leakedState, undefined, "previous frame state reached a new frame lease");
            html = value;
          },
          async waitForRenderReady() { assert.match(html, /data-render-ready="true"/); },
          async screenshot(options) {
            leakedState = "frame-owned-global";
            await writeFile(options.path, Buffer.from(html));
          },
          async resetForReuse() {
            html = "";
            leakedState = undefined;
          },
          async close() {},
        };
      },
      async close() {},
    };
    const capture = new PinnedBrowserCapture(driver, {
      expectedVersion: driver.version,
      expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    }, undefined, { maximumPages: 1 });

    const first = await capture.captureFrame(fixtureManifest(), 0, join(directory, "first.png"));
    const second = await capture.captureFrame(fixtureManifest(), 0, join(directory, "second.png"));
    assert.equal(createdPages, 1);
    assert.equal(first.outputSha256, second.outputSha256, "page reuse changed deterministic output bytes");
    await capture.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("capture teardown rejects queued work and closes leased pages", { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "alystria-browser-close-test-"));
  try {
    const executablePath = join(directory, "chromium.bin");
    const bytes = Buffer.from("pinned chromium close fixture");
    await writeFile(executablePath, bytes);
    const screenshotStarted = deferred();
    const screenshotMayFinish = deferred();
    let closedPages = 0;
    const driver: ChromiumDriver = {
      name: "test",
      executablePath,
      version: "123.0.1",
      networkPolicy: "deny",
      async newPage() {
        return {
          async setViewportSize() {},
          async setContent() {},
          async waitForRenderReady() {},
          async screenshot(options) {
            screenshotStarted.resolve();
            await screenshotMayFinish.promise;
            await writeFile(options.path, Buffer.from("PNG fixture"));
          },
          async resetForReuse() {},
          async close() { closedPages += 1; },
        };
      },
      async close() {},
    };
    const capture = new PinnedBrowserCapture(driver, {
      expectedVersion: driver.version,
      expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    }, undefined, { maximumPages: 1 });
    const active = capture.captureFrame(fixtureManifest(), 0, join(directory, "active.png"));
    await screenshotStarted.promise;
    const queued = capture.captureFrame(fixtureManifest(), 1, join(directory, "queued.png"));
    const closing = capture.close();
    await assert.rejects(queued, /closed/);
    screenshotMayFinish.resolve();
    await active;
    await closing;
    assert.equal(closedPages, 1, "the active pooled page should be closed exactly once");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("capture teardown waits for an admitted page creation and disposes it", { timeout: 10_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "alystria-browser-creating-close-test-"));
  try {
    const executablePath = join(directory, "chromium.bin");
    const bytes = Buffer.from("pinned chromium creating close fixture");
    await writeFile(executablePath, bytes);
    const creationStarted = deferred();
    const creationMayFinish = deferred();
    let closedPages = 0;
    let driverClosed = 0;
    const driver: ChromiumDriver = {
      name: "test",
      executablePath,
      version: "123.0.1",
      networkPolicy: "deny",
      async newPage() {
        creationStarted.resolve();
        await creationMayFinish.promise;
        return {
          async setViewportSize() {},
          async setContent() {},
          async waitForRenderReady() {},
          async screenshot() {},
          async resetForReuse() {},
          async close() { closedPages += 1; },
        };
      },
      async close() { driverClosed += 1; },
    };
    const capture = new PinnedBrowserCapture(driver, {
      expectedVersion: driver.version,
      expectedSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    const active = capture.captureFrame(fixtureManifest(), 0, join(directory, "active.png"));
    await creationStarted.promise;
    const closing = capture.close();
    let closeSettled = false;
    void closing.finally(() => { closeSettled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closeSettled, false, "teardown returned while page creation was still pending");
    creationMayFinish.resolve();

    await assert.rejects(active, /closed/);
    await closing;
    assert.equal(closedPages, 1);
    assert.equal(driverClosed, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
