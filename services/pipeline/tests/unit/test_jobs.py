from __future__ import annotations

import json
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from alystria.jobs import (
    ActionKey,
    BudgetExceededError,
    JobContext,
    JobState,
    RetryableTaskError,
    SQLiteWorkflowRuntime,
)
from alystria.project import ProjectStore


def test_jobs_run_in_dependency_order_and_emit_events(tmp_path: Path) -> None:
    with ProjectStore.create(tmp_path / "project", name="Jobs") as store:
        runtime = SQLiteWorkflowRuntime(store.connection)
        project_id = store.manifest.project_id
        first = runtime.enqueue(project_id=project_id, kind="first", parameters={})
        second = runtime.enqueue(
            project_id=project_id,
            kind="second",
            parameters={},
            dependency_ids=[first.job_id],
        )
        order: list[str] = []

        def handler(context, parameters):
            order.append(runtime.get_job(context.job_id).kind)
            context.set_progress(0.5)
            return {"ok": True}

        completed = runtime.run_until_idle({"first": handler, "second": handler})
        assert [job.state for job in completed] == [JobState.SUCCEEDED, JobState.SUCCEEDED]
        assert order == ["first", "second"]
        assert runtime.get_job(second.job_id).state == JobState.SUCCEEDED
        event_types = [event.event_type for event in runtime.events(first.job_id)]
        assert event_types.count("state_changed") >= 3
        assert "progress" in event_types


def test_enqueue_is_idempotent_by_action_key(tmp_path: Path) -> None:
    with ProjectStore.create(tmp_path / "project", name="Idempotency") as store:
        runtime = SQLiteWorkflowRuntime(store.connection)
        key = ActionKey("task", "v1", {"input": 1})
        first = runtime.enqueue(
            project_id=store.manifest.project_id, kind="task", parameters={"input": 1}, action_key=key
        )
        second = runtime.enqueue(
            project_id=store.manifest.project_id, kind="task", parameters={"input": 1}, action_key=key
        )
        assert first.job_id == second.job_id
        assert len(runtime.list_jobs()) == 1


def test_retryable_failure_retries_until_success(tmp_path: Path) -> None:
    with ProjectStore.create(tmp_path / "project", name="Retry") as store:
        runtime = SQLiteWorkflowRuntime(store.connection)
        job = runtime.enqueue(
            project_id=store.manifest.project_id,
            kind="flaky",
            parameters={},
            max_attempts=3,
        )
        attempts = 0

        def flaky(context, parameters):
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise RetryableTaskError("temporary")
            return {"attempts": attempts}

        completed = runtime.run_until_idle({"flaky": flaky})
        assert len(completed) == 3
        assert runtime.get_job(job.job_id).state == JobState.SUCCEEDED
        assert runtime.get_job(job.job_id).attempt_count == 3


def test_queued_cancellation_never_invokes_handler(tmp_path: Path) -> None:
    with ProjectStore.create(tmp_path / "project", name="Cancel") as store:
        runtime = SQLiteWorkflowRuntime(store.connection)
        job = runtime.enqueue(project_id=store.manifest.project_id, kind="task", parameters={})
        assert runtime.cancel(job.job_id).state == JobState.CANCELLED
        assert runtime.run_once({"task": lambda *_: pytest.fail("handler ran")}) is None


def test_expired_running_lease_is_recovered_without_losing_attempt_history(tmp_path: Path) -> None:
    with ProjectStore.create(tmp_path / "project", name="Recovery") as store:
        runtime = SQLiteWorkflowRuntime(store.connection, lease_seconds=5)
        job = runtime.enqueue(project_id=store.manifest.project_id, kind="task", parameters={})
        claim = runtime._claim_next()
        assert claim is not None
        store.connection.execute(
            "UPDATE jobs SET lease_expires_at=? WHERE job_id=?",
            ((datetime.now(UTC) - timedelta(seconds=10)).isoformat(), job.job_id),
        )
        assert runtime.recover_expired() == [job.job_id]
        assert runtime.get_job(job.job_id).state == JobState.QUEUED
        assert store.connection.execute(
            "SELECT state FROM job_attempts WHERE job_id=?", (job.job_id,)
        ).fetchone()[0] == "ABANDONED"


def test_long_handler_renews_lease_until_it_finishes(tmp_path: Path) -> None:
    project = tmp_path / "lease-heartbeat"
    with ProjectStore.create(project, name="Lease heartbeat") as store:
        runtime = SQLiteWorkflowRuntime(store.connection, lease_seconds=1)
        job = runtime.enqueue(project_id=store.manifest.project_id, kind="slow", parameters={})

    entered = threading.Event()
    release = threading.Event()
    outcome: list[JobState] = []

    def run_slow_handler() -> None:
        with ProjectStore.open(project) as worker_store:
            runtime = SQLiteWorkflowRuntime(
                worker_store.connection,
                worker_id="slow-worker",
                lease_seconds=1,
            )

            def slow(context, parameters):
                entered.set()
                assert release.wait(3)
                return {"ok": True}

            completed = runtime.run_once({"slow": slow})
            assert completed is not None
            outcome.append(completed.state)

    worker = threading.Thread(target=run_slow_handler)
    worker.start()
    assert entered.wait(1)
    time.sleep(1.2)
    with ProjectStore.open(project) as observer_store:
        observer = SQLiteWorkflowRuntime(observer_store.connection, lease_seconds=1)
        assert observer.recover_expired() == []
        assert observer.get_job(job.job_id).state is JobState.RUNNING
    release.set()
    worker.join(3)
    assert not worker.is_alive()
    assert outcome == [JobState.SUCCEEDED]


