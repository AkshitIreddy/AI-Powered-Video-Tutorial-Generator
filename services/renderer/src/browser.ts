import { createReadStream } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { constants } from "node:fs";
import type { RenderManifest, RenderedFrame } from "./contracts.js";
import type { FrameRange } from "./ranges.js";
import { validateFrameRange } from "./ranges.js";
import { FrameRenderer } from "./runtime.js";

export interface BrowserPage {
  setViewportSize(size: Readonly<{ width: number; height: number }>): Promise<void>;
  setContent(html: string): Promise<void>;
  waitForRenderReady(): Promise<void>;
  screenshot(options: Readonly<{ path: string; type: "png"; animations: "disabled"; caret: "hide" }>): Promise<void>;
  /**
   * Restores the page to a sterile document after a frame capture. Pages that
   * do not expose this hook are closed after every lease and are never pooled.
   */
  resetForReuse?(): Promise<void>;
  close(): Promise<void>;
}

export interface ChromiumDriver {
  readonly name: string;
  readonly executablePath: string;
  readonly version: string;
  /** The adapter must deny every network request, including redirects and service workers. */
  readonly networkPolicy: "deny";
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

export interface PinnedBrowserPolicy {
  readonly expectedSha256: string;
  readonly expectedVersion: string;
}

export interface CaptureResult {
  readonly frame: number;
  readonly outputPath: string;
  readonly contentHash: string;
  readonly outputSha256: string;
  readonly browserVersion: string;
}

export interface PinnedBrowserCaptureOptions {
  /** Maximum number of persistent, concurrently leased browser pages. */
  readonly maximumPages?: number;
}

const DEFAULT_MAXIMUM_PAGES = 8;
const MAXIMUM_CAPTURE_ATTEMPTS = 2;

function isRecoverablePageClosure(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /(?:target page, context or browser has been closed|target closed|page (?:is )?closed|browser has been closed|session closed.*page has been closed)/i.test(message);
}

interface PageWaiter {
  readonly resolve: () => void;
  readonly reject: (reason: Error) => void;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export interface PlaywrightChromiumDriverOptions {
  /** When omitted, playwright-core's revision-pinned Chromium is used. */
  readonly executablePath?: string;
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor?: number;
  readonly locale?: string;
}

/**
 * Creates the production Chromium adapter without giving rendered documents a
 * network path. Importing playwright-core lazily keeps pure render consumers
 * free from browser startup and lets the desktop runtime inject the exact
 * packaged executable.
 */
export async function createPlaywrightChromiumDriver(options: PlaywrightChromiumDriverOptions): Promise<ChromiumDriver> {
  const playwright = await import("playwright-core");
  const executablePath = options.executablePath ?? playwright.chromium.executablePath();
  await access(executablePath, constants.R_OK);
  const softwareOnly = process.env.ALYSTRIA_RENDERER_SOFTWARE_ONLY === "1";
  const browser = await playwright.chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-domain-reliability",
      "--disable-features=MediaRouter,OptimizationHints,Translate",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--no-pings",
      // An explicit CPU-only test/diagnostic path for shared workstations.
      // It does not alter the normal production policy, but prevents a
      // Chromium render from contending for the NVIDIA device when the owner
      // has reserved it for another task.
      ...(softwareOnly ? ["--disable-gpu", "--disable-gpu-compositing", "--use-angle=swiftshader"] : []),
    ],
  });
  let closed = false;

  return {
    name: "playwright-chromium",
    executablePath,
    version: browser.version(),
    networkPolicy: "deny",
    async newPage() {
      if (closed) throw new Error("Chromium driver is closed");
      const context = await browser.newContext({
        viewport: { width: options.width, height: options.height },
        deviceScaleFactor: options.deviceScaleFactor ?? 1,
        colorScheme: "light",
        locale: options.locale ?? "en-US",
        timezoneId: "UTC",
        reducedMotion: "reduce",
        serviceWorkers: "block",
      });
      await context.route("**/*", async (route) => route.abort("blockedbyclient"));
      const page = await context.newPage();
      const devtools = await context.newCDPSession(page);
      let pageClosed = false;
      return {
        async setViewportSize(size) { await page.setViewportSize(size); },
        async setContent(html) { await page.setContent(html, { waitUntil: "domcontentloaded" }); },
        async waitForRenderReady() {
          await page.waitForFunction(() => document.body?.dataset.renderReady === "true");
          await page.evaluate(async () => {
            const fontReady = (globalThis as typeof globalThis & {
              __alystriaFontReady?: Promise<readonly string[]>;
            }).__alystriaFontReady;
            if (fontReady) await fontReady;
            if (document.body.dataset.renderError) {
              throw new Error(document.body.dataset.renderError);
            }
            await document.fonts.ready;
            // A newly injected SVG/foreignObject document can report its DOM
            // ready before Chromium has committed text shaping to a paint
            // frame. Two frame boundaries make the authoritative screenshot
            // deterministic rather than occasionally capturing partial glyph
            // tiles from the initial composite.
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          });
        },
        async screenshot(screenshotOptions) {
          // Chromium's DevTools protocol exposes a lossless PNG speed profile
          // that Playwright's screenshot surface does not. On the Windows
          // NVIDIA reference machine it is over twice as fast for 1080p
          // authoritative frames. The bytes remain PNG and are still hashed
          // immediately by the trust boundary after this write.
          const screenshot = await devtools.send("Page.captureScreenshot", {
            format: screenshotOptions.type,
            fromSurface: true,
            captureBeyondViewport: false,
            optimizeForSpeed: true,
          });
          await writeFile(screenshotOptions.path, Buffer.from(screenshot.data, "base64"));
        },
        async resetForReuse() {
          if (pageClosed) throw new Error("Chromium page is closed");
          // Navigation replaces the Window and document, removing globals,
          // event handlers, timers and DOM mutations left by the prior frame.
          // Context-scoped state is cleared explicitly while the deny-all
          // route and blocked-service-worker policy remain installed.
          await page.goto("about:blank", { waitUntil: "load" });
          await context.clearCookies();
          await context.clearPermissions();
          for (const sibling of context.pages()) {
            if (sibling !== page) await sibling.close();
          }
        },
        async close() {
          if (pageClosed) return;
          pageClosed = true;
          await context.close();
        },
      } satisfies BrowserPage;
    },
    async close() {
      if (closed) return;
      closed = true;
      await browser.close();
    },
  };
}

