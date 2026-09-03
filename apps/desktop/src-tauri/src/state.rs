use crate::error::CommandError;
use crate::model_download::ModelDownloadManager;
use crate::model_setup::ModelSetupStore;
use crate::project_store::ProjectStore;
use crate::runtime::{RuntimeManager, load_portable_debug_pack};
use crate::secrets::CredentialManager;
use crate::sidecar::{WorkerLaunchConfig, WorkerSupervisor};
use crate::types::AppPaths;
use directories::ProjectDirs;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

#[derive(Debug)]
pub struct AppState {
    pub paths: AppPaths,
    pub projects: ProjectStore,
    pub credentials: Arc<CredentialManager>,
    pub model_setup: ModelSetupStore,
    pub model_downloads: ModelDownloadManager,
    pub worker: WorkerSupervisor,
    pub runtimes: RuntimeManager,
}

#[derive(Debug, Clone)]
struct PortableLayout {
    root: PathBuf,
    app_data: PathBuf,
    runtimes: PathBuf,
    models: PathBuf,
    projects: PathBuf,
    exports: PathBuf,
    logs: PathBuf,
    cache: PathBuf,
    temp: PathBuf,
}

impl PortableLayout {
    fn from_root(candidate: &Path) -> Result<Self, CommandError> {
        if !candidate.is_absolute() {
            return Err(CommandError::new(
                "INVALID_PORTABLE_ROOT",
                "The portable root must be an absolute path.",
                false,
            ));
        }
        reject_reparse_path(candidate)?;
        let root = candidate
            .canonicalize()
            .map_err(|_| CommandError::io("portable root validation"))?;
        let layout = Self {
            app_data: root.join("App Data"),
            runtimes: root.join("Runtime"),
            models: root.join("Models"),
            projects: root.join("Projects"),
            exports: root.join("Exports"),
            logs: root.join("Logs"),
            cache: root.join("Cache"),
            temp: root.join("Temp"),
            root,
        };
        for directory in layout.required_directories() {
            validate_existing_portable_directory(&layout.root, directory)?;
        }
        for directory in ["App", "Test Harness", "Evidence"] {
            validate_existing_portable_directory(&layout.root, &layout.root.join(directory))?;
        }
        Ok(layout)
    }

    fn required_directories(&self) -> [&Path; 8] {
        [
            &self.app_data,
            &self.runtimes,
            &self.models,
            &self.projects,
            &self.exports,
            &self.logs,
            &self.cache,
            &self.temp,
        ]
    }

    fn worker_environment(&self) -> BTreeMap<std::ffi::OsString, std::ffi::OsString> {
        let profile = self.app_data.join("User Profile");
        let values = [
            ("ALYSTRIA_PORTABLE_ROOT", self.root.clone()),
            ("ALYSTRIA_APP_DATA_DIR", self.app_data.clone()),
            ("ALYSTRIA_RUNTIME_DIR", self.runtimes.clone()),
            ("ALYSTRIA_MODELS_DIR", self.models.clone()),
            ("ALYSTRIA_PROJECTS_DIR", self.projects.clone()),
            ("ALYSTRIA_EXPORTS_DIR", self.exports.clone()),
            ("ALYSTRIA_LOGS_DIR", self.logs.clone()),
            ("ALYSTRIA_CACHE_DIR", self.cache.clone()),
            ("ALYSTRIA_TEMP_DIR", self.temp.clone()),
            ("WEBVIEW2_USER_DATA_FOLDER", self.app_data.join("WebView2")),
            ("TEMP", self.temp.clone()),
            ("TMP", self.temp.clone()),
            ("TMPDIR", self.temp.clone()),
            ("APPDATA", self.app_data.join("Roaming")),
            ("LOCALAPPDATA", self.app_data.join("Local")),
            ("USERPROFILE", profile.clone()),
            ("HOME", profile),
            ("XDG_CACHE_HOME", self.cache.join("XDG")),
            ("XDG_CONFIG_HOME", self.app_data.join("XDG/Config")),
            ("XDG_DATA_HOME", self.app_data.join("XDG/Data")),
            ("XDG_STATE_HOME", self.app_data.join("XDG/State")),
            ("HF_HOME", self.cache.join("HuggingFace")),
            ("HUGGINGFACE_HUB_CACHE", self.cache.join("HuggingFace/Hub")),
            (
                "TRANSFORMERS_CACHE",
                self.cache.join("HuggingFace/Transformers"),
            ),
            ("HF_DATASETS_CACHE", self.cache.join("HuggingFace/Datasets")),
            ("TORCH_HOME", self.cache.join("Torch")),
            ("TORCHINDUCTOR_CACHE_DIR", self.cache.join("TorchInductor")),
            ("TRITON_CACHE_DIR", self.cache.join("Triton")),
            ("NUMBA_CACHE_DIR", self.cache.join("Numba")),
            ("CUDA_CACHE_PATH", self.cache.join("CUDA")),
            ("MPLCONFIGDIR", self.cache.join("Matplotlib")),
            ("DOCLING_ARTIFACTS_PATH", self.cache.join("Docling")),
            ("PYTHONPYCACHEPREFIX", self.cache.join("PythonBytecode")),
            ("PIP_CACHE_DIR", self.cache.join("pip")),
            ("UV_CACHE_DIR", self.cache.join("uv")),
            ("NPM_CONFIG_CACHE", self.cache.join("npm")),
        ];
        let mut environment = values
            .into_iter()
            .map(|(key, value)| (key.into(), value.into_os_string()))
            .collect::<BTreeMap<_, _>>();
        environment.insert("PLAYWRIGHT_BROWSERS_PATH".into(), "0".into());
        environment.insert("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD".into(), "1".into());
        environment
    }
}

