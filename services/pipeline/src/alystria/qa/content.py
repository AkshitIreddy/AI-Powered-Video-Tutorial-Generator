"""Deterministic instructional-content, claim, and citation checks."""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

from .models import Finding, QualityGate, Severity


@dataclass(frozen=True, slots=True)
class Objective:
    objective_id: str
    text: str


@dataclass(frozen=True, slots=True)
class Citation:
    citation_id: str
    source_id: str
    locator: str | None
    source_hash: str | None = None


@dataclass(frozen=True, slots=True)
class Claim:
    claim_id: str
    text: str
    scene_id: str
    externally_verifiable: bool = True
    citation_ids: tuple[str, ...] = ()
    supported: bool = False
    proposition_key: str | None = None
    polarity: bool = True


@dataclass(frozen=True, slots=True)
class SceneContent:
    scene_id: str
    narration: str
    objective_ids: tuple[str, ...] = ()
    claims: tuple[Claim, ...] = ()


@dataclass(frozen=True, slots=True)
class ContentPackage:
    objectives: tuple[Objective, ...]
    scenes: tuple[SceneContent, ...]
    citations: tuple[Citation, ...] = ()
    terminology: Mapping[str, tuple[str, ...]] = field(default_factory=dict)


def check_objectives(package: ContentPackage) -> QualityGate:
    findings: list[Finding] = []
    declared = {objective.objective_id for objective in package.objectives}
    covered = {objective_id for scene in package.scenes for objective_id in scene.objective_ids}
    for duplicate in _duplicates(objective.objective_id for objective in package.objectives):
        findings.append(
            Finding(
                "objective.duplicate_id",
                f"Objective ID {duplicate} is not unique.",
                Severity.MAJOR,
                f"objective:{duplicate}",
            )
        )
    for objective in package.objectives:
        if not objective.text.strip():
            findings.append(
                Finding(
                    "objective.empty",
                    f"Objective {objective.objective_id} has no learner-facing text.",
                    Severity.MAJOR,
                    f"objective:{objective.objective_id}",
                    repairable=True,
                )
            )
        if objective.objective_id not in covered:
            findings.append(
                Finding(
                    "objective.uncovered",
                    f"No scene teaches objective {objective.objective_id}.",
                    Severity.MAJOR,
                    f"objective:{objective.objective_id}",
                    repairable=True,
                )
            )
    for scene in package.scenes:
        for unknown in sorted(set(scene.objective_ids) - declared):
            findings.append(
                Finding(
                    "objective.unknown_reference",
                    f"Scene {scene.scene_id} references undeclared objective {unknown}.",
                    Severity.MAJOR,
                    f"scene:{scene.scene_id}",
                    repairable=True,
                )
            )
        if not scene.narration.strip():
            findings.append(
                Finding(
                    "content.empty_narration",
                    f"Scene {scene.scene_id} has no narration.",
                    Severity.MAJOR,
                    f"scene:{scene.scene_id}",
                    repairable=True,
                )
            )
    return QualityGate.from_findings("content.objectives", "content", findings)


