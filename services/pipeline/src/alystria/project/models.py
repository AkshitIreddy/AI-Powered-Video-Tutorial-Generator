"""Dependency-free serializable project records."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass(frozen=True, slots=True)
class Manifest:
    schema_version: int
    project_id: str
    created_at: str
    database_path: str = "project.sqlite3"
    objects_path: str = "objects/sha256"
    sources_path: str = "sources/original"
    staging_path: str = "staging"
    exports_path: str = "exports"
    minimum_app_version: str = "1.8.0"
    read_only_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        value: dict[str, Any] = {
            "format": "alystria-project",
            "schemaVersion": "2.0.0",
            "projectId": self.project_id,
            "databasePath": self.database_path,
            "objectsPath": self.objects_path,
            "sourcesPath": self.sources_path,
            "stagingPath": self.staging_path,
            "exportsPath": self.exports_path,
            "createdAt": self.created_at,
            "minimumAppVersion": self.minimum_app_version,
        }
        if self.read_only_reason is not None:
            value["readOnlyReason"] = self.read_only_reason
        return value

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> Manifest:
        # The Rust desktop broker owns creation of user-visible project
        # skeletons.  Its manifest deliberately contains editor metadata in
        # addition to the storage paths used by the Python project service.
        # Accept that representation without weakening the legacy portable
        # manifest validation below.
        if "databaseRelativePath" in value:
            required = {
                "schemaVersion",
                "projectId",
                "databaseRelativePath",
                "objectStoreRelativePath",
                "sourceStoreRelativePath",
                "createdAt",
            }
            missing = required.difference(value)
            if missing:
                raise ValueError(f"Manifest is missing: {', '.join(sorted(missing))}")
            return cls(
                schema_version=int(value["schemaVersion"]),
                project_id=str(value["projectId"]),
                created_at=str(value["createdAt"]),
                database_path=str(value["databaseRelativePath"]),
                objects_path=str(value["objectStoreRelativePath"]),
                sources_path=str(value["sourceStoreRelativePath"]),
            )

        required = {
            "format",
            "schemaVersion",
            "projectId",
            "databasePath",
            "objectsPath",
            "sourcesPath",
            "stagingPath",
            "exportsPath",
            "createdAt",
            "minimumAppVersion",
        }
        missing = required.difference(value)
        if missing:
            raise ValueError(f"Manifest is missing: {', '.join(sorted(missing))}")
        if value["format"] != "alystria-project":
            raise ValueError(f"Unsupported project format: {value['format']!r}")
        return cls(
            schema_version=(
                1
                if value["schemaVersion"] == "2.0.0"
                else int(value["schemaVersion"])
            ),
            project_id=str(value["projectId"]),
            created_at=str(value["createdAt"]),
            database_path=str(value["databasePath"]),
            objects_path=str(value["objectsPath"]),
            sources_path=str(value["sourcesPath"]),
            staging_path=str(value["stagingPath"]),
            exports_path=str(value["exportsPath"]),
            minimum_app_version=str(value["minimumAppVersion"]),
            read_only_reason=value.get("readOnlyReason"),
        )


@dataclass(frozen=True, slots=True)
class Revision:
    revision_id: str
    project_id: str
    parent_revision_id: str | None
    kind: str
    name: str | None
    message: str
    snapshot: dict[str, Any]
    created_at: str
    number: int
    root_hash: str
    author: str
    approval_status: str

    def to_dict(self) -> dict[str, Any]:
        kind = {"initial": "manual", "edit": "manual"}.get(self.kind, self.kind)
        value: dict[str, Any] = {
            "id": self.revision_id,
            "projectId": self.project_id,
            "parentRevisionIds": ([] if self.parent_revision_id is None else [self.parent_revision_id]),
            "number": self.number,
            "kind": kind,
            "message": self.message or "Revision",
            "author": self.author,
            "createdAt": self.created_at,
            "rootHash": self.root_hash,
            "changes": [],
            "approvalStatus": self.approval_status,
        }
        if self.name is not None:
            value["snapshotName"] = self.name
        return value


@dataclass(frozen=True, slots=True)
class ProjectSummary:
    project_id: str
    name: str
    created_at: str
    updated_at: str
    head_revision_id: str | None
    settings: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.project_id,
            "schemaVersion": "2.0.0",
            "name": self.name,
            "status": "active",
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "headRevisionId": self.head_revision_id,
            "courseIds": [],
            "settings": self.settings,
        }
