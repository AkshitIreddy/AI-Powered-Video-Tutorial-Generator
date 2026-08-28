"""Conservative SVG sanitizer for generated and imported vector assets."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

from .errors import PolicyViolation, ValidationError

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
ET.register_namespace("", SVG_NS)

ALLOWED_TAGS = frozenset(
    {
        "svg",
        "g",
        "defs",
        "symbol",
        "use",
        "path",
        "rect",
        "circle",
        "ellipse",
        "line",
        "polyline",
        "polygon",
        "text",
        "tspan",
        "title",
        "desc",
        "clipPath",
        "mask",
        "linearGradient",
        "radialGradient",
        "stop",
        "pattern",
        "marker",
    }
)
ALLOWED_ATTRIBUTES = frozenset(
    {
        "id",
        "x",
        "y",
        "x1",
        "y1",
        "x2",
        "y2",
        "cx",
        "cy",
        "r",
        "rx",
        "ry",
        "width",
        "height",
        "viewBox",
        "preserveAspectRatio",
        "d",
        "points",
        "transform",
        "fill",
        "fill-opacity",
        "fill-rule",
        "stroke",
        "stroke-width",
        "stroke-opacity",
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-dasharray",
        "opacity",
        "clip-path",
        "mask",
        "font-family",
        "font-size",
        "font-weight",
        "text-anchor",
        "dominant-baseline",
        "offset",
        "stop-color",
        "stop-opacity",
        "gradientUnits",
        "gradientTransform",
        "patternUnits",
        "patternTransform",
        "marker-start",
        "marker-mid",
        "marker-end",
        "orient",
        "markerWidth",
        "markerHeight",
        "refX",
        "refY",
        "role",
        "aria-label",
        "aria-hidden",
        "focusable",
        "href",
    }
)
URL_FUNCTION = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.IGNORECASE)


def _local_name(value: str) -> str:
    return value.rsplit("}", 1)[-1]


def _validate_reference(value: str) -> None:
    if not value.startswith("#") or len(value) < 2 or any(char.isspace() for char in value):
        raise PolicyViolation("SVG references must target a local fragment")


def sanitize_svg(svg: str | bytes, *, max_bytes: int = 2 * 1024 * 1024) -> str:
    raw = svg.encode("utf-8") if isinstance(svg, str) else bytes(svg)
    if len(raw) > max_bytes:
        raise PolicyViolation("SVG exceeds the size limit")
    upper = raw.upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise PolicyViolation("SVG document types and entities are forbidden")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise ValidationError("SVG is not well-formed XML") from exc
    if _local_name(root.tag) != "svg":
        raise ValidationError("document root is not SVG")
    ids: set[str] = set()
    references: list[str] = []
    for element_count, element in enumerate(root.iter(), start=1):
        if element_count > 20_000:
            raise PolicyViolation("SVG contains too many elements")
        tag = _local_name(element.tag)
        if tag not in ALLOWED_TAGS:
            raise PolicyViolation(f"SVG element is not allowed: {tag}")
        clean_attributes: dict[str, str] = {}
        for raw_name, value in element.attrib.items():
            name = _local_name(raw_name)
            lowered = name.lower()
            if lowered.startswith("on") or name == "style" or name not in ALLOWED_ATTRIBUTES:
                raise PolicyViolation(f"SVG attribute is not allowed: {name}")
            if any(ord(char) < 32 and char not in "\t\r\n" for char in value):
                raise ValidationError("SVG attribute contains control characters")
            if name == "id":
                if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.:-]{0,127}", value) or value in ids:
                    raise ValidationError("SVG id is invalid or duplicated")
                ids.add(value)
            if name == "href":
                _validate_reference(value)
                references.append(value[1:])
            for match in URL_FUNCTION.finditer(value):
                reference = match.group(2)
                _validate_reference(reference)
                references.append(reference[1:])
            if re.search(r"(?:javascript|data|https?|file)\s*:", value, re.IGNORECASE):
                raise PolicyViolation("SVG contains an external or executable URI")
            clean_attributes[name] = value
        element.attrib.clear()
        element.attrib.update(clean_attributes)
        if tag not in {"text", "tspan", "title", "desc"} and element.text and element.text.strip():
            raise ValidationError("unexpected text in non-text SVG element")
    unresolved = sorted(set(references) - ids)
    if unresolved:
        raise ValidationError(
            f"SVG contains unresolved local references: {', '.join(unresolved[:5])}"
        )
    return ET.tostring(root, encoding="unicode", short_empty_elements=True)
