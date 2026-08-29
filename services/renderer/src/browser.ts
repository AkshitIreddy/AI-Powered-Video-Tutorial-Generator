import { createReadStream } from "node:fs";
import { access, mkdir } from "node:fs/promises";
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
          await page.screenshot({ ...screenshotOptions, scale: "device", omitBackground: false });
        },
        async close() { await context.close(); },
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
  #verified = false;

  constructor(driver: ChromiumDriver, policy: PinnedBrowserPolicy, renderer = new FrameRenderer()) {
    this.#driver = driver;
    this.#policy = policy;
    this.#renderer = renderer;
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
    await this.verifyBrowser();
    const rendered = this.#renderer.render(manifest, frame, "final");
    await mkdir(dirname(outputPath), { recursive: true });
    const page = await this.#driver.newPage();
    try {
      await page.setViewportSize({ width: manifest.target.width, height: manifest.target.height });
      await page.setContent(rendered.html);
      await page.waitForRenderReady();
      await page.screenshot({ path: outputPath, type: "png", animations: "disabled", caret: "hide" });
    } finally {
      await page.close();
    }
    return {
      frame,
      outputPath,
      contentHash: rendered.contentHash,
      outputSha256: await sha256File(outputPath),
      browserVersion: this.#driver.version,
    };
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
    await this.#driver.close();
  }
}

export function renderedFrameDataUrl(frame: RenderedFrame): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(frame.html)}`;
}
