"""Immutable SHA-256 content-addressed object storage."""

from __future__ import annotations

import hashlib
import mimetypes
import os
import shutil
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, BinaryIO

from .errors import InvalidProjectError


@dataclass(frozen=True, slots=True)
class Artifact:
    hash: str
    byte_size: int
    media_type: str
    original_name: str | None = None
    metadata: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ContentAddressedStore:
    """Writes immutable objects through a same-filesystem staging directory."""

    def __init__(self, project_root: Path) -> None:
        self.project_root = project_root.resolve()
        self.object_root = self.project_root / "objects" / "sha256"
        self.staging_root = self.project_root / "staging" / "cas"
        self.object_root.mkdir(parents=True, exist_ok=True)
        self.staging_root.mkdir(parents=True, exist_ok=True)

    def object_path(self, digest: str) -> Path:
        if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
            raise ValueError("A SHA-256 digest must be 64 lowercase hexadecimal characters")
        return self.object_root / digest[:2] / digest[2:]

    def add_bytes(
        self,
        content: bytes,
        *,
        media_type: str = "application/octet-stream",
        original_name: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Artifact:
        with tempfile.NamedTemporaryFile(dir=self.staging_root, delete=False) as temporary:
            temporary.write(content)
            temporary.flush()
            os.fsync(temporary.fileno())
            staging_path = Path(temporary.name)
        return self._promote(
            staging_path,
            media_type=media_type,
            original_name=original_name,
            metadata=metadata,
        )

    def add_file(
        self,
        source: Path,
        *,
        media_type: str | None = None,
        original_name: str | None = None,
        metadata: dict[str, Any] | None = None,
        max_bytes: int | None = None,
    ) -> Artifact:
        source = source.resolve(strict=True)
        if not source.is_file() or source.is_symlink():
            raise InvalidProjectError("Only regular, non-symlink files may enter the object store")
        with source.open("rb") as stream:
            return self.add_stream(
                stream,
                media_type=media_type or mimetypes.guess_type(source.name)[0] or "application/octet-stream",
                original_name=original_name or source.name,
                metadata=metadata,
                max_bytes=max_bytes,
            )

    def add_stream(
        self,
        stream: BinaryIO,
        *,
        media_type: str = "application/octet-stream",
        original_name: str | None = None,
        metadata: dict[str, Any] | None = None,
        max_bytes: int | None = None,
    ) -> Artifact:
        size = 0
        with tempfile.NamedTemporaryFile(dir=self.staging_root, delete=False) as temporary:
            staging_path = Path(temporary.name)
            try:
                while chunk := stream.read(1024 * 1024):
                    size += len(chunk)
                    if max_bytes is not None and size > max_bytes:
                        raise InvalidProjectError(f"Artifact exceeds the {max_bytes}-byte import limit")
                    temporary.write(chunk)
                temporary.flush()
                os.fsync(temporary.fileno())
            except BaseException:
                temporary.close()
                staging_path.unlink(missing_ok=True)
                raise
        return self._promote(
            staging_path,
            media_type=media_type,
            original_name=original_name,
            metadata=metadata,
        )

    def _promote(
        self,
        staging_path: Path,
        *,
        media_type: str,
        original_name: str | None,
        metadata: dict[str, Any] | None,
    ) -> Artifact:
        digest = hashlib.sha256()
        byte_size = 0
        with staging_path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
                byte_size += len(chunk)
        hexadecimal = digest.hexdigest()
        destination = self.object_path(hexadecimal)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            staging_path.unlink(missing_ok=True)
            if destination.stat().st_size != byte_size or self.hash_file(destination) != hexadecimal:
                raise InvalidProjectError(f"Object collision or corruption for {hexadecimal}")
        else:
            os.replace(staging_path, destination)
        return Artifact(hexadecimal, byte_size, media_type, original_name, metadata or {})

    def open(self, digest: str) -> BinaryIO:
        return self.object_path(digest).open("rb")

    def verify(self, digest: str) -> bool:
        path = self.object_path(digest)
        return path.is_file() and self.hash_file(path) == digest

    @staticmethod
    def hash_file(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
        return digest.hexdigest()

    def copy_to(self, digest: str, destination: Path) -> None:
        source = self.object_path(digest)
        if not self.verify(digest):
            raise InvalidProjectError(f"Object {digest} is missing or corrupt")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
