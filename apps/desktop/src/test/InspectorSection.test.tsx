import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { InspectorSection } from "../InspectorSection";

describe("InspectorSection", () => {
  it("starts expanded and toggles its content as an accessible disclosure", async () => {
    const user = userEvent.setup();
    render(<InspectorSection title="Scene identity"><label>Title<input /></label></InspectorSection>);

    const disclosure = screen.getByRole("button", { name: "Scene identity" });
    const content = document.getElementById(disclosure.getAttribute("aria-controls")!);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(content).not.toHaveAttribute("hidden");

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(content).toHaveAttribute("hidden");

    await user.keyboard("{Enter}");
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(content).not.toHaveAttribute("hidden");
  });

  it("keeps separate sections independently collapsible", async () => {
    const user = userEvent.setup();
    render(<><InspectorSection title="First"><span>First content</span></InspectorSection><InspectorSection title="Second"><span>Second content</span></InspectorSection></>);

    await user.click(screen.getByRole("button", { name: "First" }));
    expect(screen.getByRole("button", { name: "First" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Second" })).toHaveAttribute("aria-expanded", "true");
  });
});
