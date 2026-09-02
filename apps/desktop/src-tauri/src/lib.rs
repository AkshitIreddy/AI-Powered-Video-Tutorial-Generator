mod catalog_discovery;
mod commands;
mod diagnostics;
mod error;
pub mod generated;
mod model_download;
mod model_setup;
mod project_store;
mod runtime;
mod secrets;
mod sidecar;
pub mod starter_kit;
mod state;
mod types;
mod validation;

use commands::*;
use state::AppState;
use std::ffi::OsStr;
use tauri::Manager;

const HEADLESS_ACCEPTANCE_ENVIRONMENT: &str = "ALYSTRIA_HEADLESS_ACCEPTANCE";

fn should_show_main_window(headless_acceptance: Option<&OsStr>) -> bool {
    headless_acceptance != Some(OsStr::new("1"))
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let state = AppState::initialize(app.handle()).map_err(|error| {
                std::io::Error::other(format!("{}: {}", error.code, error.message))
            })?;
            app.manage(state);
            if should_show_main_window(std::env::var_os(HEADLESS_ACCEPTANCE_ENVIRONMENT).as_deref())
            {
                let window = app
                    .get_webview_window("main")
                    .ok_or_else(|| std::io::Error::other("Alystria main window was not created"))?;
                window.show()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_bootstrap,
            project_create,
            project_open,
            project_save,
            project_snapshot_get,
            project_snapshot_save,
            project_customization_save,
            project_history_get,
            project_history_undo,
            project_history_redo,
            source_import,
            project_asset_import,
            presenter_profile_select,
            project_export_archive,
            generation_start,
            generation_approve,
            scene_regenerate,
            scene_render,
            qa_repair,
            master_export,
            job_cancel,
            job_retry,
            job_status,
            worker_status,
            worker_restart,
            diagnostics_run,
            provider_secret_set,
            provider_secret_status,
            provider_secret_delete,
            provider_routing_policy_get,
            provider_routing_policy_save,
            local_model_setup_get,
            local_model_setup_save,
            local_model_download_catalog,
            local_model_download_status,
            local_model_download_start,
            runtime_manifest,
            updater_status,
            catalog_discover
        ])
        .run(tauri::generate_context!())
        .expect("Alystria Studio desktop runtime failed");
}

#[tauri::command]
async fn catalog_discover(
    input: catalog_discovery::CatalogDiscoveryRequest,
    state: tauri::State<'_, AppState>,
) -> Result<catalog_discovery::CatalogDiscoveryResponse, error::CommandError> {
    catalog_discovery::discover(input, state.credentials.clone()).await
}

#[cfg(test)]
mod tests {
    use super::should_show_main_window;
    use std::ffi::OsStr;

    #[test]
    fn main_window_is_visible_without_the_acceptance_override() {
        assert!(should_show_main_window(None));
        assert!(should_show_main_window(Some(OsStr::new("0"))));
    }

    #[test]
    fn headless_acceptance_keeps_the_main_window_hidden() {
        assert!(!should_show_main_window(Some(OsStr::new("1"))));
    }
}
