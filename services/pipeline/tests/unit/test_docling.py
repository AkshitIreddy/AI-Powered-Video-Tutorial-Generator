from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from alystria.sources import (
    DOCLING_SUFFIXES,
    DoclingExtractionError,
    DoclingExtractor,
    DoclingUnavailableError,
    docling_extractors,
)
from alystria.sources.docling import _convert_document


class FakeDocument:
    def __init__(self, text: str) -> None:
        self.text = text

    def export_to_markdown(self) -> str:
        return self.text


class FakeConverter:
    def __init__(self, text: str = "# Extracted\n\nStructured text") -> None:
        self.text = text
        self.calls: list[tuple[Path, bool, int]] = []

    def convert(
        self,
        source: Path,
        *,
        raises_on_error: bool,
        max_file_size: int,
    ) -> SimpleNamespace:
        self.calls.append((source, raises_on_error, max_file_size))
        return SimpleNamespace(
            document=FakeDocument(self.text),
            pages=[object(), object()],
            status=SimpleNamespace(value="success"),
        )


def test_worker_conversion_uses_docling_and_preserves_structural_metadata(tmp_path: Path) -> None:
    source = tmp_path / "paper.pdf"
    source.write_bytes(b"%PDF fixture")
    converter = FakeConverter()

    result = _convert_document(
        source,
        max_chars=10_000,
        converter_factory=lambda: converter,
        docling_version="2.test",
    )

    assert result.text == "# Extracted\n\nStructured text"
    assert result.media_type == "application/pdf"
    assert result.attributes == {
        "extractor": "docling",
        "extractor_version": "2.test",
        "conversion_status": "success",
        "page_count": 2,
    }
    assert converter.calls == [(source, True, source.stat().st_size)]


def test_worker_conversion_rejects_oversized_markdown_before_ipc(tmp_path: Path) -> None:
    source = tmp_path / "paper.pdf"
    source.write_bytes(b"%PDF fixture")
    converter = FakeConverter("too much text")

    with pytest.raises(DoclingExtractionError, match="character limit"):
        _convert_document(
            source,
            max_chars=5,
            converter_factory=lambda: converter,
            docling_version="2.test",
        )


def test_extractor_decodes_bounded_worker_result(tmp_path: Path) -> None:
    source = tmp_path / "paper.pdf"
    source.write_bytes(b"%PDF fixture")

    def run_worker(command: tuple[str, ...], **kwargs: object) -> subprocess.CompletedProcess[str]:
        output = Path(command[command.index("--output") + 1])
        output.write_text(
            json.dumps(
                {
                    "ok": True,
                    "text": "# Safe extraction",
                    "media_type": "application/pdf",
                    "attributes": {
                        "extractor": "docling",
                        "extractor_version": "2.test",
                        "page_count": 1,
                    },
                }
            ),
            encoding="utf-8",
        )
        assert kwargs["cwd"] == output.parent
        assert kwargs["env"] != dict()
        assert kwargs["check"] is False
        return subprocess.CompletedProcess(command, 0, "", "")

    with patch("alystria.sources.docling.subprocess.run", side_effect=run_worker):
        result = DoclingExtractor(Path(sys.executable), timeout_seconds=1).extract(
            source,
            max_chars=100,
        )

    assert result.text == "# Safe extraction"
    assert result.attributes["extractor"] == "docling"


def test_extractor_reports_optional_dependency_as_unavailable(tmp_path: Path) -> None:
    source = tmp_path / "paper.pdf"
    source.write_bytes(b"%PDF fixture")

    def run_worker(command: tuple[str, ...], **kwargs: object) -> subprocess.CompletedProcess[str]:
        del kwargs
        output = Path(command[command.index("--output") + 1])
        output.write_text(
            json.dumps(
                {
                    "ok": False,
                    "code": "unavailable",
                    "message": (
                        "Docling document extraction is unavailable; install "
                        "'alystria-pipeline[documents]' in the pipeline runtime"
                    ),
                }
            ),
            encoding="utf-8",
        )
        return subprocess.CompletedProcess(command, 20, "", "")

    with (
        patch("alystria.sources.docling.subprocess.run", side_effect=run_worker),
        pytest.raises(DoclingUnavailableError, match=r"\[documents\]"),
    ):
        DoclingExtractor(Path(sys.executable)).extract(source, max_chars=100)


def test_extractor_reports_timeout_without_leaking_subprocess_details(tmp_path: Path) -> None:
    source = tmp_path / "paper.pdf"
    source.write_bytes(b"%PDF fixture")
    timeout = subprocess.TimeoutExpired(("python",), 0.25, output="document contents")

    with (
        patch("alystria.sources.docling.subprocess.run", side_effect=timeout),
        pytest.raises(DoclingExtractionError, match=r"timed out after 0\.25 seconds") as captured,
    ):
        DoclingExtractor(Path(sys.executable), timeout_seconds=0.25).extract(
            source,
            max_chars=100,
        )

    assert "document contents" not in str(captured.value)


def test_suffix_map_is_lazy_and_reuses_one_extractor() -> None:
    extractor = DoclingExtractor(Path(sys.executable))
    mapping = docling_extractors(extractor)

    assert set(mapping) == DOCLING_SUFFIXES
    assert all(value is extractor for value in mapping.values())


def test_extractor_rejects_unlisted_document_type_before_worker(tmp_path: Path) -> None:
    source = tmp_path / "archive.zip"
    source.write_bytes(b"not a supported document")

    with pytest.raises(DoclingExtractionError, match=r"does not accept \.zip"):
        DoclingExtractor(Path(sys.executable)).extract(source, max_chars=100)
