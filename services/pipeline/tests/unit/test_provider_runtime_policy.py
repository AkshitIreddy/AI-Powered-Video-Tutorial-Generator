from __future__ import annotations

import json
import socket
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import pytest

from alystria.generation.adapters import DeterministicMediaClient
from alystria.project import ProjectStore
from alystria.providers import (
    Capability,
    CredentialGrant,
    DesktopCredentialBrokerResolver,
    EphemeralCredentialBroker,
    FailureCode,
    HttpRequest,
    HttpResponse,
    ProviderFailure,
    ProviderRuntimeFactory,
    ProviderTextClient,
    TextRequest,
    load_and_validate_root_catalog,
    parse_routing_policy,
)
from alystria.providers.comfyui_local import SDXL_MODEL_ID, ComfyGenerationMediaClient
from alystria.providers.openai_compatible_structured import (
    GROQ_STRUCTURED_120B_MODEL,
    GROQ_STRUCTURED_MODEL,
    MISTRAL_STRUCTURED_MODEL,
    OPENROUTER_STRUCTURED_MODEL,
)
from alystria.providers.runtime import provider_job_budget_scope
from alystria.service import PipelineService, _configured_local_image_runtime


class FixtureTransport:
    def __init__(self) -> None:
        self.requests: list[HttpRequest] = []

    def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        payload = {
            "id": "resp_fixture",
            "status": "completed",
            "model": "gpt-fixture",
            "output_text": "approved fixture response",
            "usage": {"input_tokens": 4, "output_tokens": 3},
        }
        return HttpResponse(200, {"content-type": "application/json"}, json.dumps(payload).encode())


class StructuredFixtureTransport:
    def __init__(self) -> None:
        self.requests: list[HttpRequest] = []

    def send(self, request: HttpRequest) -> HttpResponse:
        self.requests.append(request)
        model = str((request.json_body or {}).get("model", "fixture-structured"))
        payload = {
            "id": "structured_fixture",
            "model": model,
            "choices": [{"message": {"content": '{"lesson":"verified"}'}}],
            "usage": {"prompt_tokens": 8, "completion_tokens": 4},
        }
        return HttpResponse(200, {"content-type": "application/json"}, json.dumps(payload).encode())


def _budget() -> dict[str, Any]:
    return {
        "currency": "USD",
        "hardLimitMicros": None,
        "requireKnownPricing": False,
        "approved": True,
    }


def _cloud_policy() -> dict[str, Any]:
    return {
        "version": 1,
        "privacyMode": "hybrid",
        "dataClassification": "project",
        "budget": _budget(),
        "approvals": [
            {
                "providerId": "openai",
                "capabilities": ["llm.text"],
                "credentialRef": "keyring://alystria/openai/api_key",
                "boundary": "cloud",
                "retention": "configurable",
                "regions": ["provider-managed"],
                "dataClasses": ["project"],
                "privacyApproved": True,
                "retentionApproved": True,
                "regionApproved": True,
                "budgetApproved": True,
            }
        ],
        "routes": [
            {
                "capability": "llm.text",
                "providerIds": ["openai"],
                "model": "gpt-fixture",
                "voice": None,
            }
        ],
    }


def _structured_cloud_policy(provider_id: str, model: str) -> dict[str, Any]:
    credential_ref = f"keyring://alystria/{provider_id}/api_key"
    return {
        "version": 1,
        "privacyMode": "hybrid",
        "dataClassification": "project",
        "budget": _budget(),
        "approvals": [
            {
                "providerId": provider_id,
                "capabilities": ["llm.structured"],
                "credentialRef": credential_ref,
                "boundary": "cloud",
                "retention": "provider_default",
                "regions": ["provider-managed"],
                "dataClasses": ["project"],
                "privacyApproved": True,
                "retentionApproved": True,
                "regionApproved": True,
                "budgetApproved": True,
            }
        ],
        "routes": [
            {
                "capability": "llm.structured",
                "providerIds": [provider_id],
                "model": model,
                "voice": None,
            }
        ],
    }


