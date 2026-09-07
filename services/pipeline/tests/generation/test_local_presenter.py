from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from alystria.audio import WavFixtureSpec, generate_sine_wav
from alystria.generation import (
    DeterministicMediaClient,
    GenerationCoordinator,
    GenerationRequest,
    GenerationStage,
    GenerationState,
    SourceSpec,
)
from alystria.generation.local_presenter import (
    LocalPresenterCancelledError,
    LocalPresenterMediaClient,
    LocalPresenterOutputError,
    LocalPresenterPolicyError,
    LocalPresenterProcessSurvivedError,
    LocalPresenterProfileBinding,
    LocalPresenterRuntime,
    LocalPresenterRuntimeError,
    PinnedPresenterFile,
    PresenterContractFile,
    PresenterEncoderPolicy,
    PresenterExecutionPolicy,
    PresenterGpuLeaseMetadata,
    PresenterNetworkPolicy,
    PresenterProcessResult,
    PresenterWorkerContract,
    SubprocessPresenterCommandRunner,
    _subprocess_environment_path,
    load_local_presenter_media_client,
)
from alystria.project import ProjectStore


@pytest.fixture(autouse=True)
def _configured_gpu_marker(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    marker = tmp_path / "gpu use.txt"
    marker.write_text("no\n", encoding="utf-8")
    monkeypatch.setenv("ALYSTRIA_GPU_LOCK_PATH", str(marker))


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _mp4() -> bytes:
    return b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2avc1mp41" + bytes(256)


@dataclass
class FakePresenterRunner:
    worker: Path
    ffprobe: Path | None
    mutate_portrait: bool = False
    invalid_probe: bool = False
    mismatched_stream_durations: bool = False
    worker_exit_code: int = 0
    gpu_marker: Path | None = None
    cancel_during_worker: bool = False
    process_survives: bool = False

    def __post_init__(self) -> None:
        self.calls: list[tuple[str, ...]] = []

    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        environment: Mapping[str, str],
        timeout_seconds: float,
        cancelled: Callable[[], bool],
    ) -> PresenterProcessResult:
        del cwd, timeout_seconds
        assert environment["PYTHONUTF8"] == "1"
        assert environment["PYTHONIOENCODING"] == "utf-8"
        assert not cancelled()
        call = tuple(argv)
        self.calls.append(call)
        if self.gpu_marker is not None and Path(call[0]) != self.worker.resolve():
            assert self.gpu_marker.read_text(encoding="utf-8") == "no\n"
        if Path(call[0]) == self.worker.resolve():
            if self.gpu_marker is not None:
                assert self.gpu_marker.read_text(encoding="utf-8") == "yes\n"
            if self.cancel_during_worker:
                raise LocalPresenterCancelledError("Presenter generation cancelled")
            if self.process_survives:
                raise LocalPresenterProcessSurvivedError(
                    "Presenter failure could not confirm the GPU process stopped"
                )
            portrait = Path(call[call.index("--portrait") + 1])
            output = Path(call[call.index("--output") + 1])
            if "--job" in call:
                manifest = Path(call[call.index("--job") + 1])
                job = json.loads(manifest.read_text(encoding="utf-8"))
                assert job["schemaVersion"] == 2
                assert Path(job["inputs"]["portrait"]["path"]) == portrait
                assert Path(job["output"]["path"]) == output
                if "workerContract" in job:
                    assert job["workerContract"]["contractId"] == "alystria.musetalk.worker.v1"
                    assert job["gpuLease"]["leaseId"] == "test-lease"
                progress = Path(job["progress"]["path"])
                progress.write_text(
                    "\n".join(
                        (
                            json.dumps(
                                {
                                    "schemaVersion": 1,
                                    "sequence": 1,
                                    "stage": "accepted",
                                    "progress": 0.0,
                                    "message": "accepted",
                                }
                            ),
                            json.dumps(
                                {
                                    "schemaVersion": 1,
                                    "sequence": 2,
                                    "stage": "complete",
                                    "progress": 1.0,
                                    "message": "complete",
                                }
                            ),
                        )
                    )
                    + "\n",
                    encoding="utf-8",
                )
                if "encoding" in job:
                    assert job["encoding"]["policy"] == "alystria-presenter-h264-v1"
                    assert job["encoding"]["encoder"] == "h264_nvenc"
            if self.mutate_portrait:
                portrait.chmod(0o666)
                portrait.write_bytes(b"changed")
            output.write_bytes(_mp4())
            return PresenterProcessResult(self.worker_exit_code, "worker complete", "")
        if "lavfi" in call:
            return PresenterProcessResult(0, "", "")
        assert self.ffprobe is not None and Path(call[0]) == self.ffprobe.resolve()
        if self.invalid_probe:
            return PresenterProcessResult(0, json.dumps({"streams": []}), "")
        return PresenterProcessResult(
            0,
            json.dumps(
                {
                    "streams": [
                        {
                            "codec_type": "video",
                            "codec_name": "h264",
                            "width": 768,
                            "height": 768,
                            "r_frame_rate": "25/1",
                            "duration": (
                                "1.000000"
                                if self.mismatched_stream_durations
                                else "2.500000"
                            ),
                        },
                        {
                            "codec_type": "audio",
                            "codec_name": "aac",
                            "sample_rate": "48000",
                            "channels": 2,
                            "duration": (
                                "4.000000"
                                if self.mismatched_stream_durations
                                else "2.500000"
                            ),
                        },
                    ],
                    "format": {"duration": "2.500000"},
                }
            ),
            "",
        )


