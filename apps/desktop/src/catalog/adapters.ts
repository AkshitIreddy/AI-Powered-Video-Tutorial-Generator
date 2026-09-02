import type {
  ArtifactType,
  CatalogCapability,
  CatalogClassification,
  CatalogCompatibilityHints,
  CatalogExecution,
  CatalogItem,
  CatalogLicense,
  CatalogMetrics,
  CatalogPresentation,
  CatalogRequirements,
  CatalogSource,
  CatalogTrust,
  CommercialUse,
  ExecutionBoundary,
  LocalInstallState,
  ScanState,
} from "./types";

export interface CuratedCatalogEntry {
  id: string;
  providerId: string;
  publisher: string;
  name: string;
  revision: string;
  immutableHash?: string;
  capabilities: readonly CatalogCapability[];
  artifactType: ArtifactType;
  modalities: CatalogClassification["modalities"];
  architecture?: string;
  baseFamilies?: readonly string[];
  tags?: readonly string[];
  boundaries: readonly ExecutionBoundary[];
  runtimes?: readonly string[];
  formats?: readonly string[];
  precisions?: readonly string[];
  quantizations?: readonly string[];
  requirements?: Partial<CatalogRequirements>;
  license: CatalogLicense;
  description: string;
  documentationUrl?: string;
  sourceUrl: string;
  testedRecipeIds?: readonly string[];
  publisherVerifiedBySource?: boolean | null;
  retrievedAt: string;
}

export interface RawHuggingFaceModel {
  id: string;
  author?: string | null;
  sha?: string | null;
  pipeline_tag?: string | null;
  library_name?: string | null;
  tags?: readonly string[];
  downloads?: number | null;
  likes?: number | null;
  trendingScore?: number | null;
  lastModified?: string | null;
  gated?: boolean | "auto" | "manual" | null;
  private?: boolean | null;
  safetensors?: { parameters?: Record<string, number> } | null;
  cardData?: {
    license?: string | null;
    license_name?: string | null;
    license_link?: string | null;
    base_model?: string | readonly string[] | null;
    tags?: readonly string[];
  } | null;
  siblings?: readonly { rfilename: string; size?: number | null }[];
  inference?: "warm" | "cold" | "frozen" | null;
  inferenceProviderMapping?: Readonly<Record<string, unknown>> | null;
  description?: string | null;
}

export interface RawCivitaiModel {
  id: number;
  name: string;
  type: string;
  creator?: { username?: string | null } | null;
  description?: string | null;
  nsfw?: boolean | null;
  poi?: boolean | null;
  allowNoCredit?: boolean | null;
  allowCommercialUse?: readonly string[] | null;
  allowDerivatives?: boolean | null;
  allowDifferentLicense?: boolean | null;
  stats?: {
    downloadCount?: number | null;
    thumbsUpCount?: number | null;
    rating?: number | null;
  } | null;
  tags?: readonly { name?: string | null }[];
}

export interface RawCivitaiModelVersion {
  id: number;
  modelId: number;
  name: string;
  baseModel?: string | null;
  baseModelType?: string | null;
  air?: string | null;
  status?: string | null;
  availability?: string | null;
  nsfwLevel?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  publishedAt?: string | null;
  trainedWords?: readonly string[];
  downloadUrl?: string | null;
  files?: readonly {
    name: string;
    type?: string | null;
    sizeKB?: number | null;
    primary?: boolean | null;
    pickleScanResult?: string | null;
    virusScanResult?: string | null;
    hashes?: Readonly<Record<string, string>> | null;
    metadata?: { format?: string | null; size?: string | null; fp?: string | null } | null;
  }[];
  images?: readonly { url?: string | null; nsfwLevel?: number | null }[];
}

export interface RawNvidiaCatalogEntry {
  catalog: "nim" | "ngc";
  id: string;
  name: string;
  publisher: string;
  revision?: string | null;
  digest?: string | null;
  description?: string | null;
  capabilities: readonly CatalogCapability[];
  artifactType?: ArtifactType;
  modalities?: CatalogClassification["modalities"];
  tags?: readonly string[];
  architecture?: string | null;
  baseFamilies?: readonly string[];
  hostedApi: boolean;
  downloadable: boolean;
  operationIds?: readonly string[];
  endpointBaseUrl?: string | null;
  openAiCompatible?: boolean;
  containerImage?: string | null;
  requirements?: Partial<CatalogRequirements>;
  license?: Partial<CatalogLicense> | null;
  entitlement?: "available" | "required" | "unknown";
  publisherVerifiedBySource?: boolean | null;
  sourceUrl: string;
  documentationUrl?: string | null;
  lastModifiedAt?: string | null;
  retrievedAt: string;
}

