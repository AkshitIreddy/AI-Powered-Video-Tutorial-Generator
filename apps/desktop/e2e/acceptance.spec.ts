import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("@acceptance drives create, approve, review, and export through the app", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.getByRole("button", { name: /models & providers/i }).click();
  await expect(page.getByRole("heading", { name: /provider & model profiles/i })).toBeVisible();
  await page.getByRole("button", { name: /add profile/i }).click();
  await page.getByLabel("Name", { exact: true }).fill("Acceptance local");
  const localRoutes: Record<string, string> = {
    "Writing & review": "local/qwen3.5-9b-gguf",
    Research: "off for deterministic acceptance",
    Images: "local/flux2-klein-4b",
    Motion: "off for deterministic acceptance",
    Narration: "local/kokoro",
    Transcription: "off for deterministic acceptance",
    Presenter: "off for deterministic acceptance",
    "Lip-sync": "off for deterministic acceptance",
  };
  for (const [medium, model] of Object.entries(localRoutes)) {
    const route = page.locator(".profile-route-grid label").filter({ hasText: medium });
    await route.locator("select").selectOption("local-runtime");
    await route.getByLabel(`${medium} model`).fill(model);
  }
  await page.getByRole("button", { name: /save setup & active profile/i }).click();
  await expect(page.getByText(/setup saved locally/i)).toBeVisible();
  await page.locator(".toast button").click();

  await page.getByRole("button", { name: /new tutorial/i }).click();
  const wizard = page.locator(".wizard-modal");
  await page.getByPlaceholder(/explain why karatsuba/i).fill(
    "Explain why Karatsuba multiplication needs only three recursive products",
  );
  await page.locator(".source-drop input[type=file]").setInputFiles({
    name: "karatsuba-acceptance-notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# Acceptance source\nKaratsuba replaces four half-size products with three exact products.\n",
    ),
  });
  await expect(page.getByLabel(/selected source files/i)).toContainText(
    "karatsuba-acceptance-notes.md",
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
  await expect(page.getByText(/1 private file/i)).toBeVisible();
  await page.getByRole("checkbox", { name: /approve this exact routing policy/i }).check();
  await expect(page.locator(".routing-readiness")).toContainText("Ready");
  await page.getByRole("button", { name: /create learning plan/i }).click();

  await expect(page.getByRole("heading", { name: /shape the learning journey/i })).toBeVisible();
  await expect(page.getByRole("complementary", { name: /background jobs/i })).toHaveClass(/open/);
  await expect(page.locator(".jobs-list")).toContainText("Creating learning plan");
  await page.locator(".jobs-drawer > header .icon-button").click();

  await page.getByRole("button", { name: /^sources$/i }).click();
  await expect(page.getByText("karatsuba-acceptance-notes.md", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /approve learning plan/i }).click();

  await expect(page.getByRole("heading", { name: /review the whole argument/i })).toBeVisible();
  await expect(page.getByText(/tutorial generation completed/i)).toBeVisible();
  await page.locator(".review-player .large-play").click();
  await expect(page.locator(".review-player .large-play")).toBeVisible();
  await page.getByRole("button", { name: /prepare export/i }).click();

  await expect(page.getByRole("heading", { name: /package the finished lesson/i })).toBeVisible();
  await page.getByLabel("Resolution").selectOption("1080p");
  await page.getByRole("button", { name: "1:1 Square", exact: true }).click();
  await page.locator(".format-options button").first().click();
  await expect(page.getByRole("button", { name: /captions/i })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /accessible transcript/i })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: /export portable/i }).click();
  await expect(page.getByText(/portable project archived/i)).toBeVisible();
  await expect(page.locator(".archive-path")).toContainText(".alytutorial");
  await page.locator(".toast").filter({ hasText: "Portable project archived" }).locator("button").click();

  await page.getByRole("button", { name: /render 1080p master/i }).click();
  await expect(page.getByText(/export queued/i)).toBeVisible();
  await expect(page.getByRole("complementary", { name: /background jobs/i })).toHaveClass(/open/);
  await expect(page.locator(".jobs-list")).toContainText("Browser demo only: master export simulated");
  await expect(page.locator(".jobs-list")).toContainText("1080p");
  await expect(page.locator(".jobs-list .job-card.complete").first()).toBeVisible();

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("alystria-studio-v2") ?? "{}"));
  expect(persisted.projects[0].title).toBe(
    "Explain why Karatsuba multiplication needs only three recursive products",
  );
  expect(persisted.projects[0].sources[0].filename).toBe("karatsuba-acceptance-notes.md");
  expect(persisted.jobs.some((job: { operation?: string }) => job.operation === "export_master")).toBe(true);

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
