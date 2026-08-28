"""Validation and safe extraction for portable ``.alytutorial`` archives."""

from __future__ import annotations

import hashlib
import io
import json
import re
import shutil
import stat
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .errors import PolicyViolation, ValidationError
from .files import (
    DEFAULT_IMPORT_LIMITS,
    ImportLimits,
    ImportQuota,
    archive_depth,
    validate_archive_path,
    validate_compression,
)

REQUIRED_MEMBERS = frozenset({"manifest.json", "project.sqlite3"})
ALLOWED_ROOTS = frozenset({"objects", "sources", "exports", "previews", "captions"})
SQLITE_MAGIC = b"SQLite format 3\x00"


@dataclass(frozen=True, slots=True)
class ArchiveMember:
    path: str
    compressed_bytes: int
    uncompressed_bytes: int
    sha256: str


@dataclass(frozen=True, slots=True)
class TutorialArchive:
    format_version: int
    project_id: str
    members: tuple[ArchiveMember, ...]
    total_uncompressed_bytes: int


class _Readable(Protocol):
    def read(self, size: int = -1) -> bytes: ...


def _read_limited(stream: _Readable, limit: int) -> bytes:
    # ZipExtFile implements read; keeping this helper structural avoids exposing
    # an arbitrary filesystem handle to validation code.
    data = stream.read(limit + 1)
    if len(data) > limit:
        raise PolicyViolation("archive member expanded beyond its declared limit")
    return data


def validate_alytutorial(
    source: bytes | bytearray | Path | str,
    *,
    limits: ImportLimits = DEFAULT_IMPORT_LIMITS,
) -> TutorialArchive:
    file_or_buffer: io.BytesIO | Path | str = (
        io.BytesIO(bytes(source)) if isinstance(source, bytes | bytearray) else source
    )
    try:
        archive = zipfile.ZipFile(file_or_buffer, "r")
    except (OSError, zipfile.BadZipFile) as exc:
        raise ValidationError("invalid .alytutorial ZIP container") from exc

    quota = ImportQuota(limits)
    members: list[ArchiveMember] = []
    seen: set[str] = set()
    manifest_data: bytes | None = None
    database_header: bytes | None = None
    with archive:
        infos = archive.infolist()
        if len(infos) > limits.max_files:
            raise PolicyViolation("archive contains too many members")
        for info in infos:
            path = validate_archive_path(info.filename.rstrip("/"))
            collision_key = path.casefold()
            if collision_key in seen:
                raise ValidationError("archive contains duplicate or case-colliding paths")
            seen.add(collision_key)
            unix_mode = info.external_attr >> 16
            if stat.S_ISLNK(unix_mode) or stat.S_ISCHR(unix_mode) or stat.S_ISBLK(unix_mode):
                raise PolicyViolation("archive contains a link or device entry")
            if info.flag_bits & 0x1:
                raise PolicyViolation("encrypted archive members are not supported")
            if info.is_dir():
                continue
            root = path.split("/", 1)[0]
            if path not in REQUIRED_MEMBERS and root not in ALLOWED_ROOTS:
                raise PolicyViolation(
                    f"archive member is outside the portable project layout: {path}"
                )
            if archive_depth(path) > limits.max_archive_depth:
                raise PolicyViolation("archive nesting exceeds the configured limit")
            validate_compression(
                compressed_bytes=info.compress_size,
                uncompressed_bytes=info.file_size,
                limits=limits,
            )
            quota = quota.consume(size=info.file_size)
            with archive.open(info, "r") as member_stream:
                data = _read_limited(member_stream, min(info.file_size, limits.max_file_bytes))
            if len(data) != info.file_size:
                raise ValidationError("archive member size differs from central directory metadata")
            digest = hashlib.sha256(data).hexdigest()
            members.append(ArchiveMember(path, info.compress_size, info.file_size, digest))
            if path == "manifest.json":
                manifest_data = data
            elif path == "project.sqlite3":
                database_header = data[: len(SQLITE_MAGIC)]

    paths = {member.path for member in members}
    missing = REQUIRED_MEMBERS - paths
    if missing:
        raise ValidationError(f"archive is missing required members: {', '.join(sorted(missing))}")
    assert manifest_data is not None
    if database_header != SQLITE_MAGIC:
        raise ValidationError("archive project database does not have a SQLite 3 header")
    try:
        manifest = json.loads(manifest_data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValidationError("archive manifest is not valid UTF-8 JSON") from exc
    if not isinstance(manifest, dict):
        raise ValidationError("archive manifest must be an object")
    format_version = manifest.get("formatVersion")
    project_id = manifest.get("projectId")
    if format_version != 2:
        raise PolicyViolation("unsupported tutorial archive format version")
    if not isinstance(project_id, str) or not re.fullmatch(
        r"[A-Za-z][A-Za-z0-9._:-]{2,127}", project_id
    ):
        raise ValidationError("archive manifest projectId is invalid")
    return TutorialArchive(format_version, project_id, tuple(members), quota.total_bytes)


def extract_alytutorial(
    source: bytes | bytearray | Path | str,
    destination: Path,
    *,
    limits: ImportLimits = DEFAULT_IMPORT_LIMITS,
) -> TutorialArchive:
    """Validate fully, then atomically promote an extracted project directory.

    ``destination`` must not already exist. Extraction first occurs in a sibling
    temporary directory, so a crash never leaves a partially valid project at
    the requested path.
    """
    validated = validate_alytutorial(source, limits=limits)
    if destination.exists():
        raise PolicyViolation("archive destination already exists")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(
        tempfile.mkdtemp(prefix=f".{destination.name}-import-", dir=destination.parent)
    )
    file_or_buffer: io.BytesIO | Path | str = (
        io.BytesIO(bytes(source)) if isinstance(source, bytes | bytearray) else source
    )
    try:
        expected = {member.path: member for member in validated.members}
        with zipfile.ZipFile(file_or_buffer, "r") as archive:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                path = validate_archive_path(info.filename)
                member = expected[path]
                target = temporary.joinpath(*path.split("/"))
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info, "r") as source_stream, target.open("xb") as target_stream:
                    digest = hashlib.sha256()
                    copied = 0
                    while chunk := source_stream.read(1024 * 1024):
                        copied += len(chunk)
                        if copied > member.uncompressed_bytes or copied > limits.max_file_bytes:
                            raise PolicyViolation("archive member exceeded its validated size")
                        digest.update(chunk)
                        target_stream.write(chunk)
                if copied != member.uncompressed_bytes or digest.hexdigest() != member.sha256:
                    raise ValidationError("archive changed between validation and extraction")
        temporary.replace(destination)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return validated
