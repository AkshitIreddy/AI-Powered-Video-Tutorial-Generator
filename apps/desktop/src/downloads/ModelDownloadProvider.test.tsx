import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelDownloadProvider, useModelDownloads } from "./ModelDownloadProvider";
import { ModelDownloadLauncher, ModelDownloadPanel } from "./ModelDownloadPanel";
import { localModelDownloadCatalog, localModelDownloadStart, localModelDownloadStatus, type ModelDownloadCatalogEntry, type ModelDownloadStatus } from "../native";

vi.mock("../native", () => ({ localModelDownloadCatalog: vi.fn(), localModelDownloadStart: vi.fn(), localModelDownloadStatus: vi.fn() }));
const entries: ModelDownloadCatalogEntry[] = ["first", "second"].map((id) => ({ modelId: id, displayName: `${id} model`, immutableRevision: "pinned", totalBytes: 1024, artifactCount: 1, licenseId: "MIT", licenseUrl: "https://example.test/license", licenseSha256: `license-${id}`, licenseScope: "model", codeRevision: "pinned", weightRevision: "pinned", available: true, downloadOnlyReason: "" }));
function status(modelId: string, phase: ModelDownloadStatus["phase"], downloadedBytes = 0): ModelDownloadStatus {
  return { modelId, phase, downloadedBytes, totalBytes: 1024, artifactCount: 1, verifiedArtifacts: phase === "downloadedQuarantined" ? 1 : 0, immutableRevision: "pinned", licenseId: "MIT", licenseUrl: "https://example.test/license", licenseSha256: `license-${modelId}`, licenseAcceptedAt: null, detail: "Real bridge status", activationBlocked: true, updatedAt: "now" };
}
function Picker() {
  const downloads = useModelDownloads();
  return <button disabled={downloads.loading} onClick={() => downloads.enqueue(["first", "second", "first"])}>Select toolkit</button>;
}
function App({ showPicker = true }: { showPicker?: boolean }) {
  return <ModelDownloadProvider>{showPicker && <Picker />}<ModelDownloadLauncher /><ModelDownloadPanel /></ModelDownloadProvider>;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(localModelDownloadCatalog).mockResolvedValue(entries);
  vi.mocked(localModelDownloadStatus).mockResolvedValue([]);
  vi.mocked(localModelDownloadStart).mockImplementation(async (input) => status(input.modelId, "downloading"));
});
describe("app model downloads", () => {
  it("continues a deduplicated queue after onboarding unmounts and the panel is minimized", async () => {
    const view = render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Select toolkit" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Select toolkit" }));
    await waitFor(() => expect(localModelDownloadStart).toHaveBeenCalledTimes(1));
    expect(localModelDownloadStart).toHaveBeenCalledWith({ modelId: "first", licenseSha256: "license-first", licenseAccepted: true });
    expect(screen.getByRole("region", { name: "Model downloads" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Minimize downloads" }));
    view.rerender(<App showPicker={false} />);
    expect(screen.queryByRole("region", { name: "Model downloads" })).not.toBeInTheDocument();
    vi.mocked(localModelDownloadStatus).mockResolvedValue([status("first", "downloadedQuarantined", 1024)]);
    await waitFor(() => expect(localModelDownloadStart).toHaveBeenCalledTimes(2), { timeout: 2500 });
    expect(localModelDownloadStart).toHaveBeenLastCalledWith({ modelId: "second", licenseSha256: "license-second", licenseAccepted: true });
    fireEvent.click(screen.getByRole("button", { name: /Downloads/ }));
    expect(screen.getByText("Files downloaded")).toBeVisible();
    expect(screen.getByText("Downloading")).toBeVisible();
  });
  it("shows failed starts and advances to the next requested pack without retry loops", async () => {
    vi.mocked(localModelDownloadStart).mockRejectedValueOnce(new Error("Disk is full"));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Select toolkit" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Select toolkit" }));
    await waitFor(() => expect(localModelDownloadStart).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("alert")).toHaveTextContent("Disk is full");
    expect(screen.getByRole("button", { name: "Retry download" })).toBeEnabled();
  });
  it("restores waiting requests without accepting a changed license or downloading unavailable packs", async () => {
    localStorage.setItem("alystria-model-download-queue-v1", JSON.stringify([{ modelId: "first", licenseSha256: "previous-license" }, { modelId: "second", licenseSha256: "license-second" }]));
    render(<App />);
    await waitFor(() => expect(localModelDownloadStart).toHaveBeenCalledTimes(1));
    expect(localModelDownloadStart).toHaveBeenCalledWith(expect.objectContaining({ modelId: "second" }));
    fireEvent.click(screen.getByRole("button", { name: /Downloads/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("package changed while waiting");
  });
  it("lets queued work be removed while an accepted request is starting", async () => {
    let finish!: (value: ModelDownloadStatus) => void;
    vi.mocked(localModelDownloadStart).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Select toolkit" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Select toolkit" }));
    await waitFor(() => expect(localModelDownloadStart).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Remove second model from queue" }));
    await act(async () => finish(status("first", "downloadedQuarantined", 1024)));
    expect(localModelDownloadStart).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("alystria-model-download-queue-v1")).toBe("[]");
  });
});
