use crate::diagnostics;
use crate::error::CommandError;
use crate::sidecar::WorkerTransport;
use crate::state::AppState;
use crate::types::*;
use crate::validation;
use base64::Engine as _;
use chrono::Utc;
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::PathBuf;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub fn app_bootstrap(state: State<'_, AppState>) -> BootstrapInfo {
    BootstrapInfo {
        app_version: env!("CARGO_PKG_VERSION").into(),
        platform: std::env::consts::OS.into(),
        architecture: std::env::consts::ARCH.into(),
        project_schema_version: PROJECT_SCHEMA_VERSION,
        ticks_per_second: TICKS_PER_SECOND,
        paths: state.paths.clone(),
        worker: state.worker.status(),
        runtime_channel: state.runtimes.manifest().channel,
    }
}

#[tauri::command]
pub fn project_create(
    input: CreateProjectRequest,
    state: State<'_, AppState>,
) -> Result<ProjectHandle, CommandError> {
    if let Some(snapshot) = &input.initial_snapshot {
        validation::snapshot(snapshot)?;
    }
    let initial_snapshot = input.initial_snapshot.clone();
    let mut project = state.projects.create(input)?;
    let payload = serde_json::json!({
        "projectId": project.manifest.project_id,
        "projectDirectory": project.project_directory,
        "manifestRevision": project.manifest.manifest_revision,
        "initialSnapshot": initial_snapshot
    });
    if let Err(error) = WorkerTransport::call(&state.worker, "project.initialize", payload) {
        project.warnings.push(format!(
            "The project was created, but pipeline initialization is pending: {}",
            error.message
        ));
    } else {
        project.database_ready = project.project_directory.join("project.sqlite3").is_file();
        project.warnings.clear();
    }
    Ok(project)
}

#[tauri::command]
pub fn project_snapshot_get(
    input: ProjectIdentityRequest,
    state: State<'_, AppState>,
) -> Result<ProjectSnapshotReceipt, CommandError> {
    state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    worker_result(&state.worker, "project.snapshot.get", &input)
}

#[tauri::command]
pub fn project_snapshot_save(
    input: SaveProjectSnapshotRequest,
    state: State<'_, AppState>,
) -> Result<ProjectSnapshotReceipt, CommandError> {
    state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    validation::snapshot(&input.snapshot)?;
    if input.expected_head_revision_id.trim().is_empty()
        || input.expected_head_revision_id.len() > 128
    {
        return Err(CommandError::invalid(
            "expectedHeadRevisionId",
            "must identify the loaded head revision",
        ));
    }
    worker_result(&state.worker, "project.snapshot.save", &input)
}

#[tauri::command]
pub fn project_customization_save(
    mut input: SaveProjectCustomizationRequest,
    state: State<'_, AppState>,
) -> Result<ProjectCustomizationReceipt, CommandError> {
    state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    input.expected_head_revision_id =
        validation::stable_id(&input.expected_head_revision_id, "expectedHeadRevisionId")?;
    validation::customization(&input.customization)?;
    input.message = validation::optional_metadata(&input.message, "message")?;
    worker_result(&state.worker, "project.customization.save", &input)
}

#[tauri::command]
pub fn project_history_get(
    input: ProjectIdentityRequest,
    state: State<'_, AppState>,
) -> Result<ProjectHistoryState, CommandError> {
    state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    worker_result(&state.worker, "project.history.get", &input)
}

#[tauri::command]
pub fn project_history_undo(
    input: ProjectHistoryActionRequest,
    state: State<'_, AppState>,
) -> Result<ProjectSnapshotReceipt, CommandError> {
    project_history_action(input, "project.history.undo", &state)
}

#[tauri::command]
pub fn project_history_redo(
    input: ProjectHistoryActionRequest,
    state: State<'_, AppState>,
) -> Result<ProjectSnapshotReceipt, CommandError> {
    project_history_action(input, "project.history.redo", &state)
}

