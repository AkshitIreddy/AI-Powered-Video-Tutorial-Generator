//! Application updates use Tauri's mandatory signature verification. Runtime
//! files travel in the same installer so protocol versions cannot drift.
use crate::{error::CommandError, state::AppState};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

static INSTALLING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    version: Option<String>,
    notes: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded: usize,
    total: Option<u64>,
    phase: &'static str,
}

fn error(message: &str) -> CommandError {
    CommandError::new("APP_UPDATE_FAILED", message, true)
}

#[tauri::command]
pub async fn app_update_check(app: AppHandle) -> Result<UpdateInfo, CommandError> {
    let update = app.updater_builder().timeout(std::time::Duration::from_secs(25))
        .build().map_err(|_| error("The update service could not be initialized."))?
        .check().await.map_err(|_| error("Could not reach the update service. Try again when online."))?;
    Ok(UpdateInfo {
        current_version: env!("CARGO_PKG_VERSION").into(),
        version: update.as_ref().map(|value| value.version.clone()),
        notes: update.and_then(|value| value.body),
    })
}

#[tauri::command]
pub async fn app_update_install(app: AppHandle, version: String) -> Result<(), CommandError> {
    if INSTALLING.swap(true, Ordering::AcqRel) {
        return Err(error("An update is already being installed."));
    }
    let result = install(&app, &version).await;
    INSTALLING.store(false, Ordering::Release);
    result
}

async fn install(app: &AppHandle, version: &str) -> Result<(), CommandError> {
    let update = app.updater_builder().timeout(std::time::Duration::from_secs(300))
        .build().map_err(|_| error("The update service could not be initialized."))?
        .check().await.map_err(|_| error("Could not reach the update service. Try again when online."))?
        .ok_or_else(|| error("This version is already up to date."))?;
    if update.version != version {
        return Err(error("The available release changed. Check for updates again."));
    }
    let mut downloaded = 0;
    let bytes = update.download(|count, total| {
        downloaded += count;
        let _ = app.emit("app-update-progress", Progress { downloaded, total, phase: "downloading" });
    }, || {}).await.map_err(|_| error("The update download or signature verification failed. Your installed app has not changed."))?;
    let _ = app.emit("app-update-progress", Progress { downloaded, total: Some(downloaded as u64), phase: "installing" });
    // The UI persists pending edits before invoking this command and prevents
    // editing while it runs. Stop subprocesses before NSIS replaces their files.
    let state = app.state::<AppState>();
    state.model_downloads.close();
    state.worker.close();
    update.install(bytes).map_err(|_| error("The installer could not start. Restart the app and try again."))?;
    app.restart();
}
