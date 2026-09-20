from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from alystria.generation.workflow import _record_structured_provider_usage
from alystria.jobs import JobContext, JobState, SQLiteWorkflowRuntime
from alystria.project import ProjectStore
from alystria.providers import (
    DataClassification,
    HttpRequest,
    HttpResponse,
    NvidiaNimAdapter,
    ProviderResult,
    RequestContext,
    TextOutput,
    TextRequest,
    Usage,
)


class PreviewTransport:
    def __init__(self, usage: dict[str, Any] | None) -> None:
        self.usage = usage

    def send(self, request: HttpRequest) -> HttpResponse:
        payload: dict[str, Any] = {
            "id": "preview-response",
            "model": "openai/gpt-oss-20b",
            "choices": [{"message": {"content": '{"answer":"three products"}'}}],
        }
        if self.usage is not None:
            payload["usage"] = self.usage
        return HttpResponse(200, {}, json.dumps(payload).encode())


@pytest.mark.parametrize("telemetry", [None, {"prompt_tokens": 12, "completion_tokens": 7}])
def test_preview_response_persists_known_cost_without_inventing_tokens(
    tmp_path: Path, telemetry: dict[str, Any] | None,
) -> None:
    adapter = NvidiaNimAdapter(PreviewTransport(telemetry))
    result = adapter.invoke(
        TextRequest("Explain three products", "openai/gpt-oss-20b"),
        RequestContext(
            idempotency_key="preview", approved_provider_id="nvidia-nim",
            credential="fixture", data_classification=DataClassification.PUBLIC,
            metadata={"termsApproved": "true", "modelAccessCheckedAt": "2026-09-05T00:00:00Z"},
        ),
    )
    assert result.usage.actual_cost_micros == 0
    if telemetry is None:
        assert result.usage.units == {}
    with ProjectStore.create(tmp_path / "preview", name="Preview accounting") as store:
        runtime = SQLiteWorkflowRuntime(store.connection)
        runtime.enqueue(project_id=store.manifest.project_id, kind="record-preview", parameters={})

        def record(context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
            _record_structured_provider_usage(context, "preview", result)
            return {"recorded": True}

        completed = runtime.run_once({"record-preview": record})
        assert completed is not None and completed.state is JobState.SUCCEEDED
        row = store.connection.execute("SELECT * FROM usage_records").fetchone()
        assert row["cost_micros"] == 0
        metadata = json.loads(row["metadata_json"])
        if telemetry is None:
            assert row["unit"] == "requests" and row["quantity"] == 1
            assert metadata["inputTokens"] is None and metadata["outputTokens"] is None
            assert metadata["tokenUsageComplete"] is False
            assert metadata["usageComplete"] is True
            assert metadata["knownCostMicros"] == 0
        else:
            assert row["unit"] == "tokens" and row["quantity"] == 19


@pytest.mark.parametrize("provider,basis", [("groq", "nvidia-hosted-developer-preview-v1"), ("nvidia-nim", None)])
def test_missing_tokens_do_not_gain_generic_zero_cost_exemption(
    tmp_path: Path, provider: str, basis: str | None,
) -> None:
    result = ProviderResult(provider, "model", TextOutput("text"), Usage(provider, "model", {}, 0, billing_basis=basis))
    with ProjectStore.create(tmp_path / "priced", name="Priced accounting") as store:
        runtime = SQLiteWorkflowRuntime(store.connection)
        runtime.enqueue(project_id=store.manifest.project_id, kind="record-priced", parameters={})

        def record(context: JobContext, parameters: dict[str, Any]) -> dict[str, Any]:
            _record_structured_provider_usage(context, "priced", result)
            return {}

        completed = runtime.run_once({"record-priced": record})
        assert completed is not None and completed.state is JobState.FAILED
        assert store.connection.execute("SELECT count(*) FROM usage_records").fetchone()[0] == 0
