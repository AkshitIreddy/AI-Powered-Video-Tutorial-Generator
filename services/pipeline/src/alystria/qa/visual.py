"""Rendered-frame layout, legibility, and caption-obstruction checks."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .models import Finding, QualityGate, Severity


class ElementKind(StrEnum):
    TEXT = "text"
    CAPTION = "caption"
    VISUAL = "visual"
    CONTROL = "control"


@dataclass(frozen=True, slots=True)
class Rect:
    x: float
    y: float
    width: float
    height: float

    @property
    def right(self) -> float:
        return self.x + self.width

    @property
    def bottom(self) -> float:
        return self.y + self.height

    @property
    def area(self) -> float:
        return max(0.0, self.width) * max(0.0, self.height)

    def intersection_area(self, other: Rect) -> float:
        width = max(0.0, min(self.right, other.right) - max(self.x, other.x))
        height = max(0.0, min(self.bottom, other.bottom) - max(self.y, other.y))
        return width * height

    def inside(self, other: Rect) -> bool:
        return (
            self.x >= other.x
            and self.y >= other.y
            and self.right <= other.right
            and self.bottom <= other.bottom
        )


@dataclass(frozen=True, slots=True)
class VisualElement:
    element_id: str
    kind: ElementKind
    bounds: Rect
    foreground: str | None = None
    background: str | None = None
    font_size_px: float = 16.0
    bold: bool = False
    essential: bool = False
    visible: bool = True


@dataclass(frozen=True, slots=True)
class VisualSnapshot:
    scene_id: str
    tick: int
    width: int
    height: int
    elements: tuple[VisualElement, ...]
    safe_margin_ratio: float = 0.025


def check_visual_snapshot(snapshot: VisualSnapshot) -> QualityGate:
    findings: list[Finding] = []
    if snapshot.width <= 0 or snapshot.height <= 0:
        return QualityGate.from_findings(
            "visual.layout",
            "visual",
            (
                Finding(
                    "visual.invalid_frame",
                    "Rendered frame has invalid dimensions.",
                    Severity.CRITICAL,
                    f"scene:{snapshot.scene_id}@{snapshot.tick}",
                ),
            ),
        )
    visible = [element for element in snapshot.elements if element.visible]
    location = f"scene:{snapshot.scene_id}@{snapshot.tick}"
    if not visible:
        findings.append(
            Finding(
                "visual.blank_frame",
                "Frame has no visible elements.",
                Severity.CRITICAL,
                location,
                repairable=True,
            )
        )
    margin_x = snapshot.width * snapshot.safe_margin_ratio
    margin_y = snapshot.height * snapshot.safe_margin_ratio
    safe = Rect(margin_x, margin_y, snapshot.width - 2 * margin_x, snapshot.height - 2 * margin_y)
    for element in visible:
        element_location = f"{location}/element:{element.element_id}"
        if element.bounds.width <= 0 or element.bounds.height <= 0:
            findings.append(
                Finding(
                    "visual.invalid_bounds",
                    f"Element {element.element_id} has non-positive bounds.",
                    Severity.MAJOR,
                    element_location,
                    repairable=True,
                )
            )
        elif not element.bounds.inside(safe):
            findings.append(
                Finding(
                    "visual.overflow",
                    f"Element {element.element_id} extends outside the title-safe frame.",
                    Severity.MAJOR,
                    element_location,
                    repairable=True,
                )
            )
        if (
            element.kind in {ElementKind.TEXT, ElementKind.CAPTION, ElementKind.CONTROL}
            and element.foreground
            and element.background
        ):
            try:
                ratio = contrast_ratio(element.foreground, element.background)
            except ValueError:
                findings.append(
                    Finding(
                        "visual.invalid_color",
                        f"Element {element.element_id} has an invalid color value.",
                        Severity.MAJOR,
                        element_location,
                        repairable=True,
                    )
                )
                continue
            minimum = 3.0 if _is_large_text(element.font_size_px, element.bold) else 4.5
            if ratio < minimum:
                findings.append(
                    Finding(
                        "visual.low_contrast",
                        f"Element {element.element_id} contrast {ratio:.2f}:1 "
                        f"is below {minimum:.1f}:1.",
                        Severity.MAJOR,
                        element_location,
                        evidence=f"{ratio:.3f}",
                        repairable=True,
                    )
                )
    captions = [element for element in visible if element.kind is ElementKind.CAPTION]
    essentials = [
        element
        for element in visible
        if element.essential and element.kind is not ElementKind.CAPTION
    ]
    for caption in captions:
        for essential in essentials:
            overlap = caption.bounds.intersection_area(essential.bounds)
            denominator = min(caption.bounds.area, essential.bounds.area)
            if denominator > 0 and overlap / denominator > 0.05:
                findings.append(
                    Finding(
                        "visual.caption_obstruction",
                        f"Caption {caption.element_id} obstructs essential element "
                        f"{essential.element_id}.",
                        Severity.MAJOR,
                        f"{location}/element:{caption.element_id}",
                        evidence=f"overlap_ratio={overlap / denominator:.3f}",
                        repairable=True,
                    )
                )
    return QualityGate.from_findings("visual.layout", "visual", findings)


def contrast_ratio(foreground: str, background: str) -> float:
    light, dark = sorted(
        (_relative_luminance(foreground), _relative_luminance(background)), reverse=True
    )
    return (light + 0.05) / (dark + 0.05)


def _relative_luminance(value: str) -> float:
    value = value.removeprefix("#")
    if len(value) == 3:
        value = "".join(character * 2 for character in value)
    if len(value) != 6:
        raise ValueError(f"Expected #RGB or #RRGGBB color, got {value!r}")
    channels = [int(value[index : index + 2], 16) / 255 for index in (0, 2, 4)]
    linear = [
        channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4
        for channel in channels
    ]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def _is_large_text(font_size_px: float, bold: bool) -> bool:
    # WCAG's 18pt/14pt-bold thresholds at the CSS 96-dpi conversion.
    return font_size_px >= (18 * 96 / 72) or (bold and font_size_px >= (14 * 96 / 72))