def _runtime(root: Path, *, managed: bool = True) -> tuple[LocalPresenterRuntime, Path, Path]:
    root.mkdir()
    worker = root / "presenter-worker.exe"
    ffprobe = root / "ffprobe.exe"
    ffmpeg = root / "ffmpeg.exe"
    adapter = root / "musetalk-adapter.py"
    config = root / "musetalk.json"
    weights = root / "musetalk.pth"
    worker.write_bytes(b"pinned presenter worker")
    ffprobe.write_bytes(b"pinned ffprobe")
    ffmpeg.write_bytes(b"pinned LGPL ffmpeg")
    adapter.write_bytes(b"pinned adapter")
    config.write_bytes(b"{}")
    weights.write_bytes(b"exact legacy MuseTalk weights")
    extra_contract_paths = {
        role: root / f"{role}.bin"
        for role in (
            "audio-feature-config",
            "audio-feature-preprocessor",
            "audio-feature-weights",
            "face-detection-weights",
            "face-landmark-weights",
            "face-parse-weights",
            "face-resnet-weights",
            "musetalk-inference-entrypoint",
            "runtime-source-manifest",
            "vae-config",
            "vae-weights",
        )
    }
    for role, path in extra_contract_paths.items():
        path.write_bytes(f"exact {role}".encode())
    runtime = LocalPresenterRuntime(
        runtime_root=root,
        executable=PinnedPresenterFile(worker, _digest(worker)),
        ffprobe=PinnedPresenterFile(ffprobe, _digest(ffprobe)) if managed else None,
        argument_template=(
            "--portrait",
            "{portrait}",
            "--audio",
            "{audio}",
            "--output",
            "{output}",
            "--workspace",
            "{workspace}",
            "--job",
            "{job_manifest}",
            "--seed",
            "{seed}",
        ),
        model_id="musetalk",
        model_revision="musetalk-1.5-pinned",
        execution_policy=(
            PresenterExecutionPolicy.MANAGED_VERIFIED
            if managed
            else PresenterExecutionPolicy.UNSAFE_TEST_ONLY
        ),
        network_policy=(
            PresenterNetworkPolicy.SUPERVISOR_DENY
            if managed
            else PresenterNetworkPolicy.NOT_ENFORCED
        ),
        unsafe_test_only_acknowledged=not managed,
        minimum_output_bytes=32,
        encoder_policy=(PresenterEncoderPolicy(ffmpeg, _digest(ffmpeg)) if managed else None),
        worker_contract=(
            PresenterWorkerContract(
                "alystria.musetalk.worker.v1",
                PinnedPresenterFile(worker, _digest(worker)),
                (
                    PresenterContractFile(
                        "adapter-entrypoint", PinnedPresenterFile(adapter, _digest(adapter))
                    ),
                    PresenterContractFile(
                        "musetalk-config", PinnedPresenterFile(config, _digest(config))
                    ),
                    PresenterContractFile(
                        "musetalk-weights", PinnedPresenterFile(weights, _digest(weights))
                    ),
                    *(
                        PresenterContractFile(role, PinnedPresenterFile(path, _digest(path)))
                        for role, path in extra_contract_paths.items()
                    ),
                ),
            )
            if managed
            else None
        ),
        gpu_lease=(
            PresenterGpuLeaseMetadata(
                "test-lease", "pytest", "global\\alystria-test-gpu", "cuda:0", 4 * 1024**3
            )
            if managed
            else None
        ),
    )
    return runtime, worker, ffprobe


def _store_with_inputs(tmp_path: Path) -> tuple[ProjectStore, str, str]:
    store = ProjectStore.create(tmp_path / "Presenter Project", name="Presenter Project")
    portrait = store.add_artifact_bytes(
        b"\x89PNG\r\n\x1a\n" + bytes(128),
        media_type="image/png",
        original_name="presenter.png",
        metadata={"rightsStatus": "owned"},
    )
    narration = store.add_artifact_bytes(
        generate_sine_wav(WavFixtureSpec(duration_ms=500, frequency_hz=220)),
        media_type="audio/wav",
        original_name="narration.wav",
        metadata={"rightsStatus": "owned"},
    )
    return store, portrait.hash, narration.hash


def _client(
    store: ProjectStore,
    runtime: LocalPresenterRuntime,
    portrait_hash: str,
    runner: FakePresenterRunner,
) -> LocalPresenterMediaClient:
    return LocalPresenterMediaClient(
        store,
        DeterministicMediaClient(),
        runtime,
        (
            LocalPresenterProfileBinding(
                "presenter.ada",
                portrait_hash,
                consent_id="consent.ada",
                subject_id="subject.ada",
            ),
        ),
        default_profile_id="presenter.ada",
        runner=runner,
    )


