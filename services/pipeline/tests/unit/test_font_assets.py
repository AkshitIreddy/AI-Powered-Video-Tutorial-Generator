from __future__ import annotations

import struct
from typing import Any

import pytest

from alystria.font_assets import inspect_font
from alystria.security.errors import ValidationError


def _name_table(*, family: str = "Alystria Test", license_text: str = "Test License") -> bytes:
    values = {
        1: family,
        2: "Regular",
        4: f"{family} Regular",
        6: family.replace(" ", "") + "-Regular",
        13: license_text,
        14: "https://example.invalid/font-license",
    }
    records = bytearray()
    strings = bytearray()
    for name_id, value in values.items():
        encoded = value.encode("utf-16-be")
        records.extend(struct.pack(">HHHHHH", 3, 1, 0x0409, name_id, len(encoded), len(strings)))
        strings.extend(encoded)
    return struct.pack(">HHH", 0, len(values), 6 + len(records)) + records + strings


def _os2_table(*, fs_type: int = 0, weight: int = 400, italic: bool = False) -> bytes:
    table = bytearray(64)
    struct.pack_into(">HHHH", table, 0, 4, 0, weight, 5)
    struct.pack_into(">H", table, 8, fs_type)
    struct.pack_into(">H", table, 62, 1 if italic else 0)
    return bytes(table)


def _post_table(*, fixed_pitch: bool = False, italic: bool = False) -> bytes:
    table = bytearray(32)
    struct.pack_into(">I", table, 0, 0x00030000)
    struct.pack_into(">i", table, 4, 0x00010000 if italic else 0)
    struct.pack_into(">I", table, 12, 1 if fixed_pitch else 0)
    return bytes(table)


def _fvar_table() -> bytes:
    table = bytearray(36)
    struct.pack_into(">HHHHHHHH", table, 0, 1, 0, 16, 2, 1, 20, 0, 0)
    table[16:20] = b"wght"
    struct.pack_into(">iiiHH", table, 20, 100 << 16, 400 << 16, 900 << 16, 0, 256)
    return bytes(table)


def _sfnt(
    *,
    flavor: bytes = b"\x00\x01\x00\x00",
    fs_type: int = 0,
    fixed_pitch: bool = False,
    variable: bool = False,
) -> bytes:
    tables: dict[bytes, bytes] = {
        b"name": _name_table(),
        b"OS/2": _os2_table(fs_type=fs_type),
        b"post": _post_table(fixed_pitch=fixed_pitch),
    }
    if variable:
        tables[b"fvar"] = _fvar_table()
    header_size = 12 + len(tables) * 16
    payload = bytearray()
    records = bytearray()
    offset = header_size
    for tag, table in sorted(tables.items()):
        records.extend(tag)
        records.extend(struct.pack(">III", 0, offset, len(table)))
        payload.extend(table)
        padding = (-len(table)) % 4
        payload.extend(b"\x00" * padding)
        offset += len(table) + padding
    return flavor + struct.pack(">HHHH", len(tables), 0, 0, 0) + records + payload


def _woff_from_sfnt(sfnt: bytes) -> bytes:
    table_count = struct.unpack_from(">H", sfnt, 4)[0]
    directory = bytearray()
    payload = bytearray()
    offset = 44 + table_count * 20
    for index in range(table_count):
        record = 12 + index * 16
        tag = sfnt[record : record + 4]
        source_offset, length = struct.unpack_from(">II", sfnt, record + 8)
        table = sfnt[source_offset : source_offset + length]
        directory.extend(tag + struct.pack(">IIII", offset, length, length, 0))
        payload.extend(table)
        padding = (-length) % 4
        payload.extend(b"\x00" * padding)
        offset += length + padding
    length = 44 + len(directory) + len(payload)
    header = struct.pack(
        ">4s4sIHHIHHIIIII",
        b"wOFF",
        sfnt[:4],
        length,
        table_count,
        0,
        len(sfnt),
        1,
        0,
        0,
        0,
        0,
        0,
        0,
    )
    return header + directory + payload


def _woff2_structural_fixture() -> bytes:
    # One untransformed `head` entry (known-tag index 1), original length 4,
    # followed by a single byte representing the bounded Brotli payload.
    directory = b"\x01\x04"
    compressed = b"x"
    length = 48 + len(directory) + len(compressed)
    return struct.pack(
        ">4sIIHHIIHHIIIII",
        b"wOF2",
        0x00010000,
        length,
        1,
        0,
        32,
        len(compressed),
        1,
        0,
        0,
        0,
        0,
        0,
        0,
    ) + directory + compressed


def test_ttf_metadata_is_path_free_and_semantic() -> None:
    result = inspect_font(_sfnt(fixed_pitch=True, variable=True), media_type="font/ttf")
    metadata = result.metadata
    assert result.export_blockers == ()
    assert metadata["familyName"] == "Alystria Test"
    assert metadata["embedding"]["permission"] == "installable"
    assert metadata["variableAxes"][0]["tag"] == "wght"
    assert metadata["suggestedTypographyRoles"] == ["code", "evidenceLocator"]
    assert metadata["rendererBindingStatus"] == "not-bound"
    assert "path" not in str(metadata).casefold()


def test_otf_and_woff_formats_require_matching_outline_flavor() -> None:
    otf = _sfnt(flavor=b"OTTO")
    assert inspect_font(otf, media_type="font/otf").metadata["outlineKind"] == "cff"
    woff = _woff_from_sfnt(_sfnt())
    assert inspect_font(woff, media_type="font/woff").metadata["container"] == "woff"
    with pytest.raises(ValidationError, match="MIME requires cff"):
        inspect_font(_sfnt(), media_type="font/otf")


def test_restricted_and_bitmap_only_embedding_flags_block_export() -> None:
    restricted = inspect_font(_sfnt(fs_type=0x0002), media_type="font/ttf")
    bitmap = inspect_font(_sfnt(fs_type=0x0200), media_type="font/ttf")
    assert "restricted-license" in restricted.export_blockers[0]
    assert "bitmap embedding only" in bitmap.export_blockers[0]


def test_conflicting_embedding_flags_and_malformed_tables_fail_closed() -> None:
    with pytest.raises(ValidationError, match="permission bits conflict"):
        inspect_font(_sfnt(fs_type=0x0006), media_type="font/ttf")
    malformed = bytearray(_sfnt())
    struct.pack_into(">I", malformed, 12 + 12, len(malformed) + 10)
    with pytest.raises(ValidationError, match="outside bounded"):
        inspect_font(bytes(malformed), media_type="font/ttf")


def test_woff2_is_recognized_but_not_bound_or_exportable_before_sanitizing() -> None:
    result = inspect_font(_woff2_structural_fixture(), media_type="font/woff2")
    assert result.metadata["inspectionStatus"] == "container-only"
    assert result.metadata["compatibleTypographyRoles"] == []
    assert result.metadata["embedding"]["permission"] == "unknown"
    assert result.export_blockers == (
        "WOFF2 embedding permissions require a sandboxed decoded-font inspection",
    )


@pytest.fixture(name="valid_ttf")
def fixture_valid_ttf() -> bytes:
    return _sfnt()


def test_project_asset_import_exposes_font_metadata_without_a_path(
    valid_ttf: bytes,
) -> None:
    # Kept here as an importable fixture contract for the project-assets suite.
    inspection = inspect_font(valid_ttf, media_type="font/ttf")
    public: dict[str, Any] = inspection.metadata
    assert public["compatibleTypographyRoles"]
    assert public["rendererBindingStatus"] == "not-bound"
