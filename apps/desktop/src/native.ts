import { invoke, isTauri } from "@tauri-apps/api/core";

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
}

export interface JobReceipt {
  jobId: string;
  state: JobState;
  acceptedAt: string;
  message: string;
  retryable: boolean;
  operation?: "regenerate_scene" | "render_scene" | "repair_qa" | "export_master";
  progress?: number;
  result?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
}

export interface SceneRegenerationRequest extends ProjectIdentityRequest {
  baseRevisionId: string;
  baseJobId?: string;
  sceneId: string;
  instruction: string;
  preservationLocks: Array<"narration" | "citations" | "learningobjective" | "timing" | "assets" | "presenter">;
  alternatives: number;
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

export interface MasterExportRequest extends ProjectIdentityRequest {
  baseRevisionId: string;
  baseJobId: string;
  aspect: "16:9" | "9:16" | "1:1";
  resolution: "1080p" | "1440p" | "4K";
  fps: 24 | 25 | 30 | 50 | 60;
  captions: boolean;
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

/**
 * A saved no-secret creation preset. It cannot approve a provider or cause a
 * fallback: a project still needs its own reviewed routing policy before a
 * cloud call is possible.
 */
export interface ProfileRoute {
  providerId: string;
  modelId: string;
}

export interface ModelProfile {
  id: string;
  name: string;
  description: string;
  routes: Record<string, ProfileRoute>;
}

export interface LocalModelSetupSaveRequest {
  activeProfileId: string;
  selectedModelIds: string[];
  lipSyncModelId?: string | null;
  existingModelDirectory?: string | null;
  profiles: ModelProfile[];
}

export interface LocalModelSetup extends Omit<LocalModelSetupSaveRequest, "lipSyncModelId" | "existingModelDirectory"> {
  schemaVersion: number;
  lipSyncModelId: string | null;
  existingModelDirectory: string | null;
  updatedAt: string;
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
  }));
}

export function jobCancel(input: JobActionRequest): Promise<JobReceipt> {
  return command("job_cancel", input, () => updateBrowserJob(input.jobId, "CANCELLED", "Browser demo job cancelled."));
}

export function jobRetry(input: JobActionRequest): Promise<JobReceipt> {
  return command("job_retry", input, () => updateBrowserJob(input.jobId, "RUNNING", "Browser demo job restarted."));
}

export function generationApprove(input: JobActionRequest): Promise<JobReceipt> {
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

export function localModelSetupGet(): Promise<LocalModelSetup> {
  return command("local_model_setup_get", undefined, () => structuredClone(browserModelSetup));
}

export function localModelSetupSave(input: LocalModelSetupSaveRequest): Promise<LocalModelSetup> {
  return command("local_model_setup_save", input, () => {
    browserModelSetup = {
      ...structuredClone(input),
      lipSyncModelId: input.lipSyncModelId ?? null,
      existingModelDirectory: input.existingModelDirectory ?? null,
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
    };
    return structuredClone(browserModelSetup);
  });
}

function defaultLocalModelSetup(): LocalModelSetup {
  return {
    schemaVersion: 1,
    activeProfileId: "balanced-cloud",
    selectedModelIds: [],
    lipSyncModelId: null,
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
        voice: { providerId: "elevenlabs", modelId: "choose a voice" },
        transcription: { providerId: "openai", modelId: "choose at generation" },
        presenter: { providerId: "local-runtime", modelId: "off by default" },
        lipSync: { providerId: "local-runtime", modelId: "off by default" },
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
