import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("@ui-contract drives create, approve, review boundary, and export through the browser adapter", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await expect(page.locator(".runtime-badge")).toContainText("UI contract");
  await expect(page.locator(".runtime-badge")).toHaveAttribute("title", /browser adapter only; no native artifact/i);

  await page.getByRole("button", { name: /models & providers/i }).click();
  await expect(page.getByRole("heading", { name: /provider & model profiles/i })).toBeVisible();
  for (const [provider, key] of [["OpenAI", "ui-contract-openai"], ["ElevenLabs", "ui-contract-elevenlabs"]] as const) {
    await page.getByRole("button", { name: new RegExp(`add ${provider} credential`, "i") }).click();
    await page.getByLabel("API key").fill(key);
    await page.getByRole("button", { name: /store securely/i }).click();
    await expect(page.getByText(/browser demo connection updated/i)).toBeVisible();
    await page.locator(".toast button").click();
  }
  await page.getByRole("button", { name: /add profile/i }).click();
  await page.getByLabel("Name", { exact: true }).fill("UI contract cloud");
  const routes: Record<string, { provider: string; model: string }> = {
    "Writing & review": { provider: "openai", model: "gpt-5.4" },
    Research: { provider: "openai", model: "off for deterministic acceptance" },
    Images: { provider: "openai", model: "gpt-image-2" },
    Motion: { provider: "runway", model: "off for deterministic acceptance" },
    Narration: { provider: "elevenlabs", model: "eleven_multilingual_v2" },
    Transcription: { provider: "openai", model: "off for deterministic acceptance" },
    Presenter: { provider: "local-runtime", model: "off for deterministic acceptance" },
    "Lip-sync": { provider: "local-runtime", model: "off for deterministic acceptance" },
  };
  for (const [medium, routeSettings] of Object.entries(routes)) {
    const route = page.locator(".profile-route-grid label").filter({ hasText: medium });
    await route.locator("select").selectOption(routeSettings.provider);
    await route.getByLabel(`${medium} model`).fill(routeSettings.model);
  }
  await page.getByRole("button", { name: /save setup & active profile/i }).click();
  await expect(page.getByText(/setup saved locally/i)).toBeVisible();
  await page.locator(".toast button").click();

  await page.getByRole("button", { name: /new tutorial/i }).click();
  const wizard = page.locator(".wizard-modal");
  await page.getByPlaceholder(/explain why karatsuba/i).fill(
    "Explain why Karatsuba multiplication needs only three recursive products",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await wizard.getByLabel("Audience").fill("Undergraduate computer science students");
  await wizard.getByLabel("Target duration").selectOption("5");
  await wizard.getByLabel("Language").selectOption("English");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /^creative/i }).click();
  await expect(page.getByText(/no cloud call happens/i)).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Maximum", exact: true }).click();
  await expect(page.getByText(/hard creation budget/i)).toBeVisible();
  await page.getByLabel("Content class", { exact: true }).selectOption("public");
  await expect(page.getByText(/none yet/i)).toBeVisible();
  await page.getByRole("checkbox", { name: /approve this exact routing policy/i }).check();
  await expect(page.locator(".routing-readiness")).toContainText("Ready");
  await page.getByRole("button", { name: /create learning plan/i }).click();

  await expect(page.getByRole("heading", { name: /shape the learning journey/i })).toBeVisible();
  await expect(page.getByRole("complementary", { name: /background jobs/i })).toHaveClass(/open/);
  await expect(page.locator(".jobs-list")).toContainText("Creating learning plan");
  await page.locator(".jobs-drawer > header .icon-button").click();

  await page.getByRole("button", { name: /approve learning plan/i }).click();

  await expect(page.getByRole("heading", { name: /review the whole argument/i })).toBeVisible();
  await expect(page.getByText(/tutorial generation completed/i)).toBeVisible();
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
  await expect(page.getByText(/codec preference is recorded with this request/i)).toBeVisible();

  await page.getByRole("button", { name: /export portable/i }).click();
  await expect(page.getByText(/portable project archived/i)).toBeVisible();
  await expect(page.locator(".archive-path")).toContainText(".alytutorial");
  await page.locator(".toast").filter({ hasText: "Portable project archived" }).locator("button").click();

  await page.getByRole("button", { name: /render 1080p master/i }).click();
  await expect(page.getByText(/export queued/i)).toBeVisible();
  await expect(page.getByRole("complementary", { name: /background jobs/i })).toHaveClass(/open/);
  await expect(page.locator(".jobs-list")).toContainText("UI contract only: 24 fps AV1 export simulated");
  await expect(page.locator(".jobs-list")).toContainText("1080p");
  await expect(page.locator(".jobs-list .job-card.complete").first()).toBeVisible();

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}"));
  expect(persisted.projects[0].title).toBe(
    "Explain why Karatsuba multiplication needs only three recursive products",
  );
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

test("@ui-contract exposes retry and cancel only for eligible durable job states", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /turn a difficult idea/i })).toBeVisible();
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
