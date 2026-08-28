from __future__ import annotations

import csv
import io
import json
import unittest

from alystria.course import (
    TICKS_PER_SECOND,
    AssetLocalizationAction,
    AssetReference,
    Course,
    CourseConsistencyValidator,
    LearningObjective,
    Lesson,
    LocalizationCapability,
    LocalizationModality,
    LocalizationWorkflow,
    LocalizedText,
    Module,
    PausePrompt,
    PracticeExporter,
    PracticeExportFormat,
    QuizKind,
    QuizOption,
    QuizQuestion,
    Scene,
    SceneType,
    Section,
    TermDefinition,
    TerminologyGlossary,
    UnsupportedLocalizationError,
    VisualBible,
    VisualStyleOverride,
    WorkedProblem,
    WorkedStep,
)
from alystria.metadata import (
    ChapterBuilder,
    ExportBundleManifest,
    ExportedFile,
    ExportFileRole,
    ExportTarget,
    NormalizedRect,
    PublishingMetadata,
    SourceListEntry,
    ThumbnailCandidateSpec,
    ThumbnailEditorData,
    ThumbnailLayer,
    ThumbnailLayerType,
    ThumbnailStrategy,
    format_timestamp,
)


def text(en: str, es: str, hi: str) -> LocalizedText:
    return LocalizedText({"en": en, "es": es, "hi": hi})


