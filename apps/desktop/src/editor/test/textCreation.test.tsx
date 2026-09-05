import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdvancedVideoEditor, createEmptyEditorProject, defaultClipValues } from "..";

describe("explicit timeline text creation", () => {
  it("adds editable text without extending an existing lesson and supports undo", async () => {
    const user = userEvent.setup();
    const onProjectChange = vi.fn();
    const project = createEmptyEditorProject({ id: "text-proof", name: "Text proof", now: "2026-09-05T00:00:00Z" });
    project.durationFrames = 60;
    const slides = project.tracks.find((track) => track.kind === "slides")!;
    slides.clips.push({ ...defaultClipValues(), id: "existing-scene", name: "Existing lesson", trackId: slides.id, kind: "slides", assetId: null, timelineRange: { startFrame: 0, durationFrames: 60 }, sourceRange: { startFrame: 0, durationFrames: 60 } });
    render(<AdvancedVideoEditor project={project} onProjectChange={onProjectChange} />);
    await user.click(screen.getByRole("button", { name: "Add title" }));
    expect(screen.getByLabelText("On-screen text")).toHaveValue("Your title");
    expect(screen.getByRole("button", { name: "Add title" })).toBeDisabled();
    await user.clear(screen.getByLabelText("On-screen text"));
    await user.type(screen.getByLabelText("On-screen text"), "Three products");
    await waitFor(() => expect(onProjectChange).toHaveBeenCalled());
    const saved = onProjectChange.mock.lastCall?.[0];
    expect(saved.durationFrames).toBe(60);
    expect(saved.tracks.find((track: { kind: string }) => track.kind === "titles").clips[0]).toMatchObject({ text: "Three products", timelineRange: { startFrame: 0, durationFrames: 60 }, metadata: { userCreatedText: true } });
    await user.click(screen.getByRole("button", { name: "Add caption" }));
    expect(screen.getByLabelText("On-screen text")).toHaveValue("Your caption");
    await user.click(screen.getByRole("button", { name: "Undo last edit" }));
    expect(screen.getByRole("button", { name: "Add caption" })).toBeEnabled();
  });

  it("does not add text to a locked track", () => {
    const project = createEmptyEditorProject({ id: "locked-proof", name: "Locked proof", now: "2026-09-05T00:00:00Z" });
    project.tracks.find((track) => track.kind === "titles")!.locked = true;
    render(<AdvancedVideoEditor project={project} />);
    expect(screen.getByRole("button", { name: "Add title" })).toBeDisabled();
  });
});
