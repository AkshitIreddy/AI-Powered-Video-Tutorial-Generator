from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

from alystria.generation.renderer_client import SubprocessCommandRunner
from alystria.jobs import JobState, SQLiteWorkflowRuntime
from alystria.project import ProjectStore


def test_durable_cancel_stops_a_real_running_subprocess(tmp_path: Path) -> None:
    project = tmp_path / "project"
    ready = tmp_path / "child-ready"
    cancel_times: list[float] = []
    failures: list[BaseException] = []
    finished = threading.Event()
    with ProjectStore.create(project, name="Cancellation integration") as store:
        runtime = SQLiteWorkflowRuntime(store.connection)
        job = runtime.enqueue(project_id=store.manifest.project_id, kind="render", parameters={})

        def request_cancel() -> None:
            try:
                deadline = time.monotonic() + 5
                while not ready.exists() and time.monotonic() < deadline:
                    if finished.wait(0.02):
                        return
                assert ready.exists(), "Subprocess never started"
                with ProjectStore.open(project) as control_store:
                    cancel_times.append(time.monotonic())
                    SQLiteWorkflowRuntime(control_store.connection).cancel(job.job_id)
            except BaseException as error:
                failures.append(error)

        control = threading.Thread(target=request_cancel, daemon=True)
        control.start()

        def render(context, parameters):
            SubprocessCommandRunner().run(
                [sys.executable, "-c", "import pathlib,sys,time; pathlib.Path(sys.argv[1]).write_text('ready'); time.sleep(20)", str(ready)],
                cwd=tmp_path,
                timeout_seconds=7,
                cancelled=context.is_cancelled,
            )
            raise AssertionError("Cancelled renderer returned successfully")

        try:
            completed = runtime.run_once({"render": render})
        finally:
            finished.set()
            control.join(timeout=6)
        assert not control.is_alive()
        assert not failures
        assert cancel_times
        assert completed is not None and completed.state == JobState.CANCELLED
        assert time.monotonic() - cancel_times[0] < 4
