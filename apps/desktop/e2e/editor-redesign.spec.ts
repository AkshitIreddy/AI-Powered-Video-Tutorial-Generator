import { expect, test, type Page } from "@playwright/test";
import { configureE2eWorkspace } from "./fixtures";

async function openAdvancedEditor(page: Page) {
  await configureE2eWorkspace(page, "example");
  await page.getByRole("button", { name: /^open project$/i }).click();
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /studio/i }).click();
  await page.getByRole("button", { name: /advanced editor/i }).click();
  await expect(page.getByRole("application", { name: /advanced video editor/i })).toBeVisible();
}

test.describe("editor workspace redesign", () => {
  test.beforeEach(async ({ page }) => {
    await openAdvancedEditor(page);
  });

  test("shows one project title in a single-side dock with resizable panels", async ({ page }, testInfo) => {
    const output = testInfo.outputPath("editor-redesign");
    const editor = page.getByRole("application", { name: /advanced video editor/i });
    const title = await editor.locator(".aly-editor-shell__identity h1").textContent();
    expect(title?.trim().length).toBeGreaterThan(0);
    await expect(editor.getByRole("heading", { name: title!.trim() })).toHaveCount(1);

    for (const panel of ["Media", "Transcript", "Inspector"]) {
      await expect(page.getByRole("navigation", { name: /editor side panels/i }).getByRole("button", { name: panel, exact: true })).toBeVisible();
    }
    await expect(page.locator(".aly-editor-shell__right-panel")).toHaveCount(0);
    await expect(page.locator(".aly-editor-panel-tabs")).toHaveCount(0);
    await expect(page.getByRole("separator", { name: "Resize side panel width" })).toBeVisible();
    await expect(page.getByRole("separator", { name: "Resize timeline height" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export project JSON" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export OTIO" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import project" })).toBeVisible();
    await page.screenshot({ path: `${output}-full.png` });
    await page.locator(".aly-editor-shell__workspace").screenshot({ path: `${output}-workspace.png` });

    await page.getByRole("button", { name: "Transcript", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Transcript" })).toBeVisible();
    await page.locator(".aly-editor-shell__workspace").screenshot({ path: `${output}-transcript.png` });

    await page.getByRole("separator", { name: "Resize side panel width" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("separator", { name: "Resize side panel width" })).not.toHaveAttribute("aria-valuenow", "328");

    await page.getByRole("button", { name: "Collapse side panel" }).click();
    await expect(page.getByRole("separator", { name: "Resize side panel width" })).toHaveCount(0);
    await page.locator(".aly-editor-shell__center").screenshot({ path: `${output}-dock-collapsed.png` });
    await page.getByRole("button", { name: "Expand side panel" }).click();
    await expect(page.getByRole("separator", { name: "Resize side panel width" })).toBeVisible();

    await page.getByRole("button", { name: "Split", exact: true }).focus();
    await expect(page.getByRole("tooltip")).toContainText("Split every selected clip");
    await page.screenshot({ path: `${output}-tooltip.png` });
  });

  test("inspects a selected clip and compacts empty tracks", async ({ page }, testInfo) => {
    const output = testInfo.outputPath("editor-redesign-inspect");
    await page.getByRole("button", { name: /one multiplication disappears, slides/i }).click();
    await page.getByRole("button", { name: "Inspector", exact: true }).click();
    await expect(page.getByRole("heading", { name: "One multiplication disappears" })).toBeVisible();
    await page.locator(".aly-editor-dock").screenshot({ path: `${output}-inspector.png` });

    await expect(page.getByRole("button", { name: "Hide empty tracks" })).toHaveAttribute("aria-pressed", "true");
    const hiddenTracksNote = page.getByRole("status").filter({ hasText: /empty tracks? hidden/ });
    await expect(hiddenTracksNote).toBeVisible();
    await page.getByLabel("Timeline zoom").fill("240");
    const scroll = page.locator(".aly-editor-timeline__scroll");
    await expect.poll(() => scroll.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await scroll.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    const footerGeometry = await page.locator(".aly-editor-timeline").evaluate((timeline) => {
      const scroll = timeline.querySelector<HTMLElement>(".aly-editor-timeline__scroll")!;
      const footer = timeline.querySelector<HTMLElement>(".aly-editor-timeline__hidden-note")!;
      const timelineRect = timeline.getBoundingClientRect();
      const scrollRect = scroll.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      return {
        scrollLeft: scroll.scrollLeft,
        timelineLeft: timelineRect.left,
        timelineRight: timelineRect.right,
        scrollBottom: scrollRect.bottom,
        footerLeft: footerRect.left,
        footerRight: footerRect.right,
        footerTop: footerRect.top,
      };
    });
    expect(footerGeometry.scrollLeft).toBeGreaterThan(0);
    expect(Math.abs(footerGeometry.footerLeft - footerGeometry.timelineLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(footerGeometry.footerRight - footerGeometry.timelineRight)).toBeLessThanOrEqual(1);
    expect(footerGeometry.footerTop).toBeGreaterThanOrEqual(footerGeometry.scrollBottom - 1);
    await expect(page.getByRole("button", { name: "Show empty tracks", exact: true })).toBeInViewport();
    await page.locator(".aly-editor-timeline").screenshot({ path: `${output}-empty-hidden.png` });
    await page.getByRole("button", { name: "Show empty tracks", exact: true }).click();
    await expect(page.getByRole("group", { name: "Slides track" })).toBeVisible();
  });

  test("persists a dragged dock width across a reload", async ({ page }) => {
    const splitter = page.getByRole("separator", { name: "Resize side panel width" });
    const before = Number(await splitter.getAttribute("aria-valuenow"));
    const box = (await splitter.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    const after = Number(await splitter.getAttribute("aria-valuenow"));
    expect(after).toBeGreaterThan(before);
    const saved = await page.evaluate(() => (JSON.parse(localStorage.getItem("alystria.editor.layout.v1")!) as { dockWidth: number }).dockWidth);
    expect(saved).toBe(after);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".app-shell").waitFor();
    await page.getByRole("button", { name: /^open project$/i }).click();
    await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /studio/i }).click();
    await page.getByRole("button", { name: /advanced editor/i }).click();
    await expect(page.getByRole("separator", { name: "Resize side panel width" })).toHaveAttribute("aria-valuenow", String(after));
  });

  test.describe("short laptop height", () => {
    test.use({ viewport: { width: 1366, height: 640 } });
    test("keeps header, transport, and timeline usable", async ({ page }, testInfo) => {
      const output = testInfo.outputPath("editor-redesign-short");
      await expect(page.locator(".aly-editor-shell__topbar")).toBeVisible();
      await expect(page.getByRole("group", { name: "Playback transport" })).toBeVisible();
      await expect(page.locator(".aly-editor-timeline__toolbar")).toBeVisible();
      await page.screenshot({ path: `${output}-short.png` });
    });
  });
});
