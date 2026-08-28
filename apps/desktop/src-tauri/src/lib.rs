mod commands;
mod diagnostics;
mod error;
pub mod generated;
mod project_store;
mod runtime;
mod secrets;
mod sidecar;
mod state;
mod types;
mod validation;

use commands::*;
use state::AppState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let state = AppState::initialize(app.handle()).map_err(|error| {
                std::io::Error::other(format!("{}: {}", error.code, error.message))
            })?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_bootstrap,
            project_create,
            project_open,
            project_save,
            project_snapshot_get,
            project_snapshot_save,
            project_history_get,
            project_history_undo,
            project_history_redo,
            source_import,
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
            runtime_manifest,
            updater_status
        ])
        .run(tauri::generate_context!())
        .expect("Alystria Studio desktop runtime failed");
}
