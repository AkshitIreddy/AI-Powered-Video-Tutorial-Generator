export const catalogSources = [
  "curated",
  "hugging-face",
  "civitai",
  "nvidia-nim",
  "cohere",
  "nvidia-ngc",
  "local",
  "cloud",
] as const;

export type CatalogSource = (typeof catalogSources)[number];

export const catalogCapabilities = [
  "llm.text",
  "llm.structured",
  "research.web",
  "vlm.review",
  "vlm.chat",
  "media.licensed.search",
  "retrieval.embed",
  "image.generate",
  "image.edit",
  "image.inpaint",
  "image.control",
  "image.reference",
  "image.upscale",
  "video.generate",
  "audio.tts",
  "audio.transcribe",
  "audio.align",
  "presenter.generate",
  "portrait.animate",
  "lipsync.generate",
] as const;

export type CatalogCapability = (typeof catalogCapabilities)[number];

export const artifactTypes = [
  "model",
  "checkpoint",
  "quantization",
  "lora",
  "control-adapter",
  "reference-adapter",
  "upscaler",
  "runtime",
  "container",
  "hosted-endpoint",
  "workflow",
] as const;

export type ArtifactType = (typeof artifactTypes)[number];
export type ExecutionBoundary = "local" | "cloud";
export type CatalogAvailability = "available" | "installed" | "downloadable" | "gated" | "unavailable" | "unknown";
export type CatalogConfidence = "verified-manifest" | "provider-metadata" | "publisher-metadata" | "inferred" | "unknown";
export type CommercialUse = "allowed" | "noncommercial-only" | "restricted" | "unknown";
export type DistributionPurpose = "private" | "public-noncommercial" | "commercial";
export type ScanState = "passed" | "failed" | "not-run" | "unknown";
export type BrandReviewState = "approved" | "pending-review" | "not-reviewed" | "rejected";
export type CompatibilityLevel = "ready" | "ready-with-changes" | "needs-setup" | "unknown" | "blocked";
export type ResourceFitLevel = "green" | "amber" | "red" | "unknown";

export interface CatalogIdentity {
  source: CatalogSource;
  sourceId: string;
  providerId: string;
  publisher: string;
  name: string;
  revision: string | null;
  immutableHash: string | null;
}

export interface CatalogClassification {
  capabilities: readonly CatalogCapability[];
  artifactType: ArtifactType;
  modalities: readonly ("text" | "image" | "audio" | "video" | "multimodal")[];
  architecture: string | null;
  baseFamilies: readonly string[];
  tags: readonly string[];
}

export interface CatalogExecution {
  boundaries: readonly ExecutionBoundary[];
  runtimes: readonly string[];
  formats: readonly string[];
  precisions: readonly string[];
  quantizations: readonly string[];
  endpoint: {
    baseUrl: string | null;
    operationIds: readonly string[];
    openAiCompatible: boolean;
  } | null;
}

export interface CatalogRequirements {
  downloadBytes: number | null;
  installedBytes: number | null;
  estimatedRamBytes: number | null;
  estimatedVramBytes: number | null;
  minimumDriver: string | null;
  minimumRuntimeVersions: Readonly<Record<string, string>>;
  requiredArtifacts: readonly CatalogArtifactRequirement[];
}

export interface CatalogArtifactRequirement {
  kind: ArtifactType | "text-encoder" | "vae" | "tokenizer" | "preprocessor";
  identifier: string;
  optional: boolean;
}

export interface CatalogLicense {
  identifier: string | null;
  name: string;
  url: string | null;
  commercialUse: CommercialUse;
  attributionRequired: boolean | null;
  derivativesAllowed: boolean | null;
  hostingAllowed: boolean | null;
  status: "known" | "custom" | "unknown";
  notes: readonly string[];
}

export interface CatalogTrust {
  publisherClaim: "provider" | "publisher" | "community" | "local-user" | "unknown";
  publisherVerifiedBySource: boolean | null;
  gated: boolean;
  termsAccepted: boolean | null;
  sha256: string | null;
  virusScan: ScanState;
  pickleScan: ScanState;
  safetensors: boolean | null;
  moderation: "sfw" | "restricted" | "blocked" | "unknown";
  retrievedAt: string;
}

