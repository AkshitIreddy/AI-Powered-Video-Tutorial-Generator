import { describe, expect, it } from "vitest";
import { evaluateCatalogCompatibility, evaluateLicense } from "../compatibility";
import { catalogFixture, contextFixture, GIB, hardwareFixture } from "./fixtures";

describe("catalog compatibility", () => {
  it("marks a verified, licensed local model ready", () => {
    const result = evaluateCatalogCompatibility(catalogFixture(), contextFixture());
    expect(result.level).toBe("ready");
    expect(result.canSelect).toBe(true);
    expect(result.license.status).toBe("allowed");
    expect(result.reasons).toEqual([]);
  });

  it("requires setup when a mandatory local runtime is missing", () => {
    const context = contextFixture({ hardware: hardwareFixture({ installedRuntimes: {} }) });
    const result = evaluateCatalogCompatibility(catalogFixture(), context);
    expect(result.level).toBe("needs-setup");
    expect(result.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: "runtime-missing" })]));
  });

  it("does not demand cloud credentials for a hybrid item with an eligible local path", () => {
    const item = catalogFixture({ boundaries: ["local", "cloud"], providerId: "not-connected" });
    const context = contextFixture({ hardware: hardwareFixture({ providerConnectionIds: [] }) });
    const result = evaluateCatalogCompatibility(item, context);
    expect(result.reasons.map((reason) => reason.code)).not.toContain("credential-required");
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
