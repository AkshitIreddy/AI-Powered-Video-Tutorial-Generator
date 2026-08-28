from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from alystria.presenters import (
    ConsentGrant,
    ConsentRecord,
    DegradationPolicy,
    GazeDirection,
    IdentityMetrics,
    LipSyncMetrics,
    PresenterCapabilities,
    PresenterDirection,
    PresenterPlanError,
    PresenterProfile,
    PresenterQAStatus,
    evaluate_presenter_quality,
    plan_avatar_job,
)


def consent() -> ConsentRecord:
    return ConsentRecord(
        consent_id="consent-1",
        subject_id="person-1",
        subject_display_name="Ada",
        captured_at=datetime.now(UTC) - timedelta(days=1),
        evidence_artifact_hash="sha256:consent",
        grants=frozenset(
            {ConsentGrant.PORTRAIT_ANIMATION, ConsentGrant.PUBLIC_DISTRIBUTION}
        ),
        project_id="project-1",
        permitted_providers=frozenset({"local"}),
        permitted_models=frozenset({"musetalk-1.5"}),
    )


def profile() -> PresenterProfile:
    return PresenterProfile(
        "presenter-1",
        "person-1",
        "Ada",
        "sha256:portrait",
        "consent-1",
    )


def capabilities() -> PresenterCapabilities:
    return PresenterCapabilities(
        "local",
        "musetalk-1.5",
        max_duration_ms=120_000,
        supported_locales=frozenset({"en", "es", "hi"}),
        supported_crops=frozenset({"medium"}),
        supports_1080p=True,
    )


class PresenterTests(unittest.TestCase):
    def test_plan_has_only_approved_media_and_declared_degradation(self) -> None:
        plan = plan_avatar_job(
            job_id="job-1",
            project_id="project-1",
            scene_id="scene-1",
            profile=profile(),
            consent=consent(),
            capabilities=capabilities(),
            speech_artifact_hash="sha256:final-scene-audio",
            duration_ms=10_000,
            locale="en-US",
            direction=PresenterDirection(
                gaze=GazeDirection.LEFT,
                emotion="encouraging",
                gesture="point-left",
                background="transparent",
            ),
            deterministic_seed=42,
        )
        self.assertEqual(plan.portrait_artifact_hash, "sha256:portrait")
        self.assertEqual(plan.speech_artifact_hash, "sha256:final-scene-audio")
        self.assertEqual(
            {item.capability for item in plan.degradations},
            {"gaze", "emotion", "gesture", "background", "seed"},
        )
        self.assertIs(plan.effective_direction.gaze, GazeDirection.AUTO)
        self.assertTrue(plan.disclosure_required)

    def test_required_capabilities_can_block_instead_of_silently_degrading(self) -> None:
        with self.assertRaisesRegex(PresenterPlanError, "degrade"):
            plan_avatar_job(
                job_id="job-1",
                project_id="project-1",
                scene_id="scene-1",
                profile=profile(),
                consent=consent(),
                capabilities=capabilities(),
                speech_artifact_hash="sha256:audio",
                duration_ms=10_000,
                locale="en",
                direction=PresenterDirection(gaze=GazeDirection.LEFT),
                degradation_policy=DegradationPolicy.BLOCK,
            )

    def test_revoked_or_wrong_scope_consent_blocks_generation(self) -> None:
        revoked = ConsentRecord(
            consent_id="consent-1",
            subject_id="person-1",
            subject_display_name="Ada",
            captured_at=datetime.now(UTC) - timedelta(days=2),
            evidence_artifact_hash="sha256:consent",
            grants=frozenset({ConsentGrant.PORTRAIT_ANIMATION}),
            revoked_at=datetime.now(UTC) - timedelta(days=1),
            revocation_reason="subject withdrew consent",
        )
        with self.assertRaisesRegex(PresenterPlanError, "revoked"):
            plan_avatar_job(
                job_id="job-1",
                project_id="project-1",
                scene_id="scene-1",
                profile=profile(),
                consent=revoked,
                capabilities=capabilities(),
                speech_artifact_hash="sha256:audio",
                duration_ms=10_000,
                locale="en",
            )

    def test_lip_sync_and_identity_qa_contracts(self) -> None:
        passing = evaluate_presenter_quality(
            LipSyncMetrics(
                PresenterQAStatus.PASSED,
                engine="syncnet",
                confidence=0.92,
                mean_av_offset_ms=12,
                p95_absolute_offset_ms=42,
                evaluated_frames=240,
            ),
            IdentityMetrics(
                PresenterQAStatus.PASSED,
                engine="arcface",
                reference_similarity=0.86,
                minimum_frame_similarity=0.78,
                temporal_drift=0.08,
                evaluated_frames=24,
            ),
        )
        self.assertEqual(passing.status, PresenterQAStatus.PASSED)
        self.assertEqual(passing.findings, ())

        failing = evaluate_presenter_quality(
            LipSyncMetrics(
                PresenterQAStatus.PASSED,
                engine="syncnet",
                confidence=0.5,
                p95_absolute_offset_ms=160,
                evaluated_frames=240,
            ),
            IdentityMetrics(PresenterQAStatus.NOT_RUN, note="no face found"),
        )
        self.assertEqual(failing.status, PresenterQAStatus.FAILED)
        self.assertEqual(
            {item.code for item in failing.findings},
            {"LIP_SYNC_CONFIDENCE_LOW", "LIP_SYNC_OFFSET_HIGH", "IDENTITY_NOT_VERIFIED"},
        )


if __name__ == "__main__":
    unittest.main()
