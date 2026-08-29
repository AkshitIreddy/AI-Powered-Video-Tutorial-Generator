use crate::error::CommandError;
use serde_json::Value;
use std::path::{Component, Path};

const MAX_TITLE_CHARS: usize = 160;
const MAX_PROVIDER_ID_CHARS: usize = 64;
const MAX_SECRET_CHARS: usize = 32_768;
pub const MAX_SNAPSHOT_BYTES: usize = 1024 * 1024;
pub const MAX_CUSTOMIZATION_BYTES: usize = 128 * 1024;
pub const MAX_SOURCE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_SOURCE_BASE64_CHARS: usize = MAX_SOURCE_BYTES.div_ceil(3) * 4;
pub const MAX_PROJECT_ASSET_BYTES: usize = 64 * 1024 * 1024;

pub fn title(value: &str) -> Result<String, CommandError> {
    let trimmed = value.trim();
    let count = trimmed.chars().count();
    if count == 0 || count > MAX_TITLE_CHARS {
        return Err(CommandError::invalid(
            "title",
            format!("must contain 1 to {MAX_TITLE_CHARS} characters"),
        ));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(CommandError::invalid(
            "title",
            "control characters are not allowed",
        ));
    }
    Ok(trimmed.to_owned())
}

pub fn locale(value: &str) -> Result<String, CommandError> {
    let value = value.trim();
    if !(2..=35).contains(&value.len())
        || value.starts_with('-')
        || value.ends_with('-')
        || value.split('-').any(|part| {
            part.is_empty() || part.len() > 8 || !part.chars().all(|c| c.is_ascii_alphanumeric())
        })
    {
        return Err(CommandError::invalid(
            "locale",
            "must be a valid BCP-47 style language tag",
        ));
    }
    Ok(value.to_owned())
}

pub fn directory_name(value: &str) -> Result<String, CommandError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 120 {
        return Err(CommandError::invalid(
            "directoryName",
            "must contain 1 to 120 characters",
        ));
    }
    if trimmed == "."
        || trimmed == ".."
        || trimmed.ends_with('.')
        || trimmed.ends_with(' ')
        || trimmed.chars().any(|c| {
            c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
        })
    {
        return Err(CommandError::invalid(
            "directoryName",
            "contains characters Windows cannot use in a project folder",
        ));
    }

    let stem = trimmed
        .split('.')
        .next()
        .unwrap_or(trimmed)
        .to_ascii_uppercase();
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.contains(&stem.as_str()) {
        return Err(CommandError::invalid(
            "directoryName",
            "uses a reserved Windows device name",
        ));
    }
    Ok(trimmed.to_owned())
}

pub fn source_filename(value: &str) -> Result<String, CommandError> {
    let trimmed = value.trim();
    if trimmed != value || trimmed.is_empty() || trimmed.len() > 240 {
        return Err(CommandError::invalid(
            "filename",
            "must be a trimmed filename of at most 240 UTF-8 bytes",
        ));
    }
    if trimmed == "."
        || trimmed == ".."
        || trimmed.ends_with('.')
        || trimmed.ends_with(' ')
        || trimmed.chars().any(|c| {
            c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
        })
    {
        return Err(CommandError::invalid(
            "filename",
            "contains unsafe or platform-specific characters",
        ));
    }
    let stem = trimmed
        .split('.')
        .next()
        .unwrap_or(trimmed)
        .to_ascii_uppercase();
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.contains(&stem.as_str()) {
        return Err(CommandError::invalid(
            "filename",
            "uses a reserved Windows device name",
        ));
    }
    Ok(trimmed.to_owned())
}

pub fn mime_type(value: &str) -> Result<String, CommandError> {
    let value = value.trim().to_ascii_lowercase();
    if value.is_empty()
        || value.len() > 127
        || value.matches('/').count() != 1
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '/' | '.' | '+' | '-')
        })
    {
        return Err(CommandError::invalid(
            "mimeType",
            "must be a valid MIME token",
        ));
    }
    Ok(value)
}

pub fn optional_metadata(
    value: &Option<String>,
    field: &str,
) -> Result<Option<String>, CommandError> {
    let Some(value) = value else { return Ok(None) };
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 500 || trimmed.chars().any(char::is_control)
    {
        return Err(CommandError::invalid(
            field,
            "must contain 1 to 500 printable characters",
        ));
    }
    Ok(Some(trimmed.to_owned()))
}

pub fn optional_long_metadata(
    value: &Option<String>,
    field: &str,
) -> Result<Option<String>, CommandError> {
    let Some(value) = value else { return Ok(None) };
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > 2_000
        || trimmed.chars().any(|character| character == '\0')
    {
        return Err(CommandError::invalid(
            field,
            "must contain 1 to 2,000 non-NUL characters",
        ));
    }
    Ok(Some(trimmed.to_owned()))
}

