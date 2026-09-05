use crate::error::CommandError;
use crate::types::{
    CreateProjectRequest, OpenProjectRequest, PROJECT_SCHEMA_VERSION, ProjectAccess, ProjectHandle,
    ProjectManifest, SaveProjectRequest,
};
use crate::validation;
use chrono::Utc;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use uuid::Uuid;

const MANIFEST_FILE: &str = "manifest.json";
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Default)]
pub struct ProjectStore;

impl ProjectStore {
    pub fn create(&self, input: CreateProjectRequest) -> Result<ProjectHandle, CommandError> {
        validation::existing_absolute_directory(&input.parent_directory, "parentDirectory")?;
        let parent = input
            .parent_directory
            .canonicalize()
            .map_err(|_| CommandError::io("project path validation"))?;
        let directory_name = validation::directory_name(&input.directory_name)?;
        let title = validation::title(&input.title)?;
        let locale = validation::locale(&input.locale)?;
        let project_directory = parent.join(directory_name);

        if project_directory.exists() {
            return Err(CommandError::conflict(
                "A file or directory already exists at the requested project location.",
            ));
        }

        fs::create_dir(&project_directory).map_err(|_| CommandError::io("project creation"))?;
        let result = self.initialize_created_directory(
            &project_directory,
            title,
            locale,
            input.grounding_mode,
        );
        if result.is_err() {
            // This target was proven absent immediately before creation and is owned
            // by this operation, so rolling it back cannot remove user content.
            let _ = fs::remove_dir_all(&project_directory);
        }
        result
    }

    fn initialize_created_directory(
        &self,
        project_directory: &Path,
        title: String,
        locale: String,
        grounding_mode: crate::types::GroundingMode,
    ) -> Result<ProjectHandle, CommandError> {
        for relative in [
            "objects/sha256",
            "sources/original",
            "sources/quarantine",
            "staging",
            "exports",
            "backups",
        ] {
            fs::create_dir_all(project_directory.join(relative))
                .map_err(|_| CommandError::io("project directory creation"))?;
        }

        let now = Utc::now();
        let manifest = ProjectManifest {
            schema_version: PROJECT_SCHEMA_VERSION,
            project_id: Uuid::now_v7(),
            title,
            locale,
            grounding_mode,
            created_at: now,
            updated_at: now,
            manifest_revision: 1,
            active_snapshot_id: None,
            database_relative_path: "project.sqlite3".into(),
            object_store_relative_path: "objects/sha256".into(),
            source_store_relative_path: "sources/original".into(),
        };
        write_new_manifest(project_directory, &manifest)?;

        Ok(ProjectHandle {
            project_directory: project_directory.to_path_buf(),
            manifest,
            access: ProjectAccess::ReadWrite,
            database_ready: false,
            warnings: vec!["The pipeline worker has not initialized project.sqlite3 yet.".into()],
        })
    }

    pub fn open(&self, input: OpenProjectRequest) -> Result<ProjectHandle, CommandError> {
        validation::existing_absolute_directory(&input.project_directory, "projectDirectory")?;
        let directory = input
            .project_directory
            .canonicalize()
            .map_err(|_| CommandError::io("project path validation"))?;
        let manifest = read_manifest(&directory)?;
        validate_manifest(&manifest)?;

        let mut warnings = Vec::new();
        let sync_or_network = is_sync_or_network_path(&directory);
        let access = if sync_or_network {
            if !input.allow_read_only {
                return Err(CommandError::new(
                    "UNSAFE_PROJECT_LOCATION",
                    "Live projects on network or sync-backed paths must be opened read-only or moved to a local folder.",
                    false,
                ));
            }
            warnings.push(
                "This project is on a network or sync-backed path and was opened read-only.".into(),
            );
            ProjectAccess::ReadOnly
        } else if can_write_directory(&directory) {
            ProjectAccess::ReadWrite
        } else if input.allow_read_only {
            warnings
                .push("This project directory is not writable and was opened read-only.".into());
            ProjectAccess::ReadOnly
        } else {
            return Err(CommandError::new(
                "PROJECT_NOT_WRITABLE",
                "The project directory is not writable. Reopen it in read-only mode or choose another location.",
                false,
            ));
        };

        let database_ready = directory.join(&manifest.database_relative_path).is_file();
        if !database_ready {
            warnings
                .push("project.sqlite3 is absent; the pipeline worker must initialize it.".into());
        }

        Ok(ProjectHandle {
            project_directory: directory,
            manifest,
            access,
            database_ready,
            warnings,
        })
    }

