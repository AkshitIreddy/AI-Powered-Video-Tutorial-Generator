import { expect, test } from "@playwright/test";
import { configureE2eWorkspace } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await configureE2eWorkspace(page, "example");
});

test("home, project, and studio flows render without page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.getByRole("heading", { name: /your teaching workbench/i })).toBeVisible();
  await page.getByRole("button", { name: /^open project$/i }).click();
  await expect(page.getByRole("heading", { name: /shape the learning journey/i })).toBeVisible();
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /studio/i }).click();
  await expect(page.locator(".studio-workspace")).toBeVisible();
  await page.getByRole("button", { name: /new candidate/i }).click();
  await expect(page.getByRole("heading", { name: /create a new candidate/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a new teaching moment opens in Studio and survives a browser reload", async ({ page }) => {
  await page.getByRole("button", { name: /^open project$/i }).click();
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /storyboard/i }).click();

  const originalSceneCount = await page.evaluate(() => {
    const snapshot = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    return snapshot.projects.find((project: { id: string }) => project.id === "karatsuba").scenes.length as number;
  });
  await page.getByRole("button", { name: /add a teaching moment/i }).click();

  await expect(page.locator(".studio-workspace")).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("New teaching moment");
  await page.getByLabel("Title", { exact: true }).fill("A learner checks the pattern");
  await page.getByLabel("Scene narration").fill("Pause, predict the next step, and explain which pattern stays invariant.");
  await expect.poll(async () => page.evaluate(() => {
    const snapshot = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    const project = snapshot.projects.find((item: { id: string }) => item.id === "karatsuba");
    return project.scenes.at(-1)?.title;
  })).toBe("A learner checks the pattern");
  await page.locator(".studio-workspace").screenshot({ path: "E:/temp/avt-audit-2026-09-05/new-teaching-moment-studio.png" });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^open project$/i }).click();
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /studio/i }).click();
  await page.getByRole("button", { name: /a learner checks the pattern/i }).last().click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("A learner checks the pattern");
  await expect(page.getByLabel("Scene narration")).toHaveValue(
    "Pause, predict the next step, and explain which pattern stays invariant.",
  );
  const reloadedSceneCount = await page.evaluate(() => {
    const snapshot = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    return snapshot.projects.find((project: { id: string }) => project.id === "karatsuba").scenes.length as number;
  });
  expect(reloadedSceneCount).toBe(originalSceneCount + 1);
});

