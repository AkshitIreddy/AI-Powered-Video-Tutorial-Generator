import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { createOnboardingState } from "../onboarding";
import { exampleSnapshot } from "../data";

const install = vi.hoisted((): { activationBlocked: boolean; installFingerprint: string | null; runtimeRevision: string | null } => ({
  activationBlocked: false,
  installFingerprint: "d".repeat(64),
  runtimeRevision: "comfyui-8f40b43e+sdxl-46216598+recipe-v1",
}));

vi.mock("../native", async () => {
  const actual = await vi.importActual<typeof import("../native")>("../native");
  const catalogEntry: import("../native").ModelDownloadCatalogEntry = {
    modelId: "local/sdxl-base-1.0",
    displayName: "Stable Diffusion XL Base 1.0 + optional offset LoRA",
    immutableRevision: "comfyui-8f40b43e+sdxl-46216598",
    totalBytes: 7_000_000_000,
    artifactCount: 4,
    licenseId: "CreativeML Open RAIL++-M",
    licenseUrl: "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/462165984030d82259a11f4367a4eed129e94a7b/LICENSE.md",
    licenseSha256: "1".repeat(64),
    licenseScope: "Pinned test declaration",
    codeRevision: "8f40b43e1e2f4692bcf14d2b90889af2e770bec7",
    weightRevision: "462165984030d82259a11f4367a4eed129e94a7b",
    available: true,
    downloadOnlyReason: "One-click managed install with hardware preflight.",
  };
  const status: import("../native").ModelDownloadStatus = {
    modelId: catalogEntry.modelId,
    immutableRevision: catalogEntry.immutableRevision,
    phase: "ready",
    downloadedBytes: catalogEntry.totalBytes,
    totalBytes: catalogEntry.totalBytes,
    verifiedArtifacts: catalogEntry.artifactCount,
    artifactCount: catalogEntry.artifactCount,
    licenseId: catalogEntry.licenseId,
    licenseUrl: catalogEntry.licenseUrl,
    licenseSha256: catalogEntry.licenseSha256,
    licenseAcceptedAt: "2026-09-08T00:00:00.000Z",
    detail: "Installed files and runtime entry points passed preflight.",
    activationBlocked: false,
    updatedAt: "2026-09-08T00:00:00.000Z",
  };
  return {
    ...actual,
    localModelDownloadCatalog: vi.fn(async () => [catalogEntry]),
    localModelDownloadStatus: vi.fn(async () => [{
      ...status,
      activationBlocked: install.activationBlocked,
      installFingerprint: install.installFingerprint,
      runtimeRevision: install.runtimeRevision,
    }]),
  };
});

import App from "../App";

beforeEach(() => {
  install.activationBlocked = false;
  install.installFingerprint = "d".repeat(64);
  install.runtimeRevision = "comfyui-8f40b43e+sdxl-46216598+recipe-v1";
  localStorage.clear();
  localStorage.setItem("alystria-studio-v2", JSON.stringify(exampleSnapshot));
  const onboarding = createOnboardingState({
    runtimeConfigured: true,
    privacyConfigured: true,
    hardwareInspected: true,
    existingProfile: { displayName: "Test Creator" },
  });
  onboarding.status = "completed";
  onboarding.configuration.goals = ["tutorial"];
  localStorage.setItem("alystria-onboarding-v1", JSON.stringify(onboarding));
  localStorage.setItem("alystria-guided-tour-v1", "completed");
});

it("stages only the verified installed SDXL identity in the active profile", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole("button", { name: /models & providers/i }));
  const useButton = await screen.findByRole("button", { name: /use sdxl in active profile/i });
  expect(useButton).toBeEnabled();
  await user.click(useButton);

  expect(screen.getByLabelText(/images provider/i)).toHaveValue("local-runtime");
  expect(screen.getByLabelText(/images model$/i)).toHaveValue("local/sdxl-base-1.0");
  expect(screen.getByLabelText(/images model revision/i)).toHaveValue(install.runtimeRevision);
  expect(screen.getByLabelText(/images install fingerprint/i)).toHaveValue(install.installFingerprint);
  expect(screen.getByText(/local image route staged/i)).toBeInTheDocument();
});
it.each([
  { name: "an activation-blocked receipt", activationBlocked: true, installFingerprint: "d".repeat(64), runtimeRevision: "comfyui-8f40b43e+sdxl-46216598+recipe-v1" },
  { name: "a missing install identity", activationBlocked: false, installFingerprint: null, runtimeRevision: null },
])("keeps SDXL profile activation disabled for $name", async ({ activationBlocked, installFingerprint, runtimeRevision }) => {
  install.activationBlocked = activationBlocked;
  install.installFingerprint = installFingerprint;
  install.runtimeRevision = runtimeRevision;
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole("button", { name: /models & providers/i }));
  const useButton = await screen.findByRole("button", { name: /use sdxl in active profile/i });
  expect(useButton).toBeDisabled();
  expect(screen.getByLabelText(/images model$/i)).not.toHaveValue("local/sdxl-base-1.0");
});
