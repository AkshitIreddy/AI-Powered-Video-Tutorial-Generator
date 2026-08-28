from __future__ import annotations

import json
import unittest
from pathlib import Path

from alystria.qa.evaluation import (
    RUBRIC_DIMENSIONS,
    AcceptanceMetrics,
    DimensionScore,
    evaluate_acceptance,
    evaluate_comparison,
    rubric_template,
)
from alystria.qa.media import AudioMetrics, CaptionCue, TimelineMetrics, check_audio, check_timeline
from alystria.qa.models import GateStatus
from alystria.qa.review import ReviewHotspot, ReviewScene, build_review_plan
from alystria.qa.visual import (
    ElementKind,
    Rect,
    VisualElement,
    VisualSnapshot,
    check_visual_snapshot,
    contrast_ratio,
)

FIXTURE_PATH = Path(__file__).parents[1] / "fixtures" / "qa_faults.json"


class AudioTimelineTests(unittest.TestCase):
    def test_release_quality_audio_passes(self) -> None:
        gate = check_audio(AudioMetrics(10.0, 48_000, 2, -16.0, -1.5, 0, 0.03, 0.98))
        self.assertEqual(gate.status, GateStatus.PASS)

    def test_fault_fixture_covers_audio_thresholds(self) -> None:
        fault = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))["audio"]
        gate = check_audio(AudioMetrics(**fault))
        self.assertEqual(gate.status, GateStatus.FAIL)
        self.assertEqual(
            {finding.code for finding in gate.findings},
            {
                "audio.alignment_coverage",
                "audio.asr_wer",
                "audio.clipping",
                "audio.loudness",
                "audio.true_peak",
            },
        )

    def test_non_finite_audio_metric_blocks_instead_of_slipping_through(self) -> None:
        gate = check_audio(AudioMetrics(10.0, 48_000, 2, float("nan"), -1.5, 0))
        self.assertEqual(gate.status, GateStatus.BLOCKED)
        self.assertEqual(gate.findings[0].code, "audio.non_finite_metric")

    def test_timeline_accepts_one_frame_and_finds_drift_and_caption_faults(self) -> None:
        passing = check_timeline(TimelineMetrics("scene", 10, 10 + 1 / 30, 10, 30))
        failing = check_timeline(
            TimelineMetrics(
                "scene",
                10,
                10.1,
                9.8,
                30,
                (CaptionCue("a", 1, 3), CaptionCue("b", 2.5, 2), CaptionCue("c", 11, 12)),
            )
        )
        self.assertEqual(passing.status, GateStatus.PASS)
        self.assertEqual(failing.status, GateStatus.FAIL)
        self.assertIn("timeline.audio_drift", {finding.code for finding in failing.findings})
        self.assertIn("timeline.caption_bounds", {finding.code for finding in failing.findings})


class VisualTests(unittest.TestCase):
    def test_contrast_reference_values(self) -> None:
        self.assertAlmostEqual(contrast_ratio("#000000", "#FFFFFF"), 21.0, places=4)
        self.assertGreater(contrast_ratio("#151827", "#F7F8FC"), 4.5)

    def test_fault_fixture_finds_overflow_contrast_and_caption_obstruction(self) -> None:
        fault = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))["visual"]
        elements = tuple(
            VisualElement(
                element_id=item["element_id"],
                kind=ElementKind(item["kind"]),
                bounds=Rect(*item["bounds"]),
                foreground=item.get("foreground"),
                background=item.get("background"),
                essential=item.get("essential", False),
            )
            for item in fault["elements"]
        )
        gate = check_visual_snapshot(
            VisualSnapshot(
                fault["scene_id"], fault["tick"], fault["width"], fault["height"], elements
            )
        )
        codes = {finding.code for finding in gate.findings}
        self.assertEqual(gate.status, GateStatus.FAIL)
        self.assertTrue(
            {"visual.overflow", "visual.low_contrast", "visual.caption_obstruction"} <= codes
        )

    def test_blank_frame_is_critical(self) -> None:
        gate = check_visual_snapshot(VisualSnapshot("blank", 0, 1920, 1080, ()))
        self.assertEqual(gate.status, GateStatus.BLOCKED)

    def test_invalid_color_becomes_a_finding(self) -> None:
        element = VisualElement(
            "text",
            ElementKind.TEXT,
            Rect(100, 100, 200, 100),
            foreground="not-a-color",
            background="#ffffff",
        )
        gate = check_visual_snapshot(VisualSnapshot("color", 0, 1920, 1080, (element,)))
        self.assertEqual(gate.status, GateStatus.FAIL)
        self.assertEqual(gate.findings[0].code, "visual.invalid_color")