#[tauri::command]
pub fn source_import(
    mut input: SourceImportRequest,
    state: State<'_, AppState>,
) -> Result<SourceImportReceipt, CommandError> {
    state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    input.filename = validation::source_filename(&input.filename)?;
    input.mime_type = validation::mime_type(&input.mime_type)?;
    input.license = validation::optional_metadata(&input.license, "license")?;
    input.attribution = validation::optional_metadata(&input.attribution, "attribution")?;
    if input.content_base64.len() > validation::MAX_SOURCE_BASE64_CHARS {
        return Err(CommandError::invalid(
            "contentBase64",
            "exceeds the 8 MiB source import limit",
        ));
    }
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(input.content_base64.as_bytes())
        .map_err(|_| CommandError::invalid("contentBase64", "must be canonical base64"))?;
    if decoded.len() > validation::MAX_SOURCE_BYTES {
        return Err(CommandError::invalid(
            "contentBase64",
            "decodes beyond the 8 MiB source import limit",
        ));
    }
    drop(decoded);
    worker_result(&state.worker, "source.import", &input)
}

#[tauri::command]
pub fn project_asset_import(
    mut input: ProjectAssetImportRequest,
    state: State<'_, AppState>,
) -> Result<ProjectAssetImportReceipt, CommandError> {
    state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    validate_project_asset_import(&mut input)?;
    worker_result(&state.worker, "asset.import", &input)
}

#[tauri::command]
pub fn presenter_profile_select(
    mut input: SelectPresenterProfileRequest,
    state: State<'_, AppState>,
) -> Result<SelectPresenterProfileReceipt, CommandError> {
    state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    input.expected_head_revision_id =
        validation::stable_id(&input.expected_head_revision_id, "expectedHeadRevisionId")?;
    input.profile_id = validation::stable_id(&input.profile_id, "profileId")?;
    worker_result(&state.worker, "presenter.profile.select", &input)
}

#[tauri::command]
pub fn project_export_archive(
    input: ExportProjectArchiveRequest,
    state: State<'_, AppState>,
) -> Result<ExportProjectArchiveReceipt, CommandError> {
    let manifest = state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    let file_name = match input.file_name {
        Some(value) => {
            let value = validation::source_filename(&value)?;
            if !value.to_ascii_lowercase().ends_with(".alytutorial") {
                return Err(CommandError::invalid(
                    "fileName",
                    "must end with .alytutorial",
                ));
            }
            value
        }
        None => format!(
            "{}-{}.alytutorial",
            archive_stem(&manifest.title),
            Uuid::now_v7()
        ),
    };
    let destination: PathBuf = input.project_directory.join("exports").join(file_name);
    let payload = serde_json::json!({
        "projectPath": input.project_directory,
        "destination": destination,
        "overwrite": false
    });
    let value = WorkerTransport::call(&state.worker, "project.export", payload)?;
    serde_json::from_value(value).map_err(|_| {
        CommandError::worker("The pipeline returned an invalid archive receipt.", false)
    })
}

#[tauri::command]
pub fn project_open(
    input: OpenProjectRequest,
    state: State<'_, AppState>,
) -> Result<ProjectHandle, CommandError> {
    state.projects.open(input)
}

#[tauri::command]
pub fn project_save(
    input: SaveProjectRequest,
    state: State<'_, AppState>,
) -> Result<ProjectHandle, CommandError> {
    state.projects.save(input)
}

#[tauri::command]
pub fn generation_start(
    mut input: GenerationRequest,
    state: State<'_, AppState>,
) -> Result<JobReceipt, CommandError> {
    validate_generation(&mut input)?;
    state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    let generated_id = Uuid::now_v7();
    let payload = serde_json::to_value(&input).map_err(|_| {
        CommandError::new(
            "GENERATION_REQUEST_ENCODING_FAILED",
            "The generation request could not be encoded.",
            false,
        )
    })?;
    match WorkerTransport::call(&state.worker, "generation.start", payload) {
        Ok(value) => serde_json::from_value(value).map_err(|_| {
            CommandError::worker("The pipeline returned an invalid job receipt.", false)
        }),
        Err(error) => Ok(failed_receipt(generated_id, error)),
    }
}

#[tauri::command]
pub fn job_cancel(
    input: JobActionRequest,
    state: State<'_, AppState>,
) -> Result<JobReceipt, CommandError> {
    job_action(input, "generation.cancel", &state)
}

