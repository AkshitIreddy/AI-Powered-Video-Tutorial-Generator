//! Cheap configuration discovery. Full runtime hashes are checked by the worker
//! before rendering; opening a gallery must not hash gigabytes or load models.
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

const JOY_ROLES: [&str; 8] = [
    "adapter-entrypoint",
    "runtime-source-manifest",
    "audio-feature-config",
    "audio-feature-preprocessor",
    "audio-feature-weights",
    "motion-generator-weights",
    "motion-template",
    "portrait-runtime-manifest",
];

const SOULX_ROLES: [&str; 8] = [
    "adapter-entrypoint",
    "runtime-source-manifest",
    "audio-feature-config",
    "audio-feature-preprocessor",
    "audio-feature-weights",
    "flashhead-config",
    "flashhead-weights",
    "vae-weights",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenterPortraitRuntimeStatus {
    /// None identifies the primary runtime used when no exact portrait override exists.
    pub portrait_artifact_hash: Option<String>,
    pub model_id: Option<String>,
    pub model_revision: Option<String>,
    pub install_fingerprint: Option<String>,
    pub configured: bool,
    pub reason: String,
}

fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn regular(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| {
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            metadata.is_file() && metadata.file_attributes() & 0x400 == 0
        }
        #[cfg(not(windows))]
        {
            metadata.is_file() && !metadata.file_type().is_symlink()
        }
    })
}

fn json_file(path: &Path) -> Result<Value, &'static str> {
    if !regular(path) || fs::metadata(path).map_or(true, |metadata| metadata.len() > 1_048_576) {
        return Err("The selected character runtime configuration is missing or invalid.");
    }
    let bytes =
        fs::read(path).map_err(|_| "The character runtime configuration cannot be read.")?;
    serde_json::from_slice(&bytes).map_err(|_| "The character runtime configuration is invalid.")
}

fn relative_file(root: &Path, value: &str) -> Result<PathBuf, &'static str> {
    let relative = Path::new(value);
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("The character runtime contains an invalid relative path.");
    }
    let candidate = root.join(relative);
    if !regular(&candidate) {
        return Err("A required character runtime file is missing. Repair its installation.");
    }
    let resolved = candidate
        .canonicalize()
        .map_err(|_| "A character runtime file cannot be opened.")?;
    if !resolved.starts_with(root) {
        return Err("A character runtime file is outside its installation.");
    }
    Ok(resolved)
}

fn pin_present(root: &Path, value: &Value) -> Result<(), &'static str> {
    let hash = value
        .get("sha256")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let path = value
        .get("relativePath")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !digest(hash) {
        return Err("A character runtime file has no valid verification record.");
    }
    relative_file(root, path)?;
    Ok(())
}

