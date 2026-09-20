import type { EditorProject } from "./editor";

export interface EditorSaveIdentity {
  projectKey: string;
  projectId: string;
  projectDirectory: string;
}

export interface DurableEditorSnapshot {
  headRevisionId: string;
  revisionNumber: number;
  snapshot: Record<string, unknown>;
}

export interface DurableEditorSaveReceipt extends DurableEditorSnapshot {
  projectId: string;
}

export interface ProjectActionSnapshotCapture {
  version: number;
  snapshot: Record<string, unknown>;
}

export interface PendingProjectAutosave {
  timer: number;
  version: number;
}

export interface ProjectActionSnapshotDependencies<TReceipt extends DurableEditorSaveReceipt = DurableEditorSaveReceipt> {
  runSerialized: <T>(operation: () => Promise<T>) => Promise<T>;
  getSnapshot: () => Promise<DurableEditorSnapshot>;
  saveSnapshot: (input: {
    expectedHeadRevisionId: string;
    snapshot: Record<string, unknown>;
  }) => Promise<TReceipt>;
  markDurable: (version: number, receipt: TReceipt) => void;
}

export type EditorSaveStatus =
  | { phase: "saving"; detail: string }
  | { phase: "saved"; detail: string }
  | { phase: "error"; detail: string };

interface EditorSaveEntry extends EditorSaveIdentity {
  latest: EditorProject;
  version: number;
  persistedVersion: number;
  timer?: ReturnType<typeof setTimeout>;
  inFlight?: Promise<DurableEditorSaveReceipt>;
}

export interface EditorDocumentSaveQueueDependencies {
  load: (identity: Omit<EditorSaveIdentity, "projectKey">) => Promise<DurableEditorSnapshot>;
  save: (input: Omit<EditorSaveIdentity, "projectKey"> & {
    expectedHeadRevisionId: string;
    snapshot: Record<string, unknown>;
  }) => Promise<DurableEditorSaveReceipt>;
  validate: (document: EditorProject) => EditorProject;
  onStatus: (projectKey: string, status: EditorSaveStatus) => void;
  onSaved: (projectKey: string, receipt: DurableEditorSaveReceipt) => void;
  isRevisionConflict?: (error: unknown) => boolean;
  delayMs?: number;
}

export interface CloseRequestLike {
  preventDefault: () => void;
}

export function createEditorCloseHandler(input: {
  flush: () => Promise<void>;
  shutdown: () => Promise<void>;
  onError: (error: unknown) => void;
}): (event: CloseRequestLike) => Promise<void> {
  let closing = false;
  return async (event) => {
    event.preventDefault();
    if (closing) return;
    closing = true;
    try {
      await input.flush();
      await input.shutdown();
    } catch (error) {
      closing = false;
      input.onError(error);
    }
  };
}

function defaultRevisionConflict(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.includes("REVISION_CONFLICT");
}

