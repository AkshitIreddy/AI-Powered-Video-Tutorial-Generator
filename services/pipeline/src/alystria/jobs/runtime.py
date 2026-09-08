"""A recoverable SQLite workflow runtime with an optional DBOS boundary."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sqlite3
import threading
import traceback
import uuid
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol, cast, runtime_checkable

from alystria.project.database import transaction
from alystria.project.models import utc_now

from .keys import ActionKey, canonical_json
from .models import ALLOWED_TRANSITIONS, Job, JobEvent, JobState, UsageSummary

TaskHandler = Callable[["JobContext", dict[str, Any]], dict[str, Any]]


class JobRuntimeError(RuntimeError):
    pass


class InvalidTransitionError(JobRuntimeError):
    pass


class CancellationRequested(JobRuntimeError):
    pass


class RetryableTaskError(JobRuntimeError):
    def __init__(self, message: str, *, retry_after_seconds: float = 0) -> None:
        super().__init__(message)
        self.retry_after_seconds = max(0, retry_after_seconds)


class BudgetExceededError(JobRuntimeError):
    pass


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def _timestamp_after(seconds: float) -> str:
    value = datetime.now(UTC) + timedelta(seconds=max(seconds, 0))
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


@runtime_checkable
class WorkflowRuntime(Protocol):
    def enqueue(
        self,
        *,
        project_id: str,
        kind: str,
        parameters: dict[str, Any],
        job_id: str | None = None,
        action_key: ActionKey | None = None,
        dependency_ids: list[str] | None = None,
        priority: int = 0,
        max_attempts: int = 3,
        estimated_cost_micros: int = 0,
        budget_micros: int | None = None,
    ) -> Job: ...

    def run_once(self, handlers: Mapping[str, TaskHandler]) -> Job | None: ...

    def cancel(self, job_id: str) -> Job: ...

    def recover_expired(self) -> list[str]: ...


@dataclass(slots=True)
class JobContext:
    runtime: SQLiteWorkflowRuntime
    job_id: str
    attempt_id: str
    attempt_number: int
    task_key: str

    def is_cancelled(self) -> bool:
        row = self.runtime.connection.execute(
            "SELECT cancel_requested FROM jobs WHERE job_id=?", (self.job_id,)
        ).fetchone()
        return row is None or bool(row["cancel_requested"])

    def check_cancelled(self) -> None:
        if self.is_cancelled():
            raise CancellationRequested(f"Cancellation requested for {self.job_id}")

    def set_progress(self, progress: float, *, message: str | None = None) -> None:
        self.check_cancelled()
        if not 0 <= progress <= 1:
            raise ValueError("Progress must be between 0 and 1")
        with transaction(self.runtime.connection):
            self.runtime.connection.execute(
                "UPDATE jobs SET progress=?,updated_at=? WHERE job_id=? AND state='RUNNING'",
                (progress, utc_now(), self.job_id),
            )
            self.runtime._append_event(
                self.job_id, "progress", {"progress": progress, "message": message}
            )

    def heartbeat(self) -> None:
        self.check_cancelled()
        with transaction(self.runtime.connection):
            self.runtime.connection.execute(
                "UPDATE jobs SET lease_expires_at=?,updated_at=? WHERE job_id=? AND state='RUNNING'",
                (_timestamp_after(self.runtime.lease_seconds), utc_now(), self.job_id),
            )

    def record_usage(
        self,
        *,
        provider: str,
        model: str,
        unit: str,
        quantity: float,
        cost_micros: int,
        idempotency_key: str,
        metadata: dict[str, Any] | None = None,
        incurred: bool = False,
    ) -> None:
        self.runtime.record_usage(
            self.job_id,
            provider=provider,
            model=model,
            unit=unit,
            quantity=quantity,
            cost_micros=cost_micros,
            idempotency_key=idempotency_key,
            metadata=metadata,
            incurred=incurred,
        )

    def provider_acceptance(self, idempotency_key: str) -> dict[str, Any] | None:
        return self.runtime.provider_acceptance(self.job_id, idempotency_key)

    def record_provider_acceptance(
        self,
        *,
        idempotency_key: str,
        provider: str,
        model: str,
        provider_request_id: str | None,
        result: dict[str, Any],
        unit: str,
        quantity: float,
        cost_micros: int,
        usage_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Atomically checkpoint an accepted result and its billable usage."""

        return self.runtime.record_provider_acceptance(
            self.job_id,
            idempotency_key=idempotency_key,
            provider=provider,
            model=model,
            provider_request_id=provider_request_id,
            result=result,
            unit=unit,
            quantity=quantity,
            cost_micros=cost_micros,
            usage_metadata=usage_metadata,
        )


