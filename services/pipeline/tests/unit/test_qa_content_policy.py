from __future__ import annotations

import unittest
from datetime import UTC, datetime

from alystria.qa.content import (
    Citation,
    Claim,
    ContentPackage,
    Objective,
    SceneContent,
    check_claims_and_citations,
    check_contradictions,
    check_objectives,
    check_terminology,
    claim_support_ratio,
)
from alystria.qa.models import Finding, GateStatus, QualityGate, Severity, export_permitted
from alystria.qa.policy import (
    AccessibilityReport,
    PrivacyTransfer,
    RightsAsset,
    check_accessibility,
    check_privacy,
    check_rights,
)
from alystria.qa.repair import MAX_AUTOMATIC_REPAIRS, RepairCoordinator
from alystria.qa.report import QualityReport
from alystria.qa.validators import (
    CodeValidationRequest,
    MathValidationRequest,
    StructuralCodeValidator,
    StructuralMathValidator,
    code_gate,
    math_gate,
)


def valid_package() -> ContentPackage:
    citation = Citation("cit-1", "source-1", "page 4, paragraph 2", "sha256:abc")
    claim = Claim(
        "claim-1",
        "Karatsuba needs three recursive products.",
        "scene-1",
        True,
        ("cit-1",),
        True,
        "product-count",
        True,
    )
    scene = SceneContent(
        "scene-1", "We derive three recursive products.", ("objective-1",), (claim,)
    )
    return ContentPackage(
        (Objective("objective-1", "Derive Karatsuba's recurrence"),),
        (scene,),
        (citation,),
        {"recursive product": ("sub-call",)},
    )


class QualityModelTests(unittest.TestCase):
    def test_gate_reduction_and_export_policy(self) -> None:
        warning = QualityGate.from_findings(
            "warning", "test", (Finding("w", "warning", Severity.MINOR),)
        )
        failure = QualityGate.from_findings(
            "failure", "test", (Finding("f", "failure", Severity.MAJOR),)
        )
        blocked = QualityGate.from_findings(
            "blocked", "test", (Finding("b", "critical", Severity.CRITICAL),)
        )
        self.assertEqual(warning.status, GateStatus.WARNING)
        self.assertEqual(failure.status, GateStatus.FAIL)
        self.assertEqual(blocked.status, GateStatus.BLOCKED)
        self.assertTrue(export_permitted((warning,)))
        self.assertFalse(export_permitted((failure,)))
        required_skip = QualityGate("skip", "test", GateStatus.SKIPPED)
        optional_skip = QualityGate("skip", "test", GateStatus.SKIPPED, required=False)
        self.assertFalse(required_skip.permits_export)
        self.assertTrue(optional_skip.permits_export)

    def test_report_is_deterministic_and_counts_findings(self) -> None:
        report = QualityReport.build(
            (
                QualityGate.from_findings("b", "visual", (Finding("x", "x", Severity.MINOR),)),
                QualityGate.from_findings("a", "audio", ()),
            )
        )
        self.assertEqual([gate.gate_id for gate in report.gates], ["a", "b"])
        self.assertEqual(report.status, GateStatus.WARNING)
        self.assertEqual(report.finding_count(Severity.MINOR), 1)


class ContentTests(unittest.TestCase):
    def test_valid_content_passes_all_core_checks(self) -> None:
        package = valid_package()
        self.assertEqual(check_objectives(package).status, GateStatus.PASS)
        self.assertEqual(check_claims_and_citations(package, strict=True).status, GateStatus.PASS)
        self.assertEqual(check_terminology(package).status, GateStatus.PASS)
        self.assertEqual(check_contradictions(package).status, GateStatus.PASS)
        self.assertEqual(claim_support_ratio(package), 1.0)

    def test_objective_and_empty_narration_failures(self) -> None:
        package = ContentPackage(
            (Objective("o-1", ""),), (SceneContent("s-1", "", ("o-unknown",)),)
        )
        gate = check_objectives(package)
        self.assertEqual(gate.status, GateStatus.FAIL)
        self.assertEqual(
            {finding.code for finding in gate.findings},
            {
                "content.empty_narration",
                "objective.empty",
                "objective.uncovered",
                "objective.unknown_reference",
            },
        )

    def test_strict_claim_gate_requires_locator_and_support(self) -> None:
        claim = Claim("c", "A fact", "s", citation_ids=("missing",), supported=False)
        package = ContentPackage((), (SceneContent("s", "A fact", claims=(claim,)),))
        gate = check_claims_and_citations(package, strict=True)
        self.assertEqual(gate.status, GateStatus.FAIL)
        self.assertEqual(
            {item.code for item in gate.findings}, {"citation.missing", "claim.unsupported"}
        )

    def test_grounded_uncited_claim_warns_while_strict_fails(self) -> None:
        claim = Claim("c", "A fact", "s")
        package = ContentPackage((), (SceneContent("s", "A fact", claims=(claim,)),))
        self.assertEqual(
            check_claims_and_citations(package, strict=False).status, GateStatus.WARNING
        )
        self.assertEqual(check_claims_and_citations(package, strict=True).status, GateStatus.FAIL)

    def test_terminology_and_contradiction_checks(self) -> None:
        positive = Claim(
            "c1", "Three products", "s1", False, proposition_key="count", polarity=True
        )
        negative = Claim(
            "c2", "Not three products", "s2", False, proposition_key="count", polarity=False
        )
        package = ContentPackage(
            (),
            (
                SceneContent("s1", "Use a sub-call.", claims=(positive,)),
                SceneContent("s2", "Correction", claims=(negative,)),
            ),
            terminology={"recursive product": ("sub-call",)},
        )
        self.assertEqual(check_terminology(package).status, GateStatus.WARNING)
        self.assertEqual(check_contradictions(package).status, GateStatus.FAIL)


