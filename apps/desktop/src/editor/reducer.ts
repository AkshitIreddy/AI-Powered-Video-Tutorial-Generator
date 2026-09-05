import { createEditorState, findClip, selectedClips } from "./model";
import {
  addKeyframe,
  applyEditOperations,
  extractRange,
  insertClip,
  liftClips,
  moveClip,
  reorderClip,
  removeKeyframe,
  rippleDeleteClips,
  snapFrame,
  splitClip,
  trimClip,
  updateClip,
  updateKeyframe,
  updateLinkedTranscript,
} from "./operations";
import { applyProposalToCopy } from "./proposals";
import { rateAsNumber } from "./timecode";
import type { EditorAction, EditorDocumentSnapshot, EditorProject, EditorState, EditorVersion, ImportReceipt } from "./types";

function snapshot(state: EditorState): EditorDocumentSnapshot {
  return { project: structuredClone(state.project), proposals: structuredClone(state.proposals), lastCreatedCopy: structuredClone(state.lastCreatedCopy) };
}

function commitDocument(
  state: EditorState,
  next: EditorDocumentSnapshot,
  label: string,
  transactionKind: EditorVersion["transactionKind"],
  announcement: string,
  at = state.project.updatedAt,
): EditorState {
  const before = snapshot(state);
  if (JSON.stringify(before) === JSON.stringify(next)) return { ...state, announcement };
  const nextRevision = state.revision + 1;
  const after = structuredClone(next);
  after.project.updatedAt = at;
  const version: EditorVersion = {
    id: `editor-version-${nextRevision}`,
    label,
    createdAt: at,
    transactionKind,
    before,
    after: structuredClone(after),
  };
  const versions = [...state.versions.slice(0, state.versionIndex + 1), version];
  return {
    ...state,
    ...after,
    versions,
    versionIndex: versions.length - 1,
    revision: nextRevision,
    announcement,
  };
}

function commitProject(state: EditorState, project: EditorProject, label: string, kind: EditorVersion["transactionKind"], announcement: string): EditorState {
  return commitDocument(state, { project, proposals: state.proposals, lastCreatedCopy: state.lastCreatedCopy }, label, kind, announcement);
}

function selectedRange(state: EditorState): { startFrame: number; durationFrames: number } | null {
  const clips = selectedClips(state);
  if (!clips.length) return null;
  const startFrame = Math.min(...clips.map((clip) => clip.timelineRange.startFrame));
  const endFrame = Math.max(...clips.map((clip) => clip.timelineRange.startFrame + clip.timelineRange.durationFrames));
  return { startFrame, durationFrames: endFrame - startFrame };
}