def test_presenter_environment_uses_project_contained_home_roots(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, portrait_hash, _ = _store_with_inputs(tmp_path)
    runtime, worker, ffprobe = _runtime(tmp_path / "runtime")
    runner = FakePresenterRunner(worker, ffprobe)
    monkeypatch.setenv("HOME", str(tmp_path / "host-home"))
    monkeypatch.setenv("USERPROFILE", str(tmp_path / "host-profile"))
    monkeypatch.setenv("NVIDIA_API_KEY", "must-not-cross-presenter-boundary")
    try:
        environment = _client(store, runtime, portrait_hash, runner)._safe_environment()
        expected_home = store.root / "staging" / "presenter" / "runtime-home"
        assert environment["HOME"] == str(expected_home)
        assert environment["USERPROFILE"] == str(expected_home)
        assert expected_home.is_dir()
        assert "NVIDIA_API_KEY" not in environment
    finally:
        store.close()


@pytest.mark.skipif(os.name != "nt", reason="Windows extended paths are platform-specific")
def test_presenter_environment_path_normalizes_windows_extended_prefixes() -> None:
    assert _subprocess_environment_path(Path(r"\\?\C:\sandbox\home")) == r"C:\sandbox\home"
    assert (
        _subprocess_environment_path(Path(r"\\?\UNC\server\share\home")) == r"\\server\share\home"
    )


def test_managed_worker_returns_ffprobe_validated_video_generated_media(tmp_path: Path) -> None:
    store, portrait_hash, narration_hash = _store_with_inputs(tmp_path)
    runtime, worker, ffprobe = _runtime(tmp_path / "runtime")
    gpu_marker = Path(os.environ["ALYSTRIA_GPU_LOCK_PATH"])
    runner = FakePresenterRunner(worker, ffprobe, gpu_marker=gpu_marker)
    try:
        media = _client(store, runtime, portrait_hash, runner).create_presenter(
            {"id": "scene/unsafe name", "presenterProfileId": "presenter.ada"},
            narration_hash=narration_hash,
            seed=42,
        )
        assert media.media_type == "video/mp4"
        assert media.original_name == "scene-unsafe-name.presenter.mp4"
        assert media.provider_id == "local-presenter"
        assert media.content == _mp4()
        assert media.actual_cost_micros == 0
        assert media.usage_units == {"seconds": 2.5}
        assert media.metadata["executionPolicy"] == "managed-verified"
        assert media.metadata["motionProfile"] == "lip-sync-only"
        assert media.metadata["networkPolicy"] == "supervisor-deny"
        assert media.metadata["unsafeTestOnly"] is False
        assert media.metadata["validationLevel"] == "ffprobe"
        assert media.metadata["probe"] == {
            "verified": True,
            "durationSeconds": 2.5,
            "videoDurationSeconds": 2.5,
            "audioDurationSeconds": [2.5],
            "avDurationDeltaSeconds": 0.0,
            "width": 768,
            "height": 768,
            "frameRate": "25/1",
            "videoCodec": "h264",
            "audioCodecs": ["aac"],
        }
        assert len(runner.calls) == 3
        assert "lavfi" in runner.calls[0]
        assert all("scene/unsafe name" not in item for call in runner.calls for item in call)
        assert gpu_marker.read_text(encoding="utf-8") == "no\n"
    finally:
        store.close()


def test_managed_worker_rejects_mismatched_audio_and_video_durations(tmp_path: Path) -> None:
    store, portrait_hash, narration_hash = _store_with_inputs(tmp_path)
    runtime, worker, ffprobe = _runtime(tmp_path / "runtime")
    runner = FakePresenterRunner(worker, ffprobe, mismatched_stream_durations=True)
    try:
        with pytest.raises(
            LocalPresenterOutputError,
            match="audio and video stream durations disagree",
        ):
            _client(store, runtime, portrait_hash, runner).create_presenter(
                {"id": "scene-1"}, narration_hash=narration_hash, seed=42
            )
    finally:
        store.close()


def test_managed_worker_accepts_magic_validated_mp3_narration(tmp_path: Path) -> None:
    store, portrait_hash, _ = _store_with_inputs(tmp_path)
    narration = store.add_artifact_bytes(
        b"ID3\x04\x00\x00\x00\x00\x00\x00" + bytes(128),
        media_type="audio/mpeg",
        original_name="narration.mp3",
        metadata={"rightsStatus": "owned"},
    )
    runtime, worker, ffprobe = _runtime(tmp_path / "runtime")
    runner = FakePresenterRunner(worker, ffprobe)
    try:
        media = _client(store, runtime, portrait_hash, runner).create_presenter(
            {"id": "scene-1"}, narration_hash=narration.hash, seed=42
        )
        worker_call = next(call for call in runner.calls if Path(call[0]) == worker.resolve())
        staged_audio = Path(worker_call[worker_call.index("--audio") + 1])
        assert staged_audio.suffix == ".mp3"
        assert media.media_type == "video/mp4"
    finally:
        store.close()


def test_worker_cannot_modify_immutable_cas_inputs(tmp_path: Path) -> None:
    store, portrait_hash, narration_hash = _store_with_inputs(tmp_path)
    runtime, worker, ffprobe = _runtime(tmp_path / "runtime")
    runner = FakePresenterRunner(worker, ffprobe, mutate_portrait=True)
    try:
        with pytest.raises(LocalPresenterOutputError, match="modified immutable portrait"):
            _client(store, runtime, portrait_hash, runner).create_presenter(
                {"id": "scene-1"}, narration_hash=narration_hash, seed=1
            )
        assert store.cas.verify(portrait_hash)
        assert len(runner.calls) == 2
    finally:
        store.close()


def test_managed_policy_rejects_unverified_or_incomplete_runtime(tmp_path: Path) -> None:
    root = tmp_path / "runtime"
    root.mkdir()
    worker = root / "python.exe"
    worker.write_bytes(b"python")
    pin = PinnedPresenterFile(worker, _digest(worker))
    with pytest.raises(ValueError, match="requires a pinned ffprobe"):
        LocalPresenterRuntime(
            root,
            pin,
            None,
            ("--portrait", "{portrait}", "--audio", "{audio}", "--output", "{output}"),
        )
    with pytest.raises(ValueError, match="pinned entrypoint"):
        LocalPresenterRuntime(
            root,
            pin,
            pin,
            ("-m", "musetalk", "{portrait}", "{audio}", "{output}"),
        )
    with pytest.raises(ValueError, match="explicit acknowledgement"):
        LocalPresenterRuntime(
            root,
            pin,
            None,
            ("{portrait}", "{audio}", "{output}"),
            execution_policy=PresenterExecutionPolicy.UNSAFE_TEST_ONLY,
            network_policy=PresenterNetworkPolicy.NOT_ENFORCED,
        )
    with pytest.raises(ValueError, match=r"explicitly probed H\.264 encoder policy"):
        LocalPresenterRuntime(
            root,
            pin,
            pin,
            ("{portrait}", "{audio}", "{output}", "{job_manifest}"),
            model_id="musetalk",
        )


def test_unsafe_test_only_mode_is_visible_in_generated_metadata(tmp_path: Path) -> None:
    store, portrait_hash, narration_hash = _store_with_inputs(tmp_path)
    runtime, worker, _ = _runtime(tmp_path / "runtime", managed=False)
    runner = FakePresenterRunner(worker, None)
    try:
        media = _client(store, runtime, portrait_hash, runner).create_presenter(
            {"id": "scene-1"}, narration_hash=narration_hash, seed=7
        )
        assert media.metadata["executionPolicy"] == "unsafe-test-only"
        assert media.metadata["networkPolicy"] == "not-enforced"
        assert media.metadata["unsafeTestOnly"] is True
        assert media.metadata["validationLevel"] == "container-signature-only"
        assert media.metadata["probe"]["verified"] is False
        assert len(runner.calls) == 1
    finally:
        store.close()


def test_invalid_probe_and_unregistered_inputs_fail_closed(tmp_path: Path) -> None:
    store, portrait_hash, narration_hash = _store_with_inputs(tmp_path)
    runtime, worker, ffprobe = _runtime(tmp_path / "runtime")
    try:
        with pytest.raises(LocalPresenterOutputError, match="requires one video stream"):
            _client(
                store,
                runtime,
                portrait_hash,
                FakePresenterRunner(worker, ffprobe, invalid_probe=True),
            ).create_presenter({"id": "scene-1"}, narration_hash=narration_hash, seed=1)
        with pytest.raises(LocalPresenterPolicyError, match="Narration input"):
            _client(
                store, runtime, portrait_hash, FakePresenterRunner(worker, ffprobe)
            ).create_presenter({"id": "scene-1"}, narration_hash="not-a-hash", seed=1)
    finally:
        store.close()


def test_json_config_loader_preserves_explicit_unsafe_policy(tmp_path: Path) -> None:
    store, portrait_hash, narration_hash = _store_with_inputs(tmp_path)
    runtime_root = tmp_path / "runtime"
    runtime_root.mkdir()
    worker = runtime_root / "worker.exe"
    worker.write_bytes(b"worker")
    config = tmp_path / "presenter.json"
    config.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "runtimeRoot": str(runtime_root),
                "executable": {
                    "relativePath": "worker.exe",
                    "sha256": _digest(worker),
                },
                "argumentTemplate": [
                    "--portrait",
                    "{portrait}",
                    "--audio",
                    "{audio}",
                    "--output",
                    "{output}",
                ],
                "modelId": "musetalk",
                "modelRevision": "local-test",
                "motionProfile": "native-idle",
                "executionPolicy": "unsafe-test-only",
                "networkPolicy": "not-enforced",
                "unsafeTestOnlyAcknowledged": True,
                "minimumOutputBytes": 32,
                "profiles": [
                    {
                        "profileId": "default",
                        "portraitArtifactHash": portrait_hash,
                    }
                ],
                "defaultProfileId": "default",
            }
        ),
        encoding="utf-8",
    )
    runner = FakePresenterRunner(worker, None)
    try:
        media = load_local_presenter_media_client(
            store, DeterministicMediaClient(), config, runner=runner
        ).create_presenter({"id": "scene-1"}, narration_hash=narration_hash, seed=3)
        assert media.metadata["unsafeTestOnly"] is True
        assert media.metadata["motionProfile"] == "native-idle"
    finally:
        store.close()


