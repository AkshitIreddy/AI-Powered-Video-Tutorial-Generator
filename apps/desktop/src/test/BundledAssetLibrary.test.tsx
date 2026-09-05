import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BundledAssetLibrary } from "../BundledAssetLibrary";

describe("included offline asset browser", () => {
  it("browses included elements without implying an API dependency", () => {
    render(<BundledAssetLibrary />);
    expect(screen.getAllByRole("img")).toHaveLength(12);
    expect(screen.getByText(/needs no account, API key, or network request/u)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Download" })).toHaveLength(12);
    expect(screen.queryByRole("button", { name: /Use element/u })).not.toBeInTheDocument();
  });

  it("searches and filters by asset kind and subject", async () => {
    const user = userEvent.setup();
    render(<BundledAssetLibrary />);
    await user.type(screen.getByPlaceholderText(/Search science/u), "computer");
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Computer workbench" })).toBeInTheDocument();
    await user.clear(screen.getByPlaceholderText(/Search science/u));
    await user.click(screen.getByRole("button", { name: "Slide backgrounds" }));
    expect(screen.getAllByRole("img")).toHaveLength(4);
    expect(screen.getByRole("heading", { name: "Warm paper canvas" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Teaching elements" }));
    expect(screen.getAllByRole("img")).toHaveLength(8);
    await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "Computing");
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Computer workbench" })).toBeInTheDocument();
  });

  it("reports project-use success and errors from the async integration callback", async () => {
    const user = userEvent.setup();
    const onUse = vi.fn(async () => undefined);
    const { rerender } = render(<BundledAssetLibrary onUse={onUse} />);
    await user.click(screen.getAllByRole("button", { name: "Use background" })[0]!);
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ id: "slide-paper" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/is in the project library/u);

    rerender(<BundledAssetLibrary onUse={async () => { throw new Error("The project changed. Reload and try again."); }} />);
    await user.click(screen.getAllByRole("button", { name: "Use element" })[1]!);
    expect(await screen.findByRole("alert")).toHaveTextContent("The project changed. Reload and try again.");
  });
});
