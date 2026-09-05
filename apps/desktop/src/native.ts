import { invoke, isTauri } from "@tauri-apps/api/core";
import type { CanvasCustomization } from "./types";
import type { EditorTimelineExportRequest } from "./editor/nativeExport";
import type { AlystriaEditorMediaBindings } from "./editor/alystriaAdapter";
import type { EditorWaveformNativeReceipt, EditorWaveformNativeRequest } from "./editor/waveform";

export function editorTimelineExport(input: EditorTimelineExportRequest): Promise<JobReceipt> {
  return command("editor_timeline_export", input, () => { throw new Error("Timeline video rendering requires the desktop app."); });
}

export function editorWaveformGet(input: EditorWaveformNativeRequest): Promise<EditorWaveformNativeReceipt> {
  return command("editor_waveform_get", input, () => { throw new Error("Waveform analysis requires the desktop app."); });
}

export type DesktopEnvironment = "native" | "browser-demo";
export type GroundingMode = "creative" | "grounded" | "strict";
export type QualityPreset = "draft" | "standard" | "maximum";
export type PrivacyMode = "local" | "hybrid" | "cloud";
export type JobState = "BLOCKED" | "READY" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "RETRY_WAIT" | "FAILED" | "CANCELLED" | "STALE";
export type DiagnosticLevel = "pass" | "info" | "warning" | "failure";

export type WorkerStatus =
  | { state: "unavailable"; reason: string }
  | { state: "stopped" }
  | { state: "starting" }
  | { state: "ready"; pid: number; endpoint: string }
  | { state: "degraded"; reason: string }
  | { state: "failed"; reason: string; retryable: boolean }
  | { state: "stopping" };

export interface AppPaths {
  appData: string;
  cache: string;
  logs: string;
  runtimes: string;
  models: string;
  projects: string;
  temp: string;
}

export interface BootstrapInfo {
  appVersion: string;
  platform: string;
  architecture: string;
  projectSchemaVersion: number;
  ticksPerSecond: number;
  paths: AppPaths;
  worker: WorkerStatus;
  runtimeChannel: string;
}

export interface CreateProjectRequest {
  parentDirectory: string;
  directoryName: string;
  title: string;
  locale: string;
  groundingMode: GroundingMode;
  initialSnapshot?: Record<string, unknown>;
}

export interface ProjectIdentityRequest {
  projectId: string;
  projectDirectory: string;
}

export interface SaveProjectSnapshotRequest extends ProjectIdentityRequest {
  expectedHeadRevisionId: string;
  snapshot: Record<string, unknown>;
  message?: string;
}

export interface ProjectSnapshotReceipt {
  projectId: string;
  headRevisionId: string;
  revisionNumber: number;
  rootHash: string;
  updatedAt: string;
  snapshot: Record<string, unknown>;
  history?: ProjectHistoryState;
}

export interface SaveProjectCustomizationRequest extends ProjectIdentityRequest {
  expectedHeadRevisionId: string;
  customization: CanvasCustomization;
  message?: string;
}

export interface ProjectCustomizationReceipt {
  projectId: string;
  headRevisionId: string;
  revisionNumber: number;
  rootHash: string;
  updatedAt: string;
  customization: CanvasCustomization;
}

export interface ProjectHistoryState {
  headRevisionId: string;
  canUndo: boolean;
  canRedo: boolean;
  undoDepth: number;
  redoDepth: number;
}

export interface ProjectHistoryActionRequest extends ProjectIdentityRequest {
  expectedHeadRevisionId: string;
}

export type SourcePrivacy = "public" | "project_local" | "sensitive" | "restricted";
export type SourceRightsStatus = "owned" | "licensed" | "public_domain" | "fair_use" | "unknown";

export interface SourceImportRequest extends ProjectIdentityRequest {
  expectedHeadRevisionId?: string;
  filename: string;
  mimeType: string;
  privacy: SourcePrivacy;
  rightsStatus: SourceRightsStatus;
  license?: string;
  attribution?: string;
  contentBase64: string;
}

export interface SourceImportReceipt {
  projectId: string;
  headRevisionId: string;
  revisionNumber: number;
  id: string;
  versionId: string;
  title: string;
  filename: string;
  origin: string;
  kind: string;
  mediaType: string;
  byteSize: number;
  artifactHash: string;
  storedRelativePath: string;
  privacy: SourcePrivacy;
  rightsStatus: SourceRightsStatus;
  license: string;
  attribution: string | null;
  evidence: number;
  status: "verified" | "review";
}

export type ProjectAssetKind = "presenterPortrait" | "presenterAudio" | "backgroundImage" | "font" | "music" | "soundEffect" | "editorImage" | "editorVideo" | "editorAudio";
export type AssetRightsStatus = "owned" | "licensed" | "publicDomain" | "unknown";
export type AssetPermission = "allowed" | "notAllowed" | "unknown";

export interface AssetRightsInput {
  status: AssetRightsStatus;
  creator?: string;
  license?: string;
  attribution?: string;
  commercialUse: AssetPermission;
  redistribution: AssetPermission;
  modelInput: AssetPermission;
}

export interface PresenterConsentAttestation {
  subjectDisplayName: string;
  attestorDisplayName: string;
  authority: "selfConsent" | "parentOrGuardian" | "authorizedRepresentative";
  grants: Array<"portraitAnimation" | "videoReenactment" | "publicDistribution" | "commercialDistribution">;
  distributionScope: "privatePreview" | "publicNonCommercial" | "publicCommercial";
  accepted: boolean;
  disclosureRequired: boolean;
}

export interface PresenterAssetInput {
  identityType: "synthetic" | "realPerson";
  displayName: string;
  syntheticOriginAttested: boolean;
  consent?: PresenterConsentAttestation;
  selectAfterImport: boolean;
}

export interface ProjectAssetImportRequest extends ProjectIdentityRequest {
  expectedHeadRevisionId: string;
  kind: ProjectAssetKind;
  filename: string;
  mimeType: string;
  privacy: SourcePrivacy;
  rights: AssetRightsInput;
  presenter?: PresenterAssetInput;
  contentBase64: string;
}

export interface PresenterProfileRef {
  profileId: string;
  displayName: string;
  portraitArtifactId: string;
  identityType: "synthetic" | "realPerson";
  consentRecordId?: string;
  disclosureRequired: boolean;
  authorizedDistributionScope: "privatePreview" | "publicNonCommercial" | "publicCommercial";
}

export interface ProjectAssetImportReceipt {
  projectId: string;
  headRevisionId: string;
  revisionNumber: number;
  artifact: { id: string; kind: ProjectAssetKind; sha256: string; byteSize: number; mediaType: string; originalFilename: string; state: string };
  provenance: { id: string; origin: string; rightsStatus: AssetRightsStatus; creator?: string; license?: string; attribution?: string; exportEligible: boolean; blockers: string[]; modelInputEligible: boolean; modelInputBlockers: string[] };
  presenterProfile?: PresenterProfileRef;
  selectedPresenterProfileId?: string;
}

