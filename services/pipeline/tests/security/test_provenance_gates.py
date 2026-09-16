from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from alystria.security.errors import ValidationError
from alystria.security.gates import (
    ExportGateInput,
    GateDecision,
    GateKind,
    ImportGateInput,
    ModelGateInput,
    ProviderGateInput,
    ReleaseCandidateGateInput,
    SecurityGates,
    StoryboardGateInput,
)
from alystria.security.licensing import (
    AssetUse,
    DistributionPurpose,
    compile_attributions,
    evaluate_license,
)
from alystria.security.privacy import RouteDecision
from alystria.security.provenance import (
    AssetProvenance,
    C2paRecord,
    C2paStatus,
    ConsentRecord,
    ConsentStatus,
    OriginKind,
    RightsStatus,
)

NOW = datetime(2026, 8, 28, tzinfo=UTC)
HASH = "a" * 64


def asset(
    *,
    asset_id: str = "asset.one",
    license_id: str = "CC-BY-4.0",
    rights: RightsStatus = RightsStatus.VERIFIED,
    attribution: str | None = "Creator — Example — CC BY 4.0",
    expires: datetime | None = None,
) -> AssetProvenance:
    return AssetProvenance(
        asset_id=asset_id,
        sha256=HASH,
        origin=OriginKind.USER,
        rights_status=rights,
        license_id=license_id,
        creator="Creator",
        attribution=attribution,
        rights_expires_at=expires,
    )


def consent(
    *, status: ConsentStatus = ConsentStatus.GRANTED, expires: datetime | None = None
) -> ConsentRecord:
    return ConsentRecord(
        consent_id="consent.one",
        subject="Presenter",
        scope=frozenset({"presenter-render"}),
        status=status,
        granted_at=NOW,
        evidence_sha256=HASH,
        synthetic_media_disclosure=True,
        expires_at=expires,
        revoked_at=NOW if status == ConsentStatus.REVOKED else None,
    )


class ProvenanceTests(unittest.TestCase):
    def test_generated_assets_require_model_revision(self) -> None:
        with self.assertRaises(ValidationError):
            AssetProvenance(
                "generated",
                HASH,
                OriginKind.GENERATED,
                RightsStatus.VERIFIED,
                "PROPRIETARY-EXPLICIT",
                None,
                None,
            )

    def test_valid_c2pa_requires_verification_evidence(self) -> None:
        with self.assertRaises(ValidationError):
            C2paRecord(C2paStatus.VALID)
        value = C2paRecord(C2paStatus.VALID, HASH, "Alystria", NOW)
        self.assertEqual(value.status, C2paStatus.VALID)

    def test_consent_is_scope_time_and_status_bound(self) -> None:
        self.assertTrue(
            consent(expires=NOW + timedelta(days=1)).permits("presenter-render", at=NOW)
        )
        self.assertFalse(
            consent(expires=NOW - timedelta(seconds=1)).permits("presenter-render", at=NOW)
        )
        self.assertFalse(consent(status=ConsentStatus.REVOKED).permits("presenter-render", at=NOW))


class LicensingTests(unittest.TestCase):
    def test_nvidia_trial_output_is_limited_to_private_evaluation(self) -> None:
        for license_id in (
            "NVIDIA-API-TRIAL-OUTPUT", "LicenseRef-NVIDIA-AI-FOUNDATION-MODELS"
        ):
            with self.subTest(license_id=license_id):
                for purpose in DistributionPurpose:
                    decision = evaluate_license(
                        asset(license_id=license_id),
                        AssetUse(purpose, transformed=True, attribution_included=False),
                        now=NOW,
                    )
                    self.assertEqual(decision.allowed, purpose is DistributionPurpose.PRIVATE)
                revoked = evaluate_license(
                    asset(license_id=license_id, rights=RightsStatus.REVOKED),
                    AssetUse(DistributionPurpose.PRIVATE, transformed=True, attribution_included=False),
                    now=NOW,
                )
                self.assertFalse(revoked.allowed)

    def test_apache_two_generated_asset_allows_transformed_commercial_export(self) -> None:
        generated = AssetProvenance(
            asset_id="scene-visual:nvidia-flux",
            sha256=HASH,
            origin=OriginKind.GENERATED,
            rights_status=RightsStatus.VERIFIED,
            license_id="Apache-2.0",
            creator="nvidia-nim",
            attribution=None,
            provider_id="nvidia-nim",
            model_id="black-forest-labs/flux.2-klein-4b",
            model_revision="black-forest-labs/flux.2-klein-4b",
        )
        use = AssetUse(
            DistributionPurpose.PUBLIC_COMMERCIAL,
            transformed=True,
            attribution_included=True,
        )

        decision = evaluate_license(generated, use, now=NOW)

        self.assertTrue(decision.allowed, decision.reasons)

    def test_mit_starter_audio_allows_transformed_commercial_export(self) -> None:
        def starter_audio(role: str) -> AssetProvenance:
            return AssetProvenance(
                asset_id=f"program-{role}:starter-audio",
                sha256=HASH,
                origin=OriginKind.GENERATED,
                rights_status=RightsStatus.VERIFIED,
                license_id="MIT",
                creator="Alystria Studio contributors",
                attribution=None,
                provider_id="alystria-project-asset",
                model_id="alystria-project-asset",
                model_revision="cas-v1",
            )

        use = AssetUse(
            DistributionPurpose.PUBLIC_COMMERCIAL,
            transformed=True,
            attribution_included=True,
        )

        decision = SecurityGates.export_gate(
            ExportGateInput(
                "export",
                (starter_audio("music"), starter_audio("sfx")),
                use,
                (),
                (),
                True,
                0,
                True,
                evaluated_at=NOW,
            )
        )

        self.assertTrue(decision.allowed, decision.findings)

    def test_cc_by_requires_attribution(self) -> None:
        use = AssetUse(
            DistributionPurpose.PUBLIC_COMMERCIAL, transformed=True, attribution_included=False
        )
        decision = evaluate_license(asset(), use, now=NOW)
        self.assertFalse(decision.allowed)
        self.assertIn("required attribution is missing", decision.reasons)

    def test_noncommercial_no_derivatives_unknown_and_expired_block(self) -> None:
        commercial = AssetUse(DistributionPurpose.PUBLIC_COMMERCIAL, True, True)
        with self.subTest("noncommercial"):
            self.assertFalse(
                evaluate_license(asset(license_id="CC-BY-NC-4.0"), commercial, now=NOW).allowed
            )
        with self.subTest("no-derivatives"):
            self.assertFalse(
                evaluate_license(asset(license_id="CC-BY-ND-4.0"), commercial, now=NOW).allowed
            )
        with self.subTest("unknown"):
            self.assertFalse(
                evaluate_license(asset(license_id="NOT-A-LICENSE"), commercial, now=NOW).allowed
            )
        with self.subTest("expired"):
            expired = asset(expires=NOW - timedelta(seconds=1))
            self.assertFalse(evaluate_license(expired, commercial, now=NOW).allowed)

    def test_share_alike_and_attribution_compilation(self) -> None:
        use = AssetUse(
            DistributionPurpose.PUBLIC_NONCOMMERCIAL, True, True, share_alike_compatible=False
        )
        self.assertFalse(evaluate_license(asset(license_id="CC-BY-SA-4.0"), use, now=NOW).allowed)
        values = compile_attributions((asset(asset_id="one"), asset(asset_id="two")))
        self.assertEqual(values, ("Creator — Example — CC BY 4.0",))


