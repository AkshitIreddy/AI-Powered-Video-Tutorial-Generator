"""Serializable thumbnail candidate specifications and editor documents."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any


class ThumbnailStrategy(StrEnum):
    CONCEPT_DIAGRAM = "concept_diagram"
    PRESENTER = "presenter"
    RESULT_FIRST = "result_first"
    BEFORE_AFTER = "before_after"
    TYPOGRAPHIC = "typographic"
    ILLUSTRATED_ANALOGY = "illustrated_analogy"


class ThumbnailLayerType(StrEnum):
    TEXT = "text"
    ASSET = "asset"
    SHAPE = "shape"
    BACKGROUND = "background"


@dataclass(frozen=True, slots=True)
class NormalizedRect:
    x: float
    y: float
    width: float
    height: float

    def __post_init__(self) -> None:
        if any(value < 0 or value > 1 for value in (self.x, self.y, self.width, self.height)):
            raise ValueError("Thumbnail geometry must use normalized 0-1 coordinates")
        if (
            self.width == 0
            or self.height == 0
            or self.x + self.width > 1
            or self.y + self.height > 1
        ):
            raise ValueError("Thumbnail geometry must have positive size inside the canvas")


@dataclass(frozen=True, slots=True)
class ThumbnailCandidateSpec:
    candidate_id: str
    locale: str
    width: int
    height: int
    strategy: ThumbnailStrategy
    concept: str
    headline: str
    asset_ids: tuple[str, ...] = ()
    safe_area: NormalizedRect = NormalizedRect(0.04, 0.04, 0.92, 0.92)
    style_tokens: Mapping[str, str | int | float | bool] = field(default_factory=dict)
    rationale: str = ""

    def __post_init__(self) -> None:
        if not self.candidate_id.strip() or not self.locale.strip():
            raise ValueError("Thumbnail candidates require an ID and locale")
        if self.width < 320 or self.height < 180:
            raise ValueError("Thumbnail candidates must be at least 320x180")
        if not self.concept.strip() or not self.headline.strip():
            raise ValueError("Thumbnail candidates require concept and headline")


@dataclass(frozen=True, slots=True)
class ThumbnailLayer:
    layer_id: str
    layer_type: ThumbnailLayerType
    bounds: NormalizedRect
    z_index: int
    content: str
    locked: bool = False
    hidden: bool = False
    opacity: float = 1.0
    rotation_degrees: float = 0.0
    style: Mapping[str, str | int | float | bool] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.layer_id.strip() or not self.content.strip():
            raise ValueError("Thumbnail layers require an ID and content")
        if not 0 <= self.opacity <= 1:
            raise ValueError("Layer opacity must be between 0 and 1")
        if not -360 <= self.rotation_degrees <= 360:
            raise ValueError("Layer rotation must be between -360 and 360 degrees")


@dataclass(frozen=True, slots=True)
class ThumbnailEditorData:
    document_id: str
    candidate_id: str
    width: int
    height: int
    layers: tuple[ThumbnailLayer, ...]
    selected_layer_id: str | None = None
    revision: int = 1
    guides: tuple[float, ...] = ()

    def __post_init__(self) -> None:
        if not self.document_id.strip() or not self.candidate_id.strip():
            raise ValueError("Thumbnail editor data requires document and candidate IDs")
        if self.width < 320 or self.height < 180 or self.revision < 1:
            raise ValueError("Invalid thumbnail canvas or revision")
        layer_ids = [layer.layer_id for layer in self.layers]
        if len(layer_ids) != len(set(layer_ids)):
            raise ValueError("Thumbnail layer IDs must be unique")
        if self.selected_layer_id and self.selected_layer_id not in layer_ids:
            raise ValueError("selected_layer_id must identify a document layer")
        if any(not 0 <= guide <= 1 for guide in self.guides):
            raise ValueError("Thumbnail guides must use normalized positions")

    def ordered_layers(self) -> tuple[ThumbnailLayer, ...]:
        return tuple(sorted(self.layers, key=lambda layer: (layer.z_index, layer.layer_id)))

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