test("included artwork reaches the shared scene renderer and merges into a saved editor", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The editor proof uses the full desktop workspace");
  const output = "E:/temp/avt-audit-2026-09-05/library-proof";

  await page.getByRole("button", { name: "Library", exact: true }).click();
  const paper = page.locator(".bundled-asset-card").filter({ hasText: "Warm paper canvas" });
  await paper.getByRole("button", { name: "Use background", exact: true }).click();
  await expect(page.locator(".bundled-library__feedback")).toContainText("Warm paper canvas is in the project library");

  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: /karatsuba, visually/i }).click();
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: "Studio", exact: true }).click();
  await page.getByRole("button", { name: /one multiplication disappears/i }).first().click();

  const renderedBackground = page.locator('[data-testid="shared-scene-preview"] [data-background-treatment="full-frame"] image').first();
  await expect(renderedBackground).toHaveAttribute("href", /^blob:/u);
  await expect(renderedBackground).toHaveAttribute("x", "0");
  await expect(renderedBackground).toHaveAttribute("y", "0");
  await expect(renderedBackground).toHaveAttribute("width", "1920");
  await expect(renderedBackground).toHaveAttribute("height", "1080");
  await expect(renderedBackground).not.toHaveAttribute("mask", /.+/u);
  const paperHash = await renderedBackground.evaluate(async (image) => {
    const response = await fetch(image.getAttribute("href")!);
    const bytes = await response.arrayBuffer();
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  });
  expect(paperHash).toBe("8bda5d7b9a5332d3d6f2ea0f48adc8721f253641b1be0934ccd819b9a572edf9");
  await page.locator(".canvas-stage").screenshot({ path: `${output}/paper-background-shared-renderer.png` });

  await page.getByRole("button", { name: /advanced editor/i }).click();
  const paperMedia = page.getByRole("listitem").filter({ hasText: "Warm paper canvas" });
  await expect(paperMedia).toContainText("ready");
  await expect(paperMedia.getByRole("button", { name: /place warm paper canvas at playhead/i })).toBeEnabled();
  await expect.poll(() => paperMedia.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.getByRole("button", { name: "Mute Music", exact: true }).click();
  await expect.poll(async () => page.evaluate(() => {
    const snapshot = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    const document = snapshot.projects.find((project: { id: string }) => project.id === "karatsuba")?.editorDocument;
    return document?.tracks.find((track: { kind: string }) => track.kind === "music")?.muted;
  })).toBe(true);
  const before = await page.evaluate(() => {
    const snapshot = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    const document = snapshot.projects.find((project: { id: string }) => project.id === "karatsuba").editorDocument;
    return { trackIds: document.tracks.map((track: { id: string }) => track.id), clipIds: document.tracks.flatMap((track: { clips: Array<{ id: string }> }) => track.clips.map((clip) => clip.id)), musicMuted: document.tracks.find((track: { kind: string }) => track.kind === "music")?.muted };
  });
  expect(before.musicMuted).toBe(true);
  await page.getByRole("button", { name: /return to scene/i }).click();
  await page.getByRole("button", { name: "All projects", exact: true }).click();
  await page.getByRole("button", { name: "Library", exact: true }).click();

  const underline = page.locator(".bundled-asset-card").filter({ hasText: "Teal brush underline" });
  await underline.getByRole("button", { name: "Use element", exact: true }).click();
  await expect(page.locator(".bundled-library__feedback")).toContainText("Teal brush underline is in the project library");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: /karatsuba, visually/i }).click();
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: "Studio", exact: true }).click();
  await page.getByRole("button", { name: /advanced editor/i }).click();

  const underlineMedia = page.getByRole("listitem").filter({ hasText: "Teal brush underline" });
  await expect(paperMedia).toContainText("ready");
  await expect(underlineMedia).toContainText("ready");
  await expect(underlineMedia.getByRole("button", { name: /place teal brush underline at playhead/i })).toBeEnabled();
  await expect.poll(() => underlineMedia.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.getByRole("button", { name: "Unmute Music", exact: true }).click();
  await page.getByRole("button", { name: "Mute Music", exact: true }).click();
  await expect.poll(async () => page.evaluate(() => {
    const snapshot = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    const assets = snapshot.projects.find((project: { id: string }) => project.id === "karatsuba")?.editorDocument?.assets ?? [];
    return assets.some((asset: { name: string; status: string }) => asset.name === "Teal brush underline" && asset.status === "ready");
  })).toBe(true);
  const after = await page.evaluate(() => {
    const snapshot = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    const document = snapshot.projects.find((project: { id: string }) => project.id === "karatsuba").editorDocument;
    return { trackIds: document.tracks.map((track: { id: string }) => track.id), clipIds: document.tracks.flatMap((track: { clips: Array<{ id: string }> }) => track.clips.map((clip) => clip.id)), musicMuted: document.tracks.find((track: { kind: string }) => track.kind === "music")?.muted, assets: document.assets.map((asset: { name: string; status: string }) => ({ name: asset.name, status: asset.status })) };
  });
  expect(after.trackIds).toEqual(before.trackIds);
  expect(after.clipIds).toEqual(before.clipIds);
  expect(after.musicMuted).toBe(true);
  expect(after.assets).toEqual(expect.arrayContaining([
    { name: "Warm paper canvas", status: "ready" },
    { name: "Teal brush underline", status: "ready" },
  ]));
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause playback", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pause playback", exact: true }).click();
  await underlineMedia.scrollIntoViewIfNeeded();
  await page.locator(".aly-editor-media-bin").screenshot({ path: `${output}/saved-editor-included-assets-media-bin.png` });
  await page.locator('[role="application"][aria-label="Advanced video editor"]').screenshot({ path: `${output}/saved-editor-included-assets-merged.png` });
});

