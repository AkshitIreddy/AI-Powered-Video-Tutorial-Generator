import { convertFileSrc } from "@tauri-apps/api/core";
import { BrowserMediaImportController, exportOtioLike, prepareEditorProjectForPersistence, serializeEditorProject, type EditorImportBatch, type EditorProject } from "./editor";
import { editorDocumentExport, projectAssetImport, projectSnapshotGet, type AssetRightsStatus, type ProjectIdentityRequest } from "./native";

export async function exportNativeEditorDocument(document: EditorProject, format: "editorJson" | "otio", identity: ProjectIdentityRequest, resolve: NativeMediaResolver) {
  const portable = prepareEditorProjectForPersistence(document);
  const usedAssets = new Set(portable.tracks.flatMap((track) => track.clips.flatMap((clip) => clip.assetId ? [clip.assetId] : [])));
  for (const asset of portable.assets) {
    // Library entries are not necessarily imported CAS objects. Keep their
    // identity for relinking without letting unused entries block interchange.
    if (!usedAssets.has(asset.id)) {
      if (asset.uri && /^(asset:|http:\/\/asset\.localhost|blob:)/u.test(asset.uri)) {
        delete asset.uri;
        delete asset.previewUrl;
        delete asset.thumbnailUrl;
        asset.status = "pending";
      }
      continue;
    }
    if (!asset.hash || asset.metadata.browserSessionOnly === true) continue;
    const stored = await resolve({ ...identity, artifactHash: asset.hash });
    let path = stored.path.replace(/^\\\\\?\\UNC\\/u, "//").replace(/^\\\\\?\\/u, "").replace(/\\/gu, "/");
    if (/^[a-z]:\//iu.test(path)) path = `/${path}`;
    if (path.startsWith("//")) path = path.slice(2);
    asset.uri = `file://${path.split("/").map((part, index) => index === 1 && /^[a-z]:$/iu.test(part) ? part : encodeURIComponent(part)).join("/")}`;
    delete asset.previewUrl;
    delete asset.thumbnailUrl;
  }
  return editorDocumentExport({ ...identity, format, contents: format === "otio" ? JSON.stringify(exportOtioLike(portable), null, 2) : serializeEditorProject(portable) });
}

export type NativeMediaResolver = (input: ProjectIdentityRequest & { artifactHash: string }) => Promise<{ path: string; mediaType: string; byteSize: number }>;
export type NativeHeadUpdate = { nativeHeadRevisionId: string; nativeRevisionNumber: number };

/** Persist imported bytes first; only then expose a durable media reference. */
export async function importNativeEditorMedia(
  files: readonly File[],
  identity: ProjectIdentityRequest,
  controller: BrowserMediaImportController,
  rightsStatus: AssetRightsStatus,
  resolve: NativeMediaResolver,
  onHead: (update: NativeHeadUpdate) => void,
): Promise<EditorImportBatch> {
  const batch: EditorImportBatch = { assets: [], receipts: [] };
  for (const file of files) {
    const requestedAt = new Date().toISOString();
    let transientUrl: string | undefined;
    try {
      if (file.size > 64 * 1024 * 1024) throw new Error("Each editor media file must be 64 MiB or smaller.");
      const metadata = await controller.importFiles([file]);
      const asset = metadata.assets[0];
      if (!asset || !["image", "video", "audio"].includes(asset.kind)) throw new Error(metadata.receipts[0]?.errorMessage ?? "Use an image, video, or audio file.");
      transientUrl = asset.previewUrl;
      const durable = await projectSnapshotGet(identity);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
      const permission = rightsStatus === "unknown" ? "unknown" : "allowed";
      const receipt = await projectAssetImport({
        ...identity,
        expectedHeadRevisionId: durable.headRevisionId,
        kind: asset.kind === "image" ? "editorImage" : asset.kind === "video" ? "editorVideo" : "editorAudio",
        filename: file.name, mimeType: file.type || asset.mimeType || "application/octet-stream", privacy: "project_local",
        rights: { status: rightsStatus, commercialUse: permission, redistribution: permission, modelInput: "notAllowed" },
        contentBase64: btoa(binary),
      });
      onHead({ nativeHeadRevisionId: receipt.headRevisionId, nativeRevisionNumber: receipt.revisionNumber });
      const stored = await resolve({ ...identity, artifactHash: receipt.artifact.sha256 });
      const url = convertFileSrc(stored.path);
      const id = receipt.artifact.id;
      batch.assets.push({ ...asset, id, hash: receipt.artifact.sha256, uri: url, previewUrl: url, ...(asset.kind === "image" ? { thumbnailUrl: url } : {}), mimeType: stored.mediaType,
        importReceiptId: `import-${id}`, provenance: { origin: "user-import", createdAt: requestedAt, humanApproved: rightsStatus !== "unknown" },
        metadata: { exportEligible: receipt.provenance.exportEligible, nativeArtifactId: id, browserSessionOnly: false },
      });
      batch.receipts.push({ id: `import-${id}`, assetId: id, fileName: file.name, status: "ready", requestedAt, completedAt: new Date().toISOString(), byteLength: stored.byteSize, mimeType: stored.mediaType, localOnly: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : "Media import failed.";
      batch.receipts.push({ id: `failed-${requestedAt}-${file.name}`, assetId: "", fileName: file.name, status: "failed", requestedAt, completedAt: new Date().toISOString(), errorCode: "NATIVE_IMPORT_FAILED", errorMessage, localOnly: true });
    } finally {
      if (transientUrl) controller.release(transientUrl);
    }
  }
  return batch;
}

export async function resolveNativeEditorMedia(project: EditorProject, identity: ProjectIdentityRequest, resolve: NativeMediaResolver): Promise<EditorProject> {
  const assets = await Promise.all(project.assets.map(async (asset) => {
    if (!asset.hash || asset.metadata.browserSessionOnly === true) return asset;
    try {
      const stored = await resolve({ ...identity, artifactHash: asset.hash });
      const url = convertFileSrc(stored.path);
      // Older project records classified every presenter as video, including
      // still portraits. The verified CAS media type is authoritative.
      const kind = stored.mediaType.startsWith("image/") ? "image" as const
        : stored.mediaType.startsWith("video/") ? "video" as const
          : stored.mediaType.startsWith("audio/") ? "audio" as const : asset.kind;
      return { ...asset, kind, status: "ready" as const, uri: url, previewUrl: url,
        ...(kind === "image" ? { thumbnailUrl: url, durationFrames: null } : {}), mimeType: stored.mediaType };
    } catch {
      const pending = { ...asset, status: "pending" as const, metadata: { ...asset.metadata, requiresRelink: true } };
      delete pending.uri;
      delete pending.previewUrl;
      delete pending.thumbnailUrl;
      return pending;
    }
  }));
  return { ...project, assets };
}
