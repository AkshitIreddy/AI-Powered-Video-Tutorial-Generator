use crate::error::CommandError;
use crate::model_download::ModelDownloadManager;
use crate::model_setup::ModelSetupStore;
use crate::project_store::ProjectStore;
use crate::runtime::RuntimeManager;
use crate::secrets::CredentialManager;
use crate::sidecar::{WorkerLaunchConfig, WorkerSupervisor};
use crate::types::AppPaths;
use directories::ProjectDirs;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
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

impl AppState {
    pub fn initialize(app: &AppHandle) -> Result<Self, CommandError> {
        let fallback = ProjectDirs::from("studio", "alystria", "Alystria Studio")
            .ok_or_else(|| CommandError::unavailable("Platform application directories"))?;
        let system_app_data = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| fallback.data_local_dir().to_path_buf());
        let system_cache = app
            .path()
            .app_cache_dir()
            .unwrap_or_else(|_| fallback.cache_dir().to_path_buf());
        let app_data = debug_app_data_override().unwrap_or_else(|| system_app_data.clone());
        let using_debug_data_root = app_data != system_app_data;
        let cache = if using_debug_data_root {
            app_data.join("cache")
        } else {
            system_cache
        };
        let logs = if using_debug_data_root {
            app_data.join("logs")
        } else {
            app.path()
                .app_log_dir()
                .unwrap_or_else(|_| app_data.join("logs"))
        };
        let paths = AppPaths {
            runtimes: app_data.join("runtimes"),
            models: app_data.join("models"),
            projects: app_data.join("projects"),
            temp: cache.join("temp"),
            app_data,
            cache,
            logs,
        };
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

        let runtimes = RuntimeManager::load_at(paths.runtimes.clone())?;
        let credentials = Arc::new(CredentialManager::os_keyring());
        let worker = if let Some(config) = debug_worker_override(&paths.runtimes) {
            WorkerSupervisor::from_launch_config(config)
        } else if let Some(pack) = runtimes.active_pack() {
            let config = pack
                .worker_launch_config(paths.runtimes.join("work").join("pipeline"))
                .ok_or_else(|| {
                    CommandError::new(
                        "INCOMPLETE_RUNTIME_PACK",
                        "The active runtime pack does not provide every worker dependency.",
                        false,
                    )
                })?;
            WorkerSupervisor::from_launch_config(config)
        } else {
            WorkerSupervisor::new(
                missing_worker_path(&paths.runtimes),
                paths.runtimes.join("work").join("pipeline"),
            )
        }
        .with_credential_manager(credentials.clone());
        Ok(Self {
            projects: ProjectStore,
            credentials,
            model_setup: ModelSetupStore::at(paths.app_data.clone()),
            model_downloads: ModelDownloadManager::at(paths.models.clone())?,
            worker,
            runtimes,
            paths,
        })
    }
}

fn debug_worker_override(runtime_root: &std::path::Path) -> Option<WorkerLaunchConfig> {
    let candidate = std::env::var_os("ALYSTRIA_PIPELINE_WORKER").map(PathBuf::from);
    if cfg!(debug_assertions)
        && let Some(candidate) = candidate
        && candidate.is_file()
    {
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
        return Some(WorkerLaunchConfig {
            executable: candidate,
            working_directory: runtime_root.join("work").join("pipeline-debug"),
            expected_sha256: None,
            environment,
        });
    }
    None
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

/// A test-only data root lets the portable debug handoff leave production
/// projects, caches, and runtime records untouched.  Release binaries ignore
/// the variable so packaging cannot be redirected by an inherited shell.
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
