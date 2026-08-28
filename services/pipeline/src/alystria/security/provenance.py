"""Immutable provenance, rights, consent, and C2PA domain records."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum

from .errors import ValidationError

SHA256_RE = re.compile(r"^[a-f0-9]{64}$")


class OriginKind(StrEnum):
    USER = "user"
    LICENSED_MEDIA = "licensed-media"
    GENERATED = "generated"
    PUBLICATION = "publication"
    SCREEN_CAPTURE = "screen-capture"
    LEGACY_QUARANTINE = "legacy-quarantine"


class RightsStatus(StrEnum):
    VERIFIED = "verified"
    QUARANTINED = "quarantined"
    EXPIRED = "expired"
    REVOKED = "revoked"
    UNKNOWN = "unknown"


class ConsentStatus(StrEnum):
    GRANTED = "granted"
    REVOKED = "revoked"
    EXPIRED = "expired"


class C2paStatus(StrEnum):
    NOT_APPLICABLE = "not-applicable"
    ABSENT = "absent"
    VALID = "valid"
    INVALID = "invalid"


@dataclass(frozen=True, slots=True)
class C2paRecord:
    status: C2paStatus
    manifest_sha256: str | None = None
    signer: str | None = None
    verified_at: datetime | None = None

    def __post_init__(self) -> None:
        if self.manifest_sha256 is not None and not SHA256_RE.fullmatch(self.manifest_sha256):
            raise ValidationError("C2PA manifest hash is invalid")
        if self.status == C2paStatus.VALID and not (
            self.manifest_sha256 and self.signer and self.verified_at
        ):
            raise ValidationError(
                "valid C2PA records require a hash, signer, and verification time"
            )


@dataclass(frozen=True, slots=True)
class ConsentRecord:
    consent_id: str
    subject: str
    scope: frozenset[str]
    status: ConsentStatus
    granted_at: datetime
    evidence_sha256: str
    synthetic_media_disclosure: bool
    expires_at: datetime | None = None
    revoked_at: datetime | None = None

    def __post_init__(self) -> None:
        if not self.consent_id or not self.subject or not self.scope:
            raise ValidationError("consent id, subject, and scope are required")
        if not SHA256_RE.fullmatch(self.evidence_sha256):
            raise ValidationError("consent evidence hash is invalid")
        if self.granted_at.tzinfo is None:
            raise ValidationError("consent timestamps must be timezone-aware")
        if self.expires_at and self.expires_at.tzinfo is None:
            raise ValidationError("consent expiry must be timezone-aware")
        if self.revoked_at and self.revoked_at.tzinfo is None:
            raise ValidationError("consent revocation must be timezone-aware")
        if self.status == ConsentStatus.REVOKED and self.revoked_at is None:
            raise ValidationError("revoked consent requires a revocation timestamp")

    def permits(self, use: str, *, at: datetime | None = None) -> bool:
        instant = at or datetime.now(UTC)
        return (
            self.status == ConsentStatus.GRANTED
            and use in self.scope
            and self.revoked_at is None
            and (self.expires_at is None or instant < self.expires_at)
        )


@dataclass(frozen=True, slots=True)
class Ingredient:
    asset_id: str
    sha256: str
    relationship: str

    def __post_init__(self) -> None:
        if not self.asset_id or not self.relationship or not SHA256_RE.fullmatch(self.sha256):
            raise ValidationError("ingredient provenance is invalid")


@dataclass(frozen=True, slots=True)
class AssetProvenance:
    asset_id: str
    sha256: str
    origin: OriginKind
    rights_status: RightsStatus
    license_id: str
    creator: str | None
    attribution: str | None
    source_uri: str | None = None
    provider_id: str | None = None
    model_id: str | None = None
    model_revision: str | None = None
    consent_ids: tuple[str, ...] = ()
    ingredients: tuple[Ingredient, ...] = ()
    c2pa: C2paRecord = field(default_factory=lambda: C2paRecord(C2paStatus.NOT_APPLICABLE))
    acquired_at: datetime | None = None
    rights_expires_at: datetime | None = None

    def __post_init__(self) -> None:
        if not self.asset_id or not SHA256_RE.fullmatch(self.sha256):
            raise ValidationError("asset identity or hash is invalid")
        if not self.license_id:
            raise ValidationError("every asset must record a license identifier")
        if self.acquired_at and self.acquired_at.tzinfo is None:
            raise ValidationError("asset acquisition time must be timezone-aware")
        if self.rights_expires_at and self.rights_expires_at.tzinfo is None:
            raise ValidationError("asset rights expiry must be timezone-aware")
        if self.origin == OriginKind.GENERATED and not (
            self.provider_id and self.model_id and self.model_revision
        ):
            raise ValidationError(
                "generated assets require provider, model, and immutable revision"
            )
        if self.origin == OriginKind.LICENSED_MEDIA and not self.source_uri:
            raise ValidationError("licensed media requires a source URI")

    def rights_current(self, *, at: datetime | None = None) -> bool:
        instant = at or datetime.now(UTC)
        return self.rights_status == RightsStatus.VERIFIED and (
            self.rights_expires_at is None or instant < self.rights_expires_at
        )


@dataclass(frozen=True, slots=True)
class ExportProvenanceManifest:
    project_id: str
    revision_id: str
    assets: tuple[AssetProvenance, ...]
    generated_at: datetime
    c2pa: C2paRecord

    def __post_init__(self) -> None:
        if not self.project_id or not self.revision_id or self.generated_at.tzinfo is None:
            raise ValidationError("export provenance manifest identity/timestamp is invalid")
        asset_ids = [asset.asset_id for asset in self.assets]
        if len(asset_ids) != len(set(asset_ids)):
            raise ValidationError("export provenance contains duplicate asset ids")