fn inspect_config(models: &Path, child: &Path, is_primary: bool) -> Result<Value, &'static str> {
    let config = json_file(child)?;
    if config.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || (!is_primary && config.get("portraitRuntimeOverrides").is_some())
    {
        return Err("The character runtime configuration has an unsupported schema.");
    }
    let model = config
        .get("modelId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !matches!(
        model,
        "joyvasa-human"
            | "joyvasa-animal"
            | "musetalk"
            | "musetalk-1.5"
            | "liveportrait-musetalk-1.5"
            | "soulx-flashhead-pro"
    ) {
        return Err("The selected character animation engine is not supported.");
    }
    let root_value = config
        .get("runtimeRoot")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let root = child
        .parent()
        .unwrap_or(models)
        .join(root_value)
        .canonicalize()
        .map_err(|_| "The character animation runtime is not installed.")?;
    if root_value.is_empty() || !root.is_dir() || !root.starts_with(models) {
        return Err("The character animation runtime is outside the model installation.");
    }
    let contract = &config["workerContract"];
    let is_joy = model.starts_with("joyvasa-");
    let is_soulx = model == "soulx-flashhead-pro";
    let expected_contract = if is_soulx {
        "alystria.soulx-flashhead.worker.v1"
    } else if is_joy {
        "alystria.joyvasa.worker.v1"
    } else {
        "alystria.musetalk.worker.v1"
    };
    if contract.get("contractId").and_then(Value::as_str) != Some(expected_contract) {
        return Err("The character animation runtime has no supported worker contract.");
    }
    let fingerprint = config
        .get("installFingerprint")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !digest(fingerprint)
        || config
            .get("modelRevision")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
    {
        return Err("The character animation runtime has no installation identity.");
    }
    pin_present(&root, &config["executable"])?;
    pin_present(&root, &contract["entrypoint"])?;
    let files = contract
        .get("files")
        .and_then(Value::as_array)
        .filter(|files| !files.is_empty() && files.len() <= 64)
        .ok_or("The character animation runtime has no verified file declarations.")?;
    let roles: BTreeSet<_> = files
        .iter()
        .filter_map(|file| file["role"].as_str())
        .collect();
    if is_joy && (files.len() != JOY_ROLES.len() || roles != JOY_ROLES.into_iter().collect()) {
        return Err("The character animation runtime file declarations are incomplete.");
    }
    if is_soulx && (files.len() != SOULX_ROLES.len() || roles != SOULX_ROLES.into_iter().collect())
    {
        return Err("The character animation runtime file declarations are incomplete.");
    }
    for file in files {
        pin_present(&root, file)?;
    }
    Ok(config)
}

pub fn inspect(models: &Path) -> Vec<PresenterPortraitRuntimeStatus> {
    let Ok(models) = models.canonicalize() else {
        return vec![];
    };
    let Ok(primary) = json_file(&models.join("presenter-runtime.json")) else {
        return vec![];
    };
    if primary.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return vec![];
    }
    let mut statuses = Vec::new();
    if primary.get("modelId").and_then(Value::as_str).is_some() {
        statuses.push(status(
            None,
            inspect_config(&models, &models.join("presenter-runtime.json"), true),
        ));
    }
    if let Some(routes) = primary
        .get("portraitRuntimeOverrides")
        .and_then(Value::as_array)
    {
        for route in routes.iter().take(256) {
            let Some(hash) = route
                .get("portraitArtifactHash")
                .and_then(Value::as_str)
                .filter(|hash| digest(hash))
            else {
                continue;
            };
            let result = relative_file(
                &models,
                route
                    .get("relativeConfigPath")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )
            .and_then(|path| inspect_config(&models, &path, false));
            statuses.push(status(Some(hash), result));
        }
    }
    statuses
}

