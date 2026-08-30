//! Download-only local model staging.
//!
//! This manager deliberately stops before activation. It owns a tiny curated
//! catalog of immutable HTTPS artifacts, resumes `.part` files, verifies exact
//! sizes and SHA-256 digests, and records the accepted license hash. Runtime
//! activation remains a separate Python model-manager responsibility.

use crate::error::CommandError;
use crate::types::{
    ModelDownloadCatalogEntry, ModelDownloadPhase, ModelDownloadStartRequest, ModelDownloadStatus,
};
use chrono::Utc;
use parking_lot::RwLock;
use reqwest::blocking::{Client, Response};
use reqwest::header::{CONTENT_RANGE, RANGE};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

const STATUS_FILE: &str = "download-status.json";
const MAX_ARTIFACT_BYTES: u64 = 16 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy)]
struct ArtifactSpec {
    relative_path: &'static str,
    repository: &'static str,
    revision: &'static str,
    upstream_path: &'static str,
    size_bytes: u64,
    sha256: &'static str,
}

#[derive(Debug, Clone, Copy)]
struct PackageSpec {
    model_id: &'static str,
    display_name: &'static str,
    immutable_revision: &'static str,
    code_revision: &'static str,
    weight_revision: &'static str,
    license_id: &'static str,
    license_url: &'static str,
    license_sha256: &'static str,
    license_scope: &'static str,
    download_only_reason: &'static str,
    artifacts: &'static [ArtifactSpec],
}

// This exact artifact set was hash-verified during the RC MuseTalk spike. Some
// upstream `.pth` files may contain pickle payloads, so this pack remains in a
// quarantine directory and can never be activated by this module.
const MUSETALK_ARTIFACTS: &[ArtifactSpec] = &[
    artifact(
        "musetalkV15/musetalk.json",
        "TMElyralab/MuseTalk",
        "3ef28bc5cff08c90ad8178a25f1b570cd800170f",
        "musetalkV15/musetalk.json",
        748,
        "5b6923aee04d71692e0e9846c471e0a4ea07a4f686d39545e472bd4ba17e1b47",
    ),
    artifact(
        "musetalkV15/unet.pth",
        "TMElyralab/MuseTalk",
        "3ef28bc5cff08c90ad8178a25f1b570cd800170f",
        "musetalkV15/unet.pth",
        3_400_074_924,
        "7ebf6c98c181e20838e4c0054e96e944ac60d5d692cc01db42839fe11b787007",
    ),
    artifact(
        "sd-vae-ft-mse/config.json",
        "stabilityai/sd-vae-ft-mse",
        "31f26fdeee1355a5c34592e401dd41e45d25a493",
        "config.json",
        547,
        "92d3dfb746fca211a2c9e019e285f8597412211728dce3c5bcf4eda0f2d62e7e",
    ),
    artifact(
        "sd-vae-ft-mse/diffusion_pytorch_model.safetensors",
        "stabilityai/sd-vae-ft-mse",
        "31f26fdeee1355a5c34592e401dd41e45d25a493",
        "diffusion_pytorch_model.safetensors",
        334_643_276,
        "a1d993488569e928462932c8c38a0760b874d166399b14414135bd9c42df5815",
    ),
    artifact(
        "whisper/config.json",
        "openai/whisper-tiny",
        "169d4a4341b33bc18d8881c4b69c2e104e1cc0af",
        "config.json",
        1_983,
        "ffdccec4f3211f4c63310f2b7098f309fe70f3952cedc5e4d11e43f5b2379b98",
    ),
    artifact(
        "whisper/model.safetensors",
        "openai/whisper-tiny",
        "169d4a4341b33bc18d8881c4b69c2e104e1cc0af",
        "model.safetensors",
        151_061_672,
        "7ebd0e69e78190ffe1438491fa05cc1f5c1aa3a4c4db3bc1723adbb551ea2395",
    ),
    artifact(
        "whisper/preprocessor_config.json",
        "openai/whisper-tiny",
        "169d4a4341b33bc18d8881c4b69c2e104e1cc0af",
        "preprocessor_config.json",
        184_990,
        "9b5cd03a36fbb8a627c64d98a5b5b126ead95a77720723944487311f0110b666",
    ),
    artifact(
        "dwpose/dw-ll_ucoco_384.pth",
        "yzd-v/DWPose",
        "1a7144101628d69ee7a3768d1ee3a094070dc388",
        "dw-ll_ucoco_384.pth",
        406_878_486,
        "0d9408b13cd863c4e95a149dd31232f88f2a12aa6cf8964ed74d7d97748c7a07",
    ),
    artifact(
        "face-parse-bisent/79999_iter.pth",
        "ManyOtherFunctions/face-parse-bisent",
        "0073b233a5a3c4b1377d4dbf49245017938a72b5",
        "79999_iter.pth",
        53_289_463,
        "468e13ca13a9b43cc0881a9f99083a430e9c0a38abd935431d1c28ee94b26567",
    ),
    artifact(
        "face-parse-bisent/resnet18-5c106cde.pth",
        "ManyOtherFunctions/face-parse-bisent",
        "0073b233a5a3c4b1377d4dbf49245017938a72b5",
        "resnet18-5c106cde.pth",
        46_827_520,
        "5c106cde386e87d4033832f2996f5493238eda96ccf559d1d62760c4de0613f8",
    ),
];

