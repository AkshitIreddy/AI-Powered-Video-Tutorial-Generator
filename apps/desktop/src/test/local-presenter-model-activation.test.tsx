import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { exampleSnapshot } from "../data";
import { createOnboardingState } from "../onboarding";

const activation = vi.hoisted(() => {
  let finish: ((status: import("../native").ModelDownloadStatus) => void) | null = null;
  return {
    finish(status: import("../native").ModelDownloadStatus) { finish?.(status); },
    reset() { finish = null; },
    promise() { return new Promise<import("../native").ModelDownloadStatus>((resolve) => { finish = resolve; }); },
  };
});

const soulxEntry: import("../native").ModelDownloadCatalogEntry = {
  modelId: "local/soulx-flashhead-pro",
  displayName: "SoulX-FlashHead Pro 1.3B",
  immutableRevision: "soulx-code+weights+runtime",
  totalBytes: 12_000,
  artifactCount: 76,
  licenseId: "Apache-2.0 + dependency licenses",
  licenseUrl: "https://github.com/Soul-AILab/SoulX-FlashHead/blob/main/LICENSE",
  licenseSha256: "a".repeat(64),
  licenseScope: "Pinned test package",
  codeRevision: "code-revision",
  weightRevision: "weight-revision",
  available: true,
  downloadOnlyReason: "Installed locally; explicit activation remains required.",
};
const stagedStatus: import("../native").ModelDownloadStatus = {
  modelId: soulxEntry.modelId,
  immutableRevision: soulxEntry.immutableRevision,
  phase: "downloadedQuarantined",
  downloadedBytes: soulxEntry.totalBytes,
  totalBytes: soulxEntry.totalBytes,
  verifiedArtifacts: soulxEntry.artifactCount,
  artifactCount: soulxEntry.artifactCount,
  licenseId: soulxEntry.licenseId,
  licenseUrl: soulxEntry.licenseUrl,
  licenseSha256: soulxEntry.licenseSha256,
  licenseAcceptedAt: "2026-09-21T00:00:00.000Z",
  detail: "SoulX is installed. Select Use model to verify and activate it.",
  activationBlocked: true,
  updatedAt: "2026-09-21T00:00:00.000Z",
};

vi.mock("../native", async () => {
  const actual = await vi.importActual<typeof import("../native")>("../native");
  return {
    ...actual,
    localModelDownloadCatalog: vi.fn(async () => [soulxEntry]),
    localModelDownloadStatus: vi.fn(async () => [stagedStatus]),
    localModelPresenterActivate: vi.fn(() => activation.promise()),
    localModelSetupSave: vi.fn(actual.localModelSetupSave),
  };
});

import App from "../App";
import { localModelPresenterActivate, localModelSetupSave } from "../native";

beforeEach(async () => {
  activation.reset();
  vi.clearAllMocks();
  await localModelSetupSave({
    activeProfileId: "balanced-cloud",
    selectedModelIds: [],
    lipSyncModelId: null,
    portraitAnimationModelId: null,
    existingModelDirectory: null,
    profiles: [{
      id: "balanced-cloud",
      name: "Balanced cloud",
      description: "Use configured APIs for most stages; keep local-model choices explicit.",
      routes: {
        writing: { providerId: "openai", modelId: "choose at generation" },
        research: { providerId: "openai", modelId: "choose at generation" },
        images: { providerId: "openai", modelId: "gpt-image-2" },
        voice: { providerId: "elevenlabs", modelId: "eleven_multilingual_v2", voiceId: "Xb7hH8MSUJpSbSDYk0k2" },
        transcription: { providerId: "openai", modelId: "choose at generation" },
        presenter: { providerId: "local-runtime", modelId: "off by default" },
        portraitAnimation: { providerId: "local-runtime", modelId: "off by default" },
        lipSync: { providerId: "local-runtime", modelId: "off by default" },
      },
    }],
  });
  vi.clearAllMocks();
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

it("activates the complete SoulX install before selecting its presenter routes", async () => {
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole("button", { name: /models & providers/i }));
  const search = await screen.findByRole("searchbox", { name: /search models/i });
  await user.type(search, "SoulX-FlashHead");
  const card = (await screen.findByRole("heading", { name: "SoulX-FlashHead Pro" })).closest<HTMLElement>(".aly-catalog-card")!;
  const useModel = await within(card).findByRole("button", { name: "Use model" });
  expect(useModel).toBeEnabled();

  await user.click(useModel);
  expect(localModelPresenterActivate).toHaveBeenCalledWith({ modelId: soulxEntry.modelId });
  expect(await within(card).findByRole("button", { name: "Verifying model…" })).toBeDisabled();
  expect(localModelSetupSave).not.toHaveBeenCalled();

  const ready = {
    ...stagedStatus,
    phase: "ready" as const,
    activationBlocked: false,
    installFingerprint: "b".repeat(64),
    runtimeRevision: "soulx-code+weights+runtime",
    detail: "SoulX is installed and selected as the default presenter engine.",
  };
  await act(async () => activation.finish(ready));

  await waitFor(() => expect(localModelSetupSave).toHaveBeenCalledWith(expect.objectContaining({
    lipSyncModelId: soulxEntry.modelId,
    portraitAnimationModelId: soulxEntry.modelId,
    selectedModelIds: expect.arrayContaining([soulxEntry.modelId]),
    profiles: expect.arrayContaining([expect.objectContaining({
      routes: expect.objectContaining({
        presenter: expect.objectContaining({ modelId: soulxEntry.modelId, modelRevision: ready.runtimeRevision, installFingerprint: ready.installFingerprint }),
        portraitAnimation: expect.objectContaining({ modelId: soulxEntry.modelId, modelRevision: ready.runtimeRevision, installFingerprint: ready.installFingerprint }),
        lipSync: expect.objectContaining({ modelId: soulxEntry.modelId, modelRevision: ready.runtimeRevision, installFingerprint: ready.installFingerprint }),
      }),
    })]),
  })));
  expect(await within(card).findByRole("button", { name: "Model in use" })).toBeDisabled();
  expect(screen.getByRole("radio", { name: /SoulX-FlashHead Pro/i })).toBeChecked();
  expect(screen.getByLabelText(/^portrait animation model$/i)).toHaveValue(soulxEntry.modelId);
  expect(screen.getByLabelText(/^lip-sync model$/i)).toHaveValue(soulxEntry.modelId);
});

it("keeps the current presenter engine when verified activation fails", async () => {
  vi.mocked(localModelPresenterActivate).mockRejectedValueOnce(new Error("The installed SoulX ledger changed."));
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByRole("button", { name: /models & providers/i }));
  const search = await screen.findByRole("searchbox", { name: /search models/i });
  await user.type(search, "SoulX-FlashHead");
  const card = (await screen.findByRole("heading", { name: "SoulX-FlashHead Pro" })).closest<HTMLElement>(".aly-catalog-card")!;
  await user.click(await within(card).findByRole("button", { name: "Use model" }));

  expect(await within(card).findByRole("alert")).toHaveTextContent("The installed SoulX ledger changed.");
  expect(localModelSetupSave).not.toHaveBeenCalled();
  expect(screen.getByRole("radio", { name: /SoulX-FlashHead Pro/i })).not.toBeChecked();
  expect(within(card).getByRole("button", { name: "Use model" })).toBeEnabled();
});
