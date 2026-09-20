import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  presenterLibraryAddToProject,
  presenterLibraryImport,
  presenterLibraryList,
  presenterLibraryPromote,
  presenterLibraryResolve,
  type PresenterLibraryEntry,
  type PresenterLibraryImportRequest,
  type PresenterLibraryPromoteRequest,
  type PresenterAnimationPreview,
  type JobReceipt,
  type ProjectAssetImportReceipt,
  type ProjectIdentityRequest,
  type SceneRegenerationRequest,
} from "./native";
import type { PresenterChoice } from "./PresenterPicker";
import type { PresenterSelection, StudioAssetReference } from "./types";

export type { PresenterLibraryEntry, PresenterLibrarySource } from "./native";

export interface ResolvedPresenterLibraryEntry extends PresenterLibraryEntry {
  previewUrl: string;
}

export type PresenterLibraryImportInput = PresenterLibraryImportRequest;
export type PresenterLibraryPromoteInput = PresenterLibraryPromoteRequest;

export function presenterAnimationPreviewFromJob(receipt: JobReceipt): PresenterAnimationPreview {
  const value = receipt.result?.preview;
  if (!value || typeof value !== "object") throw new Error("The presenter preview job returned no reviewable video.");
  const preview = value as Partial<PresenterAnimationPreview>;
  const sha256 = /^[0-9a-f]{64}$/u;
  if (
    preview.schemaVersion !== 1
    || typeof preview.id !== "string"
    || preview.status !== "ready"
    || typeof preview.profileId !== "string"
    || typeof preview.portraitArtifactId !== "string"
    || typeof preview.portraitArtifactHash !== "string"
    || !sha256.test(preview.portraitArtifactHash)
    || typeof preview.narrationArtifactHash !== "string"
    || !sha256.test(preview.narrationArtifactHash)
    || typeof preview.outputArtifactHash !== "string"
    || !sha256.test(preview.outputArtifactHash)
    || preview.mediaType !== "video/mp4"
    || typeof preview.byteSize !== "number"
    || preview.byteSize <= 0
    || typeof preview.durationMs !== "number"
    || preview.durationMs < 4_000
    || preview.durationMs > 7_000
    || preview.engineId !== "soulx-flashhead-pro"
    || typeof preview.modelRevision !== "string"
    || !preview.modelRevision.trim()
    || preview.workerContractId !== "alystria.soulx-flashhead.worker.v1"
    || typeof preview.createdAt !== "string"
  ) throw new Error("The presenter preview job returned an invalid provenance receipt.");
  return preview as PresenterAnimationPreview;
}