#[tauri::command]
pub fn job_retry(
    input: JobActionRequest,
    state: State<'_, AppState>,
) -> Result<JobReceipt, CommandError> {
    job_action(input, "generation.retry", &state)
}

#[tauri::command]
pub fn generation_approve(
    input: JobActionRequest,
    state: State<'_, AppState>,
) -> Result<JobReceipt, CommandError> {
    job_action(input, "generation.approve", &state)
}

#[tauri::command]
pub fn scene_regenerate(
    mut input: SceneRegenerationRequest,
    state: State<'_, AppState>,
) -> Result<JobReceipt, CommandError> {
    verify_control_identity(
        &state,
        input.project_id,
        &input.project_directory,
        &input.base_revision_id,
    )?;
    input.scene_id = validation::stable_id(&input.scene_id, "sceneId")?;
    input.instruction = validation::bounded_text(&input.instruction, "instruction", 4_000)?;
    if !(1..=4).contains(&input.alternatives) {
        return Err(CommandError::invalid(
            "alternatives",
            "must be between 1 and 4",
        ));
    }
    let mut locks = BTreeSet::new();
    for lock in &input.preservation_locks {
        locks.insert(validation::lock_name(lock)?);
    }
    input.preservation_locks = locks.into_iter().collect();
    control_action(input, "control.regenerateScene", &state)
}

#[tauri::command]
pub fn scene_render(
    input: SceneRenderRequest,
    state: State<'_, AppState>,
) -> Result<JobReceipt, CommandError> {
    verify_control_identity(
        &state,
        input.project_id,
        &input.project_directory,
        &input.base_revision_id,
    )?;
    validation::stable_id(&input.scene_id, "sceneId")?;
    validate_render_target(&input.aspect, &input.resolution, input.fps)?;
    control_action(input, "control.renderScene", &state)
}

#[tauri::command]
pub fn qa_repair(
    input: QaRepairRequest,
    state: State<'_, AppState>,
) -> Result<JobReceipt, CommandError> {
    verify_control_identity(
        &state,
        input.project_id,
        &input.project_directory,
        &input.base_revision_id,
    )?;
    if input.finding_ids.is_empty() || input.finding_ids.len() > 20 {
        return Err(CommandError::invalid(
            "findingIds",
            "must select between 1 and 20 QA findings",
        ));
    }
    for finding in &input.finding_ids {
        validation::bounded_text(finding, "findingIds", 160)?;
    }
    control_action(input, "control.repairQa", &state)
}

#[tauri::command]
pub fn master_export(
    input: MasterExportRequest,
    state: State<'_, AppState>,
) -> Result<JobReceipt, CommandError> {
    verify_control_identity(
        &state,
        input.project_id,
        &input.project_directory,
        &input.base_revision_id,
    )?;
    validate_render_target(&input.aspect, &input.resolution, input.fps)?;
    control_action(input, "control.exportMaster", &state)
}

#[tauri::command]
pub fn job_status(
    input: JobActionRequest,
    state: State<'_, AppState>,
) -> Result<JobReceipt, CommandError> {
    job_action(input, "job.status", &state)
}

fn job_action(
    input: JobActionRequest,
    method: &str,
    state: &AppState,
) -> Result<JobReceipt, CommandError> {
    job_action_with_transport(input, method, &state.projects, &state.worker)
}

fn project_history_action(
    input: ProjectHistoryActionRequest,
    method: &str,
    state: &AppState,
) -> Result<ProjectSnapshotReceipt, CommandError> {
    state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    validation::bounded_text(
        &input.expected_head_revision_id,
        "expectedHeadRevisionId",
        128,
    )?;
    worker_result(&state.worker, method, &input)
}

fn control_action<P: serde::Serialize>(
    input: P,
    method: &str,
    state: &AppState,
) -> Result<JobReceipt, CommandError> {
    let generated_id = Uuid::now_v7();
    match worker_result(&state.worker, method, &input) {
        Ok(receipt) => Ok(receipt),
        Err(error) => Ok(failed_receipt(generated_id, error)),
    }
}

