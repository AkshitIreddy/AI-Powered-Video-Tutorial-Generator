import { expect, test } from "@playwright/test";
import { configureE2eWorkspace } from "./fixtures";

test.use({ launchOptions: { args: ["--disable-gpu"] } });

test.beforeEach(async ({ page }) => {
  await configureE2eWorkspace(page, "clean");
});

test("@casual-presenters shows featured tutors, explicit animal filters, and legacy choices", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: /new tutorial/i }).click();
  const wizard = page.locator(".wizard-modal");
  await wizard.getByPlaceholder("What would you like to teach? Describe your topic, question, or learning goal.").fill("Explain why leaves change color");
  await wizard.getByRole("button", { name: "Continue", exact: true }).click();
  await wizard.getByRole("button", { name: "Continue", exact: true }).click();
  await wizard.getByRole("button", { name: "Choose a cast" }).click();

  const gallery = wizard.locator(".presenter-picker__gallery");
  await expect(gallery.getByRole("button").nth(0)).toHaveAccessibleName("Select Emma · casual home-studio tutor");
  await expect(gallery.getByRole("button").nth(1)).toHaveAccessibleName("Select Yuki · casual anime coding tutor");
  await expect(gallery.getByRole("button").nth(2)).toHaveAccessibleName("Select Noah · casual maker tutor");
  await expect(gallery.getByRole("button").nth(3)).toHaveAccessibleName("Select Chloe · cartoon science creator");
  await expect(gallery.getByRole("button", { name: "Select Finn · retro anime maker tutor" })).toBeVisible();
  await expect(gallery.getByRole("button", { name: /Finn · legacy portrait/ })).toHaveCount(0);
  await expect.poll(() => gallery.locator("img").evaluateAll((images: HTMLImageElement[]) => images.slice(0, 4).every((image) => image.complete && image.naturalWidth === 1254 && image.naturalHeight === 1254))).toBe(true);

  await wizard.getByLabel("Presenter visual style").selectOption("Animal");
  await expect(gallery.getByRole("button")).toHaveCount(6);
  await expect(gallery.getByRole("button", { name: "Select Milo · cat science tutor" })).toBeVisible();
  await expect(gallery.getByRole("button", { name: "Select Leo · clay lion tutor" })).toBeVisible();

  await wizard.getByLabel("Presenter visual style").selectOption("Character");
  await expect(gallery.getByRole("button")).toHaveCount(1);
  await expect(gallery.getByRole("button", { name: "Select Pip · cartoon robot tutor" })).toBeVisible();

  await wizard.getByLabel("Presenter visual style").selectOption("Realistic");
  await expect(gallery.getByRole("button", { name: "Select Daniel · software instructor" })).toBeVisible();
  await wizard.getByLabel("Presenter visual style").selectOption("Anime");
  await expect(gallery.getByRole("button", { name: "Select Astrid · anime editorial" })).toBeVisible();
  await wizard.getByLabel("Presenter visual style").selectOption("Cartoon");
  await expect(gallery.getByRole("button", { name: "Select Oliver · drawn classroom" })).toBeVisible();

  await wizard.getByLabel("Presenter visual style").selectOption("All styles");
  await expect(gallery.getByRole("button", { name: "Select Daniel · software instructor" })).toBeVisible();
  await expect(wizard).not.toContainText(/lip-sync (?:ready|compatible)/i);
  await wizard.screenshot({ path: testInfo.outputPath("casual-presenter-gallery.png") });
});