def _mock_generation_policy() -> dict[str, Any]:
    return {
        "version": 1,
        "privacyMode": "local",
        "dataClassification": "project",
        "budget": {
            "currency": "USD",
            "hardLimitMicros": 0,
            "requireKnownPricing": True,
            "approved": True,
        },
        "approvals": [
            {
                "providerId": "mock",
                "capabilities": ["image.generate", "audio.tts"],
                "credentialRef": None,
                "boundary": "local",
                "retention": "local_only",
                "regions": ["local"],
                "dataClasses": ["project"],
                "privacyApproved": True,
                "retentionApproved": True,
                "regionApproved": True,
                "budgetApproved": True,
            }
        ],
        "routes": [
            {
                "capability": "image.generate",
                "providerIds": ["mock"],
                "model": "mock-image-v1",
                "voice": None,
            },
            {
                "capability": "audio.tts",
                "providerIds": ["mock"],
                "model": "mock-speech-v1",
                "voice": "fixture",
            },
        ],
    }


def _local_presenter_component_policy() -> dict[str, Any]:
    return {
        "version": 1,
        "privacyMode": "local",
        "dataClassification": "project",
        "budget": _budget(),
        "approvals": [
            {
                "providerId": "local-runtime",
                "capabilities": ["portrait.animate", "lipsync.generate"],
                "credentialRef": None,
                "boundary": "local",
                "retention": "local_only",
                "regions": ["local"],
                "dataClasses": ["project"],
                "privacyApproved": True,
                "retentionApproved": True,
                "regionApproved": True,
                "budgetApproved": True,
            }
        ],
        "routes": [
            {
                "capability": "portrait.animate",
                "providerIds": ["local-runtime"],
                "model": "local/liveportrait",
                "voice": None,
            },
            {
                "capability": "lipsync.generate",
                "providerIds": ["local-runtime"],
                "model": "local/musetalk-1.5",
                "voice": None,
            },
        ],
    }


def _all_local_generation_policy() -> dict[str, Any]:
    capabilities = ["llm.structured", "image.generate", "audio.tts"]
    return {
        "version": 1,
        "privacyMode": "local",
        "dataClassification": "project",
        "budget": {
            "currency": "USD",
            "hardLimitMicros": 0,
            "requireKnownPricing": True,
            "approved": True,
        },
        "approvals": [
            {
                "providerId": "local-runtime",
                "capabilities": capabilities,
                "credentialRef": None,
                "boundary": "local",
                "retention": "local_only",
                "regions": ["local"],
                "dataClasses": ["project"],
                "privacyApproved": True,
                "retentionApproved": True,
                "regionApproved": True,
                "budgetApproved": True,
            }
        ],
        "routes": [
            {
                "capability": capability,
                "providerIds": ["local-runtime"],
                "model": model,
                "voice": None,
            }
            for capability, model in (
                ("llm.structured", "local/writer"),
                ("image.generate", "local/procedural-visuals"),
                ("audio.tts", "local/default-narration"),
            )
        ],
    }


