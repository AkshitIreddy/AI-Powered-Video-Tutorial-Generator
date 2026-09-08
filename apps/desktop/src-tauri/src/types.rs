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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveProjectCustomizationRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub expected_head_revision_id: String,
    pub customization: Value,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectCustomizationReceipt {
    pub project_id: Uuid,
    pub head_revision_id: String,
    pub revision_number: u64,
    pub root_hash: String,
    pub updated_at: DateTime<Utc>,
    pub customization: Value,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProjectAssetKind {
    PresenterPortrait,
    PresenterAudio,
    BackgroundImage,
    Font,
    Music,
    SoundEffect,
    EditorImage,
    EditorVideo,
    EditorAudio,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AssetRightsStatus {
    Owned,
    Licensed,
    PublicDomain,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AssetPermission {
    Allowed,
    NotAllowed,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetRightsInput {
    pub status: AssetRightsStatus,
    #[serde(default)]
    pub creator: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub attribution: Option<String>,
    pub commercial_use: AssetPermission,
    pub redistribution: AssetPermission,
    pub model_input: AssetPermission,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PresenterIdentityType {
    Synthetic,
    RealPerson,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConsentAuthority {
    SelfConsent,
    ParentOrGuardian,
    AuthorizedRepresentative,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum PresenterConsentGrant {
    PortraitAnimation,
    VideoReenactment,
    PublicDistribution,
    CommercialDistribution,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PresenterDistributionScope {
    PrivatePreview,
    PublicNonCommercial,
    PublicCommercial,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresenterConsentAttestation {
    pub subject_display_name: String,
    pub attestor_display_name: String,
    pub authority: ConsentAuthority,
    pub grants: Vec<PresenterConsentGrant>,
    pub distribution_scope: PresenterDistributionScope,
    pub accepted: bool,
    pub disclosure_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresenterAssetInput {
    pub identity_type: PresenterIdentityType,
    pub display_name: String,
    pub synthetic_origin_attested: bool,
    #[serde(default)]
    pub consent: Option<PresenterConsentAttestation>,
    pub select_after_import: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectAssetImportRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub expected_head_revision_id: String,
    pub kind: ProjectAssetKind,
    pub filename: String,
    pub mime_type: String,
    pub privacy: SourcePrivacy,
    pub rights: AssetRightsInput,
    #[serde(default)]
    pub presenter: Option<PresenterAssetInput>,
    pub content_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAssetRef {
    pub id: String,
    pub kind: ProjectAssetKind,
    pub sha256: String,
    pub byte_size: u64,
    pub media_type: String,
    pub original_filename: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAssetProvenance {
    pub id: String,
    pub origin: String,
    pub rights_status: AssetRightsStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creator: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribution: Option<String>,
    pub export_eligible: bool,
    pub blockers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenterProfileRef {
    pub profile_id: String,
    pub display_name: String,
    pub portrait_artifact_id: String,
    pub identity_type: PresenterIdentityType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub consent_record_id: Option<String>,
    pub disclosure_required: bool,
    pub authorized_distribution_scope: PresenterDistributionScope,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAssetImportReceipt {
    pub project_id: Uuid,
    pub head_revision_id: String,
    pub revision_number: u64,
    pub artifact: ImportedAssetRef,
    pub provenance: ImportedAssetProvenance,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presenter_profile: Option<PresenterProfileRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_presenter_profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectPresenterProfileRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub expected_head_revision_id: String,
    pub profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectPresenterProfileReceipt {
    pub project_id: Uuid,
    pub head_revision_id: String,
    pub revision_number: u64,
    pub selected_presenter_profile_id: String,
    pub profile: PresenterProfileRef,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_head_revision_id: Option<String>,
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
    pub role: VisualCandidateRole,
    #[serde(default)]
    pub seed: Option<u64>,
    #[serde(default)]
    pub image_recipe: Option<ImageRecipeRequest>,
    #[serde(default)]
    pub preservation_locks: Vec<String>,
    pub alternatives: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageRecipeRequest {
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub loras: Vec<String>,
    #[serde(default)]
    pub negative_prompt: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum VisualCandidateRole {
    #[default]
    Scene,
    Presenter,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VisualCandidateAcceptRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub expected_head_revision_id: String,
    pub candidate_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VisualCandidateAcceptReceipt {
    pub project_id: Uuid,
    pub head_revision_id: String,
    pub revision_number: u64,
    pub candidate_id: String,
    pub scene_id: String,
    pub role: VisualCandidateRole,
    pub artifact_hash: String,
    pub asset_id: String,
    #[serde(default)]
    pub invalidated: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StockVisualCandidateSearchRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub expected_head_revision_id: String,
    pub scene_id: String,
    pub instruction: String,
    #[serde(default)]
    pub preservation_locks: Vec<String>,
    pub alternatives: u8,
    pub provider_id: StockVisualProvider,
    #[serde(default)]
    pub search_query: Option<String>,
    #[serde(default)]
    pub desired_aspect_ratio: Option<StockVisualAspectRatio>,
    #[serde(default)]
    pub locale: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StockVisualProvider {
    Openverse,
    Pexels,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum StockVisualAspectRatio {
    #[serde(rename = "16:9")]
    Landscape,
    #[serde(rename = "4:3")]
    Standard,
    #[serde(rename = "1:1")]
    Square,
    #[serde(rename = "9:16")]
    Portrait,
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

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CaptionDeliveryMode {
    /// Clean video plus UTF-8 WebVTT and SRT files. This is the safe default.
    #[default]
    Sidecar,
    /// Clean video with a selectable container track, plus both sidecar files.
    Embedded,
    /// Open captions composited into the pixels, plus both sidecar files.
    Burned,
    /// Open captions and a selectable container track, plus both sidecar files.
    Both,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ExportCodecPreference {
    #[default]
    H264Hardware,
    HevcHardware,
    Av1,
}

fn deserialize_caption_delivery_mode<'de, D>(
    deserializer: D,
) -> Result<CaptionDeliveryMode, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    match value {
        Value::String(value) => match value.as_str() {
            "sidecar" => Ok(CaptionDeliveryMode::Sidecar),
            "embedded" => Ok(CaptionDeliveryMode::Embedded),
            "burned" => Ok(CaptionDeliveryMode::Burned),
            "both" => Ok(CaptionDeliveryMode::Both),
            _ => Err(serde::de::Error::custom(
                "captionDeliveryMode must be sidecar, embedded, burned, or both",
            )),
        },
        // Pre-2.0 browser builds sent a boolean named `captions`. Migrate either
        // value to the clean, accessible sidecar default; the new contract does
        // not have a mode that discards authored caption files.
        Value::Bool(_) => Ok(CaptionDeliveryMode::Sidecar),
        _ => Err(serde::de::Error::custom(
            "captionDeliveryMode must be a supported string",
        )),
    }
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
    #[serde(default)]
    pub codec_preference: ExportCodecPreference,
    #[serde(
        default,
        alias = "captions",
        deserialize_with = "deserialize_caption_delivery_mode"
    )]
    pub caption_delivery_mode: CaptionDeliveryMode,
    pub transcript: bool,
    pub bibliography: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorTimelineExportRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub expected_head_revision_id: String,
    pub manifest: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectAssetResolveRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub artifact_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectAssetResolveReceipt {
    pub project_id: Uuid,
    pub artifact_hash: String,
    pub path: PathBuf,
    pub media_type: String,
    pub byte_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorBindingsGetRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub generation_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorBindingsGetReceipt {
    pub project_id: Uuid,
    pub generation_id: Uuid,
    pub assets: Vec<Value>,
    pub narration: Vec<Value>,
    pub presenters: Vec<Value>,
    #[serde(default)]
    pub captions: Vec<Value>,
    #[serde(default)]
    pub renders: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorWaveformProfile {
    pub width: u16,
    pub height: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorWaveformRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub artifact_hash: String,
    pub profile: EditorWaveformProfile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorWaveformReceipt {
    pub project_id: Uuid,
    pub artifact_hash: String,
    pub profile: EditorWaveformProfile,
    pub waveform_hash: String,
    pub waveform_path: PathBuf,
    pub media_type: String,
    pub width: u16,
    pub height: u16,
    pub duration_ticks: u64,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveProviderRoutingPolicyRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub expected_head_revision_id: String,
    pub policy: Value,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRoutingPolicyReceipt {
    pub policy: Option<Value>,
    pub head_revision_id: String,
    #[serde(default)]
    pub revision_number: Option<u64>,
}

/// A no-secret, app-wide preset.  It is a user-facing setup preference, not a
/// project approval or a provider routing policy; those remain durable project
/// records validated by the pipeline service.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileRoute {
    pub provider_id: String,
    pub model_id: String,
    #[serde(default)]
    pub model_revision: Option<String>,
    #[serde(default)]
    pub install_fingerprint: Option<String>,
    #[serde(default)]
    pub voice_id: Option<String>,
    #[serde(default)]
    pub presenter_profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelProfile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub routes: BTreeMap<String, ProfileRoute>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalModelSetupSaveRequest {
    pub active_profile_id: String,
    pub selected_model_ids: Vec<String>,
    #[serde(default)]
    pub lip_sync_model_id: Option<String>,
    #[serde(default)]
    pub portrait_animation_model_id: Option<String>,
    #[serde(default)]
    pub existing_model_directory: Option<String>,
    pub profiles: Vec<ModelProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalModelSetup {
    pub schema_version: u32,
    pub active_profile_id: String,
    pub selected_model_ids: Vec<String>,
    #[serde(default)]
    pub lip_sync_model_id: Option<String>,
    #[serde(default)]
    pub portrait_animation_model_id: Option<String>,
    #[serde(default)]
    pub existing_model_directory: Option<String>,
    pub profiles: Vec<ModelProfile>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelDownloadStartRequest {
    pub model_id: String,
    pub license_sha256: String,
    pub license_accepted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelDownloadCatalogEntry {
    pub model_id: String,
    pub display_name: String,
    pub immutable_revision: String,
    pub total_bytes: u64,
    pub artifact_count: usize,
    pub license_id: String,
    pub license_url: String,
    pub license_sha256: String,
    pub license_scope: String,
    pub code_revision: String,
    pub weight_revision: String,
    pub available: bool,
    pub download_only_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ModelDownloadPhase {
    ManifestRequired,
    Inspecting,
    LicenseRequired,
    Downloading,
    Cancelling,
    Cancelled,
    Verifying,
    DownloadedQuarantined,
    Installing,
    Activating,
    Ready,
    InUse,
    Incompatible,
    Corrupt,
    Repairing,
    Removing,
    Removed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelDownloadStatus {
    pub model_id: String,
    pub immutable_revision: Option<String>,
    pub install_fingerprint: Option<String>,
    pub runtime_revision: Option<String>,
    pub phase: ModelDownloadPhase,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub verified_artifacts: usize,
    pub artifact_count: usize,
    pub license_id: Option<String>,
    pub license_url: Option<String>,
    pub license_sha256: Option<String>,
    pub license_accepted_at: Option<DateTime<Utc>>,
    pub detail: String,
    pub activation_blocked: bool,
    pub updated_at: DateTime<Utc>,
}

impl From<LocalModelSetup> for LocalModelSetupSaveRequest {
    fn from(value: LocalModelSetup) -> Self {
        Self {
            active_profile_id: value.active_profile_id,
            selected_model_ids: value.selected_model_ids,
            lip_sync_model_id: value.lip_sync_model_id,
            portrait_animation_model_id: value.portrait_animation_model_id,
            existing_model_directory: value.existing_model_directory,
            profiles: value.profiles,
        }
    }
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

#[cfg(test)]
mod caption_delivery_tests {
    use super::{
        CaptionDeliveryMode, EditorBindingsGetReceipt, ExportCodecPreference, MasterExportRequest,
        SceneRegenerationRequest, StockVisualAspectRatio, StockVisualCandidateSearchRequest,
        StockVisualProvider, VisualCandidateRole,
    };
    use serde_json::{Value, json};

    fn export_request() -> Value {
        json!({
            "projectId": "11111111-1111-4111-8111-111111111111",
            "projectDirectory": "C:\\Alystria\\Project",
            "baseRevisionId": "revision.one",
            "baseJobId": "22222222-2222-4222-8222-222222222222",
            "aspect": "16:9",
            "resolution": "1080p",
            "fps": 30,
            "transcript": true,
            "bibliography": true
        })
    }

    #[test]
    fn master_export_defaults_to_clean_sidecars() {
        let request: MasterExportRequest = serde_json::from_value(export_request()).unwrap();
        assert_eq!(request.caption_delivery_mode, CaptionDeliveryMode::Sidecar);
        assert_eq!(
            request.codec_preference,
            ExportCodecPreference::H264Hardware
        );
    }

    #[test]
    fn master_export_accepts_only_the_supported_codec_preferences() {
        for (wire, expected) in [
            ("h264-hardware", ExportCodecPreference::H264Hardware),
            ("hevc-hardware", ExportCodecPreference::HevcHardware),
            ("av1", ExportCodecPreference::Av1),
        ] {
            let mut value = export_request();
            value["codecPreference"] = Value::String(wire.to_owned());
            let request: MasterExportRequest = serde_json::from_value(value).unwrap();
            assert_eq!(request.codec_preference, expected);
        }

        let mut unsupported = export_request();
        unsupported["codecPreference"] = Value::String("vp9".to_owned());
        assert!(serde_json::from_value::<MasterExportRequest>(unsupported).is_err());
    }

    #[test]
    fn master_export_accepts_the_exact_caption_delivery_modes() {
        for (wire, expected) in [
            ("sidecar", CaptionDeliveryMode::Sidecar),
            ("embedded", CaptionDeliveryMode::Embedded),
            ("burned", CaptionDeliveryMode::Burned),
            ("both", CaptionDeliveryMode::Both),
        ] {
            let mut value = export_request();
            value["captionDeliveryMode"] = Value::String(wire.to_owned());
            let request: MasterExportRequest = serde_json::from_value(value).unwrap();
            assert_eq!(request.caption_delivery_mode, expected);
        }
    }

    #[test]
    fn legacy_caption_boolean_migrates_to_clean_sidecars() {
        for legacy in [true, false] {
            let mut value = export_request();
            value["captions"] = Value::Bool(legacy);
            let request: MasterExportRequest = serde_json::from_value(value).unwrap();
            assert_eq!(request.caption_delivery_mode, CaptionDeliveryMode::Sidecar);
        }
    }

    #[test]
    fn editor_bindings_accepts_composite_render_bindings() {
        let receipt: EditorBindingsGetReceipt = serde_json::from_value(json!({
            "projectId": "11111111-1111-4111-8111-111111111111",
            "generationId": "22222222-2222-4222-8222-222222222222",
            "assets": [],
            "narration": [],
            "presenters": [],
            "captions": [{ "sceneId": "scene-1", "id": "cue-1", "startTicks": 240, "endTicks": 240000, "text": "Three products." }],
            "renders": [{
                "sceneId": "scene-1",
                "artifactHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "mediaType": "video/webm"
            }]
        }))
        .unwrap();

        assert_eq!(receipt.renders.len(), 1);
        assert_eq!(receipt.captions[0]["text"], "Three products.");
    }

    #[test]
    fn scene_regeneration_defaults_to_scene_candidates_and_accepts_a_seed() {
        let base = json!({
            "projectId": "11111111-1111-4111-8111-111111111111",
            "projectDirectory": "C:\\Alystria\\Project",
            "baseRevisionId": "revision.one",
            "sceneId": "scene-1",
            "instruction": "Make the diagram clearer",
            "preservationLocks": ["narration"],
            "alternatives": 2
        });
        let defaulted: SceneRegenerationRequest = serde_json::from_value(base.clone()).unwrap();
        assert_eq!(defaulted.role, VisualCandidateRole::Scene);
        assert_eq!(defaulted.seed, None);

        let mut presenter = base;
        presenter["role"] = Value::String("presenter".into());
        presenter["seed"] = Value::Number(42.into());
        let presenter: SceneRegenerationRequest = serde_json::from_value(presenter).unwrap();
        assert_eq!(presenter.role, VisualCandidateRole::Presenter);
        assert_eq!(presenter.seed, Some(42));
    }

    #[test]
    fn scene_regeneration_rejects_unknown_candidate_roles() {
        let request = json!({
            "projectId": "11111111-1111-4111-8111-111111111111",
            "projectDirectory": "C:\\Alystria\\Project",
            "baseRevisionId": "revision.one",
            "sceneId": "scene-1",
            "instruction": "Make the diagram clearer",
            "role": "thumbnail",
            "preservationLocks": [],
            "alternatives": 1
        });
        assert!(serde_json::from_value::<SceneRegenerationRequest>(request).is_err());
    }

    #[test]
    fn stock_visual_search_accepts_only_closed_provider_and_aspect_values() {
        let request = json!({
            "projectId": "11111111-1111-4111-8111-111111111111",
            "projectDirectory": "C:\\Alystria\\Project",
            "expectedHeadRevisionId": "revision.one",
            "sceneId": "scene-1",
            "instruction": "Find a concrete multiplication visual",
            "preservationLocks": ["narration"],
            "alternatives": 2,
            "providerId": "openverse",
            "desiredAspectRatio": "16:9",
            "locale": "en-US"
        });
        let parsed: StockVisualCandidateSearchRequest =
            serde_json::from_value(request.clone()).unwrap();
        assert_eq!(parsed.provider_id, StockVisualProvider::Openverse);
        assert_eq!(
            parsed.desired_aspect_ratio,
            Some(StockVisualAspectRatio::Landscape)
        );

        let mut unsupported_provider = request.clone();
        unsupported_provider["providerId"] = Value::String("unsplash".into());
        assert!(
            serde_json::from_value::<StockVisualCandidateSearchRequest>(unsupported_provider)
                .is_err()
        );

        let mut unsupported_aspect = request;
        unsupported_aspect["desiredAspectRatio"] = Value::String("21:9".into());
        assert!(
            serde_json::from_value::<StockVisualCandidateSearchRequest>(unsupported_aspect)
                .is_err()
        );
    }
}
