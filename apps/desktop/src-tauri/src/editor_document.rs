//! Native interchange exports do not depend on WebView download UI.
use crate::{error::CommandError, project_store::ProjectStore, state::AppState};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::PathBuf};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportRequest {
    project_id: Uuid,
    project_directory: PathBuf,
    format: DocumentFormat,
    contents: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum DocumentFormat {
    EditorJson,
    Otio,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReceipt {
    path: PathBuf,
    sha256: String,
    byte_size: usize,
}

#[tauri::command]
pub fn editor_document_export(
    input: ExportRequest,
    state: State<'_, AppState>,
) -> Result<ExportReceipt, CommandError> {
    export(input, &state.projects)
}

fn export(input: ExportRequest, projects: &ProjectStore) -> Result<ExportReceipt, CommandError> {
    projects.verify_identity(&input.project_directory, input.project_id)?;
    if input.contents.len() > 8 * 1024 * 1024 {
        return Err(CommandError::invalid(
            "contents",
            "exceeds the 8 MiB document limit",
        ));
    }
    let value: serde_json::Value = serde_json::from_str(&input.contents)
        .map_err(|_| CommandError::invalid("contents", "must be a JSON document"))?;
    let (field, schema, extension) = match input.format {
        DocumentFormat::EditorJson => ("schema", "alystria.editor.project.v1", "editor.json"),
        DocumentFormat::Otio => ("OTIO_SCHEMA", "Timeline.1", "otio"),
    };
    if value.get(field).and_then(|v| v.as_str()) != Some(schema) {
        return Err(CommandError::invalid(
            "contents",
            "does not match the selected editor document format",
        ));
    }
    let project = input
        .project_directory
        .canonicalize()
        .map_err(|_| CommandError::io("project path resolution"))?;
    let exports = project.join("exports");
    let metadata = fs::symlink_metadata(&exports)
        .map_err(|_| CommandError::io("exports directory inspection"))?;
    #[cfg(windows)]
    let redirected = {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    };
    #[cfg(not(windows))]
    let redirected = metadata.file_type().is_symlink();
    if !metadata.is_dir() || redirected || exports.canonicalize().ok().as_ref() != Some(&exports) {
        return Err(CommandError::invalid(
            "projectDirectory",
            "exports must be an ordinary directory within the project",
        ));
    }
    // Short, generated names avoid long tutorial titles and never overwrite.
    let path = exports.join(format!("timeline-{}.{}", Uuid::now_v7(), extension));
    let bytes = input.contents.as_bytes();
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|_| CommandError::io("editor document creation"))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| CommandError::io("editor document save"))?;
    let stored = fs::read(&path).map_err(|_| CommandError::io("editor document verification"))?;
    if stored != bytes {
        return Err(CommandError::io("editor document verification"));
    }
    Ok(ExportReceipt {
        path,
        sha256: format!("{:x}", Sha256::digest(&stored)),
        byte_size: stored.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{CreateProjectRequest, GroundingMode};

    #[test]
    fn exports_exact_bytes_without_overwrite_and_rejects_wrong_identity_or_schema() {
        let root = tempfile::tempdir().unwrap();
        let project = ProjectStore
            .create(CreateProjectRequest {
                parent_directory: root.path().to_path_buf(),
                directory_name: "project".into(),
                title: "Tutorial".into(),
                locale: "en-US".into(),
                grounding_mode: GroundingMode::Creative,
                initial_snapshot: None,
            })
            .unwrap();
        let request = || ExportRequest {
            project_id: project.manifest.project_id,
            project_directory: project.project_directory.clone(),
            format: DocumentFormat::Otio,
            contents: "{\"OTIO_SCHEMA\":\"Timeline.1\",\"name\":\"Unicode →\"}".into(),
        };
        let first = export(request(), &ProjectStore).unwrap();
        let second = export(request(), &ProjectStore).unwrap();
        assert_ne!(first.path, second.path);
        assert_eq!(fs::read_to_string(first.path).unwrap(), request().contents);
        assert_eq!(first.sha256, second.sha256);
        let mut wrong = request();
        wrong.project_id = Uuid::nil();
        assert!(export(wrong, &ProjectStore).is_err());
        let mut wrong = request();
        wrong.format = DocumentFormat::EditorJson;
        assert!(export(wrong, &ProjectStore).is_err());
        let mut wrong = request();
        wrong.contents = " ".repeat(8 * 1024 * 1024 + 1);
        assert!(export(wrong, &ProjectStore).is_err());
    }
}
