import { describe, expect, it, vi } from "vitest";
const save = vi.hoisted(() => vi.fn());
vi.mock("../native", () => ({ editorDocumentExport: save }));
import { exportNativeEditorDocument } from "../nativeEditorMedia";
import { makeSampleProject } from "../editor/test/fixtures";

describe("native editor interchange documents", () => {
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
