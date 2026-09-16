import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelDownloadCatalogEntry, ModelDownloadStatus } from "../../native";
import type { OnboardingCatalog, PersistedOnboardingState } from "..";

const downloads = vi.hoisted(() => ({
  catalog: [] as ModelDownloadCatalogEntry[],
  statuses: [] as ModelDownloadStatus[],
  loading: false,
  error: null as Error | null,
  queuedModelIds: [] as string[],
  startingModelIds: new Set<string>(),
  enqueue: vi.fn(),
  refresh: vi.fn(async () => undefined),
  openPanel: vi.fn(),
  minimize: vi.fn(),
  panelOpen: false,
  cancel: vi.fn(async () => undefined),
}));

vi.mock("../../downloads/ModelDownloadProvider", () => ({
  useModelDownloads: () => downloads,
}));

import { OnboardingDialog, createOnboardingState, useOnboardingController } from "..";

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

function status(phase: ModelDownloadStatus["phase"]): ModelDownloadStatus {
  return {
    modelId: entry.modelId,
    immutableRevision: entry.immutableRevision,
    phase,
    downloadedBytes: phase === "ready" ? entry.totalBytes : 256,
    totalBytes: entry.totalBytes,
    verifiedArtifacts: phase === "ready" ? entry.artifactCount : 0,
    artifactCount: entry.artifactCount,
    licenseId: entry.licenseId,
    licenseUrl: entry.licenseUrl,
    licenseSha256: entry.licenseSha256,
    licenseAcceptedAt: phase === "manifestRequired" ? null : "2026-09-16T00:00:00.000Z",
    detail: "A pinned immutable declaration is ready.",
    activationBlocked: phase !== "ready",
    updatedAt: "2026-09-16T00:00:00.000Z",
  };
}

const catalog: OnboardingCatalog = {
  goals: [{ id: "tutorial", label: "Tutorial", description: "Build a tutorial." }],
  runtimes: [{ id: "local", label: "Local", description: "Use this computer." }],
  providers: [],
  models: [{ id: entry.modelId, name: entry.displayName, providerId: "local", medium: "speech", description: "Local narration." }],
  portraits: [],
};

function modelState(selectedModelIds: string[] = []): PersistedOnboardingState {
  const state = createOnboardingState();
  state.status = "in-progress";
  state.activeChapterId = "model";
  state.visitedChapterIds = ["model"];
  state.configuration.modelIds = selectedModelIds;
  return state;
}

function Harness({
  selectedModelIds = [],
  onPersist = vi.fn(),
  onExit = vi.fn(),
  onboardingCatalog = catalog,
}: {
  selectedModelIds?: string[];
  onPersist?: (state: PersistedOnboardingState) => void;
  onExit?: (state: PersistedOnboardingState) => void;
  onboardingCatalog?: OnboardingCatalog;
}) {
  const controller = useOnboardingController({
    persistedState: modelState(selectedModelIds),
    onPersist,
    onExit,
  });
  return <OnboardingDialog controller={controller} catalog={onboardingCatalog} />;
}

describe("onboarding model downloads", () => {
  beforeEach(() => {
    downloads.catalog = [entry];
    downloads.statuses = [status("manifestRequired")];
    downloads.loading = false;
    downloads.error = null;
    downloads.queuedModelIds = [];
    downloads.startingModelIds = new Set();
    downloads.enqueue.mockReset();
    downloads.refresh.mockClear();
    downloads.openPanel.mockReset();
    downloads.minimize.mockClear();
    downloads.cancel.mockClear();
  });

  it("starts a verified download from model selection and opens the shared progress panel", async () => {
    const user = userEvent.setup();
    const onPersist = vi.fn();
    render(<Harness onPersist={onPersist} />);

    expect(screen.getByRole("link", { name: "Example-2.0" })).toHaveAttribute("href", entry.licenseUrl);
    expect(screen.getByText("aaaaaaaaaaaa…")).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: /Studio Narrator/ }));

    expect(downloads.enqueue).toHaveBeenCalledWith([entry.modelId]);
    expect(downloads.openPanel).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(onPersist).toHaveBeenLastCalledWith(expect.objectContaining({
      configuration: expect.objectContaining({ modelIds: [entry.modelId] }),
    })));
  });

  it("offers a native package missing from the descriptive catalog and starts its real package ID", async () => {
    const user = userEvent.setup();
    render(<Harness onboardingCatalog={{ ...catalog, models: [] }} />);
    await user.click(screen.getByRole("checkbox", { name: /Studio Narrator/ }));
    expect(downloads.enqueue).toHaveBeenCalledWith([entry.modelId]);
    expect(downloads.openPanel).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lets onboarding close while a selected download remains active", async () => {
    downloads.statuses = [status("downloading")];
    const user = userEvent.setup();
    const onExit = vi.fn();
    render(<Harness selectedModelIds={[entry.modelId]} onExit={onExit} />);

    expect(screen.getByText("Downloading", { exact: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "Exit onboarding" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Exit onboarding" }));

    expect(onExit).toHaveBeenCalledWith(expect.objectContaining({ status: "in-progress" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(downloads.cancel).not.toHaveBeenCalled();
  });

  it("reopens global progress for a selected model without restarting it", async () => {
    downloads.statuses = [status("ready")];
    const user = userEvent.setup();
    render(<Harness selectedModelIds={[entry.modelId]} />);

    expect(screen.getAllByText("Ready", { exact: true })).not.toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Open download progress" }));
    expect(downloads.openPanel).toHaveBeenCalledOnce();
    expect(downloads.enqueue).not.toHaveBeenCalled();
  });

  it("sorts actionable models first and disables choices without a download or installation", () => {
    render(<Harness onboardingCatalog={{
      ...catalog,
      models: [
        { id: "future-model", name: "Future model", providerId: "local", medium: "image" },
        ...catalog.models,
      ],
    }} />);

    const choices = screen.getAllByRole("checkbox");
    expect(choices.map((choice) => choice.getAttribute("value"))).toEqual([entry.modelId, "future-model"]);
    expect(screen.getByRole("checkbox", { name: /Studio Narrator/ })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /Future model/ })).toBeDisabled();
    expect(screen.getByText("Download unavailable")).toBeVisible();
  });
});