const fn artifact(
    relative_path: &'static str,
    repository: &'static str,
    revision: &'static str,
    upstream_path: &'static str,
    size_bytes: u64,
    sha256: &'static str,
) -> ArtifactSpec {
    ArtifactSpec {
        relative_path,
        repository,
        revision,
        upstream_path,
        size_bytes,
        sha256,
    }
}

const MUSETALK: PackageSpec = PackageSpec {
    model_id: "local/musetalk-1.5",
    display_name: "MuseTalk 1.5",
    immutable_revision: "musetalk-hf-3ef28bc5+code-0a89dec4+dependencies-2026-08-29",
    code_revision: "0a89dec45a0192b824e3cf4daf96c239440c5ed8",
    weight_revision: "3ef28bc5cff08c90ad8178a25f1b570cd800170f",
    license_id: "MIT-code-repository",
    license_url: "https://github.com/TMElyralab/MuseTalk/blob/0a89dec45a0192b824e3cf4daf96c239440c5ed8/LICENSE",
    license_sha256: "992ec5fd1dd4964cfa003665196cd0c0c10a7a5aa10109991e964eebd2c7f116",
    license_scope: "MuseTalk source code only; model-card and dependency terms remain separate activation gates.",
    download_only_reason: "Hash-verified quarantine download only. This acknowledgement covers the pinned MuseTalk code license, not a combined pack license. Model-card and dependency terms remain separate, and upstream .pth files are not activated or executed until dependency-license, runtime-trust, and hardware reviews pass.",
    artifacts: MUSETALK_ARTIFACTS,
};

const PACKAGES: &[PackageSpec] = &[MUSETALK];

#[derive(Debug, Clone)]
pub struct ModelDownloadManager {
    root: PathBuf,
    statuses: Arc<RwLock<BTreeMap<String, ModelDownloadStatus>>>,
}

impl ModelDownloadManager {
    pub fn at(models_root: PathBuf) -> Result<Self, CommandError> {
        let root = models_root.join("download-quarantine");
        fs::create_dir_all(&root).map_err(|_| CommandError::io("model download cache setup"))?;
        let manager = Self {
            root,
            statuses: Arc::new(RwLock::new(BTreeMap::new())),
        };
        manager.load_statuses();
        Ok(manager)
    }

    pub fn catalog(&self) -> Vec<ModelDownloadCatalogEntry> {
        PACKAGES.iter().map(catalog_entry).collect()
    }

