import { defaultClipValues } from "./model";
import { exportOtioLike, parseEditorProject, serializeEditorProject } from "./otio";
import { secondsToFrames } from "./timecode";
import type { EditorClip, EditorImportBatch, EditorMediaAsset, EditorProject, FrameRate, ImportReceipt, MediaKind, OtioLikeTimeline, TrackKind } from "./types";

export interface EditorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface EditorSessionPersistence {
  key: string;
  load(): EditorProject | null;
  save(project: EditorProject): void;
  clear(): void;
}

export interface EditorDownloadReceipt {
  fileName: string;
  mimeType: string;
  contents: string;
  url: string;
}

/**
 * Browser object URLs expire with the document that created them. Remove those
 * URLs before saving or downloading while retaining the asset identity and
 * provenance needed to relink the media later.
 */
export function prepareEditorProjectForPersistence(project: EditorProject): EditorProject {
  const portable = structuredClone(project);
  portable.assets = portable.assets.map((asset) => {
    if (asset.metadata.browserSessionOnly !== true) return asset;
    const detached: EditorMediaAsset = {
      ...asset,
      status: "pending",
      metadata: {
        ...asset.metadata,
        browserPreviewDetached: true,
        requiresNativeProjectImportForPersistence: true,
      },
    };
    delete detached.uri;
    delete detached.previewUrl;
    delete detached.thumbnailUrl;
    return detached;
  });
  return parseEditorProject(serializeEditorProject(portable, false));
}

function safeFileStem(name: string): string {
  const stem = name.trim().toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return stem || "video-project";
}

function downloadText(contents: string, fileName: string, mimeType: string): EditorDownloadReceipt {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("This environment cannot start a local file download.");
  }
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
  return { fileName, mimeType, contents, url };
}

export function downloadEditorProject(project: EditorProject, fileName = `${safeFileStem(project.name)}.editor.json`): EditorDownloadReceipt {
  return downloadText(serializeEditorProject(prepareEditorProjectForPersistence(project)), fileName, "application/json");
}

export function downloadOtioTimeline(timeline: OtioLikeTimeline, project: EditorProject, fileName = `${safeFileStem(project.name)}.otio`): EditorDownloadReceipt {
  const hasBrowserOnlyMedia = project.assets.some((asset) => asset.metadata.browserSessionOnly === true);
  const portableTimeline = hasBrowserOnlyMedia ? exportOtioLike(prepareEditorProjectForPersistence(project)) : timeline;
  return downloadText(JSON.stringify(portableTimeline, null, 2), fileName, "application/vnd.opentimelineio+json");
}

export function createEditorSessionPersistence(storage: EditorStorage, key: string): EditorSessionPersistence {
  if (!key.trim()) throw new Error("Editor persistence requires a non-empty key.");
  return {
    key,
    load: () => {
      const serialized = storage.getItem(key);
      return serialized === null ? null : parseEditorProject(serialized);
    },
    save: (project) => storage.setItem(key, serializeEditorProject(prepareEditorProjectForPersistence(project), false)),
    clear: () => storage.removeItem(key),
  };
}

function mediaKind(file: File): MediaKind {
  const [family] = file.type.toLocaleLowerCase("en-US").split("/");
  if (family === "image" || family === "video" || family === "audio") return family;
  if (/\.(srt|vtt)$/iu.test(file.name)) return "caption";
  return "unknown";
}

async function sha256(file: File): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function mediaDuration(url: string, kind: MediaKind, frameRate: FrameRate): Promise<{ durationFrames: number | null; width?: number; height?: number }> {
  if ((kind !== "video" && kind !== "audio") || typeof document === "undefined") return Promise.resolve({ durationFrames: null });
  return new Promise((resolve, reject) => {
    const element = document.createElement(kind);
    const timeout = window.setTimeout(() => reject(new Error("Media metadata did not load in time.")), 10_000);
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      const durationFrames = Number.isFinite(element.duration) ? Math.max(1, secondsToFrames(element.duration, frameRate)) : null;
      resolve({ durationFrames, ...(element instanceof HTMLVideoElement ? { width: element.videoWidth, height: element.videoHeight } : {}) });
    };
    element.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("The browser could not read this media file."));
    };
    element.src = url;
  });
}

export class BrowserMediaImportController {
  readonly #urls = new Set<string>();
  readonly #frameRate: FrameRate;
  readonly #now: () => string;