def make_course() -> Course:
    objective = LearningObjective(
        "objective-divide",
        text(
            "Explain divide and conquer",
            "Explicar divide y vencerás",
            "विभाजित करके हल करना समझाएँ",
        ),
    )
    quiz = QuizQuestion(
        "quiz-three-products",
        text(
            "How many recursive products does Karatsuba use?",
            "¿Cuántos productos recursivos usa Karatsuba?",
            "करात्सुबा कितने पुनरावर्ती गुणन का उपयोग करता है?",
        ),
        QuizKind.SINGLE_CHOICE,
        options=(
            QuizOption("three", text("Three", "Tres", "तीन")),
            QuizOption("four", text("Four", "Cuatro", "चार")),
        ),
        correct_option_ids=("three",),
        explanation=text(
            "One multiplication is replaced by additions and subtraction.",
            "Una multiplicación se sustituye por sumas y una resta.",
            "एक गुणन को जोड़ और घटाव से बदला जाता है।",
        ),
        objective_ids=(objective.objective_id,),
    )
    pause = PausePrompt(
        "pause-estimate",
        text(
            "Estimate the product before continuing.",
            "Estima el producto antes de continuar.",
            "आगे बढ़ने से पहले गुणनफल का अनुमान लगाएँ।",
        ),
        reveal=text(
            "It should be close to seven million.",
            "Debe ser cercano a siete millones.",
            "यह लगभग सत्तर लाख होना चाहिए।",
        ),
        objective_ids=(objective.objective_id,),
    )
    worked = WorkedProblem(
        "worked-1234",
        text(
            "Compute 1234 × 5678.",  # noqa: RUF001
            "Calcula 1234 × 5678.",  # noqa: RUF001
            "1234 × 5678 हल करें।",  # noqa: RUF001
        ),
        steps=(
            WorkedStep(
                "split",
                text(
                    "Split each number at two digits.",
                    "Divide cada número en dos dígitos.",
                    "हर संख्या को दो अंकों पर विभाजित करें।",
                ),
                "12·100 + 34; 56·100 + 78",
            ),
            WorkedStep(
                "combine",
                text(
                    "Combine the three recursive products.",
                    "Combina los tres productos recursivos.",
                    "तीन पुनरावर्ती गुणनों को जोड़ें।",
                ),
                "7,006,652",
            ),
        ),
        final_answer=text("7,006,652", "7.006.652", "70,06,652"),
        objective_ids=(objective.objective_id,),
    )

    intro = Scene(
        "scene-intro",
        SceneType.TITLE,
        text("Karatsuba", "Karatsuba", "करात्सुबा"),
        text(
            "We will learn a faster multiplication algorithm.",
            "Aprenderemos un algoritmo de multiplicación más rápido.",
            "हम एक तेज़ गुणन एल्गोरिदम सीखेंगे।",
        ),
        5 * TICKS_PER_SECOND,
        objective_ids=(objective.objective_id,),
        assets=(
            AssetReference("asset-grid", "background", language_neutral=True),
            AssetReference(
                "asset-formula-en",
                "formula",
                localized_variants={"es": "asset-formula-es", "hi": "asset-formula-hi"},
            ),
            AssetReference("asset-label-en", "annotated_diagram"),
        ),
        visual_override=VisualStyleOverride(tokens={"accentWeight": 700}),
    )
    explain = Scene(
        "scene-explain",
        SceneType.EXPLANATION,
        text("Three products", "Tres productos", "तीन गुणन"),
        text(
            "The algorithm recursively computes three products.",
            "El algoritmo calcula recursivamente tres productos.",
            "एल्गोरिदम पुनरावर्ती रूप से तीन गुणन करता है।",
        ),
        7 * TICKS_PER_SECOND,
        objective_ids=(objective.objective_id,),
        activities=(quiz, pause),
    )
    example = Scene(
        "scene-example",
        SceneType.WORKED_EXAMPLE,
        text("Worked problem", "Problema resuelto", "हल किया उदाहरण"),
        text(
            "Now combine the pieces carefully.",
            "Ahora combina las partes con cuidado.",
            "अब भागों को सावधानी से जोड़ें।",
        ),
        8 * TICKS_PER_SECOND,
        objective_ids=(objective.objective_id,),
        activities=(worked,),
    )
    return Course(
        "course-karatsuba",
        text("Karatsuba multiplication", "Multiplicación de Karatsuba", "करात्सुबा गुणन"),
        "en",
        modules=(
            Module(
                "module-foundations",
                text("Foundations", "Fundamentos", "आधार"),
                lessons=(
                    Lesson(
                        "lesson-core",
                        text("Core method", "Método central", "मुख्य विधि"),
                        sections=(
                            Section(
                                "section-idea",
                                text("The idea", "La idea", "विचार"),
                                (intro, explain),
                                VisualStyleOverride(motion_style="measured"),
                            ),
                            Section(
                                "section-practice",
                                text("Practice", "Práctica", "अभ्यास"),
                                (example,),
                            ),
                        ),
                        objectives=(objective,),
                        visual_override=VisualStyleOverride(typography={"body": "Atkinson"}),
                    ),
                ),
                visual_override=VisualStyleOverride(palette={"accent": "#5658E8"}),
            ),
        ),
        visual_bible=VisualBible(
            "Precision Studio",
            {"paper": "#F7F8FC", "ink": "#151827"},
            {"display": "Bricolage", "body": "System"},
            "technical editorial",
            "direct",
        ),
        glossary=TerminologyGlossary(
            (
                TermDefinition(
                    "algorithm",
                    {"en": "algorithm", "es": "algoritmo", "hi": "एल्गोरिदम"},
                    {"en": ("magic recipe",), "es": ("receta mágica",)},
                ),
            )
        ),
        target_locales=("es", "hi"),
    )


def make_metadata(course: Course) -> PublishingMetadata:
    builder = ChapterBuilder()
    chapters = {locale: builder.build(course, locale) for locale in ("en", "es", "hi")}
    source = SourceListEntry(
        "source-paper",
        "Multiplication of Multidigit Numbers on Automata",
        "Karatsuba, A. and Ofman, Y. (1962).",
        creator="A. Karatsuba and Y. Ofman",
        url="https://example.org/karatsuba",
        license_id="CC-BY-4.0",
        attribution="Karatsuba and Ofman, CC BY 4.0",
    )
    return PublishingMetadata(
        course.title,
        text(
            "A visual introduction to faster integer multiplication.",
            "Una introducción visual a la multiplicación entera rápida.",
            "तेज़ पूर्णांक गुणन का दृश्य परिचय।",
        ),
        text(
            "Derive, apply, and evaluate Karatsuba's method.",
            "Deriva, aplica y evalúa el método de Karatsuba.",
            "करात्सुबा विधि को निकालें, लागू करें और परखें।",
        ),
        {
            "en": ("algorithms", "multiplication"),
            "es": ("algoritmos", "multiplicación"),
            "hi": ("एल्गोरिदम", "गुणन"),
        },
        (source,),
        chapters,
    )


