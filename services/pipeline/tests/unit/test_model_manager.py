from __future__ import annotations

import base64
import hashlib
from pathlib import Path

import pytest

from alystria.models import (
    ArtifactSpec,
    Capability,
    DownloadError,
    DownloadRequest,
    DownloadResult,
    ExecutionMode,
    HealthState,
    IntegrityError,
    LicenseNotAcceptedError,
    ModelInUseError,
    ModelManager,
    ModelManifest,
    ModelNotInstalledError,
    NetworkDisabledError,
    NetworkPolicy,
    RecordingSignatureVerifier,
    ResourceEstimate,
    SerializationFormat,
    SignatureEnvelope,
    SignatureError,
)
from alystria.models.policy import NetworkPurpose


class FakeDownloader:
    def __init__(self, blobs: dict[str, bytes], *, fail_once_after: int | None = None) -> None:
        self.blobs = blobs
        self.fail_once_after = fail_once_after
        self.calls: list[tuple[str, int]] = []

    def download(self, request: DownloadRequest, progress=None) -> DownloadResult:
        url = request.urls[0]
        request.network_policy.assert_url(url, NetworkPurpose.MODEL_DOWNLOAD)
        blob = self.blobs[url]
        offset = request.destination.stat().st_size if request.destination.exists() else 0
        self.calls.append((url, offset))
        request.destination.parent.mkdir(parents=True, exist_ok=True)
        if self.fail_once_after is not None:
            stop = min(len(blob), offset + self.fail_once_after)
            with request.destination.open("ab") as output:
                output.write(blob[offset:stop])
            self.fail_once_after = None
            raise DownloadError("injected interruption")
        with request.destination.open("ab") as output:
            output.write(blob[offset:])
        if progress:
            progress(len(blob), len(blob))
        return DownloadResult(request.destination, len(blob), offset, url)


def signed_manifest(
    blob: bytes,
    *,
    version: str = "1.0.0",
    revision: str = "rev-a",
) -> ModelManifest:
    return ModelManifest(
        schema_version=1,
        model_id="test-model",
        version=version,
        immutable_revision=revision,
        display_name="Test Model",
        capabilities=(Capability.LLM,),
        runtime="llama-cpp",
        license_id="test-license",
        license_url="https://models.example/license.txt",
        license_sha256="a" * 64,
        requires_license_acceptance=True,
        resources=ResourceEstimate(len(blob) + 256, 1024, 0, 1),
        artifacts=(
            ArtifactSpec(
                path="weights/model.gguf",
                size_bytes=len(blob),
                sha256=hashlib.sha256(blob).hexdigest(),
                serialization=SerializationFormat.GGUF,
                urls=("https://models.example/model.gguf",),
            ),
        ),
        signature=SignatureEnvelope(
            key_id="release-key",
            algorithm="ed25519",
            signature_base64=base64.b64encode(bytes(64)).decode("ascii"),
        ),
    )


def online_policy() -> NetworkPolicy:
    return NetworkPolicy(
        mode=ExecutionMode.HYBRID,
        network_enabled=True,
        approved_hosts=frozenset({"models.example"}),
    )


def manager(tmp_path: Path, downloader: FakeDownloader, active_keys=frozenset) -> ModelManager:
    return ModelManager(
        tmp_path / "models",
        downloader,
        signature_verifier=RecordingSignatureVerifier(),
        active_model_keys=active_keys,
    )


def test_install_is_signed_licensed_atomic_and_idempotent(tmp_path: Path) -> None:
    blob = b"GGUF" + b"model data" * 50
    manifest = signed_manifest(blob)
    fake = FakeDownloader({manifest.artifacts[0].urls[0]: blob})
    runtime = manager(tmp_path, fake)

    with pytest.raises(LicenseNotAcceptedError):
        runtime.install(manifest, network_policy=online_policy())

    acceptance = runtime.accept_license(manifest, accepted_by="local-user")
    installed = runtime.install(manifest, network_policy=online_policy())
    assert acceptance.license_sha256 == manifest.license_sha256
    assert installed.active
    assert (installed.install_path / "weights/model.gguf").read_bytes() == blob
    assert runtime.health("test-model", deep_verify=True).state is HealthState.HEALTHY

    second = runtime.install(manifest, network_policy=online_policy())
    assert second.fingerprint == installed.fingerprint
    assert len(fake.calls) == 1


def test_manifest_round_trip_preserves_immutable_fingerprint() -> None:
    manifest = signed_manifest(b"GGUFcanonical")
    restored = ModelManifest.from_dict(manifest.to_dict())
    assert restored == manifest
    assert restored.fingerprint == manifest.fingerprint


