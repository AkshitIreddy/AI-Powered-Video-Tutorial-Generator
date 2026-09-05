import { describe, expect, it, vi } from "vitest";
import {
  createBrowserClipFromAsset,
  createEditorSessionPersistence,
  downloadEditorProject,
  parseEditorProject,
  prepareEditorProjectForPersistence,
} from "..";
import type { EditorMediaAsset } from "../types";
import { makeSampleProject } from "./fixtures";

describe("browser editor bridge", () => {
  it("persists only validated editor documents", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const bridge = createEditorSessionPersistence(storage, "editor:test");
    bridge.save(makeSampleProject());
    expect(bridge.load()).toEqual(makeSampleProject());
    values.set("editor:test", "{broken");
    expect(() => bridge.load()).toThrow(/could not be parsed/i);
  });

  it("detaches browser-only object URLs before persistence", () => {
    const project = makeSampleProject();
    project.assets[0] = {
      ...project.assets[0]!,
      status: "ready",
      uri: "blob:short-lived-media",
      previewUrl: "blob:short-lived-media",
      thumbnailUrl: "blob:short-lived-media",
      metadata: { browserSessionOnly: true },
    };
    const portable = prepareEditorProjectForPersistence(project);
    expect(portable.assets[0]).toMatchObject({ status: "pending", metadata: { browserPreviewDetached: true } });
    expect(portable.assets[0]).not.toHaveProperty("uri");
    expect(portable.assets[0]).not.toHaveProperty("previewUrl");
    expect(portable.assets[0]).not.toHaveProperty("thumbnailUrl");
  });

  it("creates only track-compatible clips from browser assets", () => {
    const project = makeSampleProject();
    const image = project.assets.find((asset) => asset.kind === "image")!;
    expect(createBrowserClipFromAsset(image, "track-slides", 30, project.frameRate)).toMatchObject({ kind: "slides", timelineRange: { startFrame: 30 } });
    expect(createBrowserClipFromAsset(image, "track-music", 30, project.frameRate)).toBeNull();
  });

  it("preserves video source audio without misclassifying durable imports as browser-only", () => {
    const project = makeSampleProject();
    const durableVideo: EditorMediaAsset = {
      id: "asset-native-video",
      name: "Native lesson.webm",
      kind: "video",
      status: "ready",
      durationFrames: 90,
      uri: "asset://localhost/project-cas/native-lesson.webm",
      mimeType: "video/webm",
      hash: "a".repeat(64),
      provenance: { origin: "user-import", createdAt: "2026-09-05T12:00:00.000Z", humanApproved: true },
      metadata: { nativeArtifactId: "artifact-native-video", exportEligible: true },
    };

    const durableClip = createBrowserClipFromAsset(durableVideo, "track-slides", 0, project.frameRate);
    expect(durableClip?.metadata).toEqual({ includeSourceAudio: true });
    expect(durableClip?.metadata).not.toHaveProperty("browserSessionOnly");

    const browserClip = createBrowserClipFromAsset({
      ...durableVideo,
      id: "asset-browser-video",
      uri: "blob:browser-video",
      previewUrl: "blob:browser-video",
      metadata: { browserSessionOnly: true, requiresNativeProjectImportForPersistence: true },
    }, "track-slides", 0, project.frameRate);
    expect(browserClip?.metadata).toEqual({ browserSessionOnly: true, includeSourceAudio: true });
  });

  it("downloads a parseable project document instead of reporting a toast-only export", () => {
    const createObjectURL = vi.fn(() => "blob:editor-export");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const receipt = downloadEditorProject(makeSampleProject());
    expect(receipt.fileName).toBe("explicit-local-sample.editor.json");
    expect(parseEditorProject(receipt.contents)).toEqual(makeSampleProject());
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith(receipt.url);
  });
});