class CourseDomainTests(unittest.TestCase):
    def test_hierarchy_duration_and_visual_bible_inheritance(self) -> None:
        course = make_course()
        scenes = list(course.iter_scenes())
        self.assertEqual(
            [scene.scene.scene_id for scene in scenes],
            ["scene-intro", "scene-explain", "scene-example"],
        )
        self.assertEqual(course.duration_ticks, 20 * TICKS_PER_SECOND)
        resolved = scenes[0].visual_bible
        self.assertEqual(resolved.palette["accent"], "#5658E8")
        self.assertEqual(resolved.typography["body"], "Atkinson")
        self.assertEqual(resolved.motion_style, "measured")
        self.assertEqual(resolved.tokens["accentWeight"], 700)
        self.assertEqual(
            scenes[0].path.as_string(),
            "module-foundations/lesson-core/section-idea/scene-intro",
        )

    def test_consistency_validation_accepts_complete_trilingual_course(self) -> None:
        report = CourseConsistencyValidator().validate(make_course())
        self.assertTrue(report.valid, report.issues)
        self.assertEqual(report.warnings, ())

    def test_consistency_validation_finds_missing_locale_unknown_objective_and_alias(self) -> None:
        course = make_course()
        original = course.modules[0].lessons[0].sections[0].scenes[0]
        bad_scene = Scene(
            original.scene_id,
            original.scene_type,
            LocalizedText({"en": "A magic recipe", "es": "Una receta mágica"}),
            original.narration,
            original.duration_ticks,
            objective_ids=("missing-objective",),
        )
        bad_course = Course(
            course.course_id,
            course.title,
            course.source_locale,
            (
                Module(
                    course.modules[0].module_id,
                    course.modules[0].title,
                    (
                        Lesson(
                            course.modules[0].lessons[0].lesson_id,
                            course.modules[0].lessons[0].title,
                            (
                                Section(
                                    course.modules[0].lessons[0].sections[0].section_id,
                                    course.modules[0].lessons[0].sections[0].title,
                                    (bad_scene,),
                                ),
                            ),
                            course.modules[0].lessons[0].objectives,
                        ),
                    ),
                ),
            ),
            course.visual_bible,
            course.glossary,
            course.target_locales,
        )
        report = CourseConsistencyValidator().validate(bad_course)
        codes = {issue.code for issue in report.issues}
        self.assertIn("MISSING_LOCALIZATION", codes)
        self.assertIn("UNKNOWN_OBJECTIVE", codes)
        self.assertIn("DISCOURAGED_TERM", codes)

    def test_learning_activity_validation_rejects_invalid_single_choice(self) -> None:
        with self.assertRaisesRegex(ValueError, "exactly one"):
            QuizQuestion(
                "bad",
                text("Choose", "Elige", "चुनें"),
                QuizKind.SINGLE_CHOICE,
                (
                    QuizOption("a", text("A", "A", "अ")),
                    QuizOption("b", text("B", "B", "ब")),
                ),
                ("a", "b"),
            )

    def test_cross_lesson_objective_prerequisite_is_consistent(self) -> None:
        course = make_course()
        first_module = course.modules[0]
        advanced_objective = LearningObjective(
            "objective-complexity",
            text(
                "Compare asymptotic complexity",
                "Comparar la complejidad asintótica",
                "स्पर्शोन्मुख जटिलता की तुलना करें",
            ),
            ("objective-divide",),
        )
        advanced_scene = Scene(
            "scene-complexity",
            SceneType.COMPARISON,
            text("Complexity", "Complejidad", "जटिलता"),
            text(
                "The recurrence improves the exponent.",
                "La recurrencia mejora el exponente.",
                "पुनरावृत्ति घातांक में सुधार करती है।",
            ),
            4 * TICKS_PER_SECOND,
            objective_ids=(advanced_objective.objective_id,),
        )
        advanced_lesson = Lesson(
            "lesson-analysis",
            text("Analysis", "Análisis", "विश्लेषण"),
            (
                Section(
                    "section-analysis",
                    text("Running time", "Tiempo de ejecución", "चलने का समय"),
                    (advanced_scene,),
                ),
            ),
            (advanced_objective,),
        )
        expanded = Course(
            course.course_id,
            course.title,
            course.source_locale,
            (
                Module(
                    first_module.module_id,
                    first_module.title,
                    (*first_module.lessons, advanced_lesson),
                    first_module.visual_override,
                ),
            ),
            course.visual_bible,
            course.glossary,
            course.target_locales,
        )
        report = CourseConsistencyValidator().validate(expanded)
        self.assertNotIn("UNKNOWN_PREREQUISITE", {issue.code for issue in report.issues})
        self.assertTrue(report.valid, report.issues)


class LocalizationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.course = make_course()
        self.workflow = LocalizationWorkflow()
        self.full_capability = LocalizationCapability(
            "mock-provider",
            frozenset({"en", "es", "hi", "fr"}),
            frozenset(
                {
                    LocalizationModality.TEXT,
                    LocalizationModality.TTS,
                    LocalizationModality.CAPTIONS,
                }
            ),
        )

    def test_english_spanish_hindi_are_deeply_verified_and_other_locales_are_gated(self) -> None:
        for locale in ("en", "es", "hi"):
            self.assertTrue(self.workflow.gate(locale, self.full_capability).deeply_verified)
        french = self.workflow.gate("fr", self.full_capability)
        self.assertTrue(french.allowed)
        self.assertFalse(french.deeply_verified)
        unsupported = self.workflow.gate("de", self.full_capability)
        self.assertFalse(unsupported.allowed)
        with self.assertRaises(UnsupportedLocalizationError):
            self.workflow.create_plan(self.course, "de", self.full_capability)

    def test_localization_plan_reuses_neutral_and_localized_assets(self) -> None:
        plan = self.workflow.create_plan(self.course, "es", self.full_capability)
        self.assertTrue(plan.deeply_verified)
        intro = plan.tasks[0]
        self.assertEqual(intro.translate_fields, ())
        self.assertEqual(
            [decision.action for decision in intro.asset_decisions],
            [
                AssetLocalizationAction.REUSE_NEUTRAL,
                AssetLocalizationAction.USE_LOCALIZED_VARIANT,
                AssetLocalizationAction.LOCALIZE_OR_REGENERATE,
            ],
        )
        self.assertEqual(intro.asset_decisions[1].resolved_asset_id, "asset-formula-es")

    def test_non_deep_locale_requires_human_review_and_translation_tasks(self) -> None:
        plan = self.workflow.create_plan(self.course, "fr", self.full_capability)
        self.assertFalse(plan.deeply_verified)
        self.assertTrue(plan.warnings)
        self.assertIn("course.title", plan.global_fields)
        self.assertIn("modules.module-foundations.title", plan.global_fields)
        self.assertIn("glossary.algorithm.canonical", plan.global_fields)
        self.assertIn("title", plan.tasks[0].translate_fields)
        self.assertIn("narration", plan.tasks[0].translate_fields)

    def test_deep_hindi_validation_checks_exact_text_and_script(self) -> None:
        self.assertTrue(self.workflow.validate_localization(self.course, "hi").valid)
        scene = self.course.modules[0].lessons[0].sections[0].scenes[0]
        romanized_scene = Scene(
            scene.scene_id,
            scene.scene_type,
            scene.title,
            LocalizedText({**scene.narration.values, "hi": "Hum algorithm seekhenge."}),
            scene.duration_ticks,
            scene.objective_ids,
            scene.assets,
            scene.activities,
        )
        lesson = self.course.modules[0].lessons[0]
        altered = Course(
            self.course.course_id,
            self.course.title,
            "en",
            (
                Module(
                    self.course.modules[0].module_id,
                    self.course.modules[0].title,
                    (
                        Lesson(
                            lesson.lesson_id,
                            lesson.title,
                            (
                                Section(
                                    lesson.sections[0].section_id,
                                    lesson.sections[0].title,
                                    (romanized_scene, lesson.sections[0].scenes[1]),
                                ),
                                lesson.sections[1],
                            ),
                            lesson.objectives,
                        ),
                    ),
                ),
            ),
            self.course.visual_bible,
            self.course.glossary,
            ("hi",),
        )
        codes = {issue.code for issue in self.workflow.validate_localization(altered, "hi").issues}
        self.assertIn("HINDI_SCRIPT_CHECK_FAILED", codes)


