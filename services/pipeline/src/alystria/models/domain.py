"""Immutable model manifests and shared runtime domain records."""

from __future__ import annotations

import base64
import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from importlib import import_module
from pathlib import PurePosixPath
from typing import Any, Protocol

from .errors import ManifestError, SignatureError

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_IDENTIFIER_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")


def canonical_json(value: object) -> bytes:
    """Encode data identically across runs for hashes and signatures."""

    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _require_identifier(name: str, value: str) -> None:
    if not _IDENTIFIER_RE.fullmatch(value):
        raise ManifestError(f"{name} must be a lowercase stable identifier: {value!r}")


def _require_sha256(name: str, value: str) -> None:
    if not _SHA256_RE.fullmatch(value):
        raise ManifestError(f"{name} must be a lowercase SHA-256 digest")


class SerializationFormat(StrEnum):
    GGUF = "gguf"
    SAFETENSORS = "safetensors"
    ONNX = "onnx"
    JSON = "json"
    TEXT = "text"
    TOKENIZER = "tokenizer"
    BINARY_DATA = "binary-data"


class Capability(StrEnum):
    LLM = "llm"
    VISION_LANGUAGE = "vision-language"
    EMBEDDING = "embedding"
    RERANKING = "reranking"
    IMAGE_GENERATION = "image-generation"
    TTS = "tts"
    STT = "stt"
    ALIGNMENT = "alignment"
    AVATAR = "avatar"
    LIP_SYNC = "lip-sync"


@dataclass(frozen=True, slots=True)
class ResourceEstimate:
    disk_bytes: int
    ram_bytes: int
    vram_bytes: int = 0
    minimum_cpu_threads: int = 1
    gpu_heavy: bool = False

    def __post_init__(self) -> None:
        if min(self.disk_bytes, self.ram_bytes, self.vram_bytes) < 0:
            raise ManifestError("resource estimates cannot be negative")
        if self.minimum_cpu_threads < 1:
            raise ManifestError("minimum_cpu_threads must be positive")
        if self.gpu_heavy and self.vram_bytes <= 0:
            raise ManifestError("gpu-heavy models must declare a positive VRAM estimate")

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class ArtifactSpec:
    path: str
    size_bytes: int
    sha256: str
    serialization: SerializationFormat
    urls: tuple[str, ...]
    media_type: str = "application/octet-stream"

    def __post_init__(self) -> None:
        relative = PurePosixPath(self.path)
        if relative.is_absolute() or not relative.parts or ".." in relative.parts:
            raise ManifestError(f"artifact path must remain inside its install: {self.path!r}")
        if "\\" in self.path or self.path.startswith("."):
            raise ManifestError(f"artifact path is not canonical POSIX form: {self.path!r}")
        if self.size_bytes <= 0:
            raise ManifestError("artifact size must be positive")
        _require_sha256("artifact.sha256", self.sha256)
        if not self.urls:
            raise ManifestError("an artifact requires at least one immutable download URL")
        if any(not url.startswith("https://") for url in self.urls):
            raise ManifestError("artifact URLs must use HTTPS")

    def to_dict(self) -> dict[str, object]:
        result = asdict(self)
        result["serialization"] = self.serialization.value
        result["urls"] = list(self.urls)
        return result


