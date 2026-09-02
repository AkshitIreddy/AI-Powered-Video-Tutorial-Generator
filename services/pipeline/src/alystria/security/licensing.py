"""Asset-license compatibility and attribution rules."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum

from .provenance import AssetProvenance


class DistributionPurpose(StrEnum):
    PRIVATE = "private"
    PUBLIC_NONCOMMERCIAL = "public-noncommercial"
    PUBLIC_COMMERCIAL = "public-commercial"


@dataclass(frozen=True, slots=True)
class LicenseRule:
    license_id: str
    public_distribution: bool
    commercial_use: bool
    derivatives: bool
    attribution_required: bool
    share_alike: bool = False


LICENSE_RULES: dict[str, LicenseRule] = {
    "MIT": LicenseRule("MIT", True, True, True, False),
    "Apache-2.0": LicenseRule("Apache-2.0", True, True, True, False),
    "CC0-1.0": LicenseRule("CC0-1.0", True, True, True, False),
    "CC-BY-4.0": LicenseRule("CC-BY-4.0", True, True, True, True),
    "CC-BY-SA-4.0": LicenseRule("CC-BY-SA-4.0", True, True, True, True, True),
    "CC-BY-NC-4.0": LicenseRule("CC-BY-NC-4.0", True, False, True, True),
    "CC-BY-ND-4.0": LicenseRule("CC-BY-ND-4.0", True, True, False, True),
    "PDM-1.0": LicenseRule("PDM-1.0", True, True, True, False),
    "USER-OWNED": LicenseRule("USER-OWNED", True, True, True, False),
    "PEXELS": LicenseRule("PEXELS", True, True, True, False),
    "PROPRIETARY-EXPLICIT": LicenseRule("PROPRIETARY-EXPLICIT", True, True, True, False),
    # ElevenLabs retains plan-specific commercial restrictions, but its terms
    # allow generated speech to be used privately and shared non-commercially
    # with attribution. Paid commercial entitlement must be recorded as the
    # stronger PROPRIETARY-EXPLICIT grant by account-aware configuration.
    "ELEVENLABS-OUTPUT": LicenseRule("ELEVENLABS-OUTPUT", True, False, True, True),
    "PREVIEW-ONLY": LicenseRule("PREVIEW-ONLY", False, False, False, False),
    "UNKNOWN": LicenseRule("UNKNOWN", False, False, False, False),
}


@dataclass(frozen=True, slots=True)
class AssetUse:
    purpose: DistributionPurpose
    transformed: bool
    attribution_included: bool
    share_alike_compatible: bool = False


@dataclass(frozen=True, slots=True)
class LicenseDecision:
    allowed: bool
    reasons: tuple[str, ...]
    attribution_required: bool


def evaluate_license(
    provenance: AssetProvenance,
    use: AssetUse,
    *,
    now: datetime | None = None,
) -> LicenseDecision:
    reasons: list[str] = []
    rule = LICENSE_RULES.get(provenance.license_id)
    if rule is None:
        reasons.append("license is unknown to the compatibility policy")
        return LicenseDecision(False, tuple(reasons), False)
    if not provenance.rights_current(at=now or datetime.now(UTC)):
        reasons.append("asset rights are unverified, expired, revoked, or quarantined")
    if use.purpose != DistributionPurpose.PRIVATE and not rule.public_distribution:
        reasons.append("license forbids public distribution")
    if use.purpose == DistributionPurpose.PUBLIC_COMMERCIAL and not rule.commercial_use:
        reasons.append("license forbids commercial use")
    if use.transformed and not rule.derivatives:
        reasons.append("license forbids derivative works")
    if rule.attribution_required and (not use.attribution_included or not provenance.attribution):
        reasons.append("required attribution is missing")
    if rule.share_alike and use.transformed and not use.share_alike_compatible:
        reasons.append("share-alike compatibility has not been established")
    return LicenseDecision(not reasons, tuple(reasons), rule.attribution_required)


def compile_attributions(assets: tuple[AssetProvenance, ...]) -> tuple[str, ...]:
    values: list[str] = []
    for asset in assets:
        rule = LICENSE_RULES.get(asset.license_id)
        if rule and rule.attribution_required and asset.attribution:
            values.append(asset.attribution.strip())
    return tuple(dict.fromkeys(value for value in values if value))
