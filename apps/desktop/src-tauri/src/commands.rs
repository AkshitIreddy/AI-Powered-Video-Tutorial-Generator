use crate::diagnostics;
use crate::error::CommandError;
use crate::project_store::ProjectStore;
use crate::sidecar::WorkerTransport;
use crate::state::AppState;
use crate::types::*;
use crate::validation;
use base64::Engine as _;
use chrono::Utc;
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
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
        Err(error) => Ok(failed_receipt(generated_id, error, false)),
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
    if input.seed.is_some_and(|seed| seed > i64::MAX as u64) {
        return Err(CommandError::invalid(
            "seed",
            "must be between 0 and 9223372036854775807",
        ));
    }
    validate_image_recipe(&mut input.image_recipe)?;
    if input.edit_focus.is_some() {
        if input.role != VisualCandidateRole::Scene {
            return Err(CommandError::invalid(
                "editFocus",
                "authored scene edits cannot target presenter portraits",
            ));
        }
        if input.image_recipe.is_some() {
            return Err(CommandError::invalid(
                "imageRecipe",
                "authored scene edits cannot include an image recipe",
            ));
        }
    }
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

fn validate_image_recipe(recipe: &mut Option<ImageRecipeRequest>) -> Result<(), CommandError> {
    if let Some(recipe) = recipe {
        if let Some(model) = &mut recipe.model {
            *model = validation::bounded_text(model, "imageRecipe.model", 500)?;
        }
        if recipe
            .model
            .as_deref()
            .is_some_and(|model| model != "local/sdxl-base-1.0")
        {
            return Err(CommandError::invalid(
                "imageRecipe.model",
                "must be local/sdxl-base-1.0",
            ));
        }
        if recipe.loras.len() > 1
            || recipe
                .loras
                .iter()
                .any(|lora| lora != "local/sdxl-offset-lora-1.0")
        {
            return Err(CommandError::invalid(
                "imageRecipe.loras",
                "supports only local/sdxl-offset-lora-1.0 once",
            ));
        }
        if let Some(negative_prompt) = &mut recipe.negative_prompt {
            *negative_prompt =
                validation::bounded_text(negative_prompt, "imageRecipe.negativePrompt", 2_048)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn scene_candidate_accept(
    mut input: VisualCandidateAcceptRequest,
    state: State<'_, AppState>,
) -> Result<VisualCandidateAcceptReceipt, CommandError> {
    state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    input.expected_head_revision_id = validation::bounded_text(
        &input.expected_head_revision_id,
        "expectedHeadRevisionId",
        128,
    )?;
    input.candidate_id = validation::stable_id(&input.candidate_id, "candidateId")?;

    let expected_project_id = input.project_id;
    let expected_candidate_id = input.candidate_id.clone();
    let receipt: VisualCandidateAcceptReceipt =
        worker_result(&state.worker, "control.acceptVisualCandidate", &input)?;
    if receipt.project_id != expected_project_id || receipt.candidate_id != expected_candidate_id {
        return Err(CommandError::worker(
            "The pipeline returned a mismatched visual candidate receipt.",
            false,
        ));
    }
    validation::stable_id(&receipt.head_revision_id, "headRevisionId")?;
    validation::stable_id(&receipt.scene_id, "sceneId")?;
    validation::stable_id(&receipt.asset_id, "assetId")?;
    validate_sha256(&receipt.artifact_hash, "artifactHash")?;
    Ok(receipt)
}

#[tauri::command]
pub fn scene_edit_candidate_accept(
    input: SceneEditCandidateDecisionRequest,
    state: State<'_, AppState>,
) -> Result<SceneEditCandidateDecisionReceipt, CommandError> {
    scene_edit_candidate_decision(
        input,
        "control.acceptSceneEditCandidate",
        "accepted",
        &state,
    )
}

#[tauri::command]
pub fn scene_edit_candidate_reject(
    mut input: SceneEditCandidateDecisionRequest,
    state: State<'_, AppState>,
) -> Result<SceneEditCandidateDecisionReceipt, CommandError> {
    if let Some(reason) = &mut input.reason {
        *reason = validation::bounded_text(reason, "reason", 500)?;
    }
    scene_edit_candidate_decision(
        input,
        "control.rejectSceneEditCandidate",
        "rejected",
        &state,
    )
}

fn scene_edit_candidate_decision(
    mut input: SceneEditCandidateDecisionRequest,
    method: &str,
    expected_status: &str,
    state: &State<'_, AppState>,
) -> Result<SceneEditCandidateDecisionReceipt, CommandError> {
    state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    input.expected_head_revision_id = validation::bounded_text(
        &input.expected_head_revision_id,
        "expectedHeadRevisionId",
        128,
    )?;
    input.candidate_id = validation::stable_id(&input.candidate_id, "candidateId")?;
    let expected_project_id = input.project_id;
    let expected_candidate_id = input.candidate_id.clone();
    let receipt: SceneEditCandidateDecisionReceipt = worker_result(&state.worker, method, &input)?;
    if receipt.project_id != expected_project_id
        || receipt.candidate_id != expected_candidate_id
        || receipt.status != expected_status
    {
        return Err(CommandError::worker(
            "The pipeline returned a mismatched scene edit candidate receipt.",
            false,
        ));
    }
    validation::stable_id(&receipt.head_revision_id, "headRevisionId")?;
    validation::stable_id(&receipt.scene_id, "sceneId")?;
    Ok(receipt)
}

#[tauri::command]
pub fn scene_stock_search(
    mut input: StockVisualCandidateSearchRequest,
    state: State<'_, AppState>,
) -> Result<JobReceipt, CommandError> {
    verify_control_identity(
        &state,
        input.project_id,
        &input.project_directory,
        &input.expected_head_revision_id,
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
    if let Some(search_query) = &mut input.search_query {
        *search_query = validation::bounded_text(search_query, "searchQuery", 240)?;
    }
    if let Some(locale) = &mut input.locale {
        *locale = validation::locale(locale)?;
    }
    control_action(input, "control.searchVisualCandidates", &state)
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
pub fn editor_timeline_export(
    input: EditorTimelineExportRequest,
    state: State<'_, AppState>,
) -> Result<JobReceipt, CommandError> {
    editor_timeline_export_with_transport(input, &state.projects, &state.worker)
}

fn editor_timeline_export_with_transport(
    input: EditorTimelineExportRequest,
    projects: &ProjectStore,
    worker: &dyn WorkerTransport,
) -> Result<JobReceipt, CommandError> {
    projects.verify_identity(&input.project_directory, input.project_id)?;
    validation::bounded_text(
        &input.expected_head_revision_id,
        "expectedHeadRevisionId",
        128,
    )?;
    if !input.manifest.is_object() {
        return Err(CommandError::invalid(
            "manifest",
            "must be an editor render manifest object",
        ));
    }
    worker_result(worker, "editor.timeline.export", &input)
}

#[tauri::command]
pub fn project_asset_resolve(
    input: ProjectAssetResolveRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ProjectAssetResolveReceipt, CommandError> {
    state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    validate_sha256(&input.artifact_hash, "artifactHash")?;
    let expected_project_id = input.project_id;
    let expected_hash = input.artifact_hash.clone();
    let receipt: ProjectAssetResolveReceipt =
        worker_result(&state.worker, "asset.resolve", &input)?;
    if receipt.project_id != expected_project_id || receipt.artifact_hash != expected_hash {
        return Err(CommandError::worker(
            "The pipeline returned a mismatched project artifact.",
            false,
        ));
    }
    allow_verified_project_file(&app, &input.project_directory, &receipt.path)?;
    Ok(receipt)
}

#[tauri::command]
pub fn editor_bindings_get(
    input: EditorBindingsGetRequest,
    state: State<'_, AppState>,
) -> Result<EditorBindingsGetReceipt, CommandError> {
    state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    let expected_project_id = input.project_id;
    let expected_generation_id = input.generation_id;
    let receipt: EditorBindingsGetReceipt =
        worker_result(&state.worker, "editor.bindings.get", &input)?;
    if receipt.project_id != expected_project_id || receipt.generation_id != expected_generation_id
    {
        return Err(CommandError::worker(
            "The pipeline returned mismatched editor media bindings.",
            false,
        ));
    }
    Ok(receipt)
}

#[tauri::command]
pub fn editor_waveform_get(
    input: EditorWaveformRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<EditorWaveformReceipt, CommandError> {
    state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    validate_sha256(&input.artifact_hash, "artifactHash")?;
    if !(256..=4096).contains(&input.profile.width) {
        return Err(CommandError::invalid(
            "profile.width",
            "must be between 256 and 4096",
        ));
    }
    if !(32..=256).contains(&input.profile.height) {
        return Err(CommandError::invalid(
            "profile.height",
            "must be between 32 and 256",
        ));
    }

    let expected_project_id = input.project_id;
    let expected_hash = input.artifact_hash.clone();
    let expected_width = input.profile.width;
    let expected_height = input.profile.height;
    let receipt: EditorWaveformReceipt =
        worker_result(&state.worker, "editor.waveform.get", &input)?;
    if receipt.project_id != expected_project_id
        || receipt.artifact_hash != expected_hash
        || receipt.profile.width != expected_width
        || receipt.profile.height != expected_height
        || receipt.width != expected_width
        || receipt.height != expected_height
        || receipt.media_type != "image/png"
        || receipt.duration_ticks == 0
    {
        return Err(CommandError::worker(
            "The pipeline returned mismatched waveform media.",
            false,
        ));
    }
    validate_sha256(&receipt.waveform_hash, "waveformHash")?;
    allow_verified_project_file(&app, &input.project_directory, &receipt.waveform_path)?;
    Ok(receipt)
}

fn validate_sha256(value: &str, field: &str) -> Result<(), CommandError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(CommandError::invalid(
            field,
            "must be 64 lowercase hexadecimal characters",
        ));
    }
    Ok(())
}

fn allow_verified_project_file(
    app: &AppHandle,
    project_directory: &Path,
    path: &Path,
) -> Result<(), CommandError> {
    let project_root = std::fs::canonicalize(project_directory).map_err(|_| {
        CommandError::worker("The verified project directory is unavailable.", true)
    })?;
    let resolved = std::fs::canonicalize(path)
        .map_err(|_| CommandError::worker("The verified project media is unavailable.", true))?;
    if !resolved.starts_with(&project_root)
        || !std::fs::metadata(&resolved)
            .map(|metadata| metadata.is_file())
            .unwrap_or(false)
    {
        return Err(CommandError::worker(
            "The pipeline returned media outside the verified project.",
            false,
        ));
    }
    app.asset_protocol_scope()
        .allow_file(&resolved)
        .map_err(|_| {
            CommandError::new(
                "ASSET_PROTOCOL_SCOPE_FAILED",
                "The verified project media could not be exposed to this app window.",
                true,
            )
        })
}

#[tauri::command]
pub fn job_status(
    input: JobActionRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<JobReceipt, CommandError> {
    let project_directory = input.project_directory.clone();
    let receipt = job_action(input, "job.status", &state)?;
    if receipt.state == JobState::Succeeded {
        if let Some(result) = receipt.result.as_ref().and_then(Value::as_object) {
            for field in ["path", "outputPath"] {
                if let Some(path) = result.get(field).and_then(Value::as_str) {
                    allow_verified_project_file(&app, &project_directory, Path::new(path))?;
                }
            }
        }
    }
    Ok(receipt)
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
        Err(error) => Ok(failed_receipt(generated_id, error, false)),
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
    mut input: JobActionRequest,
    method: &str,
    projects: &crate::project_store::ProjectStore,
    worker: &dyn WorkerTransport,
) -> Result<JobReceipt, CommandError> {
    projects.verify_identity(&input.project_directory, input.project_id)?;
    input.expected_head_revision_id = input
        .expected_head_revision_id
        .as_deref()
        .map(|value| validation::stable_id(value, "expectedHeadRevisionId"))
        .transpose()?;
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
        Err(error) => Ok(failed_receipt(job_id, error, true)),
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
pub fn local_presenter_runtime_status(
    state: State<'_, AppState>,
) -> Vec<crate::presenter_status::PresenterPortraitRuntimeStatus> {
    crate::presenter_status::inspect(&state.paths.models)
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
        ProjectAssetKind::PresenterPortrait
        | ProjectAssetKind::BackgroundImage
        | ProjectAssetKind::EditorImage => 32 * 1024 * 1024,
        ProjectAssetKind::SoundEffect => 32 * 1024 * 1024,
        ProjectAssetKind::PresenterAudio
        | ProjectAssetKind::Music
        | ProjectAssetKind::EditorVideo
        | ProjectAssetKind::EditorAudio => validation::MAX_PROJECT_ASSET_BYTES,
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

fn failed_receipt(job_id: Uuid, error: CommandError, durable: bool) -> JobReceipt {
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
        result: Some(serde_json::json!({ "durable": durable })),
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
    fn generation_request_matches_the_frontend_without_a_budget() {
        let frontend_request = serde_json::json!({
            "projectId": "00000000-0000-0000-0000-000000000000",
            "projectDirectory": "C:/project",
            "snapshotId": null,
            "scope": { "kind": "project" },
            "quality": "standard",
            "privacy": "local",
            "approvedProviderIds": ["Local", "local"],
            "preservationLocks": ["scene-a", "scene-a"]
        });
        let mut input: GenerationRequest = serde_json::from_value(frontend_request).unwrap();

        validate_generation(&mut input).unwrap();
        assert_eq!(input.approved_provider_ids, ["local"]);
        assert_eq!(input.preservation_locks, ["scene-a"]);

        let worker_payload = serde_json::to_value(input).unwrap();
        assert!(worker_payload.get("budget").is_none());
    }

    #[test]
    fn image_recipe_validation_accepts_defaults_and_rejects_unapproved_models() {
        let mut defaults = Some(ImageRecipeRequest {
            model: None,
            loras: Vec::new(),
            negative_prompt: None,
        });
        validate_image_recipe(&mut defaults).unwrap();

        let mut approved = Some(ImageRecipeRequest {
            model: Some(" local/sdxl-base-1.0 ".into()),
            loras: vec!["local/sdxl-offset-lora-1.0".into()],
            negative_prompt: Some(" no text or watermark ".into()),
        });
        validate_image_recipe(&mut approved).unwrap();
        let approved = approved.unwrap();
        assert_eq!(approved.model.as_deref(), Some("local/sdxl-base-1.0"));
        assert_eq!(
            approved.negative_prompt.as_deref(),
            Some("no text or watermark")
        );

        let mut rejected = Some(ImageRecipeRequest {
            model: Some("local/unreviewed-model".into()),
            loras: Vec::new(),
            negative_prompt: None,
        });
        assert_eq!(
            validate_image_recipe(&mut rejected).unwrap_err().code,
            "INVALID_INPUT"
        );
    }

    #[test]
    fn generated_transport_failures_are_not_misclassified_as_durable_jobs() {
        let receipt = failed_receipt(
            Uuid::now_v7(),
            CommandError::invalid("sceneId", "does not exist in the current revision"),
            false,
        );
        assert_eq!(
            receipt.result,
            Some(serde_json::json!({ "durable": false }))
        );
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

    #[test]
    fn asset_validation_accepts_all_durable_editor_media_kinds() {
        for (kind, filename, mime_type, encoded_kind) in [
            (
                ProjectAssetKind::EditorImage,
                "lesson.png",
                "image/png",
                "editorImage",
            ),
            (
                ProjectAssetKind::EditorVideo,
                "lesson.webm",
                "video/webm",
                "editorVideo",
            ),
            (
                ProjectAssetKind::EditorAudio,
                "lesson.wav",
                "audio/wav",
                "editorAudio",
            ),
        ] {
            let mut input = presenter_asset_input(PresenterIdentityType::Synthetic);
            input.kind = kind;
            input.filename = filename.into();
            input.mime_type = mime_type.into();
            input.presenter = None;

            validate_project_asset_import(&mut input).unwrap();
            assert_eq!(
                serde_json::to_value(input.kind).unwrap(),
                serde_json::json!(encoded_kind)
            );
        }
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
                expected_head_revision_id: None,
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
                project_id: project.manifest.project_id,
                project_directory: project.project_directory.clone(),
                job_id: Uuid::nil(),
                expected_head_revision_id: Some("revision with spaces".into()),
            },
            "generation.approve",
            &ProjectStore,
            &worker,
        )
        .unwrap_err();
        assert_eq!(error.code, "INVALID_INPUT");

        let error = job_action_with_transport(
            JobActionRequest {
                project_id: Uuid::now_v7(),
                project_directory: project.project_directory,
                job_id: Uuid::nil(),
                expected_head_revision_id: None,
            },
            "job.status",
            &ProjectStore,
            &worker,
        )
        .unwrap_err();
        assert_eq!(error.code, "INVALID_INPUT");
    }

    struct EditorExportWorker {
        method: Mutex<Option<String>>,
    }

    impl WorkerTransport for EditorExportWorker {
        fn call(&self, method: &str, _payload: Value) -> Result<Value, CommandError> {
            *self.method.lock() = Some(method.into());
            serde_json::to_value(JobReceipt {
                job_id: Uuid::nil(),
                state: JobState::Queued,
                accepted_at: Utc::now(),
                message: "Editor timeline export queued".into(),
                retryable: false,
                operation: Some("editor_timeline_export".into()),
                progress: Some(0.0),
                result: None,
                error: None,
            })
            .map_err(CommandError::from)
        }
    }

    #[test]
    fn editor_timeline_export_verifies_identity_and_uses_the_narrow_worker_method() {
        let root = tempdir().unwrap();
        let project = ProjectStore
            .create(CreateProjectRequest {
                parent_directory: root.path().to_path_buf(),
                directory_name: "editor-export-test".into(),
                title: "Editor export test".into(),
                locale: "en-US".into(),
                grounding_mode: GroundingMode::Creative,
                initial_snapshot: None,
            })
            .unwrap();
        let worker = EditorExportWorker {
            method: Mutex::new(None),
        };
        let receipt = editor_timeline_export_with_transport(
            EditorTimelineExportRequest {
                project_id: project.manifest.project_id,
                project_directory: project.project_directory,
                expected_head_revision_id: "revision.one".into(),
                manifest: serde_json::json!({ "schemaVersion": 1, "tracks": [] }),
            },
            &ProjectStore,
            &worker,
        )
        .unwrap();

        assert_eq!(*worker.method.lock(), Some("editor.timeline.export".into()));
        assert_eq!(receipt.state, JobState::Queued);
    }
}
