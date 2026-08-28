"""Publishing metadata, source lists and deterministic chapter timestamps."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from itertools import pairwise
from typing import Any
from urllib.parse import urlparse

from alystria.course import TICKS_PER_SECOND, Course, LocalizedText


def format_timestamp(ticks: int) -> str:
    if ticks < 0:
        raise ValueError("Timestamp ticks must not be negative")
    total_seconds = ticks // TICKS_PER_SECOND
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


@dataclass(frozen=True, slots=True)
class SourceListEntry:
    source_id: str
    title: str
    citation: str
    creator: str | None = None
    url: str | None = None
    license_id: str | None = None
    attribution: str | None = None
    accessed_at: str | None = None

    def __post_init__(self) -> None:
        if not self.source_id.strip() or not self.title.strip() or not self.citation.strip():
            raise ValueError("Sources require source_id, title and citation")
        if self.url:
            parsed = urlparse(self.url)
            if parsed.scheme not in {"https", "http"} or not parsed.netloc:
                raise ValueError("Source URL must be an absolute HTTP(S) URL")
        if self.license_id and not self.attribution:
            raise ValueError("Licensed sources require attribution text")


@dataclass(frozen=True, slots=True)
class ChapterTimestamp:
    chapter_id: str
    title: str
    start_ticks: int
    end_ticks: int
    scene_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.chapter_id.strip() or not self.title.strip() or not self.scene_ids:
            raise ValueError("Chapters require an ID, title and at least one scene")
        if self.start_ticks < 0 or self.end_ticks <= self.start_ticks:
            raise ValueError("Chapter end must be later than its non-negative start")

    @property
    def timestamp(self) -> str:
        return format_timestamp(self.start_ticks)


class ChapterBuilder:
    """Derive section-level chapters from canonical scene durations."""

    def build(self, course: Course, locale: str) -> tuple[ChapterTimestamp, ...]:
        current_ticks = 0
        chapters: list[ChapterTimestamp] = []
        for module in course.modules:
            for lesson in module.lessons:
                for section in lesson.sections:
                    start = current_ticks
                    scene_ids: list[str] = []
                    for scene in section.scenes:
                        scene_ids.append(scene.scene_id)
                        current_ticks += scene.duration_ticks
                    chapters.append(
                        ChapterTimestamp(
                            chapter_id=section.section_id,
                            title=section.title.get(locale, allow_family_fallback=False),
                            start_ticks=start,
                            end_ticks=current_ticks,
                            scene_ids=tuple(scene_ids),
                        )
                    )
        return tuple(chapters)


@dataclass(frozen=True, slots=True)
class PublishingMetadata:
    title: LocalizedText
    description: LocalizedText
    summary: LocalizedText
    tags: Mapping[str, tuple[str, ...]]
    sources: tuple[SourceListEntry, ...]
    chapters: Mapping[str, tuple[ChapterTimestamp, ...]]
    custom: Mapping[str, str | int | float | bool] = field(default_factory=dict)

    def __post_init__(self) -> None:
        normalized_tags: dict[str, tuple[str, ...]] = {}
        for locale, values in self.tags.items():
            key = locale.strip().replace("_", "-").lower()
            tags = tuple(dict.fromkeys(value.strip() for value in values if value.strip()))
            if not tags:
                raise ValueError(f"Publishing tags for {key} must not be empty")
            normalized_tags[key] = tags
        object.__setattr__(self, "tags", normalized_tags)
        normalized_chapters = {
            locale.strip().replace("_", "-").lower(): tuple(values)
            for locale, values in self.chapters.items()
        }
        object.__setattr__(self, "chapters", normalized_chapters)
        source_ids = [source.source_id for source in self.sources]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("Source IDs must be unique")
        for locale, chapter_list in normalized_chapters.items():
            self._validate_chapters(locale, chapter_list)

    def validate_locale(self, locale: str) -> tuple[str, ...]:
        normalized = locale.strip().replace("_", "-").lower()
        errors: list[str] = []
        for field_name, value in (
            ("title", self.title),
            ("description", self.description),
            ("summary", self.summary),
        ):
            if not value.has_exact(normalized):
                errors.append(f"{field_name} lacks exact {normalized} localization")
        if normalized not in self.tags:
            errors.append(f"tags lack exact {normalized} localization")
        if normalized not in self.chapters:
            errors.append(f"chapters lack exact {normalized} localization")
        return tuple(errors)

    @staticmethod
    def _validate_chapters(locale: str, chapters: tuple[ChapterTimestamp, ...]) -> None:
        ids = [chapter.chapter_id for chapter in chapters]
        if len(ids) != len(set(ids)):
            raise ValueError(f"Chapter IDs for {locale} must be unique")
        for previous, current in pairwise(chapters):
            if current.start_ticks < previous.end_ticks:
                raise ValueError(f"Chapters for {locale} overlap")
            if current.start_ticks != previous.end_ticks:
                raise ValueError(f"Chapters for {locale} must be contiguous")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
