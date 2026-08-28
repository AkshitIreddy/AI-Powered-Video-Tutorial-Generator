from __future__ import annotations

import unittest

from alystria.research import (
    AtomicClaim,
    ClaimStatus,
    ClaimSupport,
    EvidenceLedger,
    GroundingMode,
    ResearchPolicy,
    SupportRelation,
    chunk_source,
    verify_claim_evidence,
)
from alystria.sources import NotesLoader


class EvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        sentence = "Karatsuba multiplication uses three recursive multiplications instead of four. "
        text = (sentence * 30).strip()
        self.document = NotesLoader().load(text)

    def test_chunking_is_stable_bounded_and_located(self) -> None:
        first = chunk_source(self.document, target_chars=300, overlap_chars=30)
        second = chunk_source(self.document, target_chars=300, overlap_chars=30)
        self.assertEqual(first, second)
        self.assertGreater(len(first), 1)
        self.assertTrue(all(chunk.source_version_id == self.document.version_id for chunk in first))
        self.assertTrue(all("#chars=" in chunk.locator for chunk in first))

    def test_claim_graph_support_and_contradiction(self) -> None:
        chunk = chunk_source(self.document)[0]
        claim = AtomicClaim.create(
            "Karatsuba uses three recursive multiplications.",
            importance="high",
        )
        ledger = EvidenceLedger()
        ledger.add_chunks([chunk])
        ledger.add_claim(claim)
        ledger.link(ClaimSupport(claim.id, chunk.id, SupportRelation.SUPPORTS, 0.95))
        self.assertEqual(ledger.assess(claim.id).status, ClaimStatus.SUPPORTED)
        ledger.link(
            ClaimSupport(
                claim.id,
                chunk.id,
                SupportRelation.CONTRADICTS,
                0.8,
                "Conflicting passage",
            )
        )
        self.assertEqual(ledger.assess(claim.id).status, ClaimStatus.CONTRADICTED)

    def test_creative_warns_while_grounded_and_strict_block_unsupported_claims(self) -> None:
        claim = AtomicClaim.create("An unsupported historical fact.")
        ledger = EvidenceLedger()
        ledger.add_claim(claim)
        creative = ResearchPolicy(GroundingMode.CREATIVE).evaluate(ledger)
        grounded = ResearchPolicy(GroundingMode.GROUNDED).evaluate(ledger)
        strict = ResearchPolicy(GroundingMode.STRICT).evaluate(ledger)
        self.assertTrue(creative.accepted)
        self.assertEqual(creative.findings[0].severity, "warning")
        self.assertFalse(grounded.accepted)
        self.assertFalse(strict.accepted)

    def test_non_verifiable_creative_statement_does_not_require_support(self) -> None:
        ledger = EvidenceLedger()
        ledger.add_claim(
            AtomicClaim.create(
                "Imagine the numbers as two teams.",
                externally_verifiable=False,
            )
        )
        self.assertTrue(ResearchPolicy(GroundingMode.STRICT).evaluate(ledger).accepted)

    def test_offline_verifier_returns_claim_specific_exact_span(self) -> None:
        document = NotesLoader().load(
            "Unrelated introduction.\n\nSaturn has exactly 82 moons.\n\nUnrelated conclusion."
        )
        claim = AtomicClaim.create("Saturn has exactly 82 moons.")
        match = verify_claim_evidence(claim, chunk_source(document))
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.relation, SupportRelation.SUPPORTS)
        self.assertEqual(match.evidence.text, claim.statement)
        self.assertEqual(
            match.evidence.locator,
            f"{document.metadata.locator}#chars=25-53",
        )
        self.assertGreaterEqual(match.confidence, 0.75)

    def test_offline_verifier_rejects_unrelated_and_detects_contradiction(self) -> None:
        claim = AtomicClaim.create("Saturn has exactly 82 moons.")
        unrelated = NotesLoader().load("A sunflower head contains many florets.")
        self.assertIsNone(verify_claim_evidence(claim, chunk_source(unrelated)))

        contradiction = NotesLoader().load("Saturn does not have exactly 82 moons.")
        match = verify_claim_evidence(claim, chunk_source(contradiction))
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.relation, SupportRelation.CONTRADICTS)
        self.assertGreaterEqual(match.confidence, 0.75)

    def test_offline_verifier_detects_conflicting_equation_result(self) -> None:
        claim = AtomicClaim.create("1234 \N{MULTIPLICATION SIGN} 5678 equals 7,006,652.")
        document = NotesLoader().load("1234 \N{MULTIPLICATION SIGN} 5678 equals 7,006,651.")
        match = verify_claim_evidence(claim, chunk_source(document))
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.relation, SupportRelation.CONTRADICTS)

    def test_offline_verifier_does_not_hide_conflicting_source_behind_support(self) -> None:
        claim = AtomicClaim.create("Saturn has exactly 82 moons.")
        supporting = chunk_source(NotesLoader().load(claim.statement))
        contradicting = chunk_source(NotesLoader().load("Saturn does not have exactly 82 moons."))
        match = verify_claim_evidence(claim, (*supporting, *contradicting))
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match.relation, SupportRelation.CONTRADICTS)


if __name__ == "__main__":
    unittest.main()
