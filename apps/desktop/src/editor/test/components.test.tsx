import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AdvancedVideoEditor, defaultClipValues } from "..";
import { makeProposal, makeSampleProject } from "./fixtures";

describe("AdvancedVideoEditor", () => {
  it("renders an accessible seven-track editor without inventing preview media", () => {
    render(<AdvancedVideoEditor project={makeSampleProject()} proposals={[makeProposal()]} />);

    expect(screen.getByRole("application", { name: "Advanced video editor" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Explicit local sample" })).toBeInTheDocument();
    for (const track of ["Slides", "Presenter", "Titles", "Captions", "Narration", "Music", "Sound effects"]) {
      expect(screen.getByRole("group", { name: `${track} track` })).toBeInTheDocument();
    }
    expect(screen.getByText("Start with the question.")).toBeInTheDocument();
    expect(screen.queryByText(/generated successfully/i)).not.toBeInTheDocument();
  });

  it("supports keyboard split plus reversible undo and redo", async () => {
    const user = userEvent.setup();
    render(<AdvancedVideoEditor project={makeSampleProject()} />);
    await user.click(screen.getByRole("button", { name: /Opening slide, slides/ }));
    await user.click(screen.getByRole("button", { name: "Step forward one frame" }));
    await user.keyboard("s");
    expect(screen.getByRole("status")).toHaveTextContent("1 clip split");
    expect(screen.getByRole("button", { name: "Undo last edit" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Undo last edit" }));
    expect(screen.getByRole("status")).toHaveTextContent("Undid Split clips");
    await user.click(screen.getByRole("button", { name: "Redo last edit" }));
    expect(screen.getByRole("status")).toHaveTextContent("Redid Split clips");
  });

  it("edits transcript cues as explicit save transactions", async () => {
    const user = userEvent.setup();
    render(<AdvancedVideoEditor project={makeSampleProject()} />);
    await user.click(screen.getByRole("button", { name: "Transcript" }));
    expect(screen.getByRole("heading", { name: "Transcript" })).toBeInTheDocument();
    const cue = screen.getByDisplayValue("Start with the question.").closest("li");
    expect(cue).not.toBeNull();
    const cueScope = within(cue!);
    await user.clear(cueScope.getByRole("textbox", { name: "Transcript" }));
    await user.type(cueScope.getByRole("textbox", { name: "Transcript" }), "Open with a sharper question.");
    await user.click(cueScope.getByRole("button", { name: "Save cue" }));
    expect(screen.getByRole("status")).toHaveTextContent("Caption one updated");
    expect(screen.getByRole("button", { name: "Undo last edit" })).toBeEnabled();
  });

  it("previews proposal diffs and policy impact before reversible apply-to-copy", async () => {
    const user = userEvent.setup();
    const onCreateProjectCopy = vi.fn();
    render(<AdvancedVideoEditor project={makeSampleProject()} proposals={[makeProposal()]} onCreateProjectCopy={onCreateProjectCopy} />);
    await user.click(screen.getByRole("button", { name: "AI proposals" }));
    await user.click(screen.getByRole("button", { name: "Preview changes" }));
    expect(screen.getByText(/2 proposed edits/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Provenance" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Policy impact" })).toBeInTheDocument();
    expect(screen.getByText(/No cloud use declared/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply to copy" }));
    await waitFor(() => expect(onCreateProjectCopy).toHaveBeenCalledOnce());
    expect(onCreateProjectCopy.mock.calls[0]?.[0]).toMatchObject({
      id: "sample-project-copy-proposal-tighten-title",
      metadata: { derivedFromProjectId: "sample-project", editProposalId: "proposal-tighten-title" },
    });
    expect(screen.getByRole("status")).toHaveTextContent("applied to a new project copy");
  });

  it("imports media only from injected receipts and places it using an injected clip factory", async () => {
    const user = userEvent.setup();
    const onImportMedia = vi.fn().mockResolvedValue({
      receipts: [{ id: "receipt-upload", assetId: "asset-upload", fileName: "diagram.png", status: "ready", requestedAt: "2026-09-02T12:00:00Z", completedAt: "2026-09-02T12:00:01Z", localOnly: true }],
      assets: [{ id: "asset-upload", name: "diagram.png", kind: "image", status: "ready", durationFrames: 90, importReceiptId: "receipt-upload", provenance: { origin: "user-import", createdAt: "2026-09-02T12:00:01Z" }, metadata: {} }],
    });
    const onCreateClipFromAsset = vi.fn((asset, trackId, startFrame) => ({
      id: "clip-upload",
      trackId,
      name: asset.name,
      kind: "slides" as const,
      assetId: asset.id,
      timelineRange: { startFrame, durationFrames: 90 },
      sourceRange: { startFrame: 0, durationFrames: 90 },
      ...defaultClipValues(),
    }));
    render(<AdvancedVideoEditor project={makeSampleProject()} onImportMedia={onImportMedia} onCreateClipFromAsset={onCreateClipFromAsset} />);
    const file = new File(["diagram"], "diagram.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Import media files"), file);
    await waitFor(() => expect(onImportMedia).toHaveBeenCalledWith([file]));
    expect((await screen.findAllByText("diagram.png")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Place diagram.png at playhead" }));
    expect(onCreateClipFromAsset).toHaveBeenCalledWith(expect.objectContaining({ id: "asset-upload", status: "ready" }), "track-slides", 0);
    expect(screen.getByRole("button", { name: /diagram.png, slides/ })).toBeInTheDocument();
  });

  it("exports through injected project and OTIO callbacks", async () => {
    const user = userEvent.setup();
    const onExportProject = vi.fn();
    const onExportOtio = vi.fn();
    render(<AdvancedVideoEditor project={makeSampleProject()} onExportProject={onExportProject} onExportOtio={onExportOtio} />);
    await user.click(screen.getByRole("button", { name: "Export project JSON" }));
    expect(onExportProject).toHaveBeenCalledWith(expect.objectContaining({ schema: "alystria.editor.project.v1" }));
    await user.click(screen.getByRole("button", { name: "Export OTIO-like" }));
    expect(onExportOtio).toHaveBeenCalledWith(expect.objectContaining({ OTIO_SCHEMA: "Timeline.1" }), expect.objectContaining({ id: "sample-project" }));
  });
});
