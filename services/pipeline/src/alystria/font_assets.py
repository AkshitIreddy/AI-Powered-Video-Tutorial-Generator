"""Bounded, non-executing inspection for imported OpenType web fonts.

Font programs are active inputs: TrueType hinting bytecode and malformed table
graphs must never be executed merely to show an import receipt.  This module
therefore performs a small, read-only structural inspection.  It does not load
the font into an OS font service, Chromium, FreeType, or the renderer.

SFNT and WOFF tables are inspected directly with strict byte/count limits.
WOFF2 is accepted into quarantine after bounded container validation, but its
Brotli payload is deliberately not decoded in the privileged pipeline process;
embedding rights consequently remain unknown and export stays blocked until a
future low-privilege sanitizer produces a verified derivative.
"""

from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass
from typing import Any

from .security.errors import PolicyViolation, ValidationError

MAX_FONT_BYTES = 16 * 1024 * 1024
MAX_TABLES = 256
MAX_TABLE_BYTES = 4 * 1024 * 1024
MAX_TOTAL_INSPECTED_BYTES = 12 * 1024 * 1024
MAX_NAME_RECORDS = 4_096
MAX_VARIABLE_AXES = 64

FONT_MEDIA_TYPES = frozenset({"font/ttf", "font/otf", "font/woff", "font/woff2"})
TYPOGRAPHY_ROLES = (
    "display",
    "heading",
    "body",
    "label",
    "caption",
    "code",
    "math",
    "evidenceLocator",
    "fallback",
)
_INSPECTED_TABLES = frozenset({b"name", b"OS/2", b"post", b"fvar", b"MATH"})


@dataclass(frozen=True, slots=True)
class FontInspection:
    metadata: dict[str, Any]
    export_blockers: tuple[str, ...]


def inspect_font(data: bytes, *, media_type: str) -> FontInspection:
    """Return path-free metadata without loading or executing the font."""

    if media_type not in FONT_MEDIA_TYPES:
        raise ValidationError(f"unsupported font media type {media_type!r}")
    if not data or len(data) > MAX_FONT_BYTES:
        raise PolicyViolation("font exceeds the bounded inspection size")

    if media_type == "font/woff2":
        metadata = _inspect_woff2_container(data)
        return FontInspection(
            metadata,
            (
                "WOFF2 embedding permissions require a sandboxed decoded-font inspection",
            ),
        )
    if media_type == "font/woff":
        flavor, tables = _woff_tables(data)
        container = "woff"
    else:
        flavor, tables = _sfnt_tables(data)
        container = "sfnt"

    expected = "cff" if media_type == "font/otf" else "truetype"
    actual = _outline_kind(flavor)
    if actual != expected:
        raise ValidationError(
            f"font container declares {actual} outlines but MIME requires {expected}"
        )

    names = _name_metadata(tables.get(b"name"))
    os2 = _os2_metadata(tables.get(b"OS/2"))
    post = _post_metadata(tables.get(b"post"))
    axes = _fvar_metadata(tables.get(b"fvar"))
    compatible_roles = list(TYPOGRAPHY_ROLES)
    if b"MATH" not in tables:
        compatible_roles.remove("math")
    suggested_roles = _suggested_roles(os2, post, has_math=b"MATH" in tables)

    embedding = os2["embedding"]
    blockers: list[str] = []
    if embedding["permission"] == "unknown":
        blockers.append("Font embedding permissions could not be verified")
    if embedding["permission"] == "restricted":
        blockers.append("OpenType fsType marks this font as restricted-license embedding")
    if embedding["bitmapOnly"]:
        blockers.append("OpenType fsType permits bitmap embedding only")

    metadata = {
        "schemaVersion": 1,
        "format": media_type.removeprefix("font/"),
        "container": container,
        "outlineKind": actual,
        "inspectionStatus": "metadata-inspected",
        "familyName": names.get("familyName"),
        "subfamilyName": names.get("subfamilyName"),
        "fullName": names.get("fullName"),
        "postscriptName": names.get("postscriptName"),
        "licenseDescription": names.get("licenseDescription"),
        "licenseInfoUrl": names.get("licenseInfoUrl"),
        "weightClass": os2.get("weightClass"),
        "widthClass": os2.get("widthClass"),
        "italic": bool(os2.get("italic") or post.get("italic")),
        "fixedPitch": bool(post.get("fixedPitch")),
        "variable": bool(axes),
        "variableAxes": axes,
        "embedding": embedding,
        "compatibleTypographyRoles": compatible_roles,
        "suggestedTypographyRoles": suggested_roles,
        "rendererBindingStatus": "not-bound",
    }
    return FontInspection(metadata, tuple(blockers))