/** Adapter-neutral authoritative capture loop. Playwright/Puppeteer live outside renderer core. */
export class PinnedBrowserCapture {
  readonly #driver: ChromiumDriver;
  readonly #policy: PinnedBrowserPolicy;
  readonly #renderer: FrameRenderer;
  readonly #maximumPages: number;
  readonly #availablePages: BrowserPage[] = [];
  readonly #allPages = new Set<BrowserPage>();
  readonly #pageCreations = new Set<Promise<BrowserPage>>();
  readonly #waiters: PageWaiter[] = [];
  #creatingPages = 0;
  #closed = false;
  #closePromise: Promise<void> | undefined;
  #verified = false;

  constructor(
    driver: ChromiumDriver,
    policy: PinnedBrowserPolicy,
    renderer = new FrameRenderer(),
    options: PinnedBrowserCaptureOptions = {},
  ) {
    this.#driver = driver;
    this.#policy = policy;
    this.#renderer = renderer;
    const maximumPages = options.maximumPages ?? DEFAULT_MAXIMUM_PAGES;
    if (!Number.isSafeInteger(maximumPages) || maximumPages < 1 || maximumPages > DEFAULT_MAXIMUM_PAGES) {
      throw new TypeError(`maximumPages must be an integer between 1 and ${DEFAULT_MAXIMUM_PAGES}`);
    }
    this.#maximumPages = maximumPages;
  }