export function mergeGeneralProjectSnapshot(
  durable: Record<string, unknown>,
  captured: Record<string, unknown>,
): Record<string, unknown> {
  const capturedGenerationId = typeof captured.nativeGenerationId === "string"
    ? captured.nativeGenerationId
    : typeof captured.generationId === "string" ? captured.generationId : null;
  const durableGenerationId = typeof durable.generationId === "string"
    ? durable.generationId
    : typeof durable.nativeGenerationId === "string" ? durable.nativeGenerationId : null;
  if ((capturedGenerationId || durableGenerationId) && capturedGenerationId !== durableGenerationId) {
    throw new Error("PROJECT_EDIT_CONFLICT: This tutorial belongs to a newer generation. Reopen it before saving these edits.");
  }

  const merged: Record<string, unknown> = { ...durable };
  if (Array.isArray(captured.scenes)) merged.scenes = structuredClone(captured.scenes);
  if (captured.creative !== undefined) merged.creative = structuredClone(captured.creative);
  if (captured.reviewNotes !== undefined) merged.reviewNotes = captured.reviewNotes;
  if (typeof captured.updatedAt === "string") merged.updatedAt = captured.updatedAt;
  if (captured.presenterSelection !== undefined) {
    merged.presenterSelection = structuredClone(captured.presenterSelection);
    // Cast edits also change the presenter preview. Keep newer durable canvas
    // settings, and do not overwrite them during unrelated prose autosaves.
    if (JSON.stringify(captured.presenterSelection) !== JSON.stringify(durable.presenterSelection)) {
      const presenter = objectRecord(captured.customization)?.presenter;
      if (presenter !== undefined) {
        merged.customization = { ...objectRecord(durable.customization), presenter: structuredClone(presenter) };
      }
    }
  }

  const durablePayload = objectRecord(durable.payload);
  const durableStoryboard = objectRecord(durablePayload?.storyboard);
  if (!durablePayload || !durableStoryboard || !Array.isArray(durableStoryboard.scenes) || !Array.isArray(captured.scenes)) return merged;
  assertSameAuthoredSceneSet(durableStoryboard.scenes, captured.scenes);
  const authoredById = new Map(captured.scenes.map((raw) => {
    const scene = objectRecord(raw)!;
    return [scene.id as string, scene] as const;
  }));
  const durableById = new Map(durableStoryboard.scenes.map((raw) => {
    const scene = objectRecord(raw)!;
    return [scene.id as string, scene] as const;
  }));
  const scenes = durableStoryboard.scenes.map((raw) => {
    const durableScene = objectRecord(raw)!;
    const authored = authoredById.get(durableScene.id as string)!;
    assertImmutableScenePlan(durableScene, authored);
    return {
      ...durableScene,
      title: typeof authored.title === "string" ? authored.title : durableScene.title,
      narration: typeof authored.narration === "string" ? authored.narration : durableScene.narration,
      visualIntent: typeof authored.objective === "string" ? authored.objective : durableScene.visualIntent,
    };
  });
  merged.scenes = captured.scenes.map((raw) => {
    const authored = objectRecord(raw)!;
    const durableScene = durableById.get(authored.id as string)!;
    const durationTicks = durableScene.durationTicks;
    const kind = normalizedSceneType(durableScene.type ?? durableScene.kind);
    return {
      ...authored,
      ...(typeof durationTicks === "number" ? { duration: durationTicks / 240_000 } : {}),
      ...(kind ? { kind } : {}),
      authored: structuredClone(durableScene),
    };
  });
  merged.payload = { ...durablePayload, storyboard: { ...durableStoryboard, scenes } };
  return merged;
}

/**
 * Put a user action behind all earlier writes, then bind it to the exact
 * revision returned by its own save. The captured UI version is marked
 * durable only after that save succeeds, so a later edit remains eligible for
 * autosave and will correctly stale a long-running job based on this receipt.
 */
export async function saveProjectActionSnapshot<TReceipt extends DurableEditorSaveReceipt = DurableEditorSaveReceipt>(
  captured: ProjectActionSnapshotCapture,
  dependencies: ProjectActionSnapshotDependencies<TReceipt>,
): Promise<TReceipt> {
  return dependencies.runSerialized(async () => {
    const durable = await dependencies.getSnapshot();
    const saved = await dependencies.saveSnapshot({
      expectedHeadRevisionId: durable.headRevisionId,
      snapshot: mergeGeneralProjectSnapshot(durable.snapshot, captured.snapshot),
    });
    dependencies.markDurable(captured.version, saved);
    return saved;
  });
}

