"""Serializable quality-assurance records and gate reduction rules.

The QA package deliberately has no provider, database, or rendering dependency.  A
worker can emit :class:`Finding` records, while the pipeline is the authority that
reduces them to an export decision.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any


class Severity(StrEnum):
    INFO = "INFO"
    MINOR = "MINOR"
    MAJOR = "MAJOR"
    CRITICAL = "CRITICAL"

    @property
    def rank(self) -> int:
        return (Severity.INFO, Severity.MINOR, Severity.MAJOR, Severity.CRITICAL).index(self)


class GateStatus(StrEnum):
    PASS = "PASS"
    WARNING = "WARNING"
    FAIL = "FAIL"
    BLOCKED = "BLOCKED"
    SKIPPED = "SKIPPED"

    @property
    def permits_export(self) -> bool:
        return self in {GateStatus.PASS, GateStatus.WARNING}


@dataclass(frozen=True, slots=True)
class Finding:
    code: str
    message: str
    severity: Severity
    location: str | None = None
    evidence: str | None = None
    repairable: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class QualityGate:
    gate_id: str
    category: str
    status: GateStatus
    findings: tuple[Finding, ...] = ()
    required: bool = True
    summary: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def permits_export(self) -> bool:
        return (not self.required) or self.status.permits_export

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_findings(
        cls,
        gate_id: str,
        category: str,
        findings: Iterable[Finding],
        *,
        required: bool = True,
        blocked: bool = False,
        skipped: bool = False,
        summary: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> QualityGate:
        materialized = tuple(sorted(findings, key=_finding_sort_key))
        if blocked:
            status = GateStatus.BLOCKED
        elif skipped:
            status = GateStatus.SKIPPED
        elif any(item.severity is Severity.CRITICAL for item in materialized):
            status = GateStatus.BLOCKED
        elif any(item.severity is Severity.MAJOR for item in materialized):
            status = GateStatus.FAIL
        elif materialized:
            status = GateStatus.WARNING
        else:
            status = GateStatus.PASS
        return cls(
            gate_id=gate_id,
            category=category,
            status=status,
            findings=materialized,
            required=required,
            summary=summary,
            metadata={} if metadata is None else metadata,
        )


def _finding_sort_key(finding: Finding) -> tuple[int, str, str]:
    return (-finding.severity.rank, finding.location or "", finding.code)


def export_permitted(gates: Iterable[QualityGate]) -> bool:
    """Return the authoritative export decision for a set of gates."""

    return all(gate.permits_export for gate in gates)
