"""Untrusted-file validation and import quotas."""

from __future__ import annotations

import io
import json
import mimetypes
import unicodedata
import zipfile
from dataclasses import dataclass, field
from pathlib import PurePosixPath, PureWindowsPath

from .errors import PolicyViolation, ValidationError

WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}

MIME_ALIASES = {
    "image/jpg": "image/jpeg",
    "application/x-zip-compressed": "application/zip",
    "text/x-markdown": "text/markdown",
    # RFC 7845 registers ``audio/ogg`` for Ogg Opus. Browsers and operating
    # systems also commonly report the non-canonical ``audio/opus`` token for
    # .opus files. Canonicalize that exact alias before the normal extension
    # and magic-byte checks; do not widen the formats an Ogg container may
    # impersonate.
    "audio/opus": "audio/ogg",
}

EXTENSION_MIMES: dict[str, frozenset[str]] = {
    ".png": frozenset({"image/png"}),
    ".jpg": frozenset({"image/jpeg"}),
    ".jpeg": frozenset({"image/jpeg"}),
    ".gif": frozenset({"image/gif"}),
    ".webp": frozenset({"image/webp"}),
    ".svg": frozenset({"image/svg+xml"}),
    ".pdf": frozenset({"application/pdf"}),
    ".docx": frozenset({"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}),
    ".pptx": frozenset({"application/vnd.openxmlformats-officedocument.presentationml.presentation"}),
    ".epub": frozenset({"application/epub+zip"}),
    ".zip": frozenset({"application/zip"}),
    ".alytutorial": frozenset({"application/zip"}),
    ".sqlite3": frozenset({"application/vnd.sqlite3"}),
    ".db": frozenset({"application/vnd.sqlite3"}),
    ".json": frozenset({"application/json"}),
    ".txt": frozenset({"text/plain"}),
    ".md": frozenset({"text/markdown", "text/plain"}),
    ".markdown": frozenset({"text/markdown", "text/plain"}),
    ".csv": frozenset({"text/csv", "text/plain"}),
    ".wav": frozenset({"audio/wav"}),
    ".mp3": frozenset({"audio/mpeg"}),
    ".flac": frozenset({"audio/flac"}),
    ".ogg": frozenset({"audio/ogg"}),
    ".opus": frozenset({"audio/ogg"}),
    ".ttf": frozenset({"font/ttf"}),
    ".otf": frozenset({"font/otf"}),
    ".woff": frozenset({"font/woff"}),
    ".woff2": frozenset({"font/woff2"}),
    ".mp4": frozenset({"video/mp4"}),
}


@dataclass(frozen=True, slots=True)
class ImportLimits:
    max_files: int = 1_000
    max_file_bytes: int = 512 * 1024 * 1024
    max_total_bytes: int = 2 * 1024 * 1024 * 1024
    max_filename_bytes: int = 240
    max_archive_depth: int = 2
    max_compression_ratio: float = 100.0

    def __post_init__(self) -> None:
        if (
            min(self.max_files, self.max_file_bytes, self.max_total_bytes, self.max_filename_bytes)
            <= 0
        ):
            raise ValueError("import limits must be positive")
        if self.max_archive_depth < 0 or self.max_compression_ratio < 1:
            raise ValueError("archive limits are invalid")


@dataclass(frozen=True, slots=True)
class ImportQuota:
    limits: ImportLimits = field(default_factory=ImportLimits)
    files: int = 0
    total_bytes: int = 0

    def consume(self, *, size: int, files: int = 1) -> ImportQuota:
        if size < 0 or files < 0:
            raise ValidationError("file count and size cannot be negative")
        next_files = self.files + files
        next_bytes = self.total_bytes + size
        if size > self.limits.max_file_bytes:
            raise PolicyViolation("individual file exceeds the import limit")
        if next_files > self.limits.max_files:
            raise PolicyViolation("import contains too many files")
        if next_bytes > self.limits.max_total_bytes:
            raise PolicyViolation("import exceeds the total uncompressed size limit")
        return ImportQuota(self.limits, next_files, next_bytes)


@dataclass(frozen=True, slots=True)
class ValidatedFile:
    filename: str
    declared_mime: str | None
    detected_mime: str
    size: int


DEFAULT_IMPORT_LIMITS = ImportLimits()


def validate_safe_filename(name: str, *, max_bytes: int = 240) -> str:
    """Return a normalized single filename, rejecting cross-platform hazards."""
    if not isinstance(name, str) or not name:
        raise ValidationError("filename must be a non-empty string")
    normalized = unicodedata.normalize("NFC", name)
    if normalized != name:
        # Callers must persist the normalized name explicitly; accepting both can
        # cause duplicate/collision behavior on macOS and Windows filesystems.
        raise ValidationError("filename must be Unicode NFC normalized")
    if len(name.encode("utf-8")) > max_bytes:
        raise ValidationError("filename is too long")
    if name in {".", ".."} or "/" in name or "\\" in name:
        raise ValidationError("filename must not contain path components")
    if name[-1] in {" ", "."}:
        raise ValidationError("filename must not end in a space or period")
    if any(ord(char) < 32 or ord(char) == 127 for char in name):
        raise ValidationError("filename contains control characters")
    if any(char in '<>:"|?*' for char in name):
        raise ValidationError("filename contains characters forbidden on Windows")
    stem = name.split(".", 1)[0].upper()
    if stem in WINDOWS_RESERVED_NAMES:
        raise ValidationError("filename is reserved on Windows")
    return name


def validate_archive_path(path: str, *, max_bytes: int = 1024) -> str:
    """Normalize an archive member to a safe POSIX-relative path."""
    if not isinstance(path, str) or not path or "\x00" in path:
        raise ValidationError("archive path is empty or contains NUL")
    if len(path.encode("utf-8")) > max_bytes:
        raise ValidationError("archive path is too long")
    normalized = unicodedata.normalize("NFC", path.replace("\\", "/"))
    raw_parts = normalized.split("/")
    if any(part in {"", ".", ".."} for part in raw_parts):
        raise ValidationError("archive path contains traversal or ambiguous segments")
    if normalized.startswith("/") or normalized.startswith("//"):
        raise ValidationError("archive path must be relative")
    windows_path = PureWindowsPath(path)
    posix_path = PurePosixPath(normalized)
    if windows_path.drive or windows_path.root or posix_path.is_absolute():
        raise ValidationError("archive path contains an absolute path or drive")
    parts = posix_path.parts
    if not parts or any(part in {"", ".", ".."} for part in parts):
        raise ValidationError("archive path contains traversal or ambiguous segments")
    for part in parts:
        validate_safe_filename(part, max_bytes=min(max_bytes, 240))
    return "/".join(parts)


def detect_mime(data: bytes) -> str:
    """Detect supported formats from magic bytes, never from the extension."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"PK\x03\x04") or data.startswith(b"PK\x05\x06"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                names = frozenset(archive.namelist())
                if "word/document.xml" in names and "[Content_Types].xml" in names:
                    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                if "ppt/presentation.xml" in names and "[Content_Types].xml" in names:
                    return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                if "mimetype" in names and archive.read("mimetype") == b"application/epub+zip":
                    return "application/epub+zip"
        except (OSError, KeyError, zipfile.BadZipFile):
            pass
        return "application/zip"
    if data.startswith(b"SQLite format 3\x00"):
        return "application/vnd.sqlite3"
    if len(data) >= 12 and data[4:8] == b"ftyp":
        return "video/mp4"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "audio/wav"
    if data.startswith(b"fLaC"):
        return "audio/flac"
    if data.startswith(b"OggS"):
        return "audio/ogg"
    if data.startswith(b"ID3") or (
        len(data) >= 2 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0
    ):
        return "audio/mpeg"
    if data.startswith(b"OTTO"):
        return "font/otf"
    if data.startswith((b"\x00\x01\x00\x00", b"true", b"typ1")):
        return "font/ttf"
    if data.startswith(b"wOFF"):
        return "font/woff"
    if data.startswith(b"wOF2"):
        return "font/woff2"

    sample = data[: 64 * 1024]
    try:
        text = sample.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValidationError("unsupported or unrecognized binary file") from exc
    stripped = text.lstrip()
    lowered = stripped[:512].lower()
    if lowered.startswith("<svg") or (lowered.startswith("<?xml") and "<svg" in lowered):
        return "image/svg+xml"
    if stripped.startswith(("{", "[")):
        try:
            json.loads(data.decode("utf-8-sig"))
            return "application/json"
        except (UnicodeDecodeError, json.JSONDecodeError):
            pass
    if "\x00" in text:
        raise ValidationError("unsupported text file containing NUL")
    return "text/plain"


def validate_file(
    filename: str,
    data: bytes,
    *,
    declared_mime: str | None = None,
    limits: ImportLimits = DEFAULT_IMPORT_LIMITS,
) -> ValidatedFile:
    filename = validate_safe_filename(filename, max_bytes=limits.max_filename_bytes)
    if len(data) > limits.max_file_bytes:
        raise PolicyViolation("file exceeds the import size limit")
    detected = detect_mime(data)
    extension = PurePosixPath(filename).suffix.lower()
    allowed = EXTENSION_MIMES.get(extension)
    if allowed is None:
        guessed, _ = mimetypes.guess_type(filename)
        raise PolicyViolation(f"unsupported file extension (guessed MIME: {guessed or 'unknown'})")
    if detected not in allowed:
        raise ValidationError(f"extension {extension} does not match detected MIME {detected}")
    normalized_declared = MIME_ALIASES.get(
        (declared_mime or "").lower(), (declared_mime or "").lower()
    )
    if normalized_declared and normalized_declared not in allowed:
        raise ValidationError("declared MIME does not match filename or magic bytes")
    return ValidatedFile(filename, normalized_declared or None, detected, len(data))


def validate_compression(
    *, compressed_bytes: int, uncompressed_bytes: int, limits: ImportLimits
) -> None:
    if compressed_bytes < 0 or uncompressed_bytes < 0:
        raise ValidationError("archive sizes cannot be negative")
    if uncompressed_bytes > limits.max_file_bytes:
        raise PolicyViolation("archive member exceeds the uncompressed file limit")
    divisor = max(compressed_bytes, 1)
    if uncompressed_bytes / divisor > limits.max_compression_ratio:
        raise PolicyViolation("archive member exceeds the maximum compression ratio")


def archive_depth(path: str) -> int:
    suffixes = (".zip", ".alytutorial", ".tar", ".tgz", ".gz", ".7z", ".rar")
    return sum(1 for part in PurePosixPath(path.lower()).parts if part.endswith(suffixes))