export function cancelAutosaveThroughVersion(
  pending: PendingProjectAutosave | undefined,
  capturedVersion: number,
  cancelTimer: (timer: number) => void,
): boolean {
  if (!pending || pending.version > capturedVersion) return false;
  cancelTimer(pending.timer);
  return true;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizedSceneType(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replaceAll("_", "-") : "";
}

function assertSameAuthoredSceneSet(durableScenes: unknown[], capturedScenes: unknown[]): void {
  const durableIds = durableScenes.map((scene) => objectRecord(scene)?.id).filter((id): id is string => typeof id === "string");
  const capturedIds = capturedScenes.map((scene) => objectRecord(scene)?.id).filter((id): id is string => typeof id === "string");
  if (
    durableIds.length !== durableScenes.length
    || capturedIds.length !== capturedScenes.length
    || new Set(durableIds).size !== durableIds.length
    || new Set(capturedIds).size !== capturedIds.length
    || durableIds.length !== capturedIds.length
    || capturedIds.some((id) => !durableIds.includes(id))
  ) throw new Error("PROJECT_EDIT_CONFLICT: The generated scene plan changed. Reopen it before saving prose edits.");
}

function assertImmutableScenePlan(durable: Record<string, unknown>, captured: Record<string, unknown>): void {
  const durableDuration = durable.durationTicks;
  const capturedDuration = captured.duration;
  if (typeof durableDuration === "number" && typeof capturedDuration === "number" && Math.abs(capturedDuration * 240_000 - durableDuration) > 0.5) {
    throw new Error("PROJECT_EDIT_CONFLICT: Generated scene timing is immutable here; restore it before saving prose edits.");
  }
  const durableType = normalizedSceneType(durable.type ?? durable.kind);
  const capturedType = normalizedSceneType(captured.kind);
  if (durableType && capturedType && durableType !== capturedType) {
    throw new Error("PROJECT_EDIT_CONFLICT: Generated scene type is immutable here; restore it before saving prose edits.");
  }
}

/**
 * Owns the gap between instant local editor persistence and immutable native
 * project revisions. Every write reloads the durable head and merges only the
 * validated editor document, so a generation or import that advances the head
 * cannot be replaced by an older whole-project payload.
 */
export class EditorDocumentSaveQueue {
  readonly #dependencies: EditorDocumentSaveQueueDependencies;
  readonly #entries = new Map<string, EditorSaveEntry>();
  #sequence: Promise<void> = Promise.resolve();

  constructor(dependencies: EditorDocumentSaveQueueDependencies) {
    this.#dependencies = dependencies;
  }

  queue(identity: EditorSaveIdentity, document: EditorProject): EditorProject {
    const validated = structuredClone(this.#dependencies.validate(document));
    const previous = this.#entries.get(identity.projectKey);
    if (previous?.timer) clearTimeout(previous.timer);
    const entry: EditorSaveEntry = previous ?? { ...identity, latest: validated, version: 0, persistedVersion: 0 };
    Object.assign(entry, identity, { latest: validated, version: entry.version + 1 });
    entry.timer = setTimeout(() => {
      delete entry.timer;
      void this.flush(identity.projectKey).catch(() => {
        // The error state is already published and the local document remains dirty.
      });
    }, this.#dependencies.delayMs ?? 750);
    this.#entries.set(identity.projectKey, entry);
    this.#dependencies.onStatus(identity.projectKey, { phase: "saving", detail: "Saving timeline…" });
    return structuredClone(validated);
  }

  pendingDocument(projectKey: string): EditorProject | null {
    const entry = this.#entries.get(projectKey);
    if (!entry || entry.persistedVersion >= entry.version) return null;
    return structuredClone(entry.latest);
  }

  hasPending(projectKey?: string): boolean {
    if (projectKey) return this.pendingDocument(projectKey) !== null;
    return [...this.#entries.values()].some((entry) => entry.persistedVersion < entry.version);
  }

  async flush(projectKey: string): Promise<DurableEditorSaveReceipt | undefined> {
    const entry = this.#entries.get(projectKey);
    if (!entry) return undefined;
    if (entry.timer) {
      clearTimeout(entry.timer);
      delete entry.timer;
    }

    let lastReceipt: DurableEditorSaveReceipt | undefined;
    while (entry.persistedVersion < entry.version) {
      if (entry.inFlight) {
        lastReceipt = await entry.inFlight;
        continue;
      }
      const targetVersion = entry.version;
      const targetDocument = structuredClone(entry.latest);
      this.#dependencies.onStatus(projectKey, { phase: "saving", detail: "Saving timeline…" });
      const running = this.#serialize(() => this.#persist(entry, targetDocument));
      entry.inFlight = running;
      try {
        lastReceipt = await running;
        entry.persistedVersion = Math.max(entry.persistedVersion, targetVersion);
        this.#dependencies.onSaved(projectKey, lastReceipt);
      } catch (error) {
        this.#dependencies.onStatus(projectKey, {
          phase: "error",
          detail: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        if (entry.inFlight === running) delete entry.inFlight;
      }
    }
    this.#dependencies.onStatus(projectKey, { phase: "saved", detail: "Timeline saved" });
    return lastReceipt;
  }

  async flushAll(): Promise<void> {
    while (true) {
      const pending = [...this.#entries.values()]
        .filter((entry) => entry.persistedVersion < entry.version)
        .map((entry) => entry.projectKey);
      if (!pending.length) return;
      for (const projectKey of pending) await this.flush(projectKey);
    }
  }

  dispose(): void {
    for (const entry of this.#entries.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      delete entry.timer;
    }
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const running = this.#sequence.then(operation, operation);
    this.#sequence = running.then(() => undefined, () => undefined);
    return running;
  }

  async #persist(entry: EditorSaveEntry, document: EditorProject): Promise<DurableEditorSaveReceipt> {
    const isConflict = this.#dependencies.isRevisionConflict ?? defaultRevisionConflict;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const identity = { projectId: entry.projectId, projectDirectory: entry.projectDirectory };
      const durable = await this.#dependencies.load(identity);
      try {
        return await this.#dependencies.save({
          ...identity,
          expectedHeadRevisionId: durable.headRevisionId,
          snapshot: { ...durable.snapshot, editorDocument: structuredClone(document) },
        });
      } catch (error) {
        if (!isConflict(error) || attempt === 2) throw error;
      }
    }
    throw new Error("Timeline save could not acquire a current project revision.");
  }
}
