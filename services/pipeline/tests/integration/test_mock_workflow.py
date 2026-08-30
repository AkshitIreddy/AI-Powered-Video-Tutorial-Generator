from __future__ import annotations

import io
import json
from pathlib import Path

from alystria.ipc import handle_request, serve
from alystria.jobs import DependencyGraph, JobState, MockGenerationWorkflow, SQLiteWorkflowRuntime
from alystria.project import ProjectStore
from alystria.providers import FailureCode, ProviderFailure
from alystria.service import PipelineService


def test_mock_generation_creates_revision_artifact_and_cache(tmp_path: Path) -> None:
    with ProjectStore.create(tmp_path / "project", name="Mock") as store:
        runtime = SQLiteWorkflowRuntime(store.connection)
        workflow = MockGenerationWorkflow(store, runtime)
        enqueued = workflow.enqueue(topic="Karatsuba multiplication", duration_minutes=12, seed=7)
        completed = runtime.run_until_idle(workflow.handlers)
        assert len(completed) == 4
        final = runtime.get_job(enqueued["finalJobId"])
        assert final.state == JobState.SUCCEEDED
        assert final.result["sceneCount"] == 3
        assert store.cas.verify(final.result["artifactHash"])
        assert store.head_revision().kind == "generation"
        assert runtime.cached_result(store.manifest.project_id, final.task_key) == final.result
        assert DependencyGraph(store.connection, store.manifest.project_id).stale_nodes() == []


def test_service_and_stdio_ipc_end_to_end(tmp_path: Path) -> None:
    project_path = tmp_path / "ipc-project"
    requests = [
        {"id": 1, "method": "system.ping", "params": {}},
        {
            "id": 2,
            "method": "project.create",
            "params": {"path": str(project_path), "name": "IPC"},
        },
        {
            "id": 3,
            "method": "job.enqueueMockGeneration",
            "params": {"projectPath": str(project_path), "topic": "Binary search"},
        },
        {
            "id": 4,
            "method": "job.runPending",
            "params": {"projectPath": str(project_path)},
        },
        {"id": 5, "method": "missing.method", "params": {}},
    ]
    input_stream = io.StringIO("".join(json.dumps(request) + "\n" for request in requests))
    output_stream = io.StringIO()
    assert serve(PipelineService(), input_stream=input_stream, output_stream=output_stream) == 0
    responses = [json.loads(line) for line in output_stream.getvalue().splitlines()]
    assert [response["ok"] for response in responses] == [True, True, True, True, False]
    assert responses[0]["result"]["status"] == "ok"
    assert len(responses[3]["result"]) == 4
    assert responses[4]["error"]["code"] == "NOT_FOUND"


def test_internal_ipc_errors_never_expose_exception_details() -> None:
    class ExplodingService(PipelineService):
        def dispatch(self, method: str, params: dict[str, object]) -> dict[str, object]:
            raise RuntimeError("api_key=super-secret-provider-value internal path")

    response = handle_request(
        ExplodingService(),
        {"id": "safe-error", "method": "system.ping", "params": {}},
    )
    assert response == {
        "id": "safe-error",
        "ok": False,
        "error": {
            "code": "INTERNAL",
            "message": "The pipeline could not complete the request. Review local redacted diagnostics.",
        },
    }


def test_typed_provider_failures_keep_safe_actionable_diagnostics() -> None:
    class ProviderFailureService(PipelineService):
        def dispatch(self, method: str, params: dict[str, object]) -> dict[str, object]:
            raise ProviderFailure(
                FailureCode.AUTHENTICATION,
                "Approved credential is unavailable from the OS keyring broker",
                provider_id="nvidia-nim",
                retryable=False,
            )

    response = handle_request(
        ProviderFailureService(),
        {"id": "provider-error", "method": "system.ping", "params": {}},
    )
    assert response == {
        "id": "provider-error",
        "ok": False,
        "error": {
            "code": "AUTHENTICATION",
            "message": "Approved credential is unavailable from the OS keyring broker",
            "details": {
                "providerId": "nvidia-nim",
                "retryable": False,
                "httpStatus": None,
                "requestId": None,
                "details": {},
            },
        },
    }
