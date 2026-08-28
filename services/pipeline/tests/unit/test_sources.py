from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from alystria.sources import (
    DatasetLoader,
    FileExtractionResult,
    FileLoader,
    HttpResponse,
    LoadOptions,
    PresentationLoader,
    PrivacyClass,
    RepositoryLoader,
    RetentionClass,
    SourceKind,
    SourceLoadError,
    TopicLoader,
    UrllibSafeHttpTransport,
    UrlLoader,
    UrlSafetyPolicy,
    default_loaders,
)


class FakeTransport:
    def __init__(self, response: HttpResponse) -> None:
        self.response = response
        self.calls: list[str] = []

    def get(self, url: str, *, headers=None) -> HttpResponse:
        self.calls.append(url)
        return self.response


class FakeNetworkResponse:
    def __init__(self, status: int, headers: dict[str, str], body: bytes = b"") -> None:
        self.status = status
        self._headers = headers
        self._body = body

    def getheaders(self):
        return list(self._headers.items())

    def read(self, limit: int) -> bytes:
        return self._body[:limit]


class FakeConnection:
    def __init__(self, response: FakeNetworkResponse) -> None:
        self.response = response
        self.requests: list[tuple[str, str, dict[str, str]]] = []
        self.closed = False

    def request(self, method: str, target: str, *, headers: dict[str, str]) -> None:
        self.requests.append((method, target, headers))

    def getresponse(self) -> FakeNetworkResponse:
        return self.response

    def close(self) -> None:
        self.closed = True


class FakeDocumentExtractor:
    def extract(self, path: Path, *, max_chars: int) -> FileExtractionResult:
        self.path = path
        self.max_chars = max_chars
        return FileExtractionResult(
            "Extracted document text",
            "application/pdf",
            {"page_count": 2},
        )


class FakeUrlPolicy:
    max_redirects = 2
    max_bytes = 1024
    timeout_seconds = 1.0

    def __init__(self) -> None:
        self.urls: list[str] = []

    def resolve_public(self, url: str):
        self.urls.append(url)
        if "127.0.0.1" in url:
            raise SourceLoadError("URL resolves to a non-public network address")
        return "example.org", 80, ("93.184.216.34",)


