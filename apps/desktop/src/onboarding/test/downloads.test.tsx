import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeDownloads = vi.hoisted(() => ({
  catalog: vi.fn(),
  status: vi.fn(),
  start: vi.fn(),
}));

vi.mock("../../native", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../native")>();
  return {
    ...original,
    localModelDownloadCatalog: nativeDownloads.catalog,
    localModelDownloadStatus: nativeDownloads.status,
    localModelDownloadStart: nativeDownloads.start,
  };
});

import { OnboardingDialog, createOnboardingState, useOnboardingController } from "..";
import type { ModelDownloadCatalogEntry, ModelDownloadStatus } from "../../native";
import type { OnboardingCatalog, PersistedOnboardingState } from "..";

const entry: ModelDownloadCatalogEntry = {
  modelId: "narrator",
  displayName: "Studio Narrator",
  immutableRevision: "narrator-v1",
  totalBytes: 1024,
  artifactCount: 2,
  licenseId: "Example-2.0",
  licenseUrl: "https://example.test/license",
  licenseSha256: "a".repeat(64),
  licenseScope: "The pinned narrator runtime and its two model files.",
  codeRevision: "b".repeat(40),
  weightRevision: "c".repeat(40),
  available: true,
  downloadOnlyReason: "Verified local download.",
};

const secondEntry: ModelDownloadCatalogEntry = {
  ...entry,
  modelId: "visual-model",
  displayName: "Slide Illustrator",
  immutableRevision: "visual-v1",
  totalBytes: 2048,
  licenseId: "Visual-1.0",
  licenseUrl: "https://example.test/visual-license",
  licenseSha256: "d".repeat(64),
};

function status(phase: ModelDownloadStatus["phase"], overrides: Partial<ModelDownloadStatus> = {}): ModelDownloadStatus {
  return {
    modelId: entry.modelId,
    immutableRevision: entry.immutableRevision,
    phase,
    downloadedBytes: 0,
    totalBytes: entry.totalBytes,
    verifiedArtifacts: 0,
    artifactCount: entry.artifactCount,
    licenseId: entry.licenseId,
    licenseUrl: entry.licenseUrl,
    licenseSha256: entry.licenseSha256,
    licenseAcceptedAt: null,
    detail: "A pinned immutable declaration is ready.",
    activationBlocked: true,
    updatedAt: "2026-09-16T00:00:00.000Z",
    ...overrides,
  };
}

const catalog: OnboardingCatalog = {
  goals: [{ id: "tutorial", label: "Tutorial", description: "Build a tutorial." }],
  runtimes: [{ id: "local", label: "Local", description: "Use this computer." }],
  providers: [],
  models: [{ id: entry.modelId, name: entry.displayName, providerId: "local", medium: "speech", description: "Local narration." }],
  portraits: [],
};

const multiCatalog: OnboardingCatalog = {
  ...catalog,
  models: [
    ...catalog.models,
    { id: secondEntry.modelId, name: secondEntry.displayName, providerId: "local", medium: "image", description: "Local slide artwork." },
  ],
};

function modelState(): PersistedOnboardingState {
  const state = createOnboardingState();
  state.status = "in-progress";
  state.activeChapterId = "model";
  state.visitedChapterIds = ["model"];
  return state;
}

function Harness({ onboardingCatalog = catalog, selectedModelIds = [entry.modelId] }: { onboardingCatalog?: OnboardingCatalog; selectedModelIds?: string[] }) {
  const state = modelState();
  state.configuration.modelIds = [...state.configuration.modelIds, ...selectedModelIds];
  const controller = useOnboardingController({
    persistedState: state,
    onPersist: vi.fn(),
  });
  return <OnboardingDialog controller={controller} catalog={onboardingCatalog} />;
}