def _outline_kind(flavor: bytes) -> str:
    if flavor == b"OTTO":
        return "cff"
    if flavor in {b"\x00\x01\x00\x00", b"true", b"typ1"}:
        return "truetype"
    raise ValidationError("font has an unsupported SFNT flavor")


def _sfnt_tables(data: bytes) -> tuple[bytes, dict[bytes, bytes]]:
    if len(data) < 12:
        raise ValidationError("truncated SFNT header")
    flavor = data[:4]
    _outline_kind(flavor)
    table_count = _u16(data, 4)
    if not 1 <= table_count <= MAX_TABLES:
        raise ValidationError("SFNT table count is outside the allowed range")
    directory_end = 12 + table_count * 16
    if directory_end > len(data):
        raise ValidationError("truncated SFNT table directory")

    records: dict[bytes, tuple[int, int]] = {}
    total = 0
    for index in range(table_count):
        record = 12 + index * 16
        tag = data[record : record + 4]
        offset = _u32(data, record + 8)
        length = _u32(data, record + 12)
        if tag in records:
            raise ValidationError("SFNT table directory contains duplicate tags")
        if length > MAX_TABLE_BYTES or offset > len(data) or length > len(data) - offset:
            raise ValidationError("SFNT table lies outside bounded font data")
        records[tag] = (offset, length)
        total += length
    if total > MAX_TOTAL_INSPECTED_BYTES:
        raise PolicyViolation("font tables exceed the bounded inspection budget")
    return flavor, {
        tag: data[offset : offset + length]
        for tag, (offset, length) in records.items()
        if tag in _INSPECTED_TABLES
    }


def _woff_tables(data: bytes) -> tuple[bytes, dict[bytes, bytes]]:
    if len(data) < 44 or data[:4] != b"wOFF":
        raise ValidationError("truncated WOFF header")
    flavor = data[4:8]
    _outline_kind(flavor)
    if _u32(data, 8) != len(data):
        raise ValidationError("WOFF declared length does not match its bytes")
    table_count = _u16(data, 12)
    if not 1 <= table_count <= MAX_TABLES or _u16(data, 14) != 0:
        raise ValidationError("WOFF table count or reserved field is invalid")
    directory_end = 44 + table_count * 20
    if directory_end > len(data):
        raise ValidationError("truncated WOFF table directory")

    tables: dict[bytes, bytes] = {}
    seen: set[bytes] = set()
    total = 0
    for index in range(table_count):
        record = 44 + index * 20
        tag = data[record : record + 4]
        offset = _u32(data, record + 4)
        compressed_length = _u32(data, record + 8)
        original_length = _u32(data, record + 12)
        if tag in seen:
            raise ValidationError("WOFF table directory contains duplicate tags")
        seen.add(tag)
        if (
            original_length > MAX_TABLE_BYTES
            or compressed_length > original_length
            or offset < directory_end
            or offset > len(data)
            or compressed_length > len(data) - offset
        ):
            raise ValidationError("WOFF table lies outside bounded font data")
        total += original_length
        if total > MAX_TOTAL_INSPECTED_BYTES:
            raise PolicyViolation("WOFF tables exceed the bounded inspection budget")
        if tag not in _INSPECTED_TABLES:
            continue
        payload = data[offset : offset + compressed_length]
        if compressed_length == original_length:
            decoded = payload
        else:
            decoder = zlib.decompressobj()
            try:
                decoded = decoder.decompress(payload, original_length + 1)
                decoded += decoder.flush()
            except zlib.error as error:
                raise ValidationError("WOFF table decompression failed") from error
            if decoder.unconsumed_tail or decoder.unused_data:
                raise ValidationError("WOFF table has trailing compressed data")
        if len(decoded) != original_length:
            raise ValidationError("WOFF table decompressed length is invalid")
        tables[tag] = decoded
    return flavor, tables


