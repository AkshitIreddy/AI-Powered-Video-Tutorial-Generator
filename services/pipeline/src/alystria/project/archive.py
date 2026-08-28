"""Safe, portable `.alytutorial` archives."""

from __future__ import annotations

import os
import shutil
import stat
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from .cas import ContentAddressedStore
from .database import backup_database
from .errors import ArchiveLimitError, InvalidProjectError, ProjectExistsError, UnsafePathError
from .store import DATABASE_NAME, MANIFEST_NAME, ProjectStore


@dataclass(frozen=True, slots=True)
class ArchiveLimits:
    max_files: int = 25_000
    max_file_bytes: int = 8 * 1024**3
    max_total_bytes: int = 64 * 1024**3
    max_compression_ratio: int = 250


def _archive_files(root: Path) -> list[Path]:
    included: list[Path] = [root / MANIFEST_NAME]
    for directory_name in ("objects", "sources"):
        directory = root / directory_name
        if directory.exists():
            included.extend(
                path for path in directory.rglob("*") if path.is_file() and not path.is_symlink()
            )
    return sorted(included, key=lambda path: path.relative_to(root).as_posix())


def export_project(
    store: ProjectStore,
    destination: Path,
    *,
    overwrite: bool = False,
) -> Path:
    destination = destination.absolute()
    if destination.suffix.lower() != ".alytutorial":
        destination = destination.with_suffix(".alytutorial")
    if destination.exists() and not overwrite:
        raise ProjectExistsError(f"Archive already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
    )
    os.close(file_descriptor)
    temporary = Path(temporary_name)
    database_descriptor, database_name = tempfile.mkstemp(prefix="alystria-db-", suffix=".sqlite3")
    os.close(database_descriptor)
    database_copy = Path(database_name)
    try:
        backup_database(store.connection, database_copy)
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for source in _archive_files(store.root):
                archive.write(source, source.relative_to(store.root).as_posix())
            archive.write(database_copy, DATABASE_NAME)
        os.replace(temporary, destination)
        return destination
    finally:
        temporary.unlink(missing_ok=True)
        database_copy.unlink(missing_ok=True)


def _safe_member_path(name: str) -> PurePosixPath:
    value = PurePosixPath(name)
    if not name or name.startswith(("/", "\\")) or value.is_absolute():
        raise UnsafePathError(f"Archive contains an absolute path: {name!r}")
    if any(part in {"", ".", ".."} for part in value.parts):
        raise UnsafePathError(f"Archive contains an unsafe path: {name!r}")
    if value.parts[0].endswith(":") or "\\" in name:
        raise UnsafePathError(f"Archive contains a platform-specific path: {name!r}")
    return value


def import_project(
    archive_path: Path,
    destination: Path,
    *,
    limits: ArchiveLimits | None = None,
) -> ProjectStore:
    limits = limits or ArchiveLimits()
    archive_path = archive_path.resolve(strict=True)
    destination = destination.absolute()
    if destination.exists():
        raise ProjectExistsError(f"Project path already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{destination.name}.importing-", dir=destination.parent))
    try:
        with zipfile.ZipFile(archive_path, "r") as archive:
            members = archive.infolist()
            if len(members) > limits.max_files:
                raise ArchiveLimitError(f"Archive contains more than {limits.max_files} entries")
            total = 0
            seen: set[PurePosixPath] = set()
            for member in members:
                relative = _safe_member_path(member.filename.rstrip("/"))
                if relative in seen:
                    raise InvalidProjectError(f"Duplicate archive member: {relative}")
                seen.add(relative)
                mode = member.external_attr >> 16
                if stat.S_ISLNK(mode):
                    raise UnsafePathError(f"Archive contains a symbolic link: {relative}")
                if member.file_size > limits.max_file_bytes:
                    raise ArchiveLimitError(f"Archive member exceeds size limit: {relative}")
                total += member.file_size
                if total > limits.max_total_bytes:
                    raise ArchiveLimitError("Archive exceeds total expanded size limit")
                if member.compress_size and member.file_size / member.compress_size > limits.max_compression_ratio:
                    raise ArchiveLimitError(f"Suspicious compression ratio for {relative}")
                output = staging.joinpath(*relative.parts)
                if member.is_dir():
                    output.mkdir(parents=True, exist_ok=True)
                    continue
                output.parent.mkdir(parents=True, exist_ok=True)
                written = 0
                with archive.open(member, "r") as source, output.open("xb") as target:
                    while chunk := source.read(1024 * 1024):
                        written += len(chunk)
                        if written > member.file_size or written > limits.max_file_bytes:
                            raise ArchiveLimitError(f"Expanded member exceeded declared size: {relative}")
                        target.write(chunk)
                if written != member.file_size:
                    raise InvalidProjectError(f"Truncated archive member: {relative}")
        if not (staging / MANIFEST_NAME).is_file() or not (staging / DATABASE_NAME).is_file():
            raise InvalidProjectError("Archive does not contain an Alystria project")
        for directory_relative in (
            "objects/sha256",
            "sources/original",
            "staging",
            "exports",
            "backups",
        ):
            (staging / directory_relative).mkdir(parents=True, exist_ok=True)
        validation = ProjectStore.open(staging)
        try:
            object_store = ContentAddressedStore(staging)
            for row in validation.connection.execute("SELECT hash FROM artifacts"):
                if not object_store.verify(row["hash"]):
                    raise InvalidProjectError(f"Archive object is missing or corrupt: {row['hash']}")
        finally:
            validation.close()
        os.replace(staging, destination)
        return ProjectStore.open(destination)
    except BaseException:
        if staging.exists():
            shutil.rmtree(staging)
        raise
