import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StockImageSearch } from "../StockImageSearch";
import { stockSearchRoutes } from "../stockSearchRoutes";

const policy = { routes: [{ capability: "media.licensed.search", providerIds: ["openverse"] }, { capability: "vlm.chat", providerIds: ["nvidia-nim"] }] };

describe("optional stock photo search", () => {
  it("offers no implicit provider for missing, malformed, or unsupported routes", () => {
    expect(stockSearchRoutes(null)).toEqual({ providers: [], hasReviewer: false });
    expect(stockSearchRoutes({ routes: [null, { capability: "media.licensed.search", providerIds: ["unknown"] }] })).toEqual({ providers: [], hasReviewer: false });
  });
  it("explains setup until both routes are present", () => {
    render(<StockImageSearch sceneId="s1" suggestedQuery="Clouds" busy={false} policy={{ routes: [policy.routes[0]] }} onSearch={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Find and review photos" })).not.toBeInTheDocument();
    expect(screen.getByText(/Choose optional Stock photos/)).toBeInTheDocument();
  });
  it("submits only the approved provider with the edited search and blocks duplicates", () => {
    const search = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<StockImageSearch sceneId="s1" suggestedQuery="Clouds" busy={false} policy={policy} onSearch={search} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Photo search" }), { target: { value: " cumulus sky " } });
    fireEvent.click(screen.getByRole("button", { name: "Find and review photos" }));
    expect(search).toHaveBeenCalledExactlyOnceWith("openverse", "cumulus sky");
    rerender(<StockImageSearch sceneId="s1" suggestedQuery="Clouds" busy policy={policy} onSearch={search} />);
    expect(screen.getByRole("button", { name: "Finding pictures…" })).toBeDisabled();
  });
});