  async verifyBrowser(): Promise<void> {
    if (this.#verified) return;
    if (this.#driver.networkPolicy !== "deny") {
      throw new Error("Authoritative browser capture requires a deny-all network policy");
    }
    if (this.#driver.version !== this.#policy.expectedVersion) {
      throw new Error(`Chromium version mismatch: expected ${this.#policy.expectedVersion}, got ${this.#driver.version}`);
    }
    const actualHash = await sha256File(this.#driver.executablePath);
    if (actualHash.toLowerCase() !== this.#policy.expectedSha256.toLowerCase()) {
      throw new Error(`Chromium binary hash mismatch: expected ${this.#policy.expectedSha256}, got ${actualHash}`);
    }
    this.#verified = true;
  }

  async captureFrame(manifest: RenderManifest, frame: number, outputPath: string): Promise<CaptureResult> {
    if (this.#closed) throw new Error("Browser capture is closed");
    await this.verifyBrowser();
    const rendered = this.#renderer.render(manifest, frame, "final");
    await mkdir(dirname(outputPath), { recursive: true });
    for (let attempt = 1; attempt <= MAXIMUM_CAPTURE_ATTEMPTS; attempt += 1) {
      const page = await this.#acquirePage();
      let discardPage = false;
      try {
        await page.setViewportSize({ width: manifest.target.width, height: manifest.target.height });
        await page.setContent(rendered.html);
        await page.waitForRenderReady();
        await page.screenshot({ path: outputPath, type: "png", animations: "disabled", caret: "hide" });
      } catch (error) {
        const mayRetry = !this.#closed && attempt < MAXIMUM_CAPTURE_ATTEMPTS && isRecoverablePageClosure(error);
        if (!mayRetry) throw error;
        // A target-closure error makes every later operation on the lease
        // suspect. Remove that page from the pool before acquiring a clean
        // context for the same deterministic frame.
        discardPage = true;
        continue;
      } finally {
        if (discardPage) await this.#discardPage(page);
        else await this.#releasePage(page);
      }
      return {
        frame,
        outputPath,
        contentHash: rendered.contentHash,
        outputSha256: await sha256File(outputPath),
        browserVersion: this.#driver.version,
      };
    }
    throw new Error("Browser capture exhausted its bounded frame attempts");
  }

  async captureRange(manifest: RenderManifest, range: FrameRange, pathForFrame: (frame: number) => string): Promise<readonly CaptureResult[]> {
    validateFrameRange(range);
    const results: CaptureResult[] = [];
    for (let frame = range.startFrame; frame < range.endFrame; frame += 1) {
      results.push(await this.captureFrame(manifest, frame, pathForFrame(frame)));
    }
    return results;
  }

  async close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    const closedError = new Error("Browser capture is closed");
    for (const waiter of this.#waiters.splice(0)) waiter.reject(closedError);
    const pages = [...this.#allPages];
    const pageCreations = [...this.#pageCreations];
    this.#availablePages.length = 0;
    this.#allPages.clear();
    this.#closePromise = (async () => {
      const pageResults = await Promise.allSettled(pages.map(async (page) => page.close()));
      let driverError: unknown;
      try {
        await this.#driver.close();
      } catch (error) {
        driverError = error;
      }
      // A page creation already admitted by the bound may settle only after
      // driver shutdown begins. Its acquire path observes #closed and closes
      // the newly returned page before rejecting, so teardown waits for it.
      await Promise.allSettled(pageCreations);
      const failures = pageResults
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason as unknown);
      if (driverError !== undefined) failures.push(driverError);
      if (failures.length > 0) throw new AggregateError(failures, "Failed to close browser capture resources");
    })();
    return this.#closePromise;
  }

  async #acquirePage(): Promise<BrowserPage> {
    while (true) {
      if (this.#closed) throw new Error("Browser capture is closed");
      const available = this.#availablePages.pop();
      if (available) return available;
      if (this.#allPages.size + this.#creatingPages < this.#maximumPages) {
        this.#creatingPages += 1;
        const creation = this.#createPage();
        this.#pageCreations.add(creation);
        try {
          return await creation;
        } finally {
          this.#pageCreations.delete(creation);
          this.#creatingPages -= 1;
          this.#wakeNextWaiter();
        }
      }
      await new Promise<void>((resolve, reject) => {
        this.#waiters.push({ resolve, reject });
      });
    }
  }

  async #createPage(): Promise<BrowserPage> {
    const page = await this.#driver.newPage();
    if (this.#closed) {
      await page.close().catch(() => undefined);
      throw new Error("Browser capture is closed");
    }
    this.#allPages.add(page);
    return page;
  }

  async #releasePage(page: BrowserPage): Promise<void> {
    if (!this.#allPages.has(page)) return;
    if (this.#closed || page.resetForReuse === undefined) {
      await this.#discardPage(page);
      return;
    }
    try {
      await page.resetForReuse();
    } catch {
      await this.#discardPage(page);
      return;
    }
    if (this.#closed) {
      await this.#discardPage(page);
      return;
    }
    this.#availablePages.push(page);
    this.#wakeNextWaiter();
  }

  async #discardPage(page: BrowserPage): Promise<void> {
    if (!this.#allPages.delete(page)) return;
    const availableIndex = this.#availablePages.indexOf(page);
    if (availableIndex >= 0) this.#availablePages.splice(availableIndex, 1);
    await page.close().catch(() => undefined);
    this.#wakeNextWaiter();
  }

  #wakeNextWaiter(): void {
    this.#waiters.shift()?.resolve();
  }
}

export function renderedFrameDataUrl(frame: RenderedFrame): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(frame.html)}`;
}