def _inspect_woff2_container(data: bytes) -> dict[str, Any]:
    if len(data) < 48 or data[:4] != b"wOF2":
        raise ValidationError("truncated WOFF2 header")
    flavor = data[4:8]
    outline = _outline_kind(flavor)
    declared_length = _u32(data, 8)
    table_count = _u16(data, 12)
    reserved = _u16(data, 14)
    total_sfnt_size = _u32(data, 16)
    total_compressed_size = _u32(data, 20)
    if declared_length != len(data) or reserved != 0:
        raise ValidationError("WOFF2 length or reserved field is invalid")
    if not 1 <= table_count <= MAX_TABLES:
        raise ValidationError("WOFF2 table count is outside the allowed range")
    if not 12 <= total_sfnt_size <= MAX_TOTAL_INSPECTED_BYTES:
        raise PolicyViolation("WOFF2 expanded size exceeds the inspection budget")
    if total_compressed_size == 0 or total_compressed_size > len(data) - 48:
        raise ValidationError("WOFF2 compressed payload length is invalid")
    directory_end = _woff2_directory_end(data, table_count)
    if total_compressed_size > len(data) - directory_end:
        raise ValidationError("WOFF2 compressed payload overlaps or exceeds the container")
    _validate_optional_block(data, _u32(data, 28), _u32(data, 32), "metadata")
    _validate_optional_block(data, _u32(data, 40), _u32(data, 44), "private data")
    return {
        "schemaVersion": 1,
        "format": "woff2",
        "container": "woff2",
        "outlineKind": outline,
        "inspectionStatus": "container-only",
        "familyName": None,
        "subfamilyName": None,
        "fullName": None,
        "postscriptName": None,
        "licenseDescription": None,
        "licenseInfoUrl": None,
        "weightClass": None,
        "widthClass": None,
        "italic": False,
        "fixedPitch": False,
        "variable": False,
        "variableAxes": [],
        "embedding": {
            "fsType": None,
            "permission": "unknown",
            "noSubsetting": False,
            "bitmapOnly": False,
        },
        "compatibleTypographyRoles": [],
        "suggestedTypographyRoles": [],
        "rendererBindingStatus": "not-bound",
    }


def _woff2_directory_end(data: bytes, table_count: int) -> int:
    position = 48
    for _ in range(table_count):
        if position >= len(data):
            raise ValidationError("truncated WOFF2 table directory")
        flags = data[position]
        position += 1
        tag_index = flags & 0x3F
        transform_version = flags >> 6
        if tag_index == 0x3F:
            if position + 4 > len(data):
                raise ValidationError("truncated WOFF2 custom table tag")
            tag = data[position : position + 4]
            position += 4
        else:
            # Only glyf/loca have an inverted null-transform version in WOFF2.
            tag = b"glyf" if tag_index == 10 else b"loca" if tag_index == 11 else b""
        _, position = _woff2_base128(data, position)
        transformed = transform_version != (3 if tag in {b"glyf", b"loca"} else 0)
        if transformed:
            _, position = _woff2_base128(data, position)
    return position


def _woff2_base128(data: bytes, position: int) -> tuple[int, int]:
    value = 0
    for index in range(5):
        if position >= len(data):
            raise ValidationError("truncated WOFF2 UIntBase128 value")
        byte = data[position]
        position += 1
        if index == 0 and byte == 0x80:
            raise ValidationError("WOFF2 UIntBase128 has a leading zero")
        if value & 0xFE000000:
            raise ValidationError("WOFF2 UIntBase128 overflows 32 bits")
        value = (value << 7) | (byte & 0x7F)
        if byte & 0x80 == 0:
            return value, position
    raise ValidationError("WOFF2 UIntBase128 exceeds five bytes")


def _validate_optional_block(data: bytes, offset: int, length: int, label: str) -> None:
    if offset == 0 and length == 0:
        return
    if offset == 0 or length == 0 or offset > len(data) or length > len(data) - offset:
        raise ValidationError(f"WOFF2 {label} block is out of bounds")


def _name_metadata(table: bytes | None) -> dict[str, str | None]:
    if table is None or len(table) < 6:
        raise ValidationError("font is missing a usable name table")
    count = _u16(table, 2)
    string_offset = _u16(table, 4)
    if count > MAX_NAME_RECORDS or 6 + count * 12 > len(table) or string_offset > len(table):
        raise ValidationError("font name table is malformed or too large")
    candidates: dict[int, list[tuple[int, str]]] = {}
    for index in range(count):
        offset = 6 + index * 12
        platform = _u16(table, offset)
        encoding = _u16(table, offset + 2)
        language = _u16(table, offset + 4)
        name_id = _u16(table, offset + 6)
        length = _u16(table, offset + 8)
        relative = _u16(table, offset + 10)
        if name_id not in {1, 2, 4, 6, 13, 14}:
            continue
        start = string_offset + relative
        if length > 16 * 1024 or start > len(table) or length > len(table) - start:
            raise ValidationError("font name record is out of bounds")
        value = _decode_name(table[start : start + length], platform, encoding)
        if not value:
            continue
        priority = 0 if platform == 3 and language == 0x0409 else 1 if platform == 0 else 2
        candidates.setdefault(name_id, []).append((priority, value))

    def selected(name_id: int, maximum: int) -> str | None:
        values = candidates.get(name_id, [])
        if not values:
            return None
        value = min(values, key=lambda item: (item[0], len(item[1])))[1]
        return value[:maximum]

    family = selected(1, 256)
    full_name = selected(4, 256)
    if not family and not full_name:
        raise ValidationError("font name table does not identify a family")
    return {
        "familyName": family or full_name,
        "subfamilyName": selected(2, 128),
        "fullName": full_name or family,
        "postscriptName": selected(6, 256),
        "licenseDescription": selected(13, 4_096),
        "licenseInfoUrl": selected(14, 2_048),
    }