export interface ProjectAssetResolveRequest extends ProjectIdentityRequest {
  artifactHash: string;
}

export interface ProjectAssetResolveReceipt {
  projectId: string;
  artifactHash: string;
  path: string;
  mediaType: string;
  byteSize: number;
}

export interface EditorBindingsGetRequest extends ProjectIdentityRequest {
  generationId: string;
}

export interface EditorBindingsGetReceipt extends AlystriaEditorMediaBindings {
  projectId: string;
  generationId: string;
}

export interface SelectPresenterProfileRequest extends ProjectIdentityRequest {
  expectedHeadRevisionId: string;
  profileId: string;
}

export interface SelectPresenterProfileReceipt {
  projectId: string;
  headRevisionId: string;
  revisionNumber: number;
  selectedPresenterProfileId: string;
  profile: PresenterProfileRef;
}

export interface ExportProjectArchiveRequest extends ProjectIdentityRequest {
  fileName?: string;
}

export interface ExportProjectArchiveReceipt {
  path: string;
}

export interface OpenProjectRequest {
  projectDirectory: string;
  allowReadOnly: boolean;
}

export interface ProjectManifest {
  schemaVersion: number;
  projectId: string;
  title: string;
  locale: string;
  groundingMode: GroundingMode;
  createdAt: string;
  updatedAt: string;
  manifestRevision: number;
  activeSnapshotId: string | null;
  databaseRelativePath: string;
  objectStoreRelativePath: string;
  sourceStoreRelativePath: string;
}

export interface ProjectHandle {
  projectDirectory: string;
  manifest: ProjectManifest;
  access: "readWrite" | "readOnly";
  databaseReady: boolean;
  warnings: string[];
}

export type GenerationScope =
  | { kind: "project" }
  | { kind: "lesson"; id: string }
  | { kind: "section"; id: string }
  | { kind: "scene"; id: string };

export interface GenerationRequest {
  projectId: string;
  projectDirectory: string;
  snapshotId: string | null;
  scope: GenerationScope;
  quality: QualityPreset;
  privacy: PrivacyMode;
  budget: {
    currency: string;
    hardLimitMinorUnits: number;
    requireKnownPricing: boolean;
  };
  approvedProviderIds: string[];
  preservationLocks: string[];
}

export interface JobActionRequest {
  projectId: string;
  projectDirectory: string;
  jobId: string;
  expectedHeadRevisionId?: string;
}

export interface GenerationApprovalRequest extends JobActionRequest {
  expectedHeadRevisionId: string;
}

export interface JobReceipt {
  jobId: string;
  state: JobState;
  acceptedAt: string;
  message: string;
  retryable: boolean;
  operation?: "regenerate_scene" | "search_visual_candidates" | "render_scene" | "repair_qa" | "export_master" | "editor_timeline_export";
  progress?: number;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
}

export interface SceneRegenerationRequest extends ProjectIdentityRequest {
  baseRevisionId: string;
  baseJobId?: string;
  sceneId: string;
  instruction: string;
  role?: "scene" | "presenter";
  seed?: number;
  imageRecipe?: {
    model?: "local/sdxl-base-1.0";
    loras?: Array<"local/sdxl-offset-lora-1.0">;
    negativePrompt?: string;
  };
  preservationLocks: Array<"narration" | "citations" | "learningobjective" | "timing" | "assets" | "presenter">;
  alternatives: number;
}

export interface VisualCandidateAcceptRequest extends ProjectIdentityRequest {
  expectedHeadRevisionId: string;
  candidateId: string;
}

export interface VisualCandidateAcceptReceipt {
  projectId: string;
  headRevisionId: string;
  revisionNumber: number;
  candidateId: string;
  sceneId: string;
  role: "scene" | "presenter";
  artifactHash: string;
  assetId: string;
  invalidated: string[];
}

export interface StockVisualCandidateSearchRequest extends ProjectIdentityRequest {
  expectedHeadRevisionId: string;
  sceneId: string;
  instruction: string;
  preservationLocks: Array<"narration" | "citations" | "learningobjective" | "timing" | "assets" | "presenter">;
  alternatives: number;
  providerId: "openverse" | "pexels";
  searchQuery?: string;
  desiredAspectRatio?: "16:9" | "4:3" | "1:1" | "9:16";
  locale?: string;
}

export interface SceneRenderRequest extends ProjectIdentityRequest {
  baseRevisionId: string;
  baseJobId?: string;
  sceneId: string;
  aspect: "16:9" | "9:16" | "1:1";
  resolution: "1080p" | "1440p" | "4K";
  fps: 24 | 25 | 30 | 50 | 60;
}

export interface QaRepairRequest extends ProjectIdentityRequest {
  baseRevisionId: string;
  baseJobId: string;
  findingIds: string[];
}

export type CaptionDeliveryMode = "sidecar" | "embedded" | "burned" | "both";

export interface MasterExportRequest extends ProjectIdentityRequest {
  baseRevisionId: string;
  baseJobId: string;
  aspect: "16:9" | "9:16" | "1:1";
  resolution: "1080p" | "1440p" | "4K";
  fps: 24 | 25 | 30 | 50 | 60;
  codecPreference?: "h264-hardware" | "hevc-hardware" | "av1";
  captionDeliveryMode: CaptionDeliveryMode;
  transcript: boolean;
  bibliography: boolean;
}

export interface ProviderSecretRequest {
  providerId: string;
  credentialKind: string;
}

export interface SetProviderSecretRequest extends ProviderSecretRequest {
  secret: string;
}

export interface ProviderSecretRef {
  reference: string;
  providerId: string;
  credentialKind: string;
  availability: "present" | "missing" | "keyringUnavailable";
  updatedAt: string | null;
}

export type ProviderCapability =
  | "llm.text"
  | "llm.structured"
  | "research.web"
  | "media.licensed.search"
  | "image.generate"
  | "image.edit"
  | "motion.generate"
  | "audio.tts"
  | "audio.transcribe"
  | "audio.align"
  | "presenter.generate"
  | "portrait.animate"
  | "lipsync.generate"
  | "vlm.chat"
  | "retrieval.embed"
  | "retrieval.rerank";

export interface ProviderApproval {
  providerId: string;
  capabilities: ProviderCapability[];
  credentialRef: string | null;
  boundary: "local" | "cloud";
  retention: "local_only" | "zero_data_retention" | "configurable" | "provider_default" | "unknown";
  regions: string[];
  dataClasses: Array<"public" | "project" | "private" | "biometric" | "secret">;
  privacyApproved: boolean;
  retentionApproved: boolean;
  regionApproved: boolean;
  budgetApproved: boolean;
  termsApproved: boolean;
  modelAccessCheckedAt: string | null;
  /** Non-secret Cloudflare account identifier used only for Workers AI URL construction. */
  accountId?: string | null;
}

