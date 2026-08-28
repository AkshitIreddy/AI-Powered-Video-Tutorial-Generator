"""Bounded, format-aware source loaders."""

from __future__ import annotations

import csv
import html
import io
import json
import mimetypes
import re
import zipfile
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol
from urllib.parse import urlsplit
from xml.etree import ElementTree

from .models import (
    LoadOptions,
    PrivacyClass,
    RetentionClass,
    SourceDocument,
    SourceKind,
    SourceLoadError,
    SourceMetadata,
)
from .safety import SafeHttpTransport, resolve_safe_path

MAX_INLINE_CHARS = 1_000_000
TEXT_SUFFIXES = {
    ".txt", ".md", ".rst", ".py", ".js", ".jsx", ".ts", ".tsx", ".rs",
    ".go", ".java", ".c", ".h", ".cpp", ".hpp", ".css", ".html", ".xml",
    ".yaml", ".yml", ".toml", ".ini", ".sql", ".sh", ".ps1", ".vtt", ".srt",
}


def _slide_number(name: str) -> int:
    match = re.search(r"(\d+)", name)
    if match is None:
        raise SourceLoadError("presentation contains an invalid slide filename")
    return int(match.group(1))


class SourceLoader(Protocol):
    kind: SourceKind


@dataclass(frozen=True, slots=True)
class FileExtractionResult:
    text: str
    media_type: str
    attributes: Mapping[str, object] = field(default_factory=dict)


class DocumentExtractor(Protocol):
    """Interface for a quarantined document-parser worker such as Docling."""

    def extract(self, path: Path, *, max_chars: int) -> FileExtractionResult: ...


def _metadata(
    kind: SourceKind,
    title: str,
    locator: str,
    media_type: str,
    options: LoadOptions,
    **attributes: object,
) -> SourceMetadata:
    merged = dict(options.attributes)
    merged.update(attributes)
    return SourceMetadata(
        kind=kind,
        title=options.title or title,
        locator=locator,
        media_type=media_type,
        privacy=options.privacy,
        retention=options.retention,
        language=options.language,
        creator=options.creator,
        license=options.license,
        attributes=merged,
    )


@dataclass(slots=True)
class InlineTextLoader:
    kind: SourceKind
    default_title: str

    def load(self, text: str, options: LoadOptions | None = None) -> SourceDocument:
        options = options or LoadOptions()
        value = text.strip()
        if not value:
            raise SourceLoadError(f"{self.kind.value} source must not be blank")
        if len(value) > MAX_INLINE_CHARS:
            raise SourceLoadError(f"{self.kind.value} source exceeds the character limit")
        locator = f"inline:{self.kind.value}"
        return SourceDocument.create(
            value,
            _metadata(self.kind, self.default_title, locator, "text/plain", options),
        )


class TopicLoader(InlineTextLoader):
    def __init__(self) -> None:
        super().__init__(SourceKind.TOPIC, "Tutorial topic")


class QuestionLoader(InlineTextLoader):
    def __init__(self) -> None:
        super().__init__(SourceKind.QUESTION, "Learner question")


class NotesLoader(InlineTextLoader):
    def __init__(self) -> None:
        super().__init__(SourceKind.NOTES, "Project notes")


class ScriptLoader(InlineTextLoader):
    def __init__(self) -> None:
        super().__init__(SourceKind.SCRIPT, "Narration script")