class ValidatorTests(unittest.TestCase):
    def test_structural_validators_are_replaceable_preflights(self) -> None:
        math = math_gate((MathValidationRequest("math", "(x + 1"),), StructuralMathValidator())
        code = code_gate(
            (CodeValidationRequest("code", "python", "", timeout_ms=0),), StructuralCodeValidator()
        )
        self.assertEqual(
            {finding.code for finding in math.findings}, {"math.unbalanced_parentheses"}
        )
        self.assertEqual(
            {finding.code for finding in code.findings}, {"code.empty", "code.invalid_timeout"}
        )


class PolicyTests(unittest.TestCase):
    def test_accessibility_gate_blocks_missing_equivalents(self) -> None:
        gate = check_accessibility(
            AccessibilityReport(True, False, False, False, True, False, True, False)
        )
        self.assertEqual(gate.status, GateStatus.FAIL)
        self.assertEqual(len(gate.findings), 6)

    def test_rights_gate_blocks_unknown_expired_and_missing_consent(self) -> None:
        asset = RightsAsset(
            "legacy",
            "unknown",
            attribution_required=True,
            preview_only=True,
            expires_at="2020-01-01T00:00:00Z",
            real_person=True,
        )
        gate = check_rights((asset,), now=datetime(2026, 1, 1, tzinfo=UTC))
        self.assertEqual(gate.status, GateStatus.BLOCKED)
        self.assertIn("rights.consent_missing", {finding.code for finding in gate.findings})

    def test_privacy_gate_blocks_local_or_unapproved_egress(self) -> None:
        transfer = PrivacyTransfer("t", "provider", "source", True, False, False, False, True, True)
        gate = check_privacy((transfer,), fully_local=True)
        self.assertEqual(gate.status, GateStatus.BLOCKED)
        self.assertEqual(len(gate.findings), 6)


class RepairTests(unittest.TestCase):
    def test_repairs_stop_after_two_attempts(self) -> None:
        def validate(value: int) -> tuple[Finding, ...]:
            return (
                ()
                if value >= 3
                else (Finding("too_small", "too small", Severity.MAJOR, repairable=True),)
            )

        result = RepairCoordinator[int]().run(
            0, validate, lambda value, _findings, _attempt: value + 1
        )
        self.assertEqual(len(result.attempts), MAX_AUTOMATIC_REPAIRS)
        self.assertEqual(result.value, 2)
        self.assertTrue(result.requires_human_review)

    def test_repairs_stop_when_fixed_or_unchanged(self) -> None:
        issue = (Finding("broken", "broken", Severity.MAJOR, repairable=True),)
        fixed = RepairCoordinator[int]().run(
            0, lambda value: () if value else issue, lambda *_args: 1
        )
        unchanged = RepairCoordinator[int]().run(
            0, lambda _value: issue, lambda value, *_args: value
        )
        self.assertEqual(len(fixed.attempts), 1)
        self.assertFalse(fixed.requires_human_review)
        self.assertEqual(len(unchanged.attempts), 1)

    def test_repair_limit_cannot_exceed_policy(self) -> None:
        with self.assertRaises(ValueError):
            RepairCoordinator[int](max_attempts=MAX_AUTOMATIC_REPAIRS + 1)


if __name__ == "__main__":
    unittest.main()
