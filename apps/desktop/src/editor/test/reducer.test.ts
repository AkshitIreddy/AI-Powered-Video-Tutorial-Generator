import { describe, expect, it } from "vitest";
import {
  applyEditOperation,
  applyEditOperations,
  createEditorState,
  editorReducer,
  extractRange,
  findClip,
  liftClips,
  moveClip,
  reorderClip,
  rippleDeleteClips,
  splitClip,
  trimClip,
} from "..";
import { makeProposal, makeSampleProject } from "./fixtures";

describe("timeline operations", () => {
  it("retimes a clip by changing its source playback speed without losing source bounds", () => {
    const project = makeSampleProject();
    const changed = applyEditOperation(project, { type: "update-clip", clipId: "presenter-a", patch: { playbackRate: 2 } });
    expect(changed.changed).toBe(true);
    expect(findClip(changed.project, "presenter-a")?.clip).toMatchObject({ playbackRate: 2, timelineRange: { durationFrames: 90 }, sourceRange: { durationFrames: 180 } });
  });
  it("splits and trims clips while preserving source continuity", () => {
    const project = makeSampleProject();
    const split = splitClip(project, "slide-a", 45, "slide-a-right");
    expect(split.changed).toBe(true);
    expect(findClip(split.project, "slide-a")?.clip.timelineRange.durationFrames).toBe(45);
    expect(findClip(split.project, "slide-a-right")?.clip).toMatchObject({
      timelineRange: { startFrame: 45, durationFrames: 45 },
      sourceRange: { startFrame: 45, durationFrames: 45 },
    });

    const trimmed = trimClip(split.project, "slide-a-right", "start", 50);
    expect(findClip(trimmed.project, "slide-a-right")?.clip).toMatchObject({
      timelineRange: { startFrame: 50, durationFrames: 40 },
      sourceRange: { startFrame: 50, durationFrames: 40 },
    });
  });

  it("snaps moves to nearby edit boundaries", () => {
    const project = makeSampleProject();
    const moved = moveClip(project, "slide-b", "track-slides", 87, { enabled: true, thresholdFrames: 5, playheadFrame: 20 });
    expect(findClip(moved.project, "slide-b")?.clip.timelineRange.startFrame).toBe(90);
  });

  it("blocks cross-role moves and media trims beyond available source", () => {
    const project = makeSampleProject();
    const wrongTrack = moveClip(project, "caption-a", "track-slides", 0, { enabled: false, thresholdFrames: 0 });
    expect(wrongTrack.changed).toBe(false);
    expect(wrongTrack.announcement).toMatch(/caption.*slides/i);

    const overrun = trimClip(project, "presenter-a", "end", 240);
    expect(overrun.changed).toBe(false);
    expect(overrun.announcement).toMatch(/source ends at frame 180/i);
  });

  it("distinguishes lift, ripple delete, and extract", () => {
    const project = makeSampleProject();
    const lifted = liftClips(project, ["slide-a"]);
    expect(findClip(lifted.project, "slide-b")?.clip.timelineRange.startFrame).toBe(90);

    const rippled = rippleDeleteClips(project, ["slide-a"]);
    expect(findClip(rippled.project, "slide-b")?.clip.timelineRange.startFrame).toBe(0);

    const extracted = extractRange(project, { startFrame: 60, durationFrames: 30 });
    expect(findClip(extracted.project, "slide-a")?.clip.timelineRange.durationFrames).toBe(60);
    expect(findClip(extracted.project, "slide-b")?.clip.timelineRange.startFrame).toBe(60);
    expect(findClip(extracted.project, "presenter-a")?.clip).toMatchObject({
      timelineRange: { startFrame: 0, durationFrames: 60 },
      sourceRange: { startFrame: 0, durationFrames: 60 },
    });
    expect(findClip(extracted.project, "presenter-a-extract-60-90")?.clip).toMatchObject({
      timelineRange: { startFrame: 60, durationFrames: 90 },
      sourceRange: { startFrame: 90, durationFrames: 90 },
    });
  });

  it("extracts the middle of spanning media without losing source continuity", () => {
    const project = makeSampleProject();
    const presenter = findClip(project, "presenter-a")!.clip;
    presenter.keyframes = [{ id: "later", property: "opacity", frame: 120, value: 0.5, interpolation: "linear" }];
    project.markers = [
      { id: "inside", frame: 70, label: "Removed", kind: "comment" },
      { id: "after", frame: 120, label: "Keep", kind: "chapter" },
    ];

    const extracted = extractRange(project, { startFrame: 60, durationFrames: 30 });
    expect(findClip(extracted.project, "presenter-a-extract-60-90")?.clip.keyframes[0]?.frame).toBe(90);
    expect(extracted.project.markers).toEqual([{ id: "after", frame: 90, label: "Keep", kind: "chapter" }]);
  });

  it("reorders linked scene clips together across slide, caption, and narration tracks", () => {
    const project = makeSampleProject();
    for (const id of ["slide-a", "caption-a"]) findClip(project, id)!.clip.linkedGroupId = "scene-a";
    for (const id of ["slide-b", "caption-b"]) findClip(project, id)!.clip.linkedGroupId = "scene-b";

    const reordered = reorderClip(project, "slide-b", "previous");
    expect(reordered.changed).toBe(true);
    expect(findClip(reordered.project, "slide-b")?.clip.timelineRange.startFrame).toBe(0);
    expect(findClip(reordered.project, "caption-b")?.clip.timelineRange.startFrame).toBe(0);
    expect(findClip(reordered.project, "slide-a")?.clip.timelineRange.startFrame).toBe(90);
    expect(findClip(reordered.project, "caption-a")?.clip.timelineRange.startFrame).toBe(90);
  });

  it("applies ordered edit operations without mutating the input", () => {
    const project = makeSampleProject();
    const result = applyEditOperations(project, [
      { type: "split-clip", clipId: "slide-a", frame: 30, rightClipId: "slide-a-b" },
      { type: "update-clip", clipId: "slide-a-b", patch: { opacity: 0.5 } },
    ]);
    expect(findClip(result.project, "slide-a-b")?.clip.opacity).toBe(0.5);
    expect(findClip(project, "slide-a-b")).toBeNull();
  });
});