export interface TutorialRoutingPolicy {
  version: 1;
  privacyMode: PrivacyMode;
  dataClassification: "public" | "project" | "private" | "biometric" | "secret";
  budget: {
    currency: string;
    hardLimitMicros: number | null;
    requireKnownPricing: boolean;
    approved: boolean;
  };
  approvals: ProviderApproval[];
  routes: Array<{
    capability: ProviderCapability;
    providerIds: string[];
    model: string;
    voice: string | null;
  }>;
}

export interface ProviderRoutingPolicyReceipt {
  policy: TutorialRoutingPolicy | null;
  headRevisionId: string;
  revisionNumber?: number;
}

export interface SaveProviderRoutingPolicyRequest extends ProjectIdentityRequest {
  expectedHeadRevisionId: string;
  policy: TutorialRoutingPolicy;
  message?: string;
}

/**
 * A saved no-secret creation preset. It cannot approve a provider or cause a
 * fallback: a project still needs its own reviewed routing policy before a
 * cloud call is possible.
 */
export interface ProfileRoute {
  providerId: string;
  modelId: string;
  /** Exact runtime identities are optional in reusable presets but mandatory in project snapshots. */
  modelRevision?: string | null;
  installFingerprint?: string | null;
  voiceId?: string | null;
  presenterProfileId?: string | null;
}

export interface ModelProfile {
  id: string;
  name: string;
  description: string;
  routes: Record<string, ProfileRoute>;
}

export interface ProjectModelRouteSnapshot {
  medium: "writing" | "research" | "images" | "motion" | "voice" | "transcription" | "presenter" | "portraitAnimation" | "lipSync" | "stock" | "visualReview";
  capability: ProviderCapability;
  providerId: string;
  modelId: string;
  modelRevision?: string;
  installFingerprint?: string;
  voiceId?: string;
  presenterProfileId?: string;
  boundary: "local" | "cloud";
  retention: ProviderApproval["retention"];
  regions: string[];
  estimatedCostMicros?: number;
  fallbackConsent: boolean;
}

export interface ProjectModelProfileSnapshot {
  schemaVersion: 1;
  profileId: string;
  profileName: string;
  capturedAt: string;
  sourceSetupUpdatedAt?: string;
  routes: ProjectModelRouteSnapshot[];
}

export interface LocalModelSetupSaveRequest {
  activeProfileId: string;
  selectedModelIds: string[];
  lipSyncModelId?: string | null;
  portraitAnimationModelId?: string | null;
  existingModelDirectory?: string | null;
  profiles: ModelProfile[];
}

export interface LocalModelSetup extends Omit<LocalModelSetupSaveRequest, "lipSyncModelId" | "portraitAnimationModelId" | "existingModelDirectory"> {
  schemaVersion: number;
  lipSyncModelId: string | null;
  portraitAnimationModelId?: string | null;
  existingModelDirectory: string | null;
  updatedAt: string;
}

/**
 * One closed lifecycle vocabulary shared by download, install, activation, repair,
 * inference leases, and removal. Current native implementations may expose only a
 * subset, but must never translate an unknown state into a success-looking one.
 */
export type LocalModelLifecyclePhase =
  | "manifestRequired"
  | "inspecting"
  | "licenseRequired"
  | "downloading"
  | "cancelling"
  | "cancelled"
  | "verifying"
  | "downloadedQuarantined"
  | "installing"
  | "activating"
  | "ready"
  | "inUse"
  | "incompatible"
  | "corrupt"
  | "repairing"
  | "removing"
  | "removed"
  | "failed";

export type ModelDownloadPhase = LocalModelLifecyclePhase;

export interface ModelDownloadCatalogEntry {
  modelId: string;
  displayName: string;
  immutableRevision: string;
  totalBytes: number;
  artifactCount: number;
  licenseId: string;
  licenseUrl: string;
  licenseSha256: string;
  licenseScope: string;
  codeRevision: string;
  weightRevision: string;
  available: boolean;
  downloadOnlyReason: string;
}

export interface ModelDownloadStatus {
  modelId: string;
  immutableRevision: string | null;
  phase: ModelDownloadPhase;
  downloadedBytes: number;
  totalBytes: number;
  verifiedArtifacts: number;
  artifactCount: number;
  licenseId: string | null;
  licenseUrl: string | null;
  licenseSha256: string | null;
  licenseAcceptedAt: string | null;
  detail: string;
  activationBlocked: boolean;
  installFingerprint?: string | null;
  runtimeRevision?: string | null;
  canCancel?: boolean;
  canRepair?: boolean;
  canRemove?: boolean;
  inUseBy?: string[];
  updatedAt: string;
}

export interface ModelDownloadStartRequest {
  modelId: string;
  licenseSha256: string;
  licenseAccepted: boolean;
}

export interface LocalModelLifecycleRequest {
  modelId: string;
  immutableRevision: string;
}

export interface LocalModelRepairRequest extends LocalModelLifecycleRequest {
  deepVerify: boolean;
}

export interface DiagnosticCheck {
  id: string;
  label: string;
  level: DiagnosticLevel;
  summary: string;
  details: Record<string, string>;
  remediation: string | null;
}

export interface DiagnosticReport {
  generatedAt: string;
  overall: DiagnosticLevel;
  checks: DiagnosticCheck[];
  system: {
    os: string;
    osVersion: string | null;
    architecture: string;
    cpu: string;
    logicalCpuCount: number;
    totalMemoryBytes: number;
    availableMemoryBytes: number;
    gpu: Array<{ name: string; dedicatedMemoryBytes: number | null; driverVersion: string | null }>;
  };
}

export type RemoteCatalogSource = "hugging-face" | "civitai" | "nvidia-nim" | "cohere";

export interface CatalogDiscoveryRequest {
  source: RemoteCatalogSource;
  query?: string;
  limit?: number;
  cursor?: string | null;
}

export interface CatalogDiscoveryResponse {
  source: RemoteCatalogSource;
  items: unknown[];
  nextCursor: string | null;
  retrievedAt: string;
}

const browserSecretRefs = new Set<string>();
const browserJobs = new Map<string, JobReceipt>();
const browserProjects = new Map<string, { handle: ProjectHandle; snapshot: ProjectSnapshotReceipt }>();
const browserHistory = new Map<string, { undo: ProjectSnapshotReceipt[]; redo: ProjectSnapshotReceipt[] }>();
let browserModelSetup: LocalModelSetup = defaultLocalModelSetup();

export function desktopEnvironment(): DesktopEnvironment {
  try {
    return isTauri() ? "native" : "browser-demo";
  } catch {
    return "browser-demo";
  }
}