fn portable_layout_override() -> Result<Option<PortableLayout>, CommandError> {
    let explicit = std::env::var_os("ALYSTRIA_PORTABLE_ROOT")
        .map(PathBuf::from)
        .map(|root| PortableLayout::from_root(&root))
        .transpose()?;
    if explicit.is_some() {
        return Ok(explicit);
    }
    if !cfg!(any(debug_assertions, feature = "portable-debug-runtime")) {
        return Ok(None);
    }
    let executable = std::env::current_exe().map_err(|_| CommandError::io("portable executable discovery"))?;
    portable_root_from_executable(&executable)
        .map(|root| PortableLayout::from_root(&root))
        .transpose()
}

/// Bootstrap the portable process before Tauri creates WebView2 or any worker
/// threads. Packaged test builds discover their sibling manifest themselves, so
/// the executable remains the only launch entry point and no Python/console
/// wrapper is required.
pub(crate) fn prepare_portable_process_environment() -> Result<(), CommandError> {
    let Some(layout) = portable_layout_override()? else {
        return Ok(());
    };
    let mut environment = layout.worker_environment();
    environment.insert(
        "ALYSTRIA_PIPELINE_WORKER".into(),
        layout.runtimes.join("alystria-pipeline.exe").into_os_string(),
    );
    environment.insert(
        "ALYSTRIA_LOCAL_PRESENTER_CONFIG_PATH".into(),
        layout.models.join("presenter-runtime.json").into_os_string(),
    );
    environment.insert(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS".into(),
        "--remote-debugging-port=9333".into(),
    );

    // SAFETY: this runs synchronously at the very beginning of `run`, before
    // Tauri, WebView2, the worker supervisor, or any application thread starts.
    for (key, value) in environment {
        unsafe { std::env::set_var(key, value) };
    }
    Ok(())
}

fn portable_root_from_executable(executable: &Path) -> Option<PathBuf> {
    let app_directory = executable.parent()?;
    if app_directory.file_name()?.to_string_lossy() != "App" {
        return None;
    }
    let root = app_directory.parent()?;
    let manifest_path = root.join("test-area-manifest.json");
    let manifest: serde_json::Value = serde_json::from_slice(&fs::read(manifest_path).ok()?).ok()?;
    if manifest.get("kind")?.as_str()? != "ai-video-tutorial-generator-portable-debug-test-area"
        || manifest.pointer("/desktop/path")?.as_str()? != "App\\AI Video Tutorial Generator.exe"
    {
        return None;
    }
    Some(root.to_path_buf())
}

fn validate_existing_portable_directory(root: &Path, path: &Path) -> Result<(), CommandError> {
    reject_reparse_path(path)?;
    let metadata = path
        .symlink_metadata()
        .map_err(|_| CommandError::io("portable directory validation"))?;
    if !metadata.is_dir() || metadata_is_reparse_point(&metadata) {
        return Err(CommandError::new(
            "INVALID_PORTABLE_ROOT",
            "The portable layout contains a link, junction, or non-directory entry.",
            false,
        ));
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| CommandError::io("portable directory validation"))?;
    if !canonical.starts_with(root) {
        return Err(CommandError::new(
            "INVALID_PORTABLE_ROOT",
            "A portable directory escapes the selected portable root.",
            false,
        ));
    }
    Ok(())
}