export interface LocalCatalogManifest {
  id: string;
  providerId?: string;
  publisher?: string;
  name: string;
  revision?: string | null;
  sha256?: string | null;
  capabilities: readonly CatalogCapability[];
  artifactType: ArtifactType;
  modalities: CatalogClassification["modalities"];
  architecture?: string | null;
  baseFamilies?: readonly string[];
  tags?: readonly string[];
  runtimes: readonly string[];
  formats?: readonly string[];
  precision?: string | null;
  quantization?: string | null;
  requirements?: Partial<CatalogRequirements>;
  license?: Partial<CatalogLicense> | null;
  install: LocalInstallState;
  description?: string;
  documentationUrl?: string | null;
  sourceUrl?: string | null;
  retrievedAt: string;
}

export interface CloudCatalogEndpoint {
  id: string;
  providerId: string;
  publisher: string;
  name: string;
  revision?: string | null;
  capabilities: readonly CatalogCapability[];
  modalities: CatalogClassification["modalities"];
  operationIds: readonly string[];
  endpointBaseUrl: string;
  openAiCompatible?: boolean;
  architecture?: string | null;
  baseFamilies?: readonly string[];
  tags?: readonly string[];
  license?: Partial<CatalogLicense> | null;
  credentialConfigured: boolean;
  reachable: boolean | null;
  description?: string;
  documentationUrl?: string | null;
  sourceUrl?: string | null;
  retrievedAt: string;
}

export function adaptCuratedEntry(raw: CuratedCatalogEntry): CatalogItem<CuratedCatalogEntry> {
  return makeItem({
    source: "curated",
    sourceId: raw.id,
    providerId: raw.providerId,
    publisher: raw.publisher,
    name: raw.name,
    revision: raw.revision,
    immutableHash: raw.immutableHash ?? null,
    capabilities: raw.capabilities,
    artifactType: raw.artifactType,
    modalities: raw.modalities,
    architecture: raw.architecture ?? null,
    baseFamilies: raw.baseFamilies ?? [],
    tags: raw.tags ?? [],
    boundaries: raw.boundaries,
    runtimes: raw.runtimes ?? [],
    formats: raw.formats ?? [],
    precisions: raw.precisions ?? [],
    quantizations: raw.quantizations ?? [],
    ...(raw.requirements === undefined ? {} : { requirements: raw.requirements }),
    license: raw.license,
    trust: {
      publisherClaim: "publisher",
      publisherVerifiedBySource: raw.publisherVerifiedBySource ?? null,
      gated: false,
      termsAccepted: true,
      sha256: raw.immutableHash ?? null,
      virusScan: "unknown",
      pickleScan: "unknown",
      safetensors: raw.formats?.some(isSafetensors) ?? null,
      moderation: "unknown",
      retrievedAt: raw.retrievedAt,
    },
    metrics: emptyMetrics(),
    presentation: {
      description: raw.description,
      previewUrls: [],
      documentationUrl: raw.documentationUrl ?? null,
      sourceUrl: raw.sourceUrl,
      brandAssetId: raw.providerId,
    },
    compatibility: {
      ...emptyCompatibility(),
      testedRecipeIds: raw.testedRecipeIds ?? [],
      compatibleBaseFamilies: raw.baseFamilies ?? [],
      confidence: "verified-manifest",
    },
    availability: raw.boundaries.includes("local") ? "downloadable" : "available",
    localInstall: null,
    adapter: "alystria-curated",
    raw,
  });
}

