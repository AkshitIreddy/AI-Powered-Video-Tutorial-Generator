use crate::error::CommandError;
use crate::sidecar::WorkerLaunchConfig;
use crate::types::{RuntimeComponent, RuntimeManifest, UpdaterStatus};
use base64::Engine as _;
use chrono::Utc;
use ed25519_dalek::{Signature, Verifier as _, VerifyingKey};
use parking_lot::RwLock;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use uuid::Uuid;

const EMBEDDED_MANIFEST: &str = include_str!("../runtime-manifest.json");
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_COMPONENT_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const MANIFEST_FILE: &str = "runtime-manifest.json";
const RELEASE_KEY_ID: &str = "alystria-runtime-release-unconfigured-v1";
// This is deliberately an unconfigured public key whose private half was discarded.
// Release engineering must replace it with the offline release key before enabling
// downloads. The embedded development manifest contains no components and cannot
// activate a pack.
const RELEASE_PUBLIC_KEY_BASE64: &str = "CSHzk3EPRsmDBUUneS8S04e0F3GoEEeHXU/6Dzk3mq8=";

const PIPELINE_WORKER: &str = "pipeline-worker";
const NODE: &str = "node";
const RENDERER_CLI: &str = "renderer-cli";
const CHROMIUM: &str = "chromium";
const FFMPEG: &str = "ffmpeg";
const FFPROBE: &str = "ffprobe";
const STARTER_AUDIO_CATALOG: &str = "starter-audio-catalog";
const STARTER_AUDIO_RELATIVE_ROOT: &str = "assets/starter/audio";
const STARTER_VISUAL_CATALOG: &str = "starter-visual-catalog";
const STARTER_VISUAL_RELATIVE_ROOT: &str = "assets/starter/visuals";
const STARTER_VISUAL_CATALOG_RELATIVE_PATH: &str =
    "assets/starter/visuals/packages/themes/starter-kits/core.v1.json";
const REQUIRED_COMPONENTS: [&str; 6] = [
    PIPELINE_WORKER,
    NODE,
    RENDERER_CLI,
    CHROMIUM,
    FFMPEG,
    FFPROBE,
];

pub trait RuntimeManifestVerifier: Send + Sync {
    fn verify(&self, manifest: &RuntimeManifest) -> Result<(), CommandError>;
}

#[allow(dead_code)] // Transport/UI binding is deliberately deferred until release signing is configured.
pub trait RuntimeArtifactFetcher {
    /// Streams one component into a newly-created staging file. Implementations
    /// must not interpret the destination path or activate content themselves.
    fn fetch(
        &self,
        component: &RuntimeComponent,
        destination: &mut dyn Write,
    ) -> Result<(), CommandError>;
}

struct SizeBoundedWriter<'a> {
    inner: &'a mut File,
    remaining: u64,
}

impl Write for SizeBoundedWriter<'_> {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        if buffer.len() as u64 > self.remaining {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "runtime component exceeded its signed size",
            ));
        }
        let written = self.inner.write(buffer)?;
        self.remaining = self.remaining.saturating_sub(written as u64);
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

#[derive(Clone)]
pub struct Ed25519ManifestVerifier {
    keys: BTreeMap<String, VerifyingKey>,
}

impl std::fmt::Debug for Ed25519ManifestVerifier {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Ed25519ManifestVerifier")
            .field("key_ids", &self.keys.keys().collect::<Vec<_>>())
            .finish()
    }
}

impl Ed25519ManifestVerifier {
    pub fn release() -> Result<Self, CommandError> {
        Self::from_base64_keys([(RELEASE_KEY_ID, RELEASE_PUBLIC_KEY_BASE64)])
    }

    pub fn from_base64_keys<'a>(
        keys: impl IntoIterator<Item = (&'a str, &'a str)>,
    ) -> Result<Self, CommandError> {
        let mut parsed = BTreeMap::new();
        for (key_id, encoded) in keys {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .map_err(|_| {
                    runtime_error("INVALID_RUNTIME_TRUST", "A runtime public key is invalid.")
                })?;
            let key_bytes: [u8; 32] = bytes.try_into().map_err(|_| {
                runtime_error(
                    "INVALID_RUNTIME_TRUST",
                    "A runtime public key has the wrong size.",
                )
            })?;
            let key = VerifyingKey::from_bytes(&key_bytes).map_err(|_| {
                runtime_error(
                    "INVALID_RUNTIME_TRUST",
                    "A runtime public key could not be parsed.",
                )
            })?;
            if key_id.trim().is_empty() || parsed.insert(key_id.to_owned(), key).is_some() {
                return Err(runtime_error(
                    "INVALID_RUNTIME_TRUST",
                    "Runtime public key identifiers must be unique and non-empty.",
                ));
            }
        }
        Ok(Self { keys: parsed })
    }
}

impl RuntimeManifestVerifier for Ed25519ManifestVerifier {
    fn verify(&self, manifest: &RuntimeManifest) -> Result<(), CommandError> {
        validate_manifest_structure(manifest)?;
        let signature_record = manifest.signature.as_ref().ok_or_else(|| {
            runtime_error(
                "UNSIGNED_RUNTIME_MANIFEST",
                "The runtime manifest is not signed.",
            )
        })?;
        if signature_record.algorithm != "Ed25519" {
            return Err(runtime_error(
                "UNSUPPORTED_RUNTIME_SIGNATURE",
                "The runtime manifest signature algorithm is unsupported.",
            ));
        }
        let key = self.keys.get(&signature_record.key_id).ok_or_else(|| {
            runtime_error(
                "UNKNOWN_RUNTIME_SIGNING_KEY",
                "The runtime manifest was signed by an untrusted key.",
            )
        })?;
        let signature_bytes = base64::engine::general_purpose::STANDARD
            .decode(&signature_record.value)
            .map_err(|_| {
                runtime_error(
                    "INVALID_RUNTIME_SIGNATURE",
                    "The runtime manifest signature is malformed.",
                )
            })?;
        let signature = Signature::from_slice(&signature_bytes).map_err(|_| {
            runtime_error(
                "INVALID_RUNTIME_SIGNATURE",
                "The runtime manifest signature has the wrong size.",
            )
        })?;
        key.verify(&manifest_signing_payload(manifest)?, &signature)
            .map_err(|_| {
                runtime_error(
                    "INVALID_RUNTIME_SIGNATURE",
                    "The runtime manifest signature did not verify.",
                )
            })
    }
}