def test_managed_musetalk_config_loads_brokered_encoder_policy(tmp_path: Path) -> None:
    store, portrait_hash, narration_hash = _store_with_inputs(tmp_path)
    runtime_root = tmp_path / "runtime"
    runtime_root.mkdir()
    worker = runtime_root / "worker.exe"
    ffprobe = runtime_root / "ffprobe.exe"
    ffmpeg = runtime_root / "ffmpeg.exe"
    adapter = runtime_root / "musetalk-adapter.py"
    model_config = runtime_root / "musetalk.json"
    model_weights = runtime_root / "musetalk.pth"
    worker.write_bytes(b"worker")
    ffprobe.write_bytes(b"ffprobe")
    ffmpeg.write_bytes(b"LGPL ffmpeg")
    adapter.write_bytes(b"adapter")
    model_config.write_bytes(b"{}")
    model_weights.write_bytes(b"exact weights")
    extra_contract_paths = {
        role: runtime_root / f"{role}.bin"
        for role in (
            "audio-feature-config",
            "audio-feature-preprocessor",
            "audio-feature-weights",
            "face-detection-weights",
            "face-landmark-weights",
            "face-parse-weights",
            "face-resnet-weights",
            "musetalk-inference-entrypoint",
            "runtime-source-manifest",
            "vae-config",
            "vae-weights",
        )
    }
    for role, contract_path in extra_contract_paths.items():
        contract_path.write_bytes(f"exact {role}".encode())
    config = tmp_path / "presenter-managed.json"
    config.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "runtimeRoot": str(runtime_root),
                "executable": {"relativePath": worker.name, "sha256": _digest(worker)},
                "ffprobe": {"relativePath": ffprobe.name, "sha256": _digest(ffprobe)},
                "presenterEncoding": {
                    "policy": "alystria-presenter-h264-v1",
                    "ffmpeg": {"relativePath": ffmpeg.name, "sha256": _digest(ffmpeg)},
                    "probeTimeoutSeconds": 10,
                    "gplX264": None,
                },
                "workerContract": {
                    "contractId": "alystria.musetalk.worker.v1",
                    "entrypoint": {
                        "relativePath": worker.name,
                        "sha256": _digest(worker),
                    },
                    "files": [
                        {
                            "role": "adapter-entrypoint",
                            "relativePath": adapter.name,
                            "sha256": _digest(adapter),
                        },
                        {
                            "role": "musetalk-config",
                            "relativePath": model_config.name,
                            "sha256": _digest(model_config),
                        },
                        {
                            "role": "musetalk-weights",
                            "relativePath": model_weights.name,
                            "sha256": _digest(model_weights),
                        },
                        *(
                            {
                                "role": role,
                                "relativePath": contract_path.name,
                                "sha256": _digest(contract_path),
                            }
                            for role, contract_path in extra_contract_paths.items()
                        ),
                    ],
                },
                "gpuLease": {
                    "leaseId": "test-lease",
                    "owner": "pytest",
                    "mutexName": "global\\alystria-test-gpu",
                    "deviceId": "cuda:0",
                    "vramBytes": 4294967296,
                },
                "argumentTemplate": [
                    "--portrait",
                    "{portrait}",
                    "--audio",
                    "{audio}",
                    "--output",
                    "{output}",
                    "--job",
                    "{job_manifest}",
                ],
                "modelId": "musetalk",
                "modelRevision": "musetalk-1.5-pinned",
                "executionPolicy": "managed-verified",
                "networkPolicy": "supervisor-deny",
                "minimumOutputBytes": 32,
                "profiles": [{"profileId": "default", "portraitArtifactHash": portrait_hash}],
                "defaultProfileId": "default",
            }
        ),
        encoding="utf-8",
    )
    runner = FakePresenterRunner(worker, ffprobe)
    try:
        media = load_local_presenter_media_client(
            store, DeterministicMediaClient(), config, runner=runner
        ).create_presenter({"id": "scene-1"}, narration_hash=narration_hash, seed=3)
        assert media.metadata["encoderSelection"]["encoder"] == "h264_nvenc"
        assert media.metadata["encoderSelection"]["fallbackOccurred"] is False
        assert Path(runner.calls[0][0]) == ffmpeg.resolve()
    finally:
        store.close()


