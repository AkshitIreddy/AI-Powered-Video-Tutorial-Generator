use crate::commands::validate_project_asset_import;
use crate::error::CommandError;
use crate::sidecar::WorkerTransport;
use crate::state::AppState;
use crate::types::{
    AssetPermission, AssetRightsInput, AssetRightsStatus, PresenterAssetInput,
    PresenterIdentityType, ProjectAssetImportReceipt, ProjectAssetImportRequest, ProjectAssetKind,
    ProjectAssetResolveReceipt, SourcePrivacy,
};
use base64::Engine as _;
use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;
use uuid::Uuid;

const LIBRARY_SCHEMA_VERSION: u32 = 1;
const MANIFEST_FILE: &str = "library.json";
const MAX_PORTRAIT_BYTES: usize = 24 * 1024 * 1024;

#[derive(Debug)]
pub struct PresenterLibraryStore {
    root: PathBuf,
    write_lock: Mutex<()>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind", deny_unknown_fields)]
pub enum PresenterLibrarySource {
    Upload,
    Generated {
        provider_id: String,
        model: String,
        prompt: String,
        seed: i64,
        candidate_id: String,
        project_id: Uuid,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresenterLibraryEntry {
    pub id: String,
    pub display_name: String,
    pub sha256: String,
    pub byte_size: u64,
    pub media_type: String,
    pub original_filename: String,
    pub added_at: DateTime<Utc>,
    pub source: PresenterLibrarySource,
    pub rights: AssetRightsInput,
    pub presenter: PresenterAssetInput,
    pub animation_review: PresenterAnimationReview,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PresenterAnimationReviewState {
    NotReviewed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PresenterAnimationAcceptanceState {
    Accepted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresenterAnimationAcceptance {
    pub status: PresenterAnimationAcceptanceState,
    pub preview_id: String,
    pub portrait_artifact_hash: String,
    pub output_artifact_hash: String,
    pub engine_id: String,
    pub model_revision: String,
    pub worker_contract_id: String,
    pub accepted_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum PresenterAnimationReview {
    State(PresenterAnimationReviewState),
    Accepted(PresenterAnimationAcceptance),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PresenterLibraryManifest {
    schema_version: u32,
    entries: Vec<PresenterLibraryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresenterLibraryImportRequest {
    pub filename: String,
    pub mime_type: String,
    pub rights: AssetRightsInput,
    pub presenter: PresenterAssetInput,
    pub content_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresenterLibraryResolveRequest {
    pub entry_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenterLibraryResolveReceipt {
    pub entry_id: String,
    pub path: PathBuf,
    pub media_type: String,
    pub sha256: String,
    pub byte_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresenterLibraryAddToProjectRequest {
    pub entry_id: String,
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub expected_head_revision_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresenterLibraryPromoteRequest {
    pub project_id: Uuid,
    pub project_directory: PathBuf,
    pub artifact_hash: String,
    pub display_name: String,
    pub provider_id: String,
    pub model: String,
    pub prompt: String,
    pub seed: i64,
    pub candidate_id: String,
}

impl PresenterLibraryStore {
    pub fn at(app_data: PathBuf) -> Result<Self, CommandError> {
        let root = app_data.join("Presenters");
        ensure_owned_directory(&root, "presenter library")?;
        ensure_owned_directory(&root.join("objects"), "presenter object store")?;
        let store = Self {
            root,
            write_lock: Mutex::new(()),
        };
        store.load_manifest()?;
        Ok(store)
    }

    pub fn list(&self) -> Result<Vec<PresenterLibraryEntry>, CommandError> {
        let manifest = self.load_manifest()?;
        for entry in &manifest.entries {
            self.verify_entry_object(entry)?;
        }
        Ok(manifest.entries)
    }

    pub fn import(
        &self,
        request: PresenterLibraryImportRequest,
    ) -> Result<PresenterLibraryEntry, CommandError> {
        let mut project_request = ProjectAssetImportRequest {
            project_id: Uuid::nil(),
            project_directory: PathBuf::from("presenter-library"),
            expected_head_revision_id: "presenter_library_import".into(),
            kind: ProjectAssetKind::PresenterPortrait,
            filename: request.filename,
            mime_type: request.mime_type,
            privacy: SourcePrivacy::ProjectLocal,
            rights: request.rights,
            presenter: Some(request.presenter),
            content_base64: request.content_base64,
        };
        validate_project_asset_import(&mut project_request)?;
        let bytes = decode_image(&project_request.content_base64, &project_request.mime_type)?;
        if bytes.len() > MAX_PORTRAIT_BYTES {
            return Err(CommandError::invalid(
                "contentBase64",
                "decodes beyond the 24 MiB saved-presenter limit",
            ));
        }
        self.import_bytes(
            bytes,
            project_request.filename,
            project_request.mime_type,
            project_request.rights,
            project_request
                .presenter
                .expect("validated presenter metadata"),
            PresenterLibrarySource::Upload,
        )
    }

    pub fn promote(
        &self,
        path: &Path,
        media_type: String,
        request: &PresenterLibraryPromoteRequest,
    ) -> Result<PresenterLibraryEntry, CommandError> {
        let bytes = read_regular_file(path, "generated presenter portrait")?;
        if bytes.len() > MAX_PORTRAIT_BYTES {
            return Err(CommandError::invalid(
                "artifactHash",
                "the generated portrait exceeds the 24 MiB saved-presenter limit",
            ));
        }
        validate_image_bytes(&bytes, &media_type)?;
        let display_name = bounded_text(&request.display_name, "displayName", 120)?;
        let provider_id = bounded_text(&request.provider_id, "providerId", 240)?;
        let model = bounded_text(&request.model, "model", 500)?;
        let prompt = bounded_text(&request.prompt, "prompt", 8_000)?;
        let candidate_id = stable_id(&request.candidate_id, "candidateId")?;
        let filename = format!(
            "{}.{}",
            filename_stem(&display_name),
            extension_for_media_type(&media_type)?
        );
        let rights = AssetRightsInput {
            status: AssetRightsStatus::Owned,
            creator: Some("Generated in AI Video Tutorial Generator".into()),
            license: None,
            attribution: None,
            commercial_use: AssetPermission::Allowed,
            redistribution: AssetPermission::Allowed,
            model_input: AssetPermission::Allowed,
        };
        let presenter = PresenterAssetInput {
            identity_type: PresenterIdentityType::Synthetic,
            display_name,
            synthetic_origin_attested: true,
            consent: None,
            select_after_import: false,
        };
        self.import_bytes(
            bytes,
            filename,
            media_type,
            rights,
            presenter,
            PresenterLibrarySource::Generated {
                provider_id,
                model,
                prompt,
                seed: request.seed,
                candidate_id,
                project_id: request.project_id,
            },
        )
    }

    pub fn resolve(&self, entry_id: &str) -> Result<PresenterLibraryResolveReceipt, CommandError> {
        let entry_id = stable_id(entry_id, "entryId")?;
        let entry = self
            .load_manifest()?
            .entries
            .into_iter()
            .find(|entry| entry.id == entry_id)
            .ok_or_else(|| {
                CommandError::new(
                    "PRESENTER_NOT_FOUND",
                    "The saved presenter was not found.",
                    false,
                )
            })?;
        let path = self.verify_entry_object(&entry)?;
        Ok(PresenterLibraryResolveReceipt {
            entry_id: entry.id,
            path,
            media_type: entry.media_type,
            sha256: entry.sha256,
            byte_size: entry.byte_size,
        })
    }

    fn import_bytes(
        &self,
        bytes: Vec<u8>,
        original_filename: String,
        media_type: String,
        rights: AssetRightsInput,
        presenter: PresenterAssetInput,
        source: PresenterLibrarySource,
    ) -> Result<PresenterLibraryEntry, CommandError> {
        validate_image_bytes(&bytes, &media_type)?;
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        let _guard = self.write_lock.lock();
        let mut manifest = self.load_manifest()?;
        if let Some(existing) = manifest.entries.iter().find(|entry| entry.sha256 == sha256) {
            self.verify_entry_object(existing)?;
            return Ok(existing.clone());
        }
        let extension = extension_for_media_type(&media_type)?;
        let object_path = self
            .root
            .join("objects")
            .join(format!("{sha256}.{extension}"));
        atomic_write_new(&object_path, &bytes, "presenter portrait")?;
        let entry = PresenterLibraryEntry {
            id: format!("custom-presenter-{}", &sha256[..24]),
            display_name: presenter.display_name.clone(),
            sha256,
            byte_size: bytes.len() as u64,
            media_type,
            original_filename,
            added_at: Utc::now(),
            source,
            rights,
            presenter,
            animation_review: PresenterAnimationReview::State(
                PresenterAnimationReviewState::NotReviewed,
            ),
        };
        manifest.entries.push(entry.clone());
        manifest
            .entries
            .sort_by(|left, right| right.added_at.cmp(&left.added_at));
        self.save_manifest(&manifest)?;
        Ok(entry)
    }

    fn load_manifest(&self) -> Result<PresenterLibraryManifest, CommandError> {
        let path = self.root.join(MANIFEST_FILE);
        if !path.exists() {
            return Ok(PresenterLibraryManifest {
                schema_version: LIBRARY_SCHEMA_VERSION,
                entries: Vec::new(),
            });
        }
        let bytes = read_regular_file(&path, "presenter library manifest")?;
        let manifest: PresenterLibraryManifest = serde_json::from_slice(&bytes).map_err(|_| {
            CommandError::new(
                "INVALID_PRESENTER_LIBRARY",
                "The presenter library manifest is invalid.",
                false,
            )
        })?;
        if manifest.schema_version != LIBRARY_SCHEMA_VERSION {
            return Err(CommandError::new(
                "INVALID_PRESENTER_LIBRARY",
                "The presenter library schema is not supported.",
                false,
            ));
        }
        let mut ids = BTreeSet::new();
        let mut hashes = BTreeSet::new();
        for entry in &manifest.entries {
            if stable_id(&entry.id, "entry.id")? != entry.id
                || !valid_sha256(&entry.sha256)
                || entry.id != format!("custom-presenter-{}", &entry.sha256[..24])
                || !ids.insert(entry.id.clone())
                || !hashes.insert(entry.sha256.clone())
                || entry.presenter.display_name != entry.display_name
                || entry.presenter.select_after_import
                || !valid_animation_review(entry)
            {
                return Err(CommandError::new(
                    "INVALID_PRESENTER_LIBRARY",
                    "The presenter library contains an invalid or duplicate entry.",
                    false,
                ));
            }
            validate_image_media_type(&entry.media_type)?;
            if let PresenterLibrarySource::Generated {
                provider_id,
                model,
                prompt,
                candidate_id,
                ..
            } = &entry.source
            {
                bounded_text(provider_id, "source.providerId", 240)?;
                bounded_text(model, "source.model", 500)?;
                bounded_text(prompt, "source.prompt", 8_000)?;
                stable_id(candidate_id, "source.candidateId")?;
            }
        }
        Ok(manifest)
    }

    pub fn accept_animation_review(
        &self,
        entry_id: &str,
        acceptance: PresenterAnimationAcceptance,
    ) -> Result<PresenterLibraryEntry, CommandError> {
        let entry_id = stable_id(entry_id, "entryId")?;
        validate_animation_acceptance(&acceptance)?;
        let _guard = self.write_lock.lock();
        let mut manifest = self.load_manifest()?;
        let entry = manifest
            .entries
            .iter_mut()
            .find(|entry| entry.id == entry_id)
            .ok_or_else(|| {
                CommandError::new(
                    "PRESENTER_NOT_FOUND",
                    "The saved presenter was not found.",
                    false,
                )
            })?;
        self.verify_entry_object(entry)?;
        if entry.sha256 != acceptance.portrait_artifact_hash {
            return Err(CommandError::new(
                "PRESENTER_PREVIEW_MISMATCH",
                "The accepted animation preview belongs to a different portrait.",
                false,
            ));
        }
        if let PresenterAnimationReview::Accepted(existing) = &entry.animation_review {
            if existing == &acceptance {
                return Ok(entry.clone());
            }
        }
        entry.animation_review = PresenterAnimationReview::Accepted(acceptance);
        let accepted = entry.clone();
        self.save_manifest(&manifest)?;
        Ok(accepted)
    }

    fn save_manifest(&self, manifest: &PresenterLibraryManifest) -> Result<(), CommandError> {
        let bytes = serde_json::to_vec_pretty(manifest)
            .map_err(|_| CommandError::io("presenter library manifest serialization"))?;
        atomic_replace(
            &self.root.join(MANIFEST_FILE),
            &bytes,
            "presenter library manifest",
        )
    }

    fn verify_entry_object(&self, entry: &PresenterLibraryEntry) -> Result<PathBuf, CommandError> {
        let extension = extension_for_media_type(&entry.media_type)?;
        let path = self
            .root
            .join("objects")
            .join(format!("{}.{}", entry.sha256, extension));
        let bytes = read_regular_file(&path, "presenter portrait")?;
        if bytes.len() as u64 != entry.byte_size
            || format!("{:x}", Sha256::digest(&bytes)) != entry.sha256
        {
            return Err(CommandError::new(
                "INVALID_PRESENTER_LIBRARY",
                "A saved presenter portrait no longer matches its recorded bytes.",
                false,
            ));
        }
        validate_image_bytes(&bytes, &entry.media_type)?;
        let mut validation_request = ProjectAssetImportRequest {
            project_id: Uuid::nil(),
            project_directory: PathBuf::from("presenter-library"),
            expected_head_revision_id: "presenter_library_verify".into(),
            kind: ProjectAssetKind::PresenterPortrait,
            filename: entry.original_filename.clone(),
            mime_type: entry.media_type.clone(),
            privacy: SourcePrivacy::ProjectLocal,
            rights: entry.rights.clone(),
            presenter: Some(entry.presenter.clone()),
            content_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        };
        validate_project_asset_import(&mut validation_request).map_err(|_| {
            CommandError::new(
                "INVALID_PRESENTER_LIBRARY",
                "A saved presenter record no longer passes identity and rights validation.",
                false,
            )
        })?;
        Ok(path)
    }
}

#[tauri::command]
pub fn presenter_library_list(
    state: State<'_, AppState>,
) -> Result<Vec<PresenterLibraryEntry>, CommandError> {
    state.presenter_library.list()
}

#[tauri::command]
pub fn presenter_library_import(
    input: PresenterLibraryImportRequest,
    state: State<'_, AppState>,
) -> Result<PresenterLibraryEntry, CommandError> {
    state.presenter_library.import(input)
}

#[tauri::command]
pub fn presenter_library_resolve(
    input: PresenterLibraryResolveRequest,
    state: State<'_, AppState>,
) -> Result<PresenterLibraryResolveReceipt, CommandError> {
    state.presenter_library.resolve(&input.entry_id)
}

#[tauri::command]
pub fn presenter_library_add_to_project(
    input: PresenterLibraryAddToProjectRequest,
    state: State<'_, AppState>,
) -> Result<ProjectAssetImportReceipt, CommandError> {
    state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    let entry_id = stable_id(&input.entry_id, "entryId")?;
    let entry = state
        .presenter_library
        .list()?
        .into_iter()
        .find(|entry| entry.id == entry_id)
        .ok_or_else(|| {
            CommandError::new(
                "PRESENTER_NOT_FOUND",
                "The saved presenter was not found.",
                false,
            )
        })?;
    let resolved = state.presenter_library.resolve(&entry.id)?;
    let bytes = read_regular_file(&resolved.path, "presenter portrait")?;
    let mut project_request = ProjectAssetImportRequest {
        project_id: input.project_id,
        project_directory: input.project_directory,
        expected_head_revision_id: input.expected_head_revision_id,
        kind: ProjectAssetKind::PresenterPortrait,
        filename: entry.original_filename,
        mime_type: entry.media_type,
        privacy: SourcePrivacy::ProjectLocal,
        rights: entry.rights,
        presenter: Some(entry.presenter),
        content_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    };
    validate_project_asset_import(&mut project_request)?;
    let value = WorkerTransport::call(
        &state.worker,
        "asset.import",
        serde_json::to_value(project_request)
            .map_err(|_| CommandError::io("presenter project import request"))?,
    )?;
    serde_json::from_value(value).map_err(|_| {
        CommandError::worker(
            "The pipeline returned an invalid presenter import receipt.",
            false,
        )
    })
}

#[tauri::command]
pub fn presenter_library_promote(
    input: PresenterLibraryPromoteRequest,
    state: State<'_, AppState>,
) -> Result<PresenterLibraryEntry, CommandError> {
    state
        .projects
        .verify_identity(&input.project_directory, input.project_id)?;
    if !valid_sha256(&input.artifact_hash) {
        return Err(CommandError::invalid(
            "artifactHash",
            "must be a lowercase SHA-256 digest",
        ));
    }
    let snapshot_receipt = WorkerTransport::call(
        &state.worker,
        "project.snapshot.get",
        serde_json::json!({
            "projectId": input.project_id,
            "projectDirectory": input.project_directory,
        }),
    )?;
    let snapshot = snapshot_receipt.get("snapshot").ok_or_else(|| {
        CommandError::worker("The pipeline returned an invalid project snapshot.", false)
    })?;
    verify_accepted_generated_candidate(snapshot, &input)?;
    let resolve_payload = serde_json::json!({
        "projectId": input.project_id,
        "projectDirectory": input.project_directory,
        "artifactHash": input.artifact_hash,
    });
    let resolved: ProjectAssetResolveReceipt = serde_json::from_value(WorkerTransport::call(
        &state.worker,
        "asset.resolve",
        resolve_payload,
    )?)
    .map_err(|_| {
        CommandError::worker(
            "The pipeline returned an invalid project asset receipt.",
            false,
        )
    })?;
    if resolved.project_id != input.project_id || resolved.artifact_hash != input.artifact_hash {
        return Err(CommandError::worker(
            "The pipeline resolved a different presenter artifact.",
            false,
        ));
    }
    state
        .presenter_library
        .promote(&resolved.path, resolved.media_type, &input)
}

fn verify_accepted_generated_candidate(
    snapshot: &serde_json::Value,
    input: &PresenterLibraryPromoteRequest,
) -> Result<(), CommandError> {
    let candidate = snapshot
        .get("sceneCandidates")
        .and_then(serde_json::Value::as_array)
        .and_then(|candidates| {
            candidates.iter().find(|candidate| {
                candidate.get("id").and_then(serde_json::Value::as_str)
                    == Some(input.candidate_id.as_str())
            })
        })
        .ok_or_else(|| {
            CommandError::new(
                "PRESENTER_NOT_ACCEPTED",
                "Accept the generated presenter candidate before saving it to My presenters.",
                false,
            )
        })?;
    let matches = candidate.get("status").and_then(serde_json::Value::as_str) == Some("accepted")
        && candidate.get("role").and_then(serde_json::Value::as_str) == Some("presenter")
        && candidate
            .get("artifactHash")
            .and_then(serde_json::Value::as_str)
            == Some(input.artifact_hash.as_str())
        && candidate
            .get("provider")
            .and_then(serde_json::Value::as_str)
            == Some(input.provider_id.as_str())
        && candidate.get("model").and_then(serde_json::Value::as_str) == Some(input.model.as_str())
        && candidate.get("prompt").and_then(serde_json::Value::as_str)
            == Some(input.prompt.as_str())
        && candidate.get("seed").and_then(serde_json::Value::as_i64) == Some(input.seed);
    if !matches {
        return Err(CommandError::new(
            "PRESENTER_PROVENANCE_MISMATCH",
            "The accepted presenter candidate does not match the requested gallery record.",
            false,
        ));
    }
    Ok(())
}

fn ensure_owned_directory(path: &Path, label: &str) -> Result<(), CommandError> {
    if path.exists() {
        let metadata = path
            .symlink_metadata()
            .map_err(|_| CommandError::io(label))?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(CommandError::new(
                "INVALID_PRESENTER_LIBRARY",
                format!("The {label} path must be a regular directory."),
                false,
            ));
        }
        return Ok(());
    }
    fs::create_dir_all(path).map_err(|_| CommandError::io(label))
}

fn read_regular_file(path: &Path, label: &str) -> Result<Vec<u8>, CommandError> {
    let metadata = path
        .symlink_metadata()
        .map_err(|_| CommandError::io(label))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(CommandError::new(
            "INVALID_PRESENTER_LIBRARY",
            format!("The {label} must be a regular file."),
            false,
        ));
    }
    fs::read(path).map_err(|_| CommandError::io(label))
}

fn atomic_write_new(path: &Path, bytes: &[u8], label: &str) -> Result<(), CommandError> {
    if path.exists() {
        return Ok(());
    }
    let temporary = path.with_extension(format!(
        "{}.{}.part",
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("bin"),
        Uuid::now_v7()
    ));
    fs::write(&temporary, bytes).map_err(|_| {
        CommandError::new(
            "LOCAL_IO_FAILED",
            format!("Could not stage the {label}."),
            true,
        )
    })?;
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        if !path.exists() {
            return Err(CommandError::new(
                "LOCAL_IO_FAILED",
                format!("Could not save the {label}: {error}"),
                true,
            ));
        }
    }
    Ok(())
}

fn atomic_replace(path: &Path, bytes: &[u8], label: &str) -> Result<(), CommandError> {
    let temporary = path.with_extension(format!("json.{}.part", Uuid::now_v7()));
    fs::write(&temporary, bytes).map_err(|_| {
        CommandError::new(
            "LOCAL_IO_FAILED",
            format!("Could not stage the {label}."),
            true,
        )
    })?;
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(CommandError::new(
            "LOCAL_IO_FAILED",
            format!("Could not save the {label}: {error}"),
            true,
        ));
    }
    Ok(())
}

fn decode_image(content_base64: &str, media_type: &str) -> Result<Vec<u8>, CommandError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content_base64.as_bytes())
        .map_err(|_| CommandError::invalid("contentBase64", "must be canonical base64"))?;
    validate_image_bytes(&bytes, media_type)?;
    Ok(bytes)
}

fn validate_image_bytes(bytes: &[u8], media_type: &str) -> Result<(), CommandError> {
    validate_image_media_type(media_type)?;
    let matches = match media_type {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]) && bytes.ends_with(&[0xff, 0xd9]),
        "image/webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    };
    if !matches {
        return Err(CommandError::invalid(
            "contentBase64",
            "does not match the declared image type",
        ));
    }
    Ok(())
}

fn validate_image_media_type(media_type: &str) -> Result<(), CommandError> {
    if matches!(media_type, "image/png" | "image/jpeg" | "image/webp") {
        Ok(())
    } else {
        Err(CommandError::invalid(
            "mimeType",
            "must be image/png, image/jpeg, or image/webp",
        ))
    }
}

fn extension_for_media_type(media_type: &str) -> Result<&'static str, CommandError> {
    match media_type {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        "image/webp" => Ok("webp"),
        _ => Err(CommandError::invalid(
            "mimeType",
            "must be image/png, image/jpeg, or image/webp",
        )),
    }
}

fn bounded_text(value: &str, field: &str, maximum: usize) -> Result<String, CommandError> {
    let value = value.trim();
    if value.is_empty() || value.len() > maximum || value.chars().any(char::is_control) {
        return Err(CommandError::invalid(
            field,
            format!("must contain 1 to {maximum} visible characters"),
        ));
    }
    Ok(value.into())
}

fn stable_id(value: &str, field: &str) -> Result<String, CommandError> {
    let value = bounded_text(value, field, 240)?;
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(CommandError::invalid(
            field,
            "contains unsupported characters",
        ));
    }
    Ok(value)
}

fn filename_stem(value: &str) -> String {
    let normalized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = normalized.trim_matches('-');
    if trimmed.is_empty() {
        "presenter".into()
    } else {
        trimmed.chars().take(80).collect()
    }
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_animation_review(entry: &PresenterLibraryEntry) -> bool {
    match &entry.animation_review {
        PresenterAnimationReview::State(PresenterAnimationReviewState::NotReviewed) => true,
        PresenterAnimationReview::Accepted(acceptance) => {
            acceptance.portrait_artifact_hash == entry.sha256
                && validate_animation_acceptance(acceptance).is_ok()
        }
    }
}

fn validate_animation_acceptance(
    acceptance: &PresenterAnimationAcceptance,
) -> Result<(), CommandError> {
    stable_id(&acceptance.preview_id, "animationReview.previewId")?;
    if !valid_sha256(&acceptance.portrait_artifact_hash)
        || !valid_sha256(&acceptance.output_artifact_hash)
    {
        return Err(CommandError::new(
            "INVALID_PRESENTER_LIBRARY",
            "The saved animation review contains an invalid artifact hash.",
            false,
        ));
    }
    if acceptance.engine_id != "soulx-flashhead-pro"
        || acceptance.worker_contract_id != "alystria.soulx-flashhead.worker.v1"
    {
        return Err(CommandError::new(
            "INVALID_PRESENTER_LIBRARY",
            "The saved animation review uses an unsupported presenter runtime.",
            false,
        ));
    }
    bounded_text(
        &acceptance.model_revision,
        "animationReview.modelRevision",
        500,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nsmall-test-png";

    fn request(name: &str) -> PresenterLibraryImportRequest {
        PresenterLibraryImportRequest {
            filename: "teacher.png".into(),
            mime_type: "image/png".into(),
            rights: AssetRightsInput {
                status: AssetRightsStatus::Owned,
                creator: Some("Project owner".into()),
                license: None,
                attribution: None,
                commercial_use: AssetPermission::Allowed,
                redistribution: AssetPermission::Allowed,
                model_input: AssetPermission::Allowed,
            },
            presenter: PresenterAssetInput {
                identity_type: PresenterIdentityType::Synthetic,
                display_name: name.into(),
                synthetic_origin_attested: true,
                consent: None,
                select_after_import: false,
            },
            content_base64: base64::engine::general_purpose::STANDARD.encode(PNG),
        }
    }

    #[test]
    fn import_is_durable_hash_bound_and_deduplicated() {
        let temporary = tempdir().unwrap();
        let store = PresenterLibraryStore::at(temporary.path().to_path_buf()).unwrap();
        let first = store.import(request("Morgan")).unwrap();
        let second = store.import(request("Duplicate label")).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(store.list().unwrap().len(), 1);
        let mut different = request("Echo");
        different.content_base64 =
            base64::engine::general_purpose::STANDARD.encode([PNG, b"different"].concat());
        let third = store.import(different).unwrap();
        assert_ne!(first.id, third.id);
        assert_eq!(store.list().unwrap().len(), 2);
        let resolved = store.resolve(&first.id).unwrap();
        assert_eq!(fs::read(resolved.path).unwrap(), PNG);

        let reopened = PresenterLibraryStore::at(temporary.path().to_path_buf()).unwrap();
        assert_eq!(reopened.list().unwrap().len(), 2);
        assert!(
            reopened
                .list()
                .unwrap()
                .iter()
                .any(|entry| entry.display_name == "Morgan")
        );
        assert_eq!(
            serde_json::to_value(&first.animation_review).unwrap(),
            serde_json::json!("notReviewed")
        );
    }

    #[test]
    fn rejects_mime_spoofing_and_unattested_portraits() {
        let temporary = tempdir().unwrap();
        let store = PresenterLibraryStore::at(temporary.path().to_path_buf()).unwrap();
        let mut spoofed = request("Morgan");
        spoofed.mime_type = "image/jpeg".into();
        assert!(
            store
                .import(spoofed)
                .unwrap_err()
                .message
                .contains("declared image type")
        );
        let mut unattested = request("Morgan");
        unattested.presenter.synthetic_origin_attested = false;
        assert!(
            store
                .import(unattested)
                .unwrap_err()
                .message
                .contains("origin attestation")
        );
    }

    #[test]
    fn list_rejects_tampered_object_and_symlinked_root() {
        let temporary = tempdir().unwrap();
        let store = PresenterLibraryStore::at(temporary.path().to_path_buf()).unwrap();
        let entry = store.import(request("Morgan")).unwrap();
        let resolved = store.resolve(&entry.id).unwrap();
        fs::write(&resolved.path, b"tampered").unwrap();
        assert_eq!(store.list().unwrap_err().code, "INVALID_PRESENTER_LIBRARY");

        #[cfg(unix)]
        {
            let other = tempdir().unwrap();
            let app_data = other.path().join("app");
            fs::create_dir_all(&app_data).unwrap();
            std::os::unix::fs::symlink(temporary.path(), app_data.join("Presenters")).unwrap();
            assert_eq!(
                PresenterLibraryStore::at(app_data).unwrap_err().code,
                "INVALID_PRESENTER_LIBRARY"
            );
        }
    }

    #[test]
    fn promotion_requires_an_exact_accepted_presenter_candidate() {
        let request = PresenterLibraryPromoteRequest {
            project_id: Uuid::nil(),
            project_directory: PathBuf::from("project"),
            artifact_hash: "a".repeat(64),
            display_name: "Nova".into(),
            provider_id: "gemini".into(),
            model: "imagen".into(),
            prompt: "A fictional teacher".into(),
            seed: 42,
            candidate_id: "candidate-1".into(),
        };
        let accepted = serde_json::json!({"sceneCandidates": [{
            "id": "candidate-1", "status": "accepted", "role": "presenter",
            "artifactHash": "a".repeat(64), "provider": "gemini", "model": "imagen",
            "prompt": "A fictional teacher", "seed": 42
        }]});
        verify_accepted_generated_candidate(&accepted, &request).unwrap();
        let mut mismatched = accepted;
        mismatched["sceneCandidates"][0]["artifactHash"] = serde_json::json!("b".repeat(64));
        assert_eq!(
            verify_accepted_generated_candidate(&mismatched, &request)
                .unwrap_err()
                .code,
            "PRESENTER_PROVENANCE_MISMATCH"
        );
    }

    #[test]
    fn accepted_animation_review_is_bound_to_portrait_model_and_output() {
        let temporary = tempdir().unwrap();
        let store = PresenterLibraryStore::at(temporary.path().to_path_buf()).unwrap();
        let entry = store.import(request("Nova")).unwrap();
        let acceptance = PresenterAnimationAcceptance {
            status: PresenterAnimationAcceptanceState::Accepted,
            preview_id: "presenter-preview-proof".into(),
            portrait_artifact_hash: entry.sha256.clone(),
            output_artifact_hash: "b".repeat(64),
            engine_id: "soulx-flashhead-pro".into(),
            model_revision: "soulx-code-a+weights-b".into(),
            worker_contract_id: "alystria.soulx-flashhead.worker.v1".into(),
            accepted_at: Utc::now(),
        };
        let accepted = store
            .accept_animation_review(&entry.id, acceptance.clone())
            .unwrap();
        assert_eq!(
            accepted.animation_review,
            PresenterAnimationReview::Accepted(acceptance.clone())
        );
        let reopened = PresenterLibraryStore::at(temporary.path().to_path_buf()).unwrap();
        assert_eq!(
            reopened.list().unwrap()[0].animation_review,
            PresenterAnimationReview::Accepted(acceptance)
        );

        let mismatched = PresenterAnimationAcceptance {
            portrait_artifact_hash: "c".repeat(64),
            ..match accepted.animation_review {
                PresenterAnimationReview::Accepted(value) => value,
                PresenterAnimationReview::State(_) => unreachable!(),
            }
        };
        assert_eq!(
            store
                .accept_animation_review(&entry.id, mismatched)
                .unwrap_err()
                .code,
            "PRESENTER_PREVIEW_MISMATCH"
        );
    }
}
