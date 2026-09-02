"""Optional Docling document extraction behind a disposable process boundary.

The pipeline intentionally does not import Docling in its long-lived service
process.  Document conversion runs in a child Python process with a minimal
environment, a private working directory, a deadline, and a bounded JSON result.
This is process isolation rather than an operating-system security sandbox; the
privileged desktop broker remains responsible for applying stronger platform
sandboxing when it launches the pipeline runtime.
"""

from __future__ import annotations

import argparse
import importlib
import importlib.metadata
import json
import mimetypes
import os
import subprocess
import sys
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, cast

from .loaders import DocumentExtractor, FileExtractionResult
from .models import SourceLoadError

DOCLING_SUFFIXES = frozenset(
    {
        ".bmp",
        ".docx",
        ".heic",
        ".jpeg",
        ".jpg",
        ".pdf",
        ".png",
        ".pptx",
        ".tif",
        ".tiff",
        ".webp",
        ".xlsx",
    }
)

_WORKER_CODE = "from alystria.sources.docling import worker_main; raise SystemExit(worker_main())"
_RESULT_OVERHEAD_BYTES = 64 * 1024
_PRESERVED_ENVIRONMENT = frozenset(
    {
        "APPDATA",
        "DOCLING_ARTIFACTS_PATH",
        "HF_HOME",
        "HOME",
        "LOCALAPPDATA",
        "OMP_NUM_THREADS",
        "PATH",
        "PATHEXT",
        "SYSTEMROOT",
        "TEMP",
        "TMP",
        "TMPDIR",
        "USERPROFILE",
        "WINDIR",
        "XDG_CACHE_HOME",
    }
)


class DoclingUnavailableError(SourceLoadError):
    """Docling is not installed in the configured extraction runtime."""


class DoclingExtractionError(SourceLoadError):
    """Docling was available but could not safely produce an extraction."""


class _DoclingDocument(Protocol):
    def export_to_markdown(self) -> str: ...


class _ConversionResult(Protocol):
    document: _DoclingDocument
    pages: object
    status: object


class _DocumentConverter(Protocol):
    def convert(
        self,
        source: Path,
        *,
        raises_on_error: bool,
        max_file_size: int,
    ) -> _ConversionResult: ...


class _ConverterFactory(Protocol):
    def __call__(self) -> _DocumentConverter: ...


@dataclass(frozen=True, slots=True)
class _WorkerResult:
    text: str
    media_type: str
    attributes: Mapping[str, object]


def _safe_environment(package_root: Path) -> dict[str, str]:
    environment = {
        key: value for key, value in os.environ.items() if key.upper() in _PRESERVED_ENVIRONMENT
    }
    environment.update(
        {
            "PYTHONIOENCODING": "utf-8",
            "PYTHONPATH": str(package_root),
            "PYTHONUTF8": "1",
        }
    )
    return environment


def _load_converter() -> tuple[_ConverterFactory, str]:
    try:
        module = importlib.import_module("docling.document_converter")
        converter = cast(_ConverterFactory, module.DocumentConverter)
        version = importlib.metadata.version("docling")
    except (ImportError, AttributeError, importlib.metadata.PackageNotFoundError) as exc:
        raise DoclingUnavailableError(
            "Docling document extraction is unavailable; install "
            "'alystria-pipeline[documents]' in the pipeline runtime"
        ) from exc
    return converter, version


def _status_value(status: object) -> str:
    value = getattr(status, "value", status)
    return str(value)


def _page_count(pages: object) -> int | None:
    if isinstance(pages, Sequence):
        return len(pages)
    if isinstance(pages, Mapping):
        return len(pages)
    return None


def _convert_document(
    path: Path,
    *,
    max_chars: int,
    converter_factory: _ConverterFactory | None = None,
    docling_version: str | None = None,
) -> _WorkerResult:
    if converter_factory is None:
        converter_factory, docling_version = _load_converter()
    if docling_version is None:
        docling_version = "unknown"
    try:
        result = converter_factory().convert(
            path,
            raises_on_error=True,
            max_file_size=path.stat().st_size,
        )
        text = result.document.export_to_markdown()
    except DoclingUnavailableError:
        raise
    except Exception as exc:
        raise DoclingExtractionError(
            f"Docling could not parse the document ({type(exc).__name__})"
        ) from exc
    if not isinstance(text, str):
        raise DoclingExtractionError("Docling returned non-text document content")
    if len(text) > max_chars:
        raise DoclingExtractionError("Docling extraction exceeds the configured character limit")
    attributes: dict[str, object] = {
        "extractor": "docling",
        "extractor_version": docling_version,
        "conversion_status": _status_value(result.status),
    }
    page_count = _page_count(result.pages)
    if page_count is not None:
        attributes["page_count"] = page_count
    return _WorkerResult(
        text=text,
        media_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
        attributes=attributes,
    )