async function command<T>(name: string, input: unknown, browserFallback: () => T | Promise<T>): Promise<T> {
  if (desktopEnvironment() === "browser-demo") return browserFallback();
  return invoke<T>(name, input === undefined ? undefined : { input });
}

export function appBootstrap(): Promise<BootstrapInfo> {
  return command("app_bootstrap", undefined, () => ({
    appVersion: "2.0.0-browser-demo",
    platform: "browser",
    architecture: "preview",
    projectSchemaVersion: 1,
    ticksPerSecond: 240_000,
    paths: {
      appData: "/browser-demo/alystria",
      cache: "/browser-demo/alystria/cache",
      logs: "/browser-demo/alystria/logs",
      runtimes: "/browser-demo/alystria/runtimes",
      models: "/browser-demo/alystria/models",
      projects: "/browser-demo/alystria/projects",
      temp: "/browser-demo/alystria/temp",
    },
    worker: { state: "ready", pid: 0, endpoint: "browser-demo://pipeline" },
    runtimeChannel: "browser-demo",
  }));
}

/** Ends the native desktop process after the caller has flushed durable UI state. */
export function desktopShutdown(): Promise<void> {
  return command("desktop_shutdown", undefined, () => Promise.resolve());
}

export function diagnosticsRun(): Promise<DiagnosticReport> {
  return command("diagnostics_run", undefined, () => {
    const checks: DiagnosticCheck[] = [
      ["project-storage", "Project storage", "Browser demo project store"],
      ["pipeline-worker", "Pipeline worker", "Simulated and ready for UI testing"],
      ["frame-renderer", "Frame renderer", "Shared deterministic SceneView"],
      ["credential-vault", "Credential vault", "Native desktop required for OS vault access"],
    ].map(([id, label, summary], index) => ({
      id: id!,
      label: label!,
      level: index === 3 ? "info" : "pass",
      summary: summary!,
      details: {},
      remediation: index === 3 ? "Open the packaged desktop app to manage provider credentials." : null,
    }));
    return {
      generatedAt: new Date().toISOString(),
      overall: "info",
      checks,
      system: {
        os: "browser preview",
        osVersion: null,
        architecture: "preview",
        cpu: "Not probed in browser demo",
        logicalCpuCount: navigator.hardwareConcurrency || 1,
        totalMemoryBytes: 0,
        availableMemoryBytes: 0,
        gpu: [],
      },
    };
  });
}

export function catalogDiscover(input: CatalogDiscoveryRequest): Promise<CatalogDiscoveryResponse> {
  return command("catalog_discover", input, async () => {
    if (input.source === "nvidia-nim" || input.source === "cohere") {
      throw new Error(`Open the packaged AI Video Tutorial Generator app and connect a ${input.source === "cohere" ? "Cohere" : "NVIDIA NIM"} key before syncing the hosted catalog.`);
    }
    const limit = Math.min(50, Math.max(1, input.limit ?? 24));
    let url: URL;
    if (input.cursor) {
      url = validatedCatalogCursor(input.source, input.cursor);
    } else if (input.source === "hugging-face") {
      url = new URL("https://huggingface.co/api/models");
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("full", "true");
      url.searchParams.set("config", "true");
      url.searchParams.set("sort", "downloads");
      url.searchParams.set("direction", "-1");
      if (input.query?.trim()) url.searchParams.set("search", input.query.trim());
    } else {
      url = new URL("https://civitai.com/api/v1/models");
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("sort", "Most Downloaded");
      url.searchParams.set("period", "AllTime");
      url.searchParams.set("nsfw", "false");
      if (input.query?.trim()) url.searchParams.set("query", input.query.trim());
    }
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`The provider returned HTTP ${response.status}.`);
    const body = await response.json() as unknown;
    if (input.source === "hugging-face") {
      if (!Array.isArray(body)) throw new Error("Hugging Face returned an unexpected catalog response.");
      return { source: input.source, items: body, nextCursor: nextLink(response.headers.get("link")), retrievedAt: new Date().toISOString() };
    }
    const record = body && typeof body === "object" ? body as { items?: unknown[]; metadata?: { nextPage?: string } } : {};
    if (!Array.isArray(record.items)) throw new Error("Civitai returned an unexpected catalog response.");
    return { source: input.source, items: record.items, nextCursor: record.metadata?.nextPage ?? null, retrievedAt: new Date().toISOString() };
  });
}

function validatedCatalogCursor(source: CatalogDiscoveryRequest["source"], cursor: string): URL {
  const url = new URL(cursor);
  const expected = source === "hugging-face"
    ? { host: "huggingface.co", path: "/api/models" }
    : source === "civitai"
      ? { host: "civitai.com", path: "/api/v1/models" }
      : source === "cohere"
        ? { host: "api.cohere.com", path: "/v1/models" }
        : { host: "integrate.api.nvidia.com", path: "/v1/models" };
  if (
    url.protocol !== "https:"
    || url.host !== expected.host
    || url.pathname !== expected.path
    || url.username
    || url.password
    || url.hash
  ) {
    throw new Error("The provider returned an unsafe catalog pagination cursor.");
  }
  return url;
}

function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/u);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function projectCreate(input: CreateProjectRequest): Promise<ProjectHandle> {
  return command("project_create", input, () => {
    const projectId = demoId();
    const now = new Date().toISOString();
    const projectDirectory = `${input.parentDirectory.replace(/[\\/]$/u, "")}/${input.directoryName}`;
    const handle: ProjectHandle = {
      projectDirectory,
      manifest: {
        schemaVersion: 1,
        projectId,
        title: input.title,
        locale: input.locale,
        groundingMode: input.groundingMode,
        createdAt: now,
        updatedAt: now,
        manifestRevision: 1,
        activeSnapshotId: null,
        databaseRelativePath: "project.sqlite3",
        objectStoreRelativePath: "objects/sha256",
        sourceStoreRelativePath: "sources/original",
      },
      access: "readWrite",
      databaseReady: true,
      warnings: ["Browser demo: no folder was written to disk."],
    };
    const initialSnapshot = { ...(input.initialSnapshot ?? {}), id: projectId };
    browserProjects.set(projectId, {
      handle,
      snapshot: browserSnapshot(projectId, initialSnapshot, 1),
    });
    browserHistory.set(projectId, { undo: [], redo: [] });
    return handle;
  });
}

export function projectOpen(input: OpenProjectRequest): Promise<ProjectHandle> {
  return command("project_open", input, () => {
    const existing = [...browserProjects.values()].find((value) => value.handle.projectDirectory === input.projectDirectory);
    if (existing) return existing.handle;
    const now = new Date().toISOString();
    return {
      projectDirectory: input.projectDirectory,
      manifest: {
        schemaVersion: 1,
        projectId: demoId(),
        title: input.projectDirectory.split(/[\\/]/u).at(-1) || "Browser demo project",
        locale: "en-US",
        groundingMode: "grounded",
        createdAt: now,
        updatedAt: now,
        manifestRevision: 1,
        activeSnapshotId: null,
        databaseRelativePath: "project.sqlite3",
        objectStoreRelativePath: "objects/sha256",
        sourceStoreRelativePath: "sources/original",
      },
      access: "readWrite",
      databaseReady: true,
      warnings: ["Browser demo: the saved native folder link was not opened on disk."],
    };
  });
}

