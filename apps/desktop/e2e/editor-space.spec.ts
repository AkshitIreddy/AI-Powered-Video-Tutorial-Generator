import { test, expect } from "@playwright/test";
import { configureE2eWorkspace } from "./fixtures";

// 860px is the native window's supported minimum width.
for (const viewport of [{ width: 1440, height: 960 }, { width: 1366, height: 640 }, { width: 860, height: 800 }]) {
  test(`editor keeps playback and transcript usable at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await configureE2eWorkspace(page, "example");
    await page.getByRole("button", { name: /^open project$/i }).click();
    await page.getByRole("navigation", { name: "Project workspace" }).getByRole("button", { name: "Studio", exact: true }).click();
    await page.getByRole("button", { name: /advanced editor/i }).click();
    const editor = page.getByRole("application", { name: /advanced video editor/i });
    const transport = page.getByRole("group", { name: "Playback transport" });
    const workspace = page.locator(".aly-editor-shell__workspace");
    await expect(transport).toBeVisible();
    for (const splitter of await editor.getByRole("separator").all()) {
      expect(Number(await splitter.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(Number(await splitter.getAttribute("aria-valuemax")));
    }
    // Visibility alone passed the old test while the transport was below the
    // scrollport. Assert actual geometric containment and no center overflow.
    await expect.poll(async () => {
      const control = await transport.boundingBox();
      const region = await workspace.boundingBox();
      return !!control && !!region && control.y >= region.y && control.y + control.height <= region.y + region.height + 1;
    }).toBe(true);
    expect(await page.locator(".aly-editor-shell__center").evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
    await page.getByRole("button", { name: "Transcript", exact: true }).click();
    const cue = page.locator(".aly-editor-transcript__cue").first();
    const text = cue.getByRole("textbox", { name: "Transcript" });
    const textBounds = (await text.boundingBox())!;
    const cueBounds = (await cue.boundingBox())!;
    expect(textBounds.width / cueBounds.width).toBeGreaterThan(0.85);
    await text.fill("Unfinished wording must survive leaving the editor.");
    await page.getByRole("button", { name: "Return to scene", exact: true }).click();
    await page.getByRole("button", { name: /advanced editor/i }).click();
    await page.getByRole("button", { name: "Transcript", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Transcript", exact: true }).first()).toHaveValue("Unfinished wording must survive leaving the editor.");
    await page.mouse.move(viewport.width - 10, viewport.height - 10);
    await page.screenshot({ path: testInfo.outputPath("editor-space.png") });
    await expect(editor).toBeVisible();
  });
}
