import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelLibrary } from "../ModelLibrary";
import { ModelRoutingSettings } from "../ModelRoutingSettings";
import { stageCatalogWritingModel } from "../writingProfile";
import type { RoutingProfile } from "../types";
import { catalogFixture, contextFixture, hardwareFixture } from "./fixtures";

const profile: RoutingProfile = {
  schemaVersion: 1,
  id: "test-profile",
  name: "Test profile",
  description: "Catalog component test",
  routes: [{ capability: "image.generate", enabled: true, fallbackConsent: false, selections: [] }],
  updatedAt: "2026-09-05T00:00:00.000Z",
};

describe("catalog selection controls", () => {
  it("renders large result sets in responsive batches without hiding the exact total", async () => {
    const user = userEvent.setup();
    const items = Array.from({ length: 30 }, (_, index) => catalogFixture({
      name: `Catalog model ${String(index + 1).padStart(2, "0")}`,
      sourceId: `fixture/model-${index + 1}`,
    }));
    const { container } = render(<ModelLibrary items={items} compatibilityContext={contextFixture()} />);

    expect(screen.getAllByRole("heading", { name: /Catalog model/ })).toHaveLength(6);
    expect(container.querySelector(".aly-catalog-results-heading p")?.textContent).toContain("30 models");
    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 6 of 30 matching models.");

    await user.click(screen.getByRole("button", { name: "Show 6 more" }));
    expect(screen.getAllByRole("heading", { name: /Catalog model/ })).toHaveLength(12);

    await user.type(screen.getByRole("searchbox", { name: "Search models" }), "Catalog model 30");
    expect(screen.getAllByRole("heading", { name: /Catalog model/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Show .* more/ })).not.toBeInTheDocument();
  });

  it("shows only catalog actions that have a working callback", async () => {
    const user = userEvent.setup();
    const item = catalogFixture({ name: "Inspectable model" });
    const onInspect = vi.fn();
    const { rerender } = render(
      <ModelLibrary
        items={[item]}
        compatibilityContext={contextFixture()}
        onInspect={onInspect}
      />,
    );

    expect(screen.queryByRole("button", { name: "Select model" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Inspect details" }));
    expect(onInspect).toHaveBeenCalledWith(item);

    rerender(<ModelLibrary items={[item]} compatibilityContext={contextFixture()} />);
    expect(screen.queryByRole("button", { name: "Inspect details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select model" })).not.toBeInTheDocument();
  });

  it("stages a compatible connected cloud writing model and blocks it without the connection", async () => {
    const user = userEvent.setup();
    const item = catalogFixture({
      name: "GPT-OSS 120B on Groq",
      sourceId: "openai/gpt-oss-120b",
      providerId: "groq",
      capabilities: ["llm.text", "llm.structured"],
      boundaries: ["cloud"],
    });
    const onUseForWritingProfile = vi.fn();
    const { rerender } = render(
      <ModelLibrary
        items={[item]}
        compatibilityContext={contextFixture({ capability: null, hardware: hardwareFixture({ providerConnectionIds: ["groq"] }) })}
        onUseForWritingProfile={onUseForWritingProfile}
        writingProfileProviderIds={["groq"]}
      />,
    );

    const action = screen.getByRole("button", { name: "Use in writing profile" });
    expect(action).toBeEnabled();
    await user.click(action);
    expect(onUseForWritingProfile).toHaveBeenCalledWith(item);
    expect(stageCatalogWritingModel({
      id: "creation-profile",
      name: "Creation profile",
      description: "Saved model choices",
      routes: { writing: { providerId: "local-runtime", modelId: "local/qwen" } },
    }, item).routes.writing).toEqual({
      providerId: "groq",
      modelId: "openai/gpt-oss-120b",
      modelRevision: "rev-1",
      installFingerprint: null,
    });

    rerender(
      <ModelLibrary
        items={[item]}
        compatibilityContext={contextFixture({ capability: null, hardware: hardwareFixture({ providerConnectionIds: [] }) })}
        onUseForWritingProfile={onUseForWritingProfile}
        writingProfileProviderIds={["groq"]}
      />,
    );
    expect(screen.getByRole("button", { name: "Use in writing profile" })).toBeDisabled();
    rerender(
      <ModelLibrary
        items={[{ ...item, classification: { ...item.classification, capabilities: ["llm.text"] } }]}
        compatibilityContext={contextFixture({ capability: null, hardware: hardwareFixture({ providerConnectionIds: ["groq"] }) })}
        onUseForWritingProfile={onUseForWritingProfile}
        writingProfileProviderIds={["groq"]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Use in writing profile" })).not.toBeInTheDocument();
  });

  it("prevents an uninstalled local catalog result from being added to a route", () => {
    render(
      <ModelLibrary
        items={[catalogFixture({ availability: "downloadable", localInstall: null })]}
        compatibilityContext={contextFixture()}
        onAddToRoute={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Add to route" })).toBeDisabled();
    expect(screen.getByText("This catalog item has no verified local installation.")).toBeInTheDocument();
  });

  it("labels and disables route choices that have not passed compatibility", () => {
    const blocked = catalogFixture({ name: "Needs install", availability: "downloadable", localInstall: null });
    render(
      <ModelRoutingSettings
        profile={profile}
        items={[blocked]}
        contextFor={() => contextFixture()}
        onChange={vi.fn()}
      />,
    );

    const option = screen.getByRole("option", { name: /Needs install.*needs-setup/ });
    expect(option).toBeDisabled();
  });

  it("adds optional stock and visual-review routes without changing older profiles", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ModelRoutingSettings
        profile={profile}
        items={[]}
        contextFor={() => contextFixture()}
        onChange={onChange}
        now={() => "2026-09-05T12:00:00.000Z"}
      />,
    );

    expect(screen.getByRole("heading", { name: "Add sources only when this project needs them" })).toBeInTheDocument();
    expect(screen.getByText("Optional finishing tools")).toBeInTheDocument();
    expect(profile.routes.map((route) => route.capability)).toEqual(["image.generate"]);

    await user.click(screen.getByRole("button", { name: "Add stock image search" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      routes: expect.arrayContaining([
        expect.objectContaining({
          capability: "media.licensed.search",
          enabled: true,
          fallbackConsent: false,
          selections: [],
        }),
      ]),
      updatedAt: "2026-09-05T12:00:00.000Z",
    }));
  });

  it("uses readable names for configured optional route selectors", () => {
    render(
      <ModelRoutingSettings
        profile={{
          ...profile,
          routes: [
            ...profile.routes,
            { capability: "media.licensed.search", enabled: true, fallbackConsent: false, selections: [] },
            { capability: "vlm.chat", enabled: true, fallbackConsent: false, selections: [] },
          ],
        }}
        items={[]}
        contextFor={() => contextFixture()}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Stock image search" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Visual review" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Choose a stock source…" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Choose a visual review model…" })).toBeInTheDocument();
  });

  it("offers the anonymous Openverse catalog route without credential setup", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const openverse = catalogFixture({
      name: "Openverse CC0 image search",
      source: "cloud",
      sourceId: "licensed-media",
      providerId: "openverse",
      capabilities: ["media.licensed.search"],
      boundaries: ["cloud"],
      availability: "available",
    });
    render(
      <ModelRoutingSettings
        profile={{
          ...profile,
          routes: [{ capability: "media.licensed.search", enabled: true, fallbackConsent: false, selections: [] }],
        }}
        items={[openverse]}
        contextFor={() => contextFixture({ capability: "media.licensed.search" })}
        onChange={onChange}
        now={() => "2026-09-05T12:00:00.000Z"}
      />,
    );

    const option = screen.getByRole("option", { name: /Openverse CC0 image search.*cloud/ });
    expect(option).toBeEnabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "Add model" }), option);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      routes: [expect.objectContaining({
        capability: "media.licensed.search",
        selections: [expect.objectContaining({ providerId: "openverse", sourceId: "licensed-media" })],
      })],
    }));
  });
});
