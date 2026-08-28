"""Capability-aware, consent-gated avatar job planning."""

from __future__ import annotations

from dataclasses import replace

from .consent import ConsentGrant, ConsentRecord
from .models import (
    AvatarJobPlan,
    CapabilityDegradation,
    DegradationPolicy,
    GazeDirection,
    PresenterCapabilities,
    PresenterDirection,
    PresenterProfile,
)


class PresenterPlanError(ValueError):
    """Raised when consent or required provider behavior prevents a job."""


def plan_avatar_job(
    *,
    job_id: str,
    project_id: str,
    scene_id: str,
    profile: PresenterProfile,
    consent: ConsentRecord,
    capabilities: PresenterCapabilities,
    speech_artifact_hash: str,
    duration_ms: int,
    locale: str,
    direction: PresenterDirection | None = None,
    output_width: int = 1920,
    output_height: int = 1080,
    deterministic_seed: int | None = None,
    degradation_policy: DegradationPolicy = DegradationPolicy.ALLOW_DECLARED,
) -> AvatarJobPlan:
    """Create an allowlisted job containing only portrait and final scene audio."""

    if consent.consent_id != profile.consent_id or consent.subject_id != profile.subject_id:
        raise PresenterPlanError("presenter profile does not match the consent record")
    blockers = consent.blockers(
        required_grants=frozenset({ConsentGrant.PORTRAIT_ANIMATION}),
        provider=capabilities.provider,
        model=capabilities.model,
        project_id=project_id,
    )
    if blockers:
        raise PresenterPlanError("; ".join(blockers))
    if duration_ms > capabilities.max_duration_ms:
        raise PresenterPlanError("presenter clip exceeds provider maximum duration")
    if not _locale_supported(locale, capabilities.supported_locales):
        raise PresenterPlanError(f"presenter provider does not support locale {locale}")

    requested = direction or profile.default_direction
    effective = requested
    degradations: list[CapabilityDegradation] = []
    if requested.gaze is not GazeDirection.AUTO and not capabilities.supports_gaze_control:
        degradations.append(
            CapabilityDegradation(
                "gaze", requested.gaze, GazeDirection.AUTO, "provider has no gaze control"
            )
        )
        effective = replace(effective, gaze=GazeDirection.AUTO, eye_contact_required=False)
    if requested.emotion and not capabilities.supports_emotion:
        degradations.append(
            CapabilityDegradation(
                "emotion",
                requested.emotion,
                "provider_default",
                "provider has no emotion control",
            )
        )
        effective = replace(effective, emotion=None, expression_intensity=0.5)
    if requested.gesture and requested.gesture not in capabilities.supported_gestures:
        degradations.append(
            CapabilityDegradation("gesture", requested.gesture, "none", "gesture is unsupported")
        )
        effective = replace(effective, gesture=None)
    if requested.crop not in capabilities.supported_crops:
        replacement = (
            sorted(capabilities.supported_crops)[0]
            if capabilities.supported_crops
            else "medium"
        )
        degradations.append(
            CapabilityDegradation("crop", requested.crop, replacement, "crop is unsupported")
        )
        effective = replace(effective, crop=replacement)
    if requested.background == "transparent" and not capabilities.supports_transparency:
        degradations.append(
            CapabilityDegradation(
                "background", "transparent", "original", "provider cannot emit alpha"
            )
        )
        effective = replace(effective, background="original")
    elif (
        requested.background in {"solid", "generated"}
        and not capabilities.supports_background_replacement
    ):
        degradations.append(
            CapabilityDegradation(
                "background", requested.background, "original", "provider cannot replace background"
            )
        )
        effective = replace(effective, background="original")
    if output_width >= 3840 and not capabilities.supports_4k:
        raise PresenterPlanError("4K output requested from a provider without 4K capability")
    if output_width >= 1920 and not capabilities.supports_1080p:
        raise PresenterPlanError("1080p output requested from a provider without 1080p capability")
    if deterministic_seed is not None and not capabilities.supports_seed:
        degradations.append(
            CapabilityDegradation(
                "seed", str(deterministic_seed), "ignored", "provider has no seed control"
            )
        )
        deterministic_seed = None
    if degradations and degradation_policy is DegradationPolicy.BLOCK:
        names = ", ".join(item.capability for item in degradations)
        raise PresenterPlanError(f"provider would degrade required capabilities: {names}")

    return AvatarJobPlan(
        job_id=job_id,
        project_id=project_id,
        scene_id=scene_id,
        provider=capabilities.provider,
        model=capabilities.model,
        presenter_profile_id=profile.profile_id,
        consent_id=consent.consent_id,
        portrait_artifact_hash=profile.portrait_artifact_hash,
        speech_artifact_hash=speech_artifact_hash,
        duration_ms=duration_ms,
        locale=locale,
        requested_direction=requested,
        effective_direction=effective,
        degradations=tuple(degradations),
        output_width=output_width,
        output_height=output_height,
        deterministic_seed=deterministic_seed,
        disclosure_required=consent.synthetic_media_disclosure_required,
    )


def _locale_supported(locale: str, supported: frozenset[str]) -> bool:
    requested = locale.casefold()
    return any(
        candidate.casefold() == requested
        or ("-" not in candidate and requested.split("-", 1)[0] == candidate.casefold())
        for candidate in supported
    )
