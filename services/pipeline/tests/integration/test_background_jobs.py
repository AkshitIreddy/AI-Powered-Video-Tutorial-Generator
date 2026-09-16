from __future__ import annotations

import sqlite3
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

import alystria.generation.adapters as adapters_module
from alystria.background import DesktopJobSupervisor
from alystria.generation import (
    GenerationCoordinator,
    GenerationRequest,
    GenerationStage,
    GenerationState,
)
from alystria.jobs import SQLiteWorkflowRuntime
from alystria.native_controls import NativeControlCoordinator
from alystria.project import ProjectStore
from alystria.providers import ProviderResult, TextOutput, Usage
from alystria.scene_edit_provider import StructuredSceneEditProvider
from alystria.service import PipelineService


def _desktop_params(store: ProjectStore) -> dict[str, object]:
    return {
        "projectId": store.manifest.project_id,
        "projectDirectory": str(store.root),
        "snapshotId": None,
        "scope": {"kind": "project"},
        "quality": "standard",
        "privacy": "local",
        "approvedProviderIds": [],
        "preservationLocks": [],
    }


def _wait_for_state(
    project: Path,
    generation_id: str,
    expected: GenerationState,
    *,
    timeout: float = 5,
) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with ProjectStore.open(project) as store:
            if GenerationCoordinator(store).status(generation_id).state is expected:
                return
        time.sleep(0.02)
    raise AssertionError(f"generation {generation_id} did not reach {expected.value}")


def test_generation_rpc_returns_before_slow_background_stage_finishes(tmp_path: Path) -> None:
    project = tmp_path / "async-generation"
    with ProjectStore.create(
        project, name="Async generation", project_id=str(uuid.uuid4())
    ) as store:
        params = _desktop_params(store)

    stage_entered = threading.Event()
    release_stage = threading.Event()

    def execute(store: ProjectStore, runtime: SQLiteWorkflowRuntime):
        coordinator = GenerationCoordinator(store, runtime)
        handlers = dict(coordinator.workflow.handlers)
        first_kind = coordinator.workflow.kind(GenerationStage.INGEST_RESEARCH)
        original = handlers[first_kind]

        def slow(context, parameters):
            stage_entered.set()
            assert release_stage.wait(3)
            return original(context, parameters)

        handlers[first_kind] = slow
        return runtime.run_once(handlers)

    supervisor = DesktopJobSupervisor(execute, poll_interval_seconds=0.01)
    supervisor.start()
    try:
        service = PipelineService(
            background_supervisor=supervisor,
            generation_coordinator_factory=lambda store, runtime: GenerationCoordinator(
                store, runtime
            ),
        )
        started_at = time.monotonic()
        receipt = service.generation_start(params)
        elapsed = time.monotonic() - started_at
        assert elapsed < 0.25
        assert receipt["state"] in {"QUEUED", "RUNNING"}
        assert stage_entered.wait(1)
        assert receipt["jobId"]
    finally:
        release_stage.set()
        supervisor.stop(timeout_seconds=3)


