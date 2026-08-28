"""Aggregate report helpers shared by pipeline and desktop UI adapters."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from .models import GateStatus, QualityGate, Severity, export_permitted


@dataclass(frozen=True, slots=True)
class QualityReport:
    gates: tuple[QualityGate, ...]

    @classmethod
    def build(cls, gates: Iterable[QualityGate]) -> QualityReport:
        return cls(tuple(sorted(gates, key=lambda gate: (gate.category, gate.gate_id))))

    @property
    def permits_export(self) -> bool:
        return export_permitted(self.gates)

    @property
    def status(self) -> GateStatus:
        statuses = {gate.status for gate in self.gates if gate.required}
        if GateStatus.BLOCKED in statuses:
            return GateStatus.BLOCKED
        if GateStatus.FAIL in statuses:
            return GateStatus.FAIL
        if GateStatus.WARNING in statuses:
            return GateStatus.WARNING
        if statuses == {GateStatus.SKIPPED}:
            return GateStatus.SKIPPED
        return GateStatus.PASS

    def finding_count(self, severity: Severity | None = None) -> int:
        return sum(
            1
            for gate in self.gates
            for finding in gate.findings
            if severity is None or finding.severity is severity
        )
