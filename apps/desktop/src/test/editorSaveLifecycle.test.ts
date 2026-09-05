import { describe, expect, it, vi } from "vitest";
import { EditorDocumentSaveQueue, createEditorCloseHandler, mergeGeneralProjectSnapshot, type DurableEditorSaveReceipt } from "../editorSaveLifecycle";
import { makeSampleProject } from "../editor/test/fixtures";

function receipt(headRevisionId: string, snapshot: Record<string, unknown>): DurableEditorSaveReceipt {
  return { projectId: "native-project", headRevisionId, revisionNumber: Number(headRevisionId.slice(-1)), snapshot };
}

describe("EditorDocumentSaveQueue", () => {
  it("keeps the durable editor document and customization out of delayed general autosaves", () => {
    expect(mergeGeneralProjectSnapshot(
      { editorDocument: { name: "new WebM timeline" }, customization: { accent: "new" }, payload: { generationId: "current" } },
      { editorDocument: { name: "old MP4 timeline" }, customization: { accent: "old" }, reviewNotes: "keep this edit" },
    )).toEqual({
      editorDocument: { name: "new WebM timeline" },
      customization: { accent: "new" },
      payload: { generationId: "current" },
      reviewNotes: "keep this edit",
    });
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
