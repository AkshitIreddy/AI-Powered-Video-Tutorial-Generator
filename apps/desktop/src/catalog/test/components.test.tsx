import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelLibrary } from "../ModelLibrary";
import { ModelRoutingSettings } from "../ModelRoutingSettings";
import { CatalogIntegrationExample } from "../CatalogIntegrationExample";
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
  it("integrates only operative catalog actions instead of temporary route and resource editors", () => {
    render(
      <CatalogIntegrationExample
        hardware={hardwareFixture()}
        items={[catalogFixture({ name: "Managed local model", availability: "downloadable" })]}
        onModelDownload={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Managed local model" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compare routes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Estimate resources" })).not.toBeInTheDocument();
  });

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

  it("puts actionable models first by default while preserving explicit search and sort", async () => {
    const user = userEvent.setup();
    const unsupported = catalogFixture({ name: "Alpha unsupported", sourceId: "local/unsupported", availability: "downloadable" });
    const cloud = catalogFixture({
      name: "Middle cloud writer",
      sourceId: "openai/gpt-oss-20b",
      providerId: "groq",
      capabilities: ["llm.text", "llm.structured"],
      boundaries: ["cloud"],
      availability: "available",
    });
    const downloadable = catalogFixture({ name: "Zulu downloadable", sourceId: "local/downloadable", availability: "downloadable" });
    render(
      <ModelLibrary
        items={[unsupported, cloud, downloadable]}
        compatibilityContext={contextFixture({ capability: null, hardware: hardwareFixture({ providerConnectionIds: ["groq"] }) })}
        onDownload={vi.fn()}
        downloadState={(item) => item === downloadable
          ? { label: "Download", disabled: false }
          : { label: "Download unavailable", disabled: true }}
        onUseForWritingProfile={vi.fn()}
        writingProfileProviderIds={["groq"]}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Zulu downloadable",
      "Middle cloud writer",
      "Alpha unsupported",
    ]);

    await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "name");
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Alpha unsupported",
      "Middle cloud writer",
      "Zulu downloadable",
    ]);

    await user.type(screen.getByRole("searchbox", { name: "Search models" }), "Zulu");
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["Zulu downloadable"]);
  });

  it("uses Download as the primary local-model action and keeps details secondary", async () => {
    const user = userEvent.setup();
    const item = catalogFixture({ name: "Downloadable model", availability: "downloadable" });
    const onDownload = vi.fn();
    const { rerender } = render(
      <ModelLibrary
        items={[item]}
        compatibilityContext={contextFixture()}
        onDownload={onDownload}
      />,
    );

    expect(screen.queryByRole("button", { name: "Select model" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inspect details" })).not.toBeInTheDocument();
    expect(screen.getByText("Technical details")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Download" })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Downloadable model" }).closest(".aly-catalog-card")?.querySelector(".aly-catalog-download-state")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(onDownload).toHaveBeenCalledWith(item);

    rerender(<ModelLibrary items={[item]} compatibilityContext={contextFixture()} />);
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select model" })).not.toBeInTheDocument();
  });

  it("keeps managed progress compact and moves long package notes into technical details", async () => {
    const user = userEvent.setup();
    const longPackageNote = "Verified artifact C:\\Users\\Akshit\\AppData\\Local\\Alystria\\models\\stable-diffusion-xl-base-1.0\\sd_xl_base_1.0_0.9vae.safetensors is ready.";
    const downloading = catalogFixture({ name: "Downloading model", sourceId: "local/downloading", availability: "downloadable" });
    const unavailable = catalogFixture({ name: "Unmanaged model", sourceId: "local/unmanaged", availability: "downloadable" });
    render(
      <ModelLibrary
        items={[downloading, unavailable]}
        compatibilityContext={contextFixture()}
        onDownload={vi.fn()}
        downloadState={(item) => item.identity.sourceId === "local/downloading"
          ? { label: "Downloading 42%", disabled: true, detail: longPackageNote, progressPercent: 42 }
          : { label: "Download unavailable", disabled: true, detail: "No verified package exists for this model." }}
      />,
    );

    expect(screen.getByText("Downloading")).toBeVisible();
    expect(screen.getByText("42% downloaded")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Downloading 42%" })).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Downloading model download progress" })).toHaveAttribute("value", "42");
    expect(screen.getByText(longPackageNote)).not.toBeVisible();
    expect(screen.getByText("Download unavailable")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Download unavailable" })).not.toBeInTheDocument();
    const packageNote = screen.getByText("No verified package exists for this model.");
    expect(packageNote).not.toBeVisible();
    const unavailableCard = screen.getByRole("heading", { name: "Unmanaged model" }).closest<HTMLElement>(".aly-catalog-card")!;
    await user.click(within(unavailableCard).getByText("Technical details"));
    expect(packageNote).toBeVisible();
  });

  it("uses one progress action and keeps raw local diagnostics inside technical details", async () => {
    const user = userEvent.setup();
    const path = "C:\\Users\\Akshit\\AppData\\Local\\Alystria\\models\\stable-diffusion-xl-base-1.0\\sd_xl_base_1.0_0.9vae.safetensors";
    const fingerprint = "b".repeat(64);
    const item = catalogFixture({
      name: "Long local package",
      availability: "installed",
      localInstall: { path, fingerprint, installedAt: "2026-09-21T00:00:00Z", lastVerifiedAt: "2026-09-21T00:00:00Z", status: "verified" },
    });
    render(
      <ModelLibrary
        items={[item]}
        compatibilityContext={contextFixture()}
        onDownload={vi.fn()}
        downloadState={() => ({
          label: "Downloading · view progress",
          disabled: false,
          detail: `Verifying artifact ${path} with sha256:${fingerprint}.`,
          progressPercent: 100,
        })}
      />,
    );

    const card = screen.getByRole("heading", { name: "Long local package" }).closest<HTMLElement>(".aly-catalog-card")!;
    expect(within(card).getByText("Verifying package")).toBeVisible();
    expect(within(card).getByText("Download complete · checking files")).toBeVisible();
    expect(within(card).getByRole("button", { name: "View progress" })).toBeEnabled();
    expect(within(card).queryByText(path)).not.toBeVisible();
    expect(within(card).queryByText(fingerprint)).not.toBeVisible();
    expect(within(card).queryByText(/sha256:/i)).not.toBeVisible();

    await user.click(within(card).getByText("Technical details"));
    expect(within(card).getByText(path)).toBeVisible();
    expect(within(card).getByText(fingerprint)).toBeVisible();
    expect(within(card).getByText(/Verifying artifact/)).toBeVisible();
  });

  it("shows the native install phase instead of inferring verification from 100% downloaded", () => {
    const item = catalogFixture({ name: "Installing presenter runtime", availability: "downloadable" });
    render(
      <ModelLibrary
        items={[item]}
        compatibilityContext={contextFixture()}
        onDownload={vi.fn()}
        downloadState={() => ({
          label: "Installing · view progress",
          disabled: false,
          detail: "Building the portable environment from the verified local wheelhouse.",
          progressPercent: 100,
          phase: "installing",
        })}
      />,
    );

    const card = screen.getByRole("heading", { name: "Installing presenter runtime" }).closest<HTMLElement>(".aly-catalog-card")!;
    expect(within(card).getByText("Installing model")).toBeVisible();
    expect(within(card).getByText("Download complete · installing locally")).toBeVisible();
    expect(within(card).queryByText("Verifying package")).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "View progress" })).toBeEnabled();
  });

  it("never offers a download action for a cloud-only model", () => {
    const cloud = catalogFixture({
      name: "Cloud model",
      providerId: "groq",
      capabilities: ["llm.text", "llm.structured"],
      boundaries: ["cloud"],
      availability: "available",
    });
    render(
      <ModelLibrary
        items={[cloud]}
        compatibilityContext={contextFixture({ capability: null, hardware: hardwareFixture({ providerConnectionIds: ["groq"] }) })}
        onDownload={vi.fn()}
        downloadState={() => ({ label: "Download", disabled: false })}
      />,
    );

    const card = screen.getByRole("heading", { name: "Cloud model" }).closest<HTMLElement>(".aly-catalog-card")!;
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
    expect(within(card).getByText("Writing")).toBeVisible();
    expect(within(card).getByText("Structured output")).toBeVisible();
    expect(within(card).queryByText("llm.text")).not.toBeInTheDocument();
    expect(within(card).getByText("Cloud API")).toBeVisible();
    expect(within(card).queryByText("VRAM estimate")).not.toBeInTheDocument();
    expect(within(card).queryByText("Usable path")).not.toBeInTheDocument();
    expect(within(card).queryByText("Size not listed")).not.toBeInTheDocument();
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
    const setupReason = screen.getByText("This catalog item has no verified local installation.");
    expect(setupReason).not.toBeVisible();
    expect(screen.getByText("Technical details")).toBeVisible();
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