fn verify_control_identity(
    state: &AppState,
    project_id: Uuid,
    project_directory: &std::path::Path,
    base_revision_id: &str,
) -> Result<(), CommandError> {
    state
        .projects
        .verify_identity(project_directory, project_id)?;
    validation::bounded_text(base_revision_id, "baseRevisionId", 128)?;
    Ok(())
}

fn validate_render_target(aspect: &str, resolution: &str, fps: u16) -> Result<(), CommandError> {
    if !matches!(aspect, "16:9" | "9:16" | "1:1") {
        return Err(CommandError::invalid(
            "aspect",
            "must be 16:9, 9:16, or 1:1",
        ));
    }
    if !matches!(resolution, "1080p" | "1440p" | "4K" | "4k") {
        return Err(CommandError::invalid(
            "resolution",
            "must be 1080p, 1440p, or 4K",
        ));
    }
    if !matches!(fps, 24 | 25 | 30 | 50 | 60) {
        return Err(CommandError::invalid(
            "fps",
            "must be 24, 25, 30, 50, or 60",
        ));
    }
    Ok(())
}

fn job_action_with_transport(
    input: JobActionRequest,
    method: &str,
    projects: &crate::project_store::ProjectStore,
    worker: &dyn WorkerTransport,
) -> Result<JobReceipt, CommandError> {
    projects.verify_identity(&input.project_directory, input.project_id)?;
    let job_id = input.job_id;
    let payload = serde_json::to_value(&input).map_err(|_| {
        CommandError::new(
            "JOB_REQUEST_ENCODING_FAILED",
            "The job request could not be encoded.",
            false,
        )
    })?;
    match worker.call(method, payload) {
        Ok(value) => serde_json::from_value(value).map_err(|_| {
            CommandError::worker("The pipeline returned an invalid job receipt.", false)
        }),
        Err(error) => Ok(failed_receipt(job_id, error)),
    }
}

#[tauri::command]
pub fn worker_status(state: State<'_, AppState>) -> WorkerStatus {
    state.worker.status()
}

#[tauri::command]
pub fn worker_restart(state: State<'_, AppState>) -> Result<WorkerStatus, CommandError> {
    state.worker.restart()
}

#[tauri::command]
pub fn diagnostics_run(state: State<'_, AppState>) -> DiagnosticReport {
    diagnostics::run(&state.paths, &state.worker)
}

#[tauri::command]
pub fn provider_secret_set(
    input: SetProviderSecretRequest,
    state: State<'_, AppState>,
) -> Result<ProviderSecretRef, CommandError> {
    state.credentials.put(input)
}

#[tauri::command]
pub fn provider_secret_status(
    input: ProviderSecretRequest,
    state: State<'_, AppState>,
) -> Result<ProviderSecretRef, CommandError> {
    state
        .credentials
        .status(&input.provider_id, &input.credential_kind)
}

#[tauri::command]
pub fn provider_secret_delete(
    input: ProviderSecretRequest,
    state: State<'_, AppState>,
) -> Result<ProviderSecretRef, CommandError> {
    state
        .credentials
        .delete(&input.provider_id, &input.credential_kind)
}

#[tauri::command]
pub fn provider_routing_policy_get(
    input: ProjectIdentityRequest,
    state: State<'_, AppState>,
) -> Result<ProviderRoutingPolicyReceipt, CommandError> {
    state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    worker_result(&state.worker, "provider.routingPolicy.get", &input)
}

#[tauri::command]
pub fn provider_routing_policy_save(
    mut input: SaveProviderRoutingPolicyRequest,
    state: State<'_, AppState>,
) -> Result<ProviderRoutingPolicyReceipt, CommandError> {
    state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    if input.expected_head_revision_id.trim().is_empty()
        || input.expected_head_revision_id.len() > 128
    {
        return Err(CommandError::invalid(
            "expectedHeadRevisionId",
            "must identify the reviewed project revision",
        ));
    }
    let policy = input.policy.as_object().ok_or_else(|| {
        CommandError::invalid("policy", "must be a provider routing policy object")
    })?;
    if policy.get("version").and_then(Value::as_u64) != Some(1)
        || !policy.get("routes").is_some_and(Value::is_array)
        || !policy.get("approvals").is_some_and(Value::is_array)
    {
        return Err(CommandError::invalid(
            "policy",
            "must include version 1 routes and approvals",
        ));
    }
    validation::snapshot(&input.policy)?;
    input.message = validation::optional_metadata(&input.message, "message")?;
    worker_result(&state.worker, "provider.routingPolicy.save", &input)
}