#[derive(Debug, Clone)]
pub struct InstalledRuntimePack {
    pub pack_id: String,
    pub root: PathBuf,
    pub manifest_path: PathBuf,
    pub manifest: RuntimeManifest,
    components: BTreeMap<String, RuntimeComponent>,
}

impl InstalledRuntimePack {
    pub fn component_path(&self, id: &str) -> Option<PathBuf> {
        self.components
            .get(id)
            .map(|component| self.root.join(&component.relative_path))
    }

    fn component(&self, id: &str) -> Option<&RuntimeComponent> {
        self.components.get(id)
    }

    pub fn worker_launch_config(&self, working_directory: PathBuf) -> Option<WorkerLaunchConfig> {
        if REQUIRED_COMPONENTS
            .iter()
            .any(|id| !self.components.contains_key(*id))
        {
            return None;
        }
        let worker = self.component(PIPELINE_WORKER)?;
        let mut environment = BTreeMap::new();
        environment.insert(
            "ALYSTRIA_RUNTIME_PACK_ROOT".into(),
            self.root.as_os_str().to_owned(),
        );
        environment.insert(
            "ALYSTRIA_RUNTIME_MANIFEST_PATH".into(),
            self.manifest_path.as_os_str().to_owned(),
        );
        environment.insert("ALYSTRIA_RENDERER_MODE".into(), "production".into());
        for (id, variable) in [
            (NODE, "ALYSTRIA_NODE_PATH"),
            (RENDERER_CLI, "ALYSTRIA_RENDERER_CLI_PATH"),
            (CHROMIUM, "ALYSTRIA_CHROMIUM_PATH"),
            (FFMPEG, "ALYSTRIA_FFMPEG_PATH"),
            (FFPROBE, "ALYSTRIA_FFPROBE_PATH"),
        ] {
            environment.insert(variable.into(), self.component_path(id)?.into_os_string());
        }
        if let Some(catalog) = self.component(STARTER_AUDIO_CATALOG)
            && catalog.relative_path == format!("{STARTER_AUDIO_RELATIVE_ROOT}/catalog.json")
        {
            environment.insert(
                "ALYSTRIA_STARTER_AUDIO_ROOT".into(),
                self.root.join(STARTER_AUDIO_RELATIVE_ROOT).into_os_string(),
            );
        }
        if let Some(catalog) = self.component(STARTER_VISUAL_CATALOG)
            && catalog.relative_path == STARTER_VISUAL_CATALOG_RELATIVE_PATH
        {
            environment.insert(
                "ALYSTRIA_STARTER_VISUAL_ROOT".into(),
                self.root
                    .join(STARTER_VISUAL_RELATIVE_ROOT)
                    .into_os_string(),
            );
        }
        Some(WorkerLaunchConfig {
            executable: self.component_path(PIPELINE_WORKER)?,
            working_directory,
            expected_sha256: Some(worker.sha256.clone()),
            environment,
        })
    }
}

