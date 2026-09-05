import { describe, expect, it, vi } from "vitest";
import {
  createBrowserClipFromAsset,
  createEditorSessionPersistence,
  downloadEditorProject,
  parseEditorProject,
  prepareEditorProjectForPersistence,
} from "..";
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
