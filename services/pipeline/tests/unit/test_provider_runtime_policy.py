from __future__ import annotations

import json
import socket
import threading
import uuid
from pathlib import Path
from typing import Any

import pytest

from alystria.project import ProjectStore
from alystria.providers import (
    CredentialGrant,
    DesktopCredentialBrokerResolver,
    EphemeralCredentialBroker,
    HttpRequest,
    HttpResponse,
    ProviderFailure,
    ProviderRuntimeFactory,
    ProviderTextClient,
    TextRequest,
    load_and_validate_root_catalog,
    parse_routing_policy,
)
from alystria.service import PipelineService


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
    assert status["state"] == "SUCCEEDED"
    assert {stage["stage"] for stage in status["stages"]} >= {"assets", "narration", "export"}


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
