import { describe, expect, it } from "vitest";
import { compileEditorRenderManifest } from "..";
import { makeSampleProject } from "./fixtures";

describe("editor render manifest", () => {
  it("compiles one 240 kHz CAS-only native render contract", () => {
    const project = makeSampleProject();
    project.assets = project.assets.map((asset, index) => ({
      ...asset,
      status: "ready",
      hash: String(index + 1).repeat(64),
      metadata: { ...asset.metadata, exportEligible: true, nativeArtifactId: `artifact-${index}` },
    }));
    const compiled = compileEditorRenderManifest(project, { name: "vp9", quality: 24 });
    expect(compiled.blockers).toEqual([]);
    expect(compiled.ready).toBe(true);
    expect(compiled.manifest).toMatchObject({ schema: "alystria.editor.render.v1", timebaseHz: 240000, durationTicks: 1_440_000, codec: { name: "vp9" } });
    expect(compiled.manifest.assets.every((asset) => !asset.artifactHash.includes("blob:"))).toBe(true);
    expect(compiled.manifest.clips.find((clip) => clip.id === "sfx-a")?.audio).toMatchObject({ fadeInTicks: 0, fadeOutTicks: 0 });
  });

  it("compiles motion keyframes to canonical ticks while still blocking browser media and pan", () => {
    const project = makeSampleProject();
    project.assets[0] = { ...project.assets[0]!, hash: "a".repeat(64), status: "ready", metadata: { browserSessionOnly: true } };
    project.tracks[0]!.clips[0]!.keyframes = [{ id: "opacity", property: "opacity", frame: 0, value: 0.5, interpolation: "linear" }];
    project.tracks[0]!.clips[0]!.audio.pan = 0.25;
    const compiled = compileEditorRenderManifest(project);
    expect(compiled.ready).toBe(false);
    expect(compiled.blockers.map((blocker) => blocker.code)).toEqual(expect.arrayContaining(["ASSET_NOT_IN_CAS", "PAN_UNSUPPORTED"]));
    expect(compiled.blockers.map((blocker) => blocker.code)).not.toContain("KEYFRAME_PROPERTY_UNSUPPORTED");
    expect(compiled.manifest.clips[0]!.keyframes).toEqual([{ property: "opacity", timelineTicks: 0, value: 0.5, interpolation: "linear" }]);
  });

  it("blocks a keyframe property that cannot affect its track", () => {
    const project = makeSampleProject();
    project.tracks.find((track) => track.kind === "narration")!.clips[0]!.keyframes = [{ id: "move-audio", property: "transform.x", frame: 0, value: 50, interpolation: "linear" }];
    expect(compileEditorRenderManifest(project).blockers.map((blocker) => blocker.code)).toContain("KEYFRAME_PROPERTY_UNSUPPORTED");
  });

  it("keeps video visuals while applying track mute and solo to their source audio", () => {
    const project = makeSampleProject();
    project.assets = project.assets.map((asset, index) => ({
      ...asset,
      status: "ready",
      hash: String(index + 1).repeat(64),
      metadata: { ...asset.metadata, exportEligible: true, nativeArtifactId: `artifact-${index}` },
    }));
    const slideAsset = project.assets.find((asset) => asset.id === "asset-slide-a")!;
    slideAsset.kind = "video";
    slideAsset.mimeType = "video/webm";
    const slideTrack = project.tracks.find((track) => track.kind === "slides")!;
    slideTrack.clips[0]!.metadata.includeSourceAudio = true;
    const narrationTrack = project.tracks.find((track) => track.kind === "narration")!;
    narrationTrack.clips[0]!.keyframes = [{ id: "narration-gain", property: "audio.volumeDb", frame: 0, value: -3, interpolation: "linear" }];

    narrationTrack.solo = true;
    let manifest = compileEditorRenderManifest(project).manifest;
    expect(manifest.clips.find((clip) => clip.id === "slide-a")?.audio.muted).toBe(true);
    expect(manifest.clips.find((clip) => clip.id === "slide-a")?.includeSourceAudio).toBeUndefined();

    narrationTrack.solo = false;
    slideTrack.solo = true;
    manifest = compileEditorRenderManifest(project).manifest;
    expect(manifest.clips.find((clip) => clip.id === "slide-a")?.audio.muted).toBe(false);
    expect(manifest.clips.find((clip) => clip.id === "slide-a")?.includeSourceAudio).toBe(true);
    expect(manifest.clips.some((clip) => clip.id === "narration-a")).toBe(false);

    slideTrack.solo = false;
    manifest = compileEditorRenderManifest(project).manifest;
    expect(manifest.clips.find((clip) => clip.id === "narration-a")?.keyframes).toEqual([
      { property: "audio.volumeDb", timelineTicks: 0, value: -3, interpolation: "linear" },
    ]);

    slideTrack.muted = true;
    manifest = compileEditorRenderManifest(project).manifest;
    expect(manifest.clips.find((clip) => clip.id === "slide-a")?.audio.muted).toBe(true);
    expect(manifest.clips.find((clip) => clip.id === "slide-a")?.includeSourceAudio).toBeUndefined();
  });
});