def _write_payload(path: Path, payload: Mapping[str, object]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temporary.replace(path)


def worker_main(argv: Sequence[str] | None = None) -> int:
    """Run one conversion request in the disposable worker process."""
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--max-chars", required=True, type=int)
    arguments = parser.parse_args(argv)
    try:
        if arguments.max_chars < 1:
            raise DoclingExtractionError("Docling character limit must be positive")
        result = _convert_document(arguments.input, max_chars=arguments.max_chars)
        payload: Mapping[str, object] = {
            "ok": True,
            "text": result.text,
            "media_type": result.media_type,
            "attributes": dict(result.attributes),
        }
        exit_code = 0
    except DoclingUnavailableError as exc:
        payload = {"ok": False, "code": "unavailable", "message": str(exc)}
        exit_code = 20
    except (DoclingExtractionError, OSError) as exc:
        payload = {"ok": False, "code": "extraction_failed", "message": str(exc)}
        exit_code = 21
    _write_payload(arguments.output, payload)
    return exit_code


@dataclass(frozen=True, slots=True)
class DoclingExtractor(DocumentExtractor):
    """Extract structured Markdown using Docling in a bounded child process."""

    python_executable: Path = Path(sys.executable)
    timeout_seconds: float = 300.0

    def extract(self, path: Path, *, max_chars: int) -> FileExtractionResult:
        if max_chars < 1:
            raise DoclingExtractionError("Docling character limit must be positive")
        if path.is_symlink():
            raise DoclingExtractionError("Docling input must be a regular non-symbolic-link file")
        source = path.resolve(strict=True)
        if not source.is_file():
            raise DoclingExtractionError("Docling input must be a regular non-symbolic-link file")
        if source.suffix.lower() not in DOCLING_SUFFIXES:
            raise DoclingExtractionError(
                f"Docling does not accept {source.suffix or '(none)'} files"
            )
        executable = self.python_executable.resolve(strict=True)
        package_root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(prefix="alystria-docling-") as directory:
            work = Path(directory)
            output = work / "result.json"
            command = (
                str(executable),
                "-c",
                _WORKER_CODE,
                "--input",
                str(source),
                "--output",
                str(output),
                "--max-chars",
                str(max_chars),
            )
            try:
                completed = subprocess.run(
                    command,
                    cwd=work,
                    env=_safe_environment(package_root),
                    check=False,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=self.timeout_seconds,
                    creationflags=int(getattr(subprocess, "CREATE_NO_WINDOW", 0)),
                )
            except subprocess.TimeoutExpired as exc:
                raise DoclingExtractionError(
                    f"Docling extraction timed out after {self.timeout_seconds:g} seconds"
                ) from exc
            except OSError as exc:
                raise DoclingUnavailableError(
                    "Docling worker could not start; verify the configured pipeline Python runtime"
                ) from exc
            payload = self._read_result(output, max_chars=max_chars)
            if payload.get("ok") is not True:
                message = payload.get("message")
                detail = message if isinstance(message, str) else "Docling worker failed"
                if payload.get("code") == "unavailable":
                    raise DoclingUnavailableError(detail)
                raise DoclingExtractionError(detail)
            if completed.returncode != 0:
                raise DoclingExtractionError(
                    f"Docling worker exited unexpectedly with code {completed.returncode}"
                )
            return self._decode_success(payload, max_chars=max_chars)

    @staticmethod
    def _read_result(path: Path, *, max_chars: int) -> dict[str, object]:
        if not path.is_file():
            raise DoclingExtractionError(
                "Docling worker produced no result; the optional runtime may be incomplete"
            )
        maximum_bytes = max_chars * 4 + _RESULT_OVERHEAD_BYTES
        if path.stat().st_size > maximum_bytes:
            raise DoclingExtractionError("Docling worker result exceeds the IPC size limit")
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise DoclingExtractionError("Docling worker returned an invalid result") from exc
        if not isinstance(payload, dict):
            raise DoclingExtractionError("Docling worker returned an invalid result")
        return cast(dict[str, object], payload)

    @staticmethod
    def _decode_success(payload: Mapping[str, object], *, max_chars: int) -> FileExtractionResult:
        text = payload.get("text")
        media_type = payload.get("media_type")
        attributes = payload.get("attributes")
        if (
            not isinstance(text, str)
            or not isinstance(media_type, str)
            or not isinstance(attributes, dict)
        ):
            raise DoclingExtractionError("Docling worker returned an invalid success result")
        if len(text) > max_chars:
            raise DoclingExtractionError(
                "Docling extraction exceeds the configured character limit"
            )
        clean_attributes: dict[str, object] = {}
        for key, value in attributes.items():
            if not isinstance(key, str) or not isinstance(
                value, str | int | float | bool | type(None)
            ):
                raise DoclingExtractionError("Docling worker returned invalid extraction metadata")
            clean_attributes[key] = value
        return FileExtractionResult(text, media_type, clean_attributes)


def docling_extractors(
    extractor: DocumentExtractor | None = None,
) -> Mapping[str, DocumentExtractor]:
    """Return a suffix map suitable for :class:`FileLoader`.

    Creating this mapping does not import or initialize Docling.  If the optional
    dependency is absent, the first supported document load fails with a focused
    ``DoclingUnavailableError`` while all stdlib loaders continue to work.
    """
    selected = extractor or DoclingExtractor()
    return {suffix: selected for suffix in sorted(DOCLING_SUFFIXES)}


if __name__ == "__main__":  # pragma: no cover - exercised through the parent boundary
    raise SystemExit(worker_main())
