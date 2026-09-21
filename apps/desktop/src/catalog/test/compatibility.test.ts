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

  it("accepts an exact verified managed receipt only for its own bundled runtimes", () => {
    const managed = catalogFixture({
      sourceId: "local/soulx-flashhead-pro",
      runtimes: ["python", "pytorch", "cuda"],
      availability: "downloadable",
      localInstall: null,
    });
    const sibling = { ...managed, identity: { ...managed.identity, sourceId: "local/other-python-model", name: "Other Python model" } };
    const context = contextFixture({
      hardware: hardwareFixture({ installedRuntimes: {} }),
      verifiedManagedPackages: {
        "local/soulx-flashhead-pro": { catalogRevision: managed.identity.revision!, nativeRevision: "native-runtime-revision", installFingerprint: "b".repeat(64) },
      },
    });

    const managedResult = evaluateCatalogCompatibility(managed, context);
    expect(managedResult.level).toBe("ready");
    expect(managedResult.reasons).toEqual([]);
    const siblingResult = evaluateCatalogCompatibility(sibling, context);
    expect(siblingResult.level).toBe("needs-setup");
    expect(siblingResult.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "runtime-missing" }),
      expect.objectContaining({ code: "local-install-required" }),
    ]));
  });

  it("keeps hardware and license blocks active for verified managed packages", () => {
    const item = catalogFixture({
      sourceId: "local/soulx-flashhead-pro",
      runtimes: ["python", "pytorch", "cuda"],
      availability: "downloadable",
      localInstall: null,
      commercialUse: "restricted",
    });
    const receipt = {
      catalogRevision: item.identity.revision!,
      nativeRevision: "native-runtime-revision",
      installFingerprint: "b".repeat(64),
    };

    const hardwareResult = evaluateCatalogCompatibility(item, contextFixture({
      hardware: hardwareFixture({ gpuVendor: "amd", installedRuntimes: {} }),
      verifiedManagedPackages: { "local/soulx-flashhead-pro": receipt },
    }));
    expect(hardwareResult.level).toBe("blocked");
    expect(hardwareResult.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: "hardware-vendor" })]));

    const licenseResult = evaluateCatalogCompatibility(item, contextFixture({
      distributionPurpose: "commercial",
      verifiedManagedPackages: { "local/soulx-flashhead-pro": receipt },
    }));
    expect(licenseResult.level).toBe("blocked");
    expect(licenseResult.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: "license-blocked" })]));
  });

  it("does not downgrade a verified managed package when only live memory budgets are unavailable", () => {
    const item = catalogFixture({ sourceId: "local/soulx-flashhead-pro", runtimes: ["python"], availability: "downloadable", localInstall: null });
    const result = evaluateCatalogCompatibility(item, contextFixture({
      hardware: hardwareFixture({
        dedicatedVramFreeBytes: null,
        dxgiBudgetBytes: null,
        dxgiCurrentUsageBytes: null,
        systemRamFreeBytes: null,
        installedRuntimes: {},
      }),
      verifiedManagedPackages: {
        "local/soulx-flashhead-pro": {
          catalogRevision: item.identity.revision!,
          nativeRevision: "native-runtime-revision",
          installFingerprint: "b".repeat(64),
        },
      },
    }));

    expect(result.level).toBe("ready");
    expect(result.reasons).toEqual([]);
  });

  it("rejects stale or malformed managed receipts", () => {
    const item = catalogFixture({ sourceId: "local/soulx-flashhead-pro", runtimes: ["python"], availability: "downloadable", localInstall: null });
    for (const receipt of [
      { catalogRevision: "different-revision", nativeRevision: "native-runtime-revision", installFingerprint: "b".repeat(64) },
      { catalogRevision: item.identity.revision!, nativeRevision: "native-runtime-revision", installFingerprint: "not-a-fingerprint" },
      { catalogRevision: item.identity.revision!, nativeRevision: "", installFingerprint: "b".repeat(64) },
    ]) {
      const result = evaluateCatalogCompatibility(item, contextFixture({
        hardware: hardwareFixture({ installedRuntimes: {} }),
        verifiedManagedPackages: { "local/soulx-flashhead-pro": receipt },
      }));
      expect(result.level).toBe("needs-setup");
      expect(result.reasons.map((reason) => reason.code)).toContain("runtime-missing");
    }
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