/// Loads the complete unsigned runtime pack emitted by the portable-debug
/// packaging script. This path exists only to make a locally built debug app
/// exercise the same component ledger and worker environment as an installed
/// signed pack. Release builds always reject it.
///
/// The root is derived from the explicitly selected debug worker by
/// `state.rs`; no request, project, or renderer payload can choose it. Every
/// selected component is still path-contained, size-bound, and SHA-256
/// verified before the worker is started.
pub fn load_portable_debug_pack(root: &Path) -> Result<InstalledRuntimePack, CommandError> {
    if !cfg!(debug_assertions) {
        return Err(runtime_error(
            "PORTABLE_DEBUG_RUNTIME_DISABLED",
            "Unsigned portable runtime packs are disabled in release builds.",
        ));
    }
    let metadata = root.symlink_metadata().map_err(|_| {
        runtime_error(
            "INCOMPLETE_RUNTIME_PACK",
            "The portable debug runtime directory is missing.",
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(runtime_error(
            "INVALID_RUNTIME_PACK",
            "The portable debug runtime directory is unsafe.",
        ));
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|_| runtime_io("canonicalize portable debug runtime"))?;
    let manifest_path = canonical_root.join(MANIFEST_FILE);
    let manifest_metadata = manifest_path.symlink_metadata().map_err(|_| {
        runtime_error(
            "INCOMPLETE_RUNTIME_PACK",
            "The portable debug runtime manifest is missing.",
        )
    })?;
    if manifest_metadata.file_type().is_symlink()
        || !manifest_metadata.is_file()
        || manifest_metadata.len() == 0
        || manifest_metadata.len() > MAX_MANIFEST_BYTES
    {
        return Err(runtime_error(
            "INVALID_RUNTIME_PACK",
            "The portable debug runtime manifest is not a bounded regular file.",
        ));
    }
    let manifest: RuntimeManifest = serde_json::from_reader(
        File::open(&manifest_path).map_err(|_| runtime_io("open portable debug manifest"))?,
    )
    .map_err(|_| {
        runtime_error(
            "INVALID_RUNTIME_MANIFEST",
            "The portable debug runtime manifest is invalid.",
        )
    })?;
    if manifest.channel != "portable-debug" || manifest.signature.is_some() {
        return Err(runtime_error(
            "INVALID_RUNTIME_MANIFEST",
            "A portable debug manifest must be unsigned and use the portable-debug channel.",
        ));
    }
    validate_manifest_structure(&manifest)?;

    let mut components = BTreeMap::new();
    for component in selected_components(&manifest)? {
        let path = canonical_root.join(safe_relative_path(&component.relative_path)?);
        let canonical_path = path
            .canonicalize()
            .map_err(|_| runtime_io("canonicalize portable debug component"))?;
        if !canonical_path.starts_with(&canonical_root) {
            return Err(runtime_error(
                "INVALID_RUNTIME_PATH",
                format!(
                    "Portable runtime component {} escapes its verified pack.",
                    component.id
                ),
            ));
        }
        verify_component_file(&path, component)?;
        components.insert(component.id.clone(), component.clone());
    }
    if REQUIRED_COMPONENTS
        .iter()
        .any(|required| !components.contains_key(*required))
    {
        return Err(runtime_error(
            "INCOMPLETE_RUNTIME_PACK",
            "The portable debug runtime is incomplete for this platform.",
        ));
    }
    Ok(InstalledRuntimePack {
        pack_id: manifest_id(&manifest)?,
        root: canonical_root,
        manifest_path,
        manifest,
        components,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActivationRecord {
    schema_version: u32,
    activation_id: Uuid,
    activated_at: chrono::DateTime<Utc>,
    pack_id: String,
    previous_pack_id: Option<String>,
}

#[derive(Clone)]
pub struct RuntimeManager {
    runtime_root: PathBuf,
    embedded_manifest: RuntimeManifest,
    #[allow(dead_code)] // Retained for the staged install and rollback APIs below.
    verifier: Arc<dyn RuntimeManifestVerifier>,
    resolved: Arc<RwLock<Option<InstalledRuntimePack>>>,
}

impl std::fmt::Debug for RuntimeManager {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RuntimeManager")
            .field("runtime_root", &self.runtime_root)
            .field("manifest", &self.manifest())
            .field(
                "active_pack",
                &self.resolved.read().as_ref().map(|pack| &pack.pack_id),
            )
            .finish()
    }
}

impl RuntimeManager {
    #[allow(dead_code)] // Embedded-stub loader used by focused tests and packaging diagnostics.
    pub fn load() -> Result<Self, CommandError> {
        Self::load_at(PathBuf::new())
    }

    pub fn load_at(runtime_root: PathBuf) -> Result<Self, CommandError> {
        Self::load_with_verifier(runtime_root, Arc::new(Ed25519ManifestVerifier::release()?))
    }

    pub fn load_with_verifier(
        runtime_root: PathBuf,
        verifier: Arc<dyn RuntimeManifestVerifier>,
    ) -> Result<Self, CommandError> {
        let embedded_manifest: RuntimeManifest =
            serde_json::from_str(EMBEDDED_MANIFEST).map_err(|_| {
                runtime_error(
                    "INVALID_RUNTIME_MANIFEST",
                    "The embedded runtime manifest is invalid.",
                )
            })?;
        validate_development_stub(&embedded_manifest)?;
        let resolved = if runtime_root.as_os_str().is_empty() {
            None
        } else {
            resolve_latest_valid_pack(&runtime_root, verifier.as_ref())?
        };
        Ok(Self {
            runtime_root,
            embedded_manifest,
            verifier,
            resolved: Arc::new(RwLock::new(resolved)),
        })
    }

    pub fn manifest(&self) -> RuntimeManifest {
        self.resolved
            .read()
            .as_ref()
            .map(|pack| pack.manifest.clone())
            .unwrap_or_else(|| self.embedded_manifest.clone())
    }

    pub fn active_pack(&self) -> Option<InstalledRuntimePack> {
        self.resolved.read().clone()
    }

    pub fn updater_status(&self) -> UpdaterStatus {
        let manifest = self.manifest();
        UpdaterStatus {
            enabled: false,
            channel: manifest.channel,
            current_version: env!("CARGO_PKG_VERSION").into(),
            reason: "Runtime downloads remain disabled until release engineering configures an offline Ed25519 signing key and HTTPS fetcher.".into(),
        }
    }

    /// Installs a complete signed pack through an injected transport. Activation
    /// is one immutable record; a crash before that record leaves the prior pack
    /// selected, and a partial/corrupt newest pack is skipped on the next load.
    #[allow(dead_code)] // No network fetcher is enabled before the release key is configured.
    pub fn install_with_fetcher(
        &self,
        manifest_bytes: &[u8],
        fetcher: &dyn RuntimeArtifactFetcher,
    ) -> Result<InstalledRuntimePack, CommandError> {
        if self.runtime_root.as_os_str().is_empty() {
            return Err(runtime_error(
                "RUNTIME_INSTALL_DISABLED",
                "Runtime installation is unavailable without an application runtime directory.",
            ));
        }
        if manifest_bytes.len() as u64 > MAX_MANIFEST_BYTES {
            return Err(runtime_error(
                "INVALID_RUNTIME_MANIFEST",
                "The runtime manifest exceeds the safety limit.",
            ));
        }
        let manifest: RuntimeManifest = serde_json::from_slice(manifest_bytes).map_err(|_| {
            runtime_error(
                "INVALID_RUNTIME_MANIFEST",
                "The runtime manifest is not valid JSON.",
            )
        })?;
        self.verifier.verify(&manifest)?;
        let pack_id = manifest_id(&manifest)?;
        let staging_root =
            self.runtime_root
                .join(".staging")
                .join(format!("{}-{}", pack_id, Uuid::now_v7()));
        let final_root = self.runtime_root.join("packs").join(&pack_id);
        fs::create_dir_all(staging_root.parent().expect("staging root has parent"))
            .map_err(|_| runtime_io("create runtime staging directory"))?;
        fs::create_dir_all(final_root.parent().expect("pack root has parent"))
            .map_err(|_| runtime_io("create runtime pack directory"))?;
        fs::create_dir(&staging_root).map_err(|_| runtime_io("create isolated runtime staging"))?;

        let install_result = (|| {
            for component in selected_components(&manifest)? {
                let relative = safe_relative_path(&component.relative_path)?;
                let destination = staging_root.join(relative);
                if let Some(parent) = destination.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|_| runtime_io("create staged component directory"))?;
                }
                let part = destination.with_extension(format!(
                    "{}.part",
                    destination
                        .extension()
                        .and_then(|value| value.to_str())
                        .unwrap_or("")
                ));
                let mut file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&part)
                    .map_err(|_| runtime_io("create staged runtime component"))?;
                {
                    let mut bounded = SizeBoundedWriter {
                        inner: &mut file,
                        remaining: component.size_bytes,
                    };
                    fetcher.fetch(component, &mut bounded)?;
                    if bounded.remaining != 0 {
                        return Err(runtime_error(
                            "RUNTIME_COMPONENT_SIZE_MISMATCH",
                            format!("Runtime component {} is incomplete.", component.id),
                        ));
                    }
                }
                file.flush()
                    .map_err(|_| runtime_io("flush staged runtime component"))?;
                file.sync_all()
                    .map_err(|_| runtime_io("sync staged runtime component"))?;
                drop(file);
                verify_component_file(&part, component)?;
                fs::rename(&part, &destination)
                    .map_err(|_| runtime_io("commit staged runtime component"))?;
            }
            let manifest_path = staging_root.join(MANIFEST_FILE);
            let mut manifest_file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&manifest_path)
                .map_err(|_| runtime_io("create staged runtime manifest"))?;
            manifest_file
                .write_all(manifest_bytes)
                .and_then(|_| manifest_file.sync_all())
                .map_err(|_| runtime_io("write staged runtime manifest"))?;
            verify_pack_at(&staging_root, &pack_id, self.verifier.as_ref())?;
            Ok::<(), CommandError>(())
        })();
        if let Err(error) = install_result {
            let _ = fs::remove_dir_all(&staging_root);
            return Err(error);
        }

        if final_root.exists() {
            verify_pack_at(&final_root, &pack_id, self.verifier.as_ref())?;
            fs::remove_dir_all(&staging_root)
                .map_err(|_| runtime_io("remove duplicate staged runtime pack"))?;
        } else {
            fs::rename(&staging_root, &final_root)
                .map_err(|_| runtime_io("atomically promote runtime pack"))?;
        }
        let previous = self.active_pack().map(|pack| pack.pack_id);
        write_activation(&self.runtime_root, &pack_id, previous)?;
        let installed = verify_pack_at(&final_root, &pack_id, self.verifier.as_ref())?;
        *self.resolved.write() = Some(installed.clone());
        Ok(installed)
    }

    #[allow(dead_code)] // Exposed to the future runtime-manager command surface, not the webview.
    pub fn rollback(&self) -> Result<InstalledRuntimePack, CommandError> {
        let current = self.active_pack().ok_or_else(|| {
            runtime_error("RUNTIME_ROLLBACK_UNAVAILABLE", "No runtime pack is active.")
        })?;
        let records = activation_records(&self.runtime_root)?;
        let previous_id = records
            .iter()
            .rev()
            .find(|record| record.pack_id == current.pack_id)
            .and_then(|record| record.previous_pack_id.clone())
            .ok_or_else(|| {
                runtime_error(
                    "RUNTIME_ROLLBACK_UNAVAILABLE",
                    "The active runtime pack has no valid rollback target.",
                )
            })?;
        let previous_root = self.runtime_root.join("packs").join(&previous_id);
        let previous = verify_pack_at(&previous_root, &previous_id, self.verifier.as_ref())?;
        write_activation(&self.runtime_root, &previous.pack_id, Some(current.pack_id))?;
        *self.resolved.write() = Some(previous.clone());
        Ok(previous)
    }
}