fn reject_reparse_path(path: &Path) -> Result<(), CommandError> {
    let mut cursor = Some(path);
    while let Some(candidate) = cursor {
        let metadata = candidate
            .symlink_metadata()
            .map_err(|_| CommandError::io("portable path validation"))?;
        if metadata_is_reparse_point(&metadata) {
            return Err(CommandError::new(
                "INVALID_PORTABLE_ROOT",
                "The portable root may not traverse a link or junction.",
                false,
            ));
        }
        cursor = candidate.parent();
    }
    Ok(())
}

fn metadata_is_reparse_point(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    false
}

impl AppState {
    pub fn initialize(app: &AppHandle) -> Result<Self, CommandError> {
        let portable = portable_layout_override()?;
        // A portable launch intentionally redirects USERPROFILE, APPDATA, and
        // LOCALAPPDATA into an unregistered disposable directory. Windows'
        // known-folder lookup can therefore be unavailable even though the
        // already-validated portable layout is complete. Do not ask the host
        // for fallback application directories in that mode.
        let (system_app_data, system_cache) = if let Some(layout) = &portable {
            (layout.app_data.clone(), layout.cache.clone())
        } else {
            let fallback = ProjectDirs::from("studio", "alystria", "Alystria Studio")
                .ok_or_else(|| CommandError::unavailable("Platform application directories"))?;
            (
                app.path()
                    .app_data_dir()
                    .unwrap_or_else(|_| fallback.data_local_dir().to_path_buf()),
                app.path()
                    .app_cache_dir()
                    .unwrap_or_else(|_| fallback.cache_dir().to_path_buf()),
            )
        };
        let app_data = portable
            .as_ref()
            .map(|layout| layout.app_data.clone())
            .or_else(debug_app_data_override)
            .unwrap_or_else(|| system_app_data.clone());
        let using_data_override = portable.is_some() || app_data != system_app_data;
        let cache = if let Some(layout) = &portable {
            layout.cache.clone()
        } else if using_data_override {
            app_data.join("cache")
        } else {
            system_cache
        };
        let logs = if let Some(layout) = &portable {
            layout.logs.clone()
        } else if using_data_override {
            app_data.join("logs")
        } else {
            app.path()
                .app_log_dir()
                .unwrap_or_else(|_| app_data.join("logs"))
        };
        let paths = AppPaths {
            runtimes: portable
                .as_ref()
                .map(|layout| layout.runtimes.clone())
                .unwrap_or_else(|| app_data.join("runtimes")),
            models: portable
                .as_ref()
                .map(|layout| layout.models.clone())
                .unwrap_or_else(|| app_data.join("models")),
            projects: portable
                .as_ref()
                .map(|layout| layout.projects.clone())
                .unwrap_or_else(|| app_data.join("projects")),
            temp: portable
                .as_ref()
                .map(|layout| layout.temp.clone())
                .unwrap_or_else(|| cache.join("temp")),
            app_data,
            cache,
            logs,
        };
        if portable.is_none() {
            for directory in [
                &paths.app_data,
                &paths.cache,
                &paths.logs,
                &paths.runtimes,
                &paths.models,
                &paths.projects,
                &paths.temp,
            ] {
                fs::create_dir_all(directory)
                    .map_err(|_| CommandError::io("application directory initialization"))?;
            }
        }

        let runtimes = RuntimeManager::load_at(paths.runtimes.clone())?;
        // Provider values deliberately remain in the operating-system
        // Credential Manager. Alystria files contain opaque keyring references
        // only; this is the portable sandbox's documented external exception.
        let credentials = Arc::new(CredentialManager::os_keyring());
        let worker_config =
            if let Some(config) = debug_worker_override(&paths.runtimes, portable.as_ref())? {
                Some(config)
            } else if let Some(pack) = runtimes.active_pack() {
                Some(
                    pack.worker_launch_config(paths.runtimes.join("work").join("pipeline"))
                        .ok_or_else(|| {
                            CommandError::new(
                                "INCOMPLETE_RUNTIME_PACK",
                                "The active runtime pack does not provide every worker dependency.",
                                false,
                            )
                        })?,
                )
            } else {
                None
            };
        let worker = if let Some(mut config) = worker_config {
            if let Some(layout) = &portable {
                config.environment.extend(layout.worker_environment());
            }
            WorkerSupervisor::from_launch_config(config)
        } else {
            WorkerSupervisor::new(
                missing_worker_path(&paths.runtimes),
                paths.runtimes.join("work").join("pipeline"),
            )
        }
        .with_credential_manager(credentials.clone());
        let model_downloads = ModelDownloadManager::at(paths.models.clone())?;
        Ok(Self {
            projects: ProjectStore,
            credentials,
            model_setup: ModelSetupStore::at(paths.app_data.clone()),
            model_downloads,
            worker,
            runtimes,
            paths,
        })
    }
}

