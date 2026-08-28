"""Transactional local-model installation and lifecycle management."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import threading
from collections.abc import Callable
from contextlib import suppress
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Any

from .catalog import CompatibilityReport, ModelCatalog
from .domain import Capability, ModelManifest, SignatureVerifier, canonical_json
from .download import Downloader, DownloadRequest, ProgressCallback
from .errors import (
    InstallError,
    IntegrityError,
    LicenseNotAcceptedError,
    ManifestError,
    ModelInUseError,
    ModelNotInstalledError,
    SignatureError,
)
from .hardware import HardwareInventory
from .policy import ModelTrustPolicy, NetworkPolicy


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class HealthState(StrEnum):
    HEALTHY = "healthy"
    UNINSTALLED = "uninstalled"
    LICENSE_REQUIRED = "license-required"
    UNSIGNED = "unsigned"
    CORRUPT = "corrupt"
    INCOMPATIBLE = "incompatible"


class CapabilityHealthState(StrEnum):
    READY = "ready"
    DEGRADED = "degraded"
    UNAVAILABLE = "unavailable"


@dataclass(frozen=True, slots=True)
class LicenseAcceptance:
    model_id: str
    license_id: str
    license_sha256: str
    accepted_by: str
    accepted_at: str


@dataclass(frozen=True, slots=True)
class InstalledModel:
    model_id: str
    version: str
    immutable_revision: str
    fingerprint: str
    install_path: Path
    active: bool
    installed_at: str


@dataclass(frozen=True, slots=True)
class ModelHealthReport:
    model_id: str
    state: HealthState
    fingerprint: str | None
    reasons: tuple[str, ...]
    checked_at: str
    compatibility: CompatibilityReport | None = None


@dataclass(frozen=True, slots=True)
class CapabilityHealthReport:
    capability: Capability
    state: CapabilityHealthState
    candidates: tuple[ModelHealthReport, ...]
    checked_at: str


@dataclass(slots=True)
class _ModelState:
    active: str | None
    history: list[str]
    installed_at: dict[str, str]

    @classmethod
    def empty(cls) -> _ModelState:
        return cls(active=None, history=[], installed_at={})

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> _ModelState:
        return cls(
            active=value.get("active"),
            history=list(value.get("history", [])),
            installed_at=dict(value.get("installed_at", {})),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "active": self.active,
            "history": list(self.history),
            "installed_at": dict(sorted(self.installed_at.items())),
        }


class ModelManager:
    """Own model packages while leaving runtime workers read-only.

    Downloads persist as fingerprinted `.part` files so a failed install can
    resume. Only a complete, hash-verified staging directory is atomically moved
    into `installs/`; activation is a separate atomic state-file update.
    """

    def __init__(
        self,
        root: Path,
        downloader: Downloader,
        *,
        signature_verifier: SignatureVerifier | None,
        trust_policy: ModelTrustPolicy | None = None,
        require_signatures: bool = True,
        active_model_keys: Callable[[], frozenset[str]] | None = None,
    ) -> None:
        self.root = root.resolve()
        self.downloader = downloader
        self.signature_verifier = signature_verifier
        self.trust_policy = trust_policy or ModelTrustPolicy()
        self.require_signatures = require_signatures
        self._active_model_keys = active_model_keys or frozenset
        self._lock = threading.RLock()
        self._installs = self.root / "installs"
        self._staging = self.root / "staging"
        self._states = self.root / "state"
        self._manifests = self.root / "manifests"
        self._licenses = self.root / "licenses" / "acceptances.json"
        for directory in (self._installs, self._staging, self._states, self._manifests):
            directory.mkdir(parents=True, exist_ok=True)
        self._licenses.parent.mkdir(parents=True, exist_ok=True)

    def accept_license(self, manifest: ModelManifest, *, accepted_by: str) -> LicenseAcceptance:
        if not accepted_by.strip():
            raise ValueError("accepted_by is required for the immutable audit record")
        self._verify_manifest(manifest)
        acceptance = LicenseAcceptance(
            model_id=manifest.model_id,
            license_id=manifest.license_id,
            license_sha256=manifest.license_sha256,
            accepted_by=accepted_by,
            accepted_at=utc_now(),
        )
        with self._lock:
            records = self._load_acceptances()
            records[self._acceptance_key(manifest)] = asdict(acceptance)
            _atomic_json_write(self._licenses, {"schema_version": 1, "records": records})
        return acceptance

    def has_accepted_license(self, manifest: ModelManifest) -> bool:
        if not manifest.requires_license_acceptance:
            return True
        with self._lock:
            record = self._load_acceptances().get(self._acceptance_key(manifest))
        return bool(
            record
            and record.get("license_sha256") == manifest.license_sha256
            and record.get("license_id") == manifest.license_id
        )

    def install(
        self,
        manifest: ModelManifest,
        *,
        network_policy: NetworkPolicy,
        promote: bool = True,
        progress: ProgressCallback | None = None,
    ) -> InstalledModel:
        self._verify_manifest(manifest)
        for artifact in manifest.artifacts:
            self.trust_policy.validate_artifact(artifact)
        if not self.has_accepted_license(manifest):
            raise LicenseNotAcceptedError(
                f"accept {manifest.license_id} before installing {manifest.model_id}"
            )

        fingerprint = manifest.fingerprint
        target = self._install_path(manifest.model_id, fingerprint)
        with self._lock:
            if not target.exists():
                self._stage_and_promote_files(manifest, network_policy, progress)
            self._write_manifest(manifest)
            state = self._load_state(manifest.model_id)
            state.installed_at.setdefault(fingerprint, utc_now())
            self._save_state(manifest.model_id, state)
            if promote:
                self._promote_locked(manifest.model_id, fingerprint)
                state = self._load_state(manifest.model_id)
            return InstalledModel(
                model_id=manifest.model_id,
                version=manifest.version,
                immutable_revision=manifest.immutable_revision,
                fingerprint=fingerprint,
                install_path=target / "files",
                active=state.active == fingerprint,
                installed_at=state.installed_at[fingerprint],
            )

    def promote(self, model_id: str, fingerprint: str) -> InstalledModel:
        with self._lock:
            self._promote_locked(model_id, fingerprint)
            return self._installed_record(model_id, fingerprint)

    def rollback(self, model_id: str) -> InstalledModel:
        with self._lock:
            state = self._load_state(model_id)
            candidate = next(
                (
                    item
                    for item in reversed(state.history)
                    if item != state.active and self._install_path(model_id, item).is_dir()
                ),
                None,
            )
            if candidate is None:
                raise ModelNotInstalledError(f"no previous installed version for {model_id}")
            self._promote_locked(model_id, candidate)
            return self._installed_record(model_id, candidate)

    def uninstall(self, model_id: str, fingerprint: str, *, force_active: bool = False) -> None:
        with self._lock:
            record = self._installed_record(model_id, fingerprint)
            manifest = self._load_manifest(fingerprint)
            if manifest.install_key in self._active_model_keys():
                raise ModelInUseError(f"model has an active runtime lease: {manifest.install_key}")
            state = self._load_state(model_id)
            if record.active and not force_active:
                raise ModelInUseError(
                    "cannot uninstall the active version without force_active=True"
                )
            if record.active:
                state.active = None
            install_path = self._install_path(model_id, fingerprint)
            self._assert_managed_path(install_path, self._installs)
            shutil.rmtree(install_path)
            state.history = [item for item in state.history if item != fingerprint]
            state.installed_at.pop(fingerprint, None)
            self._save_state(model_id, state)

    def active(self, model_id: str) -> InstalledModel:
        with self._lock:
            state = self._load_state(model_id)
            if state.active is None:
                raise ModelNotInstalledError(f"no active install for {model_id}")
            return self._installed_record(model_id, state.active)

    def list_installed(self, model_id: str | None = None) -> tuple[InstalledModel, ...]:
        with self._lock:
            ids = (
                [model_id]
                if model_id
                else sorted(path.stem for path in self._states.glob("*.json"))
            )
            records: list[InstalledModel] = []
            for candidate_id in ids:
                state = self._load_state(candidate_id)
                for fingerprint in sorted(state.installed_at):
                    if self._install_path(candidate_id, fingerprint).is_dir():
                        records.append(self._installed_record(candidate_id, fingerprint))
            return tuple(records)

    def health(
        self,
        model_id: str,
        *,
        catalog: ModelCatalog | None = None,
        inventory: HardwareInventory | None = None,
        deep_verify: bool = False,
    ) -> ModelHealthReport:
        checked_at = utc_now()
        compatibility = None
        if catalog is not None and inventory is not None:
            compatibility = catalog.compatibility(model_id, inventory)
        try:
            installed = self.active(model_id)
            manifest = self._load_manifest(installed.fingerprint)
        except SignatureError as exc:
            state = self._load_state(model_id)
            return ModelHealthReport(
                model_id,
                HealthState.UNSIGNED,
                state.active,
                (str(exc),),
                checked_at,
                compatibility,
            )
        except IntegrityError as exc:
            state = self._load_state(model_id)
            return ModelHealthReport(
                model_id,
                HealthState.CORRUPT,
                state.active,
                (str(exc),),
                checked_at,
                compatibility,
            )
        except ModelNotInstalledError:
            return ModelHealthReport(
                model_id,
                HealthState.UNINSTALLED,
                None,
                ("no active installation",),
                checked_at,
                compatibility,
            )
        if manifest.requires_license_acceptance and not self.has_accepted_license(manifest):
            return ModelHealthReport(
                model_id,
                HealthState.LICENSE_REQUIRED,
                installed.fingerprint,
                ("the exact installed license hash is not accepted",),
                checked_at,
                compatibility,
            )
        if self.require_signatures and manifest.signature is None:
            return ModelHealthReport(
                model_id,
                HealthState.UNSIGNED,
                installed.fingerprint,
                ("installed manifest has no trusted signature",),
                checked_at,
                compatibility,
            )
        problems: list[str] = []
        for artifact in manifest.artifacts:
            path = installed.install_path / artifact.path
            if not path.is_file():
                problems.append(f"missing artifact: {artifact.path}")
                continue
            if path.stat().st_size != artifact.size_bytes:
                problems.append(f"wrong size: {artifact.path}")
            elif deep_verify and _sha256_file(path) != artifact.sha256:
                problems.append(f"wrong hash: {artifact.path}")
        if problems:
            return ModelHealthReport(
                model_id,
                HealthState.CORRUPT,
                installed.fingerprint,
                tuple(problems),
                checked_at,
                compatibility,
            )
        if compatibility is not None and not compatibility.compatible:
            return ModelHealthReport(
                model_id,
                HealthState.INCOMPATIBLE,
                installed.fingerprint,
                compatibility.reasons,
                checked_at,
                compatibility,
            )
        return ModelHealthReport(
            model_id,
            HealthState.HEALTHY,
            installed.fingerprint,
            (),
            checked_at,
            compatibility,
        )

    def capability_health(
        self,
        capability: Capability,
        *,
        catalog: ModelCatalog,
        inventory: HardwareInventory,
        deep_verify: bool = False,
    ) -> CapabilityHealthReport:
        candidates = tuple(
            self.health(
                entry.model_id,
                catalog=catalog,
                inventory=inventory,
                deep_verify=deep_verify,
            )
            for entry in catalog.for_capability(capability)
        )
        healthy_count = sum(item.state is HealthState.HEALTHY for item in candidates)
        if healthy_count == 0:
            state = CapabilityHealthState.UNAVAILABLE
        elif healthy_count == len(candidates):
            state = CapabilityHealthState.READY
        else:
            state = CapabilityHealthState.DEGRADED
        return CapabilityHealthReport(capability, state, candidates, utc_now())

    def _stage_and_promote_files(
        self,
        manifest: ModelManifest,
        network_policy: NetworkPolicy,
        progress: ProgressCallback | None,
    ) -> None:
        fingerprint = manifest.fingerprint
        stage = self._staging / fingerprint
        files = stage / "files"
        files.mkdir(parents=True, exist_ok=True)
        for artifact in manifest.artifacts:
            destination = files / f"{artifact.path}.part"
            final_artifact = files / artifact.path
            if (
                final_artifact.is_file()
                and final_artifact.stat().st_size == artifact.size_bytes
                and _sha256_file(final_artifact) == artifact.sha256
            ):
                continue
            self._assert_managed_path(destination, self._staging)
            result = self.downloader.download(
                DownloadRequest(artifact.urls, destination, artifact.size_bytes, network_policy),
                progress,
            )
            if result.bytes_written != artifact.size_bytes:
                destination.unlink(missing_ok=True)
                raise IntegrityError(f"wrong size for {artifact.path}")
            if _sha256_file(destination) != artifact.sha256:
                destination.unlink(missing_ok=True)
                raise IntegrityError(f"SHA-256 mismatch for {artifact.path}")
            final_artifact.parent.mkdir(parents=True, exist_ok=True)
            os.replace(destination, final_artifact)
        _atomic_json_write(stage / "manifest.json", manifest.to_dict())
        target = self._install_path(manifest.model_id, fingerprint)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            return
        try:
            os.replace(stage, target)
        except OSError as exc:
            raise InstallError(f"could not atomically promote model staging: {exc}") from exc

    def _verify_manifest(self, manifest: ModelManifest) -> None:
        if manifest.signature is None:
            if self.require_signatures:
                raise SignatureError("model manifest is unsigned")
            return
        if self.signature_verifier is None:
            raise SignatureError("no trusted manifest signature verifier is configured")
        self.signature_verifier.verify(manifest.canonical_payload, manifest.signature)

    def _write_manifest(self, manifest: ModelManifest) -> None:
        path = self._manifests / f"{manifest.fingerprint}.json"
        if path.exists():
            existing = path.read_bytes()
            if existing != canonical_json(manifest.to_dict()):
                raise IntegrityError("immutable manifest fingerprint collision or local tampering")
            return
        _atomic_bytes_write(path, canonical_json(manifest.to_dict()))

    def _load_manifest(self, fingerprint: str) -> ModelManifest:
        path = self._manifests / f"{fingerprint}.json"
        try:
            payload = path.read_bytes()
            manifest = ModelManifest.from_dict(json.loads(payload))
        except (OSError, json.JSONDecodeError, ManifestError) as exc:
            raise ModelNotInstalledError(f"missing or invalid manifest {fingerprint}") from exc
        if manifest.fingerprint != fingerprint:
            raise IntegrityError("stored model manifest fingerprint does not match its filename")
        self._verify_manifest(manifest)
        return manifest

    def _installed_record(self, model_id: str, fingerprint: str) -> InstalledModel:
        state = self._load_state(model_id)
        path = self._install_path(model_id, fingerprint)
        if not path.is_dir() or fingerprint not in state.installed_at:
            raise ModelNotInstalledError(f"model install not found: {model_id}@{fingerprint}")
        manifest = self._load_manifest(fingerprint)
        if manifest.model_id != model_id:
            raise IntegrityError("installed manifest belongs to a different model ID")
        return InstalledModel(
            model_id=model_id,
            version=manifest.version,
            immutable_revision=manifest.immutable_revision,
            fingerprint=fingerprint,
            install_path=path / "files",
            active=state.active == fingerprint,
            installed_at=state.installed_at[fingerprint],
        )

    def _promote_locked(self, model_id: str, fingerprint: str) -> None:
        state = self._load_state(model_id)
        if not self._install_path(model_id, fingerprint).is_dir():
            raise ModelNotInstalledError(
                f"cannot promote missing install: {model_id}@{fingerprint}"
            )
        if fingerprint not in state.installed_at:
            raise ModelNotInstalledError("model state does not know this install")
        if state.active == fingerprint:
            return
        if state.active is not None:
            state.history = [item for item in state.history if item != state.active]
            state.history.append(state.active)
        state.history = [item for item in state.history if item != fingerprint]
        state.active = fingerprint
        self._save_state(model_id, state)

    def _load_state(self, model_id: str) -> _ModelState:
        path = self._state_path(model_id)
        if not path.exists():
            return _ModelState.empty()
        try:
            return _ModelState.from_dict(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError, TypeError) as exc:
            raise IntegrityError(f"model state is corrupt for {model_id}") from exc

    def _save_state(self, model_id: str, state: _ModelState) -> None:
        _atomic_json_write(self._state_path(model_id), state.to_dict())

    def _load_acceptances(self) -> dict[str, dict[str, str]]:
        if not self._licenses.exists():
            return {}
        try:
            data = json.loads(self._licenses.read_text(encoding="utf-8"))
            if data.get("schema_version") != 1 or not isinstance(data.get("records"), dict):
                raise ValueError("unsupported acceptance ledger")
            return dict(data["records"])
        except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
            raise IntegrityError("license acceptance ledger is corrupt") from exc

    def _acceptance_key(self, manifest: ModelManifest) -> str:
        return f"{manifest.model_id}:{manifest.license_id}:{manifest.license_sha256}"

    def _state_path(self, model_id: str) -> Path:
        safe_characters = "abcdefghijklmnopqrstuvwxyz0123456789._-"
        if not model_id or any(char not in safe_characters for char in model_id):
            raise ValueError("unsafe model ID")
        return self._states / f"{model_id}.json"

    def _install_path(self, model_id: str, fingerprint: str) -> Path:
        if len(fingerprint) != 64 or any(char not in "0123456789abcdef" for char in fingerprint):
            raise ValueError("unsafe manifest fingerprint")
        path = self._installs / model_id / fingerprint
        self._assert_managed_path(path, self._installs)
        return path

    @staticmethod
    def _assert_managed_path(path: Path, root: Path) -> None:
        try:
            path.resolve().relative_to(root.resolve())
        except ValueError as exc:
            raise InstallError(f"path escaped managed model root: {path}") from exc


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _atomic_json_write(path: Path, value: object) -> None:
    _atomic_bytes_write(path, canonical_json(value))


def _atomic_bytes_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(file_descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        with suppress(FileNotFoundError):
            os.unlink(temporary_name)
        raise
