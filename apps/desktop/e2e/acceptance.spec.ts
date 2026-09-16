import { expect, test } from "@playwright/test";
import { configureE2eWorkspace } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await configureE2eWorkspace(page, "clean");
});

test("settings scrolls and the guided tutorial keeps its target sharp", async ({ page }) => {
  await page.getByRole("button", { name: /settings & diagnostics/i }).click();
  const main = page.locator(".main-content");
  const metrics = await main.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  await main.hover();
  await page.mouse.wheel(0, 900);
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.getByRole("button", { name: /replay guided tour/i }).click();
  await expect(page.locator(".aly-onboarding-tour")).toBeVisible();
  const backdropFilters = await page.locator(".aly-onboarding-tour__shade").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backdropFilter));
  expect(backdropFilters.length).toBeGreaterThan(0);
  expect(backdropFilters.every((value) => value === "none" || value === "")).toBeTruthy();
  await expect(page.locator(".aly-onboarding-tour__spotlight")).toBeVisible();
});

test("@ui-contract drives create, approve, review boundary, and export through the browser adapter", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await expect(page.locator(".runtime-badge")).toContainText("Browser preview");
  await expect(page.locator(".runtime-badge")).toHaveAttribute("title", /browser adapter only; no native artifact/i);

  await page.getByRole("button", { name: /models & providers/i }).click();
  await expect(page.getByRole("heading", { name: /provider & model profiles/i })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Balanced cloud");
  for (const [provider, key] of [["OpenAI", "ui-contract-openai"], ["ElevenLabs", "ui-contract-elevenlabs"]] as const) {
    await page.getByRole("button", { name: new RegExp(`add ${provider} credential`, "i") }).click();
    await page.getByLabel("API key").fill(key);
    await page.getByRole("button", { name: /store securely/i }).click();
    await expect(page.getByText(/browser demo connection updated/i)).toBeVisible();
    await page.locator(".toast button").click();
  }
  await page.getByRole("button", { name: /add profile/i }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("My profile 2");
  await page.getByLabel("Name", { exact: true }).fill("UI contract cloud");
  const routes: Record<string, { provider: string; model: string }> = {
    "Writing & review": { provider: "openai", model: "gpt-5.4" },
    Images: { provider: "openai", model: "gpt-image-2" },
    Narration: { provider: "elevenlabs", model: "eleven_multilingual_v2" },
  };
  for (const [medium, routeSettings] of Object.entries(routes)) {
    const route = page.locator(".profile-route-grid label").filter({ hasText: medium });
    await route.locator("select").selectOption(routeSettings.provider);
    await expect(route.locator("select")).toHaveValue(routeSettings.provider);
    await route.getByLabel(`${medium} model`, { exact: true }).fill(routeSettings.model);
    await expect(route.getByLabel(`${medium} model`, { exact: true })).toHaveValue(routeSettings.model);
  }
  await page.getByRole("button", { name: /save setup & active profile/i }).click();
  await expect(page.getByText(/setup saved locally/i)).toBeVisible();
  await expect(page.getByRole("tab", { name: "UI contract cloud", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.locator(".toast button").click();

  await page.getByRole("button", { name: /new tutorial/i }).click();
  const wizard = page.locator(".wizard-modal");
  await page.getByPlaceholder("What would you like to teach? Describe your topic, question, or learning goal.").fill(
    "Explain how ocean tides change over a day",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await wizard.getByLabel("Audience").fill("Undergraduate computer science students");
  await wizard.getByLabel("Target duration").selectOption("custom");
  await wizard.getByLabel("Exact duration in minutes").fill("3");
  await expect(wizard.getByLabel("Exact duration in minutes")).toHaveValue("3");
  await wizard.locator(".form-grid").screenshot({ path: testInfo.outputPath("custom-duration-three-minutes.png") });
  await wizard.getByLabel("Language").selectOption("English");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(wizard.getByRole("heading", { name: "Who will teach?" })).toBeVisible();
  await expect(wizard.getByRole("button", { name: "Just the lesson" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /^creative/i }).click();
  await expect(page.getByText(/depend on external evidence and citations/i)).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(wizard.getByText("About 3 minutes")).toBeVisible();
  await page.getByRole("button", { name: "Maximum", exact: true }).click();
  await expect(wizard.getByLabel(/hard budget/i)).toHaveCount(0);
  await expect(wizard.getByText(/hard creation budget/i)).toHaveCount(0);
  await wizard.getByLabel("Creation profile").selectOption({ label: "UI contract cloud" });
  await expect(wizard.getByLabel("Creation profile")).toHaveValue("custom-profile-2");
  await expect(page.getByText(/none yet/i)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /approve this exact routing policy/i })).toHaveCount(0);
  await expect(page.locator(".routing-readiness")).toContainText("Ready");
  await page.getByRole("button", { name: /create learning plan/i }).click();

  await expect(page.getByRole("heading", { name: /shape the learning journey/i })).toBeVisible();
  await expect(page.getByRole("complementary", { name: /background jobs/i })).toHaveClass(/open/);
  await expect(page.locator(".jobs-list")).toContainText("Creating learning plan");
  await page.locator(".jobs-drawer > header .icon-button").click();

  await page.getByRole("button", { name: /approve learning plan/i }).click();

  await expect(page.getByRole("heading", { name: /see the teaching sequence/i })).toBeVisible();
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /^review$/i }).click();
  await expect(page.getByRole("heading", { name: /review the whole argument/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /no authoritative media yet/i })).toBeVisible();
  await expect(page.getByText(/browser ui contract does not create video/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /prepare export/i })).toBeDisabled();
  await page.locator(".review-player").screenshot({ path: testInfo.outputPath("ui-contract-review-boundary-v2.png") });
  await page.getByRole("navigation", { name: /project workspace/i }).getByRole("button", { name: /export/i }).click();

  await expect(page.getByRole("heading", { name: /package the finished lesson/i })).toBeVisible();
  await page.getByLabel("Resolution").selectOption("1080p");
  await page.getByRole("button", { name: "1:1 Square", exact: true }).click();
  await page.locator(".format-options button").first().click();
  await expect(page.getByRole("radio", { name: /sidecar files/i })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/clean picture · no caption pixels/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /accessible transcript/i })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByLabel("Frame rate").selectOption("24");
  await page.getByLabel("Codec preference").selectOption("av1");
  await expect(page.getByLabel("Frame rate")).toHaveValue("24");
  await expect(page.getByLabel("Codec preference")).toHaveValue("av1");
  await expect(page.getByRole("note")).toContainText(
    /frame rate and codec are applied during native export.*selected encoder is unavailable/is,
  );

  await page.getByRole("button", { name: /export portable/i }).click();
  await expect(page.getByText(/portable project archived/i)).toBeVisible();
  await expect(page.locator(".archive-path")).toContainText(".alytutorial");
  await page.locator(".toast").filter({ hasText: "Portable project archived" }).locator("button").click();

  await page.getByRole("button", { name: /render 1080p master/i }).click();
  await expect(page.getByRole("complementary", { name: /background jobs/i })).toHaveClass(/open/);
  await expect(page.locator(".jobs-list")).toContainText("UI contract only: 24 fps AV1 export simulated");
  await expect(page.locator(".jobs-list")).toContainText("1080p");
  await expect(page.locator(".jobs-list .job-card.complete").first()).toBeVisible();

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}"));
  expect(persisted.projects[0].title).toBe(
    "Explain how ocean tides change over a day",
  );
  expect(persisted.projects[0].duration).toBe(3);
  const exportJob = persisted.jobs.find((job: { operation?: string }) => job.operation === "export_master");
  expect(exportJob).toBeTruthy();
  expect(exportJob.result).toMatchObject({ requestedFps: 24, requestedCodec: "av1", codecForwarded: false, path: null });

  await page.locator(".jobs-drawer > header .icon-button").click();
  const toastClose = page.locator(".toast button");
  while (await toastClose.count()) await toastClose.first().click();
  await page.screenshot({ path: testInfo.outputPath("acceptance-export.png"), fullPage: true });
  await page.locator(".export-settings").screenshot({
    path: testInfo.outputPath("acceptance-export-settings.png"),
  });

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("@ui-contract creates a cast and persists a scene speaker assignment without presets or budgets", async ({ page }, testInfo) => {
  await configureLocalRouting(page);
  await page.getByRole("button", { name: /new tutorial/i }).click();
  const wizard = page.locator(".wizard-modal");
  const topic = "Show how coastal dunes soften storm waves";
  const topicInput = wizard.getByPlaceholder("What would you like to teach? Describe your topic, question, or learning goal.");

  await expect(topicInput).toBeVisible();
  await expect(wizard).not.toContainText(/karatsuba|binary search/i);
  await topicInput.fill(topic);
  await wizard.getByRole("button", { name: "Continue", exact: true }).click();
  await wizard.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(wizard.getByRole("heading", { name: "Who will teach?" })).toBeVisible();
  await expect(wizard.getByRole("button", { name: "Just the lesson" })).toHaveAttribute("aria-pressed", "true");
  await wizard.getByRole("button", { name: "Choose a cast" }).click();
  await wizard.getByLabel("Presenter visual style").selectOption("Anime");
  const animeGallery = wizard.locator(".presenter-picker__gallery");
  await expect.poll(() => animeGallery.getByRole("button").count()).toBeGreaterThanOrEqual(5);
  await expect.poll(() => animeGallery.locator("img").evaluateAll((images: HTMLImageElement[]) => images.every((image) => image.complete && image.naturalWidth > 0))).toBe(true);
  const cardLayout = await animeGallery.getByRole("button").evaluateAll((cards) => cards.map((card) => {
    const cardBox = card.getBoundingClientRect();
    const portrait = card.querySelector("img")?.getBoundingClientRect();
    const name = card.querySelector(".presenter-picker__identity strong")?.getBoundingClientRect();
    const detail = card.querySelector(".presenter-picker__identity small")?.getBoundingClientRect();
    return {
      cardHeight: cardBox.height,
      cardLeft: Math.round(cardBox.left),
      portraitHeight: portrait?.height ?? 0,
      portraitWidth: portrait?.width ?? 0,
      nameHeight: name?.height ?? 0,
      detailHeight: detail?.height ?? 0,
    };
  }));
  expect(new Set(cardLayout.map((card) => card.cardLeft)).size).toBeLessThanOrEqual(4);
  for (const card of cardLayout) {
    expect(card.portraitWidth / card.portraitHeight).toBeGreaterThan(0.98);
    expect(card.portraitWidth / card.portraitHeight).toBeLessThan(1.02);
    expect(card.cardHeight - card.portraitHeight).toBeGreaterThanOrEqual(58);
    expect(card.nameHeight).toBeGreaterThan(0);
    expect(card.detailHeight).toBeGreaterThan(0);
  }
  for (let index = 0; index < cardLayout.length; index += 1) {
    await animeGallery.locator("img").nth(index).scrollIntoViewIfNeeded();
  }
  await animeGallery.evaluate((gallery) => { gallery.scrollTop = 0; });
  await wizard.locator(".wizard-body").evaluate((body) => { body.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath("anime-presenter-gallery-page.png"), fullPage: true });
  await wizard.getByLabel("Presenter visual style").selectOption("All styles");
  await wizard.getByRole("button", { name: "Select Daniel · software instructor" }).click();
  await wizard.getByRole("button", { name: "Select Astrid · anime editorial" }).click();
  await expect(wizard.getByText("2 presenters selected", { exact: true })).toBeVisible();
  await wizard.locator(".wizard-body").evaluate((body) => { body.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath("selected-two-presenter-cast-page.png"), fullPage: true });
  await wizard.getByRole("button", { name: "Continue", exact: true }).click();

  await wizard.getByRole("button", { name: /^creative/i }).click();
  await wizard.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(wizard.getByText("Daniel · software instructor, Astrid · anime editorial", { exact: true })).toBeVisible();
  await expect(wizard.getByLabel(/hard budget/i)).toHaveCount(0);
  await expect(wizard.getByText(/hard creation budget/i)).toHaveCount(0);
  await wizard.getByRole("button", { name: /create learning plan/i }).click();

  await expect(page.getByRole("heading", { name: /shape the learning journey/i })).toBeVisible();
  await expect(page.getByRole("complementary", { name: /background jobs/i })).toHaveClass(/open/);
  await page.locator(".jobs-drawer > header .icon-button").click();
  await page.locator(".plan-progress button").filter({ hasText: "Presenters" }).click();
  await expect(page.getByRole("heading", { name: "Who speaks in each scene?" })).toBeVisible();
  const assignments = page.locator(".scene-speaker-assignments select");
  const expectedSceneCount = await page.evaluate((projectTopic) => {
    const snapshot = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    return snapshot.projects.find((candidate: { topic?: string }) => candidate.topic === projectTopic)?.scenes.length ?? 0;
  }, topic);
  expect(expectedSceneCount).toBeGreaterThan(1);
  await expect(assignments).toHaveCount(expectedSceneCount);
  await assignments.first().selectOption("presenter-portrait.anime-astrid-v1");

  await expect.poll(async () => page.evaluate((projectTopic) => {
    const snapshot = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    const project = snapshot.projects?.find((candidate: { topic?: string }) => candidate.topic === projectTopic);
    return project?.presenterSelection;
  }, topic)).toMatchObject({
    mode: "on",
    presenters: [
      { presenterId: "presenter-portrait.software-daniel-v1", portraitAssetId: "presenter-portrait.software-daniel-v1" },
      { presenterId: "presenter-portrait.anime-astrid-v1", portraitAssetId: "presenter-portrait.anime-astrid-v1" },
    ],
    sceneAssignments: [{ presenterId: "presenter-portrait.anime-astrid-v1" }],
  });

  const persisted = await page.evaluate((projectTopic) => {
    const snapshot = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    return snapshot.projects.find((candidate: { topic?: string }) => candidate.topic === projectTopic);
  }, topic);
  expect(persisted.providerRoutingPolicy).not.toHaveProperty("budget");
  expect(persisted.presenterSelection.sceneAssignments[0].sceneId).toBe(persisted.scenes[0].id);
});

test("@ui-contract exposes retry and cancel only for eligible durable job states", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /your teaching workbench/i })).toBeVisible();
  await page.evaluate(() => {
    const snapshot = JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}");
    const link = { projectId: "fault-project", projectDirectory: "C:/Alystria/fault-project" };
    snapshot.jobs = [
      { id: "fault-failed-retry", title: "Retryable failure", detail: "Renderer unavailable", status: "attention", progress: 0, retryable: true, result: { receiptState: "FAILED" }, ...link },
      { id: "fault-failed-final", title: "Final failure", detail: "Invalid request", status: "attention", progress: 0, retryable: false, result: { receiptState: "FAILED" }, ...link },
      { id: "fault-cancelled", title: "Cancelled work", detail: "Cancelled by user", status: "attention", progress: 0, retryable: false, result: { receiptState: "CANCELLED" }, ...link },
      { id: "fault-stale", title: "Stale work", detail: "Revision changed", status: "attention", progress: 0, retryable: false, result: { receiptState: "STALE" }, ...link },
      { id: "fault-blocked", title: "Approval wait", detail: "Approval required", status: "attention", progress: 0, retryable: true, result: { receiptState: "BLOCKED" }, ...link },
      { id: "fault-running", title: "Active render", detail: "Rendering", status: "running", progress: 42, retryable: false, result: { receiptState: "RUNNING" }, ...link },
    ];
    localStorage.setItem("alystria-studio-v2", JSON.stringify(snapshot));
  });
  await page.reload();
  await page.locator(".jobs-button").click();

  const retryable = page.locator(".job-card").filter({ hasText: "Retryable failure" });
  await expect(retryable.getByRole("button", { name: /retry retryable failure/i })).toBeVisible();
  await expect(retryable.getByRole("button", { name: /cancel retryable failure/i })).toHaveCount(0);

  for (const title of ["Final failure", "Cancelled work", "Stale work"]) {
    const terminal = page.locator(".job-card").filter({ hasText: title });
    await expect(terminal.getByRole("button", { name: /retry/i })).toHaveCount(0);
    await expect(terminal.getByRole("button", { name: /cancel/i })).toHaveCount(0);
  }

  const blocked = page.locator(".job-card").filter({ hasText: "Approval wait" });
  await expect(blocked.getByRole("button", { name: /retry approval wait/i })).toHaveCount(0);
  await expect(blocked.getByRole("button", { name: /cancel approval wait/i })).toBeVisible();

  const running = page.locator(".job-card").filter({ hasText: "Active render" });
  await expect(running.getByRole("button", { name: /retry active render/i })).toHaveCount(0);
  await expect(running.getByRole("button", { name: /cancel active render/i })).toBeVisible();
});

async function configureLocalRouting(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /models & providers/i }).click();
  await expect(page.getByRole("heading", { name: /provider & model profiles/i })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Local UI contract");
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
