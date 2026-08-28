import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  resolveCanonicalProviderId,
  validateDistributionProviderCatalog,
  type DistributionProviderCatalog,
} from "../src/providerCatalog.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(
  readFileSync(resolve(HERE, "../../../providers.catalog.json"), "utf8"),
) as DistributionProviderCatalog;

describe("canonical provider catalog", () => {
  it("validates the distribution catalog and its migration aliases", () => {
    const result = validateDistributionProviderCatalog(catalog);
    expect(result).toMatchObject({ valid: true, errors: [] });
    expect(resolveCanonicalProviderId(catalog, "google")).toBe("gemini");
    expect(resolveCanonicalProviderId(catalog, "azure")).toBe("azure-speech");
    expect(result.canonicalProviderIds).not.toContain("google");
    expect(result.canonicalProviderIds).not.toContain("azure");
  });

  it("rejects aliases that shadow or chain through another alias", () => {
    const broken = structuredClone(catalog);
    broken.aliases = { gemini: "openai", google: "azure", azure: "azure-speech" };
    expect(validateDistributionProviderCatalog(broken).valid).toBe(false);
  });

  it("keeps NVIDIA hosted preview non-production and separate from self-hosted NIM", () => {
    const nvidia = catalog.providers.find((provider) => provider.id === "nvidia-nim");
    expect(nvidia).toBeDefined();
    expect(nvidia?.credentialKind).toBe("secret-reference");
    expect(nvidia?.approvedByDefault).toBe(false);
    expect(nvidia?.usagePolicy).toMatchObject({
      productionEligible: false,
      acceptedDataClasses: ["public"],
      explicitTermsApprovalRequired: true,
      modelAvailabilityCheckRequired: true,
      selfHostedEntitlementSeparate: true,
    });
  });
});
