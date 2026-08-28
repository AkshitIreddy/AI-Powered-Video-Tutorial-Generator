from __future__ import annotations

import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from alystria.security.archive import extract_alytutorial, validate_alytutorial
from alystria.security.errors import PolicyViolation, ValidationError
from alystria.security.files import (
    ImportLimits,
    ImportQuota,
    detect_mime,
    validate_archive_path,
    validate_file,
    validate_safe_filename,
)


def tutorial_archive(
    *, extra: dict[str, bytes] | None = None, manifest: object | None = None
) -> bytes:
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr(
            "manifest.json",
            json.dumps(
                manifest
                if manifest is not None
                else {"formatVersion": 2, "projectId": "project.demo"}
            ),
        )
        archive.writestr("project.sqlite3", b"SQLite format 3\x00" + bytes(100))
        for path, data in (extra or {}).items():
            archive.writestr(path, data)
    return target.getvalue()


class FilenameAndMimeTests(unittest.TestCase):
    def test_safe_cross_platform_filename(self) -> None:
        self.assertEqual(validate_safe_filename("lesson-01.pdf"), "lesson-01.pdf")
        for value in ("../secret", "folder/file", r"folder\file", "CON.txt", "bad?.txt", "trail. "):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                validate_safe_filename(value)

    def test_unicode_must_be_normalized(self) -> None:
        with self.assertRaises(ValidationError):
            validate_safe_filename("Cafe\u0301.txt")

    def test_magic_wins_over_declared_type(self) -> None:
        png = b"\x89PNG\r\n\x1a\n" + bytes(32)
        result = validate_file("image.png", png, declared_mime="image/png")
        self.assertEqual(result.detected_mime, "image/png")
        with self.assertRaises(ValidationError):
            validate_file("image.jpg", png, declared_mime="image/jpeg")

    def test_json_requires_valid_json(self) -> None:
        self.assertEqual(detect_mime(b'{"safe": true}'), "application/json")
        self.assertEqual(detect_mime(b"{not-json"), "text/plain")
        with self.assertRaises(ValidationError):
            validate_file("bad.json", b"{not-json")

    def test_quota_is_immutable_and_fail_closed(self) -> None:
        limits = ImportLimits(max_files=2, max_file_bytes=10, max_total_bytes=15)
        initial = ImportQuota(limits)
        next_quota = initial.consume(size=8)
        self.assertEqual(initial.files, 0)
        self.assertEqual(next_quota.total_bytes, 8)
        with self.assertRaises(PolicyViolation):
            next_quota.consume(size=8)

    def test_archive_paths_reject_windows_and_posix_traversal(self) -> None:
        self.assertEqual(validate_archive_path("objects/sha256/abc"), "objects/sha256/abc")
        for path in ("../manifest.json", r"..\manifest.json", "/etc/passwd", r"C:\temp\x", "a/./b"):
            with self.subTest(path=path), self.assertRaises(ValidationError):
                validate_archive_path(path)


class TutorialArchiveTests(unittest.TestCase):
    def test_validates_required_layout_and_hashes(self) -> None:
        result = validate_alytutorial(tutorial_archive(extra={"objects/sha256/asset": b"hello"}))
        self.assertEqual(result.project_id, "project.demo")
        self.assertEqual(
            {item.path for item in result.members},
            {"manifest.json", "project.sqlite3", "objects/sha256/asset"},
        )
        self.assertTrue(all(len(item.sha256) == 64 for item in result.members))

    def test_rejects_traversal_unknown_roots_and_wrong_version(self) -> None:
        with self.assertRaises(ValidationError):
            validate_alytutorial(tutorial_archive(extra={"../escape": b"x"}))
        with self.assertRaises(PolicyViolation):
            validate_alytutorial(tutorial_archive(extra={"runtime/executable.exe": b"x"}))
        with self.assertRaises(PolicyViolation):
            validate_alytutorial(
                tutorial_archive(manifest={"formatVersion": 1, "projectId": "old"})
            )

    def test_rejects_a_fake_project_database(self) -> None:
        target = io.BytesIO()
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED) as archive:
            archive.writestr("manifest.json", '{"formatVersion": 2, "projectId": "demo"}')
            archive.writestr("project.sqlite3", b"not a database")
        with self.assertRaises(ValidationError):
            validate_alytutorial(target.getvalue())

    def test_rejects_case_collisions(self) -> None:
        with self.assertRaises(ValidationError):
            validate_alytutorial(tutorial_archive(extra={"objects/A": b"1", "objects/a": b"2"}))

    def test_rejects_symlink(self) -> None:
        target = io.BytesIO()
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED) as archive:
            archive.writestr("manifest.json", '{"formatVersion": 2, "projectId": "demo"}')
            archive.writestr("project.sqlite3", b"SQLite format 3\x00")
            link = zipfile.ZipInfo("objects/link")
            link.create_system = 3
            link.external_attr = 0o120777 << 16
            archive.writestr(link, "target")
        with self.assertRaises(PolicyViolation):
            validate_alytutorial(target.getvalue())

    def test_compression_bomb_ratio_is_bounded(self) -> None:
        target = io.BytesIO()
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", '{"formatVersion": 2, "projectId": "demo"}')
            archive.writestr("project.sqlite3", b"0" * 100_000)
        with self.assertRaises(PolicyViolation):
            validate_alytutorial(target.getvalue(), limits=ImportLimits(max_compression_ratio=10))

    def test_extracts_to_new_destination_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "project"
            result = extract_alytutorial(tutorial_archive(), destination)
            self.assertEqual(result.project_id, "project.demo")
            self.assertTrue((destination / "manifest.json").is_file())
            with self.assertRaises(PolicyViolation):
                extract_alytutorial(tutorial_archive(), destination)


if __name__ == "__main__":
    unittest.main()