pub fn snapshot(value: &Value) -> Result<(), CommandError> {
    if !value.is_object() {
        return Err(CommandError::invalid("snapshot", "must be a JSON object"));
    }
    let bytes = serde_json::to_vec(value)
        .map_err(|_| CommandError::invalid("snapshot", "must contain only JSON values"))?;
    if bytes.len() > MAX_SNAPSHOT_BYTES {
        return Err(CommandError::invalid(
            "snapshot",
            "exceeds the 1 MiB project limit",
        ));
    }
    reject_snapshot_payloads(value)?;
    Ok(())
}

pub fn customization(value: &Value) -> Result<(), CommandError> {
    let object = value
        .as_object()
        .ok_or_else(|| CommandError::invalid("customization", "must be a JSON object"))?;
    const REQUIRED: [&str; 21] = [
        "fontPairId",
        "displayFont",
        "bodyFont",
        "typeScale",
        "lineHeight",
        "fonts",
        "paletteId",
        "colors",
        "backgroundMode",
        "backgroundAssetId",
        "materialStrength",
        "density",
        "contrast",
        "reducedMotion",
        "sceneTreatment",
        "cornerRadius",
        "shadowStrength",
        "captions",
        "presenter",
        "audio",
        "assets",
    ];
    if object.len() != REQUIRED.len() || REQUIRED.iter().any(|field| !object.contains_key(*field)) {
        return Err(CommandError::invalid(
            "customization",
            "must use the supported visual-bible contract",
        ));
    }
    let bytes = serde_json::to_vec(value)
        .map_err(|_| CommandError::invalid("customization", "must contain only JSON values"))?;
    if bytes.len() > MAX_CUSTOMIZATION_BYTES {
        return Err(CommandError::invalid(
            "customization",
            "exceeds the 128 KiB visual-bible limit",
        ));
    }
    reject_customization_payloads(value, 0)
}

fn reject_customization_payloads(value: &Value, depth: usize) -> Result<(), CommandError> {
    if depth > 8 {
        return Err(CommandError::invalid(
            "customization",
            "exceeds the supported nesting depth",
        ));
    }
    match value {
        Value::Object(map) => {
            for (key, nested) in map {
                let normalized = key.to_ascii_lowercase().replace(['_', '-'], "");
                if matches!(
                    normalized.as_str(),
                    "secret"
                        | "apikey"
                        | "token"
                        | "password"
                        | "contentbase64"
                        | "filebytes"
                        | "path"
                        | "url"
                        | "uri"
                        | "script"
                        | "command"
                        | "executable"
                ) {
                    return Err(CommandError::invalid(
                        "customization",
                        "must not contain credentials, paths, code, URLs, or embedded bytes",
                    ));
                }
                reject_customization_payloads(nested, depth + 1)?;
            }
        }
        Value::Array(values) => {
            if values.len() > 256 {
                return Err(CommandError::invalid(
                    "customization",
                    "arrays are limited to 256 entries",
                ));
            }
            for nested in values {
                reject_customization_payloads(nested, depth + 1)?;
            }
        }
        Value::String(value) => {
            if value.len() > 2_000 || value.contains('\0') {
                return Err(CommandError::invalid(
                    "customization",
                    "text values must be bounded and contain no NUL bytes",
                ));
            }
            let lowered = value.trim().to_ascii_lowercase();
            if lowered.starts_with("file:")
                || lowered.starts_with("data:")
                || lowered.starts_with("javascript:")
            {
                return Err(CommandError::invalid(
                    "customization",
                    "must not contain filesystem or executable URLs",
                ));
            }
        }
        _ => {}
    }
    Ok(())
}