class GateTests(unittest.TestCase):
    def test_import_and_model_gates_fail_closed_while_approved_provider_route_passes(self) -> None:
        import_decision = SecurityGates.import_gate(
            ImportGateInput("file", True, True, False, True)
        )
        self.assertFalse(import_decision.allowed)
        model_decision = SecurityGates.model_gate(
            ModelGateInput(
                "model", True, True, True, uses_pickle=True, requires_trust_remote_code=False
            )
        )
        self.assertFalse(model_decision.allowed)
        provider_decision = SecurityGates.provider_gate(
            ProviderGateInput(
                RouteDecision(True, (), "provider"),
                True,
                True,
            )
        )
        self.assertTrue(provider_decision.allowed)
        provider_decision.require_allowed()

    def test_strict_storyboard_requires_full_support_and_approvals(self) -> None:
        blocked = SecurityGates.storyboard_gate(
            StoryboardGateInput("storyboard", True, True, 10, 9, 0, True, True)
        )
        self.assertFalse(blocked.allowed)
        allowed = SecurityGates.storyboard_gate(
            StoryboardGateInput("storyboard", True, True, 10, 10, 0, True, True)
        )
        self.assertTrue(allowed.allowed)

    def test_export_checks_license_consent_captions_quality_and_manifest(self) -> None:
        use = AssetUse(DistributionPurpose.PUBLIC_COMMERCIAL, True, True)
        allowed = SecurityGates.export_gate(
            ExportGateInput(
                "export",
                (asset(),),
                use,
                (consent(expires=NOW + timedelta(days=1)),),
                (("consent.one", "presenter-render"),),
                True,
                0,
                True,
                evaluated_at=NOW,
            )
        )
        self.assertTrue(allowed.allowed)
        no_presenter = SecurityGates.export_gate(
            ExportGateInput(
                "export",
                (asset(),),
                use,
                (),
                (),
                True,
                0,
                True,
            )
        )
        self.assertTrue(no_presenter.allowed)
        blocked = SecurityGates.export_gate(
            ExportGateInput(
                "export",
                (asset(attribution=None),),
                use,
                (),
                (("missing", "presenter-render"),),
                False,
                2,
                False,
            )
        )
        self.assertFalse(blocked.allowed)
        self.assertGreaterEqual(len(blocked.findings), 5)

    def test_release_candidate_requires_all_evidence_and_upstream_gates(self) -> None:
        upstream = SecurityGates.import_gate(ImportGateInput("file", True, True, True, True))
        input_value = ReleaseCandidateGateInput(
            "rc",
            (upstream,),
            frozenset({"unit", "security"}),
            frozenset({"unit", "security"}),
            True,
            True,
            True,
            True,
            True,
            True,
            True,
        )
        self.assertTrue(SecurityGates.release_candidate_gate(input_value).allowed)
        blocked = ReleaseCandidateGateInput(
            "rc",
            (
                GateDecision(
                    GateKind.EXPORT,
                    SecurityGates.import_gate(
                        ImportGateInput("x", False, True, True, True)
                    ).findings,
                ),
            ),
            frozenset({"unit", "security"}),
            frozenset({"unit"}),
            False,
            False,
            False,
            False,
            False,
            False,
            False,
        )
        self.assertFalse(SecurityGates.release_candidate_gate(blocked).allowed)


if __name__ == "__main__":
    unittest.main()