def test_generation_start_and_status_do_not_probe_optional_windows_speech(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    probe_entered = threading.Event()
    release_probe = threading.Event()

    class BlockingWindowsSpeech:
        def capabilities(self):
            probe_entered.set()
            assert release_probe.wait(2)
            raise AssertionError("System.Speech capability discovery must be lazy")

    monkeypatch.delenv("ALYSTRIA_MEDIA_MODE", raising=False)
    monkeypatch.setattr(adapters_module.sys, "platform", "win32")
    monkeypatch.setattr(
        adapters_module,
        "WindowsSpeechAdapter",
        lambda **_kwargs: BlockingWindowsSpeech(),
    )
    adapters_module._cached_default_local_media_client.cache_clear()
    project = tmp_path / "lazy-windows-speech"
    try:
        with ProjectStore.create(
            project, name="Lazy Windows speech", project_id=str(uuid.uuid4())
        ) as store:
            params = _desktop_params(store)
            project_id = store.manifest.project_id

        service = PipelineService()
        with ThreadPoolExecutor(max_workers=1) as executor:
            receipt = executor.submit(service.generation_start, params).result(timeout=0.5)
            status = executor.submit(
                service.desktop_job_status,
                {
                    "projectId": project_id,
                    "projectDirectory": str(project),
                    "jobId": receipt["jobId"],
                },
            ).result(timeout=0.5)

        assert status["jobId"] == receipt["jobId"]
        assert not probe_entered.is_set()
    finally:
        release_probe.set()
        adapters_module._cached_default_local_media_client.cache_clear()


def test_supervisor_recovers_expired_lease_after_process_restart(tmp_path: Path) -> None:
    project = tmp_path / "restart-recovery"
    with ProjectStore.create(project, name="Recovery", project_id=str(uuid.uuid4())) as store:
        coordinator = GenerationCoordinator(store)
        generation_id = coordinator.start(
            GenerationRequest(topic="Recovery", audience="Test", duration_seconds=60)
        ).generation_id
        claim = coordinator.runtime._claim_next()
        assert claim is not None
        store.connection.execute(
            "UPDATE jobs SET lease_expires_at='2000-01-01T00:00:00Z' WHERE job_id=?",
            (claim[0].job_id,),
        )

    def execute(store: ProjectStore, runtime: SQLiteWorkflowRuntime):
        coordinator = GenerationCoordinator(store, runtime)
        return runtime.run_once(coordinator.workflow.handlers)

    restarted = DesktopJobSupervisor(execute, poll_interval_seconds=0.01)
    restarted.start()
    try:
        restarted.register(project)
        _wait_for_state(project, generation_id, GenerationState.WAITING_APPROVAL)
        database = sqlite3.connect(project / "project.sqlite3")
        try:
            assert database.execute(
                "SELECT COUNT(*) FROM job_attempts WHERE state='ABANDONED'"
            ).fetchone()[0] == 1
        finally:
            database.close()
    finally:
        restarted.stop(timeout_seconds=3)


def test_supervisor_reopens_authored_scene_proposal_and_service_accepts_it(
    tmp_path: Path,
) -> None:
    class FixtureWritingClient:
        def __init__(self) -> None:
            self.calls = 0

        def generate(self, request, *, idempotency_key: str):
            self.calls += 1
            return ProviderResult(
                "fixture-writing",
                request.model,
                TextOutput(
                    text="fixture",
                    parsed={
                        "title": "A concrete interval example",
                        "narration": "Start with eight values. One comparison leaves four.",
                        "objective": "Explain how each comparison narrows the interval.",
                        "durationSeconds": 8,
                        "visualIntent": "Keep the approved interval diagram visible.",
                    },
                ),
                Usage(
                    "fixture-writing",
                    request.model,
                    units={"outputTokens": 18},
                    actual_cost_micros=0,
                    request_id="fixture-scene-edit",
                ),
                raw_id=idempotency_key,
            )

    project = tmp_path / "authored-scene-recovery"
    client = FixtureWritingClient()
    provider = StructuredSceneEditProvider(client, model="fixture-writer-v1")  # type: ignore[arg-type]
    with ProjectStore.create(
        project,
        name="Authored scene recovery",
        project_id=str(uuid.uuid4()),
        initial_snapshot={
            "title": "Authored scene recovery",
            "sources": [],
            "scenes": [
                {
                    "id": "scene-one",
                    "title": "Interval narrowing",
                    "narration": "Each comparison narrows the interval.",
                    "objective": "Explain how each comparison narrows the interval.",
                    "duration": 6,
                }
            ],
        },
    ) as store:
        head = store.head_revision()
        assert head is not None
        control = NativeControlCoordinator(store, scene_edit_provider=provider)
        job = control.submit_regeneration(
            {
                "baseRevisionId": head.revision_id,
                "sceneId": "scene-one",
                "instruction": "Use a concrete example.",
                "editFocus": "explanation",
                "preservationLocks": ["learningobjective", "assets", "presenter"],
                "alternatives": 1,
            }
        )
        assert job.state.value == "QUEUED"
        project_id = store.manifest.project_id

    def execute(store: ProjectStore, runtime: SQLiteWorkflowRuntime):
        controls = NativeControlCoordinator(store, scene_edit_provider=provider)
        return runtime.run_once(controls.handlers)

    restarted = DesktopJobSupervisor(execute, poll_interval_seconds=0.01)
    restarted.start()
    try:
        restarted.register(project)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            with ProjectStore.open(project) as store:
                recovered = SQLiteWorkflowRuntime(store.connection).get_job(job.job_id)
                if recovered.state.value == "SUCCEEDED":
                    candidate_id = recovered.result["candidateIds"][0]  # type: ignore[index]
                    proposal_head = store.head_revision()
                    assert proposal_head is not None
                    break
            time.sleep(0.02)
        else:
            raise AssertionError("authored scene proposal did not recover")

        accepted = PipelineService().dispatch(
            "control.acceptSceneEditCandidate",
            {
                "projectId": project_id,
                "projectDirectory": str(project),
                "expectedHeadRevisionId": proposal_head.revision_id,
                "candidateId": candidate_id,
            },
        )
        assert accepted["status"] == "accepted"
        with ProjectStore.open(project) as store:
            current = store.head_revision()
            assert current is not None
            assert current.snapshot["scenes"][0]["narration"].startswith("Start with eight")
            assert current.snapshot["mediaInvalidatedAt"]
            assert store.connection.execute(
                "SELECT COUNT(*) FROM job_attempts WHERE job_id=? AND state='SUCCEEDED'",
                (job.job_id,),
            ).fetchone()[0] == 1
        assert client.calls == 1
    finally:
        restarted.stop(timeout_seconds=3)


def test_supervisor_reopens_persisted_blocked_child_after_parent_succeeded(
    tmp_path: Path,
) -> None:
    project = tmp_path / "persisted-blocked-child"
    with ProjectStore.create(project, name="Blocked child") as store:
        runtime = SQLiteWorkflowRuntime(store.connection)
        parent = runtime.enqueue(
            project_id=store.manifest.project_id,
            kind="parent",
            parameters={},
        )
        child = runtime.enqueue(
            project_id=store.manifest.project_id,
            kind="child",
            parameters={},
            dependency_ids=[parent.job_id],
        )
        assert runtime.run_once({"parent": lambda *_: {"ok": True}}) is not None
        # Recreate the durable snapshot visible between worker turns: the
        # parent committed successfully while its child is still blocked.
        store.connection.execute(
            "UPDATE jobs SET state='BLOCKED' WHERE job_id=?",
            (child.job_id,),
        )

    completed = threading.Event()

    def execute(store: ProjectStore, runtime: SQLiteWorkflowRuntime):
        result = runtime.run_once({"child": lambda *_: {"ok": True}})
        if result is not None and result.state.value == "SUCCEEDED":
            completed.set()
        return result

    restarted = DesktopJobSupervisor(execute, poll_interval_seconds=0.01)
    restarted.start()
    try:
        restarted.register(project)
        assert completed.wait(1)
        with ProjectStore.open(project) as store:
            recovered = SQLiteWorkflowRuntime(store.connection).get_job(child.job_id)
            assert recovered.state.value == "SUCCEEDED"
    finally:
        restarted.stop(timeout_seconds=3)


def test_supervisor_recovers_expired_child_without_rerunning_succeeded_parent(
    tmp_path: Path,
) -> None:
    project = tmp_path / "expired-child"
    with ProjectStore.create(project, name="Expired child") as store:
        runtime = SQLiteWorkflowRuntime(store.connection)
        parent = runtime.enqueue(
            project_id=store.manifest.project_id,
            kind="parent",
            parameters={},
        )
        child = runtime.enqueue(
            project_id=store.manifest.project_id,
            kind="child",
            parameters={},
            dependency_ids=[parent.job_id],
        )
        assert runtime.run_once({"parent": lambda *_: {"accepted": "once"}}) is not None
        runtime._unblock_ready_jobs()
        claim = runtime._claim_next()
        assert claim is not None and claim[0].job_id == child.job_id
        store.connection.execute(
            "UPDATE jobs SET lease_expires_at='2000-01-01T00:00:00Z' WHERE job_id=?",
            (child.job_id,),
        )

    child_completed = threading.Event()

    def execute(store: ProjectStore, runtime: SQLiteWorkflowRuntime):
        def reject_parent(*_):
            raise AssertionError("succeeded parent was executed again")

        result = runtime.run_once({"parent": reject_parent, "child": lambda *_: {"ok": True}})
        if result is not None and result.state.value == "SUCCEEDED":
            child_completed.set()
        return result

    restarted = DesktopJobSupervisor(execute, poll_interval_seconds=0.01)
    restarted.start()
    try:
        restarted.register(project)
        assert child_completed.wait(1)
        with ProjectStore.open(project) as store:
            runtime = SQLiteWorkflowRuntime(store.connection)
            recovered_parent = runtime.get_job(parent.job_id)
            recovered_child = runtime.get_job(child.job_id)
            assert recovered_parent.state.value == "SUCCEEDED"
            assert recovered_parent.attempt_count == 1
            assert recovered_parent.result == {"accepted": "once"}
            assert recovered_child.state.value == "SUCCEEDED"
            assert recovered_child.attempt_count == 2
            assert store.connection.execute(
                "SELECT COUNT(*) FROM job_attempts WHERE job_id=? AND state='ABANDONED'",
                (child.job_id,),
            ).fetchone()[0] == 1
    finally:
        restarted.stop(timeout_seconds=3)


def test_desktop_cancel_remains_responsive_while_stage_is_running(tmp_path: Path) -> None:
    project = tmp_path / "cancel-running"
    with ProjectStore.create(
        project, name="Cancellation", project_id=str(uuid.uuid4())
    ) as store:
        params = _desktop_params(store)

    stage_entered = threading.Event()
    release_stage = threading.Event()

    def execute(store: ProjectStore, runtime: SQLiteWorkflowRuntime):
        coordinator = GenerationCoordinator(store, runtime)
        handlers = dict(coordinator.workflow.handlers)
        first_kind = next(iter(handlers))
        original = handlers[first_kind]

        def cancellable(context, parameters):
            stage_entered.set()
            while not release_stage.wait(0.01):
                context.check_cancelled()
            return original(context, parameters)

        handlers[first_kind] = cancellable
        return runtime.run_once(handlers)

    supervisor = DesktopJobSupervisor(execute, poll_interval_seconds=0.01)
    supervisor.start()
    try:
        service = PipelineService(
            background_supervisor=supervisor,
            generation_coordinator_factory=lambda store, runtime: GenerationCoordinator(
                store, runtime
            ),
        )
        receipt = service.generation_start(params)
        assert stage_entered.wait(1)
        cancelled_at = time.monotonic()
        cancelled = service.generation_cancel(
            {
                "projectId": params["projectId"],
                "projectDirectory": params["projectDirectory"],
                "jobId": receipt["jobId"],
            }
        )
        assert time.monotonic() - cancelled_at < 0.25
        assert cancelled["state"] == "CANCELLED"
    finally:
        release_stage.set()
        supervisor.stop(timeout_seconds=3)
