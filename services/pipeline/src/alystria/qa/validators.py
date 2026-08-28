"""Replaceable math and code validator interfaces.

Adapters may use SymPy, WASI, Pyodide, or another sandbox.  The QA coordinator
depends only on these protocols and never evaluates generated code itself.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from .models import Finding, QualityGate, Severity


@dataclass(frozen=True, slots=True)
class MathValidationRequest:
    scene_id: str
    expression: str
    expected: str | None = None
    assumptions: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class CodeValidationRequest:
    scene_id: str
    language: str
    source: str
    expected_stdout: str | None = None
    timeout_ms: int = 2_000


@runtime_checkable
class MathValidator(Protocol):
    def validate(self, request: MathValidationRequest) -> tuple[Finding, ...]: ...


@runtime_checkable
class CodeValidator(Protocol):
    def validate(self, request: CodeValidationRequest) -> tuple[Finding, ...]: ...


class StructuralMathValidator:
    """Dependency-free preflight; symbolic correctness belongs to an adapter."""

    def validate(self, request: MathValidationRequest) -> tuple[Finding, ...]:
        findings: list[Finding] = []
        expression = request.expression.strip()
        if not expression:
            findings.append(
                Finding(
                    "math.empty",
                    "Mathematics scene has no expression.",
                    Severity.MAJOR,
                    f"scene:{request.scene_id}",
                )
            )
        if expression.count("(") != expression.count(")"):
            findings.append(
                Finding(
                    "math.unbalanced_parentheses",
                    "Expression has unbalanced parentheses.",
                    Severity.MAJOR,
                    f"scene:{request.scene_id}",
                    evidence=expression,
                    repairable=True,
                )
            )
        return tuple(findings)


class StructuralCodeValidator:
    """Preflight only; execution must be delegated to a sandbox adapter."""

    def validate(self, request: CodeValidationRequest) -> tuple[Finding, ...]:
        findings: list[Finding] = []
        if not request.source.strip():
            findings.append(
                Finding(
                    "code.empty",
                    "Code scene has no source.",
                    Severity.MAJOR,
                    f"scene:{request.scene_id}",
                )
            )
        if request.timeout_ms <= 0:
            findings.append(
                Finding(
                    "code.invalid_timeout",
                    "Sandbox timeout must be positive.",
                    Severity.MAJOR,
                    f"scene:{request.scene_id}",
                )
            )
        return tuple(findings)


def math_gate(requests: tuple[MathValidationRequest, ...], validator: MathValidator) -> QualityGate:
    return QualityGate.from_findings(
        "technical.math",
        "math",
        (finding for request in requests for finding in validator.validate(request)),
    )


def code_gate(requests: tuple[CodeValidationRequest, ...], validator: CodeValidator) -> QualityGate:
    return QualityGate.from_findings(
        "technical.code",
        "code",
        (finding for request in requests for finding in validator.validate(request)),
    )
