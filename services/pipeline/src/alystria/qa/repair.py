"""Bounded, auditable automatic-repair coordination."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

from .models import Finding, Severity

T = TypeVar("T")
MAX_AUTOMATIC_REPAIRS = 2


@dataclass(frozen=True, slots=True)
class RepairAttempt:
    attempt_number: int
    before: tuple[Finding, ...]
    after: tuple[Finding, ...]
    changed: bool


@dataclass(frozen=True, slots=True)
class RepairResult[T]:
    value: T
    findings: tuple[Finding, ...]
    attempts: tuple[RepairAttempt, ...]
    requires_human_review: bool


RepairFunction = Callable[[T, tuple[Finding, ...], int], T]
ValidationFunction = Callable[[T], tuple[Finding, ...]]


class RepairCoordinator[T]:
    def __init__(self, *, max_attempts: int = MAX_AUTOMATIC_REPAIRS) -> None:
        if not 0 <= max_attempts <= MAX_AUTOMATIC_REPAIRS:
            raise ValueError(f"max_attempts must be between 0 and {MAX_AUTOMATIC_REPAIRS}")
        self.max_attempts = max_attempts

    def run(
        self, value: T, validate: ValidationFunction[T], repair: RepairFunction[T]
    ) -> RepairResult[T]:
        current = value
        findings = tuple(validate(current))
        attempts: list[RepairAttempt] = []
        for attempt_number in range(1, self.max_attempts + 1):
            repairable = tuple(item for item in findings if item.repairable)
            if not repairable or not _has_blocking(findings):
                break
            candidate = repair(current, repairable, attempt_number)
            candidate_findings = tuple(validate(candidate))
            changed = candidate != current or candidate_findings != findings
            attempts.append(RepairAttempt(attempt_number, findings, candidate_findings, changed))
            current = candidate
            findings = candidate_findings
            if not changed:
                break
        return RepairResult(
            value=current,
            findings=findings,
            attempts=tuple(attempts),
            requires_human_review=_has_blocking(findings),
        )


def _has_blocking(findings: tuple[Finding, ...]) -> bool:
    return any(item.severity in {Severity.MAJOR, Severity.CRITICAL} for item in findings)
