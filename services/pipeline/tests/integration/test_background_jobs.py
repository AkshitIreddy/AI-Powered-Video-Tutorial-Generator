from __future__ import annotations

import sqlite3
import threading
import time
import uuid
from pathlib import Path

from alystria.background import DesktopJobSupervisor
from alystria.generation import (
    GenerationCoordinator,
    GenerationRequest,
    GenerationStage,
    GenerationState,
)
from alystria.jobs import SQLiteWorkflowRuntime
from alystria.project import ProjectStore
from alystria.service import PipelineService


def _desktop_params(store: ProjectStore) -> dict[str, object]:
    return {
        "projectId": store.manifest.project_id,
        "projectDirectory": str(store.root),
        "snapshotId": None,
        "scope": {"kind": "project"},
        "quality": "standard",
        "privacy": "local",
        "budget": {
            "currency": "USD",
            "hardLimitMinorUnits": 0,
            "requireKnownPricing": True,
        },
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
