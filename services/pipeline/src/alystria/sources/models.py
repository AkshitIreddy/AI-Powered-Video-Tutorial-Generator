"""Source-domain records shared by all ingestion loaders.

The ingestion layer intentionally deals in inert text and metadata.  It never
returns executable objects and it never silently relaxes privacy or retention
chosen by the caller.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from hashlib import sha256
from types import MappingProxyType
from typing import Any


class SourceKind(StrEnum):
    TOPIC = "topic"
    QUESTION = "question"
    NOTES = "notes"
    FILE = "file"
    URL = "url"
    REPOSITORY = "repository"
    SCRIPT = "script"
    PRESENTATION = "presentation"
    DATASET = "dataset"


class PrivacyClass(StrEnum):
    PUBLIC = "public"
    PROJECT_LOCAL = "project_local"
    SENSITIVE = "sensitive"
    RESTRICTED = "restricted"


class RetentionClass(StrEnum):
    PERMANENT = "permanent"
    PROJECT = "project"
    SESSION = "session"
    LINK_ONLY = "link_only"


def stable_id(prefix: str, *parts: str) -> str:
    payload = "\x1f".join(parts).encode("utf-8")
    return f"{prefix}_{sha256(payload).hexdigest()[:24]}"


@dataclass(frozen=True, slots=True)
class SourceMetadata:
    kind: SourceKind
    title: str
    locator: str
    media_type: str
    privacy: PrivacyClass = PrivacyClass.PROJECT_LOCAL
    retention: RetentionClass = RetentionClass.PROJECT
    language: str | None = None
    creator: str | None = None
    license: str | None = None
    acquired_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    attributes: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.title.strip():
            raise ValueError("source title must not be blank")
        if not self.locator.strip():
            raise ValueError("source locator must not be blank")
        object.__setattr__(self, "attributes", MappingProxyType(dict(self.attributes)))


@dataclass(frozen=True, slots=True)
class SourceDocument:
    id: str
    version_id: str
    content: str
    content_sha256: str
    metadata: SourceMetadata

    @classmethod
    def create(cls, content: str, metadata: SourceMetadata) -> SourceDocument:
        normalized = content.replace("\r\n", "\n").replace("\r", "\n")
        digest = sha256(normalized.encode("utf-8")).hexdigest()
        source_id = stable_id("src", metadata.kind.value, metadata.locator)
        return cls(
            id=source_id,
            version_id=stable_id("srcv", source_id, digest),
            content=normalized,
            content_sha256=digest,
            metadata=metadata,
        )


@dataclass(frozen=True, slots=True)
class LoadOptions:
    title: str | None = None
    privacy: PrivacyClass = PrivacyClass.PROJECT_LOCAL
    retention: RetentionClass = RetentionClass.PROJECT
    language: str | None = None
    creator: str | None = None
    license: str | None = None
    attributes: Mapping[str, Any] = field(default_factory=dict)


class SourceLoadError(ValueError):
    """A source was rejected before it entered the project evidence store."""
