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
import tempfile
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any, Protocol, cast

from alystria.project import ProjectStore
from alystria.security.files import detect_mime

from .adapters import GeneratedMedia, GenerationMediaClient

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
        "PATH",
        "PYTHONIOENCODING",
        "PYTHONPATH",
        "PYTHONUTF8",
        "SYSTEMROOT",
        "TEMP",
        "TMP",
        "WINDIR",
    }
)
PORTRAIT_SUFFIXES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
AUDIO_SUFFIXES = {
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
}


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
            creation_flags = int(getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
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
        while True:
            elapsed = time.monotonic() - started
            if cancelled():
                _stop_process(process)
                process.communicate()
                raise LocalPresenterCancelledError("Presenter generation cancelled")
            if elapsed >= timeout_seconds:
                _stop_process(process)
                process.communicate()
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


@dataclass(frozen=True, slots=True)
class PinnedPresenterFile:
    path: Path
    sha256: str

    def __post_init__(self) -> None:
        if not SHA256_PATTERN.fullmatch(self.sha256):
            raise ValueError("Pinned presenter file SHA-256 must be 64 lowercase hex characters")


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
class LocalPresenterRuntime:
    runtime_root: Path
    executable: PinnedPresenterFile
    ffprobe: PinnedPresenterFile | None
    argument_template: tuple[str, ...]
    model_id: str = "musetalk"
    model_revision: str = "unverified"
    execution_policy: PresenterExecutionPolicy = PresenterExecutionPolicy.MANAGED_VERIFIED
    network_policy: PresenterNetworkPolicy = PresenterNetworkPolicy.SUPERVISOR_DENY
    unsafe_test_only_acknowledged: bool = False
    timeout_seconds: float = 3_600
    probe_timeout_seconds: float = 30
    minimum_output_bytes: int = 1_024
    maximum_output_bytes: int = DEFAULT_MAX_OUTPUT_BYTES
    environment: Mapping[str, str] = field(default_factory=dict)
    additional_pins: tuple[PinnedPresenterFile, ...] = ()

    def __post_init__(self) -> None:
        if not self.model_id.strip() or not self.model_revision.strip():
            raise ValueError("Local presenter model identity cannot be blank")
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
    ) -> None:
        self.store = store
        self.base = base
        self.runtime = runtime
        self.runner = runner or SubprocessPresenterCommandRunner()
        self.cancel_check = cancel_check or (lambda: False)
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

    def cancel(self) -> None:
        self._cancelled.set()

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
        return self._generate(
            scene_id=scene_id,
            profile=profile,
            narration_hash=narration_hash,
            seed=seed,
        )

    def _profile_for_scene(self, scene: Mapping[str, Any]) -> LocalPresenterProfileBinding:
        selected = scene.get("presenterProfileId")
        presenter = scene.get("presenter")
        if selected is None and isinstance(presenter, Mapping):
            selected = presenter.get("profileId")
        profile_id = self.default_profile_id if selected is None else str(selected).strip()
        try:
            return self.profiles[profile_id]
        except KeyError as error:
            raise LocalPresenterPolicyError(
                f"Presenter profile {profile_id!r} is not configured for local generation"
            ) from error

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
        with tempfile.TemporaryDirectory(prefix="attempt-", dir=staging_parent) as temporary:
            attempt_root = _guarded_child(staging_parent, Path(temporary))
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
            self.store.cas.copy_to(profile.portrait_artifact_hash, portrait_path)
            self.store.cas.copy_to(narration_hash, narration_path)
            _make_read_only(portrait_path)
            _make_read_only(narration_path)
            self._validate_staged_input(portrait_path, profile.portrait_artifact_hash, "portrait")
            self._validate_staged_input(narration_path, narration_hash, "narration")
            self._validate_input_magic(portrait_path, str(portrait["mediaType"]), "portrait")
            self._validate_input_magic(narration_path, str(narration["mediaType"]), "narration")

            job_manifest = {
                "schemaVersion": 1,
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
            }
            manifest_path = _guarded_child(attempt_root, attempt_root / "presenter-job.json")
            manifest_path.write_text(
                json.dumps(job_manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                + "\n",
                encoding="utf-8",
                newline="\n",
            )
            argv = self._worker_argv(
                portrait=portrait_path,
                audio=narration_path,
                output=output_path,
                workspace=workspace_root,
                job_manifest=manifest_path,
                seed=seed,
            )
            result = self.runner.run(
                argv,
                cwd=runtime_root,
                environment=self._safe_environment(),
                timeout_seconds=self.runtime.timeout_seconds,
                cancelled=self._is_cancelled,
            )
            if result.exit_code != 0:
                detail = result.stderr.strip() or result.stdout.strip() or "no process output"
                raise LocalPresenterRuntimeError(
                    f"Presenter worker exited with code {result.exit_code}: {detail[-4_096:]}"
                )
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
                        "ffprobe"
                        if self.runtime.ffprobe is not None
                        else "container-signature-only"
                    ),
                    "probe": probe,
                    "seed": seed,
                },
                actual_cost_micros=0,
                usage_units={"seconds": float(probe.get("durationSeconds", 0.0))},
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

    def _verify_runtime(self) -> Path:
        root = self.runtime.runtime_root.resolve(strict=True)
        if not root.is_dir() or self.runtime.runtime_root.is_symlink():
            raise LocalPresenterRuntimeError("Presenter runtime root must be a safe directory")
        for label, pin in (
            ("worker executable", self.runtime.executable),
            ("ffprobe", self.runtime.ffprobe),
            *(("runtime file", pin) for pin in self.runtime.additional_pins),
        ):
            if pin is None:
                continue
            self._verify_pin(pin, root, label)
        if self.runtime.execution_policy is PresenterExecutionPolicy.MANAGED_VERIFIED:
            pin_paths = {
                pin.path.resolve(strict=True)
                for pin in (self.runtime.executable, *self.runtime.additional_pins)
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
            if key.upper() in SAFE_ENVIRONMENT_KEYS
        }
        environment.update(self.runtime.environment)
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
                "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate",
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
        return {
            "verified": True,
            "durationSeconds": duration,
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
) -> LocalPresenterMediaClient:
    """Load the narrow JSON setup record written by the privileged model manager."""

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
    runtime_root = _config_path(value, "runtimeRoot", base=path.parent, must_exist=True)
    executable = _config_pin(value.get("executable"), runtime_root, "executable")
    ffprobe_value = value.get("ffprobe")
    ffprobe = None if ffprobe_value is None else _config_pin(ffprobe_value, runtime_root, "ffprobe")
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
            execution_policy=PresenterExecutionPolicy(_config_string(value, "executionPolicy")),
            network_policy=PresenterNetworkPolicy(_config_string(value, "networkPolicy")),
            unsafe_test_only_acknowledged=value.get("unsafeTestOnlyAcknowledged") is True,
            timeout_seconds=float(value.get("timeoutSeconds", 3_600)),
            probe_timeout_seconds=float(value.get("probeTimeoutSeconds", 30)),
            minimum_output_bytes=int(value.get("minimumOutputBytes", 1_024)),
            maximum_output_bytes=int(value.get("maximumOutputBytes", DEFAULT_MAX_OUTPUT_BYTES)),
            environment=cast(dict[str, str], environment),
            additional_pins=additional,
        )
    except (TypeError, ValueError) as error:
        raise LocalPresenterPolicyError(f"Invalid local presenter runtime: {error}") from error
    return LocalPresenterMediaClient(
        store,
        base,
        runtime,
        profiles,
        default_profile_id=_config_string(value, "defaultProfileId"),
        runner=runner,
        cancel_check=cancel_check,
    )


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


def _safe_name(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_-]+", "-", value).strip("-_")
    return (safe or hashlib.sha256(value.encode()).hexdigest()[:16])[:96]


def _positive_int(value: object, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise LocalPresenterOutputError(f"{label} is invalid")
    return value


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


def _bounded_decode(value: bytes) -> str:
    return value[-MAX_PROCESS_OUTPUT_BYTES:].decode("utf-8", errors="replace")


def _stop_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name == "nt" and hasattr(signal, "CTRL_BREAK_EVENT"):
            process.send_signal(signal.CTRL_BREAK_EVENT)
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
