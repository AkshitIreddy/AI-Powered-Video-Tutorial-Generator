import type { EditorImportBatch, EditorMediaAsset, ImportReceipt, MediaKind } from "./types";

export type NativeEditorAssetKind = "editorImage" | "editorVideo" | "editorAudio";

export interface NativeEditorAssetImportRequest {
  projectId: string;
  projectDirectory: string;
  expectedHeadRevisionId: string;
  kind: NativeEditorAssetKind;
  filename: string;
  mimeType: string;
  privacy: "public" | "project_local" | "sensitive" | "restricted";
  rights: {
    status: "owned" | "licensed" | "publicDomain" | "unknown";
    creator?: string;
    license?: string;
    attribution?: string;
    commercialUse: "allowed" | "notAllowed" | "unknown";
    redistribution: "allowed" | "notAllowed" | "unknown";
    modelInput: "allowed" | "notAllowed" | "unknown";
  };
  contentBase64: string;
}

export interface NativeEditorAssetImportReceipt {
  projectId: string;
  headRevisionId: string;
  revisionNumber: number;
  artifact: { id: string; sha256: string; byteSize: number; mediaType: string; originalFilename: string; state: string };
  provenance: { id: string; origin: string; exportEligible: boolean; blockers: string[] };
}

export interface NativeEditorMediaImportResult extends EditorImportBatch {
  headRevisionId: string;
  revisionNumber: number;
}

function fileKind(file: File): { mediaKind: Extract<MediaKind, "image" | "video" | "audio">; nativeKind: NativeEditorAssetKind } | null {
  if (file.type.startsWith("image/")) return { mediaKind: "image", nativeKind: "editorImage" };
  if (file.type.startsWith("video/")) return { mediaKind: "video", nativeKind: "editorVideo" };
  if (file.type.startsWith("audio/")) return { mediaKind: "audio", nativeKind: "editorAudio" };
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  return btoa(parts.join(""));
}

function readFileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) reject(new Error(`Could not read ${file.name} as bytes.`));
      else resolve(new Uint8Array(reader.result));
    };
    reader.readAsArrayBuffer(file);
  });
}

export async function importEditorMediaNative(
  files: readonly File[],
  identity: { projectId: string; projectDirectory: string; expectedHeadRevisionId: string },
  invoke: (request: NativeEditorAssetImportRequest) => Promise<NativeEditorAssetImportReceipt>,
  rights: NativeEditorAssetImportRequest["rights"],
  privacy: NativeEditorAssetImportRequest["privacy"] = "project_local",
): Promise<NativeEditorMediaImportResult> {
  let headRevisionId = identity.expectedHeadRevisionId;
  let revisionNumber = 0;
  const receipts: ImportReceipt[] = [];
  const assets: EditorMediaAsset[] = [];
  for (const file of files) {
    const requestedAt = new Date().toISOString();
    const kinds = fileKind(file);
    if (!kinds) {
      receipts.push({ id: `native-rejected-${requestedAt}-${file.name}`, assetId: `unsupported-${file.name}`, fileName: file.name, status: "failed", requestedAt, completedAt: new Date().toISOString(), byteLength: file.size, mimeType: file.type, errorCode: "UNSUPPORTED_NATIVE_MEDIA", errorMessage: "Use a supported image, video, or audio file.", localOnly: true });
      continue;
    }
    const receipt = await invoke({
      projectId: identity.projectId,
      projectDirectory: identity.projectDirectory,
      expectedHeadRevisionId: headRevisionId,
      kind: kinds.nativeKind,
      filename: file.name,
      mimeType: file.type,
      privacy,
      rights,
      contentBase64: bytesToBase64(await readFileBytes(file)),
    });
    if (receipt.projectId !== identity.projectId || !/^[0-9a-f]{64}$/u.test(receipt.artifact.sha256) || receipt.artifact.state !== "promoted") throw new Error(`Native import returned an invalid receipt for ${file.name}.`);
    headRevisionId = receipt.headRevisionId;
    revisionNumber = receipt.revisionNumber;
    const importReceiptId = `editor-import-${receipt.artifact.id}`;
    receipts.push({ id: importReceiptId, assetId: receipt.artifact.id, fileName: receipt.artifact.originalFilename, status: "ready", requestedAt, completedAt: new Date().toISOString(), byteLength: receipt.artifact.byteSize, mimeType: receipt.artifact.mediaType, localOnly: true });
    assets.push({
      id: receipt.artifact.id,
      name: receipt.artifact.originalFilename,
      kind: kinds.mediaKind,
      status: "ready",
      durationFrames: null,
      mimeType: receipt.artifact.mediaType,
      hash: receipt.artifact.sha256,
      importReceiptId,
      provenance: { origin: "user-import", createdAt: requestedAt, sourceId: receipt.provenance.id, humanApproved: rights.status !== "unknown" },
      metadata: { nativeArtifactId: receipt.artifact.id, exportEligible: receipt.provenance.exportEligible, rightsBlockers: receipt.provenance.blockers.join(" · ") },
    });
  }
  return { receipts, assets, headRevisionId, revisionNumber };
}