#[tauri::command]
pub fn local_model_setup_get(state: State<'_, AppState>) -> Result<LocalModelSetup, CommandError> {
    state.model_setup.get()
}

#[tauri::command]
pub fn local_model_setup_save(
    input: LocalModelSetupSaveRequest,
    state: State<'_, AppState>,
) -> Result<LocalModelSetup, CommandError> {
    state.model_setup.save(input)
}

#[tauri::command]
pub fn local_model_download_catalog(state: State<'_, AppState>) -> Vec<ModelDownloadCatalogEntry> {
    state.model_downloads.catalog()
}

#[tauri::command]
pub fn local_model_download_status(state: State<'_, AppState>) -> Vec<ModelDownloadStatus> {
    state.model_downloads.statuses()
}

#[tauri::command]
pub fn local_model_download_start(
    input: ModelDownloadStartRequest,
    state: State<'_, AppState>,
) -> Result<ModelDownloadStatus, CommandError> {
    state.model_downloads.start(input)
}

#[tauri::command]
pub fn runtime_manifest(state: State<'_, AppState>) -> RuntimeManifest {
    state.runtimes.manifest()
}

#[tauri::command]
pub fn updater_status(state: State<'_, AppState>) -> UpdaterStatus {
    state.runtimes.updater_status()
}

fn validate_generation(input: &mut GenerationRequest) -> Result<(), CommandError> {
    if let Some(snapshot_id) = &input.snapshot_id
        && (snapshot_id.trim().is_empty() || snapshot_id.len() > 128)
    {
        return Err(CommandError::invalid(
            "snapshotId",
            "must identify a durable project revision",
        ));
    }
    if input.budget.currency.len() != 3
        || !input
            .budget
            .currency
            .chars()
            .all(|c| c.is_ascii_alphabetic())
    {
        return Err(CommandError::invalid(
            "budget.currency",
            "must be a three-letter ISO currency code",
        ));
    }
    input.budget.currency.make_ascii_uppercase();
    if input.approved_provider_ids.len() > 32 {
        return Err(CommandError::invalid(
            "approvedProviderIds",
            "cannot contain more than 32 entries",
        ));
    }
    let mut providers = BTreeSet::new();
    for provider in &input.approved_provider_ids {
        providers.insert(validation::provider_id(provider)?);
    }
    input.approved_provider_ids = providers.into_iter().collect();

    if input.preservation_locks.len() > 128 {
        return Err(CommandError::invalid(
            "preservationLocks",
            "cannot contain more than 128 entries",
        ));
    }
    let mut locks = BTreeSet::new();
    for lock in &input.preservation_locks {
        locks.insert(validation::lock_name(lock)?);
    }
    input.preservation_locks = locks.into_iter().collect();
    Ok(())
}

