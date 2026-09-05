import { compileEditorRenderManifest, type EditorRenderBlocker, type EditorRenderManifest } from "./renderManifest";
import type { EditorProject } from "./types";

export interface EditorTimelineExportRequest {
  projectId: string;
  projectDirectory: string;
  expectedHeadRevisionId: string;
  manifest: EditorRenderManifest;
}

export interface EditorTimelineExportResult {
  projectId: string;
  outputPath: string;
  artifactHash: string;
  mediaType: string;
  byteSize: number;
  codec: string;
  durationTicks: number;
  manifestHash: string;
  warnings: string[];
  captionSidecars?: Array<{ format: "vtt" | "srt"; path: string; artifactHash: string; mediaType: string; byteSize: number }>;
  headRevisionId?: string;
  revisionNumber?: number;
}

export interface EditorTimelineExportJobReceipt {
  jobId: string;
  state: "BLOCKED" | "READY" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "RETRY_WAIT" | "FAILED" | "CANCELLED" | "STALE";
  acceptedAt: string;
  message: string;
  retryable: boolean;
  operation?: string;
  progress?: number;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
}

export class EditorNativeExportBlockedError extends Error {
  readonly blockers: EditorRenderBlocker[];

  constructor(blockers: EditorRenderBlocker[]) {
    super(blockers.map((blocker) => blocker.message).join(" "));
    this.name = "EditorNativeExportBlockedError";
    this.blockers = blockers;
  }
}

export async function exportEditorTimelineNative(
  project: EditorProject,
  identity: Omit<EditorTimelineExportRequest, "manifest">,
  invoke: (request: EditorTimelineExportRequest) => Promise<EditorTimelineExportJobReceipt>,
  codec: EditorRenderManifest["codec"] = { name: "vp9" },
): Promise<EditorTimelineExportJobReceipt> {
  if (identity.projectId !== project.id) throw new Error("The open native project does not match the editor document.");
  const compiled = compileEditorRenderManifest(project, codec);
  if (!compiled.ready) throw new EditorNativeExportBlockedError(compiled.blockers);
  const receipt = await invoke({ ...identity, manifest: compiled.manifest });
  if (!receipt.jobId || !receipt.message || (receipt.operation !== undefined && receipt.operation !== "editor_timeline_export")) throw new Error("Native editor export returned an invalid job receipt.");
  return receipt;
}

export function editorTimelineExportResult(receipt: EditorTimelineExportJobReceipt, projectId: string): EditorTimelineExportResult | null {
  if (receipt.state !== "SUCCEEDED") return null;
  const value = receipt.result;
  const sidecars = value?.captionSidecars;
  const validSidecars = sidecars === undefined || (Array.isArray(sidecars) && sidecars.every((sidecar) => {
    if (!sidecar || typeof sidecar !== "object") return false;
    const entry = sidecar as Record<string, unknown>;
    return (entry.format === "vtt" || entry.format === "srt") && typeof entry.path === "string" && typeof entry.mediaType === "string" && typeof entry.byteSize === "number" && typeof entry.artifactHash === "string" && /^[0-9a-f]{64}$/u.test(entry.artifactHash);
  }));
  if (!value || value.projectId !== projectId || typeof value.outputPath !== "string" || typeof value.artifactHash !== "string" || typeof value.manifestHash !== "string" || typeof value.mediaType !== "string" || typeof value.byteSize !== "number" || typeof value.codec !== "string" || typeof value.durationTicks !== "number" || !Array.isArray(value.warnings) || !value.warnings.every((warning) => typeof warning === "string") || !/^[0-9a-f]{64}$/u.test(value.artifactHash) || !/^[0-9a-f]{64}$/u.test(value.manifestHash) || !validSidecars) {
    throw new Error("Completed native editor export has an invalid or mismatched result.");
  }
  return value as unknown as EditorTimelineExportResult;
}