    pub fn statuses(&self) -> Vec<ModelDownloadStatus> {
        let records = self.statuses.read();
        PACKAGES
            .iter()
            .map(|spec| {
                records
                    .get(spec.model_id)
                    .cloned()
                    .unwrap_or_else(|| manifest_status(spec))
            })
            .collect()
    }

    pub fn start(
        &self,
        input: ModelDownloadStartRequest,
    ) -> Result<ModelDownloadStatus, CommandError> {
        let spec = package(&input.model_id)?;
        if input.license_sha256 != spec.license_sha256 || !input.license_accepted {
            return Err(CommandError::new(
                "LICENSE_NOT_ACCEPTED",
                "Accept the displayed immutable license record before downloading this model pack.",
                false,
            ));
        }
        if self
            .statuses
            .read()
            .get(spec.model_id)
            .is_some_and(|status| {
                status.phase == ModelDownloadPhase::Downloading
                    || status.phase == ModelDownloadPhase::Verifying
            })
        {
            return Err(CommandError::conflict(
                "This model pack download is already running.",
            ));
        }
        let downloaded_bytes = existing_bytes(&self.package_root(spec), spec);
        let status = ModelDownloadStatus {
            model_id: spec.model_id.into(),
            immutable_revision: Some(spec.immutable_revision.into()),
            phase: ModelDownloadPhase::Downloading,
            downloaded_bytes,
            total_bytes: total_bytes(spec),
            verified_artifacts: 0,
            artifact_count: spec.artifacts.len(),
            license_id: Some(spec.license_id.into()),
            license_url: Some(spec.license_url.into()),
            license_sha256: Some(spec.license_sha256.into()),
            license_accepted_at: Some(Utc::now()),
            detail: if downloaded_bytes > 0 {
                "Resuming hash-bound artifacts in the download-only quarantine.".into()
            } else {
                "Downloading hash-bound artifacts into the download-only quarantine.".into()
            },
            activation_blocked: true,
            updated_at: Utc::now(),
        };
        self.update(status.clone());
        let manager = self.clone();
        if std::thread::Builder::new()
            .name(format!("model-download-{}", safe_model_key(spec.model_id)))
            .spawn(move || manager.run(spec))
            .is_err()
        {
            let mut failed = status.clone();
            failed.phase = ModelDownloadPhase::Failed;
            failed.detail =
                "The model download worker could not start. Start again to retry.".into();
            failed.updated_at = Utc::now();
            self.update(failed);
            return Err(CommandError::io("model download worker start"));
        }
        Ok(status)
    }

    fn run(&self, spec: &'static PackageSpec) {
        let result = self.download(spec);
        if let Err(error) = result {
            let mut status = self.current(spec);
            status.phase = ModelDownloadPhase::Failed;
            status.detail = error.message;
            status.updated_at = Utc::now();
            self.update(status);
        }
    }