describe("editor reducer history", () => {
  it("records split edits as undoable and redoable versions", () => {
    let state = createEditorState(makeSampleProject());
    state = editorReducer(state, { type: "SELECT_CLIP", clipId: "slide-a" });
    state = editorReducer(state, { type: "SPLIT_SELECTED", frame: 45 });
    expect(state.project.tracks.find((track) => track.kind === "slides")?.clips).toHaveLength(3);
    expect(state.versionIndex).toBe(0);

    state = editorReducer(state, { type: "UNDO" });
    expect(state.project.tracks.find((track) => track.kind === "slides")?.clips).toHaveLength(2);
    expect(state.versionIndex).toBe(-1);

    state = editorReducer(state, { type: "REDO" });
    expect(state.project.tracks.find((track) => track.kind === "slides")?.clips).toHaveLength(3);
  });

  it("stores import receipts and assets without claiming pending media is ready", () => {
    const state = editorReducer(createEditorState(makeSampleProject()), {
      type: "IMPORT_RECEIPTS",
      receipts: [{ id: "receipt-new", assetId: "asset-new", fileName: "new.mp4", status: "pending", requestedAt: "2026-09-02T11:00:00Z", localOnly: true }],
      assets: [{ id: "asset-new", name: "new.mp4", kind: "video", status: "pending", durationFrames: null, provenance: { origin: "user-import", createdAt: "2026-09-02T11:00:00Z" }, metadata: {} }],
    });
    expect(state.project.assets.find((asset) => asset.id === "asset-new")?.status).toBe("pending");
    expect(state.project.importReceipts.find((receipt) => receipt.id === "receipt-new")?.status).toBe("pending");
  });

  it("keeps linked caption and narration text synchronized in one undoable edit", () => {
    const project = makeSampleProject();
    findClip(project, "caption-a")!.clip.linkedGroupId = "scene-a";
    findClip(project, "narration-a")!.clip.linkedGroupId = "scene-a";
    let state = createEditorState(project);
    state = editorReducer(state, { type: "SET_TRANSCRIPT", clipId: "caption-a", text: "A corrected teaching line.", speaker: "Tutor" });
    expect(findClip(state.project, "caption-a")?.clip.text).toBe("A corrected teaching line.");
    expect(findClip(state.project, "narration-a")?.clip.text).toBe("A corrected teaching line.");
    state = editorReducer(state, { type: "UNDO" });
    expect(findClip(state.project, "caption-a")?.clip.text).toBe("Start with the question.");
  });

  it("previews without mutation, applies proposals reversibly, and rejects reversibly", () => {
    const proposal = makeProposal();
    let state = createEditorState(makeSampleProject(), [proposal]);
    const original = structuredClone(state.project);
    state = editorReducer(state, { type: "PREVIEW_PROPOSAL", proposalId: proposal.id });
    expect(state.project).toEqual(original);
    expect(state.proposals[0]?.status).toBe("previewing");

    state = editorReducer(state, { type: "APPLY_PROPOSAL", proposalId: proposal.id });
    expect(findClip(state.project, "title-a")?.clip.text).toBe("What changes?");
    expect(state.proposals[0]?.status).toBe("applied");
    state = editorReducer(state, { type: "UNDO" });
    expect(state.project).toEqual(original);

    state = editorReducer(state, { type: "REJECT_PROPOSAL", proposalId: proposal.id });
    expect(state.proposals[0]?.status).toBe("rejected");
    state = editorReducer(state, { type: "UNDO" });
    expect(state.proposals[0]?.status).toBe("previewing");
  });

  it("applies proposals to a copy without mutating the active project", () => {
    const proposal = makeProposal();
    const initial = createEditorState(makeSampleProject(), [proposal]);
    const state = editorReducer(initial, { type: "APPLY_PROPOSAL_TO_COPY", proposalId: proposal.id, copyId: "copy-1", copyName: "Safe copy" });
    expect(state.project).toEqual(initial.project);
    expect(state.lastCreatedCopy?.id).toBe("copy-1");
    expect(findClip(state.lastCreatedCopy!, "title-a")?.clip.text).toBe("What changes?");
    const undone = editorReducer(state, { type: "UNDO" });
    expect(undone.lastCreatedCopy).toBeNull();
  });
});