export function adaptHuggingFaceModel(raw: RawHuggingFaceModel, retrievedAt: string): CatalogItem<RawHuggingFaceModel> {
  const tags = unique([...(raw.tags ?? []), ...(raw.cardData?.tags ?? [])]);
  const files = raw.siblings ?? [];
  const modelBytes = sumKnown(files.map((file) => file.size ?? null));
  const formats = inferFormats(files.map((file) => file.rfilename));
  const baseFamilies = toArray(raw.cardData?.base_model).map(normalizeFamily);
  const capabilities = capabilitiesForPipeline(raw.pipeline_tag, tags);
  const hostedProviders = Object.keys(raw.inferenceProviderMapping ?? {});
  const boundaries: ExecutionBoundary[] = hostedProviders.length > 0 || raw.inference === "warm" ? ["local", "cloud"] : ["local"];
  const author = raw.author ?? raw.id.split("/")[0] ?? "Unknown publisher";
  const license = licenseFromIdentifier(raw.cardData?.license ?? null, {
    ...(raw.cardData?.license_name === undefined ? {} : { name: raw.cardData.license_name }),
    ...(raw.cardData?.license_link === undefined ? {} : { url: raw.cardData.license_link }),
  });

  return makeItem({
    source: "hugging-face",
    sourceId: raw.id,
    providerId: "hugging-face",
    publisher: author,
    name: raw.id.split("/").at(-1) ?? raw.id,
    revision: raw.sha ?? null,
    immutableHash: raw.sha ?? null,
    capabilities,
    artifactType: inferHuggingFaceArtifact(tags),
    modalities: modalitiesForCapabilities(capabilities),
    architecture: raw.library_name ?? null,
    baseFamilies,
    tags,
    boundaries,
    runtimes: raw.library_name ? [raw.library_name] : [],
    formats,
    precisions: inferPrecisions(tags, files.map((file) => file.rfilename)),
    quantizations: inferQuantizations(tags),
    requirements: {
      downloadBytes: modelBytes,
      installedBytes: modelBytes,
      estimatedRamBytes: modelBytes,
      estimatedVramBytes: null,
    },
    license,
    trust: {
      publisherClaim: "publisher",
      publisherVerifiedBySource: null,
      gated: Boolean(raw.gated),
      termsAccepted: raw.gated ? false : null,
      sha256: null,
      virusScan: "unknown",
      pickleScan: formats.includes("pickle") ? "unknown" : "not-run",
      safetensors: raw.safetensors ? true : formats.includes("safetensors") ? true : null,
      moderation: tags.includes("not-for-all-audiences") ? "restricted" : "unknown",
      retrievedAt,
    },
    metrics: {
      downloads: raw.downloads ?? null,
      likes: raw.likes ?? null,
      rating: null,
      trendingScore: raw.trendingScore ?? null,
      lastModifiedAt: raw.lastModified ?? null,
    },
    presentation: {
      description: raw.description?.trim() || `Model published by ${author} on Hugging Face. Review the model card before use.`,
      previewUrls: [],
      documentationUrl: `https://huggingface.co/${raw.id}`,
      sourceUrl: `https://huggingface.co/${raw.id}`,
      brandAssetId: "hugging-face",
    },
    compatibility: {
      ...emptyCompatibility(),
      compatibleBaseFamilies: baseFamilies,
      confidence: raw.cardData ? "publisher-metadata" : "inferred",
    },
    availability: raw.private ? "unavailable" : raw.gated ? "gated" : "downloadable",
    localInstall: null,
    adapter: "hugging-face-hfapi",
    raw,
  });
}