export function projectSnapshotGet(input: ProjectIdentityRequest): Promise<ProjectSnapshotReceipt> {
  return command("project_snapshot_get", input, () => {
    const project = browserProjects.get(input.projectId);
    if (!project || project.handle.projectDirectory !== input.projectDirectory) {
      throw new Error("Browser demo project snapshot is unavailable.");
    }
    return structuredClone(project.snapshot);
  });
}

export function projectSnapshotSave(input: SaveProjectSnapshotRequest): Promise<ProjectSnapshotReceipt> {
  return command("project_snapshot_save", input, () => {
    const project = browserProjects.get(input.projectId);
    if (!project || project.handle.projectDirectory !== input.projectDirectory) {
      throw new Error("Browser demo project snapshot is unavailable.");
    }
    if (project.snapshot.headRevisionId !== input.expectedHeadRevisionId) {
      throw new Error("REVISION_CONFLICT: Reload the durable project snapshot before saving.");
    }
    const history = browserHistory.get(input.projectId) ?? { undo: [], redo: [] };
    history.undo.push(structuredClone(project.snapshot));
    history.redo = [];
    browserHistory.set(input.projectId, history);
    const next = browserSnapshot(input.projectId, { ...input.snapshot, id: input.projectId }, project.snapshot.revisionNumber + 1);
    project.snapshot = next;
    return structuredClone(next);
  });
}

export function projectCustomizationSave(input: SaveProjectCustomizationRequest): Promise<ProjectCustomizationReceipt> {
  return command("project_customization_save", input, () => {
    const project = browserProjects.get(input.projectId);
    if (!project || project.handle.projectDirectory !== input.projectDirectory) {
      throw new Error("Browser demo project snapshot is unavailable.");
    }
    if (project.snapshot.headRevisionId !== input.expectedHeadRevisionId) {
      throw new Error("REVISION_CONFLICT: Reload the durable project customization before saving.");
    }
    const history = browserHistory.get(input.projectId) ?? { undo: [], redo: [] };
    history.undo.push(structuredClone(project.snapshot));
    history.redo = [];
    browserHistory.set(input.projectId, history);
    const next = browserSnapshot(input.projectId, {
      ...project.snapshot.snapshot,
      customization: structuredClone(input.customization),
    }, project.snapshot.revisionNumber + 1);
    project.snapshot = next;
    return {
      projectId: input.projectId,
      headRevisionId: next.headRevisionId,
      revisionNumber: next.revisionNumber,
      rootHash: next.rootHash,
      updatedAt: next.updatedAt,
      customization: structuredClone(input.customization),
    };
  });
}

export function projectHistoryGet(input: ProjectIdentityRequest): Promise<ProjectHistoryState> {
  return command("project_history_get", input, () => {
    const project = browserProjects.get(input.projectId);
    if (!project || project.handle.projectDirectory !== input.projectDirectory) throw new Error("Browser demo project history is unavailable.");
    return browserHistoryState(input.projectId, project.snapshot.headRevisionId);
  });
}

export function projectHistoryUndo(input: ProjectHistoryActionRequest): Promise<ProjectSnapshotReceipt> {
  return command("project_history_undo", input, () => browserHistoryMove(input, "undo"));
}

export function projectHistoryRedo(input: ProjectHistoryActionRequest): Promise<ProjectSnapshotReceipt> {
  return command("project_history_redo", input, () => browserHistoryMove(input, "redo"));
}

export function sourceImport(input: SourceImportRequest): Promise<SourceImportReceipt> {
  return command("source_import", input, () => {
    const project = browserProjects.get(input.projectId);
    if (!project || project.handle.projectDirectory !== input.projectDirectory) {
      throw new Error("Browser demo project snapshot is unavailable.");
    }
    if (input.expectedHeadRevisionId && project.snapshot.headRevisionId !== input.expectedHeadRevisionId) {
      throw new Error("REVISION_CONFLICT: Reload the durable project snapshot before importing.");
    }
    const byteSize = decodedBase64Length(input.contentBase64);
    if (byteSize > 8 * 1024 * 1024) throw new Error("Source exceeds the 8 MiB import limit.");
    const id = `src_${demoId().replaceAll("-", "")}`;
    const artifactHash = demoHash(`${input.filename}:${byteSize}:${input.contentBase64.slice(0, 64)}`);
    const receipt: SourceImportReceipt = {
      projectId: input.projectId,
      headRevisionId: `rev_browser_${demoId().replaceAll("-", "")}`,
      revisionNumber: project.snapshot.revisionNumber + 1,
      id,
      versionId: `srcv_${artifactHash.slice(0, 24)}`,
      title: input.filename,
      filename: input.filename,
      origin: "Imported file",
      kind: "document",
      mediaType: input.mimeType,
      byteSize,
      artifactHash,
      storedRelativePath: `sources/original/${artifactHash.slice(0, 16)}-${input.filename}`,
      privacy: input.privacy,
      rightsStatus: input.rightsStatus,
      license: input.license ?? "Rights review required",
      attribution: input.attribution ?? null,
      evidence: 0,
      status: input.rightsStatus === "unknown" ? "review" : "verified",
    };
    const sources = Array.isArray(project.snapshot.snapshot.sources) ? project.snapshot.snapshot.sources : [];
    project.snapshot = {
      ...project.snapshot,
      headRevisionId: receipt.headRevisionId,
      revisionNumber: receipt.revisionNumber,
      updatedAt: new Date().toISOString(),
      snapshot: { ...project.snapshot.snapshot, sources: [...sources, receipt] },
    };
    return receipt;
  });
}