class SQLiteWorkflowRuntime:
    """Single-database lease scheduler; safe across multiple worker processes."""

    def __init__(self, connection: Any, *, worker_id: str | None = None, lease_seconds: int = 60) -> None:
        self.connection = connection
        self.worker_id = worker_id or _new_id("worker")
        self.lease_seconds = max(1, lease_seconds)

    def enqueue(
        self,
        *,
        project_id: str,
        kind: str,
        parameters: dict[str, Any],
        job_id: str | None = None,
        action_key: ActionKey | None = None,
        dependency_ids: list[str] | None = None,
        priority: int = 0,
        max_attempts: int = 3,
        estimated_cost_micros: int = 0,
        budget_micros: int | None = None,
    ) -> Job:
        if not kind:
            raise ValueError("Job kind cannot be blank")
        if max_attempts < 1:
            raise ValueError("max_attempts must be at least one")
        if estimated_cost_micros < 0 or (budget_micros is not None and budget_micros < 0):
            raise ValueError("Costs and budgets cannot be negative")
        if budget_micros is not None and estimated_cost_micros > budget_micros:
            raise BudgetExceededError(
                f"Estimated cost {estimated_cost_micros} exceeds budget {budget_micros} micros"
            )
        dependencies = list(dict.fromkeys(dependency_ids or []))
        key = action_key or ActionKey(kind, "1", parameters)
        now = utc_now()
        requested_job_id = job_id or _new_id("job")
        with transaction(self.connection):
            existing = self.connection.execute(
                "SELECT * FROM jobs WHERE project_id=? AND task_key=?",
                (project_id, key.digest),
            ).fetchone()
            if existing is not None:
                return Job.from_row(existing)
            for dependency in dependencies:
                row = self.connection.execute(
                    "SELECT project_id FROM jobs WHERE job_id=?", (dependency,)
                ).fetchone()
                if row is None or row["project_id"] != project_id:
                    raise ValueError(f"Unknown or cross-project dependency: {dependency}")
            state = JobState.BLOCKED if dependencies else JobState.READY
            self.connection.execute(
                """INSERT INTO jobs(
                    job_id,project_id,kind,task_key,implementation_version,state,
                    parameters_json,priority,max_attempts,
                    estimated_cost_micros,budget_micros,available_at,created_at,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    requested_job_id,
                    project_id,
                    kind,
                    key.digest,
                    key.implementation_version,
                    state.value,
                    canonical_json(parameters),
                    priority,
                    max_attempts,
                    estimated_cost_micros,
                    budget_micros,
                    now,
                    now,
                    now,
                ),
            )
            self.connection.executemany(
                "INSERT INTO job_dependencies(job_id,dependency_id) VALUES(?,?)",
                [(requested_job_id, dependency) for dependency in dependencies],
            )
            self._append_event(
                requested_job_id, "created", {"state": state.value, "kind": kind}
            )
            if state == JobState.READY:
                self._transition(
                    requested_job_id,
                    JobState.READY,
                    JobState.QUEUED,
                    {"reason": "no_dependencies"},
                )
        return self.get_job(requested_job_id)

    def get_job(self, job_id: str) -> Job:
        row = self.connection.execute("SELECT * FROM jobs WHERE job_id=?", (job_id,)).fetchone()
        if row is None:
            raise KeyError(job_id)
        return Job.from_row(row)

    def list_jobs(
        self,
        *,
        project_id: str | None = None,
        states: list[JobState] | None = None,
        limit: int = 200,
    ) -> list[Job]:
        if not 1 <= limit <= 1000:
            raise ValueError("Job limit must be between 1 and 1000")
        clauses: list[str] = []
        parameters: list[Any] = []
        if project_id is not None:
            clauses.append("project_id=?")
            parameters.append(project_id)
        if states:
            clauses.append(f"state IN ({','.join('?' for _ in states)})")
            parameters.extend(state.value for state in states)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = self.connection.execute(
            f"SELECT * FROM jobs {where} ORDER BY created_at DESC LIMIT ?", [*parameters, limit]
        ).fetchall()
        return [Job.from_row(row) for row in rows]

    def events(self, job_id: str, *, after_sequence: int = 0, limit: int = 500) -> list[JobEvent]:
        rows = self.connection.execute(
            """SELECT * FROM job_events WHERE job_id=? AND sequence>?
            ORDER BY sequence LIMIT ?""",
            (job_id, after_sequence, limit),
        ).fetchall()
        return [
            JobEvent(
                sequence=row["sequence"],
                event_id=row["event_id"],
                job_id=row["job_id"],
                event_type=row["event_type"],
                payload=json.loads(row["payload_json"]),
                created_at=row["created_at"],
            )
            for row in rows
        ]

    def cancel(self, job_id: str) -> Job:
        with transaction(self.connection):
            job = self.get_job(job_id)
            if job.state in {JobState.SUCCEEDED, JobState.FAILED, JobState.CANCELLED, JobState.STALE}:
                return job
            self.connection.execute(
                "UPDATE jobs SET cancel_requested=1,updated_at=? WHERE job_id=?",
                (utc_now(), job_id),
            )
            self._append_event(job_id, "cancellation_requested", {})
            if job.state != JobState.RUNNING:
                self._transition(job_id, job.state, JobState.CANCELLED, {"reason": "requested"})
        return self.get_job(job_id)

    def retry(self, job_id: str) -> Job:
        with transaction(self.connection):
            job = self.get_job(job_id)
            if job.state not in {JobState.FAILED, JobState.CANCELLED, JobState.STALE}:
                raise InvalidTransitionError(f"Cannot retry a {job.state.value} job")
            dependency_states = [
                JobState(row["state"])
                for row in self.connection.execute(
                    """SELECT dependency.state FROM job_dependencies edge
                    JOIN jobs dependency ON dependency.job_id=edge.dependency_id
                    WHERE edge.job_id=?""",
                    (job_id,),
                )
            ]
            target = (
                JobState.QUEUED
                if not dependency_states
                or all(state is JobState.SUCCEEDED for state in dependency_states)
                else JobState.BLOCKED
            )
            self.connection.execute(
                """UPDATE jobs SET cancel_requested=0,error_json=NULL,result_json=NULL,
                progress=0,completed_at=NULL,available_at=?,updated_at=? WHERE job_id=?""",
                (utc_now(), utc_now(), job_id),
            )
            self._transition(
                job_id,
                job.state,
                target,
                {"reason": "manual_retry", "dependenciesReady": target is JobState.QUEUED},
            )
        return self.get_job(job_id)

    def mark_stale(self, job_id: str, *, reason: str) -> Job:
        with transaction(self.connection):
            job = self.get_job(job_id)
            if job.state == JobState.STALE:
                return job
            if JobState.STALE not in ALLOWED_TRANSITIONS[job.state]:
                raise InvalidTransitionError(f"Cannot mark a {job.state.value} job stale")
            self._transition(job_id, job.state, JobState.STALE, {"reason": reason})
        return self.get_job(job_id)

    def run_once(self, handlers: Mapping[str, TaskHandler]) -> Job | None:
        self.recover_expired()
        self._unblock_ready_jobs()
        claim = self._claim_next()
        if claim is None:
            return None
        job, attempt_id = claim
        handler = handlers.get(job.kind)
        if handler is None:
            self._finish_failed(job, attempt_id, {"code": "NO_HANDLER", "message": job.kind})
            return self.get_job(job.job_id)
        context = JobContext(self, job.job_id, attempt_id, job.attempt_count, job.task_key)
        try:
            with self._maintain_lease(job.job_id):
                context.check_cancelled()
                result = handler(context, job.parameters)
                context.check_cancelled()
                if not isinstance(result, dict):
                    raise TypeError("Task handlers must return a JSON object")
        except BaseException as error:
            # A cooperative subprocess/transport may raise its own exception
            # after observing the durable stop request. Do not retry cancelled
            # work or mislabel the resulting process exit as an ordinary failure.
            if isinstance(error, CancellationRequested) or context.is_cancelled():
                self._finish_cancelled(job, attempt_id, str(error))
            elif isinstance(error, RetryableTaskError):
                self._finish_retryable(job, attempt_id, error)
            elif isinstance(error, BudgetExceededError):
                self._finish_failed(
                    job, attempt_id, {"code": "BUDGET_EXCEEDED", "message": str(error)}
                )
            else:
                self._finish_failed(
                    job,
                    attempt_id,
                    {
                        "code": "TASK_FAILED",
                        "message": str(error),
                        "exceptionType": type(error).__name__,
                        "traceback": traceback.format_exc(limit=20),
                    },
                )
        else:
            self._finish_succeeded(job, attempt_id, result)
        return self.get_job(job.job_id)

    @contextmanager
    def _maintain_lease(self, job_id: str) -> Iterator[None]:
        """Renew a claimed lease while a provider or renderer call is blocked.

        A separate SQLite connection is required because the handler owns this
        runtime's connection and Python SQLite connections are thread-affine.
        In-memory test databases have no recoverable process boundary and skip
        the watchdog.
        """

        database_row = self.connection.execute("PRAGMA database_list").fetchone()
        database_path = None if database_row is None else str(database_row["file"] or "")
        if not database_path:
            yield
            return
        stopped = threading.Event()

        def renew() -> None:
            connection = sqlite3.connect(database_path, timeout=5, isolation_level=None)
            try:
                connection.execute("PRAGMA busy_timeout = 5000")
                interval = max(0.1, min(10.0, self.lease_seconds / 3))
                while not stopped.wait(interval):
                    try:
                        connection.execute(
                            """UPDATE jobs SET lease_expires_at=?,updated_at=?
                            WHERE job_id=? AND state='RUNNING' AND lease_owner=?""",
                            (
                                _timestamp_after(self.lease_seconds),
                                utc_now(),
                                job_id,
                                self.worker_id,
                            ),
                        )
                    except sqlite3.Error:
                        # A transient busy interval is bounded by the original
                        # lease; the next watchdog tick retries automatically.
                        continue
            finally:
                connection.close()

        watchdog = threading.Thread(
            target=renew,
            name=f"alystria-lease-{job_id[-8:]}",
            daemon=True,
        )
        watchdog.start()
        try:
            yield
        finally:
            stopped.set()
            watchdog.join(timeout=2)

    def run_until_idle(
        self, handlers: Mapping[str, TaskHandler], *, max_jobs: int = 1000
    ) -> list[Job]:
        completed: list[Job] = []
        for _ in range(max_jobs):
            job = self.run_once(handlers)
            if job is None:
                break
            completed.append(job)
        else:
            raise JobRuntimeError(f"Runtime did not become idle after {max_jobs} jobs")
        return completed

    def recover_expired(self) -> list[str]:
        now = utc_now()
        recovered: list[str] = []
        with transaction(self.connection):
            rows = self.connection.execute(
                "SELECT * FROM jobs WHERE state='RUNNING' AND lease_expires_at<?", (now,)
            ).fetchall()
            for row in rows:
                job = Job.from_row(row)
                self.connection.execute(
                    """UPDATE job_attempts SET state='ABANDONED',completed_at=?,
                    error_json=? WHERE job_id=? AND state='RUNNING'""",
                    (now, canonical_json({"code": "LEASE_EXPIRED"}), job.job_id),
                )
                if job.cancel_requested:
                    self._transition(job.job_id, JobState.RUNNING, JobState.CANCELLED, {"reason": "lease_expired_after_cancel"})
                elif job.attempt_count < job.max_attempts:
                    self.connection.execute(
                        "UPDATE jobs SET available_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE job_id=?",
                        (now, job.job_id),
                    )
                    self._transition(job.job_id, JobState.RUNNING, JobState.RETRY_WAIT, {"reason": "lease_expired"})
                    self._transition(job.job_id, JobState.RETRY_WAIT, JobState.QUEUED, {"reason": "recovered"})
                else:
                    self._transition(job.job_id, JobState.RUNNING, JobState.FAILED, {"reason": "lease_expired_max_attempts"})
                recovered.append(job.job_id)
        return recovered

    def record_usage(
        self,
        job_id: str,
        *,
        provider: str,
        model: str,
        unit: str,
        quantity: float,
        cost_micros: int,
        idempotency_key: str,
        metadata: dict[str, Any] | None = None,
        incurred: bool = False,
    ) -> None:
        if quantity < 0 or cost_micros < 0:
            raise ValueError("Usage quantity and cost cannot be negative")
        usage_id = "use_" + hashlib.sha256(
            f"{job_id}:{idempotency_key}".encode()
        ).hexdigest()[:32]
        with transaction(self.connection):
            job = self.get_job(job_id)
            existing = self.connection.execute(
                "SELECT 1 FROM usage_records WHERE usage_id=?", (usage_id,)
            ).fetchone()
            if existing is not None:
                return
            spent = int(
                self.connection.execute(
                    "SELECT COALESCE(SUM(cost_micros),0) FROM usage_records WHERE job_id=?",
                    (job_id,),
                ).fetchone()[0]
            )
            overage_micros = (
                max(0, spent + cost_micros - job.budget_micros)
                if job.budget_micros is not None
                else 0
            )
            if overage_micros and not incurred:
                raise BudgetExceededError(
                    f"Usage would exceed the job budget of {job.budget_micros} micros"
                )
            stored_metadata = dict(metadata or {})
            if incurred:
                stored_metadata["incurred"] = True
            if overage_micros:
                stored_metadata["budgetOverageMicros"] = overage_micros
            self.connection.execute(
                """INSERT INTO usage_records(
                    usage_id,job_id,provider,model,unit,quantity,cost_micros,metadata_json,created_at
                ) VALUES(?,?,?,?,?,?,?,?,?)""",
                (
                    usage_id,
                    job_id,
                    provider,
                    model,
                    unit,
                    quantity,
                    cost_micros,
                    canonical_json(stored_metadata),
                    utc_now(),
                ),
            )
            self._append_event(
                job_id,
                "usage_recorded",
                {"provider": provider, "model": model, "unit": unit, "quantity": quantity, "costMicros": cost_micros},
            )

    def usage_summary(self, job_id: str) -> UsageSummary:
        rows = self.connection.execute(
            "SELECT provider,COUNT(*) records,SUM(cost_micros) cost FROM usage_records WHERE job_id=? GROUP BY provider",
            (job_id,),
        ).fetchall()
        by_provider = {row["provider"]: int(row["cost"] or 0) for row in rows}
        return UsageSummary(sum(by_provider.values()), sum(int(row["records"]) for row in rows), by_provider)

    def provider_acceptance(
        self, job_id: str, idempotency_key: str
    ) -> dict[str, Any] | None:
        if not idempotency_key.strip():
            raise ValueError("Provider idempotency key cannot be blank")
        row = self.connection.execute(
            """SELECT * FROM provider_acceptance_checkpoints
            WHERE job_id=? AND idempotency_key=?""",
            (job_id, idempotency_key),
        ).fetchone()
        if row is None:
            return None
        return {
            "checkpointId": row["checkpoint_id"],
            "jobId": row["job_id"],
            "idempotencyKey": row["idempotency_key"],
            "provider": row["provider"],
            "model": row["model"],
            "providerRequestId": row["provider_request_id"],
            "result": json.loads(row["result_json"]),
            "acceptedAt": row["accepted_at"],
        }

    def record_provider_acceptance(
        self,
        job_id: str,
        *,
        idempotency_key: str,
        provider: str,
        model: str,
        provider_request_id: str | None,
        result: dict[str, Any],
        unit: str,
        quantity: float,
        cost_micros: int,
        usage_metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Commit provider acceptance and cost exactly once for a job call.

        A recovered attempt must query this checkpoint before contacting the
        provider. The result and usage record share one SQLite transaction, so
        there is no state where accepted work is forgotten but its charge is
        retained (or vice versa).
        """

        if not idempotency_key.strip() or not provider.strip() or not model.strip():
            raise ValueError("Provider checkpoint identifiers cannot be blank")
        checkpoint_id = "provider_" + hashlib.sha256(
            f"{job_id}:{idempotency_key}".encode()
        ).hexdigest()[:32]
        with transaction(self.connection):
            existing = self.provider_acceptance(job_id, idempotency_key)
            if existing is not None:
                if existing["provider"] != provider or existing["model"] != model:
                    raise ValueError("Provider checkpoint identity cannot change on retry")
                return existing
            self.record_usage(
                job_id,
                provider=provider,
                model=model,
                unit=unit,
                quantity=quantity,
                cost_micros=cost_micros,
                idempotency_key=f"provider-accepted:{idempotency_key}",
                metadata=usage_metadata,
            )
            accepted_at = utc_now()
            self.connection.execute(
                """INSERT INTO provider_acceptance_checkpoints(
                    checkpoint_id,job_id,idempotency_key,provider,model,
                    provider_request_id,result_json,accepted_at
                ) VALUES(?,?,?,?,?,?,?,?)""",
                (
                    checkpoint_id,
                    job_id,
                    idempotency_key,
                    provider,
                    model,
                    provider_request_id,
                    canonical_json(result),
                    accepted_at,
                ),
            )
            self._append_event(
                job_id,
                "provider_accepted",
                {
                    "checkpointId": checkpoint_id,
                    "provider": provider,
                    "model": model,
                    "providerRequestId": provider_request_id,
                },
            )
        checkpoint = self.provider_acceptance(job_id, idempotency_key)
        assert checkpoint is not None
        return checkpoint

    def cached_result(self, project_id: str, task_key: str) -> dict[str, Any] | None:
        row = self.connection.execute(
            "SELECT result_json FROM task_cache WHERE project_id=? AND task_key=?",
            (project_id, task_key),
        ).fetchone()
        return None if row is None else json.loads(row["result_json"])

    def _unblock_ready_jobs(self) -> None:
        with transaction(self.connection):
            rows = self.connection.execute("SELECT job_id FROM jobs WHERE state='BLOCKED'").fetchall()
            for row in rows:
                states = [
                    JobState(dependency["state"])
                    for dependency in self.connection.execute(
                        """SELECT dependency.state FROM job_dependencies edge
                        JOIN jobs dependency ON dependency.job_id=edge.dependency_id
                        WHERE edge.job_id=?""",
                        (row["job_id"],),
                    )
                ]
                if states and all(state == JobState.SUCCEEDED for state in states):
                    self._transition(row["job_id"], JobState.BLOCKED, JobState.READY, {"reason": "dependencies_succeeded"})
                    self._transition(row["job_id"], JobState.READY, JobState.QUEUED, {"reason": "ready"})

    def _claim_next(self) -> tuple[Job, str] | None:
        now = utc_now()
        with transaction(self.connection):
            row = self.connection.execute(
                """SELECT * FROM jobs WHERE state IN ('QUEUED','RETRY_WAIT')
                AND available_at<=? AND cancel_requested=0
                ORDER BY priority DESC,created_at ASC LIMIT 1""",
                (now,),
            ).fetchone()
            if row is None:
                return None
            job = Job.from_row(row)
            current = job.state
            if current == JobState.RETRY_WAIT:
                self._transition(job.job_id, current, JobState.QUEUED, {"reason": "retry_delay_elapsed"})
                current = JobState.QUEUED
            attempt_number = job.attempt_count + 1
            attempt_id = _new_id("attempt")
            self.connection.execute(
                """UPDATE jobs SET attempt_count=?,lease_owner=?,lease_expires_at=?,
                started_at=COALESCE(started_at,?),updated_at=? WHERE job_id=?""",
                (
                    attempt_number,
                    self.worker_id,
                    _timestamp_after(self.lease_seconds),
                    now,
                    now,
                    job.job_id,
                ),
            )
            self._transition(job.job_id, current, JobState.RUNNING, {"attempt": attempt_number})
            self.connection.execute(
                """INSERT INTO job_attempts(
                    attempt_id,job_id,attempt_number,state,worker_id,started_at
                ) VALUES(?,?,?,'RUNNING',?,?)""",
                (attempt_id, job.job_id, attempt_number, self.worker_id, now),
            )
        return self.get_job(job.job_id), attempt_id

    def _finish_succeeded(self, job: Job, attempt_id: str, result: dict[str, Any]) -> None:
        now = utc_now()
        with transaction(self.connection):
            self.connection.execute(
                "UPDATE job_attempts SET state='SUCCEEDED',completed_at=? WHERE attempt_id=?",
                (now, attempt_id),
            )
            self.connection.execute(
                """UPDATE jobs SET result_json=?,error_json=NULL,progress=1,
                lease_owner=NULL,lease_expires_at=NULL,completed_at=?,updated_at=? WHERE job_id=?""",
                (canonical_json(result), now, now, job.job_id),
            )
            self._transition(job.job_id, JobState.RUNNING, JobState.SUCCEEDED, {"result": result})
            self.connection.execute(
                """INSERT INTO task_cache(project_id,task_key,result_json,created_at)
                VALUES(?,?,?,?) ON CONFLICT(project_id,task_key) DO UPDATE SET
                result_json=excluded.result_json,created_at=excluded.created_at""",
                (job.project_id, job.task_key, canonical_json(result), now),
            )

    def _finish_cancelled(self, job: Job, attempt_id: str, reason: str) -> None:
        now = utc_now()
        with transaction(self.connection):
            self.connection.execute(
                "UPDATE job_attempts SET state='CANCELLED',completed_at=?,error_json=? WHERE attempt_id=?",
                (now, canonical_json({"message": reason}), attempt_id),
            )
            self.connection.execute(
                "UPDATE jobs SET completed_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE job_id=?",
                (now, now, job.job_id),
            )
            self._transition(job.job_id, JobState.RUNNING, JobState.CANCELLED, {"reason": reason})

    def _finish_retryable(self, job: Job, attempt_id: str, error: RetryableTaskError) -> None:
        now = utc_now()
        payload = {"code": "RETRYABLE", "message": str(error)}
        with transaction(self.connection):
            self.connection.execute(
                "UPDATE job_attempts SET state='FAILED',completed_at=?,error_json=? WHERE attempt_id=?",
                (now, canonical_json(payload), attempt_id),
            )
            current = self.get_job(job.job_id)
            if current.attempt_count >= current.max_attempts:
                self.connection.execute(
                    "UPDATE jobs SET error_json=?,completed_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE job_id=?",
                    (canonical_json(payload), now, now, job.job_id),
                )
                self._transition(job.job_id, JobState.RUNNING, JobState.FAILED, payload)
            else:
                self.connection.execute(
                    """UPDATE jobs SET error_json=?,available_at=?,lease_owner=NULL,
                    lease_expires_at=NULL,updated_at=? WHERE job_id=?""",
                    (canonical_json(payload), _timestamp_after(error.retry_after_seconds), now, job.job_id),
                )
                self._transition(job.job_id, JobState.RUNNING, JobState.RETRY_WAIT, payload)

    def _finish_failed(self, job: Job, attempt_id: str, payload: dict[str, Any]) -> None:
        now = utc_now()
        with transaction(self.connection):
            self.connection.execute(
                "UPDATE job_attempts SET state='FAILED',completed_at=?,error_json=? WHERE attempt_id=?",
                (now, canonical_json(payload), attempt_id),
            )
            self.connection.execute(
                """UPDATE jobs SET error_json=?,completed_at=?,lease_owner=NULL,
                lease_expires_at=NULL,updated_at=? WHERE job_id=?""",
                (canonical_json(payload), now, now, job.job_id),
            )
            self._transition(job.job_id, JobState.RUNNING, JobState.FAILED, payload)

    def _transition(
        self,
        job_id: str,
        from_state: JobState,
        to_state: JobState,
        payload: dict[str, Any],
    ) -> None:
        if to_state not in ALLOWED_TRANSITIONS[from_state]:
            raise InvalidTransitionError(f"Invalid transition {from_state.value} -> {to_state.value}")
        completed = utc_now() if to_state in {JobState.SUCCEEDED, JobState.FAILED, JobState.CANCELLED, JobState.STALE} else None
        cursor = self.connection.execute(
            """UPDATE jobs SET state=?,updated_at=?,completed_at=COALESCE(?,completed_at)
            WHERE job_id=? AND state=?""",
            (to_state.value, utc_now(), completed, job_id, from_state.value),
        )
        if cursor.rowcount != 1:
            actual = self.connection.execute("SELECT state FROM jobs WHERE job_id=?", (job_id,)).fetchone()
            raise InvalidTransitionError(
                f"Concurrent transition for {job_id}; expected {from_state.value}, actual {actual['state'] if actual else 'missing'}"
            )
        self._append_event(
            job_id,
            "state_changed",
            {"from": from_state.value, "to": to_state.value, **payload},
        )

    def _append_event(self, job_id: str, event_type: str, payload: dict[str, Any]) -> None:
        self.connection.execute(
            "INSERT INTO job_events(event_id,job_id,event_type,payload_json,created_at) VALUES(?,?,?,?,?)",
            (_new_id("evt"), job_id, event_type, canonical_json(payload), utc_now()),
        )


class DBOSWorkflowRuntime:
    """Capability marker for the gated DBOS implementation.

    The packaged Windows spike must validate DBOS recovery semantics before this
    adapter may be selected. Until then, construction fails explicitly and the
    service selects SQLite rather than silently claiming DBOS durability.
    """

    @staticmethod
    def available() -> bool:
        return importlib.util.find_spec("dbos") is not None

    def __init__(self, *_: Any, windows_spike_approved: bool = False, **__: Any) -> None:
        if not self.available():
            raise RuntimeError("DBOS is not installed; install the 'dbos' optional dependency")
        if not windows_spike_approved:
            raise RuntimeError("DBOS runtime is gated until the packaged Windows recovery spike passes")
        raise NotImplementedError("DBOS adapter awaits the approved packaging spike")


def select_workflow_runtime(connection: Any, *, backend: str = "sqlite") -> WorkflowRuntime:
    if backend == "sqlite":
        return SQLiteWorkflowRuntime(connection)
    if backend == "dbos":
        # Construction is intentionally gated; the cast keeps selection behind
        # the public runtime interface until the DBOS adapter is activated.
        return cast(WorkflowRuntime, DBOSWorkflowRuntime(connection))
    raise ValueError(f"Unknown workflow runtime backend: {backend}")
