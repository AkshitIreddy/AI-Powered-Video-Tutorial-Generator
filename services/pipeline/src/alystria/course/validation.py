"""Structural, terminology and cross-lesson consistency validation."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .models import (
    Course,
    LocalizedText,
    PausePrompt,
    QuizQuestion,
    TermDefinition,
    WorkedProblem,
)


class Severity(StrEnum):
    ERROR = "error"
    WARNING = "warning"


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    code: str
    severity: Severity
    path: str
    message: str


@dataclass(frozen=True, slots=True)
class ValidationReport:
    issues: tuple[ValidationIssue, ...]

    @property
    def errors(self) -> tuple[ValidationIssue, ...]:
        return tuple(issue for issue in self.issues if issue.severity is Severity.ERROR)

    @property
    def warnings(self) -> tuple[ValidationIssue, ...]:
        return tuple(issue for issue in self.issues if issue.severity is Severity.WARNING)

    @property
    def valid(self) -> bool:
        return not self.errors

    def raise_for_errors(self) -> None:
        if self.errors:
            details = "; ".join(f"{issue.path}: {issue.message}" for issue in self.errors)
            raise CourseValidationError(details)


class CourseValidationError(ValueError):
    """Raised when course records violate semantic invariants."""


def _texts_for_activity(
    activity: QuizQuestion | PausePrompt | WorkedProblem,
) -> list[LocalizedText]:
    texts = [activity.prompt]
    if isinstance(activity, QuizQuestion):
        texts.extend(option.label for option in activity.options)
        if activity.explanation:
            texts.append(activity.explanation)
    elif isinstance(activity, PausePrompt):
        if activity.reveal:
            texts.append(activity.reveal)
    else:
        texts.extend(step.explanation for step in activity.steps)
        texts.append(activity.final_answer)
    return texts


def _alias_present(text: str, alias: str, *, case_sensitive: bool) -> bool:
    if not case_sensitive:
        text = text.casefold()
        alias = alias.casefold()
    return alias in text


class CourseConsistencyValidator:
    """Validate IDs, objectives, locale coverage and glossary usage.

    Constructors enforce local shape.  This validator handles invariants that
    require knowledge of ancestors or siblings.
    """

    def validate(
        self,
        course: Course,
        *,
        required_locales: tuple[str, ...] | None = None,
    ) -> ValidationReport:
        issues: list[ValidationIssue] = []
        locales = required_locales or (course.source_locale, *course.target_locales)
        normalized_locales = tuple(
            dict.fromkeys(locale.lower().replace("_", "-") for locale in locales)
        )
        seen_ids: dict[str, str] = {course.course_id: "course"}

        self._check_text(course.title, "course.title", normalized_locales, issues)
        self._check_terms(course.glossary.terms, normalized_locales, issues)
        objective_positions: dict[str, int] = {}
        objective_counter = 0
        for module in course.modules:
            for lesson in module.lessons:
                for objective in lesson.objectives:
                    if objective.objective_id not in objective_positions:
                        objective_positions[objective.objective_id] = objective_counter
                    objective_counter += 1

        for module in course.modules:
            module_path = f"modules.{module.module_id}"
            self._claim_id(module.module_id, module_path, seen_ids, issues)
            self._check_text(module.title, f"{module_path}.title", normalized_locales, issues)
            lesson_ids = [lesson.lesson_id for lesson in module.lessons]
            self._duplicates(lesson_ids, module_path, "DUPLICATE_LESSON_ID", issues)

            for lesson in module.lessons:
                lesson_path = f"{module_path}.lessons.{lesson.lesson_id}"
                self._claim_id(lesson.lesson_id, lesson_path, seen_ids, issues)
                self._check_text(lesson.title, f"{lesson_path}.title", normalized_locales, issues)
                objective_by_id = {
                    objective.objective_id: objective for objective in lesson.objectives
                }
                self._duplicates(
                    [objective.objective_id for objective in lesson.objectives],
                    lesson_path,
                    "DUPLICATE_OBJECTIVE_ID",
                    issues,
                )
                for objective in lesson.objectives:
                    objective_path = f"{lesson_path}.objectives.{objective.objective_id}"
                    self._claim_id(objective.objective_id, objective_path, seen_ids, issues)
                    self._check_text(
                        objective.description,
                        f"{objective_path}.description",
                        normalized_locales,
                        issues,
                    )
                    for prerequisite_id in objective.prerequisite_ids:
                        if prerequisite_id not in objective_positions:
                            issues.append(
                                ValidationIssue(
                                    "UNKNOWN_PREREQUISITE",
                                    Severity.ERROR,
                                    objective_path,
                                    f"Unknown prerequisite objective {prerequisite_id!r}",
                                )
                            )
                        elif objective_positions[prerequisite_id] >= objective_positions[
                            objective.objective_id
                        ]:
                            issues.append(
                                ValidationIssue(
                                    "INVALID_PREREQUISITE_ORDER",
                                    Severity.ERROR,
                                    objective_path,
                                    f"Prerequisite {prerequisite_id!r} must appear earlier "
                                    "in the course",
                                )
                            )

                referenced_objectives: set[str] = set()
                for section in lesson.sections:
                    section_path = f"{lesson_path}.sections.{section.section_id}"
                    self._claim_id(section.section_id, section_path, seen_ids, issues)
                    self._check_text(
                        section.title, f"{section_path}.title", normalized_locales, issues
                    )
                    for scene in section.scenes:
                        scene_path = f"{section_path}.scenes.{scene.scene_id}"
                        self._claim_id(scene.scene_id, scene_path, seen_ids, issues)
                        self._check_text(
                            scene.title, f"{scene_path}.title", normalized_locales, issues
                        )
                        self._check_text(
                            scene.narration,
                            f"{scene_path}.narration",
                            normalized_locales,
                            issues,
                        )
                        if scene.accessibility_description:
                            self._check_text(
                                scene.accessibility_description,
                                f"{scene_path}.accessibility_description",
                                normalized_locales,
                                issues,
                            )
                        for objective_id in scene.objective_ids:
                            referenced_objectives.add(objective_id)
                            if objective_id not in objective_positions:
                                issues.append(
                                    ValidationIssue(
                                        "UNKNOWN_OBJECTIVE",
                                        Severity.ERROR,
                                        scene_path,
                                        f"Scene references unknown objective {objective_id!r}",
                                    )
                                )
                        for asset in scene.assets:
                            if asset.accessibility_text:
                                self._check_text(
                                    asset.accessibility_text,
                                    f"{scene_path}.assets.{asset.asset_id}.accessibility_text",
                                    normalized_locales,
                                    issues,
                                )
                        for activity in scene.activities:
                            self._claim_id(
                                activity.activity_id,
                                f"{scene_path}.activities.{activity.activity_id}",
                                seen_ids,
                                issues,
                            )
                            for text_index, text in enumerate(_texts_for_activity(activity)):
                                self._check_text(
                                    text,
                                    f"{scene_path}.activities.{activity.activity_id}."
                                    f"text[{text_index}]",
                                    normalized_locales,
                                    issues,
                                )
                            if isinstance(activity, QuizQuestion) and activity.accepted_answers:
                                for locale in normalized_locales:
                                    if locale not in activity.accepted_answers:
                                        issues.append(
                                            ValidationIssue(
                                                "MISSING_LOCALIZATION",
                                                Severity.ERROR,
                                                f"{scene_path}.activities."
                                                f"{activity.activity_id}.accepted_answers",
                                                f"Missing exact {locale} accepted answers",
                                            )
                                        )
                            for objective_id in activity.objective_ids:
                                referenced_objectives.add(objective_id)
                                if objective_id not in objective_positions:
                                    issues.append(
                                        ValidationIssue(
                                            "UNKNOWN_OBJECTIVE",
                                            Severity.ERROR,
                                            f"{scene_path}.activities.{activity.activity_id}",
                                            "Activity references unknown objective "
                                            f"{objective_id!r}",
                                        )
                                    )
                for objective_id in objective_by_id.keys() - referenced_objectives:
                    issues.append(
                        ValidationIssue(
                            "UNASSESSED_OBJECTIVE",
                            Severity.WARNING,
                            f"{lesson_path}.objectives.{objective_id}",
                            "Objective is not referenced by a scene or learning activity",
                        )
                    )

        self._check_course_terminology(course, normalized_locales, issues)
        return ValidationReport(tuple(issues))

    @staticmethod
    def _claim_id(
        stable_id: str,
        path: str,
        seen: dict[str, str],
        issues: list[ValidationIssue],
    ) -> None:
        previous = seen.get(stable_id)
        if previous:
            issues.append(
                ValidationIssue(
                    "DUPLICATE_STABLE_ID",
                    Severity.ERROR,
                    path,
                    f"Stable ID {stable_id!r} is already used at {previous}",
                )
            )
        else:
            seen[stable_id] = path

    @staticmethod
    def _duplicates(
        values: list[str], path: str, code: str, issues: list[ValidationIssue]
    ) -> None:
        duplicates = sorted({value for value in values if values.count(value) > 1})
        for duplicate in duplicates:
            issues.append(
                ValidationIssue(code, Severity.ERROR, path, f"Duplicate ID {duplicate!r}")
            )

    @staticmethod
    def _check_text(
        value: LocalizedText,
        path: str,
        locales: tuple[str, ...],
        issues: list[ValidationIssue],
    ) -> None:
        for locale in locales:
            if not value.has_exact(locale):
                issues.append(
                    ValidationIssue(
                        "MISSING_LOCALIZATION",
                        Severity.ERROR,
                        path,
                        f"Missing exact {locale} localization",
                    )
                )

    @staticmethod
    def _check_terms(
        terms: tuple[TermDefinition, ...],
        locales: tuple[str, ...],
        issues: list[ValidationIssue],
    ) -> None:
        for term in terms:
            for locale in locales:
                try:
                    term.canonical_for(locale)
                except KeyError:
                    issues.append(
                        ValidationIssue(
                            "MISSING_TERM_LOCALIZATION",
                            Severity.ERROR,
                            f"glossary.{term.term_id}",
                            f"Missing canonical term for {locale}",
                        )
                    )

    @staticmethod
    def _check_course_terminology(
        course: Course,
        locales: tuple[str, ...],
        issues: list[ValidationIssue],
    ) -> None:
        values: list[tuple[str, LocalizedText]] = [("course.title", course.title)]
        for module in course.modules:
            module_path = f"modules.{module.module_id}"
            values.append((f"{module_path}.title", module.title))
            for lesson in module.lessons:
                lesson_path = f"{module_path}.lessons.{lesson.lesson_id}"
                values.append((f"{lesson_path}.title", lesson.title))
                values.extend(
                    (
                        f"{lesson_path}.objectives.{objective.objective_id}.description",
                        objective.description,
                    )
                    for objective in lesson.objectives
                )
                for section in lesson.sections:
                    section_path = f"{lesson_path}.sections.{section.section_id}"
                    values.append((f"{section_path}.title", section.title))
                    for scene in section.scenes:
                        scene_path = f"{section_path}.scenes.{scene.scene_id}"
                        values.extend(
                            (
                                (f"{scene_path}.title", scene.title),
                                (f"{scene_path}.narration", scene.narration),
                            )
                        )
                        if scene.accessibility_description:
                            values.append(
                                (
                                    f"{scene_path}.accessibility_description",
                                    scene.accessibility_description,
                                )
                            )
                        for asset in scene.assets:
                            if asset.accessibility_text:
                                values.append(
                                    (
                                        f"{scene_path}.assets.{asset.asset_id}.accessibility_text",
                                        asset.accessibility_text,
                                    )
                                )
                        for activity in scene.activities:
                            values.extend(
                                (
                                    f"{scene_path}.activities.{activity.activity_id}.text[{index}]",
                                    text,
                                )
                                for index, text in enumerate(_texts_for_activity(activity))
                            )

        for path, localized_text in values:
            CourseConsistencyValidator._check_terminology_text(
                course, localized_text, path, locales, issues
            )

    @staticmethod
    def _check_terminology_text(
        course: Course,
        localized_text: LocalizedText,
        path: str,
        locales: tuple[str, ...],
        issues: list[ValidationIssue],
    ) -> None:
        for locale in locales:
            if not localized_text.has_exact(locale):
                continue
            text = localized_text.get(locale, allow_family_fallback=False)
            for term in course.glossary.terms:
                aliases = term.discouraged_aliases.get(locale, ())
                for alias in aliases:
                    if _alias_present(text, alias, case_sensitive=term.case_sensitive):
                        canonical = term.canonical_for(locale)
                        issues.append(
                            ValidationIssue(
                                "DISCOURAGED_TERM",
                                Severity.WARNING,
                                path,
                                f"Use {canonical!r} instead of discouraged alias {alias!r}",
                            )
                        )
