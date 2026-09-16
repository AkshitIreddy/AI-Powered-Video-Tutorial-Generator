"""Fail-closed security gates for the Alystria project lifecycle."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from .licensing import AssetUse, evaluate_license
from .privacy import RouteDecision
from .provenance import AssetProvenance, C2paStatus, ConsentRecord


class GateKind(StrEnum):
    IMPORT = "import"
    PROVIDER = "provider"
    MODEL = "model"
    STORYBOARD = "storyboard"
    EXPORT = "export"
    RELEASE_CANDIDATE = "release-candidate"


class GateSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    BLOCKER = "blocker"


@dataclass(frozen=True, slots=True)
class GateFinding:
    code: str
    severity: GateSeverity
    message: str
    subject_id: str | None = None


@dataclass(frozen=True, slots=True)
class GateDecision:
    gate: GateKind
    findings: tuple[GateFinding, ...]

    @property
    def allowed(self) -> bool:
        return not any(finding.severity == GateSeverity.BLOCKER for finding in self.findings)

    def require_allowed(self) -> None:
        if not self.allowed:
            from .errors import PolicyViolation

            codes = ", ".join(
                finding.code
                for finding in self.findings
                if finding.severity == GateSeverity.BLOCKER
            )
            raise PolicyViolation(f"{self.gate.value} gate blocked: {codes}")


@dataclass(frozen=True, slots=True)
class ImportGateInput:
    subject_id: str
    filename_valid: bool
    mime_verified: bool
    magic_verified: bool
    quota_valid: bool
    archive_valid: bool = True
    parser_sandboxed: bool = True


@dataclass(frozen=True, slots=True)
class ProviderGateInput:
    route: RouteDecision
    retention_approved: bool
    payload_class_approved: bool


@dataclass(frozen=True, slots=True)
class ModelGateInput:
    model_id: str
    immutable_revision: bool
    checksum_verified: bool
    license_accepted: bool
    uses_pickle: bool
    requires_trust_remote_code: bool
    benchmark_required: bool = False
    benchmark_passed: bool = False


@dataclass(frozen=True, slots=True)
class StoryboardGateInput:
    storyboard_id: str
    user_approved: bool
    strict_mode: bool
    verifiable_claims: int
    supported_claims: int
    unresolved_major_claims: int
    privacy_approved: bool
    rights_plan_approved: bool


@dataclass(frozen=True, slots=True)
class ExportGateInput:
    export_id: str
    assets: tuple[AssetProvenance, ...]
    asset_use: AssetUse
    consents: tuple[ConsentRecord, ...]
    required_consent_uses: tuple[tuple[str, str], ...]
    captions_present: bool
    quality_blockers: int
    provenance_manifest_present: bool
    c2pa_required: bool = False
    evaluated_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class ReleaseCandidateGateInput:
    release_id: str
    required_gate_decisions: tuple[GateDecision, ...]
    required_test_suites: frozenset[str]
    passed_test_suites: frozenset[str]
    sbom_present: bool
    third_party_notices_present: bool
    ffmpeg_configuration_recorded: bool
    model_notices_present: bool
    secret_scan_clean: bool
    platform_package_verified: bool
    provenance_manifest_present: bool


def _finding(code: str, message: str, subject_id: str | None = None) -> GateFinding:
    return GateFinding(code, GateSeverity.BLOCKER, message, subject_id)


class SecurityGates:
    @staticmethod
    def import_gate(value: ImportGateInput) -> GateDecision:
        checks = (
            (value.filename_valid, "import.filename", "filename is unsafe"),
            (value.mime_verified, "import.mime", "declared MIME was not verified"),
            (value.magic_verified, "import.magic", "file signature was not verified"),
            (value.quota_valid, "import.quota", "file or archive exceeds import quotas"),
            (value.archive_valid, "import.archive", "archive layout is unsafe"),
            (value.parser_sandboxed, "import.sandbox", "untrusted parser is not sandboxed"),
        )
        findings = tuple(
            _finding(code, message, value.subject_id)
            for passed, code, message in checks
            if not passed
        )
        return GateDecision(GateKind.IMPORT, findings)

    @staticmethod
    def provider_gate(value: ProviderGateInput) -> GateDecision:
        findings: list[GateFinding] = []
        if not value.route.allowed:
            findings.extend(
                _finding("provider.route", reason, value.route.provider_id)
                for reason in value.route.reasons
            )
        if not value.retention_approved:
            findings.append(
                _finding(
                    "provider.retention",
                    "provider retention policy is not approved",
                    value.route.provider_id,
                )
            )
        if not value.payload_class_approved:
            findings.append(
                _finding(
                    "provider.payload",
                    "payload data class is not approved",
                    value.route.provider_id,
                )
            )
        return GateDecision(GateKind.PROVIDER, tuple(findings))

    @staticmethod
    def model_gate(value: ModelGateInput) -> GateDecision:
        findings: list[GateFinding] = []
        checks = (
            (value.immutable_revision, "model.revision", "model revision is mutable"),
            (value.checksum_verified, "model.checksum", "model checksum is not verified"),
            (value.license_accepted, "model.license", "model license is not accepted"),
            (not value.uses_pickle, "model.pickle", "pickle model artifacts are forbidden"),
            (
                not value.requires_trust_remote_code,
                "model.remote-code",
                "trust_remote_code is forbidden",
            ),
            (
                not value.benchmark_required or value.benchmark_passed,
                "model.benchmark",
                "required hardware benchmark has not passed",
            ),
        )
        findings.extend(
            _finding(code, message, value.model_id)
            for passed, code, message in checks
            if not passed
        )
        return GateDecision(GateKind.MODEL, tuple(findings))

    @staticmethod
    def storyboard_gate(value: StoryboardGateInput) -> GateDecision:
        findings: list[GateFinding] = []
        if (
            value.verifiable_claims < 0
            or value.supported_claims < 0
            or value.supported_claims > value.verifiable_claims
        ):
            findings.append(
                _finding(
                    "storyboard.claim-count",
                    "claim coverage counts are inconsistent",
                    value.storyboard_id,
                )
            )
        if not value.user_approved:
            findings.append(
                _finding(
                    "storyboard.approval", "storyboard has not been approved", value.storyboard_id
                )
            )
        if value.strict_mode and value.supported_claims != value.verifiable_claims:
            findings.append(
                _finding(
                    "storyboard.unsupported-claims",
                    "Strict mode requires support for every verifiable claim",
                    value.storyboard_id,
                )
            )
        if value.unresolved_major_claims:
            findings.append(
                _finding(
                    "storyboard.major-claims",
                    "major or critical claims remain unresolved",
                    value.storyboard_id,
                )
            )
        if not value.privacy_approved:
            findings.append(
                _finding("storyboard.privacy", "privacy plan is not approved", value.storyboard_id)
            )
        if not value.rights_plan_approved:
            findings.append(
                _finding(
                    "storyboard.rights", "asset rights plan is not approved", value.storyboard_id
                )
            )
        return GateDecision(GateKind.STORYBOARD, tuple(findings))

    @staticmethod
    def export_gate(value: ExportGateInput) -> GateDecision:
        findings: list[GateFinding] = []
        for asset in value.assets:
            decision = evaluate_license(asset, value.asset_use, now=value.evaluated_at)
            findings.extend(
                _finding("export.license", reason, asset.asset_id) for reason in decision.reasons
            )
            if value.c2pa_required and asset.c2pa.status not in {
                C2paStatus.VALID,
                C2paStatus.NOT_APPLICABLE,
            }:
                findings.append(
                    _finding(
                        "export.c2pa",
                        "required content credentials are absent or invalid",
                        asset.asset_id,
                    )
                )
        consent_by_id = {consent.consent_id: consent for consent in value.consents}
        for consent_id, requested_use in value.required_consent_uses:
            consent = consent_by_id.get(consent_id)
            if consent is None or not consent.permits(requested_use, at=value.evaluated_at):
                findings.append(
                    _finding(
                        "export.consent",
                        "required consent is absent, expired, or revoked",
                        consent_id,
                    )
                )
            elif not consent.synthetic_media_disclosure:
                findings.append(
                    _finding(
                        "export.disclosure", "synthetic-media disclosure is missing", consent_id
                    )
                )
        if not value.captions_present:
            findings.append(
                _finding("export.captions", "required captions are missing", value.export_id)
            )
        if value.quality_blockers:
            findings.append(
                _finding("export.quality", "quality blockers remain unresolved", value.export_id)
            )
        if not value.provenance_manifest_present:
            findings.append(
                _finding(
                    "export.provenance", "export provenance manifest is missing", value.export_id
                )
            )
        return GateDecision(GateKind.EXPORT, tuple(findings))

    @staticmethod
    def release_candidate_gate(value: ReleaseCandidateGateInput) -> GateDecision:
        findings: list[GateFinding] = []
        for decision in value.required_gate_decisions:
            if not decision.allowed:
                findings.append(
                    _finding(
                        "rc.upstream-gate",
                        f"upstream {decision.gate.value} gate is blocked",
                        value.release_id,
                    )
                )
        missing_tests = value.required_test_suites - value.passed_test_suites
        if missing_tests:
            findings.append(
                _finding(
                    "rc.tests",
                    f"required test suites did not pass: {', '.join(sorted(missing_tests))}",
                    value.release_id,
                )
            )
        checks = (
            (value.sbom_present, "rc.sbom", "SPDX SBOM is missing"),
            (value.third_party_notices_present, "rc.notices", "third-party notices are missing"),
            (
                value.ffmpeg_configuration_recorded,
                "rc.ffmpeg",
                "FFmpeg build configuration is missing",
            ),
            (value.model_notices_present, "rc.models", "model notices are missing"),
            (value.secret_scan_clean, "rc.secrets", "secret scan has findings"),
            (value.platform_package_verified, "rc.package", "platform package is unverified"),
            (
                value.provenance_manifest_present,
                "rc.provenance",
                "release provenance manifest is missing",
            ),
        )
        findings.extend(
            _finding(code, message, value.release_id)
            for passed, code, message in checks
            if not passed
        )
        return GateDecision(GateKind.RELEASE_CANDIDATE, tuple(findings))
