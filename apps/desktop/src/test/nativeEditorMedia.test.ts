import { describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  projectAssetImport: vi.fn(),
  projectSnapshotGet: vi.fn(),
}));

vi.mock("../native", () => ({
  editorDocumentExport: vi.fn(),
  projectAssetImport: native.projectAssetImport,
  projectSnapshotGet: native.projectSnapshotGet,
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset:${path}` }));

import { importNativeEditorMedia, type NativeMediaMutationRunner } from "../nativeEditorMedia";
import type { BrowserMediaImportController, EditorImportBatch } from "../editor";

const identity = { projectId: "project", projectDirectory: "E:/project" };

function mediaFile(): File {
  const file = new File(["video"], "lesson.webm", { type: "video/webm" });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new TextEncoder().encode("video").buffer,
  });
  return file;
}

function controller(): BrowserMediaImportController {
  return {
    importFiles: vi.fn(async ([file]: readonly File[]): Promise<EditorImportBatch> => ({
      assets: [{
        id: "browser-video",
        name: file!.name,
        kind: "video",
        status: "ready",
        durationFrames: 90,
        previewUrl: "blob:transient",
        mimeType: file!.type,
        provenance: { origin: "user-import", createdAt: "2026-09-20T09:01:35.729Z", humanApproved: false },
        metadata: { browserSessionOnly: true },
      }],
      receipts: [],
    })),
    release: vi.fn(),
  } as unknown as BrowserMediaImportController;
}

describe("native editor media import", () => {
  it("reads the durable head inside the shared project-mutation queue", async () => {
    let durableHead = "head-before-editor-save";
    const operations: Array<() => Promise<void>> = [];
    const runSerialized: NativeMediaMutationRunner = <T,>(operation: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
      operations.push(async () => {
        try { resolve(await operation()); } catch (error) { reject(error); }
      });
    });
    native.projectSnapshotGet.mockImplementation(async () => ({ headRevisionId: durableHead, revisionNumber: 23, snapshot: {} }));
    native.projectAssetImport.mockImplementation(async (input: { expectedHeadRevisionId: string }) => {
      if (input.expectedHeadRevisionId !== durableHead) throw { code: "REVISION_CONFLICT", message: "Expected the current project head." };
      return {
        headRevisionId: "head-after-import",
        revisionNumber: 24,
        artifact: { id: "asset-video", sha256: "a".repeat(64) },
        provenance: { exportEligible: true },
      };
    });
    const onHead = vi.fn();
    const pending = importNativeEditorMedia(
      [mediaFile()],
      identity,
      controller(),
      "owned",
      vi.fn().mockResolvedValue({ path: "E:/project/video.webm", mediaType: "video/webm", byteSize: 5 }),
      onHead,
      runSerialized,
      (error) => error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : String(error),
    );

    await vi.waitFor(() => expect(operations).toHaveLength(1));
    durableHead = "head-after-editor-save";
    await operations.shift()!();
    const result = await pending;

    expect(native.projectSnapshotGet).toHaveBeenCalledWith(identity);
    expect(native.projectAssetImport).toHaveBeenCalledWith(expect.objectContaining({ expectedHeadRevisionId: "head-after-editor-save" }));
    expect(onHead).toHaveBeenCalledWith({ nativeHeadRevisionId: "head-after-import", nativeRevisionNumber: 24 });
    expect(result.receipts[0]).toMatchObject({ status: "ready", fileName: "lesson.webm" });
  });

  it("keeps a structured native error message in the failed import receipt", async () => {
    native.projectSnapshotGet.mockResolvedValue({ headRevisionId: "stale-head", revisionNumber: 22, snapshot: {} });
    native.projectAssetImport.mockRejectedValue({ code: "REVISION_CONFLICT", message: "The project head advanced while importing media." });
    const formatError = vi.fn((error: unknown) => error && typeof error === "object" && "message" in error ? String(error.message) : "Unexpected error");

    const result = await importNativeEditorMedia(
      [mediaFile()],
      identity,
      controller(),
      "owned",
      vi.fn(),
      vi.fn(),
      (operation) => operation(),
      formatError,
    );

    expect(formatError).toHaveBeenCalledWith(expect.objectContaining({ code: "REVISION_CONFLICT" }));
    expect(result.receipts[0]).toMatchObject({
      status: "failed",
      errorCode: "NATIVE_IMPORT_FAILED",
      errorMessage: "The project head advanced while importing media.",
    });
  });
});