export function projectAssetImport(input: ProjectAssetImportRequest): Promise<ProjectAssetImportReceipt> {
  return command("project_asset_import", input, () => {
    const project = browserProjects.get(input.projectId);
    if (!project || project.handle.projectDirectory !== input.projectDirectory) throw new Error("Browser demo project snapshot is unavailable.");
    if (project.snapshot.headRevisionId !== input.expectedHeadRevisionId) throw new Error("REVISION_CONFLICT: Reload the project before importing this asset.");
    const byteSize = decodedBase64Length(input.contentBase64);
    const sha256 = demoHash(`${input.kind}:${input.filename}:${byteSize}:${input.contentBase64.slice(0, 96)}`);
    const exportBlockers = [
      ...(input.rights.status === "unknown" ? ["Rights status has not been established"] : []),
      ...(input.rights.status === "licensed" && !input.rights.license?.trim() ? ["Licensed media requires a license identifier or terms reference"] : []),
      ...(input.rights.status === "licensed" && !input.rights.attribution?.trim() ? ["Licensed media requires attribution metadata"] : []),
      ...(input.rights.commercialUse !== "allowed" ? ["Commercial-use permission is not explicitly allowed"] : []),
      ...(input.rights.redistribution !== "allowed" ? ["Redistribution permission is not explicitly allowed"] : []),
    ];
    const exportEligible = exportBlockers.length === 0;
    const modelInputEligible = input.rights.modelInput === "allowed";
    const artifactId = `asset_${sha256.slice(0, 24)}`;
    const profile = input.kind === "presenterPortrait" && input.presenter ? {
      profileId: `presenter_${sha256.slice(0, 20)}`,
      displayName: input.presenter.displayName,
      portraitArtifactId: artifactId,
      identityType: input.presenter.identityType,
      ...(input.presenter.identityType === "realPerson" ? { consentRecordId: `consent_${sha256.slice(0, 20)}` } : {}),
      disclosureRequired: true,
      authorizedDistributionScope: input.presenter.identityType === "synthetic" ? "publicCommercial" : input.presenter.consent?.distributionScope ?? "privatePreview",
    } satisfies PresenterProfileRef : undefined;
    const next = browserSnapshot(input.projectId, {
      ...project.snapshot.snapshot,
      importedAssets: [
        ...(Array.isArray(project.snapshot.snapshot.importedAssets) ? project.snapshot.snapshot.importedAssets : []),
        { id: artifactId, kind: input.kind, sha256, byteSize, mediaType: input.mimeType, originalFilename: input.filename },
      ],
      ...(profile && input.presenter?.selectAfterImport ? { selectedPresenterProfileId: profile.profileId } : {}),
    }, project.snapshot.revisionNumber + 1);
    project.snapshot = next;
    return {
      projectId: input.projectId,
      headRevisionId: next.headRevisionId,
      revisionNumber: next.revisionNumber,
      artifact: { id: artifactId, kind: input.kind, sha256, byteSize, mediaType: input.mimeType, originalFilename: input.filename, state: "quarantined" },
      provenance: {
        id: `prov_${sha256.slice(0, 20)}`,
        origin: "User upload · browser demo",
        rightsStatus: input.rights.status,
        ...(input.rights.creator ? { creator: input.rights.creator } : {}),
        ...(input.rights.license ? { license: input.rights.license } : {}),
        ...(input.rights.attribution ? { attribution: input.rights.attribution } : {}),
        exportEligible,
        blockers: exportBlockers,
        modelInputEligible,
        modelInputBlockers: modelInputEligible ? [] : ["Model-input permission is not explicitly allowed."],
      },
      ...(profile ? { presenterProfile: profile } : {}),
      ...(profile && input.presenter?.selectAfterImport ? { selectedPresenterProfileId: profile.profileId } : {}),
    };
  });
}

export function projectAssetResolve(input: ProjectAssetResolveRequest): Promise<ProjectAssetResolveReceipt> {
  return command("project_asset_resolve", input, () => {
    throw new Error("Project media resolution requires the desktop app.");
  });
}

export function editorBindingsGet(input: EditorBindingsGetRequest): Promise<EditorBindingsGetReceipt> {
  return command("editor_bindings_get", input, () => {
    throw new Error("Generated editor media bindings require the desktop app.");
  });
}

export function presenterProfileSelect(input: SelectPresenterProfileRequest): Promise<SelectPresenterProfileReceipt> {
  return command("presenter_profile_select", input, () => {
    const project = browserProjects.get(input.projectId);
    if (!project || project.handle.projectDirectory !== input.projectDirectory) throw new Error("Browser demo project snapshot is unavailable.");
    if (project.snapshot.headRevisionId !== input.expectedHeadRevisionId) throw new Error("REVISION_CONFLICT: Reload the project before selecting this presenter.");
    const profile: PresenterProfileRef = {
      profileId: input.profileId,
      displayName: "Selected presenter",
      portraitArtifactId: `asset_${input.profileId}`,
      identityType: "synthetic",
      disclosureRequired: false,
      authorizedDistributionScope: "publicCommercial",
    };
    const next = browserSnapshot(input.projectId, { ...project.snapshot.snapshot, selectedPresenterProfileId: input.profileId }, project.snapshot.revisionNumber + 1);
    project.snapshot = next;
    return { projectId: input.projectId, headRevisionId: next.headRevisionId, revisionNumber: next.revisionNumber, selectedPresenterProfileId: input.profileId, profile };
  });
}

export function projectExportArchive(input: ExportProjectArchiveRequest): Promise<ExportProjectArchiveReceipt> {
  return command("project_export_archive", input, () => ({
    path: `${input.projectDirectory.replace(/[\\/]$/u, "")}/exports/${input.fileName ?? `tutorial-${demoId()}.alytutorial`}`,
  }));
}

export function generationStart(input: GenerationRequest): Promise<JobReceipt> {
  return command("generation_start", input, () => {
    const receipt: JobReceipt = {
      jobId: demoId(),
      state: "RUNNING",
      acceptedAt: new Date().toISOString(),
      message: "Browser demo generation is running.",
      retryable: false,
    };
    browserJobs.set(receipt.jobId, receipt);
    return receipt;
  });
}

export function sceneRegenerate(input: SceneRegenerationRequest): Promise<JobReceipt> {
  return command("scene_regenerate", input, () => browserControlReceipt("regenerate_scene", {
    demoOnly: true,
    sceneId: input.sceneId,
    baseRevisionId: input.baseRevisionId,
    candidateIds: Array.from({ length: input.alternatives }, () => `demo_candidate_${demoId()}`),
    preservationLocks: input.preservationLocks,
  }));
}

export function sceneCandidateAccept(input: VisualCandidateAcceptRequest): Promise<VisualCandidateAcceptReceipt> {
  return command("scene_candidate_accept", input, () => {
    throw new Error("Visual candidate acceptance requires the desktop app.");
  });
}

export function searchVisualCandidates(input: StockVisualCandidateSearchRequest): Promise<JobReceipt> {
  return command("scene_stock_search", input, () => browserControlReceipt("search_visual_candidates", {
    demoOnly: true,
    sceneId: input.sceneId,
    providerId: input.providerId,
    searchQuery: input.searchQuery ?? null,
    candidateIds: Array.from({ length: input.alternatives }, () => `demo_candidate_${demoId()}`),
    preservationLocks: input.preservationLocks,
  }));
}

export function sceneRender(input: SceneRenderRequest): Promise<JobReceipt> {
  return command("scene_render", input, () => browserControlReceipt("render_scene", {
    demoOnly: true,
    sceneId: input.sceneId,
    path: null,
    target: { aspect: input.aspect, resolution: input.resolution, fps: input.fps },
  }));
}

