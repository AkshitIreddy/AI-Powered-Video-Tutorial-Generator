import { describe, expect, it } from "vitest";
import { emptyCatalogFilters } from "../types";
import { filterCatalogItems, parseCatalogQuery } from "../query";
import { catalogFixture, contextFixture, GIB } from "./fixtures";

describe("catalog query grammar", () => {
  it("parses quoted text, exclusions, fields, and numeric operators", () => {
    const parsed = parseCatalogQuery('"flux dev" source:hugging-face -gated:true vram<=12GB');
    expect(parsed.errors).toEqual([]);
    expect(parsed.terms).toEqual([
      expect.objectContaining({ kind: "text", value: "flux dev", negated: false }),
      expect.objectContaining({ field: "source", value: "hugging-face", operator: ":" }),
      expect.objectContaining({ field: "gated", value: "true", negated: true }),
      expect.objectContaining({ field: "vram", value: "12GB", operator: "<=" }),
    ]);
  });

  it("reports invalid fields and unsupported operators without turning them into text", () => {
    const parsed = parseCatalogQuery("mystery:value source>local license:");
    expect(parsed.terms).toHaveLength(0);
    expect(parsed.errors.map((error) => error.message)).toEqual([
      expect.stringContaining("Unknown query field"),
      expect.stringContaining("only supports"),
      expect.stringContaining("needs a value"),
    ]);
  });
});

describe("catalog filtering", () => {
  const local = catalogFixture({ name: "Local Flux", source: "local", sourceId: "local/flux", estimatedVramBytes: 8 * GIB, downloads: 20 });
  const hosted = catalogFixture({ name: "Hosted Voice", source: "cloud", sourceId: "cloud/voice", providerId: "cloud-provider", capabilities: ["audio.tts"], boundaries: ["cloud"], runtimes: [], estimatedVramBytes: null, downloads: 500 });
  const gated = catalogFixture({ name: "Gated Flux", source: "hugging-face", sourceId: "vendor/gated", providerId: "hugging-face", gated: true, termsAccepted: false, estimatedVramBytes: 14 * GIB, downloads: 1000 });

  it("combines free text, source fields, negation, and byte comparisons", () => {
    const results = filterCatalogItems([local, hosted, gated], {
      query: "flux vram<=10GiB -gated:true",
      context: contextFixture(),
    });
    expect(results.map(({ item }) => item.identity.name)).toEqual(["Local Flux"]);
  });

  it("applies structured filters conservatively when requirement metadata is unknown", () => {
    const results = filterCatalogItems([local, hosted, gated], {
      filters: { ...emptyCatalogFilters, sources: ["local", "cloud"], maxVramBytes: 10 * GIB },
      context: contextFixture(),
    });
    expect(results.map(({ item }) => item.identity.name)).toEqual(["Local Flux"]);
  });

  it("filters verified installs and safetensors independently", () => {
    const installed = catalogFixture({
      name: "Installed",
      source: "local",
      sourceId: "local/installed",
      localInstall: { path: "E:\\models\\installed", fingerprint: "abc", installedAt: null, lastVerifiedAt: null, status: "verified" },
    });
    const unsafe = catalogFixture({ name: "Pickle", sourceId: "local/pickle", safetensors: false });
    const results = filterCatalogItems([installed, unsafe], {
      filters: { ...emptyCatalogFilters, installedOnly: true, safeTensorsOnly: true },
      context: contextFixture(),
    });
    expect(results.map(({ item }) => item.identity.name)).toEqual(["Installed"]);
  });

  it("sorts deterministically by a selected metric and then name", () => {
    const alpha = catalogFixture({ name: "Alpha", sourceId: "a", downloads: 50 });
    const beta = catalogFixture({ name: "Beta", sourceId: "b", downloads: 50 });
    const gamma = catalogFixture({ name: "Gamma", sourceId: "c", downloads: 500 });
    const results = filterCatalogItems([beta, alpha, gamma], { sort: "downloads", context: contextFixture() });
    expect(results.map(({ item }) => item.identity.name)).toEqual(["Gamma", "Alpha", "Beta"]);
  });
});