export interface PresenterLibraryController {
  entries: ResolvedPresenterLibraryEntry[];
  choices: PresenterChoice[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  importPortrait: (input: PresenterLibraryImportInput) => Promise<PresenterLibraryEntry>;
  promoteGeneratedPortrait: (input: PresenterLibraryPromoteInput) => Promise<PresenterLibraryEntry>;
}

export async function materializeLibraryPresenters(
  selection: PresenterSelection,
  project: ProjectIdentityRequest & { headRevisionId: string },
  libraryEntryIds: ReadonlySet<string>,
  importer: typeof presenterLibraryAddToProject = presenterLibraryAddToProject,
): Promise<{ selection: PresenterSelection; headRevisionId: string; revisionNumber?: number; receipts: ProjectAssetImportReceipt[] }> {
  const selectedLibraryIds = [...new Set(selection.presenters
    .map((presenter) => presenter.portraitAssetId)
    .filter((id) => libraryEntryIds.has(id)))];
  if (!selectedLibraryIds.length) return { selection, headRevisionId: project.headRevisionId, receipts: [] };
  let headRevisionId = project.headRevisionId;
  let revisionNumber: number | undefined;
  const receipts: ProjectAssetImportReceipt[] = [];
  const replacements = new Map<string, { presenterId: string; portraitAssetId: string }>();
  const presenterIdReplacements = new Map<string, string>();
  for (const entryId of selectedLibraryIds) {
    const receipt = await importer({
      projectId: project.projectId,
      projectDirectory: project.projectDirectory,
      entryId,
      expectedHeadRevisionId: headRevisionId,
    });
    const profile = receipt.presenterProfile;
    if (!profile) throw new Error("The saved portrait was imported without a presenter profile.");
    receipts.push(receipt);
    headRevisionId = receipt.headRevisionId;
    revisionNumber = receipt.revisionNumber;
    replacements.set(entryId, { presenterId: profile.profileId, portraitAssetId: profile.portraitArtifactId });
    for (const presenter of selection.presenters.filter((item) => item.portraitAssetId === entryId)) {
      presenterIdReplacements.set(presenter.presenterId, profile.profileId);
    }
  }
  return {
    selection: {
      ...selection,
      presenters: selection.presenters.map((presenter) => {
        const replacement = replacements.get(presenter.portraitAssetId);
        return replacement ? { ...presenter, ...replacement } : presenter;
      }),
      sceneAssignments: selection.sceneAssignments.map((assignment) => {
        const replacement = presenterIdReplacements.get(assignment.presenterId);
        return replacement ? { ...assignment, presenterId: replacement } : assignment;
      }),
    },
    headRevisionId,
    ...(revisionNumber === undefined ? {} : { revisionNumber }),
    receipts,
  };
}

export function buildPresenterGenerationRequest(input: ProjectIdentityRequest & {
  headRevisionId: string;
  baseJobId?: string;
  sceneId: string;
  displayName: string;
  prompt: string;
  seed: number;
}): SceneRegenerationRequest {
  return {
    projectId: input.projectId,
    projectDirectory: input.projectDirectory,
    baseRevisionId: input.headRevisionId,
    ...(input.baseJobId ? { baseJobId: input.baseJobId } : {}),
    sceneId: input.sceneId,
    role: "presenter",
    presenterDisplayName: input.displayName.trim(),
    seed: input.seed,
    instruction: `${input.prompt}. Front-facing head and shoulders, centered, unobstructed face, neutral closed resting mouth, no text or watermark.`,
    preservationLocks: ["narration", "citations", "learningobjective", "timing", "assets"],
    alternatives: 3,
  };
}

async function resolveEntry(entry: PresenterLibraryEntry): Promise<ResolvedPresenterLibraryEntry> {
  const receipt = await presenterLibraryResolve(entry.id);
  if (receipt.entryId !== entry.id || receipt.sha256 !== entry.sha256 || receipt.byteSize !== entry.byteSize) {
    throw new Error(`Saved presenter ${entry.displayName} did not resolve to its recorded portrait.`);
  }
  return { ...entry, previewUrl: convertFileSrc(receipt.path) };
}

export function presenterLibraryChoice(entry: ResolvedPresenterLibraryEntry): PresenterChoice {
  return {
    id: entry.id,
    label: entry.displayName,
    src: entry.previewUrl,
    focalPoint: "50% 38%",
    style: entry.source.kind === "generated" ? "Generated custom character" : "Uploaded custom character",
    background: "My presenters",
    styleGroup: "Other",
    filterTags: ["custom", "saved", entry.source.kind],
    portraitArtifactHash: entry.sha256,
    customPortrait: { animationReview: entry.animationReview, source: entry.source.kind, libraryEntryId: entry.id },
  };
}

export function presenterChoicesForProject(
  included: readonly PresenterChoice[],
  entries: readonly ResolvedPresenterLibraryEntry[],
  assets: readonly StudioAssetReference[],
  selection: PresenterSelection,
): PresenterChoice[] {
  const aliases: PresenterChoice[] = [];
  const importedHashes = new Set<string>();
  for (const entry of entries) {
    const asset = assets.find((candidate) => candidate.kind === "presenter" && candidate.sha256 === entry.sha256);
    if (!asset) continue;
    importedHashes.add(entry.sha256);
    const selected = selection.presenters.find((presenter) => presenter.portraitAssetId === asset.id);
    aliases.push({
      ...presenterLibraryChoice(entry),
      id: asset.id,
      presenterId: selected?.presenterId ?? asset.id,
      label: asset.label || entry.displayName,
    });
  }
  return [
    ...included,
    ...entries.filter((entry) => !importedHashes.has(entry.sha256)).map(presenterLibraryChoice),
    ...aliases,
  ];
}

export function useCustomPresenterLibrary(enabled: boolean): PresenterLibraryController {
  const [entries, setEntries] = useState<ResolvedPresenterLibraryEntry[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!enabled) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const listed = await presenterLibraryList();
      setEntries(await Promise.all(listed.map(resolveEntry)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The presenter library could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [enabled]);
  useEffect(() => { void refresh(); }, [refresh]);
  const mutate = useCallback(async (operation: () => Promise<PresenterLibraryEntry>) => {
    setBusy(true);
    setError(null);
    try {
      const entry = await operation();
      await refresh();
      return entry;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The presenter could not be saved.";
      setError(message);
      throw caught;
    } finally {
      setBusy(false);
    }
  }, [refresh]);
  const importPortrait = useCallback((input: PresenterLibraryImportInput) => mutate(() => presenterLibraryImport(input)), [mutate]);
  const promoteGeneratedPortrait = useCallback((input: PresenterLibraryPromoteInput) => mutate(() => presenterLibraryPromote(input)), [mutate]);
  return {
    entries,
    choices: useMemo(() => entries.map(presenterLibraryChoice), [entries]),
    loading,
    busy,
    error,
    refresh,
    importPortrait,
    promoteGeneratedPortrait,
  };
}

export async function fileContentBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}