@dataclass(slots=True)
class FileLoader:
    allowed_roots: tuple[Path, ...]
    max_bytes: int = 25 * 1024 * 1024
    max_extracted_chars: int = 2_000_000
    extractors: Mapping[str, DocumentExtractor] = field(default_factory=dict)
    kind: SourceKind = SourceKind.FILE

    def load(self, path: str | Path, options: LoadOptions | None = None) -> SourceDocument:
        options = options or LoadOptions()
        safe = resolve_safe_path(path, self.allowed_roots)
        if not safe.is_file():
            raise SourceLoadError("file source is not a regular file")
        suffix = safe.suffix.lower()
        if suffix not in TEXT_SUFFIXES and suffix not in self.extractors:
            raise SourceLoadError(f"unsupported file type: {safe.suffix or '(none)'}")
        size = safe.stat().st_size
        if size > self.max_bytes:
            raise SourceLoadError("file source exceeds the configured byte limit")
        attributes: dict[str, object] = {"byte_count": size}
        if suffix in TEXT_SUFFIXES:
            raw = safe.read_bytes()
            if b"\x00" in raw:
                raise SourceLoadError("binary content is not accepted by the text loader")
            try:
                content = raw.decode("utf-8-sig")
            except UnicodeDecodeError as exc:
                raise SourceLoadError("text source must be UTF-8") from exc
            media_type = mimetypes.guess_type(safe.name)[0] or "text/plain"
        else:
            extracted = self.extractors[suffix].extract(
                safe,
                max_chars=self.max_extracted_chars,
            )
            content = extracted.text
            media_type = extracted.media_type
            attributes.update(extracted.attributes)
            attributes["extractor_boundary"] = "quarantined_worker"
        if not content.strip():
            raise SourceLoadError("file source produced no extractable text")
        if len(content) > self.max_extracted_chars:
            raise SourceLoadError("extracted file text exceeds the configured limit")
        return SourceDocument.create(
            content,
            _metadata(self.kind, safe.stem, str(safe), media_type, options, **attributes),
        )


@dataclass(slots=True)
class UrlLoader:
    transport: SafeHttpTransport
    max_decoded_chars: int = 2_000_000
    kind: SourceKind = SourceKind.URL

    def load(self, url: str, options: LoadOptions | None = None) -> SourceDocument:
        options = options or LoadOptions(
            privacy=PrivacyClass.PUBLIC,
            retention=RetentionClass.LINK_ONLY,
        )
        response = self.transport.get(url)
        content_type = response.headers.get("content-type", "text/plain").split(";", 1)[0].lower()
        if content_type not in {
            "text/plain", "text/markdown", "text/html", "application/json",
            "application/xml", "text/xml",
        }:
            raise SourceLoadError(f"unsupported URL content type: {content_type}")
        charset_match = re.search(
            r"charset=([\w.-]+)",
            response.headers.get("content-type", ""),
            re.I,
        )
        charset = charset_match.group(1) if charset_match else "utf-8"
        try:
            text = response.body.decode(charset)
        except (LookupError, UnicodeDecodeError) as exc:
            raise SourceLoadError("URL response is not valid text") from exc
        if len(text) > self.max_decoded_chars:
            raise SourceLoadError("decoded URL content exceeds the configured limit")
        if content_type == "text/html":
            text = _html_to_text(text)
        elif content_type == "application/json":
            try:
                text = json.dumps(json.loads(text), ensure_ascii=False, indent=2, sort_keys=True)
            except json.JSONDecodeError as exc:
                raise SourceLoadError("URL declared JSON but returned invalid JSON") from exc
        parsed = urlsplit(response.url)
        title = parsed.path.rstrip("/").rsplit("/", 1)[-1] or parsed.hostname or "Web source"
        return SourceDocument.create(
            text,
            _metadata(
                self.kind,
                title,
                response.url,
                content_type,
                options,
                http_status=response.status,
                final_url=response.url,
            ),
        )


def _html_to_text(value: str) -> str:
    value = re.sub(r"(?is)<(script|style|noscript).*?>.*?</\1>", " ", value)
    value = re.sub(r"(?i)</?(p|div|section|article|h[1-6]|li|br|tr|blockquote)[^>]*>", "\n", value)
    value = re.sub(r"(?s)<[^>]+>", " ", value)
    lines = (re.sub(r"[ \t]+", " ", html.unescape(line)).strip() for line in value.splitlines())
    return "\n".join(line for line in lines if line)