export function adaptCivitaiModel(raw: RawCivitaiModel, version: RawCivitaiModelVersion, retrievedAt: string): CatalogItem<{
  model: RawCivitaiModel;
  version: RawCivitaiModelVersion;
}> {
  const primary = version.files?.find((file) => file.primary) ?? version.files?.[0];
  const files = version.files ?? [];
  const artifactType = civitaiArtifactType(raw.type);
  const baseFamilies = version.baseModel ? [normalizeFamily(version.baseModel)] : [];
  const capabilities = capabilitiesForCivitaiType(raw.type);
  const fileFormat = primary?.metadata?.format ?? extensionOf(primary?.name ?? "");
  const commercialUse = civitaiCommercialUse(raw.allowCommercialUse);
  const images = (version.images ?? [])
    .filter((image) => (image.nsfwLevel ?? 0) <= 1 && image.url)
    .map((image) => image.url!)
    .slice(0, 4);

  return makeItem({
    source: "civitai",
    sourceId: version.air ?? `civitai:${raw.id}@${version.id}`,
    providerId: "civitai",
    publisher: raw.creator?.username ?? "Unknown creator",
    name: `${raw.name} · ${version.name}`,
    revision: String(version.id),
    immutableHash: primary?.hashes?.SHA256 ?? null,
    capabilities,
    artifactType,
    modalities: ["image"],
    architecture: version.baseModelType ?? null,
    baseFamilies,
    tags: unique([
      ...(raw.tags ?? []).flatMap((tag) => tag.name ? [tag.name] : []),
      ...(version.trainedWords ?? []),
      raw.type,
    ]),
    boundaries: ["local"],
    runtimes: ["diffusers", "comfyui"],
    formats: fileFormat ? [fileFormat.toLowerCase()] : [],
    precisions: primary?.metadata?.fp ? [primary.metadata.fp] : [],
    quantizations: [],
    requirements: {
      downloadBytes: sumKnown(files.map((file) => bytesFromKilobytes(file.sizeKB))),
      installedBytes: sumKnown(files.map((file) => bytesFromKilobytes(file.sizeKB))),
      estimatedRamBytes: null,
      estimatedVramBytes: null,
    },
    license: {
      identifier: null,
      name: "Civitai creator permissions",
      url: `https://civitai.com/models/${raw.id}?modelVersionId=${version.id}`,
      commercialUse,
      attributionRequired: raw.allowNoCredit == null ? null : !raw.allowNoCredit,
      derivativesAllowed: raw.allowDerivatives ?? null,
      hostingAllowed: raw.allowCommercialUse?.includes("Rent") ?? null,
      status: commercialUse === "unknown" ? "unknown" : "custom",
      notes: [
        raw.allowDifferentLicense === false ? "Derivatives may not use a different license." : "Review the creator's current permissions before distribution.",
      ],
    },
    trust: {
      publisherClaim: "community",
      publisherVerifiedBySource: null,
      gated: false,
      termsAccepted: null,
      sha256: primary?.hashes?.SHA256 ?? null,
      virusScan: scanState(primary?.virusScanResult),
      pickleScan: scanState(primary?.pickleScanResult),
      safetensors: fileFormat.toLowerCase() === "safetensor" || fileFormat.toLowerCase() === "safetensors",
      moderation: raw.nsfw || (version.nsfwLevel ?? 0) > 1 ? "restricted" : "sfw",
      retrievedAt,
    },
    metrics: {
      downloads: raw.stats?.downloadCount ?? null,
      likes: raw.stats?.thumbsUpCount ?? null,
      rating: raw.stats?.rating ?? null,
      trendingScore: null,
      lastModifiedAt: version.updatedAt ?? version.publishedAt ?? version.createdAt ?? null,
    },
    presentation: {
      description: stripMarkup(raw.description) || `${raw.type} for ${version.baseModel ?? "an unspecified base family"}.`,
      previewUrls: images,
      documentationUrl: `https://civitai.com/models/${raw.id}?modelVersionId=${version.id}`,
      sourceUrl: version.downloadUrl ?? `https://civitai.com/models/${raw.id}`,
      brandAssetId: "civitai",
    },
    compatibility: {
      ...emptyCompatibility(),
      compatibleBaseFamilies: baseFamilies,
      confidence: version.baseModel ? "provider-metadata" : "unknown",
    },
    availability: version.status === "Published" || version.availability === "Public" ? "downloadable" : "unavailable",
    localInstall: null,
    adapter: "civitai-api-v1",
    raw: { model: raw, version },
  });
}

