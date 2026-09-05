import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CreativeInspector } from "../creative/CreativeInspector";
import { DEFAULT_CREATIVE_CONFIGURATION } from "../creative/defaults";
import type { CreativeConfiguration } from "../types";

function Harness({ scene, presenter }: { scene: () => void; presenter: () => void }) {
  const [configuration, setConfiguration] = useState<CreativeConfiguration>(() => structuredClone(DEFAULT_CREATIVE_CONFIGURATION));
  return <CreativeInspector configuration={configuration} onChange={setConfiguration} onQueueVisualReview={scene} onGeneratePresenter={presenter} />;
}

describe("creative generation controls", () => {
  it("offers configured providers and only enables the pinned LoRA for local SDXL", async () => {
    const user = userEvent.setup();
    const scene = vi.fn();
    const presenter = vi.fn();
    render(<Harness scene={scene} presenter={presenter} />);

    expect(screen.queryByRole("button", { name: /generate scene artwork/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /illustrated canvas/i }));
    const route = screen.getByRole("combobox", { name: /image route/i });
    const lora = screen.getByRole("checkbox", { name: /official sdxl offset lora/i });
    expect(route).toHaveValue("tutorial-route");
    expect(lora).toBeDisabled();
    expect(screen.getByRole("textbox", { name: /artwork direction/i })).toHaveValue("Calm, text-free educational background with clear central negative space for the lesson content");
    expect(screen.queryByRole("checkbox", { name: /keep text deterministic/i })).not.toBeInTheDocument();

    await user.selectOptions(route, "local/sdxl-base-1.0");
    expect(lora).toBeEnabled();
    await user.click(lora);
    await user.click(screen.getByRole("button", { name: /generate scene artwork/i }));
    expect(scene).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("tab", { name: /presenter recipe/i }));
    expect(screen.queryByText(/visual review recipe/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /negative direction/i })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: /image route/i }), "local/sdxl-base-1.0");
    expect(screen.getByRole("textbox", { name: /negative direction/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /generate presenter portrait/i }));
    expect(presenter).toHaveBeenCalledOnce();
  });
});