def test_fully_local_mode_blocks_model_downloads_without_partial_files(tmp_path: Path) -> None:
    blob = b"GGUFoffline"
    manifest = signed_manifest(blob)
    fake = FakeDownloader({manifest.artifacts[0].urls[0]: blob})
    runtime = manager(tmp_path, fake)
    runtime.accept_license(manifest, accepted_by="local-user")

    with pytest.raises(NetworkDisabledError):
        runtime.install(manifest, network_policy=NetworkPolicy.fully_local())
    assert list((tmp_path / "models" / "staging").rglob("*.part")) == []


def test_download_resumes_from_staged_partial(tmp_path: Path) -> None:
    blob = b"GGUF" + b"x" * 4096
    manifest = signed_manifest(blob)
    fake = FakeDownloader({manifest.artifacts[0].urls[0]: blob}, fail_once_after=137)
    runtime = manager(tmp_path, fake)
    runtime.accept_license(manifest, accepted_by="local-user")

    with pytest.raises(DownloadError):
        runtime.install(manifest, network_policy=online_policy())
    installed = runtime.install(manifest, network_policy=online_policy())

    assert fake.calls == [(manifest.artifacts[0].urls[0], 0), (manifest.artifacts[0].urls[0], 137)]
    assert (installed.install_path / "weights/model.gguf").read_bytes() == blob


def test_hash_failure_drops_poisoned_partial_for_retry(tmp_path: Path) -> None:
    blob = b"GGUFtrusted"
    manifest = signed_manifest(blob)
    fake = FakeDownloader({manifest.artifacts[0].urls[0]: b"GGUFuntrusted"})
    runtime = manager(tmp_path, fake)
    runtime.accept_license(manifest, accepted_by="local-user")

    with pytest.raises(IntegrityError):
        runtime.install(manifest, network_policy=online_policy())

    partials = list((tmp_path / "models" / "staging").rglob("*.part"))
    assert partials == []


def test_promote_rollback_lease_guard_and_uninstall(tmp_path: Path) -> None:
    blob_v1 = b"GGUFv1"
    blob_v2 = b"GGUFv2"
    first = signed_manifest(blob_v1)
    second = signed_manifest(blob_v2, version="2.0.0", revision="rev-b")
    fake = FakeDownloader({first.artifacts[0].urls[0]: blob_v1})
    leased: set[str] = set()
    runtime = manager(tmp_path, fake, active_keys=lambda: frozenset(leased))
    for manifest in (first, second):
        runtime.accept_license(manifest, accepted_by="local-user")
        fake.blobs[manifest.artifacts[0].urls[0]] = (
            blob_v1 if manifest.version == "1.0.0" else blob_v2
        )
        runtime.install(manifest, network_policy=online_policy())

    restored = runtime.rollback("test-model")
    assert restored.fingerprint == first.fingerprint
    assert runtime.active("test-model").fingerprint == first.fingerprint

    leased.add(second.install_key)
    with pytest.raises(ModelInUseError):
        runtime.uninstall("test-model", second.fingerprint)
    leased.clear()
    runtime.uninstall("test-model", second.fingerprint)
    assert [item.fingerprint for item in runtime.list_installed("test-model")] == [
        first.fingerprint
    ]

    with pytest.raises(ModelInUseError):
        runtime.uninstall("test-model", first.fingerprint)
    runtime.uninstall("test-model", first.fingerprint, force_active=True)
    with pytest.raises(ModelNotInstalledError):
        runtime.active("test-model")


def test_deep_health_detects_post_install_tampering(tmp_path: Path) -> None:
    blob = b"GGUFhealthy"
    manifest = signed_manifest(blob)
    fake = FakeDownloader({manifest.artifacts[0].urls[0]: blob})
    runtime = manager(tmp_path, fake)
    runtime.accept_license(manifest, accepted_by="local-user")
    installed = runtime.install(manifest, network_policy=online_policy())
    (installed.install_path / "weights/model.gguf").write_bytes(b"GGUFbroken!")

    report = runtime.health("test-model", deep_verify=True)
    assert report.state is HealthState.CORRUPT
    assert report.reasons == ("wrong hash: weights/model.gguf",)


def test_signature_policy_fails_closed(tmp_path: Path) -> None:
    blob = b"GGUFunsigned"
    signed = signed_manifest(blob)
    unsigned = ModelManifest.from_dict({**signed.to_dict(), "signature": None})
    runtime = ModelManager(
        tmp_path / "models",
        FakeDownloader({signed.artifacts[0].urls[0]: blob}),
        signature_verifier=None,
    )

    with pytest.raises(SignatureError):
        runtime.accept_license(unsigned, accepted_by="local-user")