    pub fn save(&self, input: SaveProjectRequest) -> Result<ProjectHandle, CommandError> {
        let opened = self.open(OpenProjectRequest {
            project_directory: input.project_directory,
            allow_read_only: false,
        })?;
        if opened.manifest.manifest_revision != input.expected_revision {
            return Err(CommandError::new(
                "REVISION_CONFLICT",
                "The project manifest changed after it was opened. Reload before saving.",
                false,
            ));
        }

        let mut manifest = opened.manifest;
        manifest.title = validation::title(&input.title)?;
        manifest.locale = validation::locale(&input.locale)?;
        manifest.grounding_mode = input.grounding_mode;
        manifest.active_snapshot_id = input.active_snapshot_id;
        manifest.updated_at = Utc::now();
        manifest.manifest_revision = manifest
            .manifest_revision
            .checked_add(1)
            .ok_or_else(|| CommandError::conflict("Manifest revision overflow."))?;

        replace_manifest(&opened.project_directory, &manifest)?;
        Ok(ProjectHandle { manifest, ..opened })
    }

    pub fn verify_identity(
        &self,
        directory: &Path,
        expected_id: Uuid,
    ) -> Result<ProjectManifest, CommandError> {
        let opened = self.open(OpenProjectRequest {
            project_directory: directory.to_path_buf(),
            allow_read_only: true,
        })?;
        if opened.manifest.project_id != expected_id {
            return Err(CommandError::invalid(
                "projectId",
                "does not match the project manifest at projectDirectory",
            ));
        }
        Ok(opened.manifest)
    }
}

fn write_new_manifest(directory: &Path, manifest: &ProjectManifest) -> Result<(), CommandError> {
    let path = directory.join(MANIFEST_FILE);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| CommandError::io("manifest creation"))?;
    serde_json::to_writer_pretty(&mut file, manifest)?;
    file.write_all(b"\n")
        .map_err(|_| CommandError::io("manifest write"))?;
    file.sync_all()
        .map_err(|_| CommandError::io("manifest flush"))?;
    sync_directory(directory);
    Ok(())
}

fn replace_manifest(directory: &Path, manifest: &ProjectManifest) -> Result<(), CommandError> {
    let target = directory.join(MANIFEST_FILE);
    let temp = directory.join(format!(".manifest.{}.tmp", Uuid::now_v7()));
    let backup = directory.join("backups").join("manifest.previous.json");

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|_| CommandError::io("manifest staging"))?;
    if serde_json::to_writer_pretty(&mut file, manifest).is_err()
        || file.write_all(b"\n").is_err()
        || file.sync_all().is_err()
    {
        let _ = fs::remove_file(&temp);
        return Err(CommandError::io("manifest staging"));
    }
    drop(file);

    fs::create_dir_all(directory.join("backups"))
        .map_err(|_| CommandError::io("manifest backup"))?;
    if backup.exists() {
        fs::remove_file(&backup).map_err(|_| CommandError::io("manifest backup rotation"))?;
    }
    fs::rename(&target, &backup).map_err(|_| CommandError::io("manifest backup"))?;
    if fs::rename(&temp, &target).is_err() {
        let _ = fs::rename(&backup, &target);
        let _ = fs::remove_file(&temp);
        return Err(CommandError::io("manifest replacement"));
    }
    sync_directory(directory);
    Ok(())
}