class PracticeExportTests(unittest.TestCase):
    def test_json_student_and_answer_key_exports_are_deterministic(self) -> None:
        exporter = PracticeExporter()
        student = exporter.export(make_course(), "en", PracticeExportFormat.JSON)
        answer_key = exporter.export(
            make_course(), "en", PracticeExportFormat.JSON, include_answers=True
        )
        student_data = json.loads(student.content)
        answers_data = json.loads(answer_key.content)
        self.assertEqual(student.activity_count, 3)
        self.assertNotIn("correctOptionIds", student_data["activities"][0])
        self.assertEqual(answers_data["activities"][0]["correctOptionIds"], ["three"])
        self.assertEqual(answers_data["activities"][2]["finalAnswer"], "7,006,652")
        self.assertEqual(
            answer_key.content,
            exporter.export(
                make_course(), "en", PracticeExportFormat.JSON, include_answers=True
            ).content,
        )

    def test_markdown_and_csv_cover_all_activity_kinds(self) -> None:
        exporter = PracticeExporter()
        markdown = exporter.export(
            make_course(), "es", PracticeExportFormat.MARKDOWN, include_answers=True
        )
        self.assertIn("**Final answer:** 7.006.652", markdown.content)
        csv_export = exporter.export(
            make_course(), "en", PracticeExportFormat.CSV, include_answers=True
        )
        rows = list(csv.DictReader(io.StringIO(csv_export.content)))
        self.assertEqual(
            [row["type"] for row in rows], ["quiz", "pause_prompt", "worked_problem"]
        )


