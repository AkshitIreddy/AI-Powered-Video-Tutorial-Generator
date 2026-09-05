import { describe, expect, it } from "vitest";
import { evaluateCatalogCompatibility, evaluateLicense } from "../compatibility";
import { catalogFixture, contextFixture, GIB, hardwareFixture } from "./fixtures";

describe("catalog compatibility", () => {
  it("marks a verified, licensed local model ready", () => {
    const result = evaluateCatalogCompatibility(catalogFixture({
      availability: "installed",
      localInstall: { path: "E:\\models\\fixture", fingerprint: "sha", installedAt: null, lastVerifiedAt: null, status: "verified" },
    }), contextFixture());
    expect(result.level).toBe("ready");
    expect(result.canSelect).toBe(true);
    expect(result.license.status).toBe("allowed");
    expect(result.reasons).toEqual([]);
  });

  it("requires setup when a mandatory local runtime is missing", () => {
    const context = contextFixture({ hardware: hardwareFixture({ installedRuntimes: {} }) });
    const result = evaluateCatalogCompatibility(catalogFixture({ availability: "installed", localInstall: { path: "E:\\models\\fixture", fingerprint: "sha", installedAt: null, lastVerifiedAt: null, status: "verified" } }), context);
    expect(result.level).toBe("needs-setup");
    expect(result.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: "runtime-missing" })]));
  });

  it("does not call a downloadable local catalog row ready before installation", () => {
    const result = evaluateCatalogCompatibility(catalogFixture({ availability: "downloadable", localInstall: null }), contextFixture());
    expect(result.level).toBe("needs-setup");
    expect(result.canSelect).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: "local-install-required" })]));
  });

  it("does not demand cloud credentials for a hybrid item with an eligible local path", () => {
    const item = catalogFixture({
      boundaries: ["local", "cloud"],
      providerId: "not-connected",
      availability: "installed",
      localInstall: { path: "E:\\models\\fixture", fingerprint: "sha", installedAt: null, lastVerifiedAt: null, status: "verified" },
    });
    const context = contextFixture({ hardware: hardwareFixture({ providerConnectionIds: [] }) });
    const result = evaluateCatalogCompatibility(item, context);
    expect(result.reasons.map((reason) => reason.code)).not.toContain("credential-required");
    expect(result.selectedBoundary).toBe("local");
  });

  it("uses a connected cloud path when the same hybrid item cannot fit locally", () => {
    const item = catalogFixture({ boundaries: ["local", "cloud"], providerId: "cloud-provider", estimatedVramBytes: 30 * GIB });
    const context = contextFixture({
      hardware: hardwareFixture({ dedicatedVramFreeBytes: 4 * GIB, dxgiBudgetBytes: 4 * GIB, dxgiCurrentUsageBytes: 1 * GIB }),
      resourcePolicy: { ...contextFixture().resourcePolicy, autoAdapt: false },
    });
    const result = evaluateCatalogCompatibility(item, context);
    expect(result.level).toBe("ready");
    expect(result.canSelect).toBe(true);
    expect(result.selectedBoundary).toBe("cloud");
    expect(result.resource.level).toBe("green");
    expect(result.reasons.map((reason) => reason.code)).not.toContain("resource-exceeded");
  });

  it("allows the public Openverse CC0 route without a provider credential", () => {
    const item = catalogFixture({
      source: "cloud",
      sourceId: "licensed-media",
      providerId: "openverse",
      capabilities: ["media.licensed.search"],
      boundaries: ["cloud"],
      availability: "available",
    });
    const result = evaluateCatalogCompatibility(item, contextFixture({
      capability: "media.licensed.search",
      hardware: hardwareFixture({ providerConnectionIds: [] }),
    }));
    expect(result.canSelect).toBe(true);
    expect(result.selectedBoundary).toBe("cloud");
    expect(result.reasons.map((reason) => reason.code)).not.toContain("credential-required");
  });

  it("requires a provider connection for the keyed Pexels route", () => {
    const item = catalogFixture({
      source: "cloud",
      sourceId: "licensed-media",
      providerId: "pexels",
      capabilities: ["media.licensed.search"],
      boundaries: ["cloud"],
      availability: "gated",
    });
    const result = evaluateCatalogCompatibility(item, contextFixture({
      capability: "media.licensed.search",
      hardware: hardwareFixture({ providerConnectionIds: [] }),
    }));
    expect(result.level).toBe("needs-setup");
    expect(result.canSelect).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: "credential-required" })]));
  });

  it("requires setup when neither hybrid path is currently usable", () => {
    const item = catalogFixture({ boundaries: ["local", "cloud"], providerId: "not-connected", runtimes: ["missing-runtime"] });
    const result = evaluateCatalogCompatibility(item, contextFixture({ hardware: hardwareFixture({ providerConnectionIds: [] }) }));
    expect(result.level).toBe("needs-setup");
    expect(result.canSelect).toBe(false);
    expect(result.selectedBoundary).toBe("local");
    expect(result.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: "runtime-missing" })]));
  });

  it("blocks mismatched LoRA base families", () => {
    const item = catalogFixture({ artifactType: "lora", baseFamilies: ["sdxl"], compatibleBaseFamilies: ["sdxl"] });
    const result = evaluateCatalogCompatibility(item, contextFixture({ selectedBaseFamily: "flux.1" }));
    expect(result.level).toBe("blocked");
    expect(result.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: "base-family-mismatch" })]));
  });

  it("blocks unknown rights for commercial distribution", () => {
    const item = catalogFixture({ licenseStatus: "unknown", commercialUse: "unknown" });
    expect(evaluateLicense(item, "commercial", false)).toEqual(expect.objectContaining({ status: "blocked" }));
    expect(evaluateCatalogCompatibility(item, contextFixture({ distributionPurpose: "commercial" })).level).toBe("blocked");
  });

  it("blocks a resource demand that cannot be adapted within policy", () => {
    const item = catalogFixture({ estimatedVramBytes: 30 * GIB, estimatedRamBytes: 50 * GIB });
    const context = contextFixture({
      hardware: hardwareFixture({ dedicatedVramFreeBytes: 8 * GIB, dxgiBudgetBytes: 8 * GIB, dxgiCurrentUsageBytes: 2 * GIB, systemRamFreeBytes: 16 * GIB }),
      resourcePolicy: { ...contextFixture().resourcePolicy, autoAdapt: false },
    });
    const result = evaluateCatalogCompatibility(item, context);
    expect(result.level).toBe("blocked");
    expect(result.resource.level).toBe("red");
  });
});
