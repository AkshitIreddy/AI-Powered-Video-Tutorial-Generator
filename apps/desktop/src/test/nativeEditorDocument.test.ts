import { describe, expect, it, vi } from "vitest";
const save = vi.hoisted(() => vi.fn());
vi.mock("../native", () => ({ editorDocumentExport: save }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset:${path}` }));
import { exportNativeEditorDocument, resolveNativeEditorMedia } from "../nativeEditorMedia";
import { makeSampleProject } from "../editor/test/fixtures";

describe("native editor interchange documents", () => {
  it("repairs a saved portrait's video classification from verified CAS metadata", async () => {
    const project = makeSampleProject();
    project.assets[0]!.kind = "video";
    project.assets[0]!.hash = "a".repeat(64);
    const resolved = await resolveNativeEditorMedia(project,
      { projectId: "project", projectDirectory: "E:/project" },
      vi.fn().mockResolvedValue({ path: "E:/project/portrait.webp", mediaType: "image/webp", byteSize: 100 }),
    );
    expect(resolved.assets[0]).toMatchObject({ kind: "image", status: "ready", durationFrames: null });
    expect(resolved.assets[0]!.thumbnailUrl).toBe(resolved.assets[0]!.previewUrl);
    expect(project.assets[0]!.kind).toBe("video");
  });

  it.each([
    [String.raw`\\?\E:\media folder\a#b.mp4`, "file:///E:/media%20folder/a%23b.mp4"],
    [String.raw`\\?\UNC\server\share\a b.mp4`, "file://server/share/a%20b.mp4"],
  ])("exports resolved media as portable file URLs: %s", async (path, expected) => {
    const project = makeSampleProject();
    project.assets[0]!.hash = "a".repeat(64);
    project.assets[0]!.uri = "http://asset.localhost/app-only";
    project.assets.push({ ...project.assets[0]!, id: "unused-library-entry", hash: "c".repeat(64) });
    const identity = { projectId: "project", projectDirectory: "E:/project" };
    const resolve = vi.fn().mockResolvedValue({ path, mediaType: "video/mp4", byteSize: 10 });
    save.mockResolvedValue({ path: "E:/project/exports/timeline.otio", sha256: "b".repeat(64), byteSize: 10 });
    await exportNativeEditorDocument(project, "otio", identity, resolve);
    const contents = JSON.parse(save.mock.lastCall![0].contents);
    const reference = contents.tracks.children[0].children[0].media_references.DEFAULT_MEDIA;
    expect(reference.target_url).toBe(expected);
    expect(project.assets[0]!.uri).toBe("http://asset.localhost/app-only");
    expect(resolve).toHaveBeenCalledWith({ ...identity, artifactHash: "a".repeat(64) });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(contents.metadata.alystria_project.assets.at(-1).uri).toBeUndefined();
  });
});
