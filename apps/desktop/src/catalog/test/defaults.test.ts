import { describe, expect, it } from "vitest";
import {
  assertCompleteSourceRegistry,
  createDefaultCompatibilityContext,
  createDefaultRoutingProfile,
  createUnprobedHardwareSnapshot,
  defaultCatalogItems,
  defaultCatalogSources,
} from "../defaults";
import { catalogCapabilities, catalogSources } from "../types";

describe("catalog integration defaults", () => {
  it("covers every federated source exactly once", () => {
    expect(() => assertCompleteSourceRegistry()).not.toThrow();
    expect(defaultCatalogSources.map((source) => source.id)).toEqual(catalogSources);
    expect(new Set(defaultCatalogSources.map((source) => source.id)).size).toBe(catalogSources.length);
  });

  it("starts without fabricated remote model rows", () => {
    expect(defaultCatalogItems).toEqual([]);
    expect(Object.isFrozen(defaultCatalogItems)).toBe(true);
  });

  it("creates disabled, empty routes with cloud fallback consent off", () => {
    const profile = createDefaultRoutingProfile(catalogCapabilities, "2026-09-02T00:00:00.000Z");
    expect(profile.routes).toHaveLength(catalogCapabilities.length);
    expect(profile.routes.every((route) => !route.enabled && !route.fallbackConsent && route.selections.length === 0)).toBe(true);
    expect(profile.updatedAt).toBe("2026-09-02T00:00:00.000Z");
  });

  it("keeps unprobed hardware unknown and license handling conservative", () => {
    const hardware = createUnprobedHardwareSnapshot("2026-09-02T00:00:00.000Z");
    const context = createDefaultCompatibilityContext({ hardware });
    expect(hardware.gpuVendor).toBe("unknown");
    expect(hardware.dedicatedVramBytes).toBeNull();
    expect(context.allowUnknownLicenseForPrivateUse).toBe(false);
    expect(context.allowedBoundaries).toEqual(["local", "cloud"]);
  });

  it("rejects an incomplete or duplicate source registry", () => {
    expect(() => assertCompleteSourceRegistry(defaultCatalogSources.slice(1))).toThrow(/Missing/);
    expect(() => assertCompleteSourceRegistry([...defaultCatalogSources, defaultCatalogSources[0]!])).toThrow(/duplicate/);
  });
});
