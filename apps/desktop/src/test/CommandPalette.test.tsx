import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../CommandPalette";
import type { ProjectRecord } from "../types";

function project(id: string, title: string): ProjectRecord {
  return {
    id,
    title,
    topic: `${title} topic`,
    description: "A test tutorial",
    locale: "English",
    audience: "Learners",
    duration: 5,
    updatedAt: "just now",
    progress: 20,
    status: "Planning",
    theme: "Test",
    privacy: "Local only",
    scenes: [],
    sources: [],
  };
}

describe("CommandPalette", () => {
  it("opens the selected project with Enter and exposes listbox selection", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<CommandPalette projects={[project("one", "First lesson"), project("two", "Second lesson")]} onClose={vi.fn()} onNavigate={vi.fn()} onOpen={onOpen} />);

    const search = screen.getByRole("combobox", { name: "Search projects and areas" });
    const options = screen.getAllByRole("option");
    expect(search).toHaveAttribute("aria-activedescendant", options[0]!.id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onOpen).toHaveBeenCalledWith("two");
  });

  it("filters destinations and runs the matching navigation command", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<CommandPalette projects={[project("one", "First lesson")]} onClose={vi.fn()} onNavigate={onNavigate} onOpen={vi.fn()} />);

    await user.type(screen.getByRole("combobox", { name: "Search projects and areas" }), "settings");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{Enter}");

    expect(onNavigate).toHaveBeenCalledWith("diagnostics");
  });

  it("wraps keyboard selection and closes with Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    render(<CommandPalette projects={[]} onClose={onClose} onNavigate={onNavigate} onOpen={vi.fn()} />);

    await user.keyboard("{ArrowUp}{Enter}");
    expect(onNavigate).toHaveBeenCalledWith("diagnostics");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("reports an empty result without running a stale command", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onNavigate = vi.fn();
    render(<CommandPalette projects={[project("one", "First lesson")]} onClose={vi.fn()} onNavigate={onNavigate} onOpen={onOpen} />);

    await user.type(screen.getByRole("combobox", { name: "Search projects and areas" }), "no match anywhere");
    expect(screen.getByRole("status")).toHaveTextContent("No projects or areas match");
    await user.keyboard("{Enter}");
    expect(onOpen).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