fn validate_development_stub(manifest: &RuntimeManifest) -> Result<(), CommandError> {
    if manifest.schema_version != 1
        || manifest.channel != "development"
        || !manifest.components.is_empty()
        || manifest.signature.is_some()
    {
        return Err(runtime_error(
            "INVALID_RUNTIME_MANIFEST",
            "The embedded development manifest must be empty and unsigned.",
        ));
    }
    Ok(())
}

fn validate_manifest_structure(manifest: &RuntimeManifest) -> Result<(), CommandError> {
    if manifest.schema_version != 1 || manifest.channel.trim().is_empty() {
        return Err(runtime_error(
            "INVALID_RUNTIME_MANIFEST",
            "The runtime manifest schema or channel is invalid.",
        ));
    }
    if manifest.components.is_empty() {
        return Err(runtime_error(
            "INVALID_RUNTIME_MANIFEST",
            "An installable runtime manifest must contain components.",
        ));
    }
    let mut identities = BTreeSet::new();
    let mut paths = BTreeSet::new();
    for component in &manifest.components {
        let identity = (component.id.clone(), component.target.clone());
        if component.id.trim().is_empty()
            || component.target.trim().is_empty()
            || !identities.insert(identity)
            || !valid_component_version(component)
            || component.sha256.len() != 64
            || !component
                .sha256
                .chars()
                .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase())
            || component.size_bytes == 0
            || component.size_bytes > MAX_COMPONENT_BYTES
            || !(component.url.starts_with("https://") || component.url.starts_with("file://"))
        {
            return Err(runtime_error(
                "INVALID_RUNTIME_MANIFEST",
                "A runtime component failed structural validation.",
            ));
        }
        let path = safe_relative_path(&component.relative_path)?;
        if !paths.insert(path) {
            return Err(runtime_error(
                "INVALID_RUNTIME_MANIFEST",
                "Runtime components cannot share an installed path.",
            ));
        }
    }
    let selected = selected_components(manifest)?;
    for required in REQUIRED_COMPONENTS {
        if !selected.iter().any(|component| component.id == required) {
            return Err(runtime_error(
                "INCOMPLETE_RUNTIME_MANIFEST",
                format!("The runtime manifest is missing required component {required}."),
            ));
        }
    }
    Ok(())
}