@dataclass(slots=True)
class RepositoryLoader:
    allowed_roots: tuple[Path, ...]
    suffixes: frozenset[str] = frozenset(TEXT_SUFFIXES)
    max_files: int = 500
    max_total_bytes: int = 10 * 1024 * 1024
    kind: SourceKind = SourceKind.REPOSITORY

    def load(self, path: str | Path, options: LoadOptions | None = None) -> SourceDocument:
        options = options or LoadOptions()
        root = resolve_safe_path(path, self.allowed_roots)
        if not root.is_dir():
            raise SourceLoadError("repository source must be a directory")
        chunks: list[str] = []
        total = 0
        count = 0
        skipped = {".git", ".hg", ".svn", "node_modules", "target", ".venv", "dist", "build"}
        for candidate in sorted(root.rglob("*")):
            if any(part in skipped for part in candidate.relative_to(root).parts):
                continue
            if candidate.is_symlink():
                continue
            if not candidate.is_file() or candidate.suffix.lower() not in self.suffixes:
                continue
            count += 1
            if count > self.max_files:
                raise SourceLoadError("repository source exceeds the file-count limit")
            size = candidate.stat().st_size
            total += size
            if total > self.max_total_bytes:
                raise SourceLoadError("repository source exceeds the total byte limit")
            raw = candidate.read_bytes()
            if b"\x00" in raw:
                continue
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                continue
            relative = candidate.relative_to(root).as_posix()
            chunks.append(f"--- FILE: {relative} ---\n{text.rstrip()}\n")
        if not chunks:
            raise SourceLoadError("repository source contains no supported text files")
        return SourceDocument.create(
            "\n".join(chunks),
            _metadata(
                self.kind,
                root.name,
                str(root),
                "text/x-source-tree",
                options,
                file_count=len(chunks),
                byte_count=total,
            ),
        )


@dataclass(slots=True)
class PresentationLoader:
    allowed_roots: tuple[Path, ...]
    max_archive_bytes: int = 50 * 1024 * 1024
    max_uncompressed_bytes: int = 100 * 1024 * 1024
    max_slides: int = 500
    kind: SourceKind = SourceKind.PRESENTATION

    def load(self, path: str | Path, options: LoadOptions | None = None) -> SourceDocument:
        options = options or LoadOptions()
        safe = resolve_safe_path(path, self.allowed_roots)
        if safe.suffix.lower() not in {".pptx", ".md", ".txt"}:
            raise SourceLoadError("presentation source must be PPTX, Markdown, or text")
        if safe.stat().st_size > self.max_archive_bytes:
            raise SourceLoadError("presentation exceeds the configured byte limit")
        if safe.suffix.lower() != ".pptx":
            content = safe.read_text(encoding="utf-8-sig")
            slide_count = max(1, content.count("\n---\n") + 1)
        else:
            content, slide_count = self._read_pptx(safe)
        return SourceDocument.create(
            content,
            _metadata(
                self.kind,
                safe.stem,
                str(safe),
                (
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    if safe.suffix.lower() == ".pptx"
                    else "text/markdown" if safe.suffix.lower() == ".md" else "text/plain"
                ),
                options,
                slide_count=slide_count,
            ),
        )

    def _read_pptx(self, path: Path) -> tuple[str, int]:
        try:
            archive = zipfile.ZipFile(path)
        except zipfile.BadZipFile as exc:
            raise SourceLoadError("presentation is not a valid PPTX archive") from exc
        with archive:
            members = archive.infolist()
            if sum(item.file_size for item in members) > self.max_uncompressed_bytes:
                raise SourceLoadError("presentation expands beyond the safety limit")
            names = sorted(
                (
                    item.filename
                    for item in members
                    if re.fullmatch(r"ppt/slides/slide\d+\.xml", item.filename)
                ),
                key=_slide_number,
            )
            if not names or len(names) > self.max_slides:
                raise SourceLoadError("presentation has an invalid slide count")
            rendered: list[str] = []
            for index, name in enumerate(names, 1):
                raw = archive.read(name)
                if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
                    raise SourceLoadError("presentation XML entities are not allowed")
                try:
                    root = ElementTree.fromstring(raw)
                except ElementTree.ParseError as exc:
                    raise SourceLoadError("presentation contains invalid slide XML") from exc
                texts = [
                    node.text.strip()
                    for node in root.iter()
                    if node.tag.endswith("}t") and node.text and node.text.strip()
                ]
                rendered.append(f"## Slide {index}\n" + "\n".join(texts))
            return "\n\n".join(rendered), len(names)