export function adaptNvidiaCatalogEntry(raw: RawNvidiaCatalogEntry): CatalogItem<RawNvidiaCatalogEntry> {
  const source: CatalogSource = raw.catalog === "nim" ? "nvidia-nim" : "nvidia-ngc";
  const boundaries: ExecutionBoundary[] = unique([
    ...(raw.hostedApi ? ["cloud" as const] : []),
    ...(raw.downloadable ? ["local" as const] : []),
  ]);
  const license = mergeLicense(raw.license);
  const availability = raw.entitlement === "required"
    ? "gated"
    : raw.hostedApi || raw.downloadable
      ? "available"
      : "unknown";

  return makeItem({
    source,
    sourceId: raw.id,
    providerId: "nvidia",
    publisher: raw.publisher,
    name: raw.name,
    revision: raw.revision ?? null,
    immutableHash: raw.digest ?? null,
    capabilities: raw.capabilities,
    artifactType: raw.artifactType ?? (raw.catalog === "nim" ? "container" : "model"),
    modalities: raw.modalities ?? modalitiesForCapabilities(raw.capabilities),
    architecture: raw.architecture ?? null,
    baseFamilies: raw.baseFamilies ?? [],
    tags: raw.tags ?? [],
    boundaries,
    runtimes: raw.containerImage ? ["nvidia-nim"] : [],
    formats: raw.containerImage ? ["oci-container"] : [],
    precisions: [],
    quantizations: [],
    endpoint: raw.hostedApi ? {
      baseUrl: raw.endpointBaseUrl ?? null,
      operationIds: raw.operationIds ?? [],
      openAiCompatible: raw.openAiCompatible ?? false,
    } : null,
    ...(raw.requirements === undefined ? {} : { requirements: raw.requirements }),
    license,
    trust: {
      publisherClaim: "provider",
      publisherVerifiedBySource: raw.publisherVerifiedBySource ?? null,
      gated: raw.entitlement === "required",
      termsAccepted: raw.entitlement === "required" ? false : null,
      sha256: raw.digest ?? null,
      virusScan: "unknown",
      pickleScan: "not-run",
      safetensors: null,
      moderation: "unknown",
      retrievedAt: raw.retrievedAt,
    },
    metrics: { ...emptyMetrics(), lastModifiedAt: raw.lastModifiedAt ?? null },
    presentation: {
      description: raw.description?.trim() || "NVIDIA catalog entry. Confirm operation, entitlement, and deployment availability before use.",
      previewUrls: [],
      documentationUrl: raw.documentationUrl ?? null,
      sourceUrl: raw.sourceUrl,
      brandAssetId: "nvidia",
    },
    compatibility: {
      ...emptyCompatibility(),
      compatibleBaseFamilies: raw.baseFamilies ?? [],
      requiredGpuVendors: raw.downloadable ? ["nvidia"] : [],
      confidence: "provider-metadata",
    },
    availability,
    localInstall: null,
    adapter: raw.catalog === "nim" ? "nvidia-nim-catalog" : "nvidia-ngc-catalog",
    raw,
  });
}

export function adaptLocalManifest(raw: LocalCatalogManifest): CatalogItem<LocalCatalogManifest> {
  const providerId = raw.providerId ?? "local";
  return makeItem({
    source: "local",
    sourceId: raw.id,
    providerId,
    publisher: raw.publisher ?? "Local user",
    name: raw.name,
    revision: raw.revision ?? null,
    immutableHash: raw.sha256 ?? raw.install.fingerprint,
    capabilities: raw.capabilities,
    artifactType: raw.artifactType,
    modalities: raw.modalities,
    architecture: raw.architecture ?? null,
    baseFamilies: raw.baseFamilies ?? [],
    tags: raw.tags ?? [],
    boundaries: ["local"],
    runtimes: raw.runtimes,
    formats: raw.formats ?? [],
    precisions: raw.precision ? [raw.precision] : [],
    quantizations: raw.quantization ? [raw.quantization] : [],
    ...(raw.requirements === undefined ? {} : { requirements: raw.requirements }),
    license: mergeLicense(raw.license),
    trust: {
      publisherClaim: "local-user",
      publisherVerifiedBySource: null,
      gated: false,
      termsAccepted: null,
      sha256: raw.sha256 ?? null,
      virusScan: "unknown",
      pickleScan: "unknown",
      safetensors: raw.formats?.some(isSafetensors) ?? null,
      moderation: "unknown",
      retrievedAt: raw.retrievedAt,
    },
    metrics: emptyMetrics(),
    presentation: {
      description: raw.description?.trim() || "Model detected in a local Alystria model path.",
      previewUrls: [],
      documentationUrl: raw.documentationUrl ?? null,
      sourceUrl: raw.sourceUrl ?? null,
      brandAssetId: providerId === "local" ? "local" : providerId,
    },
    compatibility: {
      ...emptyCompatibility(),
      compatibleBaseFamilies: raw.baseFamilies ?? [],
      confidence: raw.install.status === "verified" ? "verified-manifest" : "publisher-metadata",
    },
    availability: raw.install.status === "missing" ? "unavailable" : "installed",
    localInstall: raw.install,
    adapter: "alystria-local-manifest",
    raw,
  });
}