class ReviewSamplingTests(unittest.TestCase):
    def test_plan_samples_boundaries_midpoints_hotspots_and_full_audio(self) -> None:
        scenes = (ReviewScene("s1", 0, 2_400_000), ReviewScene("s2", 2_400_000, 4_800_000))
        plan = build_review_plan(
            scenes,
            hotspots=(ReviewHotspot("s2", 3_000_000, "caption_obstruction"),),
            max_frame_samples=7,
            seed=42,
        )
        self.assertTrue(plan.inspect_entire_audio)
        self.assertEqual(plan.seed, 42)
        self.assertEqual(len(plan.frame_samples), 7)
        self.assertIn(3_000_000, {sample.tick for sample in plan.frame_samples})
        self.assertEqual(len(plan.audio_samples), 1)

    def test_plan_is_deterministic_and_spreads_when_capped(self) -> None:
        scenes = tuple(
            ReviewScene(f"s{index}", index * 1_000, (index + 1) * 1_000) for index in range(20)
        )
        first = build_review_plan(scenes, max_frame_samples=9)
        second = build_review_plan(scenes, max_frame_samples=9)
        self.assertEqual(first, second)
        self.assertEqual(len(first.frame_samples), 9)
        ticks = [sample.tick for sample in first.frame_samples]
        self.assertLess(min(ticks), 2_000)
        self.assertGreater(max(ticks), 18_000)


def passing_metrics(**overrides: object) -> AcceptanceMetrics:
    values: dict[str, object] = {
        "strict_claim_support_ratio": 1.0,
        "unresolved_critical_claims": 0,
        "unresolved_major_claims": 0,
        "clipped_samples": 0,
        "integrated_lufs": -16.0,
        "true_peak_dbtp": -1.5,
        "narration_wer": 0.03,
        "aligned_token_ratio": 0.98,
        "av_drift_seconds": 1 / 30,
        "fps": 30.0,
        "local_mode_network_egress": 0,
        "secret_exposures": 0,
        "canonical_projects_rendered": 8,
        "canonical_projects_expected": 8,
        "karatsuba_three_multiplication_correct": True,
        "karatsuba_worked_product": 7_006_652,
        "karatsuba_complexity_compared": True,
        "karatsuba_scene_local_edit_verified": True,
    }
    values.update(overrides)
    return AcceptanceMetrics(**values)  # type: ignore[arg-type]


class EvaluationTests(unittest.TestCase):
    def test_rubric_is_complete_and_passing_comparison_meets_gate(self) -> None:
        self.assertEqual(set(rubric_template()), set(RUBRIC_DIMENSIONS))
        scores = tuple(DimensionScore(name, 3.0, 4.5) for name in RUBRIC_DIMENSIONS)
        result = evaluate_comparison(scores)
        self.assertEqual(result.gate.status, GateStatus.PASS)
        self.assertEqual(result.improved_dimensions, 12)
        self.assertEqual(result.key_average, 4.5)

    def test_comparison_fails_incomplete_regressing_or_insufficient_result(self) -> None:
        scores = tuple(
            DimensionScore(name, 4.0, 3.0 if index == 0 else 4.0, critical=index == 0)
            for index, name in enumerate(RUBRIC_DIMENSIONS[:8])
        )
        result = evaluate_comparison(scores)
        codes = {finding.code for finding in result.gate.findings}
        self.assertEqual(result.gate.status, GateStatus.BLOCKED)
        self.assertTrue(
            {
                "evaluation.rubric_incomplete",
                "evaluation.insufficient_improvement",
                "evaluation.critical_regression",
            }
            <= codes
        )

    def test_release_acceptance_exact_thresholds_pass(self) -> None:
        self.assertEqual(evaluate_acceptance(passing_metrics()).status, GateStatus.PASS)

    def test_release_acceptance_faults_block_on_critical_security(self) -> None:
        gate = evaluate_acceptance(
            passing_metrics(
                strict_claim_support_ratio=0.99,
                unresolved_critical_claims=1,
                local_mode_network_egress=1,
                secret_exposures=1,
                karatsuba_worked_product=0,
            )
        )
        self.assertEqual(gate.status, GateStatus.BLOCKED)
        self.assertEqual(len(gate.findings), 5)


if __name__ == "__main__":
    unittest.main()