fn validate_project_asset_import(
    input: &mut ProjectAssetImportRequest,
) -> Result<(), CommandError> {
    input.expected_head_revision_id =
        validation::stable_id(&input.expected_head_revision_id, "expectedHeadRevisionId")?;
    input.filename = validation::source_filename(&input.filename)?;
    input.mime_type = validation::mime_type(&input.mime_type)?;
    input.rights.creator = validation::optional_metadata(&input.rights.creator, "rights.creator")?;
    input.rights.license =
        validation::optional_long_metadata(&input.rights.license, "rights.license")?;
    input.rights.attribution =
        validation::optional_long_metadata(&input.rights.attribution, "rights.attribution")?;

    match (&input.kind, input.presenter.as_mut()) {
        (ProjectAssetKind::PresenterPortrait, Some(presenter)) => {
            presenter.display_name =
                validation::bounded_text(&presenter.display_name, "presenter.displayName", 120)?;
            if input.rights.model_input != AssetPermission::Allowed {
                return Err(CommandError::invalid(
                    "rights.modelInput",
                    "presenter portraits must be explicitly cleared for model input",
                ));
            }
            match presenter.identity_type {
                PresenterIdentityType::Synthetic => {
                    if !presenter.synthetic_origin_attested {
                        return Err(CommandError::invalid(
                            "presenter.syntheticOriginAttested",
                            "synthetic portraits require an explicit origin attestation",
                        ));
                    }
                    if presenter.consent.is_some() {
                        return Err(CommandError::invalid(
                            "presenter.consent",
                            "synthetic portraits must not carry a real-person consent record",
                        ));
                    }
                }
                PresenterIdentityType::RealPerson => {
                    if presenter.synthetic_origin_attested {
                        return Err(CommandError::invalid(
                            "presenter.syntheticOriginAttested",
                            "a real-person portrait cannot be attested as synthetic",
                        ));
                    }
                    let consent = presenter.consent.as_mut().ok_or_else(|| {
                        CommandError::invalid(
                            "presenter.consent",
                            "real-person portraits require explicit consent",
                        )
                    })?;
                    consent.subject_display_name = validation::bounded_text(
                        &consent.subject_display_name,
                        "presenter.consent.subjectDisplayName",
                        160,
                    )?;
                    consent.attestor_display_name = validation::bounded_text(
                        &consent.attestor_display_name,
                        "presenter.consent.attestorDisplayName",
                        160,
                    )?;
                    if !consent.accepted {
                        return Err(CommandError::invalid(
                            "presenter.consent.accepted",
                            "the authorized attestor must explicitly accept the consent record",
                        ));
                    }
                    if !consent.disclosure_required {
                        return Err(CommandError::invalid(
                            "presenter.consent.disclosureRequired",
                            "real-person animation requires synthetic-media disclosure",
                        ));
                    }
                    if consent.authority == ConsentAuthority::SelfConsent
                        && consent.subject_display_name.to_lowercase()
                            != consent.attestor_display_name.to_lowercase()
                    {
                        return Err(CommandError::invalid(
                            "presenter.consent.authority",
                            "selfConsent requires the subject and attestor to be the same person",
                        ));
                    }
                    let grants: BTreeSet<_> = consent.grants.iter().copied().collect();
                    if grants.len() != consent.grants.len() || grants.len() > 4 {
                        return Err(CommandError::invalid(
                            "presenter.consent.grants",
                            "grants must be unique and bounded",
                        ));
                    }
                    if !grants.contains(&PresenterConsentGrant::PortraitAnimation) {
                        return Err(CommandError::invalid(
                            "presenter.consent.grants",
                            "portraitAnimation consent is required",
                        ));
                    }
                    if matches!(
                        consent.distribution_scope,
                        PresenterDistributionScope::PublicNonCommercial
                            | PresenterDistributionScope::PublicCommercial
                    ) && !grants.contains(&PresenterConsentGrant::PublicDistribution)
                    {
                        return Err(CommandError::invalid(
                            "presenter.consent.grants",
                            "publicDistribution consent is required for public presenter output",
                        ));
                    }
                    if consent.distribution_scope == PresenterDistributionScope::PublicCommercial
                        && !grants.contains(&PresenterConsentGrant::CommercialDistribution)
                    {
                        return Err(CommandError::invalid(
                            "presenter.consent.grants",
                            "commercialDistribution consent is required for commercial presenter output",
                        ));
                    }
                    if grants.contains(&PresenterConsentGrant::CommercialDistribution)
                        && !grants.contains(&PresenterConsentGrant::PublicDistribution)
                    {
                        return Err(CommandError::invalid(
                            "presenter.consent.grants",
                            "commercialDistribution consent also requires publicDistribution consent",
                        ));
                    }
                }
            }
        }
        (ProjectAssetKind::PresenterPortrait, None) => {
            return Err(CommandError::invalid(
                "presenter",
                "presenter portraits require identity, disclosure, and profile metadata",
            ));
        }
        (_, Some(_)) => {
            return Err(CommandError::invalid(
                "presenter",
                "presenter metadata is only valid for presenter portraits",
            ));
        }
        (_, None) => {}
    }

    let limit = match input.kind {
        ProjectAssetKind::Font => 16 * 1024 * 1024,
        ProjectAssetKind::PresenterPortrait | ProjectAssetKind::BackgroundImage => 32 * 1024 * 1024,
        ProjectAssetKind::SoundEffect => 32 * 1024 * 1024,
        ProjectAssetKind::PresenterAudio | ProjectAssetKind::Music => {
            validation::MAX_PROJECT_ASSET_BYTES
        }
    };
    if input.content_base64.len() > limit.div_ceil(3) * 4 {
        return Err(CommandError::invalid(
            "contentBase64",
            format!(
                "exceeds the {} MiB limit for this asset kind",
                limit / 1024 / 1024
            ),
        ));
    }
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(input.content_base64.as_bytes())
        .map_err(|_| CommandError::invalid("contentBase64", "must be canonical base64"))?;
    if decoded.len() > limit {
        return Err(CommandError::invalid(
            "contentBase64",
            format!(
                "decodes beyond the {} MiB limit for this asset kind",
                limit / 1024 / 1024
            ),
        ));
    }
    Ok(())
}

