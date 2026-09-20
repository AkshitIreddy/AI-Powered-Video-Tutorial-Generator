import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PresenterPicker, type PresenterChoice } from "../PresenterPicker";
import type { PresenterSelection } from "../types";

const choices: PresenterChoice[] = [
  { id: "emma", label: "Emma · casual tutor", src: "emma.png", focalPoint: "50% 20%", style: "Natural portrait", background: "Home study", styleGroup: "Realistic", filterTags: ["conversation"] },
  { id: "yuki", label: "Yuki · anime tutor", src: "yuki.png", focalPoint: "50% 20%", style: "Anime", background: "Study room", styleGroup: "Anime" },
  { id: "pip", label: "Pip · robot tutor", src: "pip.png", focalPoint: "50% 20%", style: "Cartoon robot", background: "Workshop", styleGroup: "Character" },
  { id: "milo", label: "Milo · cat tutor", src: "milo.png", focalPoint: "50% 20%", style: "Storybook animal", background: "Reading nook", styleGroup: "Animal" },
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
});