def _create_desktop_project(
    project_path: Path,
    project_id: str,
    *,
    title: str,
    snapshot: dict[str, Any],
) -> None:
    project_path.mkdir()
    for relative in (
        "objects/sha256",
        "sources/original",
        "sources/quarantine",
        "staging",
        "exports",
        "backups",
    ):
        (project_path / relative).mkdir(parents=True)
    manifest = {
        "schemaVersion": 1,
        "projectId": project_id,
        "title": title,
        "locale": "en-US",
        "groundingMode": "grounded",
        "createdAt": "2026-08-28T00:00:00Z",
        "updatedAt": "2026-08-28T00:00:00Z",
        "manifestRevision": 1,
        "activeSnapshotId": None,
        "databaseRelativePath": "project.sqlite3",
        "objectStoreRelativePath": "objects/sha256",
        "sourceStoreRelativePath": "sources/original",
    }
    (project_path / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    with ProjectStore.initialize_existing(
        project_path,
        expected_project_id=project_id,
        expected_manifest_revision=1,
        initial_snapshot=snapshot,
    ):
        pass


def test_root_python_provider_ids_and_aliases_are_drift_checked() -> None:
    repository = Path(__file__).parents[4]
    catalog = load_and_validate_root_catalog(repository / "providers.catalog.json")
    assert catalog["aliases"] == {"azure": "azure-speech", "google": "gemini"}
    providers = {entry["id"]: entry for entry in catalog["providers"]}
    expected = {"portrait-animation", "lip-sync"}
    assert expected <= set(providers["local-runtime"]["capabilities"])
    assert expected <= set(providers["presenter-local"]["capabilities"])


def test_local_portrait_and_lipsync_routes_are_distinct_and_round_trip_exactly() -> None:
    submitted = _local_presenter_component_policy()
    policy = parse_routing_policy(submitted)

    assert policy.route_for(Capability.PORTRAIT_ANIMATION).model == "local/liveportrait"
    assert policy.route_for(Capability.LIP_SYNC).model == "local/musetalk-1.5"
    encoded = policy.to_dict()
    assert encoded["routes"] == submitted["routes"]
    assert encoded["approvals"][0]["capabilities"] == [
        "portrait.animate",
        "lipsync.generate",
    ]


def test_approved_credential_reference_selects_adapter_without_persisting_value() -> None:
    policy = parse_routing_policy(_cloud_policy())
    broker = EphemeralCredentialBroker()
    credential_ref = "keyring://alystria/openai/api_key"
    grant = broker.issue("openai", credential_ref, "fixture-credential-never-persist")
    transport = FixtureTransport()
    runtime = ProviderRuntimeFactory(
        transport_factory=lambda _provider_id: transport,
        credential_resolver=broker,
        credential_grants={"openai": grant},
    ).build(policy)

    result = ProviderTextClient(runtime).generate(
        TextRequest("Explain a stable concept", "gpt-fixture"),
        idempotency_key="fixture-attempt-1",
    )

    assert result.provider_id == "openai"
    assert result.value.text == "approved fixture response"
    assert len(transport.requests) == 1
    assert transport.requests[0].redacted_headers()["Authorization"] == "[REDACTED]"
    assert "fixture-credential-never-persist" not in json.dumps(policy.to_dict())
    assert "fixture-credential-never-persist" not in repr(transport.requests[0])


@pytest.mark.parametrize(
    ("provider_id", "model"),
    (
        ("groq", GROQ_STRUCTURED_MODEL),
        ("groq", GROQ_STRUCTURED_120B_MODEL),
        ("mistral", MISTRAL_STRUCTURED_MODEL),
        ("openrouter", OPENROUTER_STRUCTURED_MODEL),
    ),
)
def test_reviewed_structured_cloud_routes_execute_through_runtime_factory(
    provider_id: str,
    model: str,
) -> None:
    policy = parse_routing_policy(_structured_cloud_policy(provider_id, model))
    broker = EphemeralCredentialBroker()
    credential_ref = f"keyring://alystria/{provider_id}/api_key"
    grant = broker.issue(provider_id, credential_ref, "fixture-runtime-credential")
    transport = StructuredFixtureTransport()
    runtime = ProviderRuntimeFactory(
        transport_factory=lambda selected: transport
        if selected == provider_id
        else (_ for _ in ()).throw(AssertionError(f"unexpected provider {selected}")),
        credential_resolver=broker,
        credential_grants={provider_id: grant},
    ).build(policy)

    result = ProviderTextClient(runtime).generate(
        TextRequest(
            "Create a grounded lesson plan.",
            model,
            json_schema={
                "type": "object",
                "properties": {"lesson": {"type": "string"}},
                "required": ["lesson"],
                "additionalProperties": False,
            },
            schema_name="lesson_plan",
        ),
        idempotency_key=f"{provider_id}-structured-runtime",
    )

    assert result.provider_id == provider_id
    assert result.value.parsed == {"lesson": "verified"}
    assert len(transport.requests) == 1
    request = transport.requests[0]
    assert request.url.endswith("/chat/completions")
    assert request.json_body is not None
    assert request.json_body["model"] == model
    assert request.json_body["response_format"]["json_schema"]["strict"] is True
    if provider_id == "groq":
        assert request.json_body["max_completion_tokens"] == 2048
        assert request.json_body["reasoning_effort"] == "low"
        assert "max_tokens" not in request.json_body
    if provider_id == "openrouter":
        assert request.json_body["provider"] == {"require_parameters": True}


def test_durable_job_budget_scope_blocks_groq_repair_reserve_before_transport() -> None:
    policy = parse_routing_policy(
        _structured_cloud_policy("groq", GROQ_STRUCTURED_MODEL)
    )
    broker = EphemeralCredentialBroker()
    credential_ref = "keyring://alystria/groq/api_key"
    grant = broker.issue("groq", credential_ref, "fixture-runtime-credential")
    transport = StructuredFixtureTransport()
    runtime = ProviderRuntimeFactory(
        transport_factory=lambda _selected: transport,
        credential_resolver=broker,
        credential_grants={"groq": grant},
    ).build(policy)
    request = TextRequest(
        "Return one lesson.",
        GROQ_STRUCTURED_MODEL,
        max_output_tokens=256,
        json_schema={
            "type": "object",
            "properties": {"lesson": {"type": "string", "minLength": 1}},
            "required": ["lesson"],
            "additionalProperties": False,
        },
        schema_name="lesson_plan",
    )

    with provider_job_budget_scope(lambda: 1), pytest.raises(
        ProviderFailure, match="hard budget"
    ) as raised:
        ProviderTextClient(runtime).generate(
            request,
            idempotency_key="groq-durable-retry",
        )

    assert raised.value.code is FailureCode.BUDGET_EXCEEDED
    assert transport.requests == []


def test_desktop_keyring_callback_uses_fresh_one_call_nonces() -> None:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(2)
    endpoint = f"127.0.0.1:{listener.getsockname()[1]}"
    token = "fixture-broker-authentication-token-0001"
    observed: list[dict[str, Any]] = []

    def serve() -> None:
        for _ in range(2):
            connection, _address = listener.accept()
            with connection:
                request = json.loads(connection.makefile("rb").readline())
                observed.append(request)
                response = {
                    "protocolVersion": 1,
                    "requestId": request["requestId"],
                    "ok": True,
                    "credential": "fixture-lease-only",
                    "error": None,
                }
                connection.sendall((json.dumps(response) + "\n").encode())
        listener.close()

    server = threading.Thread(target=serve, daemon=True)
    server.start()
    resolver = DesktopCredentialBrokerResolver(endpoint, token)
    grant = CredentialGrant("opaque-generation-grant")
    reference = "keyring://alystria/openai/api_key"
    for _ in range(2):
        with resolver.lease(grant, provider_id="openai", credential_ref=reference) as value:
            assert value == "fixture-lease-only"
    server.join(timeout=3)
    assert not server.is_alive()
    assert len({request["nonce"] for request in observed}) == 2
    assert all(request["authenticationToken"] == token for request in observed)
    assert all(request["credentialRef"] == reference for request in observed)


def test_desktop_keyring_callback_allows_a_slow_os_vault_lookup() -> None:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    endpoint = f"127.0.0.1:{listener.getsockname()[1]}"
    token = "fixture-broker-authentication-token-0002"

    def serve() -> None:
        connection, _address = listener.accept()
        with connection:
            request = json.loads(connection.makefile("rb").readline())
            time.sleep(3.25)
            response = {
                "protocolVersion": 1,
                "requestId": request["requestId"],
                "ok": True,
                "credential": "fixture-delayed-lease",
                "error": None,
            }
            connection.sendall((json.dumps(response) + "\n").encode())
        listener.close()

    server = threading.Thread(target=serve, daemon=True)
    server.start()
    resolver = DesktopCredentialBrokerResolver(endpoint, token)
    with resolver.lease(
        CredentialGrant("opaque-delayed-grant"),
        provider_id="openai",
        credential_ref="keyring://alystria/openai/api_key",
    ) as value:
        assert value == "fixture-delayed-lease"
    server.join(timeout=1)
    assert not server.is_alive()


def test_desktop_keyring_callback_finishes_at_the_newline_frame() -> None:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    endpoint = f"127.0.0.1:{listener.getsockname()[1]}"
    token = "fixture-broker-authentication-token-0003"

    def serve() -> None:
        connection, _address = listener.accept()
        with connection:
            request = json.loads(connection.makefile("rb").readline())
            response = {
                "protocolVersion": 1,
                "requestId": request["requestId"],
                "ok": True,
                "credential": "fixture-framed-lease",
                "error": None,
            }
            connection.sendall((json.dumps(response) + "\n").encode())
            time.sleep(1.0)
        listener.close()

    server = threading.Thread(target=serve, daemon=True)
    server.start()
    resolver = DesktopCredentialBrokerResolver(endpoint, token)
    started = time.monotonic()
    with resolver.lease(
        CredentialGrant("opaque-framed-grant"),
        provider_id="openai",
        credential_ref="keyring://alystria/openai/api_key",
    ) as value:
        assert value == "fixture-framed-lease"
    assert time.monotonic() - started < 0.75
    server.join(timeout=2)
    assert not server.is_alive()


def test_local_mode_rejects_cloud_before_adapter_or_transport() -> None:
    value = _cloud_policy()
    value["privacyMode"] = "local"
    with pytest.raises(ValueError, match="Local privacy mode forbids cloud"):
        parse_routing_policy(value)


def test_policy_persists_only_canonical_opaque_references(tmp_path: Path) -> None:
    project_path = tmp_path / "Policy Project"
    with ProjectStore.create(
        project_path,
        name="Policy Project",
        initial_snapshot={"title": "Policy Project", "sources": []},
    ) as store:
        head = store.head_revision()
        assert head is not None
        expected_head = head.revision_id

    service = PipelineService()
    saved = service.dispatch(
        "provider.routingPolicy.save",
        {
            "projectPath": str(project_path),
            "expectedHeadRevisionId": expected_head,
            "policy": _cloud_policy(),
        },
    )
    encoded = json.dumps(saved, sort_keys=True)
    assert "keyring://alystria/openai/api_key" in encoded
    assert "fixture-credential-never-persist" not in encoded
    loaded = service.dispatch("provider.routingPolicy.get", {"projectPath": str(project_path)})
    assert loaded["policy"] == saved["policy"]


def test_mock_policy_reaches_durable_generation_media_stages(tmp_path: Path) -> None:
    project_id = str(uuid.uuid4())
    project_path = tmp_path / "Mock Provider Generation"
    initial = {
        "id": str(uuid.uuid4()),
        "title": "Binary search",
        "brief": {
            "topic": "Binary search invariants",
            "audience": "Beginning programmers",
            "durationSeconds": 60,
            "locale": "en-US",
        },
        "sources": [],
        "providerRoutingPolicy": _mock_generation_policy(),
    }
    _create_desktop_project(
        project_path, project_id, title="Binary search", snapshot=initial
    )
    factory = ProviderRuntimeFactory(
        transport_factory=lambda _provider_id: (_ for _ in ()).throw(
            AssertionError("local mock must not construct a network transport")
        )
    )
    service = PipelineService(provider_runtime_factory=factory)
    started = service.dispatch(
        "generation.start",
        {
            "projectId": project_id,
            "projectDirectory": str(project_path),
            "scope": {"kind": "project"},
            "quality": "standard",
            "privacy": "local",
            "budget": {
                "currency": "USD",
                "hardLimitMinorUnits": 0,
                "requireKnownPricing": True,
            },
            "approvedProviderIds": ["mock"],
        },
    )
    service.dispatch("job.runPending", {"projectPath": str(project_path)})
    service.dispatch(
        "generation.approve",
        {
            "projectId": project_id,
            "projectDirectory": str(project_path),
            "jobId": started["jobId"],
        },
    )
    service.dispatch("job.runPending", {"projectPath": str(project_path)})
    status = service.dispatch(
        "job.status",
        {
            "projectId": project_id,
            "projectDirectory": str(project_path),
            "jobId": started["jobId"],
        },
    )
    assert status["state"] == "SUCCEEDED", json.dumps(status, sort_keys=True)
    assert {stage["stage"] for stage in status["stages"]} >= {"assets", "narration", "export"}


def test_all_local_policy_uses_local_generation_without_provider_adapter(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    project_id = str(uuid.uuid4())
    project_path = tmp_path / "All Local Generation"
    initial = {
        "id": str(uuid.uuid4()),
        "title": "Stable sorting",
        "brief": {
            "topic": "Stable sorting",
            "audience": "Beginning programmers",
            "durationSeconds": 30,
            "locale": "en-US",
        },
        "sources": [],
        "providerRoutingPolicy": _all_local_generation_policy(),
    }
    _create_desktop_project(project_path, project_id, title="Stable sorting", snapshot=initial)
    monkeypatch.setattr(
        "alystria.service.default_local_media_client",
        lambda: DeterministicMediaClient(),
    )
    factory = ProviderRuntimeFactory(
        transport_factory=lambda _provider_id: (_ for _ in ()).throw(
            AssertionError("local-runtime must not construct a provider transport")
        )
    )
    service = PipelineService(provider_runtime_factory=factory)
    started = service.dispatch(
        "generation.start",
        {
            "projectId": project_id,
            "projectDirectory": str(project_path),
            "scope": {"kind": "project"},
            "quality": "standard",
            "privacy": "local",
            "budget": {
                "currency": "USD",
                "hardLimitMinorUnits": 0,
                "requireKnownPricing": True,
            },
            "approvedProviderIds": ["local-runtime"],
        },
    )
    service.dispatch("job.runPending", {"projectPath": str(project_path)})
    service.dispatch(
        "generation.approve",
        {
            "projectId": project_id,
            "projectDirectory": str(project_path),
            "jobId": started["jobId"],
        },
    )
    service.dispatch("job.runPending", {"projectPath": str(project_path)})
    status = service.dispatch(
        "job.status",
        {
            "projectId": project_id,
            "projectDirectory": str(project_path),
            "jobId": started["jobId"],
        },
    )
    assert status["state"] == "SUCCEEDED"
    assert {stage["stage"] for stage in status["stages"]} >= {"assets", "narration", "export"}


def test_policy_without_image_route_renders_authored_scenes_without_visual_calls(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class AuthoredOnlyMediaClient(DeterministicMediaClient):
        def __init__(self) -> None:
            self.visual_calls = 0

        def create_visual(self, scene: dict[str, Any], *, seed: int) -> Any:
            del scene, seed
            self.visual_calls += 1
            raise AssertionError("authored-only generation must not call an image provider")

    policy = _all_local_generation_policy()
    policy["approvals"][0]["capabilities"].remove("image.generate")
    policy["routes"] = [
        route for route in policy["routes"] if route["capability"] != "image.generate"
    ]
    project_id = str(uuid.uuid4())
    project_path = tmp_path / "Authored Visual Generation"
    initial = {
        "id": str(uuid.uuid4()),
        "title": "Stable sorting",
        "brief": {
            "topic": "Stable sorting",
            "audience": "Beginning programmers",
            "durationSeconds": 30,
            "locale": "en-US",
        },
        "sources": [],
        "providerRoutingPolicy": policy,
    }
    _create_desktop_project(project_path, project_id, title="Stable sorting", snapshot=initial)
    media = AuthoredOnlyMediaClient()
    monkeypatch.setattr("alystria.service.default_local_media_client", lambda: media)
    service = PipelineService(
        provider_runtime_factory=ProviderRuntimeFactory(
            transport_factory=lambda provider_id: (_ for _ in ()).throw(
                AssertionError(provider_id)
            )
        )
    )
    started = service.dispatch(
        "generation.start",
        {
            "projectId": project_id,
            "projectDirectory": str(project_path),
            "scope": {"kind": "project"},
            "quality": "standard",
            "privacy": "local",
            "budget": {
                "currency": "USD",
                "hardLimitMinorUnits": 0,
                "requireKnownPricing": True,
            },
            "approvedProviderIds": ["local-runtime"],
        },
    )
    service.dispatch("job.runPending", {"projectPath": str(project_path)})
    service.dispatch(
        "generation.approve",
        {
            "projectId": project_id,
            "projectDirectory": str(project_path),
            "jobId": started["jobId"],
        },
    )
    service.dispatch("job.runPending", {"projectPath": str(project_path)})
    status = service.dispatch(
        "job.status",
        {
            "projectId": project_id,
            "projectDirectory": str(project_path),
            "jobId": started["jobId"],
        },
    )

    assert status["state"] == "SUCCEEDED", json.dumps(status, sort_keys=True)
    assert media.visual_calls == 0
    assets_stage = next(stage for stage in status["stages"] if stage["stage"] == "assets")
    with ProjectStore.open(project_path) as store:
        row = store.connection.execute(
            "SELECT result_json FROM jobs WHERE job_id=?", (assets_stage["jobId"],)
        ).fetchone()
        assert row is not None
        payload = json.loads(row["result_json"])["payload"]
        assert payload["visualGenerationMode"] == "authored-only"
        assert payload["assets"] == []


def test_exact_local_sdxl_route_selects_supervised_comfy_runtime(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime_root = tmp_path / "ComfyUI"
    runtime_root.mkdir()
    gpu_lock = tmp_path / "gpu-use.txt"
    gpu_lock.write_text("available", encoding="utf-8")
    monkeypatch.setenv("ALYSTRIA_COMFYUI_RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("ALYSTRIA_GPU_LOCK_PATH", str(gpu_lock))
    monkeypatch.setenv("ALYSTRIA_COMFYUI_PORT", "8292")
    policy_value = _all_local_generation_policy()
    for route in policy_value["routes"]:
        if route["capability"] == "image.generate":
            route["model"] = SDXL_MODEL_ID
    policy = parse_routing_policy(policy_value)
    fallback = DeterministicMediaClient()

    configured = _configured_local_image_runtime(fallback, policy)

    assert isinstance(configured, ComfyGenerationMediaClient)
    assert configured.fallback is fallback
    assert configured.runtime_root == runtime_root.resolve()
    assert configured.gpu_lock == gpu_lock.resolve()
    assert configured.port == 8292

    procedural_policy = parse_routing_policy(_all_local_generation_policy())
    assert _configured_local_image_runtime(fallback, procedural_policy) is fallback


def test_local_image_route_does_not_resolve_away_an_indirect_gpu_marker(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runtime_root = tmp_path / "ComfyUI"
    runtime_root.mkdir()
    marker = tmp_path / "gpu-use.txt"
    marker.write_text("no\n", encoding="utf-8")
    indirect = tmp_path / "indirect-gpu-use.txt"
    try:
        indirect.symlink_to(marker)
    except OSError:
        pytest.skip("This host does not permit symlink creation")
    monkeypatch.setenv("ALYSTRIA_COMFYUI_RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("ALYSTRIA_GPU_LOCK_PATH", str(indirect))
    policy_value = _all_local_generation_policy()
    for route in policy_value["routes"]:
        if route["capability"] == "image.generate":
            route["model"] = SDXL_MODEL_ID
    with pytest.raises(ValueError, match="GPU lock is unsafe"):
        _configured_local_image_runtime(
            DeterministicMediaClient(), parse_routing_policy(policy_value)
        )
    assert marker.read_text(encoding="utf-8") == "no\n"


def test_missing_credential_grant_fails_before_generation_enqueue(tmp_path: Path) -> None:
    project_id = str(uuid.uuid4())
    project_path = tmp_path / "Blocked Cloud Project"
    initial = {
        "id": str(uuid.uuid4()),
        "title": "Blocked cloud",
        "brief": {
            "topic": "Blocked cloud",
            "audience": "Test learners",
            "durationSeconds": 60,
            "locale": "en-US",
        },
        "sources": [],
        "providerRoutingPolicy": _cloud_policy(),
    }
    _create_desktop_project(
        project_path, project_id, title="Blocked cloud", snapshot=initial
    )
    service = PipelineService(
        provider_runtime_factory=ProviderRuntimeFactory(
            transport_factory=lambda _provider_id: FixtureTransport()
        )
    )
    with pytest.raises(ProviderFailure, match="keyring broker is unavailable"):
        service.dispatch(
            "generation.start",
            {
                "projectId": project_id,
                "projectDirectory": str(project_path),
                "scope": {"kind": "project"},
                "quality": "standard",
                "privacy": "hybrid",
                "budget": {
                    "currency": "USD",
                    "hardLimitMinorUnits": 0,
                    "requireKnownPricing": False,
                },
                "approvedProviderIds": ["openai"],
            },
        )
    with ProjectStore.open(project_path) as store:
        assert store.connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0