def check_claims_and_citations(package: ContentPackage, *, strict: bool) -> QualityGate:
    citations = {citation.citation_id: citation for citation in package.citations}
    findings: list[Finding] = []
    for duplicate in _duplicates(citation.citation_id for citation in package.citations):
        findings.append(
            Finding(
                "citation.duplicate_id",
                f"Citation ID {duplicate} is not unique.",
                Severity.MAJOR,
                f"citation:{duplicate}",
            )
        )
    all_claims = [claim for scene in package.scenes for claim in scene.claims]
    for duplicate in _duplicates(claim.claim_id for claim in all_claims):
        findings.append(
            Finding(
                "claim.duplicate_id",
                f"Claim ID {duplicate} is not unique.",
                Severity.MAJOR,
                f"claim:{duplicate}",
            )
        )
    for scene in package.scenes:
        for claim in scene.claims:
            location = f"scene:{scene.scene_id}/claim:{claim.claim_id}"
            if not claim.text.strip():
                findings.append(
                    Finding(
                        "claim.empty",
                        f"Claim {claim.claim_id} has no text.",
                        Severity.MAJOR,
                        location,
                        repairable=True,
                    )
                )
            if claim.externally_verifiable and not claim.citation_ids:
                findings.append(
                    Finding(
                        "claim.uncited",
                        f"Externally verifiable claim {claim.claim_id} has no citation.",
                        Severity.MAJOR if strict else Severity.MINOR,
                        location,
                        repairable=True,
                    )
                )
            for citation_id in claim.citation_ids:
                citation = citations.get(citation_id)
                if citation is None:
                    findings.append(
                        Finding(
                            "citation.missing",
                            f"Claim {claim.claim_id} references missing citation {citation_id}.",
                            Severity.MAJOR,
                            location,
                            repairable=True,
                        )
                    )
                elif not citation.locator or not citation.locator.strip():
                    findings.append(
                        Finding(
                            "citation.no_locator",
                            f"Citation {citation_id} lacks an exact source locator.",
                            Severity.MAJOR if strict else Severity.MINOR,
                            location,
                            repairable=True,
                        )
                    )
            if claim.externally_verifiable and claim.citation_ids and not claim.supported:
                findings.append(
                    Finding(
                        "claim.unsupported",
                        f"Citations do not establish claim {claim.claim_id}.",
                        Severity.MAJOR if strict else Severity.MINOR,
                        location,
                        repairable=True,
                    )
                )
    return QualityGate.from_findings(
        "content.claim_support",
        "factuality",
        findings,
        metadata={"mode": "strict" if strict else "grounded"},
    )


def check_terminology(package: ContentPackage) -> QualityGate:
    findings: list[Finding] = []
    for scene in package.scenes:
        text = scene.narration
        for canonical, discouraged in sorted(package.terminology.items()):
            for alias in discouraged:
                if _contains_term(text, alias):
                    findings.append(
                        Finding(
                            "terminology.inconsistent",
                            f"Use canonical term '{canonical}' instead of '{alias}'.",
                            Severity.MINOR,
                            f"scene:{scene.scene_id}",
                            evidence=alias,
                            repairable=True,
                        )
                    )
    return QualityGate.from_findings("content.terminology", "content", findings)


def check_contradictions(package: ContentPackage) -> QualityGate:
    grouped: dict[str, list[Claim]] = {}
    for scene in package.scenes:
        for claim in scene.claims:
            if claim.proposition_key:
                grouped.setdefault(claim.proposition_key, []).append(claim)
    findings: list[Finding] = []
    for key, claims in sorted(grouped.items()):
        if {claim.polarity for claim in claims} == {False, True}:
            ids = ", ".join(sorted(claim.claim_id for claim in claims))
            findings.append(
                Finding(
                    "content.contradiction",
                    f"Claims {ids} disagree about '{key}'.",
                    Severity.MAJOR,
                    f"proposition:{key}",
                    evidence=ids,
                    repairable=True,
                )
            )
    return QualityGate.from_findings("content.contradictions", "content", findings)


def run_content_checks(package: ContentPackage, *, strict: bool = True) -> tuple[QualityGate, ...]:
    return (
        check_objectives(package),
        check_claims_and_citations(package, strict=strict),
        check_terminology(package),
        check_contradictions(package),
    )


def claim_support_ratio(package: ContentPackage) -> float:
    verifiable = [
        claim for scene in package.scenes for claim in scene.claims if claim.externally_verifiable
    ]
    if not verifiable:
        return 1.0
    supported = sum(bool(claim.citation_ids) and claim.supported for claim in verifiable)
    return supported / len(verifiable)


def _contains_term(text: str, term: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(term)}(?!\w)", text, re.IGNORECASE) is not None


def claims(package: ContentPackage) -> Iterable[Claim]:
    return (claim for scene in package.scenes for claim in scene.claims)


def _duplicates(values: Iterable[str]) -> tuple[str, ...]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for value in values:
        if value in seen:
            duplicates.add(value)
        seen.add(value)
    return tuple(sorted(duplicates))
