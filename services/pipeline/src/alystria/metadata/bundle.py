"""Deterministic manifests for Alystria export bundles."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from pathlib import PurePosixPath
from typing import Any

from .models import ChapterTimestamp, PublishingMetadata, SourceListEntry
from .thumbnails import ThumbnailCandidateSpec, ThumbnailEditorData

SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class ExportFileRole(StrEnum):
    VIDEO = "video"
    AUDIO = "audio"
    CAPTIONS = "captions"
    TRANSCRIPT = "transcript"
    BIBLIOGRAPHY = "bibliography"
    THUMBNAIL = "thumbnail"
    CHAPTERS = "chapters"
    PRACTICE = "practice"
    PROVENANCE = "provenance"
    METADATA = "metadata"
    MANIFEST = "manifest"


@dataclass(frozen=True, slots=True)
class ExportedFile:
    path: str
    media_type: str
    role: ExportFileRole
    sha256: str
    byte_size: int
    locale: str | None = None

    def __post_init__(self) -> None:
        path = PurePosixPath(self.path)
        if path.is_absolute() or ".." in path.parts or not self.path.strip():
            raise ValueError("Export file paths must be safe bundle-relative paths")
        if not self.media_type.strip() or self.byte_size < 0:
            raise ValueError("Exported files require media type and non-negative byte size")
        if not SHA256_PATTERN.fullmatch(self.sha256):
            raise ValueError("Exported file sha256 must be 64 lowercase hex characters")


@dataclass(frozen=True, slots=True)
class ExportTarget:
    target_id: str
    width: int
    height: int
    fps_numerator: int
    fps_denominator: int
    codec: str
    caption_mode: str
    locale: str

    def __post_init__(self) -> None:
        if not self.target_id.strip() or self.width < 1 or self.height < 1:
            raise ValueError("Export targets require an ID and positive dimensions")
        if self.fps_numerator < 1 or self.fps_denominator < 1:
            raise ValueError("Export target FPS must be positive")
        if not self.codec.strip() or not self.caption_mode.strip() or not self.locale.strip():
            raise ValueError("Export target codec, captions and locale are required")


@dataclass(frozen=True, slots=True)
class ExportBundleManifest:
    schema_version: int
    export_id: str
    project_id: str
    course_id: str
    revision_id: str
    created_at: str
    application_version: str
    targets: tuple[ExportTarget, ...]
    files: tuple[ExportedFile, ...]
    metadata: PublishingMetadata
    locales: tuple[str, ...]
    sources: tuple[SourceListEntry, ...]
    chapters: Mapping[str, tuple[ChapterTimestamp, ...]]
    thumbnail_candidates: tuple[ThumbnailCandidateSpec, ...] = ()
    thumbnail_editor: ThumbnailEditorData | None = None
    provenance_manifest_path: str | None = None
    custom: Mapping[str, str | int | float | bool] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.schema_version < 1:
            raise ValueError("Export manifest schema_version must be positive")
        for name, value in (
            ("export_id", self.export_id),
            ("project_id", self.project_id),
            ("course_id", self.course_id),
            ("revision_id", self.revision_id),
            ("created_at", self.created_at),
            ("application_version", self.application_version),
        ):
            if not value.strip():
                raise ValueError(f"Export manifest {name} must not be blank")
        if not self.targets or not self.files or not self.locales:
            raise ValueError("Export manifests require targets, files and locales")
        errors = self.validate()
        if errors:
            raise ValueError("; ".join(errors))

    def validate(self) -> tuple[str, ...]:
        errors: list[str] = []
        paths = [item.path for item in self.files]
        if len(paths) != len(set(paths)):
            errors.append("Export file paths must be unique")
        target_ids = [target.target_id for target in self.targets]
        if len(target_ids) != len(set(target_ids)):
            errors.append("Export target IDs must be unique")
        locales = tuple(dict.fromkeys(locale.lower().replace("_", "-") for locale in self.locales))
        if len(locales) != len(self.locales):
            errors.append("Export locales must be unique after normalization")
        for target in self.targets:
            if target.locale.lower().replace("_", "-") not in locales:
                errors.append(f"Target {target.target_id} locale is absent from manifest locales")
        for locale in locales:
            errors.extend(self.metadata.validate_locale(locale))
            if locale not in self.chapters:
                errors.append(f"Manifest chapters lack {locale}")
        metadata_source_ids = {source.source_id for source in self.metadata.sources}
        manifest_source_ids = {source.source_id for source in self.sources}
        if metadata_source_ids != manifest_source_ids:
            errors.append("Manifest and publishing metadata source lists differ")
        for locale in locales:
            if self.chapters.get(locale) != self.metadata.chapters.get(locale):
                errors.append(
                    f"Manifest and publishing metadata chapters differ for {locale}"
                )
        if self.provenance_manifest_path and self.provenance_manifest_path not in paths:
            errors.append("provenance_manifest_path does not identify an exported file")
        candidate_ids = {candidate.candidate_id for candidate in self.thumbnail_candidates}
        if self.thumbnail_editor and self.thumbnail_editor.candidate_id not in candidate_ids:
            errors.append("Thumbnail editor references an absent candidate")
        return tuple(errors)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def canonical_json(self) -> str:
        return json.dumps(
            self.to_dict(),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )

    def digest(self) -> str:
        return hashlib.sha256(self.canonical_json().encode("utf-8")).hexdigest()
