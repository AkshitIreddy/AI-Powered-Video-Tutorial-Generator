"""Course hierarchy and educational content records.

The records in this module are deliberately dependency-free.  They are the
pipeline's semantic source of truth; render-specific layouts belong to derived
artifacts instead of these objects.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any

TICKS_PER_SECOND = 240_000


class Locale(StrEnum):
    ENGLISH = "en"
    SPANISH = "es"
    HINDI = "hi"


DEEPLY_VERIFIED_LOCALES = frozenset(Locale)


def locale_family(locale: str | Locale) -> str:
    """Return a normalized BCP-47 language family (``en-US`` -> ``en``)."""

    value = str(locale).strip().replace("_", "-").lower()
    if not value or not value.split("-", 1)[0].isalpha():
        raise ValueError(f"Invalid locale: {locale!r}")
    return value.split("-", 1)[0]


@dataclass(frozen=True, slots=True)
class LocalizedText:
    """User-facing text keyed by normalized BCP-47 locale."""

    values: Mapping[str, str]

    def __post_init__(self) -> None:
        normalized: dict[str, str] = {}
        for locale, text in self.values.items():
            key = str(locale).strip().replace("_", "-").lower()
            locale_family(key)
            if key in normalized:
                raise ValueError(f"Duplicate locale after normalization: {key}")
            if not isinstance(text, str) or not text.strip():
                raise ValueError(f"Localized text for {key} must not be blank")
            normalized[key] = text.strip()
        if not normalized:
            raise ValueError("LocalizedText requires at least one value")
        object.__setattr__(self, "values", normalized)

    def has_exact(self, locale: str | Locale) -> bool:
        key = str(locale).strip().replace("_", "-").lower()
        return key in self.values

    def get(self, locale: str | Locale, *, allow_family_fallback: bool = True) -> str:
        key = str(locale).strip().replace("_", "-").lower()
        if key in self.values:
            return self.values[key]
        family = locale_family(key)
        if allow_family_fallback:
            if family in self.values:
                return self.values[family]
            family_matches = sorted(k for k in self.values if locale_family(k) == family)
            if family_matches:
                return self.values[family_matches[0]]
        raise KeyError(f"No localized text for {key}")

    def locales(self) -> frozenset[str]:
        return frozenset(self.values)


@dataclass(frozen=True, slots=True)
class AssetReference:
    asset_id: str
    role: str
    language_neutral: bool = False
    localized_variants: Mapping[str, str] = field(default_factory=dict)
    accessibility_text: LocalizedText | None = None

    def __post_init__(self) -> None:
        if not self.asset_id.strip() or not self.role.strip():
            raise ValueError("Asset references require asset_id and role")
        variants: dict[str, str] = {}
        for locale, asset_id in self.localized_variants.items():
            key = str(locale).strip().replace("_", "-").lower()
            locale_family(key)
            if not asset_id.strip():
                raise ValueError(f"Localized asset ID for {key} must not be blank")
            variants[key] = asset_id.strip()
        object.__setattr__(self, "localized_variants", variants)

    def asset_for(self, locale: str | Locale, source_locale: str | Locale) -> str | None:
        target = str(locale).strip().replace("_", "-").lower()
        source = str(source_locale).strip().replace("_", "-").lower()
        if target == source or locale_family(target) == locale_family(source):
            return self.asset_id
        if self.language_neutral:
            return self.asset_id
        return self.localized_variants.get(target) or self.localized_variants.get(
            locale_family(target)
        )


@dataclass(frozen=True, slots=True)
class VisualBible:
    name: str
    palette: Mapping[str, str]
    typography: Mapping[str, str]
    illustration_style: str
    motion_style: str
    layout_density: str = "balanced"
    tokens: Mapping[str, str | int | float | bool] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValueError("VisualBible name must not be blank")
        if not self.palette or not self.typography:
            raise ValueError("VisualBible requires palette and typography tokens")
        if not self.illustration_style.strip() or not self.motion_style.strip():
            raise ValueError("VisualBible styles must not be blank")

    def apply(self, override: VisualStyleOverride | None) -> VisualBible:
        if override is None:
            return self
        return VisualBible(
            name=override.name or self.name,
            palette={**self.palette, **override.palette},
            typography={**self.typography, **override.typography},
            illustration_style=override.illustration_style or self.illustration_style,
            motion_style=override.motion_style or self.motion_style,
            layout_density=override.layout_density or self.layout_density,
            tokens={**self.tokens, **override.tokens},
        )


@dataclass(frozen=True, slots=True)
class VisualStyleOverride:
    """Partial style changes inherited from a course ancestor."""

    name: str | None = None
    palette: Mapping[str, str] = field(default_factory=dict)
    typography: Mapping[str, str] = field(default_factory=dict)
    illustration_style: str | None = None
    motion_style: str | None = None
    layout_density: str | None = None
    tokens: Mapping[str, str | int | float | bool] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class LearningObjective:
    objective_id: str
    description: LocalizedText
    prerequisite_ids: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.objective_id.strip():
            raise ValueError("objective_id must not be blank")
        if self.objective_id in self.prerequisite_ids:
            raise ValueError("An objective cannot require itself")


@dataclass(frozen=True, slots=True)
class TermDefinition:
    term_id: str
    canonical: Mapping[str, str]
    discouraged_aliases: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    case_sensitive: bool = False

    def __post_init__(self) -> None:
        if not self.term_id.strip():
            raise ValueError("term_id must not be blank")
        normalized: dict[str, str] = {}
        for locale, value in self.canonical.items():
            key = str(locale).strip().replace("_", "-").lower()
            locale_family(key)
            if not value.strip():
                raise ValueError(f"Canonical term for {key} must not be blank")
            normalized[key] = value.strip()
        if not normalized:
            raise ValueError("A term needs at least one canonical form")
        object.__setattr__(self, "canonical", normalized)
        normalized_aliases: dict[str, tuple[str, ...]] = {}
        for locale, aliases in self.discouraged_aliases.items():
            key = str(locale).strip().replace("_", "-").lower()
            locale_family(key)
            values = tuple(dict.fromkeys(alias.strip() for alias in aliases if alias.strip()))
            if not values:
                raise ValueError(f"Discouraged aliases for {key} must not be empty")
            normalized_aliases[key] = values
        object.__setattr__(self, "discouraged_aliases", normalized_aliases)

    def canonical_for(self, locale: str | Locale) -> str:
        key = str(locale).strip().replace("_", "-").lower()
        if key in self.canonical:
            return self.canonical[key]
        family = locale_family(key)
        if family in self.canonical:
            return self.canonical[family]
        raise KeyError(f"Term {self.term_id!r} has no canonical form for {key}")


@dataclass(frozen=True, slots=True)
class TerminologyGlossary:
    terms: tuple[TermDefinition, ...] = ()

    def __post_init__(self) -> None:
        ids = [term.term_id for term in self.terms]
        if len(ids) != len(set(ids)):
            raise ValueError("Glossary term IDs must be unique")


class QuizKind(StrEnum):
    SINGLE_CHOICE = "single_choice"
    MULTIPLE_CHOICE = "multiple_choice"
    SHORT_ANSWER = "short_answer"


@dataclass(frozen=True, slots=True)
class QuizOption:
    option_id: str
    label: LocalizedText

    def __post_init__(self) -> None:
        if not self.option_id.strip():
            raise ValueError("Quiz option_id must not be blank")


@dataclass(frozen=True, slots=True)
class QuizQuestion:
    activity_id: str
    prompt: LocalizedText
    kind: QuizKind
    options: tuple[QuizOption, ...] = ()
    correct_option_ids: tuple[str, ...] = ()
    accepted_answers: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    explanation: LocalizedText | None = None
    objective_ids: tuple[str, ...] = ()
    points: int = 1

    def __post_init__(self) -> None:
        if not self.activity_id.strip() or self.points < 1:
            raise ValueError("Quiz questions require an ID and at least one point")
        option_ids = [option.option_id for option in self.options]
        if len(option_ids) != len(set(option_ids)):
            raise ValueError("Quiz option IDs must be unique")
        normalized_answers: dict[str, tuple[str, ...]] = {}
        for locale, answers in self.accepted_answers.items():
            key = str(locale).strip().replace("_", "-").lower()
            locale_family(key)
            values = tuple(dict.fromkeys(answer.strip() for answer in answers if answer.strip()))
            if not values:
                raise ValueError(f"Accepted answers for {key} must not be empty")
            normalized_answers[key] = values
        object.__setattr__(self, "accepted_answers", normalized_answers)
        if self.kind is QuizKind.SHORT_ANSWER:
            if self.options or self.correct_option_ids or not self.accepted_answers:
                raise ValueError("Short-answer quizzes use accepted_answers, not options")
        else:
            if len(self.options) < 2:
                raise ValueError("Choice quizzes require at least two options")
            unknown = set(self.correct_option_ids).difference(option_ids)
            if unknown or not self.correct_option_ids:
                raise ValueError("correct_option_ids must identify existing options")
            if self.kind is QuizKind.SINGLE_CHOICE and len(self.correct_option_ids) != 1:
                raise ValueError("Single-choice quizzes require exactly one correct option")


@dataclass(frozen=True, slots=True)
class PausePrompt:
    activity_id: str
    prompt: LocalizedText
    suggested_pause_seconds: int = 20
    reveal: LocalizedText | None = None
    objective_ids: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.activity_id.strip() or not 1 <= self.suggested_pause_seconds <= 3600:
            raise ValueError("Pause prompts require an ID and a 1-3600 second pause")


@dataclass(frozen=True, slots=True)
class WorkedStep:
    step_id: str
    explanation: LocalizedText
    expression: str | None = None

    def __post_init__(self) -> None:
        if not self.step_id.strip():
            raise ValueError("Worked step_id must not be blank")


@dataclass(frozen=True, slots=True)
class WorkedProblem:
    activity_id: str
    prompt: LocalizedText
    steps: tuple[WorkedStep, ...]
    final_answer: LocalizedText
    objective_ids: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.activity_id.strip() or not self.steps:
            raise ValueError("Worked problems require an ID and at least one step")
        step_ids = [step.step_id for step in self.steps]
        if len(step_ids) != len(set(step_ids)):
            raise ValueError("Worked step IDs must be unique")


LearningActivity = QuizQuestion | PausePrompt | WorkedProblem


class SceneType(StrEnum):
    TITLE = "title"
    SECTION_INTRO = "section_intro"
    DEFINITION = "definition"
    EXPLANATION = "explanation"
    COMPARISON = "comparison"
    DIAGRAM = "diagram"
    TIMELINE = "timeline"
    FORMULA = "formula"
    CODE = "code"
    CHART = "chart"
    MAP = "map"
    DOCUMENT = "document"
    SIMULATION = "simulation"
    PRESENTER = "presenter"
    WORKED_EXAMPLE = "worked_example"
    QUIZ = "quiz"
    RECAP = "recap"
    SOURCES = "sources"
    OUTRO = "outro"


@dataclass(frozen=True, slots=True)
class Scene:
    scene_id: str
    scene_type: SceneType
    title: LocalizedText
    narration: LocalizedText
    duration_ticks: int
    objective_ids: tuple[str, ...] = ()
    assets: tuple[AssetReference, ...] = ()
    activities: tuple[LearningActivity, ...] = ()
    visual_override: VisualStyleOverride | None = None
    accessibility_description: LocalizedText | None = None

    def __post_init__(self) -> None:
        if not self.scene_id.strip():
            raise ValueError("scene_id must not be blank")
        if self.duration_ticks <= 0:
            raise ValueError("Scene duration must be positive")
        activity_ids = [activity.activity_id for activity in self.activities]
        if len(activity_ids) != len(set(activity_ids)):
            raise ValueError("Activity IDs within a scene must be unique")


@dataclass(frozen=True, slots=True)
class Section:
    section_id: str
    title: LocalizedText
    scenes: tuple[Scene, ...]
    visual_override: VisualStyleOverride | None = None

    def __post_init__(self) -> None:
        if not self.section_id.strip() or not self.scenes:
            raise ValueError("Sections require an ID and at least one scene")


@dataclass(frozen=True, slots=True)
class Lesson:
    lesson_id: str
    title: LocalizedText
    sections: tuple[Section, ...]
    objectives: tuple[LearningObjective, ...] = ()
    visual_override: VisualStyleOverride | None = None

    def __post_init__(self) -> None:
        if not self.lesson_id.strip() or not self.sections:
            raise ValueError("Lessons require an ID and at least one section")


@dataclass(frozen=True, slots=True)
class Module:
    module_id: str
    title: LocalizedText
    lessons: tuple[Lesson, ...]
    visual_override: VisualStyleOverride | None = None

    def __post_init__(self) -> None:
        if not self.module_id.strip() or not self.lessons:
            raise ValueError("Modules require an ID and at least one lesson")


@dataclass(frozen=True, slots=True)
class ScenePath:
    module_id: str
    lesson_id: str
    section_id: str
    scene_id: str

    def as_string(self) -> str:
        return f"{self.module_id}/{self.lesson_id}/{self.section_id}/{self.scene_id}"


@dataclass(frozen=True, slots=True)
class ResolvedScene:
    path: ScenePath
    scene: Scene
    visual_bible: VisualBible
    objectives: tuple[LearningObjective, ...]


@dataclass(frozen=True, slots=True)
class Course:
    course_id: str
    title: LocalizedText
    source_locale: str
    modules: tuple[Module, ...]
    visual_bible: VisualBible
    glossary: TerminologyGlossary = field(default_factory=TerminologyGlossary)
    target_locales: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.course_id.strip() or not self.modules:
            raise ValueError("Courses require an ID and at least one module")
        source = self.source_locale.strip().replace("_", "-").lower()
        locale_family(source)
        targets = tuple(
            dict.fromkeys(t.strip().replace("_", "-").lower() for t in self.target_locales)
        )
        for locale in targets:
            locale_family(locale)
        object.__setattr__(self, "source_locale", source)
        object.__setattr__(self, "target_locales", targets)

    def iter_scenes(self) -> Iterator[ResolvedScene]:
        for module in self.modules:
            module_bible = self.visual_bible.apply(module.visual_override)
            for lesson in module.lessons:
                lesson_bible = module_bible.apply(lesson.visual_override)
                for section in lesson.sections:
                    section_bible = lesson_bible.apply(section.visual_override)
                    for scene in section.scenes:
                        yield ResolvedScene(
                            path=ScenePath(
                                module.module_id,
                                lesson.lesson_id,
                                section.section_id,
                                scene.scene_id,
                            ),
                            scene=scene,
                            visual_bible=section_bible.apply(scene.visual_override),
                            objectives=lesson.objectives,
                        )

    @property
    def duration_ticks(self) -> int:
        return sum(resolved.scene.duration_ticks for resolved in self.iter_scenes())

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