function receiptAssetState(status: ImportReceipt["status"]): "pending" | "ready" | "failed" | "cancelled" {
  return status;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "SELECT_CLIP": {
      const match = findClip(state.project, action.clipId);
      if (!match) return { ...state, announcement: "Clip not found." };
      const clipIds = action.additive
        ? state.selection.clipIds.includes(action.clipId)
          ? state.selection.clipIds.filter((id) => id !== action.clipId)
          : [...state.selection.clipIds, action.clipId]
        : [action.clipId];
      return { ...state, selection: { clipIds, trackId: match.track.id, assetId: match.clip.assetId }, announcement: `${match.clip.name} selected.` };
    }
    case "SELECT_TRACK":
      return { ...state, selection: { clipIds: [], trackId: action.trackId, assetId: null }, announcement: "Track selected." };
    case "SELECT_ASSET":
      return { ...state, selection: { clipIds: [], trackId: state.selection.trackId, assetId: action.assetId }, announcement: "Media asset selected." };
    case "CLEAR_SELECTION":
      return { ...state, selection: { ...state.selection, clipIds: [], assetId: null }, announcement: "Selection cleared." };
    case "SET_PLAYHEAD": {
      const frame = action.snap && state.view.snappingEnabled
        ? snapFrame(state.project, action.frame, state.view.snapThresholdFrames)
        : Math.max(0, Math.min(state.project.durationFrames, Math.round(action.frame)));
      return { ...state, transport: { ...state.transport, playheadFrame: frame }, announcement: `Playhead at frame ${frame}.` };
    }
    case "SET_IN_POINT":
      return { ...state, transport: { ...state.transport, inFrame: action.frame ?? state.transport.playheadFrame }, announcement: "In point set." };
    case "SET_OUT_POINT":
      return { ...state, transport: { ...state.transport, outFrame: action.frame ?? state.transport.playheadFrame }, announcement: "Out point set." };
    case "TRANSPORT_PLAY":
      return { ...state, transport: { ...state.transport, status: "playing" }, announcement: "Playback started." };
    case "TRANSPORT_PAUSE":
      return { ...state, transport: { ...state.transport, status: "paused" }, announcement: "Playback paused." };
    case "TRANSPORT_STOP":
      return { ...state, transport: { ...state.transport, status: "stopped", playheadFrame: state.transport.inFrame ?? 0 }, announcement: "Playback stopped." };
    case "TRANSPORT_TOGGLE":
      return editorReducer(state, { type: state.transport.status === "playing" ? "TRANSPORT_PAUSE" : "TRANSPORT_PLAY" });
    case "TRANSPORT_TICK": {
      if (state.transport.status !== "playing") return state;
      const boundary = state.transport.outFrame ?? state.project.durationFrames;
      const next = state.transport.playheadFrame + Math.max(0, Math.round(action.elapsedSeconds * rateAsNumber(state.project.frameRate) * state.transport.playbackRate));
      if (next < boundary) return { ...state, transport: { ...state.transport, playheadFrame: next } };
      if (state.transport.loop) return { ...state, transport: { ...state.transport, playheadFrame: state.transport.inFrame ?? 0 } };
      return { ...state, transport: { ...state.transport, playheadFrame: boundary, status: "paused" }, announcement: "Playback reached the end." };
    }
    case "SET_PLAYBACK_RATE":
      return { ...state, transport: { ...state.transport, playbackRate: Math.min(4, Math.max(0.25, action.rate)) }, announcement: "Playback rate changed." };
    case "TOGGLE_LOOP":
      return { ...state, transport: { ...state.transport, loop: !state.transport.loop }, announcement: state.transport.loop ? "Loop disabled." : "Loop enabled." };
    case "SET_ZOOM":
      return { ...state, view: { ...state.view, pixelsPerSecond: Math.min(400, Math.max(12, action.pixelsPerSecond)) } };
    case "SET_ACTIVE_PANEL":
      return { ...state, view: { ...state.view, activePanel: action.panel } };
    case "TOGGLE_GUIDE":
      return { ...state, view: { ...state.view, guides: state.view.guides.includes(action.guide) ? state.view.guides.filter((guide) => guide !== action.guide) : [...state.view.guides, action.guide] } };
    case "TOGGLE_SNAPPING":
      return { ...state, view: { ...state.view, snappingEnabled: !state.view.snappingEnabled }, announcement: state.view.snappingEnabled ? "Snapping disabled." : "Snapping enabled." };
    case "TOGGLE_RIPPLE":
      return { ...state, view: { ...state.view, rippleEnabled: !state.view.rippleEnabled }, announcement: state.view.rippleEnabled ? "Ripple mode disabled." : "Ripple mode enabled." };
    case "UPDATE_TRACK": {
      const track = state.project.tracks.find((candidate) => candidate.id === action.trackId);
      if (!track) return { ...state, announcement: "Track not found." };
      const project = { ...state.project, tracks: state.project.tracks.map((candidate) => candidate.id === action.trackId ? { ...candidate, ...action.patch } : candidate) };
      return commitProject(state, project, `Update ${track.name}`, "edit", `${track.name} updated.`);
    }
    case "IMPORT_RECEIPTS": {
      const receiptIds = new Set(action.receipts.map((receipt) => receipt.id));
      const assetIds = new Set(action.assets.map((asset) => asset.id));
      const project = {
        ...state.project,
        importReceipts: [...state.project.importReceipts.filter((receipt) => !receiptIds.has(receipt.id)), ...structuredClone(action.receipts)],
        assets: [...state.project.assets.filter((asset) => !assetIds.has(asset.id)), ...structuredClone(action.assets)],
      };
      return commitProject(state, project, "Import media", "import", `${action.receipts.length} media import${action.receipts.length === 1 ? "" : "s"} received.`);
    }
    case "UPDATE_IMPORT_RECEIPT": {
      const project = {
        ...state.project,
        importReceipts: [...state.project.importReceipts.filter((receipt) => receipt.id !== action.receipt.id), structuredClone(action.receipt)],
        assets: action.asset ? state.project.assets.map((asset) => asset.id === action.asset?.id ? { ...structuredClone(action.asset), status: receiptAssetState(action.receipt.status) } : asset) : state.project.assets,
      };
      return commitProject(state, project, "Update media import", "import", `Import ${action.receipt.status}: ${action.receipt.fileName}.`);
    }
    case "INSERT_CLIP": {
      const edit = insertClip(state.project, action.trackId, action.clip);
      return edit.changed ? commitProject(state, edit.project, "Insert clip", "edit", edit.announcement) : { ...state, announcement: edit.announcement };
    }
    case "MOVE_CLIP": {
      const edit = moveClip(state.project, action.clipId, action.trackId, action.startFrame, { enabled: action.snap ?? state.view.snappingEnabled, thresholdFrames: state.view.snapThresholdFrames, playheadFrame: state.transport.playheadFrame });
      return edit.changed ? commitProject(state, edit.project, "Move clip", "edit", edit.announcement) : { ...state, announcement: edit.announcement };
    }
    case "REORDER_CLIP": {
      const edit = reorderClip(state.project, action.clipId, action.direction);
      return edit.changed ? commitProject(state, edit.project, "Reorder clip", "edit", edit.announcement) : { ...state, announcement: edit.announcement };
    }
    case "SPLIT_SELECTED": {
      const frame = action.frame ?? state.transport.playheadFrame;
      let project = state.project;
      let count = 0;
      for (const clipId of state.selection.clipIds) {
        const id = `${clipId}-split-${frame}-${state.revision + count + 1}`;
        const edit = splitClip(project, clipId, frame, id);
        if (edit.changed) { project = edit.project; count += 1; }
      }
      return count ? commitProject(state, project, "Split clips", "edit", `${count} clip${count === 1 ? "" : "s"} split.`) : { ...state, announcement: "No selected clip crosses the playhead." };
    }
    case "TRIM_CLIP": {
      const edit = trimClip(state.project, action.clipId, action.edge, action.frame);
      return edit.changed ? commitProject(state, edit.project, "Trim clip", "edit", edit.announcement) : { ...state, announcement: edit.announcement };
    }
    case "LIFT_SELECTED": {
      const edit = liftClips(state.project, state.selection.clipIds);
      const next = edit.changed ? commitProject(state, edit.project, "Lift clips", "edit", edit.announcement) : { ...state, announcement: edit.announcement };
      return edit.changed ? { ...next, selection: { ...next.selection, clipIds: [] } } : next;
    }
    case "RIPPLE_DELETE_SELECTED": {
      const edit = rippleDeleteClips(state.project, state.selection.clipIds);
      const next = edit.changed ? commitProject(state, edit.project, "Ripple delete", "edit", edit.announcement) : { ...state, announcement: edit.announcement };
      return edit.changed ? { ...next, selection: { ...next.selection, clipIds: [] } } : next;
    }
    case "EXTRACT_SELECTED_RANGE": {
      const range = selectedRange(state);
      if (!range) return { ...state, announcement: "Select clips to define an extract range." };
      const edit = extractRange(state.project, range);
      const next = edit.changed ? commitProject(state, edit.project, "Extract range", "edit", edit.announcement) : { ...state, announcement: edit.announcement };
      return edit.changed ? { ...next, selection: { ...next.selection, clipIds: [] } } : next;
    }
    case "UPDATE_SELECTED_CLIP": {
      let project = state.project;
      let changed = 0;
      for (const clipId of state.selection.clipIds) {
        const edit = updateClip(project, clipId, action.patch);
        if (edit.changed) { project = edit.project; changed += 1; }
      }
      return changed ? commitProject(state, project, action.label ?? "Update clip", "inspector", `${changed} selected clip${changed === 1 ? "" : "s"} updated.`) : { ...state, announcement: "No editable clips selected." };
    }
    case "ADD_KEYFRAME": {
      const edit = addKeyframe(state.project, action.clipId, action.keyframe);
      return edit.changed ? commitProject(state, edit.project, "Add keyframe", "inspector", edit.announcement) : { ...state, announcement: edit.announcement };
    }
    case "UPDATE_KEYFRAME": {
      const edit = updateKeyframe(state.project, action.clipId, action.keyframeId, action.patch);
      return edit.changed ? commitProject(state, edit.project, "Update keyframe", "inspector", edit.announcement) : { ...state, announcement: edit.announcement };
    }
    case "REMOVE_KEYFRAME": {
      const edit = removeKeyframe(state.project, action.clipId, action.keyframeId);
      return edit.changed ? commitProject(state, edit.project, "Remove keyframe", "inspector", edit.announcement) : { ...state, announcement: edit.announcement };
    }
    case "SET_TRANSCRIPT": {
      const edit = updateLinkedTranscript(state.project, action.clipId, action.text, action.speaker);
      return edit.changed ? commitProject(state, edit.project, "Edit transcript", "transcript", edit.announcement) : { ...state, announcement: edit.announcement };
    }
    case "ADD_PROPOSALS": {
      const ids = new Set(action.proposals.map((proposal) => proposal.id));
      return { ...state, proposals: [...state.proposals.filter((proposal) => !ids.has(proposal.id)), ...structuredClone(action.proposals)], announcement: `${action.proposals.length} edit proposal${action.proposals.length === 1 ? "" : "s"} added for review.` };
    }
    case "PREVIEW_PROPOSAL": {
      if (!state.proposals.some((proposal) => proposal.id === action.proposalId)) return { ...state, announcement: "Proposal not found." };
      return { ...state, activeProposalId: action.proposalId, proposals: state.proposals.map((proposal) => proposal.id === action.proposalId ? { ...proposal, status: "previewing" } : proposal), announcement: "Proposal preview opened. The timeline is unchanged." };
    }
    case "APPLY_PROPOSAL": {
      const proposal = state.proposals.find((candidate) => candidate.id === action.proposalId);
      if (!proposal) return { ...state, announcement: "Proposal not found." };
      const edit = applyEditOperations(state.project, proposal.operations);
      if (!edit.changed) return { ...state, announcement: "Proposal contains no applicable edits." };
      const proposals = state.proposals.map((candidate) => candidate.id === proposal.id ? { ...candidate, status: "applied" as const } : candidate);
      return commitDocument(state, { project: edit.project, proposals, lastCreatedCopy: state.lastCreatedCopy }, `Apply proposal: ${proposal.title}`, "proposal", `${proposal.title} applied as a reversible transaction.`, proposal.provenance.generatedAt);
    }
    case "APPLY_PROPOSAL_TO_COPY": {
      const proposal = state.proposals.find((candidate) => candidate.id === action.proposalId);
      if (!proposal) return { ...state, announcement: "Proposal not found." };
      const copy = applyProposalToCopy(state.project, proposal, action.copyId, action.copyName);
      const proposals = state.proposals.map((candidate) => candidate.id === proposal.id ? { ...candidate, status: "applied-to-copy" as const } : candidate);
      return commitDocument(state, { project: state.project, proposals, lastCreatedCopy: copy }, `Apply proposal to copy: ${proposal.title}`, "proposal", `${proposal.title} applied to a new project copy.`, proposal.provenance.generatedAt);
    }
    case "REJECT_PROPOSAL": {
      const proposal = state.proposals.find((candidate) => candidate.id === action.proposalId);
      if (!proposal) return { ...state, announcement: "Proposal not found." };
      const proposals = state.proposals.map((candidate) => candidate.id === proposal.id ? { ...candidate, status: "rejected" as const } : candidate);
      return commitDocument(state, { project: state.project, proposals, lastCreatedCopy: state.lastCreatedCopy }, `Reject proposal: ${proposal.title}`, "proposal", `${proposal.title} rejected. Undo is available.`, proposal.provenance.generatedAt);
    }
    case "UNDO": {
      if (state.versionIndex < 0) return { ...state, announcement: "Nothing to undo." };
      const version = state.versions[state.versionIndex];
      if (!version) return state;
      return { ...state, ...structuredClone(version.before), versionIndex: state.versionIndex - 1, revision: state.revision + 1, activeProposalId: null, announcement: `Undid ${version.label}.` };
    }
    case "REDO": {
      const version = state.versions[state.versionIndex + 1];
      if (!version) return { ...state, announcement: "Nothing to redo." };
      return { ...state, ...structuredClone(version.after), versionIndex: state.versionIndex + 1, revision: state.revision + 1, activeProposalId: null, announcement: `Redid ${version.label}.` };
    }
    case "REPLACE_PROJECT": {
      const replacement = createEditorState(action.project, state.proposals).project;
      return commitProject(state, replacement, "Import editor project", "edit", `${replacement.name} imported.`);
    }
    case "CLEAR_ANNOUNCEMENT":
      return { ...state, announcement: "" };
  }
}
