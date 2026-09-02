//! Small, local-only setup/profile store.
//!
//! This is deliberately separate from project metadata and the OS keyring.
//! It records *intent* (which user-approved model/profile should be used),
//! never credentials, model weights, executable paths, or a claim that a
//! model is installed.  The Python model manager remains the only component
//! that can activate a signed, hash-verified model manifest.

use crate::error::CommandError;
use crate::types::{LocalModelSetup, LocalModelSetupSaveRequest, ModelProfile, ProfileRoute};
use chrono::Utc;
use parking_lot::Mutex;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const CONFIG_FILE: &str = "model-setup.json";
const MAX_SELECTED_MODELS: usize = 32;
const MAX_PROFILES: usize = 12;
const KNOWN_MODELS: &[&str] = &[
    "local/qwen3.5-9b-gguf",
    "local/gemma-3-4b-it",
    "local/phi-4-mini-instruct",
    "local/qwen2.5-coder-7b",
    "local/qwen3-embedding-0.6b",
    "local/bge-m3",
    "local/bge-reranker-v2-m3",
    "local/qwen3-reranker-0.6b",
    "local/flux2-klein-4b",
    "local/qwen3-tts-0.6b",
    "local/kokoro",
    "local/piper-voice-pack",
    "local/whisper-large-v3-turbo",
    "local/montreal-forced-aligner",
    "local/musetalk-1.5",
    "local/echomimicv3-flash",
    "local/latentsync-1.5",
    "local/nvidia-lipsync-private",
    "local/liveportrait",
    "local/stableavatar",
    "local/wav2lip-baseline",
];
const LIP_SYNC_MODELS: &[&str] = &[
    "local/echomimicv3-flash",
    "local/musetalk-1.5",
    "local/latentsync-1.5",
    "local/nvidia-lipsync-private",
];
const PORTRAIT_ANIMATION_MODELS: &[&str] = &["local/liveportrait"];
const ROUTE_MEDIA: &[&str] = &[
    "writing",
    "research",
    "images",
    "motion",
    "voice",
    "transcription",
    "presenter",
    "portraitAnimation",
    "lipSync",
];
const PROVIDERS: &[&str] = &[
    "local-runtime",
    "openai",
    "anthropic",
    "cohere",
    "gemini",
    "nvidia-nim",
    "elevenlabs",
    "azure-speech",
    "google-cloud-speech",
    "runway",
    "heygen",
    "tavus",
    "black-forest-labs",
    "recraft",
    "openverse",
    "pexels",
    "openai-compatible-local",
];

/// Owns a human-readable setup plan.  It does not own models or secrets.
#[derive(Debug)]
pub struct ModelSetupStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl ModelSetupStore {
    pub fn at(app_data: PathBuf) -> Self {
        Self {
            path: app_data.join(CONFIG_FILE),
            lock: Mutex::new(()),
        }
    }

    pub fn get(&self) -> Result<LocalModelSetup, CommandError> {
        let _guard = self.lock.lock();
        self.read_locked()
    }

    pub fn save(&self, input: LocalModelSetupSaveRequest) -> Result<LocalModelSetup, CommandError> {
        let _guard = self.lock.lock();
        let setup = validated_setup(input)?;
        let encoded = serde_json::to_vec_pretty(&setup)
            .map_err(|_| CommandError::io("model setup encoding"))?;
        atomic_write(&self.path, &encoded)?;
        Ok(setup)
    }

    fn read_locked(&self) -> Result<LocalModelSetup, CommandError> {
        if !self.path.exists() {
            return Ok(default_setup());
        }
        let bytes = fs::read(&self.path).map_err(|_| CommandError::io("model setup read"))?;
        let stored = serde_json::from_slice::<LocalModelSetup>(&bytes).map_err(|_| {
            CommandError::new(
                "MODEL_SETUP_UNREADABLE",
                "The local model setup file is not valid. It was left unchanged; restore it from a backup or remove it after inspection.",
                false,
            )
        })?;
        validated_setup(LocalModelSetupSaveRequest::from(stored))
    }
}

fn default_setup() -> LocalModelSetup {
    LocalModelSetup {
        schema_version: 1,
        active_profile_id: "balanced-cloud".into(),
        selected_model_ids: vec![],
        lip_sync_model_id: None,
        portrait_animation_model_id: None,
        existing_model_directory: None,
        profiles: vec![ModelProfile {
            id: "balanced-cloud".into(),
            name: "Balanced cloud".into(),
            description: "Use configured APIs for most stages; keep local-model choices explicit."
                .into(),
            routes: BTreeMap::from([
                ("writing".into(), route("openai", "choose at generation")),
                ("research".into(), route("openai", "choose at generation")),
                ("images".into(), route("openai", "gpt-image-2")),
                (
                    "voice".into(),
                    voice_route(
                        "elevenlabs",
                        "eleven_multilingual_v2",
                        "Xb7hH8MSUJpSbSDYk0k2",
                    ),
                ),
                (
                    "transcription".into(),
                    route("openai", "choose at generation"),
                ),
                ("presenter".into(), route("local-runtime", "off by default")),
                (
                    "portraitAnimation".into(),
                    route("local-runtime", "off by default"),
                ),
                ("lipSync".into(), route("local-runtime", "off by default")),
            ]),
        }],
        updated_at: Utc::now(),
    }
}

