import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelLibrary } from "../ModelLibrary";
import { ModelRoutingSettings } from "../ModelRoutingSettings";
import type { RoutingProfile } from "../types";
import { catalogFixture, contextFixture } from "./fixtures";

const profile: RoutingProfile = {
  schemaVersion: 1,
  id: "test-profile",
  name: "Test profile",
  description: "Catalog component test",
  routes: [{ capability: "image.generate", enabled: true, fallbackConsent: false, selections: [] }],
  updatedAt: "2026-09-05T00:00:00.000Z",
};

describe("catalog selection controls", () => {
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
