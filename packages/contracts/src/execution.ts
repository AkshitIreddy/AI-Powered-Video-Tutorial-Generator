import type { Diagnostic, Dimensions, EntityId, EntityRef, IsoDateTime, JsonValue, Money, Rational, RelativePath, Sha256 } from "./common.js";

export interface Artifact {
  id: EntityId; kind: "source" | "evidence-index" | "prompt" | "script" | "image" | "audio" | "video" | "caption" | "transcript" | "font" | "model" | "render-frame" | "scene-mezzanine" | "export" | "manifest" | "consent-proof" | "diagnostic" | "other";
  contentHash: Sha256; sizeBytes: number; mimeType: string; storage: { algorithm: "sha256"; relativePath: RelativePath; externalUri?: string };
  createdAt: IsoDateTime; state: "staged" | "verified" | "promoted" | "quarantined" | "missing" | "corrupt"; provenanceId?: EntityId; metadata?: JsonValue;
}

export type ProviderCapabilityKind = "llm" | "embedding" | "reranking" | "image" | "video" | "tts" | "asr" | "alignment" | "presenter" | "portrait-animation" | "lip-sync" | "media-search" | "research" | "render" | "code-execution";
export interface ProviderCapability {
  kind: ProviderCapabilityKind; models: EntityId[]; locality: "local" | "cloud" | "hybrid";
  dataClasses: ("public" | "project-metadata" | "source-text" | "media" | "biometric" | "private" | "secret")[];
  retention: "none" | "transient" | "provider-default" | "configurable" | "unknown"; regions: string[];
  supportsStructuredOutput?: boolean; supportsStreaming?: boolean; supportsCancellation?: boolean;
}
export interface ProviderDescriptor {
  id: EntityId; name: string; adapterVersion: string; status: "available" | "unconfigured" | "disabled" | "degraded" | "unavailable" | "deprecated";
  capabilities: ProviderCapability[]; credentialMode: "none" | "api-key" | "oauth" | "service-account" | "local-endpoint"; credentialRef?: EntityId;
  baseUri?: string; lastVerifiedAt: IsoDateTime; privacyPolicyUri?: string; termsUri?: string;
}
export type ModelLifecycleStatus = "available" | "not-installed" | "manifest-required" | "inspecting" | "license-required" | "downloading" | "cancelling" | "cancelled" | "verifying" | "downloaded-quarantined" | "installing" | "activating" | "ready" | "in-use" | "incompatible" | "corrupt" | "repairing" | "removing" | "removed" | "failed" | "disabled" | "deprecated";
export interface ModelDescriptor {
  id: EntityId; providerId: EntityId; name: string; revision: string; capability: "llm" | "embedding" | "reranking" | "image" | "video" | "tts" | "asr" | "alignment" | "presenter" | "portrait-animation" | "lip-sync";
  status: ModelLifecycleStatus; locality: "local" | "cloud";
  downloadUri?: string; contentHash?: Sha256; sizeBytes?: number; minimumVramMiB?: number; minimumRamMiB?: number; licenseExpression?: string;
  licenseStatus: "approved" | "review-required" | "restricted" | "unknown"; lastVerifiedAt: IsoDateTime;
}
export type UsageMeter = "input-token" | "output-token" | "character" | "second" | "image" | "video-second" | "request" | "compute-second" | "storage-byte-month";
export interface PricingRule { id: EntityId; providerId: EntityId; modelId: EntityId; meter: UsageMeter; unitSize: number; price: Money; effectiveAt: IsoDateTime; expiresAt?: IsoDateTime; lastVerifiedAt: IsoDateTime }
export interface UsageRecord { id: EntityId; taskAttemptId: EntityId; providerId: EntityId; modelId: EntityId; meter: UsageMeter; quantity: number; estimated: boolean; cost: Money; providerRequestId?: string; recordedAt: IsoDateTime }
export type TaskState = "BLOCKED" | "READY" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "RETRY_WAIT" | "FAILED" | "CANCELLED" | "STALE";
export interface TaskRun {
  id: EntityId; jobId: EntityId; kind: string; taskKey: Sha256; implementationVersion: string; state: TaskState; parameters: JsonValue;
  inputArtifactIds: EntityId[]; outputArtifactIds?: EntityId[]; dependencyTaskIds: EntityId[]; attemptIds: EntityId[]; createdAt: IsoDateTime;
  startedAt?: IsoDateTime; completedAt?: IsoDateTime; retryAt?: IsoDateTime; progress?: number; maxAttempts: number; diagnostics?: Diagnostic[];
}
export interface TaskAttempt {
  id: EntityId; taskId: EntityId; number: number; state: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "ABANDONED";
  stagingPath: RelativePath; leaseOwner?: string; leaseExpiresAt?: IsoDateTime; providerRequestId?: string; idempotencyKey?: Sha256;
  createdAt: IsoDateTime; startedAt?: IsoDateTime; completedAt?: IsoDateTime; usageIds: EntityId[]; diagnostics: Diagnostic[];
}
export interface GenerationRun {
  id: EntityId; projectId: EntityId; revisionId: EntityId; status: "draft" | "awaiting-approval" | "queued" | "running" | "paused" | "succeeded" | "partially-succeeded" | "failed" | "cancelled";
  mode: "cloud" | "local" | "hybrid"; taskIds: EntityId[]; privacyApproval: "not-required" | "pending" | "approved" | "rejected" | "expired";
  createdAt: IsoDateTime; completedAt?: IsoDateTime;
}
export interface JobRun {
  id: EntityId; projectId: EntityId; generationRunId?: EntityId; kind: "research" | "plan" | "script" | "storyboard" | "generate" | "regenerate" | "render" | "export" | "import" | "migration" | "model-download" | "diagnostic";
  state: "BLOCKED" | "READY" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "PARTIALLY_SUCCEEDED" | "FAILED" | "CANCELLING" | "CANCELLED" | "PAUSED" | "RECOVERING";
  taskIds: EntityId[]; createdAt: IsoDateTime; startedAt?: IsoDateTime; completedAt?: IsoDateTime; progress: number; etaMinimumSeconds?: number; etaMaximumSeconds?: number;
  cancellationRequested: boolean; diagnostics: Diagnostic[];
}
export interface JobEvent {
  id: EntityId; jobId: EntityId; taskId?: EntityId; sequence: number;
  kind: "created" | "state-changed" | "progress" | "diagnostic" | "usage" | "artifact-staged" | "artifact-promoted" | "approval-requested" | "approval-resolved" | "cancel-requested" | "heartbeat" | "recovered";
  occurredAt: IsoDateTime; payload: JsonValue;
}
export interface QualityGate {
  id: EntityId; kind: "content" | "factual" | "citation" | "math" | "code" | "visual" | "audio" | "timeline" | "accessibility" | "privacy" | "licensing" | "multimodal" | "export";
  scope: EntityRef; status: "pending" | "running" | "passed" | "warning" | "failed" | "waived" | "blocked"; severity: "info" | "minor" | "major" | "critical";
  policyVersion: string; checks: Diagnostic[]; repairAttempts: number; evaluatedAt: IsoDateTime; waiverReason?: string;
}

