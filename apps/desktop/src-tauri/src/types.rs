use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use uuid::Uuid;

pub const PROJECT_SCHEMA_VERSION: u32 = 1;
pub const TICKS_PER_SECOND: u32 = 240_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub app_data: PathBuf,
    pub cache: PathBuf,
    pub logs: PathBuf,
    pub runtimes: PathBuf,
    pub models: PathBuf,
    pub projects: PathBuf,
    pub temp: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapInfo {
    pub app_version: String,
    pub platform: String,
    pub architecture: String,
    pub project_schema_version: u32,
    pub ticks_per_second: u32,
    pub paths: AppPaths,
    pub worker: WorkerStatus,
    pub runtime_channel: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateProjectRequest {
    pub parent_directory: PathBuf,
    pub directory_name: String,
    pub title: String,
    pub locale: String,
    pub grounding_mode: GroundingMode,
    #[serde(default)]
    pub initial_snapshot: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectIdentityRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveProjectSnapshotRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub expected_head_revision_id: String,
    pub snapshot: Value,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshotReceipt {
    pub project_id: Uuid,
    pub head_revision_id: String,
    pub revision_number: u64,
    pub root_hash: String,
    pub updated_at: DateTime<Utc>,
    pub snapshot: Value,
    #[serde(default)]
    pub history: Option<ProjectHistoryState>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectHistoryState {
    pub head_revision_id: String,
    pub can_undo: bool,
    pub can_redo: bool,
    pub undo_depth: u64,
    pub redo_depth: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectHistoryActionRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub expected_head_revision_id: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SourcePrivacy {
    Public,
    ProjectLocal,
    Sensitive,
    Restricted,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SourceRightsStatus {
    Owned,
    Licensed,
    PublicDomain,
    FairUse,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceImportRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    #[serde(default)]
    pub expected_head_revision_id: Option<String>,
    pub filename: String,
    pub mime_type: String,
    pub privacy: SourcePrivacy,
    pub rights_status: SourceRightsStatus,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub attribution: Option<String>,
    pub content_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceImportReceipt {
    pub project_id: Uuid,
    pub head_revision_id: String,
    pub revision_number: u64,
    pub id: String,
    pub version_id: String,
    pub title: String,
    pub filename: String,
    pub origin: String,
    pub kind: String,
    pub media_type: String,
    pub byte_size: u64,
    pub artifact_hash: String,
    pub stored_relative_path: String,
    pub privacy: SourcePrivacy,
    pub rights_status: SourceRightsStatus,
    pub license: String,
    pub attribution: Option<String>,
    pub evidence: u64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportProjectArchiveRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    #[serde(default)]
    pub file_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProjectArchiveReceipt {
    pub path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenProjectRequest {
    pub project_directory: PathBuf,
    #[serde(default)]
    pub allow_read_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveProjectRequest {
    pub project_directory: PathBuf,
    pub expected_revision: u64,
    pub title: String,
    pub locale: String,
    pub grounding_mode: GroundingMode,
    pub active_snapshot_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifest {
    pub schema_version: u32,
    pub project_id: Uuid,
    pub title: String,
    pub locale: String,
    pub grounding_mode: GroundingMode,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub manifest_revision: u64,
    pub active_snapshot_id: Option<Uuid>,
    pub database_relative_path: String,
    pub object_store_relative_path: String,
    pub source_store_relative_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectHandle {
    pub project_directory: PathBuf,
    pub manifest: ProjectManifest,
    pub access: ProjectAccess,
    pub database_ready: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProjectAccess {
    ReadWrite,
    ReadOnly,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GroundingMode {
    Creative,
    Grounded,
    Strict,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GenerationRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub snapshot_id: Option<String>,
    pub scope: GenerationScope,
    pub quality: QualityPreset,
    pub privacy: PrivacyMode,
    pub budget: BudgetPolicy,
    pub approved_provider_ids: Vec<String>,
    #[serde(default)]
    pub preservation_locks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "id")]
pub enum GenerationScope {
    Project,
    Lesson(Uuid),
    Section(Uuid),
    Scene(Uuid),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QualityPreset {
    Draft,
    Standard,
    Maximum,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PrivacyMode {
    Local,
    Hybrid,
    Cloud,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BudgetPolicy {
    pub currency: String,
    pub hard_limit_minor_units: u64,
    pub require_known_pricing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobActionRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub job_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum JobState {
    Blocked,
    Ready,
    Queued,
    Running,
    Succeeded,
    RetryWait,
    Failed,
    Cancelled,
    Stale,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobReceipt {
    pub job_id: Uuid,
    pub state: JobState,
    pub accepted_at: DateTime<Utc>,
    pub message: String,
    pub retryable: bool,
    #[serde(default)]
    pub operation: Option<String>,
    #[serde(default)]
    pub progress: Option<f64>,
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default)]
    pub error: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneRegenerationRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub base_revision_id: String,
    #[serde(default)]
    pub base_job_id: Option<Uuid>,
    pub scene_id: String,
    pub instruction: String,
    #[serde(default)]
    pub preservation_locks: Vec<String>,
    pub alternatives: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneRenderRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub base_revision_id: String,
    #[serde(default)]
    pub base_job_id: Option<Uuid>,
    pub scene_id: String,
    pub aspect: String,
    pub resolution: String,
    pub fps: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QaRepairRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub base_revision_id: String,
    pub base_job_id: Uuid,
    pub finding_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MasterExportRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub base_revision_id: String,
    pub base_job_id: Uuid,
    pub aspect: String,
    pub resolution: String,
    pub fps: u16,
    pub captions: bool,
    pub transcript: bool,
    pub bibliography: bool,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetProviderSecretRequest {
    pub provider_id: String,
    pub credential_kind: String,
    pub secret: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderSecretRequest {
    pub provider_id: String,
    pub credential_kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSecretRef {
    pub reference: String,
    pub provider_id: String,
    pub credential_kind: String,
    pub availability: SecretAvailability,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SecretAvailability {
    Present,
    Missing,
    KeyringUnavailable,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum WorkerStatus {
    Unavailable { reason: String },
    Stopped,
    Starting,
    Ready { pid: u32, endpoint: String },
    Degraded { reason: String },
    Failed { reason: String, retryable: bool },
    Stopping,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    pub generated_at: DateTime<Utc>,
    pub overall: DiagnosticLevel,
    pub checks: Vec<DiagnosticCheck>,
    pub system: SystemSummary,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticLevel {
    Pass,
    Info,
    Warning,
    Failure,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticCheck {
    pub id: String,
    pub label: String,
    pub level: DiagnosticLevel,
    pub summary: String,
    pub details: BTreeMap<String, String>,
    pub remediation: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSummary {
    pub os: String,
    pub os_version: Option<String>,
    pub architecture: String,
    pub cpu: String,
    pub logical_cpu_count: usize,
    pub total_memory_bytes: u64,
    pub available_memory_bytes: u64,
    pub gpu: Vec<GpuSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuSummary {
    pub name: String,
    pub dedicated_memory_bytes: Option<u64>,
    pub driver_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeManifest {
    pub schema_version: u32,
    pub channel: String,
    pub generated_at: DateTime<Utc>,
    pub components: Vec<RuntimeComponent>,
    pub signature: Option<RuntimeSignature>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeComponent {
    pub id: String,
    pub version: String,
    pub target: String,
    pub relative_path: String,
    pub url: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub license: String,
    pub optional: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSignature {
    pub algorithm: String,
    pub key_id: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterStatus {
    pub enabled: bool,
    pub channel: String,
    pub current_version: String,
    pub reason: String,
}
