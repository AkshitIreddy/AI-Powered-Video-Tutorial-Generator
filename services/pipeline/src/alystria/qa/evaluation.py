"""Alystria 1.0-vs-2.0 comparison rubric and release acceptance gates."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from .models import Finding, QualityGate, Severity

RUBRIC_DIMENSIONS = (
    "teaching_sequence",
    "factuality",
    "citation_support",
    "visual_relevance_diversity",
    "narration",
    "presenter",
    "layout",
    "consistency",
    "reliability",
    "setup",
    "editability",
    "render_quality",
)
KEY_ACCEPTANCE_DIMENSIONS = (
    "factuality",
    "teaching_sequence",
    "visual_relevance_diversity",
    "narration",
    "editability",
)
MIN_KEY_AVERAGE = 4.0
MIN_IMPROVED_DIMENSIONS = 9


@dataclass(frozen=True, slots=True)
class DimensionScore:
    dimension: str
    v1_score: float
    v2_score: float
    critical: bool = False

    def __post_init__(self) -> None:
        if self.dimension not in RUBRIC_DIMENSIONS:
            raise ValueError(f"Unknown rubric dimension: {self.dimension}")
        if not 1 <= self.v1_score <= 5 or not 1 <= self.v2_score <= 5:
            raise ValueError("Rubric scores must be between 1 and 5")

    @property
    def delta(self) -> float:
        return self.v2_score - self.v1_score


@dataclass(frozen=True, slots=True)
class ComparisonResult:
    scores: tuple[DimensionScore, ...]
    key_average: float
    improved_dimensions: int
    regressed_dimensions: tuple[str, ...]
    gate: QualityGate


@dataclass(frozen=True, slots=True)
class AcceptanceMetrics:
    strict_claim_support_ratio: float
    unresolved_critical_claims: int
    unresolved_major_claims: int
    clipped_samples: int
    integrated_lufs: float
    true_peak_dbtp: float
    narration_wer: float
    aligned_token_ratio: float
    av_drift_seconds: float
    fps: float
    local_mode_network_egress: int
    secret_exposures: int
    canonical_projects_rendered: int
    canonical_projects_expected: int
    karatsuba_three_multiplication_correct: bool
    karatsuba_worked_product: int | None
    karatsuba_complexity_compared: bool
    karatsuba_scene_local_edit_verified: bool


def evaluate_comparison(scores: tuple[DimensionScore, ...]) -> ComparisonResult:
    by_dimension = {score.dimension: score for score in scores}
    missing = sorted(set(RUBRIC_DIMENSIONS) - set(by_dimension))
    duplicates = len(scores) != len(by_dimension)
    findings: list[Finding] = []
    if missing:
        findings.append(
            Finding(
                "evaluation.rubric_incomplete",
                f"Rubric is missing dimensions: {', '.join(missing)}.",
                Severity.MAJOR,
            )
        )
    if duplicates:
        findings.append(
            Finding(
                "evaluation.rubric_duplicate",
                "Rubric contains duplicate dimensions.",
                Severity.MAJOR,
            )
        )
    key_scores = [
        by_dimension[name].v2_score for name in KEY_ACCEPTANCE_DIMENSIONS if name in by_dimension
    ]
    key_average = sum(key_scores) / len(key_scores) if key_scores else 0.0
    improved = sum(score.delta > 0 for score in by_dimension.values())
    regressed = tuple(sorted(score.dimension for score in by_dimension.values() if score.delta < 0))
    if key_average < MIN_KEY_AVERAGE:
        findings.append(
            Finding(
                "evaluation.key_average",
                f"Key-dimension average {key_average:.2f} is below {MIN_KEY_AVERAGE:.1f}.",
                Severity.MAJOR,
            )
        )
    if improved < MIN_IMPROVED_DIMENSIONS:
        findings.append(
            Finding(
                "evaluation.insufficient_improvement",
                f"2.0 improves {improved} dimensions; at least "
                f"{MIN_IMPROVED_DIMENSIONS} are required.",
                Severity.MAJOR,
            )
        )
    critical_regressions = tuple(
        sorted(
            score.dimension for score in by_dimension.values() if score.critical and score.delta < 0
        )
    )
    if critical_regressions:
        findings.append(
            Finding(
                "evaluation.critical_regression",
                f"2.0 has critical regressions: {', '.join(critical_regressions)}.",
                Severity.CRITICAL,
            )
        )
    gate = QualityGate.from_findings("evaluation.v1_vs_v2", "evaluation", findings)
    return ComparisonResult(scores, key_average, improved, regressed, gate)


def evaluate_acceptance(metrics: AcceptanceMetrics) -> QualityGate:
    findings: list[Finding] = []

    def require(condition: bool, code: str, message: str, *, critical: bool = False) -> None:
        if not condition:
            findings.append(
                Finding(code, message, Severity.CRITICAL if critical else Severity.MAJOR)
            )

    require(
        metrics.strict_claim_support_ratio >= 1.0,
        "acceptance.claim_coverage",
        "Strict-mode claim support must be 100%.",
    )
    require(
        metrics.unresolved_critical_claims == 0,
        "acceptance.critical_claims",
        "Critical claim findings remain.",
        critical=True,
    )
    require(
        metrics.unresolved_major_claims == 0,
        "acceptance.major_claims",
        "Major claim findings remain.",
    )
    require(
        metrics.clipped_samples == 0,
        "acceptance.clipping",
        "Final master contains clipped samples.",
    )
    require(
        abs(metrics.integrated_lufs + 16.0) <= 1.0,
        "acceptance.loudness",
        "Final master is outside -16 ±1 LUFS.",
    )
    require(
        metrics.true_peak_dbtp <= -1.5, "acceptance.true_peak", "Final master exceeds -1.5 dBTP."
    )
    require(metrics.narration_wer <= 0.03, "acceptance.wer", "Narration WER exceeds 3%.")
    require(
        metrics.aligned_token_ratio >= 0.98,
        "acceptance.alignment",
        "Aligned-token ratio is below 98%.",
    )
    frame = 1 / metrics.fps if metrics.fps > 0 else 0.0
    require(
        metrics.fps > 0 and abs(metrics.av_drift_seconds) <= frame + 1e-9,
        "acceptance.av_sync",
        "A/V drift exceeds one frame.",
    )
    require(
        metrics.local_mode_network_egress == 0,
        "acceptance.local_egress",
        "Fully Local mode emitted project-content network traffic.",
        critical=True,
    )
    require(
        metrics.secret_exposures == 0,
        "acceptance.secret_exposure",
        "A secret appeared in an observable artifact.",
        critical=True,
    )
    require(
        metrics.canonical_projects_expected > 0
        and metrics.canonical_projects_rendered == metrics.canonical_projects_expected,
        "acceptance.canonical_fixtures",
        "Not every canonical project rendered successfully.",
    )
    require(
        metrics.karatsuba_three_multiplication_correct,
        "acceptance.karatsuba_method",
        "Karatsuba fixture does not derive the three-multiplication method.",
    )
    require(
        metrics.karatsuba_worked_product == 7_006_652,
        "acceptance.karatsuba_product",
        "Karatsuba fixture must compute 1234 multiplied by 5678 = 7,006,652.",
    )
    require(
        metrics.karatsuba_complexity_compared,
        "acceptance.karatsuba_complexity",
        "Karatsuba fixture does not compare complexity.",
    )
    require(
        metrics.karatsuba_scene_local_edit_verified,
        "acceptance.karatsuba_editability",
        "Karatsuba scene-local editing was not verified.",
    )
    return QualityGate.from_findings("evaluation.release_acceptance", "evaluation", findings)


def rubric_template() -> Mapping[str, str]:
    return {
        "teaching_sequence": (
            "Prerequisites, progression, misconceptions, and recap support learning."
        ),
        "factuality": "Externally verifiable statements are correct and supported.",
        "citation_support": "Citations resolve to exact evidence that establishes each claim.",
        "visual_relevance_diversity": "Visuals explain the narration with appropriate variety.",
        "narration": "Speech is intelligible, well paced, accurate, and pleasant.",
        "presenter": "Presenter use is selective, natural, consented, and synchronized.",
        "layout": "Composition is legible, responsive, safe, and unobstructed.",
        "consistency": "Terminology, visual language, timing, and voices remain coherent.",
        "reliability": "Generation, recovery, caching, and export behave predictably.",
        "setup": "A user can install and start without manual service terminals.",
        "editability": (
            "Scenes and downstream artifacts can be revised without destructive regeneration."
        ),
        "render_quality": "Frames, motion, captions, audio, and encodes meet delivery standards.",
    }
