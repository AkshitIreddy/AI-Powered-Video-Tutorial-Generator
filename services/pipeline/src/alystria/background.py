"""Process-lifetime supervision for durable desktop project queues.

The supervisor intentionally owns no project connection between turns. Each
turn opens the authoritative project store, lets the SQLite lease scheduler
claim at most one task, and closes the connection again. This keeps project
locking bounded while a single background execution thread serializes heavy
pipeline work across every project known to the desktop worker.
"""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from pathlib import Path

from .jobs import Job, SQLiteWorkflowRuntime
from .project import ProjectStore

ProjectExecutor = Callable[[ProjectStore, SQLiteWorkflowRuntime], Job | None]


class DesktopJobSupervisor:
    """Run registered project queues autonomously until worker shutdown.

    Registration is idempotent and also acts as a wake-up signal. The known
    project set survives individual RPC requests for the lifetime of the
    Python worker, so retry delays and expired leases are revisited without a
    foreground ``runPending`` call.
    """

    def __init__(
        self,
        executor: ProjectExecutor,
        *,
        lease_seconds: int = 60,
        poll_interval_seconds: float = 0.25,
    ) -> None:
        if poll_interval_seconds <= 0:
            raise ValueError("poll_interval_seconds must be positive")
        self._executor = executor
        self._lease_seconds = max(5, lease_seconds)
        self._poll_interval_seconds = poll_interval_seconds
        self._worker_id = f"desktop-{uuid.uuid4().hex}"
        self._condition = threading.Condition()
        self._projects: dict[str, Path] = {}
        self._wake_generation = 0
        self._stop_requested = False
        self._thread: threading.Thread | None = None
        self._last_errors: dict[str, str] = {}

    def start(self) -> None:
        with self._condition:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stop_requested = False
            self._thread = threading.Thread(
                target=self._run,
                name="alystria-desktop-jobs",
                daemon=True,
            )
            self._thread.start()

    def register(self, project_path: Path) -> None:
        resolved = project_path.resolve(strict=True)
        key = str(resolved)
        with self._condition:
            self._projects[key] = resolved
            self._wake_generation += 1
            self._condition.notify_all()

    def stop(self, *, timeout_seconds: float = 2.0) -> bool:
        """Request shutdown and report whether the runner exited in time.

        The thread is daemonized deliberately: a process termination during an
        uninterruptible provider/renderer call leaves a recoverable SQLite
        lease instead of making desktop shutdown wait indefinitely.
        """

        if timeout_seconds < 0:
            raise ValueError("timeout_seconds cannot be negative")
        with self._condition:
            self._stop_requested = True
            self._wake_generation += 1
            self._condition.notify_all()
            thread = self._thread
        if thread is None:
            return True
        thread.join(timeout_seconds)
        return not thread.is_alive()

    def diagnostics(self) -> dict[str, object]:
        with self._condition:
            return {
                "running": self._thread is not None and self._thread.is_alive(),
                "registeredProjects": len(self._projects),
                "lastErrors": dict(self._last_errors),
            }

    def _run(self) -> None:
        observed_generation = -1
        cursor = 0
        while True:
            with self._condition:
                if self._stop_requested:
                    return
                projects = tuple(self._projects.values())
                current_generation = self._wake_generation
                if not projects:
                    self._condition.wait(self._poll_interval_seconds)
                    continue

            project = projects[cursor % len(projects)]
            cursor += 1
            completed_work = self._run_project_turn(project)

            with self._condition:
                if self._stop_requested:
                    return
                if completed_work:
                    # A newly completed dependency can immediately unblock its
                    # successor; take another round without an artificial wait.
                    continue
                if self._wake_generation == current_generation == observed_generation:
                    self._condition.wait(self._poll_interval_seconds)
                observed_generation = self._wake_generation

    def _run_project_turn(self, project: Path) -> bool:
        key = str(project)
        try:
            with ProjectStore.open(project) as store:
                runtime = SQLiteWorkflowRuntime(
                    store.connection,
                    worker_id=self._worker_id,
                    lease_seconds=self._lease_seconds,
                )
                completed = self._executor(store, runtime)
        except Exception as error:
            # Diagnostics are local and deliberately avoid task payloads. A
            # later registration/poll retries the project; corrupt projects do
            # not terminate supervision for healthy ones.
            with self._condition:
                self._last_errors[key] = f"{type(error).__name__}: {error}"
            return False
        with self._condition:
            self._last_errors.pop(key, None)
        return completed is not None