class SourceLoaderTests(unittest.TestCase):
    def test_inline_loader_preserves_privacy_and_is_stable(self) -> None:
        loader = TopicLoader()
        options = LoadOptions(privacy=PrivacyClass.SENSITIVE, retention=RetentionClass.SESSION)
        first = loader.load("  Divide and conquer  ", options)
        second = loader.load("Divide and conquer", options)
        self.assertEqual(first.id, second.id)
        self.assertEqual(first.version_id, second.version_id)
        self.assertEqual(first.metadata.privacy, PrivacyClass.SENSITIVE)
        self.assertEqual(first.metadata.retention, RetentionClass.SESSION)

    def test_file_and_repository_loaders_enforce_roots_and_order(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            repo = root / "repo"
            repo.mkdir()
            (repo / "b.py").write_text("print('b')", encoding="utf-8")
            (repo / "a.md").write_text("# A", encoding="utf-8")
            (repo / "binary.bin").write_bytes(b"\x00\x01")
            (repo / ".git").mkdir()
            (repo / ".git" / "secret.txt").write_text("not ingested", encoding="utf-8")

            single = FileLoader((root,)).load(repo / "a.md")
            self.assertEqual(single.content, "# A")
            combined = RepositoryLoader((root,)).load(repo)
            self.assertLess(combined.content.index("a.md"), combined.content.index("b.py"))
            self.assertNotIn("not ingested", combined.content)
            self.assertEqual(combined.metadata.attributes["file_count"], 2)

            link = root / "linked.md"
            link.symlink_to(repo / "a.md")
            with self.assertRaises(SourceLoadError):
                FileLoader((root,)).load(link)

            with tempfile.TemporaryDirectory() as other:
                outside = Path(other) / "x.txt"
                outside.write_text("x", encoding="utf-8")
                with self.assertRaises(SourceLoadError):
                    FileLoader((root,)).load(outside)

    def test_file_loader_delegates_binary_documents_to_quarantined_extractor(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "paper.pdf"
            path.write_bytes(b"%PDF-1.7 inert fixture")
            extractor = FakeDocumentExtractor()
            document = FileLoader((root,), extractors={".pdf": extractor}).load(path)
            self.assertEqual(document.content, "Extracted document text")
            self.assertEqual(document.metadata.attributes["page_count"], 2)
            self.assertEqual(
                document.metadata.attributes["extractor_boundary"],
                "quarantined_worker",
            )

    def test_url_loader_converts_html_and_defaults_to_link_only(self) -> None:
        transport = FakeTransport(
            HttpResponse(
                "https://example.org/article",
                200,
                {"content-type": "text/html; charset=utf-8"},
                b"<h1>Title</h1><script>bad()</script><p>Hello &amp; welcome.</p>",
            )
        )
        document = UrlLoader(transport).load("https://example.org/article")
        self.assertEqual(document.metadata.privacy, PrivacyClass.PUBLIC)
        self.assertEqual(document.metadata.retention, RetentionClass.LINK_ONLY)
        self.assertIn("Title", document.content)
        self.assertIn("Hello & welcome.", document.content)
        self.assertNotIn("bad()", document.content)

    def test_url_policy_blocks_local_and_non_https_targets(self) -> None:
        def public_resolver(*args, **kwargs):
            return [(2, 1, 6, "", ("93.184.216.34", 443))]

        def private_resolver(*args, **kwargs):
            return [(2, 1, 6, "", ("127.0.0.1", 443))]

        policy = UrlSafetyPolicy()
        self.assertEqual(
            policy.validate("https://example.org/x", resolver=public_resolver),
            "https://example.org/x",
        )
        with self.assertRaises(SourceLoadError):
            policy.validate("http://example.org", resolver=public_resolver)
        with self.assertRaises(SourceLoadError):
            policy.validate("https://example.org", resolver=private_resolver)
        with self.assertRaises(SourceLoadError):
            policy.validate("https://localhost", resolver=public_resolver)

    def test_safe_transport_pins_address_and_forces_host_header(self) -> None:
        policy = FakeUrlPolicy()
        connection = FakeConnection(
            FakeNetworkResponse(200, {"Content-Type": "text/plain"}, b"safe")
        )
        with patch(
            "alystria.sources.safety.http.client.HTTPConnection",
            return_value=connection,
        ):
            response = UrllibSafeHttpTransport(policy).get(  # type: ignore[arg-type]
                "http://example.org/article?q=1"
            )
        self.assertEqual(response.body, b"safe")
        self.assertEqual(connection.requests[0][1], "/article?q=1")
        self.assertEqual(connection.requests[0][2]["Host"], "example.org")
        self.assertTrue(connection.closed)

    def test_safe_transport_revalidates_redirect_before_following(self) -> None:
        policy = FakeUrlPolicy()
        connection = FakeConnection(
            FakeNetworkResponse(302, {"Location": "https://127.0.0.1/private"})
        )
        with (
            patch(
                "alystria.sources.safety.http.client.HTTPConnection",
                return_value=connection,
            ),
            self.assertRaises(SourceLoadError),
        ):
            UrllibSafeHttpTransport(policy).get(  # type: ignore[arg-type]
                "http://example.org/redirect"
            )
        self.assertEqual(
            policy.urls,
            ["http://example.org/redirect", "https://127.0.0.1/private"],
        )

    def test_dataset_loader_returns_bounded_canonical_preview(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "sample.csv"
            path.write_text("name,value\nbeta,2\nalpha,1\n", encoding="utf-8")
            document = DatasetLoader((root,), preview_rows=1).load(path)
            self.assertEqual(document.metadata.attributes["row_count"], 2)
            self.assertEqual(document.metadata.attributes["columns"], ["name", "value"])
            self.assertTrue(document.metadata.attributes["truncated"])
            self.assertEqual(json.loads(document.content), [{"name": "beta", "value": "2"}])

    def test_pptx_loader_extracts_slide_text_without_external_library(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "deck.pptx"
            xml = (
                b'<?xml version="1.0"?><p:sld xmlns:p="urn:p" xmlns:a="urn:a">'
                b"<a:t>Safe title</a:t><a:t>Key idea</a:t></p:sld>"
            )
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("ppt/slides/slide1.xml", xml)
            document = PresentationLoader((root,)).load(path)
            self.assertIn("Safe title", document.content)
            self.assertEqual(document.metadata.attributes["slide_count"], 1)

    def test_default_registry_has_every_requested_source_kind(self) -> None:
        transport = FakeTransport(
            HttpResponse(
                "https://example.org",
                200,
                {"content-type": "text/plain"},
                b"ok",
            )
        )
        registry = default_loaders((Path.cwd(),), transport)
        for kind in SourceKind:
            self.assertEqual(registry.get(kind).kind, kind)


if __name__ == "__main__":
    unittest.main()
