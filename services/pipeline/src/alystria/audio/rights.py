"""Rights contracts for music and sound effects used in exports."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import StrEnum


class AudioAssetKind(StrEnum):
    MUSIC = "music"
    SOUND_EFFECT = "sound_effect"


class LicenseKind(StrEnum):
    USER_OWNED = "user_owned"
    CC0 = "cc0"
    CC_BY = "cc_by"
    COMMERCIAL = "commercial"
    UNKNOWN = "unknown"
    PREVIEW_ONLY = "preview_only"
    NONCOMMERCIAL = "noncommercial"
    NO_DERIVATIVES = "no_derivatives"


@dataclass(frozen=True, slots=True)
class AudioRightsRecord:
    rights_id: str
    artifact_hash: str
    kind: AudioAssetKind
    license_kind: LicenseKind
    source_uri: str | None = None
    creator: str | None = None
    attribution: str | None = None
    proof_artifact_hash: str | None = None
    permits_commercial_use: bool = True
    permits_derivatives: bool = True
    expires_on: date | None = None

    def __post_init__(self) -> None:
        if not self.rights_id or not self.artifact_hash:
            raise ValueError("audio rights identity and artifact hash are required")

    def export_blockers(self, *, on_date: date | None = None) -> tuple[str, ...]:
        today = on_date or date.today()
        blockers: list[str] = []
        if self.license_kind in {
            LicenseKind.UNKNOWN,
            LicenseKind.PREVIEW_ONLY,
            LicenseKind.NONCOMMERCIAL,
            LicenseKind.NO_DERIVATIVES,
        }:
            blockers.append(f"license {self.license_kind} is not exportable")
        if not self.permits_commercial_use:
            blockers.append("rights do not permit commercial use")
        if not self.permits_derivatives:
            blockers.append("rights do not permit mixing or modification")
        if self.expires_on is not None and self.expires_on < today:
            blockers.append("rights grant has expired")
        if self.license_kind is LicenseKind.CC_BY and not self.attribution:
            blockers.append("CC-BY asset is missing attribution")
        if self.license_kind is LicenseKind.COMMERCIAL and not self.proof_artifact_hash:
            blockers.append("commercial asset is missing license proof")
        return tuple(blockers)


@dataclass(frozen=True, slots=True)
class MixAsset:
    artifact_hash: str
    rights_id: str
    kind: AudioAssetKind
    gain_db: float = 0.0
    start_ms: int = 0
    end_ms: int | None = None
    loop: bool = False
    fade_in_ms: int = 0
    fade_out_ms: int = 0

    def __post_init__(self) -> None:
        if not self.artifact_hash or not self.rights_id:
            raise ValueError("mix asset hash and rights id are required")
        if not -60 <= self.gain_db <= 12:
            raise ValueError("mix gain must be between -60 dB and +12 dB")
        if self.start_ms < 0 or (self.end_ms is not None and self.end_ms <= self.start_ms):
            raise ValueError("invalid mix asset time range")
        if self.fade_in_ms < 0 or self.fade_out_ms < 0:
            raise ValueError("mix fades cannot be negative")


def validate_mix_rights(
    assets: tuple[MixAsset, ...] | list[MixAsset],
    rights: tuple[AudioRightsRecord, ...] | list[AudioRightsRecord],
    *,
    on_date: date | None = None,
) -> dict[str, tuple[str, ...]]:
    by_id = {record.rights_id: record for record in rights}
    failures: dict[str, tuple[str, ...]] = {}
    for asset in assets:
        record = by_id.get(asset.rights_id)
        if record is None:
            failures[asset.artifact_hash] = ("audio asset has no rights record",)
            continue
        blockers = list(record.export_blockers(on_date=on_date))
        if record.artifact_hash != asset.artifact_hash:
            blockers.append("rights record does not match the selected artifact")
        if record.kind is not asset.kind:
            blockers.append("rights record media kind does not match the selected asset")
        if blockers:
            failures[asset.artifact_hash] = tuple(blockers)
    return failures
