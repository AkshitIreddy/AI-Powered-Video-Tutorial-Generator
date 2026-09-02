import { describe, expect, it } from "vitest";
import { EditorProjectFormatError, createEditorProjectFromAlystriaProject, exportOtioLike, formatTimecode, importOtioLike, parseEditorProject, parseTimecode, serializeEditorProject } from "..";
import { makeSampleProject } from "./fixtures";

describe("editor project adapters", () => {
  it("round-trips the serializable project format", () => {
    const project = makeSampleProject();
    expect(parseEditorProject(serializeEditorProject(project))).toEqual(project);
  });

  it("round-trips Alystria metadata through an OTIO-like timeline", () => {
    const project = makeSampleProject();
    const otio = exportOtioLike(project);
    expect(otio.OTIO_SCHEMA).toBe("Timeline.1");
    expect(otio.tracks.children).toHaveLength(7);
    expect(importOtioLike(otio)).toEqual(project);
  });

  it("rejects malformed or duplicate project identities", () => {
    const project = makeSampleProject();
    project.tracks[1]!.id = project.tracks[0]!.id;
    expect(() => serializeEditorProject(project)).toThrow(EditorProjectFormatError);
    expect(() => parseEditorProject("not json")).toThrow(/could not be parsed/i);
  });
});

describe("timecode", () => {
  it("formats and parses frame-accurate timecode", () => {
    const rate = { numerator: 30, denominator: 1 };
    expect(formatTimecode(3723, rate)).toBe("00:02:04:03");
    expect(parseTimecode("00:02:04:03", rate)).toBe(3723);
    expect(parseTimecode("00:00:00:30", rate)).toBeNull();
  });
});

describe("Alystria ProjectRecord adapter", () => {
  it("maps authored scenes and asset references without claiming playable media exists", () => {
    const project = createEditorProjectFromAlystriaProject({
      id: "aly-project",
      title: "Authored tutorial",
      duration: 1,
      privacy: "Local only",
      scenes: [
        { id: "hook", index: 1, title: "Opening question", kind: "title", duration: 12, narration: "Begin with a question.", locked: true },
        { id: "answer", index: 2, title: "Explanation", kind: "diagram", duration: 18, narration: "Now explain the mechanism." },
      ],
      customization: {
        presenter: { assetId: "presenter-ref", placement: "picture-in-picture" },
        audio: { musicAssetId: "music-ref", musicLevel: -14 },
        assets: [
          { id: "presenter-ref", kind: "presenter", label: "Selected presenter", source: "user-upload", rightsStatus: "cleared" },
          { id: "music-ref", kind: "music", label: "Selected music", source: "starter-pack", rightsStatus: "cleared" },
        ],
      },
    }, { now: "2026-09-02T13:00:00Z", frameRate: { numerator: 30, denominator: 1 } });

    expect(project.tracks.find((track) => track.kind === "slides")?.clips).toHaveLength(2);
    expect(project.tracks.find((track) => track.kind === "captions")?.clips[0]?.text).toBe("Begin with a question.");
    expect(project.tracks.find((track) => track.kind === "presenter")?.clips[0]?.assetId).toBe("presenter-ref");
    expect(project.assets.map((asset) => asset.status)).toEqual(["pending", "pending"]);
    expect(project.assets.every((asset) => asset.uri === undefined)).toBe(true);
    expect(project.metadata.adapterNotice).toMatch(/playable media uris must be resolved/i);
  });
});