    fn download(&self, spec: &'static PackageSpec) -> Result<(), CommandError> {
        validate_spec(spec)?;
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(120))
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .map_err(|_| download_error("The secure model download client could not start."))?;
        let package_root = self.package_root(spec);
        fs::create_dir_all(package_root.join("files"))
            .map_err(|_| CommandError::io("model staging directory creation"))?;
        let mut verified = 0usize;
        for (index, artifact) in spec.artifacts.iter().enumerate() {
            let relative = safe_relative(artifact.relative_path)?;
            let final_path = package_root.join("files").join(&relative);
            if verify_file(&final_path, artifact).is_ok() {
                verified += 1;
                self.record_progress(
                    spec,
                    verified,
                    format!(
                        "Verified artifact {} of {}.",
                        index + 1,
                        spec.artifacts.len()
                    ),
                    ModelDownloadPhase::Downloading,
                );
                continue;
            }
            if final_path.exists() {
                fs::remove_file(&final_path)
                    .map_err(|_| CommandError::io("invalid model artifact cleanup"))?;
            }
            if let Some(parent) = final_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|_| CommandError::io("model artifact directory creation"))?;
            }
            let part = final_path.with_extension(format!(
                "{}part",
                final_path
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|value| format!("{value}."))
                    .unwrap_or_default()
            ));
            fetch_artifact(&client, spec, artifact, &part, |message| {
                self.record_progress(spec, verified, message, ModelDownloadPhase::Downloading)
            })?;
            self.record_progress(
                spec,
                verified,
                format!(
                    "Verifying SHA-256 for artifact {} of {}.",
                    index + 1,
                    spec.artifacts.len()
                ),
                ModelDownloadPhase::Verifying,
            );
            if let Err(error) = verify_file(&part, artifact) {
                let _ = fs::remove_file(&part);
                return Err(error);
            }
            fs::rename(&part, &final_path)
                .map_err(|_| CommandError::io("verified model artifact promotion"))?;
            verified += 1;
        }
        let mut status = self.current(spec);
        status.phase = ModelDownloadPhase::DownloadedQuarantined;
        status.downloaded_bytes = status.total_bytes;
        status.verified_artifacts = spec.artifacts.len();
        status.detail = "Every artifact passed its exact byte count and SHA-256 check. The pack remains download-only and cannot be used for inference.".into();
        status.updated_at = Utc::now();
        self.update(status);
        Ok(())
    }

    fn record_progress(
        &self,
        spec: &PackageSpec,
        verified: usize,
        detail: String,
        phase: ModelDownloadPhase,
    ) {
        let mut status = self.current(spec);
        status.phase = phase;
        status.downloaded_bytes = existing_bytes(&self.package_root(spec), spec);
        status.verified_artifacts = verified;
        status.detail = detail;
        status.updated_at = Utc::now();
        self.update(status);
    }

    fn package_root(&self, spec: &PackageSpec) -> PathBuf {
        self.root
            .join(safe_model_key(spec.model_id))
            .join(spec.immutable_revision)
    }
    fn current(&self, spec: &PackageSpec) -> ModelDownloadStatus {
        self.statuses
            .read()
            .get(spec.model_id)
            .cloned()
            .unwrap_or_else(|| manifest_status(spec))
    }
    fn update(&self, status: ModelDownloadStatus) {
        let path = self
            .package_root(package(status.model_id.as_str()).expect("status model is catalog-owned"))
            .join(STATUS_FILE);
        self.statuses
            .write()
            .insert(status.model_id.clone(), status.clone());
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(bytes) = serde_json::to_vec_pretty(&status) {
            let _ = atomic_write(&path, &bytes);
        }
    }
    fn load_statuses(&self) {
        for spec in PACKAGES {
            let path = self.package_root(spec).join(STATUS_FILE);
            let Ok(bytes) = fs::read(path) else { continue };
            let Ok(mut status) = serde_json::from_slice::<ModelDownloadStatus>(&bytes) else {
                continue;
            };
            if status.model_id != spec.model_id
                || status.immutable_revision.as_deref() != Some(spec.immutable_revision)
            {
                continue;
            }
            if matches!(
                status.phase,
                ModelDownloadPhase::Downloading | ModelDownloadPhase::Verifying
            ) {
                status.phase = ModelDownloadPhase::Failed;
                status.detail = "The previous app session ended during download. Start again to resume the existing .part files.".into();
                status.updated_at = Utc::now();
            } else if status.phase == ModelDownloadPhase::DownloadedQuarantined
                && spec.artifacts.iter().any(|artifact| {
                    safe_relative(artifact.relative_path).is_err()
                        || verify_file(
                            &self
                                .package_root(spec)
                                .join("files")
                                .join(artifact.relative_path),
                            artifact,
                        )
                        .is_err()
                })
            {
                status.phase = ModelDownloadPhase::Failed;
                status.detail = "A previously verified quarantine artifact is now missing or changed. Start again to repair it before any activation review.".into();
                status.updated_at = Utc::now();
            }
            self.statuses.write().insert(spec.model_id.into(), status);
        }
    }
}