def test_real_video_generated_media_is_accepted_by_durable_workflow(tmp_path: Path) -> None:
    store = ProjectStore.create(tmp_path / "Tutorial Project", name="Tutorial Project")
    portrait = store.add_artifact_bytes(
        b"\x89PNG\r\n\x1a\n" + bytes(128),
        media_type="image/png",
        original_name="presenter.png",
        metadata={"rightsStatus": "owned"},
    )
    runtime, worker, ffprobe = _runtime(tmp_path / "runtime")
    client = _client(store, runtime, portrait.hash, FakePresenterRunner(worker, ffprobe))
    request = GenerationRequest(
        topic="Binary search invariants",
        audience="Beginning computer-science learners",
        duration_seconds=60,
        sources=(
            SourceSpec(
                "source.binary-search",
                "Binary search note",
                "Binary search halves a sorted search interval while preserving the target invariant.",
                license_id="CC0-1.0",
                creator="Fixture authors",
            ),
        ),
        presenter_mode="auto",
        deterministic_seed=17,
    )
    coordinator = GenerationCoordinator(store, media_client=client)
    try:
        generation_id = coordinator.start(request).generation_id
        waiting = coordinator.run_pending()
        assert waiting is not None and waiting.state is GenerationState.WAITING_APPROVAL
        coordinator.approve(generation_id)
        completed = coordinator.run_pending()
        assert completed is not None and completed.state is GenerationState.SUCCEEDED
        presenter_stage = next(
            stage for stage in completed.stages if stage.stage is GenerationStage.PRESENTER
        )
        job = coordinator.runtime.get_job(presenter_stage.job_id)
        assert job.result is not None
        presenters = job.result["payload"]["presenters"]
        assert len(presenters) == 1
        artifact_hash = presenters[0]["artifactHash"]
        row = store.connection.execute(
            "SELECT media_type,metadata_json FROM artifacts WHERE hash=?", (artifact_hash,)
        ).fetchone()
        assert row is not None and row["media_type"] == "video/mp4"
        metadata: dict[str, Any] = json.loads(row["metadata_json"])
        assert metadata["validationLevel"] == "ffprobe"
        assert metadata["unsafeTestOnly"] is False
        assert store.cas.verify(artifact_hash)
    finally:
        store.close()


def test_exact_hash_worker_contract_rejects_changed_model_file(tmp_path: Path) -> None:
    store, portrait_hash, narration_hash = _store_with_inputs(tmp_path)
    runtime, worker, ffprobe = _runtime(tmp_path / "runtime")
    contract = runtime.worker_contract
    assert contract is not None
    weights = next(item.pin.path for item in contract.files if item.role == "musetalk-weights")
    weights.write_bytes(b"tampered")
    try:
        with pytest.raises(LocalPresenterRuntimeError, match="SHA-256 changed"):
            _client(
                store, runtime, portrait_hash, FakePresenterRunner(worker, ffprobe)
            ).create_presenter({"id": "scene-1"}, narration_hash=narration_hash, seed=1)
    finally:
        store.close()


def test_promoted_delivery_is_recovered_without_rerunning_worker(tmp_path: Path) -> None:
    store, portrait_hash, narration_hash = _store_with_inputs(tmp_path)
    runtime, worker, ffprobe = _runtime(tmp_path / "runtime")
    runner = FakePresenterRunner(worker, ffprobe)
    client = _client(store, runtime, portrait_hash, runner)
    try:
        first = client.create_presenter({"id": "scene-1"}, narration_hash=narration_hash, seed=9)
        gpu_marker = Path(os.environ["ALYSTRIA_GPU_LOCK_PATH"])
        gpu_marker.write_text("yes\n", encoding="utf-8")
        second = client.create_presenter({"id": "scene-1"}, narration_hash=narration_hash, seed=9)
        worker_calls = [call for call in runner.calls if Path(call[0]) == worker.resolve()]
        assert len(worker_calls) == 1
        assert first.content == second.content
        assert second.metadata["recoveredFromPromotion"] is True
        assert gpu_marker.read_text(encoding="utf-8") == "yes\n"
        completed = store.root / "staging" / "presenter" / "completed"
        assert len(tuple(completed.glob("*/receipt.json"))) == 1
        gpu_marker.write_text("no\n", encoding="utf-8")
    finally:
        store.close()


@pytest.mark.parametrize("cancelled", [False, True])
def test_presenter_releases_gpu_marker_after_worker_failure_or_cancellation(
    tmp_path: Path,
    cancelled: bool,
) -> None:
    store, portrait_hash, narration_hash = _store_with_inputs(tmp_path)
    runtime, worker, ffprobe = _runtime(tmp_path / "runtime")
    gpu_marker = Path(os.environ["ALYSTRIA_GPU_LOCK_PATH"])
    runner = FakePresenterRunner(
        worker,
        ffprobe,
        worker_exit_code=7 if not cancelled else 0,
        gpu_marker=gpu_marker,
        cancel_during_worker=cancelled,
    )
    try:
        expected = LocalPresenterCancelledError if cancelled else LocalPresenterRuntimeError
        with pytest.raises(expected):
            _client(store, runtime, portrait_hash, runner).create_presenter(
                {"id": "scene-1"}, narration_hash=narration_hash, seed=1
            )
        assert gpu_marker.read_text(encoding="utf-8") == "no\n"
    finally:
        store.close()