export function adaptCloudEndpoint(raw: CloudCatalogEndpoint): CatalogItem<CloudCatalogEndpoint> {
  return makeItem({
    source: "cloud",
    sourceId: raw.id,
    providerId: raw.providerId,
    publisher: raw.publisher,
    name: raw.name,
    revision: raw.revision ?? null,
    immutableHash: null,
    capabilities: raw.capabilities,
    artifactType: "hosted-endpoint",
    modalities: raw.modalities,
    architecture: raw.architecture ?? null,
    baseFamilies: raw.baseFamilies ?? [],
    tags: raw.tags ?? [],
    boundaries: ["cloud"],
    runtimes: [],
    formats: [],
    precisions: [],
    quantizations: [],
    endpoint: {
      baseUrl: raw.endpointBaseUrl,
      operationIds: raw.operationIds,
      openAiCompatible: raw.openAiCompatible ?? false,
    },
    license: mergeLicense(raw.license),
    trust: {
      publisherClaim: "provider",
      publisherVerifiedBySource: null,
      gated: !raw.credentialConfigured,
      termsAccepted: raw.credentialConfigured ? null : false,
      sha256: null,
      virusScan: "not-run",
      pickleScan: "not-run",
      safetensors: null,
      moderation: "unknown",
      retrievedAt: raw.retrievedAt,
    },
    metrics: emptyMetrics(),
    presentation: {
      description: raw.description?.trim() || `Hosted endpoint provided by ${raw.publisher}.`,
      previewUrls: [],
      documentationUrl: raw.documentationUrl ?? null,
      sourceUrl: raw.sourceUrl ?? raw.documentationUrl ?? null,
      brandAssetId: raw.providerId,
    },
    compatibility: {
      ...emptyCompatibility(),
      compatibleBaseFamilies: raw.baseFamilies ?? [],
      confidence: "provider-metadata",
    },
    availability: raw.reachable === false ? "unavailable" : raw.credentialConfigured ? "available" : "gated",
    localInstall: null,
    adapter: "alystria-cloud-endpoint",
    raw,
  });
}

interface MakeItemInput<TRaw> {
  source: CatalogSource;
  sourceId: string;
  providerId: string;
  publisher: string;
  name: string;
  revision: string | null;
  immutableHash: string | null;
  capabilities: readonly CatalogCapability[];
  artifactType: ArtifactType;
  modalities: CatalogClassification["modalities"];
  architecture: string | null;
  baseFamilies: readonly string[];
  tags: readonly string[];
  boundaries: readonly ExecutionBoundary[];
  runtimes: readonly string[];
  formats: readonly string[];
  precisions: readonly string[];
  quantizations: readonly string[];
  endpoint?: CatalogExecution["endpoint"];
  requirements?: Partial<CatalogRequirements>;
  license: CatalogLicense;
  trust: CatalogTrust;
  metrics: CatalogMetrics;
  presentation: CatalogPresentation;
  compatibility: CatalogCompatibilityHints;
  availability: CatalogItem["availability"];
  localInstall: LocalInstallState | null;
  adapter: string;
  raw: TRaw;
}

function makeItem<TRaw>(input: MakeItemInput<TRaw>): CatalogItem<TRaw> {
  return {
    schemaVersion: 1,
    identity: {
      source: input.source,
      sourceId: input.sourceId,
      providerId: input.providerId,
      publisher: input.publisher,
      name: input.name,
      revision: input.revision,
      immutableHash: input.immutableHash,
    },
    classification: {
      capabilities: unique(input.capabilities),
      artifactType: input.artifactType,
      modalities: unique(input.modalities),
      architecture: input.architecture,
      baseFamilies: unique(input.baseFamilies.map(normalizeFamily)),
      tags: unique(input.tags.map((tag) => tag.trim()).filter(Boolean)),
    },
    execution: {
      boundaries: unique(input.boundaries),
      runtimes: unique(input.runtimes),
      formats: unique(input.formats.map((format) => format.toLowerCase())),
      precisions: unique(input.precisions.map((precision) => precision.toLowerCase())),
      quantizations: unique(input.quantizations.map((quantization) => quantization.toLowerCase())),
      endpoint: input.endpoint ?? null,
    },
    requirements: {
      downloadBytes: input.requirements?.downloadBytes ?? null,
      installedBytes: input.requirements?.installedBytes ?? null,
      estimatedRamBytes: input.requirements?.estimatedRamBytes ?? null,
      estimatedVramBytes: input.requirements?.estimatedVramBytes ?? null,
      minimumDriver: input.requirements?.minimumDriver ?? null,
      minimumRuntimeVersions: input.requirements?.minimumRuntimeVersions ?? {},
      requiredArtifacts: input.requirements?.requiredArtifacts ?? [],
    },
    license: input.license,
    trust: input.trust,
    metrics: input.metrics,
    presentation: input.presentation,
    compatibility: input.compatibility,
    availability: input.availability,
    localInstall: input.localInstall,
    sourceMetadata: {
      adapter: input.adapter,
      adapterVersion: 1,
      raw: input.raw,
    },
  };
}

