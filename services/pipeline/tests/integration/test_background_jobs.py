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
