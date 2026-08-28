use crate::error::CommandError;
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
        return Some(WorkerLaunchConfig {
            executable: candidate,
            working_directory: runtime_root.join("work").join("pipeline-debug"),
            expected_sha256: None,
            environment: BTreeMap::new(),
        });
    }
    None
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