def test_busy_gpu_marker_fails_before_presenter_worker_and_is_not_reset(
    tmp_path: Path,
) -> None:
    store, portrait_hash, narration_hash = _store_with_inputs(tmp_path)
    runtime, worker, ffprobe = _runtime(tmp_path / "runtime")
    gpu_marker = Path(os.environ["ALYSTRIA_GPU_LOCK_PATH"])
    gpu_marker.write_text("yes\n", encoding="utf-8")
    runner = FakePresenterRunner(worker, ffprobe)
    try:
        with pytest.raises(LocalPresenterRuntimeError, match="already claimed"):
            _client(store, runtime, portrait_hash, runner).create_presenter(
                {"id": "scene-1"}, narration_hash=narration_hash, seed=1
            )
        assert not any(Path(call[0]) == worker.resolve() for call in runner.calls)
        assert gpu_marker.read_text(encoding="utf-8") == "yes\n"
    finally:
        gpu_marker.write_text("no\n", encoding="utf-8")
        store.close()


def test_presenter_preserves_gpu_claim_when_child_survival_is_unresolved(
    tmp_path: Path,
) -> None:
    store, portrait_hash, narration_hash = _store_with_inputs(tmp_path)
    runtime, worker, ffprobe = _runtime(tmp_path / "runtime")
    gpu_marker = Path(os.environ["ALYSTRIA_GPU_LOCK_PATH"])
    runner = FakePresenterRunner(
        worker,
        ffprobe,
        gpu_marker=gpu_marker,
        process_survives=True,
    )
    try:
        with pytest.raises(LocalPresenterProcessSurvivedError, match="confirm"):
            _client(store, runtime, portrait_hash, runner).create_presenter(
                {"id": "scene-1"}, narration_hash=narration_hash, seed=1
            )
        assert gpu_marker.read_text(encoding="utf-8") == "yes\n"
    finally:
        gpu_marker.write_text("no\n", encoding="utf-8")
        store.close()


def test_subprocess_cancellation_kills_descendant_process_tree(tmp_path: Path) -> None:
    child = tmp_path / "child.py"
    parent = tmp_path / "parent.py"
    ready = tmp_path / "ready.txt"
    sentinel = tmp_path / "child-survived.txt"
    child.write_text(
        "import pathlib,sys,time\n"
        "time.sleep(1.5)\n"
        "pathlib.Path(sys.argv[1]).write_text('survived', encoding='utf-8')\n",
        encoding="utf-8",
    )
    parent.write_text(
        "import pathlib,subprocess,sys,time\n"
        "subprocess.Popen([sys.executable, sys.argv[1], sys.argv[2]])\n"
        "pathlib.Path(sys.argv[3]).write_text('ready', encoding='utf-8')\n"
        "time.sleep(30)\n",
        encoding="utf-8",
    )
    cancelled = threading.Event()
    outcome: list[BaseException] = []

    def run() -> None:
        try:
            SubprocessPresenterCommandRunner().run(
                (sys.executable, str(parent), str(child), str(sentinel), str(ready)),
                cwd=tmp_path,
                environment=os.environ,
                timeout_seconds=20,
                cancelled=cancelled.is_set,
            )
        except BaseException as error:
            outcome.append(error)

    thread = threading.Thread(target=run)
    thread.start()
    deadline = time.monotonic() + 5
    while not ready.exists() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert ready.exists()
    cancelled.set()
    thread.join(8)
    assert not thread.is_alive()
    assert outcome and isinstance(outcome[0], LocalPresenterCancelledError)
    time.sleep(1.7)
    assert not sentinel.exists()


