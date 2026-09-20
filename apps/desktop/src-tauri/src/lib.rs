mod catalog_discovery;
mod commands;
mod diagnostics;
mod editor_document;
mod error;
pub mod generated;
mod model_download;
mod model_setup;
mod presenter_status;
mod process_tree;
mod project_store;
mod runtime;
mod secrets;
mod sidecar;
pub mod starter_kit;
mod state;
mod types;
mod validation;

use commands::*;
use state::{AppState, prepare_portable_process_environment};
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const HEADLESS_ACCEPTANCE_ENVIRONMENT: &str = "ALYSTRIA_HEADLESS_ACCEPTANCE";
const HEADLESS_ACCEPTANCE_CDP_PORT_ENVIRONMENT: &str = "ALYSTRIA_HEADLESS_ACCEPTANCE_CDP_PORT";

fn should_show_main_window(headless_acceptance: Option<&OsStr>) -> bool {
    headless_acceptance != Some(OsStr::new("1"))
}

fn headless_acceptance_requested() -> bool {
    cfg!(any(debug_assertions, feature = "portable-debug-runtime"))
        && !should_show_main_window(std::env::var_os(HEADLESS_ACCEPTANCE_ENVIRONMENT).as_deref())
}

fn headless_webview_arguments(headless: bool, port: Option<&OsStr>) -> Option<String> {
    if !headless {
        return None;
    }
    let port = port?
        .to_string_lossy()
        .parse::<u16>()
        .ok()
        .filter(|port| *port >= 1024)?;
    Some(format!(
        "--remote-debugging-port={port} --remote-allow-origins=http://127.0.0.1:{port}"
    ))
}

fn configure_headless_webview_debugging() {
    let Some(arguments) = headless_webview_arguments(
        headless_acceptance_requested(),
        std::env::var_os(HEADLESS_ACCEPTANCE_CDP_PORT_ENVIRONMENT).as_deref(),
    ) else {
        return;
    };
    // SAFETY: `run` invokes this before Tauri or WebView2 creates threads.
    unsafe { std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", arguments) };
}

fn acceptance_report_path(paths: &types::AppPaths) -> PathBuf {
    paths
        .logs
        .parent()
        .filter(|parent| parent.join("Evidence").is_dir())
        .map(|parent| parent.join("Evidence"))
        .unwrap_or_else(|| paths.logs.clone())
        .join("native-headless-ready.json")
}

fn write_acceptance_report(path: &Path, report: &serde_json::Value) -> std::io::Result<()> {
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    let mut bytes = serde_json::to_vec_pretty(report).map_err(std::io::Error::other)?;
    bytes.push(b'\n');
    fs::write(&temporary, bytes)?;
    fs::rename(temporary, path)
}

fn prepare_headless_acceptance(state: &AppState) -> Result<(), std::io::Error> {
    let path = acceptance_report_path(&state.paths);
    let result = state.worker.start().and_then(|status| {
        state
            .worker
            .call("system.ping", serde_json::Value::Null)
            .map(|_| status)
    });
    match result {
        Ok(types::WorkerStatus::Ready { pid, .. }) => write_acceptance_report(
            &path,
            &serde_json::json!({
                "schemaVersion": 1,
                "state": "ready",
                "desktopPid": std::process::id(),
                "workerPid": pid,
                "workerHandshake": true,
                "portableAppData": state.paths.app_data,
                "portableRuntime": state.paths.runtimes,
                "portableModels": state.paths.models,
                "portableProjects": state.paths.projects,
                "portableCache": state.paths.cache,
                "portableLogs": state.paths.logs,
                "portableTemp": state.paths.temp
            }),
        ),
        Ok(_) => {
            let report = serde_json::json!({
                "schemaVersion": 1,
                "state": "failed",
                "reason": "The worker did not reach the ready state."
            });
            write_acceptance_report(&path, &report)?;
            Err(std::io::Error::other("headless worker readiness failed"))
        }
        Err(error) => {
            let report = serde_json::json!({
                "schemaVersion": 1,
                "state": "failed",
                "reason": format!("{}: {}", error.code, error.message)
            });
            write_acceptance_report(&path, &report)?;
            Err(std::io::Error::other("headless worker handshake failed"))
        }
    }
}

#[tauri::command]
fn desktop_shutdown(app: tauri::AppHandle, state: tauri::State<'_, AppState>) {
    // The webview invokes this only after its pending durable saves finish.
    // Stop every supervised child before ending the process so a normal window
    // close cannot strand an installer or worker, or discard a final checkpoint.
    state.model_downloads.close();
    state.worker.close();
    app.exit(0);
}

pub fn run() {
    prepare_portable_process_environment().unwrap_or_else(|error| {
        panic!("{}: {}", error.code, error.message);
    });
    configure_headless_webview_debugging();
    let app = tauri::Builder::default()
        .setup(|app| {
            let state = AppState::initialize(app.handle()).map_err(|error| {
                std::io::Error::other(format!("{}: {}", error.code, error.message))
            })?;
            app.manage(state);
            let headless_acceptance = headless_acceptance_requested();
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if headless_acceptance {
                    let state = handle.state::<AppState>();
                    if prepare_headless_acceptance(&state).is_err() {
                        handle.exit(1);
                    }
                } else {
                    let _ = handle.state::<AppState>().worker.start();
                }
            });
            if should_show_main_window(std::env::var_os(HEADLESS_ACCEPTANCE_ENVIRONMENT).as_deref())
            {
                let window = app.get_webview_window("main").ok_or_else(|| {
                    std::io::Error::other("AI Video Tutorial Generator main window was not created")
                })?;
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
            project_asset_resolve,
            presenter_profile_select,
            project_export_archive,
            editor_document::editor_document_export,
            generation_start,
            generation_approve,
            scene_regenerate,
            scene_stock_search,
            music_search,
            music_candidate_accept,
            music_candidate_reject,
            scene_candidate_accept,
            scene_edit_candidate_accept,
            scene_edit_candidate_reject,
            scene_render,
            qa_repair,
            master_export,
            editor_timeline_export,
            editor_bindings_get,
            editor_waveform_get,
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
            local_presenter_runtime_status,
            local_model_download_start,
            runtime_manifest,
            updater_status,
            catalog_discover,
            desktop_shutdown
        ])
        .build(tauri::generate_context!())
        .expect("AI Video Tutorial Generator desktop runtime failed");
    app.run(|app_handle, event| {
        if matches!(&event, tauri::RunEvent::ExitRequested { .. }) {
            let state = app_handle.state::<AppState>();
            state.model_downloads.close();
            state.worker.close();
        }
    });
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
    use super::{headless_webview_arguments, should_show_main_window};
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

    #[test]
    fn ordinary_launch_never_enables_webview_remote_debugging() {
        assert_eq!(
            headless_webview_arguments(false, Some(OsStr::new("9333"))),
            None
        );
    }

    #[test]
    fn acceptance_debugging_requires_a_valid_unprivileged_port() {
        assert_eq!(headless_webview_arguments(true, None), None);
        assert_eq!(
            headless_webview_arguments(true, Some(OsStr::new("80"))),
            None
        );
        assert_eq!(
            headless_webview_arguments(true, Some(OsStr::new("not-a-port"))),
            None
        );
        assert_eq!(
            headless_webview_arguments(true, Some(OsStr::new("49333"))).as_deref(),
            Some("--remote-debugging-port=49333 --remote-allow-origins=http://127.0.0.1:49333")
        );
    }
}