describe("onboarding model downloads", () => {
  beforeEach(() => {
    nativeDownloads.catalog.mockReset().mockResolvedValue([entry]);
    nativeDownloads.status.mockReset().mockResolvedValue([status("manifestRequired")]);
    nativeDownloads.start.mockReset().mockImplementation(async () => {
      const downloading = status("downloading");
      nativeDownloads.status.mockResolvedValue([downloading]);
      return downloading;
    });
  });

  it("starts the selected pinned download only after its exact license is accepted", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(await screen.findByRole("heading", { name: "Install without leaving onboarding" })).toBeVisible();
    const download = screen.getByRole("button", { name: "Download and verify" });
    expect(download).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /I accept the exact Example-2.0 record/i }));
    await user.click(download);

    await waitFor(() => expect(nativeDownloads.start).toHaveBeenCalledWith({
      modelId: entry.modelId,
      licenseSha256: entry.licenseSha256,
      licenseAccepted: true,
    }));
    expect(await screen.findAllByText("Downloading", { exact: true })).toHaveLength(2);
  });

  it("shows persisted failure progress and retries through the same native declaration", async () => {
    nativeDownloads.status.mockResolvedValue([status("failed", {
      downloadedBytes: 512,
      verifiedArtifacts: 1,
      detail: "The connection ended before the second file completed.",
    })]);
    const user = userEvent.setup();
    render(<Harness />);

    expect(await screen.findByText("The connection ended before the second file completed.")).toBeVisible();
    expect(screen.getByText("1 of 2 files verified · 50%")).toBeVisible();
    const retry = screen.getByRole("button", { name: "Retry verified download" });
    expect(retry).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /I accept the exact Example-2.0 record/i }));
    await user.click(retry);
    await waitFor(() => expect(nativeDownloads.start).toHaveBeenCalledTimes(1));
  });

  it("reuses a verified installation without offering another download", async () => {
    nativeDownloads.status.mockResolvedValue([status("ready", {
      downloadedBytes: entry.totalBytes,
      verifiedArtifacts: entry.artifactCount,
      activationBlocked: false,
    })]);
    render(<Harness />);

    expect(await screen.findByText(/already available.*reuse it without downloading it again/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /download/i })).not.toBeInTheDocument();
    expect(nativeDownloads.start).not.toHaveBeenCalled();
  });

  it("queues accepted selected packs and starts only one native download at a time", async () => {
    nativeDownloads.catalog.mockResolvedValue([entry, secondEntry]);
    nativeDownloads.status.mockResolvedValue([status("manifestRequired"), {
      ...status("manifestRequired"),
      modelId: secondEntry.modelId,
      immutableRevision: secondEntry.immutableRevision,
      totalBytes: secondEntry.totalBytes,
      licenseId: secondEntry.licenseId,
      licenseUrl: secondEntry.licenseUrl,
      licenseSha256: secondEntry.licenseSha256,
    }]);
    nativeDownloads.start.mockImplementation(async ({ modelId }: { modelId: string }) => {
      const source = modelId === secondEntry.modelId ? secondEntry : entry;
      const downloading = {
        ...status("downloading"),
        modelId: source.modelId,
        immutableRevision: source.immutableRevision,
        totalBytes: source.totalBytes,
        artifactCount: source.artifactCount,
        licenseId: source.licenseId,
        licenseUrl: source.licenseUrl,
        licenseSha256: source.licenseSha256,
      };
      nativeDownloads.status.mockResolvedValue(modelId === entry.modelId ? [downloading, {
        ...status("manifestRequired"),
        modelId: secondEntry.modelId,
        immutableRevision: secondEntry.immutableRevision,
        totalBytes: secondEntry.totalBytes,
        licenseId: secondEntry.licenseId,
        licenseUrl: secondEntry.licenseUrl,
        licenseSha256: secondEntry.licenseSha256,
      }] : [downloading]);
      return downloading;
    });
    const user = userEvent.setup();
    render(<Harness onboardingCatalog={multiCatalog} selectedModelIds={[entry.modelId, secondEntry.modelId]} />);

    await screen.findByRole("heading", { name: "Install without leaving onboarding" });
    await user.click(screen.getByRole("checkbox", { name: /I accept the exact Example-2.0 record/i }));
    await user.click(screen.getByRole("checkbox", { name: /I accept the exact Visual-1.0 record/i }));
    await user.click(screen.getByRole("button", { name: "Queue accepted packs (2)" }));

    await waitFor(() => expect(nativeDownloads.start).toHaveBeenCalledTimes(1));
    expect(nativeDownloads.start).toHaveBeenCalledWith(expect.objectContaining({ modelId: entry.modelId }));
    expect(screen.getAllByText("Queued", { exact: true })).toHaveLength(2);

    nativeDownloads.status.mockResolvedValue([status("ready", {
      downloadedBytes: entry.totalBytes,
      verifiedArtifacts: entry.artifactCount,
      activationBlocked: false,
    }), {
      ...status("manifestRequired"),
      modelId: secondEntry.modelId,
      immutableRevision: secondEntry.immutableRevision,
      totalBytes: secondEntry.totalBytes,
      licenseId: secondEntry.licenseId,
      licenseUrl: secondEntry.licenseUrl,
      licenseSha256: secondEntry.licenseSha256,
    }]);
    await user.click(screen.getByRole("button", { name: "Refresh status" }));

    await waitFor(() => expect(nativeDownloads.start).toHaveBeenCalledTimes(2));
    expect(nativeDownloads.start).toHaveBeenLastCalledWith(expect.objectContaining({ modelId: secondEntry.modelId }));
  });

  it("keeps setup open while an unstarted queue exists and lets the user explicitly clear it", async () => {
    nativeDownloads.catalog.mockResolvedValue([entry, secondEntry]);
    nativeDownloads.status.mockResolvedValue([status("manifestRequired"), {
      ...status("manifestRequired"),
      modelId: secondEntry.modelId,
      immutableRevision: secondEntry.immutableRevision,
      totalBytes: secondEntry.totalBytes,
      licenseId: secondEntry.licenseId,
      licenseUrl: secondEntry.licenseUrl,
      licenseSha256: secondEntry.licenseSha256,
    }]);
    const user = userEvent.setup();
    render(<Harness onboardingCatalog={multiCatalog} selectedModelIds={[entry.modelId, secondEntry.modelId]} />);

    await screen.findByRole("heading", { name: "Install without leaving onboarding" });
    await user.click(screen.getByRole("checkbox", { name: /I accept the exact Example-2.0 record/i }));
    await user.click(screen.getByRole("checkbox", { name: /I accept the exact Visual-1.0 record/i }));
    await user.click(screen.getByRole("button", { name: "Queue accepted packs (2)" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Exit onboarding" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Skip setup" })).toBeDisabled();
    expect(screen.getByText(/keep setup open while 1 selected pack waits to start/i)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Clear waiting packs (1)" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Exit onboarding" })).toBeEnabled());
  });
});