def _decode_name(data: bytes, platform: int, encoding: int) -> str:
    try:
        if platform in {0, 3}:
            value = data.decode("utf-16-be")
        elif platform == 1 and encoding == 0:
            value = data.decode("mac_roman")
        else:
            return ""
    except UnicodeDecodeError:
        return ""
    return " ".join(value.replace("\x00", "").split())


def _os2_metadata(table: bytes | None) -> dict[str, Any]:
    if table is None:
        return {
            "weightClass": None,
            "widthClass": None,
            "italic": False,
            "embedding": {
                "fsType": None,
                "permission": "unknown",
                "noSubsetting": False,
                "bitmapOnly": False,
            },
        }
    if len(table) < 10:
        raise ValidationError("font OS/2 table is truncated")
    weight = _u16(table, 4)
    width = _u16(table, 6)
    fs_type = _u16(table, 8)
    if not 1 <= weight <= 1_000 or not 1 <= width <= 9:
        raise ValidationError("font OS/2 weight or width class is invalid")
    permission_bits = fs_type & 0x000E
    if permission_bits not in {0, 0x0002, 0x0004, 0x0008}:
        raise ValidationError("font OS/2 embedding permission bits conflict")
    permission = {
        0: "installable",
        0x0002: "restricted",
        0x0004: "previewPrint",
        0x0008: "editable",
    }[permission_bits]
    italic = len(table) >= 64 and bool(_u16(table, 62) & 0x0001)
    return {
        "weightClass": weight,
        "widthClass": width,
        "italic": italic,
        "embedding": {
            "fsType": fs_type,
            "permission": permission,
            "noSubsetting": bool(fs_type & 0x0100),
            "bitmapOnly": bool(fs_type & 0x0200),
        },
    }


def _post_metadata(table: bytes | None) -> dict[str, bool]:
    if table is None:
        return {"italic": False, "fixedPitch": False}
    if len(table) < 16:
        raise ValidationError("font post table is truncated")
    italic_fixed = struct.unpack_from(">i", table, 4)[0]
    return {"italic": italic_fixed != 0, "fixedPitch": _u32(table, 12) != 0}


def _fvar_metadata(table: bytes | None) -> list[dict[str, int | str]]:
    if table is None:
        return []
    if len(table) < 16 or _u16(table, 0) != 1:
        raise ValidationError("font fvar table has an unsupported header")
    axes_offset = _u16(table, 4)
    axis_count = _u16(table, 8)
    axis_size = _u16(table, 10)
    if axis_count > MAX_VARIABLE_AXES or axis_size < 20:
        raise ValidationError("font fvar axis count or record size is invalid")
    if axes_offset > len(table) or axis_count * axis_size > len(table) - axes_offset:
        raise ValidationError("font fvar axes lie outside the table")
    axes: list[dict[str, int | str]] = []
    for index in range(axis_count):
        offset = axes_offset + index * axis_size
        tag_bytes = table[offset : offset + 4]
        if any(value < 0x20 or value > 0x7E for value in tag_bytes):
            raise ValidationError("font fvar axis tag is invalid")
        minimum, default, maximum = struct.unpack_from(">iii", table, offset + 4)
        if not minimum <= default <= maximum:
            raise ValidationError("font fvar axis range is invalid")
        axes.append(
            {
                "tag": tag_bytes.decode("ascii"),
                "minimum": minimum,
                "default": default,
                "maximum": maximum,
            }
        )
    return axes


def _suggested_roles(
    os2: dict[str, Any], post: dict[str, bool], *, has_math: bool
) -> list[str]:
    if post.get("fixedPitch"):
        return ["code", "evidenceLocator"]
    if has_math:
        return ["math", "body"]
    weight = os2.get("weightClass")
    if isinstance(weight, int) and weight >= 600:
        return ["display", "heading", "label"]
    return ["body", "caption", "fallback"]


def _u16(data: bytes, offset: int) -> int:
    if offset < 0 or offset + 2 > len(data):
        raise ValidationError("font integer read is out of bounds")
    return int(struct.unpack_from(">H", data, offset)[0])


def _u32(data: bytes, offset: int) -> int:
    if offset < 0 or offset + 4 > len(data):
        raise ValidationError("font integer read is out of bounds")
    return int(struct.unpack_from(">I", data, offset)[0])