fn artifact_url(spec: &ArtifactSpec) -> String {
    format!(
        "https://huggingface.co/{}/resolve/{}/{}",
        spec.repository, spec.revision, spec.upstream_path
    )
}

fn fetch_artifact(
    client: &Client,
    package_spec: &PackageSpec,
    artifact: &ArtifactSpec,
    part: &Path,
    mut progress: impl FnMut(String),
) -> Result<(), CommandError> {
    let mut offset = part.metadata().map(|value| value.len()).unwrap_or(0);
    if offset > artifact.size_bytes {
        fs::remove_file(part).map_err(|_| CommandError::io("oversized model partial cleanup"))?;
        offset = 0;
    }
    let url = artifact_url(artifact);
    let mut request = client.get(&url);
    if offset > 0 {
        request = request.header(RANGE, format!("bytes={offset}-"));
    }
    let mut response = request
        .send()
        .map_err(|_| download_error("The immutable model artifact could not be reached."))?;
    if offset > 0 && response.status() == reqwest::StatusCode::OK {
        fs::remove_file(part).map_err(|_| CommandError::io("model partial restart"))?;
        offset = 0;
        response = client.get(&url).send().map_err(|_| {
            download_error("The model source did not support resume and the clean retry failed.")
        })?;
    }
    validate_response(&response, artifact, offset)?;
    let mut output = OpenOptions::new()
        .create(true)
        .write(true)
        .append(offset > 0)
        .truncate(offset == 0)
        .open(part)
        .map_err(|_| CommandError::io("model partial write"))?;
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut written = offset;
    loop {
        let count = response.read(&mut buffer).map_err(|_| {
            download_error(
                "The model download was interrupted; the verified prefix was kept for resume.",
            )
        })?;
        if count == 0 {
            break;
        }
        written = written.saturating_add(count as u64);
        if written > artifact.size_bytes {
            return Err(download_error(
                "The model source exceeded its declared immutable byte count.",
            ));
        }
        output
            .write_all(&buffer[..count])
            .map_err(|_| CommandError::io("model partial write"))?;
        progress(format!(
            "Downloading {} · {} of {} total.",
            artifact.relative_path,
            human_bytes(existing_bytes_for_progress(package_spec, artifact, written)),
            human_bytes(total_bytes(package_spec))
        ));
    }
    output
        .flush()
        .and_then(|_| output.sync_all())
        .map_err(|_| CommandError::io("model partial flush"))?;
    if written != artifact.size_bytes {
        return Err(download_error(
            "The model artifact ended before its declared immutable byte count.",
        ));
    }
    Ok(())
}

fn validate_response(
    response: &Response,
    artifact: &ArtifactSpec,
    offset: u64,
) -> Result<(), CommandError> {
    if offset > 0 {
        if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            return Err(download_error(
                "The model source did not honor the exact resume range.",
            ));
        }
        let prefix = format!("bytes {offset}-");
        if !response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| {
                value.starts_with(&prefix) && value.ends_with(&format!("/{}", artifact.size_bytes))
            })
        {
            return Err(download_error(
                "The model source returned a different immutable range or total size.",
            ));
        }
    } else if response.status() != reqwest::StatusCode::OK {
        return Err(download_error(
            "The model source returned an unexpected HTTP status.",
        ));
    }
    Ok(())
}