export interface CatalogMetrics {
  downloads: number | null;
  likes: number | null;
  rating: number | null;
  trendingScore: number | null;
  lastModifiedAt: string | null;
}

export interface CatalogPresentation {
  description: string;
  previewUrls: readonly string[];
  documentationUrl: string | null;
  sourceUrl: string | null;
  brandAssetId: string;
}

export interface CatalogCompatibilityHints {
  testedRecipeIds: readonly string[];
  compatibleBaseFamilies: readonly string[];
  incompatibleBaseFamilies: readonly string[];
  requiredGpuVendors: readonly string[];
  supportedOperatingSystems: readonly ("windows" | "linux" | "macos")[];
  confidence: CatalogConfidence;
}

export interface CatalogItem<TRaw = unknown> {
  schemaVersion: 1;
  identity: CatalogIdentity;
  classification: CatalogClassification;
  execution: CatalogExecution;
  requirements: CatalogRequirements;
  license: CatalogLicense;
  trust: CatalogTrust;
  metrics: CatalogMetrics;
  presentation: CatalogPresentation;
  compatibility: CatalogCompatibilityHints;
  availability: CatalogAvailability;
  localInstall: LocalInstallState | null;
  sourceMetadata: {
    adapter: string;
    adapterVersion: number;
    raw: TRaw;
  };
}

export interface LocalInstallState {
  path: string;
  fingerprint: string | null;
  installedAt: string | null;
  lastVerifiedAt: string | null;
  status: "verified" | "unverified" | "missing" | "corrupt";
}

export interface ProviderBrandAsset {
  id: string;
  providerId: string;
  displayName: string;
  metadataPath: string;
  assetPath: string | null;
  officialSourceUrl: string | null;
  trademarkGuidelinesUrl: string | null;
  artworkLicense: string | null;
  attributionText: string | null;
  variant: "symbol" | "wordmark" | "full-color" | "monochrome" | "internal-generic";
  reviewState: BrandReviewState;
  reviewedAt: string | null;
  reviewAfter: string | null;
  mayRender: boolean;
  notes: readonly string[];
}

export interface CatalogFilterState {
  sources: readonly CatalogSource[];
  capabilities: readonly CatalogCapability[];
  boundaries: readonly ExecutionBoundary[];
  compatibility: readonly CompatibilityLevel[];
  license: readonly CommercialUse[];
  installedOnly: boolean;
  safeTensorsOnly: boolean;
  maxVramBytes: number | null;
  maxRamBytes: number | null;
}

export type CatalogSort = "relevance" | "name" | "downloads" | "likes" | "updated" | "vram";

export interface HardwareSnapshot {
  operatingSystem: "windows" | "linux" | "macos";
  gpuVendor: "nvidia" | "amd" | "intel" | "apple" | "none" | "unknown";
  gpuNames: readonly string[];
  dedicatedVramBytes: number | null;
  dedicatedVramFreeBytes: number | null;
  dxgiBudgetBytes: number | null;
  dxgiCurrentUsageBytes: number | null;
  systemRamBytes: number | null;
  systemRamFreeBytes: number | null;
  driverVersion: string | null;
  installedRuntimes: Readonly<Record<string, string>>;
  providerConnectionIds: readonly string[];
  capturedAt: string;
}

export interface CompatibilityContext {
  capability: CatalogCapability | null;
  distributionPurpose: DistributionPurpose;
  allowedBoundaries: readonly ExecutionBoundary[];
  selectedBaseFamily: string | null;
  requiredRuntime: string | null;
  allowUnknownLicenseForPrivateUse: boolean;
  hardware: HardwareSnapshot;
  resourcePolicy: ResourcePolicy;
  verifiedManagedPackages?: Readonly<Record<string, {
    catalogRevision: string;
    nativeRevision: string;
    installFingerprint: string;
  }>>;
}

