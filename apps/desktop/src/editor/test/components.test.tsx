import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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
    expect(screen.getAllByText("Start with the question.").length).toBeGreaterThan(0);
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

  it("keeps the visual canvas visible while audio clips are active", () => {
    render(<AdvancedVideoEditor project={makeSampleProject()} />);
    expect(screen.getByTestId("editor-preview-slide")).toHaveTextContent("Opening slide");
    expect(screen.getAllByText("Why does this work?").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Start with the question.").length).toBeGreaterThan(0);
  });

  it("shows only resolved waveform media and crops it to the clip source range", async () => {
    const project = makeSampleProject();
    project.assets = project.assets.map((asset, index) => ({ ...asset, hash: String(index + 1).repeat(64) }));
    project.tracks.find((track) => track.kind === "narration")!.clips[0]!.sourceRange = { startFrame: 30, durationFrames: 90 };
    const onResolveWaveform = vi.fn(async (asset) => ({ artifactHash: asset.hash!, waveformHash: "f".repeat(64), url: `asset://waveform/${asset.id}`, width: 2048, height: 72, durationFrames: 180 }));
    render(<AdvancedVideoEditor project={project} onResolveWaveform={onResolveWaveform} />);

    const waveform = await screen.findByTestId("waveform-narration-a");
    const image = waveform.querySelector("img");
    expect(image).toHaveAttribute("src", "asset://waveform/asset-narration");
    expect(image).toHaveStyle({ left: "-33.33333333333333%", width: "200%" });
    expect(onResolveWaveform).toHaveBeenCalledTimes(3);
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

    await user.click(screen.getByRole("button", { name: "Move playhead to 00:00:06:00" }));
    await user.click(screen.getByRole("button", { name: "Place diagram.png at playhead" }));
    expect(onCreateClipFromAsset).toHaveBeenCalledWith(expect.objectContaining({ id: "asset-upload", status: "ready" }), "track-slides", 180);
    expect(screen.getByRole("button", { name: /diagram.png, slides/ })).toBeInTheDocument();
  });

  it("exports through injected project and OTIO callbacks", async () => {
    const user = userEvent.setup();
    const onExportProject = vi.fn();
    const onExportOtio = vi.fn();
    render(<AdvancedVideoEditor project={makeSampleProject()} onExportProject={onExportProject} onExportOtio={onExportOtio} />);
    await user.click(screen.getByRole("button", { name: "Export project JSON" }));
    expect(onExportProject).toHaveBeenCalledWith(expect.objectContaining({ schema: "alystria.editor.project.v1" }));
    await user.click(screen.getByRole("button", { name: "Export OTIO" }));
    expect(onExportOtio).toHaveBeenCalledWith(expect.objectContaining({ OTIO_SCHEMA: "Timeline.1" }), expect.objectContaining({ id: "sample-project" }));
  });

  it("renders the edited timeline only through an injected native callback", async () => {
    const user = userEvent.setup();
    const onRenderTimeline = vi.fn().mockResolvedValue({ outputPath: "project/exports/editor/final.webm", warnings: ["Fallback font used."] });
    render(<AdvancedVideoEditor project={makeSampleProject()} onRenderTimeline={onRenderTimeline} />);
    await user.click(screen.getByRole("button", { name: "Render timeline" }));
    await waitFor(() => expect(onRenderTimeline).toHaveBeenCalledWith(expect.objectContaining({ id: "sample-project" })));
    expect(await screen.findByRole("status")).toHaveTextContent("project/exports/editor/final.webm");
    expect(screen.getByRole("status")).toHaveTextContent("Fallback font used");
  });

  it("delivers each editor revision once when its parent passes an inline callback", async () => {
    const user = userEvent.setup();
    const delivered = vi.fn();
    function Host() {
      const [project, setProject] = useState(makeSampleProject);
      return <AdvancedVideoEditor project={project} onProjectChange={(next, revision) => { delivered(next, revision); setProject(next); }} />;
    }
    render(<Host />);
    await user.click(screen.getByRole("button", { name: "Transcript" }));
    const cue = screen.getByDisplayValue("Start with the question.").closest("li")!;
    await user.clear(within(cue).getByRole("textbox", { name: "Transcript" }));
    await user.type(within(cue).getByRole("textbox", { name: "Transcript" }), "One durable edit.");
    await user.click(within(cue).getByRole("button", { name: "Save cue" }));
    await waitFor(() => expect(delivered).toHaveBeenCalledOnce());
  });
});