  constructor(frameRate: FrameRate, now: () => string = () => new Date().toISOString()) {
    this.#frameRate = frameRate;
    this.#now = now;
  }

  async importFiles(files: readonly File[]): Promise<EditorImportBatch> {
    const receipts: ImportReceipt[] = [];
    const assets: EditorMediaAsset[] = [];
    for (const file of files) {
      const requestedAt = this.#now();
      const kind = mediaKind(file);
      const suffix = `${requestedAt}-${file.name}-${file.size}`;
      const hash = await sha256(file);
      const id = `browser-asset-${hash?.slice(0, 20) ?? safeFileStem(suffix)}`;
      const receiptId = `browser-receipt-${hash?.slice(0, 20) ?? safeFileStem(suffix)}`;
      if (kind === "unknown" || kind === "caption") {
        receipts.push({ id: receiptId, assetId: id, fileName: file.name, status: "failed", requestedAt, completedAt: this.#now(), byteLength: file.size, mimeType: file.type, errorCode: "UNSUPPORTED_BROWSER_MEDIA", errorMessage: "Use an image, video, or audio file. Caption file import needs the native caption pipeline.", localOnly: true });
        continue;
      }
      const url = URL.createObjectURL(file);
      this.#urls.add(url);
      try {
        const metadata = await mediaDuration(url, kind, this.#frameRate);
        receipts.push({ id: receiptId, assetId: id, fileName: file.name, status: "ready", requestedAt, completedAt: this.#now(), byteLength: file.size, mimeType: file.type, localOnly: true });
        assets.push({
          id,
          name: file.name,
          kind,
          status: "ready",
          durationFrames: metadata.durationFrames,
          ...(metadata.width ? { width: metadata.width } : {}),
          ...(metadata.height ? { height: metadata.height } : {}),
          uri: url,
          previewUrl: url,
          ...(kind === "image" ? { thumbnailUrl: url } : {}),
          mimeType: file.type,
          ...(hash ? { hash } : {}),
          importReceiptId: receiptId,
          provenance: { origin: "user-import", createdAt: requestedAt, humanApproved: false },
          metadata: { browserSessionOnly: true, requiresNativeProjectImportForPersistence: true },
        });
      } catch (error) {
        this.release(url);
        receipts.push({ id: receiptId, assetId: id, fileName: file.name, status: "failed", requestedAt, completedAt: this.#now(), byteLength: file.size, mimeType: file.type, errorCode: "MEDIA_METADATA_FAILED", errorMessage: error instanceof Error ? error.message : "Media metadata could not be read.", localOnly: true });
      }
    }
    return { receipts, assets };
  }

  release(url: string): void {
    if (!this.#urls.delete(url)) return;
    URL.revokeObjectURL(url);
  }

  dispose(): void {
    for (const url of this.#urls) URL.revokeObjectURL(url);
    this.#urls.clear();
  }
}

const compatibleAssetKinds: Partial<Record<TrackKind, readonly MediaKind[]>> = {
  slides: ["image", "video"],
  presenter: ["image", "video"],
  narration: ["audio"],
  music: ["audio"],
  sfx: ["audio"],
};

export function createBrowserClipFromAsset(asset: EditorMediaAsset, trackId: string, startFrame: number, frameRate: FrameRate): EditorClip | null {
  const kind = trackId.replace(/^track-/u, "") as TrackKind;
  if (!compatibleAssetKinds[kind]?.includes(asset.kind) || asset.status !== "ready" || (!asset.previewUrl && !asset.uri)) return null;
  const durationFrames = asset.durationFrames ?? secondsToFrames(asset.kind === "image" ? 5 : 3, frameRate);
  const metadata: EditorClip["metadata"] = {
    ...(asset.metadata.browserSessionOnly === true ? { browserSessionOnly: true } : {}),
    ...(asset.kind === "video" ? { includeSourceAudio: true } : {}),
  };
  return {
    id: `clip-${asset.id}-${Math.max(0, Math.round(startFrame))}`,
    trackId,
    kind,
    name: asset.name,
    assetId: asset.id,
    timelineRange: { startFrame: Math.max(0, Math.round(startFrame)), durationFrames },
    sourceRange: { startFrame: 0, durationFrames },
    ...defaultClipValues(),
    metadata,
  };
}