test("stock photo search exposes only approved routes and keeps durable credits visible", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: /^open project$/i }).click();
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: "Studio", exact: true }).click();
  await page.getByRole("button", { name: "Generate", exact: true }).click();

  const stockSearch = page.getByRole("region", { name: "Find stock photos" });
  await expect(stockSearch).toContainText("Choose optional Stock photos and Image review routes");
  await expect(stockSearch.getByRole("button", { name: "Find and review photos" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await stockSearch.screenshot({ path: testInfo.outputPath("stock-search-unconfigured.png") });

  await page.evaluate(() => {
    const snapshot = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    const project = snapshot.projects.find((item: { id: string }) => item.id === "karatsuba");
    const sceneId = project.scenes[3].id;
    project.providerRoutingPolicy = {
      id: "qa-stock-policy",
      profileId: "qa-stock-profile",
      routes: [
        { capability: "media.licensed.search", providerIds: ["openverse", "pexels"] },
        { capability: "vlm.chat", providerIds: ["google-gemini"] },
      ],
    };
    project.sceneCandidates = [{
      id: "qa-stock-candidate",
      sceneId,
      status: "ready",
      artifactHash: "b".repeat(64),
      mediaType: "image/jpeg",
      prompt: "A classroom whiteboard used to explain a shrinking search interval",
      model: "pexels-search-v1",
      provider: "pexels",
      seed: 0,
      role: "scene",
      createdAt: "2026-09-05T12:00:00.000Z",
      origin: "licensedMedia",
      rights: { status: "verified", license: "Pexels", source: "https://www.pexels.com/photo/1234/", attribution: "QA Photographer", creator: "QA Photographer", commercialUse: "allowed", redistribution: "composedWorkOnly", modelInput: "reviewOnly", exportEligible: true },
      licensedSource: { providerId: "pexels", sourceAssetId: "c".repeat(64), sourceUrl: "https://www.pexels.com/photo/1234/", creator: "QA Photographer", licenseId: "Pexels" },
      visualReview: { judgeProviderId: "google-gemini", judgeModel: "gemini-2.5-flash", lessonFit: 91, composition: 86, technicalQuality: 92, overall: 90, risks: [], rationale: "The board leaves room for editable interval markers.", recommended: true, reviewRequired: true },
    }];
    localStorage.setItem("alystria-studio-v2", JSON.stringify(snapshot));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^open project$/i }).click();
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: "Studio", exact: true }).click();
  await page.getByRole("button", { name: "Generate", exact: true }).click();

  const provider = stockSearch.getByRole("combobox", { name: "Photo library" });
  await expect(provider.locator("option")).toHaveText(["Openverse · public domain", "Pexels · credited photos"]);
  await provider.selectOption("pexels");
  await stockSearch.getByRole("textbox", { name: "Photo search" }).fill("binary search classroom whiteboard");
  await expect(stockSearch.getByRole("button", { name: "Find and review photos" })).toBeEnabled();
  await stockSearch.getByRole("button", { name: "Find and review photos" }).click();
  await expect(page.locator(".toast")).toContainText("Open the desktop app");

  const credits = page.getByRole("region", { name: "Image candidates" });
  await expect(credits).toContainText("QA Photographer");
  await expect(credits).toContainText("Pexels");
  await expect(credits.getByRole("link", { name: /view original landing page/i })).toHaveAttribute("href", "https://www.pexels.com/photo/1234/");
  await expect(credits).toContainText("Allowed inside the finished tutorial");
  await expect(credits).toContainText("90 / 100");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.locator(".inspector").screenshot({ path: testInfo.outputPath("stock-search-configured-with-credits.png") });
  await credits.getByText("Licensed media", { exact: true }).scrollIntoViewIfNeeded();
  await credits.locator(".candidate-status").filter({ hasText: "Licensed media" }).screenshot({ path: testInfo.outputPath("stock-source-credits.png") });
  await credits.getByText(/visual review · recommended candidate/i).click();
  await expect(credits.getByText("90 / 100", { exact: true })).toBeVisible();
  await credits.locator("details").screenshot({ path: testInfo.outputPath("stock-image-review-scores.png") });
});