export interface CompatibilityReason {
  code:
    | "capability-mismatch"
    | "boundary-disallowed"
    | "base-family-mismatch"
    | "runtime-missing"
    | "runtime-outdated"
    | "license-blocked"
    | "license-review"
    | "terms-required"
    | "credential-required"
    | "artifact-required"
    | "local-install-required"
    | "unverified-install"
    | "resource-adaptation"
    | "resource-exceeded"
    | "hardware-vendor"
    | "operating-system"
    | "availability"
    | "metadata-incomplete";
  severity: "info" | "warning" | "error";
  message: string;
  remediation: string | null;
}

export interface CompatibilityResult {
  level: CompatibilityLevel;
  reasons: readonly CompatibilityReason[];
  resource: ResourceFitResult;
  license: LicenseDecision;
  selectedBoundary: ExecutionBoundary | null;
  canSelect: boolean;
}

export interface LicenseDecision {
  status: "allowed" | "review" | "blocked";
  messages: readonly string[];
}

export interface ResourcePolicy {
  id: "conservative" | "balanced" | "performance" | "custom";
  name: string;
  description: string;
  vramTargetFraction: number;
  vramReserveBytes: number;
  ramTargetFraction: number;
  ramReserveBytes: number;
  maxHeavyGpuJobs: number;
  maxLightGpuJobs: number;
  maxCpuJobs: number;
  modelIdleTtlSeconds: number;
  contextTokenCap: number;
  imageMegapixelCap: number;
  imageBatchCap: number;
  temperaturePauseCelsius: number | null;
  powerDrawPauseWatts: number | null;
  physicalPowerLimitWatts: number | null;
  offloadPreference: "none" | "model" | "group" | "sequential" | "automatic";
  quantizationPreference: "quality" | "balanced" | "memory" | "automatic";
  allowDiskOffload: boolean;
  allowSharedGpuMemory: boolean;
  autoAdapt: boolean;
}

export interface ResourceDemand {
  vramBytes: number | null;
  ramBytes: number | null;
  diskBytes: number | null;
  heavyGpuJobs: number;
  lightGpuJobs: number;
  cpuJobs: number;
  contextTokens: number | null;
  imageMegapixels: number | null;
  imageBatch: number | null;
}

export interface ResourceFitResult {
  level: ResourceFitLevel;
  availableVramBytes: number | null;
  availableRamBytes: number | null;
  demand: ResourceDemand;
  adaptations: readonly ResourceAdaptation[];
  messages: readonly string[];
}

export interface ResourceAdaptation {
  code: "quantize" | "offload" | "reduce-context" | "reduce-resolution" | "reduce-batch" | "serialize-jobs" | "free-models";
  label: string;
  description: string;
  estimatedVramSavingsBytes: number | null;
  estimatedRamCostBytes: number | null;
}

export interface WorkflowStageDemand extends ResourceDemand {
  id: string;
  label: string;
  concurrencyGroup: string;
  canOverlap: boolean;
}

export interface CapabilityRouteSelection {
  source: CatalogSource;
  sourceId: string;
  revision: string | null;
  providerId: string;
}

export interface CapabilityRoute {
  capability: CatalogCapability;
  enabled: boolean;
  fallbackConsent: boolean;
  selections: readonly CapabilityRouteSelection[];
}

export interface RoutingProfile {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  routes: readonly CapabilityRoute[];
  updatedAt: string;
}

export interface RouteValidationIssue {
  routeCapability: CatalogCapability;
  selectionIndex: number | null;
  code: "empty-route" | "duplicate-selection" | "missing-item" | "capability-mismatch" | "compatibility-blocked" | "cloud-fallback-without-consent";
  message: string;
}

export interface RouteResolution {
  status: "resolved" | "needs-setup" | "blocked";
  selection: CapabilityRouteSelection | null;
  item: CatalogItem | null;
  compatibility: CompatibilityResult | null;
  attempted: readonly {
    selection: CapabilityRouteSelection;
    item: CatalogItem | null;
    compatibility: CompatibilityResult | null;
  }[];
  issues: readonly RouteValidationIssue[];
}

export const emptyCatalogFilters: CatalogFilterState = {
  sources: [],
  capabilities: [],
  boundaries: [],
  compatibility: [],
  license: [],
  installedOnly: false,
  safeTensorsOnly: false,
  maxVramBytes: null,
  maxRamBytes: null,
};
