import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LocalRuntimePanel, RuntimeDownloadPrompt } from "../LocalRuntimePanel";
import { COMFYUI_RUNTIME_PACKAGE_ID } from "../localRuntime";
import type { ModelDownloadCatalogEntry, ModelDownloadStatus } from "../native";

const runtimeEntry: ModelDownloadCatalogEntry = {
  modelId: COMFYUI_RUNTIME_PACKAGE_ID,
  displayName: "ComfyUI 0.9.2 portable runtime",
  immutableRevision: "comfyui-8f40b43e0204d5b9780f3e9618e140e929e80594",
  totalBytes: 1_803_412_624,
  artifactCount: 1,
  licenseId: "GPL-3.0",
  licenseUrl: "https://example.invalid/license",
  licenseSha256: "a".repeat(64),
  licenseScope: "ComfyUI runtime",
  codeRevision: "b".repeat(40),
  weightRevision: "runtime-only",
  available: true,
  downloadOnlyReason: "Verified runtime.",
};

function runtimeStatus(overrides: Partial<ModelDownloadStatus> = {}): ModelDownloadStatus {
  return {
    modelId: COMFYUI_RUNTIME_PACKAGE_ID,
    immutableRevision: runtimeEntry.immutableRevision,
    phase: "ready",
    downloadedBytes: runtimeEntry.totalBytes,
    totalBytes: runtimeEntry.totalBytes,
    verifiedArtifacts: 1,
    artifactCount: 1,
    licenseId: runtimeEntry.licenseId,
    licenseUrl: runtimeEntry.licenseUrl,
    licenseSha256: runtimeEntry.licenseSha256,
    licenseAcceptedAt: "2026-09-20T00:00:00.000Z",
    detail: "Runtime ready.",
    activationBlocked: false,
    installFingerprint: "c".repeat(64),
    runtimeRevision: "comfyui-8f40b43e0204d5b9780f3e9618e140e929e80594",
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("LocalRuntimePanel", () => {
  it("offers the standalone runtime package without implying a model download", async () => {
    const user = userEvent.setup();
    const onDownloadRuntime = vi.fn();
    render(<LocalRuntimePanel runtimeEntry={runtimeEntry} runtimeStatus={null} queued={false} starting={false} loading={false} onDownloadRuntime={onDownloadRuntime} onViewDownloads={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "ComfyUI runtime" })).toBeInTheDocument();
    expect(screen.getAllByText("Not installed", { exact: true })).toHaveLength(1);
    expect(screen.getByText(/1.7 GB · GPL-3.0/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Download ComfyUI" }));
    expect(onDownloadRuntime).toHaveBeenCalledOnce();
  });

  it("reports only a verified runtime receipt as ready and links to Downloads", async () => {
    const user = userEvent.setup();
    const onViewDownloads = vi.fn();
    render(<LocalRuntimePanel runtimeEntry={runtimeEntry} runtimeStatus={runtimeStatus()} queued={false} starting={false} loading={false} onDownloadRuntime={vi.fn()} onViewDownloads={onViewDownloads} />);

    expect(screen.getAllByText("Ready", { exact: true })).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Download ComfyUI" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View downloads" }));
    expect(onViewDownloads).toHaveBeenCalledOnce();
  });

  it("does not accept an SDXL receipt as the runtime", () => {
    render(<LocalRuntimePanel runtimeEntry={runtimeEntry} runtimeStatus={runtimeStatus({ modelId: "local/sdxl-base-1.0" })} queued={false} starting={false} loading={false} onDownloadRuntime={vi.fn()} onViewDownloads={vi.fn()} />);
    expect(screen.getAllByText("Not installed", { exact: true })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Download ComfyUI" })).toBeEnabled();
  });
});

describe("RuntimeDownloadPrompt", () => {
  it("offers one truthful combined action, traps focus, and restores it on cancel", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const opener = document.createElement("button");
    opener.textContent = "Open";
    document.body.append(opener);
    opener.focus();
    const view = render(<RuntimeDownloadPrompt modelName="FLUX test" modelTotalBytes={10_058_462_434} runtimeBytes={1_803_412_624} canDownload onConfirm={onConfirm} onCancel={onCancel} />);

    const primary = screen.getByRole("button", { name: "Download FLUX test + ComfyUI" });
    expect(screen.getByRole("alertdialog", { name: "Install ComfyUI with FLUX test" })).toBeInTheDocument();
    expect(screen.getByText(/complete download is 9.4 GB/)).toHaveTextContent("already includes the 1.7 GB shared runtime");
    expect(screen.queryByRole("button", { name: /model only/i })).not.toBeInTheDocument();
    await waitFor(() => expect(primary).toHaveFocus());
    const close = screen.getByRole("button", { name: "Close runtime download" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    close.focus();
    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.click(primary);
    expect(onConfirm).toHaveBeenCalledOnce();

    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    view.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