class MetadataTests(unittest.TestCase):
    def test_chapter_builder_produces_contiguous_timestamps(self) -> None:
        chapters = ChapterBuilder().build(make_course(), "en")
        self.assertEqual([chapter.timestamp for chapter in chapters], ["00:00", "00:12"])
        self.assertEqual(chapters[0].end_ticks, chapters[1].start_ticks)
        self.assertEqual(chapters[1].end_ticks, 20 * TICKS_PER_SECOND)
        self.assertEqual(format_timestamp(3661 * TICKS_PER_SECOND), "01:01:01")

    def test_publishing_metadata_has_complete_localized_fields(self) -> None:
        metadata = make_metadata(make_course())
        self.assertEqual(metadata.validate_locale("en"), ())
        self.assertEqual(metadata.validate_locale("es"), ())
        self.assertEqual(metadata.sources[0].license_id, "CC-BY-4.0")
        self.assertEqual(metadata.tags["hi"], ("एल्गोरिदम", "गुणन"))

    def test_thumbnail_candidate_and_editor_data_round_trip(self) -> None:
        candidate, editor = make_thumbnail()
        self.assertEqual(candidate.strategy, ThumbnailStrategy.CONCEPT_DIAGRAM)
        self.assertEqual(
            [layer.layer_id for layer in editor.ordered_layers()],
            ["background", "headline"],
        )
        document = editor.to_dict()
        self.assertEqual(document["width"], 1280)
        self.assertEqual(document["layers"][0]["content"], "Three products, not four")

    def test_thumbnail_rejects_out_of_canvas_geometry(self) -> None:
        with self.assertRaises(ValueError):
            NormalizedRect(0.8, 0.2, 0.3, 0.4)

    def test_export_bundle_manifest_is_complete_and_deterministic(self) -> None:
        course = make_course()
        metadata = make_metadata(course)
        candidate, editor = make_thumbnail()
        files = (
            ExportedFile(
                "video/karatsuba-en.mp4",
                "video/mp4",
                ExportFileRole.VIDEO,
                "a" * 64,
                10_000,
                "en",
            ),
            ExportedFile(
                "provenance/manifest.json",
                "application/json",
                ExportFileRole.PROVENANCE,
                "b" * 64,
                500,
            ),
            ExportedFile(
                "practice/karatsuba-en.json",
                "application/json",
                ExportFileRole.PRACTICE,
                "c" * 64,
                900,
                "en",
            ),
        )
        manifest = ExportBundleManifest(
            1,
            "export-1",
            "project-1",
            course.course_id,
            "revision-4",
            "2026-08-28T12:00:00Z",
            "2.0.0-rc.0",
            (
                ExportTarget("landscape-en", 1920, 1080, 30, 1, "h264", "webvtt", "en"),
            ),
            files,
            metadata,
            ("en",),
            metadata.sources,
            {"en": metadata.chapters["en"]},
            (candidate,),
            editor,
            "provenance/manifest.json",
        )
        self.assertEqual(manifest.validate(), ())
        self.assertEqual(manifest.canonical_json(), manifest.canonical_json())
        self.assertEqual(len(manifest.digest()), 64)
        self.assertEqual(json.loads(manifest.canonical_json())["course_id"], course.course_id)

    def test_export_bundle_rejects_source_and_thumbnail_mismatch(self) -> None:
        course = make_course()
        metadata = make_metadata(course)
        candidate, editor = make_thumbnail()
        with self.assertRaisesRegex(ValueError, "source lists differ"):
            ExportBundleManifest(
                1,
                "export-bad",
                "project-1",
                course.course_id,
                "revision-1",
                "2026-08-28T12:00:00Z",
                "2.0.0-rc.0",
                (ExportTarget("target", 1280, 720, 30, 1, "h264", "burned", "en"),),
                (
                    ExportedFile(
                        "video.mp4", "video/mp4", ExportFileRole.VIDEO, "d" * 64, 1, "en"
                    ),
                ),
                metadata,
                ("en",),
                (),
                {"en": metadata.chapters["en"]},
                (candidate,),
                editor,
            )


def make_thumbnail() -> tuple[ThumbnailCandidateSpec, ThumbnailEditorData]:
    candidate = ThumbnailCandidateSpec(
        "thumb-concept-1",
        "en",
        1280,
        720,
        ThumbnailStrategy.CONCEPT_DIAGRAM,
        "Show four products collapsing into three",
        "Three products, not four",
        ("asset-grid",),
        rationale="Makes the key insight visible before the title is read",
    )
    editor = ThumbnailEditorData(
        "thumb-document-1",
        candidate.candidate_id,
        1280,
        720,
        (
            ThumbnailLayer(
                "headline",
                ThumbnailLayerType.TEXT,
                NormalizedRect(0.08, 0.12, 0.5, 0.3),
                10,
                candidate.headline,
                style={"font": "Bricolage", "color": "#151827"},
            ),
            ThumbnailLayer(
                "background",
                ThumbnailLayerType.BACKGROUND,
                NormalizedRect(0, 0, 1, 1),
                0,
                "#F7F8FC",
                locked=True,
            ),
        ),
        selected_layer_id="headline",
        guides=(0.5,),
    )
    return candidate, editor


if __name__ == "__main__":
    unittest.main()
