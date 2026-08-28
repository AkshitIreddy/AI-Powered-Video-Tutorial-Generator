"""Immutable consent and rights records for real-person presenter synthesis."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum


class ConsentGrant(StrEnum):
    PORTRAIT_ANIMATION = "portrait_animation"
    VIDEO_REENACTMENT = "video_reenactment"
    VOICE_SYNTHESIS = "voice_synthesis"
    VOICE_CLONING = "voice_cloning"
    COMMERCIAL_DISTRIBUTION = "commercial_distribution"
    PUBLIC_DISTRIBUTION = "public_distribution"


@dataclass(frozen=True, slots=True)
class ConsentRecord:
    consent_id: str
    subject_id: str
    subject_display_name: str
    captured_at: datetime
    evidence_artifact_hash: str
    grants: frozenset[ConsentGrant]
    project_id: str | None = None
    permitted_providers: frozenset[str] = field(default_factory=frozenset)
    permitted_models: frozenset[str] = field(default_factory=frozenset)
    expires_at: datetime | None = None
    revoked_at: datetime | None = None
    revocation_reason: str | None = None
    synthetic_media_disclosure_required: bool = True

    def __post_init__(self) -> None:
        identity = (
            self.consent_id,
            self.subject_id,
            self.subject_display_name,
            self.evidence_artifact_hash,
        )
        if not all(identity):
            raise ValueError("consent identity and evidence are required")
        if not self.grants:
            raise ValueError("consent must include at least one grant")
        if self.captured_at.tzinfo is None:
            raise ValueError("consent timestamps must be timezone-aware")
        if self.expires_at is not None and self.expires_at.tzinfo is None:
            raise ValueError("consent expiration must be timezone-aware")
        if self.expires_at is not None and self.expires_at <= self.captured_at:
            raise ValueError("consent cannot expire before it is captured")
        if self.revoked_at is not None:
            if self.revoked_at.tzinfo is None:
                raise ValueError("consent revocation must be timezone-aware")
            if not self.revocation_reason:
                raise ValueError("revoked consent requires a reason")
            if self.revoked_at < self.captured_at:
                raise ValueError("consent cannot be revoked before it is captured")

    def blockers(
        self,
        *,
        required_grants: frozenset[ConsentGrant],
        provider: str,
        model: str,
        project_id: str | None,
        at: datetime | None = None,
    ) -> tuple[str, ...]:
        moment = at or datetime.now(UTC)
        failures: list[str] = []
        if self.revoked_at is not None and self.revoked_at <= moment:
            failures.append("consent was revoked")
        if self.expires_at is not None and self.expires_at < moment:
            failures.append("consent has expired")
        missing = required_grants.difference(self.grants)
        if missing:
            failures.append("missing grants: " + ", ".join(sorted(missing)))
        if self.project_id is not None and self.project_id != project_id:
            failures.append("consent is scoped to another project")
        if self.permitted_providers and provider not in self.permitted_providers:
            failures.append("provider is outside the consent scope")
        if self.permitted_models and model not in self.permitted_models:
            failures.append("model is outside the consent scope")
        return tuple(failures)
