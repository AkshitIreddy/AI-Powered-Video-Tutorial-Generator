"""Guarded local presenter worker bridge.

The pipeline owns project state and CAS objects.  Third-party presenter workers
receive immutable copies in an attempt-specific staging directory and may write
only one declared delivery file.  No scene text, project database path, provider
credential, or shell command crosses this boundary.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import signal
import subprocess
import threading
import time
import uuid
from collections.abc import Callable, Mapping, Sequence
from contextlib import suppress
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any, Protocol, cast

from alystria.gpu_guard import GpuExecutionGuard, GpuGuardError
from alystria.project import ProjectStore
from alystria.security.files import detect_mime

from .adapters import GeneratedMedia, GenerationMediaClient
from .presenter_encoding import (
    GplX264Approval,
    PresenterEncoderPolicy,
    PresenterEncoderPolicyError,
    PresenterEncoderSelection,
)

SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
PLACEHOLDER_PATTERN = re.compile(r"\{[a-z_]+\}")
ALLOWED_PLACEHOLDERS = frozenset(
    {"{portrait}", "{audio}", "{output}", "{workspace}", "{job_manifest}", "{seed}"}
)
REQUIRED_PLACEHOLDERS = frozenset({"{portrait}", "{audio}", "{output}"})
MAX_PROCESS_OUTPUT_BYTES = 4 * 1024 * 1024
MAX_PORTRAIT_BYTES = 128 * 1024 * 1024
MAX_AUDIO_BYTES = 2 * 1024 * 1024 * 1024
DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024 * 1024
SAFE_ENVIRONMENT_KEYS = frozenset(
    {
        "CUDA_PATH",
        "CUDA_VISIBLE_DEVICES",
        "HOME",
        "PATH",
        "PYTHONIOENCODING",
        "PYTHONPATH",
        "PYTHONUTF8",
        "SYSTEMROOT",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "WINDIR",
    }
)
PORTRAIT_SUFFIXES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
AUDIO_SUFFIXES = {
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
}
MUSE_TALK_CONTRACT_ID = "alystria.musetalk.worker.v1"
JOYVASA_CONTRACT_ID = "alystria.joyvasa.worker.v1"
MUSE_TALK_MODELS = frozenset(
    {"musetalk", "musetalk-1.5", "liveportrait-musetalk-1.5"}
)
JOYVASA_MODELS = frozenset({"joyvasa-human", "joyvasa-animal"})
ALLOWED_MUSE_TALK_FILE_ROLES = frozenset(
    {
        "adapter-entrypoint",
        "audio-feature-config",
        "audio-feature-preprocessor",
        "audio-feature-weights",
        "face-detection-weights",
        "face-landmark-weights",
        "face-parse-weights",
        "face-resnet-weights",
        "musetalk-config",
        "musetalk-inference-entrypoint",
        "musetalk-adapter-entrypoint",
        "musetalk-weights",
        "liveportrait-motion-template",
        "liveportrait-runtime-manifest",
        "runtime-source-manifest",
        "vae-config",
        "vae-weights",
    }
)
REQUIRED_MUSE_TALK_FILE_ROLES = frozenset(
    {
        "adapter-entrypoint",
        "audio-feature-config",
        "audio-feature-preprocessor",
        "audio-feature-weights",
        "face-detection-weights",
        "face-landmark-weights",
        "face-parse-weights",
        "face-resnet-weights",
        "musetalk-config",
        "musetalk-inference-entrypoint",
        "musetalk-weights",
        "runtime-source-manifest",
        "vae-config",
        "vae-weights",
    }
)
ALLOWED_JOYVASA_FILE_ROLES = frozenset(
    {
        "adapter-entrypoint",
        "runtime-source-manifest",
        "audio-feature-config",
        "audio-feature-preprocessor",
        "audio-feature-weights",
        "motion-generator-weights",
        "motion-template",
        "portrait-runtime-manifest",
    }
)
REQUIRED_JOYVASA_FILE_ROLES = ALLOWED_JOYVASA_FILE_ROLES
ALLOWED_PRESENTER_FILE_ROLES = (
    ALLOWED_MUSE_TALK_FILE_ROLES | ALLOWED_JOYVASA_FILE_ROLES
)
MAX_PROGRESS_BYTES = 1024 * 1024
MAX_PROGRESS_EVENTS = 10_000
PRESENTER_MOTION_PROFILES = frozenset({"lip-sync-only", "native-idle"})


class LocalPresenterError(RuntimeError):
    """Base class for actionable local presenter failures."""


class LocalPresenterPolicyError(LocalPresenterError):
    """The runtime or requested profile violates the execution policy."""


class LocalPresenterRuntimeError(LocalPresenterError):
    """The worker process failed or its runtime changed after approval."""


class LocalPresenterOutputError(LocalPresenterError):
    """The worker returned missing, unsafe, or invalid media."""


class LocalPresenterCancelledError(LocalPresenterError):
    """The owning operation cancelled local presenter generation."""


class LocalPresenterTimeoutError(LocalPresenterError):
    """The local presenter worker exceeded its wall-clock limit."""


class LocalPresenterProcessSurvivedError(LocalPresenterRuntimeError):
    """The presenter child could not be confirmed stopped; keep the GPU claimed."""


class PresenterExecutionPolicy(StrEnum):
    MANAGED_VERIFIED = "managed-verified"
    UNSAFE_TEST_ONLY = "unsafe-test-only"


class PresenterNetworkPolicy(StrEnum):
    SUPERVISOR_DENY = "supervisor-deny"
    NOT_ENFORCED = "not-enforced"


@dataclass(frozen=True, slots=True)
class PresenterProcessResult:
    exit_code: int
    stdout: str = ""
    stderr: str = ""


class PresenterCommandRunner(Protocol):
    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        environment: Mapping[str, str],
        timeout_seconds: float,
        cancelled: Callable[[], bool],
    ) -> PresenterProcessResult: ...


class SubprocessPresenterCommandRunner:
    """Run one exact argv vector without a command shell or inherited secrets."""

    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        environment: Mapping[str, str],
        timeout_seconds: float,
        cancelled: Callable[[], bool],
    ) -> PresenterProcessResult:
        if not argv or any(not item or "\x00" in item for item in argv):
            raise LocalPresenterRuntimeError("Presenter argv contains an empty value or NUL")
        if timeout_seconds <= 0:
            raise ValueError("Presenter timeout must be positive")
        if cancelled():
            raise LocalPresenterCancelledError("Presenter generation cancelled before start")

        creation_flags = 0
        process_options: dict[str, Any] = {}
        if os.name == "nt":
            creation_flags = int(getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)) | int(
                getattr(subprocess, "CREATE_NO_WINDOW", 0)
            )
        else:
            process_options["start_new_session"] = True
        try:
            process = subprocess.Popen(
                list(argv),
                cwd=cwd,
                env=dict(environment),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                shell=False,
                creationflags=creation_flags,
                **process_options,
            )
        except OSError as error:
            raise LocalPresenterRuntimeError(
                f"Could not start local presenter worker: {error}"
            ) from error

        started = time.monotonic()
        try:
            while True:
                elapsed = time.monotonic() - started
                if cancelled():
                    _stop_process(process)
                    _drain_stopped_process(process)
                    if process.poll() is None:
                        raise LocalPresenterProcessSurvivedError(
                            "Presenter cancellation could not confirm the GPU process stopped"
                        )
                    raise LocalPresenterCancelledError("Presenter generation cancelled")
                if elapsed >= timeout_seconds:
                    _stop_process(process)
                    _drain_stopped_process(process)
                    if process.poll() is None:
                        raise LocalPresenterProcessSurvivedError(
                            "Presenter timeout could not confirm the GPU process stopped"
                        )
                    raise LocalPresenterTimeoutError(
                        f"Presenter worker exceeded the {timeout_seconds:g}-second timeout"
                    )
                try:
                    stdout, stderr = process.communicate(
                        timeout=min(0.2, max(0.01, timeout_seconds - elapsed))
                    )
                    return PresenterProcessResult(
                        process.returncode if process.returncode is not None else -1,
                        _bounded_decode(stdout),
                        _bounded_decode(stderr),
                    )
                except subprocess.TimeoutExpired:
                    continue
        except BaseException as error:
            if process.poll() is None:
                _stop_process(process)
                _drain_stopped_process(process)
            if process.poll() is None:
                if isinstance(error, LocalPresenterProcessSurvivedError):
                    raise
                raise LocalPresenterProcessSurvivedError(
                    "Presenter failure could not confirm the GPU process stopped"
                ) from error
            raise


@dataclass(frozen=True, slots=True)
class PinnedPresenterFile:
    path: Path
    sha256: str

    def __post_init__(self) -> None:
        if not SHA256_PATTERN.fullmatch(self.sha256):
            raise ValueError("Pinned presenter file SHA-256 must be 64 lowercase hex characters")


@dataclass(frozen=True, slots=True)
class PresenterContractFile:
    role: str
    pin: PinnedPresenterFile

    def __post_init__(self) -> None:
        if self.role not in ALLOWED_PRESENTER_FILE_ROLES:
            raise ValueError(f"Unsupported presenter contract file role: {self.role}")


@dataclass(frozen=True, slots=True)
class PresenterWorkerContract:
    contract_id: str
    entrypoint: PinnedPresenterFile
    files: tuple[PresenterContractFile, ...]

    def __post_init__(self) -> None:
        contract_roles = {
            MUSE_TALK_CONTRACT_ID: (
                ALLOWED_MUSE_TALK_FILE_ROLES,
                REQUIRED_MUSE_TALK_FILE_ROLES,
                "MuseTalk",
            ),
            JOYVASA_CONTRACT_ID: (
                ALLOWED_JOYVASA_FILE_ROLES,
                REQUIRED_JOYVASA_FILE_ROLES,
                "JoyVASA",
            ),
        }.get(self.contract_id)
        if contract_roles is None:
            raise ValueError(f"Unsupported presenter worker contract: {self.contract_id}")
        allowed, required, name = contract_roles
        roles = [item.role for item in self.files]
        if len(roles) != len(set(roles)):
            raise ValueError(f"{name} contract file roles must be unique")
        unsupported = set(roles) - allowed
        if unsupported:
            raise ValueError(
                f"{name} worker contract has unsupported roles: "
                + ", ".join(sorted(unsupported))
            )
        missing = required - set(roles)
        if missing:
            raise ValueError(
                f"{name} worker contract is missing roles: " + ", ".join(sorted(missing))
            )


@dataclass(frozen=True, slots=True)
class PresenterGpuLeaseMetadata:
    lease_id: str
    owner: str
    mutex_name: str
    device_id: str
    vram_bytes: int

    def __post_init__(self) -> None:
        for label, value in (
            ("lease ID", self.lease_id),
            ("lease owner", self.owner),
            ("mutex name", self.mutex_name),
            ("device ID", self.device_id),
        ):
            if not value.strip() or "\x00" in value or len(value) > 256:
                raise ValueError(f"Presenter GPU {label} is invalid")
        if self.vram_bytes <= 0:
            raise ValueError("Presenter GPU lease VRAM bytes must be positive")

    def as_manifest(self) -> dict[str, object]:
        return {
            "leaseId": self.lease_id,
            "owner": self.owner,
            "mutexName": self.mutex_name,
            "deviceId": self.device_id,
            "vramBytes": self.vram_bytes,
        }


@dataclass(frozen=True, slots=True)
class LocalPresenterProfileBinding:
    profile_id: str
    portrait_artifact_hash: str
    consent_id: str | None = None
    subject_id: str | None = None

    def __post_init__(self) -> None:
        if not self.profile_id.strip():
            raise ValueError("Local presenter profile ID cannot be blank")
        if not SHA256_PATTERN.fullmatch(self.portrait_artifact_hash):
            raise ValueError("Presenter portrait must be a project CAS SHA-256 digest")


@dataclass(frozen=True, slots=True)
class PresenterRuntimeOverride:
    """Bind one reviewed portrait digest to one optional runtime config."""

    portrait_artifact_hash: str
    config_path: Path

    def __post_init__(self) -> None:
        if not SHA256_PATTERN.fullmatch(self.portrait_artifact_hash):
            raise ValueError("Presenter runtime override requires a lowercase portrait SHA-256")


@dataclass(frozen=True, slots=True)
class LocalPresenterRuntime:
    runtime_root: Path
    executable: PinnedPresenterFile
    ffprobe: PinnedPresenterFile | None
    argument_template: tuple[str, ...]
    model_id: str = "musetalk"
    model_revision: str = "unverified"
    motion_profile: str = "lip-sync-only"
    execution_policy: PresenterExecutionPolicy = PresenterExecutionPolicy.MANAGED_VERIFIED
    network_policy: PresenterNetworkPolicy = PresenterNetworkPolicy.SUPERVISOR_DENY
    unsafe_test_only_acknowledged: bool = False
    timeout_seconds: float = 3_600
    probe_timeout_seconds: float = 30
    minimum_output_bytes: int = 1_024
    maximum_output_bytes: int = DEFAULT_MAX_OUTPUT_BYTES
    environment: Mapping[str, str] = field(default_factory=dict)
    additional_pins: tuple[PinnedPresenterFile, ...] = ()
    encoder_policy: PresenterEncoderPolicy | None = None
    worker_contract: PresenterWorkerContract | None = None
    gpu_lease: PresenterGpuLeaseMetadata | None = None

    def __post_init__(self) -> None:
        if not self.model_id.strip() or not self.model_revision.strip():
            raise ValueError("Local presenter model identity cannot be blank")
        if self.motion_profile not in PRESENTER_MOTION_PROFILES:
            raise ValueError("Local presenter motion profile must be lip-sync-only or native-idle")
        if self.timeout_seconds <= 0 or self.probe_timeout_seconds <= 0:
            raise ValueError("Local presenter timeouts must be positive")
        if not 32 <= self.minimum_output_bytes <= self.maximum_output_bytes:
            raise ValueError("Local presenter output limits are invalid")
        if not self.argument_template:
            raise ValueError("Local presenter command template cannot be empty")
        placeholders: set[str] = set()
        for argument in self.argument_template:
            if (
                not isinstance(argument, str)
                or not argument
                or any(character in argument for character in ("\x00", "\r", "\n"))
            ):
                raise ValueError("Local presenter command arguments must be non-empty safe strings")
            found = set(PLACEHOLDER_PATTERN.findall(argument))
            unknown = found - ALLOWED_PLACEHOLDERS
            if unknown:
                raise ValueError(
                    "Local presenter command has unsupported placeholders: "
                    + ", ".join(sorted(unknown))
                )
            placeholders.update(found)
        missing = REQUIRED_PLACEHOLDERS - placeholders
        if missing:
            raise ValueError(
                "Local presenter command is missing placeholders: " + ", ".join(sorted(missing))
            )
        normalized_environment: dict[str, str] = {}
        for name, value in self.environment.items():
            key = str(name).upper()
            if key not in SAFE_ENVIRONMENT_KEYS:
                raise ValueError(f"Local presenter environment key is not allowlisted: {name}")
            if "\x00" in str(value):
                raise ValueError("Local presenter environment contains a NUL byte")
            normalized_environment[key] = str(value)
        object.__setattr__(self, "environment", normalized_environment)

        if self.execution_policy is PresenterExecutionPolicy.MANAGED_VERIFIED:
            if self.unsafe_test_only_acknowledged:
                raise ValueError(
                    "Managed presenter mode cannot carry an unsafe-test acknowledgement"
                )
            if self.network_policy is not PresenterNetworkPolicy.SUPERVISOR_DENY:
                raise ValueError(
                    "Managed presenter mode requires supervisor-enforced network denial"
                )
            if self.ffprobe is None:
                raise ValueError("Managed presenter mode requires a pinned ffprobe executable")
            lowered = {argument.casefold() for argument in self.argument_template}
            if lowered.intersection({"-c", "-m", "--module"}):
                raise ValueError(
                    "Managed presenter mode requires a pinned entrypoint file, not inline/module code"
                )
            model_id = self.model_id.casefold()
            expected_contract = (
                MUSE_TALK_CONTRACT_ID
                if model_id in MUSE_TALK_MODELS
                else JOYVASA_CONTRACT_ID
                if model_id in JOYVASA_MODELS
                else None
            )
            if expected_contract is not None:
                runtime_name = "MuseTalk" if expected_contract == MUSE_TALK_CONTRACT_ID else "JoyVASA"
                if self.encoder_policy is None:
                    raise ValueError(
                        f"Managed {runtime_name} requires an explicitly probed H.264 encoder policy"
                    )
                if "{job_manifest}" not in placeholders:
                    raise ValueError(
                        f"Managed {runtime_name} requires the brokered job manifest; direct upstream "
                        "libx264 muxing is not permitted"
                    )
                if self.worker_contract is None:
                    raise ValueError(
                        f"Managed {runtime_name} requires an exact-hash worker contract"
                    )
                if self.worker_contract.contract_id != expected_contract:
                    raise ValueError(
                        f"Managed {runtime_name} model requires worker contract {expected_contract}"
                    )
                if self.gpu_lease is None:
                    raise ValueError(f"Managed {runtime_name} requires GPU lease metadata")
        elif not self.unsafe_test_only_acknowledged:
            raise ValueError("Unsafe test-only presenter mode requires explicit acknowledgement")


class LocalPresenterMediaClient:
    """Decorate any approved media client with one guarded local presenter route."""

    def __init__(
        self,
        store: ProjectStore,
        base: GenerationMediaClient,
        runtime: LocalPresenterRuntime,
        profiles: Sequence[LocalPresenterProfileBinding],
        *,
        default_profile_id: str,
        runner: PresenterCommandRunner | None = None,
        cancel_check: Callable[[], bool] | None = None,
        runtime_overrides: Sequence[PresenterRuntimeOverride] = (),
        runtime_override_loader: (
            Callable[[PresenterRuntimeOverride], LocalPresenterMediaClient] | None
        ) = None,
    ) -> None:
        self.store = store
        self.base = base
        self.runtime = runtime
        self.runner = runner or SubprocessPresenterCommandRunner()
        self.cancel_check = cancel_check or self._running_presenter_job_cancelled
        self.profiles = {profile.profile_id: profile for profile in profiles}
        if not self.profiles:
            raise ValueError("At least one local presenter profile is required")
        if len(self.profiles) != len(tuple(profiles)):
            raise ValueError("Local presenter profile IDs must be unique")
        if default_profile_id not in self.profiles:
            raise ValueError("Default local presenter profile is not configured")
        self.default_profile_id = default_profile_id
        self.provider_id = base.provider_id
        self.model_revision = f"{base.model_revision}+presenter:{runtime.model_revision}"
        self._cancelled = threading.Event()
        self._encoder_lock = threading.Lock()
        self._encoder_selection: PresenterEncoderSelection | None = None
        runtime_override_items = tuple(runtime_overrides)
        self.runtime_overrides = {
            item.portrait_artifact_hash: item for item in runtime_override_items
        }
        if len(self.runtime_overrides) != len(runtime_override_items):
            raise ValueError("Presenter runtime override portrait hashes must be unique")
        if self.runtime_overrides and runtime_override_loader is None:
            raise ValueError("Presenter runtime overrides require a child runtime loader")
        self._runtime_override_loader = runtime_override_loader
        self._runtime_override_lock = threading.Lock()
        self._runtime_override_clients: dict[str, LocalPresenterMediaClient] = {}

    def cancel(self) -> None:
        self._cancelled.set()
        with self._runtime_override_lock:
            children = tuple(self._runtime_override_clients.values())
        for child in children:
            child.cancel()

    def reset_cancellation(self) -> None:
        self._cancelled.clear()
        with self._runtime_override_lock:
            children = tuple(self._runtime_override_clients.values())
        for child in children:
            child.reset_cancellation()

    def create_visual(self, scene: dict[str, Any], *, seed: int) -> GeneratedMedia:
        return self.base.create_visual(scene, seed=seed)

    def synthesize_narration(
        self, scene: dict[str, Any], *, locale: str, seed: int
    ) -> GeneratedMedia:
        return self.base.synthesize_narration(scene, locale=locale, seed=seed)

    def create_presenter(
        self,
        scene: dict[str, Any],
        *,
        narration_hash: str,
        seed: int,
    ) -> GeneratedMedia:
        scene_id = str(scene.get("id", "")).strip()
        if not scene_id:
            raise LocalPresenterPolicyError("Presenter scene requires a stable ID")
        profile = self._profile_for_scene(scene)
        override = self.runtime_overrides.get(profile.portrait_artifact_hash)
        client = self._runtime_override_client(override) if override is not None else self
        return client._generate(
            scene_id=scene_id,
            profile=profile,
            narration_hash=narration_hash,
            seed=seed,
        )

    def _runtime_override_client(
        self, override: PresenterRuntimeOverride
    ) -> LocalPresenterMediaClient:
        self._raise_if_cancelled()
        with self._runtime_override_lock:
            cached = self._runtime_override_clients.get(override.portrait_artifact_hash)
            if cached is not None:
                return cached
            loader = self._runtime_override_loader
            if loader is None:  # constructor validation makes this defensive only
                raise LocalPresenterRuntimeError("Presenter runtime override loader is unavailable")
            try:
                client = loader(override)
            except LocalPresenterError:
                raise
            except (OSError, TypeError, ValueError) as error:
                raise LocalPresenterRuntimeError(
                    "Could not load the selected portrait runtime; repair or reinstall its "
                    f"runtime pack ({override.config_path.name})"
                ) from error
            if self._cancelled.is_set():
                client.cancel()
                raise LocalPresenterCancelledError("Presenter generation cancelled")
            self._runtime_override_clients[override.portrait_artifact_hash] = client
            return client

    def _profile_for_scene(self, scene: Mapping[str, Any]) -> LocalPresenterProfileBinding:
        selected = scene.get("presenterProfileId")
        presenter = scene.get("presenter")
        if selected is None and isinstance(presenter, Mapping):
            selected = presenter.get("profileId")
        profile_id = self.default_profile_id if selected is None else str(selected).strip()
        configured = self.profiles.get(profile_id)
        portrait_hash = scene.get("portraitArtifactHash")
        if configured is not None:
            if portrait_hash is not None and portrait_hash != configured.portrait_artifact_hash:
                raise LocalPresenterPolicyError(
                    f"Presenter profile {profile_id!r} does not match the reviewed portrait"
                )
            return configured

        if scene.get("presenterModelInputAllowed") is not True:
            raise LocalPresenterPolicyError(
                f"Presenter profile {profile_id!r} is not configured for local generation"
            )
        if not isinstance(portrait_hash, str) or not SHA256_PATTERN.fullmatch(portrait_hash):
            raise LocalPresenterPolicyError(
                f"Presenter profile {profile_id!r} has no reviewed portrait hash"
            )
        if not self.store.cas.verify(portrait_hash):
            raise LocalPresenterPolicyError(
                f"Presenter profile {profile_id!r} portrait is missing or corrupt"
            )
        row = self.store.connection.execute(
            "SELECT media_type FROM artifacts WHERE hash=?", (portrait_hash,)
        ).fetchone()
        if row is None or str(row["media_type"]).casefold() not in {
            "image/jpeg",
            "image/png",
            "image/webp",
        }:
            raise LocalPresenterPolicyError(
                f"Presenter profile {profile_id!r} portrait is not a registered image"
            )
        identity_type = scene.get("presenterIdentityType")
        if identity_type not in {"synthetic", "realPerson"}:
            raise LocalPresenterPolicyError(
                f"Presenter profile {profile_id!r} has no reviewed identity policy"
            )
        consent_id = scene.get("presenterConsentId")
        subject_id = scene.get("presenterSubjectId")
        if identity_type == "realPerson" and (
            not isinstance(consent_id, str)
            or not consent_id.strip()
            or not isinstance(subject_id, str)
            or not subject_id.strip()
        ):
            raise LocalPresenterPolicyError(
                f"Real-person presenter profile {profile_id!r} has no reviewed consent binding"
            )
        return LocalPresenterProfileBinding(
            profile_id=profile_id,
            portrait_artifact_hash=portrait_hash,
            consent_id=consent_id.strip() if isinstance(consent_id, str) else None,
            subject_id=subject_id.strip() if isinstance(subject_id, str) else None,
        )

    def _generate(
        self,
        *,
        scene_id: str,
        profile: LocalPresenterProfileBinding,
        narration_hash: str,
        seed: int,
    ) -> GeneratedMedia:
        if not SHA256_PATTERN.fullmatch(narration_hash):
            raise LocalPresenterPolicyError("Narration input must be a project CAS SHA-256 digest")
        self._raise_if_cancelled()
        runtime_root = self._verify_runtime()
        encoder_selection = self._select_encoder(runtime_root)
        portrait = self._artifact_record(
            profile.portrait_artifact_hash,
            kind="portrait",
            suffixes=PORTRAIT_SUFFIXES,
            maximum_bytes=MAX_PORTRAIT_BYTES,
        )
        narration = self._artifact_record(
            narration_hash,
            kind="narration",
            suffixes=AUDIO_SUFFIXES,
            maximum_bytes=MAX_AUDIO_BYTES,
        )
        staging_parent = _guarded_child(self.store.root, self.store.root / "staging" / "presenter")
        staging_parent.mkdir(parents=True, exist_ok=True)
        request_identity = {
            "contractId": (
                self.runtime.worker_contract.contract_id
                if self.runtime.worker_contract is not None
                else "unsafe-test-only"
            ),
            "modelRevision": self.runtime.model_revision,
            "motionProfile": self.runtime.motion_profile,
            "runtimeFingerprint": self._runtime_fingerprint(),
            "encoderSelection": (
                encoder_selection.as_manifest() if encoder_selection is not None else None
            ),
            "sceneId": scene_id,
            "profileId": profile.profile_id,
            "portraitSha256": profile.portrait_artifact_hash,
            "audioSha256": narration_hash,
            "seed": seed,
        }
        request_key = hashlib.sha256(
            json.dumps(request_identity, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        recovered = self._recover_promoted(
            staging_parent,
            request_key=request_key,
            request_identity=request_identity,
            scene_id=scene_id,
            profile=profile,
            narration_hash=narration_hash,
            seed=seed,
            runtime_root=runtime_root,
            encoder_selection=encoder_selection,
        )
        if recovered is not None:
            return recovered

        self._recover_interrupted_attempts(staging_parent)
        attempt_root = _guarded_child(
            staging_parent, staging_parent / f"attempt-{uuid.uuid4().hex}"
        )
        attempt_root.mkdir()
        state_path = _guarded_child(attempt_root, attempt_root / "attempt-state.json")
        _write_json_atomic(
            state_path,
            {"schemaVersion": 1, "state": "preparing", "requestKey": request_key},
        )
        try:
            inputs_root = _guarded_child(attempt_root, attempt_root / "inputs")
            workspace_root = _guarded_child(attempt_root, attempt_root / "workspace")
            output_root = _guarded_child(attempt_root, attempt_root / "output")
            inputs_root.mkdir()
            workspace_root.mkdir()
            output_root.mkdir()
            portrait_path = _guarded_child(
                inputs_root, inputs_root / f"portrait{portrait['suffix']}"
            )
            narration_path = _guarded_child(
                inputs_root, inputs_root / f"narration{narration['suffix']}"
            )
            output_path = _guarded_child(output_root, output_root / "presenter.mp4")
            progress_path = _guarded_child(attempt_root, attempt_root / "progress.ndjson")
            self.store.cas.copy_to(profile.portrait_artifact_hash, portrait_path)
            self.store.cas.copy_to(narration_hash, narration_path)
            _make_read_only(portrait_path)
            _make_read_only(narration_path)
            self._validate_staged_input(portrait_path, profile.portrait_artifact_hash, "portrait")
            self._validate_staged_input(narration_path, narration_hash, "narration")
            self._validate_input_magic(portrait_path, str(portrait["mediaType"]), "portrait")
            self._validate_input_magic(narration_path, str(narration["mediaType"]), "narration")

            job_manifest = {
                "schemaVersion": 2,
                "sceneId": scene_id,
                "profileId": profile.profile_id,
                "model": self.runtime.model_id,
                "modelRevision": self.runtime.model_revision,
                "seed": seed,
                "inputs": {
                    "portrait": {
                        "path": str(portrait_path),
                        "sha256": profile.portrait_artifact_hash,
                        "mediaType": portrait["mediaType"],
                    },
                    "audio": {
                        "path": str(narration_path),
                        "sha256": narration_hash,
                        "mediaType": narration["mediaType"],
                    },
                },
                "output": {"path": str(output_path), "mediaType": "video/mp4"},
                "progress": {
                    "path": str(progress_path),
                    "mediaType": "application/x-ndjson",
                    "schemaVersion": 1,
                },
            }
            if self.runtime.worker_contract is not None:
                contract = self.runtime.worker_contract
                job_manifest["workerContract"] = {
                    "contractId": contract.contract_id,
                    "entrypoint": _pin_manifest(contract.entrypoint),
                    "files": [
                        {"role": item.role, **_pin_manifest(item.pin)} for item in contract.files
                    ],
                }
            if self.runtime.gpu_lease is not None:
                job_manifest["gpuLease"] = self.runtime.gpu_lease.as_manifest()
            if encoder_selection is not None:
                encoder_policy = self.runtime.encoder_policy
                if encoder_policy is None:  # pragma: no cover - guarded by _select_encoder
                    raise LocalPresenterRuntimeError("Presenter encoder policy disappeared")
                job_manifest["encoding"] = {
                    **encoder_selection.as_manifest(),
                    "ffmpegPath": str(encoder_policy.ffmpeg_path),
                    "ffmpegSha256": encoder_policy.ffmpeg_sha256,
                }
            manifest_path = _guarded_child(attempt_root, attempt_root / "presenter-job.json")
            manifest_path.write_text(
                json.dumps(job_manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                + "\n",
                encoding="utf-8",
                newline="\n",
            )
            _write_json_atomic(
                state_path,
                {"schemaVersion": 1, "state": "running", "requestKey": request_key},
            )
            argv = self._worker_argv(
                portrait=portrait_path,
                audio=narration_path,
                output=output_path,
                workspace=workspace_root,
                job_manifest=manifest_path,
                seed=seed,
            )
            gpu_lease = self.runtime.gpu_lease
            owner_identity = (
                hashlib.sha256(
                    f"{gpu_lease.owner}\0{gpu_lease.lease_id}".encode()
                ).hexdigest()[:32]
                if gpu_lease is not None
                else "unsafe-test-only"
            )
            gpu_guard = GpuExecutionGuard(
                mutex_name=(gpu_lease.mutex_name if gpu_lease is not None else None),
                owner=f"local-presenter:{owner_identity}",
            )
            try:
                with gpu_guard:
                    try:
                        result = self.runner.run(
                            argv,
                            cwd=runtime_root,
                            environment=self._safe_environment(),
                            timeout_seconds=self.runtime.timeout_seconds,
                            cancelled=self._is_cancelled,
                        )
                    except LocalPresenterProcessSurvivedError:
                        gpu_guard.preserve_claim()
                        raise
            except GpuGuardError as error:
                raise LocalPresenterRuntimeError(str(error)) from error
            if result.exit_code != 0:
                detail = result.stderr.strip() or result.stdout.strip() or "no process output"
                raise LocalPresenterRuntimeError(
                    f"Presenter worker exited with code {result.exit_code}: {detail[-4_096:]}"
                )
            progress = self._read_progress(progress_path)
            self._validate_staged_input(portrait_path, profile.portrait_artifact_hash, "portrait")
            self._validate_staged_input(narration_path, narration_hash, "narration")
            content_before_probe = self._read_output(output_root, output_path)
            probe = self._probe_output(output_path, runtime_root)
            content = self._read_output(output_root, output_path)
            if content != content_before_probe:
                raise LocalPresenterOutputError(
                    "Presenter delivery changed while it was being probed"
                )
            output_hash = hashlib.sha256(content).hexdigest()
            completed_root = _guarded_child(staging_parent, staging_parent / "completed")
            completed_root.mkdir(exist_ok=True)
            promoted_root = _guarded_child(completed_root, completed_root / request_key)
            promoted_root.mkdir(exist_ok=False)
            promoted_path = _guarded_child(promoted_root, promoted_root / "presenter.mp4")
            output_path.replace(promoted_path)
            _write_json_atomic(
                promoted_root / "receipt.json",
                {
                    "schemaVersion": 1,
                    "requestIdentity": request_identity,
                    "outputSha256": output_hash,
                },
            )
            _write_json_atomic(
                state_path,
                {
                    "schemaVersion": 1,
                    "state": "promoted",
                    "requestKey": request_key,
                    "outputSha256": output_hash,
                },
            )
            return self._build_generated_media(
                content=content,
                scene_id=scene_id,
                profile=profile,
                narration_hash=narration_hash,
                seed=seed,
                output_hash=output_hash,
                probe=probe,
                encoder_selection=encoder_selection,
                progress=progress,
                recovered=False,
            )
        except BaseException as error:
            _write_json_atomic(
                state_path,
                {
                    "schemaVersion": 1,
                    "state": "cancelled"
                    if isinstance(error, LocalPresenterCancelledError)
                    else "failed",
                    "requestKey": request_key,
                    "errorType": type(error).__name__,
                },
            )
            raise

    def _recover_promoted(
        self,
        staging_parent: Path,
        *,
        request_key: str,
        request_identity: Mapping[str, object],
        scene_id: str,
        profile: LocalPresenterProfileBinding,
        narration_hash: str,
        seed: int,
        runtime_root: Path,
        encoder_selection: PresenterEncoderSelection | None,
    ) -> GeneratedMedia | None:
        promoted_root = staging_parent / "completed" / request_key
        if not promoted_root.exists():
            return None
        receipt_path = promoted_root / "receipt.json"
        output_path = promoted_root / "presenter.mp4"
        try:
            if promoted_root.is_symlink() or not promoted_root.resolve(strict=True).is_dir():
                raise LocalPresenterOutputError("Recovered presenter delivery root is unsafe")
            receipt = _read_small_json(receipt_path)
            if receipt.get("schemaVersion") != 1 or receipt.get("requestIdentity") != dict(
                request_identity
            ):
                raise LocalPresenterOutputError("Recovered presenter receipt identity changed")
            content = _read_media_file(
                output_path,
                minimum_bytes=self.runtime.minimum_output_bytes,
                maximum_bytes=self.runtime.maximum_output_bytes,
            )
            output_hash = hashlib.sha256(content).hexdigest()
            if receipt.get("outputSha256") != output_hash:
                raise LocalPresenterOutputError("Recovered presenter delivery SHA-256 changed")
            probe = self._probe_output(output_path, runtime_root)
        except LocalPresenterError:
            raise
        except (OSError, ValueError) as error:
            raise LocalPresenterOutputError("Recovered presenter delivery is incomplete") from error
        return self._build_generated_media(
            content=content,
            scene_id=scene_id,
            profile=profile,
            narration_hash=narration_hash,
            seed=seed,
            output_hash=output_hash,
            probe=probe,
            encoder_selection=encoder_selection,
            progress=(),
            recovered=True,
        )

    @staticmethod
    def _recover_interrupted_attempts(staging_parent: Path) -> None:
        for attempt_root in tuple(staging_parent.glob("attempt-*"))[:10_000]:
            state_path = attempt_root / "attempt-state.json"
            try:
                if attempt_root.is_symlink() or not attempt_root.is_dir():
                    continue
                state = _read_small_json(state_path)
                if state.get("state") not in {"preparing", "running"}:
                    continue
                _write_json_atomic(
                    state_path,
                    {
                        **state,
                        "state": "recovered-abandoned",
                        "recoveredAtUnixNs": time.time_ns(),
                    },
                )
            except (OSError, ValueError, LocalPresenterOutputError):
                continue

    def _read_progress(self, path: Path) -> tuple[dict[str, object], ...]:
        if not path.exists():
            if self.runtime.execution_policy is PresenterExecutionPolicy.MANAGED_VERIFIED:
                raise LocalPresenterOutputError(
                    "Managed presenter worker emitted no progress ledger"
                )
            return ()
        try:
            info = path.lstat()
            if path.is_symlink() or not path.is_file() or info.st_size > MAX_PROGRESS_BYTES:
                raise LocalPresenterOutputError("Presenter progress ledger is unsafe or oversized")
            lines = path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError) as error:
            raise LocalPresenterOutputError(
                "Presenter progress ledger could not be read"
            ) from error
        if not 1 <= len(lines) <= MAX_PROGRESS_EVENTS:
            raise LocalPresenterOutputError("Presenter progress ledger has an invalid event count")
        events: list[dict[str, object]] = []
        previous_progress = -1.0
        allowed_stages = {
            "accepted",
            "verified",
            "model-loading",
            "inference",
            "encoding",
            "complete",
        }
        for index, line in enumerate(lines, start=1):
            try:
                event = json.loads(line)
            except json.JSONDecodeError as error:
                raise LocalPresenterOutputError(
                    "Presenter progress ledger contains invalid JSON"
                ) from error
            if not isinstance(event, dict) or event.get("schemaVersion") != 1:
                raise LocalPresenterOutputError("Presenter progress event has an invalid schema")
            if event.get("sequence") != index or event.get("stage") not in allowed_stages:
                raise LocalPresenterOutputError("Presenter progress sequence or stage is invalid")
            raw_progress = event.get("progress")
            if (
                not isinstance(raw_progress, (int, float))
                or isinstance(raw_progress, bool)
                or not previous_progress <= float(raw_progress) <= 1
            ):
                raise LocalPresenterOutputError(
                    "Presenter progress must be monotonic from zero to one"
                )
            message = event.get("message")
            if (
                not isinstance(message, str)
                or not message
                or len(message) > 512
                or "\x00" in message
            ):
                raise LocalPresenterOutputError("Presenter progress message is invalid")
            previous_progress = float(raw_progress)
            events.append(cast(dict[str, object], event))
        if events[-1]["stage"] != "complete" or previous_progress != 1:
            raise LocalPresenterOutputError(
                "Presenter progress ledger has no completed terminal event"
            )
        return tuple(events)

    def _build_generated_media(
        self,
        *,
        content: bytes,
        scene_id: str,
        profile: LocalPresenterProfileBinding,
        narration_hash: str,
        seed: int,
        output_hash: str,
        probe: Mapping[str, object],
        encoder_selection: PresenterEncoderSelection | None,
        progress: Sequence[Mapping[str, object]],
        recovered: bool,
    ) -> GeneratedMedia:
        duration_value = probe.get("durationSeconds", 0.0)
        duration_seconds = (
            float(duration_value)
            if isinstance(duration_value, (int, float, str))
            and not isinstance(duration_value, bool)
            else 0.0
        )
        return GeneratedMedia(
            content=content,
            media_type="video/mp4",
            original_name=f"{_safe_name(scene_id)}.presenter.mp4",
            provider_id="local-presenter",
            model_revision=self.runtime.model_revision,
            metadata={
                "rightsStatus": "owned",
                "licenseId": "USER-OWNED",
                "localOnly": True,
                "synthetic": True,
                "disclosureRequired": True,
                "provider": "local-presenter",
                # The renderer adds its subtle fallback only when the selected
                # provider declares that it produces speech motion alone.
                "motionProfile": self.runtime.motion_profile,
                "modelId": self.runtime.model_id,
                "modelRevision": self.runtime.model_revision,
                "presenterProfileId": profile.profile_id,
                "consentId": profile.consent_id,
                "consentIds": [profile.consent_id] if profile.consent_id else [],
                "subjectId": profile.subject_id,
                "portraitArtifactHash": profile.portrait_artifact_hash,
                "narrationArtifactHash": narration_hash,
                "outputSha256": output_hash,
                "executionPolicy": self.runtime.execution_policy.value,
                "networkPolicy": self.runtime.network_policy.value,
                "unsafeTestOnly": (
                    self.runtime.execution_policy is PresenterExecutionPolicy.UNSAFE_TEST_ONLY
                ),
                "validationLevel": (
                    "ffprobe" if self.runtime.ffprobe is not None else "container-signature-only"
                ),
                "probe": dict(probe),
                "encoderSelection": (
                    encoder_selection.as_manifest() if encoder_selection is not None else None
                ),
                "workerContractId": (
                    self.runtime.worker_contract.contract_id
                    if self.runtime.worker_contract is not None
                    else None
                ),
                "gpuLease": (
                    self.runtime.gpu_lease.as_manifest()
                    if self.runtime.gpu_lease is not None
                    else None
                ),
                "progress": [dict(item) for item in progress],
                "recoveredFromPromotion": recovered,
                "seed": seed,
            },
            actual_cost_micros=0,
            usage_units={"seconds": duration_seconds},
        )

    def _artifact_record(
        self,
        digest: str,
        *,
        kind: str,
        suffixes: Mapping[str, str],
        maximum_bytes: int,
    ) -> dict[str, object]:
        if not SHA256_PATTERN.fullmatch(digest) or not self.store.cas.verify(digest):
            raise LocalPresenterPolicyError(f"Presenter {kind} CAS input is missing or corrupt")
        row = self.store.connection.execute(
            "SELECT byte_size,media_type FROM artifacts WHERE hash=?", (digest,)
        ).fetchone()
        if row is None:
            raise LocalPresenterPolicyError(f"Presenter {kind} input is not a registered artifact")
        media_type = str(row["media_type"]).casefold()
        suffix = suffixes.get(media_type)
        if suffix is None:
            raise LocalPresenterPolicyError(
                f"Presenter {kind} has unsupported media type {media_type!r}"
            )
        byte_size = int(row["byte_size"])
        if byte_size <= 0 or byte_size > maximum_bytes:
            raise LocalPresenterPolicyError(f"Presenter {kind} input exceeds its size policy")
        return {"mediaType": media_type, "suffix": suffix, "byteSize": byte_size}

    def _runtime_fingerprint(self) -> str:
        ledger: list[dict[str, str]] = [
            {"role": "worker-executable", "sha256": self.runtime.executable.sha256},
            *(
                {"role": f"runtime-file-{index}", "sha256": pin.sha256}
                for index, pin in enumerate(self.runtime.additional_pins)
            ),
        ]
        if self.runtime.ffprobe is not None:
            ledger.append({"role": "ffprobe", "sha256": self.runtime.ffprobe.sha256})
        if self.runtime.encoder_policy is not None:
            ledger.append(
                {"role": "presenter-ffmpeg", "sha256": self.runtime.encoder_policy.ffmpeg_sha256}
            )
        if self.runtime.worker_contract is not None:
            ledger.append(
                {
                    "role": "worker-contract-entrypoint",
                    "sha256": self.runtime.worker_contract.entrypoint.sha256,
                }
            )
            ledger.extend(
                {"role": item.role, "sha256": item.pin.sha256}
                for item in self.runtime.worker_contract.files
            )
        return hashlib.sha256(
            json.dumps(ledger, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

    def _verify_runtime(self) -> Path:
        root = self.runtime.runtime_root.resolve(strict=True)
        if not root.is_dir() or self.runtime.runtime_root.is_symlink():
            raise LocalPresenterRuntimeError("Presenter runtime root must be a safe directory")
        pins: list[tuple[str, PinnedPresenterFile | None]] = [
            ("worker executable", self.runtime.executable),
            ("ffprobe", self.runtime.ffprobe),
            (
                "presenter FFmpeg",
                (
                    PinnedPresenterFile(
                        self.runtime.encoder_policy.ffmpeg_path,
                        self.runtime.encoder_policy.ffmpeg_sha256,
                    )
                    if self.runtime.encoder_policy is not None
                    else None
                ),
            ),
            *(("runtime file", pin) for pin in self.runtime.additional_pins),
        ]
        if self.runtime.worker_contract is not None:
            pins.append(("worker contract entrypoint", self.runtime.worker_contract.entrypoint))
            pins.extend(
                (f"worker contract {item.role}", item.pin)
                for item in self.runtime.worker_contract.files
            )
        for label, pin in pins:
            if pin is None:
                continue
            self._verify_pin(pin, root, label)
        if self.runtime.execution_policy is PresenterExecutionPolicy.MANAGED_VERIFIED:
            pin_paths = {
                pin.path.resolve(strict=True)
                for pin in (
                    self.runtime.executable,
                    *self.runtime.additional_pins,
                    *(
                        (self.runtime.worker_contract.entrypoint,)
                        if self.runtime.worker_contract is not None
                        else ()
                    ),
                    *(
                        tuple(item.pin for item in self.runtime.worker_contract.files)
                        if self.runtime.worker_contract is not None
                        else ()
                    ),
                )
            }
            for argument in self.runtime.argument_template:
                if PLACEHOLDER_PATTERN.search(argument):
                    continue
                candidate = _fixed_file_argument(argument, root)
                if candidate is not None and candidate not in pin_paths:
                    raise LocalPresenterPolicyError(
                        f"Managed presenter command references unpinned runtime file {candidate.name!r}"
                    )
        return root

    def _select_encoder(self, runtime_root: Path) -> PresenterEncoderSelection | None:
        policy = self.runtime.encoder_policy
        if policy is None:
            return None
        # A client can generate multiple presenter scenes.  The first request
        # performs real one-frame probes; later scenes reuse the auditable
        # result from the same verified runtime.  Runtime pins are rechecked on
        # every scene before this cache is consulted.
        with self._encoder_lock:
            if self._encoder_selection is not None:
                return self._encoder_selection
            try:
                selected = policy.select(
                    self.runner,
                    cwd=runtime_root,
                    environment=self._safe_environment(),
                    cancelled=self._is_cancelled,
                )
            except PresenterEncoderPolicyError as error:
                raise LocalPresenterRuntimeError(str(error)) from error
            self._encoder_selection = selected
            return selected

    @staticmethod
    def _verify_pin(pin: PinnedPresenterFile, root: Path, label: str) -> None:
        try:
            original = pin.path.lstat()
            resolved = pin.path.resolve(strict=True)
            resolved.relative_to(root)
        except (OSError, ValueError) as error:
            raise LocalPresenterRuntimeError(
                f"Pinned presenter {label} is outside or missing from its runtime"
            ) from error
        if pin.path.is_symlink() or not resolved.is_file() or original.st_size <= 0:
            raise LocalPresenterRuntimeError(
                f"Pinned presenter {label} must be a non-empty regular file"
            )
        if _sha256_file(resolved) != pin.sha256:
            raise LocalPresenterRuntimeError(f"Pinned presenter {label} SHA-256 changed")

    @staticmethod
    def _validate_staged_input(path: Path, expected_hash: str, label: str) -> None:
        try:
            info = path.lstat()
        except OSError as error:
            raise LocalPresenterOutputError(
                f"Presenter {label} staging input disappeared"
            ) from error
        if path.is_symlink() or not path.is_file() or info.st_size <= 0:
            raise LocalPresenterOutputError(f"Presenter {label} staging input became unsafe")
        if _sha256_file(path) != expected_hash:
            raise LocalPresenterOutputError(f"Presenter worker modified immutable {label} input")

    @staticmethod
    def _validate_input_magic(path: Path, declared_media_type: str, label: str) -> None:
        try:
            with path.open("rb") as stream:
                detected = detect_mime(stream.read(64 * 1024))
        except (OSError, ValueError) as error:
            raise LocalPresenterPolicyError(
                f"Presenter {label} content could not be validated"
            ) from error
        normalized = "audio/wav" if declared_media_type == "audio/x-wav" else declared_media_type
        if detected != normalized:
            raise LocalPresenterPolicyError(
                f"Presenter {label} declared {declared_media_type!r} but contains {detected!r}"
            )

    def _worker_argv(
        self,
        *,
        portrait: Path,
        audio: Path,
        output: Path,
        workspace: Path,
        job_manifest: Path,
        seed: int,
    ) -> tuple[str, ...]:
        replacements = {
            "{portrait}": str(portrait),
            "{audio}": str(audio),
            "{output}": str(output),
            "{workspace}": str(workspace),
            "{job_manifest}": str(job_manifest),
            "{seed}": str(seed),
        }
        arguments: list[str] = []
        for template in self.runtime.argument_template:
            value = template
            for placeholder, replacement in replacements.items():
                value = value.replace(placeholder, replacement)
            if not value or any(character in value for character in ("\x00", "\r", "\n")):
                raise LocalPresenterPolicyError("Expanded presenter argument is invalid")
            arguments.append(value)
        return (str(self.runtime.executable.path.resolve(strict=True)), *arguments)

    def _safe_environment(self) -> dict[str, str]:
        environment = {
            key.upper(): value
            for key, value in os.environ.items()
            if key.upper() in SAFE_ENVIRONMENT_KEYS - {"HOME", "USERPROFILE"}
        }
        environment.update(self.runtime.environment)
        # Some Python dependencies call Path.home() even when every model and
        # cache path is explicitly pinned.  Give the worker a contained home
        # instead of exposing the host profile (and its credentials/config).
        presenter_home = _guarded_child(
            self.store.root,
            self.store.root / "staging" / "presenter" / "runtime-home",
        )
        presenter_home.mkdir(parents=True, exist_ok=True)
        environment_home = _subprocess_environment_path(presenter_home)
        environment["HOME"] = environment_home
        environment["USERPROFILE"] = environment_home
        environment["PYTHONUTF8"] = "1"
        environment["PYTHONIOENCODING"] = "utf-8"
        return environment

    def _read_output(self, output_root: Path, output_path: Path) -> bytes:
        entries = list(output_root.iterdir())
        if entries != [output_path]:
            raise LocalPresenterOutputError(
                "Presenter output directory must contain exactly the declared delivery"
            )
        try:
            info = output_path.lstat()
            resolved = output_path.resolve(strict=True)
            resolved.relative_to(output_root.resolve(strict=True))
        except (OSError, ValueError) as error:
            raise LocalPresenterOutputError(
                "Presenter delivery is missing or escaped staging"
            ) from error
        if output_path.is_symlink() or not resolved.is_file():
            raise LocalPresenterOutputError("Presenter delivery must be a regular non-symlink file")
        if (
            not self.runtime.minimum_output_bytes
            <= info.st_size
            <= self.runtime.maximum_output_bytes
        ):
            raise LocalPresenterOutputError("Presenter delivery violates configured size limits")
        with resolved.open("rb") as stream:
            content = stream.read(self.runtime.maximum_output_bytes + 1)
        if len(content) != info.st_size or len(content) > self.runtime.maximum_output_bytes:
            raise LocalPresenterOutputError("Presenter delivery changed while being validated")
        try:
            detected = detect_mime(content)
        except ValueError as error:
            raise LocalPresenterOutputError("Presenter delivery is not recognized media") from error
        if detected != "video/mp4":
            raise LocalPresenterOutputError("Presenter delivery must be an MP4 container")
        return content

    def _probe_output(self, output_path: Path, runtime_root: Path) -> dict[str, Any]:
        ffprobe = self.runtime.ffprobe
        if ffprobe is None:
            return {"verified": False, "reason": "unsafe test mode has no pinned ffprobe"}
        result = self.runner.run(
            (
                str(ffprobe.path.resolve(strict=True)),
                "-v",
                "error",
                "-show_entries",
                (
                    "format=duration:stream=codec_type,codec_name,width,height,"
                    "r_frame_rate,duration,sample_rate,channels"
                ),
                "-of",
                "json",
                str(output_path),
            ),
            cwd=runtime_root,
            environment=self._safe_environment(),
            timeout_seconds=self.runtime.probe_timeout_seconds,
            cancelled=self._is_cancelled,
        )
        if result.exit_code != 0:
            detail = result.stderr.strip() or result.stdout.strip() or "no process output"
            raise LocalPresenterOutputError(
                f"ffprobe rejected presenter delivery: {detail[-2_048:]}"
            )
        try:
            value = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise LocalPresenterOutputError("ffprobe returned invalid JSON") from error
        if not isinstance(value, dict) or not isinstance(value.get("streams"), list):
            raise LocalPresenterOutputError("ffprobe presenter result is incomplete")
        streams = cast(list[object], value["streams"])
        videos = [
            item for item in streams if isinstance(item, dict) and item.get("codec_type") == "video"
        ]
        audios = [
            item for item in streams if isinstance(item, dict) and item.get("codec_type") == "audio"
        ]
        if len(videos) != 1 or not audios:
            raise LocalPresenterOutputError(
                "Presenter delivery requires one video stream and at least one audio stream"
            )
        video = cast(dict[str, Any], videos[0])
        width = _positive_int(video.get("width"), "presenter width")
        height = _positive_int(video.get("height"), "presenter height")
        if width > 16_384 or height > 16_384:
            raise LocalPresenterOutputError("Presenter delivery dimensions exceed policy")
        frame_rate = str(video.get("r_frame_rate", ""))
        if not re.fullmatch(r"[1-9][0-9]*/[1-9][0-9]*", frame_rate):
            raise LocalPresenterOutputError("Presenter delivery frame rate is invalid")
        frame_rate_numerator, frame_rate_denominator = (
            int(value) for value in frame_rate.split("/", maxsplit=1)
        )
        stream_tolerance = max(
            0.12,
            3 * frame_rate_denominator / frame_rate_numerator,
        )
        video_duration = _presenter_stream_duration(
            video.get("duration"), "video stream"
        )
        audio_durations = [
            _presenter_stream_duration(item.get("duration"), f"audio stream {index}")
            for index, item in enumerate(audios, start=1)
            if isinstance(item, dict)
        ]
        if any(
            abs(video_duration - audio_duration) > stream_tolerance
            for audio_duration in audio_durations
        ):
            raise LocalPresenterOutputError(
                "Presenter delivery audio and video stream durations disagree"
            )
        format_value = value.get("format")
        if not isinstance(format_value, dict):
            raise LocalPresenterOutputError("Presenter delivery has no format probe")
        raw_duration = format_value.get("duration")
        if not isinstance(raw_duration, (str, int, float)) or isinstance(raw_duration, bool):
            raise LocalPresenterOutputError("Presenter delivery duration is invalid")
        try:
            duration = float(raw_duration)
        except (TypeError, ValueError) as error:
            raise LocalPresenterOutputError("Presenter delivery duration is invalid") from error
        if not 0 < duration <= 10_800:
            raise LocalPresenterOutputError("Presenter delivery duration is outside policy")
        if abs(duration - max(video_duration, *audio_durations)) > stream_tolerance:
            raise LocalPresenterOutputError(
                "Presenter delivery container and stream durations disagree"
            )
        return {
            "verified": True,
            "durationSeconds": duration,
            "videoDurationSeconds": video_duration,
            "audioDurationSeconds": audio_durations,
            "avDurationDeltaSeconds": max(
                abs(video_duration - audio_duration)
                for audio_duration in audio_durations
            ),
            "width": width,
            "height": height,
            "frameRate": frame_rate,
            "videoCodec": str(video.get("codec_name", "unknown")),
            "audioCodecs": sorted(
                {
                    str(item.get("codec_name", "unknown"))
                    for item in audios
                    if isinstance(item, dict)
                }
            ),
        }

    def _is_cancelled(self) -> bool:
        return self._cancelled.is_set() or self.cancel_check()

    def _running_presenter_job_cancelled(self) -> bool:
        """Observe cancellation committed by another desktop RPC connection."""

        rows = self.store.connection.execute(
            """SELECT parameters_json FROM jobs
            WHERE state='RUNNING' AND cancel_requested=1 AND project_id=?""",
            (self.store.manifest.project_id,),
        ).fetchall()
        for row in rows:
            try:
                parameters = json.loads(row["parameters_json"])
            except (TypeError, json.JSONDecodeError):
                continue
            if isinstance(parameters, dict) and parameters.get("stage") == "presenter":
                return True
        return False

    def _raise_if_cancelled(self) -> None:
        if self._is_cancelled():
            raise LocalPresenterCancelledError("Presenter generation cancelled")


def load_local_presenter_media_client(
    store: ProjectStore,
    base: GenerationMediaClient,
    config_path: Path,
    *,
    runner: PresenterCommandRunner | None = None,
    cancel_check: Callable[[], bool] | None = None,
    _allow_runtime_overrides: bool = True,
) -> LocalPresenterMediaClient:
    """Load the narrow JSON setup record written by the privileged model manager.

    Optional portrait runtime configs are parsed only when their exact portrait
    digest is selected, then cached for this client. Recreate the client after an
    installer changes config semantics; pinned runtime files are still rechecked
    before every render.
    """

    try:
        path = config_path.resolve(strict=True)
        if config_path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
            raise LocalPresenterPolicyError("Local presenter config must be a small regular file")
        value = json.loads(path.read_text(encoding="utf-8"))
    except LocalPresenterError:
        raise
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LocalPresenterPolicyError(
            f"Could not load local presenter config: {error}"
        ) from error
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise LocalPresenterPolicyError("Local presenter config requires schemaVersion 1")
    if not _allow_runtime_overrides and "portraitRuntimeOverrides" in value:
        raise LocalPresenterPolicyError(
            "Nested portraitRuntimeOverrides are not permitted in an override config"
        )
    runtime_overrides = (
        _config_runtime_overrides(value.get("portraitRuntimeOverrides", []), path.parent)
        if _allow_runtime_overrides
        else ()
    )
    runtime_root = _config_path(value, "runtimeRoot", base=path.parent, must_exist=True)
    executable = _config_pin(value.get("executable"), runtime_root, "executable")
    ffprobe_value = value.get("ffprobe")
    ffprobe = None if ffprobe_value is None else _config_pin(ffprobe_value, runtime_root, "ffprobe")
    encoder_policy = _config_encoder_policy(value.get("presenterEncoding"), runtime_root)
    worker_contract = _config_worker_contract(value.get("workerContract"), runtime_root)
    gpu_lease = _config_gpu_lease(value.get("gpuLease"))
    additional_value = value.get("pinnedFiles", [])
    if not isinstance(additional_value, list):
        raise LocalPresenterPolicyError("pinnedFiles must be a list")
    additional = tuple(
        _config_pin(item, runtime_root, f"pinnedFiles[{index}]")
        for index, item in enumerate(additional_value)
    )
    arguments = value.get("argumentTemplate")
    if not isinstance(arguments, list) or not all(isinstance(item, str) for item in arguments):
        raise LocalPresenterPolicyError("argumentTemplate must be a string list")
    profiles_value = value.get("profiles")
    if not isinstance(profiles_value, list):
        raise LocalPresenterPolicyError("profiles must be a list")
    profiles: list[LocalPresenterProfileBinding] = []
    for index, raw_profile in enumerate(profiles_value):
        if not isinstance(raw_profile, dict):
            raise LocalPresenterPolicyError(f"profiles[{index}] must be an object")
        try:
            profiles.append(
                LocalPresenterProfileBinding(
                    profile_id=_config_string(raw_profile, "profileId"),
                    portrait_artifact_hash=_config_string(raw_profile, "portraitArtifactHash"),
                    consent_id=_optional_config_string(raw_profile, "consentId"),
                    subject_id=_optional_config_string(raw_profile, "subjectId"),
                )
            )
        except ValueError as error:
            raise LocalPresenterPolicyError(f"Invalid profiles[{index}]: {error}") from error
    environment = value.get("environment", {})
    if not isinstance(environment, dict) or not all(
        isinstance(key, str) and isinstance(item, str) for key, item in environment.items()
    ):
        raise LocalPresenterPolicyError("environment must be a string map")
    try:
        runtime = LocalPresenterRuntime(
            runtime_root=runtime_root,
            executable=executable,
            ffprobe=ffprobe,
            argument_template=tuple(arguments),
            model_id=_config_string(value, "modelId"),
            model_revision=_config_string(value, "modelRevision"),
            motion_profile=str(value.get("motionProfile", "lip-sync-only")),
            execution_policy=PresenterExecutionPolicy(_config_string(value, "executionPolicy")),
            network_policy=PresenterNetworkPolicy(_config_string(value, "networkPolicy")),
            unsafe_test_only_acknowledged=value.get("unsafeTestOnlyAcknowledged") is True,
            timeout_seconds=float(value.get("timeoutSeconds", 3_600)),
            probe_timeout_seconds=float(value.get("probeTimeoutSeconds", 30)),
            minimum_output_bytes=int(value.get("minimumOutputBytes", 1_024)),
            maximum_output_bytes=int(value.get("maximumOutputBytes", DEFAULT_MAX_OUTPUT_BYTES)),
            environment=cast(dict[str, str], environment),
            additional_pins=additional,
            encoder_policy=encoder_policy,
            worker_contract=worker_contract,
            gpu_lease=gpu_lease,
        )
    except (TypeError, ValueError) as error:
        raise LocalPresenterPolicyError(f"Invalid local presenter runtime: {error}") from error
    def load_override(override: PresenterRuntimeOverride) -> LocalPresenterMediaClient:
        candidate = override.config_path
        try:
            if candidate.is_symlink():
                raise LocalPresenterRuntimeError(
                    "Selected portrait runtime config must not be a symbolic link"
                )
            selected = candidate.resolve(strict=True)
            selected.relative_to(path.parent.resolve(strict=True))
            if not selected.is_file():
                raise LocalPresenterRuntimeError(
                    "Selected portrait runtime config must be a regular file"
                )
            return load_local_presenter_media_client(
                store,
                base,
                selected,
                runner=runner,
                cancel_check=cancel_check,
                _allow_runtime_overrides=False,
            )
        except LocalPresenterError as error:
            raise LocalPresenterRuntimeError(
                "Could not load the selected portrait runtime; repair or reinstall its "
                f"runtime pack ({candidate.name}): {error}"
            ) from error
        except (OSError, ValueError) as error:
            raise LocalPresenterRuntimeError(
                "Could not load the selected portrait runtime; repair or reinstall its "
                f"runtime pack ({candidate.name})"
            ) from error

    return LocalPresenterMediaClient(
        store,
        base,
        runtime,
        profiles,
        default_profile_id=_config_string(value, "defaultProfileId"),
        runner=runner,
        cancel_check=cancel_check,
        runtime_overrides=runtime_overrides,
        runtime_override_loader=load_override if runtime_overrides else None,
    )


def _config_runtime_overrides(
    value: object, config_root: Path
) -> tuple[PresenterRuntimeOverride, ...]:
    if not isinstance(value, list):
        raise LocalPresenterPolicyError("portraitRuntimeOverrides must be a list")
    root = config_root.resolve(strict=True)
    overrides: list[PresenterRuntimeOverride] = []
    seen: set[str] = set()
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise LocalPresenterPolicyError(
                f"portraitRuntimeOverrides[{index}] must be an object"
            )
        portrait_hash = _config_string(item, "portraitArtifactHash")
        if not SHA256_PATTERN.fullmatch(portrait_hash):
            raise LocalPresenterPolicyError(
                f"portraitRuntimeOverrides[{index}].portraitArtifactHash must be a "
                "lowercase SHA-256 digest"
            )
        if portrait_hash in seen:
            raise LocalPresenterPolicyError(
                "portraitRuntimeOverrides portrait hashes must be unique"
            )
        relative = Path(_config_string(item, "relativeConfigPath"))
        if (
            relative.is_absolute()
            or bool(relative.drive)
            or bool(relative.root)
            or not relative.parts
            or ".." in relative.parts
        ):
            raise LocalPresenterPolicyError(
                f"portraitRuntimeOverrides[{index}].relativeConfigPath must stay inside "
                "the primary config directory"
            )
        candidate = root / relative
        try:
            candidate.resolve(strict=False).relative_to(root)
        except ValueError as error:
            raise LocalPresenterPolicyError(
                f"portraitRuntimeOverrides[{index}].relativeConfigPath escapes the "
                "primary config directory"
            ) from error
        seen.add(portrait_hash)
        overrides.append(PresenterRuntimeOverride(portrait_hash, candidate))
    return tuple(overrides)


def _config_worker_contract(value: object, root: Path) -> PresenterWorkerContract | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise LocalPresenterPolicyError("workerContract must be an object")
    files_value = value.get("files")
    if not isinstance(files_value, list) or not all(isinstance(item, dict) for item in files_value):
        raise LocalPresenterPolicyError("workerContract.files must be a list")
    try:
        return PresenterWorkerContract(
            contract_id=_config_string(value, "contractId"),
            entrypoint=_config_pin(value.get("entrypoint"), root, "workerContract.entrypoint"),
            files=tuple(
                PresenterContractFile(
                    role=_config_string(cast(dict[str, Any], item), "role"),
                    pin=_config_pin(
                        item,
                        root,
                        f"workerContract.files[{index}]",
                    ),
                )
                for index, item in enumerate(files_value)
                if isinstance(item, dict)
            ),
        )
    except ValueError as error:
        raise LocalPresenterPolicyError(f"Invalid workerContract: {error}") from error


def _config_gpu_lease(value: object) -> PresenterGpuLeaseMetadata | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise LocalPresenterPolicyError("gpuLease must be an object")
    try:
        return PresenterGpuLeaseMetadata(
            lease_id=_config_string(value, "leaseId"),
            owner=_config_string(value, "owner"),
            mutex_name=_config_string(value, "mutexName"),
            device_id=_config_string(value, "deviceId"),
            vram_bytes=int(value.get("vramBytes", 0)),
        )
    except (TypeError, ValueError) as error:
        raise LocalPresenterPolicyError(f"Invalid gpuLease: {error}") from error


def _config_encoder_policy(value: object, root: Path) -> PresenterEncoderPolicy | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise LocalPresenterPolicyError("presenterEncoding must be an object")
    if value.get("policy") != "alystria-presenter-h264-v1":
        raise LocalPresenterPolicyError(
            "presenterEncoding.policy must be alystria-presenter-h264-v1"
        )
    ffmpeg = _config_pin(value.get("ffmpeg"), root, "presenterEncoding.ffmpeg")
    gpl_value = value.get("gplX264")
    approval: GplX264Approval | None = None
    if gpl_value is not None:
        if not isinstance(gpl_value, dict):
            raise LocalPresenterPolicyError("presenterEncoding.gplX264 must be an object")
        if gpl_value.get("explicitlyApproved") is not True:
            raise LocalPresenterPolicyError(
                "presenterEncoding.gplX264 requires explicitlyApproved: true"
            )
        try:
            approval = GplX264Approval(
                runtime_pack_id=_config_string(gpl_value, "runtimePackId"),
                consent_id=_config_string(gpl_value, "consentId"),
                license_id=_config_string(gpl_value, "licenseId"),
            )
        except ValueError as error:
            raise LocalPresenterPolicyError(f"Invalid GPL x264 approval: {error}") from error
    try:
        return PresenterEncoderPolicy(
            ffmpeg_path=ffmpeg.path,
            ffmpeg_sha256=ffmpeg.sha256,
            probe_timeout_seconds=float(value.get("probeTimeoutSeconds", 30)),
            gpl_x264_approval=approval,
        )
    except (TypeError, ValueError) as error:
        raise LocalPresenterPolicyError(f"Invalid presenter encoder policy: {error}") from error


def _config_pin(value: object, root: Path, label: str) -> PinnedPresenterFile:
    if not isinstance(value, dict):
        raise LocalPresenterPolicyError(f"{label} must be an object")
    relative = Path(_config_string(value, "relativePath"))
    if relative.is_absolute() or not relative.parts or ".." in relative.parts:
        raise LocalPresenterPolicyError(f"{label}.relativePath must stay inside runtimeRoot")
    path = (root / relative).resolve(strict=False)
    try:
        path.relative_to(root.resolve(strict=False))
        return PinnedPresenterFile(path, _config_string(value, "sha256"))
    except (ValueError, OSError) as error:
        raise LocalPresenterPolicyError(f"{label} escapes runtimeRoot") from error


def _config_path(value: Mapping[str, Any], key: str, *, base: Path, must_exist: bool) -> Path:
    path = Path(_config_string(value, key))
    candidate = path if path.is_absolute() else base / path
    try:
        return candidate.resolve(strict=must_exist)
    except OSError as error:
        raise LocalPresenterPolicyError(f"{key} is unavailable") from error


def _config_string(value: Mapping[str, Any], key: str) -> str:
    item = value.get(key)
    if not isinstance(item, str) or not item.strip() or "\x00" in item:
        raise LocalPresenterPolicyError(f"{key} must be a non-empty string")
    return item


def _optional_config_string(value: Mapping[str, Any], key: str) -> str | None:
    item = value.get(key)
    if item is None:
        return None
    if not isinstance(item, str) or not item.strip() or "\x00" in item:
        raise LocalPresenterPolicyError(f"{key} must be a non-empty string when supplied")
    return item


def _fixed_file_argument(argument: str, root: Path) -> Path | None:
    raw = argument.split("=", 1)[-1]
    candidate = Path(raw)
    if not candidate.is_absolute():
        candidate = root / candidate
    try:
        if not candidate.exists() or not candidate.is_file():
            return None
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(root)
        return resolved
    except (OSError, ValueError):
        return None


def _guarded_child(root: Path, candidate: Path) -> Path:
    resolved_root = root.resolve(strict=False)
    resolved_candidate = candidate.resolve(strict=False)
    try:
        resolved_candidate.relative_to(resolved_root)
    except ValueError as error:
        raise LocalPresenterOutputError(
            f"Presenter staging path escapes guarded root {resolved_root}"
        ) from error
    if resolved_candidate == resolved_root:
        raise LocalPresenterOutputError("Presenter staging path must be below its root")
    return resolved_candidate


def _subprocess_environment_path(path: Path) -> str:
    r"""Spell a verified Windows path without the extended-length prefix.

    Several ML dependencies append POSIX separators to HOME. Windows accepts
    that for normal drive paths but rejects the mixed ``\\?\C:\.../.cache``
    form. Removing the prefix changes only spelling, not the contained target.
    """

    value = str(path)
    if os.name != "nt":
        return value
    if value.startswith("\\\\?\\UNC\\"):
        return "\\\\" + value[8:]
    if value.startswith("\\\\?\\"):
        return value[4:]
    return value


def _safe_name(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_-]+", "-", value).strip("-_")
    return (safe or hashlib.sha256(value.encode()).hexdigest()[:16])[:96]


def _positive_int(value: object, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise LocalPresenterOutputError(f"{label} is invalid")
    return value


def _presenter_stream_duration(value: object, label: str) -> float:
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        raise LocalPresenterOutputError(f"Presenter delivery {label} duration is invalid")
    try:
        duration = float(value)
    except (TypeError, ValueError) as error:
        raise LocalPresenterOutputError(
            f"Presenter delivery {label} duration is invalid"
        ) from error
    if not 0 < duration <= 10_800:
        raise LocalPresenterOutputError(
            f"Presenter delivery {label} duration is outside policy"
        )
    return duration


def _make_read_only(path: Path) -> None:
    try:
        path.chmod(0o444)
    except OSError as error:
        raise LocalPresenterOutputError("Could not protect presenter staging input") from error


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _pin_manifest(pin: PinnedPresenterFile) -> dict[str, str]:
    return {"path": str(pin.path.resolve(strict=True)), "sha256": pin.sha256}


def _write_json_atomic(path: Path, value: Mapping[str, object]) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(
            json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        temporary.replace(path)
    finally:
        with suppress(OSError):
            temporary.unlink(missing_ok=True)


def _read_small_json(path: Path) -> dict[str, object]:
    try:
        info = path.lstat()
        if path.is_symlink() or not path.is_file() or not 0 < info.st_size <= MAX_PROGRESS_BYTES:
            raise LocalPresenterOutputError(f"Unsafe or oversized JSON record: {path.name}")
        value = json.loads(path.read_text(encoding="utf-8"))
    except LocalPresenterError:
        raise
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LocalPresenterOutputError(f"Invalid JSON record: {path.name}") from error
    if not isinstance(value, dict):
        raise LocalPresenterOutputError(f"JSON record must be an object: {path.name}")
    return cast(dict[str, object], value)


def _read_media_file(path: Path, *, minimum_bytes: int, maximum_bytes: int) -> bytes:
    try:
        info = path.lstat()
        if path.is_symlink() or not path.is_file():
            raise LocalPresenterOutputError("Presenter delivery must be a regular non-symlink file")
        if not minimum_bytes <= info.st_size <= maximum_bytes:
            raise LocalPresenterOutputError("Presenter delivery violates configured size limits")
        content = path.read_bytes()
    except LocalPresenterError:
        raise
    except OSError as error:
        raise LocalPresenterOutputError("Presenter delivery could not be read") from error
    if len(content) != info.st_size or detect_mime(content) != "video/mp4":
        raise LocalPresenterOutputError("Presenter delivery is not a stable MP4 container")
    return content


def _bounded_decode(value: bytes) -> str:
    return value[-MAX_PROCESS_OUTPUT_BYTES:].decode("utf-8", errors="replace")


def _stop_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name == "nt":
            # taskkill /T is the stdlib-compatible way to terminate the full
            # descendant tree. CREATE_NEW_PROCESS_GROUP above prevents the
            # presenter from sharing the desktop worker's console group.
            subprocess.run(
                ("taskkill.exe", "/PID", str(process.pid), "/T", "/F"),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                shell=False,
                timeout=5,
                check=False,
                creationflags=int(getattr(subprocess, "CREATE_NO_WINDOW", 0)),
            )
        elif os.name != "nt" and callable(kill_group := getattr(os, "killpg", None)):
            kill_group(process.pid, signal.SIGTERM)
        else:
            process.terminate()
        process.wait(timeout=2)
    except (OSError, ProcessLookupError, subprocess.TimeoutExpired):
        try:
            kill_group = getattr(os, "killpg", None)
            if os.name != "nt" and callable(kill_group):
                kill_group(process.pid, int(getattr(signal, "SIGKILL", signal.SIGTERM)))
            else:
                process.kill()
        except (OSError, ProcessLookupError):
            pass


def _drain_stopped_process(process: subprocess.Popen[bytes]) -> None:
    try:
        process.communicate(timeout=2)
    except subprocess.TimeoutExpired:
        with suppress(OSError, ProcessLookupError):
            process.kill()
        with suppress(subprocess.TimeoutExpired):
            process.communicate(timeout=2)
