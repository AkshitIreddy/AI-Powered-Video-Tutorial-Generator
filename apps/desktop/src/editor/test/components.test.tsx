import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdvancedVideoEditor, createEditorProjectFromAlystriaProject, defaultClipValues, serializeEditorProject } from "..";
import { makeProposal, makeSampleProject } from "./fixtures";

describe("AdvancedVideoEditor", () => {
  it("keeps unused catalog references out of project media without losing them", async () => {
    const user = userEvent.setup();
    const project = makeSampleProject();
    const unused = { ...project.assets[0]!, id: "unused-catalog", name: "Unlinked catalog presenter",
      status: "pending" as const,
      metadata: { alystriaAssetSource: "starter-pack", playableUriRequired: true } };
    delete unused.uri;
    delete unused.previewUrl;
    delete unused.importReceiptId;
    project.assets.push(unused);
    render(<AdvancedVideoEditor project={project} />);
    expect(screen.queryByText(unused.name)).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Show unlinked library references/ }));
    expect(screen.getByText(unused.name)).toBeInTheDocument();
    expect(screen.getByText("Not linked")).toBeInTheDocument();
    expect(project.assets.some((asset) => asset.id === unused.id)).toBe(true);
  });

  it("renders an accessible seven-track editor without inventing preview media", () => {
    render(<AdvancedVideoEditor project={makeSampleProject()} />);

    expect(screen.getByRole("application", { name: "Advanced video editor" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Explicit local sample" })).toBeInTheDocument();
    for (const track of ["Slides", "Presenter", "Titles", "Captions", "Narration", "Music", "Sound effects"]) {
      expect(screen.getByRole("group", { name: `${track} track` })).toBeInTheDocument();
    }
    expect(screen.getAllByText("Start with the question.").length).toBeGreaterThan(0);
    expect(screen.queryByText(/generated successfully/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "AI proposals" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mute Titles" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Solo Captions" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide Titles" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mute Narration" })).toBeInTheDocument();
  });

  it("hides a visual track in both preview and the persisted render state", async () => {
    const user = userEvent.setup();
    const delivered = vi.fn();
    render(<AdvancedVideoEditor project={makeSampleProject()} onProjectChange={delivered} />);
    expect(screen.getByTestId("editor-preview-title")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide Titles" }));

    expect(screen.queryByTestId("editor-preview-title")).not.toBeInTheDocument();
    await waitFor(() => expect(delivered).toHaveBeenCalledOnce());
    expect(delivered.mock.calls[0]?.[0].tracks.find((track: { kind: string }) => track.kind === "titles")).toMatchObject({ hidden: true });
    expect(screen.getByRole("button", { name: "Hide Titles" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps an imported document bound to the open native project identity", async () => {
    const user = userEvent.setup();
    const host = makeSampleProject();
    const imported = { ...makeSampleProject(), id: "another-project", name: "Imported edit" };
    const onProjectChange = vi.fn();
    render(<AdvancedVideoEditor project={host} onProjectChange={onProjectChange} />);
    const file = new File([serializeEditorProject(imported)], "imported-editor.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => serializeEditorProject(imported) });

    await user.upload(
      screen.getByLabelText("Import editor project file"),
      file,
    );

    await waitFor(() => expect(onProjectChange).toHaveBeenCalledOnce());
    expect(onProjectChange.mock.calls[0]?.[0]).toMatchObject({
      id: host.id,
      name: "Imported edit",
      metadata: { importedProjectId: "another-project", importedIntoProjectId: host.id },
    });
    expect(screen.getByRole("status")).toHaveTextContent("Imported edit imported");
  });

  it("supports keyboard split plus reversible undo and redo", async () => {
    const user = userEvent.setup();
    render(<AdvancedVideoEditor project={makeSampleProject()} />);
    const openingSlide = screen.getByRole("button", { name: /Opening slide, slides/ });
    await user.click(openingSlide);
    await user.click(screen.getByRole("button", { name: "Step forward one frame" }));
    openingSlide.focus();
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

  it("renders only the active verified caption cue and no duplicate composite title", () => {
    const project = createEditorProjectFromAlystriaProject({
      id: "caption-preview-project",
      title: "Caption preview",
      duration: 0.1,
      scenes: [{ id: "scene-1", title: "Title already in composite", kind: "title", duration: 6, narration: "First cue. Second cue." }],
    }, {
      now: "2026-09-05T12:00:00Z",
      mediaBindings: {
        renders: [{ sceneId: "scene-1", artifactHash: "d".repeat(64), mediaType: "video/webm", durationTicks: 1_440_000, sourceStartTicks: 0, captionsBurnedIntoPixels: false }],
        captions: [
          { sceneId: "scene-1", id: "cue-1", startTicks: 0, endTicks: 240_000, text: "First cue." },
          { sceneId: "scene-1", id: "cue-2", startTicks: 240_000, endTicks: 480_000, text: "Second cue." },
        ],
        assets: [], narration: [], presenters: [],
      },
    });

    render(<AdvancedVideoEditor project={project} />);

    expect(screen.getByTestId("editor-preview-caption")).toHaveTextContent("First cue.");
    expect(screen.queryByTestId("editor-preview-title")).not.toBeInTheDocument();
    expect(screen.queryByText("First cue. Second cue.")).not.toBeInTheDocument();
  });

  it("edits export-backed text placement, size, color, and explicit line breaks", async () => {
    const user = userEvent.setup();
    render(<AdvancedVideoEditor project={makeSampleProject()} />);
    await user.click(screen.getByRole("button", { name: /Opening question, titles/ }));
    await user.click(screen.getByRole("button", { name: "Inspector" }));

    expect(screen.getByRole("group", { name: "On-screen text style" })).toBeInTheDocument();
    const textSize = screen.getByRole("spinbutton", { name: "Text size" });
    fireEvent.change(textSize, { target: { value: "72" } });
    fireEvent.blur(textSize);
    fireEvent.change(screen.getByLabelText("Text color"), { target: { value: "#ff3355" } });
    await user.selectOptions(screen.getByLabelText("Text alignment"), "left");
    await user.selectOptions(screen.getByLabelText("Text placement"), "top");
    await user.click(screen.getByRole("checkbox", { name: "Background panel" }));
    const text = screen.getByDisplayValue("Why does this work?");
    await user.clear(text);
    await user.type(text, "Why this works{enter}in two steps");

    const preview = screen.getByTestId("editor-preview-title");
    expect(preview).toHaveTextContent("Why this works in two steps");
    expect(preview).toHaveStyle({ left: "5%", top: "5%", color: "#FF3355" });
    // The 1920px canvas fits a 640px preview in the layout-free test DOM.
    // Editing remains in export pixels; preview text follows canvas scale.
    expect(textSize).toHaveValue(72);
    expect(preview.style.fontSize).toBe("24px");
    expect(preview.style.whiteSpace).toBe("pre");
    expect(preview).toHaveAttribute("title", expect.stringContaining("Preview and export use Arial"));
    expect(screen.getByText(/keep only explicit line breaks/i)).toBeInTheDocument();
  });

  it("previews video source audio with the same clip, mute, and solo policy as export", async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const user = userEvent.setup();
    const project = makeSampleProject();
    const slideAsset = project.assets.find((asset) => asset.id === "asset-slide-a")!;
    slideAsset.kind = "video";
    slideAsset.previewUrl = "asset://preview/slide.webm";
    const presenterAsset = project.assets.find((asset) => asset.id === "asset-presenter")!;
    presenterAsset.previewUrl = "asset://preview/presenter.webm";
    const slideClip = project.tracks.find((track) => track.kind === "slides")!.clips[0]!;
    slideClip.metadata.includeSourceAudio = true;
    const presenterClip = project.tracks.find((track) => track.kind === "presenter")!.clips[0]!;
    presenterClip.metadata.includeSourceAudio = true;

    render(<AdvancedVideoEditor project={project} />);
    const slideVideo = screen.getByLabelText("Preview of Slide A") as HTMLVideoElement;
    const presenterVideo = screen.getByLabelText("Preview of Presenter recording") as HTMLVideoElement;
    expect(slideVideo.muted).toBe(false);
    expect(presenterVideo.muted).toBe(false);

    await user.click(screen.getByRole("button", { name: "Solo Narration" }));
    expect(slideVideo.muted).toBe(true);
    expect(presenterVideo.muted).toBe(true);
    const soloNarration = screen.getByRole("button", { name: "Solo Narration" });
    expect(soloNarration).toHaveAttribute("aria-pressed", "true");
    await user.click(soloNarration);
    expect(screen.getByRole("button", { name: "Solo Narration" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: /Opening slide, slides/ }));
    await user.click(screen.getByRole("button", { name: "Inspector" }));
    expect(screen.getByRole("group", { name: "Source audio" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Volume dB" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Mute clip" }));
    expect(slideVideo.muted).toBe(true);
    pause.mockRestore();
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

  it("shows a failed document save and allows a retry", async () => {
    const user = userEvent.setup();
    const onExportOtio = vi.fn().mockRejectedValueOnce({ code: "IO_ERROR", message: "Exports folder unavailable" }).mockResolvedValueOnce(undefined);
    render(<AdvancedVideoEditor project={makeSampleProject()} onExportOtio={onExportOtio} />);
    await user.click(screen.getByRole("button", { name: "Export OTIO" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Exports folder unavailable");
    await user.click(screen.getByRole("button", { name: "Export OTIO" }));
    expect(await screen.findByText("Document exported to the project's exports folder.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
