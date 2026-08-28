"""Accessibility, asset-rights, and privacy export policies."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime

from .models import Finding, QualityGate, Severity


@dataclass(frozen=True, slots=True)
class AccessibilityReport:
    narration_present: bool
    captions_present: bool
    transcript_present: bool
    visual_descriptions_complete: bool
    uses_color_only: bool = False
    reduced_motion_respected: bool = True
    audio_description_required: bool = False
    audio_description_present: bool = False


@dataclass(frozen=True, slots=True)
class RightsAsset:
    asset_id: str
    license_id: str | None
    attribution_required: bool = False
    attribution: str | None = None
    derivatives_allowed: bool = True
    commercial_use_allowed: bool = True
    preview_only: bool = False
    expires_at: str | None = None
    real_person: bool = False
    consent_record_id: str | None = None


@dataclass(frozen=True, slots=True)
class PrivacyTransfer:
    transfer_id: str
    provider: str
    payload_class: str
    cloud: bool
    approved: bool
    retention_disclosed: bool
    region_disclosed: bool
    contains_secret: bool = False
    local_only_content: bool = False


def check_accessibility(report: AccessibilityReport) -> QualityGate:
    findings: list[Finding] = []
    if report.narration_present and not report.captions_present:
        findings.append(
            Finding(
                "accessibility.captions_missing",
                "Narrated media requires captions.",
                Severity.MAJOR,
                repairable=True,
            )
        )
    if report.narration_present and not report.transcript_present:
        findings.append(
            Finding(
                "accessibility.transcript_missing",
                "Narrated media requires a transcript.",
                Severity.MAJOR,
                repairable=True,
            )
        )
    if not report.visual_descriptions_complete:
        findings.append(
            Finding(
                "accessibility.visual_descriptions",
                "Essential visuals lack text descriptions.",
                Severity.MAJOR,
                repairable=True,
            )
        )
    if report.uses_color_only:
        findings.append(
            Finding(
                "accessibility.color_only",
                "Information is conveyed by color alone.",
                Severity.MAJOR,
                repairable=True,
            )
        )
    if not report.reduced_motion_respected:
        findings.append(
            Finding(
                "accessibility.reduced_motion",
                "Reduced-motion preference is not honored.",
                Severity.MAJOR,
                repairable=True,
            )
        )
    if report.audio_description_required and not report.audio_description_present:
        findings.append(
            Finding(
                "accessibility.audio_description",
                "An audio-description track is required.",
                Severity.MAJOR,
                repairable=True,
            )
        )
    return QualityGate.from_findings("policy.accessibility", "accessibility", findings)


def check_rights(assets: Iterable[RightsAsset], *, now: datetime | None = None) -> QualityGate:
    findings: list[Finding] = []
    current = now or datetime.now(UTC)
    for asset in assets:
        location = f"asset:{asset.asset_id}"
        if not asset.license_id or asset.license_id.strip().lower() in {"unknown", "unverified"}:
            findings.append(
                Finding(
                    "rights.unknown_license",
                    "Asset license is unknown.",
                    Severity.CRITICAL,
                    location,
                )
            )
        if asset.preview_only:
            findings.append(
                Finding(
                    "rights.preview_only",
                    "Preview-only asset cannot be exported.",
                    Severity.CRITICAL,
                    location,
                )
            )
        if not asset.derivatives_allowed:
            findings.append(
                Finding(
                    "rights.no_derivatives",
                    "Asset license forbids derivatives.",
                    Severity.CRITICAL,
                    location,
                )
            )
        if not asset.commercial_use_allowed:
            findings.append(
                Finding(
                    "rights.noncommercial",
                    "Noncommercial asset cannot enter the standard export.",
                    Severity.CRITICAL,
                    location,
                )
            )
        if asset.attribution_required and not (asset.attribution and asset.attribution.strip()):
            findings.append(
                Finding(
                    "rights.attribution_missing",
                    "Required attribution is missing.",
                    Severity.CRITICAL,
                    location,
                    repairable=True,
                )
            )
        if asset.expires_at:
            expiration = _parse_timestamp(asset.expires_at)
            if expiration is None:
                findings.append(
                    Finding(
                        "rights.invalid_expiration",
                        "Asset rights expiration is invalid.",
                        Severity.CRITICAL,
                        location,
                    )
                )
            elif expiration <= current:
                findings.append(
                    Finding(
                        "rights.expired", "Asset rights have expired.", Severity.CRITICAL, location
                    )
                )
        if asset.real_person and not asset.consent_record_id:
            findings.append(
                Finding(
                    "rights.consent_missing",
                    "Real-person media requires immutable consent.",
                    Severity.CRITICAL,
                    location,
                )
            )
    return QualityGate.from_findings("policy.rights", "rights", findings)


def check_privacy(transfers: Iterable[PrivacyTransfer], *, fully_local: bool) -> QualityGate:
    findings: list[Finding] = []
    for transfer in transfers:
        location = f"transfer:{transfer.transfer_id}"
        if transfer.contains_secret:
            findings.append(
                Finding(
                    "privacy.secret_egress",
                    "Transfer payload contains a secret.",
                    Severity.CRITICAL,
                    location,
                )
            )
        if transfer.cloud and fully_local:
            findings.append(
                Finding(
                    "privacy.local_mode_egress",
                    "Cloud transfer attempted in Fully Local mode.",
                    Severity.CRITICAL,
                    location,
                )
            )
        if transfer.cloud and transfer.local_only_content:
            findings.append(
                Finding(
                    "privacy.classification_egress",
                    "Local-only content cannot be sent to a cloud provider.",
                    Severity.CRITICAL,
                    location,
                )
            )
        if transfer.cloud and not transfer.approved:
            findings.append(
                Finding(
                    "privacy.unapproved_transfer",
                    "Cloud transfer was not approved.",
                    Severity.CRITICAL,
                    location,
                )
            )
        if transfer.cloud and not transfer.retention_disclosed:
            findings.append(
                Finding(
                    "privacy.retention_unknown",
                    "Provider retention policy was not disclosed.",
                    Severity.MAJOR,
                    location,
                )
            )
        if transfer.cloud and not transfer.region_disclosed:
            findings.append(
                Finding(
                    "privacy.region_unknown",
                    "Provider processing region was not disclosed.",
                    Severity.MAJOR,
                    location,
                )
            )
    return QualityGate.from_findings("policy.privacy", "privacy", findings)


def _parse_timestamp(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