function capabilitiesForPipeline(pipeline: string | null | undefined, tags: readonly string[]): CatalogCapability[] {
  const normalized = pipeline?.toLowerCase() ?? "";
  const table: Record<string, CatalogCapability[]> = {
    "text-generation": ["llm.text"],
    "text2text-generation": ["llm.text", "llm.structured"],
    "image-text-to-text": ["vlm.review"],
    "visual-question-answering": ["vlm.review"],
    "feature-extraction": ["retrieval.embed"],
    "sentence-similarity": ["retrieval.embed"],
    "text-to-image": ["image.generate"],
    "image-to-image": ["image.edit"],
    "image-to-video": ["video.generate"],
    "text-to-video": ["video.generate"],
    "text-to-speech": ["audio.tts"],
    "automatic-speech-recognition": ["audio.transcribe"],
  };
  const capabilities = [...(table[normalized] ?? [])];
  const lowered = tags.map((tag) => tag.toLowerCase());
  if (lowered.some((tag) => tag.includes("inpaint"))) capabilities.push("image.inpaint", "image.edit");
  if (lowered.some((tag) => tag.includes("controlnet") || tag.includes("canny") || tag.includes("depth"))) capabilities.push("image.control");
  if (lowered.some((tag) => tag.includes("ip-adapter") || tag.includes("redux") || tag.includes("reference"))) capabilities.push("image.reference");
  if (lowered.some((tag) => tag.includes("upscal") || tag.includes("super-resolution"))) capabilities.push("image.upscale");
  if (lowered.some((tag) => tag.includes("lip-sync") || tag.includes("lipsync"))) capabilities.push("lipsync.generate");
  if (lowered.some((tag) => tag.includes("portrait-animation") || tag.includes("liveportrait"))) capabilities.push("portrait.animate");
  return unique(capabilities);
}

function capabilitiesForCivitaiType(type: string): CatalogCapability[] {
  const normalized = type.toLowerCase();
  if (normalized.includes("control")) return ["image.control"];
  if (normalized.includes("lora") || normalized.includes("checkpoint") || normalized.includes("hypernetwork") || normalized.includes("textual")) {
    return ["image.generate"];
  }
  if (normalized.includes("upscal")) return ["image.upscale"];
  return ["image.generate"];
}

function civitaiArtifactType(type: string): ArtifactType {
  const normalized = type.toLowerCase();
  if (normalized.includes("lora")) return "lora";
  if (normalized.includes("control")) return "control-adapter";
  if (normalized.includes("checkpoint")) return "checkpoint";
  if (normalized.includes("upscal")) return "upscaler";
  return "model";
}

function inferHuggingFaceArtifact(tags: readonly string[]): ArtifactType {
  const lowered = tags.map((tag) => tag.toLowerCase());
  if (lowered.some((tag) => tag === "lora" || tag.includes("adapter:lora"))) return "lora";
  if (lowered.some((tag) => tag.includes("controlnet"))) return "control-adapter";
  if (lowered.some((tag) => tag.includes("ip-adapter"))) return "reference-adapter";
  if (lowered.some((tag) => tag.includes("gguf") || tag.includes("gptq") || tag.includes("awq"))) return "quantization";
  return "model";
}

function modalitiesForCapabilities(capabilities: readonly CatalogCapability[]): CatalogClassification["modalities"] {
  const modalities = new Set<CatalogClassification["modalities"][number]>();
  for (const capability of capabilities) {
    if (capability.startsWith("llm.") || capability === "research.web" || capability === "retrieval.embed") modalities.add("text");
    if (capability === "vlm.review") modalities.add("multimodal");
    if (capability.startsWith("image.") || capability === "presenter.generate") modalities.add("image");
    if (capability.startsWith("audio.")) modalities.add("audio");
    if (capability.startsWith("video.") || capability === "portrait.animate" || capability === "lipsync.generate") modalities.add("video");
  }
  return [...modalities];
}

function inferFormats(filenames: readonly string[]): string[] {
  return unique(filenames.flatMap((filename) => {
    const extension = extensionOf(filename);
    if (["safetensors", "gguf", "onnx", "pt", "pth", "bin", "ckpt"].includes(extension)) {
      return [extension === "bin" || extension === "pt" || extension === "pth" || extension === "ckpt" ? "pickle" : extension];
    }
    return [];
  }));
}

