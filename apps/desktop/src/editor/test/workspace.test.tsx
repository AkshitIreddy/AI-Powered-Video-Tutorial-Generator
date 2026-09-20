import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { AdvancedVideoEditor, createEmptyEditorProject } from "..";
import { EDITOR_LAYOUT_DEFAULTS } from "../editorLayout";
import { makeSampleProject } from "./fixtures";

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
});

describe("editor workspace redesign", () => {
  it("shows exactly one in-app project title with save state, rights, and return", () => {
    render(
      <AdvancedVideoEditor
        project={makeSampleProject()}
        saveStatus={<span>Saved just now</span>}
        importRightsValue="unknown"
        onImportRightsChange={() => undefined}
        onReturn={() => undefined}
      />,
    );
    expect(screen.getAllByRole("heading", { name: "Explicit local sample" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Return to scene" })).toBeInTheDocument();
    expect(screen.getByLabelText("Rights for new editor media")).toBeInTheDocument();
    expect(screen.getByText("Saved just now")).toBeInTheDocument();
    expect(screen.getByText(/Finishing room/)).toBeInTheDocument();
  });

  it("keeps unsaved transcript drafts when switching side panels", async () => {
    const user = userEvent.setup();
    render(<AdvancedVideoEditor project={makeSampleProject()} />);
    await user.click(screen.getByRole("button", { name: "Transcript" }));
    const cue = screen.getByDisplayValue("Start with the question.").closest("li")!;
    await user.clear(within(cue).getByRole("textbox", { name: "Transcript" }));
    await user.type(within(cue).getByRole("textbox", { name: "Transcript" }), "Draft that is not saved yet.");
    expect(within(cue).getByText("Draft kept on this device")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Media" }));
    expect(screen.queryAllByRole("textbox", { name: "Transcript" })).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Transcript" }));

    expect(screen.getByDisplayValue("Draft that is not saved yet.")).toBeInTheDocument();
    await user.click(within(screen.getByDisplayValue("Draft that is not saved yet.").closest("li")!).getByRole("button", { name: /Revert/ }));
    expect(screen.getByDisplayValue("Start with the question.")).toBeInTheDocument();
  });

  it("shows speaker identity contextually and never invents a speaker", async () => {
    const user = userEvent.setup();
    const delivered: Array<{ text: string | undefined; speaker: string | undefined }> = [];
    const project = makeSampleProject();
    const captions = project.tracks.find((track) => track.kind === "captions")!;
    const unsaidClip = captions.clips[1]!;
    unsaidClip.text = "A cue without a speaker.";
    delete unsaidClip.speaker;
    render(
      <AdvancedVideoEditor
        project={project}
        onProjectChange={(next) => {
          const cue = next.tracks.flatMap((track) => track.clips).find((clip) => clip.id === unsaidClip.id);
          delivered.push({ text: cue?.text, speaker: cue?.speaker });
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Transcript" }));

    const spoken = screen.getByDisplayValue("Start with the question.").closest("li")!;
    expect(within(spoken).getByText("Narrator")).toBeInTheDocument();
    expect(within(spoken).queryByRole("textbox", { name: "Speaker" })).not.toBeInTheDocument();

    const unsaid = screen.getByDisplayValue("A cue without a speaker.").closest("li")!;
    expect(within(unsaid).queryByText("Narrator")).not.toBeInTheDocument();
    await user.click(within(unsaid).getByRole("button", { name: "Add speaker" }));
    expect(within(unsaid).getByRole("textbox", { name: "Speaker" })).toBeInTheDocument();

    await user.clear(within(unsaid).getByRole("textbox", { name: "Transcript" }));
    await user.type(within(unsaid).getByRole("textbox", { name: "Transcript" }), "A cue without a speaker, edited.");
    await user.click(within(unsaid).getByRole("button", { name: "Save cue" }));
    expect(delivered.at(-1)).toMatchObject({ text: "A cue without a speaker, edited.", speaker: undefined });
  });

  it("resizes the dock with keyboard and persists the layout", async () => {
    const user = userEvent.setup();
    render(<AdvancedVideoEditor project={makeSampleProject()} />);
    const splitter = screen.getByRole("separator", { name: "Resize side panel width" });
    const before = Number(splitter.getAttribute("aria-valuenow"));
    expect(before).toBe(EDITOR_LAYOUT_DEFAULTS.dockWidth);

    splitter.focus();
    fireEvent.keyDown(splitter, { key: "ArrowRight" });
    const after = Number(screen.getByRole("separator", { name: "Resize side panel width" }).getAttribute("aria-valuenow"));
    expect(after).toBe(before + 12);
    expect(JSON.parse(window.localStorage.getItem("alystria.editor.layout.v1")!).dockWidth).toBe(after);

    await user.click(screen.getByRole("button", { name: "Collapse side panel" }));
    expect(screen.queryByRole("separator", { name: "Resize side panel width" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand side panel" }));
    expect(screen.getByRole("separator", { name: "Resize side panel width" })).toHaveAttribute("aria-valuenow", String(after));

    await user.click(screen.getByRole("button", { name: "Reset panel layout" }));
    expect(screen.getByRole("separator", { name: "Resize side panel width" })).toHaveAttribute("aria-valuenow", String(EDITOR_LAYOUT_DEFAULTS.dockWidth));
  });

  it("keeps focused buttons keyboard-operable instead of running editor shortcuts", async () => {
    const user = userEvent.setup();
    render(<AdvancedVideoEditor project={makeSampleProject()} />);
    const transcript = screen.getByRole("button", { name: "Transcript" });
    transcript.focus();

    await user.keyboard(" ");

    expect(screen.getByRole("heading", { name: "Transcript" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("makes disabled icon explanations keyboard reachable", async () => {
    render(<AdvancedVideoEditor project={makeSampleProject()} />);
    const undo = screen.getByRole("button", { name: "Undo last edit" });
    expect(undo).toBeDisabled();
    const tooltipAnchor = undo.closest(".aly-editor-iconbtn-wrap");
    expect(tooltipAnchor).toHaveAttribute("tabindex", "0");

    fireEvent.focus(tooltipAnchor!);

    expect(await screen.findByRole("tooltip")).toHaveTextContent("There is nothing to undo yet.");
  });

  it("uses visual splitter direction and exposes viewport-clamped bounds", () => {
    render(<AdvancedVideoEditor project={makeSampleProject()} />);
    const timeline = screen.getByRole("separator", { name: "Resize timeline height" });
    const before = Number(timeline.getAttribute("aria-valuenow"));
    timeline.focus();
    fireEvent.keyDown(timeline, { key: "ArrowUp" });
    expect(screen.getByRole("separator", { name: "Resize timeline height" })).toHaveAttribute("aria-valuenow", String(before + 12));

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    fireEvent(window, new Event("resize"));

    const dock = screen.getByRole("separator", { name: "Resize side panel width" });
    expect(dock).toHaveAttribute("aria-valuemax", "280");
    expect(dock).toHaveAttribute("aria-valuenow", "280");
    expect(screen.getByRole("separator", { name: "Resize timeline height" })).toHaveAttribute("aria-valuemax", "220");
    expect(screen.getByRole("separator", { name: "Resize timeline height" })).toHaveAttribute("aria-valuenow", "220");
  });

  it("collapses and reopens the timeline without losing clips", async () => {
    const user = userEvent.setup();
    render(<AdvancedVideoEditor project={makeSampleProject()} />);
    expect(screen.getByRole("button", { name: /Opening slide, slides/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse timeline" }));
    expect(screen.queryByRole("button", { name: /Opening slide, slides/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand timeline" }));
    expect(screen.getByRole("button", { name: /Opening slide, slides/ })).toBeInTheDocument();
  });

  it("explains icon actions with themed tooltips on focus", async () => {
    render(<AdvancedVideoEditor project={makeSampleProject()} />);
    const split = screen.getByRole("button", { name: "Split" });
    split.focus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Split every selected clip at the playhead");
    fireEvent.blur(split);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("compacts empty tracks and hides them only on request without deleting data", async () => {
    const user = userEvent.setup();
    const project = createEmptyEditorProject({ id: "empty-tracks", name: "Empty tracks", now: "2026-09-05T00:00:00Z" });
    project.durationFrames = 60;
    render(<AdvancedVideoEditor project={project} />);
    for (const track of ["Slides", "Presenter", "Titles", "Captions", "Narration", "Music", "Sound effects"]) {
      expect(screen.getByRole("group", { name: `${track} track` })).toBeInTheDocument();
    }
    expect(screen.getAllByText(/Empty · clips placed at the playhead land here/)).toHaveLength(7);

    await user.click(screen.getByRole("button", { name: "Hide empty tracks" }));
    expect(screen.queryByRole("group", { name: "Slides track" })).not.toBeInTheDocument();
    expect(screen.getByText(/7 empty tracks hidden/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show empty tracks" }));
    expect(screen.getByRole("group", { name: "Slides track" })).toBeInTheDocument();
  });

  it("opens the inspector when a new title is created", async () => {
    const user = userEvent.setup();
    const project = createEmptyEditorProject({ id: "text-proof", name: "Text proof", now: "2026-09-05T00:00:00Z" });
    project.durationFrames = 60;
    render(<AdvancedVideoEditor project={project} />);
    await user.click(screen.getByRole("button", { name: "Add title" }));
    expect(screen.getByLabelText("On-screen text")).toHaveValue("Your title");
  });

  it("clamps persisted layout sizes instead of trusting stored values", () => {
    window.localStorage.setItem("alystria.editor.layout.v1", JSON.stringify({ dockWidth: 9999, timelineHeight: -40, dockCollapsed: false, timelineCollapsed: false, hideEmptyTracks: false }));
    render(<AdvancedVideoEditor project={makeSampleProject()} />);
    const dock = Number(screen.getByRole("separator", { name: "Resize side panel width" }).getAttribute("aria-valuenow"));
    const timeline = Number(screen.getByRole("separator", { name: "Resize timeline height" }).getAttribute("aria-valuenow"));
    expect(dock).toBeLessThanOrEqual(560);
    expect(timeline).toBeGreaterThanOrEqual(184);
  });
});
