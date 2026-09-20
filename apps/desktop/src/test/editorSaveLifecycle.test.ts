import { describe, expect, it, vi } from "vitest";
import { EditorDocumentSaveQueue, cancelAutosaveThroughVersion, createEditorCloseHandler, mergeGeneralProjectSnapshot, saveProjectActionSnapshot, type DurableEditorSaveReceipt } from "../editorSaveLifecycle";
import { makeSampleProject } from "../editor/test/fixtures";

function receipt(headRevisionId: string, snapshot: Record<string, unknown>): DurableEditorSaveReceipt {
  return { projectId: "native-project", headRevisionId, revisionNumber: Number(headRevisionId.slice(-1)), snapshot };
}

describe("EditorDocumentSaveQueue", () => {
  it("cancels the duplicate autosave covered by an action while preserving a later edit", () => {
    const cancelTimer = vi.fn();
    expect(cancelAutosaveThroughVersion({ timer: 41, version: 7 }, 7, cancelTimer)).toBe(true);
    expect(cancelTimer).toHaveBeenCalledWith(41);

    cancelTimer.mockClear();
    expect(cancelAutosaveThroughVersion({ timer: 42, version: 8 }, 7, cancelTimer)).toBe(false);
    expect(cancelTimer).not.toHaveBeenCalled();
  });

  it("serializes an action save, merges it onto the fresh head, and marks only its captured version durable", async () => {
    const order: string[] = [];
    let releasePrior!: () => void;
    const priorWrite = new Promise<void>((resolve) => { releasePrior = resolve; });
    let sequence = Promise.resolve();
    const runSerialized = <T,>(operation: () => Promise<T>): Promise<T> => {
      const running = sequence.then(operation, operation);
      sequence = running.then(() => undefined, () => undefined);
      return running;
    };
    const prior = runSerialized(async () => {
      order.push("prior:start");
      await priorWrite;
      order.push("prior:end");
    });
    const markDurable = vi.fn((version: number, saved: DurableEditorSaveReceipt) => {
      order.push(`durable:${version}:${saved.headRevisionId}`);
    });
    const saveSnapshot = vi.fn(async (input: { expectedHeadRevisionId: string; snapshot: Record<string, unknown> }) => {
      order.push(`save:${input.expectedHeadRevisionId}`);
      return receipt("revision-8", input.snapshot);
    });

    const action = saveProjectActionSnapshot({
      version: 7,
      snapshot: {
        generationId: "generation-1",
        scenes: [{ id: "scene-1" }],
        creative: { slide: { prompt: "The exact reviewed image recipe" } },
      },
    }, {
      runSerialized,
      getSnapshot: async () => {
        order.push("get");
        return {
          headRevisionId: "revision-7",
          revisionNumber: 7,
          snapshot: {
            generationId: "generation-1",
            stage: "rendered",
            sceneCandidates: [{ id: "keep-new-candidate" }],
            scenes: [{ id: "scene-1" }],
            creative: { slide: { prompt: "Old recipe" } },
          },
        };
      },
      saveSnapshot,
      markDurable,
    });

    const later = runSerialized(async () => { order.push("later-edit"); });
    releasePrior();
    await prior;
    const saved = await action;
    await later;

    expect(order).toEqual(["prior:start", "prior:end", "get", "save:revision-7", "durable:7:revision-8", "later-edit"]);
    expect(saveSnapshot).toHaveBeenCalledWith({
      expectedHeadRevisionId: "revision-7",
      snapshot: expect.objectContaining({
        stage: "rendered",
        sceneCandidates: [{ id: "keep-new-candidate" }],
        creative: { slide: { prompt: "The exact reviewed image recipe" } },
      }),
    });
    expect(saved.headRevisionId).toBe("revision-8");
  });

  it("does not mark an action version durable when its compare-and-swap save conflicts", async () => {
    const markDurable = vi.fn();
    await expect(saveProjectActionSnapshot({ version: 4, snapshot: { scenes: [] } }, {
      runSerialized: async (operation) => operation(),
      getSnapshot: async () => ({ headRevisionId: "revision-4", revisionNumber: 4, snapshot: { scenes: [] } }),
      saveSnapshot: async () => { throw new Error("REVISION_CONFLICT: another edit advanced the head"); },
      markDurable,
    })).rejects.toThrow("REVISION_CONFLICT");
    expect(markDurable).not.toHaveBeenCalled();
  });

  it("persists edited cast and scene speakers while retaining newer durable canvas settings", () => {
    const selection = { schemaVersion: 1, mode: "on", presenters: [{ presenterId: "daniel", portraitAssetId: "daniel" }, { presenterId: "astrid", portraitAssetId: "astrid" }], sceneAssignments: [{ sceneId: "scene-1", presenterId: "astrid" }] };
    const merged = mergeGeneralProjectSnapshot({
      generationId: "generation-1",
      presenterSelection: { ...selection, sceneAssignments: [] },
      customization: { accent: "new", presenter: { assetId: "daniel", placement: "picture-in-picture" } },
      scenes: [{ id: "scene-1" }],
    }, {
      nativeGenerationId: "generation-1",
      presenterSelection: selection,
      customization: { accent: "old", presenter: { assetId: "astrid", placement: "picture-in-picture" } },
      scenes: [{ id: "scene-1" }],
    });
    expect(merged.presenterSelection).toEqual(selection);
    expect(merged.customization).toEqual({ accent: "new", presenter: { assetId: "astrid", placement: "picture-in-picture" } });
    selection.sceneAssignments[0]!.presenterId = "daniel";
    expect(merged.presenterSelection).toMatchObject({ sceneAssignments: [{ presenterId: "astrid" }] });
  });

  it("preserves a newer same-generation stage while merging only authored prose and creative settings", () => {
    const presenterSelection = { schemaVersion: 1, mode: "off", presenters: [], sceneAssignments: [] };
    const merged = mergeGeneralProjectSnapshot({
      generationId: "generation-1",
      presenterSelection,
      stage: "rendered",
      editorDocument: { name: "new WebM timeline" },
      customization: { accent: "new" },
      sceneCandidates: [{ id: "candidate-new" }],
      payload: { render: { artifactHash: "new-render" }, storyboard: { approved: true, scenes: [{ id: "scene-1", type: "definition", durationTicks: 2_400_000, title: "Generated title", narration: "Generated narration", visualIntent: "Generated intent", artifactId: "immutable-scene" }] } },
    }, {
      nativeGenerationId: "generation-1",
      presenterSelection,
      stage: "planning",
      editorDocument: { name: "old MP4 timeline" },
      customization: { accent: "old" },
      sceneCandidates: [{ id: "candidate-old" }],
      payload: { render: { artifactHash: "old-render" }, storyboard: { scenes: [{ id: "scene-1", type: "definition", durationTicks: 2_400_000, title: "Old title" }] } },
      scenes: [{ id: "scene-1", kind: "definition", duration: 10, title: "Reviewed title", narration: "Reviewed narration", objective: "Reviewed intent" }],
      creative: { slide: { prompt: "Line art" } },
      reviewNotes: "Check the final example",
    });

    expect(merged).toMatchObject({
      generationId: "generation-1",
      stage: "rendered",
      editorDocument: { name: "new WebM timeline" },
      customization: { accent: "new" },
      sceneCandidates: [{ id: "candidate-new" }],
      creative: { slide: { prompt: "Line art" } },
      reviewNotes: "Check the final example",
      payload: { render: { artifactHash: "new-render" }, storyboard: { approved: true, scenes: [{ id: "scene-1", type: "definition", durationTicks: 2_400_000, title: "Reviewed title", narration: "Reviewed narration", visualIntent: "Reviewed intent", artifactId: "immutable-scene" }] } },
    });
  });

  it("fails visibly instead of applying stale edits to a different generation", () => {
    expect(() => mergeGeneralProjectSnapshot(
      { generationId: "generation-2", payload: {} },
      { nativeGenerationId: "generation-1", scenes: [] },
    )).toThrow(/PROJECT_EDIT_CONFLICT.*newer generation/i);
    expect(() => mergeGeneralProjectSnapshot(
      { generationId: "generation-1", stage: "storyboard", payload: { storyboard: { scenes: [] } } },
      { stage: "project-created", payload: { brief: { topic: "stale" } }, scenes: [] },
    )).toThrow(/PROJECT_EDIT_CONFLICT.*newer generation/i);
  });

  it("rejects timing and scene-type changes outside the approved prose fields", () => {
    const durable = { generationId: "generation-1", payload: { storyboard: { scenes: [{ id: "scene-1", type: "definition", durationTicks: 2_400_000 }] } } };
    expect(() => mergeGeneralProjectSnapshot(durable, { nativeGenerationId: "generation-1", scenes: [{ id: "scene-1", kind: "definition", duration: 11 }] })).toThrow(/timing is immutable/i);
    expect(() => mergeGeneralProjectSnapshot(durable, { nativeGenerationId: "generation-1", scenes: [{ id: "scene-1", kind: "recap", duration: 10 }] })).toThrow(/scene type is immutable/i);
  });

  it("flushes an immediate close through every edit that arrived during the first save", async () => {
    const original = makeSampleProject();
    const imported = { ...original, name: "Timeline with durable WebM import" };
    let releaseFirst!: () => void;
    const firstSave = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const savedSnapshots: Record<string, unknown>[] = [];
    const save = vi.fn(async (input: { snapshot: Record<string, unknown> }) => {
      savedSnapshots.push(input.snapshot);
      if (savedSnapshots.length === 1) await firstSave;
      return receipt(`revision-${savedSnapshots.length}`, input.snapshot);
    });
    const queue = new EditorDocumentSaveQueue({
      load: vi.fn(async () => ({ headRevisionId: `head-${savedSnapshots.length}`, revisionNumber: savedSnapshots.length, snapshot: { generationId: "generation-kept", stage: "rendered" } })),
      save,
      validate: (document) => structuredClone(document),
      onStatus: vi.fn(),
      onSaved: vi.fn(),
      delayMs: 60_000,
    });
    queue.queue({ projectKey: "local-project", projectId: "native-project", projectDirectory: "C:/projects/native-project" }, original);

    const closeFlush = queue.flushAll();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    queue.queue({ projectKey: "local-project", projectId: "native-project", projectDirectory: "C:/projects/native-project" }, imported);
    releaseFirst();
    await closeFlush;

    expect(save).toHaveBeenCalledTimes(2);
    expect(savedSnapshots[1]).toMatchObject({ generationId: "generation-kept", stage: "rendered", editorDocument: { name: "Timeline with durable WebM import" } });
    expect(queue.hasPending()).toBe(false);
    queue.dispose();
  });

  it("reloads a generation-advanced head on conflict and merges only the captured editor document", async () => {
    const document = { ...makeSampleProject(), name: "Trimmed timeline" };
    const load = vi.fn()
      .mockResolvedValueOnce({ headRevisionId: "revision-1", revisionNumber: 1, snapshot: { generationId: "generation-old", scene: "old" } })
      .mockResolvedValueOnce({ headRevisionId: "revision-2", revisionNumber: 2, snapshot: { generationId: "generation-new", scene: "new", approval: { accepted: true } } });
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("REVISION_CONFLICT: generation advanced"))
      .mockImplementationOnce(async (input: { snapshot: Record<string, unknown> }) => receipt("revision-3", input.snapshot));
    const queue = new EditorDocumentSaveQueue({ load, save, validate: (value) => structuredClone(value), onStatus: vi.fn(), onSaved: vi.fn(), delayMs: 60_000 });
    queue.queue({ projectKey: "local-project", projectId: "native-project", projectDirectory: "C:/projects/native-project" }, document);

    await queue.flushAll();

    expect(load).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).toMatchObject({
      expectedHeadRevisionId: "revision-2",
      snapshot: { generationId: "generation-new", scene: "new", approval: { accepted: true }, editorDocument: { name: "Trimmed timeline" } },
    });
    queue.dispose();
  });

  it("keeps a failed close dirty and succeeds when the user retries", async () => {
    const statuses: string[] = [];
    const document = makeSampleProject();
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("Disk is unavailable"))
      .mockImplementationOnce(async (input: { snapshot: Record<string, unknown> }) => receipt("revision-2", input.snapshot));
    const queue = new EditorDocumentSaveQueue({
      load: vi.fn(async () => ({ headRevisionId: "revision-1", revisionNumber: 1, snapshot: { stage: "ready" } })),
      save,
      validate: (value) => structuredClone(value),
      onStatus: (_projectKey, status) => statuses.push(status.phase),
      onSaved: vi.fn(),
      delayMs: 60_000,
    });
    queue.queue({ projectKey: "local-project", projectId: "native-project", projectDirectory: "C:/projects/native-project" }, document);

    await expect(queue.flushAll()).rejects.toThrow("Disk is unavailable");
    expect(queue.hasPending("local-project")).toBe(true);
    expect(statuses.at(-1)).toBe("error");

    await queue.flushAll();
    expect(queue.hasPending("local-project")).toBe(false);
    expect(statuses.at(-1)).toBe("saved");
    queue.dispose();
  });

  it("prevents native shutdown when the immediate durable flush fails", async () => {
    const event = { preventDefault: vi.fn() };
    const shutdown = vi.fn(async () => undefined);
    const onError = vi.fn();
    const flush = vi.fn().mockRejectedValueOnce(new Error("Project drive disconnected"));
    const close = createEditorCloseHandler({ flush, shutdown, onError });

    await close(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(shutdown).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Project drive disconnected" }));

    flush.mockResolvedValueOnce(undefined);
    await close(event);
    expect(shutdown).toHaveBeenCalledOnce();
  });
});