fn reject_snapshot_payloads(value: &Value) -> Result<(), CommandError> {
    match value {
        Value::Object(map) => {
            for (key, nested) in map {
                let normalized = key.to_ascii_lowercase();
                if matches!(
                    normalized.as_str(),
                    "secret" | "apikey" | "api_key" | "contentbase64" | "filebytes"
                ) {
                    return Err(CommandError::invalid(
                        "snapshot",
                        "must not contain credentials or embedded file bytes",
                    ));
                }
                reject_snapshot_payloads(nested)?;
            }
        }
        Value::Array(values) => {
            for nested in values {
                reject_snapshot_payloads(nested)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn existing_absolute_directory(path: &Path, field: &str) -> Result<(), CommandError> {
    if !path.is_absolute() {
        return Err(CommandError::invalid(field, "must be an absolute path"));
    }
    if path
        .components()
        .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(CommandError::invalid(
            field,
            "parent traversal is not allowed",
        ));
    }
    let metadata = std::fs::metadata(path).map_err(|_| {
        CommandError::invalid(field, "directory does not exist or cannot be accessed")
    })?;
    if !metadata.is_dir() {
        return Err(CommandError::invalid(field, "must identify a directory"));
    }
    Ok(())
}

pub fn provider_id(value: &str) -> Result<String, CommandError> {
    identifier(value, "providerId", MAX_PROVIDER_ID_CHARS)
}

pub fn credential_kind(value: &str) -> Result<String, CommandError> {
    identifier(value, "credentialKind", 48)
}

pub fn lock_name(value: &str) -> Result<String, CommandError> {
    identifier(value, "preservationLock", 96)
}

pub fn stable_id(value: &str, field: &str) -> Result<String, CommandError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 128
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
    {
        return Err(CommandError::invalid(
            field,
            "must be a bounded stable identifier",
        ));
    }
    Ok(value.to_owned())
}

pub fn bounded_text(value: &str, field: &str, max_len: usize) -> Result<String, CommandError> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().count() > max_len
        || value.chars().any(|character| character == '\0')
    {
        return Err(CommandError::invalid(
            field,
            format!("must contain 1 to {max_len} non-NUL characters"),
        ));
    }
    Ok(value.to_owned())
}

fn identifier(value: &str, field: &str, max_len: usize) -> Result<String, CommandError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > max_len
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(CommandError::invalid(
            field,
            "must contain only ASCII letters, digits, '.', '-' or '_'",
        ));
    }
    Ok(value.to_ascii_lowercase())
}

pub fn secret(value: &str) -> Result<(), CommandError> {
    if value.trim().is_empty() || value.len() > MAX_SECRET_CHARS || value.contains('\0') {
        return Err(CommandError::invalid(
            "secret",
            format!("must contain 1 to {MAX_SECRET_CHARS} non-NUL characters"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_windows_device_names() {
        assert!(directory_name("CON.txt").is_err());
        assert!(directory_name("lpt9").is_err());
    }

    #[test]
    fn rejects_path_separators_and_traversal_names() {
        assert!(directory_name("../outside").is_err());
        assert!(directory_name("course\\unit").is_err());
    }

    #[test]
    fn accepts_locales_and_normalizes_identifiers() {
        assert_eq!(locale("en-US").unwrap(), "en-US");
        assert_eq!(provider_id(" OpenAI ").unwrap(), "openai");
    }

    #[test]
    fn validates_source_names_and_rejects_embedded_snapshot_payloads() {
        assert_eq!(
            source_filename("lecture-notes.md").unwrap(),
            "lecture-notes.md"
        );
        assert!(source_filename("../notes.md").is_err());
        assert!(source_filename("CON.txt").is_err());
        assert!(snapshot(&serde_json::json!({"title": "Safe", "scenes": []})).is_ok());
        assert!(snapshot(&serde_json::json!({"contentBase64": "c2VjcmV0"})).is_err());
        assert!(snapshot(&serde_json::json!({"provider": {"apiKey": "secret"}})).is_err());
    }

    #[test]
    fn source_base64_limit_matches_eight_mibibytes() {
        assert_eq!(MAX_SOURCE_BASE64_CHARS, 11_184_812);
        assert_eq!(MAX_SOURCE_BYTES, 8_388_608);
    }

    #[test]
    fn customization_accepts_contract_and_rejects_paths_or_extra_fields() {
        let value = serde_json::json!({
            "fontPairId": "editorial",
            "displayFont": "Bricolage Grotesque",
            "bodyFont": "Atkinson Hyperlegible Next",
            "typeScale": 100,
            "lineHeight": "balanced",
            "fonts": {"displayAssetId":null,"bodyAssetId":null},
            "paletteId": "precision",
            "colors": {"paper":"#F7F8FC","ink":"#151827","accent":"#5658E8","evidence":"#168F88"},
            "backgroundMode": "paper",
            "backgroundAssetId": null,
            "materialStrength": 28,
            "density": "balanced",
            "contrast": "standard",
            "reducedMotion": false,
            "sceneTreatment": "edge-to-edge",
            "cornerRadius": 14,
            "shadowStrength": 24,
            "captions": {"position":"auto","style":"soft-panel","size":100,"safeInset":8,"textColor":"#FFFFFF","panelColor":"#151827","maxLines":2},
            "presenter": {"assetId":null,"placement":"off","side":"right","scale":72,"crop":"portrait","frame":"soft"},
            "audio": {"musicAssetId":null,"sfxAssetId":null,"musicLevel":12,"sfxLevel":28,"narrationDucking":72},
            "assets": []
        });
        assert!(customization(&value).is_ok());
        let mut with_path = value.clone();
        with_path["assets"] = serde_json::json!([{"path":"C:/private/file.png"}]);
        assert!(customization(&with_path).is_err());
        let mut with_extra = value;
        with_extra["command"] = serde_json::json!("run");
        assert!(customization(&with_extra).is_err());
    }
}
