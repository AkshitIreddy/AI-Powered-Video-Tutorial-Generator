import { describe, expect, it, vi } from "vitest";
import { importEditorMediaNative } from "..";

describe("native editor media import", () => {
  it("imports files sequentially so every CAS promotion uses the latest head", async () => {
    const invoke = vi.fn(async (request) => ({
      projectId: request.projectId,
      headRevisionId: request.filename === "one.png" ? "rev-2" : "rev-3",
      revisionNumber: request.filename === "one.png" ? 2 : 3,
      artifact: { id: `asset-${request.filename}`, sha256: (request.filename === "one.png" ? "a" : "b").repeat(64), byteSize: 3, mediaType: request.mimeType, originalFilename: request.filename, state: "promoted" },
      provenance: {
        id: `prov-${request.filename}`,
        origin: "userImport",
        exportEligible: true,
        blockers: [],
        modelInputEligible: false,
        modelInputBlockers: ["Model-input permission is not explicitly allowed"],
      },
    }));
    const result = await importEditorMediaNative(
      [new File(["one"], "one.png", { type: "image/png" }), new File(["two"], "two.webm", { type: "video/webm" })],
      { projectId: "project", projectDirectory: "project-dir", expectedHeadRevisionId: "rev-1" },
      invoke,
      { status: "owned", commercialUse: "allowed", redistribution: "allowed", modelInput: "notAllowed" },
    );
    expect(invoke.mock.calls[0]?.[0]).toMatchObject({ kind: "editorImage", expectedHeadRevisionId: "rev-1" });
    expect(invoke.mock.calls[1]?.[0]).toMatchObject({ kind: "editorVideo", expectedHeadRevisionId: "rev-2" });
    expect(result).toMatchObject({ headRevisionId: "rev-3", revisionNumber: 3 });
    expect(result.assets[0]).toMatchObject({
      status: "ready",
      hash: "a".repeat(64),
      metadata: {
        exportEligible: true,
        modelInputEligible: false,
        modelInputBlockers: "Model-input permission is not explicitly allowed",
      },
    });
  });
});
