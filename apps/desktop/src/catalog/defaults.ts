import { resourcePolicyPresets } from "./resourcePolicy";
import {
  catalogCapabilities,
  catalogSources,
  type CatalogCapability,
  type CatalogItem,
  type CatalogSource,
  type CompatibilityContext,
  type HardwareSnapshot,
  type ResourcePolicy,
  type RoutingProfile,
} from "./types";

export interface CatalogSourceDefinition {
  id: CatalogSource;
  label: string;
  description: string;
  brandAssetId: string;
  discovery: "bundled-manifest" | "remote-api" | "local-scan" | "configured-endpoints";
  authentication: "none" | "optional-token" | "required-token" | "provider-connection";
  catalogUrl: string | null;
  enabledByDefault: boolean;
}

/**
 * Stable source metadata only. Remote model rows are intentionally not bundled:
 * each adapter should populate them from a dated API response or verified local scan.
 */
export const defaultCatalogSources: readonly CatalogSourceDefinition[] = [
  {
    id: "curated",
    label: "Alystria curated",
    description: "Versioned, tested workflow manifests shipped by Alystria.",
    brandAssetId: "alystria",
    discovery: "bundled-manifest",
    authentication: "none",
    catalogUrl: null,
    enabledByDefault: true,
  },
  {
    id: "hugging-face",
    label: "Hugging Face",
    description: "Models discovered from the Hugging Face Hub API; gating and license metadata remain explicit.",
    brandAssetId: "hugging-face",
    discovery: "remote-api",
    authentication: "optional-token",
    catalogUrl: "https://huggingface.co/models",
    enabledByDefault: true,
  },
  {
    id: "civitai",
    label: "Civitai",
    description: "Image-generation models and version artifacts discovered from Civitai.",
    brandAssetId: "civitai",
    discovery: "remote-api",
    authentication: "optional-token",
    catalogUrl: "https://civitai.com/models",
    enabledByDefault: true,
  },
  {
    id: "nvidia-nim",
    label: "NVIDIA NIM",
    description: "Hosted and self-hosted NIM offerings resolved through a connected NVIDIA account.",
    brandAssetId: "nvidia",
    discovery: "remote-api",
    authentication: "required-token",
    catalogUrl: "https://build.nvidia.com/",
    enabledByDefault: true,
  },
  {
    id: "nvidia-ngc",
    label: "NVIDIA NGC",
    description: "Downloadable NVIDIA catalog artifacts with entitlement and container metadata preserved.",
    brandAssetId: "nvidia",
    discovery: "remote-api",
    authentication: "required-token",
    catalogUrl: "https://catalog.ngc.nvidia.com/",
    enabledByDefault: true,
  },
  {
    id: "local",
    label: "Local installs",
    description: "Models found through an explicit, user-authorized filesystem and runtime scan.",
    brandAssetId: "local",
    discovery: "local-scan",
    authentication: "none",
    catalogUrl: null,
    enabledByDefault: true,
  },
  {
    id: "cloud",
    label: "Connected cloud providers",
    description: "User-configured endpoints normalized into the same model and capability contract.",
    brandAssetId: "cloud",
    discovery: "configured-endpoints",
    authentication: "provider-connection",
    catalogUrl: null,
    enabledByDefault: true,
  },
] as const;

/** No fake models appear before a real sync, verified install scan, or bundled manifest is supplied. */
export const defaultCatalogItems: readonly CatalogItem[] = Object.freeze([]);

export function createDefaultRoutingProfile(
  capabilities: readonly CatalogCapability[] = catalogCapabilities,
  now = new Date().toISOString(),
): RoutingProfile {
  return {
    schemaVersion: 1,
    id: "default",
    name: "Default routing",
    description: "No model runs until a user enables a capability and chooses its route.",
    routes: capabilities.map((capability) => ({
      capability,
      enabled: false,
      fallbackConsent: false,
      selections: [],
    })),
    updatedAt: now,
  };
}

export function createUnprobedHardwareSnapshot(capturedAt = new Date().toISOString()): HardwareSnapshot {
  return {
    operatingSystem: "windows",
    gpuVendor: "unknown",
    gpuNames: [],
    dedicatedVramBytes: null,
    dedicatedVramFreeBytes: null,
    dxgiBudgetBytes: null,
    dxgiCurrentUsageBytes: null,
    systemRamBytes: 0,
    systemRamFreeBytes: 0,
    driverVersion: null,
    installedRuntimes: {},
    providerConnectionIds: [],
    capturedAt,
  };
}

export function createDefaultCompatibilityContext(input: {
  hardware: HardwareSnapshot;
  policy?: ResourcePolicy;
  capability?: CatalogCapability | null;
}): CompatibilityContext {
  return {
    capability: input.capability ?? null,
    distributionPurpose: "private",
    allowedBoundaries: ["local", "cloud"],
    selectedBaseFamily: null,
    requiredRuntime: null,
    allowUnknownLicenseForPrivateUse: false,
    hardware: input.hardware,
    resourcePolicy: input.policy ?? resourcePolicyPresets.balanced,
  };
}

export function assertCompleteSourceRegistry(sources: readonly CatalogSourceDefinition[] = defaultCatalogSources): void {
  const ids = new Set(sources.map((source) => source.id));
  const missing = catalogSources.filter((source) => !ids.has(source));
  const duplicate = sources.find((source, index) => sources.findIndex((candidate) => candidate.id === source.id) !== index);
  if (missing.length > 0 || duplicate) {
    throw new Error(`Invalid catalog source registry. Missing: ${missing.join(", ") || "none"}; duplicate: ${duplicate?.id ?? "none"}.`);
  }
}