function inferPrecisions(tags: readonly string[], filenames: readonly string[]): string[] {
  const text = [...tags, ...filenames].join(" ").toLowerCase();
  return ["bf16", "fp16", "fp32", "int8", "int4"].filter((precision) => text.includes(precision));
}

function inferQuantizations(tags: readonly string[]): string[] {
  const known = ["gguf", "gptq", "awq", "bnb-4bit", "bnb-8bit", "fp8", "q4_k_m", "q5_k_m", "q8_0"];
  const lowered = tags.map((tag) => tag.toLowerCase());
  return known.filter((quantization) => lowered.some((tag) => tag.includes(quantization)));
}

function licenseFromIdentifier(identifier: string | null, custom?: { name?: string | null; url?: string | null }): CatalogLicense {
  if (!identifier || identifier === "unknown") return unknownLicense();
  const normalized = identifier.toLowerCase();
  const noncommercial = normalized.includes("non-commercial") || normalized.includes("noncommercial") || normalized.includes("research");
  const permissive = ["apache-2.0", "mit", "bsd", "bsd-2-clause", "bsd-3-clause", "cc0-1.0", "unlicense"].includes(normalized);
  return {
    identifier,
    name: custom?.name ?? identifier,
    url: custom?.url ?? null,
    commercialUse: noncommercial ? "noncommercial-only" : permissive ? "allowed" : "restricted",
    attributionRequired: permissive && normalized !== "cc0-1.0" && normalized !== "unlicense" ? true : null,
    derivativesAllowed: permissive ? true : null,
    hostingAllowed: permissive ? true : null,
    status: normalized === "other" ? "custom" : "known",
    notes: permissive ? [] : ["Review the complete model license before public or commercial use."],
  };
}

function mergeLicense(partial: Partial<CatalogLicense> | null | undefined): CatalogLicense {
  if (!partial) return unknownLicense();
  return {
    identifier: partial.identifier ?? null,
    name: partial.name ?? partial.identifier ?? "Unknown license",
    url: partial.url ?? null,
    commercialUse: partial.commercialUse ?? "unknown",
    attributionRequired: partial.attributionRequired ?? null,
    derivativesAllowed: partial.derivativesAllowed ?? null,
    hostingAllowed: partial.hostingAllowed ?? null,
    status: partial.status ?? (partial.identifier ? "known" : "unknown"),
    notes: partial.notes ?? [],
  };
}

function unknownLicense(): CatalogLicense {
  return {
    identifier: null,
    name: "Unknown license",
    url: null,
    commercialUse: "unknown",
    attributionRequired: null,
    derivativesAllowed: null,
    hostingAllowed: null,
    status: "unknown",
    notes: ["No license metadata was supplied. Do not infer permission from availability."],
  };
}

function civitaiCommercialUse(values: readonly string[] | null | undefined): CommercialUse {
  if (!values || values.length === 0) return "unknown";
  const normalized = values.map((value) => value.toLowerCase());
  if (normalized.includes("none")) return "noncommercial-only";
  if (normalized.some((value) => ["image", "rent", "sell"].includes(value))) return "allowed";
  return "restricted";
}

function scanState(value: string | null | undefined): ScanState {
  if (!value) return "unknown";
  const normalized = value.toLowerCase();
  if (["success", "passed", "pass"].includes(normalized)) return "passed";
  if (["failed", "fail", "danger", "error"].includes(normalized)) return "failed";
  if (["pending", "not scanned", "not-run"].includes(normalized)) return "not-run";
  return "unknown";
}

function emptyCompatibility(): CatalogCompatibilityHints {
  return {
    testedRecipeIds: [],
    compatibleBaseFamilies: [],
    incompatibleBaseFamilies: [],
    requiredGpuVendors: [],
    supportedOperatingSystems: ["windows", "linux", "macos"],
    confidence: "unknown",
  };
}

function emptyMetrics(): CatalogMetrics {
  return { downloads: null, likes: null, rating: null, trendingScore: null, lastModifiedAt: null };
}

function sumKnown(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value != null && Number.isFinite(value) && value >= 0);
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
}

function bytesFromKilobytes(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 1024);
}

function extensionOf(filename: string): string {
  const last = filename.split(".").at(-1);
  return last && last !== filename ? last.toLowerCase() : "";
}

function normalizeFamily(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function stripMarkup(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function toArray(value: string | readonly string[] | null | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? [...value] : [value as string];
}

function isSafetensors(value: string): boolean {
  return value.toLowerCase().includes("safetensor");
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