fn status(
    hash: Option<&str>,
    result: Result<Value, &'static str>,
) -> PresenterPortraitRuntimeStatus {
    let mut status = PresenterPortraitRuntimeStatus {
        portrait_artifact_hash: hash.map(str::to_owned),
        model_id: None,
        model_revision: None,
        install_fingerprint: None,
        configured: false,
        reason: String::new(),
    };
    match result {
        Ok(config) => {
            status.model_id = config["modelId"].as_str().map(str::to_owned);
            status.model_revision = config["modelRevision"].as_str().map(str::to_owned);
            status.install_fingerprint = config["installFingerprint"].as_str().map(str::to_owned);
            status.configured = true;
            status.reason =
                "Presenter runtime configured. File integrity is checked before rendering.".into();
        }
        Err(reason) => status.reason = reason.into(),
    }
    status
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn setup() -> tempfile::TempDir {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join("runtime")).unwrap();
        fs::write(temp.path().join("runtime/worker.py"), "verified at render").unwrap();
        let pin = json!({"relativePath":"worker.py", "sha256":"a".repeat(64)});
        let files: Vec<_> = JOY_ROLES
            .iter()
            .map(|role| json!({"role":role,"relativePath":"worker.py","sha256":"a".repeat(64)}))
            .collect();
        let config = json!({"schemaVersion":1, "runtimeRoot":"runtime", "modelId":"joyvasa-animal", "modelRevision":"pinned", "installFingerprint":"b".repeat(64), "executable":pin, "workerContract":{"contractId":"alystria.joyvasa.worker.v1", "entrypoint":pin, "files":files}});
        fs::write(temp.path().join("animal.json"), config.to_string()).unwrap();
        fs::write(temp.path().join("presenter-runtime.json"), json!({"schemaVersion":1,"portraitRuntimeOverrides":[{"portraitArtifactHash":"c".repeat(64),"relativeConfigPath":"animal.json"},{"portraitArtifactHash":"d".repeat(64),"relativeConfigPath":"missing.json"}]}).to_string()).unwrap();
        temp
    }

    #[test]
    fn discovers_each_configured_route_without_loading_models() {
        let temp = setup();
        let statuses = inspect(temp.path());
        assert_eq!(statuses.len(), 2);
        assert!(statuses[0].configured);
        assert_eq!(statuses[0].model_id.as_deref(), Some("joyvasa-animal"));
        assert!(!statuses[1].configured);
        fs::remove_file(temp.path().join("runtime/worker.py")).unwrap();
        assert!(!inspect(temp.path())[0].configured);
    }

    #[test]
    fn rejects_nested_overrides_and_path_escape() {
        let temp = setup();
        let path = temp.path().join("animal.json");
        let mut config = json_file(&path).unwrap();
        config["portraitRuntimeOverrides"] = json!([]);
        fs::write(path, config.to_string()).unwrap();
        assert!(!inspect(temp.path())[0].configured);
        let root = temp.path().canonicalize().unwrap();
        assert!(relative_file(&root, "../animal.json").is_err());
    }

    #[test]
    fn discovers_default_runtime_even_without_portrait_overrides() {
        let temp = setup();
        let mut config = json_file(&temp.path().join("animal.json")).unwrap();
        config["modelId"] = json!("liveportrait-musetalk-1.5");
        config["workerContract"]["contractId"] = json!("alystria.musetalk.worker.v1");
        fs::write(
            temp.path().join("presenter-runtime.json"),
            config.to_string(),
        )
        .unwrap();
        let statuses = inspect(temp.path());
        assert_eq!(statuses.len(), 1);
        assert!(statuses[0].configured);
        assert_eq!(statuses[0].portrait_artifact_hash, None);
        assert_eq!(
            statuses[0].model_id.as_deref(),
            Some("liveportrait-musetalk-1.5")
        );
    }

    #[test]
    fn discovers_flashhead_and_rejects_a_missing_audio_encoder_role() {
        let temp = setup();
        let mut config = json_file(&temp.path().join("animal.json")).unwrap();
        config["modelId"] = json!("soulx-flashhead-pro");
        config["workerContract"]["contractId"] = json!("alystria.soulx-flashhead.worker.v1");
        config["workerContract"]["files"] =
            json!(SOULX_ROLES
            .iter()
            .map(|role| json!({"role":role,"relativePath":"worker.py","sha256":"a".repeat(64)}))
            .collect::<Vec<_>>());
        let path = temp.path().join("presenter-runtime.json");
        fs::write(&path, config.to_string()).unwrap();
        let statuses = inspect(temp.path());
        assert_eq!(statuses.len(), 1);
        assert!(statuses[0].configured);
        assert_eq!(statuses[0].model_id.as_deref(), Some("soulx-flashhead-pro"));
        config["workerContract"]["files"]
            .as_array_mut()
            .unwrap()
            .retain(|file| file["role"] != "audio-feature-weights");
        fs::write(&path, config.to_string()).unwrap();
        assert!(!inspect(temp.path())[0].configured);
    }

    #[test]
    fn no_optional_runtime_is_a_normal_empty_state() {
        let temp = tempfile::tempdir().unwrap();
        assert!(inspect(temp.path()).is_empty());
    }
}