@dataclass(slots=True)
class DatasetLoader:
    allowed_roots: tuple[Path, ...]
    max_bytes: int = 25 * 1024 * 1024
    max_rows: int = 10_000
    preview_rows: int = 200
    kind: SourceKind = SourceKind.DATASET

    def load(self, path: str | Path, options: LoadOptions | None = None) -> SourceDocument:
        options = options or LoadOptions()
        safe = resolve_safe_path(path, self.allowed_roots)
        if safe.suffix.lower() not in {".csv", ".json", ".jsonl"}:
            raise SourceLoadError("dataset source must be CSV, JSON, or JSONL")
        if safe.stat().st_size > self.max_bytes:
            raise SourceLoadError("dataset exceeds the configured byte limit")
        try:
            raw_text = safe.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError as exc:
            raise SourceLoadError("dataset must be UTF-8") from exc
        rows: list[object]
        columns: list[str]
        if safe.suffix.lower() == ".csv":
            reader = csv.DictReader(io.StringIO(raw_text))
            columns = list(reader.fieldnames or [])
            rows = []
            row_count = 0
            for index, row in enumerate(reader, 1):
                if index > self.max_rows:
                    raise SourceLoadError("dataset exceeds the row limit")
                row_count = index
                if index <= self.preview_rows:
                    rows.append(dict(row))
        else:
            try:
                parsed = (
                    [json.loads(line) for line in raw_text.splitlines() if line.strip()]
                    if safe.suffix.lower() == ".jsonl"
                    else json.loads(raw_text)
                )
            except json.JSONDecodeError as exc:
                raise SourceLoadError("dataset contains invalid JSON") from exc
            if isinstance(parsed, dict):
                parsed = [parsed]
            if not isinstance(parsed, list):
                raise SourceLoadError("JSON dataset must be an object or array")
            if len(parsed) > self.max_rows:
                raise SourceLoadError("dataset exceeds the row limit")
            row_count = len(parsed)
            rows = parsed[: self.preview_rows]
            columns = sorted({str(key) for row in rows if isinstance(row, dict) for key in row})
        preview = json.dumps(rows, ensure_ascii=False, indent=2, sort_keys=True)
        return SourceDocument.create(
            preview,
            _metadata(
                self.kind,
                safe.stem,
                str(safe),
                "application/vnd.alystria.dataset-preview+json",
                options,
                row_count=row_count,
                columns=columns,
                preview_rows=len(rows),
                truncated=row_count > len(rows),
            ),
        )


class LoaderRegistry:
    def __init__(self, loaders: Iterable[SourceLoader] = ()) -> None:
        self._loaders: dict[SourceKind, SourceLoader] = {}
        for loader in loaders:
            self.register(loader)

    def register(self, loader: SourceLoader) -> None:
        if loader.kind in self._loaders:
            raise ValueError(f"loader already registered for {loader.kind.value}")
        self._loaders[loader.kind] = loader

    def get(self, kind: SourceKind) -> SourceLoader:
        try:
            return self._loaders[kind]
        except KeyError as exc:
            raise SourceLoadError(f"no loader registered for {kind.value}") from exc


def default_loaders(
    allowed_roots: tuple[Path, ...],
    transport: SafeHttpTransport,
) -> LoaderRegistry:
    return LoaderRegistry(
        [
            TopicLoader(), QuestionLoader(), NotesLoader(), ScriptLoader(),
            FileLoader(allowed_roots), UrlLoader(transport), RepositoryLoader(allowed_roots),
            PresentationLoader(allowed_roots), DatasetLoader(allowed_roots),
        ]
    )