fn debug_worker_override(
    runtime_root: &std::path::Path,
    portable: Option<&PortableLayout>,
) -> Result<Option<WorkerLaunchConfig>, CommandError> {
    let candidate = std::env::var_os("ALYSTRIA_PIPELINE_WORKER").map(PathBuf::from);
    let Some(candidate) = candidate else {
        return Ok(None);
    };
    if let Some(layout) = portable {
        validate_portable_worker_path(layout, &candidate)?;
        if !candidate
            .parent()
            .is_some_and(|parent| parent.join("runtime-manifest.json").is_file())
        {
            return Err(CommandError::new(
                "INVALID_RUNTIME_PACK",
                "The portable worker must be verified by its sibling runtime manifest.",
                false,
            ));
        }
        return portable_debug_worker_launch(&candidate, runtime_root).map(Some);
    }
    if cfg!(debug_assertions) && candidate.is_file() {
        if candidate
            .parent()
            .is_some_and(|parent| parent.join("runtime-manifest.json").is_file())
        {
            return portable_debug_worker_launch(&candidate, runtime_root).map(Some);
        }
        let mut environment = BTreeMap::new();
        if let Some(starter_audio_root) = debug_starter_audio_root(&candidate) {
            environment.insert(
                "ALYSTRIA_STARTER_AUDIO_ROOT".into(),
                starter_audio_root.into_os_string(),
            );
        }
        if let Some(starter_visual_root) = debug_starter_visual_root(&candidate) {
            environment.insert(
                "ALYSTRIA_STARTER_VISUAL_ROOT".into(),
                starter_visual_root.into_os_string(),
            );
        }
        return Ok(Some(WorkerLaunchConfig {
            executable: candidate,
            working_directory: runtime_root.join("work").join("pipeline-debug"),
            expected_sha256: None,
            environment,
        }));
    }
    Ok(None)
}

fn validate_portable_worker_path(
    layout: &PortableLayout,
    candidate: &Path,
) -> Result<(), CommandError> {
    if !candidate.is_absolute() || !candidate.is_file() {
        return Err(CommandError::new(
            "INVALID_PORTABLE_WORKER",
            "The portable worker must be an existing absolute regular file.",
            false,
        ));
    }
    reject_reparse_path(candidate)?;
    let canonical = candidate
        .canonicalize()
        .map_err(|_| CommandError::io("portable worker validation"))?;
    if !canonical.starts_with(&layout.runtimes) {
        return Err(CommandError::new(
            "INVALID_PORTABLE_WORKER",
            "The portable worker must be contained by the portable Runtime directory.",
            false,
        ));
    }
    Ok(())
}

fn portable_debug_worker_launch(
    candidate: &std::path::Path,
    runtime_root: &std::path::Path,
) -> Result<WorkerLaunchConfig, CommandError> {
    let pack_root = candidate.parent().ok_or_else(|| {
        CommandError::new(
            "INVALID_RUNTIME_PACK",
            "The portable debug worker has no runtime directory.",
            false,
        )
    })?;
    let pack = load_portable_debug_pack(pack_root)?;
    let expected_worker = pack.component_path("pipeline-worker").ok_or_else(|| {
        CommandError::new(
            "INCOMPLETE_RUNTIME_PACK",
            "The portable debug manifest has no pipeline worker.",
            false,
        )
    })?;
    let actual_worker = candidate
        .canonicalize()
        .map_err(|_| CommandError::io("portable debug worker validation"))?;
    if actual_worker != expected_worker {
        return Err(CommandError::new(
            "INVALID_RUNTIME_PACK",
            "The selected debug worker does not match the portable runtime manifest.",
            false,
        ));
    }
    pack.worker_launch_config(runtime_root.join("work").join("pipeline-debug"))
        .ok_or_else(|| {
            CommandError::new(
                "INCOMPLETE_RUNTIME_PACK",
                "The portable debug runtime does not provide every renderer component.",
                false,
            )
        })
}