fn route(provider_id: &str, model_id: &str) -> ProfileRoute {
    ProfileRoute {
        provider_id: provider_id.into(),
        model_id: model_id.into(),
        model_revision: None,
        install_fingerprint: None,
        voice_id: None,
        presenter_profile_id: None,
    }
}

fn voice_route(provider_id: &str, model_id: &str, voice_id: &str) -> ProfileRoute {
    ProfileRoute {
        voice_id: Some(voice_id.into()),
        ..route(provider_id, model_id)
    }
}

fn validated_setup(input: LocalModelSetupSaveRequest) -> Result<LocalModelSetup, CommandError> {
    if input.selected_model_ids.len() > MAX_SELECTED_MODELS {
        return Err(CommandError::invalid(
            "selectedModelIds",
            "contains too many choices",
        ));
    }
    let selected: BTreeSet<String> = input
        .selected_model_ids
        .into_iter()
        .map(|value| value.trim().to_owned())
        .collect();
    if selected
        .iter()
        .any(|value| !KNOWN_MODELS.contains(&value.as_str()))
    {
        return Err(CommandError::invalid(
            "selectedModelIds",
            "contains an unknown catalog model",
        ));
    }
    let lip_sync_model_id = input
        .lip_sync_model_id
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if let Some(value) = &lip_sync_model_id
        && !LIP_SYNC_MODELS.contains(&value.as_str())
    {
        return Err(CommandError::invalid(
            "lipSyncModelId",
            "must be a selectable lip-sync model",
        ));
    }
    let portrait_animation_model_id = input
        .portrait_animation_model_id
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if let Some(value) = &portrait_animation_model_id
        && !PORTRAIT_ANIMATION_MODELS.contains(&value.as_str())
    {
        return Err(CommandError::invalid(
            "portraitAnimationModelId",
            "must be a selectable portrait-animation model",
        ));
    }
    let existing_model_directory = input
        .existing_model_directory
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if let Some(value) = &existing_model_directory {
        if value.len() > 1024 || value.chars().any(char::is_control) {
            return Err(CommandError::invalid(
                "existingModelDirectory",
                "must be a printable path of at most 1024 characters",
            ));
        }
        let metadata = fs::metadata(value).map_err(|_| {
            CommandError::invalid(
                "existingModelDirectory",
                "must be an existing directory; no files were inspected or activated",
            )
        })?;
        if !metadata.is_dir() {
            return Err(CommandError::invalid(
                "existingModelDirectory",
                "must be a directory",
            ));
        }
    }
    if input.profiles.is_empty() || input.profiles.len() > MAX_PROFILES {
        return Err(CommandError::invalid(
            "profiles",
            "must contain 1 to 12 named profiles",
        ));
    }
    let mut ids = BTreeSet::new();
    for profile in &input.profiles {
        validate_profile(profile)?;
        if !ids.insert(profile.id.clone()) {
            return Err(CommandError::invalid(
                "profiles",
                "profile IDs must be unique",
            ));
        }
    }
    if !ids.contains(input.active_profile_id.trim()) {
        return Err(CommandError::invalid(
            "activeProfileId",
            "must identify one saved profile",
        ));
    }
    Ok(LocalModelSetup {
        schema_version: 1,
        active_profile_id: input.active_profile_id.trim().to_owned(),
        selected_model_ids: selected.into_iter().collect(),
        lip_sync_model_id,
        portrait_animation_model_id,
        existing_model_directory,
        profiles: input.profiles,
        updated_at: Utc::now(),
    })
}

fn validate_profile(profile: &ModelProfile) -> Result<(), CommandError> {
    if !valid_id(&profile.id) {
        return Err(CommandError::invalid(
            "profiles.id",
            "must use lowercase letters, digits, and hyphens",
        ));
    }
    if invalid_text(&profile.name, 64) || invalid_text(&profile.description, 180) {
        return Err(CommandError::invalid(
            "profiles",
            "name or description is invalid",
        ));
    }
    if profile.routes.is_empty() || profile.routes.len() > ROUTE_MEDIA.len() {
        return Err(CommandError::invalid(
            "profiles.routes",
            "must contain known media routes",
        ));
    }
    for (medium, selection) in &profile.routes {
        if !ROUTE_MEDIA.contains(&medium.as_str()) {
            return Err(CommandError::invalid(
                "profiles.routes",
                "contains an unknown medium",
            ));
        }
        if !PROVIDERS.contains(&selection.provider_id.as_str())
            || invalid_text(&selection.model_id, 160)
        {
            return Err(CommandError::invalid(
                "profiles.routes",
                "contains an unsupported provider or model label",
            ));
        }
        for (field, value, limit) in [
            ("modelRevision", selection.model_revision.as_deref(), 200),
            ("voiceId", selection.voice_id.as_deref(), 160),
            (
                "presenterProfileId",
                selection.presenter_profile_id.as_deref(),
                160,
            ),
        ] {
            if value.is_some_and(|item| invalid_text(item, limit)) {
                return Err(CommandError::invalid(
                    "profiles.routes",
                    format!("contains an invalid {field}"),
                ));
            }
        }
        if selection
            .install_fingerprint
            .as_deref()
            .is_some_and(|value| !is_sha256(value))
        {
            return Err(CommandError::invalid(
                "profiles.routes",
                "contains an invalid install fingerprint",
            ));
        }
    }
    Ok(())
}