def test_pinned_worker_validates_contract_and_emits_progress(tmp_path: Path) -> None:
    worker = Path(__file__).parents[2] / "scripts" / "local_presenter_worker.py"
    adapter = tmp_path / "adapter.py"
    model_config = tmp_path / "musetalk.json"
    model_weights = tmp_path / "musetalk.pth"
    portrait = tmp_path / "portrait.png"
    audio = tmp_path / "audio.wav"
    workspace = tmp_path / "workspace"
    output_root = tmp_path / "output"
    output = output_root / "presenter.mp4"
    ffmpeg = tmp_path / "ffmpeg.exe"
    progress = tmp_path / "progress.ndjson"
    workspace.mkdir()
    output_root.mkdir()
    ffmpeg.write_bytes(b"pinned ffmpeg")
    adapter.write_text(
        "def run_presenter_job(job, emit_progress):\n"
        "    import os, socket\n"
        "    from pathlib import Path\n"
        "    assert os.environ['HF_HUB_OFFLINE'] == '1'\n"
        "    try:\n"
        "        socket.socket().connect(('127.0.0.1', 9))\n"
        "    except PermissionError:\n"
        "        pass\n"
        "    else:\n"
        "        raise AssertionError('presenter worker network was not denied')\n"
        "    emit_progress('inference', 0.5, 'fake inference')\n"
        "    Path(job['output']['path']).write_bytes(" + repr(_mp4()) + ")\n"
        "    emit_progress('encoding', 0.9, 'fake encoding')\n"
        "    return 0\n",
        encoding="utf-8",
    )
    model_config.write_text("{}", encoding="utf-8")
    model_weights.write_bytes(b"exact model weights")
    extra_contract_paths = {
        role: tmp_path / f"{role}.bin"
        for role in (
            "audio-feature-config",
            "audio-feature-preprocessor",
            "audio-feature-weights",
            "face-detection-weights",
            "face-landmark-weights",
            "face-parse-weights",
            "face-resnet-weights",
            "musetalk-inference-entrypoint",
            "runtime-source-manifest",
            "vae-config",
            "vae-weights",
        )
    }
    for role, contract_path in extra_contract_paths.items():
        contract_path.write_bytes(f"exact {role}".encode())
    source_root = tmp_path / "source"
    source_root.mkdir()
    source_file = source_root / "inference.py"
    source_file.write_text("# pinned source\n", encoding="utf-8")
    extra_contract_paths["musetalk-inference-entrypoint"].write_text(
        "# pinned inference\n", encoding="utf-8"
    )
    extra_contract_paths["runtime-source-manifest"].write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "root": str(source_root),
                "files": [{"relativePath": source_file.name, "sha256": _digest(source_file)}],
            }
        ),
        encoding="utf-8",
    )
    portrait.write_bytes(b"\x89PNG\r\n\x1a\n" + bytes(64))
    audio.write_bytes(b"RIFF" + bytes(64))
    manifest = tmp_path / "job.json"
    job = {
        "schemaVersion": 2,
        "model": "musetalk",
        "modelRevision": "test",
        "seed": 12,
        "inputs": {
            "portrait": {"path": str(portrait), "sha256": _digest(portrait)},
            "audio": {"path": str(audio), "sha256": _digest(audio)},
        },
        "output": {"path": str(output), "mediaType": "video/mp4"},
        "progress": {"path": str(progress), "schemaVersion": 1},
        "encoding": {
            "policy": "alystria-presenter-h264-v1",
            "encoder": "h264_nvenc",
            "codecArguments": ["-c:v", "h264_nvenc"],
            "ffmpegPath": str(ffmpeg),
            "ffmpegSha256": _digest(ffmpeg),
        },
        "gpuLease": {
            "leaseId": "test-lease",
            "owner": "pytest",
            "mutexName": "global\\alystria-test-gpu",
            "deviceId": "cuda:0",
            "vramBytes": 4294967296,
        },
        "workerContract": {
            "contractId": "alystria.musetalk.worker.v1",
            "entrypoint": {"path": str(worker), "sha256": _digest(worker)},
            "files": [
                {
                    "role": "adapter-entrypoint",
                    "path": str(adapter),
                    "sha256": _digest(adapter),
                },
                {
                    "role": "musetalk-config",
                    "path": str(model_config),
                    "sha256": _digest(model_config),
                },
                {
                    "role": "musetalk-weights",
                    "path": str(model_weights),
                    "sha256": _digest(model_weights),
                },
                *(
                    {"role": role, "path": str(path), "sha256": _digest(path)}
                    for role, path in extra_contract_paths.items()
                ),
            ],
        },
    }
    manifest.write_text(json.dumps(job), encoding="utf-8")
    result = subprocess.run(
        (
            sys.executable,
            str(worker),
            "--job",
            str(manifest),
            "--portrait",
            str(portrait),
            "--audio",
            str(audio),
            "--output",
            str(output),
            "--workspace",
            str(workspace),
            "--seed",
            "12",
        ),
        cwd=tmp_path,
        capture_output=True,
        check=False,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    events = [json.loads(line) for line in progress.read_text(encoding="utf-8").splitlines()]
    assert [event["sequence"] for event in events] == list(range(1, len(events) + 1))
    assert events[-1]["stage"] == "complete"
    assert events[-1]["progress"] == 1.0
    assert output.read_bytes() == _mp4()


def test_cross_connection_job_cancellation_reaches_presenter_client(tmp_path: Path) -> None:
    store, portrait_hash, narration_hash = _store_with_inputs(tmp_path)
    runtime, worker, ffprobe = _runtime(tmp_path / "runtime")
    client = _client(store, runtime, portrait_hash, FakePresenterRunner(worker, ffprobe))
    coordinator = GenerationCoordinator(store, media_client=client)
    generation_id = coordinator.start(
        GenerationRequest(
            topic="Cancellation test",
            audience="Learners",
            duration_seconds=60,
            sources=(
                SourceSpec(
                    "source.cancel",
                    "Cancellation source",
                    "Cancellation must terminate the active presenter subprocess.",
                ),
            ),
            presenter_mode="on",
        )
    ).generation_id
    coordinator.run_pending()
    approved = coordinator.approve(generation_id)
    presenter_job_id = next(
        stage.job_id for stage in approved.stages if stage.stage is GenerationStage.PRESENTER
    )
    observer = ProjectStore.open(store.root)
    try:
        observer.connection.execute(
            "UPDATE jobs SET state='RUNNING',cancel_requested=1 WHERE job_id=?",
            (presenter_job_id,),
        )
        with pytest.raises(LocalPresenterCancelledError, match="cancelled"):
            client.create_presenter({"id": "scene-1"}, narration_hash=narration_hash, seed=1)
    finally:
        observer.close()
        store.close()


def test_musetalk_adapter_replaces_upstream_shell_mux_with_fixed_argv(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    adapter_path = Path(__file__).parents[2] / "scripts" / "musetalk_v15_adapter.py"
    spec = importlib.util.spec_from_file_location("tested_musetalk_adapter", adapter_path)
    assert spec is not None and spec.loader is not None
    adapter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(adapter)
    assert adapter._fixed_argv_matches(
        (r"C:\runtime/frames/%08d.png", "-y"),
        (r"C:\runtime\frames\%08d.png", "-y"),
        path_indices={0},
    )
    assert not adapter._fixed_argv_matches(
        (r"C:\runtime/frames/%08d.png", "-n"),
        (r"C:\runtime\frames\%08d.png", "-y"),
        path_indices={0},
    )
    source_root = tmp_path / "source"
    (source_root / "scripts").mkdir(parents=True)
    (source_root / "musetalk" / "utils" / "dwpose").mkdir(parents=True)
    (source_root / "musetalk" / "__init__.py").write_text("", encoding="utf-8")
    (source_root / "musetalk" / "utils" / "__init__.py").write_text("", encoding="utf-8")
    preprocessing = source_root / "musetalk" / "utils" / "preprocessing.py"
    preprocessing.write_text(
        "config_file = './musetalk/utils/dwpose/"
        "rtmpose-l_8xb32-270e_coco-ubody-wholebody-384x288.py'\n"
        "checkpoint_file = './models/dwpose/dw-ll_ucoco_384.pth'\n",
        encoding="utf-8",
    )
    pose_config = (
        source_root
        / "musetalk"
        / "utils"
        / "dwpose"
        / "rtmpose-l_8xb32-270e_coco-ubody-wholebody-384x288.py"
    )
    pose_config.write_text("model = {}\n", encoding="utf-8")
    inference = source_root / "scripts" / "inference.py"
    inference.write_text(
        "import os\n"
        "from pathlib import Path\n"
        "from musetalk.utils import preprocessing\n"
        "def get_image(image, face, face_box, mode='raw', fp=None):\n"
        "    return image\n"
        "def main(args):\n"
        "    assert args.parsing_mode == 'raw'\n"
        "    assert (Path.cwd() / 'models' / 'dwpose' / "
        "'dw-ll_ucoco_384.pth').is_file()\n"
        "    assert Path(preprocessing.config_file).is_file()\n"
        "    assert Path(preprocessing.checkpoint_file).is_file()\n"
        "    assert Path(args.vae_type).name == 'sd-vae-ft-mse'\n"
        "    frames = Path(args.result_dir) / 'v15' / 'portrait_narration'\n"
        "    frames.mkdir(parents=True)\n"
        "    silent = Path(args.result_dir) / 'v15' / 'temp_portrait_narration.mp4'\n"
        "    output = Path(args.result_dir) / 'v15' / 'presenter.mp4'\n"
        "    os.system(f'ffmpeg -y -v warning -r 25 -f image2 -i {frames}/%08d.png "
        "-vcodec libx264 -vf format=yuv420p -crf 18 {silent.parent}/temp_portrait_narration.mp4')\n"
        "    audio = Path(__import__('json').loads(Path(args.inference_config)"
        ".read_text())['alystria']['audio_path'])\n"
        "    os.system(f'ffmpeg -y -v warning -i {audio} -i "
        "{silent.parent}/temp_portrait_narration.mp4 {output}')\n"
        "    print('Error occurred during processing:', "
        "\"local variable 'save_dir_full' referenced before assignment\")\n",
        encoding="utf-8",
    )
    source_manifest = tmp_path / "source-manifest.json"
    source_manifest.write_text(
        json.dumps({"schemaVersion": 1, "root": str(source_root), "files": []}),
        encoding="utf-8",
    )
    model_pack = tmp_path / "model-pack"
    models = model_pack / "models"
    model_config = models / "musetalkV15" / "musetalk.json"
    model_weights = models / "musetalkV15" / "unet.pth"
    whisper_config = models / "whisper" / "config.json"
    contract_model_files = {
        "audio-feature-preprocessor": models / "whisper" / "preprocessor_config.json",
        "audio-feature-weights": models / "whisper" / "model.safetensors",
        "face-detection-weights": models / "face-detection" / "s3fd-619a316812.pth",
        "face-landmark-weights": models / "dwpose" / "dw-ll_ucoco_384.pth",
        "face-parse-weights": models / "face-parse-bisent" / "79999_iter.pth",
        "face-resnet-weights": models / "face-parse-bisent" / "resnet18-5c106cde.pth",
        "vae-config": models / "sd-vae-ft-mse" / "config.json",
        "vae-weights": models / "sd-vae-ft-mse" / "diffusion_pytorch_model.safetensors",
    }
    model_config.parent.mkdir(parents=True)
    whisper_config.parent.mkdir(parents=True)
    for contract_path in contract_model_files.values():
        contract_path.parent.mkdir(parents=True, exist_ok=True)
        contract_path.write_bytes(b"pinned")
    model_config.write_text("{}", encoding="utf-8")
    model_weights.write_bytes(b"weights")
    whisper_config.write_text("{}", encoding="utf-8")
    attempt = tmp_path / "attempt"
    output_root = attempt / "output"
    workspace = attempt / "workspace"
    output_root.mkdir(parents=True)
    workspace.mkdir()
    output = output_root / "presenter.mp4"
    ffmpeg = tmp_path / "ffmpeg.exe"
    portrait = tmp_path / "portrait.png"
    audio = tmp_path / "narration.wav"
    portrait.write_bytes(b"portrait")
    audio.write_bytes(b"audio")
    ffmpeg.write_bytes(b"ffmpeg")
    calls: list[tuple[str, ...]] = []

    def fake_run(argv: Sequence[str], **kwargs: object) -> SimpleNamespace:
        assert kwargs["shell"] is False
        call = tuple(argv)
        calls.append(call)
        Path(call[-1]).parent.mkdir(parents=True, exist_ok=True)
        Path(call[-1]).write_bytes(_mp4())
        return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

    monkeypatch.setattr(adapter.subprocess, "run", fake_run)
    monkeypatch.setattr(adapter, "_decode_speech_weights", lambda **_kwargs: [1.0])
    monkeypatch.setattr(adapter, "_restore_silent_mouth_frames", lambda **_kwargs: 0)
    contract_files = {
        "musetalk-inference-entrypoint": inference,
        "runtime-source-manifest": source_manifest,
        "musetalk-config": model_config,
        "musetalk-weights": model_weights,
        "audio-feature-config": whisper_config,
        **contract_model_files,
    }
    events: list[tuple[str, float, str]] = []
    result = adapter.run_presenter_job(
        {
            "inputs": {
                "portrait": {"path": str(portrait)},
                "audio": {"path": str(audio)},
            },
            "output": {"path": str(output)},
            "gpuLease": {"deviceId": "cuda:0"},
            "encoding": {
                "encoder": "h264_nvenc",
                "codecArguments": ["-c:v", "h264_nvenc"],
                "ffmpegPath": str(ffmpeg),
            },
            "workerContract": {
                "files": [
                    {"role": role, "path": str(path)} for role, path in contract_files.items()
                ]
            },
        },
        lambda stage, progress, message: events.append((stage, progress, message)),
    )
    assert result == 0
    assert len(calls) == 2
    assert all(call[0].endswith("ffmpeg.exe") for call in calls)
    assert output.read_bytes() == _mp4()
    assert [event[0] for event in events] == ["inference", "encoding"]
