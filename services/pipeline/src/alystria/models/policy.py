"""Trust and network policies for local model execution."""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from enum import StrEnum
from pathlib import PurePosixPath
from typing import ClassVar
from urllib.parse import urlsplit

from .domain import ArtifactSpec, SerializationFormat
from .errors import NetworkDisabledError, NetworkPolicyError, UnsafeModelError


class ExecutionMode(StrEnum):
    LOCAL = "local"
    HYBRID = "hybrid"
    CLOUD = "cloud"


class NetworkPurpose(StrEnum):
    PROJECT_CONTENT = "project-content"
    MODEL_DOWNLOAD = "model-download"
    PROVIDER_METADATA = "provider-metadata"
    LOOPBACK_RUNTIME = "loopback-runtime"


@dataclass(frozen=True, slots=True)
class NetworkPolicy:
    """A deny-by-default egress policy carried through provider/runtime calls."""

    mode: ExecutionMode
    network_enabled: bool
    approved_hosts: frozenset[str] = frozenset()
    allow_loopback_runtime: bool = True

    @classmethod
    def fully_local(cls, *, allow_loopback_runtime: bool = True) -> NetworkPolicy:
        return cls(
            mode=ExecutionMode.LOCAL,
            network_enabled=False,
            allow_loopback_runtime=allow_loopback_runtime,
        )

    def assert_url(self, url: str, purpose: NetworkPurpose) -> None:
        parsed = urlsplit(url)
        hostname = (parsed.hostname or "").lower().rstrip(".")
        if not hostname:
            raise NetworkPolicyError("URL has no host")

        is_loopback = _is_loopback(hostname)
        if purpose is NetworkPurpose.LOOPBACK_RUNTIME:
            if not self.allow_loopback_runtime or not is_loopback:
                raise NetworkPolicyError("local runtimes must use an approved loopback address")
            if parsed.scheme not in {"http", "https"}:
                raise NetworkPolicyError("local runtime URL must use HTTP(S)")
            return

        if not self.network_enabled:
            raise NetworkDisabledError(
                f"{purpose.value} networking is disabled in {self.mode.value} mode"
            )
        if parsed.scheme != "https":
            raise NetworkPolicyError("remote model/provider traffic must use HTTPS")
        if is_loopback or _is_non_public_address(hostname):
            raise NetworkPolicyError("remote traffic cannot target local or private addresses")
        if hostname not in self.approved_hosts:
            raise NetworkPolicyError(f"host is not explicitly approved: {hostname}")

    def assert_project_content_egress(self, url: str) -> None:
        if self.mode is ExecutionMode.LOCAL:
            raise NetworkDisabledError("project content cannot leave Fully Local mode")
        self.assert_url(url, NetworkPurpose.PROJECT_CONTENT)


def _is_loopback(hostname: str) -> bool:
    if hostname == "localhost":
        return True
    try:
        return ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        return False


def _is_non_public_address(hostname: str) -> bool:
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return False
    return not address.is_global


@dataclass(frozen=True, slots=True)
class ModelTrustPolicy:
    """Prevent model packages from smuggling executable Python/pickle payloads."""

    allow_native_runtime_binaries: bool = False
    allow_remote_code: bool = False

    _EXTENSIONS: ClassVar[dict[SerializationFormat, frozenset[str]]] = {
        SerializationFormat.GGUF: frozenset({".gguf"}),
        SerializationFormat.SAFETENSORS: frozenset({".safetensors"}),
        SerializationFormat.ONNX: frozenset({".onnx"}),
        SerializationFormat.JSON: frozenset({".json"}),
        SerializationFormat.TEXT: frozenset({".txt", ".md", ".vocab", ".merges"}),
        SerializationFormat.TOKENIZER: frozenset(
            {".json", ".model", ".txt", ".vocab", ".merges"}
        ),
        SerializationFormat.BINARY_DATA: frozenset({".bin", ".dat", ".npy", ".npz"}),
    }
    _ALWAYS_REJECTED: ClassVar[frozenset[str]] = frozenset(
        {
            ".pkl",
            ".pickle",
            ".pt",
            ".pth",
            ".ckpt",
            ".py",
            ".pyc",
            ".js",
            ".mjs",
            ".cjs",
            ".exe",
            ".dll",
            ".so",
            ".dylib",
            ".bat",
            ".cmd",
            ".ps1",
            ".sh",
        }
    )

    def validate_artifact(self, artifact: ArtifactSpec) -> None:
        suffix = PurePosixPath(artifact.path).suffix.lower()
        if suffix in self._ALWAYS_REJECTED:
            raise UnsafeModelError(
                f"executable or pickle-capable artifact rejected: {artifact.path}"
            )
        allowed = self._EXTENSIONS[artifact.serialization]
        if suffix not in allowed:
            raise UnsafeModelError(
                f"{artifact.path} does not match declared format {artifact.serialization.value}"
            )
        if self.allow_remote_code:
            raise UnsafeModelError("trust_remote_code is unsupported by Alystria model installs")

    def runtime_environment(self) -> dict[str, str]:
        """Environment flags adapters must honor when loading third-party model data."""

        return {
            "ALYSTRIA_TRUST_REMOTE_CODE": "0",
            "HF_HUB_DISABLE_TELEMETRY": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "HF_DATASETS_OFFLINE": "1",
        }
