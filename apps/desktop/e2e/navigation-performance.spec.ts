import { expect, test, type Page } from "@playwright/test";
import { configureE2eWorkspace } from "./fixtures";

type NavigationSample = {
  label: string;
  firstPaintMs: number;
  settledMs: number;
  elementCount: number;
  imageCount: number;
  pendingImageCount: number;
  maxLongTaskMs: number;
  modelCardCount: number;
  progressivePlaceholderCount: number;
  sectionElementCounts: Array<{ selector: string; elements: number }>;
};

declare global {
  interface Window {
    __alystriaNavigationLongTasks?: PerformanceEntry[];
    __alystriaNavigationObserver?: PerformanceObserver;
    __alystriaNavigationFirstPaint?: Promise<number>;
  }
}

async function measureNavigation(page: Page, label: string): Promise<NavigationSample> {
  await page.evaluate((routeLabel) => {
    window.__alystriaNavigationObserver?.disconnect();
    window.__alystriaNavigationLongTasks = [];
    window.__alystriaNavigationObserver = new PerformanceObserver((list) => window.__alystriaNavigationLongTasks?.push(...list.getEntries()));
    window.__alystriaNavigationObserver.observe({ type: "longtask" });
    const control = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === routeLabel);
    if (!control) throw new Error(`Navigation control not found: ${routeLabel}`);
    window.__alystriaNavigationFirstPaint = new Promise<number>((resolve) => {
      control.addEventListener("click", () => {
        const startedAt = performance.now();
        const observer = new MutationObserver(() => {
          if (control.getAttribute("aria-current") !== "page") return;
          observer.disconnect();
          requestAnimationFrame(() => resolve(performance.now() - startedAt));
        });
        observer.observe(document.body, { attributes: true, childList: true, subtree: true });
      }, { capture: true, once: true });
    });
  }, label);

  const control = page.getByRole("button", { name: label, exact: true });
  const settledStartedAt = Date.now();
  await control.click();
  await expect(control).toHaveAttribute("aria-current", "page");
  const firstPaintMs = await page.evaluate(() => window.__alystriaNavigationFirstPaint!);
  if (label === "Models & providers") {
    await expect(page.locator(".provider-progressive-placeholder")).toHaveCount(0);
  }
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  return page.evaluate(({ routeLabel, firstPaint, settledDuration }) => {
    window.__alystriaNavigationLongTasks?.push(...(window.__alystriaNavigationObserver?.takeRecords() ?? []));
    window.__alystriaNavigationObserver?.disconnect();
    const images = [...document.querySelectorAll<HTMLImageElement>("main img")];
    return {
      label: routeLabel,
      firstPaintMs: firstPaint,
      settledMs: settledDuration,
      elementCount: document.querySelectorAll("main *").length,
      imageCount: images.length,
      pendingImageCount: images.filter((image) => !image.complete || image.naturalWidth === 0).length,
      maxLongTaskMs: Math.max(0, ...(window.__alystriaNavigationLongTasks ?? []).map((entry) => entry.duration)),
      modelCardCount: document.querySelectorAll(".aly-catalog-card").length,
      progressivePlaceholderCount: document.querySelectorAll(".provider-progressive-placeholder").length,
      sectionElementCounts: [...document.querySelectorAll<HTMLElement>("main > .page > *")].map((element) => ({
        selector: `${element.tagName.toLowerCase()}.${element.className}`,
        elements: element.querySelectorAll("*").length,
      })),
    };
  }, { routeLabel: label, firstPaint: firstPaintMs, settledDuration: Date.now() - settledStartedAt });
}

test("global navigation stays responsive after rich pages have mounted", async ({ page }) => {
  await configureE2eWorkspace(page, "example");
  await page.evaluate(() => {
    document.documentElement.dataset.reduceMotion = "true";
  });

  const labels = ["Projects", "Templates", "Library", "Models & providers", "Settings & diagnostics", "Home"];
  const cold: NavigationSample[] = [];
  const warm: NavigationSample[] = [];
  for (const label of labels) cold.push(await measureNavigation(page, label));
  for (const label of labels) warm.push(await measureNavigation(page, label));

  const report = { cold, warm };
  console.log(`NAVIGATION_PERFORMANCE ${JSON.stringify(report)}`);
  await test.info().attach("navigation-performance.json", {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: "application/json",
  });

  const providerSamples = [...cold, ...warm].filter((sample) => sample.label === "Models & providers");
  expect(providerSamples.every((sample) => sample.modelCardCount === 6)).toBe(true);
  expect(providerSamples.every((sample) => sample.progressivePlaceholderCount === 0)).toBe(true);
  expect(Math.max(...providerSamples.map((sample) => sample.maxLongTaskMs))).toBeLessThan(100);
  expect(Math.max(...warm.map((sample) => sample.firstPaintMs))).toBeLessThan(200);
});