fn failed_receipt(job_id: Uuid, error: CommandError) -> JobReceipt {
    let state = if error.code == "COMPONENT_UNAVAILABLE" || error.code == "WORKER_ERROR" {
        JobState::Blocked
    } else {
        JobState::Failed
    };
    JobReceipt {
        job_id,
        state,
        accepted_at: Utc::now(),
        message: error.message,
        retryable: error.retryable,
        operation: None,
        progress: None,
        result: None,
        error: None,
    }
}

fn worker_result<T: serde::de::DeserializeOwned, P: serde::Serialize>(
    worker: &dyn WorkerTransport,
    method: &str,
    payload: &P,
) -> Result<T, CommandError> {
    let value = serde_json::to_value(payload).map_err(|_| {
        CommandError::new(
            "REQUEST_ENCODING_FAILED",
            "The desktop request could not be encoded.",
            false,
        )
    })?;
    let result = worker.call(method, value)?;
    serde_json::from_value(result)
        .map_err(|_| CommandError::worker("The pipeline returned an invalid response.", false))
}

fn archive_stem(title: &str) -> String {
    let value: String = title
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let value = value
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let stem = value
        .chars()
        .take(64)
        .collect::<String>()
        .trim_matches('-')
        .to_owned();
    if stem.is_empty() {
        "tutorial".into()
    } else {
        stem
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project_store::ProjectStore;
    use parking_lot::Mutex;
    use serde_json::Value;
    use tempfile::tempdir;

    #[test]
    fn generation_validation_normalizes_and_deduplicates() {
        let mut input = GenerationRequest {
            project_id: Uuid::nil(),
            project_directory: "C:/project".into(),
            snapshot_id: None,
            scope: GenerationScope::Project,
            quality: QualityPreset::Standard,
            privacy: PrivacyMode::Local,
            budget: BudgetPolicy {
                currency: "usd".into(),
                hard_limit_minor_units: 0,
                require_known_pricing: true,
            },
            approved_provider_ids: vec!["Local".into(), "local".into()],
            preservation_locks: vec!["scene-a".into(), "scene-a".into()],
        };
        validate_generation(&mut input).unwrap();
        assert_eq!(input.budget.currency, "USD");
        assert_eq!(input.approved_provider_ids, ["local"]);
        assert_eq!(input.preservation_locks, ["scene-a"]);
    }

    fn presenter_asset_input(identity_type: PresenterIdentityType) -> ProjectAssetImportRequest {
        ProjectAssetImportRequest {
            project_id: Uuid::nil(),
            project_directory: "C:/project".into(),
            expected_head_revision_id: "rev_test".into(),
            kind: ProjectAssetKind::PresenterPortrait,
            filename: "presenter.png".into(),
            mime_type: "image/png".into(),
            privacy: SourcePrivacy::ProjectLocal,
            rights: AssetRightsInput {
                status: AssetRightsStatus::Owned,
                creator: Some("Project owner".into()),
                license: Some("User-owned media".into()),
                attribution: None,
                commercial_use: AssetPermission::Allowed,
                redistribution: AssetPermission::Allowed,
                model_input: AssetPermission::Allowed,
            },
            presenter: Some(PresenterAssetInput {
                identity_type,
                display_name: "Studio instructor".into(),
                synthetic_origin_attested: identity_type == PresenterIdentityType::Synthetic,
                consent: None,
                select_after_import: true,
            }),
            content_base64: base64::engine::general_purpose::STANDARD.encode(b"small-test-image"),
        }
    }

    #[test]
    fn asset_validation_accepts_attested_synthetic_presenter() {
        let mut input = presenter_asset_input(PresenterIdentityType::Synthetic);
        validate_project_asset_import(&mut input).unwrap();
        assert_eq!(input.filename, "presenter.png");
        assert_eq!(input.rights.creator.as_deref(), Some("Project owner"));
    }

    #[test]
    fn asset_validation_requires_real_person_consent() {
        let mut input = presenter_asset_input(PresenterIdentityType::RealPerson);
        let error = validate_project_asset_import(&mut input).unwrap_err();
        assert!(error.message.contains("explicit consent"));
    }

    #[test]
    fn asset_validation_requires_distribution_grants_matching_output_scope() {
        let mut input = presenter_asset_input(PresenterIdentityType::RealPerson);
        input.presenter.as_mut().unwrap().consent = Some(PresenterConsentAttestation {
            subject_display_name: "Studio instructor".into(),
            attestor_display_name: "Studio instructor".into(),
            authority: ConsentAuthority::SelfConsent,
            grants: vec![
                PresenterConsentGrant::PortraitAnimation,
                PresenterConsentGrant::PublicDistribution,
            ],
            distribution_scope: PresenterDistributionScope::PublicCommercial,
            accepted: true,
            disclosure_required: true,
        });
        let error = validate_project_asset_import(&mut input).unwrap_err();
        assert!(error.message.contains("commercialDistribution"));

        input
            .presenter
            .as_mut()
            .unwrap()
            .consent
            .as_mut()
            .unwrap()
            .grants
            .push(PresenterConsentGrant::CommercialDistribution);
        validate_project_asset_import(&mut input).unwrap();
    }

    #[test]
    fn asset_validation_rejects_presenter_metadata_for_other_media() {
        let mut input = presenter_asset_input(PresenterIdentityType::Synthetic);
        input.kind = ProjectAssetKind::Music;
        input.filename = "music.mp3".into();
        input.mime_type = "audio/mpeg".into();
        let error = validate_project_asset_import(&mut input).unwrap_err();
        assert!(error.message.contains("only valid for presenter portraits"));
    }

    #[derive(Default)]
    struct RecordingWorker {
        method: Mutex<Option<String>>,
    }

    impl WorkerTransport for RecordingWorker {
        fn call(&self, method: &str, _payload: Value) -> Result<Value, CommandError> {
            *self.method.lock() = Some(method.into());
            serde_json::to_value(JobReceipt {
                job_id: Uuid::nil(),
                state: JobState::Running,
                accepted_at: Utc::now(),
                message: "Running".into(),
                retryable: false,
                operation: None,
                progress: None,
                result: None,
                error: None,
            })
            .map_err(CommandError::from)
        }
    }

    #[test]
    fn job_status_verifies_project_and_uses_narrow_worker_method() {
        let root = tempdir().unwrap();
        let project = ProjectStore
            .create(CreateProjectRequest {
                parent_directory: root.path().to_path_buf(),
                directory_name: "status-test".into(),
                title: "Status test".into(),
                locale: "en-US".into(),
                grounding_mode: GroundingMode::Grounded,
                initial_snapshot: None,
            })
            .unwrap();
        let worker = RecordingWorker::default();
        let receipt = job_action_with_transport(
            JobActionRequest {
                project_id: project.manifest.project_id,
                project_directory: project.project_directory.clone(),
                job_id: Uuid::nil(),
            },
            "job.status",
            &ProjectStore,
            &worker,
        )
        .unwrap();

        assert_eq!(*worker.method.lock(), Some("job.status".into()));
        assert_eq!(receipt.state, JobState::Running);

        let error = job_action_with_transport(
            JobActionRequest {
                project_id: Uuid::now_v7(),
                project_directory: project.project_directory,
                job_id: Uuid::nil(),
            },
            "job.status",
            &ProjectStore,
            &worker,
        )
        .unwrap_err();
        assert_eq!(error.code, "INVALID_INPUT");
    }
}
