import { describe, expect, it, vi } from "vitest";
import { EditorNativeExportBlockedError, editorTimelineExportResult, exportEditorTimelineNative } from "..";
import { makeSampleProject } from "./fixtures";

describe("native editor export bridge", () => {
  it("blocks before native invocation when media has no durable CAS binding", async () => {
    const invoke = vi.fn();
    await expect(exportEditorTimelineNative(makeSampleProject(), { projectId: "sample-project", projectDirectory: "project", expectedHeadRevisionId: "rev-1" }, invoke)).rejects.toBeInstanceOf(EditorNativeExportBlockedError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("validates the native export receipt", async () => {
    const project = makeSampleProject();
    project.assets = project.assets.map((asset, index) => ({ ...asset, status: "ready", hash: String(index + 1).repeat(64), metadata: { exportEligible: true } }));
    const invoke = vi.fn(async () => ({
      jobId: "job-editor-export",
      state: "QUEUED" as const,
      acceptedAt: "2026-09-05T00:00:00Z",
      message: "Editor timeline export is queued",
      retryable: false,
      operation: "editor_timeline_export" as const,
      result: null,
    }));
    await expect(exportEditorTimelineNative(project, { projectId: project.id, projectDirectory: "project", expectedHeadRevisionId: "rev-1" }, invoke)).resolves.toMatchObject({ state: "QUEUED", jobId: "job-editor-export" });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("extracts only a valid completed render result", () => {
    const succeeded = {
      jobId: "job-editor-export",
      state: "SUCCEEDED" as const,
      acceptedAt: "2026-09-05T00:00:00Z",
      message: "Editor timeline export completed",
      retryable: false,
      operation: "editor_timeline_export",
      result: {
        projectId: "sample-project",
        outputPath: "C:/project/exports/editor/sample.webm",
        artifactHash: "a".repeat(64),
        mediaType: "video/webm",
        byteSize: 1024,
        codec: "vp9",
        durationTicks: 240_000,
        manifestHash: "b".repeat(64),
        warnings: [],
        headRevisionId: "rev-2",
        revisionNumber: 2,
      },
    };
    expect(editorTimelineExportResult(succeeded, "sample-project")).toMatchObject({ outputPath: "C:/project/exports/editor/sample.webm", headRevisionId: "rev-2" });
    expect(editorTimelineExportResult({ ...succeeded, state: "RETRY_WAIT" }, "sample-project")).toBeNull();
    expect(() => editorTimelineExportResult({ ...succeeded, result: { ...succeeded.result, projectId: "another-project" } }, "sample-project")).toThrow(/invalid or mismatched/i);
  });
});