test("new tutorial wizard exposes privacy and cost before creation", async ({ page }, testInfo) => {
  await configureLocalRouting(page);
  await page.getByRole("button", { name: /create a tutorial/i }).click();
  await page.getByPlaceholder(/explain why karatsuba/i).fill("Explain stable sorting visually");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText(/no cloud call happens/i)).toBeVisible();
  await page.getByRole("button", { name: /^creative/i }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText(/hard creation budget/i)).toBeVisible();
  await page.getByRole("checkbox", { name: /approve this exact routing policy/i }).check();
  await expect(page.locator(".routing-readiness")).toContainText("Ready");
  await page.locator(".routing-review").screenshot({ path: testInfo.outputPath("routing-review-approved.png") });
  await page.getByRole("button", { name: /create learning plan/i }).click();
  await expect(page.getByText(/Explain stable sorting visually is stored under/i)).toBeVisible();
});

test("selected sources remain visible through review and portable export is wired", async ({ page }, testInfo) => {
  await configureLocalRouting(page);
  await page.getByRole("button", { name: /create a tutorial/i }).click();
  await page.getByPlaceholder(/explain why karatsuba/i).fill("Explain source-backed recursion trees");
  await page.locator(".source-drop input[type=file]").setInputFiles({
    name: "recursion-notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Recursion tree notes\nPrivate fixture content."),
  });
  await expect(page.getByLabel(/selected source files/i)).toContainText("recursion-notes.md");
  await page.screenshot({ path: testInfo.outputPath("wizard-source-selection.png"), fullPage: true });
  await page.locator(".wizard-modal").screenshot({ path: testInfo.outputPath("wizard-source-selection-detail.png") });

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /^creative/i }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText(/1 private file/i)).toBeVisible();
  await page.getByRole("checkbox", { name: /approve this exact routing policy/i }).check();
  await page.getByRole("button", { name: /create learning plan/i }).click();
  await page.locator("[data-tour-route='plan-sources']").click();
  await expect(page.getByText(/recursion-notes.md/i)).toBeVisible();

  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /export/i }).click();
  await expect(page.getByRole("radio", { name: /sidecar files/i })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/clean picture · no caption pixels/i)).toBeVisible();
  await page.locator(".jobs-drawer > header .icon-button").click();
  await page.getByRole("radio", { name: /always visible open captions/i }).click();
  await expect(page.getByText(/open captions in picture/i)).toBeVisible();
  await expect(page.getByText(/cannot be hidden after export/i)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("open-caption-export-warning.png"), fullPage: true });
  await page.getByRole("radio", { name: /sidecar files/i }).click();
  await page.getByRole("button", { name: /export portable/i }).click();
  await expect(page.getByText(/portable project archived/i)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("project-archive-export.png"), fullPage: true });
  await page.locator(".export-settings").screenshot({ path: testInfo.outputPath("project-archive-export-detail.png") });
});

test("narrow desktop does not overflow horizontally", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "narrow", "Narrow layout check only");
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasOverflow).toBe(false);
  await page.getByRole("button", { name: /^open project$/i }).click();
  const projectOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(projectOverflow).toBe(false);
});

test("local model and provider profiles remain explicit and saveable", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: /models & providers/i }).click();
  await expect(page.getByRole("heading", { name: /local models, without surprise downloads/i })).toBeVisible();
  await expect(page.getByRole("radio", { name: /liveportrait/i })).toBeChecked();
  await page.getByRole("radio", { name: /musetalk 1.5/i }).check();
  await expect(page.getByRole("radio", { name: /musetalk 1.5/i })).toBeChecked();
  await expect(page.getByText(/download-only pack/i)).toBeVisible();
  await expect(page.getByText(/browser preview never fetches model bytes/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /start verified download/i })).toBeDisabled();
  await page.getByRole("button", { name: /add profile/i }).click();
  await page.getByLabel("Name", { exact: true }).fill("Offline presenter review");
  await page.getByRole("button", { name: /save setup & active profile/i }).click();
  await expect(page.getByText(/setup saved locally/i)).toBeVisible();
  await expect(page.getByRole("radio", { name: /liveportrait/i })).toBeChecked();
  await expect(page.getByRole("radio", { name: /musetalk 1.5/i })).toBeChecked();
  await page.locator(".toast button").click();
  await page.locator(".model-setup-panel").screenshot({ path: testInfo.outputPath("local-model-setup.png") });
  await page.locator(".model-download-panel").screenshot({ path: testInfo.outputPath("local-model-download-detail.png") });
  await page.locator(".profile-panel").screenshot({ path: testInfo.outputPath("provider-profiles.png") });
});