export function qaRepair(input: QaRepairRequest): Promise<JobReceipt> {
  return command("qa_repair", input, () => browserControlReceipt("repair_qa", {
    demoOnly: true,
    findingIds: input.findingIds,
  }));
}

export function masterExport(input: MasterExportRequest): Promise<JobReceipt> {
  return command("master_export", input, () => browserControlReceipt("export_master", {
    demoOnly: true,
    path: null,
    target: { aspect: input.aspect, resolution: input.resolution, fps: input.fps },
    captionDelivery: {
      mode: input.captionDeliveryMode,
      sidecars: ["vtt", "srt"],
      burnedIntoPixels: input.captionDeliveryMode === "burned" || input.captionDeliveryMode === "both",
      embeddedInContainer: input.captionDeliveryMode === "embedded" || input.captionDeliveryMode === "both",
    },
  }));
}

export function jobCancel(input: JobActionRequest): Promise<JobReceipt> {
  return command("job_cancel", input, () => updateBrowserJob(input.jobId, "CANCELLED", "Browser demo job cancelled."));
}

export function jobRetry(input: JobActionRequest): Promise<JobReceipt> {
  return command("job_retry", input, () => updateBrowserJob(input.jobId, "RUNNING", "Browser demo job restarted."));
}

export function generationApprove(input: GenerationApprovalRequest): Promise<JobReceipt> {
  return command("generation_approve", input, () => updateBrowserJob(input.jobId, "SUCCEEDED", "Browser demo generation approved and completed."));
}

export function jobStatus(input: JobActionRequest): Promise<JobReceipt> {
  return command("job_status", input, () => browserJobs.get(input.jobId) ?? updateBrowserJob(input.jobId, "STALE", "Browser demo job is no longer active."));
}

export function providerSecretStatus(input: ProviderSecretRequest): Promise<ProviderSecretRef> {
  return command("provider_secret_status", input, () => browserSecretRef(input, browserSecretRefs.has(secretKey(input)) ? "present" : "missing"));
}

export function providerSecretSet(input: SetProviderSecretRequest): Promise<ProviderSecretRef> {
  return command("provider_secret_set", input, () => {
    // Browser preview records only availability. The credential value is immediately discarded.
    browserSecretRefs.add(secretKey(input));
    return browserSecretRef(input, "present", new Date().toISOString());
  });
}

export function providerSecretDelete(input: ProviderSecretRequest): Promise<ProviderSecretRef> {
  return command("provider_secret_delete", input, () => {
    browserSecretRefs.delete(secretKey(input));
    return browserSecretRef(input, "missing");
  });
}

export function providerRoutingPolicyGet(input: ProjectIdentityRequest): Promise<ProviderRoutingPolicyReceipt> {
  return command("provider_routing_policy_get", input, () => {
    const project = browserProjects.get(input.projectId);
    if (!project || project.handle.projectDirectory !== input.projectDirectory) throw new Error("Browser demo project routing policy is unavailable.");
    const policy = project.snapshot.snapshot.providerRoutingPolicy;
    return {
      policy: policy && typeof policy === "object" ? structuredClone(policy) as TutorialRoutingPolicy : null,
      headRevisionId: project.snapshot.headRevisionId,
    };
  });
}

export function providerRoutingPolicySave(input: SaveProviderRoutingPolicyRequest): Promise<ProviderRoutingPolicyReceipt> {
  return command("provider_routing_policy_save", input, () => {
    const project = browserProjects.get(input.projectId);
    if (!project || project.handle.projectDirectory !== input.projectDirectory) throw new Error("Browser demo project routing policy is unavailable.");
    if (project.snapshot.headRevisionId !== input.expectedHeadRevisionId) throw new Error("REVISION_CONFLICT: Reload the durable project snapshot before saving routing.");
    const history = browserHistory.get(input.projectId) ?? { undo: [], redo: [] };
    history.undo.push(structuredClone(project.snapshot));
    history.redo = [];
    browserHistory.set(input.projectId, history);
    const next = browserSnapshot(input.projectId, { ...project.snapshot.snapshot, providerRoutingPolicy: structuredClone(input.policy) }, project.snapshot.revisionNumber + 1);
    project.snapshot = next;
    return { policy: structuredClone(input.policy), headRevisionId: next.headRevisionId, revisionNumber: next.revisionNumber };
  });
}

export function localModelSetupGet(): Promise<LocalModelSetup> {
  return command("local_model_setup_get", undefined, () => structuredClone(browserModelSetup));
}

export function localModelSetupSave(input: LocalModelSetupSaveRequest): Promise<LocalModelSetup> {
  return command("local_model_setup_save", input, () => {
    browserModelSetup = {
      ...withBrowserContractRuntimeIdentity(structuredClone(input)),
      lipSyncModelId: input.lipSyncModelId ?? null,
      portraitAnimationModelId: input.portraitAnimationModelId ?? null,
      existingModelDirectory: input.existingModelDirectory ?? null,
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
    };
    return structuredClone(browserModelSetup);
  });
}

function withBrowserContractRuntimeIdentity(input: LocalModelSetupSaveRequest): LocalModelSetupSaveRequest {
  const profiles = input.profiles.map((profile) => ({
    ...profile,
    routes: Object.fromEntries(Object.entries(profile.routes).map(([medium, route]) => {
      if (!route || route.providerId !== "local-runtime" || !route.modelId.trim() || route.modelId.trim().toLowerCase().startsWith("off")) {
        return [medium, route];
      }
      const identity = new TextEncoder().encode(`alystria-browser-contract:${route.modelId}`);
      let fingerprint = "";
      for (let index = 0; index < 64; index += 1) fingerprint += identity[index % identity.length]!.toString(16).padStart(2, "0").slice(-1);
      return [medium, {
        ...route,
        modelRevision: route.modelRevision?.trim() || `browser-contract-${route.modelId.replaceAll("/", "-")}-v1`,
        installFingerprint: route.installFingerprint?.trim() || fingerprint,
      }];
    })) as ModelProfile["routes"],
  }));
  return { ...input, profiles };
}

const browserDownloadCatalog: ModelDownloadCatalogEntry[] = [{
  modelId: "local/musetalk-1.5",
  displayName: "MuseTalk 1.5",
  immutableRevision: "musetalk-hf-3ef28bc5+code-0a89dec4+dependencies-2026-08-29",
  totalBytes: 4_392_963_609,
  artifactCount: 10,
  licenseId: "MIT-code-repository",
  licenseUrl: "https://github.com/TMElyralab/MuseTalk/blob/0a89dec45a0192b824e3cf4daf96c239440c5ed8/LICENSE",
  licenseSha256: "992ec5fd1dd4964cfa003665196cd0c0c10a7a5aa10109991e964eebd2c7f116",
  licenseScope: "MuseTalk source code only; model-card and dependency terms remain separate activation gates.",
  codeRevision: "0a89dec45a0192b824e3cf4daf96c239440c5ed8",
  weightRevision: "3ef28bc5cff08c90ad8178a25f1b570cd800170f",
  available: false,
  downloadOnlyReason: "Native app required. Browser demo mode never downloads model bytes.",
}];