export interface ExportSpec {
  id: EntityId; projectId: EntityId; revisionId: EntityId; target: "landscape" | "portrait" | "square" | "custom"; dimensions: Dimensions; frameRate: Rational;
  videoCodec: "h264" | "hevc" | "av1" | "prores" | "vp9" | "ffv1"; audioCodec: "aac" | "opus" | "flac" | "pcm"; quality: "draft" | "standard" | "high" | "maximum" | "lossless";
  bitrateKbps?: number; hardwareEncoder?: "auto" | "none" | "nvenc" | "qsv" | "amf" | "videotoolbox" | "vaapi"; captionDeliveryMode: "sidecar" | "embedded" | "burned" | "both";
  sidecars: ("vtt" | "srt" | "transcript" | "descriptive-transcript" | "bibliography" | "chapters" | "provenance" | "c2pa" | "thumbnail" | "metadata" | "audio-description")[];
  colorSpace: "rec709-sdr"; gplRuntimePackApproved?: boolean; outputPath?: RelativePath;
}

export interface PluginPermission { capability: "read-artifact" | "write-artifact" | "network" | "provider" | "render-scene" | "run-sandbox" | "model-inference" | "project-metadata"; scope: string[]; required: boolean; reason?: string }
export interface PluginManifest {
  manifestVersion: 1; id: string; name: string; version: string; description: string; publisher: string; entrypoint: RelativePath; runtime: "wasm-wasi" | "process-jsonrpc";
  permissions: PluginPermission[]; contributes: { sceneKinds?: EntityId[]; providers?: EntityId[]; exporters?: EntityId[]; qualityGates?: EntityId[] };
  integrity: Sha256; signature?: string; licenseExpression: string; minimumAlystriaVersion?: string;
}