test("visual bible customizes typography, captions, backgrounds, presenter, and licensed uploads", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Full studio inspection uses the desktop viewport");
  await page.getByRole("button", { name: /^open project$/i }).click();
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /studio/i }).click();
  await page.getByRole("button", { name: "Design" }).click();
  await page.getByRole("button", { name: /cinematic lecture/i }).click();
  await page.getByRole("button", { name: /modern signal/i }).click();
  await page.getByRole("tab", { name: /captions/i }).click();
  await page.getByRole("button", { name: /top/i }).click();
  await page.getByRole("slider", { name: /caption size/i }).fill("116");
  await page.getByRole("tab", { name: /media/i }).click();
  await page.getByRole("button", { name: /daniel · software instructor/i }).click();
  await page.getByLabel(/presenter layout/i).selectOption("picture-in-picture");
  await expect(page.getByTestId("presenter-preview")).toBeVisible();
  await expect(page.getByTestId("caption-preview")).toHaveClass(/position-top/);

  await page.screenshot({ path: testInfo.outputPath("visual-bible-full.png") });
  await page.locator(".canvas-stage").screenshot({ path: testInfo.outputPath("visual-bible-canvas.png") });
  await page.locator(".inspector").screenshot({ path: testInfo.outputPath("visual-bible-media-inspector.png") });

  await page.getByRole("button", { name: /licensed/i }).click();
  await page.getByLabel("License", { exact: true }).fill("CC BY 4.0");
  await page.getByLabel(/required attribution/i).fill("Alystria QA fixture · CC BY 4.0");
  await page.locator('.license-fields label:has-text("Commercial use") select').selectOption("allowed");
  await page.locator('.license-fields label:has-text("Redistribution in exported video") select').selectOption("allowed");
  await page.locator('.license-fields label:has-text("AI / model input") select').selectOption("allowed");
  await page.getByRole("button", { name: /fictional \/ generated/i }).click();
  await page.getByText(/i attest this identity is fictional or generated/i).click();
  await page.locator('.asset-upload:has-text("Upload your presenter picture") input').setInputFiles({
    name: "presenter-owned.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await expect(page.getByText(/asset added to visual bible/i)).toBeVisible();
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}"));
  const customization = persisted.projects.find((project: { id: string }) => project.id === "karatsuba")?.customization;
  expect(customization.presenter.placement).toBe("picture-in-picture");
  expect(customization.assets.some((asset: { filename?: string; rightsStatus: string }) => asset.filename === "presenter-owned.png" && asset.rightsStatus === "cleared")).toBe(true);
});

async function configureLocalRouting(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /models & providers/i }).click();
  await expect(page.getByRole("heading", { name: /provider & model profiles/i })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Local deterministic");
  const routes = page.locator(".profile-route-grid");
  for (const label of ["Writing & review", "Images", "Narration"]) {
    await routes.locator("label", { hasText: label }).locator("select").selectOption("local-runtime");
  }
  await page.getByLabel("Writing & review model", { exact: true }).fill("local/qwen3.5-9b-gguf");
  await page.getByLabel("Images model", { exact: true }).fill("local/flux.2-klein-4b-fp8");
  await page.getByLabel("Narration model", { exact: true }).fill("local/kokoro");
  await page.getByRole("button", { name: /save setup & active profile/i }).click();
  await expect(page.getByText(/setup saved locally/i)).toBeVisible();
  await page.getByRole("button", { name: /^home$/i }).click();
}