fn verify_file(path: &Path, spec: &ArtifactSpec) -> Result<(), CommandError> {
    let metadata =
        fs::metadata(path).map_err(|_| download_error("A staged model artifact is missing."))?;
    if metadata.len() != spec.size_bytes {
        return Err(download_error(
            "A staged model artifact has the wrong byte count.",
        ));
    }
    let mut file =
        File::open(path).map_err(|_| CommandError::io("model artifact verification read"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| CommandError::io("model artifact verification read"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    if format!("{:x}", hasher.finalize()) != spec.sha256 {
        return Err(download_error(
            "A staged model artifact failed its exact SHA-256 check and was not promoted.",
        ));
    }
    Ok(())
}

fn validate_spec(spec: &PackageSpec) -> Result<(), CommandError> {
    if spec.artifacts.is_empty()
        || !spec.license_url.starts_with("https://")
        || !is_sha256(spec.license_sha256)
        || !is_git_revision(spec.code_revision)
        || !is_git_revision(spec.weight_revision)
        || spec.license_scope.trim().is_empty()
    {
        return Err(download_error(
            "The curated model declaration is incomplete.",
        ));
    }
    for artifact in spec.artifacts {
        safe_relative(artifact.relative_path)?;
        if artifact.size_bytes == 0
            || artifact.size_bytes > MAX_ARTIFACT_BYTES
            || !is_sha256(artifact.sha256)
            || !artifact_url(artifact).starts_with("https://huggingface.co/")
        {
            return Err(download_error(
                "The curated model artifact declaration is invalid.",
            ));
        }
    }
    Ok(())
}

fn is_git_revision(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn catalog_entry(spec: &PackageSpec) -> ModelDownloadCatalogEntry {
    ModelDownloadCatalogEntry {
        model_id: spec.model_id.into(),
        display_name: spec.display_name.into(),
        immutable_revision: spec.immutable_revision.into(),
        total_bytes: total_bytes(spec),
        artifact_count: spec.artifacts.len(),
        license_id: spec.license_id.into(),
        license_url: spec.license_url.into(),
        license_sha256: spec.license_sha256.into(),
        license_scope: spec.license_scope.into(),
        code_revision: spec.code_revision.into(),
        weight_revision: spec.weight_revision.into(),
        available: true,
        download_only_reason: spec.download_only_reason.into(),
    }
}
fn manifest_status(spec: &PackageSpec) -> ModelDownloadStatus {
    ModelDownloadStatus { model_id: spec.model_id.into(), immutable_revision: Some(spec.immutable_revision.into()), phase: ModelDownloadPhase::ManifestRequired, downloaded_bytes: existing_bytes_placeholder(), total_bytes: total_bytes(spec), verified_artifacts: 0, artifact_count: spec.artifacts.len(), license_id: Some(spec.license_id.into()), license_url: Some(spec.license_url.into()), license_sha256: Some(spec.license_sha256.into()), license_accepted_at: None, detail: "A pinned download-only declaration is available. Review and accept its exact license record to begin.".into(), activation_blocked: true, updated_at: Utc::now() }
}
const fn existing_bytes_placeholder() -> u64 {
    0
}
fn package(model_id: &str) -> Result<&'static PackageSpec, CommandError> {
    PACKAGES
        .iter()
        .find(|value| value.model_id == model_id)
        .ok_or_else(|| {
            CommandError::invalid("modelId", "has no curated immutable download declaration")
        })
}
fn total_bytes(spec: &PackageSpec) -> u64 {
    spec.artifacts.iter().map(|value| value.size_bytes).sum()
}
fn existing_bytes(root: &Path, spec: &PackageSpec) -> u64 {
    spec.artifacts
        .iter()
        .map(|artifact| {
            let relative = safe_relative(artifact.relative_path).unwrap_or_default();
            let final_path = root.join("files").join(&relative);
            if final_path.is_file() {
                artifact.size_bytes
            } else {
                final_path
                    .with_extension(format!(
                        "{}part",
                        final_path
                            .extension()
                            .and_then(|value| value.to_str())
                            .map(|value| format!("{value}."))
                            .unwrap_or_default()
                    ))
                    .metadata()
                    .map(|value| value.len().min(artifact.size_bytes))
                    .unwrap_or(0)
            }
        })
        .sum()
}
fn existing_bytes_for_progress(
    spec: &PackageSpec,
    current: &ArtifactSpec,
    current_written: u64,
) -> u64 {
    let mut total = 0;
    for artifact in spec.artifacts {
        if std::ptr::eq(artifact, current) {
            total += current_written;
            break;
        }
        total += artifact.size_bytes;
    }
    total
}
fn safe_model_key(model_id: &str) -> String {
    model_id.replace('/', "--")
}
fn safe_relative(value: &str) -> Result<PathBuf, CommandError> {
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(download_error(
            "A model artifact path escaped the download quarantine.",
        ));
    }
    Ok(path.to_path_buf())
}
fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}
fn human_bytes(value: u64) -> String {
    if value >= 1024 * 1024 * 1024 {
        format!("{:.2} GiB", value as f64 / (1024.0 * 1024.0 * 1024.0))
    } else if value >= 1024 * 1024 {
        format!("{:.1} MiB", value as f64 / (1024.0 * 1024.0))
    } else {
        format!("{} KiB", value / 1024)
    }
}
fn download_error(message: &str) -> CommandError {
    CommandError::new("MODEL_DOWNLOAD_FAILED", message, true)
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), CommandError> {
    let temporary = path.with_extension("json.part");
    fs::write(&temporary, bytes)
        .map_err(|_| CommandError::io("model download status staging write"))?;
    fs::rename(&temporary, path).map_err(|_| CommandError::io("model download status promotion"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn catalog_is_pinned_and_explicitly_download_only() {
        validate_spec(&MUSETALK).expect("valid pinned declaration");
        let entry = catalog_entry(&MUSETALK);
        assert_eq!(entry.model_id, "local/musetalk-1.5");
        assert!(entry.total_bytes > 4_000_000_000);
        assert!(entry.download_only_reason.contains("not activated"));
        assert_eq!(
            entry.code_revision,
            "0a89dec45a0192b824e3cf4daf96c239440c5ed8"
        );
        assert_eq!(
            entry.weight_revision,
            "3ef28bc5cff08c90ad8178a25f1b570cd800170f"
        );
        assert!(entry.license_url.contains(&entry.code_revision));
        assert!(!entry.license_url.contains(&entry.weight_revision));
        assert!(entry.license_scope.contains("source code only"));
    }

    #[test]
    fn exact_existing_artifact_is_hash_verified() {
        let directory = tempdir().expect("tempdir");
        let bytes = b"safe deterministic bytes";
        let path = directory.path().join("artifact.bin");
        fs::write(&path, bytes).expect("write fixture");
        let digest = format!("{:x}", Sha256::digest(bytes));
        let spec = ArtifactSpec {
            relative_path: "artifact.bin",
            repository: "example/model",
            revision: "revision",
            upstream_path: "artifact.bin",
            size_bytes: bytes.len() as u64,
            sha256: Box::leak(digest.into_boxed_str()),
        };
        verify_file(&path, &spec).expect("verified");
        fs::write(&path, b"tampered").expect("tamper");
        assert_eq!(
            verify_file(&path, &spec).expect_err("reject").code,
            "MODEL_DOWNLOAD_FAILED"
        );
    }

    #[test]
    fn manager_requires_the_exact_license_hash_before_start() {
        let directory = tempdir().expect("tempdir");
        let manager = ModelDownloadManager::at(directory.path().to_path_buf()).expect("manager");
        let error = manager
            .start(ModelDownloadStartRequest {
                model_id: MUSETALK.model_id.into(),
                license_sha256: "0".repeat(64),
                license_accepted: true,
            })
            .expect_err("wrong license");
        assert_eq!(error.code, "LICENSE_NOT_ACCEPTED");
        assert_eq!(
            manager.statuses()[0].phase,
            ModelDownloadPhase::ManifestRequired
        );
    }
}