fn read_manifest(directory: &Path) -> Result<ProjectManifest, CommandError> {
    let path = directory.join(MANIFEST_FILE);
    let metadata = fs::metadata(&path).map_err(|_| {
        CommandError::new(
            "NOT_AN_ALYSTRIA_PROJECT",
            "manifest.json is missing from the selected directory.",
            false,
        )
    })?;
    if !metadata.is_file() || metadata.len() > MAX_MANIFEST_BYTES {
        return Err(CommandError::new(
            "INVALID_PROJECT_DOCUMENT",
            "manifest.json is not a regular file or exceeds the 1 MiB safety limit.",
            false,
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(path)
        .and_then(|file| file.take(MAX_MANIFEST_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|_| CommandError::io("manifest read"))?;
    serde_json::from_slice(&bytes).map_err(Into::into)
}

fn validate_manifest(manifest: &ProjectManifest) -> Result<(), CommandError> {
    if manifest.schema_version > PROJECT_SCHEMA_VERSION {
        return Err(CommandError::new(
            "PROJECT_REQUIRES_NEWER_APP",
            "This project uses a newer manifest schema. Update AI Video Tutorial Generator before opening it.",
            false,
        ));
    }
    if manifest.schema_version == 0 {
        return Err(CommandError::new(
            "INVALID_PROJECT_DOCUMENT",
            "Project schema version 0 is invalid.",
            false,
        ));
    }
    validation::title(&manifest.title)?;
    validation::locale(&manifest.locale)?;
    for (field, relative) in [
        ("databaseRelativePath", &manifest.database_relative_path),
        (
            "objectStoreRelativePath",
            &manifest.object_store_relative_path,
        ),
        (
            "sourceStoreRelativePath",
            &manifest.source_store_relative_path,
        ),
    ] {
        validate_safe_relative_path(relative, field)?;
    }
    Ok(())
}

fn validate_safe_relative_path(value: &str, field: &str) -> Result<(), CommandError> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(CommandError::invalid(field, "must be a safe relative path"));
    }
    Ok(())
}

fn can_write_directory(directory: &Path) -> bool {
    let probe = directory.join(format!(".alystria-write-probe-{}", Uuid::now_v7()));
    let result = OpenOptions::new().write(true).create_new(true).open(&probe);
    if let Ok(file) = result {
        drop(file);
        let _ = fs::remove_file(probe);
        true
    } else {
        false
    }
}

fn is_sync_or_network_path(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::path::Prefix;
        if let Some(std::path::Component::Prefix(prefix)) = path.components().next()
            && matches!(prefix.kind(), Prefix::UNC(_, _) | Prefix::VerbatimUNC(_, _))
        {
            return true;
        }
    }
    path.components().any(|component| {
        let name = component.as_os_str().to_string_lossy().to_ascii_lowercase();
        matches!(
            name.as_str(),
            "onedrive" | "dropbox" | "google drive" | "icloud drive" | "syncthing"
        ) || name.starts_with("onedrive - ")
    })
}

fn sync_directory(_directory: &Path) {
    #[cfg(unix)]
    if let Ok(file) = File::open(_directory) {
        let _ = file.sync_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::GroundingMode;
    use tempfile::tempdir;

    fn request(root: &Path) -> CreateProjectRequest {
        CreateProjectRequest {
            parent_directory: root.to_path_buf(),
            directory_name: "Karatsuba Course".into(),
            title: "Karatsuba Multiplication".into(),
            locale: "en-US".into(),
            grounding_mode: GroundingMode::Strict,
            initial_snapshot: None,
        }
    }

    #[test]
    fn creates_expected_skeleton_without_claiming_database_ownership() {
        let temp = tempdir().unwrap();
        let handle = ProjectStore.create(request(temp.path())).unwrap();
        assert!(handle.project_directory.join("manifest.json").is_file());
        assert!(handle.project_directory.join("objects/sha256").is_dir());
        assert!(handle.project_directory.join("sources/quarantine").is_dir());
        assert!(!handle.project_directory.join("project.sqlite3").exists());
        assert!(!handle.database_ready);
    }

    #[test]
    fn optimistic_revision_prevents_lost_updates() {
        let temp = tempdir().unwrap();
        let handle = ProjectStore.create(request(temp.path())).unwrap();
        let saved = ProjectStore
            .save(SaveProjectRequest {
                project_directory: handle.project_directory.clone(),
                expected_revision: 1,
                title: "New title".into(),
                locale: "es-ES".into(),
                grounding_mode: GroundingMode::Grounded,
                active_snapshot_id: None,
            })
            .unwrap();
        assert_eq!(saved.manifest.manifest_revision, 2);
        assert!(
            ProjectStore
                .save(SaveProjectRequest {
                    project_directory: handle.project_directory,
                    expected_revision: 1,
                    title: "Stale title".into(),
                    locale: "en-US".into(),
                    grounding_mode: GroundingMode::Creative,
                    active_snapshot_id: None,
                })
                .is_err()
        );
    }
}