fn valid_id(value: &str) -> bool {
    let value = value.trim();
    (1..=48).contains(&value.len())
        && !value.starts_with('-')
        && !value.ends_with('-')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn invalid_text(value: &str, max: usize) -> bool {
    value.trim().is_empty() || value.chars().count() > max || value.chars().any(char::is_control)
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), CommandError> {
    let parent = path
        .parent()
        .ok_or_else(|| CommandError::io("model setup path"))?;
    let temporary = parent.join(format!(".{CONFIG_FILE}.{}.part", Uuid::now_v7()));
    fs::write(&temporary, bytes).map_err(|_| CommandError::io("model setup staging write"))?;
    if let Err(_error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(CommandError::io("model setup atomic promotion"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn persists_an_explicit_lipsync_choice_without_activating_it() {
        let temp = tempdir().expect("tempdir");
        let store = ModelSetupStore::at(temp.path().to_path_buf());
        let mut setup = default_setup();
        setup.selected_model_ids = vec!["local/echomimicv3-flash".into()];
        setup.lip_sync_model_id = Some("local/echomimicv3-flash".into());
        let saved = store.save(setup.into()).expect("save");
        assert_eq!(
            saved.lip_sync_model_id.as_deref(),
            Some("local/echomimicv3-flash")
        );
        assert!(temp.path().join(CONFIG_FILE).is_file());
        assert_eq!(
            store.get().expect("get").active_profile_id,
            "balanced-cloud"
        );
        let mut replacement = store.get().expect("reload");
        replacement.profiles[0].name = "My verified profile".into();
        store.save(replacement.into()).expect("replace");
        assert_eq!(
            store.get().expect("reloaded replacement").profiles[0].name,
            "My verified profile"
        );
    }

    #[test]
    fn rejects_unknown_or_unvalidated_model_paths() {
        let temp = tempdir().expect("tempdir");
        let store = ModelSetupStore::at(temp.path().to_path_buf());
        let mut setup = default_setup();
        setup.selected_model_ids = vec!["local/not-real".into()];
        assert_eq!(
            store.save(setup.into()).expect_err("invalid").code,
            "INVALID_INPUT"
        );

        let mut setup = default_setup();
        setup.existing_model_directory = Some(temp.path().join("not-there").display().to_string());
        assert_eq!(
            store.save(setup.into()).expect_err("missing").code,
            "INVALID_INPUT"
        );
    }

    #[test]
    fn persists_distinct_portrait_animation_and_lipsync_routes_with_exact_identities() {
        let temp = tempdir().expect("tempdir");
        let store = ModelSetupStore::at(temp.path().to_path_buf());
        let mut setup = default_setup();
        setup.portrait_animation_model_id = Some("local/liveportrait".into());
        setup.lip_sync_model_id = Some("local/musetalk-1.5".into());
        let portrait = setup.profiles[0]
            .routes
            .get_mut("portraitAnimation")
            .expect("portrait route");
        portrait.model_id = "local/liveportrait".into();
        portrait.model_revision = Some("liveportrait-hf-82a4fa67".into());
        portrait.install_fingerprint = Some("a".repeat(64));
        let lipsync = setup.profiles[0]
            .routes
            .get_mut("lipSync")
            .expect("lip-sync route");
        lipsync.model_id = "local/musetalk-1.5".into();
        lipsync.model_revision = Some("musetalk-hf-3ef28bc5+code-0a89dec4".into());
        lipsync.install_fingerprint = Some("b".repeat(64));

        let saved = store.save(setup.into()).expect("save exact local routes");
        assert_eq!(
            saved.portrait_animation_model_id.as_deref(),
            Some("local/liveportrait")
        );
        assert_eq!(
            saved.lip_sync_model_id.as_deref(),
            Some("local/musetalk-1.5")
        );
        assert_ne!(
            saved.profiles[0].routes["portraitAnimation"].model_id,
            saved.profiles[0].routes["lipSync"].model_id
        );
    }

    #[test]
    fn rejects_a_non_sha_install_fingerprint() {
        let temp = tempdir().expect("tempdir");
        let store = ModelSetupStore::at(temp.path().to_path_buf());
        let mut setup = default_setup();
        setup.profiles[0]
            .routes
            .get_mut("lipSync")
            .expect("route")
            .install_fingerprint = Some("not-a-sha".into());
        assert_eq!(
            store
                .save(setup.into())
                .expect_err("invalid fingerprint")
                .code,
            "INVALID_INPUT"
        );
    }
}