export function localModelDownloadCatalog(): Promise<ModelDownloadCatalogEntry[]> {
  return command("local_model_download_catalog", undefined, () => structuredClone(browserDownloadCatalog));
}

export function localModelDownloadStatus(): Promise<ModelDownloadStatus[]> {
  return command("local_model_download_status", undefined, () => browserDownloadCatalog.map((entry) => ({
    modelId: entry.modelId,
    immutableRevision: entry.immutableRevision,
    phase: "manifestRequired" as const,
    downloadedBytes: 0,
    totalBytes: entry.totalBytes,
    verifiedArtifacts: 0,
    artifactCount: entry.artifactCount,
    licenseId: entry.licenseId,
    licenseUrl: entry.licenseUrl,
    licenseSha256: entry.licenseSha256,
    licenseAcceptedAt: null,
    detail: "Open the native app to stage this pack. Browser demo mode never downloads model bytes.",
    activationBlocked: true,
    updatedAt: new Date().toISOString(),
  })));
}

export function localModelDownloadStart(input: ModelDownloadStartRequest): Promise<ModelDownloadStatus> {
  return command("local_model_download_start", input, () => Promise.reject(new Error("Open the native app to download model packs. Browser demo mode never downloads model bytes.")));
}

function defaultLocalModelSetup(): LocalModelSetup {
  return {
    schemaVersion: 1,
    activeProfileId: "balanced-cloud",
    selectedModelIds: ["local/qwen3.5-9b-gguf", "local/kokoro", "local/whisper-large-v3-turbo", "local/liveportrait", "local/musetalk-1.5"],
    lipSyncModelId: "local/musetalk-1.5",
    portraitAnimationModelId: "local/liveportrait",
    existingModelDirectory: null,
    updatedAt: new Date().toISOString(),
    profiles: [{
      id: "balanced-cloud",
      name: "Balanced cloud",
      description: "Use configured APIs for most stages; keep local-model choices explicit.",
      routes: {
        writing: { providerId: "openai", modelId: "choose at generation" },
        research: { providerId: "openai", modelId: "choose at generation" },
        images: { providerId: "openai", modelId: "gpt-image-2" },
        voice: {
          providerId: "elevenlabs",
          modelId: "eleven_multilingual_v2",
          voiceId: "Xb7hH8MSUJpSbSDYk0k2",
        },
        transcription: { providerId: "openai", modelId: "choose at generation" },
        presenter: { providerId: "local-runtime", modelId: "off by default" },
        portraitAnimation: { providerId: "local-runtime", modelId: "local/liveportrait" },
        lipSync: { providerId: "local-runtime", modelId: "local/musetalk-1.5" },
      },
    }],
  };
}

function browserSecretRef(input: ProviderSecretRequest, availability: ProviderSecretRef["availability"], updatedAt: string | null = null): ProviderSecretRef {
  return {
    reference: `browser-demo://alystria/${input.providerId}/${input.credentialKind}`,
    providerId: input.providerId,
    credentialKind: input.credentialKind,
    availability,
    updatedAt,
  };
}

function secretKey(input: ProviderSecretRequest): string {
  return `${input.providerId}/${input.credentialKind}`;
}

function updateBrowserJob(jobId: string, state: JobState, message: string): JobReceipt {
  const receipt: JobReceipt = {
    jobId,
    state,
    acceptedAt: browserJobs.get(jobId)?.acceptedAt ?? new Date().toISOString(),
    message,
    retryable: state === "FAILED" || state === "BLOCKED",
  };
  browserJobs.set(jobId, receipt);
  return receipt;
}

function browserControlReceipt(operation: NonNullable<JobReceipt["operation"]>, result: Record<string, unknown>): JobReceipt {
  const receipt: JobReceipt = {
    jobId: demoId(),
    state: "SUCCEEDED",
    acceptedAt: new Date().toISOString(),
    message: `Browser demo only: ${operation.replaceAll("_", " ")} simulated; no native artifact was created.`,
    retryable: false,
    operation,
    progress: 1,
    result,
  };
  browserJobs.set(receipt.jobId, receipt);
  return receipt;
}

function browserHistoryState(projectId: string, headRevisionId: string): ProjectHistoryState {
  const history = browserHistory.get(projectId) ?? { undo: [], redo: [] };
  return {
    headRevisionId,
    canUndo: history.undo.length > 0,
    canRedo: history.redo.length > 0,
    undoDepth: history.undo.length,
    redoDepth: history.redo.length,
  };
}

function browserHistoryMove(input: ProjectHistoryActionRequest, direction: "undo" | "redo"): ProjectSnapshotReceipt {
  const project = browserProjects.get(input.projectId);
  if (!project || project.handle.projectDirectory !== input.projectDirectory) throw new Error("Browser demo project history is unavailable.");
  if (project.snapshot.headRevisionId !== input.expectedHeadRevisionId) throw new Error("REVISION_CONFLICT: Reload before navigating history.");
  const history = browserHistory.get(input.projectId) ?? { undo: [], redo: [] };
  const from = direction === "undo" ? history.undo : history.redo;
  const to = direction === "undo" ? history.redo : history.undo;
  const target = from.pop();
  if (!target) throw new Error(`Browser demo has nothing to ${direction}.`);
  to.push(structuredClone(project.snapshot));
  const restored = browserSnapshot(input.projectId, structuredClone(target.snapshot), project.snapshot.revisionNumber + 1);
  browserHistory.set(input.projectId, history);
  restored.history = browserHistoryState(input.projectId, restored.headRevisionId);
  project.snapshot = restored;
  return structuredClone(restored);
}

function demoId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `00000000-0000-7000-8000-${Date.now().toString().padStart(12, "0").slice(-12)}`;
}

function browserSnapshot(projectId: string, snapshot: Record<string, unknown>, revisionNumber: number): ProjectSnapshotReceipt {
  return {
    projectId,
    headRevisionId: `rev_browser_${demoId().replaceAll("-", "")}`,
    revisionNumber,
    rootHash: demoHash(JSON.stringify(snapshot)),
    updatedAt: new Date().toISOString(),
    snapshot,
  };
}

function decodedBase64Length(value: string): number {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new Error("Source content is not valid base64.");
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function demoHash(value: string): string {
  let state = 2166136261;
  for (const character of value) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  return Math.abs(state >>> 0).toString(16).padStart(8, "0").repeat(8).slice(0, 64);
}