@dataclass(frozen=True, slots=True)
class SignatureEnvelope:
    key_id: str
    algorithm: str
    signature_base64: str

    def __post_init__(self) -> None:
        _require_identifier("signature.key_id", self.key_id)
        if self.algorithm != "ed25519":
            raise ManifestError("only ed25519 model manifest signatures are supported")
        try:
            signature = base64.b64decode(self.signature_base64, validate=True)
        except ValueError as exc:
            raise ManifestError("signature is not valid base64") from exc
        if len(signature) != 64:
            raise ManifestError("an Ed25519 signature must be exactly 64 bytes")

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class ModelManifest:
    schema_version: int
    model_id: str
    version: str
    immutable_revision: str
    display_name: str
    capabilities: tuple[Capability, ...]
    runtime: str
    license_id: str
    license_url: str
    license_sha256: str
    requires_license_acceptance: bool
    resources: ResourceEstimate
    artifacts: tuple[ArtifactSpec, ...]
    signature: SignatureEnvelope | None = None
    metadata: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.schema_version != 1:
            raise ManifestError(f"unsupported model manifest schema {self.schema_version}")
        _require_identifier("model_id", self.model_id)
        _require_identifier("version", self.version)
        _require_identifier("runtime", self.runtime)
        if not self.immutable_revision.strip():
            raise ManifestError("immutable_revision is required")
        if not self.capabilities:
            raise ManifestError("at least one capability is required")
        if len(set(self.capabilities)) != len(self.capabilities):
            raise ManifestError("capabilities cannot contain duplicates")
        _require_sha256("license_sha256", self.license_sha256)
        if not self.license_url.startswith("https://"):
            raise ManifestError("license_url must use HTTPS")
        if not self.artifacts:
            raise ManifestError("a model manifest requires artifacts")
        paths = [artifact.path for artifact in self.artifacts]
        if len(paths) != len(set(paths)):
            raise ManifestError("artifact paths must be unique")
        if sum(item.size_bytes for item in self.artifacts) > self.resources.disk_bytes:
            raise ManifestError("disk estimate must cover all declared artifacts")

    @property
    def install_key(self) -> str:
        return f"{self.model_id}@{self.version}+{self.immutable_revision}"

    def unsigned_dict(self) -> dict[str, object]:
        return {
            "schema_version": self.schema_version,
            "model_id": self.model_id,
            "version": self.version,
            "immutable_revision": self.immutable_revision,
            "display_name": self.display_name,
            "capabilities": [item.value for item in self.capabilities],
            "runtime": self.runtime,
            "license_id": self.license_id,
            "license_url": self.license_url,
            "license_sha256": self.license_sha256,
            "requires_license_acceptance": self.requires_license_acceptance,
            "resources": self.resources.to_dict(),
            "artifacts": [item.to_dict() for item in self.artifacts],
            "metadata": dict(sorted(self.metadata.items())),
        }

    def to_dict(self) -> dict[str, object]:
        result = self.unsigned_dict()
        result["signature"] = self.signature.to_dict() if self.signature else None
        return result

    @property
    def canonical_payload(self) -> bytes:
        return canonical_json(self.unsigned_dict())

    @property
    def fingerprint(self) -> str:
        return hashlib.sha256(self.canonical_payload).hexdigest()

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> ModelManifest:
        try:
            resources = ResourceEstimate(**value["resources"])
            artifacts = tuple(
                ArtifactSpec(
                    path=item["path"],
                    size_bytes=item["size_bytes"],
                    sha256=item["sha256"],
                    serialization=SerializationFormat(item["serialization"]),
                    urls=tuple(item["urls"]),
                    media_type=item.get("media_type", "application/octet-stream"),
                )
                for item in value["artifacts"]
            )
            signature_value = value.get("signature")
            signature = SignatureEnvelope(**signature_value) if signature_value else None
            return cls(
                schema_version=value["schema_version"],
                model_id=value["model_id"],
                version=value["version"],
                immutable_revision=value["immutable_revision"],
                display_name=value["display_name"],
                capabilities=tuple(Capability(item) for item in value["capabilities"]),
                runtime=value["runtime"],
                license_id=value["license_id"],
                license_url=value["license_url"],
                license_sha256=value["license_sha256"],
                requires_license_acceptance=value["requires_license_acceptance"],
                resources=resources,
                artifacts=artifacts,
                signature=signature,
                metadata=dict(value.get("metadata", {})),
            )
        except (KeyError, TypeError, ValueError) as exc:
            if isinstance(exc, ManifestError):
                raise
            raise ManifestError(f"invalid model manifest: {exc}") from exc


class SignatureVerifier(Protocol):
    def verify(self, payload: bytes, envelope: SignatureEnvelope) -> None: ...


class Ed25519KeyringVerifier:
    """Verify manifests against pinned raw Ed25519 public keys.

    ``cryptography`` is intentionally optional so the local-only pipeline has no
    mandatory third-party dependency. Installations that require signatures must
    include it; otherwise verification fails closed.
    """

    def __init__(self, public_keys: dict[str, bytes]) -> None:
        self._public_keys = dict(public_keys)

    def verify(self, payload: bytes, envelope: SignatureEnvelope) -> None:
        key = self._public_keys.get(envelope.key_id)
        if key is None:
            raise SignatureError(f"untrusted manifest signing key: {envelope.key_id}")
        try:
            exceptions_module = import_module("cryptography.exceptions")
            ed25519_module = import_module(
                "cryptography.hazmat.primitives.asymmetric.ed25519"
            )
        except ImportError as exc:  # pragma: no cover - depends on optional packaging
            raise SignatureError(
                "Ed25519 verification requires the 'cryptography' package"
            ) from exc
        invalid_signature = exceptions_module.InvalidSignature
        public_key_class = ed25519_module.Ed25519PublicKey
        try:
            signature = base64.b64decode(envelope.signature_base64, validate=True)
            public_key_class.from_public_bytes(key).verify(signature, payload)
        except (invalid_signature, ValueError) as exc:
            raise SignatureError("model manifest signature is invalid") from exc


class RecordingSignatureVerifier:
    """Test adapter which still requires a signature envelope."""

    def __init__(self) -> None:
        self.verified_fingerprints: list[str] = []

    def verify(self, payload: bytes, envelope: SignatureEnvelope) -> None:
        del envelope
        self.verified_fingerprints.append(hashlib.sha256(payload).hexdigest())
