"""Durable job state machine records."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from enum import StrEnum
from sqlite3 import Row
from typing import Any


class JobState(StrEnum):
    BLOCKED = "BLOCKED"
    READY = "READY"
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    RETRY_WAIT = "RETRY_WAIT"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    STALE = "STALE"


TERMINAL_STATES = frozenset({JobState.SUCCEEDED, JobState.FAILED, JobState.CANCELLED, JobState.STALE})

ALLOWED_TRANSITIONS: dict[JobState, frozenset[JobState]] = {
    JobState.BLOCKED: frozenset({JobState.READY, JobState.CANCELLED, JobState.STALE}),
    JobState.READY: frozenset({JobState.QUEUED, JobState.CANCELLED, JobState.STALE}),
    JobState.QUEUED: frozenset({JobState.RUNNING, JobState.CANCELLED, JobState.STALE}),
    JobState.RUNNING: frozenset(
        {JobState.SUCCEEDED, JobState.RETRY_WAIT, JobState.FAILED, JobState.CANCELLED}
    ),
    JobState.RETRY_WAIT: frozenset({JobState.QUEUED, JobState.CANCELLED, JobState.STALE}),
    JobState.SUCCEEDED: frozenset({JobState.STALE}),
    JobState.FAILED: frozenset({JobState.BLOCKED, JobState.QUEUED, JobState.STALE}),
    JobState.CANCELLED: frozenset({JobState.BLOCKED, JobState.QUEUED, JobState.STALE}),
    JobState.STALE: frozenset({JobState.BLOCKED, JobState.QUEUED}),
}


@dataclass(frozen=True, slots=True)
class Job:
    job_id: str
    project_id: str
    kind: str
    task_key: str
    implementation_version: str
    state: JobState
    parameters: dict[str, Any]
    result: dict[str, Any] | None
    error: dict[str, Any] | None
    progress: float
    priority: int
    max_attempts: int
    attempt_count: int
    cancel_requested: bool
    estimated_cost_micros: int
    budget_micros: int | None
    available_at: str
    lease_owner: str | None
    lease_expires_at: str | None
    created_at: str
    updated_at: str
    started_at: str | None
    completed_at: str | None

    def to_dict(self) -> dict[str, Any]:
        diagnostics = []
        if self.error is not None:
            diagnostics.append(self.error)
        value: dict[str, Any] = {
            "id": self.job_id,
            "jobId": self.job_id,
            "kind": self.kind,
            "taskKey": self.task_key,
            "implementationVersion": self.implementation_version,
            "state": self.state.value,
            "parameters": self.parameters,
            "inputArtifactIds": [],
            "outputArtifactIds": [],
            "dependencyTaskIds": [],
            "attemptIds": [],
            "createdAt": self.created_at,
            "progress": self.progress,
            "maxAttempts": self.max_attempts,
            "diagnostics": diagnostics,
        }
        if self.started_at is not None:
            value["startedAt"] = self.started_at
        if self.completed_at is not None:
            value["completedAt"] = self.completed_at
        if self.state == JobState.RETRY_WAIT:
            value["retryAt"] = self.available_at
        return value

    @classmethod
    def from_row(cls, row: Row) -> Job:
        return cls(
            job_id=row["job_id"],
            project_id=row["project_id"],
            kind=row["kind"],
            task_key=row["task_key"],
            implementation_version=row["implementation_version"],
            state=JobState(row["state"]),
            parameters=json.loads(row["parameters_json"]),
            result=None if row["result_json"] is None else json.loads(row["result_json"]),
            error=None if row["error_json"] is None else json.loads(row["error_json"]),
            progress=float(row["progress"]),
            priority=int(row["priority"]),
            max_attempts=int(row["max_attempts"]),
            attempt_count=int(row["attempt_count"]),
            cancel_requested=bool(row["cancel_requested"]),
            estimated_cost_micros=int(row["estimated_cost_micros"]),
            budget_micros=None if row["budget_micros"] is None else int(row["budget_micros"]),
            available_at=row["available_at"],
            lease_owner=row["lease_owner"],
            lease_expires_at=row["lease_expires_at"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            started_at=row["started_at"],
            completed_at=row["completed_at"],
        )


@dataclass(frozen=True, slots=True)
class JobEvent:
    sequence: int
    event_id: str
    job_id: str
    event_type: str
    payload: dict[str, Any]
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        kind = {
            "state_changed": "state-changed",
            "cancellation_requested": "cancel-requested",
            "usage_recorded": "usage",
        }.get(self.event_type, self.event_type.replace("_", "-"))
        return {
            "id": self.event_id,
            "jobId": self.job_id,
            "sequence": self.sequence,
            "kind": kind,
            "occurredAt": self.created_at,
            "payload": self.payload,
        }


@dataclass(frozen=True, slots=True)
class UsageSummary:
    total_cost_micros: int
    records: int
    by_provider: dict[str, int]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
