import type { Page } from "@playwright/test";
import { defaultSnapshot, exampleSnapshot } from "../src/data";

export const completedOnboarding = {
  schemaVersion: 1,
  status: "completed",
  activeChapterId: "ready",
  completedChapterIds: ["welcome", "goal", "runtime", "privacy", "provider", "hardware", "model", "profile", "ready"],
  visitedChapterIds: ["welcome", "goal", "runtime", "privacy", "provider", "hardware", "model", "profile", "ready"],
  configuration: {
    goals: ["tutorial"],
    runtime: "hybrid",
    privacy: "ask-before-cloud",
    providerIds: [],
    modelIds: ["local/qwen3.5-9b-gguf", "local/kokoro", "local/whisper-large-v3-turbo", "local/liveportrait", "local/musetalk-1.5"],
    hardwareReviewed: true,
    profile: { displayName: "Akshit", portraitAssetId: "presenter-portrait.academic-amara-v1" },
  },
  revision: 9,
  updatedAt: "2026-09-02T00:00:00.000Z",
};

export async function configureE2eWorkspace(page: Page, fixture: "clean" | "example") {
  const snapshot = fixture === "example" ? exampleSnapshot : defaultSnapshot;
  await page.addInitScript(({ onboarding, workspace }) => {
    if (sessionStorage.getItem("alystria-e2e-ready") === "1") return;
    localStorage.clear();
    localStorage.setItem("alystria-onboarding-v1", JSON.stringify(onboarding));
    localStorage.setItem("alystria-guided-tour-v1", "completed");
    localStorage.setItem("alystria-studio-v2", JSON.stringify(workspace));
    sessionStorage.setItem("alystria-e2e-ready", "1");
  }, { onboarding: completedOnboarding, workspace: snapshot });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator(".app-shell").waitFor();
}
