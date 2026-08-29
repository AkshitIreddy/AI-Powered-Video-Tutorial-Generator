from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
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
    LocalPresenterMediaClient,
    LocalPresenterOutputError,
    LocalPresenterPolicyError,
    LocalPresenterProfileBinding,
    LocalPresenterRuntime,
    PinnedPresenterFile,
    PresenterEncoderPolicy,
    PresenterExecutionPolicy,
    PresenterNetworkPolicy,
    PresenterProcessResult,
    load_local_presenter_media_client,
)
from alystria.project import ProjectStore


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
    worker_exit_code: int = 0

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
        if Path(call[0]) == self.worker.resolve():
            portrait = Path(call[call.index("--portrait") + 1])
            output = Path(call[call.index("--output") + 1])
            if "--job" in call:
                manifest = Path(call[call.index("--job") + 1])
                job = json.loads(manifest.read_text(encoding="utf-8"))
                assert Path(job["inputs"]["portrait"]["path"]) == portrait
                assert Path(job["output"]["path"]) == output
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
                        },
                        {"codec_type": "audio", "codec_name": "aac"},
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
    worker.write_bytes(b"pinned presenter worker")
    ffprobe.write_bytes(b"pinned ffprobe")
    ffmpeg.write_bytes(b"pinned LGPL ffmpeg")
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
        encoder_policy=(
            PresenterEncoderPolicy(ffmpeg, _digest(ffmpeg)) if managed else None
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


def test_managed_worker_returns_ffprobe_validated_video_generated_media(tmp_path: Path) -> None:
    store, portrait_hash, narration_hash = _store_with_inputs(tmp_path)
    runtime, worker, ffprobe = _runtime(tmp_path / "runtime")
    runner = FakePresenterRunner(worker, ffprobe)
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
        assert media.metadata["networkPolicy"] == "supervisor-deny"
        assert media.metadata["unsafeTestOnly"] is False
        assert media.metadata["validationLevel"] == "ffprobe"
        assert media.metadata["probe"] == {
            "verified": True,
            "durationSeconds": 2.5,
            "width": 768,
            "height": 768,
            "frameRate": "25/1",
            "videoCodec": "h264",
            "audioCodecs": ["aac"],
        }
        assert len(runner.calls) == 3
        assert "lavfi" in runner.calls[0]
        assert all("scene/unsafe name" not in item for call in runner.calls for item in call)
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
    finally:
        store.close()


def test_managed_musetalk_config_loads_brokered_encoder_policy(tmp_path: Path) -> None:
    store, portrait_hash, narration_hash = _store_with_inputs(tmp_path)
    runtime_root = tmp_path / "runtime"
    runtime_root.mkdir()
    worker = runtime_root / "worker.exe"
    ffprobe = runtime_root / "ffprobe.exe"
    ffmpeg = runtime_root / "ffmpeg.exe"
    worker.write_bytes(b"worker")
    ffprobe.write_bytes(b"ffprobe")
    ffmpeg.write_bytes(b"LGPL ffmpeg")
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
                "profiles": [
                    {"profileId": "default", "portraitArtifactHash": portrait_hash}
                ],
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
