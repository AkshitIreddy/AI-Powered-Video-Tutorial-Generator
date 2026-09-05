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
  const general = { ...captured };
  delete general.editorDocument;
  delete general.customization;
  return { ...durable, ...general };
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
