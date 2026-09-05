import { applyEditOperations } from "./operations";
import type { EditOperation, EditProposal, EditorProject, HumanReadableEditDiff } from "./types";

function describeOperation(operation: EditOperation): string {
  switch (operation.type) {
    case "insert-clip": return `Insert “${operation.clip.name}” on track ${operation.trackId} at frame ${operation.clip.timelineRange.startFrame}.`;
    case "remove-clips": return `${operation.ripple ? "Ripple delete" : "Lift"} ${operation.clipIds.length} clip${operation.clipIds.length === 1 ? "" : "s"}.`;
    case "move-clip": return `Move clip ${operation.clipId} to ${operation.trackId} at frame ${operation.startFrame}${operation.snap ? " with snapping" : ""}.`;
    case "reorder-clip": return `Move clip ${operation.clipId} ${operation.direction} in sequence.`;
    case "trim-clip": return `Trim the ${operation.edge} of clip ${operation.clipId} to frame ${operation.frame}.`;
    case "split-clip": return `Split clip ${operation.clipId} at frame ${operation.frame}.`;
    case "update-clip": return `Update ${Object.keys(operation.patch).join(", ") || "properties"} on clip ${operation.clipId}.`;
    case "set-transcript": return `Revise transcript text for clip ${operation.clipId}.`;
    case "add-marker": return `Add “${operation.marker.label}” marker at frame ${operation.marker.frame}.`;
  }
}

function affectedClipIds(operations: readonly EditOperation[]): string[] {
  const ids = operations.flatMap((operation) => {
    switch (operation.type) {
      case "insert-clip": return [operation.clip.id];
      case "remove-clips": return operation.clipIds;
      case "move-clip":
      case "reorder-clip":
      case "trim-clip":
      case "split-clip":
      case "update-clip":
      case "set-transcript": return [operation.clipId];
      case "add-marker": return [];
    }
  });
  return [...new Set(ids)];
}

function affectedTrackIds(project: EditorProject, operations: readonly EditOperation[]): string[] {
  const ids = operations.flatMap((operation) => {
    switch (operation.type) {
      case "insert-clip": return [operation.trackId];
      case "move-clip": return [operation.trackId];
      case "remove-clips": return project.tracks.filter((track) => track.clips.some((clip) => operation.clipIds.includes(clip.id))).map((track) => track.id);
      case "trim-clip":
      case "reorder-clip":
      case "split-clip":
      case "update-clip":
      case "set-transcript": return project.tracks.filter((track) => track.clips.some((clip) => clip.id === operation.clipId)).map((track) => track.id);
      case "add-marker": return [];
    }
  });
  return [...new Set(ids)];
}

export function describeEditProposal(project: EditorProject, proposal: EditProposal): HumanReadableEditDiff {
  const policy = proposal.policyImpact;
  const policySummary = [
    policy.usesCloudData ? "Uses a cloud provider." : "No cloud use declared.",
    policy.sendsSourceMedia ? "Source media may leave this device." : "Source media is not declared for upload.",
    policy.createsGeneratedMedia ? "Creates or inserts generated media." : "Does not claim to generate media.",
    policy.changesAttribution ? "May change attribution or provenance metadata." : "Attribution is unchanged.",
    ...policy.warnings,
  ];
  const provenance = proposal.provenance;
  const model = provenance.modelId ? ` using ${provenance.modelId}${provenance.modelRevision ? ` @ ${provenance.modelRevision}` : ""}` : "";
  const provider = provenance.providerId ? ` via ${provenance.providerId}` : "";
  return {
    proposalId: proposal.id,
    headline: `${proposal.operations.length} proposed edit${proposal.operations.length === 1 ? "" : "s"}: ${proposal.title}`,
    changes: proposal.operations.map(describeOperation),
    affectedClipIds: affectedClipIds(proposal.operations),
    affectedTrackIds: affectedTrackIds(project, proposal.operations),
    policySummary,
    provenanceSummary: `${provenance.source === "ai" ? "AI proposal" : provenance.source === "automation" ? "Automated proposal" : "Human proposal"}${provider}${model}, prepared ${provenance.generatedAt}.`,
  };
}

export function previewEditProposal(project: EditorProject, proposal: EditProposal): { project: EditorProject; diff: HumanReadableEditDiff; applicable: boolean } {
  const applied = applyEditOperations(project, proposal.operations);
  return { project: applied.project, diff: describeEditProposal(project, proposal), applicable: applied.changed };
}

export function applyProposalToCopy(project: EditorProject, proposal: EditProposal, copyId: string, copyName?: string): EditorProject {
  const applied = applyEditOperations(project, proposal.operations);
  return {
    ...applied.project,
    id: copyId,
    name: copyName ?? `${project.name} — ${proposal.title}`,
    createdAt: proposal.provenance.generatedAt,
    updatedAt: proposal.provenance.generatedAt,
    metadata: {
      ...applied.project.metadata,
      derivedFromProjectId: project.id,
      editProposalId: proposal.id,
      proposalRequestId: proposal.provenance.requestId ?? null,
    },
  };
}
