"""Capability-gated localization planning and validation."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .models import (
    DEEPLY_VERIFIED_LOCALES,
    AssetReference,
    Course,
    Locale,
    LocalizedText,
    PausePrompt,
    QuizQuestion,
    WorkedProblem,
    locale_family,
)
from .validation import Severity, ValidationIssue, ValidationReport


class LocalizationModality(StrEnum):
    TEXT = "text"
    TTS = "tts"
    CAPTIONS = "captions"
    OCR = "ocr"


@dataclass(frozen=True, slots=True)
class LocalizationCapability:
    provider: str
    supported_locales: frozenset[str]
    modalities: frozenset[LocalizationModality] = frozenset({LocalizationModality.TEXT})

    def __post_init__(self) -> None:
        if not self.provider.strip():
            raise ValueError("Localization capability requires a provider")
        normalized = frozenset(
            locale.strip().replace("_", "-").lower() for locale in self.supported_locales
        )
        for locale in normalized:
            locale_family(locale)
        object.__setattr__(self, "supported_locales", normalized)

    def supports(self, locale: str, modality: LocalizationModality) -> bool:
        normalized = locale.strip().replace("_", "-").lower()
        family = locale_family(normalized)
        locale_supported = normalized in self.supported_locales or family in self.supported_locales
        return locale_supported and modality in self.modalities


@dataclass(frozen=True, slots=True)
class LocalizationGate:
    allowed: bool
    locale: str
    deeply_verified: bool
    provider: str
    reason: str


class AssetLocalizationAction(StrEnum):
    REUSE_SOURCE = "reuse_source"
    REUSE_NEUTRAL = "reuse_language_neutral"
    USE_LOCALIZED_VARIANT = "use_localized_variant"
    LOCALIZE_OR_REGENERATE = "localize_or_regenerate"


@dataclass(frozen=True, slots=True)
class AssetLocalizationDecision:
    scene_id: str
    source_asset_id: str
    resolved_asset_id: str | None
    action: AssetLocalizationAction


@dataclass(frozen=True, slots=True)
class SceneLocalizationTask:
    scene_id: str
    translate_fields: tuple[str, ...]
    asset_decisions: tuple[AssetLocalizationDecision, ...]


@dataclass(frozen=True, slots=True)
class LocalizationPlan:
    source_locale: str
    target_locale: str
    provider: str
    deeply_verified: bool
    tasks: tuple[SceneLocalizationTask, ...]
    warnings: tuple[str, ...] = ()
    global_fields: tuple[str, ...] = ()


def _activity_texts(
    activity: QuizQuestion | PausePrompt | WorkedProblem,
) -> list[tuple[str, LocalizedText]]:
    texts: list[tuple[str, LocalizedText]] = [("prompt", activity.prompt)]
    if isinstance(activity, QuizQuestion):
        texts.extend((f"option.{option.option_id}", option.label) for option in activity.options)
        if activity.explanation:
            texts.append(("explanation", activity.explanation))
    elif isinstance(activity, PausePrompt):
        if activity.reveal:
            texts.append(("reveal", activity.reveal))
    else:
        texts.extend((f"step.{step.step_id}", step.explanation) for step in activity.steps)
        texts.append(("final_answer", activity.final_answer))
    return texts


class LocalizationWorkflow:
    """Create deterministic localization work without silently changing provider."""

    def gate(
        self,
        locale: str | Locale,
        capability: LocalizationCapability,
        *,
        required_modalities: frozenset[LocalizationModality] = frozenset(
            {LocalizationModality.TEXT}
        ),
    ) -> LocalizationGate:
        normalized = str(locale).strip().replace("_", "-").lower()
        family = locale_family(normalized)
        missing = sorted(
            modality.value
            for modality in required_modalities
            if not capability.supports(normalized, modality)
        )
        deeply_verified = family in {item.value for item in DEEPLY_VERIFIED_LOCALES}
        if missing:
            return LocalizationGate(
                False,
                normalized,
                deeply_verified,
                capability.provider,
                f"{capability.provider} lacks {', '.join(missing)} capability for {normalized}",
            )
        reason = (
            "Deep Alystria validation profile available"
            if deeply_verified
            else "Provider-supported locale; capability-gated validation only"
        )
        return LocalizationGate(True, normalized, deeply_verified, capability.provider, reason)

    def create_plan(
        self,
        course: Course,
        target_locale: str | Locale,
        capability: LocalizationCapability,
        *,
        required_modalities: frozenset[LocalizationModality] = frozenset(
            {LocalizationModality.TEXT}
        ),
    ) -> LocalizationPlan:
        gate = self.gate(target_locale, capability, required_modalities=required_modalities)
        if not gate.allowed:
            raise UnsupportedLocalizationError(gate.reason)

        global_fields: list[str] = []
        if not course.title.has_exact(gate.locale):
            global_fields.append("course.title")
        for module in course.modules:
            if not module.title.has_exact(gate.locale):
                global_fields.append(f"modules.{module.module_id}.title")
            for lesson in module.lessons:
                if not lesson.title.has_exact(gate.locale):
                    global_fields.append(
                        f"modules.{module.module_id}.lessons.{lesson.lesson_id}.title"
                    )
                for objective in lesson.objectives:
                    if not objective.description.has_exact(gate.locale):
                        global_fields.append(
                            f"objectives.{objective.objective_id}.description"
                        )
                for section in lesson.sections:
                    if not section.title.has_exact(gate.locale):
                        global_fields.append(f"sections.{section.section_id}.title")
        for term in course.glossary.terms:
            if gate.locale not in term.canonical:
                global_fields.append(f"glossary.{term.term_id}.canonical")

        tasks: list[SceneLocalizationTask] = []
        for resolved in course.iter_scenes():
            scene = resolved.scene
            fields: list[str] = []
            for field_name, value in (
                ("title", scene.title),
                ("narration", scene.narration),
                ("accessibility_description", scene.accessibility_description),
            ):
                if value is not None and not value.has_exact(gate.locale):
                    fields.append(field_name)
            for activity in scene.activities:
                for field_name, value in _activity_texts(activity):
                    if not value.has_exact(gate.locale):
                        fields.append(f"activities.{activity.activity_id}.{field_name}")
                if (
                    isinstance(activity, QuizQuestion)
                    and activity.accepted_answers
                    and gate.locale not in activity.accepted_answers
                ):
                    fields.append(f"activities.{activity.activity_id}.accepted_answers")
            decisions = tuple(
                self._asset_decision(
                    scene.scene_id, asset, gate.locale, course.source_locale
                )
                for asset in scene.assets
            )
            tasks.append(SceneLocalizationTask(scene.scene_id, tuple(fields), decisions))

        warnings: tuple[str, ...] = ()
        if not gate.deeply_verified:
            warnings = (
                f"{gate.locale} is provider-supported but not deeply verified by Alystria; "
                "human linguistic review is required",
            )
        return LocalizationPlan(
            course.source_locale,
            gate.locale,
            gate.provider,
            gate.deeply_verified,
            tuple(tasks),
            warnings,
            tuple(global_fields),
        )

    @staticmethod
    def _asset_decision(
        scene_id: str,
        asset: AssetReference,
        target_locale: str,
        source_locale: str,
    ) -> AssetLocalizationDecision:
        if locale_family(target_locale) == locale_family(source_locale):
            return AssetLocalizationDecision(
                scene_id,
                asset.asset_id,
                asset.asset_id,
                AssetLocalizationAction.REUSE_SOURCE,
            )
        if asset.language_neutral:
            return AssetLocalizationDecision(
                scene_id,
                asset.asset_id,
                asset.asset_id,
                AssetLocalizationAction.REUSE_NEUTRAL,
            )
        localized = asset.asset_for(target_locale, source_locale)
        if localized:
            return AssetLocalizationDecision(
                scene_id,
                asset.asset_id,
                localized,
                AssetLocalizationAction.USE_LOCALIZED_VARIANT,
            )
        return AssetLocalizationDecision(
            scene_id,
            asset.asset_id,
            None,
            AssetLocalizationAction.LOCALIZE_OR_REGENERATE,
        )

    def validate_localization(
        self, course: Course, target_locale: str | Locale
    ) -> ValidationReport:
        locale = str(target_locale).strip().replace("_", "-").lower()
        family = locale_family(locale)
        issues: list[ValidationIssue] = []
        all_texts: list[tuple[str, LocalizedText]] = [("course.title", course.title)]

        for module in course.modules:
            all_texts.append((f"modules.{module.module_id}.title", module.title))
            for lesson in module.lessons:
                all_texts.append((f"lessons.{lesson.lesson_id}.title", lesson.title))
                all_texts.extend(
                    (f"objectives.{objective.objective_id}.description", objective.description)
                    for objective in lesson.objectives
                )
                all_texts.extend(
                    (f"sections.{section.section_id}.title", section.title)
                    for section in lesson.sections
                )

        for resolved in course.iter_scenes():
            path = resolved.path.as_string()
            scene = resolved.scene
            all_texts.extend(
                [
                    (f"{path}.title", scene.title),
                    (f"{path}.narration", scene.narration),
                ]
            )
            if scene.accessibility_description:
                all_texts.append(
                    (f"{path}.accessibility_description", scene.accessibility_description)
                )
            for activity in scene.activities:
                all_texts.extend(
                    (f"{path}.activities.{activity.activity_id}.{name}", value)
                    for name, value in _activity_texts(activity)
                )
                if (
                    isinstance(activity, QuizQuestion)
                    and activity.accepted_answers
                    and locale not in activity.accepted_answers
                ):
                    issues.append(
                        ValidationIssue(
                            "MISSING_LOCALIZATION",
                            Severity.ERROR,
                            f"{path}.activities.{activity.activity_id}.accepted_answers",
                            f"Missing exact {locale} accepted answers",
                        )
                    )
            for asset in scene.assets:
                if asset.accessibility_text:
                    all_texts.append(
                        (
                            f"{path}.assets.{asset.asset_id}.accessibility_text",
                            asset.accessibility_text,
                        )
                    )

        for path, value in all_texts:
            if not value.has_exact(locale):
                issues.append(
                    ValidationIssue(
                        "MISSING_LOCALIZATION",
                        Severity.ERROR,
                        path,
                        f"Missing exact {locale} localization",
                    )
                )

        for term in course.glossary.terms:
            try:
                term.canonical_for(locale)
            except KeyError:
                issues.append(
                    ValidationIssue(
                        "MISSING_TERM_LOCALIZATION",
                        Severity.ERROR,
                        f"glossary.{term.term_id}",
                        f"No canonical form for {locale}",
                    )
                )

        if family == Locale.HINDI.value:
            narration_values = [
                resolved.scene.narration.values.get(locale, "") for resolved in course.iter_scenes()
            ]
            if narration_values and not all(
                self._contains_devanagari(text) for text in narration_values
            ):
                issues.append(
                    ValidationIssue(
                        "HINDI_SCRIPT_CHECK_FAILED",
                        Severity.ERROR,
                        "course",
                        "Deep Hindi validation requires Devanagari narration in every scene",
                    )
                )

        return ValidationReport(tuple(issues))

    @staticmethod
    def _contains_devanagari(text: str) -> bool:
        return any("\u0900" <= character <= "\u097f" for character in text)


class UnsupportedLocalizationError(ValueError):
    """The selected provider cannot meet the requested locale/modalities."""
