import { resourcePolicyPresets } from "../resourcePolicy";
import type {
  ArtifactType,
  CatalogAvailability,
  CatalogCapability,
  CatalogItem,
  CatalogSource,
  CommercialUse,
  CompatibilityContext,
  ExecutionBoundary,
  HardwareSnapshot,
  LocalInstallState,
} from "../types";

const GIB = 1024 ** 3;

export interface CatalogFixtureOptions {
  name?: string;
  source?: CatalogSource;
  sourceId?: string;
  providerId?: string;
  capabilities?: readonly CatalogCapability[];
  artifactType?: ArtifactType;
  boundaries?: readonly ExecutionBoundary[];
  runtimes?: readonly string[];
  tags?: readonly string[];
  baseFamilies?: readonly string[];
  compatibleBaseFamilies?: readonly string[];
  estimatedVramBytes?: number | null;
  estimatedRamBytes?: number | null;
  commercialUse?: CommercialUse;
  licenseStatus?: CatalogItem["license"]["status"];
  gated?: boolean;
  termsAccepted?: boolean | null;
  safetensors?: boolean | null;
  availability?: CatalogAvailability;
  localInstall?: LocalInstallState | null;
  downloads?: number | null;
  likes?: number | null;
  updatedAt?: string | null;
}

export function catalogFixture(options: CatalogFixtureOptions = {}): CatalogItem {
  const source = options.source ?? "curated";
  const sourceId = options.sourceId ?? "fixture/model";
  const providerId = options.providerId ?? (source === "local" ? "local" : "alystria");
  const baseFamilies = options.baseFamilies ?? [];
  return {
    schemaVersion: 1,
    identity: {
      source,
      sourceId,
      providerId,
      publisher: "Fixture Labs",
      name: options.name ?? "Fixture Model",
      revision: "rev-1",
      immutableHash: "a".repeat(64),
    },
    classification: {
      capabilities: options.capabilities ?? ["image.generate"],
      artifactType: options.artifactType ?? "model",
      modalities: ["image"],
      architecture: "fixture-architecture",
      baseFamilies,
      tags: options.tags ?? ["fixture", "safetensors"],
    },
    execution: {
      boundaries: options.boundaries ?? ["local"],
      runtimes: options.runtimes ?? ["comfyui"],
      formats: ["safetensors"],
      precisions: ["fp16"],
      quantizations: [],
      endpoint: null,
    },
    requirements: {
      downloadBytes: 5 * GIB,
      installedBytes: 6 * GIB,
      estimatedRamBytes: options.estimatedRamBytes === undefined ? 8 * GIB : options.estimatedRamBytes,
      estimatedVramBytes: options.estimatedVramBytes === undefined ? 4 * GIB : options.estimatedVramBytes,
      minimumDriver: null,
      minimumRuntimeVersions: { comfyui: "0.3.0" },
      requiredArtifacts: [],
    },
    license: {
      identifier: options.licenseStatus === "unknown" ? null : "apache-2.0",
      name: options.licenseStatus === "unknown" ? "Unknown license" : "Apache License 2.0",
      url: null,
      commercialUse: options.commercialUse ?? "allowed",
      attributionRequired: true,
      derivativesAllowed: true,
      hostingAllowed: true,
      status: options.licenseStatus ?? "known",
      notes: [],
    },
    trust: {
      publisherClaim: "provider",
      publisherVerifiedBySource: true,
      gated: options.gated ?? false,
      termsAccepted: options.termsAccepted ?? true,
      sha256: "a".repeat(64),
      virusScan: "passed",
      pickleScan: "not-run",
      safetensors: options.safetensors ?? true,
      moderation: "sfw",
      retrievedAt: "2026-09-02T00:00:00.000Z",
    },
    metrics: {
      downloads: options.downloads ?? 100,
      likes: options.likes ?? 10,
      rating: null,
      trendingScore: null,
      lastModifiedAt: options.updatedAt ?? "2026-09-01T00:00:00.000Z",
    },
    presentation: {
      description: "A fully specified catalog fixture for image generation.",
      previewUrls: [],
      documentationUrl: null,
      sourceUrl: null,
      brandAssetId: providerId,
    },
    compatibility: {
      testedRecipeIds: ["fixture-recipe"],
      compatibleBaseFamilies: options.compatibleBaseFamilies ?? baseFamilies,
      incompatibleBaseFamilies: [],
      requiredGpuVendors: ["nvidia"],
      supportedOperatingSystems: ["windows"],
      confidence: "verified-manifest",
    },
    availability: options.availability ?? "available",
    localInstall: options.localInstall === undefined ? null : options.localInstall,
    sourceMetadata: { adapter: "test-fixture", adapterVersion: 1, raw: {} },
  };
}

export function hardwareFixture(overrides: Partial<HardwareSnapshot> = {}): HardwareSnapshot {
  return {
    operatingSystem: "windows",
    gpuVendor: "nvidia",
    gpuNames: ["NVIDIA fixture GPU"],
    dedicatedVramBytes: 16 * GIB,
    dedicatedVramFreeBytes: 14 * GIB,
    dxgiBudgetBytes: 15 * GIB,
    dxgiCurrentUsageBytes: 2 * GIB,
    systemRamBytes: 64 * GIB,
    systemRamFreeBytes: 48 * GIB,
    driverVersion: "600.1",
    installedRuntimes: { comfyui: "0.3.50", "nvidia-nim": "1.0.0" },
    providerConnectionIds: ["nvidia", "cloud-provider"],
    capturedAt: "2026-09-02T00:00:00.000Z",
    ...overrides,
  };
}

export function contextFixture(overrides: Partial<CompatibilityContext> = {}): CompatibilityContext {
  return {
    capability: "image.generate",
    distributionPurpose: "private",
    allowedBoundaries: ["local", "cloud"],
    selectedBaseFamily: null,
    requiredRuntime: null,
    allowUnknownLicenseForPrivateUse: false,
    hardware: hardwareFixture(),
    resourcePolicy: resourcePolicyPresets.balanced,
    ...overrides,
  };
}

export { GIB };
