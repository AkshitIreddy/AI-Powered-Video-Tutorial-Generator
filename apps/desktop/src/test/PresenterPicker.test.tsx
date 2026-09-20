import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PresenterPicker, type PresenterChoice } from "../PresenterPicker";
import type { PresenterSelection } from "../types";

const choices: PresenterChoice[] = [
  { id: "emma", label: "Emma · casual tutor", src: "emma.png", focalPoint: "50% 20%", style: "Natural portrait", background: "Home study", styleGroup: "Realistic", filterTags: ["conversation"], portraitArtifactHash: "a".repeat(64), lipSync: {
    preferredEngineId: "liveportrait-musetalk-1.5",
    qualifications: [{ engineId: "liveportrait-musetalk-1.5", displayName: "LivePortrait + MuseTalk 1.5", outcome: "reviewed-compatible", notes: "Reviewed." }],
  } },
  { id: "yuki", label: "Yuki · anime tutor", src: "yuki.png", focalPoint: "50% 20%", style: "Anime", background: "Study room", styleGroup: "Anime" },
  { id: "pip", label: "Pip · robot tutor", src: "pip.png", focalPoint: "50% 20%", style: "Cartoon robot", background: "Workshop", styleGroup: "Character" },
  { id: "milo", label: "Milo · cat tutor", src: "milo.png", focalPoint: "50% 20%", style: "Storybook animal", background: "Reading nook", styleGroup: "Animal", portraitArtifactHash: "b".repeat(64), lipSync: {
    preferredEngineId: "joyvasa-animal",
    qualifications: [
      { engineId: "liveportrait-musetalk-1.5", displayName: "LivePortrait + MuseTalk 1.5", outcome: "incompatible", notes: "Human-face route is not valid for this animal." },
      { engineId: "joyvasa-animal", displayName: "JoyVASA animal route", outcome: "pending-review", notes: "Review is pending." },
    ],
  } },
  { id: "legacy", label: "Legacy guide", src: "legacy.png", focalPoint: "50% 20%" },
];

const value: PresenterSelection = { schemaVersion: 1, mode: "on", presenters: [], sceneAssignments: [] };

describe("PresenterPicker", () => {
  it("filters animals and characters through explicit catalog groups", async () => {
    const user = userEvent.setup();
    render(<PresenterPicker choices={choices} value={value} onChange={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText("Presenter visual style"), "Animal");
    expect(screen.getByRole("button", { name: "Select Milo · cat tutor" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select Pip · robot tutor" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Presenter visual style"), "Character");
    expect(screen.getByRole("button", { name: "Select Pip · robot tutor" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select Milo · cat tutor" })).not.toBeInTheDocument();
  });

  it("keeps uncategorized legacy portraits available under Other styles", async () => {
    const user = userEvent.setup();
    render(<PresenterPicker choices={choices} value={value} onChange={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("Presenter visual style"), "Other");
    expect(screen.getByRole("button", { name: "Select Legacy guide" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select Yuki · anime tutor" })).not.toBeInTheDocument();
  });

  it("includes catalog tags in search without inferring the visual group", async () => {
    const user = userEvent.setup();
    render(<PresenterPicker choices={choices} value={value} onChange={vi.fn()} />);
    await user.type(screen.getByLabelText("Search presenters"), "conversation");
    expect(screen.getByRole("button", { name: "Select Emma · casual tutor" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select Yuki · anime tutor" })).not.toBeInTheDocument();
  });

  it("keeps a pending animal available as a static portrait when lip-sync is off", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PresenterPicker choices={choices} value={value} onChange={onChange} />);

    expect(screen.getByRole("button", { name: "Select Milo · cat tutor" })).toBeEnabled();
    expect(screen.getByText("Static ready")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Select Milo · cat tutor" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      presenters: [expect.objectContaining({ portraitAssetId: "milo" })],
    }));
  });

  it("blocks an animal from silently entering the active MuseTalk route", () => {
    render(<PresenterPicker
      choices={choices}
      value={value}
      onChange={vi.fn()}
      runtime={{ activeEngineId: "liveportrait-musetalk-1.5", portraitStatuses: [{ portraitArtifactHash: null, modelId: "liveportrait-musetalk-1.5", configured: true, reason: "Primary route configured." }] }}
    />);

    expect(screen.getByRole("button", { name: "Select Emma · casual tutor" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Select Milo · cat tutor" })).toBeDisabled();
    expect(screen.getByText("Animated speech ready")).toBeInTheDocument();
    expect(screen.getByText("Static only")).toBeInTheDocument();
  });

  it("keeps a reviewed portrait blocked until its managed runtime is actually ready", () => {
    render(<PresenterPicker
      choices={choices}
      value={value}
      onChange={vi.fn()}
      runtime={{ activeEngineId: "liveportrait-musetalk-1.5", portraitStatuses: [] }}
    />);

    const emma = screen.getByRole("button", { name: "Select Emma · casual tutor" });
    expect(emma).toBeDisabled();
    expect(emma).toHaveAttribute("title", expect.stringMatching(/exact local route is not configured on this PC/i));
    expect(screen.getByText("Runtime required")).toBeInTheDocument();
  });

  it("lets the user remove a persisted incompatible selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PresenterPicker
      choices={choices}
      value={{ ...value, presenters: [{ presenterId: "milo", portraitAssetId: "milo" }] }}
      onChange={onChange}
      runtime={{ activeEngineId: "liveportrait-musetalk-1.5", portraitStatuses: [{ portraitArtifactHash: "b".repeat(64), modelId: "joyvasa-animal", configured: true, reason: "Configured." }] }}
    />);

    const milo = screen.getByRole("button", { name: "Select Milo · cat tutor" });
    expect(milo).toBeEnabled();
    await user.click(milo);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ presenters: [] }));
  });
});