/// Development and portable-debug workers may use only an Alystria-owned
/// starter-audio directory. Packaged sidecars place it beside the executable;
/// source development falls back to the repository asset root compiled into
/// this debug binary. No project request or inherited environment variable can
/// redirect this trust boundary.
fn debug_starter_audio_root(worker: &std::path::Path) -> Option<PathBuf> {
    let sibling = worker
        .parent()?
        .join("assets")
        .join("starter")
        .join("audio");
    if starter_audio_catalog_is_regular(&sibling) {
        return sibling.canonicalize().ok();
    }
    let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .join("assets")
        .join("starter")
        .join("audio");
    starter_audio_catalog_is_regular(&source_root)
        .then(|| source_root.canonicalize().ok())
        .flatten()
}

fn starter_audio_catalog_is_regular(root: &std::path::Path) -> bool {
    let Ok(root_metadata) = root.symlink_metadata() else {
        return false;
    };
    if !root_metadata.is_dir() || root_metadata.file_type().is_symlink() {
        return false;
    }
    let Ok(catalog_metadata) = root.join("catalog.json").symlink_metadata() else {
        return false;
    };
    catalog_metadata.is_file()
        && !catalog_metadata.file_type().is_symlink()
        && catalog_metadata.len() > 0
        && catalog_metadata.len() <= 2 * 1024 * 1024
}

fn debug_starter_visual_root(worker: &std::path::Path) -> Option<PathBuf> {
    let sibling = worker
        .parent()?
        .join("assets")
        .join("starter")
        .join("visuals");
    if starter_visual_catalog_is_regular(&sibling) {
        return sibling.canonicalize().ok();
    }
    let source_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..");
    starter_visual_catalog_is_regular(&source_root)
        .then(|| source_root.canonicalize().ok())
        .flatten()
}

fn starter_visual_catalog_is_regular(root: &std::path::Path) -> bool {
    let Ok(root_metadata) = root.symlink_metadata() else {
        return false;
    };
    if !root_metadata.is_dir() || root_metadata.file_type().is_symlink() {
        return false;
    }
    let catalog = root
        .join("packages")
        .join("themes")
        .join("starter-kits")
        .join("core.v1.json");
    let Ok(catalog_metadata) = catalog.symlink_metadata() else {
        return false;
    };
    catalog_metadata.is_file()
        && !catalog_metadata.file_type().is_symlink()
        && catalog_metadata.len() > 0
        && catalog_metadata.len() <= 8 * 1024 * 1024
}

/// Legacy debug-only compatibility override. Portable builds use the
/// canonical `ALYSTRIA_PORTABLE_ROOT` layout above in both debug and release.
/// Release binaries continue to ignore this independently redirectable path.
fn debug_app_data_override() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let candidate = std::env::var_os("ALYSTRIA_APP_DATA_DIR").map(PathBuf::from)?;
    candidate.is_absolute().then_some(candidate)
}