fn valid_component_version(component: &RuntimeComponent) -> bool {
    if Version::parse(&component.version).is_ok() {
        return true;
    }
    // Chromium reports a four-part build version (for example
    // 151.0.7922.34), while the other managed components use SemVer. Preserve
    // the exact browser-reported pin instead of weakening it to a three-part
    // approximation that the renderer could not verify.
    component.id == CHROMIUM
        && component.version.split('.').count() == 4
        && component
            .version
            .split('.')
            .all(|part| !part.is_empty() && part.chars().all(|value| value.is_ascii_digit()))
}

fn selected_components(manifest: &RuntimeManifest) -> Result<Vec<&RuntimeComponent>, CommandError> {
    let target = current_target();
    let selected: Vec<_> = manifest
        .components
        .iter()
        .filter(|component| component.target == target || component.target == "any")
        .collect();
    let mut ids = BTreeSet::new();
    if selected.iter().any(|component| !ids.insert(&component.id)) {
        return Err(runtime_error(
            "INVALID_RUNTIME_MANIFEST",
            "The runtime manifest selects duplicate component identifiers for this platform.",
        ));
    }
    Ok(selected)
}

fn current_target() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

fn safe_relative_path(value: &str) -> Result<PathBuf, CommandError> {
    if value.is_empty() || value.contains('\\') || value.contains('\0') {
        return Err(runtime_error(
            "INVALID_RUNTIME_PATH",
            "A runtime component path is unsafe.",
        ));
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(runtime_error(
            "INVALID_RUNTIME_PATH",
            "A runtime component path must be a normalized relative path.",
        ));
    }
    Ok(path.to_path_buf())
}

fn manifest_signing_payload(manifest: &RuntimeManifest) -> Result<Vec<u8>, CommandError> {
    let mut value = serde_json::to_value(manifest).map_err(|_| {
        runtime_error(
            "INVALID_RUNTIME_MANIFEST",
            "The runtime manifest could not be canonicalized.",
        )
    })?;
    let object = value.as_object_mut().ok_or_else(|| {
        runtime_error(
            "INVALID_RUNTIME_MANIFEST",
            "The runtime manifest must be a JSON object.",
        )
    })?;
    object.remove("signature");
    serde_jcs::to_vec(&value).map_err(|_| {
        runtime_error(
            "INVALID_RUNTIME_MANIFEST",
            "The runtime manifest could not be canonicalized.",
        )
    })
}

fn manifest_id(manifest: &RuntimeManifest) -> Result<String, CommandError> {
    let bytes = serde_jcs::to_vec(manifest).map_err(|_| {
        runtime_error(
            "INVALID_RUNTIME_MANIFEST",
            "The signed runtime manifest could not be identified.",
        )
    })?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn verify_component_file(path: &Path, component: &RuntimeComponent) -> Result<(), CommandError> {
    let metadata = path
        .symlink_metadata()
        .map_err(|_| runtime_io("inspect runtime component"))?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() != component.size_bytes
    {
        return Err(runtime_error(
            "RUNTIME_COMPONENT_SIZE_MISMATCH",
            format!("Runtime component {} has the wrong size.", component.id),
        ));
    }
    let actual = sha256_file(path)?;
    if actual != component.sha256 {
        return Err(runtime_error(
            "RUNTIME_COMPONENT_HASH_MISMATCH",
            format!(
                "Runtime component {} failed SHA-256 verification.",
                component.id
            ),
        ));
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, CommandError> {
    let mut file = File::open(path).map_err(|_| runtime_io("open runtime component"))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| runtime_io("read runtime component"))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn verify_pack_at(
    root: &Path,
    expected_pack_id: &str,
    verifier: &dyn RuntimeManifestVerifier,
) -> Result<InstalledRuntimePack, CommandError> {
    if root
        .symlink_metadata()
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(true)
    {
        return Err(runtime_error(
            "INVALID_RUNTIME_PACK",
            "The runtime pack directory is missing or unsafe.",
        ));
    }
    let manifest_path = root.join(MANIFEST_FILE);
    let metadata = manifest_path.symlink_metadata().map_err(|_| {
        runtime_error(
            "INCOMPLETE_RUNTIME_PACK",
            "The runtime pack manifest is missing.",
        )
    })?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > MAX_MANIFEST_BYTES
    {
        return Err(runtime_error(
            "INVALID_RUNTIME_PACK",
            "The installed runtime manifest is not a bounded regular file.",
        ));
    }
    let manifest: RuntimeManifest = serde_json::from_reader(
        File::open(&manifest_path).map_err(|_| runtime_io("open installed runtime manifest"))?,
    )
    .map_err(|_| {
        runtime_error(
            "INVALID_RUNTIME_MANIFEST",
            "The installed runtime manifest is invalid.",
        )
    })?;
    verifier.verify(&manifest)?;
    if manifest_id(&manifest)? != expected_pack_id {
        return Err(runtime_error(
            "RUNTIME_PACK_ID_MISMATCH",
            "The installed runtime pack identifier does not match its manifest.",
        ));
    }
    let mut components = BTreeMap::new();
    for component in selected_components(&manifest)? {
        let path = root.join(safe_relative_path(&component.relative_path)?);
        verify_component_file(&path, component)?;
        components.insert(component.id.clone(), component.clone());
    }
    if REQUIRED_COMPONENTS
        .iter()
        .any(|required| !components.contains_key(*required))
    {
        return Err(runtime_error(
            "INCOMPLETE_RUNTIME_PACK",
            "The installed runtime pack is incomplete for this platform.",
        ));
    }
    Ok(InstalledRuntimePack {
        pack_id: expected_pack_id.to_owned(),
        root: root.to_path_buf(),
        manifest_path,
        manifest,
        components,
    })
}

fn activation_records(runtime_root: &Path) -> Result<Vec<ActivationRecord>, CommandError> {
    let directory = runtime_root.join("activations");
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(runtime_io("read runtime activations")),
    };
    let mut records = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let metadata = match path.symlink_metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 64 * 1024 {
            continue;
        }
        let record: ActivationRecord = match File::open(path)
            .ok()
            .and_then(|file| serde_json::from_reader(file).ok())
        {
            Some(record) => record,
            None => continue,
        };
        if record.schema_version == 1
            && record.pack_id.len() == 64
            && record
                .pack_id
                .chars()
                .all(|character| character.is_ascii_hexdigit())
        {
            records.push(record);
        }
    }
    records.sort_by_key(|record| (record.activated_at, record.activation_id));
    Ok(records)
}

fn resolve_latest_valid_pack(
    runtime_root: &Path,
    verifier: &dyn RuntimeManifestVerifier,
) -> Result<Option<InstalledRuntimePack>, CommandError> {
    for record in activation_records(runtime_root)?.into_iter().rev() {
        let root = runtime_root.join("packs").join(&record.pack_id);
        if let Ok(pack) = verify_pack_at(&root, &record.pack_id, verifier) {
            return Ok(Some(pack));
        }
    }
    Ok(None)
}

#[allow(dead_code)] // Called by install/rollback, which intentionally have no UI binding yet.
fn write_activation(
    runtime_root: &Path,
    pack_id: &str,
    previous_pack_id: Option<String>,
) -> Result<(), CommandError> {
    let directory = runtime_root.join("activations");
    fs::create_dir_all(&directory)
        .map_err(|_| runtime_io("create runtime activation directory"))?;
    let activation_id = Uuid::now_v7();
    let record = ActivationRecord {
        schema_version: 1,
        activation_id,
        activated_at: Utc::now(),
        pack_id: pack_id.to_owned(),
        previous_pack_id,
    };
    let temporary = directory.join(format!("{activation_id}.json.part"));
    let destination = directory.join(format!("{activation_id}.json"));
    let bytes = serde_json::to_vec(&record).map_err(|_| {
        runtime_error(
            "INVALID_RUNTIME_ACTIVATION",
            "Runtime activation could not be encoded.",
        )
    })?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| runtime_io("create runtime activation"))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| runtime_io("write runtime activation"))?;
    drop(file);
    fs::rename(temporary, destination).map_err(|_| runtime_io("commit runtime activation"))
}

