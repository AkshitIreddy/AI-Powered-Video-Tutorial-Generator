"""Deterministic, provider-neutral QA and release evaluation for Alystria."""

from .evaluation import (
    AcceptanceMetrics,
    ComparisonResult,
    DimensionScore,
    evaluate_acceptance,
    evaluate_comparison,
    rubric_template,
)
from .models import Finding, GateStatus, QualityGate, Severity, export_permitted
from .repair import MAX_AUTOMATIC_REPAIRS, RepairCoordinator, RepairResult
from .report import QualityReport

__all__ = [
    "MAX_AUTOMATIC_REPAIRS",
    "AcceptanceMetrics",
    "ComparisonResult",
    "DimensionScore",
    "Finding",
    "GateStatus",
    "QualityGate",
    "QualityReport",
    "RepairCoordinator",
    "RepairResult",
    "Severity",
    "evaluate_acceptance",
    "evaluate_comparison",
    "export_permitted",
    "rubric_template",
]