def test_budget_preflight_and_idempotent_usage_accounting(tmp_path: Path) -> None:
    with ProjectStore.create(tmp_path / "project", name="Budget") as store:
        runtime = SQLiteWorkflowRuntime(store.connection)
        with pytest.raises(BudgetExceededError):
            runtime.enqueue(
                project_id=store.manifest.project_id,
                kind="expensive",
                parameters={},
                estimated_cost_micros=101,
                budget_micros=100,
            )
        job = runtime.enqueue(
            project_id=store.manifest.project_id,
            kind="metered",
            parameters={},
            budget_micros=100,
        )

        def metered(context, parameters):
            for _ in range(2):
                context.record_usage(
                    provider="mock",
                    model="v1",
                    unit="token",
                    quantity=10,
                    cost_micros=60,
                    idempotency_key="provider-call-1",
                )
            return {"ok": True}

        assert runtime.run_once({"metered": metered}).state == JobState.SUCCEEDED
        summary = runtime.usage_summary(job.job_id)
        assert summary.total_cost_micros == 60
        assert summary.records == 1


def test_usage_over_budget_fails_job(tmp_path: Path) -> None:
    with ProjectStore.create(tmp_path / "project", name="Budget failure") as store:
        runtime = SQLiteWorkflowRuntime(store.connection)
        job = runtime.enqueue(
            project_id=store.manifest.project_id,
            kind="metered",
            parameters={},
            budget_micros=10,
        )

        def metered(context, parameters):
            context.record_usage(
                provider="mock",
                model="v1",
                unit="call",
                quantity=1,
                cost_micros=11,
                idempotency_key="too-much",
            )
            return {"ok": True}

        assert runtime.run_once({"metered": metered}).state == JobState.FAILED
        assert runtime.get_job(job.job_id).error["code"] == "BUDGET_EXCEEDED"


def test_incurred_provider_usage_is_retained_when_actual_cost_exceeds_budget(
    tmp_path: Path,
) -> None:
    with ProjectStore.create(tmp_path / "project", name="Incurred overage") as store:
        runtime = SQLiteWorkflowRuntime(store.connection)
        job = runtime.enqueue(
            project_id=store.manifest.project_id,
            kind="metered",
            parameters={},
            budget_micros=10,
        )

        def metered(context, parameters):
            context.record_usage(
                provider="mock",
                model="v1",
                unit="call",
                quantity=1,
                cost_micros=11,
                idempotency_key="incurred-overage",
                incurred=True,
            )
            raise RuntimeError("provider result cannot be accepted after the overage")

        assert runtime.run_once({"metered": metered}).state == JobState.FAILED
        summary = runtime.usage_summary(job.job_id)
        assert summary.total_cost_micros == 11
        row = store.connection.execute(
            "SELECT metadata_json FROM usage_records WHERE job_id=?",
            (job.job_id,),
        ).fetchone()
        assert json.loads(row["metadata_json"]) == {
            "budgetOverageMicros": 1,
            "incurred": True,
        }


def test_recovery_reuses_accepted_provider_checkpoint_without_duplicate_charge(
    tmp_path: Path,
) -> None:
    project = tmp_path / "provider-recovery"
    provider_calls = 0
    with ProjectStore.create(project, name="Provider recovery") as store:
        runtime = SQLiteWorkflowRuntime(store.connection, lease_seconds=5)
        job = runtime.enqueue(
            project_id=store.manifest.project_id,
            kind="provider-task",
            parameters={},
            budget_micros=100,
        )
        claim = runtime._claim_next()
        assert claim is not None
        claimed, attempt_id = claim
        context = JobContext(
            runtime,
            claimed.job_id,
            attempt_id,
            claimed.attempt_count,
            claimed.task_key,
        )
        provider_calls += 1
        context.record_provider_acceptance(
            idempotency_key="scene-1-image",
            provider="mock-cloud",
            model="image-v1",
            provider_request_id="request-accepted-1",
            result={"artifactHash": "sha256:accepted"},
            unit="request",
            quantity=1,
            cost_micros=60,
        )
        # Simulate a hard process stop after provider acceptance but before the
        # job result commit by leaving this attempt RUNNING with an expired lease.
        store.connection.execute(
            "UPDATE jobs SET lease_expires_at=? WHERE job_id=?",
            ((datetime.now(UTC) - timedelta(seconds=10)).isoformat(), job.job_id),
        )

    with ProjectStore.open(project) as reopened:
        recovered = SQLiteWorkflowRuntime(reopened.connection, lease_seconds=5)
        assert recovered.recover_expired() == [job.job_id]

        def resumed(context, parameters):
            nonlocal provider_calls
            checkpoint = context.provider_acceptance("scene-1-image")
            if checkpoint is None:
                provider_calls += 1
                raise AssertionError("accepted provider operation was duplicated")
            return checkpoint["result"]

        result = recovered.run_once({"provider-task": resumed})
        assert result is not None and result.state is JobState.SUCCEEDED
        assert provider_calls == 1
        assert recovered.usage_summary(job.job_id).records == 1
        assert recovered.usage_summary(job.job_id).total_cost_micros == 60