fn runtime_error(code: &'static str, message: impl Into<String>) -> CommandError {
    CommandError::new(code, message, false)
}

fn runtime_io(operation: &str) -> CommandError {
    CommandError::new(
        "RUNTIME_IO_FAILED",
        format!("The local {operation} operation failed."),
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::RuntimeSignature;
    use ed25519_dalek::{Signer as _, SigningKey};
    use std::sync::Mutex;
    use tempfile::TempDir;

    #[derive(Default)]
    struct MemoryFetcher {
        files: BTreeMap<String, Vec<u8>>,
        fetched: Mutex<Vec<String>>,
    }

    impl RuntimeArtifactFetcher for MemoryFetcher {
        fn fetch(
            &self,
            component: &RuntimeComponent,
            destination: &mut dyn Write,
        ) -> Result<(), CommandError> {
            self.fetched.lock().unwrap().push(component.id.clone());
            destination
                .write_all(self.files.get(&component.id).ok_or_else(|| {
                    runtime_error("TEST_FIXTURE_MISSING", "Missing test component.")
                })?)
                .map_err(|_| runtime_io("write test runtime component"))
        }
    }

    fn fixture() -> (SigningKey, RuntimeManifest, MemoryFetcher) {
        let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
        let target = current_target();
        let mut fetcher = MemoryFetcher::default();
        let mut components: Vec<_> = REQUIRED_COMPONENTS
            .iter()
            .map(|id| {
                let bytes = format!("fixture-{id}").into_bytes();
                fetcher.files.insert((*id).to_owned(), bytes.clone());
                RuntimeComponent {
                    id: (*id).to_owned(),
                    version: "2.0.0-rc.0".into(),
                    target: target.clone(),
                    relative_path: format!("bin/{id}"),
                    url: format!("https://runtime.invalid/{id}"),
                    sha256: format!("{:x}", Sha256::digest(&bytes)),
                    size_bytes: bytes.len() as u64,
                    license: "MIT".into(),
                    optional: false,
                }
            })
            .collect();
        let starter_catalog =
            br#"{"schemaVersion":1,"catalogId":"alystria.starter-audio.v1","assets":[]}"#.to_vec();
        fetcher
            .files
            .insert(STARTER_AUDIO_CATALOG.into(), starter_catalog.clone());
        components.push(RuntimeComponent {
            id: STARTER_AUDIO_CATALOG.into(),
            version: "2.0.0-rc.0".into(),
            target: "any".into(),
            relative_path: format!("{STARTER_AUDIO_RELATIVE_ROOT}/catalog.json"),
            url: format!("https://runtime.invalid/{STARTER_AUDIO_CATALOG}"),
            sha256: format!("{:x}", Sha256::digest(&starter_catalog)),
            size_bytes: starter_catalog.len() as u64,
            license: "MIT".into(),
            optional: false,
        });
        let visual_catalog =
            br#"{"schemaVersion":1,"id":"alystria.starter-kit.core","assets":[]}"#.to_vec();
        fetcher
            .files
            .insert(STARTER_VISUAL_CATALOG.into(), visual_catalog.clone());
        components.push(RuntimeComponent {
            id: STARTER_VISUAL_CATALOG.into(),
            version: "2.0.0-rc.0".into(),
            target: "any".into(),
            relative_path: STARTER_VISUAL_CATALOG_RELATIVE_PATH.into(),
            url: format!("https://runtime.invalid/{STARTER_VISUAL_CATALOG}"),
            sha256: format!("{:x}", Sha256::digest(&visual_catalog)),
            size_bytes: visual_catalog.len() as u64,
            license: "MIT".into(),
            optional: false,
        });
        let manifest = RuntimeManifest {
            schema_version: 1,
            channel: "stable".into(),
            generated_at: Utc::now(),
            components,
            signature: None,
            note: None,
        };
        (signing_key, manifest, fetcher)
    }

    fn portable_debug_fixture(root: &Path) -> RuntimeManifest {
        let records = [
            (PIPELINE_WORKER, "2.0.0-rc.0", "alystria-pipeline.exe"),
            (NODE, "24.20.0", "node/node.exe"),
            (RENDERER_CLI, "2.0.0-rc.0", "renderer/dist/src/cli.js"),
            (CHROMIUM, "151.0.7922.34", "chromium/chrome.exe"),
            (FFMPEG, "9.0.1", "ffmpeg/ffmpeg.exe"),
            (FFPROBE, "9.0.1", "ffmpeg/ffprobe.exe"),
        ];
        let components = records
            .into_iter()
            .map(|(id, version, relative_path)| {
                let bytes = format!("portable-{id}").into_bytes();
                let path = root.join(relative_path);
                fs::create_dir_all(path.parent().unwrap()).unwrap();
                fs::write(&path, &bytes).unwrap();
                RuntimeComponent {
                    id: id.into(),
                    version: version.into(),
                    target: current_target(),
                    relative_path: relative_path.into(),
                    url: format!("file:///portable-debug/{relative_path}"),
                    sha256: format!("{:x}", Sha256::digest(&bytes)),
                    size_bytes: bytes.len() as u64,
                    license: "test-only".into(),
                    optional: false,
                }
            })
            .collect();
        RuntimeManifest {
            schema_version: 1,
            channel: "portable-debug".into(),
            generated_at: Utc::now(),
            components,
            signature: None,
            note: Some("test-only portable debug pack".into()),
        }
    }

    #[test]
    fn portable_debug_pack_is_hash_pinned_and_emits_complete_worker_environment() {
        let temporary = TempDir::new().unwrap();
        let manifest = portable_debug_fixture(temporary.path());
        fs::write(
            temporary.path().join(MANIFEST_FILE),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();

        let pack = load_portable_debug_pack(temporary.path()).unwrap();
        let config = pack
            .worker_launch_config(temporary.path().join("work"))
            .unwrap();
        assert_eq!(
            config.executable,
            temporary
                .path()
                .canonicalize()
                .unwrap()
                .join("alystria-pipeline.exe")
        );
        assert!(config.expected_sha256.is_some());
        for variable in [
            "ALYSTRIA_RUNTIME_PACK_ROOT",
            "ALYSTRIA_RUNTIME_MANIFEST_PATH",
            "ALYSTRIA_RENDERER_MODE",
            "ALYSTRIA_NODE_PATH",
            "ALYSTRIA_RENDERER_CLI_PATH",
            "ALYSTRIA_CHROMIUM_PATH",
            "ALYSTRIA_FFMPEG_PATH",
            "ALYSTRIA_FFPROBE_PATH",
        ] {
            assert!(
                config
                    .environment
                    .contains_key(std::ffi::OsStr::new(variable))
            );
        }
        assert_eq!(
            config
                .environment
                .get(std::ffi::OsStr::new("ALYSTRIA_RENDERER_MODE")),
            Some(&std::ffi::OsString::from("production"))
        );
    }

    #[test]
    fn portable_debug_pack_rejects_a_replaced_dependency() {
        let temporary = TempDir::new().unwrap();
        let manifest = portable_debug_fixture(temporary.path());
        fs::write(
            temporary.path().join(MANIFEST_FILE),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        fs::write(
            temporary.path().join("renderer/dist/src/cli.js"),
            b"replaced renderer",
        )
        .unwrap();

        let error = load_portable_debug_pack(temporary.path()).unwrap_err();
        assert_eq!(error.code, "RUNTIME_COMPONENT_SIZE_MISMATCH");
    }

    fn verifier(signing_key: &SigningKey) -> Arc<dyn RuntimeManifestVerifier> {
        let encoded = base64::engine::general_purpose::STANDARD
            .encode(signing_key.verifying_key().as_bytes());
        Arc::new(Ed25519ManifestVerifier::from_base64_keys([("test", encoded.as_str())]).unwrap())
    }

    fn sign(signing_key: &SigningKey, manifest: &mut RuntimeManifest) {
        let signature = signing_key.sign(&manifest_signing_payload(manifest).unwrap());
        manifest.signature = Some(RuntimeSignature {
            algorithm: "Ed25519".into(),
            key_id: "test".into(),
            value: base64::engine::general_purpose::STANDARD.encode(signature.to_bytes()),
        });
    }

    #[test]
    fn development_manifest_is_empty_and_installation_disabled() {
        let manager = RuntimeManager::load().unwrap();
        assert!(manager.manifest().components.is_empty());
        assert!(!manager.updater_status().enabled);
        assert!(manager.active_pack().is_none());
    }

    #[test]
    fn rejects_bad_signature_before_fetching() {
        let temp = TempDir::new().unwrap();
        let (signing_key, mut manifest, fetcher) = fixture();
        sign(&signing_key, &mut manifest);
        manifest.components[0].version = "2.0.1".into();
        let manager =
            RuntimeManager::load_with_verifier(temp.path().to_path_buf(), verifier(&signing_key))
                .unwrap();
        let error = manager
            .install_with_fetcher(&serde_json::to_vec(&manifest).unwrap(), &fetcher)
            .unwrap_err();
        assert_eq!(error.code, "INVALID_RUNTIME_SIGNATURE");
        assert!(fetcher.fetched.lock().unwrap().is_empty());
    }

    #[test]
    fn rejects_bad_component_hash_without_activation() {
        let temp = TempDir::new().unwrap();
        let (signing_key, mut manifest, mut fetcher) = fixture();
        sign(&signing_key, &mut manifest);
        let worker_size = fetcher.files[PIPELINE_WORKER].len();
        fetcher
            .files
            .insert(PIPELINE_WORKER.into(), vec![b'x'; worker_size]);
        let manager =
            RuntimeManager::load_with_verifier(temp.path().to_path_buf(), verifier(&signing_key))
                .unwrap();
        let error = manager
            .install_with_fetcher(&serde_json::to_vec(&manifest).unwrap(), &fetcher)
            .unwrap_err();
        assert!(matches!(
            error.code,
            "RUNTIME_COMPONENT_HASH_MISMATCH" | "RUNTIME_COMPONENT_SIZE_MISMATCH"
        ));
        assert!(manager.active_pack().is_none());
        assert!(activation_records(temp.path()).unwrap().is_empty());
    }

    #[test]
    fn installs_complete_pack_and_builds_pinned_worker_environment() {
        let temp = TempDir::new().unwrap();
        let (signing_key, mut manifest, fetcher) = fixture();
        sign(&signing_key, &mut manifest);
        let manager =
            RuntimeManager::load_with_verifier(temp.path().to_path_buf(), verifier(&signing_key))
                .unwrap();
        let pack = manager
            .install_with_fetcher(&serde_json::to_vec(&manifest).unwrap(), &fetcher)
            .unwrap();
        let launch = pack.worker_launch_config(temp.path().join("work")).unwrap();
        assert_eq!(
            launch.expected_sha256,
            Some(manifest.components[0].sha256.clone())
        );
        for variable in [
            "ALYSTRIA_RUNTIME_PACK_ROOT",
            "ALYSTRIA_RUNTIME_MANIFEST_PATH",
            "ALYSTRIA_RENDERER_MODE",
            "ALYSTRIA_NODE_PATH",
            "ALYSTRIA_RENDERER_CLI_PATH",
            "ALYSTRIA_CHROMIUM_PATH",
            "ALYSTRIA_FFMPEG_PATH",
            "ALYSTRIA_FFPROBE_PATH",
            "ALYSTRIA_STARTER_AUDIO_ROOT",
            "ALYSTRIA_STARTER_VISUAL_ROOT",
        ] {
            assert!(
                launch
                    .environment
                    .contains_key(std::ffi::OsStr::new(variable))
            );
        }
        assert_eq!(
            launch
                .environment
                .get(std::ffi::OsStr::new("ALYSTRIA_STARTER_AUDIO_ROOT"))
                .map(PathBuf::from),
            Some(
                temp.path()
                    .join("packs")
                    .join(&pack.pack_id)
                    .join(STARTER_AUDIO_RELATIVE_ROOT)
            )
        );
        assert_eq!(
            launch
                .environment
                .get(std::ffi::OsStr::new("ALYSTRIA_STARTER_VISUAL_ROOT"))
                .map(PathBuf::from),
            Some(
                temp.path()
                    .join("packs")
                    .join(&pack.pack_id)
                    .join(STARTER_VISUAL_RELATIVE_ROOT)
            )
        );
    }

    #[test]
    fn reload_falls_back_when_newest_pack_is_partial() {
        let temp = TempDir::new().unwrap();
        let (signing_key, mut first, first_fetcher) = fixture();
        sign(&signing_key, &mut first);
        let shared_verifier = verifier(&signing_key);
        let manager =
            RuntimeManager::load_with_verifier(temp.path().to_path_buf(), shared_verifier.clone())
                .unwrap();
        let installed = manager
            .install_with_fetcher(&serde_json::to_vec(&first).unwrap(), &first_fetcher)
            .unwrap();

        let bogus_id = "f".repeat(64);
        let bogus_root = temp.path().join("packs").join(&bogus_id);
        fs::create_dir_all(&bogus_root).unwrap();
        write_activation(temp.path(), &bogus_id, Some(installed.pack_id.clone())).unwrap();

        let reloaded =
            RuntimeManager::load_with_verifier(temp.path().to_path_buf(), shared_verifier).unwrap();
        assert_eq!(reloaded.active_pack().unwrap().pack_id, installed.pack_id);
    }

    #[test]
    fn rollback_creates_a_new_activation_to_previous_complete_pack() {
        let temp = TempDir::new().unwrap();
        let (signing_key, mut first, first_fetcher) = fixture();
        sign(&signing_key, &mut first);
        let manager =
            RuntimeManager::load_with_verifier(temp.path().to_path_buf(), verifier(&signing_key))
                .unwrap();
        let first_pack = manager
            .install_with_fetcher(&serde_json::to_vec(&first).unwrap(), &first_fetcher)
            .unwrap();
        let (_, mut second, second_fetcher) = fixture();
        second.generated_at = Utc::now() + chrono::Duration::seconds(1);
        sign(&signing_key, &mut second);
        let second_pack = manager
            .install_with_fetcher(&serde_json::to_vec(&second).unwrap(), &second_fetcher)
            .unwrap();
        assert_ne!(first_pack.pack_id, second_pack.pack_id);
        assert_eq!(manager.rollback().unwrap().pack_id, first_pack.pack_id);
    }
}