fn missing_worker_path(runtime_root: &std::path::Path) -> PathBuf {
    let executable = if cfg!(windows) {
        "alystria-pipeline.exe"
    } else {
        "alystria-pipeline"
    };
    runtime_root.join("unavailable").join(executable)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_portable_layout(root: &Path) {
        for directory in [
            "App",
            "Runtime",
            "Models",
            "App Data",
            "Projects",
            "Exports",
            "Logs",
            "Cache",
            "Temp",
            "Test Harness",
            "Evidence",
        ] {
            fs::create_dir_all(root.join(directory)).unwrap();
        }
    }

    #[test]
    fn packaged_test_executable_discovers_its_portable_root_without_a_launcher() {
        let temporary = TempDir::new().unwrap();
        create_portable_layout(temporary.path());
        let executable = temporary.path().join("App/AI Video Tutorial Generator.exe");
        fs::write(&executable, b"test executable").unwrap();
        fs::write(
            temporary.path().join("test-area-manifest.json"),
            serde_json::to_vec(&serde_json::json!({
                "kind": "ai-video-tutorial-generator-portable-debug-test-area",
                "desktop": { "path": "App\\AI Video Tutorial Generator.exe" }
            })).unwrap(),
        ).unwrap();

        assert_eq!(portable_root_from_executable(&executable), Some(temporary.path().to_path_buf()));
    }

    #[test]
    fn portable_layout_uses_only_fixed_contained_directories() {
        let temporary = TempDir::new().unwrap();
        create_portable_layout(temporary.path());

        let layout = PortableLayout::from_root(temporary.path()).unwrap();
        assert_eq!(layout.app_data, layout.root.join("App Data"));
        assert_eq!(layout.runtimes, layout.root.join("Runtime"));
        assert_eq!(layout.models, layout.root.join("Models"));
        assert_eq!(layout.projects, layout.root.join("Projects"));
        assert_eq!(layout.exports, layout.root.join("Exports"));
        assert_eq!(layout.logs, layout.root.join("Logs"));
        assert_eq!(layout.cache, layout.root.join("Cache"));
        assert_eq!(layout.temp, layout.root.join("Temp"));

        for (key, value) in layout.worker_environment() {
            if key == "PLAYWRIGHT_BROWSERS_PATH" || key == "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD" {
                continue;
            }
            assert!(
                PathBuf::from(value).starts_with(&layout.root),
                "{key:?} escaped the portable root"
            );
        }
    }

    #[test]
    fn portable_layout_requires_every_owned_directory_before_app_writes() {
        let temporary = TempDir::new().unwrap();
        create_portable_layout(temporary.path());
        fs::remove_dir(temporary.path().join("Temp")).unwrap();

        let error = PortableLayout::from_root(temporary.path()).unwrap_err();
        assert_eq!(error.code, "LOCAL_IO_FAILED");
    }

    #[test]
    fn portable_worker_must_be_inside_the_fixed_runtime_directory() {
        let temporary = TempDir::new().unwrap();
        create_portable_layout(temporary.path());
        let layout = PortableLayout::from_root(temporary.path()).unwrap();
        let contained = layout.runtimes.join("alystria-pipeline.exe");
        fs::write(&contained, b"worker").unwrap();
        validate_portable_worker_path(&layout, &contained).unwrap();

        let external = temporary.path().join("external-worker.exe");
        fs::write(&external, b"worker").unwrap();
        let error = validate_portable_worker_path(&layout, &external).unwrap_err();
        assert_eq!(error.code, "INVALID_PORTABLE_WORKER");
    }

    #[cfg(unix)]
    #[test]
    fn portable_layout_rejects_symlinked_owned_directories() {
        let temporary = TempDir::new().unwrap();
        create_portable_layout(temporary.path());
        let external = temporary.path().join("outside");
        fs::create_dir_all(&external).unwrap();
        fs::remove_dir(temporary.path().join("Cache")).unwrap();
        std::os::unix::fs::symlink(&external, temporary.path().join("Cache")).unwrap();

        let error = PortableLayout::from_root(temporary.path()).unwrap_err();
        assert_eq!(error.code, "INVALID_PORTABLE_ROOT");
    }

    #[test]
    fn debug_asset_roots_are_derived_from_the_worker_sibling() {
        let temporary = TempDir::new().unwrap();
        let worker = temporary.path().join("alystria-pipeline.exe");
        fs::write(&worker, b"test worker").unwrap();

        let audio = temporary.path().join("assets/starter/audio");
        fs::create_dir_all(&audio).unwrap();
        fs::write(audio.join("catalog.json"), b"{}").unwrap();

        let visuals = temporary
            .path()
            .join("assets/starter/visuals/packages/themes/starter-kits");
        fs::create_dir_all(&visuals).unwrap();
        fs::write(visuals.join("core.v1.json"), b"{}").unwrap();

        assert_eq!(
            debug_starter_audio_root(&worker),
            Some(audio.canonicalize().unwrap())
        );
        assert_eq!(
            debug_starter_visual_root(&worker),
            Some(
                temporary
                    .path()
                    .join("assets/starter/visuals")
                    .canonicalize()
                    .unwrap()
            )
        );
    }

    #[cfg(unix)]
    #[test]
    fn debug_asset_roots_reject_symlinked_catalogs() {
        let temporary = TempDir::new().unwrap();
        let worker = temporary.path().join("alystria-pipeline.exe");
        fs::write(&worker, b"test worker").unwrap();
        let external = temporary.path().join("external.json");
        fs::write(&external, b"{}").unwrap();

        let audio = temporary.path().join("assets/starter/audio");
        fs::create_dir_all(&audio).unwrap();
        std::os::unix::fs::symlink(&external, audio.join("catalog.json")).unwrap();

        // A rejected packaged root falls back to the compile-time repository
        // root in a source build, never to the symlink target.
        assert_ne!(debug_starter_audio_root(&worker), Some(audio));
    }
}
